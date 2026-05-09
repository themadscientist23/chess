// transient stockfish worker for deep / multipv analysis (game review).
// invariants: one worker per engine, dispose() is idempotent, analyze() rejects
// synchronously on a disposed engine, and only the per-analysis timeout can
// reject a healthy run (we wait out slow wasm boot rather than inventing failures).

const INIT_TIMEOUT_MS = 90_000;
const ANALYZE_TIMEOUT_MS = 120_000;
const READY_PING_INTERVAL_MS = 1_500;

export interface MultipvLine {
  multipv: number;
  cp: number | null;
  mate: number | null;
  pvUci: string[];
}

export interface AnalysisResult {
  bestmove: string | null;
  depth: number;
  lines: MultipvLine[];
  rawInfo: string[];
}

export interface AnalyzeOptions {
  // fires when a new depth has produced fresh pv data and is safe to render.
  onUpdate?: (partial: AnalysisResult) => void;
}

export interface AnalysisEngine {
  analyze: (
    fen: string,
    depth: number,
    multipv: number,
    options?: AnalyzeOptions,
  ) => Promise<AnalysisResult>;
  isDisposed: () => boolean;
  dispose: () => void;
}

// decodes whatever the stockfish worker sends (string, wrapper object, etc).
function readWorkerText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data == null) return "";
  if (data instanceof ArrayBuffer) return "";
  if (ArrayBuffer.isView(data)) return "";
  if (typeof data === "object" && "data" in (data as Record<string, unknown>)) {
    const inner = (data as Record<string, unknown>).data;
    return typeof inner === "string" ? inner : "";
  }
  try {
    const s = String(data);
    return s === "[object Object]" ? "" : s;
  } catch {
    return "";
  }
}

// builds the worker js url from the vite base path.
function workerJsUrl(): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${base}/stockfish/stockfish-18-lite-single.js`;
}

interface ParsedInfo {
  multipv: number;
  depth: number;
  cp: number | null;
  mate: number | null;
  pvUci: string[];
}

// permissive `info ...` line parser.
function parseInfoLine(line: string): ParsedInfo | null {
  if (!line.startsWith("info ") || line.includes(" string ")) return null;

  const dm = line.match(/\bdepth (\d+)/);
  const mm = line.match(/\bmultipv (\d+)/);
  const cpM = line.match(/\bscore cp (-?\d+)/);
  const mateM = line.match(/\bscore mate (-?\d+)/);
  const pvM = line.match(/\bpv (.+)$/);

  const hasScore = !!cpM || !!mateM;
  if (!hasScore && !pvM) return null;

  return {
    depth: dm ? Number(dm[1]) : 0,
    multipv: mm ? Number(mm[1]) : 1,
    cp: cpM ? Number(cpM[1]) : null,
    mate: mateM ? Number(mateM[1]) : null,
    pvUci: pvM ? pvM[1]!.trim().split(/\s+/).filter(Boolean) : [],
  };
}

export function createAnalysisEngine(): AnalysisEngine {
  const worker = new Worker(workerJsUrl(), {
    type: "classic",
    name: "stockfish-analyze",
  });

  let disposed = false;
  let boot: "uci" | "ready" | "done" = "uci";
  let initError: Error | null = null;
  let readyPing: ReturnType<typeof setInterval> | null = null;

  type Pending = {
    fen: string;
    resolve: (r: AnalysisResult) => void;
    reject: (e: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    onUpdate?: (partial: AnalysisResult) => void;
    lastEmittedDepth: number;
  };
  let pending: Pending | null = null;

  let rawInfo: string[] = [];
  const lineByPv = new Map<number, MultipvLine>();
  let maxDepth = 0;
  let bestmove: string | null | undefined;

  const resetAccum = () => {
    rawInfo = [];
    lineByPv.clear();
    maxDepth = 0;
    bestmove = undefined;
  };

  const stopReadyPing = () => {
    if (readyPing != null) {
      window.clearInterval(readyPing);
      readyPing = null;
    }
  };

  const failPending = (err: Error) => {
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    const p = pending;
    pending = null;
    resetAccum();
    p.reject(err);
  };

  const tryFinish = () => {
    if (pending == null || bestmove === undefined) return;
    const result: AnalysisResult = {
      bestmove,
      depth: maxDepth,
      lines: [...lineByPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
      rawInfo,
    };
    window.clearTimeout(pending.timeout);
    const p = pending;
    pending = null;
    resetAccum();
    p.resolve(result);
  };

  worker.onmessage = (ev: MessageEvent<unknown>) => {
    const text = readWorkerText(ev.data);
    if (!text) return;

    for (const part of text.split(/\r?\n/)) {
      const line = part.trim();
      if (!line) continue;

      if (boot !== "done") {
        if (line.includes("uciok") && boot === "uci") {
          boot = "ready";
          worker.postMessage("isready");
        } else if (line.toLowerCase() === "readyok" && boot === "ready") {
          boot = "done";
          stopReadyPing();
          console.debug("[sf-analyze] engine ready");
        }
      }

      if (!pending) continue;

      if (line.startsWith("info ")) {
        rawInfo.push(line);
        const p = parseInfoLine(line);
        if (p) {
          lineByPv.set(p.multipv, {
            multipv: p.multipv,
            cp: p.cp,
            mate: p.mate,
            pvUci: p.pvUci,
          });
          maxDepth = Math.max(maxDepth, p.depth);

          // emit partial results once each new completed depth has all multipv
          // lines populated, so subscribers always see a coherent set.
          if (
            pending.onUpdate &&
            p.depth > pending.lastEmittedDepth &&
            p.depth >= 6 &&
            p.pvUci.length > 0
          ) {
            const haveAllPv = lineByPv.size >= p.multipv;
            if (haveAllPv) {
              pending.lastEmittedDepth = p.depth;
              const snapshot: AnalysisResult = {
                bestmove: null,
                depth: p.depth,
                lines: [...lineByPv.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, v]) => v),
                rawInfo: [],
              };
              try {
                pending.onUpdate(snapshot);
              } catch (err) {
                console.error("[sf-analyze] onUpdate handler threw", err);
              }
            }
          }
        }
      }

      const bm = line.match(/^bestmove\s+(\S+)/i);
      if (bm) {
        const tok = bm[1]!;
        bestmove = tok === "(none)" ? null : tok;
        // guarantee at least a bare line so consumers always see a result.
        if (bestmove && lineByPv.size === 0) {
          lineByPv.set(1, { multipv: 1, cp: null, mate: null, pvUci: [bestmove] });
        }
        tryFinish();
      }
    }
  };

  worker.onerror = (ev) => {
    const msg =
      "message" in ev && typeof ev.message === "string" && ev.message
        ? ev.message
        : "Analysis worker runtime error";
    console.error("[sf-analyze] worker error:", msg, ev);
    initError = initError ?? new Error(msg);
    stopReadyPing();
    failPending(new Error(msg));
  };

  worker.onmessageerror = (ev) => {
    console.error("[sf-analyze] worker messageerror", ev);
    initError = initError ?? new Error("Analysis worker message error");
    failPending(new Error("Analysis worker message error"));
  };

  // boot handshake: keep nudging until the engine answers.
  worker.postMessage("uci");
  readyPing = window.setInterval(() => {
    if (boot === "done" || disposed) {
      stopReadyPing();
      return;
    }
    if (boot === "uci") worker.postMessage("uci");
    worker.postMessage("isready");
  }, READY_PING_INTERVAL_MS);

  // shared promise for "engine has answered readyok at least once".
  let readyPromise: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    if (boot === "done") return Promise.resolve();
    if (initError) return Promise.reject(initError);
    if (disposed) return Promise.reject(new Error("Disposed"));

    if (!readyPromise) {
      readyPromise = new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const iv = window.setInterval(() => {
          if (boot === "done") {
            window.clearInterval(iv);
            resolve();
            return;
          }
          if (initError) {
            window.clearInterval(iv);
            reject(initError);
            return;
          }
          if (disposed) {
            window.clearInterval(iv);
            reject(new Error("Disposed"));
            return;
          }
          if (Date.now() - start > INIT_TIMEOUT_MS) {
            window.clearInterval(iv);
            const e = new Error(
              `Analysis engine init timeout after ${INIT_TIMEOUT_MS}ms (no readyok)`,
            );
            initError = e;
            reject(e);
          }
        }, 50);
      });
    }
    return readyPromise;
  };

  const analyze = async (
    fen: string,
    depth: number,
    multipv: number,
    options?: AnalyzeOptions,
  ): Promise<AnalysisResult> => {
    if (disposed) throw new Error("Disposed");
    await ensureReady();
    if (disposed) throw new Error("Disposed");
    if (pending) throw new Error("Analysis already running (caller should serialize)");

    return new Promise<AnalysisResult>((resolve, reject) => {
      resetAccum();
      const timeout = window.setTimeout(() => {
        failPending(
          new Error(`Analysis timeout after ${ANALYZE_TIMEOUT_MS}ms (depth ${depth})`),
        );
      }, ANALYZE_TIMEOUT_MS);

      pending = {
        fen,
        resolve,
        reject,
        timeout,
        onUpdate: options?.onUpdate,
        lastEmittedDepth: 0,
      };

      worker.postMessage("stop");
      worker.postMessage(`setoption name MultiPV value ${multipv}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopReadyPing();
    failPending(new Error("Disposed"));
    try {
      worker.postMessage("stop");
      worker.postMessage("quit");
    } catch {
      // ignore
    }
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  };

  return {
    analyze,
    isDisposed: () => disposed,
    dispose,
  };
}

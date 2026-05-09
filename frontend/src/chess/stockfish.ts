export interface StockfishHandle {
  go: (fen: string, depth?: number) => void;
  stop: () => void;
  dispose: () => void;
  // whether the worker has reported a fatal error or timeout.
  isDead: () => boolean;
}

export type StockfishDiag =
  | { tag: "worker_created"; detail?: string }
  | { tag: "asset_check"; detail: string }
  | { tag: "uci_sent" }
  | { tag: "engine_line"; detail: string }
  | { tag: "uciok" }
  | { tag: "readyok" }
  | { tag: "go_queued" }
  | { tag: "fen_sent"; detail: string }
  | { tag: "search_start"; detail: string }
  | { tag: "search_info"; detail: string }
  | { tag: "bestmove_raw"; detail: string }
  | { tag: "bestmove_none" }
  | { tag: "init_timeout"; detail: string }
  | { tag: "search_timeout"; detail: string }
  | { tag: "worker_error"; detail: string }
  | { tag: "parse_note"; detail: string }
  | { tag: "raw_message"; detail: string };

export interface CreateStockfishOptions {
  onBestMove: (uci: string | null) => void;
  onDiag?: (d: StockfishDiag) => void;
  // ms to wait for uci `readyok` before giving up (wasm compile can be slow).
  initTimeoutMs?: number;
  // ms to wait for `bestmove` after each `go`.
  searchTimeoutMs?: number;
}

function emit(onDiag: CreateStockfishOptions["onDiag"], d: StockfishDiag) {
  onDiag?.(d);
}

// fires HEAD requests for the script + wasm so 404s show up as diagnostics.
function probeAssets(
  jsUrl: string,
  wasmUrl: string,
  onDiag: CreateStockfishOptions["onDiag"],
) {
  const report = (label: string, url: string, status: number | string) => {
    emit(onDiag, { tag: "asset_check", detail: `${label} ${url} → ${status}` });
  };

  void fetch(jsUrl, { method: "HEAD" })
    .then((r) => report("HEAD JS", jsUrl, r.status))
    .catch((e: unknown) => report("HEAD JS (error)", jsUrl, String(e)));

  void fetch(wasmUrl, { method: "HEAD" })
    .then((r) => report("HEAD WASM", wasmUrl, r.status))
    .catch((e: unknown) => report("HEAD WASM (error)", wasmUrl, String(e)));
}

function serializeWorkerData(data: unknown, max = 500): string {
  if (data == null) return String(data);
  if (typeof data === "string") return data.length > max ? `${data.slice(0, max)}…` : data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (data instanceof ArrayBuffer) return `[ArrayBuffer ${data.byteLength} bytes]`;
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return `[TypedArray ${v.constructor.name} ${v.byteLength} bytes]`;
  }
  try {
    const s = JSON.stringify(data);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return Object.prototype.toString.call(data);
  }
}

// builds a stockfish worker handle whose lifecycle is owned by the caller.
// the caller must dispose() on unmount; pair with a strict-mode-safe effect.
export function createStockfish(options: CreateStockfishOptions): StockfishHandle {
  const onBestMove = () => options.onBestMove;
  const onDiag = () => options.onDiag;

  const initTimeoutMs = options.initTimeoutMs ?? 60_000;
  const searchTimeoutMs = options.searchTimeoutMs ?? 60_000;

  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const jsUrl = `${window.location.origin}${base}/stockfish/stockfish-18-lite-single.js`;
  const wasmUrl = `${window.location.origin}${base}/stockfish/stockfish-18-lite-single.wasm`;

  emit(onDiag(), {
    tag: "worker_created",
    detail: `${jsUrl} (classic worker, no hash — WASM: ${wasmUrl})`,
  });
  probeAssets(jsUrl, wasmUrl, onDiag());

  // stockfish-18-lite-single derives the .wasm path from the script url; do not
  // append `#wasmUrl,worker` since some browsers expose an empty WorkerLocation.hash.
  const worker = new Worker(jsUrl, { type: "classic", name: "stockfish" });

  let ready = false;
  let sentIsready = false;
  let disposed = false;
  let dead = false;
  let rawMsgCount = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSearch: { fen: string; depth: number; retries: number } | null = null;
  const deferred: Array<() => void> = [];

  const markDead = (reason: string) => {
    if (dead) return;
    dead = true;
    console.warn(`[sf] engine marked dead: ${reason}`);
  };

  const clearSearchTimer = () => {
    if (searchTimer != null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  };

  const initTimer = window.setTimeout(() => {
    if (disposed || ready) return;
    emit(onDiag(), {
      tag: "init_timeout",
      detail: `No readyok after ${initTimeoutMs}ms — confirm ${wasmUrl} returns 200 (run npm run sync-stockfish).`,
    });
    markDead(`init timeout after ${initTimeoutMs}ms`);
    onBestMove()(null);
  }, initTimeoutMs);

  const runWhenReady = (fn: () => void) => {
    if (ready) fn();
    else deferred.push(fn);
  };

  const finishSearch = (uci: string | null) => {
    clearSearchTimer();
    activeSearch = null;
    onBestMove()(uci);
  };

  const startSearch = (fen: string, depth: number) => {
    emit(onDiag(), { tag: "fen_sent", detail: fen });
    emit(onDiag(), { tag: "search_start", detail: `go depth ${depth}` });

    worker.postMessage("stop");
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth}`);

    searchTimer = window.setTimeout(() => {
      if (activeSearch && activeSearch.retries < 1) {
        activeSearch.retries += 1;
        emit(onDiag(), { tag: "parse_note", detail: "search timeout, retrying once" });
        startSearch(activeSearch.fen, activeSearch.depth);
        return;
      }
      emit(onDiag(), {
        tag: "search_timeout",
        detail: `No bestmove after ${searchTimeoutMs}ms`,
      });
      markDead(`search timeout after ${searchTimeoutMs}ms (twice)`);
      finishSearch(null);
    }, searchTimeoutMs);
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;

    emit(onDiag(), { tag: "engine_line", detail: line });

    if (line.includes("uciok") && !sentIsready) {
      sentIsready = true;
      emit(onDiag(), { tag: "uciok" });
      worker.postMessage("isready");
    }

    if (line.toLowerCase() === "readyok") {
      window.clearTimeout(initTimer);
      if (!ready) {
        ready = true;
        emit(onDiag(), { tag: "readyok" });
        for (const fn of deferred.splice(0)) fn();
      }
    }

    if (line.startsWith("info ") && /\bdepth \d+/.test(line)) {
      const dm = line.match(/\bdepth (\d+)/);
      emit(onDiag(), {
        tag: "search_info",
        detail: dm ? `Considering… depth ${dm[1]}` : line.slice(0, 96),
      });
    }

    const best = line.match(/^bestmove\s*(.*)$/i);
    if (best) {
      emit(onDiag(), { tag: "bestmove_raw", detail: line });
      const rest = (best[1] ?? "").trim();
      const token = rest.split(/\s+/)[0]?.replace(/\r$/, "") ?? "";
      if (!token || token === "(none)") {
        emit(onDiag(), { tag: "bestmove_none" });
        finishSearch(null);
      } else {
        finishSearch(token);
      }
    }
  };

  worker.onmessage = (ev: MessageEvent<unknown>) => {
    const data = ev.data;

    if (rawMsgCount < 6) {
      rawMsgCount += 1;
      emit(onDiag(), { tag: "raw_message", detail: serializeWorkerData(data) });
    }

    if (typeof data === "string") {
      for (const part of data.split(/\r?\n/)) processLine(part);
      return;
    }

    if (data != null && typeof (data as { toString?: () => string }).toString === "function") {
      const s = String(data);
      if (s && s !== "[object Object]") {
        for (const part of s.split(/\r?\n/)) processLine(part);
        return;
      }
    }

    emit(onDiag(), {
      tag: "parse_note",
      detail: `Non-text worker message: ${serializeWorkerData(data, 200)}`,
    });
  };

  worker.onmessageerror = (ev) => {
    emit(onDiag(), { tag: "worker_error", detail: `messageerror: ${String(ev)}` });
    markDead("messageerror");
    finishSearch(null);
  };

  worker.onerror = (ev) => {
    const msg =
      "message" in ev && typeof ev.message === "string"
        ? ev.message
        : "filename" in ev && typeof ev.filename === "string"
          ? `Worker script error (${ev.filename}:${"lineno" in ev ? ev.lineno : "?"})`
          : "Worker failed to load or execute";
    emit(onDiag(), { tag: "worker_error", detail: msg });
    window.clearTimeout(initTimer);
    markDead(msg);
    finishSearch(null);
  };

  emit(onDiag(), { tag: "uci_sent" });
  worker.postMessage("uci");

  return {
    go(fen: string, depth = 12) {
      if (dead || disposed) {
        // signal caller so it can rebuild instead of waiting on a dead engine.
        onBestMove()(null);
        return;
      }
      clearSearchTimer();
      emit(onDiag(), { tag: "go_queued" });
      activeSearch = { fen, depth, retries: 0 };
      worker.postMessage("isready");
      runWhenReady(() => {
        if (!activeSearch) return;
        startSearch(activeSearch.fen, activeSearch.depth);
      });
    },

    stop() {
      clearSearchTimer();
      try {
        worker.postMessage("stop");
      } catch {
        // worker may already be terminated
      }
    },

    isDead: () => dead || disposed,

    dispose() {
      disposed = true;
      window.clearTimeout(initTimer);
      clearSearchTimer();
      try {
        worker.postMessage("quit");
      } catch {
        // ignore
      }
      worker.terminate();
    },
  };
}

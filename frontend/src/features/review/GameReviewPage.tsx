import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { initialGameState, parseUciMove, replayToMove, toFen, type Coord } from "../../chess/game";
import { ChessBoard } from "../../components/chess/ChessBoard";
import { Button } from "../../components/ui/Button";
import { useSettings } from "../../context/SettingsContext";
import {
  createAnalysisEngine,
  type AnalysisEngine,
  type AnalysisResult,
} from "../../chess/stockfishAnalyze";
import { gamesApi, type SavedGame } from "../../lib/api";
import {
  classifyMoveQuality,
  deltaForMove,
  formatEngineScore,
  GRADE_META,
  GRADE_ORDER,
  isMoveInBook,
  scoreSign,
  sideAccuracy,
  topScoreCp,
  winPercent,
  type MoveGrade,
} from "../../lib/reviewScoring";
import { formatPvLine } from "../../lib/sanFormat";
import styles from "./GameReviewPage.module.css";

const PANEL_DEPTH = 16;
const PANEL_MULTIPV = 3;
// grading depth was 10 which routinely missed real losses and inflated
// accuracy scores; 14 is a much better trade of speed vs signal.
const SCORE_DEPTH = 14;

// eval graph clamp: any cp beyond this is treated as +/- winning.
const EVAL_CLAMP_CP = 900;

interface EvalGraphProps {
  cpSeries: readonly number[]; // white-pov cp at each position
  currentIndex: number;
  onSeek: (index: number) => void;
}

// compact svg line chart of the eval; click/drag to seek. we draw a filled
// polygon above the zero-line (white advantage) and another below (black),
// then a smooth line on top plus a current-position marker.
function EvalGraph({ cpSeries, currentIndex, onSeek }: EvalGraphProps) {
  const width = 300;
  const height = 96;
  const padX = 4;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  if (cpSeries.length < 2) {
    return (
      <div className={styles.graphEmpty}>Analyzing to build the eval graph…</div>
    );
  }

  const clamp = (cp: number) =>
    Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));

  const points = cpSeries.map((cp, i) => {
    const x = padX + (i / (cpSeries.length - 1)) * innerW;
    // higher cp = better for white = higher on graph (smaller y).
    const yNorm = 0.5 - clamp(cp) / (EVAL_CLAMP_CP * 2);
    const y = padY + yNorm * innerH;
    return { x, y, i };
  });

  const zeroY = padY + innerH / 2;

  // white-advantage filled polygon (clipped above zero line).
  const whitePath = [
    `M ${points[0]!.x},${zeroY}`,
    ...points.map((p) => `L ${p.x},${Math.min(p.y, zeroY)}`),
    `L ${points[points.length - 1]!.x},${zeroY}`,
    "Z",
  ].join(" ");

  // black-advantage filled polygon (below the zero line).
  const blackPath = [
    `M ${points[0]!.x},${zeroY}`,
    ...points.map((p) => `L ${p.x},${Math.max(p.y, zeroY)}`),
    `L ${points[points.length - 1]!.x},${zeroY}`,
    "Z",
  ].join(" ");

  const linePath =
    "M " + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");

  const markerX = points[Math.max(0, Math.min(currentIndex, points.length - 1))]!.x;

  const seekFromClientX = (svg: SVGSVGElement, clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const rel = ((clientX - rect.left) / rect.width) * width;
    const inner = Math.max(0, Math.min(innerW, rel - padX));
    const idx = Math.round((inner / innerW) * (cpSeries.length - 1));
    onSeek(idx);
  };

  return (
    <svg
      className={styles.graphSvg}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation over time"
      onPointerDown={(e) => {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        seekFromClientX(e.currentTarget, e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        seekFromClientX(e.currentTarget, e.clientX);
      }}
    >
      {/* backdrop */}
      <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.35)" />

      {/* white / black advantage fills */}
      <path d={whitePath} fill="rgba(255, 255, 255, 0.85)" stroke="none" />
      <path d={blackPath} fill="rgba(35, 45, 78, 0.85)" stroke="none" />

      {/* zero line */}
      <line
        x1={padX}
        x2={width - padX}
        y1={zeroY}
        y2={zeroY}
        stroke="rgba(90, 105, 160, 0.6)"
        strokeDasharray="3 3"
        strokeWidth={0.75}
      />

      {/* eval line */}
      <path
        d={linePath}
        fill="none"
        stroke="rgba(45, 99, 226, 0.9)"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* current-position marker */}
      <line
        x1={markerX}
        x2={markerX}
        y1={padY}
        y2={height - padY}
        stroke="#2d63e2"
        strokeWidth={1.2}
      />
      <circle
        cx={markerX}
        cy={points[Math.max(0, Math.min(currentIndex, points.length - 1))]!.y}
        r={3}
        fill="#fff"
        stroke="#2d63e2"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function GameReviewPage() {
  const { id = "" } = useParams();
  const { settings } = useSettings();
  const [game, setGame] = useState<SavedGame | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  // loads selected game from backend.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const gameId = Number(id);
        if (!Number.isFinite(gameId)) throw new Error("Invalid game id");
        const { game } = await gamesApi.getGame(gameId);
        if (!cancelled) setGame(game);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load game");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const ucis = game?.ucis ?? [];
  const gameMoves = game?.prettyMoves ?? [];
  const [index, setIndex] = useState(ucis.length);

  const displayGame = useMemo(
    () => replayToMove(initialGameState(), ucis, index),
    [index, ucis],
  );

  const lastMove = useMemo(() => {
    if (index <= 0) return null;
    const parsed = parseUciMove(ucis[index - 1] ?? "");
    return parsed ? { from: parsed.from, to: parsed.to } : null;
  }, [index, ucis]);

  const [panel, setPanel] = useState<AnalysisResult | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // engine lifecycle is owned by one mount/unmount effect; strict mode cannot
  // strand a disposed worker behind a stale ref.
  const engineRef = useRef<AnalysisEngine | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const engine = createAnalysisEngine();
    engineRef.current = engine;
    queueRef.current = Promise.resolve();
    console.debug("[review] engine created");

    return () => {
      engineRef.current = null;
      engine.dispose();
      console.debug("[review] engine disposed");
    };
  }, []);

  // serializes worker tasks; each task captures the engine ref at submit time
  // and bails early if its engine has since been disposed.
  const runQueued = useCallback((task: () => Promise<void>) => {
    const next = queueRef.current.then(task, task);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  // analyses the current position and streams partial updates as depth grows.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    let cancelled = false;
    setPanelBusy(true);
    setPanelError(null);
    setPanel(null);

    const fen = toFen(displayGame);
    void runQueued(async () => {
      if (cancelled || engine.isDisposed()) return;
      try {
        const result = await engine.analyze(fen, PANEL_DEPTH, PANEL_MULTIPV, {
          onUpdate: (partial) => {
            if (cancelled || engine.isDisposed()) return;
            setPanel(partial);
          },
        });
        if (!cancelled) setPanel(result);
        console.debug("[review] panel ready", {
          lines: result.lines.length,
          depth: result.depth,
        });
      } catch (e) {
        if (cancelled || engine.isDisposed()) return;
        setPanelError(e instanceof Error ? e.message : "Panel analysis failed");
        console.error("[review] panel failed", e);
      } finally {
        if (!cancelled) setPanelBusy(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displayGame, runQueued]);

  useEffect(() => {
    if (!game) return;
    setIndex(ucis.length);
  }, [game, ucis.length]);

  interface PositionEval {
    cp: number;
    best: string | null;
  }

  const [evals, setEvals] = useState<PositionEval[]>([]);
  const [gradingBusy, setGradingBusy] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);

  // grades each move from eval delta + whether it matched the engine's bestmove.
  useEffect(() => {
    if (!game) return;
    const engine = engineRef.current;
    if (!engine) return;

    let cancelled = false;
    setGradingBusy(true);
    setGradingError(null);

    void runQueued(async () => {
      if (cancelled || engine.isDisposed()) return;
      const out: PositionEval[] = [];
      try {
        for (let i = 0; i <= ucis.length; i++) {
          if (cancelled || engine.isDisposed()) break;
          const g = replayToMove(initialGameState(), ucis, i);
          const analysis = await engine.analyze(toFen(g), SCORE_DEPTH, 1);
          out.push({ cp: topScoreCp(analysis), best: analysis.bestmove });
        }
        if (!cancelled) setEvals(out);
        console.debug("[review] grading ready", { entries: out.length });
      } catch (e) {
        if (cancelled || engine.isDisposed()) return;
        setGradingError(e instanceof Error ? e.message : "Grading analysis failed");
        console.error("[review] grading failed", e);
      } finally {
        if (!cancelled) setGradingBusy(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [game, ucis, runQueued]);

  // keyboard navigation between moves.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight" || ev.key === "d" || ev.key === "w") {
        setIndex((prev) => Math.min(ucis.length, prev + 1));
      }
      if (ev.key === "ArrowLeft" || ev.key === "a") {
        setIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ucis.length]);

  const pairedMoves = useMemo(() => {
    const rows: Array<{
      n: number;
      white: { text: string; grade: MoveGrade } | null;
      black: { text: string; grade: MoveGrade } | null;
    }> = [];

    const cpSeries = evals.map((e) => e.cp);

    const gradeAt = (i: number): MoveGrade => {
      const delta = deltaForMove(cpSeries, i);
      const matchedBest = !!evals[i]?.best && evals[i]!.best === ucis[i];
      const gameBefore = replayToMove(initialGameState(), ucis, i);
      const cpBefore = cpSeries[i] ?? 0;
      const cpAfter = cpSeries[i + 1] ?? 0;
      return classifyMoveQuality({
        delta,
        matchedBest,
        cpBefore,
        cpAfter,
        gameBefore,
        uci: ucis[i] ?? "",
        isBook: isMoveInBook(ucis, i),
      });
    };

    for (let i = 0; i < gameMoves.length; i += 2) {
      rows.push({
        n: i / 2 + 1,
        white: gameMoves[i]
          ? { text: gameMoves[i]!, grade: gradeAt(i) }
          : null,
        black: gameMoves[i + 1]
          ? { text: gameMoves[i + 1]!, grade: gradeAt(i + 1) }
          : null,
      });
    }
    return rows;
  }, [evals, gameMoves, ucis]);

  // legend: only show grades that actually appear in the game.
  const presentGrades = useMemo(() => {
    const set = new Set<MoveGrade>();
    for (const row of pairedMoves) {
      if (row.white) set.add(row.white.grade);
      if (row.black) set.add(row.black.grade);
    }
    return GRADE_ORDER.filter((g) => set.has(g));
  }, [pairedMoves]);

  // white-pov cp series (one entry per position, from start through end).
  const cpWhite = useMemo(
    () => evals.map((e, i) => (e.cp ?? 0) * (i % 2 === 0 ? 1 : -1)),
    [evals],
  );

  // per-side accuracy using the chess.com-style blend of a volatility-weighted
  // mean and a harmonic mean of per-move accuracies.
  const accuracies = useMemo(() => {
    if (cpWhite.length < 2) return { white: null, black: null } as const;
    const winPctSeries = cpWhite.map(winPercent);
    return {
      white: sideAccuracy(winPctSeries, "w"),
      black: sideAccuracy(winPctSeries, "b"),
    } as const;
  }, [cpWhite]);


  const emptyHighlights = useMemo(() => new Map<string, Coord>(), []);

  if (!game) {
    return (
      <div className={styles.empty}>
        <h1>{loadError ? "Could not load game" : "Loading game…"}</h1>
        {loadError ? <p>{loadError}</p> : null}
        <Link to="/games">Back to games</Link>
      </div>
    );
  }

  const sideToMove = displayGame.sideToMove;
  const panelDepth = panel?.depth ?? 0;

  // review always starts from white's perspective; user can flip on top.
  const perspective: "w" | "b" = flipped ? "b" : "w";

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1>Review</h1>
        <p>{game.whiteName} vs {game.blackName} · {game.result}</p>
      </header>

      <div className={styles.main}>
        <div className={styles.boardCol}>
          <ChessBoard
            game={displayGame}
            selected={null}
            lastMove={settings.highlightLastMove ? lastMove : null}
            highlights={emptyHighlights}
            onSquareClick={() => {}}
            promote={null}
            onPromote={() => {}}
            interactive={false}
            perspective={perspective}
          />
          <div className={styles.controls}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
              disabled={index === 0}
            >
              ← Prev
            </Button>

            <div className={styles.moveIndicator}>
              <span className={styles.moveLabel}>
                {index === 0
                  ? "Start position"
                  : `${Math.ceil(index / 2)}${index % 2 === 1 ? "." : "..."} ${gameMoves[index - 1] ?? ""}`}
              </span>
              <span className={styles.moveProgress}>
                {ucis.length === 0
                  ? "no moves"
                  : index === 0
                    ? `move 0 of ${Math.ceil(ucis.length / 2)}`
                    : `move ${Math.ceil(index / 2)} of ${Math.ceil(ucis.length / 2)}`}
              </span>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIndex((prev) => Math.min(ucis.length, prev + 1))}
              disabled={index >= ucis.length}
            >
              Next →
            </Button>
          </div>

          <div className={styles.controls}>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setFlipped((f) => !f)}
              aria-label="Flip the board"
            >
              ⇅ Flip board
            </Button>
          </div>
        </div>

        <aside className={styles.side}>
          <section className={styles.evalPanel}>
            <div className={styles.panelHead}>
              <h2>Evaluation</h2>
              <span className={styles.depthPill}>
                {cpWhite.length < 2
                  ? "waiting"
                  : `${Math.ceil((cpWhite.length - 1) / 2)} moves`}
              </span>
            </div>

            <EvalGraph
              cpSeries={cpWhite}
              currentIndex={index}
              onSeek={(i) => setIndex(i)}
            />

            <div className={styles.accuracyRow}>
              <span className={`${styles.accPill} ${styles.accWhite}`}>
                <span className={styles.accLabel}>White</span>
                <span className={styles.accVal}>
                  {accuracies.white == null
                    ? "—"
                    : `${accuracies.white.toFixed(1)}%`}
                </span>
              </span>
              <span className={`${styles.accPill} ${styles.accBlack}`}>
                <span className={styles.accLabel}>Black</span>
                <span className={styles.accVal}>
                  {accuracies.black == null
                    ? "—"
                    : `${accuracies.black.toFixed(1)}%`}
                </span>
              </span>
            </div>
          </section>

          <div className={styles.panelHead}>
            <h2>Engine lines</h2>
            <span className={styles.depthPill}>
              {panelBusy
                ? panelDepth > 0
                  ? `searching · d${panelDepth}`
                  : "starting…"
                : panelDepth > 0
                  ? `d${panelDepth}`
                  : "—"}
            </span>
          </div>

          {panelError ? <p className={styles.error}>panel error: {panelError}</p> : null}
          {!panel && !panelError ? <p className={styles.muted}>Warming engine…</p> : null}
          {panel && panel.lines.length === 0 && !panelBusy ? (
            <p className={styles.muted}>No legal moves to evaluate.</p>
          ) : null}

          <div className={styles.lines}>
            {panel?.lines.map((line) => {
              const sign = scoreSign(line, sideToMove);
              const scoreClass =
                sign > 0 ? styles.scorePos : sign < 0 ? styles.scoreNeg : styles.scoreEven;
              return (
                <div className={styles.line} key={line.multipv}>
                  <div className={styles.lineHead}>
                    <span className={styles.lineRank}>#{line.multipv}</span>
                    <span className={`${styles.lineScore} ${scoreClass}`}>
                      {formatEngineScore(line, sideToMove)}
                    </span>
                  </div>
                  <div className={styles.linePv}>
                    {formatPvLine(displayGame, line.pvUci.slice(0, 12)) || "—"}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className={styles.movesTitle}>Moves</h2>
          {gradingBusy ? <p className={styles.muted}>Grading…</p> : null}
          {gradingError ? <p className={styles.error}>grading error: {gradingError}</p> : null}

          <div className={styles.movesPairs}>
            {pairedMoves.map((row) => (
              <div key={row.n} className={styles.pairRow}>
                <span className={styles.moveNum}>{row.n}.</span>
                {(["white", "black"] as const).map((side) => {
                  const cell = row[side];
                  const targetIndex =
                    (row.n - 1) * 2 + (side === "white" ? 1 : 2);
                  return (
                    <button
                      key={side}
                      type="button"
                      className={`${styles.moveCell} ${cell ? styles[cell.grade] : ""}`}
                      onClick={() => setIndex(targetIndex)}
                      disabled={!cell}
                    >
                      {cell ? (
                        <>
                          <span
                            className={`${styles.moveBadge} ${styles[`badge_${cell.grade}`]}`}
                            aria-label={GRADE_META[cell.grade].label}
                            title={GRADE_META[cell.grade].label}
                          >
                            {GRADE_META[cell.grade].glyph}
                          </span>
                          <span className={styles.moveText}>{cell.text}</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {presentGrades.length > 0 ? (
            <div className={styles.legend} aria-label="Move grade legend">
              {presentGrades.map((g) => (
                <span key={g} className={styles.legendItem}>
                  <span className={`${styles.moveBadge} ${styles[`badge_${g}`]}`}>
                    {GRADE_META[g].glyph}
                  </span>
                  <span>{GRADE_META[g].label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

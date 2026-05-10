import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { initialGameState, parseUciMove, replayToPly, toFen, type Coord } from "../../chess/game";
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
  scoreSign,
  topScoreCp,
  type MoveGrade,
} from "../../lib/reviewScoring";
import { formatPvLine } from "../../lib/sanFormat";
import styles from "./GameReviewPage.module.css";

const PANEL_DEPTH = 16;
const PANEL_MULTIPV = 3;
const SCORE_DEPTH = 10;

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
    () => replayToPly(initialGameState(), ucis, index),
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

  interface PlyEval {
    cp: number;
    best: string | null;
  }

  const [evals, setEvals] = useState<PlyEval[]>([]);
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
      const out: PlyEval[] = [];
      try {
        for (let i = 0; i <= ucis.length; i++) {
          if (cancelled || engine.isDisposed()) break;
          const g = replayToPly(initialGameState(), ucis, i);
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

  // keyboard navigation between plies.
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
      return classifyMoveQuality(delta, matchedBest);
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
    const order: MoveGrade[] = [
      "brilliant",
      "best",
      "great",
      "good",
      "inaccuracy",
      "mistake",
      "blunder",
    ];
    return order.filter((g) => set.has(g));
  }, [pairedMoves]);

  const emptyHighlights = useMemo(() => new Map<string, Coord>(), []);

  if (!game) {
    return (
      <div className={styles.empty}>
        <h1>{loadError ? "Could not load game" : "Loading game..."}</h1>
        {loadError ? <p>{loadError}</p> : null}
        <Link to="/games">Back to games</Link>
      </div>
    );
  }

  const sideToMove = displayGame.sideToMove;
  const panelDepth = panel?.depth ?? 0;

  // base orientation honors user setting; flip toggles on top.
  const baseOrientation: "w" | "b" =
    settings.defaultOrientation === "black" ? "b" : "w";
  const perspective: "w" | "b" = flipped
    ? baseOrientation === "w" ? "b" : "w"
    : baseOrientation;

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
                ply {index} of {ucis.length}
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
                  const ply = (row.n - 1) * 2 + (side === "white" ? 1 : 2);
                  return (
                    <button
                      key={side}
                      type="button"
                      className={`${styles.moveCell} ${cell ? styles[cell.grade] : ""}`}
                      onClick={() => setIndex(ply)}
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

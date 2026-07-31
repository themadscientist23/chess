import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  applyUci,
  initialGameState,
  inCheck,
  legalTargets,
  makeMove,
  moveToUci,
  parseUciMove,
  playStatus,
  opposite,
  toFen,
  type Color,
  type Coord,
  type GameState,
  type PieceType,
} from "../../chess/game";
import {
  createStockfish,
  type StockfishDiag,
  type StockfishHandle,
} from "../../chess/stockfish";
import { ChessBoard } from "../../components/chess/ChessBoard";
import { Button } from "../../components/ui/Button";
import { useSettings } from "../../context/SettingsContext";
import { gamesApi } from "../../lib/api";
import { formatClock } from "../../lib/clock";
import { prettyFromUci } from "../../lib/sanFormat";
import { useOpening } from "./useOpening";
import styles from "./PlayPage.module.css";

const START_CLOCK_MS = 10 * 60 * 1000;

type PlayMode = "pvp" | "ai";
type ViewState = "setup" | "playing" | "finished";
type MoveRecord = { uci: string; pretty: string; mover: Color };

// short status banner shown above the board.
function statusMessage(
  game: GameState,
  mode: PlayMode,
  humanColor: Color,
  engineOn: boolean,
): string {
  const s = playStatus(game);

  if (s === "playing") {
    if (inCheck(game.board, game.sideToMove)) return "Check";
    if (mode === "ai" && engineOn && game.sideToMove !== humanColor) {
      return "Stockfish is thinking…";
    }
    return `${game.sideToMove === "w" ? "White" : "Black"} to move`;
  }

  if (s === "stalemate") return "Draw · Stalemate";

  const winner: Color = game.sideToMove === "w" ? "b" : "w";
  return `${winner === "w" ? "White" : "Black"} wins · Checkmate`;
}

export function PlayPage() {
  const { settings } = useSettings();
  const username = settings.playerName;

  const [view, setView] = useState<ViewState>("setup");
  const [playMode, setPlayMode] = useState<PlayMode>("ai");
  const [humanColor, setHumanColor] = useState<Color>("w");
  const [engineOn] = useState(true);
  // when playing Stockfish, users can decide whether to run clocks at all.
  // in local pvp this is ignored (clocks always tick for both sides).
  const [useClock, setUseClock] = useState(true);
  const [opponentName, setOpponentName] = useState("Opponent");
  const [whiteName, setWhiteName] = useState(username);
  const [blackName, setBlackName] = useState("Stockfish");
  const [editingWhite, setEditingWhite] = useState(false);
  const [editingBlack, setEditingBlack] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [platformFolderId, setPlatformFolderId] = useState<number>(1);
  const [savedGameId, setSavedGameId] = useState<number | null>(null);

  const [game, setGame] = useState<GameState>(() => initialGameState());
  const [selected, setSelected] = useState<Coord | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Coord; to: Coord } | null>(null);
  const [promote, setPromote] = useState<{ from: Coord; to: Coord } | null>(null);
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);

  // human-facing engine label. we intentionally hide the specific wasm build
  // (e.g. "Stockfish 18 lite") and instead advertise the play depth so it
  // reads as a difficulty knob, not a version.
  const engineName = useMemo(
    () => `Stockfish (Depth ${settings.engineDepth})`,
    [settings.engineDepth],
  );

  const [whiteMs, setWhiteMs] = useState(START_CLOCK_MS);
  const [blackMs, setBlackMs] = useState(START_CLOCK_MS);

  // engine handlers read from .current so updates from later renders apply
  // without rebuilding the worker.
  const onBestMoveRef = useRef<(uci: string | null) => void>(() => {});
  const sfRef = useRef<StockfishHandle | null>(null);
  const engineSearchRef = useRef(false);
  // holds the timeout that defers Stockfish's move so replies never feel
  // instantaneous. cleared on reset / disposal.
  const engineMoveTimerRef = useRef<number | null>(null);
  const [engineEpoch, setEngineEpoch] = useState(0);

  const gameRef = useRef(game);
  gameRef.current = game;

  const viewRef = useRef(view);
  viewRef.current = view;

  const savedRef = useRef(false);

  // resolve the platform folder id once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { folders } = await gamesApi.folders();
        const platform = folders.find((f) => f.name === "On Platform Games");
        if (!cancelled && platform) setPlatformFolderId(platform.id);
      } catch {
        // keep fallback id
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const status = playStatus(game);
  const turn = game.sideToMove;
  const opening = useOpening(moveHistory.map((m) => m.uci));

  const highlights = useMemo(() => {
    if (!selected) return new Map<string, Coord>();
    const [r, c] = selected;
    const map = new Map<string, Coord>();
    for (const t of legalTargets(game, r, c)) {
      map.set(`${t[0]},${t[1]}`, t);
    }
    return map;
  }, [game, selected]);

  const appendMove = useCallback((gameBefore: GameState, uci: string) => {
    const mover = gameBefore.sideToMove;
    const pretty = prettyFromUci(gameBefore, uci);
    setMoveHistory((prev) => [...prev, { uci, pretty, mover }]);
  }, []);

  const onEngineBestMove = useCallback(
    (uci: string | null) => {
      engineSearchRef.current = false;
      console.debug("[play] best", uci);

      if (!uci) return;
      if (viewRef.current !== "playing") return;

      // impose a small minimum "thinking" pause so Stockfish never snaps a
      // reply out instantly at shallow depths. any pending timer is replaced.
      if (engineMoveTimerRef.current != null) {
        window.clearTimeout(engineMoveTimerRef.current);
      }
      engineMoveTimerRef.current = window.setTimeout(() => {
        engineMoveTimerRef.current = null;
        if (viewRef.current !== "playing") return;

        const g = gameRef.current;
        const next = applyUci(g, uci);
        if (!next) return;

        setGame(next);
        appendMove(g, uci);

        const parsed = parseUciMove(uci);
        if (parsed) setLastMove({ from: parsed.from, to: parsed.to });
      }, 1000);
    },
    [appendMove],
  );

  // keep the ref handler current without rebuilding the worker.
  useEffect(() => {
    onBestMoveRef.current = onEngineBestMove;
  }, [onEngineBestMove]);

  // engine lifecycle owned by a single effect; bumping engineEpoch rebuilds
  // the worker after a fatal error. strict-mode safe.
  useEffect(() => {
    const handle = createStockfish({
      onBestMove: (uci) => onBestMoveRef.current(uci),
      onDiag: (d: StockfishDiag) => {
        const fatal =
          d.tag === "worker_error" ||
          d.tag === "init_timeout" ||
          d.tag === "search_timeout";

        if (fatal) {
          console.warn(`[play] ${d.tag}`, "detail" in d ? d.detail : "");
          window.setTimeout(() => setEngineEpoch((n) => n + 1), 0);
        } else {
          console.debug(`[play] ${d.tag}`, "detail" in d ? d.detail : "");
        }
      },
    });

    sfRef.current = handle;
    engineSearchRef.current = false;
    console.debug("[play] engine created", { epoch: engineEpoch });

    return () => {
      sfRef.current = null;
      engineSearchRef.current = false;
      if (engineMoveTimerRef.current != null) {
        window.clearTimeout(engineMoveTimerRef.current);
        engineMoveTimerRef.current = null;
      }
      handle.dispose();
      console.debug("[play] engine disposed", { epoch: engineEpoch });
    };
  }, [engineEpoch]);

  const engineShouldMove =
    view === "playing" &&
    playMode === "ai" &&
    engineOn &&
    turn !== humanColor &&
    status === "playing" &&
    !promote;

  // kick off engine search when it becomes the engine's turn.
  useEffect(() => {
    if (!engineShouldMove) return;
    if (engineSearchRef.current) return;

    const sf = sfRef.current;
    if (!sf || sf.isDead()) {
      console.warn("[play] engine unavailable for go(); awaiting recreation");
      return;
    }

    engineSearchRef.current = true;
    const fen = toFen(game);
    const depth = settings.engineDepth;
    console.debug("[play] go", { fen, depth });
    sf.go(fen, depth);
  }, [engineShouldMove, game, settings.engineDepth]);

  const resetToSetup = useCallback(() => {
    sfRef.current?.stop();
    engineSearchRef.current = false;
    if (engineMoveTimerRef.current != null) {
      window.clearTimeout(engineMoveTimerRef.current);
      engineMoveTimerRef.current = null;
    }
    setGame(initialGameState());
    setSelected(null);
    setLastMove(null);
    setPromote(null);
    setMoveHistory([]);
    setWhiteMs(START_CLOCK_MS);
    setBlackMs(START_CLOCK_MS);
    setResultText(null);
    savedRef.current = false;
    setSavedGameId(null);
    setView("setup");
  }, []);

  const startGame = useCallback(() => {
    resetToSetup();
    const player = username || "Player";
    if (playMode === "ai") {
      // in AI mode, whichever colour the human picked wears the player's
      // name; the opposite colour is Stockfish (with its detected version,
      // when the engine has already reported it).
      if (humanColor === "w") {
        setWhiteName(player);
        setBlackName(engineName);
      } else {
        setWhiteName(engineName);
        setBlackName(player);
      }
    } else {
      setWhiteName(player);
      setBlackName(opponentName.trim() || "Opponent");
    }
    setView("playing");
  }, [engineName, humanColor, opponentName, playMode, resetToSetup, username]);

  // keep the AI-side label in sync with engineName (which tracks the depth
  // setting). we only overwrite when the current label still looks like an
  // engine name, so a user rename ("Terminator") is preserved.
  useEffect(() => {
    if (view !== "playing" || playMode !== "ai") return;
    const looksLikeEngine = (cur: string) => /^stockfish\b/i.test(cur);
    if (humanColor === "w") {
      setBlackName((cur) => (looksLikeEngine(cur) ? engineName : cur));
    } else {
      setWhiteName((cur) => (looksLikeEngine(cur) ? engineName : cur));
    }
  }, [engineName, humanColor, playMode, view]);

  const finishPromotion = useCallback(
    (p: PieceType) => {
      if (!promote) return;

      const uci = moveToUci(promote.from, promote.to, p);
      const next = makeMove(game, promote.from, promote.to, p);
      if (next) {
        setGame(next);
        setLastMove({ from: promote.from, to: promote.to });
        appendMove(game, uci);
      }

      setPromote(null);
      setSelected(null);
    },
    [appendMove, game, promote],
  );

  const onSquareClick = useCallback(
    (r: number, c: number) => {
      if (promote) return;
      if (view !== "playing") return;
      if (playMode === "ai" && engineOn && turn !== humanColor) return;
      if (status !== "playing") return;

      const cell = game.board[r][c];
      const key = `${r},${c}`;

      if (selected) {
        const target = highlights.get(key);
        if (target) {
          const piece = game.board[selected[0]]![selected[1]]!;
          if (piece.type === "P" && (target[0] === 0 || target[0] === 7)) {
            setPromote({ from: selected, to: target });
            return;
          }

          const uci = moveToUci(selected, target);
          const next = makeMove(game, selected, target, "Q");
          if (next) {
            setGame(next);
            setLastMove({ from: selected, to: target });
            appendMove(game, uci);
            setSelected(null);
          }
          return;
        }
      }

      if (cell && cell.color === turn) {
        setSelected([r, c]);
        return;
      }

      setSelected(null);
    },
    [
      appendMove,
      game,
      highlights,
      playMode,
      engineOn,
      humanColor,
      promote,
      selected,
      status,
      turn,
      view,
    ],
  );

  const onResign = useCallback(() => {
    if (view !== "playing") return;
    const winner = opposite(game.sideToMove);
    setResultText(`${winner === "w" ? "White" : "Black"} wins · Resignation`);
    setView("finished");
  }, [game.sideToMove, view]);

  // detect natural game end (mate/stalemate) and flip into finished state.
  useEffect(() => {
    if (view !== "playing") return;
    if (status === "playing") return;

    if (status === "stalemate") {
      setResultText("Draw · Stalemate");
    } else {
      const winner: Color = game.sideToMove === "w" ? "b" : "w";
      setResultText(`${winner === "w" ? "White" : "Black"} wins · Checkmate`);
    }
    setView("finished");
  }, [game.sideToMove, status, view]);

  // persist the game once when it finishes, then remember the id for the
  // "review this game" link.
  useEffect(() => {
    if (view !== "finished") return;
    if (savedRef.current) return;
    if (moveHistory.length === 0) return;

    savedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { gameId } = await gamesApi.createGame({
          folderId: platformFolderId,
          mode: playMode,
          whiteName,
          blackName,
          result: resultText ?? "finished",
          source: "platform",
          ucis: moveHistory.map((m) => m.uci),
          prettyMoves: moveHistory.map((m) => m.pretty),
        });
        if (!cancelled) setSavedGameId(gameId);
      } catch (err) {
        console.warn("[play] could not save game", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blackName, moveHistory, platformFolderId, playMode, resultText, view, whiteName]);

  // tick clocks for the side to move while play is in progress. in AI mode
  // clocks only ever run when the toggle is on AND it's the human's turn —
  // Stockfish never runs down a clock.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (view !== "playing" || status !== "playing") {
      lastTickRef.current = null;
      return;
    }

    // no clocks at all when playing Stockfish with the toggle off.
    if (playMode === "ai" && !useClock) {
      lastTickRef.current = null;
      return;
    }

    lastTickRef.current = performance.now();
    const id = window.setInterval(() => {
      const last = lastTickRef.current;
      const now = performance.now();
      if (last == null) {
        lastTickRef.current = now;
        return;
      }
      const dt = now - last;
      lastTickRef.current = now;

      const sideOnMove = gameRef.current.sideToMove;
      // don't burn Stockfish's clock even if the toggle is on.
      if (playMode === "ai" && sideOnMove !== humanColor) return;

      if (sideOnMove === "w") {
        setWhiteMs((v) => v - dt);
      } else {
        setBlackMs((v) => v - dt);
      }
    }, 200);

    return () => window.clearInterval(id);
  }, [turn, status, view, playMode, useClock, humanColor]);

  const moveRows = useMemo(() => {
    const rows: Array<{ n: number; w: string; b: string }> = [];
    for (let i = 0; i < moveHistory.length; i += 2) {
      rows.push({
        n: i / 2 + 1,
        w: moveHistory[i]?.pretty ?? "",
        b: moveHistory[i + 1]?.pretty ?? "",
      });
    }
    return rows;
  }, [moveHistory]);

  const [flipped, setFlipped] = useState(false);

  // base perspective follows the human side in AI games; in local pvp we
  // start from white and let the user flip manually.
  const basePerspective: Color = useMemo(
    () => (playMode === "ai" ? humanColor : "w"),
    [playMode, humanColor],
  );

  // final perspective applies the user's manual flip on top.
  const perspective: Color = flipped
    ? basePerspective === "w" ? "b" : "w"
    : basePerspective;

  // reset the flip whenever a new game starts so the base orientation wins.
  useEffect(() => {
    if (view === "setup") setFlipped(false);
  }, [view]);

  const topLabel = useMemo(
    () => (perspective === "w" ? blackName : whiteName),
    [blackName, perspective, whiteName],
  );
  const bottomLabel = useMemo(
    () => (perspective === "w" ? whiteName : blackName),
    [blackName, perspective, whiteName],
  );

  if (view === "setup") {
    return (
      <div className={styles.setupWrap}>
        <div className={styles.setupCard}>
          <h1 className={styles.h1}>Play</h1>
          <p className={styles.p}>
            Pick a mode and start.{" "}
            {playMode === "pvp"
              ? "Both sides get 10 minutes on the clock."
              : useClock
                ? "You get 10 minutes on the clock — Stockfish plays untimed."
                : "No clock — take as long as you want."}
          </p>

          <div className={styles.setupRow}>
            <label className={styles.radio}>
              <input
                type="radio"
                name="mode"
                checked={playMode === "pvp"}
                onChange={() => setPlayMode("pvp")}
              />
              <span>Local (both sides)</span>
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="mode"
                checked={playMode === "ai"}
                onChange={() => setPlayMode("ai")}
              />
              <span>vs. Stockfish</span>
            </label>
          </div>

          {playMode === "ai" ? (
            <>
              <div className={styles.setupRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="hum"
                    checked={humanColor === "w"}
                    onChange={() => setHumanColor("w")}
                  />
                  <span>You play White</span>
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="hum"
                    checked={humanColor === "b"}
                    onChange={() => setHumanColor("b")}
                  />
                  <span>You play Black</span>
                </label>
              </div>
              <div className={styles.setupRow}>
                <label className={styles.radio}>
                  <input
                    type="checkbox"
                    checked={useClock}
                    onChange={(e) => setUseClock(e.target.checked)}
                  />
                  <span>Use clock (10 min)</span>
                </label>
              </div>
            </>
          ) : (
            <div className={styles.setupRow}>
              <label className={styles.label}>
                Opponent name
                <input
                  className={styles.input}
                  value={opponentName}
                  onChange={(e) => setOpponentName(e.target.value)}
                />
              </label>
            </div>
          )}

          <Button variant="primary" size="lg" onClick={startGame}>
            Start game
          </Button>
        </div>
      </div>
    );
  }

  const topClockMs = perspective === "w" ? blackMs : whiteMs;
  const bottomClockMs = perspective === "w" ? whiteMs : blackMs;

  // active player highlight only lights up while the game is actually in play.
  const isLive = view === "playing" && status === "playing";
  const topColor: Color = perspective === "w" ? "b" : "w";
  const bottomColor: Color = perspective === "w" ? "w" : "b";
  const topActive = isLive && turn === topColor;
  const bottomActive = isLive && turn === bottomColor;

  // clocks: always on in local pvp; in AI mode they only appear on the
  // human's side and only when the clock toggle was enabled at setup.
  const showTopClock =
    playMode === "pvp" || (useClock && topColor === humanColor);
  const showBottomClock =
    playMode === "pvp" || (useClock && bottomColor === humanColor);

  return (
    <div className={styles.playWrap}>
      <header className={styles.playHeader}>
        <div className={styles.statusRow}>
          <h1 className={styles.h1}>Play</h1>
          <p className={styles.status}>
            {statusMessage(game, playMode, humanColor, engineOn)}
          </p>
        </div>
        <p className={styles.opening}>
          <span className={styles.openingEco}>{opening.eco}</span> {opening.name}
        </p>
        {resultText ? <p className={styles.result}>{resultText}</p> : null}
      </header>

      <div className={styles.centerRow}>
        <div className={styles.boardCol}>
          <div
            className={`${styles.nameBarTop} ${topActive ? styles.nameBarActive : ""}`}
            aria-current={topActive ? "true" : undefined}
          >
            <span className={styles.nameSide}>
              <span
                className={`${styles.turnDot} ${topActive ? styles.turnDotActive : ""}`}
                aria-hidden
              />
              {editingBlack || editingWhite ? (
                <input
                  className={styles.nameEdit}
                  value={perspective === "w" ? blackName : whiteName}
                  onChange={(e) => {
                    if (perspective === "w") setBlackName(e.target.value);
                    else setWhiteName(e.target.value);
                  }}
                  onBlur={() => {
                    setEditingWhite(false);
                    setEditingBlack(false);
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className={styles.name}
                  onDoubleClick={() => {
                    if (perspective === "w") setEditingBlack(true);
                    else setEditingWhite(true);
                  }}
                >
                  {topLabel}
                </span>
              )}
            </span>
            {showTopClock ? (
              <span className={styles.clock}>{formatClock(topClockMs)}</span>
            ) : null}
          </div>

          <ChessBoard
            game={game}
            selected={selected}
            lastMove={settings.highlightLastMove ? lastMove : null}
            highlights={settings.showMoveHints ? highlights : new Map()}
            onSquareClick={onSquareClick}
            promote={promote}
            onPromote={finishPromotion}
            interactive={view === "playing"}
            perspective={perspective}
          />

          <div
            className={`${styles.nameBarBottom} ${bottomActive ? styles.nameBarActive : ""}`}
            aria-current={bottomActive ? "true" : undefined}
          >
            <span className={styles.nameSide}>
              <span
                className={`${styles.turnDot} ${bottomActive ? styles.turnDotActive : ""}`}
                aria-hidden
              />
              {editingWhite || editingBlack ? (
                <input
                  className={styles.nameEdit}
                  value={perspective === "w" ? whiteName : blackName}
                  onChange={(e) => {
                    if (perspective === "w") setWhiteName(e.target.value);
                    else setBlackName(e.target.value);
                  }}
                  onBlur={() => {
                    setEditingWhite(false);
                    setEditingBlack(false);
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className={styles.name}
                  onDoubleClick={() => {
                    if (perspective === "w") setEditingWhite(true);
                    else setEditingBlack(true);
                  }}
                >
                  {bottomLabel}
                </span>
              )}
            </span>
            {showBottomClock ? (
              <span className={styles.clock}>{formatClock(bottomClockMs)}</span>
            ) : null}
          </div>
        </div>

        <aside className={styles.side}>
          <h2 className={styles.sideTitle}>Moves</h2>
          <div className={styles.movesGrid} aria-label="Move list">
            {moveRows.map((row) => (
              <div key={row.n} className={styles.moveRow}>
                <span className={styles.moveNum}>{row.n}.</span>
                <span className={styles.moveW}>{row.w}</span>
                <span className={styles.moveB}>{row.b}</span>
              </div>
            ))}
          </div>

          <div className={styles.sideActions}>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setFlipped((f) => !f)}
              aria-label="Flip the board"
            >
              ⇅ Flip board
            </Button>
            {view === "playing" ? (
              <Button variant="danger" onClick={onResign}>
                Resign
              </Button>
            ) : null}
            {view === "finished" && savedGameId != null ? (
              <Link to={`/games/${savedGameId}`} className={styles.reviewLink}>
                <Button variant="primary" size="md" aria-label="Review this game">
                  Review this game →
                </Button>
              </Link>
            ) : (
              <Button
                variant="ghost"
                disabled
                title={
                  view === "finished"
                    ? "Saving game…"
                    : "Available after the game ends"
                }
              >
                {view === "finished" ? "Saving…" : "Review after finish"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={resetToSetup}
              disabled={view !== "finished"}
            >
              New game
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

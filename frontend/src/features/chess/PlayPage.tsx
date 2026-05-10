import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
type PlyRecord = { uci: string; pretty: string; mover: Color };

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
    if (mode === "pvp") {
      return `${game.sideToMove === "w" ? "White" : "Black"} to move (local)`;
    }
    return "Your move";
  }

  if (s === "stalemate") return "Stalemate — draw";

  const winner: Color = game.sideToMove === "w" ? "b" : "w";
  return `Checkmate — ${winner === "w" ? "White" : "Black"} wins`;
}

export function PlayPage() {
  const { settings } = useSettings();
  const username = settings.playerName;

  const [view, setView] = useState<ViewState>("setup");
  const [playMode, setPlayMode] = useState<PlayMode>("ai");
  const [humanColor, setHumanColor] = useState<Color>("w");
  const [engineOn] = useState(true);
  const [opponentName, setOpponentName] = useState("Opponent");
  const [whiteName, setWhiteName] = useState(username);
  const [blackName, setBlackName] = useState("Stockfish");
  const [editingWhite, setEditingWhite] = useState(false);
  const [editingBlack, setEditingBlack] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [platformFolderId, setPlatformFolderId] = useState<number>(1);

  const [game, setGame] = useState<GameState>(() => initialGameState());
  const [selected, setSelected] = useState<Coord | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Coord; to: Coord } | null>(null);
  const [promote, setPromote] = useState<{ from: Coord; to: Coord } | null>(null);
  const [plies, setPlies] = useState<PlyRecord[]>([]);

  const [whiteMs, setWhiteMs] = useState(START_CLOCK_MS);
  const [blackMs, setBlackMs] = useState(START_CLOCK_MS);

  // engine handlers read from .current so updates from later renders apply
  // without rebuilding the worker.
  const onBestMoveRef = useRef<(uci: string | null) => void>(() => {});
  const sfRef = useRef<StockfishHandle | null>(null);
  const engineSearchRef = useRef(false);
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
  const opening = useOpening(plies.map((p) => p.uci));

  const highlights = useMemo(() => {
    if (!selected) return new Map<string, Coord>();
    const [r, c] = selected;
    const map = new Map<string, Coord>();
    for (const t of legalTargets(game, r, c)) {
      map.set(`${t[0]},${t[1]}`, t);
    }
    return map;
  }, [game, selected]);

  const appendPly = useCallback((gameBefore: GameState, uci: string) => {
    const mover = gameBefore.sideToMove;
    const pretty = prettyFromUci(gameBefore, uci);
    setPlies((prev) => [...prev, { uci, pretty, mover }]);
  }, []);

  const onEngineBestMove = useCallback(
    (uci: string | null) => {
      engineSearchRef.current = false;
      console.debug("[play] best", uci);

      if (!uci) return;
      if (viewRef.current !== "playing") return;

      const g = gameRef.current;
      const next = applyUci(g, uci);
      if (!next) return;

      setGame(next);
      appendPly(g, uci);

      const parsed = parseUciMove(uci);
      if (parsed) setLastMove({ from: parsed.from, to: parsed.to });
    },
    [appendPly],
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
    setGame(initialGameState());
    setSelected(null);
    setLastMove(null);
    setPromote(null);
    setPlies([]);
    setWhiteMs(START_CLOCK_MS);
    setBlackMs(START_CLOCK_MS);
    setResultText(null);
    savedRef.current = false;
    setView("setup");
  }, []);

  const startGame = useCallback(() => {
    resetToSetup();
    setWhiteName(username || "Player");
    setBlackName(playMode === "ai" ? "Stockfish" : opponentName.trim() || "Opponent");
    setView("playing");
  }, [opponentName, playMode, resetToSetup, username]);

  const finishPromotion = useCallback(
    (p: PieceType) => {
      if (!promote) return;

      const uci = moveToUci(promote.from, promote.to, p);
      const next = makeMove(game, promote.from, promote.to, p);
      if (next) {
        setGame(next);
        setLastMove({ from: promote.from, to: promote.to });
        appendPly(game, uci);
      }

      setPromote(null);
      setSelected(null);
    },
    [appendPly, game, promote],
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
            appendPly(game, uci);
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
      appendPly,
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
    setResultText(`${winner === "w" ? "White" : "Black"} wins by resignation`);
    setView("finished");
  }, [game.sideToMove, view]);

  // detect natural game end (mate/stalemate) and flip into finished state.
  useEffect(() => {
    if (view !== "playing") return;
    if (status === "playing") return;

    if (status === "stalemate") {
      setResultText("Draw by stalemate");
    } else {
      const winner: Color = game.sideToMove === "w" ? "b" : "w";
      setResultText(`${winner === "w" ? "White" : "Black"} wins by checkmate`);
    }
    setView("finished");
  }, [game.sideToMove, status, view]);

  // persist the game once when it finishes.
  useEffect(() => {
    if (view !== "finished") return;
    if (savedRef.current) return;
    if (plies.length === 0) return;

    savedRef.current = true;
    void gamesApi.createGame({
      folderId: platformFolderId,
      mode: playMode,
      whiteName,
      blackName,
      result: resultText ?? "finished",
      source: "platform",
      ucis: plies.map((p) => p.uci),
      prettyMoves: plies.map((p) => p.pretty),
    });
  }, [blackName, platformFolderId, playMode, plies, resultText, view, whiteName]);

  // tick clocks for the side to move while play is in progress.
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (view !== "playing" || status !== "playing") {
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
      if (gameRef.current.sideToMove === "w") {
        setWhiteMs((v) => v - dt);
      } else {
        setBlackMs((v) => v - dt);
      }
    }, 200);

    return () => window.clearInterval(id);
  }, [turn, status, view]);

  const moveRows = useMemo(() => {
    const rows: Array<{ n: number; w: string; b: string }> = [];
    for (let i = 0; i < plies.length; i += 2) {
      rows.push({
        n: i / 2 + 1,
        w: plies[i]?.pretty ?? "",
        b: plies[i + 1]?.pretty ?? "",
      });
    }
    return rows;
  }, [plies]);

  const [flipped, setFlipped] = useState(false);

  // base perspective: explicit override from settings, else follow human side.
  const basePerspective: Color = useMemo(() => {
    if (settings.defaultOrientation === "white") return "w";
    if (settings.defaultOrientation === "black") return "b";
    return playMode === "ai" ? humanColor : "w";
  }, [settings.defaultOrientation, playMode, humanColor]);

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
            Choose a mode, then start the game. Clocks start at 10:00.
          </p>

          <div className={styles.setupRow}>
            <label className={styles.radio}>
              <input
                type="radio"
                name="mode"
                checked={playMode === "pvp"}
                onChange={() => setPlayMode("pvp")}
              />
              <span>Local both sides</span>
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="mode"
                checked={playMode === "ai"}
                onChange={() => setPlayMode("ai")}
              />
              <span>vs Stockfish</span>
            </label>
          </div>

          {playMode === "ai" ? (
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
          <div className={styles.nameBarTop}>
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
            <span className={styles.clock}>{formatClock(topClockMs)}</span>
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

          <div className={styles.nameBarBottom}>
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
            <span className={styles.clock}>{formatClock(bottomClockMs)}</span>
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
            <Button variant="ghost" disabled>
              Post-game review (from Games)
            </Button>
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

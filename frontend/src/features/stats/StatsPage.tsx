import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  applyUciSequence,
  initialGameState,
  playStatus,
} from "../../chess/game";
import { useSettings } from "../../context/SettingsContext";
import { gamesApi, type SavedGame } from "../../lib/api";
import { lookupOpening } from "../../lib/openingsData";
import styles from "./StatsPage.module.css";

type Outcome = "win" | "loss" | "draw";
type Scope = "all" | "w" | "b";
// games the player appeared in, including imports with no usable result yet.
type PlayerGame = {
  game: SavedGame;
  side: "w" | "b";
  outcome: Outcome | null;
};

// canonicalizes assorted result strings into a winner tag. covers platform
// copy ("White wins · …"), PGN results ("1-0"), and common prose variants.
function resultWinnerFromText(result: string): "w" | "b" | "draw" | null {
  const r = result.trim().toLowerCase();
  if (!r || r === "*" || r === "imported pgn" || r === "unfinished") return null;
  if (r === "1-0" || r.startsWith("1-0")) return "w";
  if (r === "0-1" || r.startsWith("0-1")) return "b";
  if (
    r === "1/2-1/2" ||
    r.startsWith("1/2") ||
    r.includes("drawn") ||
    r.startsWith("draw")
  ) {
    return "draw";
  }
  if (r.startsWith("white wins") || r.includes("white won")) return "w";
  if (r.startsWith("black wins") || r.includes("black won")) return "b";
  return null;
}

// when the stored result string is useless (common for older imports), replay
// the moves and read the terminal position.
function resultWinnerFromMoves(ucis: readonly string[]): "w" | "b" | "draw" | null {
  if (ucis.length === 0) return null;
  const end = applyUciSequence(initialGameState(), ucis);
  if (!end) return null;
  const status = playStatus(end);
  if (status === "stalemate") return "draw";
  if (status === "checkmate") {
    // sideToMove is the mated side, so the other colour won.
    return end.sideToMove === "w" ? "b" : "w";
  }
  return null;
}

function resultWinner(game: SavedGame): "w" | "b" | "draw" | null {
  return resultWinnerFromText(game.result) ?? resultWinnerFromMoves(game.ucis);
}

// which side (if any) did the player play in this game?
function playerSide(game: SavedGame, player: string): "w" | "b" | null {
  const norm = player.trim().toLowerCase();
  if (!norm) return null;
  if (game.whiteName.trim().toLowerCase() === norm) return "w";
  if (game.blackName.trim().toLowerCase() === norm) return "b";
  return null;
}

// interprets a saved game from the player's point of view. returns null only
// when the player didn't sit that board — missing results still count (outcome
// null) so import-only players show up in the picker and length stats.
function playerGame(
  game: SavedGame,
  player: string,
): PlayerGame | null {
  const side = playerSide(game, player);
  if (!side) return null;
  const w = resultWinner(game);
  if (w == null) return { game, side, outcome: null };
  if (w === "draw") return { game, side, outcome: "draw" };
  return { game, side, outcome: w === side ? "win" : "loss" };
}

// human summary of how a game ended.
function endingKind(result: string): "checkmate" | "resignation" | "stalemate" | null {
  const r = result.toLowerCase();
  if (r.includes("checkmate")) return "checkmate";
  if (r.includes("resignation")) return "resignation";
  if (r.includes("stalemate")) return "stalemate";
  return null;
}

interface Row {
  label: string;
  value: string;
  hint?: string;
}

function StatCard({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <dl className={styles.rows}>
        {rows.map((r) => (
          <div key={r.label} className={styles.row}>
            <dt className={styles.rowKey}>{r.label}</dt>
            <dd className={styles.rowVal}>
              <span>{r.value}</span>
              {r.hint ? <span className={styles.rowHint}>{r.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PlayerPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (name: string) => void;
}) {
  return (
    <label className={styles.playerPicker}>
      <span className={styles.playerPickerLabel}>Player</span>
      <select
        className={styles.playerPickerSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordBar({ w, d, l }: { w: number; d: number; l: number }) {
  const total = w + d + l;
  if (total === 0) {
    return <div className={styles.recordBar} aria-hidden />;
  }
  const wp = (w / total) * 100;
  const dp = (d / total) * 100;
  const lp = (l / total) * 100;
  return (
    <div
      className={styles.recordBar}
      role="img"
      aria-label={`${w} wins, ${d} draws, ${l} losses`}
    >
      <span className={styles.barWin} style={{ width: `${wp}%` }} />
      <span className={styles.barDraw} style={{ width: `${dp}%` }} />
      <span className={styles.barLoss} style={{ width: `${lp}%` }} />
    </div>
  );
}

// segmented control that scopes the whole stats page — record, game length,
// endings, and openings all recompute against the selected slice.
function ScopeToggle({
  value,
  onChange,
  disabledScopes,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
  disabledScopes?: Set<Scope>;
}) {
  const options: Array<{ id: Scope; label: string }> = [
    { id: "all", label: "All games" },
    { id: "w", label: "As White" },
    { id: "b", label: "As Black" },
  ];
  return (
    <div className={styles.scopeToggle} role="tablist" aria-label="Filter by color">
      {options.map((opt) => {
        const isDisabled = disabledScopes?.has(opt.id) ?? false;
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isDisabled}
            className={`${styles.scopeOpt} ${isActive ? styles.scopeOptActive : ""}`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function isEnginePlayer(name: string): boolean {
  return /^\s*stockfish\b/i.test(name);
}

export function StatsPage() {
  const { settings } = useSettings();

  const [games, setGames] = useState<SavedGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>(settings.playerName);
  const [scope, setScope] = useState<Scope>("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { games } = await gamesApi.listGames();
        if (!cancelled) setGames(games);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load games");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // every non-engine name that appears on any game — including imports with
  // no Result tag / unfinished PGNs — so import-only players are selectable.
  const playerOptions = useMemo(() => {
    if (!games) return [] as string[];
    const seen = new Map<string, string>();
    for (const g of games) {
      for (const raw of [g.whiteName, g.blackName]) {
        const trimmed = raw.trim();
        if (!trimmed || isEnginePlayer(trimmed)) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) seen.set(key, trimmed);
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [games]);

  useEffect(() => {
    if (playerOptions.length === 0) return;
    const match = (needle: string) =>
      playerOptions.find(
        (n) => n.toLowerCase() === needle.trim().toLowerCase(),
      );
    const current = match(selectedPlayer);
    if (current) {
      if (current !== selectedPlayer) setSelectedPlayer(current);
      return;
    }
    const preferred = match(settings.playerName);
    setSelectedPlayer(preferred ?? playerOptions[0]!);
  }, [playerOptions, selectedPlayer, settings.playerName]);

  const player = selectedPlayer;

  // every game this player sat, regardless of whether a result is known.
  const playerGames = useMemo<PlayerGame[]>(() => {
    if (!games) return [];
    return games
      .map((g) => playerGame(g, player))
      .filter((v): v is PlayerGame => v !== null);
  }, [games, player]);

  const totals = useMemo(() => {
    let w = 0;
    let b = 0;
    for (const a of playerGames) {
      if (a.side === "w") w++;
      else b++;
    }
    return { total: playerGames.length, w, b };
  }, [playerGames]);

  // whenever the underlying player changes, keep the scope selection valid.
  useEffect(() => {
    if (scope === "w" && totals.w === 0) setScope("all");
    else if (scope === "b" && totals.b === 0) setScope("all");
  }, [totals, scope]);

  const summary = useMemo(() => {
    if (!games) return null;

    const scoped =
      scope === "all"
        ? playerGames
        : playerGames.filter((a) => a.side === scope);

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let totalHalfMoves = 0;
    let longestHalfMoves = 0;
    let shortestDecisiveHalfMoves = Number.POSITIVE_INFINITY;
    const endings = { checkmate: 0, resignation: 0, stalemate: 0 };
    const openingCounts = new Map<string, { eco: string; wins: number; total: number }>();

    for (const { game: g, outcome } of scoped) {
      if (outcome === "win") wins++;
      else if (outcome === "loss") losses++;
      else if (outcome === "draw") draws++;

      totalHalfMoves += g.ucis.length;
      longestHalfMoves = Math.max(longestHalfMoves, g.ucis.length);

      const dec = resultWinner(g);
      if (dec === "w" || dec === "b") {
        shortestDecisiveHalfMoves = Math.min(
          shortestDecisiveHalfMoves,
          g.ucis.length,
        );
      }

      const kind = endingKind(g.result);
      if (kind) endings[kind]++;

      const op = lookupOpening(g.ucis);
      if (op.eco !== "—") {
        const cur = openingCounts.get(op.name) ?? { eco: op.eco, wins: 0, total: 0 };
        cur.total++;
        if (outcome === "win") cur.wins++;
        openingCounts.set(op.name, cur);
      }
    }

    const openingList = [...openingCounts.entries()]
      .map(([name, v]) => ({ name, eco: v.eco, wins: v.wins, total: v.total }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, 5);

    const rated = wins + losses + draws;
    const scored = wins + 0.5 * draws;
    const scorePct = rated === 0 ? 0 : (scored / rated) * 100;

    return {
      total: scoped.length,
      wins,
      losses,
      draws,
      totalHalfMoves,
      longestHalfMoves,
      shortestDecisiveHalfMoves:
        shortestDecisiveHalfMoves === Number.POSITIVE_INFINITY
          ? 0
          : shortestDecisiveHalfMoves,
      endings,
      openingList,
      scorePct,
    };
  }, [playerGames, games, scope]);

  if (error) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Stats</h1>
        </header>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (!games || !summary) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Stats</h1>
        </header>
        <p className={styles.muted}>Crunching your numbers…</p>
      </div>
    );
  }

  const disabledScopes = new Set<Scope>();
  if (totals.w === 0) disabledScopes.add("w");
  if (totals.b === 0) disabledScopes.add("b");

  if (totals.total === 0) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Stats</h1>
          {playerOptions.length > 0 ? (
            <PlayerPicker
              value={selectedPlayer}
              options={playerOptions}
              onChange={setSelectedPlayer}
            />
          ) : null}
          <p className={styles.subtitle}>
            No games yet for <strong>{player}</strong>.{" "}
            <Link to="/play">Play one</Link> to start filling this up.
          </p>
        </header>
      </div>
    );
  }

  const avgHalfMoves =
    summary.total > 0 ? summary.totalHalfMoves / summary.total : 0;
  const avgMoves = avgHalfMoves / 2;

  const scopeCountLabel =
    scope === "all"
      ? `${summary.total} ${summary.total === 1 ? "game" : "games"}`
      : `${summary.total} ${summary.total === 1 ? "game" : "games"} as ${
          scope === "w" ? "White" : "Black"
        }`;

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Stats</h1>
        {playerOptions.length > 0 ? (
          <PlayerPicker
            value={selectedPlayer}
            options={playerOptions}
            onChange={setSelectedPlayer}
          />
        ) : (
          <p className={styles.subtitle}>
            <strong>{player}</strong>
          </p>
        )}
        <div className={styles.headerToggleRow}>
          <ScopeToggle
            value={scope}
            onChange={setScope}
            disabledScopes={disabledScopes}
          />
        </div>
        <p className={styles.subtitle}>{scopeCountLabel}.</p>
      </header>

      <section className={styles.recordCard}>
        <div className={styles.recordHead}>
          <h2 className={styles.cardTitle}>Record</h2>
          <span className={styles.recordScore}>
            {summary.scorePct.toFixed(1)}%{" "}
            <span className={styles.recordScoreLabel}>score</span>
          </span>
        </div>

        <RecordBar w={summary.wins} d={summary.draws} l={summary.losses} />

        <div className={styles.recordCounts}>
          <span className={`${styles.pill} ${styles.pillWin}`}>
            {summary.wins} <span>W</span>
          </span>
          <span className={`${styles.pill} ${styles.pillDraw}`}>
            {summary.draws} <span>D</span>
          </span>
          <span className={`${styles.pill} ${styles.pillLoss}`}>
            {summary.losses} <span>L</span>
          </span>
        </div>
      </section>

      <div className={styles.grid}>
        <StatCard
          title="Game length"
          rows={[
            {
              label: "Avg moves / game",
              value: summary.total === 0 ? "—" : avgMoves.toFixed(1),
            },
            {
              label: "Longest game",
              value:
                summary.longestHalfMoves === 0
                  ? "—"
                  : `${Math.ceil(summary.longestHalfMoves / 2)} moves`,
            },
            {
              label: "Shortest decisive",
              value:
                summary.shortestDecisiveHalfMoves === 0
                  ? "—"
                  : `${Math.ceil(summary.shortestDecisiveHalfMoves / 2)} moves`,
            },
          ]}
        />

        <StatCard
          title="How games end"
          rows={[
            {
              label: "Checkmate",
              value: String(summary.endings.checkmate),
            },
            {
              label: "Resignation",
              value: String(summary.endings.resignation),
            },
            {
              label: "Stalemate",
              value: String(summary.endings.stalemate),
            },
          ]}
        />
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Top openings</h2>
        {summary.openingList.length === 0 ? (
          <p className={styles.muted}>
            No recognized openings yet — try a few classical lines.
          </p>
        ) : (
          <ul className={styles.openingList}>
            {summary.openingList.map((op) => {
              const pct = op.total === 0 ? 0 : (op.wins / op.total) * 100;
              return (
                <li key={op.name} className={styles.openingItem}>
                  <span className={styles.openingEco}>{op.eco}</span>
                  <span className={styles.openingName}>{op.name}</span>
                  <span className={styles.openingCount}>
                    {op.total} {op.total === 1 ? "game" : "games"}
                  </span>
                  <span
                    className={styles.openingBar}
                    aria-label={`${pct.toFixed(0)}% wins`}
                  >
                    <span
                      className={styles.openingBarFill}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className={styles.openingPct}>{pct.toFixed(0)}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

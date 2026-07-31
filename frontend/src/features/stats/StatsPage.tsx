import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../../context/SettingsContext";
import { gamesApi, type SavedGame } from "../../lib/api";
import { lookupOpening } from "../../lib/openingsData";
import styles from "./StatsPage.module.css";

type Outcome = "win" | "loss" | "draw";
type Scope = "all" | "w" | "b";

// canonicalizes assorted result strings into a winner tag.
function resultWinner(result: string): "w" | "b" | "draw" | null {
  const r = result.trim().toLowerCase();
  if (!r) return null;
  if (r === "1-0") return "w";
  if (r === "0-1") return "b";
  if (r === "1/2-1/2" || r.startsWith("draw")) return "draw";
  if (r.startsWith("white wins")) return "w";
  if (r.startsWith("black wins")) return "b";
  return null;
}

// which side (if any) did the player play in this game?
function playerSide(game: SavedGame, player: string): "w" | "b" | null {
  const norm = player.trim().toLowerCase();
  if (!norm) return null;
  if (game.whiteName.trim().toLowerCase() === norm) return "w";
  if (game.blackName.trim().toLowerCase() === norm) return "b";
  return null;
}

// interprets a saved game from the player's point of view. requires the game
// to be attributable to `player` and to have a decoded result; otherwise null.
function outcomeFor(
  game: SavedGame,
  player: string,
): { outcome: Outcome; side: "w" | "b" } | null {
  const side = playerSide(game, player);
  if (!side) return null;
  const w = resultWinner(game.result);
  if (w == null) return null;
  if (w === "draw") return { outcome: "draw", side };
  return { outcome: w === side ? "win" : "loss", side };
}

// human summary of how a game ended. only the three "real" endings are
// tracked; imported / unlabeled games are excluded from stats entirely.
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

// small stat card (title + rows).
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

// player switcher — appears in the header when the platform has more than
// one non-engine player on record.
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

// three-color record bar for W / D / L.
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

// segmented control for switching the Record card between the player's
// total games and just the games they played as one colour.
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

// engines never appear in the player picker. anything matching `stockfish`
// (any suffix like "Stockfish 16.1") is treated as an engine. we also drop
// the literal PGN placeholder names "white" / "black" that some imports
// carry so they don't clutter the picker.
function isEnginePlayer(name: string): boolean {
  return /^\s*stockfish\b/i.test(name);
}
function isPlaceholderColorName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "white" || n === "black";
}

export function StatsPage() {
  const { settings } = useSettings();

  const [games, setGames] = useState<SavedGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // which player's stats are being shown. seeded from settings, but users
  // can flip to any other player who has games on the platform.
  const [selectedPlayer, setSelectedPlayer] = useState<string>(settings.playerName);
  // record-card scope filter: total, white-only, or black-only.
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

  // unique, non-engine, non-placeholder player names across every saved game,
  // sorted for the dropdown. names are compared case-insensitively but we
  // preserve the first-seen casing for display.
  const playerOptions = useMemo(() => {
    if (!games) return [] as string[];
    const seen = new Map<string, string>();
    const consider = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (isEnginePlayer(trimmed)) return;
      if (isPlaceholderColorName(trimmed)) return;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    };
    for (const g of games) {
      consider(g.whiteName);
      consider(g.blackName);
    }
    return [...seen.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [games]);

  // when the games load (or change), make sure the current selection is a
  // real option. prefer the settings player, fall back to the first option.
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

  const summary = useMemo(() => {
    if (!games) return null;

    // only games attributable to the current player with a decoded result
    // count toward the stats.
    const attributed = games
      .map((g) => {
        const parsed = outcomeFor(g, player);
        return parsed ? { game: g, ...parsed } : null;
      })
      .filter((v): v is { game: SavedGame; outcome: Outcome; side: "w" | "b" } => v !== null);

    // per-side W/D/L breakdown feeds the record card's scope toggle.
    const empty = { w: 0, d: 0, l: 0 };
    const byScope: Record<Scope, { w: number; d: number; l: number }> = {
      all: { ...empty },
      w: { ...empty },
      b: { ...empty },
    };

    let totalHalfMoves = 0;
    let longestHalfMoves = 0;
    let shortestDecisiveHalfMoves = Number.POSITIVE_INFINITY;
    const endings = { checkmate: 0, resignation: 0, stalemate: 0 };
    const openingCounts = new Map<string, { eco: string; wins: number; total: number }>();

    for (const { game: g, outcome, side } of attributed) {
      const bucket = byScope[side];
      const total = byScope.all;
      if (outcome === "win") {
        bucket.w++;
        total.w++;
      } else if (outcome === "loss") {
        bucket.l++;
        total.l++;
      } else {
        bucket.d++;
        total.d++;
      }

      totalHalfMoves += g.ucis.length;
      longestHalfMoves = Math.max(longestHalfMoves, g.ucis.length);

      const dec = resultWinner(g.result);
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

    return {
      total: attributed.length,
      byScope,
      totalHalfMoves,
      longestHalfMoves,
      shortestDecisiveHalfMoves:
        shortestDecisiveHalfMoves === Number.POSITIVE_INFINITY
          ? 0
          : shortestDecisiveHalfMoves,
      endings,
      openingList,
    };
  }, [games, player]);

  // whenever the underlying player changes, keep the scope selection valid.
  // e.g. flipping to a player who has never played black should not leave
  // "As Black" active.
  useEffect(() => {
    if (!summary) return;
    if (scope === "w" && summary.byScope.w.w + summary.byScope.w.d + summary.byScope.w.l === 0) {
      setScope("all");
    } else if (
      scope === "b" &&
      summary.byScope.b.w + summary.byScope.b.d + summary.byScope.b.l === 0
    ) {
      setScope("all");
    }
  }, [summary, scope]);

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

  if (summary.total === 0) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Stats</h1>
          {playerOptions.length > 1 ? (
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

  // active bucket for the record card based on the toggle.
  const active = summary.byScope[scope];
  const activeTotal = active.w + active.d + active.l;
  const activeScored = active.w + 0.5 * active.d;
  const activeScorePct = activeTotal === 0 ? 0 : (activeScored / activeTotal) * 100;
  const disabledScopes = new Set<Scope>();
  if (summary.byScope.w.w + summary.byScope.w.d + summary.byScope.w.l === 0) {
    disabledScopes.add("w");
  }
  if (summary.byScope.b.w + summary.byScope.b.d + summary.byScope.b.l === 0) {
    disabledScopes.add("b");
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Stats</h1>
        {playerOptions.length > 1 ? (
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
        <p className={styles.subtitle}>
          {summary.total} {summary.total === 1 ? "game" : "games"} on record.
        </p>
      </header>

      <section className={styles.recordCard}>
        <div className={styles.recordHead}>
          <h2 className={styles.cardTitle}>Record</h2>
          <span className={styles.recordScore}>
            {activeScorePct.toFixed(1)}%{" "}
            <span className={styles.recordScoreLabel}>score</span>
          </span>
        </div>

        <ScopeToggle
          value={scope}
          onChange={setScope}
          disabledScopes={disabledScopes}
        />

        <RecordBar w={active.w} d={active.d} l={active.l} />

        <div className={styles.recordCounts}>
          <span className={`${styles.pill} ${styles.pillWin}`}>
            {active.w} <span>W</span>
          </span>
          <span className={`${styles.pill} ${styles.pillDraw}`}>
            {active.d} <span>D</span>
          </span>
          <span className={`${styles.pill} ${styles.pillLoss}`}>
            {active.l} <span>L</span>
          </span>
        </div>
      </section>

      <div className={styles.grid}>
        <StatCard
          title="Game length"
          rows={[
            {
              label: "Avg moves / game",
              value: avgMoves.toFixed(1),
            },
            {
              label: "Longest game",
              value: `${Math.ceil(summary.longestHalfMoves / 2)} moves`,
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

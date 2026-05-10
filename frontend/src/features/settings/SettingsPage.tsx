import { useState } from "react";

import { Button } from "../../components/ui/Button";
import {
  ENGINE_DEPTH_RANGE,
  useSettings,
  type DefaultOrientation,
} from "../../context/SettingsContext";
import styles from "./SettingsPage.module.css";

// rough difficulty label for a given engine depth.
function difficultyLabel(depth: number): string {
  if (depth <= 8) return "Casual";
  if (depth <= 12) return "Club";
  if (depth <= 16) return "Strong";
  if (depth <= 19) return "Expert";
  return "Master";
}

export function SettingsPage() {
  const {
    settings,
    setPlayerName,
    setThemeHue,
    setEngineDepth,
    setDefaultOrientation,
    setShowMoveHints,
    setHighlightLastMove,
    reset,
  } = useSettings();

  const [nameDraft, setNameDraft] = useState(settings.playerName);

  const commitName = () => setPlayerName(nameDraft);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Local preferences. Saved to this browser.</p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.cardHead}>Profile</h2>

        <label className={styles.field}>
          <span className={styles.label}>Player name</span>
          <input
            className={styles.input}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
          />
        </label>

        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={commitName}>
            Save name
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardHead}>Engine</h2>

        <label className={styles.field}>
          <span className={styles.label}>
            Stockfish strength
            <span className={styles.value}>
              depth {settings.engineDepth} · {difficultyLabel(settings.engineDepth)}
            </span>
          </span>
          <input
            className={styles.range}
            type="range"
            min={ENGINE_DEPTH_RANGE.min}
            max={ENGINE_DEPTH_RANGE.max}
            value={settings.engineDepth}
            onChange={(e) => setEngineDepth(Number(e.target.value))}
          />
          <span className={styles.hint}>
            Higher depth = stronger and slower. Most players want 14–18.
          </span>
        </label>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardHead}>Board</h2>

        <label className={styles.field}>
          <span className={styles.label}>Default orientation</span>
          <select
            className={styles.select}
            value={settings.defaultOrientation}
            onChange={(e) =>
              setDefaultOrientation(e.target.value as DefaultOrientation)
            }
          >
            <option value="auto">Auto (your color in AI games)</option>
            <option value="white">Always White</option>
            <option value="black">Always Black</option>
          </select>
        </label>

        <div className={styles.toggle}>
          <span className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Show move hints</span>
            <span className={styles.toggleDesc}>
              Highlight legal target squares when a piece is selected.
            </span>
          </span>
          <input
            className={styles.toggleInput}
            type="checkbox"
            checked={settings.showMoveHints}
            onChange={(e) => setShowMoveHints(e.target.checked)}
          />
        </div>

        <div className={styles.toggle}>
          <span className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Highlight last move</span>
            <span className={styles.toggleDesc}>
              Tint the from / to squares of the previous move.
            </span>
          </span>
          <input
            className={styles.toggleInput}
            type="checkbox"
            checked={settings.highlightLastMove}
            onChange={(e) => setHighlightLastMove(e.target.checked)}
          />
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardHead}>Theme</h2>

        <label className={styles.field}>
          <span className={styles.label}>
            Sky hue
            <span className={styles.value}>{settings.themeHue}°</span>
          </span>
          <input
            className={styles.range}
            type="range"
            min={0}
            max={360}
            value={settings.themeHue}
            onChange={(e) => setThemeHue(Number(e.target.value))}
          />
        </label>
      </section>

      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

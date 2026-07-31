import { useState } from "react";

import { Button } from "../../components/ui/Button";
import { ENGINE_DEPTH_RANGE, useSettings } from "../../context/SettingsContext";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const {
    settings,
    setPlayerName,
    setThemeHue,
    setEngineDepth,
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
            Stockfish depth
            <span className={styles.value}>{settings.engineDepth}</span>
          </span>
          <input
            className={styles.range}
            type="range"
            min={ENGINE_DEPTH_RANGE.min}
            max={ENGINE_DEPTH_RANGE.max}
            value={settings.engineDepth}
            onChange={(e) => setEngineDepth(Number(e.target.value))}
          />
        </label>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardHead}>Board</h2>

        <div className={styles.toggle}>
          <span className={styles.toggleTitle}>Show move hints</span>
          <input
            className={styles.toggleInput}
            type="checkbox"
            checked={settings.showMoveHints}
            onChange={(e) => setShowMoveHints(e.target.checked)}
          />
        </div>

        <div className={styles.toggle}>
          <span className={styles.toggleTitle}>Highlight last move</span>
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

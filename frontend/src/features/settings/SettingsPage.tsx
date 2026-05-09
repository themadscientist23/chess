import { useState } from "react";
import { useSettings } from "../../context/SettingsContext";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { settings, setPlayerName, setThemeHue } = useSettings();
  const [nameDraft, setNameDraft] = useState(settings.playerName);

  // saves the current settings form values.
  function save() {
    setPlayerName(nameDraft);
  }

  return (
    <div className={styles.wrap}>
      <header style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>Settings</h1>
        <p style={{ margin: "0.4rem 0 0", fontSize: "1.05rem", color: "#3d4566" }}>
          Single-account local settings.
        </p>
      </header>

      <section className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Player name</span>
          <input
            className={styles.select}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Sky hue ({settings.themeHue}°)</span>
          <input
            className={styles.range}
            type="range"
            min={0}
            max={360}
            value={settings.themeHue}
            onChange={(e) => setThemeHue(Number(e.target.value))}
          />
        </label>

        <button type="button" className={styles.save} onClick={save}>
          Save
        </button>
      </section>
    </div>
  );
}

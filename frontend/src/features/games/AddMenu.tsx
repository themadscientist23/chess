import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import { parsePgnToGame } from "../../lib/pgnImport";
import styles from "./AddMenu.module.css";

type Mode = "closed" | "menu" | "newTag" | "importPgn";

export interface ImportPgnPayload {
  pgnText: string;
  whiteName: string;
  blackName: string;
}

interface AddMenuProps {
  onCreateTag: (name: string) => Promise<void>;
  onImportPgn: (payload: ImportPgnPayload) => Promise<void>;
}

// "+" popover for creating a tag or importing a PGN. platform games are
// created by finishing a match on the Play page, not from here.
export function AddMenu({ onCreateTag, onImportPgn }: AddMenuProps) {
  const [mode, setMode] = useState<Mode>("closed");
  const [tagName, setTagName] = useState("");
  const [pgn, setPgn] = useState("");
  const [whiteName, setWhiteName] = useState("");
  const [blackName, setBlackName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode === "closed") return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mode]);

  const close = () => {
    setMode("closed");
    setError(null);
    setTagName("");
    setPgn("");
    setWhiteName("");
    setBlackName("");
    setSubmitting(false);
  };

  const submitTag = async () => {
    if (!tagName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreateTag(tagName.trim());
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tag");
    } finally {
      setSubmitting(false);
    }
  };

  // when the user pastes a PGN, pull White/Black tags into the name fields
  // if those fields are still empty — never overwrite a typed name.
  const onPgnChange = (value: string) => {
    setPgn(value);
    if (!value.trim()) return;
    if (whiteName.trim() && blackName.trim()) return;
    try {
      const parsed = parsePgnToGame(value);
      if (!whiteName.trim()) setWhiteName(parsed.whiteName);
      if (!blackName.trim()) setBlackName(parsed.blackName);
    } catch {
      // incomplete paste — ignore until Import is clicked
    }
  };

  const submitPgn = async () => {
    if (!pgn.trim()) return;
    if (!whiteName.trim() || !blackName.trim()) {
      setError("Enter both player names");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onImportPgn({
        pgnText: pgn.trim(),
        whiteName: whiteName.trim(),
        blackName: blackName.trim(),
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import PGN");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.fab}
        aria-label="Add"
        title="Add"
        onClick={() => (mode === "closed" ? setMode("menu") : close())}
      >
        +
      </button>

      {mode === "menu" ? (
        <div className={`${styles.popover} ${styles.menu}`}>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => setMode("newTag")}
          >
            New tag
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => setMode("importPgn")}
          >
            Import PGN
          </button>
        </div>
      ) : null}

      {mode === "newTag" ? (
        <div className={styles.popover}>
          <h3 className={styles.popTitle}>New tag</h3>
          <input
            className={styles.input}
            placeholder="tag name"
            value={tagName}
            autoFocus
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitTag();
            }}
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.popActions}>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitTag()}
              disabled={submitting || !tagName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "importPgn" ? (
        <div className={styles.popover}>
          <h3 className={styles.popTitle}>Import PGN</h3>
          <label className={styles.label}>
            White player name
            <input
              className={styles.input}
              value={whiteName}
              onChange={(e) => setWhiteName(e.target.value)}
              placeholder="White"
              autoFocus
            />
          </label>
          <label className={styles.label}>
            Black player name
            <input
              className={styles.input}
              value={blackName}
              onChange={(e) => setBlackName(e.target.value)}
              placeholder="Black"
            />
          </label>
          <textarea
            className={styles.textarea}
            placeholder="Paste PGN here…"
            value={pgn}
            onChange={(e) => onPgnChange(e.target.value)}
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.popActions}>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitPgn()}
              disabled={
                submitting ||
                !pgn.trim() ||
                !whiteName.trim() ||
                !blackName.trim()
              }
            >
              Import
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

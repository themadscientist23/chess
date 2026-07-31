import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import styles from "./AddMenu.module.css";

type Mode = "closed" | "newFolder";

interface AddMenuProps {
  onCreateFolder: (name: string) => Promise<void>;
}

// A single-purpose "+" popover for creating a new folder. The games surface
// intentionally exposes no other add flows — games are only ever created by
// finishing a match on the Play page.
export function AddMenu({ onCreateFolder }: AddMenuProps) {
  const [mode, setMode] = useState<Mode>("closed");
  const [folderName, setFolderName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // closes the popover when clicking outside or pressing escape.
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
    setFolderName("");
    setSubmitting(false);
  };

  const submitNewFolder = async () => {
    if (!folderName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreateFolder(folderName.trim());
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create folder");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.fab}
        aria-label="New folder"
        title="New folder"
        onClick={() => (mode === "closed" ? setMode("newFolder") : close())}
      >
        +
      </button>

      {mode === "newFolder" ? (
        <div className={styles.popover}>
          <h3 className={styles.popTitle}>New folder</h3>
          <input
            className={styles.input}
            placeholder="folder name"
            value={folderName}
            autoFocus
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNewFolder();
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
              onClick={() => void submitNewFolder()}
              disabled={submitting || !folderName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import type { GameFolder } from "../../lib/api";
import styles from "./AddMenu.module.css";

type Mode = "closed" | "menu" | "newFolder" | "newGame";

interface AddMenuProps {
  folders: GameFolder[];
  // when set, "New game" imports straight into this folder (no picker shown).
  fixedFolderId?: number;
  onCreateFolder: (name: string) => Promise<void>;
  onImportPgn: (folderId: number, pgnText: string) => Promise<void>;
}

export function AddMenu({
  folders,
  fixedFolderId,
  onCreateFolder,
  onImportPgn,
}: AddMenuProps) {
  const [mode, setMode] = useState<Mode>("closed");
  const [folderName, setFolderName] = useState("");
  const [pgn, setPgn] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null);
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
    setPgn("");
    setSubmitting(false);
  };

  const openMenu = () => {
    setError(null);
    setMode("menu");
  };

  const openNewGame = () => {
    setError(null);
    if (fixedFolderId != null) {
      setTargetFolderId(fixedFolderId);
    } else {
      setTargetFolderId(folders[0]?.id ?? null);
    }
    setMode("newGame");
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

  const submitNewGame = async () => {
    if (targetFolderId == null) {
      setError("Pick a folder first");
      return;
    }
    if (!pgn.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImportPgn(targetFolderId, pgn.trim());
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
        onClick={() => (mode === "closed" ? openMenu() : close())}
      >
        +
      </button>

      {mode === "menu" ? (
        <div className={`${styles.popover} ${styles.menu}`}>
          <button type="button" className={styles.menuItem} onClick={() => setMode("newFolder")}>
            New folder
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={openNewGame}
            disabled={folders.length === 0 && fixedFolderId == null}
            title={
              folders.length === 0 && fixedFolderId == null
                ? "Create a folder first"
                : undefined
            }
          >
            New game (paste PGN)
          </button>
        </div>
      ) : null}

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

      {mode === "newGame" ? (
        <div className={styles.popover}>
          <h3 className={styles.popTitle}>New game</h3>
          {fixedFolderId == null ? (
            <label className={styles.label}>
              Folder
              <select
                className={styles.input}
                value={targetFolderId ?? ""}
                onChange={(e) => setTargetFolderId(Number(e.target.value))}
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <textarea
            className={styles.textarea}
            placeholder="Paste PGN here…"
            value={pgn}
            autoFocus
            onChange={(e) => setPgn(e.target.value)}
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.popActions}>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitNewGame()}
              disabled={submitting || !pgn.trim() || targetFolderId == null}
            >
              Add game
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

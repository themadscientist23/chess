import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { gamesApi, type GameFolder } from "../../lib/api";
import { AddMenu } from "./AddMenu";
import { FolderIcon } from "./FolderIcon";
import styles from "./GamesPage.module.css";

export function GamesPage() {
  const [folders, setFolders] = useState<GameFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // loads folder list from the backend.
  const loadFolders = useCallback(async () => {
    try {
      const { folders } = await gamesApi.folders();
      setFolders(folders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load folders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  // creates one new (non-system) folder.
  const handleCreateFolder = async (name: string) => {
    setError(null);
    await gamesApi.createFolder(name);
    await loadFolders();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.titleBar}>
        <h1 className={styles.title}>Games</h1>
        <AddMenu onCreateFolder={handleCreateFolder} />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Loading folders…</p>
      ) : folders.length === 0 ? (
        <p className={styles.muted}>No folders yet — use + to create one.</p>
      ) : (
        <ul className={styles.folderList}>
          {folders.map((folder) => (
            <li key={folder.id} className={styles.folderItem}>
              <Link to={`/games/folder/${folder.id}`} className={styles.folderLink}>
                <FolderIcon className={styles.folderIcon} />
                <span className={styles.folderName}>{folder.name}</span>
                <span className={styles.folderCount}>
                  {folder.gameCount} {folder.gameCount === 1 ? "game" : "games"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

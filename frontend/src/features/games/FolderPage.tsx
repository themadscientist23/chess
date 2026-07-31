import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { gamesApi, type GameFolder, type SavedGame } from "../../lib/api";
import { AddMenu } from "./AddMenu";
import styles from "./GamesPage.module.css";

export function FolderPage() {
  const { folderId: folderIdParam = "" } = useParams();
  const folderId = Number(folderIdParam);

  const [folder, setFolder] = useState<GameFolder | null>(null);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // index of the item currently being dragged, for visual affordance only.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // loads the folder metadata + its games in the order the backend returns.
  const loadAll = useCallback(async () => {
    if (!Number.isFinite(folderId)) {
      setError("Invalid folder id");
      setLoading(false);
      return;
    }
    try {
      const [foldersRes, gamesRes] = await Promise.all([
        gamesApi.folders(),
        gamesApi.listGames(folderId),
      ]);
      setFolder(foldersRes.folders.find((f) => f.id === folderId) ?? null);
      setGames(gamesRes.games);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load folder");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateFolder = async (name: string) => {
    setError(null);
    await gamesApi.createFolder(name);
    await loadAll();
  };

  // avoid re-issuing the same reorder while a previous one is in flight.
  const reorderInFlightRef = useRef(false);

  const persistOrder = useCallback(
    async (nextGames: SavedGame[]) => {
      if (reorderInFlightRef.current) return;
      reorderInFlightRef.current = true;
      try {
        await gamesApi.reorderGames(
          folderId,
          nextGames.map((g) => g.id),
        );
      } catch (e) {
        // roll back on failure by reloading from the source of truth.
        setError(e instanceof Error ? e.message : "Could not save new order");
        await loadAll();
      } finally {
        reorderInFlightRef.current = false;
      }
    },
    [folderId, loadAll],
  );

  const onDragStart = (index: number) => (ev: React.DragEvent<HTMLLIElement>) => {
    setDragIndex(index);
    // needed for the drag operation to actually fire in Firefox.
    ev.dataTransfer.effectAllowed = "move";
    try {
      ev.dataTransfer.setData("text/plain", String(games[index]?.id ?? ""));
    } catch {
      // some browsers throw for read-only transfers; ignore.
    }
  };

  const onDragOver = (index: number) => (ev: React.DragEvent<HTMLLIElement>) => {
    if (dragIndex == null) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (dropIndex !== index) setDropIndex(index);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const onDrop = (index: number) => (ev: React.DragEvent<HTMLLIElement>) => {
    ev.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setDropIndex(null);
    if (from == null || from === index) return;

    const next = games.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(index, 0, moved);

    setGames(next);
    void persistOrder(next);
  };

  const isSystem = folder?.isSystem ?? false;

  return (
    <div className={styles.wrap}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link to="/games" className={styles.crumb}>
          Games
        </Link>
        <span className={styles.crumbSep}>/</span>
        <span className={styles.crumbCurrent}>{folder?.name ?? "…"}</span>
      </nav>

      <div className={styles.titleBar}>
        <h1 className={styles.title}>{folder?.name ?? "Folder"}</h1>
        {/* the On Platform folder is immutable — no + menu here. */}
        {isSystem ? null : <AddMenu onCreateFolder={handleCreateFolder} />}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Loading games…</p>
      ) : games.length === 0 ? (
        <p className={styles.muted}>
          {isSystem
            ? "No platform games yet — finish a game on the Play page to fill this."
            : "No games here yet."}
        </p>
      ) : (
        <ul className={styles.gameList}>
          {games.map((g, i) => {
            const isDragging = dragIndex === i;
            const isDropTarget = dropIndex === i && dragIndex !== i;
            const classes = [
              styles.gameItem,
              styles.gameItemDraggable,
              isDragging ? styles.gameItemDragging : "",
              isDropTarget ? styles.gameItemDropTarget : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={g.id}
                className={classes}
                draggable
                onDragStart={onDragStart(i)}
                onDragOver={onDragOver(i)}
                onDragEnd={onDragEnd}
                onDrop={onDrop(i)}
              >
                <span className={styles.dragHandle} aria-hidden>
                  ⋮⋮
                </span>
                <Link to={`/games/${g.id}`} className={styles.gameLink}>
                  <span className={styles.gameNames}>
                    {g.whiteName} vs {g.blackName}
                  </span>
                  <span className={styles.gameMeta}>
                    {new Date(g.createdAt).toLocaleString()} · {g.result}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

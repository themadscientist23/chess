import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { gamesApi, type GameFolder, type SavedGame } from "../../lib/api";
import { parsePgnToGame } from "../../lib/pgnImport";
import { AddMenu } from "./AddMenu";
import styles from "./GamesPage.module.css";

export function FolderPage() {
  const { folderId: folderIdParam = "" } = useParams();
  const folderId = Number(folderIdParam);

  const [folder, setFolder] = useState<GameFolder | null>(null);
  const [folders, setFolders] = useState<GameFolder[]>([]);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // loads the folder list (for moves) and the games for this folder.
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
      setFolders(foldersRes.folders);
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

  const handleImportPgn = async (targetId: number, pgnText: string) => {
    setError(null);
    const parsed = parsePgnToGame(pgnText);
    await gamesApi.createGame({
      folderId: targetId,
      mode: "pvp",
      whiteName: parsed.whiteName,
      blackName: parsed.blackName,
      result: parsed.result,
      source: "pgn",
      ucis: parsed.ucis,
      prettyMoves: parsed.prettyMoves,
    });
    await loadAll();
  };

  const handleCreateFolder = async (name: string) => {
    setError(null);
    await gamesApi.createFolder(name);
    await loadAll();
  };

  // a system folder cannot accept pgn imports — hide the "New game" path here.
  const importableFolders = useMemo(
    () => folders.filter((f) => !f.isSystem),
    [folders],
  );
  const fixedFolderId = folder && !folder.isSystem ? folder.id : undefined;

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
        <AddMenu
          folders={importableFolders}
          fixedFolderId={fixedFolderId}
          onCreateFolder={handleCreateFolder}
          onImportPgn={handleImportPgn}
        />
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Loading games…</p>
      ) : games.length === 0 ? (
        <p className={styles.muted}>
          {folder?.isSystem
            ? "No platform games yet — finish a game on the Play page to fill this."
            : "No games here yet — use + to paste a PGN."}
        </p>
      ) : (
        <ul className={styles.gameList}>
          {games.map((g) => (
            <li key={g.id} className={styles.gameItem}>
              <Link to={`/games/${g.id}`} className={styles.gameLink}>
                <span className={styles.gameNames}>
                  {g.whiteName} vs {g.blackName}
                </span>
                <span className={styles.gameMeta}>
                  {new Date(g.createdAt).toLocaleString()} · {g.result}
                </span>
              </Link>
              {!folder?.isSystem ? null : (
                <span className={styles.tag}>played here</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  gamesApi,
  tagsApi,
  type GameTag,
  type SavedGame,
} from "../../lib/api";
import { parsePgnToGame } from "../../lib/pgnImport";
import { AddMenu, type ImportPgnPayload } from "./AddMenu";
import styles from "./GamesPage.module.css";

function isImported(game: SavedGame): boolean {
  return game.source !== "platform";
}

type PendingDelete =
  | { kind: "game"; game: SavedGame }
  | { kind: "tag"; tag: GameTag };

export function GamesPage() {
  const [games, setGames] = useState<SavedGame[]>([]);
  const [tags, setTags] = useState<GameTag[]>([]);
  // single-select filter: null = All, otherwise one tag id.
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformFolderId, setPlatformFolderId] = useState<number>(1);
  // which game's "add tag" picker is open, if any.
  const [tagPickerFor, setTagPickerFor] = useState<number | null>(null);
  // inline name editor for an imported game.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editWhite, setEditWhite] = useState("");
  const [editBlack, setEditBlack] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [gamesRes, tagsRes, foldersRes] = await Promise.all([
        gamesApi.listGames(
          selectedTagId != null ? { tagIds: [selectedTagId] } : undefined,
        ),
        tagsApi.list(),
        gamesApi.folders(),
      ]);
      setGames(gamesRes.games);
      setTags(tagsRes.tags);
      const platform = foldersRes.folders.find((f) => f.isSystem);
      if (platform) setPlatformFolderId(platform.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load games");
    } finally {
      setLoading(false);
    }
  }, [selectedTagId]);

  useEffect(() => {
    setLoading(true);
    void loadAll();
  }, [loadAll]);

  const handleCreateTag = async (name: string) => {
    setError(null);
    await tagsApi.create(name);
    await loadAll();
  };

  const handleImportPgn = async ({
    pgnText,
    whiteName,
    blackName,
  }: ImportPgnPayload) => {
    setError(null);
    const parsed = parsePgnToGame(pgnText);
    await gamesApi.createGame({
      folderId: platformFolderId,
      mode: "pvp",
      whiteName,
      blackName,
      result: parsed.result,
      source: "pgn",
      ucis: parsed.ucis,
      prettyMoves: parsed.prettyMoves,
    });
    await loadAll();
  };

  const selectFilter = (tagId: number | null) => {
    setSelectedTagId(tagId);
  };

  const attachTag = async (gameId: number, tagId: number) => {
    setError(null);
    try {
      await gamesApi.addTagToGame(gameId, tagId);
      setTagPickerFor(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add tag");
    }
  };

  const detachTag = async (gameId: number, tag: GameTag) => {
    if (tag.isSystem) return;
    setError(null);
    try {
      await gamesApi.removeTagFromGame(gameId, tag.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove tag");
    }
  };

  const requestDeleteTag = (tag: GameTag) => {
    if (tag.isSystem) return;
    setPendingDelete({ kind: "tag", tag });
  };

  const startEditNames = (game: SavedGame) => {
    if (!isImported(game)) return;
    setEditingId(game.id);
    setEditWhite(game.whiteName);
    setEditBlack(game.blackName);
    setTagPickerFor(null);
  };

  const cancelEditNames = () => {
    setEditingId(null);
    setEditWhite("");
    setEditBlack("");
  };

  const saveEditNames = async (gameId: number) => {
    if (!editWhite.trim() || !editBlack.trim()) {
      setError("Both player names are required");
      return;
    }
    setError(null);
    try {
      await gamesApi.updateGameNames(gameId, {
        whiteName: editWhite.trim(),
        blackName: editBlack.trim(),
      });
      cancelEditNames();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename players");
    }
  };

  const requestDeleteGame = (game: SavedGame) => {
    if (!isImported(game)) return;
    setPendingDelete({ kind: "game", game });
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      if (pendingDelete.kind === "game") {
        await gamesApi.deleteGame(pendingDelete.game.id);
        if (editingId === pendingDelete.game.id) cancelEditNames();
      } else {
        await tagsApi.remove(pendingDelete.tag.id);
        setSelectedTagId((cur) =>
          cur === pendingDelete.tag.id ? null : cur,
        );
      }
      setPendingDelete(null);
      await loadAll();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : pendingDelete.kind === "game"
            ? "Could not delete game"
            : "Could not delete tag",
      );
    } finally {
      setDeleting(false);
    }
  };

  // custom tags available to attach to a given game (not already on it).
  const attachableFor = useMemo(() => {
    const map = new Map<number, GameTag[]>();
    for (const g of games) {
      const have = new Set((g.tags ?? []).map((t) => t.id));
      map.set(
        g.id,
        tags.filter((t) => !t.isSystem && !have.has(t.id)),
      );
    }
    return map;
  }, [games, tags]);

  return (
    <div className={styles.wrap}>
      <div className={styles.titleBar}>
        <h1 className={styles.title}>Games</h1>
        <AddMenu onCreateTag={handleCreateTag} onImportPgn={handleImportPgn} />
      </div>

      <div className={styles.filterRow} role="radiogroup" aria-label="Filter by tag">
        <button
          type="button"
          role="radio"
          aria-checked={selectedTagId == null}
          className={`${styles.filterChip} ${
            selectedTagId == null ? styles.filterChipActive : ""
          }`}
          onClick={() => selectFilter(null)}
        >
          All
        </button>
        {tags.map((tag) => {
          const active = selectedTagId === tag.id;
          return (
            <button
              key={tag.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.filterChip} ${
                active ? styles.filterChipActive : ""
              }`}
              onClick={() => selectFilter(tag.id)}
              onContextMenu={(e) => {
                if (tag.isSystem) return;
                e.preventDefault();
                requestDeleteTag(tag);
              }}
              title={
                tag.isSystem
                  ? tag.name
                  : `${tag.name} — right-click to delete`
              }
            >
              {tag.name}
              {typeof tag.gameCount === "number" ? (
                <span className={styles.filterCount}>{tag.gameCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {loading ? (
        <p className={styles.muted}>Loading games…</p>
      ) : games.length === 0 ? (
        <p className={styles.muted}>
          {selectedTagId != null
            ? "No games with that tag."
            : "No games yet — play one or import a PGN."}
        </p>
      ) : (
        <ul className={styles.gameList}>
          {games.map((g) => {
            const attachable = attachableFor.get(g.id) ?? [];
            const pickerOpen = tagPickerFor === g.id;
            const imported = isImported(g);
            const editing = editingId === g.id;

            return (
              <li key={g.id} className={styles.gameItem}>
                <div className={styles.gameMain}>
                  {editing ? (
                    <div className={styles.nameEditRow}>
                      <input
                        className={styles.nameInput}
                        value={editWhite}
                        onChange={(e) => setEditWhite(e.target.value)}
                        aria-label="White player name"
                        autoFocus
                      />
                      <span className={styles.nameVs}>vs</span>
                      <input
                        className={styles.nameInput}
                        value={editBlack}
                        onChange={(e) => setEditBlack(e.target.value)}
                        aria-label="Black player name"
                      />
                      <button
                        type="button"
                        className={styles.nameSave}
                        onClick={() => void saveEditNames(g.id)}
                        disabled={!editWhite.trim() || !editBlack.trim()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className={styles.nameCancel}
                        onClick={cancelEditNames}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <Link to={`/games/${g.id}`} className={styles.gameLink}>
                      <span className={styles.gameNames}>
                        {g.whiteName} vs {g.blackName}
                      </span>
                      <span className={styles.gameMeta}>
                        {new Date(g.createdAt).toLocaleString()} · {g.result}
                      </span>
                    </Link>
                  )}

                  {imported && !editing ? (
                    <div className={styles.gameActions}>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => startEditNames(g)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionDanger}`}
                        onClick={() => requestDeleteGame(g)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className={styles.tagRow}>
                  {(g.tags ?? []).map((tag) => (
                    <span
                      key={tag.id}
                      className={`${styles.tag} ${
                        tag.isSystem ? styles.tagSystem : styles.tagCustom
                      }`}
                    >
                      {tag.name}
                      {!tag.isSystem ? (
                        <button
                          type="button"
                          className={styles.tagRemove}
                          aria-label={`Remove tag ${tag.name}`}
                          onClick={() => void detachTag(g.id, tag)}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}

                  <div className={styles.tagAddWrap}>
                    <button
                      type="button"
                      className={styles.tagAdd}
                      aria-label="Add tag"
                      disabled={attachable.length === 0}
                      title={
                        attachable.length === 0
                          ? "Create a custom tag first"
                          : "Add tag"
                      }
                      onClick={() =>
                        setTagPickerFor((cur) => (cur === g.id ? null : g.id))
                      }
                    >
                      +
                    </button>
                    {pickerOpen && attachable.length > 0 ? (
                      <div className={styles.tagPicker}>
                        {attachable.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={styles.tagPickerItem}
                            onClick={() => void attachTag(g.id, t.id)}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title={
          pendingDelete?.kind === "tag" ? "Delete tag?" : "Delete game?"
        }
        body={
          pendingDelete?.kind === "tag"
            ? `Remove the tag “${pendingDelete.tag.name}” from all games? This cannot be undone.`
            : `Delete ${
                pendingDelete?.kind === "game"
                  ? `${pendingDelete.game.whiteName} vs ${pendingDelete.game.blackName}`
                  : "this game"
              }? It will be removed from your Games list.`
        }
        confirmLabel="Delete"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={() => void confirmPendingDelete()}
      />
    </div>
  );
}

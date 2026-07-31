import { Router } from "express";

import { getDb } from "../db/index.js";

interface FolderRow {
  id: number;
  name: string;
  is_system: number;
  created_at: string;
}

interface GameRow {
  id: number;
  folder_id: number;
  mode: string;
  white_name: string;
  black_name: string;
  result: string;
  source: string;
  ucis_json: string;
  pretty_moves_json: string;
  created_at: string;
}

interface TagRow {
  id: number;
  name: string;
  is_system: number;
}

// safely parses a json string array.
function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

interface TagInfo {
  id: number;
  name: string;
  isSystem: boolean;
}

// builds a game_id -> TagInfo[] map for the given game ids in one query.
function loadTagsForGames(gameIds: number[]): Map<number, TagInfo[]> {
  const map = new Map<number, TagInfo[]>();
  if (gameIds.length === 0) return map;
  const db = getDb();
  const placeholders = gameIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT gt.game_id AS game_id, t.id AS id, t.name AS name, t.is_system AS is_system
       FROM game_tags gt
       JOIN tags t ON t.id = gt.tag_id
       WHERE gt.game_id IN (${placeholders})
       ORDER BY t.is_system DESC, t.name ASC`,
    )
    .all(...gameIds) as Array<TagRow & { game_id: number }>;

  for (const r of rows) {
    const list = map.get(r.game_id) ?? [];
    list.push({ id: r.id, name: r.name, isSystem: Boolean(r.is_system) });
    map.set(r.game_id, list);
  }
  return map;
}

// maps a db row + its tags to the API response shape.
function mapGame(row: GameRow, tags: TagInfo[]) {
  let ucis: string[] = [];
  let prettyMoves: string[] = [];

  try {
    ucis = parseStringArray(JSON.parse(row.ucis_json));
  } catch {
    ucis = [];
  }
  try {
    prettyMoves = parseStringArray(JSON.parse(row.pretty_moves_json));
  } catch {
    prettyMoves = [];
  }

  return {
    id: row.id,
    folderId: row.folder_id,
    mode: row.mode,
    whiteName: row.white_name,
    blackName: row.black_name,
    result: row.result,
    source: row.source,
    ucis,
    prettyMoves,
    createdAt: row.created_at,
    tags,
  };
}

export const gamesRouter = Router();

// lists folders with game counts; system folders sort first.
gamesRouter.get("/folders", (_req, res) => {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.is_system, f.created_at,
              COUNT(CASE WHEN g.deleted_at IS NULL THEN g.id END) AS game_count
       FROM game_folders f
       LEFT JOIN games g ON g.folder_id = f.id
       GROUP BY f.id
       ORDER BY f.is_system DESC, f.id ASC`,
    )
    .all() as Array<FolderRow & { game_count: number }>;

  res.json({
    folders: rows.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: Boolean(r.is_system),
      createdAt: r.created_at,
      gameCount: Number(r.game_count ?? 0),
    })),
  });
});

// creates a user folder.
gamesRouter.post("/folders", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    res.status(400).json({ error: "Folder name must be 2-80 characters" });
    return;
  }

  const db = getDb();
  try {
    const info = db.prepare(`INSERT INTO game_folders (name) VALUES (?)`).run(name);
    res.status(201).json({
      folder: { id: Number(info.lastInsertRowid), name },
    });
  } catch {
    res.status(409).json({ error: "Folder name already exists" });
  }
});

// lists games. games are always ordered by creation time (newest first).
//
// query params:
//   folderId — if provided, restrict to that folder (legacy).
//   tagIds   — comma-separated tag ids; games are returned if they carry
//              *any* of the listed tags (OR semantics).
gamesRouter.get("/", (req, res) => {
  const db = getDb();
  const folderId = req.query.folderId ? Number(req.query.folderId) : null;
  const tagIdsParam =
    typeof req.query.tagIds === "string" ? req.query.tagIds.trim() : "";
  // note: "".split(",") === [""], and Number("") === 0 — so we must drop
  // empty tokens or an unfiltered list would silently match tag_id = 0.
  const tagIds = tagIdsParam
    ? tagIdsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0)
    : [];

  const clauses: string[] = ["games.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (folderId != null) {
    clauses.push("games.folder_id = ?");
    params.push(folderId);
  }

  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => "?").join(",");
    clauses.push(
      `games.id IN (SELECT game_id FROM game_tags WHERE tag_id IN (${placeholders}))`,
    );
    params.push(...tagIds);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = db
    .prepare(
      `SELECT games.* FROM games ${where} ORDER BY games.created_at DESC, games.id DESC`,
    )
    .all(...params) as GameRow[];

  const tagsByGame = loadTagsForGames(rows.map((r) => r.id));
  res.json({ games: rows.map((r) => mapGame(r, tagsByGame.get(r.id) ?? [])) });
});

// loads one game by id.
gamesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM games WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as GameRow | undefined;

  if (!row) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const tagsByGame = loadTagsForGames([row.id]);
  res.json({ game: mapGame(row, tagsByGame.get(row.id) ?? []) });
});

// inserts a game record and auto-attaches the correct system tag.
gamesRouter.post("/", (req, res) => {
  const db = getDb();
  const folderId = Number(req.body?.folderId);
  const mode = typeof req.body?.mode === "string" ? req.body.mode : "pvp";
  const whiteName = typeof req.body?.whiteName === "string" ? req.body.whiteName.trim() : "";
  const blackName = typeof req.body?.blackName === "string" ? req.body.blackName.trim() : "";
  const result = typeof req.body?.result === "string" ? req.body.result.trim() : "";
  const source = typeof req.body?.source === "string" ? req.body.source.trim() : "platform";
  const ucis = parseStringArray(req.body?.ucis);
  const prettyMoves = parseStringArray(req.body?.prettyMoves);

  if (!Number.isFinite(folderId)) {
    res.status(400).json({ error: "folderId is required" });
    return;
  }
  if (!whiteName || !blackName || !result) {
    res.status(400).json({ error: "Missing required game fields" });
    return;
  }

  const folder = db
    .prepare(`SELECT id FROM game_folders WHERE id = ?`)
    .get(folderId) as { id: number } | undefined;

  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO games
        (folder_id, mode, white_name, black_name, result, source, ucis_json, pretty_moves_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      folderId,
      mode,
      whiteName,
      blackName,
      result,
      source || "platform",
      JSON.stringify(ucis),
      JSON.stringify(prettyMoves),
    );

  const gameId = Number(info.lastInsertRowid);

  // auto-tag with the correct system tag.
  const tagName = source === "platform" ? "Played Here" : "Imported";
  const tag = db
    .prepare(`SELECT id FROM tags WHERE name = ?`)
    .get(tagName) as { id: number } | undefined;
  if (tag) {
    db.prepare(
      `INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)`,
    ).run(gameId, tag.id);
  }

  res.status(201).json({ gameId });
});

// updates player names on an imported game. platform-played games are locked.
gamesRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const whiteName =
    typeof req.body?.whiteName === "string" ? req.body.whiteName.trim() : "";
  const blackName =
    typeof req.body?.blackName === "string" ? req.body.blackName.trim() : "";
  if (!whiteName || !blackName) {
    res.status(400).json({ error: "whiteName and blackName are required" });
    return;
  }
  if (whiteName.length > 80 || blackName.length > 80) {
    res.status(400).json({ error: "Player names must be at most 80 characters" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, source FROM games WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as { id: number; source: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  if (row.source === "platform") {
    res.status(403).json({ error: "Platform games cannot be renamed" });
    return;
  }

  db.prepare(
    `UPDATE games SET white_name = ?, black_name = ? WHERE id = ?`,
  ).run(whiteName, blackName, id);

  res.json({ ok: true });
});

// soft-deletes an imported game. platform-played games cannot be deleted.
gamesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, source, deleted_at FROM games WHERE id = ?`,
    )
    .get(id) as { id: number; source: string; deleted_at: string | null } | undefined;
  if (!row || row.deleted_at) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  if (row.source === "platform") {
    res.status(403).json({ error: "Platform games cannot be deleted" });
    return;
  }

  db.prepare(
    `UPDATE games SET deleted_at = datetime('now') WHERE id = ?`,
  ).run(id);
  res.json({ ok: true });
});

// moves a game into a different folder. kept for compatibility.
gamesRouter.patch("/:id/folder", (req, res) => {
  const id = Number(req.params.id);
  const folderId = Number(req.body?.folderId);
  if (!Number.isFinite(id) || !Number.isFinite(folderId)) {
    res.status(400).json({ error: "Invalid id or folderId" });
    return;
  }

  const db = getDb();
  const folderExists = db.prepare(`SELECT id FROM game_folders WHERE id = ?`).get(folderId);
  if (!folderExists) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  const info = db.prepare(`UPDATE games SET folder_id = ? WHERE id = ?`).run(folderId, id);
  if (info.changes === 0) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ ok: true });
});

// attaches a tag to a game (idempotent).
gamesRouter.post("/:id/tags", (req, res) => {
  const id = Number(req.params.id);
  const tagId = Number(req.body?.tagId);
  if (!Number.isFinite(id) || !Number.isFinite(tagId)) {
    res.status(400).json({ error: "Invalid id or tagId" });
    return;
  }

  const db = getDb();
  const game = db.prepare(`SELECT id FROM games WHERE id = ?`).get(id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  const tag = db.prepare(`SELECT id FROM tags WHERE id = ?`).get(tagId);
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }

  db.prepare(
    `INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)`,
  ).run(id, tagId);

  res.json({ ok: true });
});

// removes a tag from a game. system tags cannot be removed from their auto-
// assigned games (Played Here / Imported are considered permanent).
gamesRouter.delete("/:id/tags/:tagId", (req, res) => {
  const id = Number(req.params.id);
  const tagId = Number(req.params.tagId);
  if (!Number.isFinite(id) || !Number.isFinite(tagId)) {
    res.status(400).json({ error: "Invalid id or tagId" });
    return;
  }

  const db = getDb();
  const tag = db
    .prepare(`SELECT id, is_system FROM tags WHERE id = ?`)
    .get(tagId) as { id: number; is_system: number } | undefined;
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  if (tag.is_system) {
    res.status(403).json({ error: "System tags cannot be removed from a game" });
    return;
  }

  db.prepare(`DELETE FROM game_tags WHERE game_id = ? AND tag_id = ?`).run(id, tagId);
  res.json({ ok: true });
});

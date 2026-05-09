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

// safely parses a json string array.
function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

// maps a db row to api response shape.
function mapGame(row: GameRow) {
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
  };
}

export const gamesRouter = Router();

// lists folders with game counts; system folders sort first.
gamesRouter.get("/folders", (_req, res) => {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.is_system, f.created_at, COUNT(g.id) AS game_count
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

// lists games, optionally filtered by folder.
gamesRouter.get("/", (req, res) => {
  const db = getDb();
  const folderId = req.query.folderId ? Number(req.query.folderId) : null;

  const rows = folderId
    ? (db
        .prepare(`SELECT * FROM games WHERE folder_id = ? ORDER BY id DESC`)
        .all(folderId) as GameRow[])
    : (db.prepare(`SELECT * FROM games ORDER BY id DESC`).all() as GameRow[]);

  res.json({ games: rows.map(mapGame) });
});

// loads one game by id.
gamesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid game id" });
    return;
  }

  const db = getDb();
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as GameRow | undefined;

  if (!row) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json({ game: mapGame(row) });
});

// inserts a game record into the chosen folder.
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
    .prepare(`SELECT id, is_system FROM game_folders WHERE id = ?`)
    .get(folderId) as { id: number; is_system: number } | undefined;

  if (!folder) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  // system folder only accepts platform-played games.
  if (folder.is_system && source !== "platform") {
    res
      .status(403)
      .json({ error: "This folder only accepts games played on the platform" });
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

  res.status(201).json({ gameId: Number(info.lastInsertRowid) });
});

// moves a game into a different folder.
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

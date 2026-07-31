import { Router } from "express";

import { getDb } from "../db/index.js";

interface TagRow {
  id: number;
  name: string;
  is_system: number;
  created_at: string;
}

export const tagsRouter = Router();

// lists every tag with the number of games it is currently applied to.
// system tags sort first, then user tags alphabetically.
tagsRouter.get("/", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.is_system, t.created_at,
              (SELECT COUNT(*) FROM game_tags gt
               JOIN games g ON g.id = gt.game_id
               WHERE gt.tag_id = t.id AND g.deleted_at IS NULL) AS game_count
       FROM tags t
       ORDER BY t.is_system DESC, t.name ASC`,
    )
    .all() as Array<TagRow & { game_count: number }>;

  res.json({
    tags: rows.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: Boolean(r.is_system),
      createdAt: r.created_at,
      gameCount: Number(r.game_count ?? 0),
    })),
  });
});

// creates a new user tag. name must be 1-40 chars after trim and must not
// collide (case-insensitively) with an existing tag.
tagsRouter.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 1 || name.length > 40) {
    res.status(400).json({ error: "Tag name must be 1-40 characters" });
    return;
  }

  const db = getDb();
  try {
    const info = db
      .prepare(`INSERT INTO tags (name, is_system) VALUES (?, 0)`)
      .run(name);
    const id = Number(info.lastInsertRowid);
    res.status(201).json({
      tag: { id, name, isSystem: false, gameCount: 0 },
    });
  } catch {
    res.status(409).json({ error: "Tag name already exists" });
  }
});

// deletes a user tag. system tags are protected. cascade-clears game_tags
// rows via the foreign key.
tagsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid tag id" });
    return;
  }

  const db = getDb();
  const tag = db
    .prepare(`SELECT id, is_system FROM tags WHERE id = ?`)
    .get(id) as { id: number; is_system: number } | undefined;
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  if (tag.is_system) {
    res.status(403).json({ error: "System tags cannot be deleted" });
    return;
  }

  db.prepare(`DELETE FROM tags WHERE id = ?`).run(id);
  res.json({ ok: true });
});

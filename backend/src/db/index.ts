import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, "../../data");
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "chess.sqlite");

const PLATFORM_FOLDER = "On Platform Games";
const LEGACY_OTB_FOLDER = "Over the board games";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    migrate(db);
  }
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS game_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL REFERENCES game_folders(id) ON DELETE RESTRICT,
      mode TEXT NOT NULL,
      white_name TEXT NOT NULL,
      black_name TEXT NOT NULL,
      result TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'platform',
      ucis_json TEXT NOT NULL,
      pretty_moves_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_games_folder ON games(folder_id);
    CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
  `);

  // idempotent column add for older databases.
  try {
    database.exec(
      `ALTER TABLE game_folders ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`,
    );
  } catch {
    // column already exists
  }

  // seed the platform folder and lock it as system.
  database
    .prepare(`INSERT OR IGNORE INTO game_folders (name, is_system) VALUES (?, 1)`)
    .run(PLATFORM_FOLDER);
  database
    .prepare(`UPDATE game_folders SET is_system = 1 WHERE name = ?`)
    .run(PLATFORM_FOLDER);

  // remove the legacy default folder if it was auto-created and is empty.
  const legacy = database
    .prepare(`SELECT id FROM game_folders WHERE name = ?`)
    .get(LEGACY_OTB_FOLDER) as { id: number } | undefined;
  if (legacy) {
    const usage = database
      .prepare(`SELECT COUNT(*) AS n FROM games WHERE folder_id = ?`)
      .get(legacy.id) as { n: number };
    if (usage.n === 0) {
      database.prepare(`DELETE FROM game_folders WHERE id = ?`).run(legacy.id);
    }
  }
}

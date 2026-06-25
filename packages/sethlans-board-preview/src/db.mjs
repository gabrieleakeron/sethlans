import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DB_PATH = fileURLToPath(new URL("../data/board.db", import.meta.url));
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// DELETE (default) invece di WAL: nessun file -wal/-shm collaterale, il .db committato
// in git riflette sempre lo stato corrente senza bisogno di checkpoint manuali.
db.exec("PRAGMA journal_mode = DELETE;");
// Non persiste nel file: va impostato ad ogni apertura per avere CASCADE/SET NULL.
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'internal',
  jira_key TEXT NOT NULL DEFAULT '',
  md TEXT NOT NULL DEFAULT '',
  md_updated_at TEXT,
  config TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS epics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  md TEXT NOT NULL DEFAULT '',
  md_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_task TEXT NOT NULL DEFAULT 'Inattivo',
  status TEXT NOT NULL DEFAULT 'idle',
  tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  phase TEXT NOT NULL DEFAULT 'analysis',
  epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  md TEXT NOT NULL DEFAULT '',
  md_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  md TEXT NOT NULL DEFAULT '',
  md_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'general',
  kind TEXT NOT NULL DEFAULT 'kb',
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  md TEXT NOT NULL DEFAULT '',
  md_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mockup_comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  mockup_index INTEGER NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at TEXT NOT NULL
);
`);

export function nowIso() {
  return new Date().toISOString();
}

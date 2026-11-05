import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { BOARD_SCHEMA } from './board/schema.js';
import { INTAKE_SCHEMA } from './intake/schema.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
  duties_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS residents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, raw_text TEXT NOT NULL, source TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
  analysis_json TEXT, analyzer TEXT, model TEXT, error TEXT, usage_json TEXT
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, action_required TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'medium',
  categories_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_staff ON deliveries(staff_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_message ON deliveries(message_id);
CREATE TABLE IF NOT EXISTS ack_events (
  id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  acked_at TEXT NOT NULL, client TEXT NOT NULL
);
`;

/** SQLite を開いてテーブルを作成する。dbPath が ':memory:' 以外なら親ディレクトリも作る。 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec(BOARD_SCHEMA);
  db.exec(INTAKE_SCHEMA);
  return db;
}

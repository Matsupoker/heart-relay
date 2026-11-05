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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
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

// v2: 200名台帳の列（docs/api.md Resident）。v1 の residents(id,name,notes) は migrate で作り直す
const RESIDENTS_V2 = `
CREATE TABLE IF NOT EXISTS residents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kana TEXT NOT NULL DEFAULT '', sei TEXT NOT NULL DEFAULT '', mei TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '', birth_date TEXT NOT NULL DEFAULT '',
  service_status TEXT NOT NULL DEFAULT '', weekly_pattern_json TEXT NOT NULL DEFAULT '[]',
  transport_route TEXT NOT NULL DEFAULT '', transport_note TEXT NOT NULL DEFAULT '',
  mobility TEXT NOT NULL DEFAULT '', residence TEXT NOT NULL DEFAULT '',
  care_manager TEXT NOT NULL DEFAULT '', office TEXT NOT NULL DEFAULT '',
  staff_id TEXT,
  attendance_date TEXT NOT NULL DEFAULT '', attendance_status TEXT NOT NULL DEFAULT '対象外',
  attendance_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
`;

export const SCHEMA_VERSION = 2;

// 既存テーブルへ後から足す列（PRAGMA table_info で存在確認してから ALTER）
const ADDED_COLUMNS = {
  messages: [['resident_id', 'TEXT'], ['match_json', 'TEXT']],
  staff: [['ledger_staff_id', 'TEXT'], ['transport_routes_json', "TEXT NOT NULL DEFAULT '[]'"]],
};

function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

/**
 * v1 → v2 の移行。messages / deliveries / ack_events / staff の既存行は保持する。
 * residents は v1 の8名簡易シードなので DROP して v2 の列で作り直す（台帳の投入は seed 側）。
 */
function migrate(db) {
  const version = Number(getMeta(db, 'schema_version') || 1);
  db.exec('BEGIN');
  try {
    for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
      const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const [name, type] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    if (version < 2) {
      db.exec('DROP TABLE IF EXISTS residents');
      setMeta(db, 'schema_version', SCHEMA_VERSION);
    }
    db.exec(RESIDENTS_V2);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** SQLite を開いてテーブルを作成する。dbPath が ':memory:' 以外なら親ディレクトリも作る。 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec(BOARD_SCHEMA);
  db.exec(INTAKE_SCHEMA);
  migrate(db);
  return db;
}

// 法人内複数事業所（Issue #2）: 事業所と事業所間連絡（人間主導）。契約: docs/plan/Issue2_法人内連絡_設計_2026-11-07.md
export const OFFICE_SCHEMA = `
CREATE TABLE IF NOT EXISTS offices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS office_messages (
  id TEXT PRIMARY KEY, from_office_id TEXT NOT NULL, to_office_id TEXT NOT NULL,
  source_message_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  acknowledged_at TEXT, acknowledged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_office_messages_to ON office_messages(to_office_id, created_at);
CREATE INDEX IF NOT EXISTS idx_office_messages_from ON office_messages(from_office_id, created_at);
`;
export const DEFAULT_OFFICE_ID = 'A';

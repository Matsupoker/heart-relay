// 取り込みファイル（契約: docs/api.md Attachment）
export const INTAKE_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  kind TEXT NOT NULL, extractor TEXT NOT NULL, extracted_text TEXT NOT NULL DEFAULT '',
  warnings_json TEXT NOT NULL DEFAULT '[]', stored_path TEXT NOT NULL,
  created_at TEXT NOT NULL, message_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
`;

// 共有ボード投稿テーブル（契約: docs/api.md BoardPost）
export const BOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS board_posts (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'medium', categories_json TEXT NOT NULL DEFAULT '[]',
  resident_name TEXT,
  created_at TEXT NOT NULL, until TEXT, archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_board_posts_active ON board_posts(archived_at, created_at);
`;

// ファイル取り込み API（POST /api/intake, GET /api/attachments/:id, GET /api/attachments/:id/file）— 実装は intake 作業系統
import express from 'express';
import { parseJson } from '../http.js';

export const toAttachment = (r, { withText = true } = {}) => ({
  id: r.id, filename: r.filename, mime: r.mime, size: r.size, kind: r.kind, extractor: r.extractor,
  ...(withText ? { extracted_text: r.extracted_text } : {}),
  warnings: parseJson(r.warnings_json, []), created_at: r.created_at, message_id: r.message_id ?? null,
});

/** routes.js（messages 系統）から呼ぶ: 連絡事項に添付を紐づける。存在しない id は無視せず 400 相当の Error を投げる */
export function attachToMessage(db, messageId, attachmentIds) {
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter((x) => typeof x === 'string') : [];
  for (const aid of ids) {
    const r = db.prepare('SELECT id FROM attachments WHERE id=?').get(aid);
    if (!r) { const e = new Error(`添付が見つかりません: ${aid}`); e.status = 400; e.code = 'unknown_attachment'; throw e; }
  }
  const upd = db.prepare('UPDATE attachments SET message_id=? WHERE id=?');
  for (const aid of ids) upd.run(messageId, aid);
}

export function listAttachments(db, messageId) {
  return db.prepare('SELECT * FROM attachments WHERE message_id=? ORDER BY created_at').all(messageId).map((r) => toAttachment(r, { withText: false }));
}

/** ctx = { db, env, analyzer, checkRate, dataDir } */
export function createIntakeRouter(ctx) {
  const router = express.Router();
  // TODO(intake): POST /intake（multipart）, GET /attachments/:id, GET /attachments/:id/file を実装する（docs/api.md 参照）
  return router;
}

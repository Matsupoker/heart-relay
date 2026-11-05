// ファイル取り込み API（POST /api/intake, GET /api/attachments/:id, GET /api/attachments/:id/file）— 実装は intake 作業系統
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, newId, nowIso, parseJson, wrap } from '../http.js';
import { LOCAL_EXTRACTORS } from './extract/index.js';
import { transcribe } from './transcribe.js';

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

const TYPES = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
  '.txt': { kind: 'txt', mime: 'text/plain' },
  '.docx': { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xls': { kind: 'xls', mime: 'application/vnd.ms-excel' },
};
const GENERIC_MIME = new Set(['', 'application/octet-stream']);
const UNSUPPORTED = '対応していないファイル形式です。画像(PNG/JPEG/WebP/GIF)、PDF、TXT、DOCX、XLSX、XLS に対応しています（HEIC・DOC・XLSM などは変換してからアップロードしてください）';

/** 拡張子で種別を決め、申告 MIME が明らかに食い違う場合は 415 */
function detectType(filename, claimedMime) {
  const t = TYPES[path.extname(filename).toLowerCase()];
  if (!t) throw new HttpError(415, UNSUPPORTED, 'unsupported_type');
  const m = String(claimedMime || '').toLowerCase().split(';')[0].trim();
  const family = t.kind === 'image' ? m.startsWith('image/') : m === t.mime;
  const okExtra = (t.kind === 'xls' && m === 'application/x-msexcel') || (t.kind === 'txt' && m.startsWith('text/'))
    || (t.kind === 'image' && m === 'image/jpg');
  if (!GENERIC_MIME.has(m) && !family && !okExtra) throw new HttpError(415, UNSUPPORTED, 'unsupported_type');
  return t;
}

/** ctx = { db, env, analyzer, checkRate, dataDir } */
export function createIntakeRouter(ctx) {
  const { db, env, dataDir } = ctx;
  const router = express.Router();
  const maxBytes = Number(env.INTAKE_MAX_BYTES) || 20 * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file');
  const uploadsDir = path.join(dataDir, 'uploads');

  const runUpload = (req, res) => new Promise((resolve, reject) => {
    upload(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(413, `ファイルが大きすぎます（上限 ${Math.floor(maxBytes / 1024 / 1024)}MB）`, 'file_too_large'));
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return reject(new HttpError(400, 'ファイルはフィールド名 file で1件だけ送ってください', 'bad_request'));
      reject(new HttpError(400, `アップロードを読み取れませんでした: ${err.message}`, 'bad_request'));
    });
  });

  router.post('/intake', wrap(async (req, res) => {
    await runUpload(req, res);
    const f = req.file;
    if (!f) throw new HttpError(400, 'ファイルが指定されていません（multipart のフィールド名は file）', 'bad_request');
    // multer は filename を latin1 として解釈するため UTF-8 に戻す
    const filename = path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8')) || 'file';
    const t = detectType(filename, f.mimetype);

    let out;
    if (t.kind === 'image' || t.kind === 'pdf') {
      out = await transcribe({ buffer: f.buffer, mime: t.mime, kind: t.kind, filename }, ctx);
    } else {
      try {
        const r = await LOCAL_EXTRACTORS[t.kind](f.buffer);
        out = { extractor: 'local', text: r.text, warnings: r.warnings, usage: null };
      } catch (e) {
        throw new HttpError(400, `ファイルの内容を読み取れませんでした（壊れているか、形式が正しくありません）: ${e.message}`, 'extract_failed');
      }
    }

    const id = newId();
    const ext = path.extname(filename).toLowerCase();
    fs.mkdirSync(uploadsDir, { recursive: true });
    const stored = path.join(uploadsDir, id + ext);
    fs.writeFileSync(stored, f.buffer);
    db.prepare(`INSERT INTO attachments (id, filename, mime, size, kind, extractor, extracted_text, warnings_json, stored_path, usage_json, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, filename, t.mime, f.size, t.kind, out.extractor, out.text,
      JSON.stringify(out.warnings), stored, out.usage ? JSON.stringify(out.usage) : null, nowIso());
    res.status(201).json(toAttachment(db.prepare('SELECT * FROM attachments WHERE id=?').get(id)));
  }));

  const getRow = (id) => {
    const r = db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
    if (!r) throw new HttpError(404, '添付が見つかりません', 'not_found');
    return r;
  };

  router.get('/attachments/:id', wrap(async (req, res) => { res.json(toAttachment(getRow(req.params.id))); }));

  router.get('/attachments/:id/file', wrap(async (req, res) => {
    const r = getRow(req.params.id);
    if (!fs.existsSync(r.stored_path)) throw new HttpError(404, '元ファイルが見つかりません', 'not_found');
    res.set({
      'Content-Type': r.mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(fs.readFileSync(r.stored_path));
  }));

  return router;
}

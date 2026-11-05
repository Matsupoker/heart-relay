// 共有ボード API（GET /api/board, POST /api/board/:id/archive）
import express from 'express';
import { HttpError, nowIso, wrap } from '../http.js';
import { toBoardPost } from './service.js';

const URGENCY_RANK = { high: 0, medium: 1, low: 2 };
const byCreatedDesc = (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);

/** until が未設定 or 未来なら有効（解釈できない値は有効扱い） */
const notExpired = (p, now) => {
  if (!p.until) return true;
  const t = Date.parse(p.until);
  return Number.isNaN(t) || t > now;
};

export function createBoardRouter({ db }) {
  const router = express.Router();

  router.get('/', wrap((req, res) => {
    if (req.query.all === '1') {
      const rows = db.prepare('SELECT * FROM board_posts ORDER BY created_at DESC LIMIT 100').all();
      return res.json(rows.map(toBoardPost));
    }
    const now = Date.now();
    const posts = db.prepare('SELECT * FROM board_posts WHERE archived_at IS NULL').all()
      .map(toBoardPost)
      .filter((p) => notExpired(p, now))
      .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1) || byCreatedDesc(a, b));
    res.json(posts);
  }));

  router.post('/:id/archive', wrap((req, res) => {
    const row = db.prepare('SELECT * FROM board_posts WHERE id=?').get(req.params.id);
    if (!row) throw new HttpError(404, '掲示が見つかりません', 'not_found');
    if (!row.archived_at) db.prepare('UPDATE board_posts SET archived_at=? WHERE id=?').run(nowIso(), row.id);
    res.json(toBoardPost(db.prepare('SELECT * FROM board_posts WHERE id=?').get(row.id)));
  }));

  return router;
}

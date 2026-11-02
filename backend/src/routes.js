import express from 'express';
import crypto from 'node:crypto';
import { log } from './log.js';
import { DEMO_MESSAGES } from './seedData.js';

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const j = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// ---------- DB 行 → API 型 ----------
const toStaff = (r) => ({ id: r.id, name: r.name, role: r.role, duties: j(r.duties_json, []), active: !!r.active });

const toDelivery = (r) => ({
  id: r.id, message_id: r.message_id, staff_id: r.staff_id,
  staff_name: r.staff_name, staff_role: r.staff_role,
  title: r.title, body: r.body, action_required: r.action_required, reason: r.reason,
  urgency: r.urgency, categories: j(r.categories_json, []),
  created_at: r.created_at, acknowledged_at: r.acknowledged_at,
});

const DELIVERY_SELECT = `SELECT d.*, s.name AS staff_name, s.role AS staff_role
  FROM deliveries d JOIN staff s ON s.id = d.staff_id`;

function toMessage(db, r) {
  const deliveries = db.prepare(`${DELIVERY_SELECT} WHERE d.message_id = ? ORDER BY d.created_at, s.id`).all(r.id).map(toDelivery);
  return {
    id: r.id, raw_text: r.raw_text, source: r.source, created_by: r.created_by, created_at: r.created_at,
    status: r.status, analyzer: r.analyzer, model: r.model, error: r.error,
    usage: j(r.usage_json), analysis: j(r.analysis_json), deliveries,
  };
}

/** 1分あたりの回数制限（メモリ内スライディングウィンドウ） */
function createRateLimiter(limitPerMin) {
  const hits = [];
  return () => {
    const t = Date.now();
    while (hits.length && t - hits[0] >= 60_000) hits.shift();
    if (hits.length >= limitPerMin) return false;
    hits.push(t);
    return true;
  };
}

export function createRouter({ db, analyzer, env }) {
  const router = express.Router();
  const allowAnalyze = createRateLimiter(Number(env.ANALYZE_RATE_LIMIT_PER_MIN) || 10);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  const rosterAndResidents = () => ({
    staff: db.prepare('SELECT * FROM staff ORDER BY id').all().map(toStaff),
    residents: db.prepare('SELECT * FROM residents ORDER BY id').all(),
  });
  const getMessageRow = (mid) => {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid);
    if (!row) throw new HttpError(404, '連絡事項が見つかりません', 'not_found');
    return row;
  };

  /** 解析を実行して messages を proposed / failed に更新する */
  async function runAnalysis(row) {
    const started = Date.now();
    try {
      const { staff, residents } = rosterAndResidents();
      const out = await analyzer.analyze({ rawText: row.raw_text, source: row.source, staff, residents });
      log.analyzer({ analyzer: analyzer.name, model: out.model, usage: out.usage, ms: Date.now() - started });
      db.prepare(`UPDATE messages SET status='proposed', analysis_json=?, analyzer=?, model=?, usage_json=?, error=NULL WHERE id=?`)
        .run(JSON.stringify(out.analysis), analyzer.name, out.model, JSON.stringify(out.usage), row.id);
    } catch (e) {
      log.error('解析失敗:', e.message);
      db.prepare(`UPDATE messages SET status='failed', analyzer=?, error=? WHERE id=?`).run(analyzer.name, String(e.message || e), row.id);
    }
    return toMessage(db, getMessageRow(row.id));
  }

  const checkRate = () => {
    if (!allowAnalyze()) throw new HttpError(429, '解析の呼び出しが多すぎます。しばらくしてからやり直してください', 'rate_limited');
  };

  router.get('/health', (req, res) => {
    res.json({ ok: true, analyzer: analyzer.name, model: analyzer.model || 'mock', time: now() });
  });

  router.get('/staff', (req, res) => {
    res.json(db.prepare('SELECT * FROM staff ORDER BY id').all().map(toStaff));
  });

  router.get('/residents', (req, res) => {
    res.json(db.prepare('SELECT * FROM residents ORDER BY id').all());
  });

  // デモ用の架空サンプル文（PC画面のクイック挿入ボタン用）
  router.get('/demo-messages', (req, res) => {
    res.json(DEMO_MESSAGES.map((text) => ({ label: text.slice(0, 10), raw_text: text })));
  });

  router.get('/messages', (req, res) => {
    const rows = db.prepare('SELECT * FROM messages ORDER BY created_at DESC, rowid DESC').all();
    res.json(rows.map((r) => toMessage(db, r)));
  });

  router.post('/messages', wrap(async (req, res) => {
    const { raw_text, source, created_by } = req.body || {};
    if (typeof raw_text !== 'string' || !raw_text.trim()) throw new HttpError(400, 'raw_text は必須です', 'bad_request');
    if (raw_text.length > 5000) throw new HttpError(400, 'raw_text は5000文字以内にしてください', 'bad_request');
    checkRate();
    const mid = id();
    db.prepare(`INSERT INTO messages (id,raw_text,source,created_by,created_at,status) VALUES (?,?,?,?,?, 'analyzing')`)
      .run(mid, raw_text.trim(), typeof source === 'string' && source ? source : '手入力',
        typeof created_by === 'string' && created_by ? created_by : 'pc', now());
    res.json(await runAnalysis(getMessageRow(mid)));
  }));

  router.get('/messages/:id', (req, res) => {
    res.json(toMessage(db, getMessageRow(req.params.id)));
  });

  router.post('/messages/:id/reanalyze', wrap(async (req, res) => {
    const row = getMessageRow(req.params.id);
    if (row.status === 'sent') throw new HttpError(400, '配信済みの連絡事項は再解析できません', 'already_sent');
    if (row.status === 'analyzing') throw new HttpError(400, '解析中です', 'analyzing');
    checkRate();
    db.prepare(`UPDATE messages SET status='analyzing', error=NULL WHERE id=?`).run(row.id);
    res.json(await runAnalysis(row));
  }));

  router.post('/messages/:id/send', (req, res) => {
    const row = getMessageRow(req.params.id);
    if (row.status !== 'proposed') {
      throw new HttpError(400, row.status === 'sent' ? '既に配信済みです' : '解析結果が未確定のため配信できません', row.status === 'sent' ? 'already_sent' : 'bad_status');
    }
    const recipients = req.body?.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) throw new HttpError(400, 'recipients は1件以上必要です', 'bad_request');
    const known = new Set(db.prepare('SELECT id FROM staff').all().map((s) => s.id));
    const seen = new Set();
    for (const r of recipients) {
      if (!r || !known.has(r.staff_id)) throw new HttpError(400, `存在しない職員IDです: ${r?.staff_id}`, 'unknown_staff');
      if (seen.has(r.staff_id)) throw new HttpError(400, `職員IDが重複しています: ${r.staff_id}`, 'duplicate_staff');
      seen.add(r.staff_id);
      if (typeof r.title !== 'string' || !r.title.trim() || typeof r.body !== 'string') {
        throw new HttpError(400, `title と body は必須です: ${r.staff_id}`, 'bad_request');
      }
    }
    const analysis = j(row.analysis_json, {});
    const ins = db.prepare(`INSERT INTO deliveries
      (id,message_id,staff_id,title,body,action_required,reason,urgency,categories_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const t = now();
    db.exec('BEGIN');
    try {
      for (const r of recipients) {
        ins.run(id(), row.id, r.staff_id, r.title, r.body, String(r.action_required ?? ''), String(r.reason ?? ''),
          analysis.urgency || 'medium', JSON.stringify(analysis.categories || []), t);
      }
      db.prepare(`UPDATE messages SET status='sent' WHERE id=?`).run(row.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json(toMessage(db, getMessageRow(row.id)));
  });

  router.get('/staff/:id/deliveries', (req, res) => {
    if (!db.prepare('SELECT 1 FROM staff WHERE id=?').get(req.params.id)) throw new HttpError(404, '職員が見つかりません', 'not_found');
    const since = req.query.since;
    if (since !== undefined && Number.isNaN(Date.parse(since))) throw new HttpError(400, 'since はISO形式で指定してください', 'bad_request');
    // since 以降に作成 or 確認されたものを返す（確認状況の差分も拾える）
    const rows = since
      ? db.prepare(`${DELIVERY_SELECT} WHERE d.staff_id=? AND (d.created_at > ? OR d.acknowledged_at > ?) ORDER BY d.created_at DESC, d.rowid DESC`).all(req.params.id, since, since)
      : db.prepare(`${DELIVERY_SELECT} WHERE d.staff_id=? ORDER BY d.created_at DESC, d.rowid DESC`).all(req.params.id);
    res.json(rows.map(toDelivery));
  });

  router.post('/deliveries/:id/ack', (req, res) => {
    const d = db.prepare(`${DELIVERY_SELECT} WHERE d.id=?`).get(req.params.id);
    if (!d) throw new HttpError(404, '配信が見つかりません', 'not_found');
    const staffId = req.get('X-Staff-Id');
    if (!staffId) throw new HttpError(403, 'X-Staff-Id ヘッダが必要です', 'forbidden');
    if (staffId !== d.staff_id) throw new HttpError(403, '配信先本人のみ確認できます', 'forbidden');
    const client = req.body?.client === 'web' ? 'web' : 'android';
    if (!d.acknowledged_at) { // 冪等：2回目以降は最初の acknowledged_at を保つ
      const t = now();
      db.prepare('UPDATE deliveries SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL').run(t, d.id);
      db.prepare('INSERT INTO ack_events (id,delivery_id,staff_id,acked_at,client) VALUES (?,?,?,?,?)').run(id(), d.id, staffId, t, client);
    }
    res.json(toDelivery(db.prepare(`${DELIVERY_SELECT} WHERE d.id=?`).get(d.id)));
  });

  router.get('/stats', (req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    const deliveries = n('SELECT COUNT(*) AS n FROM deliveries');
    const acked = n('SELECT COUNT(*) AS n FROM deliveries WHERE acknowledged_at IS NOT NULL');
    res.json({ messages: n('SELECT COUNT(*) AS n FROM messages'), deliveries, acked, unacked: deliveries - acked });
  });

  router.use((req, res) => res.status(404).json({ error: 'エンドポイントが見つかりません', code: 'not_found' }));

  // エラー形式 { error, code }
  router.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON が不正です', code: 'bad_json' });
    if (err.type === 'entity.too.large') return res.status(400).json({ error: 'リクエストが大きすぎます', code: 'too_large' });
    log.error(err);
    res.status(500).json({ error: 'サーバー内部エラー', code: 'internal' });
  });

  return router;
}

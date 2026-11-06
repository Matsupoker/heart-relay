import express from 'express';
import path from 'node:path';
import { log } from './log.js';
import { DEMO_SAMPLES } from './seedData.js';
import { HttpError, newId as id, nowIso as now, parseJson as j } from './http.js';
import { createBoardRouter } from './board/router.js';
import { createIntakeRouter, attachToMessage, listAttachments } from './intake/router.js';
import { createOfficeRouter } from './office/router.js';
import { insertBoardPost, getBoardPostByMessage } from './board/service.js';
import { getResident, listResidents } from './ledger/resident.js';
import { matchResidents, normalizeText, toKatakana } from './ledger/match.js';
import { readLedger } from './ledger/load.js';

// ---------- DB 行 → API 型 ----------
const toStaff = (r) => ({
  id: r.id, name: r.name, role: r.role, duties: j(r.duties_json, []), active: !!r.active,
  ledger_staff_id: r.ledger_staff_id ?? null, transport_routes: j(r.transport_routes_json, []),
});

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
    usage: j(r.usage_json),
    resident_id: r.resident_id ?? null,
    resident: getResident(db, r.resident_id),
    resident_match: j(r.match_json),
    attachments: listAttachments(db, r.id),
    analysis: j(r.analysis_json), deliveries,
    board_post: getBoardPostByMessage(db, r.id),
  };
}

/** 掲示案（BoardPostProposal）の検証。不正なら HttpError */
function validateBoardPost(bp) {
  if (bp == null) return null;
  if (typeof bp !== 'object' || Array.isArray(bp)) throw new HttpError(400, 'board_post の形式が不正です', 'bad_request');
  if (typeof bp.title !== 'string' || !bp.title.trim() || typeof bp.body !== 'string' || !bp.body.trim()) {
    throw new HttpError(400, 'board_post の title と body は必須です', 'bad_request');
  }
  const until = bp.until ?? null;
  if (until !== null && (typeof until !== 'string' || Number.isNaN(Date.parse(until)))) {
    throw new HttpError(400, 'board_post.until はISO形式の日時か null にしてください', 'bad_request');
  }
  return { title: bp.title.trim(), body: bp.body.trim(), until };
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

  /** 解析に渡す職員名簿（担当利用者数＝利用中の担当人数を付ける） */
  const rosterForAnalysis = () => {
    const counts = new Map(db.prepare(`SELECT staff_id, COUNT(*) AS n FROM residents
      WHERE staff_id IS NOT NULL AND service_status = '利用中' GROUP BY staff_id`).all().map((x) => [x.staff_id, x.n]));
    return db.prepare('SELECT * FROM staff ORDER BY id').all().map(toStaff)
      .map((st) => ({ ...st, assigned_residents: counts.get(st.id) ?? 0 }));
  };
  // 照合時に「利用者ではない人」として除外する氏名（職員・ケアマネ）
  const nonResidentNames = () => [
    ...db.prepare('SELECT name FROM staff').all().map((x) => x.name),
    ...readLedger().careManagerNames,
  ];
  // 照合用の利用者一覧（台帳は起動中に変わらないため1回だけ読む）
  let residentsForMatch = null;
  const matchText = (text) => {
    residentsForMatch ??= listResidents(db);
    return matchResidents(text, residentsForMatch, { excludeNames: nonResidentNames() });
  };
  /** resident_id 指定の解釈: undefined=未指定、null / "" = 利用者に関係しない、文字列=台帳ID（存在しなければ 400） */
  const parseResidentId = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !getResident(db, v)) throw new HttpError(400, `存在しない利用者IDです: ${v}`, 'unknown_resident');
    return v;
  };
  const getMessageRow = (mid) => {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid);
    if (!row) throw new HttpError(404, '連絡事項が見つかりません', 'not_found');
    return row;
  };

  /** 解析を実行して messages を proposed / failed に更新する */
  async function runAnalysis(row) {
    const started = Date.now();
    try {
      const staff = rosterForAnalysis();
      const resident = getResident(db, row.resident_id);
      const out = await analyzer.analyze({ rawText: row.raw_text, source: row.source, staff, resident });
      log.analyzer({ analyzer: analyzer.name, model: out.model, usage: out.usage, ms: Date.now() - started });
      out.analysis.resident_id = resident?.id ?? null; // Claude の出力ではなく確定値を正とする
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

  // v2 サブルータ（別作業系統が実装。ファイルを分けて並行開発の競合を避ける）
  const dataDir = path.dirname(path.resolve(env.DB_PATH || './data/heart-relay.db'));
  router.use('/board', createBoardRouter({ db, env }));
  router.use(createOfficeRouter({ db, env }));
  router.use(createIntakeRouter({ db, env, analyzer, checkRate, dataDir }));

  router.get('/health', (req, res) => {
    const residents = db.prepare('SELECT COUNT(*) AS n FROM residents').get().n;
    res.json({ ok: true, analyzer: analyzer.name, model: analyzer.model || 'mock', time: now(), residents });
  });

  router.get('/staff', (req, res) => {
    res.json(db.prepare('SELECT * FROM staff ORDER BY id').all().map(toStaff));
  });

  // 台帳検索（氏名・カナ・ID の部分一致。空白・全角半角・ひらがな/カタカナの違いは無視）
  router.get('/residents', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rawLimit = req.query.limit;
    let limit = rawLimit === undefined ? (q ? 20 : Infinity) : Number(rawLimit);
    if (!Number.isInteger(limit) && limit !== Infinity) throw new HttpError(400, 'limit は整数で指定してください', 'bad_request');
    limit = Math.max(1, Math.min(limit, 500));
    let list = listResidents(db);
    if (q) {
      const nq = normalizeText(q);
      const kq = toKatakana(nq);
      list = list.filter((r) => r.id.includes(nq) || normalizeText(r.name).includes(nq)
        || toKatakana(normalizeText(r.kana)).includes(kq));
    }
    res.json(list.slice(0, limit));
  });

  router.get('/residents/:id', (req, res) => {
    const r = getResident(db, req.params.id);
    if (!r) throw new HttpError(404, '利用者が見つかりません', 'not_found');
    res.json(r);
  });

  // 決定的照合のみ（Claude は呼ばない）
  router.post('/residents/match', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string') throw new HttpError(400, 'text は必須です', 'bad_request');
    res.json(matchText(text));
  });

  // デモ用の架空サンプル文（PC画面のクイック挿入ボタン用）
  router.get('/demo-messages', (req, res) => {
    res.json(DEMO_SAMPLES.map((d) => ({ label: d.label, raw_text: d.raw_text })));
  });

  router.get('/messages', (req, res) => {
    const rows = db.prepare('SELECT * FROM messages ORDER BY created_at DESC, rowid DESC').all();
    res.json(rows.map((r) => toMessage(db, r)));
  });

  router.post('/messages', wrap(async (req, res) => {
    const { raw_text, source, created_by, attachment_ids } = req.body || {};
    if (typeof raw_text !== 'string' || !raw_text.trim()) throw new HttpError(400, 'raw_text は必須です', 'bad_request');
    if (raw_text.length > 5000) throw new HttpError(400, 'raw_text は5000文字以内にしてください', 'bad_request');
    if (attachment_ids !== undefined && (!Array.isArray(attachment_ids) || attachment_ids.some((x) => typeof x !== 'string'))) {
      throw new HttpError(400, 'attachment_ids は文字列の配列にしてください', 'bad_request');
    }
    const text = raw_text.trim();
    // 対象利用者: 明示されていれば照合しない。未指定なら決定的照合
    let residentId = parseResidentId(req.body?.resident_id);
    let match = null;
    if (residentId === undefined) {
      match = matchText(text);
      residentId = match.status === 'confirmed' ? match.resident_id : null;
    }
    const needsResident = match?.status === 'ambiguous';
    if (!needsResident) checkRate(); // 候補選択待ちは Claude を呼ばないので回数に数えない
    const mid = id();
    db.exec('BEGIN');
    try {
      db.prepare(`INSERT INTO messages (id,raw_text,source,created_by,created_at,status,resident_id,match_json) VALUES (?,?,?,?,?,?,?,?)`)
        .run(mid, text, typeof source === 'string' && source ? source : '手入力',
          typeof created_by === 'string' && created_by ? created_by : 'pc', now(),
          needsResident ? 'needs_resident' : 'analyzing', residentId, match ? JSON.stringify(match) : null);
      if (attachment_ids?.length) attachToMessage(db, mid, attachment_ids);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (needsResident) return res.json(toMessage(db, getMessageRow(mid)));
    res.json(await runAnalysis(getMessageRow(mid)));
  }));

  // 対象利用者を確定して解析（needs_resident / proposed / failed のとき）
  router.post('/messages/:id/resident', wrap(async (req, res) => {
    const row = getMessageRow(req.params.id);
    if (!['needs_resident', 'proposed', 'failed'].includes(row.status)) {
      throw new HttpError(400, row.status === 'sent' ? '配信済みの連絡事項は変更できません' : '解析中です', row.status === 'sent' ? 'already_sent' : 'bad_status');
    }
    if (!req.body || !('resident_id' in req.body)) throw new HttpError(400, 'resident_id は必須です（関係しない場合は null）', 'bad_request');
    const residentId = parseResidentId(req.body.resident_id) ?? null;
    checkRate();
    db.prepare(`UPDATE messages SET resident_id=?, status='analyzing', error=NULL WHERE id=?`).run(residentId, row.id);
    res.json(await runAnalysis(getMessageRow(row.id)));
  }));

  router.get('/messages/:id', (req, res) => {
    res.json(toMessage(db, getMessageRow(req.params.id)));
  });

  router.post('/messages/:id/reanalyze', wrap(async (req, res) => {
    const row = getMessageRow(req.params.id);
    if (row.status === 'sent') throw new HttpError(400, '配信済みの連絡事項は再解析できません', 'already_sent');
    if (row.status === 'analyzing') throw new HttpError(400, '解析中です', 'analyzing');
    if (row.status === 'needs_resident') throw new HttpError(400, '先に対象利用者を選んでください', 'needs_resident');
    checkRate();
    db.prepare(`UPDATE messages SET status='analyzing', error=NULL WHERE id=?`).run(row.id);
    res.json(await runAnalysis(row));
  }));

  router.post('/messages/:id/send', (req, res) => {
    const row = getMessageRow(req.params.id);
    if (row.status !== 'proposed') {
      throw new HttpError(400, row.status === 'sent' ? '既に配信済みです' : '解析結果が未確定のため配信できません', row.status === 'sent' ? 'already_sent' : 'bad_status');
    }
    const recipients = req.body?.recipients ?? [];
    if (!Array.isArray(recipients)) throw new HttpError(400, 'recipients は配列にしてください', 'bad_request');
    const boardPost = validateBoardPost(req.body?.board_post);
    if (recipients.length === 0 && !boardPost) throw new HttpError(400, 'recipients か board_post のどちらかが必要です', 'bad_request');
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
    const urgency = analysis.urgency || 'medium';
    const categories = analysis.categories || [];
    const ins = db.prepare(`INSERT INTO deliveries
      (id,message_id,staff_id,title,body,action_required,reason,urgency,categories_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const t = now();
    db.exec('BEGIN');
    try {
      for (const r of recipients) {
        ins.run(id(), row.id, r.staff_id, r.title, r.body, String(r.action_required ?? ''), String(r.reason ?? ''),
          urgency, JSON.stringify(categories), t);
      }
      if (boardPost) {
        insertBoardPost(db, {
          message_id: row.id, ...boardPost, urgency, categories,
          resident_name: getResident(db, row.resident_id)?.name ?? null,
        });
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
    res.json({
      messages: n('SELECT COUNT(*) AS n FROM messages'), deliveries, acked, unacked: deliveries - acked,
      board_posts: n('SELECT COUNT(*) AS n FROM board_posts WHERE archived_at IS NULL'),
    });
  });

  router.use((req, res) => res.status(404).json({ error: 'エンドポイントが見つかりません', code: 'not_found' }));

  // エラー形式 { error, code }
  router.use((err, req, res, next) => {
    if (err instanceof HttpError || (err && Number.isInteger(err.status) && err.status < 500)) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON が不正です', code: 'bad_json' });
    if (err.type === 'entity.too.large') return res.status(400).json({ error: 'リクエストが大きすぎます', code: 'too_large' });
    log.error(err);
    res.status(500).json({ error: 'サーバー内部エラー', code: 'internal' });
  });

  return router;
}

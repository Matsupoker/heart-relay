// 事業所 API（Issue #2）: GET /api/offices, GET/POST /api/office-messages, POST /api/office-messages/draft,
// POST /api/office-messages/:id/ack。契約: docs/plan/Issue2_法人内連絡_設計_2026-11-07.md §2
// 事業所間連絡は人間主導: 作成は POST /api/office-messages（人の明示操作）のみ。/draft は案を返すだけ。
import express from 'express';
import { HttpError, wrap } from '../http.js';
import {
  listOffices, listOfficeMessages, getOfficeMessage, createOfficeMessage, ackOfficeMessage,
  resolveOfficeId, requireOfficeId,
} from './service.js';
import { draftOfficeMessage } from './draft.js';

const reqStr = (v, field, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} は必須です`, 'bad_request');
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} は${max}文字以内にしてください`, 'bad_request');
  return s;
};

export function createOfficeRouter({ db, env = {}, checkRate = () => {} }) {
  const router = express.Router();

  router.get('/offices', (req, res) => res.json(listOffices(db)));

  router.get('/office-messages', (req, res) => {
    res.json(listOfficeMessages(db, resolveOfficeId(db, req.query.office)));
  });

  // AI 文面支援: 件名・本文の案を返すだけ（office_messages は作らない）
  router.post('/office-messages/draft', wrap(async (req, res) => {
    res.json(await draftOfficeMessage(req.body, { db, env, checkRate }));
  }));

  // 人間の明示操作による送信（office_messages を作る唯一の経路）
  router.post('/office-messages', (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const from = requireOfficeId(db, b.from_office_id, 'from_office_id');
    const to = requireOfficeId(db, b.to_office_id, 'to_office_id');
    if (from === to) throw new HttpError(400, '送信元と送信先に同じ事業所は指定できません', 'same_office');
    const title = reqStr(b.title, 'title', 200);
    const body = reqStr(b.body, 'body', 5000);
    if (b.created_by !== undefined && b.created_by !== null && typeof b.created_by !== 'string') {
      throw new HttpError(400, 'created_by は文字列にしてください', 'bad_request');
    }
    let sourceId = null;
    if (b.source_message_id !== undefined && b.source_message_id !== null && b.source_message_id !== '') {
      const sid = b.source_message_id;
      const row = typeof sid === 'string' ? db.prepare('SELECT office_id FROM messages WHERE id = ?').get(sid) : null;
      if (!row) throw new HttpError(400, `存在しない連絡事項です: ${sid}`, 'unknown_message');
      if (row.office_id !== from) throw new HttpError(400, '送信元事業所の連絡事項ではありません', 'office_mismatch');
      sourceId = sid;
    }
    res.json(createOfficeMessage(db, {
      from_office_id: from, to_office_id: to, source_message_id: sourceId, title, body,
      created_by: (b.created_by ?? '').trim().slice(0, 100),
    }));
  });

  // 受信側の確認（冪等）。office_id を付けた場合は受信事業所と一致すること
  router.post('/office-messages/:id/ack', (req, res) => {
    const m = getOfficeMessage(db, req.params.id);
    if (!m) throw new HttpError(404, '事業所間連絡が見つかりません', 'not_found');
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const staffName = reqStr(b.staff_name, 'staff_name', 100);
    if (b.office_id !== undefined && b.office_id !== m.to_office.id) {
      throw new HttpError(403, '受信した事業所のみ確認できます', 'forbidden');
    }
    res.json(ackOfficeMessage(db, m.id, staffName));
  });

  return router;
}

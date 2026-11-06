// 事業所と事業所間連絡（Issue #2）のデータ操作。
// 安全上の約束: office_messages への INSERT はこのファイルの createOfficeMessage() だけが行い、
// それを呼ぶのは POST /api/office-messages（office/router.js）だけ。解析・配信・ボード・/draft からは作らない。
import { HttpError, newId, nowIso } from '../http.js';
import { DEFAULT_OFFICE_ID } from './schema.js';

export const toOffice = (r) => (r ? { id: r.id, name: r.name, kind: r.kind } : null);

export function listOffices(db) {
  return db.prepare('SELECT * FROM offices ORDER BY id').all().map(toOffice);
}

export function getOffice(db, id) {
  return toOffice(db.prepare('SELECT * FROM offices WHERE id = ?').get(id));
}

/** 起動時に架空事業所を upsert する（seed から呼ぶ） */
export function upsertOffices(db, offices) {
  const up = db.prepare(`INSERT INTO offices (id,name,kind,created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind`);
  const t = nowIso();
  for (const o of offices) up.run(o.id, o.name, o.kind, t);
}

/**
 * 事業所 ID の解釈（クエリ・body 共通）。undefined / '' は既定 A。未知の ID は 400。
 * @returns {string} 存在する事業所 ID
 */
export function resolveOfficeId(db, v, field = 'office') {
  if (v === undefined || v === null || v === '') return DEFAULT_OFFICE_ID;
  if (typeof v !== 'string' || !getOffice(db, v)) throw new HttpError(400, `存在しない事業所です（${field}）: ${v}`, 'unknown_office');
  return v;
}

/** 明示が必須の事業所 ID（事業所間連絡の from / to）。未指定・未知は 400 */
export function requireOfficeId(db, v, field) {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `${field} は必須です`, 'bad_request');
  if (!getOffice(db, v)) throw new HttpError(400, `存在しない事業所です（${field}）: ${v}`, 'unknown_office');
  return v;
}

function toOfficeMessage(db, r) {
  return {
    id: r.id,
    from_office: getOffice(db, r.from_office_id),
    to_office: getOffice(db, r.to_office_id),
    source_message_id: r.source_message_id ?? null,
    title: r.title, body: r.body, created_by: r.created_by, created_at: r.created_at,
    acknowledged_at: r.acknowledged_at ?? null, acknowledged_by: r.acknowledged_by ?? null,
  };
}

export function getOfficeMessage(db, id) {
  const r = db.prepare('SELECT * FROM office_messages WHERE id = ?').get(id);
  return r ? toOfficeMessage(db, r) : null;
}

/** 受信（to = officeId）と送信（from = officeId）。どちらも新しい順 */
export function listOfficeMessages(db, officeId) {
  const q = (col) => db.prepare(`SELECT * FROM office_messages WHERE ${col} = ? ORDER BY created_at DESC, rowid DESC`)
    .all(officeId).map((r) => toOfficeMessage(db, r));
  return { inbox: q('to_office_id'), outbox: q('from_office_id') };
}

/**
 * 事業所間連絡を 1 件作る（入力は router 側で検証済み）。
 * office_messages への INSERT はコード全体でここだけ（test/office.test.js で確認）。
 */
export function createOfficeMessage(db, { from_office_id, to_office_id, source_message_id = null, title, body, created_by = '' }) {
  const id = newId();
  db.prepare(`INSERT INTO office_messages (id,from_office_id,to_office_id,source_message_id,title,body,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, from_office_id, to_office_id, source_message_id, title, body, created_by, nowIso());
  return getOfficeMessage(db, id);
}

/** 受信側の確認（冪等: 2回目以降は最初の確認日時・確認者を保つ） */
export function ackOfficeMessage(db, id, staffName) {
  db.prepare('UPDATE office_messages SET acknowledged_at=?, acknowledged_by=? WHERE id=? AND acknowledged_at IS NULL')
    .run(nowIso(), staffName, id);
  return getOfficeMessage(db, id);
}

// 200名台帳の取り込み・照合規則・v1→v2 マイグレーションのテスト（fixtures/ の架空データを使用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readLedger } from '../src/ledger/load.js';
import { matchResidents, normalizeText, extractIds } from '../src/ledger/match.js';
import { LEDGER_STAFF_MAP } from '../src/ledger/staffMap.js';
import { ageOn } from '../src/ledger/resident.js';
import { openDb } from '../src/db.js';
import { seedIfEmpty } from '../src/seed.js';
import { STAFF, DEMO_SAMPLES } from '../src/seedData.js';

const { rows, careManagerNames } = readLedger();
const byId = new Map(rows.map((r) => [r.id, r]));
const surname = (r) => r.name.split(' ')[0];

// フィクスチャから実際の同姓同名・姓重複・固有の姓を探す
const nameGroups = new Map();
const seiGroups = new Map();
for (const r of rows) {
  (nameGroups.get(r.name) || nameGroups.set(r.name, []).get(r.name)).push(r);
  (seiGroups.get(surname(r)) || seiGroups.set(surname(r), []).get(surname(r))).push(r);
}
const sameNamePair = [...nameGroups.values()].find((g) => g.length === 2);
const sharedSei = [...seiGroups.entries()].find(([, g]) => g.length >= 3);
const uniqueSeiPerson = [...seiGroups.values()].find((g) => g.length === 1)[0];
const uniqueFullButSharedSei = sharedSei[1].find((r) => nameGroups.get(r.name).length === 1);
const kanaBoundary = rows.find((r) => r.sei === '' && r.mei === '');

const match = (text) => matchResidents(text, rows, { excludeNames: [...careManagerNames, ...STAFF.map((s) => s.name)] });

test('台帳: 200名・4桁ID・担当職員は HEART RELAY の id に変換', () => {
  assert.equal(rows.length, 200);
  assert.ok(rows.every((r) => /^\d{4}$/.test(r.id)));
  const allowed = new Set(Object.values(LEDGER_STAFF_MAP));
  assert.ok(rows.every((r) => allowed.has(r.staff_id)));
  const counts = { 利用中: 0, 中止中: 0, 終了: 0 };
  for (const r of rows) counts[r.service_status]++;
  assert.deepEqual(counts, { 利用中: 150, 中止中: 30, 終了: 20 });
  // 2026-11-10（火）の予定34名: 出席31・欠席3
  assert.equal(rows.filter((r) => r.attendance_status === '出席').length, 31);
  assert.equal(rows.filter((r) => r.attendance_status === '欠席').length, 3);
  assert.ok(rows.every((r) => r.attendance_date === '2026-11-10'));
  const r1 = byId.get('0001');
  assert.equal(r1.name, '新田 洋子');
  assert.match(r1.notes, /^利用中 \/ 月水金 \/ 送迎コース4 \/ /);
});

test('年齢は基準日で満年齢', () => {
  assert.equal(ageOn('1957-12-05', '2026-11-05'), 68);
  assert.equal(ageOn('1957-11-05', '2026-11-05'), 69);
});

test('フィクスチャに照合テスト用のデータがある', () => {
  assert.ok(sameNamePair, '同姓同名ペア');
  assert.ok(sharedSei, '3名以上の同姓');
  assert.ok(uniqueSeiPerson && uniqueFullButSharedSei && kanaBoundary);
});

test('照合: ID 接頭・引用付き4桁は ID 一致として確定', () => {
  const [a] = sameNamePair;
  for (const text of [`ID:${a.id} の件`, `利用者${a.id}について`, `No.${a.id}`, `#${a.id} 送迎変更`, `「${a.id}」の方`, `"${a.id}"`]) {
    const m = match(text);
    assert.equal(m.status, 'confirmed', text);
    assert.equal(m.resident_id, a.id, text);
    assert.equal(m.candidates[0].score, 100);
  }
});

test('照合: 時刻・年・電話番号の4桁は ID と誤認しない', () => {
  assert.deepEqual(extractIds('2026年11月 1500に到着 電話 0120-0001'), []);
  assert.equal(match('0150 の便は1500発').status, 'none');
});

test('照合: 同姓同名の無い氏名完全一致は自動確定（同じ姓の他者は候補にしない）', () => {
  const r = uniqueFullButSharedSei;
  const m = match(`${r.name}様 本日の送迎は不要`);
  assert.equal(m.status, 'confirmed');
  assert.equal(m.resident_id, r.id);
  assert.deepEqual(m.candidates.map((c) => c.id), [r.id]);
  assert.equal(m.candidates[0].score, 90);
  assert.equal(m.candidates[0].same_name, false);
});

test('照合: 敬称・空白・全角半角・ひらがなのゆれを吸収', () => {
  const r = uniqueFullButSharedSei;
  const [sei, mei] = r.name.split(' ');
  for (const text of [`${sei}${mei}さん`, `${sei}　${mei} 様`, `${sei} ${mei}氏`, `${sei}${mei}さま`]) {
    assert.equal(match(text).resident_id, r.id, text);
  }
  // 半角カナ（濁点分離）・全角カナ・ひらがな
  const halfKana = r.kana;
  const fullKana = halfKana.normalize('NFKC');
  const hira = fullKana.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const text of [`${halfKana}様`, `${fullKana.replace(' ', '')}さん`, `${hira}さん`]) {
    const m = match(text);
    assert.equal(m.status, 'confirmed', text);
    assert.equal(m.resident_id, r.id, text);
    assert.equal(m.candidates[0].score, 85, text);
  }
  // 全角英数字の ID 接頭
  const id = r.id.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  assert.equal(match(`ＩＤ：${id}`).resident_id, r.id);
  assert.equal(normalizeText('ｻｶｲ　様'), 'サカイ');
});

test('照合: カナ境界未確定（sei/mei 空）の利用者も氏名・カナで一致', () => {
  assert.equal(match(`${kanaBoundary.name.replace(' ', '')}様`).resident_id, kanaBoundary.id);
  assert.equal(match(`${kanaBoundary.kana}様`).resident_id, kanaBoundary.id);
});

test('照合: 同姓同名は ambiguous、same_name フラグ付きで両名が候補', () => {
  const m = match(`${sameNamePair[0].name}さん 明日は欠席`);
  assert.equal(m.status, 'ambiguous');
  assert.equal(m.resident_id, null);
  assert.deepEqual(m.candidates.map((c) => c.id).sort(), sameNamePair.map((r) => r.id).sort());
  assert.ok(m.candidates.every((c) => c.same_name && c.score === 90));
  // ID が併記されていれば確定
  const withId = match(`${sameNamePair[1].name}さん（ID${sameNamePair[1].id}）`);
  assert.equal(withId.status, 'confirmed');
  assert.equal(withId.resident_id, sameNamePair[1].id);
});

test('照合: 姓のみは1名しかいなくても ambiguous、候補は score 降順・利用中優先・最大10件', () => {
  const one = match(`${surname(uniqueSeiPerson)}様のご家族から電話`);
  assert.equal(one.status, 'ambiguous');
  assert.deepEqual(one.candidates.map((c) => c.id), [uniqueSeiPerson.id]);
  assert.equal(one.candidates[0].score, 50);
  assert.equal(one.candidates[0].reason, `姓「${surname(uniqueSeiPerson)}」が一致`);

  const [sei, group] = sharedSei;
  const m = match(`${sei}様の入浴について`);
  assert.equal(m.status, 'ambiguous');
  assert.equal(m.candidates.length, Math.min(group.length, 10));
  const order = m.candidates.map((c) => (c.service_status === '利用中' ? 0 : 1));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '利用中が先');

  // 11件以上の候補は10件に切る（姓を複数並べる）
  const many = match([...seiGroups.keys()].slice(0, 6).map((s) => `${s}様`).join('、'));
  assert.equal(many.candidates.length, 10);
});

test('照合: 本文中に複数の別人が完全一致すれば ambiguous', () => {
  const a = uniqueFullButSharedSei;
  const b = rows.find((r) => r.id !== a.id && nameGroups.get(r.name).length === 1 && surname(r) !== surname(a));
  const m = match(`${a.name}様と${b.name}様は同じ便`);
  assert.equal(m.status, 'ambiguous');
  assert.deepEqual(m.candidates.map((c) => c.id).sort(), [a.id, b.id].sort());
  // ID と別人の氏名の併記も ambiguous
  assert.equal(match(`ID${a.id} ${b.name}様`).status, 'ambiguous');
});

test('照合: 該当なしは none、職員・ケアマネの氏名は利用者として拾わない', () => {
  assert.deepEqual(match('送迎車2号車は午前点検のため使用不可'), { status: 'none', resident_id: null, candidates: [] });
  // ケアマネの姓が利用者の姓と重なる場合でも、フルネームなら除外される
  const cm = careManagerNames.find((n) => seiGroups.has(n.split(' ')[0]));
  assert.ok(cm);
  assert.equal(match(`ケアマネの${cm}さんから連絡`).status, 'none');
});

test('デモ文は想定どおりに照合される', () => {
  for (const d of DEMO_SAMPLES) assert.equal(match(d.raw_text).status, d.expect, d.label);
});

test('マイグレーション: v1 の DB（residents 8名・messages あり）を壊さず v3 へ', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-mig-'));
  const dbPath = path.join(tmp, 'v1.db');
  try {
    // v1 のスキーマとデータを再現
    const v1 = new DatabaseSync(dbPath);
    v1.exec(`
      CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, duties_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE residents (id TEXT PRIMARY KEY, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '');
      CREATE TABLE messages (id TEXT PRIMARY KEY, raw_text TEXT NOT NULL, source TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, analysis_json TEXT, analyzer TEXT, model TEXT, error TEXT, usage_json TEXT);
      CREATE TABLE deliveries (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, staff_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, action_required TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'medium', categories_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, acknowledged_at TEXT);
      CREATE TABLE ack_events (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, staff_id TEXT NOT NULL, acked_at TEXT NOT NULL, client TEXT NOT NULL);
    `);
    v1.prepare("INSERT INTO staff VALUES ('s07','竹内 康介','運転手','[\"送迎(午前)\"]',0)").run();
    for (let i = 1; i <= 8; i++) v1.prepare('INSERT INTO residents VALUES (?,?,?)').run(`r0${i}`, `旧利用者${i}`, '');
    v1.prepare("INSERT INTO messages VALUES ('m1','旧連絡','手入力','pc','2026-11-03T00:00:00Z','sent','{}','mock','mock',NULL,NULL)").run();
    v1.prepare("INSERT INTO deliveries (id,message_id,staff_id,title,body,created_at,acknowledged_at) VALUES ('d1','m1','s07','t','b','2026-11-03T00:00:00Z','2026-11-03T00:01:00Z')").run();
    v1.close();

    const db = openDb(dbPath);
    seedIfEmpty(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM residents').get().n, 200);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '3');
    const m = db.prepare("SELECT * FROM messages WHERE id='m1'").get();
    assert.equal(m.office_id, 'A');
    assert.equal(m.raw_text, '旧連絡');
    assert.equal(m.resident_id, null);
    assert.ok('match_json' in m);
    assert.equal(db.prepare("SELECT acknowledged_at FROM deliveries WHERE id='d1'").get().acknowledged_at, '2026-11-03T00:01:00Z');
    const s07 = db.prepare("SELECT * FROM staff WHERE id='s07'").get();
    assert.equal(s07.transport_routes_json, '["1","2"]');
    assert.match(s07.duties_json, /コース1・2/);
    assert.equal(s07.active, 0, 'active は upsert で上書きしない');
    assert.equal(db.prepare("SELECT ledger_staff_id FROM staff WHERE id='s04'").get().ledger_staff_id, 'S0001');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM staff WHERE office_id='A'").get().n, 20);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff').get().n, 26, 'B・C の架空職員 各3名を追加');
    db.close();

    // 2回目の起動では residents を作り直さない（冪等）
    const db2 = openDb(dbPath);
    seedIfEmpty(db2);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM residents').get().n, 200);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
    db2.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #2 法人内複数事業所（スキーマ v3・事業所別の絞り込み・事業所間連絡・AI 文面支援）。すべて架空データ
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server.js';
import { BOARD_SCHEMA } from '../src/board/schema.js';
import { INTAKE_SCHEMA } from '../src/intake/schema.js';
import { DEMO_SAMPLES } from '../src/seedData.js';
import { draftOfficeMessage, DRAFT_SYSTEM_PROMPT } from '../src/office/draft.js';

const VISIT = DEMO_SAMPLES[0].raw_text; // 坂井 夏子様（台帳: 送迎コース2・担当 小林 直樹）
const VEHICLE = DEMO_SAMPLES[4].raw_text; // 個別＋ボード
const B_TEXT = '2階フロアの食事形態の見直しについて、来週の会議で検討します。看護師より。';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-office-'));
const servers = [];

async function start(name, env = {}) {
  const ctx = createApp({ dbPath: path.join(tmp, name + '.db'), env });
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push({ server, ctx });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  return { call, ctx };
}

let api, db;
const omCount = () => db.prepare('SELECT COUNT(*) AS n FROM office_messages').get().n;
before(async () => { ({ call: api, ctx: { db } } = await start('main', { ANALYZE_RATE_LIMIT_PER_MIN: '100' })); });
after(() => {
  for (const { server, ctx } of servers) { server.close(); ctx.close(); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- 移行 ----------
test('v2 の DB（messages・deliveries・board_posts あり）を壊さず v3 へ移行し、既存行は事業所 A', async () => {
  const dbPath = path.join(tmp, 'v2.db');
  const v2 = new DatabaseSync(dbPath);
  v2.exec(`
    CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, duties_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      ledger_staff_id TEXT, transport_routes_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, raw_text TEXT NOT NULL, source TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
      analysis_json TEXT, analyzer TEXT, model TEXT, error TEXT, usage_json TEXT, resident_id TEXT, match_json TEXT);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, staff_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      action_required TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'medium',
      categories_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, acknowledged_at TEXT);
    CREATE TABLE ack_events (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, staff_id TEXT NOT NULL, acked_at TEXT NOT NULL, client TEXT NOT NULL);
    INSERT INTO meta VALUES ('schema_version', '2');
  `);
  v2.exec(BOARD_SCHEMA);
  v2.exec(INTAKE_SCHEMA);
  v2.prepare("INSERT INTO staff (id,name,role,active) VALUES ('s07','竹内 康介','運転手',1)").run();
  for (const m of ['m1', 'm2']) {
    v2.prepare(`INSERT INTO messages (id,raw_text,source,created_by,created_at,status,analysis_json) VALUES (?,?,?,?,?,?,?)`)
      .run(m, `旧連絡${m}`, '手入力', 'pc', `2026-11-0${m.slice(1)}T00:00:00Z`, 'sent', '{"summary":"s"}');
  }
  v2.prepare("INSERT INTO deliveries (id,message_id,staff_id,title,body,created_at) VALUES ('d1','m1','s07','t','b','2026-11-01T00:00:00Z')").run();
  v2.prepare("INSERT INTO board_posts (id,message_id,title,body,created_at) VALUES ('p1','m2','旧掲示','b','2026-11-02T00:00:00Z')").run();
  v2.close();

  const { call, ctx } = await start('v2');
  const d = ctx.db;
  assert.equal(d.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '3');
  assert.deepEqual(d.prepare('SELECT DISTINCT office_id FROM messages').all().map((r) => r.office_id), ['A']);
  assert.equal(d.prepare("SELECT office_id FROM board_posts WHERE id='p1'").get().office_id, 'A');
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n, 1);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM staff').get().n, 26);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM staff WHERE office_id='A'").get().n, 20);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM residents').get().n, 200);
  assert.deepEqual((await call('GET', '/api/messages')).json.map((m) => m.id), ['m2', 'm1']);
  assert.equal((await call('GET', '/api/messages?office=B')).json.length, 0);
  assert.equal((await call('GET', '/api/board?all=1')).json[0].id, 'p1');
  assert.equal((await call('GET', '/api/board?office=B&all=1')).json.length, 0);
  assert.equal((await call('GET', '/api/stats')).json.deliveries, 1);
  assert.equal((await call('GET', '/api/stats?office=B')).json.deliveries, 0);
});

// ---------- 事業所・職員 ----------
test('offices は架空 3 事業所', async () => {
  const { status, json } = await api('GET', '/api/offices');
  assert.equal(status, 200);
  assert.deepEqual(json, [
    { id: 'A', name: 'デイサービス ひだまり', kind: 'デイサービス' },
    { id: 'B', name: '老健 やすらぎ', kind: '老健' },
    { id: 'C', name: 'ひだまり病院', kind: '病院' },
  ]);
});

test('staff は ?office= で絞る（省略時 A の20名）。未知の事業所は 400', async () => {
  const a = (await api('GET', '/api/staff')).json;
  assert.equal(a.length, 20);
  assert.ok(a.every((s) => s.office_id === 'A'));
  const b = (await api('GET', '/api/staff?office=B')).json;
  assert.deepEqual(b.map((s) => s.id), ['b01', 'b02', 'b03']);
  assert.ok(b.every((s) => s.office_id === 'B' && s.ledger_staff_id === null && s.transport_routes.length === 0));
  assert.deepEqual((await api('GET', '/api/staff?office=C')).json.map((s) => s.role), ['地域連携室', '看護師', '医事']);
  const bad = await api('GET', '/api/staff?office=Z');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'unknown_office');
});

// ---------- 事業所内フローの分離 ----------
let aMsg; // A で配信済みの連絡（坂井 夏子様）
test('A で解析→配信しても B の一覧・ボード・統計に出ず、office_messages も作られない', async () => {
  const m = (await api('POST', '/api/messages', { raw_text: VISIT })).json;
  assert.equal(m.office_id, 'A');
  assert.equal(m.status, 'proposed');
  const ids = [...m.analysis.recipients, ...m.analysis.excluded].map((x) => x.staff_id);
  assert.ok(ids.length > 0 && ids.every((x) => x.startsWith('s')), 'A の名簿だけで解析');
  const sent = await api('POST', `/api/messages/${m.id}/send`, { recipients: m.analysis.recipients });
  assert.equal(sent.status, 200);
  aMsg = sent.json;

  const v = (await api('POST', '/api/messages', { raw_text: VEHICLE, office_id: 'A' })).json;
  const vs = await api('POST', `/api/messages/${v.id}/send`, { recipients: v.analysis.recipients, board_post: v.analysis.board_post });
  assert.equal(vs.status, 200);

  assert.ok((await api('GET', '/api/messages')).json.some((x) => x.id === m.id));
  assert.ok(!(await api('GET', '/api/messages?office=B')).json.some((x) => x.id === m.id || x.id === v.id));
  assert.ok((await api('GET', '/api/board')).json.some((p) => p.message_id === v.id));
  assert.equal((await api('GET', '/api/board?office=B')).json.length, 0);
  assert.equal((await api('GET', '/api/board?office=B&all=1')).json.length, 0);
  const sb = (await api('GET', '/api/stats?office=B')).json;
  assert.deepEqual(sb, { messages: 0, deliveries: 0, acked: 0, unacked: 0, board_posts: 0 });
  assert.equal(omCount(), 0, '/send・ボード掲示は office_messages を作らない');
});

test('B の連絡は B の職員名簿だけで解析・配信し、A の一覧に出ない。A の職員は宛先にできない', async () => {
  const m = (await api('POST', '/api/messages', { raw_text: B_TEXT, office_id: 'B' })).json;
  assert.equal(m.office_id, 'B');
  assert.equal(m.status, 'proposed');
  const ids = [...m.analysis.recipients, ...m.analysis.excluded].map((x) => x.staff_id).sort();
  assert.deepEqual(ids, ['b01', 'b02', 'b03']);
  const wrong = await api('POST', `/api/messages/${m.id}/send`, { recipients: [{ staff_id: 's04', title: 't', body: 'b' }] });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, 'unknown_staff');
  const sent = await api('POST', `/api/messages/${m.id}/send`, {
    recipients: [{ staff_id: 'b02', title: '食事形態の見直し', body: B_TEXT }],
    board_post: { title: '会議のお知らせ', body: '食事形態の見直しを検討します', until: null },
  });
  assert.equal(sent.status, 200);
  assert.ok((await api('GET', '/api/messages?office=B')).json.some((x) => x.id === m.id));
  assert.ok(!(await api('GET', '/api/messages')).json.some((x) => x.id === m.id));
  assert.ok((await api('GET', '/api/board?office=B')).json.some((p) => p.message_id === m.id));
  assert.ok(!(await api('GET', '/api/board')).json.some((p) => p.message_id === m.id));
  assert.equal((await api('GET', '/api/stats?office=B')).json.deliveries, 1);
  // Android 互換: 職員別の配信一覧は無変更で引ける
  assert.equal((await api('GET', '/api/staff/b02/deliveries')).json.length, 1);
  assert.equal(omCount(), 0);
  assert.equal((await api('POST', '/api/messages', { raw_text: B_TEXT, office_id: 'Z' })).status, 400);
});

// ---------- AI 文面支援 ----------
test('/draft はモック文面を返し、office_messages を作らない。入力不備は 400', async () => {
  const r = await api('POST', '/api/office-messages/draft', { from_office_id: 'A', to_office_id: 'B', source_message_id: aMsg.id, notes: '退所後の受け入れについてご相談です。' });
  assert.equal(r.status, 200);
  assert.equal(r.json.model, 'mock');
  assert.equal(r.json.usage, null);
  assert.ok(r.json.title.includes('デイサービス ひだまり'));
  assert.match(r.json.body, /老健 やすらぎ ご担当者様/);
  assert.match(r.json.body, /坂井 夏子 様/);
  assert.match(r.json.body, /退所後の受け入れ/);
  assert.match(r.json.body, /ご確認ください/);
  for (const rc of aMsg.analysis.recipients) {
    const name = aMsg.deliveries.find((d) => d.staff_id === rc.staff_id).staff_name;
    assert.ok(!r.json.body.includes(name), `宛先職員名を含めない: ${name}`);
  }
  assert.equal((await api('POST', '/api/office-messages/draft', { from_office_id: 'A', to_office_id: 'C', notes: 'メモのみ' })).status, 200);
  const cases = [
    [{ from_office_id: 'A', to_office_id: 'A', notes: 'x' }, 'same_office'],
    [{ from_office_id: 'A', to_office_id: 'Z', notes: 'x' }, 'unknown_office'],
    [{ to_office_id: 'B', notes: 'x' }, 'bad_request'],
    [{ from_office_id: 'A', to_office_id: 'B' }, 'bad_request'],
    [{ from_office_id: 'A', to_office_id: 'B', source_message_id: 'nope' }, 'unknown_message'],
    [{ from_office_id: 'B', to_office_id: 'C', source_message_id: aMsg.id }, 'office_mismatch'],
  ];
  for (const [body, code] of cases) {
    const x = await api('POST', '/api/office-messages/draft', body);
    assert.equal(x.status, 400, JSON.stringify(body));
    assert.equal(x.json.code, code);
  }
  assert.equal(omCount(), 0, '/draft は送信しない');
});

test('/draft（Claude）: 渡す材料は要約・対応・分類・利用者名・notes だけで、宛先職員名・除外理由・台帳詳細を含めない', async () => {
  let params;
  const client = { messages: { create: async (p) => {
    params = p;
    return { usage: { input_tokens: 400, output_tokens: 200 }, content: [{ type: 'tool_use', name: 'submit_office_draft', input: { title: '件名案', body: '本文案です。' } }] };
  } } };
  let rated = 0;
  const out = await draftOfficeMessage(
    { from_office_id: 'A', to_office_id: 'C', source_message_id: aMsg.id, notes: '受診先の確認をお願いします' },
    { db, env: { ANTHROPIC_API_KEY: 'x', HEART_RELAY_MODEL: 'claude-sonnet-5-5' }, client, checkRate: () => { rated++; } },
  );
  assert.equal(rated, 1, '回数制限は解析と共有');
  assert.deepEqual({ title: out.title, body: out.body, model: out.model }, { title: '件名案', body: '本文案です。', model: 'claude-sonnet-5-5' });
  assert.equal(out.usage.input_tokens, 400);
  assert.ok(out.usage.est_cost_usd > 0);
  assert.equal(params.system, DRAFT_SYSTEM_PROMPT);
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  const content = params.messages[0].content;
  assert.match(content, /デイサービス ひだまり（デイサービス）/);
  assert.match(content, /ひだまり病院（病院）/);
  assert.match(content, /坂井 夏子 様/);
  assert.ok(content.includes(aMsg.analysis.summary));
  for (const a of aMsg.analysis.required_actions) assert.ok(content.includes(a));
  assert.match(content, /受診先の確認をお願いします/);
  const staffNames = db.prepare('SELECT name FROM staff').all().map((s) => s.name);
  for (const n of staffNames) assert.ok(!content.includes(n), `職員名を含めない: ${n}`);
  for (const x of aMsg.analysis.excluded) assert.ok(!x.reason || !content.includes(x.reason), '除外理由を含めない');
  for (const r of aMsg.analysis.recipients) assert.ok(!content.includes(r.reason), '宛先理由を含めない');
  assert.doesNotMatch(content, /コース\d|送迎上の注意|ケアマネ/, '台帳の詳細を含めない');
  assert.equal(omCount(), 0);

  // tool_use が無いときは本文の JSON を使う
  const c2 = { messages: { create: async () => ({ usage: {}, content: [{ type: 'text', text: '```json\n{"title":"T","body":"B"}\n```' }] }) } };
  const o2 = await draftOfficeMessage({ from_office_id: 'A', to_office_id: 'B', notes: 'n' }, { db, env: { ANTHROPIC_API_KEY: 'x' }, client: c2 });
  assert.deepEqual([o2.title, o2.body], ['T', 'B']);
  const c3 = { messages: { create: async () => { throw Object.assign(new Error('bad'), { status: 400 }); } } };
  await assert.rejects(draftOfficeMessage({ from_office_id: 'A', to_office_id: 'B', notes: 'n' }, { db, env: { ANTHROPIC_API_KEY: 'x' }, client: c3 }), (e) => e.status === 502);
});

// ---------- 事業所間連絡 ----------
test('office-messages: 作成→受信/送信一覧→確認（冪等）', async () => {
  const c = await api('POST', '/api/office-messages', {
    from_office_id: 'A', to_office_id: 'B', title: '  受け入れのご相談  ', body: '本文です。', created_by: '村井 拓也', source_message_id: aMsg.id,
  });
  assert.equal(c.status, 200);
  const om = c.json;
  assert.deepEqual(om.from_office, { id: 'A', name: 'デイサービス ひだまり', kind: 'デイサービス' });
  assert.deepEqual(om.to_office, { id: 'B', name: '老健 やすらぎ', kind: '老健' });
  assert.equal(om.title, '受け入れのご相談');
  assert.equal(om.source_message_id, aMsg.id);
  assert.equal(om.created_by, '村井 拓也');
  assert.equal(om.acknowledged_at, null);
  assert.equal(om.acknowledged_by, null);
  assert.deepEqual(Object.keys(om).sort(), ['acknowledged_at', 'acknowledged_by', 'body', 'created_at', 'created_by', 'from_office', 'id', 'source_message_id', 'title', 'to_office']);

  const second = (await api('POST', '/api/office-messages', { from_office_id: 'A', to_office_id: 'C', title: '2件目', body: 'b' })).json;
  assert.equal(second.source_message_id, null);
  assert.equal(second.created_by, '');

  const a = (await api('GET', '/api/office-messages?office=A')).json;
  assert.deepEqual(a.outbox.map((x) => x.id), [second.id, om.id], '新しい順');
  assert.equal(a.inbox.length, 0);
  assert.deepEqual((await api('GET', '/api/office-messages')).json, a, '省略時 A');
  const b = (await api('GET', '/api/office-messages?office=B')).json;
  assert.deepEqual(b.inbox.map((x) => x.id), [om.id]);
  assert.equal(b.outbox.length, 0);
  const cc = (await api('GET', '/api/office-messages?office=C')).json;
  assert.deepEqual(cc.inbox.map((x) => x.id), [second.id], '選んでいない事業所には届かない');
  assert.equal((await api('GET', '/api/office-messages?office=Z')).status, 400);

  // 事業所間連絡は通常の一覧・ボードに混入しない
  assert.ok(!(await api('GET', '/api/messages?office=B')).json.some((x) => x.raw_text.includes('本文です')));
  assert.ok(!(await api('GET', '/api/board?office=B&all=1')).json.some((x) => x.title === '受け入れのご相談'));

  const ack = await api('POST', `/api/office-messages/${om.id}/ack`, { staff_name: '杉山 真理' });
  assert.equal(ack.status, 200);
  assert.ok(ack.json.acknowledged_at);
  assert.equal(ack.json.acknowledged_by, '杉山 真理');
  const ack2 = await api('POST', `/api/office-messages/${om.id}/ack`, { staff_name: '原田 由香', office_id: 'B' });
  assert.equal(ack2.status, 200);
  assert.equal(ack2.json.acknowledged_at, ack.json.acknowledged_at, '冪等');
  assert.equal(ack2.json.acknowledged_by, '杉山 真理');
  const out = (await api('GET', '/api/office-messages?office=A')).json.outbox.find((x) => x.id === om.id);
  assert.equal(out.acknowledged_by, '杉山 真理', '送信側でも確認状況が分かる');

  assert.equal((await api('POST', `/api/office-messages/${om.id}/ack`, {})).status, 400);
  assert.equal((await api('POST', `/api/office-messages/${second.id}/ack`, { staff_name: 'x', office_id: 'A' })).status, 403);
  assert.equal((await api('POST', '/api/office-messages/nope/ack', { staff_name: 'x' })).status, 404);
});

test('office-messages: 400 系（from=to・未知の事業所・必須項目・元連絡の存在と事業所）', async () => {
  const before = omCount();
  const base = { from_office_id: 'A', to_office_id: 'B', title: 't', body: 'b' };
  const cases = [
    [{ ...base, to_office_id: 'A' }, 'same_office'],
    [{ ...base, to_office_id: 'Z' }, 'unknown_office'],
    [{ ...base, from_office_id: 'Q' }, 'unknown_office'],
    [{ ...base, from_office_id: undefined }, 'bad_request'],
    [{ ...base, title: '  ' }, 'bad_request'],
    [{ ...base, body: undefined }, 'bad_request'],
    [{ ...base, title: 'x'.repeat(201) }, 'bad_request'],
    [{ ...base, source_message_id: 'nope' }, 'unknown_message'],
    [{ ...base, from_office_id: 'C', source_message_id: aMsg.id }, 'office_mismatch'],
  ];
  for (const [body, code] of cases) {
    const r = await api('POST', '/api/office-messages', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, code);
  }
  assert.equal(omCount(), before);
});

// ---------- 作成経路がコード上 1 箇所であること ----------
test('office_messages への INSERT は office/service.js の createOfficeMessage だけで、呼び出しは POST /api/office-messages のみ', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } };
  walk(SRC_DIR);
  const hits = (re) => files.flatMap((f) => (fs.readFileSync(f, 'utf8').match(re) || []).map(() => path.relative(SRC_DIR, f)));
  assert.deepEqual(hits(/INSERT\s+(OR\s+\w+\s+)?INTO\s+office_messages/gi), [path.join('office', 'service.js')]);
  assert.deepEqual(hits(/REPLACE\s+INTO\s+office_messages/gi), []);
  const callers = hits(/createOfficeMessage\(/g).filter((f) => f !== path.join('office', 'service.js'));
  assert.deepEqual(callers, [path.join('office', 'router.js')], '呼び出しは router.js の 1 箇所');
  const router = fs.readFileSync(path.join(SRC_DIR, 'office', 'router.js'), 'utf8');
  const call = router.indexOf('createOfficeMessage(db');
  const handler = router.lastIndexOf("router.", call);
  assert.ok(router.slice(handler, call).startsWith("router.post('/office-messages', "), 'POST /api/office-messages ハンドラ内');
  assert.ok(!fs.readFileSync(path.join(SRC_DIR, 'office', 'draft.js'), 'utf8').includes('createOfficeMessage'));
});

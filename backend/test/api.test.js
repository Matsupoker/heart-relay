import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { DEMO_MESSAGES, DEMO_SAMPLES } from '../src/seedData.js';

// 確定するデモ文（坂井 夏子様の受診帰宅）と、全体共有向け（レク変更）
const VISIT = DEMO_SAMPLES[0].raw_text;
const SURNAME_ONLY = DEMO_SAMPLES[2].raw_text;
const SAME_NAME = DEMO_SAMPLES[3].raw_text;
const VEHICLE = DEMO_SAMPLES[4].raw_text;
const RECREATION = DEMO_SAMPLES[5].raw_text;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-test-'));
const servers = [];

/** 一時DB・APIキー無し（モック解析）でサーバー起動 */
async function start(name, extraEnv = {}) {
  const env = { ...extraEnv }; // ANTHROPIC_API_KEY は含めない
  const ctx = createApp({ dbPath: path.join(tmp, name + '.db'), env });
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push({ server, ctx });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers } = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  return { call };
}

let api;
before(async () => { api = await start('main', { ANALYZE_RATE_LIMIT_PER_MIN: '50' }); });
after(() => {
  for (const { server, ctx } of servers) { server.close(); ctx.close(); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health はモック解析を示す', async () => {
  const { status, json } = await api.call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.analyzer, 'mock');
  assert.equal(json.residents, 200);
});

test('職員は20名（送迎コース・台帳ID付き）・利用者は200名', async () => {
  const staff = (await api.call('GET', '/api/staff')).json;
  assert.equal(staff.length, 20);
  const s07 = staff.find((s) => s.id === 's07');
  assert.deepEqual(s07.transport_routes, ['1', '2']);
  assert.equal(s07.ledger_staff_id, null);
  assert.equal(staff.find((s) => s.id === 's04').ledger_staff_id, 'S0001');
  assert.deepEqual(staff.find((s) => s.id === 's10').transport_routes, ['3', '4']);
  assert.equal((await api.call('GET', '/api/residents')).json.length, 200);
});

test('利用者検索・詳細', async () => {
  const q = await api.call('GET', `/api/residents?q=${encodeURIComponent('ｻｶｲ')}`);
  assert.ok(q.json.some((r) => r.id === '0466'));
  assert.equal((await api.call('GET', '/api/residents?q=0')).json.length, 20, '既定 limit 20');
  assert.equal((await api.call('GET', '/api/residents?q=0&limit=5')).json.length, 5);
  const r = (await api.call('GET', '/api/residents/0466')).json;
  assert.equal(r.name, '坂井 夏子');
  assert.equal(r.transport_route, '2');
  assert.equal(r.staff_name, '小林 直樹');
  assert.equal(typeof r.age, 'number');
  assert.deepEqual(r.attendance, { date: '2026-11-10', status: '出席', reason: '' });
  assert.equal((await api.call('GET', '/api/residents/9999')).status, 404);
});

test('利用者照合 API（Claude を呼ばない）', async () => {
  const m = (await api.call('POST', '/api/residents/match', { body: { text: SAME_NAME } })).json;
  assert.equal(m.status, 'ambiguous');
  assert.deepEqual(m.candidates.map((c) => c.id).sort(), ['0001', '0006']);
  assert.equal((await api.call('POST', '/api/residents/match', { body: {} })).status, 400);
});

test('連絡事項の登録→配信→確認の一連の流れ', async () => {
  // 登録＋解析
  const posted = await api.call('POST', '/api/messages', { body: { raw_text: VISIT } });
  assert.equal(posted.status, 200);
  const msg = posted.json;
  assert.equal(msg.status, 'proposed');
  assert.equal(msg.analyzer, 'mock');
  assert.equal(msg.resident_id, '0466');
  assert.equal(msg.resident.name, '坂井 夏子');
  assert.equal(msg.resident_match.status, 'confirmed');
  assert.equal(msg.analysis.resident_id, '0466');
  assert.equal(msg.analysis.deadline, '15:00');
  assert.equal(msg.analysis.audience, 'individual');
  assert.equal(msg.analysis.board_post, null);
  // 送迎コース2 の担当（運転手 s07・添乗 s09）だけに送る。コース3・4 の s08/s10 は除外
  const ids = msg.analysis.recipients.map((r) => r.staff_id);
  assert.ok(ids.includes('s07') && ids.includes('s09'));
  assert.ok(!ids.includes('s08') && !ids.includes('s10'));
  assert.match(msg.analysis.recipients.find((r) => r.staff_id === 's07').body, /出発前に声かけ/);
  // excluded は宛先以外の全職員（重複なし）
  const ex = msg.analysis.excluded.map((x) => x.staff_id);
  assert.equal(ids.length + ex.length, 20);
  assert.ok(ex.every((x) => !ids.includes(x)));
  assert.ok(msg.analysis.excluded.every((x) => x.reason));
  assert.deepEqual(msg.deliveries, []);
  assert.deepEqual(msg.attachments, []);
  assert.equal(msg.board_post, null);

  // 配信
  const sent = await api.call('POST', `/api/messages/${msg.id}/send`, { body: { recipients: msg.analysis.recipients } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.status, 'sent');
  assert.equal(sent.json.deliveries.length, msg.analysis.recipients.length);
  const target = sent.json.deliveries[0];
  assert.ok(target.staff_name);

  // 二重配信は不可
  assert.equal((await api.call('POST', `/api/messages/${msg.id}/send`, { body: { recipients: msg.analysis.recipients } })).status, 400);

  // 職員別一覧
  const list = await api.call('GET', `/api/staff/${target.staff_id}/deliveries`);
  assert.ok(list.json.some((d) => d.id === target.id && d.acknowledged_at === null));
  const future = await api.call('GET', `/api/staff/${target.staff_id}/deliveries?since=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`);
  assert.equal(future.json.length, 0);

  // 他人の X-Staff-Id では 403、ヘッダ無しも 403
  const other = sent.json.deliveries.find((d) => d.staff_id !== target.staff_id).staff_id;
  assert.equal((await api.call('POST', `/api/deliveries/${target.id}/ack`, { body: { client: 'android' }, headers: { 'X-Staff-Id': other } })).status, 403);
  assert.equal((await api.call('POST', `/api/deliveries/${target.id}/ack`, { body: { client: 'android' } })).status, 403);

  // 本人は確認できる
  const ack = await api.call('POST', `/api/deliveries/${target.id}/ack`, { body: { client: 'android' }, headers: { 'X-Staff-Id': target.staff_id } });
  assert.equal(ack.status, 200);
  assert.ok(ack.json.acknowledged_at);

  // メッセージ詳細に反映
  const detail = await api.call('GET', `/api/messages/${msg.id}`);
  assert.ok(detail.json.deliveries.find((d) => d.id === target.id).acknowledged_at);

  // 2回目は冪等（最初の時刻を維持）
  await new Promise((r) => setTimeout(r, 15));
  const ack2 = await api.call('POST', `/api/deliveries/${target.id}/ack`, { body: { client: 'android' }, headers: { 'X-Staff-Id': target.staff_id } });
  assert.equal(ack2.json.acknowledged_at, ack.json.acknowledged_at);

  // 統計
  const stats = (await api.call('GET', '/api/stats')).json;
  assert.equal(stats.deliveries, sent.json.deliveries.length);
  assert.equal(stats.acked, 1);
  assert.equal(stats.unacked, stats.deliveries - 1);
  assert.equal(typeof stats.board_posts, 'number');
});

test('姓のみ → needs_resident（解析しない）→ /resident で確定 → proposed → 別の利用者で再解析', async () => {
  const posted = (await api.call('POST', '/api/messages', { body: { raw_text: SURNAME_ONLY } })).json;
  assert.equal(posted.status, 'needs_resident');
  assert.equal(posted.analysis, null);
  assert.equal(posted.analyzer, null, 'Claude/モックを呼んでいない');
  assert.equal(posted.resident_id, null);
  assert.equal(posted.resident_match.status, 'ambiguous');
  assert.ok(posted.resident_match.candidates.length >= 2);
  assert.ok(posted.resident_match.candidates.every((c) => c.score === 50));
  // 候補選択前は送信・再解析できない
  assert.equal((await api.call('POST', `/api/messages/${posted.id}/send`, { body: { recipients: [] } })).status, 400);
  assert.equal((await api.call('POST', `/api/messages/${posted.id}/reanalyze`)).status, 400);
  // 存在しない利用者は 400、resident_id 欠落も 400
  assert.equal((await api.call('POST', `/api/messages/${posted.id}/resident`, { body: { resident_id: '9999' } })).status, 400);
  assert.equal((await api.call('POST', `/api/messages/${posted.id}/resident`, { body: {} })).status, 400);

  const pick = posted.resident_match.candidates[0].id;
  const done = await api.call('POST', `/api/messages/${posted.id}/resident`, { body: { resident_id: pick } });
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'proposed');
  assert.equal(done.json.resident_id, pick);
  assert.equal(done.json.analysis.resident_id, pick);
  assert.equal(done.json.resident_match.status, 'ambiguous', '照合結果は履歴として残す');

  // proposed からの変更は再解析。null（関係なし）も可
  const other = posted.resident_match.candidates[1].id;
  assert.equal((await api.call('POST', `/api/messages/${posted.id}/resident`, { body: { resident_id: other } })).json.analysis.resident_id, other);
  const none = (await api.call('POST', `/api/messages/${posted.id}/resident`, { body: { resident_id: null } })).json;
  assert.equal(none.resident_id, null);
  assert.equal(none.resident, null);
  assert.equal(none.analysis.resident_id, null);
});

test('同姓同名 → needs_resident、候補は same_name', async () => {
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: SAME_NAME } })).json;
  assert.equal(m.status, 'needs_resident');
  assert.ok(m.resident_match.candidates.every((c) => c.same_name));
  const done = (await api.call('POST', `/api/messages/${m.id}/resident`, { body: { resident_id: '0006' } })).json;
  assert.equal(done.status, 'proposed');
  assert.equal(done.resident.attendance.date, '2026-11-10');
});

test('resident_id 明示: "" は関係なし（照合スキップ）、ID 指定はそのまま確定', async () => {
  const none = (await api.call('POST', '/api/messages', { body: { raw_text: SURNAME_ONLY, resident_id: '' } })).json;
  assert.equal(none.status, 'proposed');
  assert.equal(none.resident_id, null);
  assert.equal(none.resident_match, null);
  const fixed = (await api.call('POST', '/api/messages', { body: { raw_text: SURNAME_ONLY, resident_id: '0205' } })).json;
  assert.equal(fixed.status, 'proposed');
  assert.equal(fixed.resident_id, '0205');
  assert.equal(fixed.analysis.resident_id, '0205');
  assert.equal((await api.call('POST', '/api/messages', { body: { raw_text: 'x', resident_id: 'r01' } })).status, 400);
});

test('未知の attachment_ids は 400 で連絡事項も作らない', async () => {
  const before = (await api.call('GET', '/api/stats')).json.messages;
  const r = await api.call('POST', '/api/messages', { body: { raw_text: VEHICLE, attachment_ids: ['nope'] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'unknown_attachment');
  assert.equal((await api.call('GET', '/api/stats')).json.messages, before);
  assert.equal((await api.call('POST', '/api/messages', { body: { raw_text: VEHICLE, attachment_ids: 'x' } })).status, 400);
});

test('全体共有: audience=both の提案、board_post のみで配信できる', async () => {
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: RECREATION } })).json;
  assert.equal(m.status, 'proposed');
  assert.equal(m.resident_id, null);
  assert.equal(m.resident_match.status, 'none');
  assert.equal(m.analysis.audience, 'both');
  assert.ok(m.analysis.board_post.title && m.analysis.board_post.body);
  // 両方空は 400、board_post 不正も 400
  assert.equal((await api.call('POST', `/api/messages/${m.id}/send`, { body: { recipients: [], board_post: null } })).status, 400);
  assert.equal((await api.call('POST', `/api/messages/${m.id}/send`, { body: { board_post: { title: '', body: 'b' } } })).status, 400);
  assert.equal((await api.call('POST', `/api/messages/${m.id}/send`, { body: { board_post: { title: 't', body: 'b', until: 'いつか' } } })).status, 400);

  const before = (await api.call('GET', '/api/stats')).json;
  const sent = await api.call('POST', `/api/messages/${m.id}/send`, { body: { recipients: [], board_post: m.analysis.board_post } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.status, 'sent');
  assert.deepEqual(sent.json.deliveries, []);
  assert.equal(sent.json.board_post.title, m.analysis.board_post.title);
  assert.equal(sent.json.board_post.message_id, m.id);
  assert.equal(sent.json.board_post.resident_name, null);
  const after = (await api.call('GET', '/api/stats')).json;
  assert.equal(after.board_posts, before.board_posts + 1);
  assert.equal(after.deliveries, before.deliveries);
});

test('個別＋全体共有（車両）: deliveries と board_post を同時に作る。利用者名は board_post に載る', async () => {
  const v = (await api.call('POST', '/api/messages', { body: { raw_text: VEHICLE } })).json;
  assert.equal(v.analysis.audience, 'both');
  const sent = (await api.call('POST', `/api/messages/${v.id}/send`, { body: { recipients: v.analysis.recipients, board_post: v.analysis.board_post } })).json;
  assert.equal(sent.deliveries.length, v.analysis.recipients.length);
  assert.ok(sent.board_post);

  const p = (await api.call('POST', '/api/messages', { body: { raw_text: VISIT } })).json;
  const s2 = (await api.call('POST', `/api/messages/${p.id}/send`, {
    body: { recipients: p.analysis.recipients.slice(0, 1), board_post: { title: '早めの帰宅', body: '15時帰宅', until: '2026-11-10T18:00:00+09:00' } },
  })).json;
  assert.equal(s2.board_post.resident_name, '坂井 夏子');
  assert.equal(s2.board_post.until, '2026-11-10T18:00:00+09:00');
});

test('v1 の Android 経路（X-Staff-Id で一覧取得・確認）は無変更で動く', async () => {
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: VISIT } })).json;
  // v1 クライアントは recipients だけを送る
  const sent = (await api.call('POST', `/api/messages/${m.id}/send`, { body: { recipients: m.analysis.recipients } })).json;
  const d = sent.deliveries[0];
  const list = (await api.call('GET', `/api/staff/${d.staff_id}/deliveries`, { headers: { 'X-Staff-Id': d.staff_id } })).json;
  const got = list.find((x) => x.id === d.id);
  assert.deepEqual(Object.keys(got).sort(), ['acknowledged_at', 'action_required', 'body', 'categories', 'created_at', 'id', 'message_id', 'reason', 'staff_id', 'staff_name', 'staff_role', 'title', 'urgency']);
  const ack = await api.call('POST', `/api/deliveries/${d.id}/ack`, { body: { client: 'android' }, headers: { 'X-Staff-Id': d.staff_id } });
  assert.equal(ack.status, 200);
  assert.ok(ack.json.acknowledged_at);
});

test('デモ文は6件、ラベル付き', async () => {
  const demos = (await api.call('GET', '/api/demo-messages')).json;
  assert.equal(demos.length, 6);
  assert.ok(demos.every((d) => d.label && d.raw_text));
});

test('デモ文はそれぞれ宛先を持ち、職種に合った本文になる', async () => {
  for (const d of DEMO_SAMPLES) {
    const text = d.raw_text;
    let { json } = await api.call('POST', '/api/messages', { body: { raw_text: text } });
    assert.equal(json.status, d.expect === 'ambiguous' ? 'needs_resident' : 'proposed', text);
    if (json.status === 'needs_resident') {
      json = (await api.call('POST', `/api/messages/${json.id}/resident`, { body: { resident_id: json.resident_match.candidates[0].id } })).json;
    }
    assert.equal(json.status, 'proposed', text);
    assert.ok(json.analysis.recipients.length >= 1, text);
    assert.ok(json.analysis.recipients.length < 20, '一斉送信にならない');
  }
});

test('不正な入力は 400、存在しない宛先は 400、未知IDは 404', async () => {
  assert.equal((await api.call('POST', '/api/messages', { body: { raw_text: '  ' } })).status, 400);
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: DEMO_MESSAGES[1] } })).json;
  assert.equal(m.status, 'proposed');
  const bad = await api.call('POST', `/api/messages/${m.id}/send`, { body: { recipients: [{ staff_id: 'zzz', title: 't', body: 'b' }] } });
  assert.equal(bad.status, 400);
  assert.equal((await api.call('GET', '/api/messages/nope')).status, 404);
});

test('再解析ができる', async () => {
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: VEHICLE } })).json;
  const r = await api.call('POST', `/api/messages/${m.id}/reanalyze`);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'proposed');
});

test('解析の回数制限を超えると 429', async () => {
  const limited = await start('limited', { ANALYZE_RATE_LIMIT_PER_MIN: '2' });
  const post = () => limited.call('POST', '/api/messages', { body: { raw_text: VISIT } });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const third = await post();
  assert.equal(third.status, 429);
  assert.equal(third.json.code, 'rate_limited');
  // 候補選択待ち（Claude を呼ばない）は制限に数えない
  assert.equal((await limited.call('POST', '/api/messages', { body: { raw_text: SURNAME_ONLY } })).json.status, 'needs_resident');
  // 読み取り系は制限されない
  assert.equal((await limited.call('GET', '/api/staff')).status, 200);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { DEMO_MESSAGES } from '../src/seedData.js';

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
});

test('職員は20名・利用者は8名', async () => {
  assert.equal((await api.call('GET', '/api/staff')).json.length, 20);
  assert.equal((await api.call('GET', '/api/residents')).json.length, 8);
});

test('連絡事項の登録→配信→確認の一連の流れ', async () => {
  // 登録＋解析
  const posted = await api.call('POST', '/api/messages', { body: { raw_text: DEMO_MESSAGES[0] } });
  assert.equal(posted.status, 200);
  const msg = posted.json;
  assert.equal(msg.status, 'proposed');
  assert.equal(msg.analyzer, 'mock');
  assert.equal(msg.analysis.resident_id, 'r01');
  assert.equal(msg.analysis.deadline, '15:00');
  assert.ok(msg.analysis.recipients.length >= 1);
  assert.deepEqual(msg.deliveries, []);

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
});

test('デモ文はそれぞれ宛先を持ち、職種に合った本文になる', async () => {
  for (const text of DEMO_MESSAGES) {
    const { json } = await api.call('POST', '/api/messages', { body: { raw_text: text } });
    assert.equal(json.status, 'proposed', text);
    assert.ok(json.analysis.recipients.length >= 1, text);
    assert.ok(json.analysis.recipients.length < 20, '一斉送信にならない');
  }
});

test('不正な入力は 400、存在しない宛先は 400、未知IDは 404', async () => {
  assert.equal((await api.call('POST', '/api/messages', { body: { raw_text: '  ' } })).status, 400);
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: DEMO_MESSAGES[1] } })).json;
  const bad = await api.call('POST', `/api/messages/${m.id}/send`, { body: { recipients: [{ staff_id: 'zzz', title: 't', body: 'b' }] } });
  assert.equal(bad.status, 400);
  assert.equal((await api.call('GET', '/api/messages/nope')).status, 404);
});

test('再解析ができる', async () => {
  const m = (await api.call('POST', '/api/messages', { body: { raw_text: DEMO_MESSAGES[3] } })).json;
  const r = await api.call('POST', `/api/messages/${m.id}/reanalyze`);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'proposed');
});

test('解析の回数制限を超えると 429', async () => {
  const limited = await start('limited', { ANALYZE_RATE_LIMIT_PER_MIN: '2' });
  const post = () => limited.call('POST', '/api/messages', { body: { raw_text: DEMO_MESSAGES[0] } });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const third = await post();
  assert.equal(third.status, 429);
  assert.equal(third.json.code, 'rate_limited');
  // 読み取り系は制限されない
  assert.equal((await limited.call('GET', '/api/staff')).status, 200);
});

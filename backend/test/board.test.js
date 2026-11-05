import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { insertBoardPost } from '../src/board/service.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-board-'));
let ctx, server, base;
const call = async (method, url) => {
  const res = await fetch(base + url, { method });
  return { status: res.status, json: await res.json() };
};
const mk = (o) => insertBoardPost(ctx.db, { message_id: 'm-' + Math.random(), body: '本文', ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  ctx = createApp({ dbPath: path.join(tmp, 'b.db'), env: {} });
  server = await new Promise((resolve) => { const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); ctx.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET /api/board は緊急度 high→medium→low、同順位は新しい順', async () => {
  const l1 = mk({ title: 'low-1', urgency: 'low' }); await sleep(5);
  const m1 = mk({ title: 'med-1', urgency: 'medium' }); await sleep(5);
  const h1 = mk({ title: 'high-1', urgency: 'high' }); await sleep(5);
  const h2 = mk({ title: 'high-2', urgency: 'high' }); await sleep(5);
  const m2 = mk({ title: 'med-2', urgency: 'medium' });
  const { status, json } = await call('GET', '/api/board');
  assert.equal(status, 200);
  assert.deepEqual(json.map((p) => p.title), ['high-2', 'high-1', 'med-2', 'med-1', 'low-1']);
  assert.ok([l1, m1, h1, h2, m2].every((p) => json.some((j) => j.id === p.id)));
});

test('期限切れは通常一覧に出ず、all=1 では出る。未来の期限は出る', async () => {
  const past = mk({ title: 'expired', until: new Date(Date.now() - 60000).toISOString() });
  const future = mk({ title: 'future', until: new Date(Date.now() + 3600000).toISOString() });
  const list = (await call('GET', '/api/board')).json;
  assert.ok(!list.some((p) => p.id === past.id));
  assert.ok(list.some((p) => p.id === future.id));
  const all = (await call('GET', '/api/board?all=1')).json;
  assert.ok(all.some((p) => p.id === past.id));
});

test('archive は冪等で、以後は通常一覧から消え all=1 には残る', async () => {
  const p = mk({ title: 'to-archive', urgency: 'high' });
  const r1 = await call('POST', `/api/board/${p.id}/archive`);
  assert.equal(r1.status, 200);
  assert.ok(r1.json.archived_at);
  const r2 = await call('POST', `/api/board/${p.id}/archive`);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.archived_at, r1.json.archived_at);
  assert.ok(!(await call('GET', '/api/board')).json.some((x) => x.id === p.id));
  assert.ok((await call('GET', '/api/board?all=1')).json.some((x) => x.id === p.id));
});

test('存在しない id の archive は 404', async () => {
  const r = await call('POST', '/api/board/nope/archive');
  assert.equal(r.status, 404);
  assert.ok(r.json.error);
});

test('categories と resident_name が返る', async () => {
  const p = mk({ title: 'ctx', categories: ['送迎', '食事'], resident_name: '架空 太郎' });
  const got = (await call('GET', '/api/board')).json.find((x) => x.id === p.id);
  assert.deepEqual(got.categories, ['送迎', '食事']);
  assert.equal(got.resident_name, '架空 太郎');
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import * as fx from './fixtures/make.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-intake-'));
let ctx, server, base;

before(async () => {
  const env = { DB_PATH: path.join(tmp, 'intake.db'), INTAKE_MAX_BYTES: '100000', ANALYZE_RATE_LIMIT_PER_MIN: '50' };
  ctx = createApp({ dbPath: env.DB_PATH, env });
  server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); ctx.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function upload(buf, filename, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], type ? { type } : {}), filename);
  const res = await fetch(base + '/api/intake', { method: 'POST', body: fd });
  return { status: res.status, json: await res.json() };
}

test('txt UTF-8（BOM除去・LF統一）', async () => {
  const { status, json } = await upload(fx.txtUtf8(), 'memo.txt', 'text/plain');
  assert.equal(status, 201);
  assert.equal(json.kind, 'txt'); assert.equal(json.extractor, 'local');
  assert.ok(json.extracted_text.startsWith('【連絡メモ】\n田中花子様'));
  assert.ok(!json.extracted_text.includes('\r') && !json.extracted_text.includes('﻿'));
  assert.deepEqual(json.warnings, []);
  assert.equal(json.message_id, null);
});

test('txt Shift_JIS は判定して warning', async () => {
  const { status, json } = await upload(fx.txtSjis(), 'sjis.txt', 'text/plain');
  assert.equal(status, 201);
  assert.ok(json.extracted_text.includes('明日の通所を欠席'));
  assert.ok(json.warnings.includes('文字コードを Shift_JIS と判定'));
});

for (const [ext, bt] of [['xlsx', 'xlsx'], ['xls', 'biff8']]) {
  test(`${ext} はシートごとに ' | ' 区切り・非表示シート除外・数式非実行の注記`, async () => {
    const { status, json } = await upload(fx.xlsx({ bookType: bt }), `t.${ext}`);
    assert.equal(status, 201);
    assert.equal(json.kind, ext);
    assert.ok(json.extracted_text.startsWith('## 送迎表\n氏名 | 時刻 | 備考'), json.extracted_text);
    assert.ok(json.extracted_text.includes('山田太郎（架空） | 10:00'));
    assert.ok(json.extracted_text.includes('鈴木一郎（架空）'));
    assert.ok(!json.extracted_text.includes('秘密'));
    assert.ok(json.warnings.includes('マクロ・数式は実行していません（値のみ）'));
    assert.ok(json.warnings.some((w) => w.includes('非表示シート')));
  });
}

test('docx の本文抽出', async () => {
  const { status, json } = await upload(await fx.docx(), 'n.docx');
  assert.equal(status, 201);
  assert.equal(json.kind, 'docx');
  assert.ok(json.extracted_text.includes('面会予定のお知らせ（架空）'));
});

test('5000 文字で打ち切り＋warning', async () => {
  const { json } = await upload(Buffer.from('あ'.repeat(6000)), 'long.txt', 'text/plain');
  assert.equal(Array.from(json.extracted_text).length, 5000);
  assert.ok(json.warnings.some((w) => w.includes('打ち切り')));
});

test('画像/PDF はAPIキー未設定でモック転記', async () => {
  const a = await upload(fx.png(), 'FAX画像.png', 'image/png');
  assert.equal(a.status, 201);
  assert.equal(a.json.kind, 'image'); assert.equal(a.json.extractor, 'local');
  assert.ok(a.json.extracted_text.startsWith('（モック転記）ファイル名: FAX画像.png'));
  assert.ok(a.json.warnings.includes('モック'));
  const b = await upload(fx.pdf(), 'x.pdf', 'application/pdf');
  assert.equal(b.status, 201); assert.equal(b.json.kind, 'pdf'); assert.ok(b.json.warnings.includes('モック'));
});

test('415: HEIC / doc / xlsm / MIME 不一致', async () => {
  for (const [name, type] of [['a.heic', 'image/heic'], ['a.doc', 'application/msword'], ['a.xlsm', ''], ['a.png', 'application/pdf']]) {
    const r = await upload(Buffer.from('x'), name, type);
    assert.equal(r.status, 415, name);
    assert.equal(r.json.code, 'unsupported_type');
    assert.match(r.json.error, /対応していない/);
  }
});

test('413: 上限超過、400: ファイル無し／壊れたdocx', async () => {
  const big = await upload(Buffer.alloc(100001, 65), 'big.txt', 'text/plain');
  assert.equal(big.status, 413); assert.equal(big.json.code, 'file_too_large');
  const ok = await upload(Buffer.alloc(100000, 65), 'edge.txt', 'text/plain');
  assert.equal(ok.status, 201);
  const none = await fetch(base + '/api/intake', { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
  const bad = await upload(Buffer.from('not a zip'), 'bad.docx');
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'extract_failed');
});

test('GET /attachments/:id と /file、404', async () => {
  const { json } = await upload(fx.png(), '写真 1.png', 'image/png');
  const meta = await fetch(`${base}/api/attachments/${json.id}`);
  assert.equal(meta.status, 200);
  const mj = await meta.json();
  assert.equal(mj.id, json.id); assert.equal(typeof mj.extracted_text, 'string');
  const f = await fetch(`${base}/api/attachments/${json.id}/file`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/png');
  assert.equal(f.headers.get('content-disposition'), `inline; filename*=UTF-8''${encodeURIComponent('写真 1.png')}`);
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), fx.png());
  assert.ok(fs.existsSync(path.join(tmp, 'uploads', json.id + '.png')));
  assert.equal((await fetch(`${base}/api/attachments/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/attachments/nope/file`)).status, 404);
});

test('転記: キーありなら Claude に画像ブロックを送り usage を保存（クライアント差し替え）', async () => {
  const { transcribe } = await import('../src/intake/transcribe.js');
  let seen; let rate = 0;
  const client = { messages: { create: async (p) => { seen = p; return { content: [{ type: 'text', text: '転記結果' }], usage: { input_tokens: 10, output_tokens: 5 } }; } } };
  const out = await transcribe({ buffer: fx.png(), mime: 'image/png', kind: 'image', filename: 'a.png' },
    { env: { ANTHROPIC_API_KEY: 'k' }, checkRate: () => { rate++; }, client });
  assert.equal(out.extractor, 'claude'); assert.equal(out.text, '転記結果'); assert.equal(rate, 1);
  assert.equal(seen.model, 'claude-sonnet-5-5');
  assert.equal(seen.messages[0].content[0].type, 'image');
  const pdf = await transcribe({ buffer: fx.pdf(), mime: 'application/pdf', kind: 'pdf', filename: 'a.pdf' },
    { env: { ANTHROPIC_API_KEY: 'k' }, checkRate() {}, client });
  assert.equal(seen.messages[0].content[0].type, 'document'); assert.equal(pdf.usage.input_tokens, 10);
  await assert.rejects(transcribe({ buffer: fx.png(), mime: 'image/png', kind: 'image', filename: 'a.png' },
    { env: { ANTHROPIC_API_KEY: 'k' }, checkRate() {}, client: { messages: { create: async () => { throw Object.assign(new Error('bad'), { status: 400 }); } } } }),
    (e) => e.status === 502 && e.code === 'transcribe_failed');
});

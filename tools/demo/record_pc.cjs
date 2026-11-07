// デモ動画用 自動収録スクリプト（Playwright / Chromium）
// 使い方: BASE=http://127.0.0.1:8787 OUT=./video/raw DEMO_FILES=./demo-files SCENES=s1,s2,corp,ack node tools/demo/record_pc.cjs
//   - 本番バックエンドに対して実際に操作しながら録画する（解析は本番 Claude。費用 1 件 $0.03〜0.05）
//   - 既存機能は変更しない。すべて架空データ
//   - 出力: <OUT>/<scene>/*.webm と <OUT>/markers.json（各シーンの経過ミリ秒。編集時の待ちカットに使う）
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'video/raw');
const DEMO = path.resolve(process.env.DEMO_FILES || 'demo-files');
const SCENES = (process.env.SCENES || 's1,s2,corp,ack').split(',').map((s) => s.trim()).filter(Boolean);
const ANALYZE_TIMEOUT = Number(process.env.ANALYZE_TIMEOUT || 120000);
const ACK_TIMEOUT = Number(process.env.ACK_TIMEOUT || 240000);
const SLOW = Number(process.env.SLOW || 1); // 間の倍率

fs.mkdirSync(OUT, { recursive: true });
const markersPath = path.join(OUT, 'markers.json');
const markers = fs.existsSync(markersPath) ? JSON.parse(fs.readFileSync(markersPath, 'utf8')) : {};
const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SLOW));

// 画面上に擬似カーソルを描く（Playwright の録画にはマウスカーソルが映らないため）
const CURSOR_SCRIPT = `
(() => {
  if (window.__hrCursor) return;
  const c = document.createElement('div');
  c.id = '__hr_cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:left .05s linear,top .05s linear;';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 L20 12 L12.5 13.5 L16 21 L13.5 22 L10 14.5 L4 20 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const add = () => { if (document.body && !document.body.contains(c)) document.body.appendChild(c); };
  add(); document.addEventListener('DOMContentLoaded', add);
  window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  window.addEventListener('mousedown', () => { c.style.transform = 'translate(-3px,-2px) scale(.8)'; }, true);
  window.addEventListener('mouseup', () => { c.style.transform = 'translate(-3px,-2px) scale(1)'; }, true);
  window.__hrCursor = true;
})();`;

class Scene {
  constructor(browser, name, opts) {
    this.browser = browser; this.name = name; this.opts = opts; this.marks = [];
  }
  async open() {
    const dir = path.join(OUT, this.name);
    fs.mkdirSync(dir, { recursive: true });
    const { width, height } = this.opts.viewport;
    this.ctx = await this.browser.newContext({
      viewport: this.opts.viewport, deviceScaleFactor: 1,
      isMobile: !!this.opts.isMobile, hasTouch: !!this.opts.isMobile,
      locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
      recordVideo: { dir, size: { width, height } },
    });
    await this.ctx.addInitScript(CURSOR_SCRIPT);
    this.t0 = Date.now();
    this.page = await this.newPage();
    return this.page;
  }
  async newPage() {
    const p = await this.ctx.newPage();
    p.on('dialog', (d) => { this.mark('dialog:' + d.message().slice(0, 30)); d.accept(); });
    p.on('pageerror', (e) => console.error(`[${this.name}] pageerror`, e.message));
    return p;
  }
  mark(name) { const t = Date.now() - this.t0; this.marks.push({ name, t }); console.log(`[${this.name}] ${(t / 1000).toFixed(1)}s ${name}`); }
  async click(page, sel, label) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.hover(); await sleep(350);
    await el.click(); this.mark('click:' + (label || sel)); await sleep(500);
  }
  async close() {
    const pages = this.ctx.pages();
    const videos = [];
    for (const p of pages) { const v = p.video(); if (v) videos.push(v); }
    await this.ctx.close();
    const files = [];
    for (const v of videos) files.push(await v.path());
    markers[this.name] = { files, marks: this.marks, finished_at: new Date().toISOString() };
    fs.writeFileSync(markersPath, JSON.stringify(markers, null, 2));
    console.log(`[${this.name}] saved`, files);
  }
}

async function waitAnalysis(scene, page) {
  scene.mark('analyze:start');
  await page.waitForSelector(`${T('btn-send')}, ${T('resident-candidate')}, ${T('proposal-failed')}`, { timeout: ANALYZE_TIMEOUT });
  if (await page.locator(T('proposal-failed')).count()) throw new Error('analysis failed');
  scene.mark('analyze:end');
}

// ---------- シーン 1: PC・FAX 画像取り込み → 転記 → 解析 → 宛先 → 両方 → 承認 → ボード ----------
async function sceneS1(browser) {
  const sc = new Scene(browser, 's1', { viewport: { width: 1600, height: 900 } });
  const page = await sc.open();
  await page.goto(BASE + '/#/home'); await page.waitForSelector(T('home-cta'));
  sc.mark('home'); await sleep(2500);
  await sc.click(page, T('home-cta'), 'home-cta');
  await page.waitForSelector(T('raw-text'), { state: 'visible' }); await sleep(1500);

  const fax = ['FAX_坂井様_帰宅時刻.png', 'FAX_坂井様_帰宅時刻.pdf'].map((f) => path.join(DEMO, f)).find((f) => fs.existsSync(f));
  if (!fax) throw new Error('demo file not found: ' + DEMO);
  await page.locator(T('intake')).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.hover(T('intake')).catch(() => {}); await sleep(500);
  // 日本語パスを直接渡すと Playwright が change を発火しないことがあるため、バッファで渡す
  const mime = fax.endsWith('.pdf') ? 'application/pdf' : 'image/png';
  await page.setInputFiles(T('file-input'), { name: path.basename(fax), mimeType: mime, buffer: fs.readFileSync(fax) });
  sc.mark('intake:start');
  await page.waitForSelector(T('extract-text'), { timeout: ANALYZE_TIMEOUT });
  sc.mark('intake:end'); await sleep(2500);
  // 人が 1 語追記
  const ta = page.locator(T('extract-text'));
  if (process.env.MOCK_EXTRACT) { // モック環境での動作確認用（本番では使わない）
    await ta.fill('坂井 夏子 様（ID 0466）\n本日は受診のため 15:00 に帰宅をお願いします。\n送迎コース2 出発前に声かけをお願いします。');
  }
  await ta.hover(); await ta.click(); await page.keyboard.press('End');
  await page.keyboard.type('（家族確認済み）', { delay: 90 });
  sc.mark('edit'); await sleep(1200);
  await sc.click(page, T('extract-apply'), 'extract-apply');
  await sleep(1500);
  await sc.click(page, T('submit-analyze'), 'submit-analyze');
  await waitAnalysis(sc, page);
  await page.locator(T('resident')).scrollIntoViewIfNeeded().catch(() => {});
  await sleep(3500);
  // 宛先と除外一覧
  await page.locator(T('recipients')).scrollIntoViewIfNeeded(); sc.mark('recipients'); await sleep(3000);
  const exd = page.locator(T('excluded-details')).first();
  if (await exd.count()) {
    await exd.scrollIntoViewIfNeeded();
    const open = await exd.evaluate((e) => e.open);
    if (!open) { await exd.locator('summary').hover(); await sleep(300); await exd.locator('summary').click(); }
    sc.mark('excluded'); await sleep(3500);
  }
  // 届け方: 両方
  const both = page.locator(T('audience-both'));
  await both.scrollIntoViewIfNeeded(); await both.hover(); await sleep(300);
  if (!(await both.isChecked())) await both.check();
  sc.mark('audience:both'); await sleep(2000);
  await page.locator(T('board-title')).scrollIntoViewIfNeeded().catch(() => {}); await sleep(1500);
  // 掲示文が空なら人が入力（本番 Claude は board_post を返すため通常は不要）
  if (!(await page.inputValue(T('board-title'))).trim()) { await page.locator(T('board-title')).click(); await page.keyboard.type('坂井様 本日15時帰宅（受診）', { delay: 60 }); }
  if (!(await page.inputValue(T('board-body'))).trim()) { await page.locator(T('board-body')).click(); await page.keyboard.type('本日は受診のため15時に帰宅。送迎コース2は出発前に声かけをお願いします。', { delay: 40 }); }
  sc.mark('board-post'); await sleep(1000);
  await sc.click(page, T('btn-send'), 'btn-send');
  await page.waitForFunction(() => location.hash.startsWith('#/deliveries/'), null, { timeout: 15000 });
  await page.waitForSelector(T('board-badge'), { timeout: 15000 }).catch(() => {});
  sc.mark('sent'); await sleep(3000);
  const msgId = await page.evaluate(() => location.hash.split('/').pop());
  // 共有ボード（別ページ・別動画）
  const bp = await sc.newPage();
  await bp.setViewportSize({ width: 1024, height: 768 });
  await bp.goto(BASE + '/board.html'); await bp.waitForSelector('[data-testid="board-post"]', { timeout: 15000 });
  sc.mark('board'); await sleep(4000);
  await sc.close();
  return msgId;
}

// ---------- シーン 2: スマホ幅・直接入力・同姓同名の選択 ----------
async function sceneS2(browser) {
  const sc = new Scene(browser, 's2', { viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await sc.open();
  await page.goto(BASE + '/#/home'); await page.waitForSelector(T('tab-new')); sc.mark('home'); await sleep(2000);
  await sc.click(page, T('tab-new'), 'tab-new');
  await page.waitForSelector(T('raw-text'), { state: 'visible' }); await sleep(800);
  const ta = page.locator(T('raw-text'));
  await ta.click();
  await page.keyboard.type('新田洋子さん、明後日は発熱でお休みと家族から連絡がありました。', { delay: 70 });
  sc.mark('typed'); await sleep(1200);
  await sc.click(page, T('submit-analyze'), 'submit-analyze');
  await page.waitForSelector(T('resident-candidate'), { timeout: 30000 });
  sc.mark('candidates'); await sleep(3500);
  const cand = page.locator(`${T('resident-candidate')}[data-rid="0006"]`);
  await cand.scrollIntoViewIfNeeded(); await cand.hover(); await sleep(500);
  await cand.click(); sc.mark('pick:0006');
  await waitAnalysis(sc, page);
  await sleep(2500);
  await page.locator(T('recipients')).scrollIntoViewIfNeeded(); sc.mark('recipients'); await sleep(3500);
  await page.locator(T('btn-send')).scrollIntoViewIfNeeded(); await sleep(800);
  await sc.click(page, T('btn-send'), 'btn-send');
  await page.waitForFunction(() => location.hash.startsWith('#/deliveries/'), null, { timeout: 15000 });
  sc.mark('sent'); await sleep(3000);
  const msgId = await page.evaluate(() => location.hash.split('/').pop());
  await sc.close();
  return msgId;
}

// ---------- シーン ack: PC 配信管理で ✅ 反映を待つ（Pixel 側は別途 screenrecord） ----------
async function sceneAck(browser, msgId) {
  const sc = new Scene(browser, 'ack', { viewport: { width: 1600, height: 900 } });
  const page = await sc.open();
  if (!msgId) {
    const msgs = await (await fetch(BASE + '/api/messages?office=A')).json();
    msgId = msgs[0].id;
  }
  await page.goto(`${BASE}/#/deliveries/${msgId}`); await page.waitForSelector(T('dl-detail'), { timeout: 15000 });
  const before = await page.locator(T('pill-ack')).count();
  sc.mark(`detail acks=${before}`);
  fs.writeFileSync(path.join(OUT, 'ack_ready.txt'), `${msgId}\n${new Date().toISOString()}\n`);
  console.log('[ack] waiting for ack on', msgId, '(record the Pixel now)');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="pill-ack"]').length > n, before, { timeout: ACK_TIMEOUT, polling: 500 });
  sc.mark('ack:shown'); await sleep(5000);
  await sc.close();
}

// ---------- シーン corp: Issue #2 法人内連絡 ----------
async function sceneCorp(browser) {
  const sc = new Scene(browser, 'corp', { viewport: { width: 1600, height: 900 } });
  const page = await sc.open();
  await page.goto(BASE + '/#/home'); await page.waitForSelector(T('office-select'));
  await page.selectOption(T('office-select'), 'A');
  sc.mark('home'); await sleep(1500);
  await page.hover(T('office-select')); await sleep(1200); sc.mark('office-select');
  await sc.click(page, T('nav-corp'), 'nav-corp');
  await page.waitForSelector(T('view-corp'), { state: 'visible' }); await sleep(1500);
  await page.hover(T('corp-to')); await sleep(400);
  await page.selectOption(T('corp-to'), 'B'); sc.mark('to:B'); await sleep(1200);
  await page.hover(T('corp-source')); await sleep(400);
  const opts = await page.$$eval(`${T('corp-source')} option`, (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
  const src = opts.find((o) => o.v && /坂井/.test(o.t)) || opts.find((o) => o.v);
  await page.selectOption(T('corp-source'), src.v); sc.mark('source'); await sleep(2500);
  await sc.click(page, T('corp-draft'), 'corp-draft');
  sc.mark('draft:start');
  await page.waitForFunction(() => { const t = document.querySelector('[data-testid="corp-title"]'); return t && t.value.length > 0; }, null, { timeout: ANALYZE_TIMEOUT });
  sc.mark('draft:end'); await sleep(3500);
  const title = page.locator(T('corp-title'));
  await title.hover(); await title.click(); await page.keyboard.press('Home');
  await page.keyboard.type('【要確認】', { delay: 90 }); sc.mark('edit-title'); await sleep(1500);
  await sc.click(page, T('corp-send'), 'corp-send');
  await page.waitForSelector(T('corp-outbox-item'), { timeout: 15000 }); sc.mark('sent'); await sleep(3000);
  await page.hover(T('office-select')); await sleep(500);
  await page.selectOption(T('office-select'), 'B'); sc.mark('switch:B');
  await page.waitForSelector(T('corp-inbox-item'), { timeout: 15000 }); await sleep(3000);
  await sc.click(page, T('corp-ack'), 'corp-ack');
  await page.waitForSelector(T('corp-acked'), { timeout: 15000 }); sc.mark('acked'); await sleep(2500);
  await page.hover(T('office-select')); await sleep(500);
  await page.selectOption(T('office-select'), 'A'); sc.mark('switch:A');
  await page.waitForSelector(T('corp-outbox-item'), { timeout: 15000 });
  await page.waitForFunction(() => /確認済/.test(document.querySelector('[data-testid="corp-status"]')?.textContent || ''), null, { timeout: 15000 });
  sc.mark('outbox:acked'); await sleep(3500);
  await sc.close();
}

async function main() {
  const health = await (await fetch(BASE + '/api/health')).json();
  console.log('health', JSON.stringify(health));
  const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
  let s1Id, s2Id;
  try {
    for (const s of SCENES) {
      if (s === 's1') s1Id = await sceneS1(browser);
      else if (s === 's2') s2Id = await sceneS2(browser);
      else if (s === 'corp') await sceneCorp(browser);
      else if (s === 'ack') await sceneAck(browser, process.env.ACK_MESSAGE_ID || s2Id || s1Id);
      else console.warn('unknown scene', s);
    }
  } finally { await browser.close(); }
  const idsPath = path.join(OUT, 'ids.json');
  const ids = fs.existsSync(idsPath) ? JSON.parse(fs.readFileSync(idsPath, 'utf8')) : {};
  if (s1Id) ids.s1 = s1Id; if (s2Id) ids.s2 = s2Id;
  fs.writeFileSync(idsPath, JSON.stringify(ids, null, 2));
  console.log('done. markers →', markersPath, 'ids', JSON.stringify(ids));
}
main().catch((e) => { console.error(e); process.exit(1); });

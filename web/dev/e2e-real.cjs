// 実バックエンド（mock 解析・一時DB）に対する統合 E2E。`node web/dev/e2e-real.cjs` で実行。Claude 解析は呼ばない
// 統合 E2E: 実バックエンド（mock 解析・一時DB）に対して v2 の一連を通す
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-int-'));

const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(ok ? '✔' : '✘', name, extra); };

async function main() {
  const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'x.db'), ANALYZE_RATE_LIMIT_PER_MIN: '100' };
  delete env.ANTHROPIC_API_KEY;
  const srv = spawn('node', ['src/server.js'], { cwd: path.join(REPO, 'backend'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  await new Promise((r) => setTimeout(r, 1500));
  const health = await (await fetch(BASE + '/api/health')).json();
  check('health residents=200', health.residents === 200, JSON.stringify(health));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-testid="home-cta"]');
  await page.screenshot({ path: `${SHOTS}/01-home.png` });
  await page.click('[data-testid="home-cta"]');
  await page.waitForSelector('[data-testid="sample-0"]', { state: 'visible' });

  // --- シナリオ1: 固有氏名で確定 → 提案 → both → 送信 → ボード → ack ---
  const samples = await (await fetch(BASE + '/api/demo-messages')).json();
  console.log(samples.map((s) => s.label));
  const s1 = samples.find((s) => /坂井/.test(s.raw_text));
  await page.fill('[data-testid="raw-text"]', s1.raw_text);
  await page.click('[data-testid="submit-analyze"]');
  await page.waitForSelector('[data-testid="btn-send"]', { timeout: 20000 });
  const residentTxt = await page.textContent('[data-testid="resident"]');
  check('S1 resident 坂井 夏子 (0466) shown', /坂井/.test(residentTxt) && /0466/.test(residentTxt), residentTxt.slice(0, 80));
  const rcpts = await page.$$eval('[data-testid="recipient-card"]', (els) => els.map((e) => e.dataset.staffId));
  check('S1 recipients = course2 staff (s07,s09) only', rcpts.includes('s07') && rcpts.includes('s09') && !rcpts.includes('s08') && !rcpts.includes('s10'), rcpts.join(','));
  const exclN = await page.$$eval('[data-testid="excluded-list"] li, [data-testid="excluded-list"] > *', (els) => els.length);
  check('S1 excluded list rendered', exclN > 5, String(exclN));
  await page.screenshot({ path: `${SHOTS}/02-proposal.png`, fullPage: true });
  await page.check('[data-testid="audience-both"]');
  await page.fill('[data-testid="board-title"]', '坂井様 15時帰宅（受診）');
  await page.fill('[data-testid="board-body"]', '本日は受診のため15時に帰宅。送迎コース2は前倒し。');
  await page.click('[data-testid="btn-send"]');
  await page.waitForFunction(() => location.hash.startsWith('#/deliveries/'), null, { timeout: 10000 });
  await page.waitForSelector('[data-testid="board-badge"]', { timeout: 10000 });
  check('S1 sent + board badge on delivery detail', await page.isVisible('[data-testid="dl-detail"]') && (await page.textContent('[data-testid="board-badge"]')).includes('掲示中'));
  const board = await (await fetch(BASE + '/api/board')).json();
  check('S1 /api/board has post', board.length === 1 && board[0].resident_name === '坂井 夏子', JSON.stringify(board[0]).slice(0, 120));
  // ack by s07
  const msgs = await (await fetch(BASE + '/api/messages')).json();
  const d = msgs[0].deliveries.find((x) => x.staff_id === 's07');
  const ack = await fetch(`${BASE}/api/deliveries/${d.id}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Id': 's07' }, body: '{"client":"android"}' });
  check('S1 ack 200', ack.status === 200);
  await page.waitForSelector('[data-testid="pill-ack"]', { timeout: 10000 });
  check('S1 PC shows ✅', true);
  await page.screenshot({ path: `${SHOTS}/03-status.png`, fullPage: true });

  // board page
  const bp = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await bp.goto(BASE + '/board.html');
  await bp.waitForSelector('[data-testid="board-post"]');
  const bt = await bp.textContent('[data-testid="board-title"]');
  check('board.html shows post', /坂井/.test(bt), bt);
  await bp.screenshot({ path: `${SHOTS}/04-board.png` });
  await bp.close();

  // --- シナリオ2: 姓のみ → needs_resident → 候補選択 ---
  await page.click('[data-testid="nav-new"]');
  const s2 = samples.find((s) => /江口/.test(s.raw_text));
  await page.fill('[data-testid="raw-text"]', s2.raw_text);
  await page.click('[data-testid="submit-analyze"]');
  await page.waitForSelector('[data-testid="resident-candidate"]', { timeout: 10000 });
  const cands = await page.$$eval('[data-testid="resident-candidate"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 40)));
  check('S2 candidates shown (江口 x N)', cands.length >= 2, cands.join(' / '));
  await page.screenshot({ path: `${SHOTS}/05-candidates.png`, fullPage: true });
  await page.click('[data-testid="resident-candidate"] >> nth=0');
  await page.waitForSelector('[data-testid="btn-send"]', { timeout: 20000 });
  const r2 = await page.textContent('[data-testid="resident"]');
  check('S2 resident confirmed after pick', /江口/.test(r2), r2.slice(0, 60));

  // --- シナリオ3: 同姓同名（新田 洋子） ---
  const s3 = samples.find((s) => /新田/.test(s.raw_text));
  await page.fill('[data-testid="raw-text"]', s3.raw_text);
  await page.click('[data-testid="submit-analyze"]');
  await page.waitForSelector('[data-testid="resident-candidate"]', { timeout: 10000 });
  const c3 = await page.$$eval('[data-testid="resident-candidate"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 60)));
  check('S3 same-name → 2 candidates with badge', c3.length === 2 && c3.some((t) => /同姓同名/.test(t)), c3.join(' / '));

  // --- シナリオ4: ファイル添付（txt） ---
  const txtPath = path.join(tmp, 'fax.txt');
  fs.writeFileSync(txtPath, '飯島 愛子様 本日より食事形態を刻み食へ変更。看護師より。\n');
  await page.setInputFiles('[data-testid="file-input"]', txtPath);
  await page.waitForSelector('[data-testid="extract-text"]', { timeout: 10000 });
  const ext = await page.inputValue('[data-testid="extract-text"]');
  check('S4 extracted text', /飯島/.test(ext), ext.slice(0, 40));
  await page.fill('[data-testid="raw-text"]', '');
  await page.click('[data-testid="extract-apply"]');
  await page.click('[data-testid="submit-analyze"]');
  await page.waitForSelector('[data-testid="btn-send"]', { timeout: 20000 });
  const m4 = (await (await fetch(BASE + '/api/messages')).json())[0];
  check('S4 message has attachment + resident 0150', m4.attachments?.length === 1 && m4.resident_id === '0150', `${m4.attachments?.length} ${m4.resident_id} source=${m4.source}`);
  await page.screenshot({ path: `${SHOTS}/06-attach.png`, fullPage: true });

  // --- シナリオ5: スマホ幅 ---
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mp.goto(BASE + '/#/new');
  await mp.waitForSelector('[data-testid="raw-text"]', { state: 'visible' });
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  check('mobile no horizontal scroll', sw <= 390, String(sw));
  const s5 = samples.find((s) => /2号車|点検/.test(s.raw_text));
  await mp.fill('[data-testid="raw-text"]', s5.raw_text);
  await mp.click('[data-testid="submit-analyze"]');
  await mp.waitForSelector('[data-testid="btn-send"]', { timeout: 20000 });
  const aud = await mp.isChecked('[data-testid="audience-both"]');
  check('mobile vehicle → audience both preselected', aud);
  await mp.screenshot({ path: `${SHOTS}/07-mobile-proposal.png`, fullPage: true });
  await mp.close();

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  srv.kill();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 実バックエンド（モック解析）に対する結合テスト。
// 前提: backend を PORT=8787 で起動済み。 node web/dev/e2e-real.cjs
const { chromium } = require('playwright');
const S = __dirname + '/screenshots/real-';
const BASE = process.env.BASE || 'http://localhost:8787';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE + '/'); await p.waitForTimeout(800);
  await p.screenshot({ path: S + '01-initial.png' });
  await p.click('[data-testid=sample-0]');
  await p.click('[data-testid=submit-analyze]');
  await p.waitForSelector('[data-testid=recipient-card]', { timeout: 60000 });
  const cards = await p.locator('[data-testid=recipient-card]').count();
  await p.screenshot({ path: S + '02-proposal.png' });
  await p.click('[data-testid=btn-send]');
  await p.waitForSelector('[data-testid=delivery-row]');
  const rows = await p.locator('[data-testid=delivery-row]').count();
  await p.screenshot({ path: S + '03-sent.png' });

  // Android 側の API で 1 名が「確認しました」
  const msgs = await (await fetch(BASE + '/api/messages')).json();
  const d = msgs[0].deliveries[0];
  const inbox = await (await fetch(`${BASE}/api/staff/${d.staff_id}/deliveries`)).json();
  const ack = await fetch(`${BASE}/api/deliveries/${d.id}/ack`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Staff-Id': d.staff_id }, body: JSON.stringify({ client: 'android' }) });
  const t0 = Date.now();
  await p.waitForSelector('[data-testid=pill-ack]', { timeout: 5000 });
  const ms = Date.now() - t0;
  await p.waitForTimeout(300);
  await p.screenshot({ path: S + '04-acked.png' });
  const stats = await p.locator('[data-testid=stats]').innerText();
  console.log(JSON.stringify({ cards, rows, inboxCount: inbox.length, ackStatus: ack.status, ackVisibleMs: ms, stats: stats.replace(/\n/g, ' '), errs }, null, 1));
  await b.close();
})().catch(e => { console.error('E2E FAILED', e); process.exit(1); });

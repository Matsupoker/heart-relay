const { chromium } = require('playwright');
const S = __dirname + '/screenshots/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto('http://localhost:8790/'); await p.waitForTimeout(800);
  await p.screenshot({ path: S + '01-initial.png' });
  await p.click('[data-testid=sample-0]');
  await p.click('[data-testid=submit-analyze]');
  await p.waitForSelector('[data-testid=proposal-loading]'); await p.screenshot({ path: S + '02-loading.png' });
  await p.waitForSelector('[data-testid=recipient-card]');
  // add manual recipient
  await p.selectOption('[data-testid=add-select]', 's01'); await p.click('[data-testid=btn-add]');
  await p.fill('[data-testid=recipient-card]:last-child [data-testid=rcpt-title]', '所長への共有');
  await p.fill('[data-testid=recipient-card]:last-child [data-testid=rcpt-body]', '参考共有です。');
  // edit first card & uncheck second
  await p.fill('[data-testid=recipient-card]:first-child [data-testid=rcpt-title]', '【編集済】A様 15時帰宅');
  await p.uncheck('[data-testid=recipient-card]:nth-child(2) [data-testid=rcpt-check]');
  await p.evaluate(() => document.querySelector('.col-proposal').scrollTop = 0);
  await p.screenshot({ path: S + '03-proposal.png' });
  await p.screenshot({ path: S + '03b-proposal-full.png', fullPage: true });
  await p.click('[data-testid=btn-send]');
  await p.waitForSelector('[data-testid=delivery-row]');
  console.log('rows', await p.locator('[data-testid=delivery-row]').count(), 'wait', await p.locator('[data-testid=pill-wait]').count());
  await p.screenshot({ path: S + '04-sent-unacked.png' });
  await p.evaluate(() => fetch('/api/dev/ack-random', { method: 'POST' }));
  const t0 = Date.now();
  await p.waitForSelector('[data-testid=pill-ack]', { timeout: 4500 });
  console.log('ack visible after ms', Date.now() - t0);
  await p.waitForTimeout(300);
  await p.screenshot({ path: S + '05-acked.png' });
  // second message + failure
  await p.fill('[data-testid=raw-text]', 'テスト FAIL'); await p.click('[data-testid=submit-analyze]');
  await p.waitForSelector('[data-testid=proposal-failed]'); await p.screenshot({ path: S + '06-failed.png' });
  await p.click('[data-testid=sample-1]'); await p.click('[data-testid=submit-analyze]');
  await p.waitForSelector('[data-testid=recipient-card]'); await p.click('[data-testid=btn-send]');
  await p.waitForTimeout(3500);
  await p.screenshot({ path: S + '07-two-messages.png' });
  console.log('stats', await p.locator('[data-testid=stats]').innerText().then(t=>t.replace(/\n/g,' ')));
  console.log('badge', await p.textContent('[data-testid=analyzer-badge]'), '| conn', await p.textContent('[data-testid=conn-indicator]'));
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();

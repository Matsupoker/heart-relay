// E2E（Playwright）。先に `node web/dev/mock-server.mjs` を起動しておく（既定 http://localhost:8790）。
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8790/';
const S = __dirname + '/screenshots/';
fs.mkdirSync(S, { recursive: true });
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const T = (id) => `[data-testid=${id}]`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.goto(BASE); await p.waitForTimeout(800);
  await p.screenshot({ path: S + '01-initial.png' });

  // --- 入力者セレクト ---
  const opts = await p.locator(`${T('created-by')} option`).count();
  check('created-by は select（職員一覧）', opts >= 15, 'options=' + opts);
  await p.selectOption(T('created-by'), '田中 相談');
  await p.reload(); await p.waitForTimeout(600);
  check('入力者が localStorage で保持される', (await p.inputValue(T('created-by'))) === '田中 相談');
  check('共有ボードリンク', (await p.getAttribute(T('link-board'), 'href')) === '/board.html' && (await p.getAttribute(T('link-board'), 'target')) === '_blank');

  // --- 既存シナリオ（利用者特定なし→個別配信） ---
  await p.click(T('sample-0'));
  const [req0] = await Promise.all([p.waitForRequest(r => r.url().endsWith('/api/messages') && r.method() === 'POST'), p.click(T('submit-analyze'))]);
  check('created_by に氏名で送る', JSON.parse(req0.postData()).created_by === '田中 相談');
  await p.waitForSelector(T('proposal-loading')); await p.screenshot({ path: S + '02-loading.png' });
  await p.waitForSelector(T('recipient-card'));
  check('利用者特定なし表示', (await p.textContent(T('resident'))).includes('特定なし'));
  check('excluded-list と excluded-note', (await p.locator(`${T('excluded-list')} li`).count()) > 0 && (await p.locator(T('excluded-note')).count()) === 1);
  await p.selectOption(T('add-select'), 's01'); await p.click(T('btn-add'));
  await p.fill(`${T('recipient-card')}:last-child ${T('rcpt-title')}`, '所長への共有');
  await p.fill(`${T('recipient-card')}:last-child ${T('rcpt-body')}`, '参考共有です。');
  await p.fill(`${T('recipient-card')}:first-child ${T('rcpt-title')}`, '【編集済】A様 15時帰宅');
  await p.uncheck(`${T('recipient-card')}:nth-child(2) ${T('rcpt-check')}`);
  await p.evaluate(() => document.querySelector('.col-proposal').scrollTop = 0);
  await p.screenshot({ path: S + '03-proposal.png' });
  await p.screenshot({ path: S + '03b-proposal-full.png', fullPage: true });
  check('送信ボタン文言（個別のみ）', (await p.textContent(T('btn-send'))).includes('3名'), await p.textContent(T('btn-send')));
  const [sreq] = await Promise.all([p.waitForRequest(r => /\/send$/.test(r.url())), p.click(T('btn-send'))]);
  const sb = JSON.parse(sreq.postData());
  check('個別のみ: board_post=null', sb.board_post === null && sb.recipients.length === 3);
  await p.waitForSelector(T('delivery-row'));
  check('配信行 3', (await p.locator(T('delivery-row')).count()) === 3);
  check('board-badge なし', (await p.locator(T('board-badge')).count()) === 0);
  await p.screenshot({ path: S + '04-sent-unacked.png' });
  await p.evaluate(() => fetch('/api/dev/ack-random', { method: 'POST' }));
  await p.waitForSelector(T('pill-ack'), { timeout: 4500 });
  await p.waitForTimeout(300); await p.screenshot({ path: S + '05-acked.png' });

  // --- 失敗 ---
  await p.fill(T('raw-text'), 'テスト FAIL'); await p.click(T('submit-analyze'));
  await p.waitForSelector(T('proposal-failed')); await p.screenshot({ path: S + '06-failed.png' });

  // --- (a) 姓のみ → 候補選択 → 提案 ---
  await p.fill(T('raw-text'), '新田様のご家族より電話。体調不良のため明日は欠席とのこと。');
  await p.click(T('submit-analyze'));
  await p.waitForSelector(T('resident-candidate'));
  const nc = await p.locator(T('resident-candidate')).count();
  check('(a) 候補が複数', nc >= 3, 'n=' + nc);
  check('(a) 同姓同名バッジ', (await p.locator(T('same-name-badge')).count()) >= 2);
  check('(a) 提案は未表示', (await p.locator(T('recipient-card')).count()) === 0);
  await p.screenshot({ path: S + '07-candidates.png' });
  await p.click(`${T('resident-candidate')}[data-rid="0003"]`);
  await p.waitForSelector(T('proposal-loading'));
  await p.waitForSelector(T('recipient-card'));
  let rt = await p.textContent(T('resident'));
  check('(a) 選択した利用者が提案に出る', rt.includes('新田 健一') && rt.includes('0003') && rt.includes('欠席'), rt.replace(/\s+/g, ' ').slice(0, 80));
  await p.screenshot({ path: S + '08-resident-chosen.png' });
  // 利用者の変更（検索 → 再解析）
  await p.click(T('resident-change'));
  await p.fill(T('resident-search'), '山田');
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=resident-candidate]').length === 2);
  await p.click(`${T('resident-candidate')}[data-rid="0005"]`);
  await p.waitForSelector(T('recipient-card'));
  rt = await p.textContent(T('resident'));
  check('(a) 変更→再解析で山田 太郎', rt.includes('山田 太郎'));

  // --- (b) 利用者に関係しない ---
  await p.fill(T('raw-text'), '新田様の件ではなく、全般の連絡です。来週の避難訓練の案内。');
  await p.click(T('submit-analyze'));
  await p.waitForSelector(T('resident-none'));
  await p.click(T('resident-none'));
  await p.waitForSelector(T('recipient-card'));
  check('(b) 利用者に関係しない → 特定なし', (await p.textContent(T('resident'))).includes('特定なし'));

  // --- (c) ファイル添付 → 抽出反映 → 解析 ---
  await p.fill(T('raw-text'), '【FAX】ケアマネより');
  await p.setInputFiles(T('file-input'), { name: 'fax-scan.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector(T('extract-panel'));
  check('(c) 抽出パネル', (await p.textContent(T('extract-panel'))).includes('fax-scan.png') && (await p.textContent(T('extract-method'))).includes('Claude'));
  check('(c) 警告表示', (await p.locator(T('extract-warnings')).count()) === 1);
  await p.waitForFunction(() => { const i = document.querySelector('[data-testid=extract-preview]'); return i && i.complete && i.naturalWidth > 0; });
  check('(c) 画像プレビュー', true);
  const ex = await p.inputValue(T('extract-text'));
  check('(c) 抽出テキスト', ex.includes('新田 洋子'));
  await p.fill(T('extract-text'), ex + '\n（職員追記）');
  await p.screenshot({ path: S + '09-extract.png' });
  await p.click(T('extract-apply'));
  const raw = await p.inputValue(T('raw-text'));
  check('(c) 既存文の末尾に追記', raw.startsWith('【FAX】ケアマネより') && raw.includes('職員追記'));
  check('(c) 添付チップ', (await p.locator(T('attachment-chip')).count()) === 1);
  check('(c) 情報源が自動変更', (await p.inputValue(T('source'))) === '書類（ファイル）');
  const [req1] = await Promise.all([p.waitForRequest(r => r.url().endsWith('/api/messages') && r.method() === 'POST'), p.click(T('submit-analyze'))]);
  const b1 = JSON.parse(req1.postData());
  check('(c) attachment_ids を送信', Array.isArray(b1.attachment_ids) && b1.attachment_ids.length === 1 && b1.source === '書類（ファイル）');
  await p.waitForSelector(T('resident-candidate'));  // 新田 洋子 は同姓同名2名
  check('(c) 同姓同名は自動確定されない', (await p.locator(T('same-name-badge')).count()) === 2);
  await p.click(`${T('resident-candidate')}[data-rid="0001"]`);
  await p.waitForSelector(T('recipient-card'));
  check('(c) 解析後チップが消える', (await p.locator(T('attachment-chip')).count()) === 0);
  // 添付チップの削除
  await p.setInputFiles(T('file-input'), { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('テスト') });
  await p.waitForSelector(T('extract-panel'));
  check('(c) txt はローカル抽出', (await p.textContent(T('extract-method'))).includes('ローカル'));
  await p.click(T('extract-apply'));
  await p.click(T('attachment-remove'));
  check('(c) チップ削除', (await p.locator(T('attachment-chip')).count()) === 0);
  await p.setInputFiles(T('file-input'), { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await p.waitForSelector(`${T('toast')}`);
  check('(c) 非対応形式はエラー表示', (await p.locator(T('toast')).last().textContent()).includes('取り込みに失敗'));

  // --- (d) audience=both で board_post 付き送信 ---
  await p.fill(T('raw-text'), '明日午前、送迎車2号車を点検に出します。全員に共有してください。');
  await p.click(T('submit-analyze'));
  await p.waitForSelector(T('audience'));
  check('(d) audience=both 初期値', await p.isChecked(T('audience-both')));
  check('(d) board 編集欄', (await p.locator(T('board-title')).count()) === 1);
  check('(d) 送信ボタン（両方）', (await p.textContent(T('btn-send'))).includes('共有ボード'), await p.textContent(T('btn-send')));
  await p.check(T('audience-board'));
  check('(d) 共有のみ → 宛先非表示', (await p.locator(T('recipient-card')).count()) === 0 && (await p.textContent(T('btn-send'))).includes('共有ボード'));
  await p.check(T('audience-individual'));
  check('(d) 個別のみ → board非表示', (await p.locator(T('board-title')).count()) === 0);
  await p.check(T('audience-both'));
  await p.fill(T('board-title'), '【編集】明日午前は1号車のみ');
  await p.fill(T('board-until'), '2099-12-31T17:00');
  await p.screenshot({ path: S + '10-audience-both.png' });
  await p.screenshot({ path: S + '10b-audience-both-full.png', fullPage: true });
  const [sreq2] = await Promise.all([p.waitForRequest(r => /\/send$/.test(r.url())), p.click(T('btn-send'))]);
  const sb2 = JSON.parse(sreq2.postData());
  check('(d) /send に board_post と recipients', sb2.board_post && sb2.board_post.title === '【編集】明日午前は1号車のみ' && sb2.board_post.until.startsWith('2099-12-31T08:00') && sb2.recipients.length === 2, JSON.stringify(sb2.board_post));
  await p.waitForSelector(T('board-badge'));
  check('(d) 状況パネルに掲示中バッジ', (await p.textContent(T('board-badge'))).includes('掲示中'));
  const board = await p.evaluate(() => fetch('/api/board').then(r => r.json()));
  check('(d) /api/board に掲示', board.length === 1 && board[0].title.includes('編集'));
  await p.screenshot({ path: S + '11-sent-both.png' });
  // 共有のみ送信
  await p.fill(T('raw-text'), '明日午前、送迎車を点検に出します。共有のみお願いします。');
  await p.click(T('submit-analyze')); await p.waitForSelector(T('audience'));
  await p.check(T('audience-board'));
  const [sreq3] = await Promise.all([p.waitForRequest(r => /\/send$/.test(r.url())), p.click(T('btn-send'))]);
  const sb3 = JSON.parse(sreq3.postData());
  check('(d) 共有のみ: recipients=[]', Array.isArray(sb3.recipients) && sb3.recipients.length === 0 && !!sb3.board_post);
  await p.waitForTimeout(3500);
  console.log('stats', (await p.locator(T('stats')).innerText()).replace(/\n/g, ' '));
  await p.screenshot({ path: S + '12-final-desktop.png' });
  check('PC幅でタブは非表示', !(await p.isVisible(T('tab-input'))));

  // --- (e) スマホ 390x844 ---
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  m.on('pageerror', e => errs.push('mobile:' + e.message)); m.on('dialog', d => d.accept());
  await m.goto(BASE); await m.waitForTimeout(800);
  const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('(e) タブ表示', await m.isVisible(T('tab-input')) && await m.isVisible(T('tab-proposal')) && await m.isVisible(T('tab-status')));
  check('(e) 初期は入力のみ', await m.isVisible(T('raw-text')) && !(await m.isVisible(T('proposal-panel'))) && !(await m.isVisible(T('stats'))));
  check('(e) 横スクロールなし(入力)', (await overflow()) <= 0, 'overflow=' + await overflow());
  await m.screenshot({ path: S + '20-mobile-input.png' });
  await m.screenshot({ path: S + '20b-mobile-input-full.png', fullPage: true });
  const small = await m.evaluate(() => [...document.querySelectorAll('button,.btn,select,input:not([type=file]):not([type=radio]):not([type=checkbox]),textarea,.tab')].filter(e => e.offsetParent && !e.closest('.quick') ).map(e => ({ t: e.dataset.testid || e.id || e.className, h: Math.round(e.getBoundingClientRect().height), f: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.h < 44 || x.f < 16));
  check('(e) 入力画面: 高さ44px以上・文字16px以上', small.length === 0, JSON.stringify(small));
  await m.click(T('tab-status'));
  check('(e) 状況タブ', await m.isVisible(T('stats')) && !(await m.isVisible(T('raw-text'))));
  await m.screenshot({ path: S + '21-mobile-status.png' });
  await m.click(T('tab-input'));
  await m.fill(T('raw-text'), '新田様のご家族より。明日は欠席です。');
  await m.click(T('submit-analyze'));
  await m.waitForSelector(T('resident-candidate'));
  check('(e) 候補選択待ちで自動的に提案タブ', await m.isVisible(T('resident-candidate')) && !(await m.isVisible(T('raw-text'))));
  check('(e) 横スクロールなし(候補)', (await overflow()) <= 0);
  await m.screenshot({ path: S + '22-mobile-candidates.png' });
  await m.click(`${T('resident-candidate')}[data-rid="0001"]`);
  await m.waitForSelector(T('recipient-card'));
  check('(e) 提案表示', await m.isVisible(T('summary')) && await m.isVisible(T('resident')));
  check('(e) 横スクロールなし(提案)', (await overflow()) <= 0, 'overflow=' + await overflow());
  await m.screenshot({ path: S + '23-mobile-proposal.png' });
  await m.screenshot({ path: S + '23b-mobile-proposal-full.png', fullPage: true });
  const small2 = await m.evaluate(() => [...document.querySelectorAll('.col-proposal button,.col-proposal select,.col-proposal input:not([type=radio]):not([type=checkbox]),.col-proposal textarea,.aud-opt')].filter(e => e.offsetParent).map(e => ({ t: e.dataset.testid || e.id || e.className, h: Math.round(e.getBoundingClientRect().height), f: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.h < 44 || x.f < 16));
  check('(e) 提案画面: 高さ44px以上・文字16px以上', small2.length === 0, JSON.stringify(small2));
  await m.check(T('audience-both'));
  await m.fill(T('board-title'), '掲示テスト');
  await m.fill(T('board-body'), '掲示本文テスト');
  await m.evaluate(() => document.querySelector('[data-testid=board-edit]').scrollIntoView());
  await m.screenshot({ path: S + '24-mobile-board.png' });
  await m.click(T('btn-send'));
  await m.waitForSelector(T('delivery-row'));
  check('(e) 配信後は状況タブへ', await m.isVisible(T('stats')) && await m.isVisible(T('board-badge')));
  check('(e) 横スクロールなし(状況)', (await overflow()) <= 0);
  await m.screenshot({ path: S + '25-mobile-sent.png' });
  await m.screenshot({ path: S + '25b-mobile-sent-full.png', fullPage: true });

  console.log('errors', JSON.stringify(errs));
  check('JSエラーなし', errs.length === 0);
  console.log(fails ? `\n${fails} 件失敗` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

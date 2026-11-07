// E2E（Playwright）。先に `node web/dev/mock-server.mjs` を起動しておく（既定 http://localhost:8790）。
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8790/';
const S = __dirname + '/screenshots/';
fs.mkdirSync(S + 'ui/', { recursive: true });
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
  check('既定ルートは #/home', await p.isVisible(T('view-home')) && !(await p.isVisible(T('view-new'))));
  check('ナビ: ホームがハイライト', (await p.getAttribute(T('nav-home'), 'aria-current')) === 'page');
  check('ヘッダの事業所セレクト（既定 A・架空名）', (await p.inputValue(T('office-select'))) === 'A' && (await p.$eval(T('office-select'), e => e.selectedOptions[0].textContent)).includes('デイサービス'));
  check('日付表示（JST）', /^\s*\d{4}年\d{1,2}月\d{1,2}日（.）\s*$/.test(await p.textContent(T('today-label'))));
  check('ベル/再通知は無い', !(await p.content()).includes('再通知'));
  check('PC幅でタブバー非表示', !(await p.isVisible(T('tabbar'))));
  check('共有ボードリンク', (await p.getAttribute(T('nav-board'), 'href')) === '/board.html' && (await p.getAttribute(T('nav-board'), 'target')) === '_blank');
  check('ホーム: 件数0（空）', (await p.textContent(`${T('home-stat-sent')} b`)) === '0' && (await p.locator(T('home-row')).count()) === 0);
  await p.screenshot({ path: S + '01-initial.png' });
  // ホームの副導線
  await p.click(T('home-text')); await p.waitForURL(/#\/new$/); await p.waitForTimeout(100);
  check('文章を入力 → #/new で本文にフォーカス', p.url().endsWith('#/new') && await p.evaluate(() => document.activeElement && document.activeElement.id === 'raw-text'));
  await p.click(T('nav-home'));
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(T('home-file'))]);
  check('ファイル・写真を取り込む → #/new でファイル選択', p.url().endsWith('#/new') && !!fc);
  await p.goBack().catch(() => {}); await p.goto(BASE + '#/home');
  await p.click(T('home-cta')); await p.waitForURL(/#\/new$/); await p.waitForSelector(T('raw-text'), { state: 'visible' });
  check('新しい連絡を作成 → #/new', p.url().endsWith('#/new') && await p.isVisible(T('raw-text')));

  // --- 入力者セレクト ---
  const opts = await p.locator(`${T('created-by')} option`).count();
  check('created-by は select（職員一覧）', opts >= 15, 'options=' + opts);
  await p.selectOption(T('created-by'), '田中 相談');
  await p.reload(); await p.waitForTimeout(600);
  await p.goto(BASE + '#/new'); await p.waitForTimeout(300);
  check('入力者が localStorage で保持される', (await p.inputValue(T('created-by'))) === '田中 相談');

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
  await p.screenshot({ path: S + '03-proposal.png' });
  await p.screenshot({ path: S + '03b-proposal-full.png', fullPage: true });
  check('送信ボタン文言（個別のみ）', (await p.textContent(T('btn-send'))).includes('3名'), await p.textContent(T('btn-send')));
  const [sreq] = await Promise.all([p.waitForRequest(r => /\/send$/.test(r.url())), p.click(T('btn-send'))]);
  const sb = JSON.parse(sreq.postData());
  check('個別のみ: board_post=null', sb.board_post === null && sb.recipients.length === 3);
  await p.waitForFunction(() => location.hash.startsWith('#/deliveries/'));
  await p.waitForSelector(T('delivery-row'));
  check('配信後 #/deliveries/<id> へ遷移・トースト', await p.isVisible(T('dl-detail')) && (await p.textContent(T('toast'))).includes('配信しました'));
  check('配信詳細: 役割・担当者・理由', (await p.locator(T('dl-recipient-row')).count()) === 3 && (await p.locator(T('dl-reason')).first().textContent()).trim().length > 1);
  check('進捗: 4ステップ・最終は確認完了で未達', (await p.locator(T('dl-step')).count()) === 4 && (await p.locator(`${T('dl-step')}[data-done="1"]`).count()) === 3);
  check('除外職員は折りたたみ', (await p.locator(`${T('excluded-details')}[open]`).count()) === 0 && (await p.locator(T('excluded-details')).count()) === 1);
  check('配信行 3', (await p.locator(T('delivery-row')).count()) === 3);
  check('board-badge なし', (await p.locator(T('board-badge')).count()) === 0);
  await p.screenshot({ path: S + '04-sent-unacked.png' });
  await p.evaluate(() => fetch('/api/dev/ack-random', { method: 'POST' }));
  await p.waitForSelector(T('pill-ack'), { timeout: 4500 });
  await p.waitForTimeout(300); await p.screenshot({ path: S + '05-acked.png' });

  await p.click(T('nav-new'));
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

  // --- (c2) 取り込み失敗時の表示と再操作 ---
  {
    await p.fill(T('raw-text'), '入力済みの本文です');
    await p.selectOption(T('source'), '電話');
    await p.selectOption(T('created-by'), '田中 相談');
    const keep = async (label) => check(`(c2) ${label}: 本文・情報源・入力者が保持`, (await p.inputValue(T('raw-text'))) === '入力済みの本文です' && (await p.inputValue(T('source'))) === '電話' && (await p.inputValue(T('created-by'))) === '田中 相談');
    const lastToast = async () => (await p.locator(T('toast')).last().textContent()) || '';
    const F = { name: 'retry.png', mimeType: 'image/png', buffer: PNG };
    // 1. 通信失敗 → 同じファイルで再試行
    await p.route('**/api/intake', (r) => r.abort());
    await p.setInputFiles(T('file-input'), F);
    await p.waitForSelector(T('toast'));
    check('(c2) 通信失敗: 失敗表示', (await lastToast()).includes('取り込みに失敗しました'), await lastToast());
    check('(c2) 通信失敗: 抽出パネルなし・読み取り中表示が消える', (await p.locator(T('extract-panel')).count()) === 0 && (await p.locator(T('intake-loading')).count()) === 0);
    await keep('通信失敗');
    check('(c2) 通信失敗: file-input の value が空（同じファイルを再選択可）', (await p.inputValue(T('file-input'))) === '');
    await p.unroute('**/api/intake');
    await p.setInputFiles(T('file-input'), F);   // 同じファイルをもう一度
    await p.waitForSelector(T('extract-panel'));
    check('(c2) 通信失敗: 同じファイルの再選択で抽出パネルが出る', (await p.textContent(T('extract-filename'))) === 'retry.png');
    await keep('再試行成功');
    await p.click(T('extract-discard'));
    // 2/5. サーバーエラー・429・413・415 の文言
    const cases = [
      [500, { error: 'サーバー内部エラー（テスト）' }, '500'],
      [429, { error: 'リクエストが多すぎます。しばらくしてからお試しください', code: 'rate_limited' }, '429'],
      [413, { error: 'ファイルが大きすぎます（上限 10MB）', code: 'too_large' }, '413'],
      [415, { error: '対応していないファイル形式です', code: 'unsupported' }, '415'],
    ];
    for (const [status, body, label] of cases) {
      await p.route('**/api/intake', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
      const n = await p.locator(T('toast')).count();
      await p.setInputFiles(T('file-input'), F);
      await p.waitForFunction((n) => document.querySelectorAll('[data-testid=toast]').length > n, n);
      check(`(c2) ${label}: サーバーの error 文言を表示`, (await lastToast()).includes(body.error), await lastToast());
      check(`(c2) ${label}: パネルなし・再選択可`, (await p.locator(T('extract-panel')).count()) === 0 && (await p.inputValue(T('file-input'))) === '');
      await keep(label);
      await p.unroute('**/api/intake');
    }
    // 4. 転記結果の修正が反映される
    await p.setInputFiles(T('file-input'), F);
    await p.waitForSelector(T('extract-panel'));
    await p.fill(T('extract-text'), '修正後の転記テキスト（職員が訂正）');
    await p.click(T('extract-apply'));
    const rt = await p.inputValue(T('raw-text'));
    check('(c2) 編集後の文字列が本文に入る', rt.includes('修正後の転記テキスト（職員が訂正）') && rt.startsWith('入力済みの本文です') && !rt.includes('FAX受信'), rt);
    const [rq] = await Promise.all([p.waitForRequest((r) => r.url().endsWith('/api/messages') && r.method() === 'POST'), p.click(T('submit-analyze'))]);
    const bq = JSON.parse(rq.postData());
    check('(c2) POST /api/messages の raw_text に編集後内容・attachment_ids', bq.raw_text.includes('修正後の転記テキスト（職員が訂正）') && !bq.raw_text.includes('FAX受信') && Array.isArray(bq.attachment_ids) && bq.attachment_ids.length === 1, JSON.stringify(bq));
    await p.waitForSelector(`${T('recipient-card')}, ${T('resident-candidate')}, ${T('resident-none')}`);
    await p.goto(BASE + '#/new'); await p.waitForSelector(T('raw-text'), { state: 'visible' });
  }

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
  check('(d) 配信詳細に掲示中バッジ', (await p.textContent(T('board-badge'))).includes('掲示中'));
  check('(d) 配信成功後に入力欄・チップ・抽出パネルが初期化', (await p.inputValue(T('raw-text'))) === '' && (await p.locator(T('attachment-chip')).count()) === 0 && (await p.locator(T('extract-panel')).count()) === 0 && (await p.inputValue(T('source'))) === '手入力');
  const board = await p.evaluate(() => fetch('/api/board').then(r => r.json()));
  check('(d) /api/board に掲示', board.length === 1 && board[0].title.includes('編集'));
  await p.screenshot({ path: S + '11-sent-both.png' });
  // 共有のみ送信
  await p.click(T('nav-new'));
  await p.fill(T('raw-text'), '明日午前、送迎車を点検に出します。共有のみお願いします。');
  await p.click(T('submit-analyze')); await p.waitForSelector(T('audience'));
  await p.check(T('audience-board'));
  const [sreq3] = await Promise.all([p.waitForRequest(r => /\/send$/.test(r.url())), p.click(T('btn-send'))]);
  const sb3 = JSON.parse(sreq3.postData());
  check('(d) 共有のみ: recipients=[]', Array.isArray(sb3.recipients) && sb3.recipients.length === 0 && !!sb3.board_post);
  await p.waitForFunction(() => location.hash.startsWith('#/deliveries/'));
  check('共有のみ: 詳細に表なし・掲示中', (await p.locator(T('dl-recipient-row')).count()) === 0 && (await p.locator(T('board-badge')).count()) === 1);
  await p.screenshot({ path: S + '12-final-desktop.png' });
  // --- ホーム集計 / 配信管理 ---
  await p.click(T('nav-home')); await p.waitForTimeout(3300);
  const sent = +(await p.textContent(`${T('home-stat-sent')} b`)), un = +(await p.textContent(`${T('home-stat-unacked')} b`)), ak = +(await p.textContent(`${T('home-stat-acked')} b`));
  const api = await p.evaluate(() => fetch('/api/stats').then(r => r.json()));
  check('ホーム件数が /api/stats と一致', sent === api.deliveries && un === api.unacked && ak === api.acked && sent === un + ak, `${sent}/${un}/${ak} vs ${JSON.stringify(api)}`);
  check('ホーム行は連絡ごと(3件)', (await p.locator(T('home-row')).count()) === 3, 'n=' + await p.locator(T('home-row')).count());
  await p.screenshot({ path: S + '12b-home.png', fullPage: true });
  await p.locator(T('home-row-link')).first().click();
  await p.waitForFunction(() => /^#\/deliveries\/.+/.test(location.hash));
  await p.waitForTimeout(200);
  check('配信状況を見る → 配信詳細', await p.isVisible(T('dl-detail')) && (await p.getAttribute(T('nav-deliveries'), 'aria-current')) === 'page');
  check('一覧の選択ハイライト', (await p.locator(`${T('dl-list-item')}.on`).count()) === 1);
  await p.click(T('dl-filter-all'));
  check('「すべて」トグル', (await p.locator(T('dl-list-item')).count()) === 3);
  await p.click(`${T('dl-list-item')} >> nth=1`);
  await p.waitForFunction(() => /^#\/deliveries\/.+/.test(location.hash));
  check('一覧クリックで詳細切替', (await p.locator(`${T('dl-list-item')}.on`).count()) === 1);
  await p.goto(BASE + '#/deliveries'); await p.waitForTimeout(800);
  check('#/deliveries はPCで先頭を詳細表示', await p.isVisible(T('dl-detail')) && (await p.locator(T('dl-title')).count()) === 1);
  // 全員確認 → 確認完了
  await p.evaluate(async () => { for (let i = 0; i < 20; i++) await fetch('/api/dev/ack-random', { method: 'POST' }); });
  await p.waitForTimeout(3500);
  check('全員確認で最終ステップ達成', await p.evaluate(() => [...document.querySelectorAll('[data-testid=sent-message]')].some(e => e.dataset.allAcked === '1' && e.querySelectorAll('[data-testid=dl-step][data-done="1"]').length === 4)));
  await p.screenshot({ path: S + '12-final-desktop.png' });


  // --- (f) 法人内連絡（Issue #2）---
  const dlg = []; p.on('dialog', d => dlg.push(d.message()));
  await p.goto(BASE + '#/home'); await p.waitForTimeout(900);
  check('(f) 事業所セレクト 3件（A/B/C）', (await p.locator(`${T('office-select')} option`).count()) === 3);
  await p.click(T('nav-corp')); await p.waitForSelector(T('view-corp'), { state: 'visible' });
  check('(f) ナビ「法人内連絡」→ #/corp', p.url().endsWith('#/corp') && (await p.getAttribute(T('nav-corp'), 'aria-current')) === 'page');
  check('(f) 送信先は自事業所以外（B, C）', JSON.stringify(await p.$$eval(`${T('corp-to')} option`, o => o.map(x => x.value))) === '["B","C"]');
  check('(f) 受信・送信履歴は空状態の文言', await p.isVisible(T('corp-inbox-empty')) && await p.isVisible(T('corp-outbox-empty')));
  await p.selectOption(T('corp-to'), 'B');
  const nsrc = await p.locator(`${T('corp-source')} option`).count();
  check('(f) 内容の元に A の配信済み連絡が並ぶ', nsrc === 4, 'n=' + nsrc);
  await p.selectOption(T('corp-source'), { index: 1 });
  const srcId = await p.inputValue(T('corp-source'));
  const srcBody = await p.inputValue(T('corp-body'));
  check('(f) 既存の連絡を選ぶと本文に要約が入る', srcBody.length > 10 && !/除外|宛先/.test(srcBody), srcBody.replace(/\n/g, ' / ').slice(0, 70));
  // 失敗表示
  await p.fill(T('corp-body'), 'DRAFTFAIL 要点');
  await p.click(T('corp-draft'));
  check('(f) 作成中表示・ボタン無効', await p.isVisible(T('corp-draft-busy')) && await p.isDisabled(T('corp-draft')));
  await p.waitForSelector(T('corp-draft-error'));
  check('(f) 失敗時はエラー表示・入力は保持', (await p.inputValue(T('corp-body'))).includes('DRAFTFAIL') && !(await p.isDisabled(T('corp-draft'))));
  await p.fill(T('corp-body'), srcBody);
  // AI 文面支援
  const [dreq] = await Promise.all([p.waitForRequest(r => /office-messages\/draft$/.test(r.url())), p.click(T('corp-draft'))]);
  const db = JSON.parse(dreq.postData());
  check('(f) /draft に from/to/source/notes を送る', db.from_office_id === 'A' && db.to_office_id === 'B' && db.source_message_id === srcId && db.notes === srcBody);
  await p.waitForFunction(() => document.querySelector('[data-testid=corp-title]').value.startsWith('【ご連絡】'));
  check('(f) 確認ダイアログ後に件名・本文が案に置き換わる', dlg.some(x => x.startsWith('この案を反映しますか？')) && (await p.inputValue(T('corp-body'))).includes('ご確認のほどよろしく') && !(await p.inputValue(T('corp-body'))).includes(srcBody));
  check('(f) 案の反映だけでは送信されない', (await p.evaluate(() => fetch('/api/office-messages?office=A').then(r => r.json()))).outbox.length === 0);
  await p.fill(T('corp-body'), (await p.inputValue(T('corp-body'))) + '\n（職員追記：電話でも連絡済みです）');
  await p.fill(T('corp-title'), '【編集済】送迎の変更について');
  const [oreq] = await Promise.all([p.waitForRequest(r => /\/api\/office-messages$/.test(r.url()) && r.method() === 'POST'), p.click(T('corp-send'))]);
  const ob = JSON.parse(oreq.postData());
  check('(f) 送信 payload', ob.from_office_id === 'A' && ob.to_office_id === 'B' && ob.title === '【編集済】送迎の変更について' && ob.body.includes('職員追記') && ob.source_message_id === srcId && ob.created_by === '田中 相談', JSON.stringify(ob).slice(0, 120));
  check('(f) 送信前の確認ダイアログに送信先と件名', dlg.some(x => x.includes('老健 やすらぎ') && x.includes('【編集済】送迎の変更について')));
  await p.waitForSelector(T('corp-outbox-item'));
  check('(f) 送信履歴に表示・未確認', (await p.textContent(T('corp-outbox'))).includes('老健 やすらぎ') && (await p.textContent(T('corp-status'))).includes('未確認'));
  check('(f) トーストとフォーム初期化', (await p.locator(T('toast')).last().textContent()).includes('送信しました') && (await p.inputValue(T('corp-title'))) === '' && (await p.inputValue(T('corp-body'))) === '' && (await p.inputValue(T('corp-source'))) === '');
  await p.screenshot({ path: S + 'ui/corp-1440.png', fullPage: true });
  // B に切替
  await p.selectOption(T('office-select'), 'B');
  await p.waitForSelector(T('corp-inbox-item'));
  check('(f) B の受信に表示・未確認バッジ', (await p.textContent(T('corp-inbox'))).includes('【編集済】送迎の変更について') && (await p.locator(T('corp-unacked')).count()) === 1 && (await p.textContent(T('corp-nav-badge'))) === '1');
  check('(f) 職員 select が B の職員に切替', (await p.locator(`${T('created-by')} option`).allTextContents()).some(x => x.includes('青木 相談')) && !(await p.locator(`${T('created-by')} option`).allTextContents()).some(x => x.includes('田中 相談')));
  check('(f) 共有ボードリンクが B', (await p.getAttribute(T('nav-board'), 'href')) === '/board.html?office=B');
  await p.reload(); await p.waitForTimeout(900);
  check('(f) 事業所の選択が localStorage で保持', (await p.inputValue(T('office-select'))) === 'B' && p.url().endsWith('#/corp'));
  const [areq] = await Promise.all([p.waitForRequest(r => /office-messages\/[^/]+\/ack$/.test(r.url())), p.click(T('corp-ack'))]);
  check('(f) ack に操作者名', JSON.parse(areq.postData()).staff_name.length > 0, areq.postData());
  await p.waitForSelector(T('corp-acked'));
  check('(f) 確認済になりボタンが消える', (await p.locator(T('corp-ack')).count()) === 0 && (await p.locator(T('corp-nav-badge')).isHidden()));
  // B の配信管理・ホーム・ボード・stats に A の連絡が出ない
  await p.click(T('nav-deliveries')); await p.click(T('dl-filter-all')); await p.waitForTimeout(300);
  const dlB = await p.locator(T('sent-list')).textContent();
  check('(f) B の配信管理に A の連絡が無い', (await p.locator(T('dl-list-item')).count()) === 1 && !dlB.includes('新田') && !dlB.includes('送迎'), dlB.replace(/\s+/g, ' ').slice(0, 60));
  await p.click(T('nav-home')); await p.waitForTimeout(400);
  const homeB = await p.locator(T('sent-today')).textContent();
  check('(f) B のホームは B の連絡のみ', (await p.locator(T('home-row')).count()) === 1 && homeB.includes('[B]'), homeB.replace(/\s+/g, ' ').slice(0, 60));
  const bp = await b.newPage(); await bp.goto(BASE + 'board.html?office=B'); await bp.waitForSelector('[data-testid=board-post]');
  const bt = await bp.locator('[data-testid=board-post]').allTextContents();
  check('(f) board.html?office=B は B の掲示のみ', bt.length === 1 && bt[0].includes('[B]'), bt.join('|').slice(0, 60));
  await bp.goto(BASE + 'board.html?office=A'); await bp.waitForSelector('[data-testid=board-post]');
  check('(f) board.html?office=A は A の掲示のみ', (await bp.locator('[data-testid=board-post]').allTextContents()).every(t => !t.includes('[B]') && !t.includes('[C]')));
  await bp.close();
  const stB = await p.evaluate(() => fetch('/api/stats?office=B').then(r => r.json()));
  check('(f) /api/stats?office=B は B のみ', stB.messages === 1);
  // A に戻る
  await p.selectOption(T('office-select'), 'A'); await p.click(T('nav-corp'));
  await p.waitForSelector(T('corp-outbox-item'));
  check('(f) A に戻ると送信履歴が確認済', (await p.textContent(T('corp-status'))).includes('確認済') && (await p.getAttribute(`${T('corp-outbox-item')}`, 'data-acked')) === '1');
  check('(f) A のホームは A の連絡のみ', await (async () => { await p.click(T('nav-home')); await p.waitForTimeout(400); return (await p.locator(T('home-row')).count()) === 3 && !(await p.locator(T('sent-today')).textContent()).includes('[B]'); })());

  // --- (e) スマホ 390x844 ---
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  m.on('pageerror', e => errs.push('mobile:' + e.message)); m.on('dialog', d => d.accept());
  await m.goto(BASE); await m.waitForTimeout(1200);
  const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const small = (sel) => m.evaluate((sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => ({ t: e.dataset.testid || e.id || e.className, h: Math.round(e.getBoundingClientRect().height), f: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.h < 44 || x.f < 16), sel);
  check('(e) 下部タブ表示・サイドナビ非表示', await m.isVisible(T('tab-corp')) && await m.isVisible(T('tab-home')) && await m.isVisible(T('tab-new')) && await m.isVisible(T('tab-deliveries')) && await m.isVisible(T('link-board')) && !(await m.isVisible(T('sidenav'))));
  check('(e) ホーム表示・横スクロールなし', await m.isVisible(T('view-home')) && (await overflow()) <= 0, 'overflow=' + await overflow());
  let sm = await small('.btn-new,.hero-cta,.hero-alt a,.more,.hr-link,.operator select,.tabbar a');
  check('(e) ホーム: 44px以上・16px以上', sm.length === 0, JSON.stringify(sm));
  await m.screenshot({ path: S + '20-mobile-home.png', fullPage: true });
  await m.click(T('tab-new')); await m.waitForURL(/#\/new$/); await m.waitForSelector(T('raw-text'), { state: 'visible' });
  check('(e) 新規タブ → #/new', m.url().endsWith('#/new') && await m.isVisible(T('raw-text')));
  check('(e) 横スクロールなし(入力)', (await overflow()) <= 0, 'overflow=' + await overflow());
  sm = await small('.col-input button,.col-input .btn,.col-input select,.col-input input:not([type=file]),.col-input textarea,.quick button');
  check('(e) 入力画面: 44px以上・16px以上', sm.length === 0, JSON.stringify(sm));
  await m.screenshot({ path: S + '21-mobile-new.png', fullPage: true });
  await m.fill(T('raw-text'), '新田様のご家族より。明日は欠席です。');
  await m.click(T('submit-analyze'));
  await m.waitForSelector(T('resident-candidate'));
  check('(e) 候補選択が見える', await m.isVisible(T('resident-candidate')));
  check('(e) 横スクロールなし(候補)', (await overflow()) <= 0);
  await m.click(`${T('resident-candidate')}[data-rid="0001"]`);
  await m.waitForSelector(T('recipient-card'));
  check('(e) 提案表示', await m.isVisible(T('summary')) && await m.isVisible(T('resident')));
  check('(e) 横スクロールなし(提案)', (await overflow()) <= 0, 'overflow=' + await overflow());
  sm = await small('.col-proposal button,.col-proposal select,.col-proposal input:not([type=radio]):not([type=checkbox]),.col-proposal textarea,.aud-opt');
  check('(e) 提案画面: 44px以上・16px以上', sm.length === 0, JSON.stringify(sm));
  await m.check(T('audience-both'));
  await m.fill(T('board-title'), '掲示テスト');
  await m.fill(T('board-body'), '掲示本文テスト');
  await m.screenshot({ path: S + '23-mobile-proposal.png', fullPage: true });
  await m.click(T('btn-send'));
  await m.waitForSelector(T('delivery-row'));
  check('(e) 配信後は配信詳細へ（一覧は隠れ、戻る導線）', await m.isVisible(T('dl-detail')) && !(await m.isVisible(T('dl-list-item') + ' >> nth=0').catch(() => false)) && await m.isVisible(T('dl-back')) && await m.isVisible(T('board-badge')));
  check('(e) 横スクロールなし(詳細)', (await overflow()) <= 0, 'overflow=' + await overflow());
  sm = await small('.dl-detail-pane a,.dl-detail-pane summary,.dl-detail-pane td,.dl-detail-pane li');
  check('(e) 詳細: 16px以上', sm.every(x => x.f >= 16), JSON.stringify(sm.filter(x => x.f < 16)));
  await m.screenshot({ path: S + '25-mobile-detail.png', fullPage: true });
  await m.click(T('dl-back')); await m.waitForURL(/#\/deliveries$/); await m.waitForTimeout(100);
  check('(e) 戻る → 一覧のみ', m.url().endsWith('#/deliveries') && await m.isVisible(T('dl-list-item') + ' >> nth=0') && !(await m.isVisible(T('dl-detail'))));
  sm = await small('.dl-item,.seg button');
  check('(e) 一覧: 44px以上', sm.length === 0, JSON.stringify(sm));
  await m.click(T('tab-new')); await m.waitForURL(/#\/new$/); await m.click(T('tab-deliveries')); await m.waitForURL(/#\/deliveries$/);
  check('(e) タブ往復', m.url().endsWith('#/deliveries'));
  check('(e) 横スクロールなし(一覧)', (await overflow()) <= 0);

  // --- (f) スマホで #/corp ---
  await m.click(T('tab-corp')); await m.waitForURL(/#\/corp$/); await m.waitForSelector(T('corp-title'), { state: 'visible' });
  check('(f) 法人内タブ → #/corp・横スクロールなし', m.url().endsWith('#/corp') && (await overflow()) <= 0, 'overflow=' + await overflow());
  await m.selectOption(T('corp-to'), 'C'); await m.fill(T('corp-title'), 'スマホからの連絡'); await m.fill(T('corp-body'), '本文テストです。');
  sm = await small('.corp-form button,.corp-form select,.corp-form input,.corp-form textarea,.facility select,.corp-ack');
  check('(f) 法人内フォーム: 44px以上・16px以上', sm.length === 0, JSON.stringify(sm));
  await m.click(T('corp-send'));
  // 送信履歴には直前の PC シナリオ(A→B)の項目が既にあるため、項目の存在ではなく今回の件名が現れるまで待つ
  await m.waitForFunction((id) => (document.querySelector(`[data-testid=${id}]`) || {}).textContent?.includes('スマホからの連絡'), 'corp-outbox', { timeout: 5000 }).catch(() => {});
  check('(f) スマホで送信でき履歴に出る', (await m.textContent(T('corp-outbox'))).includes('スマホからの連絡'), (await m.textContent(T('corp-outbox'))).replace(/\s+/g, ' ').slice(0, 80));
  sm = await small('.corp-box .corp-meta,.corp-box .corp-body,.corp-box .corp-badge');
  check('(f) 履歴: 16px以上', sm.every(x => x.f >= 16), JSON.stringify(sm.filter(x => x.f < 16)));
  check('(f) 横スクロールなし(履歴)', (await overflow()) <= 0, 'overflow=' + await overflow());
  await m.screenshot({ path: S + 'ui/corp-390.png', fullPage: true });

  // --- 音声入力（偽 SpeechRecognition を注入。実マイクは使わない） ---
  const FAKE = (mode) => `(() => {
    const MODE = ${JSON.stringify(mode)};
    if (MODE === 'none') { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; return; }
    class Fake {
      constructor() { window.__fake = this; this.started = false; }
      start() { this.started = true; window.__fakeStarts = (window.__fakeStarts || 0) + 1;
        setTimeout(() => {
          if (MODE === 'deny') { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); return; }
          this.onstart && this.onstart();
        }, 20); }
      stop() { this.started = false; setTimeout(() => this.onend && this.onend(), 20); }
      abort() { this.stop(); }
      emit(list) { const rs = list.map(([t, f]) => { const a = [{ transcript: t, confidence: 0.9 }]; a.isFinal = f; return a; });
        this.onresult && this.onresult({ resultIndex: 0, results: rs }); }
    }
    window.SpeechRecognition = Fake; window.webkitSpeechRecognition = undefined;
  })();`;
  const voiceCtx = async (mode, opt = {}) => {
    const c = await b.newContext(opt); await c.addInitScript(FAKE(mode));
    const pg = await c.newPage(); pg.on('pageerror', e => errs.push('voice: ' + e.message));
    await pg.goto(BASE + '#/new'); await pg.waitForSelector(T('voice-toggle'), { state: 'visible' }); await pg.waitForTimeout(500);
    return pg;
  };
  const FINAL = '飯島愛子さん来週火曜から入浴は午後に変更';
  for (const [label, opt] of [['PC', { viewport: { width: 1440, height: 900 } }], ['スマホ', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const v = await voiceCtx('ok', opt);
    check(`(voice ${label}) 初期は待機・ボタン有効`, (await v.textContent(T('voice-status'))).trim() === '待機' && !(await v.isDisabled(T('voice-toggle'))));
    await v.fill(T('raw-text'), '既存の文章');
    await v.click(T('voice-toggle')); await v.waitForFunction(() => document.querySelector('[data-testid=voice-status]').textContent.includes('録音中'));
    check(`(voice ${label}) 録音中表示・ボタン状態`, (await v.textContent(T('voice-status'))).includes('マイクに向かって話してください') && (await v.getAttribute(T('voice-toggle'), 'aria-pressed')) === 'true' && await v.$eval(T('voice-toggle'), e => e.classList.contains('rec')));
    check(`(voice ${label}) status は aria-live=polite`, (await v.getAttribute(T('voice-status'), 'aria-live')) === 'polite');
    await v.evaluate(() => window.__fake.emit([['飯島愛子さん来週', false]]));
    check(`(voice ${label}) 途中結果は voice-interim のみ（textarea に入らない）`, (await v.textContent(T('voice-interim'))).includes('飯島愛子さん来週') && (await v.inputValue(T('raw-text'))) === '既存の文章' && (await v.textContent(T('voice-status'))).includes('認識中'));
    await v.screenshot({ path: S + `ui/voice-${label === 'PC' ? 1440 : 390}.png`, fullPage: label !== 'PC' });
    await v.evaluate((t) => window.__fake.emit([[t, true]]), FINAL);
    check(`(voice ${label}) 確定結果が textarea 末尾に追記`, (await v.inputValue(T('raw-text'))) === '既存の文章\n' + FINAL, JSON.stringify(await v.inputValue(T('raw-text'))));
    check(`(voice ${label}) 途中結果表示は消える`, !(await v.isVisible(T('voice-interim'))));
    if (label === 'スマホ') {
      const sm = await v.evaluate(() => [...document.querySelectorAll('#voice-toggle,#voice-status,#voice-interim')].filter(e => e.offsetParent).map(e => ({ t: e.id, h: Math.round(e.getBoundingClientRect().height), f: parseFloat(getComputedStyle(e).fontSize) })));
      check('(voice スマホ) ボタン44px以上・文字16px以上', sm.find(x => x.t === 'voice-toggle').h >= 44 && sm.every(x => x.f >= 16), JSON.stringify(sm));
      check('(voice スマホ) 横スクロールなし', (await v.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    }
    await v.click(T('voice-toggle')); await v.waitForFunction(() => document.querySelector('[data-testid=voice-status]').textContent.trim() === '停止しました');
    check(`(voice ${label}) 停止で「停止しました」・ボタンが待機に戻る`, (await v.getAttribute(T('voice-toggle'), 'aria-pressed')) === 'false');
    check(`(voice ${label}) 停止直後に自動解析されていない`, (await v.locator(T('recipient-card')).count()) === 0 && (await v.locator(T('proposal-loading')).count()) === 0);
    await v.fill(T('raw-text'), (await v.inputValue(T('raw-text'))) + '（確認済み）');
    await v.click(T('submit-analyze')); await v.waitForSelector(T('recipient-card'), { timeout: 8000 });
    check(`(voice ${label}) 人が編集→「AIで解析する」で従来どおり提案`, (await v.locator(T('recipient-card')).count()) > 0);
    await v.context().close();
  }
  { // continuous が勝手に終了
    const v = await voiceCtx('ok', { viewport: { width: 1366, height: 768 } });
    await v.click(T('voice-toggle')); await v.waitForFunction(() => document.querySelector('[data-testid=voice-status]').textContent.includes('録音中'));
    await v.evaluate(() => window.__fake.onend()); await v.waitForTimeout(100);
    check('(voice) onend で「停止しました」・自動再開しない', (await v.textContent(T('voice-status'))).trim() === '停止しました' && (await v.evaluate(() => window.__fakeStarts)) === 1 && (await v.getAttribute(T('voice-toggle'), 'aria-pressed')) === 'false');
    await v.click(T('voice-toggle')); await v.waitForFunction(() => document.querySelector('[data-testid=voice-status]').textContent.includes('録音中'));
    await v.evaluate(() => { location.hash = '#/home'; }); await v.waitForTimeout(150);
    check('(voice) 画面遷移で録音停止', (await v.evaluate(() => window.__fake.started)) === false);
    await v.context().close();
  }
  { // マイク拒否
    const v = await voiceCtx('deny', { viewport: { width: 1366, height: 768 } });
    await v.click(T('voice-toggle')); await v.waitForFunction(() => document.querySelector('[data-testid=voice-status]').textContent.includes('エラー'));
    const t = await v.textContent(T('voice-status'));
    check('(voice) not-allowed: 拒否メッセージ', t.includes('マイクの使用が許可されていません。ブラウザの設定で許可するか、文章を入力してください'), t);
    check('(voice) 拒否後もボタンは待機表示', (await v.getAttribute(T('voice-toggle'), 'aria-pressed')) === 'false');
    await v.fill(T('raw-text'), '手入力で連絡します'); await v.click(T('submit-analyze')); await v.waitForSelector(T('recipient-card'), { timeout: 8000 });
    check('(voice) 拒否後も手入力→解析できる', true);
    await v.context().close();
  }
  { // API なし
    const v = await voiceCtx('none', { viewport: { width: 1366, height: 768 } });
    check('(voice) API なし: ボタン無効・案内文', await v.isDisabled(T('voice-toggle')) && (await v.textContent(T('voice-status'))).includes('このブラウザは音声入力に対応していません。文章を入力してください'));
    await v.fill(T('raw-text'), '手入力で連絡します'); await v.click(T('submit-analyze')); await v.waitForSelector(T('recipient-card'), { timeout: 8000 });
    check('(voice) API なしでも手入力→解析できる', true);
    await v.context().close();
  }

  console.log('errors', JSON.stringify(errs));
  check('JSエラーなし', errs.length === 0);
  console.log(fails ? `\n${fails} 件失敗` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

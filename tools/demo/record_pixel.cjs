// Pixel（Android アプリ）の「受信箱 → 詳細 → 確認しました」を adb で自動操作しながら screenrecord で収録する。
// Windows PC（adb が PATH にある）で node から実行する。record_all.cjs から呼ばれる。
// 使い方: node record_pixel.cjs <OUT dir> <message title substring or ''> [staff name to use or '']
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ADB = process.env.ADB || 'adb';
const APP = 'jp.heartrelay.app/.MainActivity';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sh = (cmd) => adb('shell', cmd);

let lastXml = '';
function dump() {
  // uiautomator dump → XML を取得し、text と bounds を持つノードを返す（idle 待ちで失敗することがあるため 3 回まで再試行）
  let xml = '';
  for (let i = 0; i < 3 && !xml.includes('<node'); i++) {
    try { sh('rm -f /sdcard/hr_ui.xml; uiautomator dump /sdcard/hr_ui.xml 2>&1'); } catch (e) { console.log('[pixel] dump err', String(e.message).slice(0, 120)); }
    try { xml = adb('exec-out', 'cat', '/sdcard/hr_ui.xml'); } catch { xml = ''; }
    if (!xml.includes('<node')) { try { xml = sh('uiautomator dump --compressed /dev/tty 2>/dev/null'); } catch { xml = ''; } }
  }
  lastXml = xml;
  const nodes = [];
  const re = /<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n');
    if (!text) continue;
    nodes.push({ text, x: (Number(m[2]) + Number(m[4])) / 2, y: (Number(m[3]) + Number(m[5])) / 2, y1: Number(m[3]) });
  }
  return nodes;
}
const find = (nodes, pred) => nodes.find((n) => (typeof pred === 'string' ? n.text.includes(pred) : pred(n.text)));
async function tap(n, label) { sh(`input tap ${Math.round(n.x)} ${Math.round(n.y)}`); console.log(`[pixel] tap ${label || n.text.slice(0, 20)} @${Math.round(n.x)},${Math.round(n.y)}`); await sleep(1500); }

async function waitFor(pred, { timeout = 30000, label = '' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const nodes = dump();
    const n = find(nodes, pred);
    if (n) return { n, nodes };
    await sleep(1500);
  }
  throw new Error('not found on screen: ' + label);
}

async function ensureStaff(names) {
  // names: 受け入れ可能な職員名の配列（配信先の未確認職員）。受信箱に出ている職員がその中にあればそのまま使う。
  // そうでなければ「職員を切り替える」→ 一覧から names[0] を選ぶ。
  let nodes = dump();
  const onInbox = !!find(nodes, '職員を切り替える');
  if (onInbox) {
    const cur = names.find((n) => find(nodes, (t) => t === n));
    if (cur) { console.log('[pixel] current staff ok:', cur); return cur; }
    await tap(find(nodes, '職員を切り替える'), 'switch-staff');
  }
  const want = names[0];
  if (!want) return null;
  const swipes = ['540 1700 540 700 400', '540 1700 540 700 400', '540 1700 540 700 400', '540 1700 540 700 400', '540 1700 540 700 400',
    '540 700 540 1700 400', '540 700 540 1700 400', '540 700 540 1700 400', '540 700 540 1700 400', '540 700 540 1700 400', '540 700 540 1700 400', '540 700 540 1700 400'];
  for (let i = 0; i <= swipes.length; i++) {
    nodes = dump();
    const n = find(nodes, (t) => t === want);
    if (n) { await tap(n, 'staff:' + want); await sleep(2500); return want; }
    if (i < swipes.length) { sh('input swipe ' + swipes[i]); await sleep(1200); }
  }
  throw new Error('staff not found in list: ' + want);
}

async function main() {
  if (process.argv[2] === '--whoami') { // 画面のテキストを出して終了（record_all が職員を判定する）
    sh(`am start -n ${APP}`); await sleep(2500);
    const nodes = dump();
    console.log(JSON.stringify(nodes.map((n) => n.text)));
    return;
  }
  const OUT = path.resolve(process.argv[2] || 'raw');
  const titleHint = process.argv[3] || '';
  const staffNames = (process.argv[4] || '').split('|').filter(Boolean);
  const dir = path.join(OUT, 'pixel'); fs.mkdirSync(dir, { recursive: true });
  const marks = []; let t0 = Date.now();
  const mark = (name) => { marks.push({ name, t: Date.now() - t0 }); console.log(`[pixel] ${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`); };

  const devs = adb('devices').split('\n').filter((l) => /\tdevice$/.test(l.trim()));
  if (!devs.length) throw new Error('no adb device');
  sh('wm size').trim().split('\n').forEach((l) => console.log('[pixel]', l));
  sh(`am start -n ${APP}`); await sleep(3000);
  const usedStaff = await ensureStaff(staffNames); console.log('[pixel] staff used:', usedStaff);
  // 受信箱で最新の未確認が出るまで待つ（アプリは前面時にポーリング）
  const stNodes = dump();
  console.log('[pixel] screen texts:', stNodes.map((n) => n.text).slice(0, 15).join(' | '));
  if (!stNodes.length) throw new Error('uiautomator dump returned no text nodes');

  // 収録開始（最大 50 秒。終了は時間切れで確定させる）
  const rec = spawn(ADB, ['shell', 'screenrecord', '--time-limit', '50', '--bit-rate', '8000000', '/sdcard/hr_ack.mp4'], { stdio: 'ignore' });
  t0 = Date.now(); mark('record:start');
  await sleep(3500);
  // 未確認の連絡（タイトルに hint を含むものを優先）
  await sleep(2000);
  const { n: card } = await waitFor((t) => t === '未確認', { timeout: 40000, label: '未確認' }).catch(async () => {
    // 出ない場合は更新ボタン相当（下に引く）を試す
    sh('input swipe 540 900 540 1500 300'); await sleep(2500);
    return waitFor((t) => t === '未確認', { timeout: 20000, label: '未確認(after refresh)' });
  });
  let target = card;
  if (titleHint) {
    const nodes = dump();
    const tn = find(nodes, (t) => t.includes(titleHint));
    if (tn) target = tn;
  }
  mark('inbox'); await tap(target, 'open-detail'); await sleep(2500); mark('detail');
  const { n: btn } = await waitFor((t) => t === '確認しました', { timeout: 15000, label: '確認しました' });
  await sleep(1500);
  await tap(btn, 'ack'); mark('ack:tapped');
  await waitFor('確認を記録しました', { timeout: 15000, label: '確認を記録しました' }).catch(() => {});
  mark('ack:done');
  await sleep(4000);
  adb('exec-out', 'screencap', '-p').length; // no-op warmup
  fs.writeFileSync(path.join(dir, 'after_ack.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  await new Promise((r) => rec.on('exit', r)); mark('record:end');
  await sleep(1000);
  adb('pull', '/sdcard/hr_ack.mp4', path.join(dir, 'hr_ack.mp4'));
  fs.writeFileSync(path.join(dir, 'markers.json'), JSON.stringify({ marks, finished_at: new Date().toISOString() }, null, 2));
  console.log('[pixel] saved', path.join(dir, 'hr_ack.mp4'));
}
main().catch((e) => {
  console.error('[pixel] ERROR', e.message);
  try {
    const dir = path.join(path.resolve(process.argv[2] || 'raw'), 'pixel'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'debug_ui.xml'), lastXml || '');
    fs.writeFileSync(path.join(dir, 'debug_screen.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
    console.error('[pixel] debug saved (ui.xml bytes=' + (lastXml || '').length + ')');
  } catch (e2) { console.error('[pixel] debug save failed', e2.message); }
  process.exit(1);
});

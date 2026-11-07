// デモ収録の一括実行（Windows PC 上で node から実行。v1_record.cmd から呼ばれる）
//  1) PC: s1, s2, corp を Playwright で録画（本番 Claude）
//  2) Pixel: 配信先の職員でアプリを開き、受信→詳細→「確認しました」を adb で操作しつつ screenrecord
//     同時に PC 側で配信管理の ✅ 反映を録画（ack シーン）
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = path.join(HERE, 'raw');
const DEMO = process.env.DEMO_FILES || path.join(HERE, '..', 'demo-files');
const SCENES = process.env.SCENES || 's1,s2,corp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (u) => (await fetch(u)).json();

function run(script, env, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(HERE, script), ...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${script} exit ${c}`))));
  });
}
function spawnBg(script, env, args = []) {
  const p = spawn(process.execPath, [path.join(HERE, script), ...args], { env: { ...process.env, ...env }, stdio: 'inherit' });
  p.done = new Promise((resolve) => p.on('exit', (c) => resolve(c)));
  return p;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of ['ack_ready.txt']) { try { fs.unlinkSync(path.join(OUT, f)); } catch {} }
  const health = await j(BASE + '/api/health');
  console.log('[all] health', JSON.stringify(health));
  if (health.analyzer !== 'claude') console.warn('[all] WARNING: analyzer is not claude');

  // 1) PC シーン
  if (SCENES !== 'none') {
    await run('record_pc.cjs', { BASE, OUT, DEMO_FILES: DEMO, SCENES });
  }
  const ids = JSON.parse(fs.readFileSync(path.join(OUT, 'ids.json'), 'utf8'));
  console.log('[all] ids', JSON.stringify(ids));

  // 2) Pixel + PC ack
  let hasDevice = false;
  try { hasDevice = execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').some((l) => /\tdevice$/.test(l.trim())); } catch {}
  if (!hasDevice) { console.error('[all] no adb device: skip Pixel scene (enable wireless debugging and rerun with SCENES=none)'); return; }

  const staff = await j(BASE + '/api/staff?office=A');
  const msgs = await j(BASE + '/api/messages?office=A');
  const byId = (id) => msgs.find((m) => m.id === id);
  // 候補: s2（同姓同名→コース担当のみ）を優先、無ければ s1
  const cand = [ids.s2, ids.s1].filter(Boolean).map(byId).filter(Boolean);
  if (!cand.length) throw new Error('no message to ack');
  // s2 の未確認配信先の職員名一覧を渡し、Pixel 側で「画面の職員がその中にあればそのまま、無ければ先頭に切替」する
  const msg = cand[0];
  const unacked = msg.deliveries.filter((x) => !x.acknowledged_at);
  const d = unacked[0] || msg.deliveries[0];
  const names = unacked.map((x) => (staff.find((s) => s.id === x.staff_id) || {}).name).filter(Boolean);
  const st = staff.find((s) => s.id === d.staff_id);
  const title = '';
  console.log('[all] ack target message', msg.id, 'acceptable staff', names.join('|'));

  const pc = spawnBg('record_pc.cjs', { BASE, OUT, DEMO_FILES: DEMO, SCENES: 'ack', ACK_MESSAGE_ID: msg.id, ACK_TIMEOUT: '240000' });
  const t0 = Date.now();
  while (!fs.existsSync(path.join(OUT, 'ack_ready.txt'))) { if (Date.now() - t0 > 90000) throw new Error('pc ack recorder did not start'); await sleep(1000); }
  await sleep(2000);
  try {
    await run('record_pixel.cjs', { ADB: 'adb' }, [OUT, title, names.join('|')]);
  } catch (e) { console.error('[all] pixel failed:', e.message); }
  const code = await pc.done;
  console.log('[all] pc ack recorder exit', code);
  console.log('[all] DONE');
}
main().catch((e) => { console.error('[all] ERROR', e); process.exit(1); });

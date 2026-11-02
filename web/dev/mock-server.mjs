// 開発用モックサーバ（Node 22, 依存なし）。web/ を配信し docs/api.md の API を偽装する。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8790);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const staff = [
  ['s01', '山田 所長', '事業所長', ['全体統括']],
  ['s02', '佐藤 理学', '理学療法士', ['機能訓練', '個別リハ']],
  ['s03', '鈴木 看護', '看護師', ['バイタル測定', '服薬管理']],
  ['s04', '高橋 看護', '看護師', ['入浴前チェック', '処置']],
  ['s05', '田中 相談', '生活相談員', ['利用調整', '家族連絡']],
  ['s06', '伊藤 運転', '運転手', ['送迎(午前)', '車両管理']],
  ['s07', '渡辺 運転', '運転手', ['送迎(午後)']],
  ['s08', '中村 介護', '介護職員', ['入浴介助']],
  ['s09', '小林 介護', '介護職員', ['食事介助', '配膳']],
  ['s10', '加藤 介護', '介護職員', ['レクリエーション']],
  ['s11', '吉田 介護', '介護職員', ['送迎同乗(午後)', '見守り']],
  ['s12', '山本 介護', '介護職員', ['排泄介助']],
  ['s13', '松本 介護', '介護職員', ['入浴介助', '更衣']],
  ['s14', '井上 介護', '介護職員', ['食事介助']],
  ['s15', '木村 介護', '介護職員', ['フロア見守り']],
  ['s16', '林 介護', '介護職員', ['レクリエーション', '清掃']],
  ['s17', '清水 介護', '介護職員', ['送迎同乗(午前)']],
  ['s18', '山口 介護', '介護職員', ['洗濯', '見守り']],
  ['s19', '森 介護', '介護職員', ['食事介助', '口腔ケア']],
  ['s20', '池田 運転', '運転手', ['送迎(予備)']],
].map(([id, name, role, duties]) => ({ id, name, role, duties, active: true }));
const residents = [
  { id: 'r01', name: 'A様（架空）', notes: '送迎あり・午後帰宅' },
  { id: 'r02', name: 'B様（架空）', notes: '入浴週2回' },
  { id: 'r03', name: 'C様（架空）', notes: '嚥下注意' },
];

let messages = [];
let seq = 1;
let deliveries = [];
const now = () => new Date().toISOString();
const uid = (p) => `${p}${String(seq++).padStart(4, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function analyze(raw) {
  const pick = (ids, reasons, titles) => ids.map((id, i) => ({
    staff_id: id, reason: reasons[i], title: titles[i][0], body: titles[i][1], action_required: titles[i][2],
  }));
  let a;
  if (/欠席/.test(raw)) {
    a = { summary: 'B様が明日欠席。送迎・入浴・食事の準備を調整する。', categories: ['欠席', '送迎', '入浴'], urgency: 'medium', resident_id: 'r02', deadline: '明日 朝', required_actions: ['送迎ルートから除外', '入浴予定の差し替え'],
      recipients: pick(['s06', 's08', 's05'], ['明日の午前送迎ルートに含まれるため', '明日の入浴予定者に含まれるため', '家族との連絡窓口のため'],
        [['B様 明日欠席：送迎ルート変更', 'B様が明日欠席です。午前ルートからB様宅を外してください。', 'ルート修正の確認'], ['B様 明日欠席：入浴枠の空き', 'B様の入浴枠が空きます。他の利用者の調整をお願いします。', '入浴枠の再調整'], ['B様 欠席の家族連絡記録', '欠席理由と振替日の確認を行ってください。', '振替日の調整']]),
      board_summary: 'B様 明日欠席（送迎・入浴に影響）', excluded_note: '食事介助担当・レクリエーション担当は影響が小さいため除外。' };
  } else if (/おかゆ|食事形態/.test(raw)) {
    a = { summary: 'C様の食事形態をおかゆに変更。配膳と食事介助で共有が必要。', categories: ['食事', '嚥下'], urgency: 'high', resident_id: 'r03', deadline: '本日 昼食まで', required_actions: ['昼食からおかゆで提供'],
      recipients: pick(['s09', 's14', 's03'], ['配膳担当のため', '食事介助担当のため', '嚥下状態の評価・観察のため'],
        [['C様 食事形態変更（おかゆ）', '昼食よりおかゆで提供してください。', '配膳時に形態確認'], ['C様 食事介助時の注意', 'おかゆへ変更。むせ込みに注意。', 'むせ込みの観察'], ['C様 嚥下状態の観察依頼', '食事形態変更後の状態を観察してください。', '食後に状態報告']]),
      board_summary: 'C様 食事形態：おかゆへ変更', excluded_note: '送迎・入浴担当は無関係のため除外。' };
  } else {
    a = { summary: 'A様が受診のため本日15時までに帰宅が必要。午後送迎の前倒しが必要。', categories: ['受診', '送迎', '時間変更'], urgency: 'high', resident_id: 'r01', deadline: '15:00', required_actions: ['送迎時刻を前倒し', '帰宅準備の声かけ'],
      recipients: pick(['s07', 's11', 's03'], ['午後送迎の運転担当のため', '午後送迎の同乗担当のため', '受診情報の確認が必要なため'],
        [['A様 15時までに帰宅（送迎前倒し）', 'A様は受診のため15時までに帰宅が必要です。午後ルートの先頭にしてください。', '14:30出発の準備'], ['A様 帰宅準備と同乗', '14:20までに帰宅準備の声かけをお願いします。', '帰宅準備の声かけ'], ['A様 受診前のバイタル確認', '出発前にバイタルを測定してください。', 'バイタル測定']]),
      board_summary: 'A様 15時帰宅（受診）', excluded_note: '入浴・食事・レクリエーション担当は関係なし。' };
  }
  return a;
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const full = (m) => ({ ...m, deliveries: deliveries.filter((d) => d.message_id === m.id) });

async function runAnalysis(m) {
  m.status = 'analyzing'; m.error = null;
  await sleep(1000);
  if (/FAIL/.test(m.raw_text)) { m.status = 'failed'; m.error = 'モック: 解析に失敗しました'; return; }
  m.analysis = analyze(m.raw_text); m.analyzer = 'mock'; m.model = null;
  m.usage = { input_tokens: 1820, output_tokens: 640, est_cost_usd: 0.0151 };
  m.status = 'proposed';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      let m;
      if (p === '/api/health') return json(res, 200, { ok: true, analyzer: process.env.MOCK_CLAUDE ? 'claude' : 'mock', model: process.env.MOCK_CLAUDE ? 'claude-sonnet-4-5' : null, time: now() });
      if (p === '/api/staff') return json(res, 200, staff);
      if (p === '/api/residents') return json(res, 200, residents);
      if (p === '/api/demo-messages') return json(res, 404, { error: 'not found' });
      if (p === '/api/stats') {
        const acked = deliveries.filter((d) => d.acknowledged_at).length;
        return json(res, 200, { messages: messages.length, deliveries: deliveries.length, acked, unacked: deliveries.length - acked });
      }
      if (p === '/api/messages' && req.method === 'GET') return json(res, 200, [...messages].reverse().map(full));
      if (p === '/api/messages' && req.method === 'POST') {
        const b = await body(req);
        if (!b.raw_text || !String(b.raw_text).trim()) return json(res, 400, { error: 'raw_text は必須です', code: 'bad_request' });
        m = { id: uid('m'), raw_text: b.raw_text, source: b.source || '手入力', created_by: b.created_by || '相談員 デモ', created_at: now(), status: 'analyzing', analyzer: null, model: null, error: null, usage: null, analysis: null };
        messages.push(m); await runAnalysis(m); return json(res, 200, full(m));
      }
      if ((m = p.match(/^\/api\/messages\/([^/]+)(\/reanalyze|\/send)?$/))) {
        const msg = messages.find((x) => x.id === m[1]);
        if (!msg) return json(res, 404, { error: 'not found' });
        if (!m[2]) return json(res, 200, full(msg));
        if (m[2] === '/reanalyze') { await runAnalysis(msg); return json(res, 200, full(msg)); }
        if (m[2] === '/send') {
          const b = await body(req);
          if (!Array.isArray(b.recipients) || !b.recipients.length) return json(res, 400, { error: '宛先がありません' });
          for (const r of b.recipients) {
            const s = staff.find((x) => x.id === r.staff_id);
            deliveries.push({ id: uid('d'), message_id: msg.id, staff_id: s.id, staff_name: s.name, staff_role: s.role, title: r.title, body: r.body, action_required: r.action_required, reason: r.reason, urgency: msg.analysis.urgency, categories: msg.analysis.categories, created_at: now(), acknowledged_at: null });
          }
          msg.status = 'sent'; return json(res, 200, full(msg));
        }
      }
      if (p === '/api/dev/ack-random' && req.method === 'POST') {
        const pend = deliveries.filter((d) => !d.acknowledged_at);
        if (!pend.length) return json(res, 200, { acked: null });
        const d = pend[Math.floor(Math.random() * pend.length)]; d.acknowledged_at = now();
        return json(res, 200, { acked: d.id });
      }
      return json(res, 404, { error: 'not found' });
    }
    let f = path.join(WEB, p === '/' ? 'index.html' : decodeURIComponent(p));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 500, { error: String(e) }); }
});
server.listen(PORT, () => console.log(`mock server http://localhost:${PORT}`));

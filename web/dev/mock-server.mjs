// 開発用モックサーバ（Node 22, 依存なし）。web/ を配信し docs/api.md の API を偽装する。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
].map(([id, name, role, duties]) => ({ id, name, role, duties, active: true, ledger_staff_id: null, transport_routes: /送迎/.test(duties.join()) ? ['1', '2'] : [] }));

// ---- 利用者（すべて架空）。同姓同名ペア(0001/0002)・姓だけ同じ(0001/0003, 0005/0006)を含む ----
const REF_DATE = '2026-11-05';
const RES_SRC = [
  ['0001', '新田', '洋子', 'ﾆｯﾀ ﾖｳｺ', '利用中', ['月', '水', '金'], '4', '玄関前で待機', 's17', '清水 介護', '出席', ''],
  ['0002', '新田', '洋子', 'ﾆｯﾀ ﾖｳｺ', '中止中', ['火', '木'], '2', '', 's11', '吉田 介護', '対象外', ''],
  ['0003', '新田', '健一', 'ﾆｯﾀ ｹﾝｲﾁ', '利用中', ['火', '木', '土'], '1', '階段あり・要介助', 's08', '中村 介護', '欠席', '通院'],
  ['0004', '佐々木', '恵子', 'ｻｻｷ ｹｲｺ', '利用中', ['月', '木'], '3', '', 's09', '小林 介護', '出席', ''],
  ['0005', '山田', '太郎', 'ﾔﾏﾀﾞ ﾀﾛｳ', '利用中', ['月', '水', '金'], '2', '車いす対応車両', 's11', '吉田 介護', '出席', ''],
  ['0006', '山田', '花子', 'ﾔﾏﾀﾞ ﾊﾅｺ', '利用中', ['火', '金'], '', '施設居住', 's12', '山本 介護', '出席', ''],
  ['0007', '中島', '和夫', 'ﾅｶｼﾏ ｶｽﾞｵ', '利用中', ['水', '土'], '4', '', 's13', '松本 介護', '欠席', '発熱'],
  ['0008', '小川', 'みどり', 'ｵｶﾞﾜ ﾐﾄﾞﾘ', '利用中', ['月', '火', '木'], '1', 'インターホンを鳴らす', 's14', '井上 介護', '出席', ''],
  ['0009', '高木', '正雄', 'ﾀｶｷﾞ ﾏｻｵ', '終了', [], '', '', null, null, '対象外', ''],
  ['0010', '石井', 'キヨ', 'ｲｼｲ ｷﾖ', '利用中', ['水', '金'], '3', '嚥下注意', 's15', '木村 介護', '出席', ''],
  ['0011', '村上', 'トシ', 'ﾑﾗｶﾐ ﾄｼ', '利用中', ['月', '金', '土'], '2', '', 's18', '山口 介護', '出席', ''],
  ['0012', '森田', '一郎', 'ﾓﾘﾀ ｲﾁﾛｳ', '中止中', ['火'], '4', '', 's19', '森 介護', '対象外', ''],
];
const residents = RES_SRC.map(([id, sei, mei, kana, st, wk, route, note, sid, sname, att, why]) => ({
  id, name: `${sei} ${mei}`, kana, sei, mei, gender: '女', birth_date: '1940-01-01', age: 86,
  service_status: st, weekly_pattern: wk, transport_route: route, transport_note: note,
  mobility: '1.独歩', residence: route ? '1.自宅' : '3.施設', care_manager: 'ケアマネ（架空）', office: '架空居宅介護支援事業所',
  staff_id: sid, staff_name: sname, attendance: { date: REF_DATE, status: att, reason: why },
  notes: `${st} / ${wk.join('') || '予定なし'} / 送迎コース${route || 'なし'} / 独歩${sname ? ' / 担当: ' + sname : ''}`,
}));
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/(様|さん|氏|さま)/g, '');
const sameName = (r) => residents.filter((x) => x.name === r.name).length > 1;
const cand = (r, score, reason) => ({ id: r.id, name: r.name, kana: r.kana, service_status: r.service_status, score, reason, same_name: sameName(r) });
function matchResident(text) {
  const t = norm(text);
  const idm = String(text).match(/(?:ID|No\.?|#|利用者)\s*[:：]?\s*(\d{4})|["“「](\d{4})["”」]/);
  if (idm) {
    const r = residents.find((x) => x.id === (idm[1] || idm[2]));
    if (r) return { status: 'confirmed', resident_id: r.id, candidates: [cand(r, 100, 'IDが一致')] };
  }
  const full = residents.filter((r) => t.includes(r.sei + r.mei));
  let cands = full.map((r) => cand(r, 90, '氏名が一致'));
  if (!full.length) cands = residents.filter((r) => t.includes(r.sei)).map((r) => cand(r, 50, `姓「${r.sei}」が一致`));
  cands.sort((a, b) => b.score - a.score || (a.service_status === '利用中' ? -1 : 1));
  cands = cands.slice(0, 10);
  if (cands.length === 1 && cands[0].score >= 90 && !cands[0].same_name) return { status: 'confirmed', resident_id: cands[0].id, candidates: cands };
  if (cands.length) return { status: 'ambiguous', resident_id: null, candidates: cands };
  return { status: 'none', resident_id: null, candidates: [] };
}

// ---- 添付（ダミー PNG を zlib で生成） ----
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function dummyPng(w = 240, h = 150) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const line = y % 24 === 12 && x > 16 && x < w - 16; raw[o] = line ? 40 : 245; raw[o + 1] = line ? 40 : 245; raw[o + 2] = line ? 60 : 238; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = dummyPng();
const attachments = [];

let messages = [];
let boardPosts = [];
let seq = 1;
let deliveries = [];
const DELAY = Number(process.env.MOCK_DELAY ?? 1000);
const now = () => new Date().toISOString();
const uid = (p) => `${p}${String(seq++).padStart(4, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function analyze(raw, res) {
  const N = res ? res.name + ' 様' : '対象者';
  const pick = (ids, reasons, titles) => ids.map((id, i) => ({ staff_id: id, reason: reasons[i], title: titles[i][0], body: titles[i][1], action_required: titles[i][2] }));
  const allIds = staff.map((s) => s.id);
  const excl = (used) => allIds.filter((id) => !used.includes(id)).slice(0, 4).map((id) => ({ staff_id: id, reason: '今回の連絡に関わる担当業務がないため' }));
  let a;
  if (/点検|全員|共有/.test(raw)) {
    a = { summary: '明日午前に送迎車2号車を点検。午前の送迎は1号車のみとなる。', categories: ['送迎', '車両'], urgency: 'medium', resident_id: null, deadline: '明日 午前', required_actions: ['午前送迎を1号車のみで運用'], audience: 'both',
      recipients: pick(['s06', 's17'], ['午前送迎の運転担当のため', '午前送迎の同乗担当のため'], [['明日午前 2号車点検：1号車のみ', '2号車を点検に出します。午前は1号車のみでの送迎になります。', '送迎ルートの再確認'], ['明日午前 送迎が1号車のみ', '同乗の組み合わせを確認してください。', '同乗の確認']]),
      board_post: { title: '明日午前：送迎は1号車のみ', body: '2号車を点検に出すため、明日午前の送迎は1号車のみです。乗り降りに時間がかかる場合があります。', until: null },
      board_summary: '明日午前 送迎は1号車のみ', excluded_note: '入浴・食事担当は無関係のため除外。' };
    a.excluded = excl(['s06', 's17']);
  } else if (/欠席/.test(raw)) {
    a = { summary: `${N}が明日欠席。送迎・入浴・食事の準備を調整する。`, categories: ['欠席', '送迎', '入浴'], urgency: 'medium', resident_id: res?.id ?? null, deadline: '明日 朝', required_actions: ['送迎ルートから除外', '入浴予定の差し替え'], audience: 'individual',
      recipients: pick(['s06', 's08', 's05'], ['明日の午前送迎ルートに含まれるため', '明日の入浴予定者に含まれるため', '家族との連絡窓口のため'],
        [[`${N} 明日欠席：送迎ルート変更`, `${N}が明日欠席です。午前ルートから外してください。`, 'ルート修正の確認'], [`${N} 明日欠席：入浴枠の空き`, `${N}の入浴枠が空きます。他の利用者の調整をお願いします。`, '入浴枠の再調整'], [`${N} 欠席の家族連絡記録`, '欠席理由と振替日の確認を行ってください。', '振替日の調整']]),
      board_post: null, board_summary: `${N} 明日欠席（送迎・入浴に影響）`, excluded_note: '食事介助担当・レクリエーション担当は影響が小さいため除外。' };
    a.excluded = excl(['s06', 's08', 's05']);
  } else if (/おかゆ|食事形態/.test(raw)) {
    a = { summary: `${N}の食事形態をおかゆに変更。配膳と食事介助で共有が必要。`, categories: ['食事', '嚥下'], urgency: 'high', resident_id: res?.id ?? null, deadline: '本日 昼食まで', required_actions: ['昼食からおかゆで提供'], audience: 'both',
      recipients: pick(['s09', 's14', 's03'], ['配膳担当のため', '食事介助担当のため', '嚥下状態の評価・観察のため'],
        [[`${N} 食事形態変更（おかゆ）`, '昼食よりおかゆで提供してください。', '配膳時に形態確認'], [`${N} 食事介助時の注意`, 'おかゆへ変更。むせ込みに注意。', 'むせ込みの観察'], [`${N} 嚥下状態の観察依頼`, '食事形態変更後の状態を観察してください。', '食後に状態報告']]),
      board_post: { title: `${N} 食事形態：おかゆ`, body: '本日昼食からおかゆで提供します。配膳時に必ず確認してください。', until: null },
      board_summary: `${N} 食事形態：おかゆへ変更`, excluded_note: '送迎・入浴担当は無関係のため除外。' };
    a.excluded = excl(['s09', 's14', 's03']);
  } else {
    a = { summary: `${N}が受診のため本日15時までに帰宅が必要。午後送迎の前倒しが必要。`, categories: ['受診', '送迎', '時間変更'], urgency: 'high', resident_id: res?.id ?? null, deadline: '15:00', required_actions: ['送迎時刻を前倒し', '帰宅準備の声かけ'], audience: 'individual',
      recipients: pick(['s07', 's11', 's03'], ['午後送迎の運転担当のため', '午後送迎の同乗担当のため', '受診情報の確認が必要なため'],
        [[`${N} 15時までに帰宅（送迎前倒し）`, `${N}は受診のため15時までに帰宅が必要です。午後ルートの先頭にしてください。`, '14:30出発の準備'], [`${N} 帰宅準備と同乗`, '14:20までに帰宅準備の声かけをお願いします。', '帰宅準備の声かけ'], [`${N} 受診前のバイタル確認`, '出発前にバイタルを測定してください。', 'バイタル測定']]),
      board_post: null, board_summary: `${N} 15時帰宅（受診）`, excluded_note: '入浴・食事・レクリエーション担当は関係なし。' };
    a.excluded = excl(['s07', 's11', 's03']);
  }
  return a;
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const rawBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const body = async (req) => { try { return JSON.parse((await rawBody(req)).toString('utf8') || '{}'); } catch { return {}; } };
const resOf = (m) => residents.find((r) => r.id === m.resident_id) || null;
const full = (m) => ({
  ...m, resident: resOf(m), attachments: attachments.filter((a) => a.message_id === m.id).map(({ extracted_text, ...a }) => a),
  deliveries: deliveries.filter((d) => d.message_id === m.id), board_post: boardPosts.find((b) => b.message_id === m.id) || null,
});

async function runAnalysis(m) {
  m.status = 'analyzing'; m.error = null;
  await sleep(DELAY);
  if (/FAIL/.test(m.raw_text)) { m.status = 'failed'; m.error = 'モック: 解析に失敗しました'; return; }
  m.analysis = analyze(m.raw_text, resOf(m)); m.analyzer = process.env.MOCK_CLAUDE ? 'claude' : 'mock'; m.model = null;
  m.usage = { input_tokens: 1820, output_tokens: 640, est_cost_usd: 0.0151 };
  m.status = 'proposed';
}
const activeBoard = () => boardPosts.filter((b) => !b.archived_at && (!b.until || new Date(b.until) > new Date())).reverse();

// 最低限の multipart パース（1ファイル）。ファイル名と Content-Type だけ読む。
function parseMultipart(buf, ctype) {
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype || ''); if (!bm) return null;
  const s = buf.toString('latin1'); const i = s.indexOf('filename="'); if (i < 0) return null;
  const hdrEnd = s.indexOf('\r\n\r\n', i); const hdr = s.slice(i, hdrEnd);
  const fn = Buffer.from(/filename="([^"]*)"/.exec(hdr)[1], 'latin1').toString('utf8');
  const mime = (/Content-Type:\s*([^\r\n]+)/i.exec(hdr) || [])[1] || 'application/octet-stream';
  return { filename: fn, mime, size: Math.max(0, buf.length - hdrEnd - 100) };
}
const kindOf = (fn, mime) => { const e = path.extname(fn).toLowerCase(); if (/^image\//.test(mime) || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) return 'image'; return { '.pdf': 'pdf', '.txt': 'txt', '.docx': 'docx', '.xls': 'xls', '.xlsx': 'xlsx' }[e] || null; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      let m;
      if (p === '/api/health') return json(res, 200, { ok: true, analyzer: process.env.MOCK_CLAUDE ? 'claude' : 'mock', model: process.env.MOCK_CLAUDE ? 'claude-sonnet-4-5' : null, time: now(), residents: residents.length });
      if (p === '/api/staff') return json(res, 200, staff);
      if (p === '/api/residents' && req.method === 'GET') {
        const q = norm(url.searchParams.get('q') || ''); const limit = Number(url.searchParams.get('limit') || 20);
        const list = q ? residents.filter((r) => norm(r.name).includes(q) || r.id.includes(q) || r.kana.normalize('NFKC').replace(/\s+/g, '').includes(q)) : residents;
        return json(res, 200, list.slice(0, q ? limit : 300));
      }
      if (p === '/api/residents/match' && req.method === 'POST') return json(res, 200, matchResident((await body(req)).text));
      if ((m = p.match(/^\/api\/residents\/([^/]+)$/))) { const r = residents.find((x) => x.id === m[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'not found' }); }
      if (p === '/api/demo-messages') return json(res, 404, { error: 'not found' });
      if (p === '/api/stats') {
        const acked = deliveries.filter((d) => d.acknowledged_at).length;
        return json(res, 200, { messages: messages.length, deliveries: deliveries.length, acked, unacked: deliveries.length - acked, board_posts: boardPosts.length });
      }
      if (p === '/api/board') return json(res, 200, activeBoard());
      if ((m = p.match(/^\/api\/board\/([^/]+)\/archive$/)) && req.method === 'POST') { const b = boardPosts.find((x) => x.id === m[1]); if (!b) return json(res, 404, { error: 'not found' }); b.archived_at = now(); return json(res, 200, b); }
      if (p === '/api/intake' && req.method === 'POST') {
        const f = parseMultipart(await rawBody(req), req.headers['content-type']);
        if (!f) return json(res, 400, { error: 'file がありません', code: 'bad_request' });
        const kind = kindOf(f.filename, f.mime);
        if (!kind) return json(res, 415, { error: '対応していないファイル形式です', code: 'unsupported' });
        await sleep(Math.min(DELAY, 800));
        const claude = kind === 'image' || kind === 'pdf';
        const a = { id: uid('a'), filename: f.filename, mime: f.mime, size: f.size, kind, extractor: claude ? 'claude' : 'local',
          extracted_text: claude ? 'FAX受信 連絡票\n対象: 新田 洋子 様\n内容: 体調不良のため明日は欠席します。\n連絡者: ご家族' : `（${f.filename} から抽出）\nシート1\n月\t水\t金\n新田 洋子\t入浴\t入浴`,
          warnings: claude ? ['手書き部分は読み取りが不確かです。内容を確認してください'] : (kind === 'xlsx' || kind === 'xls' ? ['マクロは実行していません'] : []),
          created_at: now(), message_id: null, _bytes: claude };
        attachments.push(a); const { _bytes, ...pub } = a; return json(res, 200, pub);
      }
      if ((m = p.match(/^\/api\/attachments\/([^/]+)(\/file)?$/))) {
        const a = attachments.find((x) => x.id === m[1]); if (!a) return json(res, 404, { error: 'not found' });
        if (m[2]) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
        const { _bytes, ...pub } = a; return json(res, 200, pub);
      }
      if (p === '/api/messages' && req.method === 'GET') return json(res, 200, [...messages].reverse().map(full));
      if (p === '/api/messages' && req.method === 'POST') {
        const b = await body(req);
        if (!b.raw_text || !String(b.raw_text).trim()) return json(res, 400, { error: 'raw_text は必須です', code: 'bad_request' });
        m = { id: uid('m'), raw_text: b.raw_text, source: b.source || '手入力', created_by: b.created_by || '相談員 デモ', created_at: now(), status: 'analyzing', analyzer: null, model: null, error: null, usage: null, resident_id: null, resident_match: null, analysis: null };
        (b.attachment_ids || []).forEach((id) => { const a = attachments.find((x) => x.id === id); if (a) a.message_id = m.id; });
        messages.push(m);
        if (b.resident_id !== undefined && b.resident_id !== null) { m.resident_id = b.resident_id || null; m.resident_match = null; }
        else { m.resident_match = matchResident(b.raw_text); if (m.resident_match.status === 'confirmed') m.resident_id = m.resident_match.resident_id; }
        if (m.resident_match && m.resident_match.status === 'ambiguous') { m.status = 'needs_resident'; return json(res, 200, full(m)); }
        await runAnalysis(m); return json(res, 200, full(m));
      }
      if ((m = p.match(/^\/api\/messages\/([^/]+)(\/reanalyze|\/send|\/resident)?$/))) {
        const msg = messages.find((x) => x.id === m[1]);
        if (!msg) return json(res, 404, { error: 'not found' });
        if (!m[2]) return json(res, 200, full(msg));
        if (m[2] === '/resident') {
          const b = await body(req);
          if (b.resident_id && !residents.find((r) => r.id === b.resident_id)) return json(res, 404, { error: '利用者が見つかりません' });
          msg.resident_id = b.resident_id || null; await runAnalysis(msg); return json(res, 200, full(msg));
        }
        if (m[2] === '/reanalyze') { await runAnalysis(msg); return json(res, 200, full(msg)); }
        if (m[2] === '/send') {
          const b = await body(req);
          const rs = Array.isArray(b.recipients) ? b.recipients : [];
          if (!rs.length && !b.board_post) return json(res, 400, { error: '宛先がありません' });
          for (const r of rs) {
            const s = staff.find((x) => x.id === r.staff_id);
            deliveries.push({ id: uid('d'), message_id: msg.id, staff_id: s.id, staff_name: s.name, staff_role: s.role, title: r.title, body: r.body, action_required: r.action_required, reason: r.reason, urgency: msg.analysis.urgency, categories: msg.analysis.categories, created_at: now(), acknowledged_at: null });
          }
          if (b.board_post) boardPosts.push({ id: uid('b'), message_id: msg.id, title: b.board_post.title, body: b.board_post.body, urgency: msg.analysis.urgency, categories: msg.analysis.categories, resident_name: resOf(msg)?.name ?? null, created_at: now(), until: b.board_post.until || null, archived_at: null });
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

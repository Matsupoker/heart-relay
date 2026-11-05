import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAnalyzer, ANALYSIS_SCHEMA, buildUserMessage } from '../src/analyzer/claude.js';
import { normalizeAnalysis } from '../src/analyzer/common.js';
import { STAFF } from '../src/seedData.js';

const staff = STAFF.map((s) => ({ ...s, active: true, assigned_residents: s.ledger_staff_id ? 10 : 0 }));

// 確定済み利用者1名（Resident 型、架空）
const resident = {
  id: '0466', name: '坂井 夏子', kana: 'ｻｶｲ ﾅﾂｺ', sei: 'ｻｶｲ', mei: 'ﾅﾂｺ', gender: '女', birth_date: '1939-11-26', age: 86,
  service_status: '利用中', weekly_pattern: ['火'], transport_route: '2', transport_note: '出発前に声かけ',
  mobility: '2.独歩（見守り）', residence: '1.自宅', care_manager: '上野 育子', office: 'こもれつづり町居宅支援室',
  staff_id: 's14', staff_name: '小林 直樹', attendance: { date: '2026-11-10', status: '出席', reason: '' }, notes: '',
};

const toolResult = (input) => ({
  usage: { input_tokens: 1000, output_tokens: 500 },
  content: [{ type: 'tool_use', name: 'submit_analysis', input }],
});

test('Claude解析器: 名簿外IDを除外し、費用を計算し、tool_choiceはautoにする', async () => {
  let params; let calls = 0;
  const client = { messages: { create: async (p) => {
    params = p; calls++;
    if (calls === 1) throw Object.assign(new Error('Overloaded'), { status: 529 }); // 1回再試行
    return toolResult({
      summary: 's', categories: ['受診'], urgency: 'high', resident_id: '0001', deadline: '15:00',
      required_actions: ['a'], board_summary: 'b', excluded_note: 'e', audience: 'individual', board_post: null,
      recipients: [
        { staff_id: 's07', reason: 'r', title: 't', body: 'b', action_required: 'a' },
        { staff_id: 'zz99', reason: 'r', title: 't', body: 'b', action_required: 'a' },
      ],
      excluded: [{ staff_id: 's08', reason: 'コース3・4担当' }, { staff_id: 'zz98', reason: 'x' }, { staff_id: 's07', reason: '重複' }],
    });
  } } };
  const a = new ClaudeAnalyzer({ client, model: 'claude-sonnet-5-5' });
  const out = await a.analyze({ rawText: 'x', source: '手入力', staff, resident });
  assert.equal(calls, 2);
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  assert.equal(params.max_tokens, 6000);
  assert.deepEqual(out.analysis.recipients.map((r) => r.staff_id), ['s07']);
  assert.equal(out.analysis.resident_id, '0466', 'Claude の resident_id は使わず確定値で上書き');
  // excluded: 名簿内のみ・宛先と重複しない・漏れた職員は補完して全19名
  assert.equal(out.analysis.excluded[0].staff_id, 's08');
  assert.equal(out.analysis.excluded[0].reason, 'コース3・4担当');
  assert.equal(out.analysis.excluded.length, 19);
  assert.ok(!out.analysis.excluded.some((x) => x.staff_id === 's07' || x.staff_id === 'zz98'));
  assert.equal(out.usage.est_cost_usd, (1000 * 2 + 500 * 10) / 1e6);
});

test('Claude解析器: APIエラーは読みやすいメッセージで throw', async () => {
  const client = { messages: { create: async () => { throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); } } };
  const a = new ClaudeAnalyzer({ client });
  await assert.rejects(a.analyze({ rawText: 'x', staff, resident: null }), /Claude API エラー\(401\)/);
});

test('スキーマ v2: excluded / audience / board_post を必須で持ち、resident_id は Claude に決めさせない', () => {
  for (const k of ['excluded', 'audience', 'board_post']) assert.ok(ANALYSIS_SCHEMA.required.includes(k), k);
  assert.deepEqual(ANALYSIS_SCHEMA.properties.audience.enum, ['individual', 'board', 'both']);
  assert.equal(ANALYSIS_SCHEMA.properties.resident_id, undefined);
});

test('Claude へ渡す文脈: 職員名簿（送迎コース・担当利用者数）＋確定利用者1名のみ', () => {
  const now = new Date('2026-11-10T01:00:00Z'); // JST 火曜 10:00
  const msg = buildUserMessage({ rawText: '本文テキスト', source: 'FAX（画像）', staff, resident, now });
  assert.match(msg, /s07 \| 竹内 康介 \| 運転手 \| 担当: 送迎\(午前\) コース1・2、送迎\(午後\) コース1・2 \| 送迎コース: コース1・2/);
  assert.match(msg, /s04 \| 高橋 美和 .*担当利用者: 10名/);
  assert.match(msg, /ID: 0466 \/ 氏名: 坂井 夏子/);
  assert.match(msg, /曜日予定: 火（本日 火曜日は利用日か: はい）/);
  assert.match(msg, /当日出欠（デモ基準日 2026-11-10（火））: 出席/);
  assert.match(msg, /送迎: コース2 \/ 送迎上の注意: 出発前に声かけ/);
  assert.match(msg, /移動手段: 2\.独歩（見守り）/);
  assert.match(msg, /居住先: 1\.自宅/);
  assert.match(msg, /担当職員: s14 小林 直樹/);
  assert.match(msg, /ケアマネ: 上野 育子（こもれつづり町居宅支援室）/);
  assert.match(msg, /【連絡事項（入手経路: FAX（画像））】\n本文テキスト$/);
  const none = buildUserMessage({ rawText: 'x', staff, resident: null, now });
  assert.match(none, /【対象利用者】特定なし/);
});

test('normalizeAnalysis: audience 不正は individual、board/both で board_post 欠落なら summary から生成', () => {
  const bad = normalizeAnalysis({ summary: '要約', audience: 'everyone', board_post: { title: 't', body: 'b' } }, { staff });
  assert.equal(bad.audience, 'individual');
  assert.equal(bad.board_post, null);
  assert.equal(bad.resident_id, null);
  const both = normalizeAnalysis({ summary: '明日のレクは室内に変更', audience: 'both' }, { staff });
  assert.deepEqual(both.board_post, { title: '明日のレクは室内に変更', body: '明日のレクは室内に変更', until: null });
  assert.equal(both.board_summary, '明日のレクは室内に変更');
  const until = normalizeAnalysis({ summary: 's', audience: 'board', board_post: { title: 't', body: 'b', until: '不明' } }, { staff });
  assert.equal(until.board_post.until, null);
  assert.equal(until.excluded.length, 20, '宛先なし → 全員が excluded');
  assert.ok(until.excluded_note);
});

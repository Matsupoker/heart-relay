import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAnalyzer } from '../src/analyzer/claude.js';
import { STAFF, RESIDENTS } from '../src/seedData.js';

const staff = STAFF.map((s) => ({ ...s, active: true }));

test('Claude解析器: 名簿外IDを除外し、費用を計算し、tool_choiceはautoにする', async () => {
  let params; let calls = 0;
  const client = { messages: { create: async (p) => {
    params = p; calls++;
    if (calls === 1) throw Object.assign(new Error('Overloaded'), { status: 529 }); // 1回再試行
    return {
      usage: { input_tokens: 1000, output_tokens: 500 },
      content: [{ type: 'tool_use', name: 'submit_analysis', input: {
        summary: 's', categories: ['受診'], urgency: 'high', resident_id: 'r01', deadline: '15:00',
        required_actions: ['a'], board_summary: 'b', excluded_note: 'e',
        recipients: [
          { staff_id: 's07', reason: 'r', title: 't', body: 'b', action_required: 'a' },
          { staff_id: 'zz99', reason: 'r', title: 't', body: 'b', action_required: 'a' },
        ],
      } }],
    };
  } } };
  const a = new ClaudeAnalyzer({ client, model: 'claude-sonnet-5-5' });
  const out = await a.analyze({ rawText: 'x', source: '手入力', staff, residents: RESIDENTS });
  assert.equal(calls, 2);
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  assert.equal(params.max_tokens, 4000);
  assert.deepEqual(out.analysis.recipients.map((r) => r.staff_id), ['s07']);
  assert.equal(out.usage.est_cost_usd, (1000 * 2 + 500 * 10) / 1e6);
});

test('Claude解析器: APIエラーは読みやすいメッセージで throw', async () => {
  const client = { messages: { create: async () => { throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); } } };
  const a = new ClaudeAnalyzer({ client });
  await assert.rejects(a.analyze({ rawText: 'x', staff, residents: RESIDENTS }), /Claude API エラー\(401\)/);
});

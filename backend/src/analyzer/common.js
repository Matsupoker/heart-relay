// 解析結果の検証・補完と費用計算（Claude / Mock 共通）

const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  default: { in: 3, out: 15 },
};

/** トークン数から概算費用(USD)を求める（単価は100万トークンあたり） */
export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model] || PRICES.default;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

const URGENCIES = ['high', 'medium', 'low'];
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** AI出力を Analysis 型に整える。名簿にない staff_id の宛先は捨てる。 */
export function normalizeAnalysis(raw, { staff, residents }) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const staffIds = new Set(staff.map((s) => s.id));
  const seen = new Set();
  const recipients = (Array.isArray(a.recipients) ? a.recipients : [])
    .filter((r) => r && staffIds.has(r.staff_id) && !seen.has(r.staff_id) && seen.add(r.staff_id))
    .map((r) => ({
      staff_id: r.staff_id,
      reason: str(r.reason),
      title: str(r.title, '連絡事項'),
      body: str(r.body),
      action_required: str(r.action_required),
    }));
  const residentIds = new Set(residents.map((r) => r.id));
  return {
    summary: str(a.summary),
    categories: strList(a.categories),
    urgency: URGENCIES.includes(a.urgency) ? a.urgency : 'medium',
    resident_id: residentIds.has(a.resident_id) ? a.resident_id : null,
    deadline: typeof a.deadline === 'string' && a.deadline ? a.deadline : null,
    required_actions: strList(a.required_actions),
    recipients,
    board_summary: str(a.board_summary, str(a.summary)),
    excluded_note: str(a.excluded_note),
  };
}

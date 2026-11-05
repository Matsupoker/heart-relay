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
export const AUDIENCES = ['individual', 'board', 'both'];
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const validDate = (v) => typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v));

/**
 * AI出力を Analysis v2 型に整える。
 * - 名簿にない staff_id の宛先・除外は捨てる。宛先と除外の重複は宛先を優先
 * - resident_id は Claude の出力を使わず、呼び出し側が確定した resident の id で上書き
 * - audience 不正時は 'individual'。board/both で board_post が無ければ summary から作る
 * - excluded に漏れた職員（宛先にも除外にも無い在籍職員）は「理由の記載なし」で補う
 */
export function normalizeAnalysis(raw, { staff, resident = null }) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const active = staff.filter((s) => s.active !== false);
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
  const excluded = (Array.isArray(a.excluded) ? a.excluded : [])
    .filter((x) => x && staffIds.has(x.staff_id) && !seen.has(x.staff_id) && seen.add(x.staff_id))
    .map((x) => ({ staff_id: x.staff_id, reason: str(x.reason) }));
  for (const s of active) {
    if (!seen.has(s.id)) { seen.add(s.id); excluded.push({ staff_id: s.id, reason: '解析結果に理由の記載なし' }); }
  }

  const summary = str(a.summary);
  const audience = AUDIENCES.includes(a.audience) ? a.audience : 'individual';
  let board_post = null;
  if (audience !== 'individual') {
    const bp = a.board_post && typeof a.board_post === 'object' ? a.board_post : {};
    const body = str(bp.body).trim() || str(a.board_summary).trim() || summary;
    board_post = {
      title: str(bp.title).trim() || (summary ? summary.slice(0, 30) : '共有事項'),
      body,
      until: validDate(bp.until) ? bp.until : null,
    };
  }
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const excludedNote = str(a.excluded_note).trim()
    || (excluded.length ? `宛先外: ${excluded.map((x) => nameOf.get(x.staff_id)).join('、')}` : '');
  return {
    summary,
    categories: strList(a.categories),
    urgency: URGENCIES.includes(a.urgency) ? a.urgency : 'medium',
    resident_id: resident?.id ?? null,
    deadline: typeof a.deadline === 'string' && a.deadline ? a.deadline : null,
    required_actions: strList(a.required_actions),
    recipients,
    excluded,
    excluded_note: excludedNote,
    audience,
    board_post,
    board_summary: str(a.board_summary).trim() || (board_post ? board_post.body.split('\n')[0] : summary),
  };
}

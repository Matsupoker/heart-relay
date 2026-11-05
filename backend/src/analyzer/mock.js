// ルールベースの解析器（APIキー無しの開発・テスト用）。同じ入力には常に同じ出力を返す。
import { normalizeAnalysis } from './common.js';

const has = (s, kw) => kw.some((k) => s.includes(k));
const withDuty = (role, kw) => (s) => s.role === role && s.duties.some((d) => d.includes(kw));
const byRole = (role) => (s) => s.role === role;
// 利用者の送迎コースが分かればそのコースの担当者だけ、分からなければ該当業務の全員
const onRoute = (base) => (s, c) => base(s) && (!c.route || (s.transport_routes || []).includes(c.route));
const byDuty = (kw) => (s) => s.duties.some((d) => d.includes(kw));

// 先に一致したルールが優先（送迎車の点検が「送迎」ルールに吸われないよう車両を先頭に）
const RULES = [
  {
    id: 'vehicle', test: (t) => /点検|号車|車両|送迎車/.test(t),
    categories: ['車両', '送迎'], urgency: 'medium', audience: 'both', boardTitle: '送迎車の使用不可',
    pick: [byRole('運転手'), byRole('事業所長')],
    excluded: '介護職員・看護師・理学療法士は車両の運用に直接関与しないため対象外。',
    action: { 運転手: '代替車両の割り当てとコースの確認', 事業所長: '代替手段（レンタカー等）の判断' },
    text: (r, c) => ({
      運転手: [`車両使用不可の連絡`, `${c.raw} 代替車両でのコース組み替えを確認してください。`],
      事業所長: [`車両点検に伴う送迎体制の確認`, `${c.raw} 代替手段が必要な場合はご判断ください。`],
    }[r]),
  },
  {
    id: 'recreation', test: (t) => /レク|行事|イベント|全体周知|全職員/.test(t),
    categories: ['レクリエーション', '全体周知'], urgency: 'low', audience: 'both', boardTitle: 'レクリエーションの変更',
    pick: [byDuty('レクリエーション'), byDuty('フロア')],
    excluded: '送迎・入浴・食事・機能訓練などの担当は個別の対応が不要なため、共有ボードでの周知のみ。',
    action: { 介護職員: '変更後の内容に合わせた準備と誘導' },
    text: (r, c) => [`レクリエーション内容の変更`, `${c.raw} 準備物と会場の確認をお願いします。`],
  },
  {
    id: 'absence', test: (t) => has(t, ['欠席', 'お休み', '休み']),
    categories: ['欠席', '送迎'], urgency: 'medium',
    pick: [onRoute(withDuty('運転手', '送迎')), byRole('生活相談員'), byRole('看護師')], assigned: true,
    excluded: '介護職員・理学療法士・事業所長へは個別連絡の必要性が低いため対象外（共有ボードで周知）。',
    action: { 運転手: '送迎コースから対象者を外す', 生活相談員: 'ご家族・ケアマネへの確認と記録', 看護師: '体調経過の把握（発熱の有無）' },
    text: (r, c) => ({
      運転手: [`欠席連絡：送迎対象から除外`, `${c.raw} 該当日の送迎コース${c.route ? c.route + 'の便' : ''}から外してください。`],
      生活相談員: [`欠席の連絡と家族・ケアマネ確認`, `${c.raw} 状況の確認と記録をお願いします。`],
      看護師: [`欠席（体調不良）の共有`, `${c.raw} 復帰時のバイタル確認に備えてください。`],
    }[r]),
  },
  {
    id: 'meal', test: (t) => has(t, ['食事形態', 'おかゆ', '食事', '刻み', 'ミキサー']),
    categories: ['食事', '形態変更'], urgency: 'high',
    pick: [withDuty('介護職員', '食事介助'), byRole('看護師')], assigned: true,
    excluded: '送迎・入浴担当の職員、運転手は食事提供に関与しないため対象外。',
    action: { 介護職員: '配膳時に食事形態を確認し、見守りを行う', 看護師: '嚥下状態の観察・必要に応じ記録' },
    text: (r, c) => ({
      介護職員: [`食事形態変更：配膳時の確認`, `${c.raw} 配膳前に形態を必ず確認してください。`],
      看護師: [`食事形態変更の共有`, `${c.raw} 嚥下状態の観察をお願いします。`],
    }[r]),
  },
  {
    id: 'bath', test: (t) => has(t, ['湿布', '入浴']),
    categories: ['入浴', 'ご家族依頼'], urgency: 'medium',
    pick: [withDuty('介護職員', '入浴介助'), byRole('看護師')], assigned: true,
    excluded: '送迎・食事・フロア担当の職員、運転手は入浴対応に関与しないため対象外。',
    action: { 介護職員: '入浴後に湿布を貼付する', 看護師: '貼付可否・皮膚状態の確認' },
    text: (r, c) => ({
      介護職員: [`入浴時の湿布貼付依頼`, `${c.raw} 入浴後に対応してください。`],
      看護師: [`湿布貼付の可否確認`, `${c.raw} 皮膚の状態を確認し、可否を介護職員へ伝えてください。`],
    }[r]),
  },
  {
    id: 'visit', test: (t) => has(t, ['受診', '帰宅', '送迎', '時間']),
    categories: ['受診', '送迎', '時間変更'], urgency: 'high',
    pick: [onRoute(withDuty('運転手', '送迎')), onRoute(withDuty('介護職員', '送迎添乗')), byRole('生活相談員')],
    excluded: '入浴・食事・フロア・レク担当の介護職員、看護師、理学療法士、事業所長は直接の対応が不要なため対象外。',
    action: {
      運転手: '帰宅時刻に合わせた送迎順序の変更',
      介護職員: '帰宅準備を時刻までに終える',
      生活相談員: 'ご家族・受診先との待ち合わせ確認',
    },
    text: (r, c) => ({
      運転手: [`${c.when}帰宅：送迎の時刻・順序を調整`, `${c.raw} 帰宅時刻と送迎上の注意（待ち合わせ場所）を確認してください。${c.note}`],
      介護職員: [`${c.when}までに帰宅準備`, `${c.raw} 送迎添乗の担当として、${c.when}までに身支度と持ち物の準備をお願いします。`],
      生活相談員: [`受診に伴う帰宅の家族連絡`, `${c.raw} ご家族・受診先との待ち合わせ内容を確認してください。`],
    }[r]),
  },
];

const DEFAULT_RULE = {
  id: 'default', categories: ['その他'], urgency: 'low',
  pick: [byRole('生活相談員'), byRole('事業所長')],
  excluded: '内容から特定の担当が判断できないため、まず相談員と事業所長のみに共有。',
  action: { 生活相談員: '内容の確認と担当の振り分け', 事業所長: '内容の把握' },
  text: (r, c) => [`連絡事項の確認依頼`, `${c.raw} 内容をご確認ください。`],
};

/** 「15時」「15:30」「15時30分」を "HH:MM" にする */
export function extractTime(text) {
  const m = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/) || text.match(/(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 非宛先の職員それぞれの除外理由 */
function excludedReason(s) {
  const duties = s.duties.length ? s.duties.join('・') : s.role;
  return `${s.role}（${duties}）で、この連絡への直接の対応が不要なため`;
}

export class MockAnalyzer {
  name = 'mock';
  /** resident はサーバーが確定した利用者1名（Resident 型）または null */
  async analyze({ rawText, staff, resident = null }) {
    const text = rawText.trim();
    const rule = RULES.find((r) => r.test(text)) || DEFAULT_RULE;
    const deadline = extractTime(text);
    const ctx = {
      raw: text, when: deadline || 'ご指定の時刻',
      route: resident?.transport_route || '',
      note: resident?.transport_note ? ` 送迎上の注意: ${resident.transport_note}。` : '',
    };
    const active = staff.filter((s) => s.active !== false);

    const recipients = [];
    const push = (s, reason, title, body, action) => {
      if (recipients.some((r) => r.staff_id === s.id)) return;
      recipients.push({ staff_id: s.id, reason, title, body, action_required: action });
    };
    for (const pred of rule.pick) {
      for (const s of active.filter((x) => pred(x, ctx))) {
        const [title, body] = rule.text(s.role, ctx);
        const route = ctx.route && (s.transport_routes || []).includes(ctx.route) ? `・送迎コース${ctx.route}担当` : '';
        push(s, `${s.role}${s.duties.length ? '（' + s.duties.join('・') + '）' : ''}${route}のため関係あり`,
          title, body, rule.action[s.role] || '内容の確認');
      }
    }
    // 利用者の担当職員（台帳）にも共有する
    const owner = rule.assigned && resident?.staff_id ? active.find((s) => s.id === resident.staff_id) : null;
    if (owner) push(owner, `${resident.name}様の担当職員のため`, `担当利用者の連絡: ${rule.categories[0]}`, `${text} 担当として内容を把握してください。`, '内容の把握');

    const who = resident ? `${resident.name}様` : '';
    const audience = rule.audience || 'individual';
    const analysis = normalizeAnalysis({
      summary: `${who ? who + 'に関する' : ''}${rule.categories.join('・')}の連絡。${deadline ? deadline + 'までの対応が必要。' : ''}`,
      categories: rule.categories,
      urgency: rule.urgency,
      deadline,
      required_actions: [...new Set(Object.values(rule.action))],
      recipients,
      excluded: active.filter((s) => !recipients.some((r) => r.staff_id === s.id)).map((s) => ({ staff_id: s.id, reason: excludedReason(s) })),
      excluded_note: rule.excluded,
      audience,
      board_post: audience === 'individual' ? null : { title: rule.boardTitle || rule.categories[0], body: text, until: null },
      board_summary: `${who}${text}`.slice(0, 80),
    }, { staff, resident });
    return { analysis, usage: { input_tokens: 0, output_tokens: 0, est_cost_usd: 0 }, model: 'mock' };
  }
}

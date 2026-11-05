// Claude API（Tool Use）による解析器
import Anthropic from '@anthropic-ai/sdk';
import { estimateCost, normalizeAnalysis } from './common.js';

const TOOL_NAME = 'submit_analysis';

const recipientSchema = {
  type: 'object',
  properties: {
    staff_id: { type: 'string', description: '名簿に存在する職員ID' },
    reason: { type: 'string', description: 'この職員に送る理由（役割・当日の担当業務に基づく）' },
    title: { type: 'string', description: '通知タイトル（短く）' },
    body: { type: 'string', description: '本文。その職種が必要とする情報だけを簡潔に' },
    action_required: { type: 'string', description: 'その職員に求める具体的対応' },
  },
  required: ['staff_id', 'reason', 'title', 'body', 'action_required'],
};

const excludedSchema = {
  type: 'object',
  properties: {
    staff_id: { type: 'string', description: '宛先にしなかった職員のID（名簿に存在するもの）' },
    reason: { type: 'string', description: '宛先にしなかった理由（職種・当日の担当業務に基づく短い説明）' },
  },
  required: ['staff_id', 'reason'],
};

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1〜2文の要約' },
    categories: { type: 'array', items: { type: 'string' }, description: '例: 受診, 送迎, 時間変更' },
    urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
    deadline: { type: ['string', 'null'], description: '例 "15:00" / "2026-11-10"。無ければ null' },
    required_actions: { type: 'array', items: { type: 'string' } },
    recipients: { type: 'array', items: recipientSchema, description: '個別に通知する職員。audience が board のみなら空配列でよい' },
    excluded: { type: 'array', items: excludedSchema, description: 'recipients に含めなかった在籍職員の全員と、その理由' },
    excluded_note: { type: 'string', description: 'excluded の要約（1〜2文）' },
    audience: { type: 'string', enum: ['individual', 'board', 'both'], description: 'individual=個別配信のみ、board=フロア共有ボードのみ、both=両方' },
    board_post: {
      type: ['object', 'null'],
      description: 'フロア共有ボードの掲示。audience が board / both のとき必須、individual のときは null',
      properties: {
        title: { type: 'string', description: '掲示の見出し（20字程度）' },
        body: { type: 'string', description: '掲示本文。フロアの誰が読んでも分かる簡潔な文' },
        until: { type: ['string', 'null'], description: '掲示期限（ISO 8601 日時、例 "2026-11-10T18:00:00+09:00"）。当日中なら null' },
      },
      required: ['title', 'body', 'until'],
    },
    board_summary: { type: 'string', description: '共有ボード向けの1行要点' },
  },
  required: ['summary', 'categories', 'urgency', 'deadline', 'required_actions', 'recipients', 'excluded', 'excluded_note', 'audience', 'board_post', 'board_summary'],
};

const SYSTEM_PROMPT = `あなたは、デイサービス（1事業所）の連絡事項を整理し、適切な職員へ振り分ける支援AIです。
目的は「必要な情報を、必要な職員に、必要な形で」届けることです。

方針:
- 全員への一斉送信は避ける。職種と「当日の担当業務(duties)」「送迎コース担当」の両方を見て、本当に対応や把握が必要な職員だけを recipients にする。
- 対象利用者の台帳情報（送迎コース・担当職員など）が与えられた場合はそれを根拠に宛先を選ぶ。例: 送迎の変更はその利用者の送迎コースを担当する運転手・添乗職員へ。
- 宛先ごとに title / body / action_required を職種に合わせて書き分ける（例: 運転手には送迎時刻や待ち合わせ・送迎上の注意、介護職員には準備や介助の注意、看護師には健康面の確認、相談員には家族・ケアマネ連絡）。
- excluded には recipients に入れなかった在籍職員を「全員」列挙し、各自に短い理由を書く（例: 「入浴介助担当で、送迎の変更には関与しないため」）。excluded_note はその要約。
- audience の判断基準:
  - individual: 特定の利用者の予定変更・体調・ケア内容など、関係する職員が個別に対応すればよいもの
  - board: フロア全体の運営情報（行事・レクの変更、設備・車両の状況、全員が知っておくべき周知）で、個別の対応依頼が無いもの
  - both: 担当者の個別対応が必要で、かつフロア全体にも周知すべきもの（例: 車両の使用不可＝運転手は対応、フロアは周知）
- audience が board / both のときは board_post（title・body・until）を必ず書く。individual のときは null。
- 推測で事実を足さない。台帳や本文に無い情報（病名・時刻・家族の意向など）を作らない。不明な点は action_required で確認を促す。本文に無い主語（誰が連絡・共有したか）や時間帯（昼食から、入浴後など）を補わない。
- 台帳の「担当職員」は職種を問わない担当者で、「担当看護師」「担当運転手」という区分は台帳に無い。担当職員に触れるときは「担当職員（s04・看護師）」のように書き、「担当看護師」「担当の看護師」とは書かない。看護師など同じ担当業務の職員が複数いて当日の対応者を名簿から決められないときは、理由を「担当業務が同じで当日の対応者を名簿から決められないため」と書く。
- board_summary と board_post には、病名・症状（発熱など）・受診・服薬・湿布や外用薬・食事形態など、利用者の健康情報を書かない。audience が individual のときの board_summary は「〇〇様：個別連絡あり（掲示なし）」程度にする。
- required_actions の各項目は、必ず recipients のいずれかの action_required に含める。担当できる職員がいない項目は、生活相談員か事業所長を宛先にする。
- 除外理由に「必要に応じて調整する」と書く相手は recipients に入れる。宛先本人の担当業務と矛盾する依頼（本人が担当する作業を他の担当へ引き継がせる等）を書かない。
- deadline は、対応が必要になる日（影響が出る日）を必ず入れる。車両・行事の変更も同じ。
- 対象利用者は「対象利用者」欄に示したものをサーバーが確定済み。別の利用者を推定しない。「特定なし」の場合は利用者を特定しない前提で書く。
- staff_id は必ず提供された名簿のIDのみを使う。
- 判断の最終承認は人間が行う。提案として出力する。
- 回答は必ずツール ${TOOL_NAME} を1回呼び出して提出する。本文のテキストでの説明は不要。ツールが使えない場合のみ、同じスキーマの JSON だけを出力する。`;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
/** JST の現在曜日（"木" など） */
const weekdayJst = (now) => WEEKDAYS[new Date(now.getTime() + 9 * 3600_000).getUTCDay()];

/** 職員名簿の1行 */
function staffLine(s) {
  const routes = Array.isArray(s.transport_routes) && s.transport_routes.length ? `コース${s.transport_routes.join('・')}` : '-';
  const assigned = Number.isInteger(s.assigned_residents) ? `${s.assigned_residents}名` : '-';
  return `- ${s.id} | ${s.name} | ${s.role} | 担当: ${(s.duties || []).join('、') || 'なし'} | 送迎コース: ${routes} | 担当利用者: ${assigned}`;
}

/** 確定した利用者1名の台帳情報 */
function residentBlock(r, now) {
  if (!r) return '【対象利用者】特定なし（利用者に関係しない連絡、または本文から特定できない）';
  const wd = weekdayJst(now);
  const pattern = r.weekly_pattern?.length ? r.weekly_pattern.join('・') : 'なし';
  const usesToday = r.weekly_pattern?.includes(wd) ? 'はい' : 'いいえ';
  const att = r.attendance || {};
  const attDate = att.date ? `${att.date}（${WEEKDAYS[new Date(att.date + 'T00:00:00Z').getUTCDay()]}）` : '-';
  const lines = [
    `- ID: ${r.id} / 氏名: ${r.name}（${r.kana}）/ ${r.gender || '-'}・${r.age ?? '-'}歳`,
    `- 利用状況: ${r.service_status}`,
    `- 曜日予定: ${pattern}（本日 ${wd}曜日は利用日か: ${usesToday}）`,
    `- 当日出欠（デモ基準日 ${attDate}）: ${att.status || '-'}${att.reason ? `（理由: ${att.reason}）` : ''}`,
    `- 送迎: ${r.transport_route ? `コース${r.transport_route}` : 'なし（施設居住）'} / 送迎上の注意: ${r.transport_note || 'なし'}`,
    `- 移動手段: ${r.mobility || '-'}`,
    `- 居住先: ${r.residence || '-'}`,
    `- 担当職員: ${r.staff_id ? `${r.staff_id} ${r.staff_name || ''}`.trim() : 'なし'}`,
    `- ケアマネ: ${r.care_manager || '-'}（${r.office || '-'}）`,
  ];
  return `【対象利用者（台帳より・サーバーで確定済み）】\n${lines.join('\n')}`;
}

/** Claude へ渡すユーザーメッセージ。200名の一覧は渡さず、確定した利用者1名のみ */
export function buildUserMessage({ rawText, source, staff, resident = null, now = new Date() }) {
  const roster = staff.filter((s) => s.active !== false).map(staffLine).join('\n');
  const today = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' });
  return [
    `【現在日時（日本時間）】${today}`,
    `【職員名簿（id | 氏名 | 職種 | 当日の担当業務 | 送迎コース担当 | 担当利用者数）】\n${roster}`,
    residentBlock(resident, now),
    `【連絡事項（入手経路: ${source || '手入力'}）】\n${rawText}`,
  ].join('\n\n');
}

const isRetryable = (e) => e?.status >= 500 || e?.status === 529 || /overloaded/i.test(e?.message || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));


// 本文テキストから JSON オブジェクトを取り出す（tool_use が無かった場合の保険）
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [m?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try { const o = JSON.parse(c); if (o && typeof o === 'object') return o; } catch { /* 次へ */ }
  }
  return null;
}

export class ClaudeAnalyzer {
  name = 'claude';
  constructor({ apiKey, model, client } = {}) {
    this.model = model || 'claude-sonnet-5-5';
    this.client = client || new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });
  }

  async #call(params) {
    try {
      return await this.client.messages.create(params);
    } catch (e) {
      if (!isRetryable(e)) throw e;
      await wait(1000); // 5xx/529 は1回だけ再試行
      return await this.client.messages.create(params);
    }
  }

  /** resident は確定した利用者1名（Resident 型）または null */
  async analyze({ rawText, source, staff, resident = null }) {
    let res;
    try {
      res = await this.#call({
        model: this.model,
        max_tokens: 6000, // v2 で excluded（非宛先の全職員）が増えたため 4000 → 6000
        system: SYSTEM_PROMPT,
        tools: [{ name: TOOL_NAME, description: '連絡事項の解析結果と宛先の提案を提出する', input_schema: ANALYSIS_SCHEMA }],
        // 注: 一部モデルは tool_choice の "tool"/"any" 強制に非対応（400）のため auto とし、
        //     システムプロンプトで必ずツールを呼ぶよう指示する。未使用時は本文の JSON を解析する。
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: buildUserMessage({ rawText, source, staff, resident }) }],
      });
    } catch (e) {
      throw new Error(`Claude API エラー${e?.status ? `(${e.status})` : ''}: ${e?.message || e}`);
    }
    const block = res.content?.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    let raw = block?.input;
    if (!raw) {
      const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      raw = extractJson(text);
    }
    if (!raw) throw new Error('Claude の応答に解析結果(tool_use / JSON)が含まれていませんでした');
    const inT = res.usage?.input_tokens ?? 0;
    const outT = res.usage?.output_tokens ?? 0;
    return {
      analysis: normalizeAnalysis(raw, { staff, resident }),
      usage: { input_tokens: inT, output_tokens: outT, est_cost_usd: estimateCost(this.model, inT, outT) },
      model: this.model,
    };
  }
}

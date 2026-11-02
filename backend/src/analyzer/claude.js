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

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1〜2文の要約' },
    categories: { type: 'array', items: { type: 'string' }, description: '例: 受診, 送迎, 時間変更' },
    urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
    resident_id: { type: ['string', 'null'], description: '対象利用者ID。判別できなければ null' },
    deadline: { type: ['string', 'null'], description: '例 "15:00" / "2026-11-05"。無ければ null' },
    required_actions: { type: 'array', items: { type: 'string' } },
    recipients: { type: 'array', items: recipientSchema },
    board_summary: { type: 'string', description: '共有ボード向けの1行要点' },
    excluded_note: { type: 'string', description: '送らないと判断した職員とその理由の要約' },
  },
  required: ['summary', 'categories', 'urgency', 'resident_id', 'deadline', 'required_actions', 'recipients', 'board_summary', 'excluded_note'],
};

const SYSTEM_PROMPT = `あなたは、デイサービス（1事業所）の連絡事項を整理し、適切な職員へ振り分ける支援AIです。
目的は「必要な情報を、必要な職員に、必要な形で」届けることです。

方針:
- 全員への一斉送信は避ける。職種と「当日の担当業務(duties)」の両方を見て、本当に対応や把握が必要な職員だけを宛先にする。
- 宛先ごとに title / body / action_required を職種に合わせて書き分ける（例: 運転手には送迎時刻や待ち合わせ、介護職員には準備や介助の注意、看護師には健康面の確認、相談員には家族・ケアマネ連絡）。
- 簡潔に書く。推測で事実を足さない。不明な点は action_required で確認を促す。
- staff_id は必ず提供された名簿のIDのみを使う。利用者は利用者一覧のIDで resident_id に入れる（判別できなければ null）。
- excluded_note には、宛先に含めなかった職員（職種・担当）と、その理由を書く。
- board_summary は事業所の共有ボードに載せる1行の要点にする。
- 判断の最終承認は人間が行う。提案として出力する。
- 結果は必ず ${TOOL_NAME} ツールで提出する。`;

function buildUserMessage({ rawText, source, staff, residents }) {
  const roster = staff.filter((s) => s.active !== false)
    .map((s) => `- ${s.id} | ${s.name} | ${s.role} | 担当: ${s.duties.join('、') || 'なし'}`).join('\n');
  const res = residents.map((r) => `- ${r.id} | ${r.name} | ${r.notes}`).join('\n');
  const today = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' });
  return `【現在日時（日本時間）】${today}\n\n【職員名簿（id | 氏名 | 職種 | 当日の担当業務）】\n${roster}\n\n【利用者一覧（id | 氏名 | 備考）】\n${res}\n\n【連絡事項（入手経路: ${source || '手入力'}）】\n${rawText}`;
}

const isRetryable = (e) => e?.status >= 500 || e?.status === 529 || /overloaded/i.test(e?.message || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

  async analyze({ rawText, source, staff, residents }) {
    let res;
    try {
      res = await this.#call({
        model: this.model,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [{ name: TOOL_NAME, description: '連絡事項の解析結果と宛先の提案を提出する', input_schema: ANALYSIS_SCHEMA }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: buildUserMessage({ rawText, source, staff, residents }) }],
      });
    } catch (e) {
      throw new Error(`Claude API エラー${e?.status ? `(${e.status})` : ''}: ${e?.message || e}`);
    }
    const block = res.content?.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!block) throw new Error('Claude の応答に解析結果(tool_use)が含まれていませんでした');
    const inT = res.usage?.input_tokens ?? 0;
    const outT = res.usage?.output_tokens ?? 0;
    return {
      analysis: normalizeAnalysis(block.input, { staff, residents }),
      usage: { input_tokens: inT, output_tokens: outT, est_cost_usd: estimateCost(this.model, inT, outT) },
      model: this.model,
    };
  }
}

// 事業所間連絡の AI 文面支援（POST /api/office-messages/draft）。
// 件名・本文の「案」を返すだけで、office_messages は作らない（送信は人間が POST /api/office-messages で行う）。
// APIキー未設定時はテンプレートによるモック文面。
import Anthropic from '@anthropic-ai/sdk';
import { HttpError, parseJson } from '../http.js';
import { estimateCost } from '../analyzer/common.js';
import { getResident } from '../ledger/resident.js';
import { getOffice, requireOfficeId } from './service.js';

const TOOL_NAME = 'submit_office_draft';
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '件名（30字程度）' },
    body: { type: 'string', description: '本文（敬体。事業所間の連絡文として簡潔に）' },
  },
  required: ['title', 'body'],
};

export const DRAFT_SYSTEM_PROMPT = `あなたは、同一法人内の介護・医療事業所どうしの連絡文の作成を補助するAIです。
送信元事業所の職員が、送信先事業所へ送る連絡の「件名」と「本文」の案を書きます。案は職員が確認・編集してから、職員自身が送信します。

方針:
- 本文は敬体（です・ます）で、事業所間の連絡文として簡潔に書く。冒頭に宛先（「〇〇 ご担当者様」）と名乗り（送信元事業所名）を入れる。
- 材料（元連絡の要約・必要な対応・分類・対象利用者名・職員のメモ）に書かれた事実だけを使う。推測で事実（病名・日時・経緯・家族の意向など）を足さない。
- 材料から分からない点や、送信先に判断してほしい点は「ご確認ください」と書く。
- 送信元事業所の内部の担当者名・職員の配置・送迎コースなどの内部運用は書かない。
- 回答は必ずツール ${TOOL_NAME} を1回呼び出して提出する。ツールが使えない場合のみ {"title": "...", "body": "..."} の JSON だけを出力する。`;

const isRetryable = (e) => e?.status >= 500 || e?.status === 529 || /overloaded/i.test(e?.message || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v) => (typeof v === 'string' ? v : '');

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const c of [m?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!c) continue;
    try { const o = JSON.parse(c); if (o && typeof o === 'object') return o; } catch { /* 次へ */ }
  }
  return null;
}

/**
 * 入力を検証し、Claude に渡してよい材料だけを集める。
 * 渡すもの: 事業所名・種別、元連絡の summary / required_actions / categories / 利用者名、notes。
 * 渡さないもの: 宛先職員名・除外理由・台帳の詳細（送迎コース・担当職員等）・原文。
 */
export function collectDraftMaterial(db, body) {
  const b = body && typeof body === 'object' ? body : {};
  const fromId = requireOfficeId(db, b.from_office_id, 'from_office_id');
  const toId = requireOfficeId(db, b.to_office_id, 'to_office_id');
  if (fromId === toId) throw new HttpError(400, '送信元と送信先に同じ事業所は指定できません', 'same_office');
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string') throw new HttpError(400, 'notes は文字列にしてください', 'bad_request');
  const notes = str(b.notes).trim();
  if (notes.length > 2000) throw new HttpError(400, 'notes は2000文字以内にしてください', 'bad_request');
  let source = null;
  const sid = b.source_message_id;
  if (sid !== undefined && sid !== null && sid !== '') {
    if (typeof sid !== 'string') throw new HttpError(400, 'source_message_id は文字列にしてください', 'bad_request');
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(sid);
    if (!row) throw new HttpError(400, `存在しない連絡事項です: ${sid}`, 'unknown_message');
    if (row.office_id !== fromId) throw new HttpError(400, '送信元事業所の連絡事項ではありません', 'office_mismatch');
    const a = parseJson(row.analysis_json);
    if (!a) throw new HttpError(400, '解析が済んでいない連絡事項は材料にできません', 'not_analyzed');
    source = {
      summary: str(a.summary),
      required_actions: Array.isArray(a.required_actions) ? a.required_actions.filter((x) => typeof x === 'string') : [],
      categories: Array.isArray(a.categories) ? a.categories.filter((x) => typeof x === 'string') : [],
      resident_name: getResident(db, row.resident_id)?.name ?? null,
    };
  }
  if (!source && !notes) throw new HttpError(400, 'source_message_id か notes のどちらかが必要です', 'bad_request');
  return { from: getOffice(db, fromId), to: getOffice(db, toId), source, notes };
}

/** Claude へ渡すユーザーメッセージ（材料のみ） */
export function buildDraftMessage({ from, to, source, notes }) {
  const lines = [
    `【送信元事業所】${from.name}（${from.kind}）`,
    `【送信先事業所】${to.name}（${to.kind}）`,
  ];
  if (source) {
    lines.push([
      '【元の連絡（送信元事業所内で整理済み）】',
      `- 対象利用者: ${source.resident_name ? `${source.resident_name} 様` : '特定なし'}`,
      `- 分類: ${source.categories.join('、') || 'なし'}`,
      `- 要約: ${source.summary || 'なし'}`,
      `- 必要な対応: ${source.required_actions.length ? source.required_actions.map((x) => `\n  ・${x}`).join('') : 'なし'}`,
    ].join('\n'));
  }
  lines.push(`【職員のメモ】\n${notes || 'なし'}`);
  lines.push('上記をもとに、送信先事業所への連絡文の件名と本文の案を作成してください。');
  return lines.join('\n\n');
}

/** APIキー無しのテンプレート文面（材料をそのまま並べる。事実は足さない） */
function mockDraft({ from, to, source, notes }) {
  const head = source?.summary ? source.summary.split(/[。\n]/)[0].slice(0, 24) : (notes.split('\n')[0].slice(0, 24) || 'ご連絡');
  const parts = [`${to.name} ご担当者様`, '', `${from.name}です。いつもお世話になっております。`, '下記の件についてご連絡いたします。', ''];
  if (source) {
    if (source.resident_name) parts.push(`対象: ${source.resident_name} 様`);
    if (source.summary) parts.push(source.summary);
    if (source.required_actions.length) parts.push('', 'ご確認・ご対応のお願い:', ...source.required_actions.map((x) => `・${x}`));
  }
  if (notes) parts.push('', notes);
  parts.push('', `ご不明な点は${from.name}までご確認ください。よろしくお願いいたします。`);
  return { title: `【${from.name}】${head}`, body: parts.join('\n') };
}

/**
 * 文面案を作る。checkRate は解析と共有の回数制限（モックでも数える）。
 * @returns {{title, body, model, usage}}
 */
export async function draftOfficeMessage(body, { db, env = {}, checkRate = () => {}, client } = {}) {
  const material = collectDraftMaterial(db, body);
  checkRate();
  if (!env.ANTHROPIC_API_KEY && !client) return { ...mockDraft(material), model: 'mock', usage: null };
  const model = env.OFFICE_DRAFT_MODEL || env.HEART_RELAY_MODEL || 'claude-sonnet-5-5';
  const c = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 0 });
  const params = {
    model, max_tokens: 1500, system: DRAFT_SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: '事業所間連絡の件名と本文の案を提出する', input_schema: DRAFT_SCHEMA }],
    tool_choice: { type: 'auto' }, // analyzer と同じく auto（一部モデルは強制指定に非対応）
    messages: [{ role: 'user', content: buildDraftMessage(material) }],
  };
  let res;
  try {
    try { res = await c.messages.create(params); } catch (e) {
      if (!isRetryable(e)) throw e;
      await wait(1000); res = await c.messages.create(params);
    }
  } catch (e) {
    throw new HttpError(502, `Claude による文面作成に失敗しました${e?.status ? `(${e.status})` : ''}: ${e?.message || e}`, 'draft_failed');
  }
  let out = res.content?.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME)?.input;
  if (!out) out = extractJson((res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
  const title = str(out?.title).trim(), text = str(out?.body).trim();
  if (!title || !text) throw new HttpError(502, 'Claude の応答に件名・本文が含まれていませんでした', 'draft_failed');
  const inT = res.usage?.input_tokens ?? 0, outT = res.usage?.output_tokens ?? 0;
  return { title, body: text, model, usage: { input_tokens: inT, output_tokens: outT, est_cost_usd: estimateCost(model, inT, outT) } };
}

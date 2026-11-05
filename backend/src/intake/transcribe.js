// 画像/PDF を Claude で転記する（APIキー未設定時はモック）
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from '../http.js';
import { estimateCost } from '../analyzer/common.js';
import { clip } from './extract/common.js';

const SYSTEM_PROMPT = `介護事業所に届いた FAX・書類・メモの画像を、内容を一切推測・補完せず、そのまま日本語テキストに転記してください。
レイアウトの行構成を保ち、表は行ごとに " | " 区切りで書きます。判読できない箇所は【判読不能】と書き、手書きの訂正は訂正後の内容を採用して（訂正）と注記します。本文以外の説明は書かないでください。`;

const isRetryable = (e) => e?.status >= 500 || e?.status === 529 || /overloaded/i.test(e?.message || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function transcribe({ buffer, mime, kind, filename }, ctx) {
  const { env, checkRate } = ctx;
  if (!env.ANTHROPIC_API_KEY) {
    return {
      extractor: 'local', usage: null, warnings: ['モック'],
      text: `（モック転記）ファイル名: ${filename} — APIキー未設定のため画像/PDF は読み取れません。内容を手入力してください。`,
    };
  }
  checkRate(); // 429 は解析と共有
  const model = env.INTAKE_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const data = buffer.toString('base64');
  const block = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const client = ctx.client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 0 });
  const params = {
    model, max_tokens: 4000, system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'この内容を転記してください。' }] }],
  };
  let res;
  try {
    try { res = await client.messages.create(params); } catch (e) {
      if (!isRetryable(e)) throw e;
      await wait(1000); res = await client.messages.create(params);
    }
  } catch (e) {
    throw new HttpError(502, `Claude による転記に失敗しました${e?.status ? `(${e.status})` : ''}: ${e?.message || e}`, 'transcribe_failed');
  }
  const warnings = [];
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const inT = res.usage?.input_tokens ?? 0, outT = res.usage?.output_tokens ?? 0;
  return {
    extractor: 'claude', warnings, text: clip(text, warnings),
    usage: { input_tokens: inT, output_tokens: outT, est_cost_usd: estimateCost(model, inT, outT) },
  };
}

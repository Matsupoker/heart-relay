// 抽出テキストの共通処理
export const MAX_TEXT = 5000; // messages.raw_text の上限と同じ

export const normalizeNewlines = (s) => s.replace(/\r\n?/g, '\n');

/** 5000 文字で打ち切り、打ち切った場合は warnings に追記する */
export function clip(text, warnings) {
  const t = normalizeNewlines(text).trim();
  const chars = Array.from(t);
  if (chars.length <= MAX_TEXT) return t;
  warnings.push(`抽出テキストが ${chars.length} 文字のため先頭 ${MAX_TEXT} 文字で打ち切りました`);
  return chars.slice(0, MAX_TEXT).join('');
}

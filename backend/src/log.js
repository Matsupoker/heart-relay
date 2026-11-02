// 簡易ロガー（タイムスタンプ付き）
const ts = () => new Date().toISOString();

export const log = {
  info: (...a) => console.log(ts(), '[info]', ...a),
  warn: (...a) => console.warn(ts(), '[warn]', ...a),
  error: (...a) => console.error(ts(), '[error]', ...a),
  // 解析呼び出しの費用ログ
  analyzer: ({ analyzer, model, usage, ms }) =>
    console.log(
      ts(), '[analyze]',
      `analyzer=${analyzer} model=${model}`,
      `in=${usage.input_tokens} out=${usage.output_tokens}`,
      `est_cost_usd=$${usage.est_cost_usd.toFixed(6)}`,
      `time=${ms}ms`,
    ),
};

import { ClaudeAnalyzer } from './claude.js';
import { MockAnalyzer } from './mock.js';

/** APIキーがあれば ClaudeAnalyzer、無ければ MockAnalyzer */
export function getAnalyzer(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    return new ClaudeAnalyzer({ apiKey: env.ANTHROPIC_API_KEY, model: env.HEART_RELAY_MODEL || 'claude-sonnet-5-5' });
  }
  return new MockAnalyzer();
}

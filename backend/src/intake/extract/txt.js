import iconv from 'iconv-lite';
import { clip } from './common.js';

export async function extractTxt(buffer) {
  const warnings = [];
  let text = new TextDecoder('utf-8').decode(buffer); // BOM は除去される（ignoreBOM 既定 false）
  if (text.includes('�')) {
    text = iconv.decode(buffer, 'Shift_JIS');
    warnings.push('文字コードを Shift_JIS と判定');
  }
  return { text: clip(text, warnings), warnings };
}

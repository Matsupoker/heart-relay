import mammoth from 'mammoth';
import { clip } from './common.js';

export async function extractDocx(buffer) {
  const warnings = [];
  const { value, messages } = await mammoth.extractRawText({ buffer });
  for (const m of messages || []) if (m.type === 'warning') warnings.push(`docx: ${m.message}`);
  return { text: clip(value || '', warnings), warnings };
}

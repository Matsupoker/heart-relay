import XLSX from 'xlsx';
import { clip } from './common.js';

/** 値のみ読む。マクロ・数式は読まず実行しない。 */
export async function extractXlsx(buffer) {
  const warnings = ['マクロ・数式は実行していません（値のみ）'];
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, bookVBA: false, cellHTML: false });
  const meta = wb.Workbook?.Sheets || [];
  const parts = [];
  wb.SheetNames.forEach((name, i) => {
    if (meta[i]?.Hidden) { warnings.push(`非表示シート「${name}」は含めていません`); return; }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    const lines = rows
      .map((r) => { const c = r.map((v) => String(v ?? '').trim()); while (c.length && c[c.length - 1] === '') c.pop(); return c; })
      .filter((c) => c.length)
      .map((c) => c.join(' | '));
    parts.push(`## ${name}\n${lines.join('\n')}`);
  });
  return { text: clip(parts.join('\n\n'), warnings), warnings };
}

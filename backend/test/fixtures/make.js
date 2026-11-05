// テスト用の架空フィクスチャ生成: node test/fixtures/make.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import iconv from 'iconv-lite';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEMO = '【連絡メモ】\r\n田中花子様（架空）は明日の通所を欠席です。\r\n理由: 通院のため。';

export const txtUtf8 = () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MEMO, 'utf8')]);
export const txtSjis = () => iconv.encode(MEMO, 'Shift_JIS');

export function xlsx({ bookType = 'xlsx' } = {}) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['氏名', '時刻', '備考'], ['山田太郎（架空）', '10:00', ''], [], ['鈴木一郎（架空）', '', '']]);
  ws['D1'] = { t: 'n', f: 'SUM(1,2)', v: 3 }; // 数式セル（値のみ読まれる）
  ws['!merges'] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
  XLSX.utils.book_append_sheet(wb, ws, '送迎表');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['秘密']]), '隠し');
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
  return XLSX.write(wb, { type: 'buffer', bookType });
}

export async function docx(paragraphs = ['面会予定のお知らせ（架空）', '佐藤花子様のご家族が午後2時に来所されます。']) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

// 1x1 PNG
export const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const pdf = () => Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(here, 'memo-utf8.txt'), txtUtf8());
  fs.writeFileSync(path.join(here, 'memo-sjis.txt'), txtSjis());
  fs.writeFileSync(path.join(here, 'transport.xlsx'), xlsx());
  fs.writeFileSync(path.join(here, 'transport.xls'), xlsx({ bookType: 'biff8' }));
  fs.writeFileSync(path.join(here, 'notice.docx'), await docx());
  fs.writeFileSync(path.join(here, 'pixel.png'), png());
  fs.writeFileSync(path.join(here, 'blank.pdf'), pdf());
}

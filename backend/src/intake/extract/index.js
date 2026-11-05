import { extractTxt } from './txt.js';
import { extractDocx } from './docx.js';
import { extractXlsx } from './xlsx.js';

export const LOCAL_EXTRACTORS = { txt: extractTxt, docx: extractDocx, xlsx: extractXlsx, xls: extractXlsx };

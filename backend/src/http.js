// ルート間で共有する小物（HttpError・async ラッパ・JSON 安全パース）
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const parseJson = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

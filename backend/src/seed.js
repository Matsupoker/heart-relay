import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDb } from './db.js';
import { STAFF, RESIDENTS } from './seedData.js';
import { log } from './log.js';

export { DEMO_MESSAGES } from './seedData.js';

/** 職員が1人もいなければ投入する。force 指定時は全データを消して再投入。戻り値: 投入したか */
export function seedIfEmpty(db, { force = false } = {}) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
  if (count > 0 && !force) return false;
  db.exec('BEGIN');
  try {
    if (force) for (const t of ['ack_events', 'deliveries', 'messages', 'residents', 'staff']) db.exec(`DELETE FROM ${t}`);
    const ins = db.prepare('INSERT INTO staff (id,name,role,duties_json,active) VALUES (?,?,?,?,1)');
    for (const s of STAFF) ins.run(s.id, s.name, s.role, JSON.stringify(s.duties));
    const insR = db.prepare('INSERT INTO residents (id,name,notes) VALUES (?,?,?)');
    for (const r of RESIDENTS) insR.run(r.id, r.name, r.notes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return true;
}

// 直接実行されたとき（npm run seed）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });
  const db = openDb(process.env.DB_PATH || './data/heart-relay.db');
  const force = process.argv.includes('--force');
  const done = seedIfEmpty(db, { force });
  log.info(done ? `シード投入完了（職員${STAFF.length}名・利用者${RESIDENTS.length}名、すべて架空）` : '職員が既に存在するためスキップ（--force で再投入）');
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDb, setMeta } from './db.js';
import { ALL_STAFF, OFFICES } from './seedData.js';
import { upsertOffices } from './office/service.js';
import { installLedger, readLedger } from './ledger/load.js';
import { log } from './log.js';

export { DEMO_MESSAGES } from './seedData.js';

/**
 * ALL_STAFF 定数（A の20名＋B・C 各3名）から staff 行を upsert して属性
 * （事業所・氏名・職種・担当・台帳ID・送迎コース）を同期する。id と active は保持
 */
export function syncStaff(db) {
  const up = db.prepare(`INSERT INTO staff (id,name,role,duties_json,active,ledger_staff_id,transport_routes_json,office_id)
    VALUES (?,?,?,?,1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, duties_json=excluded.duties_json,
      ledger_staff_id=excluded.ledger_staff_id, transport_routes_json=excluded.transport_routes_json, office_id=excluded.office_id`);
  for (const s of ALL_STAFF) {
    up.run(s.id, s.name, s.role, JSON.stringify(s.duties), s.ledger_staff_id, JSON.stringify(s.transport_routes), s.office_id);
  }
}

/**
 * 起動時の投入・同期。
 * - 事業所: 毎回 upsert（架空 3 事業所）
 * - 職員: 毎回 upsert（既存 DB にも送迎コース・事業所等を反映）
 * - 利用者: residents が台帳件数と異なれば fixtures/ の200名台帳で置き換え
 * force 指定時は連絡事項・配信・共有ボード・添付・事業所間連絡も含めて全消去して再投入。
 * 戻り値: 職員が空の状態から投入したか（v1 互換）
 */
export function seedIfEmpty(db, { force = false } = {}) {
  const wasEmpty = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n === 0;
  db.exec('BEGIN');
  try {
    if (force) {
      for (const t of ['office_messages', 'ack_events', 'deliveries', 'board_posts', 'attachments', 'messages', 'residents', 'staff']) db.exec(`DELETE FROM ${t}`);
    }
    upsertOffices(db, OFFICES);
    syncStaff(db);
    const have = db.prepare('SELECT COUNT(*) AS n FROM residents').get().n;
    if (have !== readLedger().rows.length) {
      installLedger(db);
      setMeta(db, 'ledger_loaded_at', new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return wasEmpty || force;
}

// 直接実行されたとき（npm run seed）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });
  const db = openDb(process.env.DB_PATH || './data/heart-relay.db');
  const force = process.argv.includes('--force');
  const done = seedIfEmpty(db, { force });
  const n = db.prepare('SELECT COUNT(*) AS n FROM residents').get().n;
  log.info(done ? `シード投入完了（事業所${OFFICES.length}件・職員${ALL_STAFF.length}名・利用者${n}名、すべて架空）` : `職員属性を同期・利用者台帳${n}名を確認（--force で全消去して再投入）`);
}

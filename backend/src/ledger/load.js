// 200名台帳（fixtures/ の架空データ）を読み込み、residents テーブルへ投入する。
// パスは import.meta.url から解決するため、backend の cwd に依存しない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_STAFF_MAP } from './staffMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(__dirname, '..', '..', '..', 'fixtures');
const BACKUP_PATH = path.join(FIXTURES_DIR, 'harmonize2', 'harmonize2_backup_fictional200.json');
const EXTENSION_PATH = path.join(FIXTURES_DIR, 'heart-relay', 'user_extension_fictional200.json');

/** 移動手段 "1.独歩" → "独歩"（notes 用に番号を外す） */
const stripNo = (s) => String(s || '').replace(/^\d+\./, '');

/** v1 互換の1行要約 "利用中 / 月水金 / 送迎コース4 / 独歩 / 担当: 清水 達也" */
export function buildNotes({ service_status, weekly_pattern, transport_route, residence, mobility, staffName }) {
  const parts = [service_status];
  parts.push(weekly_pattern.length ? weekly_pattern.join('') : '曜日予定なし');
  parts.push(transport_route ? `送迎コース${transport_route}` : `施設居住（${stripNo(residence)}）`);
  if (mobility) parts.push(stripNo(mobility));
  if (staffName) parts.push(`担当: ${staffName}`);
  return parts.join(' / ');
}

let cache = null;

/**
 * フィクスチャ2ファイルを読み、residents 行（DB 列の形）を返す。結果はプロセス内でキャッシュする。
 * 戻り値: { rows, attendanceDate, careManagerNames, ledgerStaffNames }
 */
export function readLedger() {
  if (cache) return cache;
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8')).data;
  const ext = JSON.parse(fs.readFileSync(EXTENSION_PATH, 'utf8'));
  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  const offices = byId(backup.offices);
  const cms = byId(backup.careManagers);
  const staff = byId(backup.staff);
  const residences = byId(backup.residences);
  const mobilities = byId(backup.mobilities);
  const extUsers = byId(ext.users);
  const attendance = byId(ext.attendance?.records);
  const attendanceDate = ext.attendance?.date || '';

  const rows = backup.users.map((u) => {
    const e = extUsers.get(u.id) || {};
    const a = attendance.get(u.id) || { status: '対象外', reason: '' };
    const cm = cms.get(u.careManagerId);
    const office = offices.get(u.officeId) || offices.get(cm?.officeId);
    const ledgerStaff = staff.get(u.staffId);
    const row = {
      id: u.id,
      name: u.fullName,
      kana: u.kana || '',
      sei: u.sei || '',
      mei: u.mei || '',
      gender: u.gender || '',
      birth_date: u.birthDate || '',
      service_status: e.serviceStatus || (u.usageStatus === '利用中' ? '利用中' : '中止中'),
      weekly_pattern: Array.isArray(e.weeklyPattern) ? e.weeklyPattern : [],
      transport_route: e.transportRoute || '',
      transport_note: e.transportNote || '',
      mobility: mobilities.get(u.mobilityId)?.name || '',
      residence: residences.get(u.residenceId)?.name || '',
      care_manager: cm?.name || '',
      office: office?.name || '',
      staff_id: LEDGER_STAFF_MAP[u.staffId] || null,
      attendance_date: attendanceDate,
      attendance_status: a.status || '対象外',
      attendance_reason: a.reason || '',
    };
    row.notes = buildNotes({ ...row, staffName: ledgerStaff?.name || '' });
    return row;
  });
  cache = {
    rows,
    attendanceDate,
    careManagerNames: (backup.careManagers || []).map((c) => c.name),
    ledgerStaffNames: (backup.staff || []).map((s) => s.name),
  };
  return cache;
}

/** residents を台帳で置き換える（トランザクションは呼び出し側）。戻り値: 投入件数 */
export function installLedger(db) {
  const { rows } = readLedger();
  db.exec('DELETE FROM residents');
  const ins = db.prepare(`INSERT INTO residents
    (id,name,kana,sei,mei,gender,birth_date,service_status,weekly_pattern_json,transport_route,transport_note,
     mobility,residence,care_manager,office,staff_id,attendance_date,attendance_status,attendance_reason,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) {
    ins.run(r.id, r.name, r.kana, r.sei, r.mei, r.gender, r.birth_date, r.service_status, JSON.stringify(r.weekly_pattern),
      r.transport_route, r.transport_note, r.mobility, r.residence, r.care_manager, r.office, r.staff_id,
      r.attendance_date, r.attendance_status, r.attendance_reason, r.notes);
  }
  return rows.length;
}

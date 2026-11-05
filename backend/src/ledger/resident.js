// residents 行 → API の Resident 型
import { parseJson } from '../http.js';

/** JST の今日の日付 "YYYY-MM-DD" */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 生年月日 "YYYY-MM-DD" から基準日時点の満年齢 */
export function ageOn(birthDate, onDate = todayJst()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate || '');
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
  if (!m || !t) return null;
  let age = Number(t[1]) - Number(m[1]);
  if (t[2] + t[3] < m[2] + m[3]) age -= 1;
  return age;
}

/** row は residents.* に staff_name（staff テーブルとの結合）を加えたもの */
export function toResident(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, kana: r.kana, sei: r.sei, mei: r.mei,
    gender: r.gender, birth_date: r.birth_date, age: ageOn(r.birth_date),
    service_status: r.service_status,
    weekly_pattern: parseJson(r.weekly_pattern_json, []),
    transport_route: r.transport_route, transport_note: r.transport_note,
    mobility: r.mobility, residence: r.residence,
    care_manager: r.care_manager, office: r.office,
    staff_id: r.staff_id ?? null, staff_name: r.staff_name ?? null,
    attendance: { date: r.attendance_date, status: r.attendance_status, reason: r.attendance_reason },
    notes: r.notes,
  };
}

export const RESIDENT_SELECT = `SELECT r.*, s.name AS staff_name FROM residents r LEFT JOIN staff s ON s.id = r.staff_id`;

export function getResident(db, id) {
  if (typeof id !== 'string' || !id) return null;
  return toResident(db.prepare(`${RESIDENT_SELECT} WHERE r.id = ?`).get(id));
}

export function listResidents(db) {
  return db.prepare(`${RESIDENT_SELECT} ORDER BY r.id`).all().map(toResident);
}

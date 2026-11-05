import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STAFF } from '../../backend/src/seedData.js';

// Independent acceptance checks, pinned to HARMONIZE d87c5e9; no generator import.
const root = new URL('../../', import.meta.url);
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = x => Array.isArray(x) ? x : [];
const string = x => typeof x === 'string';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const date = x => string(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number(x.slice(0, 4)) >= 1868 && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const iso = x => string(x) && /^\d{4}-\d{2}-\d{2}T/.test(x) && !Number.isNaN(Date.parse(x));
const canonicalIso = x => iso(x) && new Date(x).toISOString() === x;
const count = (xs, key) => xs.reduce((r, x) => { r[x?.[key]] = (r[x?.[key]] ?? 0) + 1; return r; }, {});
const exactKeys = (x, keys) => object(x) && same(Object.keys(x).sort(), [...keys].sort());
function read(path) {
  try { return readFileSync(new URL(path, root), 'utf8'); }
  catch (e) { errors.push(`${path}: ${e.message}`); return null; }
}
function json(path) {
  const text = read(path);
  if (text === null) return {};
  try {
    const value = JSON.parse(text);
    check(text === JSON.stringify(value, null, 2), `${path}: UTF-8 BOMなし / LF / JSON.stringify(file, null, 2) の形式`);
    return value;
  } catch (e) { errors.push(`${path}: JSON不正 (${e.message})`); return {}; }
}
const backup = json('fixtures/harmonize2/harmonize2_backup_fictional200.json');
const extension = json('fixtures/heart-relay/user_extension_fictional200.json');
const data = object(backup?.data) ? backup.data : {};
check(backup?.format === 'harmonize2-backup', 'backup.format');
check(backup?.schemaVersion === 1 && data.schemaVersion === 1, 'backup / data.schemaVersion');
check(iso(backup?.createdAt), 'backup.createdAt: ISO日時');
check(backup?.createdAt === '2026-11-05T00:00:00.000Z', 'backup.createdAt: 固定日時');
check(backup?.appVersion === '2.2.0-mvp.1', 'backup.appVersion');
const config = [
  ['office', 'offices', 'K', 8], ['careManager', 'careManagers', 'CM', 16],
  ['staff', 'staff', 'S', 15], ['residence', 'residences', 'R', 4], ['mobility', 'mobilities', 'M', 8],
];
const maps = {};
check(object(data.counters), 'data.counters: object必須');
for (const [kind, key, prefix, size] of config) {
  check(Array.isArray(data[key]), `${key}: 配列必須`);
  const items = list(data[key]);
  maps[kind] = new Map();
  check(items.length === size, `${key}: ${size}件必須`);
  for (const [i, item] of items.entries()) {
    check(object(item) && string(item.id) && !!item.id && string(item.name), `${key}[${i}]: id/name必須`);
    if (!object(item)) continue;
    check(!maps[kind].has(item.id), `${key}: ID重複 ${item.id}`);
    maps[kind].set(item.id, item);
    check(item.id === `${prefix}${String(i + 1).padStart(4, '0')}`, `${key}[${i}]: 接頭辞・4桁連番`);
    check(string(item.name) && item.name.trim() === item.name && !!item.name, `${key}[${i}]: 名称空欄/前後空白`);
    const sequence = Number(String(item.id).slice(prefix.length));
    if (item.id === `${prefix}${String(sequence).padStart(4, '0')}`) {
      check(data.counters?.[kind] >= sequence, `counters.${kind}: ${item.id}未満`);
    }
  }
  check(Number.isInteger(data.counters?.[kind]) && data.counters[kind] >= 0, `counters.${kind}: 非負整数`);
  check(data.counters?.[kind] === size, `counters.${kind}: 最大連番と一致`);
}
const mobilityNames = ['1.独歩', '2.独歩（見守り）', '3.歩行（介助・手引き）', '4.歩行器（自立）', '5.歩行器（見守り）', '6.歩行器（介助）', '7.車椅子（自走）', '8.車椅子（介助）'];
const residenceNames = ['1.自宅', '2.ほのつむぎ苑', '3.ゆめこずえ館', '4.そらねむり舎'];
check(same(list(data.mobilities).map(x => x?.name), mobilityNames), '移動手段: STANDARD_MOBILITIESと同じ順・名称');
// Exact fictional allowlist excludes every standard facility name without reproducing them here.
check(same(list(data.residences).map(x => x?.name), residenceNames), '居住先: 自宅と架空3施設のみ（標準施設名禁止）');
const expectedStaff = STAFF.filter(x => ['介護職員', '生活相談員', '看護師'].includes(x.role));
check(expectedStaff.length === 15, 'seedData: 対象職員15名');
check(same(list(data.staff).map(x => x?.name), expectedStaff.map(x => x.name)), 'スタッフ: seedDataの対象職員と同じ順・氏名');
for (const cm of list(data.careManagers)) {
  check(maps.office.has(cm?.officeId), `CM ${cm?.id}: 所属居宅が存在`);
  check(list(data.careManagers).filter(x => x?.officeId === cm?.officeId && x?.name === cm?.name).length === 1, `CM ${cm?.id}: 同一居宅内で同名なし`);
}
for (const office of maps.office.values()) check(list(data.careManagers).filter(x => x?.officeId === office.id).length === 2, `${office.id}: CM2名`);
const fields = ['id', 'fullName', 'kana', 'sei', 'mei', 'birthDate', 'gender', 'mobilityId', 'officeId', 'usageStatus', 'careManagerId', 'staffId', 'residenceId', 'firstAddedAt', 'review'];
check(Array.isArray(data.users), 'users: 配列必須');
const users = list(data.users);
check(users.length === 200, 'users: 200名');
const userIds = new Set();
for (const [i, u] of users.entries()) {
  const label = `users[${i}] (${u?.id})`;
  check(exactKeys(u, fields), `${label}: 全16キーのみ`);
  if (!object(u)) continue;
  for (const key of fields.filter(x => x !== 'review')) check(string(u[key]), `${label}: ${key}は文字列`);
  check(string(u.id) && !!u.id && !userIds.has(u.id), `${label}: ID非空・一意`);
  userIds.add(u.id);
  check(/^\d{4}$/.test(u.id) && u.id >= '0001' && u.id <= '0480', `${label}: ID範囲/ゼロ埋め`);
  if (i) check(users[i - 1]?.id < u.id, `${label}: ID昇順`);
  check(['', '利用中'].includes(u.usageStatus), `${label}: usageStatus値域`);
  check(['', '男', '女'].includes(u.gender), `${label}: parseBackup gender値域`);
  check(['男', '女'].includes(u.gender), `${label}: fixture gender空欄禁止`);
  check(date(u.birthDate) && u.birthDate >= '1930-01-01' && u.birthDate <= '1961-12-31', `${label}: 生年月日実在/範囲`);
  const age = 2026 - Number(String(u.birthDate).slice(0, 4)) - (String(u.birthDate).slice(5) > '11-05' ? 1 : 0);
  check(age >= 65 && age <= 96, `${label}: 基準日年齢65〜96歳`);
  check(canonicalIso(u.firstAddedAt) && u.firstAddedAt >= '2025-04-01T00:00:00.000Z' && u.firstAddedAt <= '2026-10-18T23:59:59.999Z', `${label}: firstAddedAt`);
  check(object(u.review), `${label}: review object必須`);
  check(same(u.review, {}) || same(u.review, { kanaBoundary: true }), `${label}: review許可キーのみ`);
  check(string(u.fullName) && /^[^\s]+ [^\s]+$/u.test(u.fullName), `${label}: 氏名の半角空白1個`);
  // NFKC re-composes voiced pairs, NFD decomposes them; compare their canonical forms.
  check(string(u.kana) && /^[\uFF66-\uFF9F]+(?: [\uFF66-\uFF9F]+)?$/u.test(u.kana), `${label}: 半角カタカナ`);
  check(u.kana === halfKana(u.kana), `${label}: toHalfKana正規形`);
  if (u.review?.kanaBoundary) check(u.sei === '' && u.mei === '' && !String(u.kana).includes(' '), `${label}: kanaBoundary時の境界未確定`);
  else check(string(u.kana) && u.kana.split(' ').length === 2 && u.kana === `${u.sei} ${u.mei}` && !!u.sei && !!u.mei, `${label}: splitKana一致`);
  for (const [kind] of config) check(maps[kind].has(u[`${kind}Id`]), `${label}: ${kind}参照が存在・空欄禁止`);
  check(maps.careManager.get(u.careManagerId)?.officeId === u.officeId, `${label}: CMと居宅一致`);
}
function halfKana(value) {
  const full = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンヮヰヱヵヶ';
  const half = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾜｲｴｶｹ';
  const map = new Map([...full].map((c, i) => [c, half[i]]));
  map.set('\u3099', 'ﾞ'); map.set('\u309a', 'ﾟ');
  return [...String(value).normalize('NFKC').normalize('NFD')].map(c => map.get(c) ?? c).join('');
}
check(users.filter(u => u?.review?.kanaBoundary).length === 3, 'kanaBoundary: 3名のみ');
const genders = count(users, 'gender');
check(genders['女'] >= 120 && genders['女'] <= 130, '女性60〜65%');
const names = Object.values(count(users, 'fullName'));
check(names.filter(n => n > 1).length <= 2 && names.every(n => n <= 2), '同姓同名: 最大2組・各2名');
const dates = new Set(users.map(u => u?.firstAddedAt));
check(dates.size === 19 && new Set([...dates].map(x => String(x).slice(0, 7))).size === 19, '初回取込: 月1回・19日時');
for (const s of maps.staff.keys()) { const n = users.filter(u => u?.staffId === s).length; check(n >= 8 && n <= 15, `${s}: 担当8〜15名`); }
check(users.filter(u => u?.residenceId === 'R0001').length === 150, '自宅75%');
check(Math.max(0, ...Object.values(count(users, 'officeId'))) === 50, '最大居宅25%');
check(same(mobilityNames.map((_, i) => users.filter(u => u?.mobilityId === `M000${i + 1}`).length), [40, 40, 20, 14, 13, 13, 20, 40]), '移動手段分布');

check(exactKeys(extension, ['format', 'schemaVersion', 'sourceBackup', 'generatedAt', 'statusDefinitions', 'users', 'attendance']), 'extension: キー/予約キーなし');
check(extension?.format === 'heart-relay-user-extension' && extension?.schemaVersion === 1, 'extension: format/schemaVersion');
check(extension?.sourceBackup === 'harmonize2_backup_fictional200.json', 'extension.sourceBackup');
check(extension?.generatedAt === backup?.createdAt, 'extension.generatedAt');
check(same(extension?.statusDefinitions, { serviceStatus: ['利用中', '中止中', '終了'], attendance: ['出席', '欠席', '対象外'] }), 'extension.statusDefinitions');
check(Array.isArray(extension?.users), 'extension.users: 配列必須');
const extra = list(extension?.users);
check(extra.length === 200 && new Set(extra.map(x => x?.id)).size === 200, 'extension: 一意な200名');
const statuses = count(extra, 'serviceStatus');
check(statuses['利用中'] === 150 && statuses['中止中'] === 30 && statuses['終了'] === 20, 'serviceStatus: 150/30/20');
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const scheduled = Object.fromEntries(weekdays.slice(1).map(x => [x, 0]));
for (const e of extra) {
  const u = users.find(u => u?.id === e?.id);
  check(exactKeys(e, ['id', 'serviceStatus', 'statusSince', 'weeklyPattern', 'transportRoute', 'transportNote']), `extension ${e?.id}: 必須キー/予約キーなし`);
  if (!object(e)) continue;
  check(!!u, `extension ${e.id}: 正本に存在`);
  check(['利用中', '中止中', '終了'].includes(e.serviceStatus), `extension ${e.id}: serviceStatus値域`);
  check((e.serviceStatus === '利用中' ? '利用中' : '') === u?.usageStatus, `extension ${e.id}: usageStatus一致`);
  check(date(e.statusSince) && e.statusSince >= String(u?.firstAddedAt).slice(0, 10) && e.statusSince <= '2026-11-05', `extension ${e.id}: statusSince`);
  const pattern = list(e.weeklyPattern);
  check(Array.isArray(e.weeklyPattern) && new Set(pattern).size === pattern.length && pattern.every(x => string(x) && Object.hasOwn(scheduled, x)), `extension ${e.id}: 曜日配列`);
  check(e.serviceStatus === '利用中' ? pattern.length >= 1 && pattern.length <= 3 : pattern.length === 0, `extension ${e.id}: 利用状況別の曜日数`);
  for (const day of pattern) if (string(day) && Object.hasOwn(scheduled, day)) scheduled[day]++;
  check(['1', '2', '3', '4', ''].includes(e.transportRoute) && (u?.residenceId === 'R0001' ? e.transportRoute !== '' : e.transportRoute === ''), `extension ${e.id}: 送迎コース`);
  check(string(e.transportNote) && e.transportNote.length <= 30, `extension ${e.id}: transportNote`);
}
for (const [day, n] of Object.entries(scheduled)) check(n >= 25 && n <= 40, `曜日 ${day}: 25〜40名 (${n})`);
check(extra.filter(x => x?.transportNote).length === 40, '送迎注意: 20%');
check(exactKeys(extension?.attendance, ['date', 'records']) && extension.attendance.date === '2026-11-10', 'attendance: 固定日付/キー');
const targetDay = weekdays[new Date('2026-11-10T00:00:00Z').getUTCDay()];
const records = list(extension?.attendance?.records);
check(Array.isArray(extension?.attendance?.records) && records.length === 200 && new Set(records.map(x => x?.id)).size === 200, 'attendance: 一意な200名');
let eligible = 0; let absent = 0;
for (const r of records) {
  const e = extra.find(e => e?.id === r?.id);
  check(exactKeys(r, ['id', 'status', 'reason']) && !!e, `attendance ${r?.id}: キー/参照`);
  if (!object(r)) continue;
  const expected = e?.serviceStatus === '利用中' && list(e?.weeklyPattern).includes(targetDay);
  check(expected ? ['出席', '欠席'].includes(r.status) : r.status === '対象外', `attendance ${r.id}: 実日付の${targetDay}曜日と一致`);
  check(string(r.reason) && (r.status === '欠席' ? ['受診', '体調不良', '家族都合'].includes(r.reason) : r.reason === ''), `attendance ${r.id}: reason`);
  if (expected) eligible++;
  if (r.status === '欠席') absent++;
}
check(absent === Math.round(eligible * 0.1), 'attendance: 欠席約10%');

const targets = users.filter(u => u?.usageStatus === '利用中').sort((a, b) => String(a.kana).localeCompare(String(b.kana), 'ja') || String(a.id).localeCompare(String(b.id), 'ja'));
check(targets.length === 150, '利用中: 150名');
const quote = v => /[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = rows => '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
const masterName = (kind, id) => maps[kind].get(id)?.name ?? '';
const mars = [['ID', '氏名', '担当', '移動手段', '居宅', 'ケアマネ'], ...targets.map(u => [u.id, u.fullName, masterName('staff', u.staffId), masterName('mobility', u.mobilityId), masterName('office', u.officeId), masterName('careManager', u.careManagerId)])];
const sds = [['種別', 'ID', '氏名'], ...targets.map(u => ['利用者', u.id, u.fullName]), ...[...maps.staff.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(s => ['スタッフ', s.id, s.name])];
for (const [path, rows] of [['harmonize2_mars_v2_fictional200.csv', mars], ['harmonize2_sds_v1_fictional200.csv', sds]]) {
  const text = read(`fixtures/harmonize2/${path}`);
  if (text === null) continue;
  check(text.startsWith('\uFEFF') && text.endsWith('\r\n') && !/[\r\n]/.test(text.replace(/\r\n/g, '')), `${path}: BOM/CRLF/末尾`);
  check(text.slice(1).split('\r\n')[0] === rows[0].join(','), `${path}: ヘッダー厳密一致`);
  check(text === csv(rows), `${path}: 全行の件数・値・順序・クォート一致`);
}
if (errors.length) {
  console.error(errors.map((e, i) => `${i + 1}. ${e}`).join('\n'));
  console.error(`FAIL: ${errors.length} violation(s)`);
  process.exitCode = 1;
} else {
  console.log('PASS: 0 violations');
  console.log('users=200 active=150 paused=30 ended=20 female=' + genders['女'] + ' kanaBoundary=3');
  console.log('masters: offices=8 careManagers=16 staff=15 residences=4 mobilities=8');
  console.log('CSV: MARS=150 SDS=150+15; UTF-8 BOM / CRLF / values / order OK');
  console.log('weekly: ' + JSON.stringify(scheduled));
  console.log(`attendance: 2026-11-10 (${targetDay}) scheduled=${eligible} present=${eligible - absent} absent=${absent} excluded=${records.length - eligible}`);
  console.log('root=' + fileURLToPath(root));
}
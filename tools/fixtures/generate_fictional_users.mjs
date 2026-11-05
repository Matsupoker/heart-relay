import { mkdirSync, writeFileSync } from 'node:fs';
import { STAFF } from '../../backend/src/seedData.js';

// Format source: Matsupoker/HARMONIZE d87c5e9 (2.2.0-mvp.1).
// Every name below is a synthetic vocabulary entry, never a person record.
const root = new URL('../../fixtures/', import.meta.url);
const NOW = '2026-11-05T00:00:00.000Z';
const SEED = 0x48523200;
function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const integer = n => Math.floor(random() * n);
function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = integer(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const pairs = text => text.split(/\s+/).filter(Boolean).map(x => x.split(':'));
const surnames = pairs(`
青野:アオノ 朝倉:アサクラ 安西:アンザイ 飯島:イイジマ 池上:イケガミ 石岡:イシオカ
板倉:イタクラ 稲葉:イナバ 岩瀬:イワセ 上野:ウエノ 宇田:ウダ 江口:エグチ
大沢:オオサワ 岡野:オカノ 奥村:オクムラ 尾崎:オザキ 笠原:カサハラ 片桐:カタギリ
金井:カナイ 川原:カワハラ 菊池:キクチ 岸田:キシダ 北岡:キタオカ 久保田:クボタ
倉田:クラタ 黒沢:クロサワ 小泉:コイズミ 古賀:コガ 小坂:コサカ 近田:コンダ
坂井:サカイ 桜井:サクライ 佐野:サノ 柴原:シバハラ 島崎:シマザキ 白川:シラカワ
杉原:スギハラ 瀬川:セガワ 園田:ソノダ 高井:タカイ 竹田:タケダ 田辺:タナベ
千葉:チバ 津田:ツダ 寺岡:テラオカ 戸田:トダ 中沢:ナカザワ 永井:ナガイ
新田:ニッタ 沼田:ヌマタ 根岸:ネギシ 野沢:ノザワ 橋田:ハシダ 畑中:ハタナカ
浜野:ハマノ 早川:ハヤカワ 平岡:ヒラオカ 福原:フクハラ 藤岡:フジオカ 星野:ホシノ
堀田:ホッタ 牧野:マキノ 丸岡:マルオカ 水野:ミズノ 宮原:ミヤハラ 村岡:ムラオカ
望月:モチヅキ 矢島:ヤジマ 柳原:ヤナギハラ 湯浅:ユアサ 吉岡:ヨシオカ 若林:ワカバヤシ
`);
const maleNames = pairs(`
昭夫:アキオ 明:アキラ 勲:イサオ 勇夫:イサオ 岩雄:イワオ 栄一:エイイチ
栄治:エイジ 和夫:カズオ 和彦:カズヒコ 勝男:カツオ 勝彦:カツヒコ 清一:キヨイチ
清志:キヨシ 国夫:クニオ 邦彦:クニヒコ 健一:ケンイチ 健治:ケンジ 幸一:コウイチ
幸三:コウゾウ 貞夫:サダオ 茂男:シゲオ 茂雄:シゲオ 滋:シゲル 静雄:シズオ
修一:シュウイチ 昭三:ショウゾウ 正二:ショウジ 進:ススム 誠司:セイジ 清二:セイジ
忠雄:タダオ 忠志:タダシ 隆夫:タカオ 孝夫:タカオ 武雄:タケオ 武志:タケシ
達夫:タツオ 辰雄:タツオ 千秋:チアキ 恒夫:ツネオ 照男:テルオ 敏夫:トシオ
利雄:トシオ 直夫:タダオ 信夫:ノブオ 信彦:ノブヒコ 春雄:ハルオ 秀夫:ヒデオ
久夫:ヒサオ 久志:ヒサシ 博:ヒロシ 文雄:フミオ 正男:マサオ 正彦:マサヒコ
昌夫:マサオ 守:マモル 道夫:ミチオ 光男:ミツオ 稔:ミノル 宗雄:ムネオ
保:タモツ 安雄:ヤスオ 幸男:ユキオ 豊:ユタカ 義夫:ヨシオ 義彦:ヨシヒコ
良一:リョウイチ 良三:リョウゾウ 六郎:ロクロウ 和男:カズオ
`);
const femaleNames = pairs(`
愛子:アイコ 明子:アキコ 秋子:アキコ 朝子:アサコ 厚子:アツコ 綾子:アヤコ
郁子:イクコ 育子:イクコ 石子:イシコ 歌子:ウタコ 梅子:ウメコ 栄子:エイコ
悦子:エツコ 延子:ノブコ 和子:カズコ 勝子:カツコ 加代子:カヨコ 喜久子:キクコ
絹子:キヌコ 清子:キヨコ 邦子:クニコ 久仁子:クニコ 圭子:ケイコ 恵子:ケイコ
幸子:サチコ 貞子:サダコ 早苗:サナエ 重子:シゲコ 静子:シズコ 志津子:シズコ
淑子:ヨシコ 澄子:スミコ 節子:セツコ 千恵子:チエコ 妙子:タエコ 孝子:タカコ
多喜子:タキコ 玉子:タマコ 千代子:チヨコ 常子:ツネコ 鶴子:ツルコ 照子:テルコ
敏子:トシコ とみ:トミ 富子:トミコ 直子:ナオコ 夏子:ナツコ 信子:ノブコ
春子:ハルコ 初子:ハツコ 花代:ハナヨ 秀子:ヒデコ 久子:ヒサコ 文子:フミコ
ふみ:フミ 房子:フサコ 政子:マサコ 松子:マツコ 道子:ミチコ 光子:ミツコ
美代子:ミヨコ 睦子:ムツコ 安子:ヤスコ 幸江:ユキエ 由紀子:ユキコ 良子:ヨシコ
律子:リツコ 和江:カズエ 洋子:ヨウコ 里子:サトコ
`);
for (const names of [surnames, maleNames, femaleNames]) {
  if (names.length < 60 || names.some(x => x.length !== 2)) throw new Error('Name vocabulary requires >=60 entries with readings');
}
// Same normalization pipeline as domain/text.ts; no kanji-to-reading inference.
// NFKC provides the reverse map for the standard half-width kana repertoire.
const halfMap = new Map(Array.from({ length: 58 }, (_, i) => String.fromCharCode(0xFF66 + i)).map(c => [c.normalize('NFKC'), c]));
halfMap.set('\u3099', 'ﾞ'); halfMap.set('\u309a', 'ﾟ');
const halfKana = value => [...value.normalize('NFKC').normalize('NFD')].map(c => halfMap.get(c) ?? c).join('');
const usedNames = new Set(STAFF.map(x => x.name));
function fictionalName(gender) {
  const names = gender === '女' ? femaleNames : maleNames;
  for (;;) {
    const surname = surnames[integer(surnames.length)];
    const given = names[integer(names.length)];
    const name = `${surname[0]} ${given[0]}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return { fullName: name, kana: halfKana(`${surname[1]} ${given[1]}`) };
    }
  }
}
const master = (prefix, names) => names.map((name, i) => ({ id: prefix + String(i + 1).padStart(4, '0'), name }));
const offices = master('K', ['ほのつむぎ町ケアプラン室', 'ゆめこずえ町居宅支援室', 'そらねむり町ケアプラン室', 'あわほし町居宅支援室', 'なぎしらべ町ケアプラン室', 'こもれつづり町居宅支援室', 'ふわみち町ケアプラン室', 'ひよりまゆ町居宅支援室']);
const careManagers = Array.from({ length: 16 }, (_, i) => ({ id: 'CM' + String(i + 1).padStart(4, '0'), name: fictionalName(i % 2 ? '女' : '男').fullName, officeId: offices[Math.floor(i / 2)].id }));
const selectedStaff = STAFF.filter(x => ['介護職員', '生活相談員', '看護師'].includes(x.role));
if (selectedStaff.length !== 15) throw new Error('Expected the 15 fictional staff in seedData.js');
const staff = master('S', selectedStaff.map(x => x.name));
const mobilities = master('M', ['1.独歩', '2.独歩（見守り）', '3.歩行（介助・手引き）', '4.歩行器（自立）', '5.歩行器（見守り）', '6.歩行器（介助）', '7.車椅子（自走）', '8.車椅子（介助）']);
const residences = master('R', ['1.自宅', '2.ほのつむぎ苑', '3.ゆめこずえ館', '4.そらねむり舎']);
const quota = counts => shuffle(counts.flatMap((n, i) => Array(n).fill(i)));
const ids = shuffle(Array.from({ length: 480 }, (_, i) => String(i + 1).padStart(4, '0'))).slice(0, 200).sort();
const genders = shuffle([...Array(125).fill('女'), ...Array(75).fill('男')]);
const mobility = quota([40, 40, 20, 14, 13, 13, 20, 40]);
const residence = quota([150, 18, 17, 15]);
const office = quota([50, 36, 28, 24, 20, 18, 14, 10]);
const staffAssignments = shuffle(Array.from({ length: 200 }, (_, i) => i % 15));
const statuses = shuffle([...Array(150).fill('利用中'), ...Array(30).fill('中止中'), ...Array(20).fill('終了')]);
const imports = Array.from({ length: 19 }, (_, i) => new Date(Date.UTC(2025, 3 + i, 1, 1)).toISOString());
const importAssignments = shuffle(Array.from({ length: 200 }, (_, i) => i % 19));
const notes = shuffle([...Array(40).fill(true), ...Array(160).fill(false)]);
const users = ids.map((id, i) => {
  const person = fictionalName(genders[i]);
  const year = 1930 + integer(32);
  // More births in spring/autumn; real month lengths, not a uniform day/month grid.
  const month = [1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12][integer(14)];
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let birth = new Date(Date.UTC(year, month - 1, 1 + integer(maxDay)));
  if (birth.toISOString().slice(0, 10) > '1961-11-05') birth = new Date(Date.UTC(1960, month - 1, birth.getUTCDate()));
  const [sei, mei] = person.kana.split(' ');
  return {
    id, ...person, sei, mei, birthDate: birth.toISOString().slice(0, 10), gender: genders[i],
    mobilityId: mobilities[mobility[i]].id, officeId: offices[office[i]].id, usageStatus: statuses[i] === '利用中' ? '利用中' : '',
    careManagerId: careManagers[office[i] * 2 + integer(2)].id, staffId: staff[staffAssignments[i]].id,
    residenceId: residences[residence[i]].id, firstAddedAt: imports[importAssignments[i]], review: {},
  };
});
// Two deliberate duplicate-name pairs; keep distinct IDs, with matching readings/genders.
for (const [from, to] of [[0, 1], [2, 3]]) {
  for (const key of ['fullName', 'kana', 'sei', 'mei', 'gender']) users[to][key] = users[from][key];
}
// Preserve the exact female quota despite copying the names in the deliberate pairs.
let delta = 125 - users.filter(u => u.gender === '女').length;
for (let i = 4; delta !== 0; i++) {
  const desired = delta > 0 ? '女' : '男';
  if (users[i].gender === desired) continue;
  const person = fictionalName(desired);
  const [sei, mei] = person.kana.split(' ');
  Object.assign(users[i], person, { sei, mei, gender: desired });
  delta += delta > 0 ? -1 : 1;
}
for (const i of [17, 83, 146]) {
  users[i].kana = users[i].kana.replace(' ', '');
  users[i].sei = ''; users[i].mei = ''; users[i].review = { kanaBoundary: true };
}
const days = ['月', '火', '水', '木', '金', '土'];
let activeIndex = 0;
const extensionUsers = users.map((u, i) => {
  const weeklyPattern = [];
  if (statuses[i] === '利用中') {
    const n = activeIndex++;
    weeklyPattern.push(days[n % 6]);
    if (n < 45) weeklyPattern.push(days[(n + 2) % 6]);
    if (n < 15) weeklyPattern.push(days[(n + 4) % 6]);
    weeklyPattern.sort((a, b) => days.indexOf(a) - days.indexOf(b));
  }
  const start = Date.parse(u.firstAddedAt.slice(0, 10));
  const span = Math.floor((Date.parse(NOW) - start) / 86400000);
  const statusSince = new Date(start + integer(span + 1) * 86400000).toISOString().slice(0, 10);
  return { id: u.id, serviceStatus: statuses[i], statusSince, weeklyPattern, transportRoute: u.residenceId === 'R0001' ? String(1 + integer(4)) : '', transportNote: notes[i] ? ['玄関前で待機', '到着時に呼び鈴', '門の内側で待機', '出発前に声かけ'][integer(4)] : '' };
});
const attendanceDate = '2026-11-10'; // Tuesday, despite the request's parenthetical Monday.
const weekday = ['日', ...days][new Date(`${attendanceDate}T00:00:00Z`).getUTCDay()];
const eligible = extensionUsers.filter(u => u.serviceStatus === '利用中' && u.weeklyPattern.includes(weekday));
const absentIds = new Set(shuffle(eligible).slice(0, Math.round(eligible.length * 0.1)).map(u => u.id));
const attendance = { date: attendanceDate, records: extensionUsers.map(u => {
  const scheduled = u.serviceStatus === '利用中' && u.weeklyPattern.includes(weekday);
  const status = !scheduled ? '対象外' : absentIds.has(u.id) ? '欠席' : '出席';
  return { id: u.id, status, reason: status === '欠席' ? ['受診', '体調不良', '家族都合'][integer(3)] : '' };
}) };
const data = { schemaVersion: 1, users, offices, careManagers, staff, residences, mobilities, counters: { office: 8, careManager: 16, staff: 15, residence: 4, mobility: 8 } };
const backup = { format: 'harmonize2-backup', schemaVersion: 1, appVersion: '2.2.0-mvp.1', createdAt: NOW, data };
const extension = { format: 'heart-relay-user-extension', schemaVersion: 1, sourceBackup: 'harmonize2_backup_fictional200.json', generatedAt: NOW, statusDefinitions: { serviceStatus: ['利用中', '中止中', '終了'], attendance: ['出席', '欠席', '対象外'] }, users: extensionUsers, attendance };
const targets = users.filter(u => u.usageStatus === '利用中').sort((a, b) => a.kana.localeCompare(b.kana, 'ja') || a.id.localeCompare(b.id, 'ja'));
const name = (items, id) => items.find(x => x.id === id).name;
const csvField = value => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csv = rows => '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
const mars = [['ID', '氏名', '担当', '移動手段', '居宅', 'ケアマネ'], ...targets.map(u => [u.id, u.fullName, name(staff, u.staffId), name(mobilities, u.mobilityId), name(offices, u.officeId), name(careManagers, u.careManagerId)])];
const sds = [['種別', 'ID', '氏名'], ...targets.map(u => ['利用者', u.id, u.fullName]), ...[...staff].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(s => ['スタッフ', s.id, s.name])];
for (const dir of ['harmonize2/', 'heart-relay/']) mkdirSync(new URL(dir, root), { recursive: true });
for (const [file, content] of [
  ['harmonize2/harmonize2_backup_fictional200.json', JSON.stringify(backup, null, 2)],
  ['harmonize2/harmonize2_mars_v2_fictional200.csv', csv(mars)],
  ['harmonize2/harmonize2_sds_v1_fictional200.csv', csv(sds)],
  ['heart-relay/user_extension_fictional200.json', JSON.stringify(extension, null, 2)],
]) writeFileSync(new URL(file, root), content, 'utf8');
console.log(`Generated: users=200 active=150 paused=30 ended=20 seed=0x${SEED.toString(16)}`);
console.log('masters: offices=8 careManagers=16 staff=15 residences=4 mobilities=8');
console.log('CSV: MARS=150 SDS=150+15; data files=4; XLS=not generated');
console.log(`Name vocabulary: surnames=${surnames.length} male=${maleNames.length} female=${femaleNames.length}`);
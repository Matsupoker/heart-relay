// 連絡文から対象利用者を決定的に照合する（Claude は使わない）。規則は docs/api.md「利用者照合の規則」。
//
// 1. 正規化: NFKC（半角カナ→全角・濁点結合も含む）→ 空白除去 → 敬称（様・さん・氏・さま）除去
// 2. ID: 「ID / No. / # / 利用者」に続く4桁、または引用付き4桁（"0001"「0001」など）のみ
// 3. 氏名完全一致 90 ／ カナ完全一致 85 ／ 姓のみ 50（姓は2文字以上のみ）
// 4. 自動確定: ID一致が1名、または氏名／カナ完全一致が1名で台帳に同姓同名なし。それ以外は ambiguous
// 5. 候補なしは none

const HONORIFICS = /様|さん|さま|氏/g;
const MASK = '\u0000'; // 一致済みの範囲を塗りつぶす文字（姓の二重検出を防ぐ）

/** 照合用の正規化（NFKC・空白除去・敬称除去） */
export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, '').replace(HONORIFICS, '');
}

/** ひらがな → カタカナ（カナ照合用） */
export function toKatakana(s) {
  return String(s ?? '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** 本文中の利用者ID（4桁）を抽出する。時刻・年などの4桁は拾わない */
export function extractIds(text) {
  const t = String(text ?? '').normalize('NFKC');
  const ids = new Set();
  const prefixed = /(?:ID|No\.?|#|利用者(?:ID|番号)?)\s*[:：]?\s*(\d{4})(?!\d)/gi;
  const quoted = /["'“”‘’「『【(（](\d{4})["'“”‘’」』】)）]/g;
  for (const m of t.matchAll(prefixed)) ids.add(m[1]);
  for (const m of t.matchAll(quoted)) ids.add(m[1]);
  return [...ids];
}

const surnameOf = (name) => String(name ?? '').normalize('NFKC').trim().split(/\s+/)[0] || '';

/** 照合用の索引（residents が同じなら再利用する） */
const indexCache = new WeakMap();
function buildIndex(residents) {
  if (indexCache.has(residents)) return indexCache.get(residents);
  const nameCount = new Map();
  const entries = residents.map((r) => {
    const name = normalizeText(r.name);
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
    return {
      r, name,
      kana: toKatakana(normalizeText(r.kana)),
      sei: surnameOf(r.name),
    };
  });
  for (const e of entries) e.sameName = nameCount.get(e.name) > 1;
  const idx = { entries, byId: new Map(entries.map((e) => [e.r.id, e])) };
  indexCache.set(residents, idx);
  return idx;
}

/** text 中の needle をすべて MASK に置き換える。見つかったら true */
function maskAll(holder, needle) {
  if (!needle || !holder.text.includes(needle)) return false;
  holder.text = holder.text.split(needle).join(MASK.repeat(needle.length));
  return true;
}

/**
 * 利用者照合。
 * @param {string} text 連絡文
 * @param {Array} residents Resident 型（id, name, kana, service_status を使う）の配列
 * @param {{excludeNames?: string[]}} opts 職員・ケアマネなど利用者でない人の氏名（照合前に除外する）
 * @returns {{status:'confirmed'|'ambiguous'|'none', resident_id:string|null, candidates:Array}}
 */
export function matchResidents(text, residents, { excludeNames = [] } = {}) {
  const idx = buildIndex(residents);
  const found = new Map(); // id -> candidate
  const add = (e, score, reason) => {
    const cur = found.get(e.r.id);
    if (cur && cur.score >= score) return;
    found.set(e.r.id, {
      id: e.r.id, name: e.r.name, kana: e.r.kana, service_status: e.r.service_status,
      score, reason, same_name: e.sameName,
    });
  };

  // 2. ID
  const idHits = extractIds(text).map((id) => idx.byId.get(id)).filter(Boolean);
  for (const e of idHits) add(e, 100, `ID「${e.r.id}」が一致`);

  // 職員・ケアマネの氏名（フルネーム）を先に塗りつぶす
  const kanji = { text: normalizeText(text) };
  const kana = { text: toKatakana(kanji.text) };
  for (const n of excludeNames) maskAll(kanji, normalizeText(n));

  // 3. 氏名・カナの完全一致（長い名前から順に塗りつぶす）
  const byNameLen = [...idx.entries].sort((a, b) => b.name.length - a.name.length);
  const fullHits = [];
  const hitNames = new Set();
  for (const e of byNameLen) {
    if (hitNames.has(e.name) || kanji.text.includes(e.name)) {
      hitNames.add(e.name);
      add(e, 90, '氏名が一致');
      fullHits.push(e);
    }
  }
  for (const n of hitNames) maskAll(kanji, n);
  const hitKana = new Set();
  for (const e of [...idx.entries].sort((a, b) => b.kana.length - a.kana.length)) {
    if (e.kana.length < 3) continue;
    if (hitKana.has(e.kana) || kana.text.includes(e.kana)) {
      hitKana.add(e.kana);
      add(e, 85, 'カナが一致');
      fullHits.push(e);
    }
  }
  for (const k of hitKana) maskAll(kana, k);

  // 3'. 姓のみ（2文字以上。完全一致で塗りつぶした範囲は対象外）
  for (const e of idx.entries) {
    if (e.sei.length >= 2 && kanji.text.includes(e.sei)) add(e, 50, `姓「${e.sei}」が一致`);
  }

  const candidates = [...found.values()].sort((a, b) =>
    b.score - a.score
    || (a.service_status === '利用中' ? 0 : 1) - (b.service_status === '利用中' ? 0 : 1)
    || a.id.localeCompare(b.id)).slice(0, 10);

  // 4. 自動確定の判定
  const people = (list) => new Set(list.map((e) => e.r.id));
  const fullIds = people(fullHits);
  let status = 'none';
  let residentId = null;
  if (idHits.length > 0) {
    const ids = people(idHits);
    const [only] = ids;
    const idName = idx.byId.get(only)?.name;
    // ID と別人の氏名が併記されていれば複数名の可能性 → ambiguous（同姓同名の相手は同一人物の言及とみなす）
    const others = fullHits.filter((e) => e.r.id !== only && e.name !== idName);
    if (ids.size === 1 && others.length === 0) { status = 'confirmed'; residentId = only; } else status = 'ambiguous';
  } else if (fullIds.size === 1) {
    const [only] = fullIds;
    if (idx.byId.get(only).sameName) status = 'ambiguous';
    else { status = 'confirmed'; residentId = only; }
  } else if (found.size > 0) {
    status = 'ambiguous'; // 複数の完全一致・同姓同名・姓のみ
  }
  return { status, resident_id: residentId, candidates };
}

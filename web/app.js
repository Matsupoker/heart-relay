// HEART RELAY PC Webアプリ（Vanilla JS / ES modules, ビルド不要）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FALLBACK_SAMPLES = [
  { label: '受診で15時帰宅', text: 'A様は本日、受診のため15時までに帰宅が必要です。午後の送迎を調整してください。' },
  { label: '明日欠席', text: 'B様のご家族より電話。体調不良のため明日は欠席とのこと。' },
  { label: '食事形態をおかゆに変更', text: 'C様の食事形態を、本日の昼食からおかゆに変更。むせ込みに注意してください。' },
  { label: '送迎車点検', text: '明日午前、送迎車2号車を点検に出します。午前の送迎は1号車のみとなります。' },
  { label: '入浴時の湿布依頼', text: 'A様、入浴後に腰へ湿布を貼ってほしいとご家族から依頼がありました。' },
];

const state = {
  staff: new Map(),
  samples: FALLBACK_SAMPLES,
  current: null,        // 中央パネルに表示中の Message（または {loading:true}）
  recips: [],           // 編集中の宛先 [{staff_id, reason, title, body, action_required, checked}]
  messages: [],
  ackedSeen: null,      // Set<delivery id>（初回はnull）
  busy: false,
  audience: 'individual',
  board: { title: '', body: '', until: '' },   // until は datetime-local 値（JST）
  attachments: [],      // 反映済みの添付 [{id, filename, kind, ...}]
  extract: null,        // 確認待ちの抽出結果 {att, text}
  intakeBusy: null,     // 取り込み中のファイル名
  changing: false,      // 提案表示中に利用者を変更するUIを開いているか
  pickResults: null,    // 検索結果 Resident[] | null
  dlAll: false,         // 配信管理: 「すべて」表示か
  exclOpen: false,      // 配信詳細: 除外職員の折りたたみ開閉
  pending: null,        // ルート遷移後に行う操作 'focus'
};
const NARROW = window.matchMedia('(max-width: 900px)');
const LS_KEY = 'hr.createdBy';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// ---------- util ----------
const TZ = 'Asia/Tokyo';
function parseDate(iso) { return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z'); }
function jstParts(d) {
  const f = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = parseDate(iso), p = jstParts(d), n = jstParts(new Date());
  const hm = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  return (p.month === n.month && p.day === n.day) ? hm : `${p.month}/${p.day} ${hm}`;
}
function fmtFull(iso) { const p = jstParts(parseDate(iso)); return `${p.month}/${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`; }
const URG = { high: '緊急度：高', medium: '緊急度：中', low: '緊急度：低' };

function toast(msg, kind = 'err') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg; el.dataset.testid = 'toast';
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
async function api(path, opts = {}) {
  let res;
  try {
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    res = await fetch(path, { ...opts, headers: isForm ? { ...(opts.headers || {}) } : { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined });
  } catch (e) { setConn(false); throw new Error('サーバーに接続できません'); }
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) { const err = new Error((data && data.error) || `エラー (${res.status})`); err.status = res.status; err.data = data; throw err; }
  setConn(true);
  return data;
}
function setConn(ok) {
  const el = $('conn'); el.className = 'conn ' + (ok ? 'conn-on' : 'conn-off');
  el.querySelector('span').textContent = ok ? '接続中' : '接続できません';
}

// ---------- header ----------
async function loadHealth() {
  const b = $('analyzer-badge');
  try {
    const h = await api('/api/health');
    if (h.analyzer === 'claude') { b.className = 'badge badge-claude'; b.textContent = `Claude API（${h.model || 'モデル不明'}）`; }
    else { b.className = 'badge badge-mock'; b.textContent = 'モック解析（APIキー未設定）'; }
  } catch { b.className = 'badge badge-neutral'; b.textContent = '解析モード不明'; }
}

// ---------- input ----------
async function loadSamples() {
  try {
    const d = await fetch('/api/demo-messages');
    if (d.ok) {
      const j = await d.json();
      const arr = Array.isArray(j) ? j : (j.messages || j.items || []);
      const norm = arr.map((x) => typeof x === 'string' ? { label: x.slice(0, 12), text: x }
        : { label: x.label || x.title || x.name || String(x.raw_text || x.text || '').slice(0, 12), text: x.raw_text || x.text || x.body || '' }).filter((x) => x.text);
      if (norm.length) state.samples = norm;
    }
  } catch { /* fallback */ }
  renderQuick();
}
function renderQuick() {
  const q = $('quick'); q.innerHTML = '';
  state.samples.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.label; b.dataset.testid = `sample-${i}`; b.title = s.text;
    b.addEventListener('click', () => { $('raw-text').value = s.text; $('raw-text').focus(); });
    q.appendChild(b);
  });
}
function setBusy(b) {
  state.busy = b;
  const btn = $('submit');
  btn.disabled = b;
  btn.innerHTML = b ? '<span class="spinner"></span>解析中…' : 'AIで解析する';
}
async function submitMessage(ev) {
  ev.preventDefault();
  const raw = $('raw-text').value.trim();
  if (!raw) { toast('連絡内容を入力してください'); return; }
  if (state.busy) return;
  if (state.extract && !confirm('「抽出内容の確認」がまだ反映されていません。反映せずに解析しますか？')) return;
  syncSource();
  state.changing = false; state.pickResults = null;
  state.current = { loading: true };
  setBusy(true); renderProposal(); focusProposal();
  const body = { raw_text: raw, source: $('source').value, created_by: $('created-by').value || '相談員 デモ' };
  if (state.attachments.length) body.attachment_ids = state.attachments.map((a) => a.id);
  try {
    const m = await api('/api/messages', { method: 'POST', body });
    state.attachments = []; renderChips();
    setCurrent(m);
  } catch (e) {
    state.current = null; toast('解析に失敗しました: ' + e.message);
    renderProposal();
  } finally { setBusy(false); }
}
function toLocalInput(iso) {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parseDate(iso));
  return p.replace(' ', 'T').replace(/T24:/, 'T00:');
}
function fromLocalInput(v) { if (!v) return null; const d = new Date(v + ':00+09:00'); return isNaN(d) ? null : d.toISOString(); }
function setCurrent(m) {
  state.current = m; state.changing = false; state.pickResults = null;
  if (m.status === 'proposed' && m.analysis) {
    const a = m.analysis;
    state.recips = (a.recipients || []).map((r) => ({ ...r, checked: true }));
    state.audience = ['individual', 'board', 'both'].includes(a.audience) ? a.audience : 'individual';
    const bp = a.board_post;
    state.board = { title: bp ? bp.title : '', body: bp ? bp.body : '', until: bp ? toLocalInput(bp.until) : '' };
  } else state.recips = [];
  renderProposal();
  if (m.status === 'proposed' || m.status === 'needs_resident' || m.status === 'failed') focusProposal();
}
function focusProposal() {
  if (NARROW.matches && currentRoute().name === 'new') { const h = $('h-prop'); if (h) h.scrollIntoView({ block: 'start' }); }
}
function syncSource() {
  if (state.attachments.length && $('source').value === '手入力') $('source').value = '書類（ファイル）';
}

// ---------- file intake (P0-4) ----------
const KIND = { image: '画像', pdf: 'PDF', txt: 'テキスト', docx: 'Word', xlsx: 'Excel', xls: 'Excel（旧形式）' };
async function intakeFile(file) {
  if (!file) return;
  if (state.intakeBusy) { toast('別のファイルを読み取り中です'); return; }
  state.intakeBusy = file.name; state.extract = null; renderIntake();
  const fd = new FormData(); fd.append('file', file, file.name);
  try {
    const att = await api('/api/intake', { method: 'POST', body: fd });
    state.extract = { att, text: att.extracted_text || '' };
  } catch (e) { toast('取り込みに失敗しました: ' + e.message); }
  finally { state.intakeBusy = null; renderIntake(); }
}
function renderIntake() {
  const st = $('intake-status'), area = $('extract-area');
  st.innerHTML = state.intakeBusy ? `<div class="loading small" data-testid="intake-loading"><span class="spinner dark"></span>「${esc(state.intakeBusy)}」を読み取り中…<small>画像・PDFは Claude で読み取ります（数秒〜20秒ほど）</small></div>` : '';
  const x = state.extract;
  if (!x) { area.innerHTML = ''; return; }
  const a = x.att;
  area.innerHTML = `<div class="extract" data-testid="extract-panel">
    <h3>抽出内容の確認</h3>
    <div class="chips"><span class="chip" data-testid="extract-filename">${esc(a.filename)}</span><span class="chip">${esc(KIND[a.kind] || a.kind)}</span>
      <span class="chip ${a.extractor === 'claude' ? 'chip-claude' : ''}" data-testid="extract-method">${a.extractor === 'claude' ? 'Claudeで読み取り' : 'ローカル抽出'}</span></div>
    ${(a.warnings || []).length ? `<ul class="warn-list" data-testid="extract-warnings">${a.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${a.kind === 'image' ? `<img class="preview" data-testid="extract-preview" alt="取り込んだ画像のプレビュー" src="/api/attachments/${encodeURIComponent(a.id)}/file">` : ''}
    <label class="field-label" for="extract-text">読み取り結果（原本と見比べて必要なら修正してください）</label>
    <textarea id="extract-text" data-testid="extract-text" rows="7"></textarea>
    <div class="btn-row"><button type="button" class="btn btn-primary" id="extract-apply" data-testid="extract-apply">この内容を連絡内容に反映</button>
      <button type="button" class="btn" id="extract-discard" data-testid="extract-discard">破棄</button></div>
  </div>`;
  const ta = $('extract-text'); ta.value = x.text;
  ta.addEventListener('input', () => { state.extract.text = ta.value; });
  $('extract-apply').addEventListener('click', applyExtract);
  $('extract-discard').addEventListener('click', () => { state.extract = null; renderIntake(); });
}
function applyExtract() {
  const x = state.extract; if (!x) return;
  const txt = x.text.trim();
  const rt = $('raw-text');
  if (txt) rt.value = rt.value.trim() ? rt.value.replace(/\s+$/, '') + '\n\n' + txt : txt;
  if (!state.attachments.some((a) => a.id === x.att.id)) state.attachments.push(x.att);
  state.extract = null; syncSource(); renderIntake(); renderChips();
  toast('連絡内容に反映しました。内容を確認して「AIで解析する」を押してください', 'ok');
}
function renderChips() {
  const root = $('chips');
  root.innerHTML = state.attachments.map((a, i) => `<span class="att-chip" data-testid="attachment-chip" data-id="${esc(a.id)}">📎 ${esc(a.filename)}<button type="button" class="chip-x" data-i="${i}" data-testid="attachment-remove" aria-label="${esc(a.filename)} を外す">×</button></span>`).join('');
  root.querySelectorAll('.chip-x').forEach((b) => b.addEventListener('click', () => { state.attachments.splice(Number(b.dataset.i), 1); renderChips(); }));
}
function setupCreatedBy() {
  const sel = $('created-by'); const saved = lsGet(LS_KEY);
  const list = [...state.staff.values()].filter((s) => s.active !== false);
  if (!list.length) return;
  sel.innerHTML = list.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}（${esc(s.role)}）</option>`).join('');
  const names = list.map((s) => s.name);
  sel.value = names.includes(saved) ? saved : (list.find((s) => s.role === '生活相談員') || list[0]).name;
  sel.addEventListener('change', () => lsSet(LS_KEY, sel.value));
}

// ---------- proposal ----------
function staffLine(id) {
  const s = state.staff.get(id);
  if (!s) return { name: id, role: '', duties: [] };
  return { name: s.name, role: s.role, duties: s.duties || [] };
}
function keepScroll(fn) {
  const col = document.querySelector('.col-proposal'); const st = col ? col.scrollTop : 0; const wy = window.scrollY;
  fn(); const c2 = document.querySelector('.col-proposal'); if (c2) c2.scrollTop = st; window.scrollTo(0, wy);
}
const STATUS_CLS = { 利用中: 'ok', 中止中: 'warn', 終了: 'off' };
function residentBlock(r, m) {
  if (!r) return `<div class="resident-box none" data-testid="resident"><b>対象利用者：特定なし</b><span class="sub">（利用者に関係しない連絡として扱います）</span></div>`;
  const at = r.attendance || {};
  return `<div class="resident-box" data-testid="resident">
    <div class="res-head"><span class="rname">${esc(r.name)}</span><span class="res-kana">${esc(r.kana || '')}</span><span class="chip">ID ${esc(r.id)}</span><span class="st st-${STATUS_CLS[r.service_status] || 'off'}">${esc(r.service_status)}</span></div>
    <dl class="meta">
      <dt>通所予定</dt><dd>${esc((r.weekly_pattern || []).join('・') || 'なし')}</dd>
      <dt>当日の出欠</dt><dd data-testid="resident-attendance">${esc(at.status || '—')}${at.reason ? '（' + esc(at.reason) + '）' : ''}${at.date ? ` <span class="sub">${esc(at.date)}</span>` : ''}</dd>
      <dt>送迎</dt><dd>${r.transport_route ? 'コース' + esc(r.transport_route) : 'なし（施設居住など）'}${r.transport_note ? ' ／ ' + esc(r.transport_note) : ''}</dd>
      <dt>担当職員</dt><dd>${esc(r.staff_name || '—')}</dd>
    </dl></div>`;
}
function candCard(c, isSearch) {
  const same = c.same_name ? '<span class="dup" data-testid="same-name-badge">同姓同名あり</span>' : '';
  return `<button type="button" class="cand" data-testid="resident-candidate" data-rid="${esc(c.id)}">
    <span class="cand-main"><span class="rname">${esc(c.name)}</span><span class="res-kana">${esc(c.kana || '')}</span>${same}</span>
    <span class="cand-sub"><span class="st st-${STATUS_CLS[c.service_status] || 'off'}">${esc(c.service_status)}</span> <span class="sub">ID ${esc(c.id)}</span>
      ${c.reason ? `<span class="cand-why">${esc(c.reason)}</span>` : ''}${c.score != null && !isSearch ? `<span class="score" data-testid="cand-score">score ${esc(c.score)}</span>` : ''}</span></button>`;
}
function pickerHtml(m) {
  const cands = state.pickResults ? state.pickResults.map((r) => ({ id: r.id, name: r.name, kana: r.kana, service_status: r.service_status, reason: '検索結果', score: null, same_name: false })) : ((m.resident_match && m.resident_match.candidates) || []);
  const isSearch = !!state.pickResults;
  const lead = state.changing
    ? '<p class="summary">対象利用者を変更します</p><p class="hint">変更を確定すると、新しい利用者の情報で<b>再解析</b>します（現在の提案は破棄されます）。</p>'
    : '<p class="summary" data-testid="needs-resident">どの利用者の連絡ですか？</p><p class="hint">文中の名前だけでは利用者を一人に決められませんでした。該当する方を選んでください。</p>';
  return `${lead}
    <p class="raw">${esc(m.raw_text)}</p>
    <div class="cands" data-testid="resident-candidates">${cands.length ? cands.map((c) => candCard(c, isSearch)).join('') : '<div class="placeholder">候補がありません。検索してください。</div>'}</div>
    <label class="field-label" for="resident-search">利用者を検索（氏名・カナ・ID）</label>
    <input type="text" id="resident-search" data-testid="resident-search" placeholder="例：新田" autocomplete="off">
    <div class="btn-row"><button type="button" class="btn" id="resident-none" data-testid="resident-none">利用者に関係しない連絡</button>
      ${state.changing ? '<button type="button" class="btn" id="resident-cancel" data-testid="resident-cancel">変更をやめる</button>' : ''}</div>`;
}
function bindPicker(m) {
  const root = $('proposal');
  root.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => chooseResident(m, b.dataset.rid)));
  $('resident-none').addEventListener('click', () => chooseResident(m, null));
  const c = $('resident-cancel'); if (c) c.addEventListener('click', () => { state.changing = false; state.pickResults = null; renderProposal(); });
  let timer = null; const inp = $('resident-search');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = inp.value.trim();
      try { state.pickResults = q ? await api('/api/residents?q=' + encodeURIComponent(q) + '&limit=10') : null; }
      catch (e) { toast('検索に失敗しました: ' + e.message); return; }
      const list = root.querySelector('.cands'); if (!list) return;
      const cands = state.pickResults ? state.pickResults.map((r) => ({ id: r.id, name: r.name, kana: r.kana, service_status: r.service_status, reason: '検索結果', same_name: false })) : ((m.resident_match && m.resident_match.candidates) || []);
      list.innerHTML = cands.length ? cands.map((x) => candCard(x, !!state.pickResults)).join('') : '<div class="placeholder" data-testid="search-empty">該当する利用者がいません。</div>';
      list.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => chooseResident(m, b.dataset.rid)));
    }, 250);
  });
}
async function chooseResident(m, rid) {
  if (state.busy) return;
  if (state.changing && !confirm('対象利用者を変更すると再解析します（現在の提案内容と編集は破棄されます）。よろしいですか？')) return;
  state.current = { loading: true }; state.changing = false; state.pickResults = null;
  setBusy(true); renderProposal();
  try { setCurrent(await api(`/api/messages/${encodeURIComponent(m.id)}/resident`, { method: 'POST', body: { resident_id: rid } })); }
  catch (e) { toast('利用者の確定に失敗しました: ' + e.message); state.current = m; renderProposal(); }
  finally { setBusy(false); }
}
const AUD = [['individual', '個別のみ', '選んだ職員にだけ届けます'], ['board', '全体共有のみ', '共有ボードに掲示します（個別配信なし）'], ['both', '両方', '個別配信＋共有ボード掲示']];
function renderProposal() {
  const root = $('proposal'); const m = state.current;
  if (!m) { root.innerHTML = '<div class="placeholder" data-testid="proposal-empty">連絡事項を入力して「AIで解析する」を押すと、ここにAIの提案が表示されます。</div>'; return; }
  if (m.loading || m.status === 'analyzing') {
    root.innerHTML = '<div class="loading" data-testid="proposal-loading"><span class="spinner dark"></span>解析中…<small>Claudeが宛先と個別の本文を考えています（最大20秒ほど）</small></div>';
    return;
  }
  if (m.status === 'needs_resident') { root.innerHTML = pickerHtml(m); bindPicker(m); return; }
  if (m.status === 'failed') {
    root.innerHTML = `<div class="error-box" data-testid="proposal-failed">解析に失敗しました：${esc(m.error || '原因不明')}</div>
      <p class="raw">${esc(m.raw_text)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="btn-reanalyze" data-testid="btn-reanalyze">再解析</button></div>`;
    $('btn-reanalyze').addEventListener('click', reanalyze);
    return;
  }
  if (m.status === 'sent') {
    root.innerHTML = '<div class="ok-box">配信済みです。「配信管理」で確認状況を確認できます。</div>';
    return;
  }
  if (state.changing) { root.innerHTML = pickerHtml(m); bindPicker(m); return; }
  const a = m.analysis;
  const usage = m.usage ? `入力 ${m.usage.input_tokens} / 出力 ${m.usage.output_tokens} トークン ≈ $${Number(m.usage.est_cost_usd).toFixed(4)}` : '';
  const used = new Set(state.recips.map((r) => r.staff_id));
  const addable = [...state.staff.values()].filter((s) => s.active !== false && !used.has(s.id));
  const aud = state.audience; const showInd = aud !== 'board'; const showBoard = aud !== 'individual';
  const excl = a.excluded || [];
  root.innerHTML = `
    <p class="summary" data-testid="summary">${esc(a.summary)}</p>
    <div class="chips">
      <span class="urg urg-${esc(a.urgency)}" data-testid="urgency">${esc(URG[a.urgency] || a.urgency)}</span>
      ${(a.categories || []).map((c) => `<span class="chip" data-testid="category">${esc(c)}</span>`).join('')}
    </div>
    <div class="res-wrap">${residentBlock(m.resident, m)}<button type="button" class="btn btn-sm" id="resident-change" data-testid="resident-change">利用者を変更</button></div>
    <dl class="meta">
      <dt>期限</dt><dd data-testid="deadline">${esc(a.deadline || 'なし')}</dd>
      <dt>必要な対応</dt><dd>${(a.required_actions || []).length ? `<ul class="actions-list" data-testid="required-actions">${a.required_actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : 'なし'}</dd>
    </dl>
    <fieldset class="aud" data-testid="audience"><legend>届け方</legend>
      ${AUD.map(([v, l, d]) => `<label class="aud-opt ${aud === v ? 'on' : ''}"><input type="radio" name="audience" value="${v}" data-testid="audience-${v}" ${aud === v ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}
    </fieldset>
    ${showInd ? `<h3>宛先候補（${state.recips.length}名）— 内容を確認・修正してください</h3>
    <div id="rcpts" data-testid="recipients">${state.recips.map(rcptHtml).join('')}</div>
    <div class="add-row">
      <select id="add-select" data-testid="add-select"><option value="">宛先を追加…</option>
        ${addable.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.role)}）</option>`).join('')}</select>
      <button class="btn" id="btn-add" type="button" data-testid="btn-add">追加</button>
    </div>` : '<p class="hint" data-testid="no-individual">個別配信は行いません（共有ボードのみ）。</p>'}
    ${showBoard ? `<h3>共有ボードに掲示する内容</h3>
    <div class="board-edit" data-testid="board-edit">
      <label class="field-label" for="board-title">掲示タイトル</label><input type="text" id="board-title" data-testid="board-title" value="${esc(state.board.title)}">
      <label class="field-label" for="board-body">掲示本文（フロアの全員が見ます）</label><textarea id="board-body" data-testid="board-body" rows="3">${esc(state.board.body)}</textarea>
      <label class="field-label" for="board-until">掲示の期限（空欄なら当日中）</label><input type="datetime-local" id="board-until" data-testid="board-until" value="${esc(state.board.until)}">
    </div>` : `<h4 class="future-h">共有ボード向け要点</h4><div class="future" data-testid="board-summary">${esc(a.board_summary || '—')}</div>`}
    <h4 class="future-h">送らないと判断した職員と理由</h4>
    ${excl.length ? `<ul class="excl" data-testid="excluded-list">${excl.map((x) => { const s = staffLine(x.staff_id); return `<li data-testid="excluded-item"><b>${esc(s.name)}</b>${s.role ? `<span class="role">${esc(s.role)}</span>` : ''}<span class="excl-why">${esc(x.reason)}</span></li>`; }).join('')}</ul>` : ''}
    <div class="future" data-testid="excluded-note">${esc(a.excluded_note || '—')}</div>
    <div class="btn-row">
      <button class="btn btn-send" id="btn-send" data-testid="btn-send">承認して配信</button>
      <button class="btn" id="btn-reanalyze" data-testid="btn-reanalyze">再解析</button>
    </div>
    <div class="usage" data-testid="usage">${esc(usage)}${m.analyzer ? ` ／ 解析: ${m.analyzer === 'claude' ? 'Claude' + (m.model ? '（' + esc(m.model) + '）' : '') : 'モック'}` : ''}</div>`;
  root.querySelectorAll('.rcpt').forEach(bindRcpt);
  const add = $('btn-add'); if (add) add.addEventListener('click', addRecipient);
  $('btn-send').addEventListener('click', sendMessage);
  $('btn-reanalyze').addEventListener('click', reanalyze);
  $('resident-change').addEventListener('click', () => { state.changing = true; state.pickResults = null; renderProposal(); });
  root.querySelectorAll('input[name=audience]').forEach((r) => r.addEventListener('change', () => { state.audience = r.value; keepScroll(renderProposal); }));
  [['board-title', 'title'], ['board-body', 'body'], ['board-until', 'until']].forEach(([id, k]) => { const el = $(id); if (el) el.addEventListener('input', () => { state.board[k] = el.value; updateSendBtn(); }); });
  updateSendBtn();
}
function rcptHtml(r, i) {
  const s = staffLine(r.staff_id);
  return `<div class="rcpt ${r.checked ? '' : 'off'}" data-idx="${i}" data-testid="recipient-card" data-staff-id="${esc(r.staff_id)}">
    <div class="rcpt-head">
      <span class="rname" data-testid="rcpt-name">${esc(s.name)}</span><span class="role">${esc(s.role)}</span>
      <label class="send"><input type="checkbox" data-f="checked" data-testid="rcpt-check" ${r.checked ? 'checked' : ''}>送る</label>
    </div>
    ${s.duties.length ? `<div class="duties">当日の担当：${s.duties.map(esc).join('、')}</div>` : ''}
    ${r.reason ? `<div class="reason" data-testid="rcpt-reason">AIの理由：${esc(r.reason)}</div>` : '<div class="reason">手動で追加した宛先</div>'}
    <div class="rgrid"><div><label class="field-label">タイトル</label><input type="text" data-f="title" data-testid="rcpt-title" value="${esc(r.title)}"></div>
    <div><label class="field-label">必要な対応</label><input type="text" data-f="action_required" data-testid="rcpt-action" value="${esc(r.action_required)}"></div></div>
    <label class="field-label">本文</label><textarea data-f="body" data-testid="rcpt-body" rows="2">${esc(r.body)}</textarea>
    ${r.reason ? '' : '<button type="button" class="rm" data-rm>この宛先を削除</button>'}
  </div>`;
}
function bindRcpt(card) {
  const idx = Number(card.dataset.idx);
  card.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('input', () => {
      const f = el.dataset.f;
      if (f === 'checked') { state.recips[idx].checked = el.checked; card.classList.toggle('off', !el.checked); updateSendBtn(); }
      else state.recips[idx][f] = el.value;
    });
  });
  const rm = card.querySelector('[data-rm]');
  if (rm) rm.addEventListener('click', () => { state.recips.splice(idx, 1); renderProposal(); });
}
function sendPlan() {
  const aud = state.audience;
  const n = aud === 'board' ? 0 : state.recips.filter((r) => r.checked).length;
  const useBoard = aud !== 'individual';
  const boardOk = !useBoard || (state.board.title.trim() && state.board.body.trim());
  const valid = (n > 0 || useBoard) && boardOk;
  const label = aud === 'individual' ? (n ? `承認して配信（${n}名）` : '承認して配信')
    : aud === 'board' ? '承認して共有ボードに掲示'
    : (n ? `承認して配信（${n}名＋共有ボード）` : '承認して共有ボードに掲示');
  return { aud, n, useBoard, valid, label };
}
function updateSendBtn() {
  const b = $('btn-send'); if (!b) return;
  const p = sendPlan(); b.disabled = !p.valid; b.textContent = p.label;
}
function addRecipient() {
  const id = $('add-select').value; if (!id) return;
  state.recips.push({ staff_id: id, reason: '', title: '', body: '', action_required: '', checked: true });
  renderProposal();
  const cards = document.querySelectorAll('.rcpt'); const last = cards[cards.length - 1];
  if (last) { last.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); last.querySelector('[data-f=title]').focus(); }
}
async function sendMessage() {
  const m = state.current; if (!m) return;
  const p = sendPlan();
  if (!p.valid) { toast(p.useBoard ? '共有ボードのタイトルと本文を入力してください' : '送る宛先を選んでください'); return; }
  const rs = p.aud === 'board' ? [] : state.recips.filter((r) => r.checked);
  const empty = rs.find((r) => !r.title.trim() || !r.body.trim());
  if (empty) { toast(`${staffLine(empty.staff_id).name} さんのタイトルと本文を入力してください`); return; }
  const btn = $('btn-send'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>配信中…';
  try {
    const payload = rs.map(({ checked, ...r }) => r);
    const board_post = p.useBoard ? { title: state.board.title.trim(), body: state.board.body.trim(), until: fromLocalInput(state.board.until) } : null;
    await api(`/api/messages/${encodeURIComponent(m.id)}/send`, { method: 'POST', body: { recipients: payload, board_post } });
    state.current = null; state.recips = [];
    $('raw-text').value = ''; $('source').value = '手入力';
    state.attachments = []; renderChips();
    state.extract = null; renderIntake();
    toast(board_post && !rs.length ? '共有ボードに掲示しました' : '配信しました', 'ok');
    renderProposal();
    await pollOnce();
    location.hash = '#/deliveries/' + encodeURIComponent(m.id);
  } catch (e) { toast('配信に失敗しました: ' + e.message); renderProposal(); }
}
async function reanalyze() {
  const m = state.current; if (!m || state.busy) return;
  state.current = { loading: true }; setBusy(true); renderProposal();
  try { setCurrent(await api(`/api/messages/${encodeURIComponent(m.id)}/reanalyze`, { method: 'POST', body: {} })); }
  catch (e) { toast('再解析に失敗しました: ' + e.message); state.current = m; renderProposal(); }
  finally { setBusy(false); }
}


// ---------- icons / helpers for views ----------
const ico = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const jstYmd = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);
function todayLabel() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}年${p.month}月${p.day}日（${p.weekday}）`;
}
function setHtml(el, html) { if (el && el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } }
const byNewest = (a, b) => parseDate(b.created_at) - parseDate(a.created_at);
const sentMessages = () => state.messages.filter((m) => m.status === 'sent').sort(byNewest);
function todaysSent() { const t = jstYmd(new Date()); return sentMessages().filter((m) => jstYmd(parseDate(m.created_at)) === t); }
function ackCount(m) { const ds = m.deliveries || []; return { total: ds.length, done: ds.filter((d) => d.acknowledged_at).length }; }
function residentLabel(m) {
  if (m.resident && m.resident.name) return `${m.resident.name}様`;
  const t = (m.analysis && m.analysis.summary) || m.raw_text || '';
  return t.length > 14 ? t.slice(0, 14) + '…' : t;
}
// 要約が利用者名（空白・様/さん有無を許容）で始まる場合、その部分と直後の「の/は/が/、」を除く
function stripName(m, text) {
  text = String(text || '');
  const name = m && m.resident && m.resident.name ? String(m.resident.name).replace(/[\s\u3000]+/g, '') : '';
  if (!name) return text;
  let i = 0, j = 0;
  while (j < name.length) {
    while (i < text.length && /[\s\u3000]/.test(text[i])) i++;
    if (text[i] !== name[j]) return text;
    i++; j++;
  }
  const rest = text.slice(i).replace(/^(様|さん)/, '').replace(/^[\s\u3000]*[のはが、]/, '').replace(/^[\s\u3000]+/, '');
  return rest || text;
}
const summaryOf = (m) => stripName(m, m.analysis && m.analysis.summary);
function categoryOf(m) { const a = m.analysis; return (a && a.categories && a.categories[0]) || (summaryOf(m) || m.raw_text || '').slice(0, 14); }
const clip = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; };

// ---------- home ----------
function renderHome() {
  const list = todaysSent();
  let total = 0, done = 0;
  list.forEach((m) => { const c = ackCount(m); total += c.total; done += c.done; });
  setHtml($('home-stats'), [['sent', 'check', '配信', total, ''], ['unacked', 'alert', '未確認', total - done, 'warn'], ['acked', 'check-o', '確認完了', done, 'ok']]
    .map(([k, ic, l, v, c]) => `<div class="hstat ${c}" data-testid="home-stat-${k}">${ico(ic)}<span class="hs-l">${l}</span><b>${esc(v)}</b><span class="hs-u">件</span></div>`).join(''));
  setHtml($('home-rows'), list.length ? list.map((m) => {
    const { total: t, done: d } = ackCount(m);
    const un = t - d;
    const st = !t ? `<span class="ack ack-off">${ico('pin')}ボード掲示のみ</span>`
      : un > 0 ? `<span class="ack ack-wait" data-testid="home-row-status">${ico('alert')}未確認 ${un}名</span>`
      : `<span class="ack ack-ok" data-testid="home-row-status">${ico('check')}確認済み ${d}/${t}</span>`;
    return `<div class="home-row ${un > 0 ? 'is-wait' : ''}" data-testid="home-row" data-id="${esc(m.id)}">
      <i class="bar-l" aria-hidden="true"></i>
      <span class="hr-name">${esc(residentLabel(m))}</span>
      <span class="hr-sum"><b>${esc(categoryOf(m))}</b><span>${esc(clip(summaryOf(m), 40))}</span></span>
      ${st}
      <a class="hr-link" href="#/deliveries/${encodeURIComponent(m.id)}" data-testid="home-row-link">配信状況を見る${ico('chev')}</a>
    </div>`;
  }).join('') : '<div class="placeholder" data-testid="home-empty">本日配信した連絡はまだありません。「新しい連絡を作成」から始めましょう。</div>');
}

// ---------- deliveries ----------
function listItemHtml(m, selId) {
  const { total: t, done: d } = ackCount(m);
  const urg = (m.analysis && m.analysis.urgency) || 'low';
  const on = m.id === selId;
  return `<a class="dl-item ${on ? 'on' : ''} ${t && d < t ? 'is-wait' : ''}" href="#/deliveries/${encodeURIComponent(m.id)}" data-testid="dl-list-item" data-id="${esc(m.id)}" data-urgency="${esc(urg)}" ${on ? 'aria-current="true"' : ''}>
    <i class="urg-bar urg-bar-${esc(urg)}" aria-hidden="true"></i>
    <span class="dl-main"><b>${esc(residentLabel(m))}</b><span>${esc(clip(categoryOf(m), 18))}</span></span>
    <span class="dl-count" data-testid="dl-count">${t ? `${d}/${t}` : '掲示'}</span>${ico('chev', 'dl-chev')}
  </a>`;
}
const STEPS = ['情報を受信', 'AIが通知先を提案', '職員が承認', '確認完了'];
function detailHtml(m, flashIds) {
  const a = m.analysis || {};
  const ds = m.deliveries || [];
  const { total, done } = ackCount(m);
  const all = total === 0 || done === total;
  const reasonOf = (d) => { const r = (a.recipients || []).find((x) => x.staff_id === d.staff_id); return (r && r.reason) || d.reason || ''; };
  const stepsDone = [true, true, true, all];
  const title = m.resident && m.resident.name ? `${esc(m.resident.name)}様<i class="tsep" aria-hidden="true"></i>${esc(clip(stripName(m, a.summary), 30))}` : esc(clip(a.summary || m.raw_text, 40));
  const excl = a.excluded || [];
  const bp = m.board_post;
  const live = bp && !bp.archived_at && (!bp.until || parseDate(bp.until) > new Date());
  return `<div data-testid="sent-message" data-id="${esc(m.id)}" data-all-acked="${all ? '1' : '0'}">
    <a class="dl-back" href="#/deliveries" data-testid="dl-back">${ico('chev-l')}一覧に戻る</a>
    <h2 class="dl-title" data-testid="dl-title">${title}</h2>
    <p class="dl-meta">${esc(fmtFull(m.created_at))} ／ 入力者 ${esc(m.created_by)}${a.urgency ? ` <span class="urg urg-${esc(a.urgency)}">${esc(URG[a.urgency] || a.urgency)}</span>` : ''}</p>
    <div class="ai-sum"><span class="ai-lab">AI 要約</span><div><p data-testid="dl-summary">${esc(a.summary || m.raw_text)}</p><small>情報の出所： ${esc(m.source || '—')}</small></div></div>
    <ol class="prog-steps" data-testid="dl-steps">${STEPS.map((s, i) => `<li class="${stepsDone[i] ? 'done' : ''}" data-testid="dl-step" data-done="${stepsDone[i] ? '1' : '0'}"><span class="dot">${stepsDone[i] ? ico('check') : ''}</span><span>${s}</span></li>`).join('')}</ol>
    <h3 class="sec-h"><i aria-hidden="true"></i>通知先と確認状況<span class="prog-t" data-testid="progress-text" ${total ? '' : 'hidden'}>確認 ${done} / ${total}</span></h3>
    ${total ? `<table class="rtable" data-testid="dl-table"><thead><tr><th>通知先（役割）</th><th>担当者</th><th>AIによる通知理由</th><th>確認状況</th></tr></thead><tbody>
      ${ds.map((d) => `<tr data-testid="dl-recipient-row" class="${flashIds.has(d.id) ? 'flash' : ''}">
        <td data-label="通知先（役割）"><b data-testid="delivery-row" data-delivery-id="${esc(d.id)}" data-acked="${d.acknowledged_at ? '1' : '0'}">${esc(d.staff_role)}</b></td>
        <td data-label="担当者">${esc(d.staff_name)}</td>
        <td data-label="AIによる通知理由" class="rs" data-testid="dl-reason">${esc(reasonOf(d) || '—')}</td>
        <td data-label="確認状況">${d.acknowledged_at ? `<span class="ack ack-ok" data-testid="pill-ack">${ico('check')}確認済 ${esc(fmtTime(d.acknowledged_at))}</span>` : `<span class="ack ack-wait" data-testid="pill-wait">${ico('alert')}未確認</span>`}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="hint" data-testid="dl-no-individual">個別配信はありません（共有ボードのみ）。</p>'}
    ${bp ? `<div class="board-line">${ico('pin')}<span class="bl-l">共有ボード</span><b>${esc(bp.title)}</b>${live ? `<span class="pill pill-board" data-testid="board-badge">掲示中</span>${bp.until ? `<small>${esc(fmtFull(bp.until))} まで</small>` : ''}` : '<span class="pill pill-off" data-testid="board-badge-ended">掲示終了</span>'}</div>` : ''}
    <h3 class="sec-h"><i aria-hidden="true"></i>AIによる選定理由</h3>
    <p class="sel-note" data-testid="dl-selection">${esc(a.excluded_note || '—')}</p>
    ${excl.length ? `<details class="excl-d" data-testid="excluded-details" ${state.exclOpen ? 'open' : ''}><summary>送らなかった職員と理由（${excl.length}名）</summary>
      <ul class="excl" data-testid="dl-excluded">${excl.map((x) => { const s = staffLine(x.staff_id); return `<li><b>${esc(s.name)}</b>${s.role ? `<span class="role">${esc(s.role)}</span>` : ''}<span class="excl-why">${esc(x.reason)}</span></li>`; }).join('')}</ul></details>` : ''}
  </div>`;
}
function renderDeliveries(flashIds = new Set()) {
  const r = currentRoute();
  const all = sentMessages();
  const list = state.dlAll ? all : todaysSent();
  $('dl-today').setAttribute('aria-pressed', String(!state.dlAll)); $('dl-all').setAttribute('aria-pressed', String(state.dlAll));
  $('h-dl').textContent = state.dlAll ? 'すべての連絡' : '今日の連絡';
  $('dl-lead').textContent = state.dlAll ? '配信済みの連絡の一覧です。' : '本日受信した連絡の一覧です。';
  let sel = r.id ? all.find((m) => m.id === r.id) : null;
  if (!sel && !r.id && !NARROW.matches) sel = list[0] || null;
  $('dl-wrap').classList.toggle('has-sel', !!r.id);
  setHtml($('dl-list'), list.length ? list.map((m) => listItemHtml(m, sel && sel.id)).join('')
    : `<div class="placeholder" data-testid="sent-empty">${state.dlAll ? 'まだ配信された連絡事項はありません。' : '本日配信した連絡はありません。「すべて」で過去の連絡を表示できます。'}</div>`);
  const d = $('dl-detail');
  if (sel) setHtml(d, detailHtml(sel, flashIds));
  else setHtml(d, r.id ? `<a class="dl-back" href="#/deliveries">${ico('chev-l')}一覧に戻る</a><div class="placeholder" data-testid="dl-notfound">この連絡は見つかりません。</div>` : '<div class="placeholder" data-testid="dl-empty">左の一覧から連絡を選ぶと、通知先と確認状況を表示します。</div>');
  const ex = d.querySelector('details.excl-d'); if (ex && !ex.dataset.bound) { ex.dataset.bound = '1'; ex.addEventListener('toggle', () => { state.exclOpen = ex.open; }); }
}

// ---------- router ----------
function currentRoute() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  if (name === 'new') return { name: 'new' };
  if (name === 'deliveries') return { name: 'deliveries', id: rest.length ? decodeURIComponent(rest.join('/')) : null };
  return { name: 'home' };
}
let lastRouteKey = '';
function route() {
  const r = currentRoute();
  document.body.dataset.route = r.name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== r.name; });
  document.querySelectorAll('.sidenav a[data-route], .tabbar a[data-route]').forEach((a) => {
    const on = a.dataset.route === r.name; a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const key = r.name + '/' + (r.id || '');
  if (key !== lastRouteKey) { lastRouteKey = key; window.scrollTo(0, 0); }
  renderViews();
  if (r.name === 'new' && state.pending === 'focus') $('raw-text').focus();
  state.pending = null;
}
function renderViews(flashIds = new Set()) {
  const r = currentRoute();
  if (r.name === 'home') renderHome();
  else if (r.name === 'deliveries') renderDeliveries(flashIds);
}

async function pollOnce() {
  try {
    const msgs = await api('/api/messages');
    state.messages = msgs;
    const acked = new Set(); msgs.forEach((m) => (m.deliveries || []).forEach((d) => d.acknowledged_at && acked.add(d.id)));
    const flash = new Set();
    if (state.ackedSeen) acked.forEach((id) => { if (!state.ackedSeen.has(id)) flash.add(id); });
    state.ackedSeen = acked;
    $('today-label').querySelector('span').textContent = todayLabel();
    renderViews(flash);
  } catch { /* api() が接続表示を更新済み。ポーリングは静かに継続 */ }
}

// ---------- init ----------
async function init() {
  $('msg-form').addEventListener('submit', submitMessage);
  $('file-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; intakeFile(f); });
  $('camera-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; intakeFile(f); });
  $('home-text').addEventListener('click', () => { state.pending = 'focus'; if (currentRoute().name === 'new') $('raw-text').focus(); });
  $('home-file').addEventListener('click', () => { $('file-input').click(); });
  $('dl-today').addEventListener('click', () => { state.dlAll = false; renderViews(); });
  $('dl-all').addEventListener('click', () => { state.dlAll = true; renderViews(); });
  window.addEventListener('hashchange', route);
  $('today-label').querySelector('span').textContent = todayLabel();
  renderQuick(); renderProposal(); route();
  loadHealth(); loadSamples();
  try { (await api('/api/staff')).forEach((s) => state.staff.set(s.id, s)); } catch (e) { toast('職員一覧を取得できません: ' + e.message); }
  setupCreatedBy();
  await pollOnce();
  setInterval(pollOnce, 3000);
  setInterval(loadHealth, 15000);
}
init();

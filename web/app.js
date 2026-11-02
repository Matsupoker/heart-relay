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
  sentNote: null,
};

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
    res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
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
  state.sentNote = null;
  state.current = { loading: true };
  setBusy(true); renderProposal();
  try {
    const m = await api('/api/messages', { method: 'POST', body: { raw_text: raw, source: $('source').value, created_by: $('created-by').value.trim() || '相談員 デモ' } });
    setCurrent(m);
  } catch (e) {
    state.current = null; toast('解析に失敗しました: ' + e.message);
    renderProposal();
  } finally { setBusy(false); }
}
function setCurrent(m) {
  state.current = m;
  if (m.status === 'proposed' && m.analysis) {
    state.recips = (m.analysis.recipients || []).map((r) => ({ ...r, checked: true }));
  } else state.recips = [];
  renderProposal();
}

// ---------- proposal ----------
function staffLine(id) {
  const s = state.staff.get(id);
  if (!s) return { name: id, role: '', duties: [] };
  return { name: s.name, role: s.role, duties: s.duties || [] };
}
function renderProposal() {
  const root = $('proposal'); const m = state.current;
  if (state.sentNote) {
    root.innerHTML = `<div class="ok-box" data-testid="sent-note">${esc(state.sentNote)}</div><p class="placeholder" style="margin-top:12px">次の連絡事項を入力してください。</p>`;
    return;
  }
  if (!m) { root.innerHTML = '<div class="placeholder" data-testid="proposal-empty">左で連絡事項を入力して「AIで解析する」を押すと、ここにAIの提案が表示されます。</div>'; return; }
  if (m.loading || m.status === 'analyzing') {
    root.innerHTML = '<div class="loading" data-testid="proposal-loading"><span class="spinner dark"></span>解析中…<small>Claudeが宛先と個別の本文を考えています（最大20秒ほど）</small></div>';
    return;
  }
  if (m.status === 'failed') {
    root.innerHTML = `<div class="error-box" data-testid="proposal-failed">解析に失敗しました：${esc(m.error || '原因不明')}</div>
      <p class="raw">${esc(m.raw_text)}</p>
      <div class="btn-row"><button class="btn btn-primary" id="btn-reanalyze" data-testid="btn-reanalyze">再解析</button></div>`;
    $('btn-reanalyze').addEventListener('click', reanalyze);
    return;
  }
  if (m.status === 'sent') {
    root.innerHTML = '<div class="ok-box">配信済みです。右の一覧で確認状況を確認できます。</div>';
    return;
  }
  const a = m.analysis;
  const res = a.resident_id ? residentName(a.resident_id) : '（特定できず）';
  const usage = m.usage ? `入力 ${m.usage.input_tokens} / 出力 ${m.usage.output_tokens} トークン ≈ $${Number(m.usage.est_cost_usd).toFixed(4)}` : '';
  const used = new Set(state.recips.map((r) => r.staff_id));
  const addable = [...state.staff.values()].filter((s) => s.active !== false && !used.has(s.id));
  root.innerHTML = `
    <p class="summary" data-testid="summary">${esc(a.summary)}</p>
    <div class="chips">
      <span class="urg urg-${esc(a.urgency)}" data-testid="urgency">${esc(URG[a.urgency] || a.urgency)}</span>
      ${(a.categories || []).map((c) => `<span class="chip" data-testid="category">${esc(c)}</span>`).join('')}
    </div>
    <dl class="meta">
      <dt>対象利用者</dt><dd data-testid="resident">${esc(res)}</dd>
      <dt>期限</dt><dd data-testid="deadline">${esc(a.deadline || 'なし')}</dd>
      <dt>必要な対応</dt><dd>${(a.required_actions || []).length ? `<ul class="actions-list" data-testid="required-actions">${a.required_actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : 'なし'}</dd>
    </dl>
    <h3>宛先候補（${state.recips.length}名）— 内容を確認・修正してください</h3>
    <div id="rcpts" data-testid="recipients">${state.recips.map(rcptHtml).join('')}</div>
    <div class="add-row">
      <select id="add-select" data-testid="add-select"><option value="">宛先を追加…</option>
        ${addable.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.role)}）</option>`).join('')}</select>
      <button class="btn" id="btn-add" type="button" data-testid="btn-add">追加</button>
    </div>
    <h4 class="future-h">共有ボード向け要点（将来機能）</h4>
    <div class="future" data-testid="board-summary">${esc(a.board_summary || '—')}</div>
    <h4 class="future-h">送らないと判断した職員と理由</h4>
    <div class="future" data-testid="excluded-note">${esc(a.excluded_note || '—')}</div>
    <div class="btn-row">
      <button class="btn btn-send" id="btn-send" data-testid="btn-send">承認して配信</button>
      <button class="btn" id="btn-reanalyze" data-testid="btn-reanalyze">再解析</button>
    </div>
    <div class="usage" data-testid="usage">${esc(usage)}${m.analyzer ? ` ／ 解析: ${m.analyzer === 'claude' ? 'Claude' + (m.model ? '（' + esc(m.model) + '）' : '') : 'モック'}` : ''}</div>`;
  root.querySelectorAll('.rcpt').forEach(bindRcpt);
  $('btn-add').addEventListener('click', addRecipient);
  $('btn-send').addEventListener('click', sendMessage);
  $('btn-reanalyze').addEventListener('click', reanalyze);
  updateSendBtn();
}
function residentName(id) { return (state.residents && state.residents.get(id)) || id; }
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
function updateSendBtn() {
  const n = state.recips.filter((r) => r.checked).length;
  const b = $('btn-send'); if (!b) return;
  b.disabled = n === 0; b.textContent = n ? `承認して配信（${n}名）` : '承認して配信';
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
  const rs = state.recips.filter((r) => r.checked);
  if (!rs.length) { toast('送る宛先を選んでください'); return; }
  const empty = rs.find((r) => !r.title.trim() || !r.body.trim());
  if (empty) { toast(`${staffLine(empty.staff_id).name} さんのタイトルと本文を入力してください`); return; }
  const btn = $('btn-send'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>配信中…';
  try {
    const payload = rs.map(({ checked, ...r }) => r);
    await api(`/api/messages/${encodeURIComponent(m.id)}/send`, { method: 'POST', body: { recipients: payload } });
    state.sentNote = `${rs.length}名へ配信しました。右の一覧で確認状況をご覧ください。`;
    state.current = null; state.recips = [];
    toast('配信しました', 'ok');
    renderProposal(); pollOnce();
  } catch (e) { toast('配信に失敗しました: ' + e.message); renderProposal(); }
}
async function reanalyze() {
  const m = state.current; if (!m || state.busy) return;
  state.current = { loading: true }; setBusy(true); renderProposal();
  try { setCurrent(await api(`/api/messages/${encodeURIComponent(m.id)}/reanalyze`, { method: 'POST', body: {} })); }
  catch (e) { toast('再解析に失敗しました: ' + e.message); state.current = m; renderProposal(); }
  finally { setBusy(false); }
}

// ---------- sent list / stats ----------
function renderStats(s) {
  $('stats').innerHTML = [['連絡事項', s.messages, ''], ['配信', s.deliveries, ''], ['確認済み', s.acked, 'ok'], ['未確認', s.unacked, 'warn']]
    .map(([l, v, c]) => `<div class="stat ${c}" data-testid="stat-${esc(l)}"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
}
function renderSent(flashIds) {
  const sent = state.messages.filter((m) => m.status === 'sent');
  const root = $('sent-list');
  if (!sent.length) { root.innerHTML = '<div class="placeholder" data-testid="sent-empty">まだ配信された連絡事項はありません。</div>'; return; }
  root.innerHTML = sent.map((m) => {
    const ds = m.deliveries || []; const done = ds.filter((d) => d.acknowledged_at).length;
    const pct = ds.length ? Math.round(done / ds.length * 100) : 0;
    return `<article class="sent ${ds.length && done === ds.length ? 'all-done' : ''}" data-testid="sent-message" data-id="${esc(m.id)}">
      <p class="sent-summary sent-sum">${esc(m.analysis ? m.analysis.summary : m.raw_text)}</p>
      <div class="sent-time">${esc(fmtFull(m.created_at))} ／ ${esc(m.created_by)}</div>
      <div class="prog"><b data-testid="progress-text">確認 ${done} / ${ds.length}</b><div class="bar"><div style="width:${pct}%"></div></div></div>
      ${ds.map((d) => `<div class="drow ${flashIds.has(d.id) ? 'flash' : ''}" data-testid="delivery-row" data-delivery-id="${esc(d.id)}" data-acked="${d.acknowledged_at ? '1' : '0'}">
        <span><span class="dname">${esc(d.staff_name)}</span><span class="drole">${esc(d.staff_role)}</span></span>
        ${d.acknowledged_at ? `<span class="pill pill-ok" data-testid="pill-ack">✅ 確認済み ${esc(fmtTime(d.acknowledged_at))}</span>` : '<span class="pill pill-wait" data-testid="pill-wait">⏳ 未確認</span>'}
      </div>`).join('')}
    </article>`;
  }).join('');
}
async function pollOnce() {
  try {
    const [msgs, stats] = await Promise.all([api('/api/messages'), api('/api/stats')]);
    state.messages = msgs;
    const acked = new Set(); msgs.forEach((m) => (m.deliveries || []).forEach((d) => d.acknowledged_at && acked.add(d.id)));
    const flash = new Set();
    if (state.ackedSeen) acked.forEach((id) => { if (!state.ackedSeen.has(id)) flash.add(id); });
    state.ackedSeen = acked;
    renderStats(stats); renderSent(flash);
    if (flash.size) setTimeout(() => {}, 0);
  } catch { /* api() が接続表示を更新済み。ポーリングは静かに継続 */ }
}

// ---------- init ----------
async function init() {
  $('msg-form').addEventListener('submit', submitMessage);
  renderQuick(); renderProposal(); renderSent(new Set());
  loadHealth(); loadSamples();
  try { (await api('/api/staff')).forEach((s) => state.staff.set(s.id, s)); } catch (e) { toast('職員一覧を取得できません: ' + e.message); }
  try { state.residents = new Map((await api('/api/residents')).map((r) => [r.id, r.name])); } catch { state.residents = new Map(); }
  await pollOnce();
  setInterval(pollOnce, 3000);
  setInterval(loadHealth, 15000);
}
init();

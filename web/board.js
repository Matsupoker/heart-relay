// 共有ボード（依存なし）。5 秒ごとに /api/board を取得し、変化があれば差し替える。操作要素は持たない。
(() => {
  const POLL_MS = 5000;
  const URG = { high: '緊急', medium: '通常', low: '参考' };
  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  let lastSig = null;
  let known = null; // 既知の id 集合（初回は新着扱いにしない）

  const pad = (n) => String(n).padStart(2, '0');
  const hms = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const hm = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date().toDateString() === d.toDateString();
    return (today ? '' : `${d.getMonth() + 1}/${d.getDate()} `) + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function el(tag, cls, text, testid) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (testid) e.dataset.testid = testid;
    return e;
  }

  function renderPost(p, isNew) {
    const u = ['high', 'medium', 'low'].includes(p.urgency) ? p.urgency : 'medium';
    const art = el('article', `post u-${u}${isNew ? ' is-new' : ''}`, null, 'board-post');
    art.dataset.id = p.id;
    const head = el('div', 'post-head');
    head.append(el('span', 'urg', URG[u]));
    (p.categories || []).forEach((c) => head.append(el('span', 'chip', c)));
    if (p.resident_name) head.append(el('span', 'resident', `対象: ${p.resident_name} 様`));
    art.append(head, el('h2', 'post-title', p.title, 'board-title'), el('p', 'post-body', p.body, 'board-body'));
    const foot = el('div', 'post-foot');
    foot.append(el('span', null, `掲示 ${hm(p.created_at)}`));
    if (p.until) foot.append(el('span', null, `期限 ${hm(p.until)}`));
    art.append(foot);
    return art;
  }

  function render(posts) {
    const ids = new Set(posts.map((p) => p.id));
    const fresh = known ? posts.filter((p) => !known.has(p.id)).map((p) => p.id) : [];
    known = ids;
    const keep = listEl.scrollTop;
    listEl.replaceChildren();
    if (!posts.length) {
      const e = el('div', 'empty', '現在、掲示はありません', 'board-empty');
      e.append(el('small', null, '新しい共有事項があるとここに表示されます'));
      listEl.append(e);
      return;
    }
    posts.forEach((p) => listEl.append(renderPost(p, fresh.includes(p.id))));
    listEl.scrollTop = keep;
  }

  function setConn(ok) {
    const c = $('conn');
    c.className = `conn ${ok ? 'conn-on' : 'conn-off'}`;
    c.querySelector('span').textContent = ok ? '接続中' : '接続できません（再試行中）';
  }

  async function poll() {
    try {
      const res = await fetch('/api/board', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const posts = await res.json();
      // 期限切れは次回取得で消えるが、表示中の更新時刻を毎回更新する
      const sig = JSON.stringify(posts);
      if (sig !== lastSig) { lastSig = sig; render(posts); }
      $('updated').textContent = hms(new Date());
      setConn(true);
    } catch {
      setConn(false);
    }
  }

  setInterval(() => { $('clock').textContent = hms(new Date()); }, 1000);
  $('clock').textContent = hms(new Date());
  poll();
  setInterval(poll, POLL_MS);
})();

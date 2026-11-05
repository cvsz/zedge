const view = document.getElementById('view');
const el = (t, a, ...k) => { const n = document.createElement(t); for (const [x, v] of Object.entries(a || {})) { if (x === 'class') n.className = v; else n.setAttribute(x, v); } n.append(...k.filter((c) => c != null && c !== false)); return n; };
async function api(method, path, body) {
  const r = await fetch(`/api/${path}`, { method, headers: body ? { 'content-type': 'application/json', 'x-studio': '1' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
}
const fail = (e) => view.replaceChildren(el('p', { class: 'err', role: 'alert' }, e.message));
async function board() {
  const d = await api('GET', 'calendar');
  const days = Array.from({ length: 7 }, (_, i) => { const t = new Date(); t.setUTCHours(0, 0, 0, 0); t.setUTCDate(t.getUTCDate() + i); return t; });
  const key = (t) => t.toISOString().slice(0, 10);
  const later = d.scheduled.filter((r) => !days.some((t) => key(t) === String(r.scheduled_for).slice(0, 10)) && new Date(r.scheduled_for) > days[6]);
  const week = el('div', { class: 'week', role: 'group', 'aria-label': 'Next 7 days (UTC)' }, ...days.map((t) => el('section', { class: 'col', 'aria-label': t.toUTCString().slice(0, 16) }, el('strong', null, t.toUTCString().slice(0, 11)),
    ...d.scheduled.filter((r) => String(new Date(r.scheduled_for).toISOString()).slice(0, 10) === key(t)).map((r) => el('div', { class: 'card' }, el('div', { class: 'mute' }, new Date(r.scheduled_for).toISOString().slice(11, 16) + ' UTC'), el('div', null, r.caption || '(no caption)'))))),
    later.length ? el('section', { class: 'col', 'aria-label': 'Later' }, el('strong', null, `Later (${later.length})`), ...later.map((r) => el('div', { class: 'card' }, el('div', { class: 'mute' }, new Date(r.scheduled_for).toUTCString()), el('div', null, r.caption || '(no caption)')))) : null);
  view.replaceChildren(el('p', { class: 'mute' }, d.note), week, el('div', { class: 'board' }, ...Object.entries(d.columns).map(([s, rows]) => el('section', { class: 'col', 'aria-label': s }, el('strong', null, `${s} (${rows.length})`), ...rows.map((r) => el('div', { class: 'card' }, el('div', null, r.caption || '(no caption)'), el('span', { class: 'mute' }, `${r.format} · ${r.language} · ${r.autonomy_level}`)))))));
}
async function approvals(me) {
  const { approvals: list } = await api('GET', 'approvals?status=pending');
  const canDecide = me.permissions.includes('*') || me.permissions.includes('approvals.decide');
  view.replaceChildren(list.length ? el('div', null, ...list.map((a) => {
    const act = (approve) => async () => { try { await api('POST', `approvals/${a.id}/decide`, { approve }); await approvals(me); } catch (e) { fail(e); } };
    return el('div', { class: 'card' }, el('strong', null, a.summary), el('div', { class: 'mute' }, `${a.kind} · ${a.subject_type}`), canDecide && el('div', { class: 'row' }, Object.assign(el('button', { type: 'button' }, 'Approve'), { onclick: act(true) }), Object.assign(el('button', { type: 'button' }, 'Reject'), { onclick: act(false) })));
  })) : el('p', { class: 'mute' }, 'Nothing is waiting for approval.'));
}
(async () => {
  try {
    const me = await api('GET', 'me'); document.getElementById('who').textContent = `${me.name} (${me.role})`;
    const tabs = { 'tab-cal': () => board(), 'tab-appr': () => approvals(me) };
    for (const id of Object.keys(tabs)) document.getElementById(id).onclick = async () => { for (const k of Object.keys(tabs)) document.getElementById(k).setAttribute('aria-pressed', String(k === id)); try { await tabs[id](); } catch (e) { fail(e); } };
    await board();
  } catch (e) { fail(e); }
})();

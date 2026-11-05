// Tiny DOM + API helpers. Data is only ever inserted as text nodes, never as HTML.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) return kid.forEach(add);
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

/** Replace an element's children; unlike replaceChildren it flattens arrays and skips empty values. */
export function fill(el, ...kids) {
  el.replaceChildren();
  el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
}

export class ApiError extends Error {
  constructor(status, message, json) { super(message); this.status = status; this.json = json || null; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

function baseHeaders() {
  const h0 = { 'X-Requested-With': 'zedge' };
  try { const a = localStorage.getItem('zedge.account'); if (a) h0['X-Account-Id'] = a; } catch { /* storage unavailable */ }
  return h0;
}

/** Upload raw bytes (R2 objects). */
export async function apiRaw(method, path, body, headers = {}) {
  const res = await fetch(`/api/${path}`, { method, credentials: 'same-origin', headers: { ...baseHeaders(), 'Content-Type': 'application/octet-stream', ...headers }, body });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (res.status === 401) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (json && json.error) || `Request failed (${res.status})`);
  return json;
}

export async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...baseHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== 'login') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (json && json.error) || `Request failed (${res.status})`, json);
  return json;
}
export const cf = (method, path, body) => api(method, `cf${path}`, body);

/** Fetch every page of a Cloudflare list endpoint through the proxy. */
export async function cfAll(path, query = {}) {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ ...query, page: String(page), per_page: '100' });
    const r = await cf('GET', `${path}?${qs}`);
    out.push(...(r.result || []));
    if (page >= ((r.result_info && r.result_info.total_pages) || 1)) break;
  }
  return out;
}

export function toast(msg, bad = false) {
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), bad ? 8000 : 4500);
}

/** Run an async action with a disabled button and an error toast. */
export async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong', true); return undefined; } finally { if (btn) btn.disabled = false; }
}

// ---- components ----
export const badge = (text, kind = 'mute') => h('span', { class: `badge b-${kind}` }, text);
export const btn = (label, onclick, kind = '') => h('button', { type: 'button', class: `btn ${kind}`.trim(), onclick: (e) => run(e.currentTarget, () => onclick(e)) }, label);
export const card = (title, ...kids) => h('section', { class: 'card', 'aria-label': title }, title && h('h2', null, title), ...kids);
export const field = (label, input) => h('label', { class: 'f' }, label, input);
export const input = (props) => h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
export const empty = (msg) => h('div', { class: 'empty' }, msg);

export function segmented(label, options, current, onPick) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([value, text]) => h('button', {
      type: 'button', class: 'btn', 'aria-pressed': String(value === current),
      onclick: (e) => {
        const self = e.currentTarget;
        return run(self, async () => {
          await onPick(value);
          self.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === self)));
        });
      }
    }, text)));
}

export function toggle(on, label, onChange) {
  return h('button', {
    type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(on), 'aria-label': label,
    onclick: (e) => {
      const self = e.currentTarget; // currentTarget is null once the handler has awaited
      return run(self, async () => {
        const next = self.getAttribute('aria-checked') !== 'true';
        await onChange(next);
        self.setAttribute('aria-checked', String(next));
      });
    }
  }, h('i'));
}

export const confirmAsk = (msg) => window.confirm(msg);

export function secretBox(title, value) {
  return h('div', { class: 'secret', role: 'status' },
    h('span', { class: 'small', style: undefined }, title),
    h('span', null, value),
    h('div', { class: 'row' }, btn('Copy', async () => { await navigator.clipboard.writeText(value); toast('Copied'); })));
}

export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : 'never');

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const fmtNum = (n) => new Intl.NumberFormat('en', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n || 0);
export function fmtBytes(n) {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export const lines = (s) => String(s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
export const selectOf = (label, options, value) => h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));

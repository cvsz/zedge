// Small shared pieces for the tabbed screens.
import { h, fill, card, segmented } from '../lib.js';
import { header, can } from '../ctx.js';

export async function tabbedView({ title, sub, perm, tabs, builders, key }, ...args) {
  let tab = localStorage.getItem(key);
  if (!builders[tab]) tab = tabs[0][0];
  const body = h('div', { class: 'stack' });
  const show = async (t) => {
    try { localStorage.setItem(key, t); } catch { /* storage unavailable */ }
    fill(body, h('div', { class: 'spin' }, 'Loading…'));
    try { fill(body, await builders[t](...args)); } catch (e) { fill(body, card('', h('div', { class: 'err' }, e.message))); }
  };
  await show(tab);
  return h('div', { class: 'stack' }, header(title, sub), perm && !can(perm) && h('div', { class: 'note' }, 'Your role is read-only here: you can look, but changes will be refused.'),
    segmented(`${title} section`, tabs, tab, show), body);
}

/** One list row: a title, a quiet second line, and action buttons on the right. */
export const item = (title, sub, ...actions) => h('div', { class: 'li' },
  h('div', { class: 'col' }, h('strong', { class: 'mono' }, title), sub && h('span', { class: 'xs mute' }, sub)),
  h('div', { class: 'row' }, actions));

export function table(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!cols.length) return h('div', { class: 'empty' }, 'No rows.');
  return h('div', { class: 'scroll' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, cols.map((c) => h('td', { class: 'mono' }, r[c] === null || r[c] === undefined ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c]))))))));
}

export const noAccount = () => card('', h('div', { class: 'empty' }, 'No Cloudflare account is available to this console.'));
export const textarea = (props) => h('textarea', { class: 'code', spellcheck: 'false', ...props });

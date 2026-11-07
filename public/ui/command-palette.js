/**
 * Command palette - Ctrl/Cmd+K to jump to any screen, domain, Worker, or bucket.
 * Keyboard only, announced to screen readers.
 */
import { h, fill } from '../lib.js';
import { S } from '../ctx.js';
import { t } from '../i18n.js';

const PALETTE_ID = 'cmd-palette';
const INPUT_ID = 'cmd-palette-input';
const LIST_ID = 'cmd-palette-list';

let paletteEl = null;
let inputEl = null;
let listEl = null;
let currentItems = [];

function open() {
  if (paletteEl) { close(); return; }
  paletteEl = h('div', { id: PALETTE_ID, class: 'cmd-palette' },
    h('div', { class: 'cmd-palette-backdrop', onclick: close }),
    h('div', { class: 'cmd-palette-panel' },
      h('div', { class: 'cmd-palette-header' },
        h('span', { class: 'cmd-palette-title' }, t('cmd_palette_title')),
        h('input', {
          id: INPUT_ID,
          type: 'text',
          placeholder: t('cmd_palette_placeholder'),
          'aria-label': t('cmd_palette_label'),
          autofocus: true,
          oninput: (e) => filter(e.target.value),
          onkeydown: (e) => {
            if (e.key === 'Escape') { close(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
            if (e.key === 'Enter') { activate(); }
          }
        })
      ),
      h('div', { id: LIST_ID, class: 'cmd-palette-list', role: 'listbox', 'aria-label': t('cmd_palette_label') },
        h('div', { class: 'cmd-palette-empty' }, t('cmd_palette_empty'))
      ),
      h('div', { class: 'cmd-palette-hint' },
        h('kbd', null, 'Ctrl'), h('span', null, ' + '), h('kbd', null, 'K'), h('span', null, ' ', t('cmd_palette_open'))
      )
    )
  );
  document.body.appendChild(paletteEl);
  inputEl = document.getElementById(INPUT_ID);
  listEl = document.getElementById(LIST_ID);
  inputEl.focus();
  renderItems([]);
}

function close() {
  if (paletteEl && paletteEl.parentNode) {
    paletteEl.parentNode.removeChild(paletteEl);
  }
  paletteEl = null;
  inputEl = null;
  listEl = null;
  currentItems = [];
}

function renderItems(items) {
  currentItems = items || [];
  if (!listEl) { return; }
  fill(listEl, currentItems.length === 0
    ? h('div', { class: 'cmd-palette-empty' }, t('cmd_palette_no_results'))
    : currentItems.map((item, i) => h('div', { class: 'cmd-palette-item' + (i === 0 ? ' cmd-palette-item-active' : ''),
      role: 'option',
      'aria-selected': i === 0 ? 'true' : 'false',
      onclick: () => selectItem(item) },
      h('div', { class: 'cmd-palette-item-icon' }, item.icon || '•'),
      h('div', { class: 'cmd-palette-item-content' },
        h('div', { class: 'cmd-palette-item-title' }, item.title),
        h('div', { class: 'cmd-palette-item-subtitle' }, item.subtitle || '')
      ),
      h('div', { class: 'cmd-palette-item-key' }, item.key || '')
    ))
  );
}

function filter(value) {
  const q = value.toLowerCase();
  if (!q) { renderItems([]); return; }
  const items = [];
  // Zones
  for (const z of (S.zones || [])) {
    if (z.name.toLowerCase().includes(q)) {
      items.push({ id: 'zone:' + z.id, title: z.name, subtitle: t('zone'), icon: '🌐', key: z.name });
    }
  }
  // Workers
  for (const w of (S.workers || [])) {
    if (w.name.toLowerCase().includes(q)) {
      items.push({ id: 'worker:' + w.id, title: w.name, subtitle: t('workers'), icon: '⚡', key: w.name });
    }
  }
  // Buckets
  for (const b of (S.buckets || [])) {
    if (b.name.toLowerCase().includes(q)) {
      items.push({ id: 'bucket:' + b.name, title: b.name, subtitle: t('r2'), icon: '🪣', key: b.name });
    }
  }
  // Routes
  for (const [id, label] of (S.navRoutes || [])) {
    if (label.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
      items.push({ id: 'route:' + id, title: label, subtitle: t('my_account'), icon: '📄', key: label });
    }
  }
  renderItems(items.slice(0, 10));
}

function moveFocus(delta) {
  if (!currentItems.length) { return; }
  const active = currentItems.findIndex((_, i) => listEl.children[i] && listEl.children[i].classList.contains('cmd-palette-item-active'));
  let next = active + delta;
  if (next < 0) { next = currentItems.length - 1; }
  if (next >= currentItems.length) { next = 0; }
  for (let i = 0; i < currentItems.length; i++) {
    listEl.children[i].classList.toggle('cmd-palette-item-active', i === next);
  }
  listEl.children[next]?.scrollIntoView({ block: 'nearest' });
}

function activate() {
  const active = listEl.querySelector('.cmd-palette-item-active');
  if (active) {
    const item = currentItems[Array.from(listEl.children).indexOf(active)];
    selectItem(item);
  }
}

function selectItem(item) {
  close();
  const [type, value] = item.id.split(':');
  if (type === 'zone') { S.zoneId = value; localStorage.setItem('zedge.zone', value); S.render(); }
  else if (type === 'worker') { location.hash = '#/workers/' + value; }
  else if (type === 'bucket') { location.hash = '#/storage/' + value; }
  else if (type === 'route') { location.hash = '#/' + value; }
}

export function initCommandPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (paletteEl) { close(); } else { open(); }
    }
  });
}

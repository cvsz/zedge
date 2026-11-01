// State and small helpers shared by every screen.
import { h, badge, card, empty } from './lib.js';

export const S = {
  zones: [], zoneId: localStorage.getItem('zedge.zone') || '',
  accountId: '', accounts: [], meta: null, me: null,
  render: () => {} // set by app.js
};
export const zone = () => S.zones.find((z) => z.id === S.zoneId);
export const can = (perm) => !!S.me && (S.me.permissions.includes('*') || S.me.permissions.includes(perm));
export const statusKind = (s) => (['active', 'healthy', 'on', 'ready', 'verified', 'valid'].includes(s) ? 'ok' : ['pending', 'degraded', 'inactive', 'unconfigured'].includes(s) ? 'warn' : 'mute');
export const header = (title, sub, ...actions) => h('header', { class: 'row between' }, h('div', { class: 'col' }, h('h1', null, title), sub && h('span', { class: 'mute small' }, sub)), h('div', { class: 'row' }, actions));
export const noZone = () => card('', empty('Add a domain first, then come back here.'), h('div', null, h('a', { href: '#/domains' }, 'Go to Domains')));
export const nsBox = (z) => h('div', { class: 'mono xs soft' }, (z.name_servers || []).join('   ') || 'Nameservers not reported yet');
export const pick = (id) => { S.zoneId = id; localStorage.setItem('zedge.zone', id); };
export { badge };

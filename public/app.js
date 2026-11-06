import { h, fill, api, cf, cfAll, toast, run, badge, btn, card, field, input, empty, segmented, toggle, confirmAsk, secretBox, fmtDate, fmtNum, fmtBytes, setUnauthorizedHandler } from './lib.js';
import { S, zone, can, statusKind, header, noZone, nsBox, pick } from './ctx.js';
import { barChart, legend } from './charts.js';
import { loadI18n, t } from './i18n.js';
import { initCommandPalette } from './ui/command-palette.js';
import { rulesView } from './views/rules.js';
import { emailView } from './views/email.js';
import { workersView } from './views/workers.js';
import { storageView } from './views/storage.js';
import { zeroTrustView } from './views/zerotrust.js';
import { usersView, auditView, accountView } from './views/admin.js';
import { pagesView } from './views/pages.js';
import { lbView } from './views/lb.js';
import { edgeView } from './views/edge.js';
import { dataView } from './views/data.js';
import { sslView } from './views/ssl.js';
import { snapshotsView } from './views/snapshots.js';
import { approvalsView } from './views/approvals.js';

const app = document.getElementById('app');

// Settings saved under the old product name (edge.*) move to zedge.* once, so nobody loses their theme or selected domain.
try {
  for (const k of Object.keys(localStorage)) {
    if (/^edge\.[A-Za-z]+$/.test(k) && localStorage.getItem(`z${k}`) === null) {localStorage.setItem(`z${k}`, localStorage.getItem(k));}
    if (/^edge\.[A-Za-z]+$/.test(k)) {localStorage.removeItem(k);}
  }
} catch { /* storage unavailable */ }


// Theme: follows the system until the user picks one.
const savedTheme = (() => { try { return localStorage.getItem('zedge.theme'); } catch { return null; } })();
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('zedge.theme', t); } catch { /* ignore */ } }
document.documentElement.dataset.theme = savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

// [id, label, view, needsZone, permission]
const ROUTES = [
  ['overview', t('domains_page'), overviewView, true, 'read'],
  ['domains', t('domains_page'), domainsView, false, 'read'],
  ['dns', t('domains_page'), dnsView, true, 'read'],
  ['email', t('email'), emailView, true, 'read'],
  ['security', t('security_settings'), securityView, true, 'read'],
  ['rules', t('rules_page'), rulesView, true, 'read'],
  ['workers', t('workers_page'), workersView, false, 'read'],
  ['edge', t('edge'), edgeView, false, 'read'],
  ['pages', t('pages_page'), pagesView, false, 'read'],
  ['lb', 'Load balancing', lbView, false, 'read'],
  ['data', 'Data (KV, D1)', dataView, false, 'read'],
  ['ssl', 'SSL & Bots', sslView, true, 'read'],
  ['snapshots', 'Snapshots', snapshotsView, true, 'read'],
  ['storage', t('r2_page'), storageView, false, 'read'],
  ['zerotrust', t('zerotrust'), zeroTrustView, false, 'read'],
  ['tokens', t('api_tokens'), tokensView, false, 'tokens.read'],
  ['approvals', t('approvals'), approvalsView, false, 'read'],
  ['audit', t('audit_page'), auditView, false, 'audit.read'],
  ['users', t('admin'), usersView, false, 'users.admin'],
  ['account', t('my_account'), async () => accountView(), false, 'read']
];
const allowedRoutes = () => ROUTES.filter((r) => can(r[4]));

async function loadZones() {
  S.zones = (await cfAll('/zones')).sort((a, b) => a.name.localeCompare(b.name));
  if (!S.zones.some((z) => z.id === S.zoneId)) {S.zoneId = (S.zones[0] && S.zones[0].id) || '';}
  localStorage.setItem('zedge.zone', S.zoneId);
}

// ---------------------------------------------------------------- shell + router
function currentRoute() {
  const name = (location.hash.replace(/^#\//, '') || 'overview');
  const list = allowedRoutes();
  return list.find((r) => r[0] === name) || list[0];
}

function shell() {
  const route = currentRoute();
  const zoneSelect = h('select', { 'aria-label': t('zone'), onchange: (e) => { pick(e.target.value); render(); } },
    S.zones.length ? S.zones.map((z) => h('option', { value: z.id, selected: z.id === S.zoneId }, z.name)) : h('option', null, t('no_domains')));
  const acctSelect = S.accounts.length > 1 && h('label', { class: 'f' }, t('account'), h('select', { 'aria-label': t('account'), onchange: (e) => switchAccount(e.target.value) },
    S.accounts.map((a) => h('option', { value: a.id, selected: a.id === S.accountId }, a.name || a.id))));
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'ZE'), h('div', { class: 'col' }, h('strong', null, 'Zedge'), h('span', { class: 'xs mute' }, S.me ? `${S.me.name} · ${S.me.role}` : ''))),
    can('domains.write') && h('a', { class: 'btn primary', href: '#/domains', id: 'add-domain-link' }, '+ ' + t('add_domain')),
    acctSelect,
    h('label', { class: 'f' }, t('zone'), zoneSelect),
    h('nav', { class: 'nav', 'aria-label': t('primary_nav') }, allowedRoutes().map(([id, label]) => h('a', { href: `#/${id}`, 'aria-current': id === route[0] ? 'page' : 'false' }, t(label)))),
    h('div', { class: 'row' }, btn(document.documentElement.dataset.theme === 'light' ? t('dark_theme') : t('light_theme'), async () => { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); render(); }, 'link')),
    h('div', { class: 'row' }, btn(t('sign_out'), async () => { await api('POST', 'logout'); location.reload(); }, 'link')),
    // Mobile menu toggle (below 900px)
    h('button', { class: 'btn mobile-toggle', 'aria-label': t('menu'), 'aria-expanded': 'false', onclick: () => { const m = document.getElementById('mobile-menu'); m.classList.toggle('open'); const expanded = m.classList.contains('open'); this.setAttribute('aria-expanded', String(expanded)); } }, '☰'),
    h('div', { class: 'mobile-menu', id: 'mobile-menu' },
      h('nav', { class: 'nav', 'aria-label': t('primary_nav') }, allowedRoutes().map(([id, label]) => h('a', { href: `#/${id}`, 'aria-current': id === route[0] ? 'page' : 'false', onclick: () => { const m = document.getElementById('mobile-menu'); m.classList.remove('open'); } }, t(label)))),
      h('div', { class: 'row' }, btn(document.documentElement.dataset.theme === 'light' ? t('dark_theme') : t('light_theme'), async () => { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); render(); }, 'link')),
      h('div', { class: 'row' }, btn(t('sign_out'), async () => { await api('POST', 'logout'); location.reload(); }, 'link'))));
  app.replaceChildren(h('div', { class: 'shell' }, side, h('main', { class: 'main', id: 'view' })));
}

async function switchAccount(id) {
  S.accountId = id;
  localStorage.setItem('zedge.account', id);
  S.zoneId = '';
  localStorage.removeItem('zedge.zone');
  for (const k of ['zedge.worker', 'zedge.bucket']) {localStorage.removeItem(k);}
  await loadZones();
  render();
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  shell();
  const view = document.getElementById('view');
  view.replaceChildren(h('div', { class: 'spin' }, 'Loading…'));
  const [, , fn, needsZone] = currentRoute();
  try {
    const node = needsZone && !zone() ? noZone() : await /** @type {any} */ (fn)();
    if (seq === renderSeq) {view.replaceChildren(node);}
  } catch (e) {
    if (seq === renderSeq) {view.replaceChildren(card('Something went wrong', h('div', { class: 'err' }, e.message), btn('Retry', render)));}
  }
}
S.render = render;

// ---------------------------------------------------------------- overview
async function overviewView() {
  const z = zone();
  const [sR, dR, zR] = await Promise.allSettled([cf('GET', `/zones/${z.id}/settings`), cf('GET', `/zones/${z.id}/dnssec`), cf('GET', `/zones/${z.id}`)]);
  const zd = zR.status === 'fulfilled' ? zR.value.result : z;
  const settings = Object.fromEntries(((sR.status === 'fulfilled' && sR.value.result) || []).map((s) => [s.id, s.value]));
  const dnssec = dR.status === 'fulfilled' ? dR.value.result : null;
  const set = async (id, value, label) => { await cf('PATCH', `/zones/${z.id}/settings/${id}`, { value }); settings[id] = value; toast(`${label} updated`); };

  const toggles = [
    ['always_use_https', 'Always Use HTTPS', 'Redirect every http:// request to https://'],
    ['http3', 'HTTP/3 (QUIC)', 'Faster connection setup on lossy networks'],
    ['brotli', 'Brotli compression', 'Smaller text assets at the edge'],
    ['early_hints', 'Early Hints', 'Send 103 responses so browsers preload assets'],
    ['development_mode', 'Development mode', 'Bypass the cache temporarily (turns itself off after 3 hours)']
  ].filter(([id]) => id in settings);

  const purgeUrl = input({ placeholder: 'https://example.com/assets/app.js' });
  const traffic = h('div');
  let range = '24h';
  const loadTraffic = async () => {
    fill(traffic, h('div', { class: 'spin' }, 'Loading traffic…'));
    try {
      const t = await api('GET', `analytics/${z.id}?range=${range}`);
      fill(traffic,
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('span', { class: 'xs mute' }, 'Requests'), h('b', null, fmtNum(t.totals.requests))),
          h('div', { class: 'tile' }, h('span', { class: 'xs mute' }, 'Cache hit ratio'), h('b', null, `${Math.round((t.totals.cacheRatio || 0) * 100)}%`)),
          h('div', { class: 'tile' }, h('span', { class: 'xs mute' }, 'Bandwidth'), h('b', null, fmtBytes(t.totals.bytes))),
          h('div', { class: 'tile' }, h('span', { class: 'xs mute' }, 'Threats'), h('b', null, fmtNum(t.totals.threats)))),
        t.series.length ? [barChart(t.series), legend()] : empty('No traffic recorded in this period.'));
    } catch (e) { fill(traffic, empty(`Analytics not available: ${e.message}`)); }
  };
  loadTraffic();

  const TOPS = [['path', 'Top paths'], ['country', 'Countries'], ['status', 'Status codes'], ['fw_action', 'Firewall actions'], ['fw_source', 'Firewall sources']];
  const topBox = h('div');
  let topBy = 'path';
  const loadTop = async () => {
    fill(topBox, h('div', { class: 'spin' }, 'Loading…'));
    try {
      const r = await api('GET', `analytics/${z.id}/top?by=${topBy}&range=${range}`);
      const max = Math.max(1, ...r.rows.map((x) => x.count));
      fill(topBox, r.rows.length ? r.rows.map((x) => h('div', { class: 'li' }, h('span', { class: 'mono small' }, x.key), h('div', { class: 'row' }, h('progress', { class: 'bar', max, value: x.count, 'aria-label': `${x.key}: ${x.count}` }), h('span', { class: 'xs mute' }, fmtNum(x.count))))) : empty('Nothing recorded in this period.'));
    } catch (e) { fill(topBox, empty(`Not available: ${e.message}`)); }
  };
  loadTop();

  return h('div', { class: 'stack' },
    !can('zone.write') && h('div', { class: 'note' }, 'Your role is read-only. Changes on this page will be refused.'),
    header('Overview', zd.name, badge(zd.status, statusKind(zd.status)), btn('Purge everything', async () => {
      if (!confirmAsk(`Purge the entire cache for ${zd.name}?`)) {return;}
      await cf('POST', `/zones/${z.id}/purge_cache`, { purge_everything: true });
      toast('Cache purge started');
    })),
    h('div', { class: 'grid2' },
      h('div', { class: 'wide stack' },
        card('Traffic', segmented('Time range', [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']], range, async (v) => { range = v; await loadTraffic(); }), traffic),
        card('Top lists', segmented('What to rank', TOPS, topBy, async (v) => { topBy = v; await loadTop(); }), topBox, h('span', { class: 'xs mute' }, 'Uses the time range chosen above.')),
        card('Quick zone settings',
          'ssl' in settings && h('div', { class: 'col' }, h('strong', null, 'SSL/TLS encryption mode'),
            segmented('SSL mode', [['off', 'Off'], ['flexible', 'Flexible'], ['full', 'Full'], ['strict', 'Full (strict)']], settings.ssl, (v) => set('ssl', v, 'SSL mode'))),
          'min_tls_version' in settings && h('div', { class: 'col' }, h('strong', null, 'Minimum TLS version'),
            segmented('Minimum TLS', ['1.0', '1.1', '1.2', '1.3'].map((v) => [v, v]), settings.min_tls_version, (v) => set('min_tls_version', v, 'Minimum TLS'))),
          toggles.map(([id, name, desc]) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('strong', null, name), h('span', { class: 'xs mute' }, desc)),
            toggle(settings[id] === 'on', name, (on) => set(id, on ? 'on' : 'off', name)))),
          !Object.keys(settings).length && empty('Settings could not be read. The token needs Zone Settings: Read.')),
        card('Purge by URL',
          h('div', { class: 'row end' }, field('URL', purgeUrl), btn('Purge URL', async () => {
            if (!purgeUrl.value.trim()) {throw new Error('Enter a URL');}
            await cf('POST', `/zones/${z.id}/purge_cache`, { files: [purgeUrl.value.trim()] });
            toast('URL purge started'); purgeUrl.value = '';
          })))),
      h('div', { class: 'narrow stack' },
        card('Zone health',
          h('div', { class: 'li' }, h('span', null, 'Zone status'), badge(zd.status, statusKind(zd.status))),
          h('div', { class: 'li' }, h('span', null, 'Plan'), h('span', { class: 'mute' }, (zd.plan && zd.plan.name) || 'unknown')),
          h('div', { class: 'li' }, h('span', null, 'DNSSEC'), dnssec ? badge(dnssec.status, statusKind(dnssec.status)) : badge('unavailable')),
          dnssec && dnssec.ds && h('div', { class: 'mono xs soft' }, dnssec.ds),
          dnssec && btn(dnssec.status === 'active' ? 'Disable DNSSEC' : 'Enable DNSSEC', async () => {
            const next = dnssec.status === 'active' ? 'disabled' : 'active';
            if (next === 'disabled' && !confirmAsk('Disable DNSSEC? Remove the DS record at your registrar first or the domain may stop resolving.')) {return;}
            await cf('PATCH', `/zones/${z.id}/dnssec`, { status: next }); toast('DNSSEC updated'); render();
          }),
          h('div', { class: 'col' }, h('span', { class: 'xs mute' }, 'Nameservers'), nsBox(zd))))));
}

// ---------------------------------------------------------------- domains
async function domainsView() {
  const nameIn = input({ placeholder: 'example.com', 'aria-label': 'Domain name' });
  const bulk = h('textarea', { rows: '4', placeholder: 'one domain per line', 'aria-label': 'Domains, one per line' });
  const addOne = async (name) => { const r = await api('POST', 'domains', { name }); return r.zone; };

  const add = card('Add a domain', h('div', { class: 'row end' }, field('Domain name', nameIn), btn('Add domain', async () => {
    const z = await addOne(nameIn.value);
    pick(z.id);
    toast(`Added ${z.name}. Set its nameservers at your registrar to activate.`);
    await loadZones(); render();
  }, 'primary')),
  h('details', null, h('summary', { class: 'small' }, 'Add several domains at once'), h('div', { class: 'col' }, bulk, h('div', { class: 'row' }, btn('Add all', async () => {
    const names = [...new Set(bulk.value.split('\n').map((s) => s.trim()).filter(Boolean))];
    let ok = 0; const fails = [];
    for (const n of names) { try { await addOne(n); ok += 1; } catch (e) { fails.push(`${n}: ${e.message}`); } }
    toast(`Added ${ok} of ${names.length}.${fails.length ? ` ${fails[0]}` : ''}`, fails.length > 0);
    await loadZones(); render();
  })))));
  add.classList.add('hero');

  const list = card(`Your domains (${S.zones.length})`, S.zones.length ? S.zones.map((z) => {
    const sub = input({ placeholder: 'app', 'aria-label': `Subdomain for ${z.name}` });
    const tgt = input({ placeholder: '203.0.113.30 or host.example.net', 'aria-label': `Target for ${z.name}` });
    return h('div', { class: 'li', style: undefined }, h('div', { class: 'col', style: undefined },
      h('div', { class: 'row' }, h('strong', { class: 'mono' }, z.name), badge(z.status, statusKind(z.status)),
        h('a', { href: '#/dns', onclick: () => { pick(z.id); } }, 'Manage DNS')),
      z.status !== 'active' && h('div', { class: 'col' }, h('span', { class: 'xs mute' }, 'Set these nameservers at your registrar:'), nsBox(z),
        btn('Check activation', async () => { await cf('PUT', `/zones/${z.id}/activation_check`, {}); toast('Activation check requested'); })),
      h('div', { class: 'row end' }, field('Add subdomain', sub), field('Points to', tgt), btn('Add subdomain', async () => {
        const r = await api('POST', `zones/${z.id}/subdomains`, { name: sub.value, target: tgt.value });
        toast(`Added ${r.record.name} (${r.record.type}), proxied`); sub.value = ''; tgt.value = '';
      }, 'primary'))));
  }) : empty('No domains yet. Add one above.'));

  return h('div', { class: 'stack' }, header('Domains', 'Add a domain or subdomain in one step'), add, list);
}

// ---------------------------------------------------------------- dns
async function dnsView() {
  const z = zone();
  let records = await cfAll(`/zones/${z.id}/dns_records`);
  let filter = 'All';
  let editing = null;
  const box = h('div');

  const draw = () => {
    const types = ['All', ...[...new Set(records.map((r) => r.type))].sort()];
    const vis = records.filter((r) => filter === 'All' || r.type === filter);
    fill(box,
      h('div', { class: 'row between' }, h('h2', null, `Records (${records.length})`),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by type' }, types.map((t) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(t === filter), onclick: () => { filter = t; draw(); } }, t)))),
      h('div', { class: 'tbl' }, h('div', { class: 'tr th' }, h('span', null, 'Type'), h('span', null, 'Name'), h('span', null, 'Content'), h('span', null, 'Proxy'), h('span', null, 'Actions')),
        vis.map(row), !vis.length && empty('No records.')));
  };

  function row(r) {
    const can_ = ['A', 'AAAA', 'CNAME'].includes(r.type);
    const prox = h('button', {
      type: 'button', class: 'proxy', disabled: !can_, 'aria-pressed': String(!!r.proxied), 'aria-label': `${can_ && r.proxied ? 'Proxied' : 'DNS only'}: toggle proxy for ${r.name}`,
      onclick: (e) => run(e.currentTarget, async () => { const res = await cf('PATCH', `/zones/${z.id}/dns_records/${r.id}`, { proxied: !r.proxied }); Object.assign(r, res.result); draw(); })
    }, h('span', { class: `dot${can_ && r.proxied ? ' on' : ''}` }), can_ && r.proxied ? 'Proxied' : 'DNS only');
    if (editing === r.id) {
      const n = input({ value: r.name, 'aria-label': 'Name' });
      const c = input({ value: r.content, 'aria-label': 'Content' });
      return h('div', { class: 'tr editing' }, h('span', { class: 'mute' }, r.type), n, c, prox, h('div', { class: 'row' },
        btn('Save', async () => {
          const body = {};
          if (n.value.trim() && n.value.trim() !== r.name) {body.name = n.value.trim();}
          if (c.value.trim() && c.value.trim() !== r.content) {body.content = c.value.trim();}
          if (Object.keys(body).length) { const res = await cf('PATCH', `/zones/${z.id}/dns_records/${r.id}`, body); Object.assign(r, res.result); toast('Record updated'); }
          editing = null; draw();
        }, 'primary'), btn('Cancel', () => { editing = null; draw(); })));
    }
    return h('div', { class: 'tr' }, h('span', { class: 'mute' }, r.type), h('span', null, r.name), h('span', { class: 'soft' }, r.content), prox, h('div', { class: 'row' },
      btn('Edit', () => { editing = r.id; draw(); }),
      btn('Delete', async () => {
        if (!confirmAsk(`Delete ${r.type} record ${r.name}?`)) {return;}
        await cf('DELETE', `/zones/${z.id}/dns_records/${r.id}`);
        records = records.filter((x) => x.id !== r.id); draw(); toast('Record deleted');
      }, 'danger')));
  }

  // quick add
  const qs = input({ placeholder: 'app', 'aria-label': 'Subdomain' });
  const qt = input({ placeholder: '203.0.113.30 or host.example.net', 'aria-label': 'Target' });
  const qp = h('input', { type: 'checkbox', checked: true });
  const quick = card('Quick add subdomain', h('span', { class: 'small soft' }, 'An IP becomes an A/AAAA record, a hostname becomes a CNAME.'),
    h('div', { class: 'row end' }, field(`Subdomain (.${z.name})`, qs), field('Points to', qt), h('label', { class: 'check' }, qp, 'Proxied'),
      btn('Add subdomain', async () => {
        const r = await api('POST', `zones/${z.id}/subdomains`, { name: qs.value, target: qt.value, proxied: qp.checked });
        records.unshift(r.record); qs.value = ''; qt.value = ''; filter = 'All'; draw(); toast(`Added ${r.record.name} (${r.record.type})`);
      }, 'primary')));
  quick.classList.add('hero');

  // bulk origin
  const bip = input({ placeholder: '203.0.113.99', 'aria-label': 'New IPv4 address' });
  const bop = h('input', { type: 'checkbox', checked: true });
  const plan = h('div');
  const bulk = card('Bulk update origin', h('span', { class: 'small soft' }, 'Moving servers? Preview, then change the IP on every A record at once.'),
    field('New IPv4 address', bip), h('label', { class: 'check' }, bop, 'Only proxied records'), plan,
    h('div', { class: 'row' }, btn('Preview', async () => {
      const r = await api('POST', `zones/${z.id}/bulk-origin`, { ip: bip.value, dryRun: true, onlyProxied: bop.checked });
      fill(plan, r.plan.length ? [h('div', { class: 'small' }, `${r.plan.length} record(s) will change:`), r.plan.map((p) => h('div', { class: 'mono xs soft' }, `${p.name}: ${p.from} → ${p.to}`)),
        btn(`Apply to ${r.plan.length}`, async () => {
          const d = await api('POST', `zones/${z.id}/bulk-origin`, { ip: bip.value, onlyProxied: bop.checked });
          toast(`Updated ${d.updated.length}${d.failed.length ? `, ${d.failed.length} failed` : ''}`, d.failed.length > 0);
          records = await cfAll(`/zones/${z.id}/dns_records`); fill(plan); draw();
        }, 'primary')] : empty('Nothing to change.'));
    })));

  // advanced add
  const at = h('select', { 'aria-label': 'Type' }, ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA', 'SRV'].map((t) => h('option', { value: t }, t)));
  const an = input({ placeholder: '@ or name', 'aria-label': 'Name' });
  const ac = input({ placeholder: 'Value', 'aria-label': 'Content' });
  const ap = input({ placeholder: '10', 'aria-label': 'MX priority' });
  const ax = h('input', { type: 'checkbox' });
  const adv = card('Advanced record', h('div', { class: 'row end' }, field('Type', at), field('Name', an), field('Content', ac), field('MX priority', ap), h('label', { class: 'check' }, ax, 'Proxied')),
    h('div', { class: 'row' }, btn('Save record', async () => {
      const body = { type: at.value, name: an.value.trim() || '@', content: ac.value.trim(), ttl: 1, proxied: ax.checked && ['A', 'AAAA', 'CNAME'].includes(at.value) };
      if (at.value === 'MX') {body.priority = Number(ap.value || 10);}
      const res = await cf('POST', `/zones/${z.id}/dns_records`, body);
      records.unshift(res.result); draw(); toast('Record created');
    })));

  draw();
  // zone file import / export
  const zoneText = h('textarea', { class: 'code', 'aria-label': 'BIND zone file', spellcheck: 'false', placeholder: '$ORIGIN example.com.\nwww 300 IN A 203.0.113.10' });
  const zoneFile = h('input', { type: 'file', 'aria-label': 'Zone file to load' });
  zoneFile.addEventListener('change', async () => { const f = zoneFile.files[0]; if (f) {zoneText.value = await f.text();} });
  const proxiedImport = h('input', { type: 'checkbox', 'aria-label': 'Proxy imported records' });
  const importExport = can('dns.write') ? card('Import and export', h('span', { class: 'small soft' }, 'Export downloads every record as a BIND zone file. Import adds the records in a zone file; existing records are not removed.'),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `/api/zones/${z.id}/dns/export`, download: '' }, 'Export zone file')),
    zoneFile, zoneText, h('label', { class: 'row small' }, proxiedImport, 'Proxy imported A, AAAA and CNAME records'),
    h('div', { class: 'row end' }, btn('Import', async () => {
      const r = await api('POST', `zones/${z.id}/dns/import`, { text: zoneText.value, proxied: proxiedImport.checked });
      toast(`Imported ${r.added ?? '?'} of ${r.parsed ?? '?'} records`); zoneText.value = ''; records = await cfAll(`/zones/${z.id}/dns_records`); draw();
    }, 'primary'))) : h('div', { class: 'row' }, h('a', { class: 'btn', href: `/api/zones/${z.id}/dns/export`, download: '' }, 'Export zone file'));
  return h('div', { class: 'stack' }, header('DNS', `Records for ${z.name}`), quick, card('', box),
    h('div', { class: 'grid2' }, h('div', { class: 'wide' }, adv), h('div', { class: 'narrow' }, bulk)), importExport);
}

// ---------------------------------------------------------------- security
async function securityView() {
  const z = zone();
  const [lvlR, customR, ipR] = await Promise.allSettled([
    cf('GET', `/zones/${z.id}/settings`), api('GET', `zones/${z.id}/rules/custom`), cf('GET', `/zones/${z.id}/firewall/access_rules/rules?per_page=50`)
  ]);
  const level = (lvlR.status === 'fulfilled' && (lvlR.value.result.find((s) => s.id === 'security_level') || {}).value) || 'medium';
  const setLevel = async (v) => { await cf('PATCH', `/zones/${z.id}/settings/security_level`, { value: v }); toast(`Security level: ${v}`); };
  let prev = level === 'under_attack' ? 'medium' : level;
  const attack = toggle(level === 'under_attack', 'Under attack mode', async (on) => { await setLevel(on ? 'under_attack' : prev); });

  let rules = customR.status === 'fulfilled' ? customR.value.rules : [];
  const rulesBox = h('div');
  const rbase = `zones/${z.id}/rules/custom`;
  const drawRules = () => fill(rulesBox, customR.status === 'rejected' ? empty(`Not available: ${customR.reason.message}`) : rules.length ? rules.map((r) => h('div', { class: 'li' },
    h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', null, r.description || '(no description)'), badge(r.action, r.action === 'block' ? 'bad' : 'warn')), h('span', { class: 'mono xs mute' }, r.expression)),
    h('div', { class: 'row' }, toggle(r.enabled !== false, `Enable ${r.description || 'rule'}`, async (on) => { await api('PATCH', `${rbase}/${r.id}`, { enabled: on }); r.enabled = on; }),
      btn('Delete', async () => {
        if (!confirmAsk('Delete this rule?')) {return;}
        await api('DELETE', `${rbase}/${r.id}`); rules = rules.filter((x) => x.id !== r.id); drawRules();
      }, 'danger')))) : empty('No custom rules yet.'));
  drawRules();
  const rd = input({ placeholder: 'Block legacy xmlrpc', 'aria-label': 'Rule description' });
  const rx = h('textarea', { rows: '2', placeholder: '(http.request.uri.path eq "/xmlrpc.php")', 'aria-label': 'Rule expression' });
  const ra = h('select', { 'aria-label': 'Action' }, [['block', 'Block'], ['managed_challenge', 'Managed challenge'], ['js_challenge', 'JS challenge'], ['log', 'Log']].map(([v, t]) => h('option', { value: v }, t)));
  const create = card('Create custom rule', field('Description', rd), field('Expression', rx), h('div', { class: 'row end' }, field('Action', ra), btn('Create rule', async () => {
    if (!rx.value.trim()) {throw new Error('Enter an expression');}
    const r = await api('POST', rbase, { description: rd.value.trim(), expression: rx.value.trim(), action: ra.value });
    rules = r.rules; drawRules(); rd.value = ''; rx.value = ''; toast('Rule created');
  }, 'primary')));

  let ips = ipR.status === 'fulfilled' ? ipR.value.result : [];
  const ipBox = h('div');
  const drawIps = () => fill(ipBox, ips.length ? ips.map((i) => h('div', { class: 'li' }, h('div', { class: 'row' }, h('span', { class: 'mono' }, i.configuration.value), badge(i.mode, i.mode === 'block' ? 'bad' : 'info')),
    btn('Remove', async () => { await cf('DELETE', `/zones/${z.id}/firewall/access_rules/rules/${i.id}`); ips = ips.filter((x) => x.id !== i.id); drawIps(); }, 'danger'))) : empty('No IP rules.'));
  drawIps();
  const iv = input({ placeholder: '198.51.100.7, 198.51.100.0/24 or CN', 'aria-label': 'IP, range or country' });
  const im = h('select', { 'aria-label': 'Mode' }, ['block', 'managed_challenge', 'challenge', 'whitelist'].map((m) => h('option', { value: m }, m)));
  const ipCard = card('IP access rules', h('div', { class: 'row end' }, field('IP, range or country code', iv), field('Mode', im), btn('Add', async () => {
    const v = iv.value.trim();
    const target = /^[A-Za-z]{2}$/.test(v) ? 'country' : v.includes('/') ? 'ip_range' : 'ip';
    const r = await cf('POST', `/zones/${z.id}/firewall/access_rules/rules`, { mode: im.value, configuration: { target, value: target === 'country' ? v.toUpperCase() : v }, notes: 'Added from Zedge' });
    ips.unshift(r.result); iv.value = ''; drawIps(); toast('Rule added');
  }, 'primary')), ipBox);

  return h('div', { class: 'stack' }, header('Security & WAF', `Firewall for ${z.name}`),
    !can('security.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'wide stack' },
        card('Security level', segmented('Security level', [['essentially_off', 'Essentially off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], level === 'under_attack' ? '' : level, async (v) => { prev = v; await setLevel(v); }),
          h('div', { class: 'li' }, h('div', { class: 'col' }, h('strong', null, 'Under attack mode'), h('span', { class: 'xs mute' }, 'Challenge every visitor. Use only during an active attack.')), attack)),
        card('Custom rules', rulesBox), create),
      h('div', { class: 'narrow stack' }, ipCard, card('Rate limits and managed rulesets', h('span', { class: 'small soft' }, 'These now have their own editor.'), h('a', { href: '#/rules' }, 'Open Rules')))));
}

// ---------------------------------------------------------------- tokens + audit
async function tokensView() {
  const [tplR, listR, auditR] = await Promise.allSettled([
    api('GET', 'tokens/templates'), cf('GET', '/user/tokens'),
    S.accountId ? cf('GET', `/accounts/${S.accountId}/audit_logs?limit=25`) : Promise.reject(new Error('No account available'))
  ]);
  const tpls = tplR.status === 'fulfilled' ? tplR.value : {};
  let tpl = Object.keys(tpls)[0];
  let ttl = 90;
  const zoneSel = h('select', { 'aria-label': 'Zone' }, S.zones.map((z) => h('option', { value: z.id, selected: z.id === S.zoneId }, z.name)));
  const out = h('div');
  const permsBox = h('div', { class: 'col' });
  const drawPerms = () => fill(permsBox, h('span', { class: 'xs mute' }, 'PERMISSIONS'), ((tpls[tpl] && tpls[tpl].permissions) || []).map((p) => h('span', { class: 'mono small' }, p)));
  drawPerms();
  const verify = S.meta && S.meta.token;

  const create = card('Create a scoped token', h('span', { class: 'small soft' }, 'Pick a template and a lifetime. Nothing broader than needed is granted.'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Template' }, Object.entries(tpls).map(([k, v]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(k === tpl), onclick: (e) => { tpl = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); drawPerms(); } }, v.label))),
    permsBox, field('Zone (for zone-scoped templates)', zoneSel),
    segmented('Lifetime', [[30, '30 days'], [90, '90 days'], [365, '1 year']], ttl, (v) => { ttl = v; }),
    h('div', { class: 'row' }, btn('Create token', async () => {
      const r = await api('POST', 'tokens/from-template', { template: tpl, zoneId: zoneSel.value, ttlDays: ttl });
      out.replaceChildren(secretBox(`Token "${r.token.name}" created. Copy it now: it is shown only once.`, r.token.value)); toast('Token created');
    }, 'primary')), out);
  create.classList.add('hero');

  const tokens = card('Tokens', listR.status === 'rejected' ? empty(`Not available: ${listR.reason.message}. Listing tokens needs the API Tokens: Read permission.`)
    : (listR.value.result.length ? listR.value.result.map((t) => {
      const holder = h('div');
      return h('div', { class: 'li' }, h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', { class: 'mono' }, t.name), badge(t.status, statusKind(t.status))), h('span', { class: 'xs mute' }, `expires ${fmtDate(t.expires_on)} · last used ${fmtDate(t.last_used_on)}`), holder),
        h('div', { class: 'row' }, btn('Roll', async () => {
          if (!confirmAsk(`Roll ${t.name}? The old value stops working immediately.`)) {return;}
          const r = await cf('PUT', `/user/tokens/${t.id}/value`, {}); holder.replaceChildren(secretBox('New value (shown once):', r.result));
        }), btn('Revoke', async () => { if (!confirmAsk(`Revoke ${t.name}?`)) {return;} await cf('DELETE', `/user/tokens/${t.id}`); toast('Token revoked'); render(); }, 'danger')));
    }) : empty('No tokens.')));

  const audit = card('Audit log', auditR.status === 'rejected' ? empty(`Not available: ${auditR.reason.message}`)
    : (auditR.value.result.length ? auditR.value.result.map((e) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('span', null, `${(e.action && e.action.type) || 'event'} ${(e.resource && e.resource.type) || ''}`.trim()), h('span', { class: 'mono xs mute' }, `${fmtDate(e.when)} · ${(e.actor && (e.actor.email || e.actor.ip)) || 'system'}`)))) : empty('No events.')));

  return h('div', { class: 'stack' }, header('API Tokens', verify ? `This console's token is ${verify.status}${verify.expires_on ? `, expires ${fmtDate(verify.expires_on)}` : ''}` : ''), create, h('div', { class: 'grid2' }, h('div', { class: 'wide' }, tokens), h('div', { class: 'narrow' }, audit)));
}

// ---------------------------------------------------------------- login + boot
async function loginView() {
  let sso = null;
  try { sso = (await api('GET', 'session')).sso; } catch { /* show the password form */ }
  const user = h('input', { type: 'text', autocomplete: 'username', value: 'admin', 'aria-label': 'Username' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Authentication code', placeholder: '123456 or a recovery code' });
  const codeRow = h('label', { class: 'f', hidden: true }, 'Authentication code', code);
  const msg = h('div', { class: 'err small', role: 'alert' });
  const fromSso = new URLSearchParams(location.search).get('sso_error');
  if (fromSso) { msg.textContent = fromSso; history.replaceState(null, '', location.pathname + location.hash); }
  const go = async (e) => {
    e.preventDefault();
    try { await api('POST', 'login', { username: user.value, password: pw.value, code: code.value.trim() || undefined }); boot(); } catch (err) {
      msg.textContent = err.message;
      if (err.json && err.json.totpRequired) { codeRow.hidden = false; code.focus(); }
    }
  };
  const passwordForm = [h('label', { class: 'f' }, 'Username', user), h('label', { class: 'f' }, 'Password', pw), codeRow, h('button', { type: 'submit', class: sso ? 'btn' : 'btn primary' }, 'Sign in')];
  app.replaceChildren(h('form', { class: 'login', onsubmit: go },
    h('div', { class: 'brand' }, h('div', { class: 'mark' }, 'ZE'), h('strong', null, 'Zedge')),
    sso && h('a', { class: 'btn primary', href: '/api/oidc/login' }, sso.label),
    msg,
    sso && !sso.passwordLogin ? h('details', null, h('summary', { class: 'small' }, 'Local administrator sign-in'), h('div', { class: 'stack' }, passwordForm)) : [sso && h('div', { class: 'xs mute' }, 'or use a local account'), passwordForm]));
  (sso ? undefined : pw).focus?.();
}

async function boot() {
  await loadI18n();
  setUnauthorizedHandler(loginView);
  try {
    const sess = await api('GET', 'session');
    if (!sess.signedIn) {return loginView();}
    S.meta = await api('GET', 'meta');
    S.me = S.meta.me;
    S.accounts = S.meta.accounts || [];
    const saved = localStorage.getItem('zedge.account');
    if (saved && !S.accounts.some((a) => a.id === saved)) {localStorage.removeItem('zedge.account');}
    S.accountId = S.meta.accountId || '';
    if (S.meta.accountError) {toast(`Account: ${S.meta.accountError}`, true);}
    const exp = S.meta.token && S.meta.token.expires_on && new Date(S.meta.token.expires_on).getTime();
    if (exp) {
      const days = Math.ceil((exp - Date.now()) / 86400000);
      if (days <= 14) {toast(days <= 0 ? 'The Cloudflare API token has expired. Create a new one and restart the console.' : `The Cloudflare API token expires in ${days} day${days === 1 ? '' : 's'}.`, true);}
    }
    await loadZones();
    initCommandPalette();
    const state = /** @type {any} */ (boot);
    if (!state.listening) { window.addEventListener('hashchange', render); state.listening = true; }
    if (!S.zones.length && !location.hash && can('domains.write')) {location.hash = '#/domains';}
    render();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'login' }, h('h1', null, 'Cannot reach Cloudflare'), h('div', { class: 'err' }, e.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry')));
  }
}
boot();

import { h, cf, toast, badge, btn, card, field, input, empty, toggle, confirmAsk, selectOf, lines } from '../lib.js';
import { S, zone, can } from '../ctx.js';
import { tabbedView, item, noAccount } from './kit.js';

const acct = (p) => `/accounts/${S.accountId}/load_balancers/${p}`;
const poolOptions = (pools) => pools.map((p) => [p.id, p.name]);

async function balancersTab() {
  const z = zone();
  if (!z) return card('', empty('Add a domain first.'));
  const [lbs, pools] = await Promise.all([cf('GET', `/zones/${z.id}/load_balancers`), cf('GET', acct('pools'))]);
  const reload = () => location.reload();
  const name = input({ placeholder: `lb.${z.name}`, 'aria-label': 'Hostname' });
  const def = selectOf('Default pool', poolOptions(pools.result || []), '');
  const fb = selectOf('Fallback pool', poolOptions(pools.result || []), '');
  const proxied = selectOf('Proxy', [['true', 'Proxied (orange cloud)'], ['false', 'DNS only']], 'true');
  return [
    card('Load balancers', (lbs.result || []).length ? lbs.result.map((l) => item(l.name, `${(l.default_pools || []).length} pool(s) · ${l.steering_policy || 'off'} steering`,
      toggle(l.enabled !== false, `Enable ${l.name}`, async (on) => { await cf('PATCH', `/zones/${z.id}/load_balancers/${l.id}`, { enabled: on }); }),
      btn('Delete', async () => { if (!confirmAsk(`Delete load balancer ${l.name}?`)) return; await cf('DELETE', `/zones/${z.id}/load_balancers/${l.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No load balancers on this zone. Load Balancing is a paid add-on.')),
    can('lb.write') && card('Create a load balancer', (pools.result || []).length ? h('div', { class: 'row end' }, field('Hostname', name), field('Default pool', def), field('Fallback pool', fb), field('Proxy', proxied),
      btn('Create', async () => {
        if (!def.value) throw new Error('Create a pool first');
        await cf('POST', `/zones/${z.id}/load_balancers`, { name: name.value.trim().toLowerCase(), default_pools: [def.value], fallback_pool: fb.value || def.value, proxied: proxied.value === 'true' });
        toast('Load balancer created'); reload();
      }, 'primary')) : empty('Create a pool first (Pools tab).'))
  ];
}

async function poolsTab() {
  const [pools, mons] = await Promise.all([cf('GET', acct('pools')), cf('GET', acct('monitors'))]);
  const reload = () => location.reload();
  const name = input({ placeholder: 'bangkok', 'aria-label': 'Pool name' });
  const origins = h('textarea', { class: 'code', 'aria-label': 'Origins', placeholder: 'one per line:\norigin-1 203.0.113.10\norigin-2 203.0.113.11', spellcheck: 'false' });
  const mon = selectOf('Monitor', [['', '(none)'], ...(mons.result || []).map((m) => [m.id, `${m.type} ${m.path || ''}`.trim()])], '');
  return [
    card('Pools', (pools.result || []).length ? pools.result.map((p) => item(p.name, `${(p.origins || []).map((o) => o.address).join(', ')}`, p.healthy === false ? badge('unhealthy', 'bad') : p.healthy === true ? badge('healthy', 'ok') : badge('unknown'),
      toggle(p.enabled !== false, `Enable ${p.name}`, async (on) => { await cf('PATCH', `${acct('pools')}/${p.id}`, { enabled: on }); }),
      btn('Delete', async () => { if (!confirmAsk(`Delete pool ${p.name}?`)) return; await cf('DELETE', `${acct('pools')}/${p.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No pools yet.')),
    can('lb.write') && card('Create a pool', field('Name', name), field('Origins (name, then address)', origins), h('div', { class: 'row end' }, field('Health monitor', mon),
      btn('Create pool', async () => {
        const list = lines(origins.value.replace(/\n/g, ',')).map((l, i) => { const parts = l.split(/\s+/); return parts.length > 1 ? { name: parts[0], address: parts[1], enabled: true } : { name: `origin-${i + 1}`, address: parts[0], enabled: true }; });
        if (!list.length) throw new Error('Add at least one origin');
        const body = { name: name.value.trim(), origins: list, enabled: true };
        if (mon.value) body.monitor = mon.value;
        await cf('POST', acct('pools'), body); toast('Pool created'); reload();
      }, 'primary')))
  ];
}

async function monitorsTab() {
  const mons = await cf('GET', acct('monitors'));
  const reload = () => location.reload();
  const type = selectOf('Protocol', [['https', 'HTTPS'], ['http', 'HTTP'], ['tcp', 'TCP']], 'https');
  const path = input({ value: '/', 'aria-label': 'Path' });
  const codes = input({ value: '200', 'aria-label': 'Expected codes' });
  const interval = selectOf('Check every', [[60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']], 60);
  return [
    card('Health monitors', (mons.result || []).length ? mons.result.map((m) => item(`${m.type.toUpperCase()} ${m.path || ''}`.trim(), `expects ${m.expected_codes || 'open port'} · every ${m.interval}s`,
      btn('Delete', async () => { if (!confirmAsk('Delete this monitor?')) return; await cf('DELETE', `${acct('monitors')}/${m.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No monitors yet.')),
    can('lb.write') && card('Create a monitor', h('div', { class: 'row end' }, field('Protocol', type), field('Path', path), field('Expected codes', codes), field('Check every', interval),
      btn('Create monitor', async () => {
        const body = { type: type.value, interval: Number(interval.value), timeout: 5, retries: 2 };
        if (type.value !== 'tcp') Object.assign(body, { method: 'GET', path: path.value.trim() || '/', expected_codes: codes.value.trim() || '200' });
        await cf('POST', acct('monitors'), body); toast('Monitor created'); reload();
      }, 'primary')))
  ];
}

async function healthTab() {
  const z = zone();
  if (!z) return card('', empty('Add a domain first.'));
  const hc = await cf('GET', `/zones/${z.id}/healthchecks`);
  const reload = () => location.reload();
  const name = input({ placeholder: 'api-check', 'aria-label': 'Name' });
  const addr = input({ placeholder: 'origin.example.com', 'aria-label': 'Address' });
  const type = selectOf('Protocol', [['HTTPS', 'HTTPS'], ['HTTP', 'HTTP'], ['TCP', 'TCP']], 'HTTPS');
  return [
    card('Health checks', h('span', { class: 'small soft' }, 'Standalone checks that probe your origin from Cloudflare and report status.'),
      (hc.result || []).length ? hc.result.map((c) => item(c.name, `${c.type} ${c.address}`, badge(c.status || 'unknown', c.status === 'healthy' ? 'ok' : c.status === 'unhealthy' ? 'bad' : 'mute'),
        btn('Delete', async () => { if (!confirmAsk(`Delete ${c.name}?`)) return; await cf('DELETE', `/zones/${z.id}/healthchecks/${c.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No health checks.')),
    can('lb.write') && card('Create a health check', h('div', { class: 'row end' }, field('Name', name), field('Address', addr), field('Protocol', type),
      btn('Create', async () => { await cf('POST', `/zones/${z.id}/healthchecks`, { name: name.value.trim(), address: addr.value.trim(), type: type.value }); toast('Health check created'); reload(); }, 'primary')))
  ];
}

export async function lbView() {
  if (!S.accountId) return noAccount();
  return tabbedView({
    title: 'Load balancing', sub: 'Pools, monitors, load balancers and health checks', perm: 'lb.write', key: 'zedge.lbTab',
    tabs: [['balancers', 'Load balancers'], ['pools', 'Pools'], ['monitors', 'Monitors'], ['health', 'Health checks']],
    builders: { balancers: balancersTab, pools: poolsTab, monitors: monitorsTab, health: healthTab }
  });
}

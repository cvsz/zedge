import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, confirmAsk, selectOf, lines } from '../lib.js';
import { S, zone, can } from '../ctx.js';
import { tabbedView, item, noAccount, textarea } from './kit.js';

const scriptNames = async () => ((await cf('GET', `/accounts/${S.accountId}/workers/scripts`)).result || []).map((s) => s.id);

async function routesTab() {
  const z = zone();
  const a = S.accountId;
  const [scripts, routes, doms] = await Promise.all([scriptNames(), z ? cf('GET', `/zones/${z.id}/workers/routes`) : { result: [] }, cf('GET', `/accounts/${a}/workers/domains`)]);
  const reload = () => location.reload();
  const pattern = input({ placeholder: `${z ? z.name : 'example.com'}/api/*`, 'aria-label': 'Route pattern' });
  const script = selectOf('Worker', scripts.map((s) => [s, s]), '');
  const host = input({ placeholder: `app.${z ? z.name : 'example.com'}`, 'aria-label': 'Custom domain hostname' });
  const svc = selectOf('Worker', scripts.map((s) => [s, s]), '');
  return [
    card(`Routes${z ? ` on ${z.name}` : ''}`, h('span', { class: 'small soft' }, 'A route sends matching requests to a Worker. Use * as a wildcard.'),
      (routes.result || []).length ? routes.result.map((r) => item(r.pattern, r.script || '(no Worker: bypasses Workers)', btn('Delete', async () => { if (!confirmAsk(`Delete route ${r.pattern}?`)) return; await cf('DELETE', `/zones/${z.id}/workers/routes/${r.id}`); toast('Route deleted'); reload(); }, 'danger'))) : empty('No routes.'),
      can('workers.write') && z && h('div', { class: 'row end' }, field('Pattern', pattern), field('Worker', script), btn('Add route', async () => { await cf('POST', `/zones/${z.id}/workers/routes`, { pattern: pattern.value.trim(), script: script.value }); toast('Route added'); reload(); }, 'primary'))),
    card('Custom domains', h('span', { class: 'small soft' }, 'Cloudflare creates the DNS record and certificate for you.'),
      (doms.result || []).length ? doms.result.map((d) => item(d.hostname, `→ ${d.service}`, btn('Remove', async () => { if (!confirmAsk(`Remove ${d.hostname}?`)) return; await cf('DELETE', `/accounts/${a}/workers/domains/${d.id}`); toast('Removed'); reload(); }, 'danger'))) : empty('No custom domains.'),
      can('workers.write') && z && h('div', { class: 'row end' }, field('Hostname', host), field('Worker', svc), btn('Attach', async () => { await cf('PUT', `/accounts/${a}/workers/domains`, { hostname: host.value.trim().toLowerCase(), service: svc.value, zone_id: z.id, environment: 'production' }); toast('Domain attached'); reload(); }, 'primary')))
  ];
}

async function cronTab() {
  const a = S.accountId;
  const scripts = await scriptNames();
  if (!scripts.length) return card('', empty('No Workers yet.'));
  const pick = selectOf('Worker', scripts.map((s) => [s, s]), localStorage.getItem('zedge.cronWorker') || scripts[0]);
  const box = h('div', { class: 'stack' });
  const load = async () => {
    localStorage.setItem('zedge.cronWorker', pick.value);
    const r = await cf('GET', `/accounts/${a}/workers/scripts/${pick.value}/schedules`);
    const crons = ((r.result && r.result.schedules) || []).map((x) => x.cron);
    const ta = textarea({ 'aria-label': 'Cron expressions', placeholder: '*/15 * * * *\n0 3 * * *', value: crons.join('\n') });
    fill(box, h('span', { class: 'small soft' }, 'One cron expression per line, in UTC. Saving replaces the full list; an empty box removes all triggers.'), ta,
      can('workers.write') && h('div', { class: 'row end' }, btn('Save triggers', async () => {
        const list = lines(ta.value.replace(/\n/g, ',').replace(/,\s*/g, '\n')).filter(Boolean);
        await cf('PUT', `/accounts/${a}/workers/scripts/${pick.value}/schedules`, list.map((cron) => ({ cron }))); toast('Cron triggers saved');
      }, 'primary')));
  };
  pick.addEventListener('change', load);
  await load();
  return card('Cron triggers', field('Worker', pick), box);
}

async function snippetsTab() {
  const z = zone();
  if (!z) return card('', empty('Add a domain first.'));
  const [list, rules] = await Promise.all([cf('GET', `/zones/${z.id}/snippets`), cf('GET', `/zones/${z.id}/snippets/snippet_rules`).catch(() => ({ result: [] }))]);
  const names = (list.result || []).map((s) => s.snippet_name);
  const reload = () => location.reload();
  const name = input({ placeholder: 'add_security_headers', 'aria-label': 'Snippet name' });
  const code = textarea({ 'aria-label': 'Snippet code', placeholder: 'export default {\n  async fetch(request) {\n    return fetch(request);\n  },\n};' });
  const sn = selectOf('Snippet', names.map((n) => [n, n]), names[0]);
  const expr = input({ placeholder: '(http.host eq "example.com")', 'aria-label': 'Match expression' });
  const saveRules = (next) => api('PUT', `zones/${z.id}/snippet-rules`, { rules: next });
  const current = (rules.result || []).map((r) => ({ snippet_name: r.snippet_name, expression: r.expression, enabled: r.enabled !== false, description: r.description || '' }));
  return [
    card('Snippets', h('span', { class: 'small soft' }, 'Tiny JavaScript modules (32 KB max) that run on matching requests. Saving a name that exists replaces it.'),
      names.length ? names.map((n) => item(n, null, btn('Delete', async () => { if (!confirmAsk(`Delete snippet ${n}? Rules that use it must be removed first.`)) return; await api('DELETE', `zones/${z.id}/snippets/${n}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No snippets yet.'),
      can('workers.write') && [field('Name (letters, digits, underscores)', name), code, h('div', { class: 'row end' }, btn('Save snippet', async () => { await api('PUT', `zones/${z.id}/snippets/${name.value.trim()}`, { code: code.value }); toast('Snippet saved'); reload(); }, 'primary'))]),
    card('Snippet rules', h('span', { class: 'small soft' }, 'Which requests run which snippet.'),
      current.length ? current.map((r, i) => item(r.snippet_name, r.expression, !r.enabled && badge('off'), btn('Remove', async () => { await saveRules(current.filter((_, j) => j !== i)); toast('Rule removed'); reload(); }, 'danger'))) : empty('No rules.'),
      can('workers.write') && names.length > 0 && h('div', { class: 'row end' }, field('Snippet', sn), field('When', expr), btn('Add rule', async () => { await saveRules([...current, { snippet_name: sn.value, expression: expr.value.trim(), enabled: true }]); toast('Rule added'); reload(); }, 'primary')))
  ];
}

export async function edgeView() {
  if (!S.accountId) return noAccount();
  return tabbedView({
    title: 'Edge', sub: 'Worker routes and domains, cron triggers, Snippets', perm: 'workers.write', key: 'zedge.edgeTab',
    tabs: [['routes', 'Routes & domains'], ['cron', 'Cron triggers'], ['snippets', 'Snippets']],
    builders: { routes: routesTab, cron: cronTab, snippets: snippetsTab }
  });
}
void badge;

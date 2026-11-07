import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, segmented, toggle, confirmAsk, selectOf } from '../lib.js';
import { S, zone, header, can } from '../ctx.js';

const MANAGED = [
  ['cloudflare', 'efb7b8c949ac4650a09736fc376e9aee', 'Cloudflare Managed Ruleset', 'Blocks known exploits such as Log4j and common CVEs.'],
  ['owasp', '4814384a9e5d4991b9815dcfc25d2f1f', 'Cloudflare OWASP Core Ruleset', 'Scores requests against OWASP ModSecurity patterns.']
];
const TABS = [['ratelimit', 'Rate limits'], ['managed', 'Managed rulesets'], ['redirect', 'Redirects'], ['cache', 'Cache rules'], ['rewrite', 'URL rewrites'], ['headers', 'Header edits'], ['origin', 'Origin override'], ['pagerules', 'Page rules']];
const ttlChoices = [[7200, '2 hours'], [86400, '1 day'], [604800, '7 days'], [2592000, '30 days'], [31536000, '1 year']];

const matchFields = (prefix = '') => {
  const host = input({ placeholder: 'old.example.com (optional)', 'aria-label': `${prefix}Host` });
  const path = input({ placeholder: '/blog (optional)', 'aria-label': `${prefix}Path` });
  const type = selectOf('Path match', [['prefix', 'starts with'], ['exact', 'is exactly']], 'prefix');
  const custom = input({ placeholder: '(http.request.uri.path contains "/api")', 'aria-label': 'Custom expression' });
  return {
    nodes: [field('Host', host), field('Path', path), field('Path match', type), field('Or a custom expression (overrides the fields to the left)', custom)],
    values: () => ({ fromHost: host.value, fromPath: path.value, matchType: type.value, expression: custom.value }),
    clear: () => { host.value = ''; path.value = ''; custom.value = ''; }
  };
};

function ruleList(z, kind, describe, reload) {
  const box = h('div');
  let rules = [];
  const draw = () => fill(box, rules.length ? rules.map((r) => h('div', { class: 'li' },
    h('div', { class: 'col' }, h('strong', null, r.description || '(no description)'), h('span', { class: 'mono xs mute' }, describe(r))),
    h('div', { class: 'row' },
      toggle(r.enabled !== false, `Enable ${r.description || 'rule'}`, async (on) => { await api('PATCH', `zones/${z.id}/rules/${kind}/${r.id}`, { enabled: on }); r.enabled = on; }),
      btn('Delete', async () => {
        if (!confirmAsk(`Delete "${r.description || 'this rule'}"?`)) {return;}
        await api('DELETE', `zones/${z.id}/rules/${kind}/${r.id}`);
        rules = rules.filter((x) => x.id !== r.id); draw(); toast('Rule deleted');
      }, 'danger')))) : empty('None yet.'));
  return { box, set: (list) => { rules = list; draw(); }, load: async () => { rules = (await api('GET', `zones/${z.id}/rules/${kind}`)).rules; draw(); }, reload };
}

async function rateLimitTab(z) {
  const list = ruleList(z, 'ratelimit', (r) => `${r.expression}  ·  ${r.ratelimit ? `${r.ratelimit.requests_per_period} req / ${r.ratelimit.period}s → ${r.action}${r.ratelimit.mitigation_timeout ? ` for ${r.ratelimit.mitigation_timeout}s` : ''}` : r.action}`);
  await list.load();
  const m = matchFields();
  const desc = input({ placeholder: 'Login endpoint', 'aria-label': 'Description' });
  const reqs = input({ placeholder: '100', 'aria-label': 'Requests' });
  const period = selectOf('Period', [[10, '10 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [3600, '1 hour']], 60);
  const action = selectOf('Action', [['block', 'Block'], ['managed_challenge', 'Managed challenge'], ['js_challenge', 'JS challenge'], ['log', 'Log only']], 'block');
  const timeout = selectOf('Block for', [[10, '10 seconds'], [60, '1 minute'], [600, '10 minutes'], [3600, '1 hour'], [86400, '1 day']], 600);
  return [
    card('Rate limiting rules', h('span', { class: 'small soft' }, 'Limits count requests per client IP per Cloudflare location. Leave host, path and expression empty to cover the whole site.'), list.box),
    card('Add a rate limit', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' },
      field('Requests', reqs), field('Per', period), field('Action', action), field('Block for', timeout),
      btn('Add rate limit', async () => {
        await api('POST', `zones/${z.id}/rules/ratelimit`, { ...m.values(), description: desc.value, requests: reqs.value, period: period.value, action: action.value, timeout: timeout.value });
        toast('Rate limit added'); m.clear(); desc.value = ''; reqs.value = ''; await list.load();
      }, 'primary')))
  ];
}

async function managedTab(z) {
  let rules = (await api('GET', `zones/${z.id}/rules/managed`)).rules;
  const box = h('div');
  const draw = () => fill(box, MANAGED.map(([key, id, title, desc]) => {
    const r = rules.find((x) => x.action_parameters && x.action_parameters.id === id);
    return h('div', { class: 'li' },
      h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', null, title), r ? badge(r.enabled === false ? 'Deployed, off' : 'On', r.enabled === false ? 'warn' : 'ok') : badge('Not deployed')), h('span', { class: 'xs mute' }, desc)),
      h('div', { class: 'row' },
        toggle(!!r && r.enabled !== false, title, async (on) => {
          if (r) {await api('PATCH', `zones/${z.id}/rules/managed/${r.id}`, { enabled: on });}
          else if (on) {await api('POST', `zones/${z.id}/rules/managed`, { ruleset: key });}
          rules = (await api('GET', `zones/${z.id}/rules/managed`)).rules; draw(); toast(`${title} ${on ? 'on' : 'off'}`);
        }),
        r && btn('Remove', async () => {
          if (!confirmAsk(`Remove ${title} from this zone?`)) {return;}
          await api('DELETE', `zones/${z.id}/rules/managed/${r.id}`); rules = rules.filter((x) => x.id !== r.id); draw();
        }, 'danger')));
  }));
  draw();
  return [card('Managed rulesets', h('span', { class: 'small soft' }, 'Maintained by Cloudflare. Some rulesets need a paid plan; if Cloudflare refuses, the message is shown here.'), box)];
}

async function redirectTab(z) {
  const list = ruleList(z, 'redirect', (r) => { const f = r.action_parameters && r.action_parameters.from_value; return `${r.expression}  →  ${f ? `${f.status_code} ${f.target_url && f.target_url.value}` : ''}`; });
  await list.load();
  const m = matchFields();
  const desc = input({ placeholder: 'Old blog to new site', 'aria-label': 'Description' });
  const target = input({ placeholder: 'https://example.com/news', 'aria-label': 'Target URL' });
  const status = selectOf('Status', [[301, '301 permanent'], [302, '302 temporary'], [307, '307 temporary (keep method)'], [308, '308 permanent (keep method)']], 301);
  const keep = h('input', { type: 'checkbox', checked: true });
  return [
    card('Redirect rules', list.box),
    card('Add a redirect', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' }, field('Redirect to', target), field('Status', status), h('label', { class: 'check' }, keep, 'Keep query string'),
      btn('Add redirect', async () => {
        await api('POST', `zones/${z.id}/rules/redirect`, { ...m.values(), description: desc.value, target: target.value, status: status.value, preserveQuery: keep.checked });
        toast('Redirect added'); m.clear(); desc.value = ''; target.value = ''; await list.load();
      }, 'primary')))
  ];
}

async function cacheTab(z) {
  const list = ruleList(z, 'cache', (r) => { const p = r.action_parameters || {}; return `${r.expression}  →  ${p.cache === false ? 'bypass cache' : `edge TTL ${p.edge_ttl && p.edge_ttl.default}s`}`; });
  await list.load();
  const m = matchFields();
  const desc = input({ placeholder: 'Cache static assets', 'aria-label': 'Description' });
  const mode = selectOf('Mode', [['ttl', 'Cache with a TTL'], ['bypass', 'Bypass cache']], 'ttl');
  const edge = selectOf('Edge TTL', ttlChoices, 86400);
  const browser = input({ placeholder: 'seconds (optional)', 'aria-label': 'Browser TTL' });
  return [
    card('Cache rules', h('span', { class: 'small soft' }, 'Free plans require an edge TTL of at least 2 hours.'), list.box),
    card('Add a cache rule', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' }, field('Mode', mode), field('Edge TTL', edge), field('Browser TTL', browser),
      btn('Add cache rule', async () => {
        await api('POST', `zones/${z.id}/rules/cache`, { ...m.values(), description: desc.value, mode: mode.value, edgeTtl: edge.value, browserTtl: browser.value });
        toast('Cache rule added'); m.clear(); desc.value = ''; browser.value = ''; await list.load();
      }, 'primary')))
  ];
}

async function pageRulesTab(z) {
  let rules = (await cf('GET', `/zones/${z.id}/pagerules`)).result || [];
  const box = h('div');
  const summarise = (r) => (r.actions || []).map((a) => (a.id === 'forwarding_url' ? `forward to ${a.value.url} (${a.value.status_code})` : `${a.id}: ${typeof a.value === 'object' ? JSON.stringify(a.value) : a.value}`)).join(', ');
  const draw = () => fill(box, rules.length ? rules.map((r) => h('div', { class: 'li' },
    h('div', { class: 'col' }, h('strong', { class: 'mono' }, ((r.targets || [])[0] && r.targets[0].constraint.value) || '(pattern)'), h('span', { class: 'xs mute' }, summarise(r))),
    h('div', { class: 'row' },
      toggle(r.status === 'active', 'Page rule active', async (on) => { await cf('PATCH', `/zones/${z.id}/pagerules/${r.id}`, { status: on ? 'active' : 'disabled' }); r.status = on ? 'active' : 'disabled'; }),
      btn('Delete', async () => { if (!confirmAsk('Delete this page rule?')) {return;} await cf('DELETE', `/zones/${z.id}/pagerules/${r.id}`); rules = rules.filter((x) => x.id !== r.id); draw(); }, 'danger')))) : empty('No page rules.'));
  draw();
  const pattern = input({ placeholder: '*example.com/old/*', 'aria-label': 'URL pattern' });
  const kind = selectOf('Action', [['forward', 'Forward to a URL'], ['cache_level', 'Set cache level']], 'forward');
  const target = input({ placeholder: 'https://example.com/new/$1', 'aria-label': 'Forward to' });
  const code = selectOf('Status', [[301, '301 permanent'], [302, '302 temporary']], 301);
  const level = selectOf('Cache level', [['bypass', 'Bypass'], ['basic', 'No query string'], ['simplified', 'Ignore query string'], ['aggressive', 'Standard'], ['cache_everything', 'Cache everything']], 'cache_everything');
  return [
    card('Page rules', h('span', { class: 'small soft' }, 'Page Rules are Cloudflare\'s older system. Prefer redirect and cache rules for new work.'), box),
    card('Add a page rule', h('div', { class: 'row end' }, field('URL pattern', pattern), field('Action', kind)), h('div', { class: 'row end' }, field('Forward to', target), field('Status', code), field('Cache level', level),
      btn('Add page rule', async () => {
        if (!pattern.value.trim()) {throw new Error('Enter a URL pattern');}
        const action = kind.value === 'forward'
          ? { id: 'forwarding_url', value: { url: target.value.trim(), status_code: Number(code.value) } }
          : { id: 'cache_level', value: level.value };
        if (kind.value === 'forward' && !/^https?:\/\//.test(target.value.trim())) {throw new Error('Forward to a full URL starting with https://');}
        const r = await cf('POST', `/zones/${z.id}/pagerules`, { targets: [{ target: 'url', constraint: { operator: 'matches', value: pattern.value.trim() } }], actions: [action], priority: 1, status: 'active' });
        rules.unshift(r.result); draw(); pattern.value = ''; toast('Page rule added');
      }, 'primary')))
  ];
}


async function rewriteTab(z) {
  const list = ruleList(z, 'urlrewrite', (r) => `${r.expression}  →  ${JSON.stringify(r.action_parameters && r.action_parameters.uri)}`);
  await list.load();
  const m = matchFields();
  const desc = input({ placeholder: 'Old blog path', 'aria-label': 'Description' });
  const np = input({ placeholder: '/new-path (optional)', 'aria-label': 'New path' });
  const nq = input({ placeholder: 'v=2 (optional)', 'aria-label': 'New query string' });
  return [
    card('URL rewrites', h('span', { class: 'small soft' }, 'Change the path or query string Cloudflare sends to your origin. Visitors still see the original URL.'), list.box),
    card('Add a rewrite', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' }, field('Rewrite path to', np), field('Rewrite query to', nq),
      btn('Add rewrite', async () => { await api('POST', `zones/${z.id}/rules/urlrewrite`, { ...m.values(), description: desc.value, newPath: np.value, newQuery: nq.value }); toast('Rewrite added'); m.clear(); np.value = ''; nq.value = ''; await list.load(); }, 'primary')))
  ];
}

function headerEditor(z, kind, ops, title, help) {
  return async () => {
    const list = ruleList(z, kind, (r) => `${r.expression}  ·  ${Object.entries((r.action_parameters && r.action_parameters.headers) || {}).map(([k, v]) => `${v.operation} ${k}${v.value ? `: ${v.value}` : ''}`).join(', ')}`);
    await list.load();
    const m = matchFields();
    const desc = input({ placeholder: 'Security headers', 'aria-label': 'Description' });
    const name = input({ placeholder: 'X-Frame-Options', 'aria-label': 'Header name' });
    const op = selectOf('Operation', ops.map((o) => [o, o]), 'set');
    const value = input({ placeholder: 'DENY', 'aria-label': 'Header value' });
    return [card(title, h('span', { class: 'small soft' }, help), list.box),
      card('Add a header edit', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' }, field('Header', name), field('Operation', op), field('Value', value),
        btn('Add', async () => { await api('POST', `zones/${z.id}/rules/${kind}`, { ...m.values(), description: desc.value, headers: [{ name: name.value, op: op.value, value: value.value }] }); toast('Header edit added'); m.clear(); name.value = ''; value.value = ''; await list.load(); }, 'primary')))];
  };
}

async function originTab(z) {
  const list = ruleList(z, 'origin', (r) => `${r.expression}  →  ${JSON.stringify(r.action_parameters)}`);
  await list.load();
  const m = matchFields();
  const desc = input({ placeholder: 'Send /api to the API server', 'aria-label': 'Description' });
  const host = input({ placeholder: 'origin.example.com', 'aria-label': 'Origin host' });
  const port = input({ placeholder: '443 (optional)', 'aria-label': 'Origin port' });
  const hh = input({ placeholder: 'Host header (optional)', 'aria-label': 'Host header' });
  return [
    card('Origin overrides', h('span', { class: 'small soft' }, 'Send matching requests to a different origin server, and optionally change the Host header.'), list.box),
    card('Add an override', field('Name', desc), h('div', { class: 'row end' }, m.nodes), h('div', { class: 'row end' }, field('Origin host', host), field('Port', port), field('Host header', hh),
      btn('Add override', async () => { await api('POST', `zones/${z.id}/rules/origin`, { ...m.values(), description: desc.value, originHost: host.value, originPort: port.value, hostHeader: hh.value }); toast('Override added'); m.clear(); host.value = ''; await list.load(); }, 'primary')))
  ];
}

const BUILDERS = { ratelimit: rateLimitTab, managed: managedTab, redirect: redirectTab, cache: cacheTab, rewrite: rewriteTab, headers: async (z) => [...await headerEditor(z, 'reqheaders', ['set', 'remove'], 'Request header edits', 'Change headers on requests before they reach your origin.')(), ...await headerEditor(z, 'respheaders', ['set', 'add', 'remove'], 'Response header edits', 'Change headers on responses before visitors receive them.')()], origin: originTab, pagerules: pageRulesTab };

export async function rulesView() {
  const z = zone();
  let tab = localStorage.getItem('zedge.rulesTab');
  if (!BUILDERS[tab]) {tab = 'ratelimit';}
  const body = h('div', { class: 'stack' });
  const show = async (t) => {
    localStorage.setItem('zedge.rulesTab', t);
    fill(body, h('div', { class: 'spin' }, 'Loading…'));
    try { fill(body, await BUILDERS[t](z)); } catch (e) { fill(body, card('', h('div', { class: 'err' }, e.message))); }
  };
  await show(tab);
  return h('div', { class: 'stack' },
    header('Rules', `Traffic rules for ${z.name}`),
    !can('rules.write') && h('div', { class: 'note' }, 'Your role is read-only here: you can look, but changes will be refused.'),
    segmented('Rule type', TABS, tab, (t) => show(t)),
    body);
}

void S;

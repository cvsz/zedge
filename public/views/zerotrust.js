import { groupsTab, serviceTokensTab, devicesTab } from './zt-extra.js';
import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, segmented, toggle, confirmAsk, selectOf, lines, fmtDate } from '../lib.js';
import { S, zone, header, statusKind, can } from '../ctx.js';

const TABS = [['tunnels', 'Tunnels'], ['access', 'Access'], ['groups', 'Access groups'], ['tokens', 'Service tokens'], ['devices', 'WARP profiles'], ['posture', 'Device posture'], ['gateway', 'Gateway']];
const noAcct = () => card('', empty('No Cloudflare account is available to this console.'));

// ------------------------------------------------------------------ tunnels
async function tunnelsTab(a) {
  const z = zone();
  const tunnels = (await cf('GET', `/accounts/${a}/cfd_tunnel?is_deleted=false`)).result || [];
  const hosts = new Map();
  await Promise.all(tunnels.map(async (t) => {
    try { const c = (await cf('GET', `/accounts/${a}/cfd_tunnel/${t.id}/configurations`)).result; hosts.set(t.id, ((c && c.config && c.config.ingress) || []).filter((i) => i.hostname)); } catch { hosts.set(t.id, []); }
  }));
  const sel = selectOf('Tunnel', tunnels.map((t) => [t.id, t.name]), '');
  const sub = input({ placeholder: 'grafana', 'aria-label': 'Subdomain' });
  const svc = input({ placeholder: 'http://localhost:3000', 'aria-label': 'Local service' });
  const publish = card('Publish a hostname', h('span', { class: 'small soft' }, z ? `Creates the tunnel route and a proxied CNAME in ${z.name}.` : 'Add a domain first.'),
    h('div', { class: 'row end' }, field('Tunnel', sel), field(`Subdomain${z ? ` (.${z.name})` : ''}`, sub), field('Local service', svc), btn('Publish', async () => {
      if (!z || !tunnels.length) {throw new Error('You need a domain and a tunnel first');}
      const r = await api('POST', `tunnels/${sel.value}/publish`, { zoneId: z.id, subdomain: sub.value, service: svc.value });
      toast(`${r.hostname} → ${r.service} (DNS ${r.dns})`); S.render();
    }, 'primary')));
  publish.classList.add('hero');
  return [publish, card('Tunnels', tunnels.length ? tunnels.map((t) => h('div', { class: 'li' }, h('div', { class: 'col' },
    h('div', { class: 'row' }, h('strong', { class: 'mono' }, t.name), badge(t.status, statusKind(t.status)), h('span', { class: 'xs mute' }, `${(t.connections || []).length} connection(s)`)),
    (hosts.get(t.id) || []).map((i) => h('div', { class: 'mono xs soft' }, `${i.hostname} → ${i.service}`))))) : empty('No tunnels yet. Create one with cloudflared or the deploy script.'))];
}

// ------------------------------------------------------------------ access
const includeLabel = (i) => {
  if (i.email) {return i.email.email;}
  if (i.email_domain) {return `@${i.email_domain.domain}`;}
  if (i.everyone) {return 'Everyone';}
  return Object.keys(i)[0] || 'rule';
};
/** Keep include entries we do not edit here (groups, IdPs, countries...) untouched. */
const rebuildInclude = (old, emails, domains) => [
  ...old.filter((i) => !i.email && !i.email_domain),
  ...emails.map((email) => ({ email: { email } })),
  ...domains.map((domain) => ({ email_domain: { domain: domain.replace(/^@/, '') } }))
];
const splitInclude = (list) => ({
  emails: list.filter((i) => i.email).map((i) => i.email.email),
  domains: list.filter((i) => i.email_domain).map((i) => i.email_domain.domain)
});
const policyBody = (p, over) => {
  const { id, uid, created_at, updated_at, reusable, ...rest } = p;
  void id; void uid; void created_at; void updated_at; void reusable;
  return { ...rest, ...over };
};

async function accessTab(a) {
  const apps = (await cf('GET', `/accounts/${a}/access/apps`)).result || [];
  const z = zone();
  const wrap = h('div', { class: 'stack' });

  const draw = async () => {
    const cards = await Promise.all(apps.map(async (app) => {
      let pols = [];
      try { pols = (await cf('GET', `/accounts/${a}/access/apps/${app.id}/policies`)).result || []; } catch { /* shown empty */ }
      const pBase = `/accounts/${a}/access/apps/${app.id}/policies`;
      const polRows = pols.map((p) => {
        const { emails, domains } = splitInclude(p.include || []);
        const other = (p.include || []).filter((i) => !i.email && !i.email_domain);
        const name = input({ value: p.name, 'aria-label': `Policy name for ${app.name}` });
        const dec = selectOf('Decision', [['allow', 'Allow'], ['deny', 'Block'], ['bypass', 'Bypass'], ['non_identity', 'Service auth']], p.decision);
        const em = h('textarea', { rows: '3', 'aria-label': 'Allowed emails' }, emails.join('\n'));
        const dm = h('textarea', { rows: '2', 'aria-label': 'Allowed email domains' }, domains.join('\n'));
        return h('details', { class: 'li block' }, h('summary', null, h('strong', null, p.name), ' ', badge(p.decision, p.decision === 'allow' ? 'ok' : p.decision === 'deny' ? 'bad' : 'warn'), ' ', h('span', { class: 'xs mute' }, (p.include || []).map(includeLabel).join(', '))),
          h('div', { class: 'col' },
            field('Name', name), field('Decision', dec), field('Emails (one per line)', em), field('Email domains (one per line, no @)', dm),
            other.length > 0 && h('div', { class: 'note' }, `${other.length} other include rule(s) (${other.map(includeLabel).join(', ')}) are kept as they are.`),
            h('div', { class: 'row' }, btn('Save policy', async () => {
              const e = lines(em.value); const d = lines(dm.value);
              if (dec.value === 'allow' && !e.length && !d.length && !other.length) {throw new Error('An allow policy needs at least one email or domain');}
              await cf('PUT', `${pBase}/${p.id}`, policyBody(p, { name: name.value.trim() || p.name, decision: dec.value, include: rebuildInclude(p.include || [], e, d) }));
              toast('Policy saved'); await redraw();
            }, 'primary'), btn('Delete policy', async () => {
              if (!confirmAsk(`Delete policy ${p.name}?`)) {return;}
              await cf('DELETE', `${pBase}/${p.id}`); toast('Policy deleted'); await redraw();
            }, 'danger'))));
      });
      const pn = input({ placeholder: 'Team members', 'aria-label': `New policy name for ${app.name}` });
      const pe = h('textarea', { rows: '2', placeholder: 'alice@example.com', 'aria-label': 'Emails for the new policy' });
      const pd = input({ placeholder: 'example.com', 'aria-label': 'Domain for the new policy' });
      return card(app.name, h('div', { class: 'row' }, h('span', { class: 'mono small' }, app.domain || ''), badge(app.session_duration || 'session', 'info'),
        btn('Delete app', async () => { if (!confirmAsk(`Delete the Access application ${app.name}? The hostname becomes public unless another control protects it.`)) {return;} await cf('DELETE', `/accounts/${a}/access/apps/${app.id}`); apps.splice(apps.indexOf(app), 1); await redraw(); toast('Application deleted'); }, 'danger')),
      polRows.length ? polRows : empty('No policies. Without a policy nobody can sign in.'),
        h('details', null, h('summary', { class: 'small' }, 'Add a policy'), h('div', { class: 'col' }, field('Name', pn), field('Emails (one per line)', pe), field('Email domain', pd),
          btn('Add allow policy', async () => {
            const e = lines(pe.value); const d = lines(pd.value);
            if (!pn.value.trim() || (!e.length && !d.length)) {throw new Error('Give the policy a name and at least one email or domain');}
            await cf('POST', pBase, { name: pn.value.trim(), decision: 'allow', include: rebuildInclude([], e, d), precedence: pols.length + 1 }); toast('Policy added'); await redraw();
          }, 'primary'))));
    }));
    fill(wrap, cards.length ? cards : card('Access applications', empty('No Access applications.')));
  };
  const redraw = draw;
  await draw();

  const dom = input({ placeholder: z ? `grafana.${z.name}` : 'app.example.com', 'aria-label': 'Hostname to protect' });
  const nm = input({ placeholder: 'Grafana', 'aria-label': 'Application name' });
  const em = h('textarea', { rows: '2', placeholder: 'you@example.com', 'aria-label': 'Emails allowed in' });
  const dur = selectOf('Session', [['1h', '1 hour'], ['8h', '8 hours'], ['24h', '24 hours'], ['168h', '7 days'], ['730h', '30 days']], '24h');
  const create = card('Protect a hostname', h('span', { class: 'small soft' }, 'Creates a self-hosted Access application and one allow policy.'),
    h('div', { class: 'row end' }, field('Hostname', dom), field('Application name', nm), field('Session length', dur)), field('Emails allowed in (one per line)', em),
    btn('Create application', async () => {
      const emails = lines(em.value);
      const domain = dom.value.trim();
      if (!domain || !emails.length) {throw new Error('Enter a hostname and at least one email');}
      const r = await cf('POST', `/accounts/${a}/access/apps`, { name: nm.value.trim() || domain, domain, type: 'self_hosted', session_duration: dur.value });
      await cf('POST', `/accounts/${a}/access/apps/${r.result.id}/policies`, { name: 'Allow listed emails', decision: 'allow', include: emails.map((email) => ({ email: { email } })), precedence: 1 });
      apps.push(r.result); dom.value = ''; nm.value = ''; em.value = ''; toast('Application protected'); await redraw();
    }, 'primary'));
  create.classList.add('hero');
  return [create, wrap];
}

// ------------------------------------------------------------------ device posture
const POSTURE = {
  firewall: { label: 'Firewall enabled', input: () => ({ enabled: true }) },
  disk_encryption: { label: 'Disk encryption on', input: () => ({ requireAll: true }) },
  os_version: { label: 'Minimum OS version', needsVersion: true, input: (os, version) => ({ operating_system: os, operator: '>=', version }) }
};

async function postureTab(a) {
  let rules = [];
  try { rules = (await cf('GET', `/accounts/${a}/devices/posture`)).result || []; } catch (e) { return card('Device posture', empty(`Not available: ${e.message}`)); }
  const box = h('div');
  const draw = () => fill(box, rules.length ? rules.map((r) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('strong', null, r.name), h('span', { class: 'xs mute' }, `${r.type}${r.description ? ` · ${r.description}` : ''}`)),
    btn('Delete', async () => { if (!confirmAsk(`Delete posture check ${r.name}?`)) {return;} await cf('DELETE', `/accounts/${a}/devices/posture/${r.id}`); rules = rules.filter((x) => x.id !== r.id); draw(); toast('Check deleted'); }, 'danger'))) : empty('No posture checks.'));
  draw();
  const type = selectOf('Check', Object.entries(POSTURE).map(([k, v]) => [k, v.label]), 'firewall');
  const name = input({ placeholder: 'Windows firewall on', 'aria-label': 'Check name' });
  const os = selectOf('Operating system', [['windows', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux']], 'windows');
  const ver = input({ placeholder: '10.0.19045 (for OS version)', 'aria-label': 'Minimum version' });
  return [card('Device posture checks', h('span', { class: 'small soft' }, 'Conditions a device must meet. Use them in Access and Gateway policies.'), box),
    card('Add a check', h('div', { class: 'row end' }, field('Check', type), field('Name', name), field('OS (firewall, encryption, version)', os), field('Version (OS version only)', ver),
      btn('Add check', async () => {
        const t = POSTURE[type.value];
        if (!name.value.trim()) {throw new Error('Give the check a name');}
        if (t.needsVersion && !ver.value.trim()) {throw new Error('Enter the minimum version');}
        const r = await cf('POST', `/accounts/${a}/devices/posture`, { name: name.value.trim(), type: type.value, match: [{ platform: os.value }], input: t.input(os.value, ver.value.trim()) });
        rules.push(r.result); name.value = ''; ver.value = ''; draw(); toast('Posture check added');
      }, 'primary')))];
}

// ------------------------------------------------------------------ gateway
const q = (s) => s.replace(/[\\"]/g, '');
async function gatewayTab(a) {
  let rules = [];
  try { rules = (await cf('GET', `/accounts/${a}/gateway/rules`)).result || []; } catch (e) { return card('Gateway', empty(`Not available: ${e.message}`)); }
  let cats = [];
  try { cats = (await cf('GET', `/accounts/${a}/gateway/categories`)).result || []; } catch { /* optional */ }
  const box = h('div');
  const body = (r, over) => { const { id, created_at, updated_at, deleted_at, version, sharable, read_only, source_account, ...rest } = r; void id; void created_at; void updated_at; void deleted_at; void version; void sharable; void read_only; void source_account; return { ...rest, ...over }; };
  const draw = () => fill(box, rules.length ? rules.map((r) => h('div', { class: 'li' },
    h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', null, r.name), badge(r.action, r.action === 'block' ? 'bad' : 'info')), h('span', { class: 'mono xs mute' }, `${(r.filters || []).join('+') || 'dns'} · ${r.traffic || ''}`)),
    h('div', { class: 'row' }, toggle(r.enabled !== false, `Enable ${r.name}`, async (on) => { await cf('PUT', `/accounts/${a}/gateway/rules/${r.id}`, body(r, { enabled: on })); r.enabled = on; }),
      btn('Delete', async () => { if (!confirmAsk(`Delete Gateway rule ${r.name}?`)) {return;} await cf('DELETE', `/accounts/${a}/gateway/rules/${r.id}`); rules = rules.filter((x) => x.id !== r.id); draw(); toast('Rule deleted'); }, 'danger')))) : empty('No Gateway rules.'));
  draw();
  const name = input({ placeholder: 'Block ad networks', 'aria-label': 'Rule name' });
  const type = selectOf('Applies to', [['dns', 'DNS queries'], ['http', 'Web traffic (HTTP)'], ['l4', 'Network (IP and port)']], 'dns');
  const domains = h('textarea', { rows: '3', placeholder: 'bad.example\nads.example', 'aria-label': 'Domains to match' });
  const ips = h('textarea', { rows: '3', placeholder: '203.0.113.0/24\n198.51.100.7', 'aria-label': 'Destination IPs' });
  const ports = input({ placeholder: '22 3389 (optional)', 'aria-label': 'Destination ports' });
  const catBox = cats.map((c) => ({ c, el: h('input', { type: 'checkbox' }) }));
  const ACTIONS = { dns: [['block', 'Block'], ['allow', 'Allow']], http: [['block', 'Block'], ['allow', 'Allow'], ['isolate', 'Open in Browser Isolation'], ['noscan', 'Skip scanning']], l4: [['block', 'Block'], ['allow', 'Allow']] };
  const action = selectOf('Action', ACTIONS.dns, 'block');
  const dnsFields = h('div', { class: 'stack' }, field('Domains (one per line)', domains),
    cats.length > 0 && h('details', null, h('summary', { class: 'small' }, `Content categories (${cats.length})`), h('div', { class: 'checks' }, catBox.map(({ c, el }) => h('label', { class: 'check' }, el, c.name)))));
  const netFields = h('div', { class: 'stack' }, field('Destination IPs or ranges (one per line)', ips), field('Destination ports', ports));
  const sync = () => {
    const t = type.value;
    action.replaceChildren(...ACTIONS[t].map(([v, l]) => h('option', { value: v }, l)));
    netFields.hidden = t !== 'l4';
    dnsFields.hidden = t === 'l4';
  };
  type.addEventListener('change', sync); sync();
  const expr = (t) => {
    const parts = [];
    if (t === 'l4') {
      const i = lines(ips.value).map(q); const pt = ports.value.split(/[\s,]+/).filter((x) => /^\d{1,5}$/.test(x));
      if (i.length) {parts.push(`net.dst.ip in {${i.join(' ')}}`);}
      if (pt.length) {parts.push(`net.dst.port in {${pt.join(' ')}}`);}
      return parts.join(' and ');
    }
    const d = lines(domains.value).map(q); const ids = catBox.filter((x) => x.el.checked).map((x) => x.c.id);
    if (t === 'http') { if (d.length) {parts.push(`any(http.request.domains[*] in {${d.map((x) => `"${x}"`).join(' ')}})`);} } else if (d.length) {parts.push(`any(dns.domains[*] in {${d.map((x) => `"${x}"`).join(' ')}})`);}
    if (ids.length) {parts.push(t === 'http' ? `any(http.request.uri.content_category[*] in {${ids.join(' ')}})` : `any(dns.content_category[*] in {${ids.join(' ')}})`);}
    return parts.join(' or ');
  };
  return [card('Gateway rules', h('span', { class: 'small soft' }, 'DNS, web and network policies. Rules run in precedence order, lowest number first.'), box),
    can('zerotrust.write') && card('Add a rule', h('span', { class: 'small soft' }, 'Web and network rules need Gateway HTTP/proxy features turned on in Zero Trust settings. Cloudflare will say if your plan or settings do not allow a rule.'),
      field('Name', name), field('Applies to', type), dnsFields, netFields,
      h('div', { class: 'row end' }, field('Action', action), btn('Add rule', async () => {
        const t = type.value; const traffic = expr(t);
        if (!name.value.trim() || !traffic) {throw new Error('Give the rule a name and something to match');}
        const r = await cf('POST', `/accounts/${a}/gateway/rules`, { name: name.value.trim(), action: action.value, enabled: true, filters: [t], traffic, description: 'Added from Zedge', precedence: 1000 + rules.length });
        rules.push(r.result); name.value = ''; domains.value = ''; ips.value = ''; ports.value = ''; catBox.forEach((x) => { x.el.checked = false; }); draw(); toast('Gateway rule added');
      }, 'primary')))];
}

export async function zeroTrustView() {
  const a = S.accountId;
  if (!a) {return noAcct();}
  let tab = localStorage.getItem('zedge.ztTab') || 'tunnels';
  if (!TABS.some(([k]) => k === tab)) {tab = 'tunnels';}
  const body = h('div', { class: 'stack' });
  const render = async (t) => {
    tab = t; try { localStorage.setItem('zedge.ztTab', t); } catch { /* ignore */ }
    fill(body, h('div', { class: 'spin' }, 'Loading…'));
    try { fill(body, await ({ tunnels: tunnelsTab, access: accessTab, groups: groupsTab, tokens: serviceTokensTab, devices: devicesTab, posture: postureTab, gateway: gatewayTab })[t](a)); } catch (e) { fill(body, card('', h('div', { class: 'err' }, e.message))); }
  };
  await render(tab);
  void fmtDate;
  return h('div', { class: 'stack' }, header('Zero Trust', 'Tunnels, Access, device posture and Gateway'),
    !can('zerotrust.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    segmented('Zero Trust section', TABS, tab, (v) => render(v)), body);
}

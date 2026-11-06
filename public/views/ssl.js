import { h, cf, toast, badge, btn, card, field, input, empty, toggle, confirmAsk, selectOf, lines, secretBox, fmtDate } from '../lib.js';
import { S, zone, can } from '../ctx.js';
import { tabbedView, item, noAccount, textarea } from './kit.js';

const needZone = () => card('', empty('Add a domain first.'));

async function certsTab() {
  const z = zone();
  if (!z) {return needZone();}
  const [packs, uni, aop, ca] = await Promise.allSettled([
    cf('GET', `/zones/${z.id}/ssl/certificate_packs`), cf('GET', `/zones/${z.id}/ssl/universal/settings`),
    cf('GET', `/zones/${z.id}/origin_tls_client_auth/settings`), cf('GET', `/certificates?zone_id=${z.id}`)
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value.result : null);
  const reload = () => location.reload();
  const hosts = textarea({ 'aria-label': 'Hostnames', placeholder: `${z.name}\n*.${z.name}`, value: `${z.name}\n*.${z.name}` });
  const validation = selectOf('Validation', [['txt', 'TXT record'], ['http', 'HTTP'], ['cname', 'CNAME']], 'txt');
  const days = selectOf('Valid for', [[90, '90 days'], [365, '1 year']], 90);
  const authority = selectOf('Authority', [['lets_encrypt', "Let's Encrypt"], ['google', 'Google'], ['ssl_com', 'SSL.com']], 'lets_encrypt');
  const caHosts = textarea({ 'aria-label': 'Origin CA hostnames', value: `${z.name}\n*.${z.name}` });
  const csr = textarea({ 'aria-label': 'Certificate signing request', placeholder: '-----BEGIN CERTIFICATE REQUEST-----\n…\n-----END CERTIFICATE REQUEST-----' });
  const validity = selectOf('Valid for', [[90, '90 days'], [365, '1 year'], [730, '2 years'], [1095, '3 years'], [5475, '15 years']], 5475);
  const issued = h('div');
  return [
    card('Universal SSL and origin authentication',
      uni.status === 'fulfilled' ? h('div', { class: 'li' }, h('span', null, 'Universal SSL certificate'), toggle(!!ok(uni).enabled, 'Universal SSL', async (on) => { await cf('PATCH', `/zones/${z.id}/ssl/universal/settings`, { enabled: on }); })) : h('div', { class: 'xs mute' }, `Universal SSL: ${uni.reason.message}`),
      aop.status === 'fulfilled' ? h('div', { class: 'li' }, h('div', { class: 'col' }, h('span', null, 'Authenticated origin pulls'), h('span', { class: 'xs mute' }, 'Your origin can then require Cloudflare’s client certificate.')),
        toggle(!!ok(aop).enabled, 'Authenticated origin pulls', async (on) => { await cf('PUT', `/zones/${z.id}/origin_tls_client_auth/settings`, { enabled: on }); })) : h('div', { class: 'xs mute' }, `Authenticated origin pulls: ${aop.reason.message}`)),
    card('Edge certificates', (ok(packs) || []).length ? ok(packs).map((p) => item(`${p.type} · ${(p.hosts || []).join(', ')}`, p.expires_on ? `expires ${fmtDate(p.expires_on)}` : null, badge(p.status, p.status === 'active' ? 'ok' : 'warn'),
      p.type !== 'universal' && can('ssl.write') && btn('Delete', async () => { if (!confirmAsk('Delete this certificate pack?')) {return;} await cf('DELETE', `/zones/${z.id}/ssl/certificate_packs/${p.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty(packs.status === 'rejected' ? packs.reason.message : 'None.'),
      can('ssl.write') && [h('strong', { class: 'small' }, 'Order an advanced certificate'), field('Hostnames (one per line)', hosts), h('div', { class: 'row end' }, field('Validation', validation), field('Valid for', days), field('Authority', authority),
        btn('Order', async () => { await cf('POST', `/zones/${z.id}/ssl/certificate_packs/order`, { type: 'advanced', hosts: lines(hosts.value), validation_method: validation.value, validity_days: Number(days.value), certificate_authority: authority.value }); toast('Certificate ordered'); reload(); }, 'primary'))]),
    card('Origin CA certificates', h('span', { class: 'small soft' }, 'Free certificates for the connection between Cloudflare and your server. Create the key and request yourself, e.g. openssl req -new -newkey rsa:2048 -nodes -keyout origin.key -out origin.csr. The private key never touches this console.'),
      ca.status === 'fulfilled' ? (ok(ca) || []).map((c) => item((c.hostnames || []).join(', ') || c.id, c.expires_on ? `expires ${fmtDate(c.expires_on)}` : null,
        can('ssl.write') && btn('Revoke', async () => { if (!confirmAsk('Revoke this certificate? Servers using it will stop being trusted by Cloudflare.')) {return;} await cf('DELETE', `/certificates/${c.id}`); toast('Revoked'); reload(); }, 'danger'))) : h('div', { class: 'xs mute' }, ca.reason.message),
      can('ssl.write') && [field('Hostnames', caHosts), field('Certificate signing request', csr), h('div', { class: 'row end' }, field('Valid for', validity), btn('Create certificate', async () => {
        const r = await cf('POST', '/certificates', { hostnames: lines(caHosts.value), requested_validity: Number(validity.value), request_type: 'origin-rsa', csr: csr.value.trim() });
        toast('Certificate created'); issued.replaceChildren(secretBox('Certificate (save it now, then paste into your server)', r.result.certificate));
      }, 'primary')), issued])
  ];
}

async function turnstileTab() {
  const a = S.accountId;
  const ws = (await cf('GET', `/accounts/${a}/challenges/widgets`)).result || [];
  const name = input({ placeholder: 'Login form', 'aria-label': 'Widget name' });
  const doms = textarea({ 'aria-label': 'Domains', placeholder: 'example.com' });
  const mode = selectOf('Mode', [['managed', 'Managed'], ['non-interactive', 'Non-interactive'], ['invisible', 'Invisible']], 'managed');
  const shown = h('div');
  return [
    card('Turnstile widgets', h('span', { class: 'small soft' }, 'A privacy-friendly CAPTCHA alternative. The site key goes in your page; the secret stays on your server.'),
      ws.length ? ws.map((w) => item(w.name, `site key ${w.sitekey} · ${(w.domains || []).join(', ')} · ${w.mode}`, can('security.write') && [
        btn('Rotate secret', async () => { if (!confirmAsk(`Rotate the secret for ${w.name}? The old one stops working.`)) {return;} const r = await cf('POST', `/accounts/${a}/challenges/widgets/${w.sitekey}/rotate_secret`, {}); shown.replaceChildren(secretBox(`New secret for ${w.name}`, r.result.secret)); }),
        btn('Delete', async () => { if (!confirmAsk(`Delete widget ${w.name}?`)) {return;} await cf('DELETE', `/accounts/${a}/challenges/widgets/${w.sitekey}`); toast('Deleted'); location.reload(); }, 'danger')])) : empty('No widgets.'), shown),
    can('security.write') && card('Create a widget', field('Name', name), field('Domains (one per line)', doms), h('div', { class: 'row end' }, field('Mode', mode), btn('Create widget', async () => {
      const r = await cf('POST', `/accounts/${a}/challenges/widgets`, { name: name.value.trim(), domains: lines(doms.value), mode: mode.value });
      toast('Widget created'); shown.replaceChildren(h('div', { class: 'stack' }, h('span', { class: 'mono small' }, `Site key: ${r.result.sitekey}`), secretBox('Secret key (shown once)', r.result.secret)));
    }, 'primary')))
  ];
}

async function botsTab() {
  const z = zone();
  if (!z) {return needZone();}
  const b = (await cf('GET', `/zones/${z.id}/bot_management`)).result || {};
  const flag = (key, label, help) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('span', null, label), h('span', { class: 'xs mute' }, help)),
    can('security.write') ? toggle(!!b[key], label, async (on) => { await cf('PUT', `/zones/${z.id}/bot_management`, { [key]: on }); }) : badge(b[key] ? 'on' : 'off'));
  return card('Bot management', h('span', { class: 'small soft' }, 'Which options exist depends on your Cloudflare plan. Options your plan does not support will be refused with an explanation.'),
    flag('fight_mode', 'Bot Fight Mode', 'Challenges requests that look automated.'), flag('enable_js', 'JavaScript detections', 'Lets Cloudflare run a small script to tell browsers from bots.'),
    b.using_latest_model !== undefined && h('div', { class: 'xs mute' }, `Latest detection model: ${b.using_latest_model ? 'yes' : 'no'}`));
}

async function logsTab() {
  const z = zone();
  if (!z) {return needZone();}
  const jobs = (await cf('GET', `/zones/${z.id}/logpush/jobs`)).result || [];
  const name = input({ placeholder: 'http-to-s3', 'aria-label': 'Job name' });
  const dataset = selectOf('Dataset', [['http_requests', 'HTTP requests'], ['firewall_events', 'Firewall events']], 'http_requests');
  const dest = input({ placeholder: 's3://bucket/path?region=auto&endpoint=…', 'aria-label': 'Destination' });
  const token = input({ placeholder: 'token from the challenge file', 'aria-label': 'Ownership token' });
  const challenge = h('div', { class: 'small soft' });
  return [
    card('Logpush jobs', jobs.length ? jobs.map((j) => item(j.name || `job ${j.id}`, `${j.dataset} → ${(j.destination_conf || '').replace(/\?.*$/, '')}`, j.last_error && badge('error', 'bad'),
      can('zone.write') && [toggle(!!j.enabled, `Enable ${j.name}`, async (on) => { await cf('PUT', `/zones/${z.id}/logpush/jobs/${j.id}`, { enabled: on }); }),
        btn('Delete', async () => { if (!confirmAsk(`Delete job ${j.name}?`)) {return;} await cf('DELETE', `/zones/${z.id}/logpush/jobs/${j.id}`); toast('Deleted'); location.reload(); }, 'danger')])) : empty('No jobs.')),
    can('zone.write') && card('Create a job', h('span', { class: 'small soft' }, 'Cloudflare may require destination ownership validation; if so it will say so. Credentials in the destination are not shown again after saving.'),
      h('div', { class: 'row end' }, field('Name', name), field('Dataset', dataset), field('Destination', dest)),
      h('div', { class: 'row end' }, btn('1. Get ownership challenge', async () => {
        const r = await cf('POST', `/zones/${z.id}/logpush/ownership`, { destination_conf: dest.value.trim() });
        challenge.textContent = `Cloudflare wrote a file named ${r.result.filename} to the destination. Open it, copy the token inside, and paste it below.`;
      }), field('2. Ownership token', token), btn('3. Create job', async () => {
        const body = { name: name.value.trim(), dataset: dataset.value, destination_conf: dest.value.trim(), enabled: true };
        if (token.value.trim()) {body.ownership_challenge = token.value.trim();}
        await cf('POST', `/zones/${z.id}/logpush/jobs`, body); toast('Job created'); location.reload();
      }, 'primary')), challenge)
  ];
}

export async function sslView() {
  return tabbedView({ title: 'SSL & Bots', sub: 'Certificates, Turnstile, bot management and log delivery', perm: 'ssl.write', key: 'zedge.sslTab',
    tabs: [['certs', 'Certificates'], ['turnstile', 'Turnstile'], ['bots', 'Bots'], ['logs', 'Logs']], builders: { certs: certsTab, turnstile: turnstileTab, bots: botsTab, logs: logsTab } });
}
void S;

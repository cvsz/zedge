import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, toggle, confirmAsk, selectOf } from '../lib.js';
import { S, zone, header, statusKind, can } from '../ctx.js';

const check = (label, ok, detail) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('strong', null, label), detail && h('span', { class: 'mono xs mute' }, detail)), badge(ok ? 'Found' : 'Missing', ok ? 'ok' : 'warn'));
const matcherText = (r) => (r.matchers || []).map((m) => (m.type === 'all' ? 'everything else' : m.value)).join(', ');
const actionText = (r) => (r.actions || []).map((a) => (a.type === 'forward' ? `forward to ${(a.value || []).join(', ')}` : a.type)).join(', ');

export async function emailView() {
  const z = zone();
  const a = S.accountId;
  const zp = `/zones/${z.id}/email/routing`;
  const [secR, stR, rulesR, catchR, addrR] = await Promise.allSettled([
    api('GET', `zones/${z.id}/email-security`), cf('GET', zp), cf('GET', `${zp}/rules`), cf('GET', `${zp}/rules/catch_all`), a ? cf('GET', `/accounts/${a}/email/routing/addresses`) : Promise.reject(new Error('No account'))
  ]);

  // ---- security checks + DMARC helper ----
  const secBox = h('div');
  const policy = selectOf('Policy', [['none', 'none: monitor only'], ['quarantine', 'quarantine: send to spam'], ['reject', 'reject: refuse delivery']], 'none');
  const pct = input({ placeholder: '100', 'aria-label': 'Percentage' });
  const rua = input({ placeholder: 'dmarc-reports@example.com', 'aria-label': 'Report address' });
  const drawSec = (s) => fill(secBox, check('SPF', s.spf.found, s.spf.record), check('DKIM', s.dkim.found, s.dkim.found ? s.dkim.selectors.join(', ') : 'No *._domainkey records found'),
    check('DMARC', s.dmarc.found, s.dmarc.found ? `${s.dmarc.record}` : 'Start with p=none and read the reports before tightening'));
  if (secR.status === 'fulfilled') {drawSec(secR.value);}
  const security = card('Email security', secR.status === 'rejected' ? empty(`Not available: ${secR.reason.message}`) : secBox,
    h('strong', null, 'DMARC helper'), h('span', { class: 'small soft' }, 'Creates or updates the _dmarc TXT record. Move from none to quarantine to reject as your reports come back clean.'),
    h('div', { class: 'row end' }, field('Policy', policy), field('Apply to % of mail', pct), field('Send reports to', rua),
      btn('Save DMARC record', async () => {
        const r = await api('POST', `zones/${z.id}/dmarc`, { policy: policy.value, pct: pct.value, rua: rua.value });
        toast(r.updated ? 'DMARC record updated' : 'DMARC record created'); drawSec(await api('GET', `zones/${z.id}/email-security`));
      }, 'primary')));

  // ---- routing status ----
  const enabled = stR.status === 'fulfilled' && stR.value.result && stR.value.result.enabled;
  const status = card('Email routing', stR.status === 'rejected' ? empty(`Not available: ${stR.reason.message}`) : h('div', { class: 'li' },
    h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', null, `Receiving mail for ${z.name}`), badge(enabled ? 'Enabled' : 'Off', enabled ? 'ok' : 'warn')), h('span', { class: 'xs mute' }, 'Enabling adds the MX and SPF records Cloudflare needs. Disabling removes them.')),
    btn(enabled ? 'Disable' : 'Enable email routing', async () => {
      if (enabled && !confirmAsk('Disable email routing? Incoming mail to these addresses will stop.')) {return;}
      await cf(enabled ? 'DELETE' : 'POST', `${zp}/dns`, enabled ? undefined : {}); toast(enabled ? 'Email routing disabled' : 'Email routing enabled'); S.render();
    }, enabled ? 'danger' : 'primary')));

  // ---- destination addresses ----
  let addrs = addrR.status === 'fulfilled' ? addrR.value.result || [] : [];
  const addrBox = h('div');
  const drawAddrs = () => fill(addrBox, addrs.length ? addrs.map((d) => h('div', { class: 'li' }, h('div', { class: 'row' }, h('span', { class: 'mono' }, d.email), badge(d.verified ? 'Verified' : 'Waiting for verification', d.verified ? 'ok' : 'warn')),
    btn('Remove', async () => { if (!confirmAsk(`Remove ${d.email}?`)) {return;} await cf('DELETE', `/accounts/${a}/email/routing/addresses/${d.id}`); addrs = addrs.filter((x) => x.id !== d.id); drawAddrs(); }, 'danger'))) : empty('No destination addresses yet.'));
  drawAddrs();
  const newAddr = input({ placeholder: 'me@gmail.com', 'aria-label': 'Destination email' });
  const addresses = card('Destination addresses', h('span', { class: 'small soft' }, 'Cloudflare emails a verification link to each new address before it can receive forwarded mail.'), addrBox,
    h('div', { class: 'row end' }, field('Add an address', newAddr), btn('Add', async () => {
      const r = await cf('POST', `/accounts/${a}/email/routing/addresses`, { email: newAddr.value.trim() }); addrs.push(r.result); newAddr.value = ''; drawAddrs(); toast('Verification email sent');
    }, 'primary')));

  // ---- rules ----
  let rules = rulesR.status === 'fulfilled' ? (rulesR.value.result || []).filter((r) => !(r.matchers || []).some((m) => m.type === 'all')) : [];
  const ruleBox = h('div');
  const drawRules = () => fill(ruleBox, rules.length ? rules.map((r) => h('div', { class: 'li' },
    h('div', { class: 'col' }, h('strong', { class: 'mono' }, matcherText(r)), h('span', { class: 'xs mute' }, actionText(r))),
    h('div', { class: 'row' },
      toggle(r.enabled !== false, `Enable ${matcherText(r)}`, async (on) => { await cf('PUT', `${zp}/rules/${r.id}`, { name: r.name, enabled: on, matchers: r.matchers, actions: r.actions, priority: r.priority }); r.enabled = on; }),
      btn('Delete', async () => { if (!confirmAsk(`Delete ${matcherText(r)}?`)) {return;} await cf('DELETE', `${zp}/rules/${r.id}`); rules = rules.filter((x) => x.id !== r.id); drawRules(); }, 'danger')))) : empty('No forwarding rules yet.'));
  drawRules();
  const alias = input({ placeholder: 'hello  (becomes hello@' + z.name + ')', 'aria-label': 'Address' });
  const dest = selectOf('Forward to', addrs.filter((d) => d.verified).map((d) => [d.email, d.email]), '');
  const routes = card('Forwarding rules', ruleBox, h('div', { class: 'row end' }, field('Receive at', alias), field('Forward to (verified addresses)', dest), btn('Add rule', async () => {
    const local = alias.value.trim().toLowerCase();
    if (!/^[a-z0-9._+-]{1,64}$/.test(local)) {throw new Error('Enter just the part before the @, such as hello');}
    if (!dest.value) {throw new Error('Add and verify a destination address first');}
    const address = `${local}@${z.name}`;
    const r = await cf('POST', `${zp}/rules`, { name: `Forward ${address}`, enabled: true, matchers: [{ type: 'literal', field: 'to', value: address }], actions: [{ type: 'forward', value: [dest.value] }] });
    rules.push(r.result); alias.value = ''; drawRules(); toast(`${address} now forwards`);
  }, 'primary')));

  // ---- catch-all ----
  const ca = catchR.status === 'fulfilled' ? catchR.value.result : null;
  const caMode = !ca || ca.enabled === false ? 'off' : (ca.actions && ca.actions[0] && ca.actions[0].type === 'forward') ? 'forward' : 'drop';
  const caMode_ = selectOf('Catch-all', [['off', 'Off'], ['drop', 'Drop silently'], ['forward', 'Forward to an address']], caMode);
  const caDest = selectOf('Forward to', addrs.filter((d) => d.verified).map((d) => [d.email, d.email]), ca && ca.actions && ca.actions[0] && ca.actions[0].value && ca.actions[0].value[0]);
  const catchAll = card('Catch-all', h('span', { class: 'small soft' }, 'What happens to mail sent to addresses that have no rule.'),
    h('div', { class: 'row end' }, field('Mode', caMode_), field('Forward to', caDest), btn('Save catch-all', async () => {
      const m = caMode_.value;
      if (m === 'forward' && !caDest.value) {throw new Error('Choose a verified destination');}
      const body = { name: 'Catch-all', enabled: m !== 'off', matchers: [{ type: 'all' }], actions: [m === 'forward' ? { type: 'forward', value: [caDest.value] } : { type: 'drop' }] };
      await cf('PUT', `${zp}/rules/catch_all`, body); toast('Catch-all saved');
    }, 'primary')));

  return h('div', { class: 'stack' }, header('Email', `Routing and sender security for ${z.name}`),
    !can('email.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    h('div', { class: 'grid2' }, h('div', { class: 'wide stack' }, security, routes, catchAll), h('div', { class: 'narrow stack' }, status, addresses)));
}

void statusKind;

import { h, cf, toast, badge, btn, card, field, input, empty, confirmAsk, selectOf, lines, secretBox } from '../lib.js';
import { can } from '../ctx.js';
import { item } from './kit.js';

export async function groupsTab(a) {
  const gs = (await cf('GET', `/accounts/${a}/access/groups`)).result || [];
  const name = input({ placeholder: 'Staff', 'aria-label': 'Group name' });
  const emails = h('textarea', { class: 'code', 'aria-label': 'Emails', placeholder: 'person@example.com\nanother@example.com' });
  const domain = input({ placeholder: 'example.com (optional)', 'aria-label': 'Email domain' });
  const summary = (g) => (g.include || []).map((r) => (r.email ? r.email.email : r.email_domain ? `@${r.email_domain.domain}` : Object.keys(r)[0])).join(', ');
  return [
    card('Access groups', h('span', { class: 'small soft' }, 'Reusable sets of people. Use them in Access policies.'), gs.length ? gs.map((g) => item(g.name, summary(g),
      can('zerotrust.write') && btn('Delete', async () => { if (!confirmAsk(`Delete group ${g.name}? Policies using it will stop matching.`)) return; await cf('DELETE', `/accounts/${a}/access/groups/${g.id}`); toast('Deleted'); location.reload(); }, 'danger'))) : empty('No groups.')),
    can('zerotrust.write') && card('Create a group', field('Name', name), field('Emails (one per line)', emails), field('Or everyone at a domain', domain), btn('Create group', async () => {
      const include = [...lines(emails.value).map((email) => ({ email: { email } })), ...(domain.value.trim() ? [{ email_domain: { domain: domain.value.trim().toLowerCase() } }] : [])];
      if (!include.length) throw new Error('Add at least one email or a domain');
      await cf('POST', `/accounts/${a}/access/groups`, { name: name.value.trim(), include }); toast('Group created'); location.reload();
    }, 'primary'))
  ];
}

export async function serviceTokensTab(a) {
  const ts = (await cf('GET', `/accounts/${a}/access/service_tokens`)).result || [];
  const name = input({ placeholder: 'ci-deploy', 'aria-label': 'Token name' });
  const dur = selectOf('Valid for', [['8760h', '1 year'], ['17520h', '2 years'], ['43800h', '5 years'], ['forever', 'No expiry']], '8760h');
  const shown = h('div');
  return [
    card('Service tokens', h('span', { class: 'small soft' }, 'Credentials for machines that must pass an Access policy. The secret is shown once.'), ts.length ? ts.map((t) => item(t.name, `${t.client_id}${t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ''}`,
      can('zerotrust.write') && [btn('Rotate', async () => { if (!confirmAsk(`Rotate ${t.name}? The old secret stops working.`)) return; const r = await cf('POST', `/accounts/${a}/access/service_tokens/${t.id}/rotate`, {}); shown.replaceChildren(secretBox(`New secret for ${t.name} (client id ${r.result.client_id})`, r.result.client_secret)); }),
        btn('Delete', async () => { if (!confirmAsk(`Delete ${t.name}?`)) return; await cf('DELETE', `/accounts/${a}/access/service_tokens/${t.id}`); toast('Deleted'); location.reload(); }, 'danger')])) : empty('No service tokens.'), shown),
    can('zerotrust.write') && card('Create a service token', h('div', { class: 'row end' }, field('Name', name), field('Valid for', dur), btn('Create token', async () => {
      const r = await cf('POST', `/accounts/${a}/access/service_tokens`, { name: name.value.trim(), duration: dur.value }); toast('Token created');
      shown.replaceChildren(h('div', { class: 'stack' }, h('span', { class: 'mono small' }, `Client ID: ${r.result.client_id}`), secretBox('Client secret (shown once)', r.result.client_secret)));
    }, 'primary')))
  ];
}

export async function devicesTab(a) {
  const ds = (await cf('GET', `/accounts/${a}/devices/policies`)).result || [];
  const name = input({ placeholder: 'Laptops', 'aria-label': 'Profile name' });
  const match = input({ placeholder: 'identity.email == "you@example.com"', 'aria-label': 'Match expression' });
  const prec = input({ value: '100', 'aria-label': 'Precedence' });
  return [
    card('WARP device profiles', h('span', { class: 'small soft' }, 'Settings applied to devices that match. Lower precedence numbers win.'), ds.length ? ds.map((d) => item(d.name || 'Default', d.match || 'everyone else', d.default && badge('default'), d.policy_id && can('zerotrust.write') &&
      btn('Delete', async () => { if (!confirmAsk(`Delete profile ${d.name}?`)) return; await cf('DELETE', `/accounts/${a}/devices/policy/${d.policy_id}`); toast('Deleted'); location.reload(); }, 'danger'))) : empty('No profiles.')),
    can('zerotrust.write') && card('Create a profile', h('div', { class: 'row end' }, field('Name', name), field('Matches', match), field('Precedence', prec), btn('Create profile', async () => {
      await cf('POST', `/accounts/${a}/devices/policy`, { name: name.value.trim(), match: match.value.trim(), precedence: Number(prec.value), enabled: true }); toast('Profile created'); location.reload();
    }, 'primary')))
  ];
}

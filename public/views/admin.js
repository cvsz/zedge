import { h, fill, api, toast, badge, btn, card, field, input, empty, confirmAsk, fmtDate, selectOf, secretBox } from '../lib.js';
import { S, header } from '../ctx.js';

function twoFactorCard(enabled) {
  const out = h('div', { class: 'stack' });
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': 'Code from your app', placeholder: '123456' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password to turn off two-factor' });
  const off = h('input', { type: 'text', 'aria-label': 'Code or recovery code to turn off two-factor', placeholder: '123456 or recovery code' });
  const start = async () => {
    const r = await api('POST', 'me/totp/setup');
    out.replaceChildren(h('span', { class: 'small soft' }, 'Open an authenticator app (Google Authenticator, 1Password, Authy…), choose “enter a setup key”, and type this key. Then enter the 6-digit code it shows.'),
      secretBox('Setup key', r.secret), h('div', { class: 'mono xs mute' }, r.uri),
      h('div', { class: 'row end' }, field('Code from your app', code), btn('Turn on', async () => {
        const e = await api('POST', 'me/totp/enable', { code: code.value });
        toast('Two-factor sign-in is on');
        out.replaceChildren(h('div', { class: 'note' }, 'Save these recovery codes somewhere safe. Each works once if you lose your phone. They are not shown again.'), secretBox('Recovery codes', e.recoveryCodes.join('   ')));
      }, 'primary')));
  };
  if (!enabled) return card('Two-factor sign-in', h('span', { class: 'small soft' }, 'Adds a code from your phone to your password. Strongly recommended for anyone who can change things.'), out, btn('Set up two-factor', start, 'primary'));
  return card('Two-factor sign-in', badge('on', 'ok'), h('span', { class: 'small soft' }, 'To turn it off, confirm with your password and a current code (or a recovery code).'),
    h('div', { class: 'row end' }, field('Password', pw), field('Code', off), btn('Turn off', async () => {
      await api('POST', 'me/totp/disable', { password: pw.value, code: off.value }); toast('Two-factor sign-in is off'); location.reload();
    }, 'danger')));
}

const RESOURCE_KINDS = [['workers', 'Workers (script names)'], ['buckets', 'R2 buckets (names)'], ['kv', 'KV namespaces (ids)'], ['d1', 'D1 databases (ids)'], ['pages', 'Pages projects (names)']];

function editZones(u, zones) {
  const old = document.getElementById('zone-editor');
  if (old) old.remove();
  const boxes = zones.map((z) => ({ z, el: h('input', { type: 'checkbox', checked: u.zones.includes(z.id) }) }));
  const res = RESOURCE_KINDS.map(([k, label]) => ({ k, label, el: h('textarea', { rows: '2', class: 'code', 'aria-label': label, placeholder: 'one per line; empty = all', value: (u.resources[k] || []).join('\n') }) }));
  const panel = h('div', { id: 'zone-editor', class: 'card stack', role: 'group', 'aria-label': `Limits for ${u.name}` },
    h('strong', null, `Limit what ${u.name} can reach`),
    h('span', { class: 'small soft' }, 'Leave everything empty for no limit. Domains hide the other domains and block zone-level actions on them. The resource lists do the same for account-level things, and a limited user cannot create new ones.'),
    h('strong', { class: 'small' }, 'Domains'),
    boxes.map(({ z, el }) => h('label', { class: 'perm' }, el, h('span', { class: 'mono small' }, z.name))),
    res.map(({ label, el }) => h('label', { class: 'f' }, label, el)),
    h('div', { class: 'row end' }, btn('Cancel', async () => panel.remove()), btn('Save limits', async () => {
      const resources = {};
      for (const { k, el } of res) { const list = el.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean); if (list.length) resources[k] = list; }
      await api('PATCH', `admin/users/${u.name}`, { zones: boxes.filter((x) => x.el.checked).map((x) => x.z.id), resources }); toast('Limits updated'); S.render();
    }, 'primary')));
  document.getElementById('view').prepend(panel);
}

export async function usersView() {
  const [{ users, roles }, perms] = await Promise.all([api('GET', 'admin/users'), api('GET', 'admin/permissions')]);
  const roleOpts = roles.map((r) => [r.name, r.name]);
  const refresh = () => S.render();

  const userRows = users.map((u) => {
    const mine = u.name === S.me.name;
    const role = selectOf(`Role for ${u.name}`, roleOpts, u.role);
    role.disabled = mine;
    const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'new password', 'aria-label': `New password for ${u.name}` });
    return h('div', { class: 'li' }, h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', { class: 'mono' }, u.name), mine && badge('you', 'info'), u.disabled && badge('disabled', 'bad'), u.totp && badge('2FA', 'ok'), u.sso && badge('SSO', 'info'), u.zones.length > 0 && badge(`${u.zones.length} domain${u.zones.length === 1 ? '' : 's'}`, 'warn'), Object.keys(u.resources || {}).length > 0 && badge('limited resources', 'warn')),
      h('span', { class: 'xs mute' }, `created ${fmtDate(u.createdAt)}`)),
    h('div', { class: 'row' }, role,
      btn('Set role', async () => { await api('PATCH', `admin/users/${u.name}`, { role: role.value }); toast('Role updated'); refresh(); }),
      !mine && btn(u.disabled ? 'Enable' : 'Disable', async () => { await api('PATCH', `admin/users/${u.name}`, { disabled: !u.disabled }); toast(u.disabled ? 'User enabled' : 'User disabled'); refresh(); }),
      btn('Limits…', () => editZones(u, S.zones)),
      u.totp && btn('Reset 2FA', async () => { if (!confirmAsk(`Turn off two-factor for ${u.name}? They will sign in with just a password until they set it up again.`)) return; await api('PATCH', `admin/users/${u.name}`, { resetTotp: true }); toast('Two-factor reset'); refresh(); }),
      !u.sso && pw, !u.sso && btn('Reset password', async () => { await api('PATCH', `admin/users/${u.name}`, { password: pw.value }); pw.value = ''; toast('Password changed'); }),
      !mine && btn('Delete', async () => { if (!confirmAsk(`Delete user ${u.name}?`)) return; await api('DELETE', `admin/users/${u.name}`); toast('User deleted'); refresh(); }, 'danger')));
  });

  const un = input({ placeholder: 'alice', 'aria-label': 'New username' });
  const up = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New user password' });
  const ur = selectOf('Role', roleOpts, 'operator');
  const addUser = card('Add a user', h('div', { class: 'row end' }, field('Username', un), field('Password (12+ characters)', up), field('Role', ur), btn('Create user', async () => {
    await api('POST', 'admin/users', { name: un.value, password: up.value, role: ur.value }); toast('User created'); refresh();
  }, 'primary')));

  const roleRows = roles.map((r) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', null, r.name), r.builtin && badge('built in')),
    h('span', { class: 'xs mute' }, r.permissions.includes('*') ? 'Everything' : r.permissions.join(', '))),
  !r.builtin && btn('Delete', async () => { if (!confirmAsk(`Delete role ${r.name}?`)) return; await api('DELETE', `admin/roles/${r.name}`); toast('Role deleted'); refresh(); }, 'danger')));

  const rn = input({ placeholder: 'dns-editor', 'aria-label': 'New role name' });
  const checks = Object.entries(perms).map(([k, desc]) => ({ k, el: h('input', { type: 'checkbox' }), desc }));
  const addRole = card('Create a role', h('span', { class: 'small soft' }, 'Pick exactly the actions the role may perform. Reading is a separate permission.'), field('Role name', rn),
    checks.map(({ k, el, desc }) => h('label', { class: 'perm' }, el, h('span', { class: 'col' }, h('strong', { class: 'mono small' }, k), h('span', { class: 'xs mute' }, desc)))),
    btn('Save role', async () => {
      const permissions = checks.filter((c) => c.el.checked).map((c) => c.k);
      if (!permissions.length) throw new Error('Pick at least one permission');
      await api('POST', 'admin/roles', { name: rn.value, permissions }); toast('Role saved'); refresh();
    }, 'primary'));

  return h('div', { class: 'stack' }, header('Users & Roles', 'Who can sign in, and what each role may do'), addUser, card('Users', userRows),
    h('div', { class: 'grid2' }, h('div', { class: 'wide stack' }, card('Roles', roleRows)), h('div', { class: 'narrow' }, addRole)));
}

export async function auditView() {
  const [r, v] = await Promise.all([api('GET', 'admin/audit?limit=200'), api('GET', 'admin/audit/verify')]);
  return h('div', { class: 'stack' }, header('Console audit log', 'Every change made through this console. Request bodies and secrets are never logged.',
      h('a', { class: 'btn', href: '/api/admin/audit/export', download: '' }, 'Export (JSONL)')),
    v.ok ? h('div', { class: 'note' }, `Integrity check passed: ${v.entries} entries are chained and unmodified.`) : h('div', { class: 'err' }, `Integrity check FAILED at entry ${v.brokenAt}: the log was edited or truncated after it was written.`),
    card('', r.entries.length ? r.entries.map((e) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('span', { class: 'mono small' }, `${e.method} ${e.path}${e.detail ? ` ${e.detail}` : ''}`), h('span', { class: 'xs mute' }, `${fmtDate(e.t)} · ${e.user} · ${e.ip || ''}`)), badge(String(e.status), e.status < 400 ? 'ok' : 'bad'))) : empty('Nothing recorded yet.')));
}

export async function accountView() {
  const totp = await api('GET', 'me/totp');
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New password' });
  const mine = S.me;
  return h('div', { class: 'stack' }, header('My account', `Signed in as ${mine.name} (${mine.role})`),
    card('Change password', h('div', { class: 'row end' }, field('Current password', cur), field('New password (12+ characters)', nw), btn('Change password', async () => {
      await api('POST', 'me/password', { current: cur.value, next: nw.value }); cur.value = ''; nw.value = ''; toast('Password changed');
    }, 'primary'))),
    twoFactorCard(totp.enabled),
    card('What your role allows', h('div', { class: 'mono small soft' }, mine.permissions.includes('*') ? 'Everything' : mine.permissions.join(', '))));
}

import { h, fill, api, toast, badge, btn, card, field, input, empty, confirmAsk, fmtDate, selectOf } from '../lib.js';
import { S, header } from '../ctx.js';

export async function usersView() {
  const [{ users, roles }, perms] = await Promise.all([api('GET', 'admin/users'), api('GET', 'admin/permissions')]);
  const roleOpts = roles.map((r) => [r.name, r.name]);
  const refresh = () => S.render();

  const userRows = users.map((u) => {
    const mine = u.name === S.me.name;
    const role = selectOf(`Role for ${u.name}`, roleOpts, u.role);
    role.disabled = mine;
    const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'new password', 'aria-label': `New password for ${u.name}` });
    return h('div', { class: 'li' }, h('div', { class: 'col' }, h('div', { class: 'row' }, h('strong', { class: 'mono' }, u.name), mine && badge('you', 'info'), u.disabled && badge('disabled', 'bad')),
      h('span', { class: 'xs mute' }, `created ${fmtDate(u.createdAt)}`)),
    h('div', { class: 'row' }, role,
      btn('Set role', async () => { await api('PATCH', `admin/users/${u.name}`, { role: role.value }); toast('Role updated'); refresh(); }),
      !mine && btn(u.disabled ? 'Enable' : 'Disable', async () => { await api('PATCH', `admin/users/${u.name}`, { disabled: !u.disabled }); toast(u.disabled ? 'User enabled' : 'User disabled'); refresh(); }),
      pw, btn('Reset password', async () => { await api('PATCH', `admin/users/${u.name}`, { password: pw.value }); pw.value = ''; toast('Password changed'); }),
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
  const r = await api('GET', 'admin/audit?limit=200');
  return h('div', { class: 'stack' }, header('Console audit log', 'Every change made through this console. Request bodies and secrets are never logged.'),
    card('', r.entries.length ? r.entries.map((e) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('span', { class: 'mono small' }, `${e.method} ${e.path}${e.detail ? ` ${e.detail}` : ''}`), h('span', { class: 'xs mute' }, `${fmtDate(e.t)} · ${e.user} · ${e.ip || ''}`)), badge(String(e.status), e.status < 400 ? 'ok' : 'bad'))) : empty('Nothing recorded yet.')));
}

export function accountView() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'New password' });
  const mine = S.me;
  return h('div', { class: 'stack' }, header('My account', `Signed in as ${mine.name} (${mine.role})`),
    card('Change password', h('div', { class: 'row end' }, field('Current password', cur), field('New password (12+ characters)', nw), btn('Change password', async () => {
      await api('POST', 'me/password', { current: cur.value, next: nw.value }); cur.value = ''; nw.value = ''; toast('Password changed');
    }, 'primary'))),
    card('What your role allows', h('div', { class: 'mono small soft' }, mine.permissions.includes('*') ? 'Everything' : mine.permissions.join(', '))));
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, PASSWORD } from './helpers.js';

let env, admin, z;
const PW2 = 'another long password';
before(async () => { env = await boot(); admin = env.client(); await admin.login(); z = env.mock.zoneId; });
after(async () => { await env.close(); });

async function userClient(name, role, extra = {}) {
  const r = await admin.json('POST', '/api/admin/users', { name, password: PW2, role, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = env.client();
  assert.equal((await c.login(name, PW2)).status, 200);
  return c;
}

test('the first admin is created from ZEDGE_ADMIN_PASSWORD and passwords are stored hashed', () => {
  const file = fs.readFileSync(path.join(env.dataDir, 'users.json'), 'utf8');
  assert.ok(!file.includes(PASSWORD), 'no plaintext password on disk');
  assert.match(JSON.parse(file).users.admin.hash, /^scrypt\$/);
  assert.equal((fs.statSync(path.join(env.dataDir, 'users.json')).mode & 0o777), 0o600);
});

test('viewer can read but not change anything or see tokens and admin pages', async () => {
  const v = await userClient('vera', 'viewer');
  assert.equal((await v.call('GET', `/api/cf/zones/${z}/dns_records`)).status, 200);
  assert.equal((await v.call('GET', `/api/analytics/${z}?range=7d`)).status, 200);
  assert.equal((await v.call('GET', `/api/zones/${z}/rules/ratelimit`)).status, 200);
  const w = await v.json('POST', `/api/zones/${z}/subdomains`, { name: 'x', target: '1.2.3.4' });
  assert.equal(w.status, 403);
  assert.match(w.body.error, /viewer.*dns\.write/);
  assert.equal((await v.call('PATCH', `/api/cf/zones/${z}/settings/ssl`, { value: 'full' })).status, 403);
  assert.equal((await v.call('POST', `/api/cf/zones/${z}/purge_cache`, { purge_everything: true })).status, 403);
  assert.equal((await v.call('GET', '/api/cf/user/tokens')).status, 403, 'tokens.read is separate');
  assert.equal((await v.call('GET', '/api/admin/users')).status, 403);
  assert.equal((await v.call('GET', '/api/admin/audit')).status, 403);
  assert.equal((await v.call('POST', '/api/workers/api-gateway/deploy', { code: 'x' })).status, 403);
  assert.equal((await v.call('POST', '/api/domains', { name: 'nope.dev' })).status, 403);
});

test('operator can manage DNS, zone and rules but not Workers, R2, Zero Trust, tokens or users', async () => {
  const o = await userClient('olga', 'operator');
  assert.equal((await o.call('POST', `/api/zones/${z}/subdomains`, { name: 'shop', target: '203.0.113.5' })).status, 201);
  assert.equal((await o.call('PATCH', `/api/cf/zones/${z}/settings/security_level`, { value: 'high' })).status, 200);
  assert.equal((await o.call('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 10, period: 60 })).status, 201);
  assert.equal((await o.call('POST', `/api/zones/${z}/rules/custom`, { expression: 'true', action: 'log' })).status, 201);
  assert.equal((await o.call('POST', `/api/zones/${z}/dmarc`, { policy: 'none' })).status, 201);
  assert.equal((await o.call('POST', '/api/workers/api-gateway/deploy', { code: 'x' })).status, 403);
  assert.equal((await o.call('POST', `/api/tunnels/${'b'.repeat(32)}/publish`, { zoneId: z, subdomain: 'a', service: 'http://localhost:1' })).status, 403);
  assert.equal((await o.call('POST', `/api/cf/accounts/${'a'.repeat(32)}/access/apps`, { name: 'x' })).status, 403);
  assert.equal((await o.call('POST', '/api/tokens/from-template', { template: 'dns', zoneId: z })).status, 403);
  assert.equal((await o.call('GET', '/api/admin/users')).status, 403);
});

test('custom roles grant exactly the chosen permissions, and changes apply immediately', async () => {
  assert.equal((await admin.call('POST', '/api/admin/roles', { name: 'deployer', permissions: ['read', 'workers.write'] })).status, 201);
  const d = await userClient('dave', 'deployer');
  assert.equal((await d.call('POST', '/api/workers/api-gateway/deploy', { code: 'export default {}' })).status, 201);
  assert.equal((await d.call('POST', `/api/zones/${z}/subdomains`, { name: 'y', target: '1.2.3.4' })).status, 403);
  assert.equal((await admin.call('PATCH', '/api/admin/users/dave', { role: 'viewer' })).status, 200);
  assert.equal((await d.call('POST', '/api/workers/api-gateway/deploy', { code: 'export default {}' })).status, 403, 'new role applies on the very next request');
  assert.equal((await admin.call('PATCH', '/api/admin/users/dave', { role: 'deployer' })).status, 200);
  assert.equal((await admin.call('DELETE', '/api/admin/roles/deployer')).status, 409, 'role still in use');
  assert.equal((await admin.call('DELETE', '/api/admin/roles/admin')).status, 400, 'built-ins are fixed');
  assert.equal((await admin.call('POST', '/api/admin/roles', { name: 'bad', permissions: ['read', 'launch.missiles'] })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/roles', { name: 'admin', permissions: ['read'] })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/users', { name: 'zed', password: PW2, role: 'ghost' })).status, 400);
});

test('user management rules: strong passwords, no duplicates, never lock out the last admin', async () => {
  assert.equal((await admin.call('POST', '/api/admin/users', { name: 'weak', password: 'short', role: 'viewer' })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/users', { name: 'vera', password: PW2, role: 'viewer' })).status, 409);
  assert.equal((await admin.call('POST', '/api/admin/users', { name: 'Bad Name!', password: PW2, role: 'viewer' })).status, 400);
  assert.equal((await admin.call('DELETE', '/api/admin/users/admin')).status, 400, 'cannot delete yourself');
  assert.equal((await admin.call('PATCH', '/api/admin/users/admin', { role: 'viewer' })).status, 400, 'cannot demote yourself');
  const second = await userClient('boss', 'admin');
  assert.equal((await second.call('PATCH', '/api/admin/users/admin', { disabled: true })).status, 200);
  assert.equal((await second.call('PATCH', '/api/admin/users/boss', { role: 'viewer' })).status, 400, 'self change refused');
  assert.equal((await admin.call('GET', '/api/meta')).status, 401, 'a disabled user loses their session at once');
  assert.equal((await env.client().login('admin', PASSWORD)).status, 401);
  assert.equal((await second.call('PATCH', '/api/admin/users/admin', { disabled: false })).status, 200);
  await admin.login();
  const lone = env.client(); await lone.login('boss', PW2);
  assert.equal((await admin.call('DELETE', '/api/admin/users/boss')).status, 200);
  assert.equal((await lone.call('GET', '/api/meta')).status, 401, 'deleted user is signed out');
});

test('users can change their own password; the old one stops working', async () => {
  const p = await userClient('pat', 'viewer');
  assert.equal((await p.call('POST', '/api/me/password', { current: 'wrong password!!', next: 'brand new password 1' })).status, 403);
  assert.equal((await p.call('POST', '/api/me/password', { current: PW2, next: 'short' })).status, 400);
  assert.equal((await p.call('POST', '/api/me/password', { current: PW2, next: 'brand new password 1' })).status, 200);
  assert.equal((await env.client().login('pat', PW2)).status, 401);
  assert.equal((await env.client().login('pat', 'brand new password 1')).status, 200);
});

test('console audit log records who changed what, never request bodies, and is admin-only', async () => {
  await admin.call('POST', `/api/zones/${z}/subdomains`, { name: 'audited', target: '203.0.113.77' });
  const { body } = await admin.json('GET', '/api/admin/audit?limit=200');
  const hit = body.entries.find((e) => e.path === `/api/zones/${z}/subdomains` && e.user === 'admin');
  assert.ok(hit, 'subdomain creation is logged');
  assert.equal(hit.method, 'POST');
  assert.equal(hit.status, 201);
  assert.ok(body.entries.some((e) => e.method === 'LOGIN' && e.status === 401), 'failed logins are logged');
  const text = JSON.stringify(body.entries);
  assert.ok(!text.includes(PW2) && !text.includes('203.0.113.77'), 'no passwords or request bodies in the log');
  assert.ok(body.entries.every((e) => e.method !== 'GET'), 'reads are not logged');
});

test('multi-account: switch with X-Account-Id, and zone lists follow the active account', async () => {
  const second = 'c'.repeat(32);
  const m = await boot({ mockOpts: { accounts: [{ id: 'a'.repeat(32), name: 'Main' }, { id: second, name: 'Client' }] } });
  try {
    m.mock.state.zones.push({ id: 'y'.repeat(32), name: 'client.example', status: 'active', name_servers: [], account: { id: second } });
    const c = m.client(); await c.login();
    const meta = (await c.json('GET', '/api/meta')).body;
    assert.deepEqual(meta.accounts.map((a) => a.name), ['Main', 'Client']);
    assert.equal(meta.accountId, 'a'.repeat(32), 'defaults to the first account');
    assert.deepEqual((await c.json('GET', '/api/cf/zones')).body.result.map((x) => x.name), ['zeaz.dev']);
    assert.deepEqual((await c.json('GET', '/api/cf/zones', undefined, { 'X-Account-Id': second })).body.result.map((x) => x.name), ['client.example']);
    assert.equal((await c.json('GET', '/api/meta', undefined, { 'X-Account-Id': second })).body.accountId, second);
    assert.equal((await c.call('GET', '/api/cf/zones', undefined, { 'X-Account-Id': 'd'.repeat(32) })).status, 403, 'unknown account refused');
    assert.equal((await c.call('GET', `/api/cf/accounts/${'d'.repeat(32)}/workers/scripts`)).status, 403, 'paths for other accounts refused');
    const added = await c.json('POST', '/api/domains', { name: 'new-client.dev' }, { 'X-Account-Id': second });
    assert.equal(added.body.zone.account.id, second, 'new domains land in the active account');
  } finally { await m.close(); }
});

test('CLOUDFLARE_ACCOUNT_IDS limits the console to chosen accounts, including zones in other accounts', async () => {
  const other = 'c'.repeat(32);
  const m = await boot({ env: { CLOUDFLARE_ACCOUNT_IDS: 'a'.repeat(32) }, mockOpts: { accounts: [{ id: 'a'.repeat(32), name: 'Main' }, { id: other, name: 'Other' }] } });
  try {
    m.mock.state.zones.push({ id: 'y'.repeat(32), name: 'other.example', status: 'active', name_servers: [], account: { id: other } });
    const c = m.client(); await c.login();
    assert.deepEqual((await c.json('GET', '/api/meta')).body.accounts.map((a) => a.id), ['a'.repeat(32)]);
    assert.equal((await c.call('GET', '/api/cf/zones', undefined, { 'X-Account-Id': other })).status, 403);
    assert.equal((await c.call('GET', `/api/cf/zones/${'y'.repeat(32)}/dns_records`)).status, 403, 'zone in another account');
    assert.equal((await c.call('POST', `/api/zones/${'y'.repeat(32)}/subdomains`, { name: 'x', target: '1.2.3.4' })).status, 403);
    assert.equal((await c.call('GET', `/api/cf/zones/${m.mock.zoneId}/dns_records`)).status, 200);
  } finally { await m.close(); }
});

test('no-auth mode acts as a full admin on loopback only', async () => {
  const m = await boot({ env: { ZEDGE_ADMIN_PASSWORD: '', ZEDGE_ALLOW_NO_AUTH: '1' } });
  const c = m.client();
  const s = (await c.json('GET', '/api/session')).body;
  assert.deepEqual([s.signedIn, s.noAuth, s.user.role], [true, true, 'admin']);
  assert.equal((await c.call('GET', '/api/admin/users')).status, 200);
  await m.close();
});

import { loadConfig } from '../server/config.js';
test('config: CLOUDFLARE_* names are read; legacy CF_* names still work with a warning; new names win', () => {
  const base = { ZEDGE_ADMIN_PASSWORD: 'correct horse battery', SESSION_SECRET: 's'.repeat(32), DATA_DIR: '/tmp/x' };
  assert.equal(loadConfig({ ...base, CLOUDFLARE_API_TOKEN: 'new', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }).token, 'new');
  const warn = console.warn; const seen = []; console.warn = (m) => seen.push(m);
  try {
    const c = loadConfig({ ...base, CF_API_TOKEN: 'old', CF_ACCOUNT_IDS: 'b'.repeat(32) });
    assert.equal(c.token, 'old'); assert.deepEqual(c.accountIds, ['b'.repeat(32)]);
    assert.match(seen.join(' '), /Deprecated.*CF_API_TOKEN.*CLOUDFLARE_API_TOKEN/);
    seen.length = 0; assert.equal(loadConfig({ ...base, CLOUDFLARE_API_TOKEN: 'new', CF_API_TOKEN: 'old' }).token, 'new'); assert.equal(seen.length, 0);
  } finally { console.warn = warn; }
  assert.throws(() => loadConfig({ ...base }), /CLOUDFLARE_API_TOKEN is required/);
});

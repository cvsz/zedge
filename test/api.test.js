import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { boot, PASSWORD } from './helpers.js';

let env, admin;
before(async () => { env = await boot(); admin = env.client(); });
after(async () => { await env.close(); });

test('config refuses to start without a password or with a weak one', () => {
  const DATA_DIR = '/nonexistent/zedge-test-dir';
  assert.throws(() => loadConfig({ CLOUDFLARE_API_TOKEN: 't', DATA_DIR }), /ZEDGE_ADMIN_PASSWORD/);
  assert.throws(() => loadConfig({ CLOUDFLARE_API_TOKEN: 't', DATA_DIR, ZEDGE_ADMIN_PASSWORD: 'short' }), /12 characters/);
  assert.throws(() => loadConfig({ DATA_DIR }), /CLOUDFLARE_API_TOKEN/);
  assert.doesNotThrow(() => loadConfig({ CLOUDFLARE_API_TOKEN: 't', DATA_DIR, ZEDGE_ALLOW_NO_AUTH: '1' }));
  assert.throws(() => loadConfig({ CLOUDFLARE_API_TOKEN: 't', DATA_DIR, ZEDGE_ALLOW_NO_AUTH: '1', HOST: '0.0.0.0' }), /ZEDGE_ADMIN_PASSWORD/);
});

test('API requires a session', async () => {
  assert.equal((await env.client().call('GET', '/api/meta')).status, 401);
});

test('wrong password is rejected, right password sets an HttpOnly cookie', async () => {
  const c = env.client();
  assert.equal((await c.login('admin', 'nope-nope-nope')).status, 401);
  assert.equal((await c.login('nobody', PASSWORD)).status, 401);
  const ok = await admin.login();
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
});

test('tampered session cookie is rejected', async () => {
  const c = env.client();
  c.cookie = admin.cookie.slice(0, -2) + 'xx';
  assert.equal((await c.call('GET', '/api/meta')).status, 401);
});

test('state-changing requests need the CSRF header', async () => {
  assert.equal((await admin.call('POST', '/api/domains', { name: 'csrf.dev' }, { 'X-Requested-With': '' })).status, 403);
});

test('meta verifies the token, finds the account and describes the user', async () => {
  const { body } = await admin.json('GET', '/api/meta');
  assert.equal(body.token.status, 'active');
  assert.equal(body.accountId, 'a'.repeat(32));
  assert.equal(body.me.name, 'admin');
  assert.deepEqual(body.me.permissions, ['*']);
});

test('proxy allows listed endpoints and blocks everything else', async () => {
  const ok = await admin.call('GET', `/api/cf/zones/${env.mock.zoneId}/dns_records?type=A`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).result.length, 3);
  assert.equal((await admin.call('DELETE', `/api/cf/zones/${env.mock.zoneId}`)).status, 403);
  assert.equal((await admin.call('GET', '/api/cf/user')).status, 403);
  assert.equal((await admin.call('GET', '/api/cf/zones/%2e%2e/user')).status, 403, 'encoded traversal never matches an ID pattern');
  assert.equal((await admin.call('POST', '/api/cf/zones', { name: 'x.dev' })).status, 403, 'zone creation only via /api/domains');
  assert.equal((await admin.call('POST', `/api/cf/zones/${env.mock.zoneId}/rulesets/${'r'.repeat(32)}/rules`, {})).status, 403, 'rule writes only via the validating endpoints');
});

test('add domain validates and creates a pending zone with nameservers', async () => {
  assert.equal((await admin.call('POST', '/api/domains', { name: 'not a domain' })).status, 400);
  const { status, body } = await admin.json('POST', '/api/domains', { name: 'https://Example.org/path' });
  assert.equal(status, 201);
  assert.equal(body.zone.name, 'example.org');
  assert.equal(body.zone.status, 'pending');
  const dup = await admin.json('POST', '/api/domains', { name: 'example.org' });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already exists/);
});

test('add subdomain picks A / AAAA / CNAME from the target and proxies by default', async () => {
  const z = env.mock.zoneId;
  const a = (await admin.json('POST', `/api/zones/${z}/subdomains`, { name: 'app', target: '203.0.113.50' })).body;
  assert.equal(a.record.type, 'A'); assert.equal(a.record.name, 'app.zeaz.dev'); assert.equal(a.record.proxied, true);
  const c = (await admin.json('POST', `/api/zones/${z}/subdomains`, { name: 'docs.zeaz.dev', target: 'site.pages.dev', proxied: false })).body;
  assert.equal(c.record.type, 'CNAME'); assert.equal(c.record.proxied, false);
  assert.equal((await admin.json('POST', `/api/zones/${z}/subdomains`, { name: 'v6', target: '2001:db8::1' })).body.record.type, 'AAAA');
  assert.equal((await admin.call('POST', `/api/zones/${z}/subdomains`, { name: 'bad name!', target: '1.2.3.4' })).status, 400);
  assert.equal((await admin.call('POST', `/api/zones/${z}/subdomains`, { name: 'x', target: 'not a target' })).status, 400);
});

test('bulk origin update previews, then updates only A records that differ', async () => {
  const z = env.mock.zoneId;
  assert.equal((await admin.call('POST', `/api/zones/${z}/bulk-origin`, { ip: '999.1.1.1' })).status, 400);
  const prev = (await admin.json('POST', `/api/zones/${z}/bulk-origin`, { ip: '203.0.113.99', dryRun: true, onlyProxied: true })).body;
  assert.ok(!prev.plan.some((p) => p.name === 'mail.zeaz.dev'));
  assert.ok(env.mock.state.records.filter((r) => r.type === 'A').every((r) => r.content !== '203.0.113.99'), 'dry run changes nothing');
  const done = (await admin.json('POST', `/api/zones/${z}/bulk-origin`, { ip: '203.0.113.99', onlyProxied: true })).body;
  assert.equal(done.failed.length, 0);
  assert.ok(done.updated.includes('api.zeaz.dev'));
  assert.equal(env.mock.state.records.find((r) => r.name === 'mail.zeaz.dev').content, '203.0.113.30');
});

test('publish hostname adds an ingress rule before the catch-all and a proxied CNAME', async () => {
  const tid = 'b'.repeat(32);
  const z = env.mock.zoneId;
  const r = await admin.json('POST', `/api/tunnels/${tid}/publish`, { zoneId: z, subdomain: 'grafana', service: 'http://localhost:3000' });
  assert.equal(r.status, 200);
  assert.equal(r.body.dns, 'created');
  assert.deepEqual(env.mock.state.tunnelConfigs[tid].config.ingress.map((x) => x.hostname || '(catch-all)'), ['old.zeaz.dev', 'grafana.zeaz.dev', '(catch-all)']);
  const cname = env.mock.state.records.find((x) => x.name === 'grafana.zeaz.dev');
  assert.equal(cname.content, `${tid}.cfargotunnel.com`);
  const again = (await admin.json('POST', `/api/tunnels/${tid}/publish`, { zoneId: z, subdomain: 'grafana', service: 'http://localhost:3001' })).body;
  assert.equal(again.dns, 'unchanged');
  assert.equal(env.mock.state.tunnelConfigs[tid].config.ingress.filter((x) => x.hostname === 'grafana.zeaz.dev').length, 1);
  assert.equal((await admin.call('POST', `/api/tunnels/${tid}/publish`, { zoneId: z, subdomain: 'x', service: 'javascript:alert(1)' })).status, 400);
});

test('token template builds least-privilege policies with an expiry and returns the value once', async () => {
  const z = env.mock.zoneId;
  const r = await admin.json('POST', '/api/tokens/from-template', { template: 'dns', zoneId: z, ttlDays: 30 });
  assert.equal(r.status, 201);
  const t = r.body.token;
  assert.equal(t.value, 'secret-token-value');
  assert.deepEqual(t.policies[0].permission_groups.map((g) => g.id).sort(), ['g1', 'g2']);
  assert.ok(t.policies[0].resources[`com.cloudflare.api.account.zone.${z}`]);
  assert.equal((await admin.call('POST', '/api/tokens/from-template', { template: 'dns' })).status, 400);
  assert.equal((await admin.call('POST', '/api/tokens/from-template', { template: 'workers', zoneId: z })).status, 422);
});

test('Cloudflare errors surface as readable messages', async () => {
  const r = await admin.json('POST', `/api/zones/${'f'.repeat(32)}/subdomains`, { name: 'x', target: '1.2.3.4' });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /Zone not found/);
});

test('login is rate limited after repeated failures', async () => {
  const c = env.client();
  let last;
  for (let i = 0; i < 7; i += 1) last = await c.login('admin', 'wrong-wrong-wrong');
  assert.equal(last.status, 429);
});

test('security headers are set', async () => {
  const r = await fetch(env.base + '/api/session');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

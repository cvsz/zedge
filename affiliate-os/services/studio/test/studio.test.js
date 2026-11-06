import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { setup } from '../../auth/test/helpers.js';
import { createStudio, createAccessVerifier } from '../src/index.js';

const ISS = 'https://team.cloudflareaccess.com', AUD = 'app-aud-tag';
let env, server, base, key; const now = Date.now();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const accessToken = (claims = {}, k = key) => { const h = b64({ alg: 'RS256', kid: k.kid }); const p = b64({ iss: ISS, aud: [AUD], sub: 's', email: 'x@example.com', exp: now / 1000 + 600, ...claims }); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), k.privateKey).toString('base64url')}`; };
const call = async (method, path, { token, body, headers = {} } = {}) => { const r = await fetch(base + path, { method, headers: { ...(token ? { 'cf-access-jwt-assertion': token } : {}), ...(body ? { 'content-type': 'application/json', 'x-studio': '1' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j, headers: r.headers }; };

before(async () => {
  env = await setup();
  key = (await import('../../auth/test/helpers.js')).newKey('ak');
  await env.auth.bootstrapOwner(env.orgA, { subject: 'owner-s', email: 'owner@example.com' });
  const owner = await env.login(env.orgA, 'owner-s', ['aff-owners']);
  await env.login(env.orgA, 'ed-s', ['aff-editors'], { email: 'ed@example.com' });
  await env.login(env.orgA, 'ap-s', ['aff-approvers'], { email: 'ap@example.com' });
  await env.scoped(env.orgA).tx((q) => env.repos.content.create(q, { language: 'en', format: 'text', caption: 'Hello board', disclosure: '#ad' }));
  const verify = createAccessVerifier({ issuer: ISS, audience: AUD, keys: async () => [key.jwk], now: () => now });
  const handler = createStudio({ db: env.db, auth: env.auth, access: verify, organizationId: env.orgA });
  server = http.createServer(handler); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; void owner;
});
after(async () => { server.close(); await env.close(); });

test('static shell is served with a strict CSP and no inline script/style', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'/);
  assert.doesNotMatch(r.json, /<script>|style=/);
  assert.equal((await call('GET', '/healthz')).status, 200);
});
test('API refuses: no token, bad signature, wrong audience, expired, unknown member, wrong issuer', async () => {
  assert.equal((await call('GET', '/api/me')).status, 403);
  const other = (await import('../../auth/test/helpers.js')).newKey('ak');          // same kid, different key
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'ed@example.com' }, other) })).status, 403);
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'ed@example.com', aud: ['nope'] }) })).status, 403);
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'ed@example.com', exp: now / 1000 - 3600 }) })).status, 403);
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'stranger@example.com' }) })).status, 403, 'valid Access identity but not a member: no auto-provisioning');
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'ed@example.com', iss: 'https://evil.example' }) })).status, 403);
});
test('member sees identity and the content board', async () => {
  const t = accessToken({ email: 'ED@example.com' });
  const me = await call('GET', '/api/me', { token: t });
  assert.equal(me.status, 200); assert.equal(me.json.role, 'editor');
  const cal = await call('GET', '/api/calendar', { token: t });
  assert.equal(cal.json.columns.IDEA.length, 1); assert.equal(cal.json.columns.IDEA[0].caption, 'Hello board');
});
test('approval inbox: requester cannot approve own request; a second person can; mutating calls need the JSON header and same origin', async () => {
  const ed = await env.login(env.orgA, 'ed-s', ['aff-editors']);
  const req = await env.auth.approvals.request(ed, { kind: 'publish', subject_type: 'content', subject_id: crypto.randomUUID(), summary: 'Publish hello', payload: { x: 1 } });
  const edT = accessToken({ email: 'ed@example.com' }), apT = accessToken({ email: 'ap@example.com' });
  const list = await call('GET', '/api/approvals', { token: apT });
  assert.equal(list.json.approvals.length, 1);
  assert.equal((await call('POST', `/api/approvals/${req.id}/decide`, { token: edT, body: { approve: true } })).status, 403, 'editor has no decide permission');
  assert.equal((await call('POST', `/api/approvals/${req.id}/decide`, { token: apT, body: { approve: 'yes' } })).status, 400);
  assert.equal((await call('POST', `/api/approvals/${req.id}/decide`, { token: apT, body: { approve: true }, headers: { origin: 'https://evil.example' } })).status, 403);
  const r = await fetch(`${base}/api/approvals/${req.id}/decide`, { method: 'POST', headers: { 'cf-access-jwt-assertion': apT, 'content-type': 'text/plain' }, body: '{"approve":true}' });
  assert.equal(r.status, 400, 'no custom header / wrong content type');
  const ok = await call('POST', `/api/approvals/${req.id}/decide`, { token: apT, body: { approve: true } });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'approved');
  assert.equal((await call('POST', `/api/approvals/${req.id}/decide`, { token: apT, body: { approve: true } })).status, 409, 'already decided');
});
test('a disabled member is locked out at once', async () => {
  await env.scoped(env.orgA).tx((q) => q.query("UPDATE users SET disabled = true WHERE email = 'ed@example.com'"));
  assert.equal((await call('GET', '/api/me', { token: accessToken({ email: 'ed@example.com' }) })).status, 403);
});

test('scheduling through the studio: needs publish.schedule, approved content, future time', async () => {
  const s = env.scoped(env.orgA);
  const c = await s.tx((q) => env.repos.content.create(q, { language: 'en', format: 'text', caption: 'Plan me', disclosure: '#ad', status: 'APPROVED' }));
  const idea = await s.tx((q) => env.repos.content.create(q, { language: 'en', format: 'text', caption: 'Just an idea', disclosure: '#ad' }));
  const apT = accessToken({ email: 'ap@example.com' }), ownT = accessToken({ email: 'owner@example.com' });
  const when = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await call('POST', `/api/content/${c.id}/schedule`, { token: apT, body: { when } })).status, 403, 'approver role has no publish.schedule');
  assert.equal((await call('POST', `/api/content/${idea.id}/schedule`, { token: ownT, body: { when } })).status, 409);
  assert.equal((await call('POST', `/api/content/${c.id}/schedule`, { token: ownT, body: { when: '2001-01-01' } })).status, 400);
  assert.equal((await call('POST', `/api/content/${c.id}/schedule`, { token: ownT, body: { when } })).status, 200);
  const cal = await call('GET', '/api/calendar', { token: ownT });
  assert.equal(cal.json.scheduled.length, 1); assert.equal(cal.json.columns.SCHEDULED.length, 1);
  assert.equal((await call('POST', `/api/content/${c.id}/unschedule`, { token: ownT, body: {} })).status, 200);
  assert.equal((await call('GET', '/api/calendar', { token: ownT })).json.scheduled.length, 0);
});

import { readConfig } from '../src/main.js';
import { createMetrics } from '../../../packages/observability/src/index.js';
test('/metrics needs the bearer token; counts requests without ids or identities', async () => {
  const metrics = createMetrics();
  const verify = createAccessVerifier({ issuer: ISS, audience: AUD, keys: async () => [key.jwk], now: () => now });
  const s2 = http.createServer(createStudio({ db: env.db, auth: env.auth, access: verify, organizationId: env.orgA, metrics, metricsToken: 'm'.repeat(24) }));
  await new Promise((r) => s2.listen(0, '127.0.0.1', r)); const b2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    assert.equal((await fetch(`${b2}/metrics`)).status, 401);
    assert.equal((await fetch(`${b2}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    await fetch(`${b2}/healthz`); await fetch(`${b2}/api/me`);
    const ok = await fetch(`${b2}/metrics`, { headers: { authorization: `Bearer ${'m'.repeat(24)}` } });
    assert.equal(ok.status, 200);
    const text = await ok.text();
    assert.match(text, /studio_requests_total\{route="health",status="200"\} 1/);
    assert.match(text, /studio_requests_total\{route="api",status="403"\} 1/);
    assert.doesNotMatch(text, /@|Bearer/);
  } finally { s2.close(); }
  const off = http.createServer(createStudio({ db: env.db, auth: env.auth, access: verify, organizationId: env.orgA }));
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  try { assert.equal((await fetch(`http://127.0.0.1:${off.address().port}/metrics`, { headers: { authorization: 'Bearer x' } })).status, 401, 'disabled unless configured'); } finally { off.close(); }
});
test('production config: required variables, secret length, issuer normalised', () => {
  const ok = { DATABASE_URL: 'postgres://x', ORGANIZATION_ID: 'o', SESSION_SECRET: 's'.repeat(32), ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/', ACCESS_AUD: 'aud' };
  assert.equal(readConfig(ok).issuer, 'https://team.cloudflareaccess.com');
  assert.throws(() => readConfig({ ...ok, ACCESS_AUD: '' }), /ACCESS_AUD/);
  assert.throws(() => readConfig({ ...ok, SESSION_SECRET: 'short' }), /32 characters/);
});

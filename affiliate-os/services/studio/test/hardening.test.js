import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { setup, newKey } from '../../auth/test/helpers.js';
import { createStudio, createAccessVerifier } from '../src/index.js';
import { createRateLimiter } from '../src/ratelimit.js';
import { createLogger, redactForLog } from '../../../packages/observability/src/index.js';

test('token bucket: allows a burst, refuses with Retry-After, refills over time, bounds memory', () => {
  let t = 0; const l = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => t, maxKeys: 5 });
  assert.deepEqual([l.take('a').ok, l.take('a').ok, l.take('a').ok], [true, true, true]);
  const r = l.take('a'); assert.equal(r.ok, false); assert.equal(r.retryAfter, 1);
  assert.equal(l.take('b').ok, true, 'keys are independent');
  t = 2000; assert.equal(l.take('a').ok, true); assert.equal(l.take('a').ok, true); assert.equal(l.take('a').ok, false);
  t = 120000; for (let i = 0; i < 20; i += 1) l.take(`k${i}`); assert.ok(l.size() <= 6, 'idle buckets are swept and the map stays bounded');
  assert.equal(l.take('x', 5).ok, false, 'a cost above capacity is never allowed');
});
test('logger redacts secrets, emails and bearer tokens, and child fields persist', () => {
  const lines = []; const log = createLogger({ service: 's', write: (x) => lines.push(JSON.parse(x)), now: () => new Date('2026-11-03T00:00:00Z') }).child({ request_id: 'r1' });
  log.info('login by ann@example.com', { password: 'hunter2', nested: { authorization: 'Bearer abc.def', note: 'mail bob@example.org' }, ok: 1 });
  log.debug('hidden at info level');
  assert.equal(lines.length, 1);
  const s = JSON.stringify(lines[0]);
  assert.doesNotMatch(s, /hunter2|abc\.def|ann@|bob@/);
  assert.equal(lines[0].request_id, 'r1'); assert.equal(lines[0].password, '[redacted]'); assert.equal(lines[0].ok, 1);
  assert.equal(redactForLog({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }).a.b.c.d.e.f.g, '[deep]');
});

let env, server, base, key; const ISS = 'https://t.cloudflareaccess.com', AUD = 'aud';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (email) => { const h = b64({ alg: 'RS256', kid: 'ak' }), p = b64({ iss: ISS, aud: [AUD], sub: email, email, exp: Date.now() / 1000 + 600 }); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url')}`; };
before(async () => {
  env = await setup(); key = newKey('ak');
  await env.auth.bootstrapOwner(env.orgA, { subject: 'o', email: 'owner@example.com' });
  const limiter = createRateLimiter({ capacity: 4, refillPerSecond: 0.001 });
  server = http.createServer(createStudio({ db: env.db, auth: env.auth, access: createAccessVerifier({ issuer: ISS, audience: AUD, keys: async () => [key.jwk] }), organizationId: env.orgA, limiter, securityContact: 'mailto:security@example.test' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await env.close(); });

test('readiness reflects the database; security.txt is served only when configured; security headers on every response', async () => {
  const r = await fetch(`${base}/readyz`); assert.equal(r.status, 200);
  const sec = await fetch(`${base}/.well-known/security.txt`); assert.match(await sec.text(), /^Contact: mailto:security@example.test/);
  for (const path of ['/', '/healthz', '/api/me', '/nope']) {
    const x = await fetch(base + path);
    assert.match(x.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(x.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(x.headers.get('cache-control'), 'no-store');
    assert.match(x.headers.get('referrer-policy'), /no-referrer/);
  }
});
test('API floods are refused with 429 and Retry-After, even without a valid token', async () => {
  const codes = []; let retry;
  for (let i = 0; i < 8; i += 1) { const r = await fetch(`${base}/api/me`, { headers: { 'cf-connecting-ip': '198.51.100.9' } }); codes.push(r.status); if (r.status === 429) retry = r.headers.get('retry-after'); }
  assert.deepEqual(codes.slice(0, 4), [403, 403, 403, 403]); assert.ok(codes.slice(4).every((c) => c === 429)); assert.ok(Number(retry) >= 1);
  const other = await fetch(`${base}/api/me`, { headers: { 'cf-connecting-ip': '198.51.100.10', 'cf-access-jwt-assertion': tok('owner@example.com') } });
  assert.equal(other.status, 200, 'another client is unaffected');
});

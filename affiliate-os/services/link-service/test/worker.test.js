import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, checkDestination, withUtm } from '../worker.js';
import { makeDb } from './d1-shim.mjs';

const TOKEN = 't'.repeat(40);
const mkEnv = (extra = {}) => ({ DB: makeDb(), ADMIN_TOKEN: TOKEN, ALLOWED_DESTINATION_HOSTS: 'shopee.co.th,example.com', DEFAULT_DISCLOSURE: 'Affiliate link: we may earn a commission.', ...extra });
let clock = Date.parse('2026-11-02T12:00:00Z');
const handler = createHandler({ now: () => clock });
const call = (env, method, path, { body, token = TOKEN, headers = {}, cf } = {}) => {
  const req = new Request(`https://go.example.com${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  const pending = [];
  return handler.fetch(req, env, { waitUntil: (p) => pending.push(p) }).then(async (res) => { await Promise.all(pending); return res; });
};
const create = (env, over = {}) => call(env, 'POST', '/api/links', { body: { slug: 'tiktok-ab12', destination: 'https://shopee.co.th/product/1', platform: 'tiktok', campaign_id: 'cmp1', creative_id: 'cr7', ...over } });

test('destination checks refuse anything that could become an open redirect or reach internal hosts', () => {
  const env = mkEnv();
  assert.equal(checkDestination('https://shopee.co.th/p/1', env).hostname, 'shopee.co.th');
  assert.equal(checkDestination('https://m.shopee.co.th/p/1', env).hostname, 'm.shopee.co.th', 'subdomains of an allowed host are fine');
  for (const bad of ['http://shopee.co.th/p', 'https://evil.example.org/p', 'https://shopee.co.th.evil.com/p', 'https://user:pw@shopee.co.th/p', 'https://localhost/p', 'https://127.0.0.1/p', 'https://10.0.0.5/p', 'https://192.168.1.1/p', 'https://169.254.169.254/latest', 'https://[::1]/p', 'https://intranet/p', 'javascript:alert(1)', 'not a url', 'https://shopee.co.th/' + 'a'.repeat(2100)]) {
    assert.throws(() => checkDestination(bad, env), Error, bad.slice(0, 40));
  }
  assert.throws(() => checkDestination('https://shopee.co.th/p', mkEnv({ ALLOWED_DESTINATION_HOSTS: '' })), /allowed list/, 'an empty list allows nothing');
});

test('UTM parameters are added without overwriting what the destination already carries', () => {
  const link = { platform: 'tiktok', campaign_id: 'c1', creative_id: 'v2' };
  const u = new URL(withUtm('https://shopee.co.th/p?aff_id=9&utm_source=partner', link));
  assert.equal(u.searchParams.get('utm_source'), 'partner', 'existing value kept');
  assert.equal(u.searchParams.get('aff_id'), '9');
  assert.equal(u.searchParams.get('utm_medium'), 'affiliate');
  assert.equal(u.searchParams.get('utm_campaign'), 'c1');
  assert.equal(u.searchParams.get('utm_content'), 'v2');
  assert.ok(!new URL(withUtm('https://shopee.co.th/p', { platform: 'other' })).searchParams.has('utm_campaign'), 'empty fields add nothing');
});

test('the admin API needs a strong bearer token', async () => {
  const env = mkEnv();
  assert.equal((await call(env, 'GET', '/api/links', { token: null })).status, 401);
  assert.equal((await call(env, 'GET', '/api/links', { token: 'wrong' })).status, 401);
  assert.equal((await call(env, 'GET', '/api/links', { token: TOKEN + 'x' })).status, 401);
  assert.equal((await call(env, 'GET', '/api/links')).status, 200);
  assert.equal((await call(mkEnv({ ADMIN_TOKEN: 'short' }), 'GET', '/api/links', { token: 'short' })).status, 401, 'a short or missing secret locks the API instead of opening it');
  assert.equal((await call(mkEnv({ ADMIN_TOKEN: undefined }), 'GET', '/api/links', { token: '' })).status, 401);
  assert.equal((await call(env, 'GET', '/healthz', { token: null })).status, 200);
});

test('create, validate, list and change links', async () => {
  const env = mkEnv();
  const r = await create(env);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { slug: 'tiktok-ab12', url: 'https://go.example.com/go/tiktok-ab12' });
  assert.equal((await create(env)).status, 409, 'slugs are unique');
  for (const [over, why] of [[{ slug: 'x' }, 'short slug'], [{ slug: 'bad slug!' }, 'bad characters'], [{ destination: 'https://evil.example.org/x' }, 'destination'], [{ platform: 'myspace' }, 'platform'], [{ campaign_id: 'has space' }, 'id chars'], [{ disclosure: '' }, 'disclosure'], [{ expires_at: 5 }, 'expiry']]) {
    assert.equal((await create(env, { slug: 'other-link', ...over })).status, 400, why);
  }
  const list = await (await call(env, 'GET', '/api/links')).json();
  assert.equal(list.links.length, 1);
  assert.equal(list.links[0].disclosure, 'Affiliate link: we may earn a commission.', 'a default disclosure is always set');
  assert.equal((await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: { enabled: false } })).status, 200);
  assert.equal((await (await call(env, 'GET', '/api/links/tiktok-ab12')).json()).enabled, 0);
  assert.equal((await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: {} })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: { destination: 'https://evil.example.org' } })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/links/nope-nope', { body: { enabled: true } })).status, 404);
  assert.equal((await call(env, 'DELETE', '/api/links/tiktok-ab12')).status, 404, 'links are disabled, never deleted');
  const bad = await handler.fetch(new Request('https://go.example.com/api/links', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: 'not json' }), env, {});
  assert.equal(bad.status, 400);
});

test('/go/{slug} redirects to the visible destination and records a click without personal data', async () => {
  const env = mkEnv();
  await create(env);
  const res = await call(env, 'GET', '/go/tiktok-ab12?p=youtube', { token: null, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)', 'X-Forwarded-For': '203.0.113.9', 'CF-Connecting-IP': '203.0.113.9' }, cf: { country: 'TH' } });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.hostname, 'shopee.co.th');
  assert.equal(loc.searchParams.get('utm_source'), 'tiktok');
  assert.equal(loc.searchParams.get('utm_campaign'), 'cmp1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const rows = env.DB.raw.prepare('SELECT * FROM clicks').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ slug: rows[0].slug, platform: rows[0].platform, country: rows[0].country, is_bot: rows[0].is_bot, day: rows[0].day }, { slug: 'tiktok-ab12', platform: 'youtube', country: 'TH', is_bot: 0, day: '2026-11-02' });
  const everything = JSON.stringify(rows);
  assert.ok(!everything.includes('203.0.113.9') && !everything.includes('iPhone') && !everything.includes('Mozilla'), 'no IP address or user agent is stored');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['country', 'day', 'id', 'is_bot', 'platform', 'slug', 'ts']);
  // an unknown ?p= falls back to the link's own platform
  await call(env, 'GET', '/go/tiktok-ab12?p=<script>', { token: null });
  assert.equal(env.DB.raw.prepare('SELECT platform FROM clicks ORDER BY id DESC LIMIT 1').get().platform, 'tiktok');
});

test('bots, previews and HEAD requests are handled honestly', async () => {
  const env = mkEnv();
  await create(env);
  await call(env, 'GET', '/go/tiktok-ab12', { token: null, headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  assert.equal(env.DB.raw.prepare('SELECT is_bot FROM clicks').get().is_bot, 1, 'flagged, still redirected');
  const head = await call(env, 'HEAD', '/go/tiktok-ab12', { token: null });
  assert.equal(head.status, 302);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM clicks').get().n, 1, 'HEAD is not a click');
  assert.equal((await call(env, 'POST', '/go/tiktok-ab12', { token: null })).status, 405);
});

test('/go/{slug}/info shows exactly where the link goes and the disclosure', async () => {
  const env = mkEnv();
  await create(env, { disclosure: 'Paid partnership: I earn a commission.' });
  const info = await (await call(env, 'GET', '/go/tiktok-ab12/info', { token: null })).json();
  assert.match(info.destination, /^https:\/\/shopee\.co\.th\/product\/1\?/);
  assert.equal(info.disclosure, 'Paid partnership: I earn a commission.');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM clicks').get().n, 0, 'looking is not clicking');
});

test('disabled, expired and unknown links never redirect', async () => {
  const env = mkEnv();
  await create(env);
  assert.equal((await call(env, 'GET', '/go/nope-nope', { token: null })).status, 404);
  assert.equal((await call(env, 'GET', '/go/a', { token: null })).status, 404, 'bad slug shape');
  await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: { expires_at: clock + 3600000 } });
  assert.equal((await call(env, 'GET', '/go/tiktok-ab12', { token: null })).status, 302);
  clock += 2 * 3600000;
  const gone = await call(env, 'GET', '/go/tiktok-ab12', { token: null });
  assert.equal(gone.status, 410);
  assert.ok(!gone.headers.get('location'));
  await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: { expires_at: null, enabled: false } });
  assert.equal((await call(env, 'GET', '/go/tiktok-ab12', { token: null })).status, 410);
  await call(env, 'PATCH', '/api/links/tiktok-ab12', { body: { enabled: true } });
  assert.equal((await call(env, 'GET', '/go/tiktok-ab12', { token: null })).status, 302, 'can be switched back on');
  // if the allowed list shrinks later, existing links stop redirecting
  const strict = { ...env, ALLOWED_DESTINATION_HOSTS: 'example.com' };
  assert.equal((await call(strict, 'GET', '/go/tiktok-ab12', { token: null })).status, 410);
});

test('stats count observed clicks by day, platform and country, separating bots', async () => {
  const env = mkEnv();
  await create(env);
  clock = Date.parse('2026-11-01T10:00:00Z');
  await call(env, 'GET', '/go/tiktok-ab12', { token: null, cf: { country: 'TH' } });
  clock = Date.parse('2026-11-02T10:00:00Z');
  await call(env, 'GET', '/go/tiktok-ab12', { token: null, cf: { country: 'TH' } });
  await call(env, 'GET', '/go/tiktok-ab12?p=facebook', { token: null, cf: { country: 'US' } });
  await call(env, 'GET', '/go/tiktok-ab12', { token: null, headers: { 'User-Agent': 'Googlebot' } });
  const s = await (await call(env, 'GET', '/api/links/tiktok-ab12/stats?days=7')).json();
  assert.equal(s.clicks, 4);
  assert.equal(s.human_clicks, 3);
  assert.deepEqual(s.by_day, [{ day: '2026-11-01', clicks: 1, human_clicks: 1 }, { day: '2026-11-02', clicks: 3, human_clicks: 2 }]);
  assert.deepEqual(s.by_platform, [{ platform: 'tiktok', clicks: 2 }, { platform: 'facebook', clicks: 1 }]);
  assert.deepEqual(s.by_country.map((c) => [c.country, c.clicks]).sort(), [['TH', 2], ['US', 1]]);
  const one = await (await call(env, 'GET', '/api/links/tiktok-ab12/stats?days=1')).json();
  assert.equal(one.clicks, 3, 'the window is respected');
  assert.match(s.note, /Conversions and commissions come from the affiliate provider/);
  assert.equal((await call(env, 'GET', '/api/links/tiktok-ab12/stats', { token: null })).status, 401);
});

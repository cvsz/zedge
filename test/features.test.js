import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

let env, admin, z;
before(async () => { env = await boot({ s3: true, env: { R2_MAX_UPLOAD_MB: '1' } }); admin = env.client(); await admin.login(); z = env.mock.zoneId; });
after(async () => { await env.close(); });
const J = (m, p, b, h) => admin.json(m, p, b, h);

// ------------------------------------------------------------------ rules engine
test('rate limit rules are shaped and validated server-side', async () => {
  const r = await J('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 100, period: 60, fromPath: '/api/', matchType: 'prefix', action: 'block', timeout: 600, description: 'API limit' });
  assert.equal(r.status, 201);
  const rule = env.mock.state.rulesets.http_ratelimit.rules[0];
  assert.equal(rule.expression, '(starts_with(http.request.uri.path, "/api/"))');
  assert.deepEqual(rule.ratelimit, { characteristics: ['cf.colo.id', 'ip.src'], period: 60, requests_per_period: 100, mitigation_timeout: 600 });
  assert.equal((await J('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 100, period: 7 })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 0, period: 60 })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 5, period: 60, fromPath: '/x" or true or "' })).status, 400, 'quote injection is refused');
  const chal = await J('POST', `/api/zones/${z}/rules/ratelimit`, { requests: 20, period: 10, action: 'managed_challenge' });
  assert.equal(chal.body.rules.at(-1).ratelimit.mitigation_timeout, 0, 'challenge actions carry no block duration');
  assert.equal(chal.body.rules.at(-1).expression, 'true', 'no match fields means every request');
});

test('managed rulesets can be deployed once, toggled and removed', async () => {
  const c = await J('POST', `/api/zones/${z}/rules/managed`, { ruleset: 'owasp' });
  assert.equal(c.status, 201);
  const rule = c.body.rules[0];
  assert.equal(rule.action, 'execute');
  assert.equal(rule.action_parameters.id, '4814384a9e5d4991b9815dcfc25d2f1f');
  assert.equal((await J('POST', `/api/zones/${z}/rules/managed`, { ruleset: 'owasp' })).status, 409);
  assert.equal((await J('POST', `/api/zones/${z}/rules/managed`, { ruleset: 'nope' })).status, 400);
  assert.equal((await J('PATCH', `/api/zones/${z}/rules/managed/${rule.id}`, { enabled: false })).status, 200);
  const stored = env.mock.state.rulesets.http_request_firewall_managed.rules[0];
  assert.equal(stored.enabled, false);
  assert.equal(stored.action, 'execute', 'toggling keeps the rest of the rule');
  assert.equal((await J('DELETE', `/api/zones/${z}/rules/managed/${rule.id}`)).status, 200);
  assert.equal(env.mock.state.rulesets.http_request_firewall_managed.rules.length, 0);
  assert.equal((await J('DELETE', `/api/zones/${z}/rules/managed/${'x'.repeat(32)}`)).status, 404);
});

test('redirect rules build the expression and validate the target', async () => {
  const r = await J('POST', `/api/zones/${z}/rules/redirect`, { fromHost: 'old.zeaz.dev', fromPath: '/blog', matchType: 'prefix', target: 'https://zeaz.dev/news', status: 308 });
  assert.equal(r.status, 201);
  const rule = env.mock.state.rulesets.http_request_dynamic_redirect.rules[0];
  assert.equal(rule.expression, '(http.host eq "old.zeaz.dev" and starts_with(http.request.uri.path, "/blog"))');
  assert.deepEqual(rule.action_parameters.from_value, { status_code: 308, target_url: { value: 'https://zeaz.dev/news' }, preserve_query_string: true });
  assert.equal((await J('POST', `/api/zones/${z}/rules/redirect`, { fromPath: '/a', target: 'javascript:alert(1)' })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/rules/redirect`, { fromPath: '/a', target: 'https://x.dev', status: 200 })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/rules/redirect`, { target: 'https://x.dev' })).status, 400, 'needs something to match');
  const custom = await J('POST', `/api/zones/${z}/rules/redirect`, { expression: '(http.host eq "a.dev")', target: 'https://b.dev' });
  assert.equal(custom.status, 201);
});

test('cache rules support TTL overrides and bypass', async () => {
  await J('POST', `/api/zones/${z}/rules/cache`, { fromPath: '/assets/', matchType: 'prefix', mode: 'ttl', edgeTtl: 86400, browserTtl: 3600 });
  await J('POST', `/api/zones/${z}/rules/cache`, { fromPath: '/admin', matchType: 'prefix', mode: 'bypass' });
  const rules = env.mock.state.rulesets.http_request_cache_settings.rules;
  assert.deepEqual(rules[0].action_parameters, { cache: true, edge_ttl: { mode: 'override_origin', default: 86400 }, browser_ttl: { mode: 'override_origin', default: 3600 } });
  assert.deepEqual(rules[1].action_parameters, { cache: false });
  assert.equal(rules[0].action, 'set_cache_settings');
  assert.equal((await J('POST', `/api/zones/${z}/rules/cache`, { fromPath: '/x', mode: 'ttl', edgeTtl: 5 })).status, 400);
});

test('WAF custom rules create the ruleset first, then append', async () => {
  assert.equal((await J('GET', `/api/zones/${z}/rules/custom`)).body.id, null);
  await J('POST', `/api/zones/${z}/rules/custom`, { expression: '(http.request.uri.path eq "/xmlrpc.php")', action: 'block', description: 'xmlrpc' });
  await J('POST', `/api/zones/${z}/rules/custom`, { expression: '(ip.src eq 198.51.100.7)', action: 'managed_challenge' });
  assert.equal(env.mock.state.rulesets.http_request_firewall_custom.rules.length, 2);
  assert.equal((await J('POST', `/api/zones/${z}/rules/custom`, { expression: '', action: 'block' })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/rules/custom`, { expression: 'true', action: 'skip' })).status, 400);
  assert.equal((await J('GET', `/api/zones/${z}/rules/bogus`)).status, 404);
});

test('page rules go through the allowlist', async () => {
  const body = { targets: [{ target: 'url', constraint: { operator: 'matches', value: '*zeaz.dev/old/*' } }], actions: [{ id: 'forwarding_url', value: { url: 'https://zeaz.dev/new/$1', status_code: 301 } }], priority: 1, status: 'active' };
  const c = await J('POST', `/api/cf/zones/${z}/pagerules`, body);
  assert.equal(c.status, 200);
  const id = c.body.result.id;
  assert.equal((await J('PATCH', `/api/cf/zones/${z}/pagerules/${id}`, { status: 'disabled' })).status, 200);
  assert.equal(env.mock.state.pagerules[0].status, 'disabled');
  assert.equal((await J('DELETE', `/api/cf/zones/${z}/pagerules/${id}`)).status, 200);
});

// ------------------------------------------------------------------ analytics
test('analytics queries GraphQL and returns series with totals', async () => {
  const d = await J('GET', `/api/analytics/${z}?range=7d`);
  assert.equal(d.status, 200);
  assert.equal(d.body.granularity, 'day');
  assert.equal(d.body.series.length, 2);
  assert.equal(d.body.totals.requests, 300);
  assert.equal(d.body.totals.cacheRatio, 0.9);
  const last = env.mock.state.graphql.at(-1);
  assert.match(last.query, /httpRequests1dGroups/);
  assert.equal(last.variables.zone, z);
  assert.match(last.variables.since, /^\d{4}-\d{2}-\d{2}$/);
  const h = await J('GET', `/api/analytics/${z}?range=24h`);
  assert.equal(h.body.granularity, 'hour');
  assert.match(env.mock.state.graphql.at(-1).query, /httpRequests1hGroups/);
  assert.equal((await J('GET', `/api/analytics/${z}?range=1y`)).status, 400);
});

// ------------------------------------------------------------------ workers
test('Worker deploy uploads a module, keeps bindings and records a version', async () => {
  const code = 'export default { fetch() { return new Response("hi"); } }';
  const r = await J('POST', '/api/workers/api-gateway/deploy', { code, compatibilityDate: '2026-02-01' });
  assert.equal(r.status, 201);
  const w = env.mock.state.workers['api-gateway'];
  assert.equal(w.code, code);
  assert.equal(w.meta.main_module, 'worker.js');
  assert.equal(w.meta.compatibility_date, '2026-02-01');
  assert.ok(w.meta.keep_bindings.includes('secret_text'), 'secrets survive a redeploy');
  assert.equal((await J('POST', '/api/workers/api-gateway/deploy', { code: '   ' })).status, 400);
  assert.equal((await J('POST', '/api/workers/api-gateway/deploy', { code, compatibilityDate: 'tomorrow' })).status, 400);
  assert.equal((await J('POST', '/api/workers/bad.name/deploy', { code })).status, 400);
  assert.equal((await J('POST', '/api/workers/api-gateway/deploy', { code: 'x'.repeat(1024 * 1024 + 1) })).status, 400);
});

test('Worker variables and secrets can be edited without losing each other', async () => {
  const n = '/api/workers/api-gateway';
  assert.equal((await J('PUT', `${n}/secrets/API_KEY`, { value: 'sk-123' })).status, 200);
  assert.equal(env.mock.state.workers['api-gateway'].secretValues.API_KEY, 'sk-123');
  assert.equal((await J('PUT', `${n}/vars/ORIGIN_URL`, { value: 'https://origin.zeaz.dev' })).status, 200);
  assert.equal((await J('PUT', `${n}/vars/MODE`, { value: 'prod' })).status, 200);
  assert.equal((await J('PUT', `${n}/vars/MODE`, { value: 'staging' })).status, 200);
  const detail = (await J('GET', n)).body;
  assert.deepEqual(detail.vars.map((v) => [v.name, v.value]).sort(), [['MODE', 'staging'], ['ORIGIN_URL', 'https://origin.zeaz.dev']]);
  assert.deepEqual(detail.secrets, ['API_KEY'], 'secret values are never returned');
  assert.ok(!JSON.stringify(detail).includes('sk-123'));
  assert.equal((await J('DELETE', `${n}/vars/MODE`)).status, 200);
  assert.equal((await J('DELETE', `${n}/vars/MODE`)).status, 404);
  assert.equal((await J('DELETE', `${n}/secrets/API_KEY`)).status, 200);
  assert.equal((await J('DELETE', `${n}/secrets/API_KEY`)).status, 404);
  assert.equal((await J('PUT', `${n}/vars/1bad`, { value: 'x' })).status, 400);
  assert.equal((await J('PUT', `${n}/secrets/OK`, { value: '' })).status, 400);
});

test('Worker rollback sends 100% of traffic to the chosen version', async () => {
  const n = '/api/workers/api-gateway';
  await J('POST', `${n}/deploy`, { code: 'export default { fetch() { return new Response("v2") } }' });
  const detail = (await J('GET', n)).body;
  assert.ok(detail.versions.length >= 2);
  assert.ok(detail.deployments.length >= 2);
  const first = detail.versions.find((v) => v.number === 1);
  const r = await J('POST', `${n}/rollback`, { versionId: first.id });
  assert.equal(r.status, 200);
  assert.deepEqual(env.mock.state.workers['api-gateway'].deployments[0].versions, [{ version_id: first.id, percentage: 100 }]);
  assert.equal((await J('POST', `${n}/rollback`, { versionId: 'nope' })).status, 400);
});

// ------------------------------------------------------------------ R2
test('R2 object browsing, upload, download and delete use signed S3 requests', async () => {
  assert.equal((await J('GET', '/api/r2/status')).body.objectAccess, true);
  const up = await admin.call('PUT', '/api/r2/zeaz-assets/object?key=photos%2Fa%26b.txt', Buffer.from('hello world'), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 201);
  await admin.call('PUT', '/api/r2/zeaz-assets/object?key=readme.md', Buffer.from('# hi'), { 'Content-Type': 'application/octet-stream' });
  assert.ok(env.s3.objects.has('zeaz-assets/photos/a&b.txt'));

  const root = (await J('GET', '/api/r2/zeaz-assets/objects')).body;
  assert.deepEqual(root.prefixes, ['photos/']);
  assert.deepEqual(root.objects.map((o) => o.key), ['readme.md']);
  const sub = (await J('GET', '/api/r2/zeaz-assets/objects?prefix=photos%2F')).body;
  assert.deepEqual(sub.objects.map((o) => [o.key, o.size]), [['photos/a&b.txt', 11]]);

  const dl = await admin.call('GET', '/api/r2/zeaz-assets/object?key=photos%2Fa%26b.txt');
  assert.equal(await dl.text(), 'hello world');
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''a%26b\.txt$/);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');

  assert.ok(env.s3.calls.length >= 4 && env.s3.calls.every((c) => /^AWS4-HMAC-SHA256 Credential=R2KEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*x-amz-content-sha256.*x-amz-date.*, Signature=[0-9a-f]{64}$/.test(c.auth)), 'every request is SigV4-signed');
  assert.equal((await admin.call('DELETE', '/api/r2/zeaz-assets/object?key=readme.md')).status, 200);
  assert.ok(!env.s3.objects.has('zeaz-assets/readme.md'));
  assert.equal((await admin.call('GET', '/api/r2/zeaz-assets/object?key=missing.txt')).status, 404);
});

test('R2 refuses bad input and oversized uploads', async () => {
  assert.equal((await admin.call('PUT', '/api/r2/zeaz-assets/object', Buffer.from('x'), { 'Content-Type': 'application/octet-stream' })).status, 400, 'key required');
  assert.equal((await admin.call('GET', '/api/r2/Bad_Bucket/objects')).status, 400);
  assert.equal((await admin.call('PUT', '/api/r2/zeaz-assets/object?key=big.bin', Buffer.alloc(1024 * 1024 + 10), { 'Content-Type': 'application/octet-stream' })).status, 413);
  assert.equal((await admin.call('PUT', '/api/r2/zeaz-assets/object?key=empty', Buffer.alloc(0), { 'Content-Type': 'application/octet-stream' })).status, 400);
});

test('R2 lifecycle and CORS rules round-trip through the allowlist', async () => {
  const b = '/api/cf/accounts/' + 'a'.repeat(32) + '/r2/buckets/zeaz-assets';
  const lifecycle = { rules: [{ id: 'expire-tmp', enabled: true, conditions: { prefix: 'tmp/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 604800 } } }] };
  assert.equal((await J('PUT', `${b}/lifecycle`, lifecycle)).status, 200);
  assert.deepEqual((await J('GET', `${b}/lifecycle`)).body.result, lifecycle);
  const cors = { rules: [{ allowed: { methods: ['GET'], origins: ['https://zeaz.dev'], headers: ['*'] }, maxAgeSeconds: 3600 }] };
  assert.equal((await J('PUT', `${b}/cors`, cors)).status, 200);
  assert.deepEqual((await J('GET', `${b}/cors`)).body.result, cors);
  assert.equal((await J('DELETE', `${b}/cors`)).status, 200);
  assert.deepEqual((await J('GET', `${b}/cors`)).body.result, { rules: [] });
});

test('object access without an R2 key explains what to set', async () => {
  const bare = await boot();
  const c = bare.client(); await c.login();
  const r = await c.json('GET', '/api/r2/zeaz-assets/objects');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /R2_ACCESS_KEY_ID/);
  await bare.close();
});

// ------------------------------------------------------------------ email
test('email security reads SPF/DKIM/DMARC and the DMARC helper creates then updates the record', async () => {
  const before = (await J('GET', `/api/zones/${z}/email-security`)).body;
  assert.equal(before.spf.found, true);
  assert.equal(before.dmarc.found, false);
  assert.equal(before.dkim.found, false);
  const c = await J('POST', `/api/zones/${z}/dmarc`, { policy: 'quarantine', pct: 50, rua: 'dmarc@zeaz.dev' });
  assert.equal(c.status, 201);
  assert.equal(c.body.content, 'v=DMARC1; p=quarantine; pct=50; rua=mailto:dmarc@zeaz.dev');
  const after = (await J('GET', `/api/zones/${z}/email-security`)).body;
  assert.deepEqual([after.dmarc.found, after.dmarc.policy], [true, 'quarantine']);
  const u = await J('POST', `/api/zones/${z}/dmarc`, { policy: 'reject' });
  assert.equal(u.status, 200);
  assert.equal(u.body.updated, true);
  assert.equal(env.mock.state.records.filter((r) => r.name === '_dmarc.zeaz.dev').length, 1);
  assert.equal((await J('POST', `/api/zones/${z}/dmarc`, { policy: 'maybe' })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/dmarc`, { policy: 'none', rua: 'not-an-email' })).status, 400);
  assert.equal((await J('POST', `/api/zones/${z}/dmarc`, { policy: 'none', pct: 500 })).status, 400);
});

test('email routing: enable, forwarding rule, catch-all and destination addresses', async () => {
  const zp = `/api/cf/zones/${z}/email/routing`;
  assert.equal((await J('GET', zp)).body.result.enabled, false);
  assert.equal((await J('POST', `${zp}/dns`, {})).status, 200);
  assert.equal((await J('GET', zp)).body.result.enabled, true);
  const addr = await J('POST', `/api/cf/accounts/${'a'.repeat(32)}/email/routing/addresses`, { email: 'me@example.net' });
  assert.equal(addr.status, 200);
  const rule = await J('POST', `${zp}/rules`, { name: 'hello', enabled: true, matchers: [{ type: 'literal', field: 'to', value: 'hello@zeaz.dev' }], actions: [{ type: 'forward', value: ['me@example.net'] }] });
  assert.equal(rule.status, 200);
  assert.equal((await J('PUT', `${zp}/rules/catch_all`, { enabled: true, matchers: [{ type: 'all' }], actions: [{ type: 'drop' }] })).status, 200);
  assert.equal((await J('DELETE', `${zp}/rules/${rule.body.result.id}`)).status, 200);
});

// ------------------------------------------------------------------ zero trust
test('Access apps, policies, device posture and Gateway rules can be created, edited and removed', async () => {
  const a = `/api/cf/accounts/${'a'.repeat(32)}`;
  const app = (await J('POST', `${a}/access/apps`, { name: 'Grafana', domain: 'grafana.zeaz.dev', type: 'self_hosted', session_duration: '24h' })).body.result;
  const pol = (await J('POST', `${a}/access/apps/${app.id}/policies`, { name: 'Team', decision: 'allow', include: [{ email_domain: { domain: 'zeaz.dev' } }] })).body.result;
  assert.equal((await J('PUT', `${a}/access/apps/${app.id}/policies/${pol.id}`, { name: 'Team', decision: 'allow', include: [{ email: { email: 'me@zeaz.dev' } }] })).status, 200);
  assert.deepEqual(env.mock.state.policies[app.id][0].include, [{ email: { email: 'me@zeaz.dev' } }]);
  assert.equal((await J('DELETE', `${a}/access/apps/${app.id}/policies/${pol.id}`)).status, 200);
  assert.equal((await J('DELETE', `${a}/access/apps/${app.id}`)).status, 200);

  const post = (await J('POST', `${a}/devices/posture`, { name: 'Disk encryption', type: 'disk_encryption', match: [{ platform: 'mac' }], input: { requireAll: true } })).body.result;
  assert.equal(env.mock.state.posture.length, 1);
  assert.equal((await J('DELETE', `${a}/devices/posture/${post.id}`)).status, 200);

  const g = (await J('POST', `${a}/gateway/rules`, { name: 'Block malware', action: 'block', filters: ['dns'], traffic: 'any(dns.content_category[*] in {1})', enabled: true })).body.result;
  assert.equal((await J('PUT', `${a}/gateway/rules/${g.id}`, { name: 'Block malware', action: 'block', filters: ['dns'], traffic: 'any(dns.content_category[*] in {1})', enabled: false })).status, 200);
  assert.equal(env.mock.state.gateway[0].enabled, false);
  assert.equal((await J('GET', `${a}/gateway/categories`)).body.result.length, 2);
  assert.equal((await J('DELETE', `${a}/gateway/rules/${g.id}`)).status, 200);
});

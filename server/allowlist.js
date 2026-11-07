/**
 * Only these Cloudflare endpoints are reachable through /api/cf/*, and each one
 * names the permission a user's role must hold. The first matching rule wins.
 * Anything else (account deletion, billing, members, ...) is refused.
 *
 * Rule-engine writes (WAF, rate limits, redirects, cache, managed rulesets),
 * Worker deploys and R2 object operations are NOT here: they go through the
 * dedicated, validating endpoints in server/routes/.
 */
const ID = '[A-Za-z0-9_-]{6,64}';
const BUCKET = '[a-z0-9][a-z0-9-]{1,61}[a-z0-9]';
const R = 'read';
const rule = (method, pattern, perm = R) => ({ method, re: new RegExp(`^${pattern}$`), perm });

export const ALLOWED = [
  // identity / tokens
  rule('GET', '/user/tokens/verify'),
  rule('GET', '/user/tokens', 'tokens.read'),
  rule('GET', '/user/tokens/permission_groups', 'tokens.read'),
  rule('DELETE', `/user/tokens/${ID}`, 'tokens.write'),
  rule('PUT', `/user/tokens/${ID}/value`, 'tokens.write'),
  rule('GET', `/accounts/${ID}/audit_logs`, 'audit.read'),

  // zones + DNS
  rule('GET', '/zones'),
  rule('GET', `/zones/${ID}`),
  rule('PUT', `/zones/${ID}/activation_check`, 'domains.write'),
  rule('GET', `/zones/${ID}/dns_records`),
  rule('POST', `/zones/${ID}/dns_records`, 'dns.write'),
  rule('PATCH', `/zones/${ID}/dns_records/${ID}`, 'dns.write'),
  rule('DELETE', `/zones/${ID}/dns_records/${ID}`, 'dns.write'),
  rule('GET', `/zones/${ID}/dnssec`),
  rule('PATCH', `/zones/${ID}/dnssec`, 'zone.write'),

  // zone settings + cache
  rule('GET', `/zones/${ID}/settings`),
  rule('PATCH', `/zones/${ID}/settings/security_level`, 'security.write'),
  rule('PATCH', `/zones/${ID}/settings/[a-z0-9_]{2,48}`, 'zone.write'),
  rule('POST', `/zones/${ID}/purge_cache`, 'zone.write'),

  // read-only views of rulesets (writes go through /api/zones/:zid/rules/:kind)
  rule('GET', `/zones/${ID}/rulesets/phases/[a-z_]{5,50}/entrypoint`),
  rule('GET', `/zones/${ID}/firewall/access_rules/rules`),
  rule('POST', `/zones/${ID}/firewall/access_rules/rules`, 'security.write'),
  rule('DELETE', `/zones/${ID}/firewall/access_rules/rules/${ID}`, 'security.write'),

  // legacy page rules
  rule('GET', `/zones/${ID}/pagerules`),
  rule('POST', `/zones/${ID}/pagerules`, 'rules.write'),
  rule('PATCH', `/zones/${ID}/pagerules/${ID}`, 'rules.write'),
  rule('DELETE', `/zones/${ID}/pagerules/${ID}`, 'rules.write'),

  // email routing
  rule('GET', `/zones/${ID}/email/routing`),
  rule('POST', `/zones/${ID}/email/routing/dns`, 'email.write'),
  rule('DELETE', `/zones/${ID}/email/routing/dns`, 'email.write'),
  rule('GET', `/zones/${ID}/email/routing/rules`),
  rule('POST', `/zones/${ID}/email/routing/rules`, 'email.write'),
  rule('PUT', `/zones/${ID}/email/routing/rules/${ID}`, 'email.write'),
  rule('DELETE', `/zones/${ID}/email/routing/rules/${ID}`, 'email.write'),
  rule('GET', `/zones/${ID}/email/routing/rules/catch_all`),
  rule('PUT', `/zones/${ID}/email/routing/rules/catch_all`, 'email.write'),
  rule('GET', `/accounts/${ID}/email/routing/addresses`),
  rule('POST', `/accounts/${ID}/email/routing/addresses`, 'email.write'),
  rule('DELETE', `/accounts/${ID}/email/routing/addresses/${ID}`, 'email.write'),

  // Workers / storage listings (deploys and R2 objects use dedicated routes)
  rule('GET', `/accounts/${ID}/workers/scripts`),
  rule('GET', `/accounts/${ID}/storage/kv/namespaces`),
  rule('GET', `/accounts/${ID}/d1/database`),
  rule('GET', `/accounts/${ID}/r2/buckets`),
  rule('POST', `/accounts/${ID}/r2/buckets`, 'r2.write'),
  rule('GET', `/accounts/${ID}/r2/buckets/${BUCKET}/lifecycle`),
  rule('PUT', `/accounts/${ID}/r2/buckets/${BUCKET}/lifecycle`, 'r2.write'),
  rule('GET', `/accounts/${ID}/r2/buckets/${BUCKET}/cors`),
  rule('PUT', `/accounts/${ID}/r2/buckets/${BUCKET}/cors`, 'r2.write'),
  rule('DELETE', `/accounts/${ID}/r2/buckets/${BUCKET}/cors`, 'r2.write'),

  // SSL / certificates
  rule('GET', `/zones/${ID}/ssl/certificate_packs`, 'ssl.write'),
  rule('POST', `/zones/${ID}/ssl/certificate_packs/order`, 'ssl.write'),
  rule('DELETE', `/zones/${ID}/ssl/certificate_packs/${ID}`, 'ssl.write'),
  rule('GET', `/zones/${ID}/ssl/universal/settings`, 'ssl.write'),
  rule('PATCH', `/zones/${ID}/ssl/universal/settings`, 'ssl.write'),
  rule('GET', `/zones/${ID}/origin_tls_client_auth/settings`, 'ssl.write'),
  rule('PUT', `/zones/${ID}/origin_tls_client_auth/settings`, 'ssl.write'),
  rule('GET', `/certificates`, 'ssl.write'),
  rule('POST', `/certificates`, 'ssl.write'),
  rule('DELETE', `/certificates/${ID}`, 'ssl.write'),

  // Turnstile
  rule('GET', `/accounts/${ID}/challenges/widgets`, 'security.write'),
  rule('POST', `/accounts/${ID}/challenges/widgets`, 'security.write'),
  rule('POST', `/accounts/${ID}/challenges/widgets/${ID}/rotate_secret`, 'security.write'),
  rule('DELETE', `/accounts/${ID}/challenges/widgets/${ID}`, 'security.write'),

  // Bot management
  rule('GET', `/zones/${ID}/bot_management`, 'security.write'),
  rule('PUT', `/zones/${ID}/bot_management`, 'security.write'),

  // Logpush
  rule('GET', `/zones/${ID}/logpush/jobs`, 'zone.write'),
  rule('POST', `/zones/${ID}/logpush/jobs`, 'zone.write'),
  rule('PUT', `/zones/${ID}/logpush/jobs/${ID}`, 'zone.write'),
  rule('DELETE', `/zones/${ID}/logpush/jobs/${ID}`, 'zone.write'),
  rule('POST', `/zones/${ID}/logpush/ownership`, 'zone.write'),

  // Workers routes, custom domains and cron schedules
  rule('GET', `/zones/${ID}/workers/routes`, 'workers.write'),
  rule('POST', `/zones/${ID}/workers/routes`, 'workers.write'),
  rule('DELETE', `/zones/${ID}/workers/routes/${ID}`, 'workers.write'),
  rule('GET', `/accounts/${ID}/workers/domains`, 'workers.write'),
  rule('PUT', `/accounts/${ID}/workers/domains`, 'workers.write'),
  rule('DELETE', `/accounts/${ID}/workers/domains/${ID}`, 'workers.write'),
  rule('GET', `/accounts/${ID}/workers/scripts/${ID}/schedules`, 'workers.write'),
  rule('PUT', `/accounts/${ID}/workers/scripts/${ID}/schedules`, 'workers.write'),

  // Snippets
  rule('GET', `/zones/${ID}/snippets`, 'workers.write'),
  rule('PUT', `/zones/${ID}/snippets/${ID}`, 'workers.write'),
  rule('DELETE', `/zones/${ID}/snippets/${ID}`, 'workers.write'),
  rule('GET', `/zones/${ID}/snippets/snippet_rules`, 'workers.write'),
  rule('PUT', `/zones/${ID}/snippets/snippet_rules`, 'workers.write'),

  // Zero Trust
  rule('GET', `/accounts/${ID}/cfd_tunnel`),
  rule('GET', `/accounts/${ID}/cfd_tunnel/${ID}/configurations`),
  rule('PUT', `/accounts/${ID}/cfd_tunnel/${ID}/configurations`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/access/apps`),
  rule('POST', `/accounts/${ID}/access/apps`, 'zerotrust.write'),
  rule('PUT', `/accounts/${ID}/access/apps/${ID}`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/access/apps/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/access/apps/${ID}/policies`),
  rule('POST', `/accounts/${ID}/access/apps/${ID}/policies`, 'zerotrust.write'),
  rule('PUT', `/accounts/${ID}/access/apps/${ID}/policies/${ID}`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/access/apps/${ID}/policies/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/access/groups`, 'zerotrust.write'),
  rule('POST', `/accounts/${ID}/access/groups`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/access/groups/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/access/service_tokens`, 'zerotrust.write'),
  rule('POST', `/accounts/${ID}/access/service_tokens`, 'zerotrust.write'),
  rule('POST', `/accounts/${ID}/access/service_tokens/${ID}/rotate`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/access/service_tokens/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/devices/posture`),
  rule('POST', `/accounts/${ID}/devices/posture`, 'zerotrust.write'),
  rule('PUT', `/accounts/${ID}/devices/posture/${ID}`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/devices/posture/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/devices/policies`, 'zerotrust.write'),
  rule('POST', `/accounts/${ID}/devices/policy`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/devices/policy/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/gateway/lists`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/gateway/rules`),
  rule('POST', `/accounts/${ID}/gateway/rules`, 'zerotrust.write'),
  rule('PUT', `/accounts/${ID}/gateway/rules/${ID}`, 'zerotrust.write'),
  rule('DELETE', `/accounts/${ID}/gateway/rules/${ID}`, 'zerotrust.write'),
  rule('GET', `/accounts/${ID}/gateway/categories`),

  // Load balancing
  rule('GET', `/zones/${ID}/load_balancers`, 'lb.write'),
  rule('POST', `/zones/${ID}/load_balancers`, 'lb.write'),
  rule('PATCH', `/zones/${ID}/load_balancers/${ID}`, 'lb.write'),
  rule('DELETE', `/zones/${ID}/load_balancers/${ID}`, 'lb.write'),
  rule('GET', `/accounts/${ID}/load_balancers/pools`, 'lb.write'),
  rule('POST', `/accounts/${ID}/load_balancers/pools`, 'lb.write'),
  rule('PATCH', `/accounts/${ID}/load_balancers/pools/${ID}`, 'lb.write'),
  rule('DELETE', `/accounts/${ID}/load_balancers/pools/${ID}`, 'lb.write'),
  rule('GET', `/accounts/${ID}/load_balancers/monitors`, 'lb.write'),
  rule('POST', `/accounts/${ID}/load_balancers/monitors`, 'lb.write'),
  rule('DELETE', `/accounts/${ID}/load_balancers/monitors/${ID}`, 'lb.write'),
  rule('GET', `/zones/${ID}/healthchecks`, 'lb.write'),
  rule('POST', `/zones/${ID}/healthchecks`, 'lb.write'),
  rule('DELETE', `/zones/${ID}/healthchecks/${ID}`, 'lb.write'),

  // Storage (KV, D1, queues, stream, images)
  rule('GET', `/accounts/${ID}/storage/kv/namespaces/${ID}/keys`, 'data.access'),
  rule('GET', `/accounts/${ID}/storage/kv/namespaces/${ID}/values/(.+)`, 'data.access'),
  rule('PUT', `/accounts/${ID}/storage/kv/namespaces/${ID}/values/(.+)`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/storage/kv/namespaces/${ID}/values/(.+)`, 'data.access'),
  rule('POST', `/accounts/${ID}/storage/kv/namespaces`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/storage/kv/namespaces/${ID}`, 'data.access'),
  rule('POST', `/accounts/${ID}/d1/database`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/d1/database/${ID}`, 'data.access'),
  rule('GET', `/accounts/${ID}/queues`, 'data.access'),
  rule('POST', `/accounts/${ID}/queues`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/queues/${ID}`, 'data.access'),
  rule('GET', `/accounts/${ID}/stream`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/stream/${ID}`, 'data.access'),
  rule('GET', `/accounts/${ID}/images/v1`, 'data.access'),
  rule('DELETE', `/accounts/${ID}/images/v1/(.+)`, 'data.access'),

  // Pages
  rule('GET', `/accounts/${ID}/pages/projects`, 'pages.write'),
  rule('POST', `/accounts/${ID}/pages/projects`, 'pages.write'),
  rule('GET', `/accounts/${ID}/pages/projects/${ID}`, 'pages.write'),
  rule('PATCH', `/accounts/${ID}/pages/projects/${ID}`, 'pages.write'),
  rule('GET', `/accounts/${ID}/pages/projects/${ID}/deployments`, 'pages.write'),
  rule('POST', `/accounts/${ID}/pages/projects/${ID}/deployments/(retry|rollback)`, 'pages.write'),
  rule('GET', `/accounts/${ID}/pages/projects/${ID}/domains`, 'pages.write'),
  rule('POST', `/accounts/${ID}/pages/projects/${ID}/domains`, 'pages.write'),
  rule('DELETE', `/accounts/${ID}/pages/projects/${ID}/domains/(.+)`, 'pages.write')
];

const QUERY_KEY = /^[a-z_.]{1,40}$/;

/** The permission needed for this call, or null when the endpoint is not allowed at all. */
export function permissionFor(method, path) {
  const hit = ALLOWED.find((r) => r.method === method && r.re.test(path));
  return hit ? hit.perm : null;
}
export const isAllowed = (method, path) => permissionFor(method, path) !== null;

/** Keep only plain, short query parameters. */
export function cleanQuery(q) {
  const out = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (QUERY_KEY.test(k) && typeof v === 'string' && v.length <= 200) {out[k] = v;}
  }
  return out;
}

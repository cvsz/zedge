import { HttpError, bad } from '../errors.js';
import { guardProxy } from '../limits.js';
import { permissionFor, cleanQuery } from '../allowlist.js';
import { can } from '../rbac.js';

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LABEL_RE = /^(\*|[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST_RE = /^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/;
const SERVICE_RE = /^(https?|ssh|tcp|rdp|smb):\/\/[^\s]{1,200}$/i;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Token templates: Cloudflare permission-group names grouped by scope. */
export const TOKEN_TEMPLATES = {
  dns: { label: 'DNS editor', zone: ['DNS Write', 'Zone Read'], account: [] },
  workers: { label: 'Workers deploy', zone: ['Workers Routes Write'], account: ['Workers Scripts Write', 'Workers KV Storage Write'] },
  r2: { label: 'R2 storage', zone: [], account: ['Workers R2 Storage Write'] },
  zt: { label: 'Zero Trust read-only', zone: [], account: ['Access: Apps and Policies Read', 'Cloudflare Tunnel Read'] }
};

export function registerCore(app, ctx) {
  const { cf, config, wrap, need, accountId, accounts, assertZone } = ctx;

  app.param('zid', (req, res, next, v) => {
    if (!ID_RE.test(v)) return next(bad('Invalid zone id'));
    return Promise.resolve(assertZone(v, req)).then(() => next(), next);
  });

  app.get('/api/meta', wrap(async (req, res) => {
    let token = null;
    try { token = (await cf.get('/user/tokens/verify')).result; } catch (e) { token = { status: 'error', message: e.message }; }
    let list = [];
    let active = null;
    let accountError = null;
    try { list = await accounts(); active = await accountId(req); } catch (e) { accountError = e.message; }
    res.json({
      token, accounts: list, accountId: active, accountError,
      me: { name: req.user.name, role: req.user.role, permissions: req.user.permissions },
      r2ObjectAccess: !!(config.r2.accessKeyId && config.r2.secretAccessKey)
    });
  }));

  // ---- allowlisted pass-through to Cloudflare ----
  app.all('/api/cf/*', wrap(async (req, res) => {
    const cfPath = req.path.slice('/api/cf'.length);
    const perm = permissionFor(req.method, cfPath);
    if (!perm) throw new HttpError(403, `Not permitted: ${req.method} ${cfPath}`);
    if (!can(req.user.permissions, perm)) throw new HttpError(403, `Your role (${req.user.role}) does not allow this (${perm})`);
    const am = cfPath.match(/^\/accounts\/([^/]+)/);
    if (am && !(await accounts()).some((a) => a.id === am[1])) throw new HttpError(403, 'That account is not available to this console');
    const zm = cfPath.match(/^\/zones\/([^/]+)/);
    if (zm) await assertZone(zm[1], req);
    if (cfPath.startsWith('/certificates')) {
      // Origin CA is a user-level API: list per zone, and only allow changes when the console is not restricted to specific accounts.
      if (req.method === 'GET') {
        if (!req.query.zone_id) throw bad('zone_id is required');
        await assertZone(String(req.query.zone_id), req);
      } else if (config.accountIds.length) throw new HttpError(403, 'Origin CA changes are disabled when CLOUDFLARE_ACCOUNT_IDS restricts this console');
    }
    if (req.body && typeof req.body.zone_id === 'string') await assertZone(req.body.zone_id, req); // e.g. Workers custom domains
    const trim = guardProxy(req.user, req.method, cfPath, req.body);
    const query = cleanQuery(req.query);
    if (req.method === 'GET' && cfPath === '/zones') query['account.id'] = await accountId(req);
    const r = await cf.raw(req.method, cfPath, { body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined, query });
    if (req.method === 'GET' && cfPath === '/zones' && req.user.zones.length && Array.isArray(r.result)) r.result = r.result.filter((z) => req.user.zones.includes(z.id));
    res.json(trim ? trim(r) : r);
  }));

  // ---- one-click: add domain ----
  app.post('/api/domains', need('domains.write'), wrap(async (req, res) => {
    if (req.user.zones.length) throw new HttpError(403, 'Your account is limited to specific domains and cannot add new ones');
    const name = String((req.body && req.body.name) || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!DOMAIN_RE.test(name)) throw bad('Enter a valid domain such as example.com');
    const r = await cf.post('/zones', { name, account: { id: await accountId(req) }, type: 'full' });
    res.status(201).json({ zone: r.result });
  }));

  // ---- one-click: add subdomain (A / AAAA / CNAME chosen from the target) ----
  app.post('/api/zones/:zid/subdomains', need('dns.write'), wrap(async (req, res) => {
    const zone = (await cf.get(`/zones/${req.params.zid}`)).result;
    let label = String((req.body && req.body.name) || '').trim().toLowerCase();
    if (label.endsWith(`.${zone.name}`)) label = label.slice(0, -zone.name.length - 1);
    if (!label || !LABEL_RE.test(label)) throw bad('Enter a valid subdomain such as app or api.v2');
    const target = String((req.body && req.body.target) || '').trim().toLowerCase().replace(/\.$/, '');
    let type;
    if (IPV4_RE.test(target)) type = 'A';
    else if (/^[0-9a-f:]+$/.test(target) && target.includes(':')) type = 'AAAA';
    else if (HOST_RE.test(target)) type = 'CNAME';
    else throw bad('Target must be an IPv4/IPv6 address or a hostname');
    const proxied = !(req.body && req.body.proxied === false);
    const r = await cf.post(`/zones/${zone.id}/dns_records`, { type, name: `${label}.${zone.name}`, content: target, proxied, ttl: 1 });
    res.status(201).json({ record: r.result, zone: zone.name });
  }));

  // ---- easy update: point every A record at a new origin IP ----
  app.post('/api/zones/:zid/bulk-origin', need('dns.write'), wrap(async (req, res) => {
    const ip = String((req.body && req.body.ip) || '').trim();
    if (!IPV4_RE.test(ip)) throw bad('Enter a valid IPv4 address');
    const records = (await cf.listAll(`/zones/${req.params.zid}/dns_records`, { type: 'A' }))
      .filter((r) => r.content !== ip && (!(req.body && req.body.onlyProxied) || r.proxied));
    const plan = records.map((r) => ({ id: r.id, name: r.name, from: r.content, to: ip }));
    if (req.body && req.body.dryRun) return res.json({ dryRun: true, plan });
    const updated = [];
    const failed = [];
    for (const r of records) {
      try { await cf.patch(`/zones/${req.params.zid}/dns_records/${r.id}`, { content: ip }); updated.push(r.name); } catch (e) { failed.push({ name: r.name, error: e.message }); }
    }
    return res.json({ dryRun: false, updated, failed });
  }));

  // ---- one-click: publish a hostname through a tunnel (ingress rule + proxied CNAME) ----
  app.post('/api/tunnels/:tid/publish', need('zerotrust.write'), wrap(async (req, res) => {
    if (!ID_RE.test(req.params.tid)) throw bad('Invalid tunnel id');
    const { zoneId } = req.body || {};
    if (!ID_RE.test(String(zoneId || ''))) throw bad('Choose a zone');
    await assertZone(zoneId, req);
    const service = String((req.body && req.body.service) || '').trim();
    if (!SERVICE_RE.test(service)) throw bad('Service must look like http://localhost:3000');
    const aid = await accountId(req);
    const zone = (await cf.get(`/zones/${zoneId}`)).result;
    let label = String((req.body && req.body.subdomain) || '').trim().toLowerCase();
    if (label.endsWith(`.${zone.name}`)) label = label.slice(0, -zone.name.length - 1);
    if (!label || !LABEL_RE.test(label) || label === '*') throw bad('Enter a valid subdomain');
    const hostname = `${label}.${zone.name}`;

    const cur = (await cf.get(`/accounts/${aid}/cfd_tunnel/${req.params.tid}/configurations`)).result;
    const config0 = (cur && cur.config) || {};
    const ingress = Array.isArray(config0.ingress) ? [...config0.ingress] : [];
    const existing = ingress.findIndex((r) => r.hostname === hostname);
    if (existing >= 0) ingress[existing] = { ...ingress[existing], service };
    else {
      const catchAll = ingress.findIndex((r) => !r.hostname);
      const rule = { hostname, service };
      if (catchAll >= 0) ingress.splice(catchAll, 0, rule); else ingress.push(rule, { service: 'http_status:404' });
    }
    if (!ingress.some((r) => !r.hostname)) ingress.push({ service: 'http_status:404' });
    await cf.put(`/accounts/${aid}/cfd_tunnel/${req.params.tid}/configurations`, { config: { ...config0, ingress } });

    const target = `${req.params.tid}.cfargotunnel.com`;
    const found = (await cf.get(`/zones/${zone.id}/dns_records`, { name: hostname })).result || [];
    let dns = 'unchanged';
    if (!found.length) {
      await cf.post(`/zones/${zone.id}/dns_records`, { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 });
      dns = 'created';
    } else if (found[0].type === 'CNAME' && found[0].content !== target) {
      await cf.patch(`/zones/${zone.id}/dns_records/${found[0].id}`, { content: target, proxied: true });
      dns = 'updated';
    }
    res.json({ hostname, service, dns });
  }));

  // ---- scoped API token from a template ----
  app.get('/api/tokens/templates', need('tokens.read'), (req, res) => res.json(Object.fromEntries(Object.entries(TOKEN_TEMPLATES).map(([k, v]) => [k, { label: v.label, needsZone: v.zone.length > 0, permissions: [...v.zone, ...v.account] }]))));

  app.post('/api/tokens/from-template', need('tokens.write'), wrap(async (req, res) => {
    const { template, zoneId, ttlDays } = req.body || {};
    const tpl = TOKEN_TEMPLATES[template];
    if (!tpl) throw bad('Unknown template');
    const days = [30, 90, 365].includes(Number(ttlDays)) ? Number(ttlDays) : 90;
    if (tpl.zone.length && !zoneId) throw bad('Choose a zone for this template');
    if (zoneId) { if (!ID_RE.test(String(zoneId))) throw bad('Invalid zone'); await assertZone(zoneId, req); }
    const aid = await accountId(req);
    const groups = (await cf.get('/user/tokens/permission_groups')).result || [];
    const byName = new Map(groups.map((g) => [g.name, g]));
    const missing = [...tpl.zone, ...tpl.account].filter((n) => !byName.has(n));
    if (missing.length) throw new HttpError(422, `Permission group(s) not found: ${missing.join(', ')}`);
    const policies = [];
    if (tpl.zone.length) policies.push({ effect: 'allow', resources: { [`com.cloudflare.api.account.zone.${zoneId}`]: '*' }, permission_groups: tpl.zone.map((n) => ({ id: byName.get(n).id })) });
    if (tpl.account.length) policies.push({ effect: 'allow', resources: { [`com.cloudflare.api.account.${aid}`]: '*' }, permission_groups: tpl.account.map((n) => ({ id: byName.get(n).id })) });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = String((req.body && req.body.name) || `${template}-${stamp}`).replace(/[^\w .-]/g, '').slice(0, 60) || `${template}-${stamp}`;
    const expires = new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const r = await cf.post('/user/tokens', { name, policies, expires_on: expires });
    res.status(201).json({ token: r.result });
  }));

}

import { CFError } from '../cf.js';
import { HttpError, bad } from '../errors.js';

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MANAGED = {
  cloudflare: { id: 'efb7b8c949ac4650a09736fc376e9aee', description: 'Cloudflare Managed Ruleset' },
  owasp: { id: '4814384a9e5d4991b9815dcfc25d2f1f', description: 'Cloudflare OWASP Core Ruleset' }
};

// ---- small validators --------------------------------------------------------
const text = (v) => String(v === undefined || v === null ? '' : v).trim();
function required(v, name, max = 4000) {
  const s = text(v);
  if (!s) {throw bad(`${name} is required`);}
  if (s.length > max) {throw bad(`${name} is too long`);}
  return s;
}
/** A literal that will sit inside a quoted string in a wirefilter expression. */
function literal(v, name) {
  const s = text(v);
  if (/["\\\r\n]/.test(s) || s.length > 500) {throw bad(`${name} contains characters that are not allowed`);}
  return s;
}
function oneOf(v, allowed, name) {
  if (!allowed.includes(v)) {throw bad(`${name} must be one of: ${allowed.join(', ')}`);}
  return v;
}
function intIn(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {throw bad(`${name} must be a whole number from ${min} to ${max}`);}
  return n;
}
function absoluteUrl(v, name) {
  const s = text(v);
  let u;
  try { u = new URL(s); } catch { throw bad(`${name} must be a full URL such as https://example.com/new`); }
  if (!['http:', 'https:'].includes(u.protocol)) {throw bad(`${name} must start with http:// or https://`);}
  return s;
}

/** Build an expression from simple fields, or pass a custom one through. */
export function matchExpression(b, { allowAll = false } = {}) {
  if (text(b.expression)) {return required(b.expression, 'Expression');}
  const parts = [];
  if (text(b.fromHost)) {parts.push(`http.host eq "${literal(b.fromHost, 'Host')}"`);}
  if (text(b.fromPath)) {
    const p = literal(b.fromPath, 'Path');
    parts.push(b.matchType === 'prefix' ? `starts_with(http.request.uri.path, "${p}")` : `http.request.uri.path eq "${p}"`);
  }
  if (!parts.length) {
    if (allowAll) {return 'true';}
    throw bad('Enter a host, a path or a custom expression');
  }
  return `(${parts.join(' and ')})`;
}

// ---- one shaper per rule kind: user input in, a Cloudflare rule out -----------
export const KINDS = {
  custom: {
    phase: 'http_request_firewall_custom',
    perm: 'security.write',
    shape: (b) => ({
      description: text(b.description).slice(0, 200),
      expression: required(b.expression, 'Expression'),
      action: oneOf(b.action || 'block', ['block', 'managed_challenge', 'js_challenge', 'challenge', 'log'], 'Action'),
      enabled: true
    })
  },
  ratelimit: {
    phase: 'http_ratelimit',
    perm: 'rules.write',
    shape: (b) => {
      const action = oneOf(b.action || 'block', ['block', 'managed_challenge', 'js_challenge', 'log'], 'Action');
      const period = oneOf(Number(b.period || 60), [10, 60, 120, 300, 600, 3600], 'Period (seconds)');
      const timeout = action === 'block' ? oneOf(Number(b.timeout || 600), [10, 60, 600, 3600, 86400], 'Block duration (seconds)') : 0;
      return {
        description: text(b.description).slice(0, 200) || 'Rate limit',
        expression: matchExpression(b, { allowAll: true }),
        action,
        enabled: true,
        ratelimit: { characteristics: ['cf.colo.id', 'ip.src'], period, requests_per_period: intIn(b.requests, 1, 1000000, 'Requests'), mitigation_timeout: timeout }
      };
    }
  },
  managed: {
    phase: 'http_request_firewall_managed',
    perm: 'rules.write',
    shape: (b) => {
      const m = MANAGED[b.ruleset];
      if (!m) {throw bad(`ruleset must be one of: ${Object.keys(MANAGED).join(', ')}`);}
      return { description: m.description, expression: 'true', action: 'execute', action_parameters: { id: m.id }, enabled: true };
    }
  },
  redirect: {
    phase: 'http_request_dynamic_redirect',
    perm: 'rules.write',
    shape: (b) => ({
      description: text(b.description).slice(0, 200) || 'Redirect',
      expression: matchExpression(b),
      action: 'redirect',
      action_parameters: { from_value: { status_code: oneOf(Number(b.status || 301), [301, 302, 303, 307, 308], 'Status code'), target_url: { value: absoluteUrl(b.target, 'Target') }, preserve_query_string: b.preserveQuery !== false } },
      enabled: true
    })
  },
  cache: {
    phase: 'http_request_cache_settings',
    perm: 'rules.write',
    shape: (b) => {
      const mode = oneOf(b.mode || 'ttl', ['ttl', 'bypass'], 'Mode');
      const params = mode === 'bypass' ? { cache: false } : { cache: true, edge_ttl: { mode: 'override_origin', default: intIn(b.edgeTtl, 60, 31536000, 'Edge TTL (seconds)') } };
      if (mode === 'ttl' && text(b.browserTtl)) {params.browser_ttl = { mode: 'override_origin', default: intIn(b.browserTtl, 0, 31536000, 'Browser TTL (seconds)') };}
      return { description: text(b.description).slice(0, 200) || 'Cache rule', expression: matchExpression(b), action: 'set_cache_settings', action_parameters: params, enabled: true };
    }
  }
};

const KEEP = ['action', 'expression', 'description', 'action_parameters', 'ratelimit'];

export function registerRules(app, ctx) {
  const { cf, wrap, need } = ctx;

  const gate = (write) => (req, res, next) => {
    const k = KINDS[req.params.kind];
    if (!k) {return res.status(404).json({ error: 'Unknown rule type' });}
    return need(write ? k.perm : 'read')(req, res, next);
  };
  const ruleId = (req) => {
    if (!ID_RE.test(req.params.rid)) {throw bad('Invalid rule id');}
    return req.params.rid;
  };

  async function entry(zid, phase) {
    try { return (await cf.get(`/zones/${zid}/rulesets/phases/${phase}/entrypoint`)).result; } catch (e) {
      if (e instanceof CFError && e.status === 404) {return null;}
      throw e;
    }
  }
  const view = (e) => ({ id: (e && e.id) || null, rules: (e && e.rules) || [] });

  app.get('/api/zones/:zid/rules/:kind', gate(false), wrap(async (req, res) => {
    res.json(view(await entry(req.params.zid, KINDS[req.params.kind].phase)));
  }));

  app.post('/api/zones/:zid/rules/:kind', gate(true), wrap(async (req, res) => {
    const k = KINDS[req.params.kind];
    const rule = k.shape(req.body || {});
    const cur = await entry(req.params.zid, k.phase);
    if (req.params.kind === 'managed' && cur && cur.rules.some((r) => r.action_parameters && rule.action_parameters && r.action_parameters.id === rule.action_parameters.id)) {
      throw new HttpError(409, 'That managed ruleset is already deployed');
    }
    if (cur && cur.id) {await cf.post(`/zones/${req.params.zid}/rulesets/${cur.id}/rules`, rule);}
    else {await cf.put(`/zones/${req.params.zid}/rulesets/phases/${k.phase}/entrypoint`, { rules: [rule] });}
    res.status(201).json(view(await entry(req.params.zid, k.phase)));
  }));

  app.patch('/api/zones/:zid/rules/:kind/:rid', gate(true), wrap(async (req, res) => {
    const k = KINDS[req.params.kind];
    const rid = ruleId(req);
    const cur = await entry(req.params.zid, k.phase);
    const rule = cur && cur.rules.find((r) => r.id === rid);
    if (!rule) {throw new HttpError(404, 'Rule not found');}
    const body = { enabled: !!(req.body && req.body.enabled) };
    for (const f of KEEP) {if (rule[f] !== undefined) {body[f] = rule[f];}}
    await cf.patch(`/zones/${req.params.zid}/rulesets/${cur.id}/rules/${rid}`, body);
    res.json({ ok: true });
  }));

  app.delete('/api/zones/:zid/rules/:kind/:rid', gate(true), wrap(async (req, res) => {
    const k = KINDS[req.params.kind];
    const rid = ruleId(req);
    const cur = await entry(req.params.zid, k.phase);
    if (!cur || !cur.rules.some((r) => r.id === rid)) {throw new HttpError(404, 'Rule not found');}
    await cf.del(`/zones/${req.params.zid}/rulesets/${cur.id}/rules/${rid}`);
    res.json({ ok: true });
  }));
}

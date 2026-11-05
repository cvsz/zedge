import { HttpError, bad } from './errors.js';

/** Per-user limits on account-level resources. An empty or missing list means "all of them". */
export const KINDS = {
  workers: 'Workers (script names)',
  buckets: 'R2 buckets (names)',
  kv: 'KV namespaces (ids)',
  d1: 'D1 databases (ids)',
  pages: 'Pages projects (names)'
};
const ITEM_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function checkResources(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('resources must be an object');
  const out = {};
  for (const [k, list] of Object.entries(v)) {
    if (!(k in KINDS)) throw bad(`Unknown resource type "${k}"`);
    if (!Array.isArray(list) || list.length > 200 || list.some((x) => !ITEM_RE.test(String(x)))) throw bad(`${KINDS[k]} must be a list of names or ids`);
    if (list.length) out[k] = [...new Set(list.map(String))];
  }
  return out;
}

const restricted = (user, kind) => !!(user && user.resources && user.resources[kind] && user.resources[kind].length);
const allowed = (user, kind, id) => !restricted(user, kind) || user.resources[kind].includes(id);
const deny = (kind) => new HttpError(403, `Your account is limited to specific ${kind}, and this is not one of them`);

const ACCT = '\\/accounts\\/[^/]+';
const MAP = [
  { kind: 'workers', label: 'Workers', re: new RegExp(`^${ACCT}\\/workers\\/scripts(?:\\/([^/]+))?(?:\\/.*)?$`), listKey: 'id' },
  { kind: 'buckets', label: 'R2 buckets', re: new RegExp(`^${ACCT}\\/r2\\/buckets(?:\\/([^/]+))?(?:\\/.*)?$`), listKey: 'name', nested: 'buckets' },
  { kind: 'kv', label: 'KV namespaces', re: new RegExp(`^${ACCT}\\/storage\\/kv\\/namespaces(?:\\/([^/]+))?(?:\\/.*)?$`), listKey: 'id' },
  { kind: 'd1', label: 'D1 databases', re: new RegExp(`^${ACCT}\\/d1\\/database(?:\\/([^/]+))?(?:\\/.*)?$`), listKey: 'uuid' },
  { kind: 'pages', label: 'Pages projects', re: new RegExp(`^${ACCT}\\/pages\\/projects(?:\\/([^/]+))?(?:\\/.*)?$`), listKey: 'name' }
];

/** For a Cloudflare path, which limited resource does it touch? */
export function classify(cfPath) {
  for (const m of MAP) {
    const hit = cfPath.match(m.re);
    if (hit) return { ...m, id: hit[1] || null };
  }
  return null;
}

/**
 * Check a pass-through call against the user's limits. Returns a function that trims list results, or null.
 * Creating something new is refused for a limited user: it would not be in their list.
 */
export function guardProxy(user, method, cfPath, body) {
  const c = classify(cfPath);
  if (body && typeof body === 'object') {
    // a Worker route or custom domain names the Worker it sends traffic to
    const target = typeof body.service === 'string' ? body.service : typeof body.script === 'string' ? body.script : null;
    if (target && !allowed(user, 'workers', target)) throw deny('Workers');
  }
  if (!c) return null;
  if (!restricted(user, c.kind)) return null;
  if (c.id) {
    if (!allowed(user, c.kind, c.id)) throw deny(c.label);
    return null;
  }
  if (method !== 'GET') throw new HttpError(403, `Your account is limited to specific ${c.label}, so it cannot create new ones`);
  return (json) => {
    const r = json && json.result;
    const arr = c.nested ? r && r[c.nested] : r;
    if (!Array.isArray(arr)) return json;
    const kept = arr.filter((x) => user.resources[c.kind].includes(String(x[c.listKey])));
    if (c.nested) r[c.nested] = kept; else json.result = kept;
    return json;
  };
}

/** Param handlers for the console's own routes (/api/workers/:name, /api/r2/:bucket, /api/kv/:ns, /api/d1/:db). */
export function registerLimits(app) {
  const check = (kind, label) => (req, res, next, v) => (allowed(req.user, kind, v) ? next() : next(deny(label)));
  app.param('name', (req, res, next, v) => (req.path.startsWith('/api/workers/') ? check('workers', 'Workers')(req, res, next, v) : next()));
  app.param('bucket', check('buckets', 'R2 buckets'));
  app.param('ns', check('kv', 'KV namespaces'));
  app.param('db', check('d1', 'D1 databases'));
}

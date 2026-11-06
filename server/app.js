import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCF, CFError } from './cf.js';
import { createAuth } from './auth.js';
import { createStore } from './store.js';
import { can } from './rbac.js';
import { HttpError } from './errors.js';
import { createMetrics } from './metrics.js';
import { build as buildOpenApi } from './openapi.js';
import { registerCore } from './routes/core.js';
import { registerRules } from './routes/rules.js';
import { registerWorkers } from './routes/workers.js';
import { registerR2 } from './routes/r2.js';
import { registerAnalytics } from './routes/analytics.js';
import { registerEmail } from './routes/email.js';
import { registerAdmin } from './routes/admin.js';
import { registerEdge } from './routes/edge.js';
import { registerSnapshots } from './routes/snapshots.js';
import { registerLimits } from './limits.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export { TOKEN_TEMPLATES } from './routes/core.js';

/** @param {{ fetchImpl?: typeof fetch }} opts */
export function createApp(config, opts = {}) {
  const { fetchImpl } = opts;
  const store = createStore(config.dataDir);
  if (store.isEmpty() && config.password) {
    store.createUser({ name: 'admin', password: config.password, role: 'admin' });
  }
  const metrics = createMetrics(); // X4: per-app metrics state
  const cf = createCF({ token: config.token, apiBase: config.apiBase, fetchImpl, metrics });
  const auth = createAuth(config, store, { metrics });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => metrics.recordMetric(res.statusCode, Date.now() - start));
    next();
  });

  // Behind a Cloudflare Tunnel every request arrives from cloudflared. Cloudflare sets CF-Connecting-IP to the real
  // client, so the login rate limit and audit log can use it. Only enable when the tunnel is the sole way in.
  if (config.trustCfIp) {
    app.use((req, res, next) => {
      const v = req.get('cf-connecting-ip');
      if (v && /^[0-9a-fA-F:.]{3,45}$/.test(v)) {Object.defineProperty(req, 'ip', { value: v, configurable: true });}
      next();
    });
  }

  // ---- accounts: every account this console may act on (all the token can see, or the configured subset) ----
  let accountCache = { at: 0, list: [] };
  async function accounts() {
    if (Date.now() - accountCache.at < 60000 && accountCache.list.length) {return accountCache.list;}
    let list = [];
    try {
      list = ((await cf.get('/accounts', { per_page: '50' })).result || []).map((a) => ({ id: a.id, name: a.name }));
    } catch (e) {
      if (!config.accountIds.length) {throw e;}
    }
    if (config.accountIds.length) {
      const byId = new Map(list.map((a) => [a.id, a]));
      list = config.accountIds.map((id) => byId.get(id) || { id, name: id });
    }
    accountCache = { at: Date.now(), list };
    return list;
  }
  async function accountId(req) {
    const list = await accounts();
    if (!list.length) {throw new HttpError(409, 'This token cannot see any account. Set CLOUDFLARE_ACCOUNT_ID.');}
    const want = req && req.get && req.get('x-account-id');
    if (want) {
      if (!list.some((a) => a.id === want)) {throw new HttpError(403, 'That account is not available to this console');}
      return want;
    }
    return list[0].id;
  }

  // When CLOUDFLARE_ACCOUNT_IDS limits the console to some accounts, zone ids must belong to one of them.
  const zoneCache = new Map();
  async function assertZone(zid) {
    if (!config.accountIds.length) {return;}
    const hit = zoneCache.get(zid);
    if (hit && hit.until > Date.now()) { if (hit.ok) {return;} throw new HttpError(403, 'That zone is not in an account available to this console'); }
    const z = (await cf.get(`/zones/${zid}`)).result;
    const ok = !!(z && z.account && config.accountIds.includes(z.account.id));
    zoneCache.set(zid, { ok, until: Date.now() + 300000 });
    if (!ok) {throw new HttpError(403, 'That zone is not in an account available to this console');}
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const need = (perm) => (req, res, next) => {
    if (can(req.user.permissions, perm)) {return next();}
    return res.status(403).json({ error: `Your role (${req.user.role}) does not allow this (${perm})` });
  };
  const ctx = { cf, config, store, auth, wrap, need, accountId, accounts, assertZone, fetchImpl };

  // ---- security headers + static files ----
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    // HSTS when cookies are marked secure (tunnel or public HTTPS)
    if (config.secureCookie) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });
  app.use(express.static(path.join(here, '..', 'public'), { index: 'index.html', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  // ---- session (no auth needed) ----
  app.post('/api/login', express.json({ limit: '4kb' }), (req, res) => auth.login(req, res));
  app.post('/api/logout', (req, res) => auth.logout(req, res));
  app.get('/api/session', (req, res) => {
    const user = auth.resolve(req);
    res.json({ signedIn: !!user, noAuth: config.noAuth, user: user && { name: user.name, role: user.role, permissions: user.permissions } });
  });

  // ---- everything below needs a session; writes also need the CSRF header ----
  app.use('/api', auth.require);
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'zedge') {
      return res.status(403).json({ error: 'Missing X-Requested-With header' });
    }
    return next();
  });
  app.use('/api', express.json({ limit: '2mb' }));
  app.use('/api', (req, res, next) => { // console audit log: who changed what, never the request body
    if (req.method !== 'GET') {
      res.on('finish', () => store.audit({
        t: new Date().toISOString(), user: req.user.name, method: req.method, path: req.originalUrl.split('?')[0],
        detail: req.query.key ? String(req.query.key).slice(0, 200) : undefined, status: res.statusCode, ip: req.ip
      }));
    }
    next();
  });

  // ---- authenticated-only endpoints ----
  // ---- /metrics: Bearer token first (scrapers), else a session with audit.read (X5) ----
  app.get('/metrics', (req, res) => {
    const token = req.get('authorization') || '';
    const ok = config.metricsToken && token === `Bearer ${config.metricsToken}`;
    if (ok) { return res.type('text/plain').send(metrics.getMetrics(store)); }
    const user = auth.resolve(req);
    if (!user) { return res.status(401).json({ error: 'Not signed in' }); }
    if (!can(user.permissions, 'audit.read')) { return res.status(403).json({ error: 'Forbidden' }); }
    res.type('text/plain').send(metrics.getMetrics(store));
  });
  app.get('/openapi.json', auth.require, (req, res) => res.json(openApiSpec));

  registerCore(app, ctx);
  registerRules(app, ctx);
  registerWorkers(app, ctx);
  registerR2(app, ctx);
  registerAnalytics(app, ctx);
  registerEmail(app, ctx);
  registerAdmin(app, ctx);
  registerEdge(app, ctx);
  registerSnapshots(app, ctx);
  // Param-based resource limits for the dedicated account-level routes (workers, r2, kv, d1, pages).
  registerLimits(app);

  // ---- errors ----
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {return res.status(err.status).json({ error: err.message });}
    if (err instanceof CFError) {
      const status = err.status >= 400 && err.status < 500 && err.status !== 401 ? err.status : 502;
      return res.status(status).json({ error: err.message, cloudflare: err.errors });
    }
    if (err && err.type === 'entity.parse.failed') {return res.status(400).json({ error: 'Invalid JSON' });}
    if (err && err.type === 'entity.too.large') {return res.status(413).json({ error: 'Request is too large' });}
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  });

  const openApiSpec = buildOpenApi(app);
  return app;
}

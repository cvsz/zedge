import { readFile } from 'node:fs/promises';
import { scoped, repos } from '@affiliate-os/db';
import crypto from 'node:crypto';
import { AuthError } from '@affiliate-os/auth';
import { createRateLimiter } from './ratelimit.js';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'] };
const COLUMNS = ['IDEA', 'GENERATING', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns a (req, res) handler. One deployment serves one organization. Identity comes only from a verified Cloudflare Access token. */
export function createStudio({ db, auth, access, organizationId, metrics, metricsToken, logger, limiter = createRateLimiter(), securityContact, publicDir = new URL('../public/', import.meta.url) }) {
  const requests = metrics ? metrics.counter('studio_requests_total', 'HTTP requests by route class and status') : null;
  const sameToken = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { ...HEADERS, 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const readJson = (req) => new Promise((ok, no) => { let n = 0; const b = []; req.on('data', (c) => { n += c.length; if (n > 16384) { no(new AuthError('too large', 413)); req.destroy(); } else b.push(c); }); req.on('end', () => { try { ok(b.length ? JSON.parse(Buffer.concat(b)) : {}); } catch { no(new AuthError('Body must be JSON', 400)); } }); req.on('error', no); });

  async function principalFor(req) {
    const tok = req.headers['cf-access-jwt-assertion'];
    if (!tok) return null;
    let who; try { who = await access(tok); } catch { return null; }
    // Access proves who they are; the studio decides what they may do. Unknown people get nothing (no auto-provisioning).
    const u = (await scoped(db, organizationId).query('SELECT id FROM users WHERE disabled = false AND (($1::text IS NOT NULL AND lower(email) = $1) OR ($2::text IS NOT NULL AND subject = $2)) LIMIT 1', [who.email, who.subject])).rows[0];
    return u ? auth.authenticate(auth.issueSession(organizationId, u.id)) : null;
  }

  return async function handle(req, res) {
    const route = (u) => (u === '/' || u === '/app.js' || u === '/app.css' ? 'static' : u === '/healthz' ? 'health' : u === '/metrics' ? 'metrics' : u.startsWith('/api/') ? 'api' : 'other');
    res.on('finish', () => { if (requests) requests.inc({ route: route(String(req.url).split('?')[0]), status: String(res.statusCode) }); });
    try {
      const url = new URL(req.url, 'http://studio.local');
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (url.pathname === '/readyz') {                  // ready = can reach the database
        try { await db.query('SELECT 1'); return send(res, 200, { ready: true }); } catch { return send(res, 503, { ready: false }); }
      }
      if (url.pathname === '/.well-known/security.txt' && securityContact) return send(res, 200, `Contact: ${securityContact}\nExpires: ${new Date(Date.now() + 365 * 86400000).toISOString()}\nPreferred-Languages: en, th\n`, 'text/plain; charset=utf-8');
      if (url.pathname === '/metrics') {                // scraped by Prometheus with a bearer token; never exposed through Access
        const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
        if (!metrics || !metricsToken || !m || !sameToken(m[1], metricsToken)) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, metrics.expose(), 'text/plain; version=0.0.4; charset=utf-8');
      }
      if (req.method === 'GET' && FILES[url.pathname]) { const [f, t] = FILES[url.pathname]; return send(res, 200, await readFile(new URL(f, publicDir)), t); }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
      const pre = limiter.take(`ip:${ip}`, 1);              // before any token work, so unauthenticated floods are cheap to refuse
      if (!pre.ok) { res.setHeader('retry-after', String(pre.retryAfter)); return send(res, 429, { error: 'Too many requests' }); }
      const p = await principalFor(req);
      if (!p) return send(res, 403, { error: 'Not signed in, or not a member of this studio' });
      const lim = limiter.take(`user:${p.userId}`, req.method === 'GET' ? 1 : 5);   // writes cost more
      if (!lim.ok) { res.setHeader('retry-after', String(lim.retryAfter)); return send(res, 429, { error: 'Too many requests' }); }
      if (req.method !== 'GET') {                       // CSRF: must be a JSON request from our own page
        if (req.headers['x-studio'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 400, { error: 'Bad request' });
        const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) return send(res, 403, { error: 'Cross-origin request refused' });
      }
      if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { name: p.name, role: p.role, permissions: p.permissions });
      if (req.method === 'GET' && url.pathname === '/api/calendar') {
        auth.need(p, 'read');
        const rows = (await scoped(db, p.organizationId).query('SELECT id, status, format, language, left(coalesce(caption, \'\'), 120) AS caption, autonomy_level, scheduled_for, updated_at FROM content ORDER BY updated_at DESC LIMIT 500')).rows;
        const columns = Object.fromEntries(COLUMNS.map((c) => [c, rows.filter((r) => r.status === c)]));
        const scheduled = rows.filter((r) => r.scheduled_for).sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
        return send(res, 200, { columns, scheduled, note: 'Times are UTC. Only approved content can be scheduled.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/approvals') { const st = url.searchParams.get('status') || 'pending'; return send(res, 200, { approvals: await auth.approvals.list(p, { status: st }) }); }
      const m = /^\/api\/approvals\/([^/]+)\/decide$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        if (!UUID.test(m[1])) return send(res, 400, { error: 'Bad id' });
        const b = await readJson(req);
        if (typeof b.approve !== 'boolean') return send(res, 400, { error: 'approve must be true or false' });
        return send(res, 200, await auth.approvals.decide(p, m[1], { approve: b.approve, note: b.note }));
      }
      const sc = /^\/api\/content\/([^/]+)\/(schedule|unschedule)$/.exec(url.pathname);
      if (req.method === 'POST' && sc) {
        if (!UUID.test(sc[1])) return send(res, 400, { error: 'Bad id' });
        auth.need(p, 'publish.schedule');
        const b = await readJson(req);
        let n;
        try { n = await scoped(db, p.organizationId).tx((q) => (sc[2] === 'schedule' ? repos.content.schedule(q, sc[1], b.when) : repos.content.unschedule(q, sc[1]))); }
        catch (e) { return send(res, 400, { error: String(e.message).slice(0, 120) }); }
        return n ? send(res, 200, { ok: true }) : send(res, 409, { error: 'Only approved content can be scheduled, and only scheduled content can be unscheduled' });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof AuthError) return send(res, e.status || 400, { error: e.message });
      if (logger) logger.error('request failed', { route: String(req.url).split('?')[0], error: e && e.message });
      return send(res, 500, { error: 'Something went wrong' });          // details stay in logs, not responses
    }
  };
}

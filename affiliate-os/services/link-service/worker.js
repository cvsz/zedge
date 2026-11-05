// Affiliate link and click-attribution service (Cloudflare Worker + D1).
//   GET /go/{slug}            records a click, then redirects (302) to the visible destination
//   GET /go/{slug}/info       returns the destination and disclosure as JSON (nothing is hidden or cloaked)
//   /api/links ...            admin API, bearer token
// Nothing here stores IP addresses or user agents.

const SLUG_RE = /^[A-Za-z0-9_-]{3,64}$/;
const PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'shopee', 'other'];
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|slurp|headless|monitor/i;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[.*\]|.*:.*)$/i;

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

function hostAllowed(host, env) {
  const list = String(env.ALLOWED_DESTINATION_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Validates a destination for storage and again for redirecting. Returns a URL or throws a message. */
export function checkDestination(value, env) {
  let u;
  try { u = new URL(String(value)); } catch { throw new Error('destination must be a full https URL'); }
  if (u.protocol !== 'https:') throw new Error('destination must use https');
  if (u.username || u.password) throw new Error('destination must not contain a username or password');
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || !host.includes('.')) throw new Error('destination host is not allowed');
  if (!hostAllowed(host, env)) throw new Error('destination host is not on the allowed list (ALLOWED_DESTINATION_HOSTS)');
  if (String(value).length > 2000) throw new Error('destination is too long');
  return u;
}

/** Add UTM parameters the destination does not already carry. Existing parameters are never overwritten. */
export function withUtm(dest, link) {
  const u = new URL(dest);
  const defaults = { utm_source: link.platform, utm_medium: 'affiliate', utm_campaign: link.campaign_id, utm_content: link.creative_id };
  for (const k of UTM_KEYS) if (defaults[k] && !u.searchParams.has(k)) u.searchParams.set(k, defaults[k]);
  return u.toString();
}

function constantTimeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)); const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function authorized(request, env) {
  const token = env.ADMIN_TOKEN || '';
  if (token.length < 32) return false; // refuse to run an admin API with a weak or missing token
  const got = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return constantTimeEqual(got, token);
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function parseLinkInput(b, env, { partial = false } = {}) {
  const out = {};
  const need = (k) => !partial || b[k] !== undefined;
  if (need('destination')) out.destination = checkDestination(b.destination, env).toString();
  if (need('platform') && b.platform !== undefined) { if (!PLATFORMS.includes(b.platform)) throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`); out.platform = b.platform; }
  for (const k of ['provider', 'campaign_id', 'content_id', 'creative_id']) {
    if (b[k] !== undefined && b[k] !== null) { if (!ID_RE.test(String(b[k]))) throw new Error(`${k} may only contain letters, digits and . _ : -`); out[k] = String(b[k]); }
  }
  if (b.disclosure !== undefined) { const d = String(b.disclosure).trim(); if (!d || d.length > 300) throw new Error('disclosure must be 1 to 300 characters'); out.disclosure = d; }
  if (b.enabled !== undefined) out.enabled = b.enabled ? 1 : 0;
  if (b.expires_at !== undefined) {
    if (b.expires_at === null) out.expires_at = null;
    else { const n = Number(b.expires_at); if (!Number.isInteger(n) || n < 1e12) throw new Error('expires_at must be a time in milliseconds since 1970, or null'); out.expires_at = n; }
  }
  return out;
}

async function recordClick(env, link, request, platformParam, nowMs) {
  const platform = PLATFORMS.includes(platformParam) ? platformParam : link.platform;
  const bot = BOT_RE.test(request.headers.get('User-Agent') || '') ? 1 : 0; // only a yes/no is kept, never the agent string
  const country = (request.cf && request.cf.country) || null;
  await env.DB.prepare('INSERT INTO clicks (slug, ts, day, platform, country, is_bot) VALUES (?, ?, ?, ?, ?, ?)').bind(link.slug, nowMs, dayOf(nowMs), platform, country, bot).run();
}

export function createHandler({ now = () => Date.now() } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === '/healthz') return json({ ok: true });

      // ---- public: the redirect ----
      let m = path.match(/^\/go\/([^/]+)(\/info)?\/?$/);
      if (m) {
        if (!['GET', 'HEAD'].includes(method)) return text('Method not allowed', 405);
        const slug = m[1];
        if (!SLUG_RE.test(slug)) return text('Not found', 404);
        const link = await env.DB.prepare('SELECT * FROM links WHERE slug = ?').bind(slug).first();
        if (!link) return text('Not found', 404);
        const t = now();
        if (!link.enabled || (link.expires_at && link.expires_at < t)) return text('This link is no longer active.', 410);
        let dest;
        try { dest = withUtm(checkDestination(link.destination, env).toString(), link); } catch { return text('This link is not available.', 410); }
        if (m[2]) return json({ slug, destination: dest, disclosure: link.disclosure, expires_at: link.expires_at });
        if (method === 'GET') { // HEAD (previews, uptime checks) does not count as a click
          const p = recordClick(env, link, request, url.searchParams.get('p'), t).catch(() => {});
          if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
        }
        return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin', 'X-Robots-Tag': 'noindex' } });
      }

      // ---- admin API ----
      if (path.startsWith('/api/')) {
        if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);
        let body = {};
        if (['POST', 'PATCH'].includes(method)) {
          try { body = await request.json(); } catch { return json({ error: 'Send a JSON body' }, 400); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Send a JSON object' }, 400);
        }
        try {
          if (path === '/api/links' && method === 'POST') {
            if (!SLUG_RE.test(String(body.slug || ''))) return json({ error: 'slug must be 3 to 64 letters, digits, - or _' }, 400);
            const f = parseLinkInput(body, env);
            const t = now();
            const exists = await env.DB.prepare('SELECT slug FROM links WHERE slug = ?').bind(body.slug).first();
            if (exists) return json({ error: 'That slug is already used' }, 409);
            const row = { provider: 'generic', platform: 'other', campaign_id: null, content_id: null, creative_id: null, enabled: 1, expires_at: null, disclosure: env.DEFAULT_DISCLOSURE || 'Affiliate link: we may earn a commission.', ...f };
            await env.DB.prepare('INSERT INTO links (slug, destination, provider, campaign_id, content_id, creative_id, platform, disclosure, enabled, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
              .bind(body.slug, row.destination, row.provider, row.campaign_id, row.content_id, row.creative_id, row.platform, row.disclosure, row.enabled, row.expires_at, t, t).run();
            return json({ slug: body.slug, url: `${url.origin}/go/${body.slug}` }, 201);
          }
          if (path === '/api/links' && method === 'GET') {
            const r = await env.DB.prepare('SELECT * FROM links ORDER BY created_at DESC LIMIT 200').all();
            return json({ links: r.results });
          }
          m = path.match(/^\/api\/links\/([^/]+)(\/stats)?$/);
          if (m && SLUG_RE.test(m[1])) {
            const link = await env.DB.prepare('SELECT * FROM links WHERE slug = ?').bind(m[1]).first();
            if (!link) return json({ error: 'No such link' }, 404);
            if (!m[2] && method === 'GET') return json(link);
            if (!m[2] && method === 'PATCH') {
              const f = parseLinkInput(body, env, { partial: true });
              const keys = Object.keys(f);
              if (!keys.length) return json({ error: 'Nothing to change' }, 400);
              await env.DB.prepare(`UPDATE links SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE slug = ?`).bind(...keys.map((k) => f[k]), now(), m[1]).run();
              return json({ ok: true });
            }
            if (m[2] && method === 'GET') {
              const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
              const since = dayOf(now() - (days - 1) * 86400000);
              const byDay = await env.DB.prepare('SELECT day, COUNT(*) AS clicks, SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_clicks FROM clicks WHERE slug = ? AND day >= ? GROUP BY day ORDER BY day').bind(m[1], since).all();
              const byPlatform = await env.DB.prepare('SELECT platform, COUNT(*) AS clicks FROM clicks WHERE slug = ? AND day >= ? AND is_bot = 0 GROUP BY platform ORDER BY clicks DESC').bind(m[1], since).all();
              const byCountry = await env.DB.prepare('SELECT COALESCE(country, \'unknown\') AS country, COUNT(*) AS clicks FROM clicks WHERE slug = ? AND day >= ? AND is_bot = 0 GROUP BY country ORDER BY clicks DESC LIMIT 20').bind(m[1], since).all();
              const total = byDay.results.reduce((a, r) => a + r.clicks, 0);
              const human = byDay.results.reduce((a, r) => a + r.human_clicks, 0);
              return json({ slug: m[1], days, clicks: total, human_clicks: human, by_day: byDay.results, by_platform: byPlatform.results, by_country: byCountry.results, note: 'Clicks are observed redirects. Conversions and commissions come from the affiliate provider and are joined in the attribution service.' });
            }
          }
          return json({ error: 'Not found' }, 404);
        } catch (e) {
          return json({ error: e.message || 'Bad request' }, 400);
        }
      }
      return text('Not found', 404);
    }
  };
}

export default createHandler();

import crypto from 'node:crypto';
import { verifyPassword, hashPassword, MIN_PASSWORD } from './store.js';
import { HttpError, bad } from './errors.js';

const COOKIE = 'edge_session';
const LOCAL_ADMIN = { name: 'local', role: 'admin', permissions: ['*'] };

const sign = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth(config, store) {
  const attempts = new Map(); // ip -> { count, resetAt }

  function issue(res, username) {
    const exp = Date.now() + config.sessionHours * 3600 * 1000;
    const payload = `${exp}.${crypto.randomBytes(8).toString('hex')}.${Buffer.from(username).toString('base64url')}`;
    const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${config.sessionHours * 3600}`];
    if (config.secureCookie) flags.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(config.sessionSecret, payload)}; ${flags.join('; ')}`);
  }

  function sessionName(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const parts = raw ? raw.split('.') : [];
    if (parts.length !== 4) return null;
    const payload = parts.slice(0, 3).join('.');
    if (!safeEqual(parts[3], sign(config.sessionSecret, payload))) return null;
    if (!(Number(parts[0]) > Date.now())) return null;
    return Buffer.from(parts[2], 'base64url').toString();
  }

  /** The signed-in user, looked up fresh on every request so role changes apply at once. */
  function resolve(req) {
    if (config.noAuth) return LOCAL_ADMIN;
    const name = sessionName(req);
    if (!name) return null;
    const u = store.getUser(name);
    if (!u || u.disabled) return null;
    return { name: u.name, role: u.role, permissions: store.permissionsFor(u.role) };
  }

  function login(req, res) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = attempts.get(ip);
    if (rec && rec.resetAt > now && rec.count >= 5) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }
    const username = String((req.body && req.body.username) || 'admin').trim().toLowerCase();
    const u = config.noAuth ? null : store.getUser(username);
    const ok = !!u && !u.disabled && verifyPassword(req.body && req.body.password, u.hash);
    if (!u) verifyPassword(req.body && req.body.password, undefined); // keep timing similar for unknown users
    if (!ok) {
      const next = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + 15 * 60 * 1000 };
      next.count += 1;
      attempts.set(ip, next);
      store.audit({ t: new Date().toISOString(), user: username, method: 'LOGIN', path: '/api/login', status: 401, ip });
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    attempts.delete(ip);
    issue(res, u.name);
    store.audit({ t: new Date().toISOString(), user: u.name, method: 'LOGIN', path: '/api/login', status: 200, ip });
    return res.json({ ok: true });
  }

  function require(req, res, next) {
    const user = resolve(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    return next();
  }

  function changePassword(req, res) {
    if (config.noAuth) throw bad('Passwords are not used in no-auth mode');
    const { current, next: nextPw } = req.body || {};
    const u = store.getUser(req.user.name);
    if (!u || !verifyPassword(current, u.hash)) throw new HttpError(403, 'Current password is incorrect');
    if (typeof nextPw !== 'string' || nextPw.length < MIN_PASSWORD) throw bad(`New password must be at least ${MIN_PASSWORD} characters`);
    store.updateUser(u.name, { password: nextPw });
    res.json({ ok: true });
  }

  return {
    login,
    logout: (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); res.json({ ok: true }); },
    resolve,
    require,
    changePassword
  };
}

export { hashPassword };

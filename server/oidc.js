import crypto from 'node:crypto';
import { HttpError } from './errors.js';

const COOKIE = 'zedge_oidc';
const STATE_SECONDS = 600;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('The identity token is malformed');
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')), claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')), signed: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2], 'base64url') };
  } catch { throw new Error('The identity token is malformed'); }
}

/** Only RS256 and ES256 are accepted. "none" and shared-secret algorithms are refused. */
export function verifySignature(jwt, jwk) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (jwt.header.alg === 'RS256') return crypto.verify('RSA-SHA256', Buffer.from(jwt.signed), key, jwt.sig);
  if (jwt.header.alg === 'ES256') return crypto.verify('sha256', Buffer.from(jwt.signed), { key, dsaEncoding: 'ieee-p1363' }, jwt.sig);
  throw new Error('The identity token uses an unsupported signature algorithm');
}

export function checkClaims(claims, { issuer, clientId, nonce, now = Date.now() }) {
  if (claims.iss !== issuer) throw new Error('The identity token is from a different issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('The identity token is for a different application');
  if (aud.length > 1 && claims.azp !== clientId) throw new Error('The identity token was issued to a different party');
  if (!(Number(claims.exp) * 1000 > now - 60000)) throw new Error('The identity token has expired');
  if (claims.nbf && Number(claims.nbf) * 1000 > now + 60000) throw new Error('The identity token is not valid yet');
  if (claims.iat && Number(claims.iat) * 1000 > now + 5 * 60000) throw new Error('The identity token was issued in the future');
  if (!claims.nonce || claims.nonce !== nonce) throw new Error('The sign-in response did not match this browser session');
  if (!claims.sub) throw new Error('The identity token has no subject');
}

export function roleFromClaims(claims, cfg) {
  const raw = claims[cfg.roleClaim];
  const vals = Array.isArray(raw) ? raw.map(String) : raw !== undefined && raw !== null ? [String(raw)] : [];
  for (const [value, role] of Object.entries(cfg.roleMap)) if (vals.includes(value)) return role; // first match in the order given wins
  return cfg.defaultRole;
}

/** A console username derived from the email, always prefixed so it can never collide with a local account. */
export function usernameFor(claims) {
  const base = String(claims.preferred_username || claims.email || claims.sub).toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 24);
  return `sso-${base || crypto.createHash('sha256').update(String(claims.sub)).digest('hex').slice(0, 10)}`;
}

/** @param {any} config @param {any} store @param {any} auth @param {{ alert?: (message: string) => void, fetchImpl?: any }} [deps] */
export function createOidc(config, store, auth, { alert = (_message) => {}, fetchImpl = fetch } = {}) {
  const cfg = config.oidc;
  let discovery; let jwks;
  const getJson = async (url) => {
    const r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`The identity provider answered ${r.status}`);
    return r.json();
  };
  async function meta() {
    if (discovery && discovery.until > Date.now()) return discovery.doc;
    const doc = await getJson(`${cfg.issuer}/.well-known/openid-configuration`);
    if (doc.issuer !== cfg.issuer) throw new Error('The identity provider reports a different issuer than OIDC_ISSUER');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!doc[k]) throw new Error(`The identity provider is missing ${k}`);
    discovery = { doc, until: Date.now() + 3600000 };
    return doc;
  }
  async function keyFor(kid, force) {
    if (!jwks || force || jwks.until < Date.now()) jwks = { keys: (await getJson((await meta()).jwks_uri)).keys || [], until: Date.now() + 600000 };
    return jwks.keys.find((k) => (!kid || k.kid === kid) && (!k.use || k.use === 'sig'));
  }

  const flags = () => ['HttpOnly', 'SameSite=Lax', 'Path=/api/oidc', `Max-Age=${STATE_SECONDS}`, ...(config.secureCookie ? ['Secure'] : [])].join('; ');
  const fail = (res, message) => res.redirect(302, `/?sso_error=${encodeURIComponent(message)}`);

  async function start(req, res) {
    let m;
    try { m = await meta(); } catch (e) { return fail(res, `Single sign-on is unavailable: ${e.message}`.slice(0, 200)); }
    const state = crypto.randomBytes(16).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const payload = b64u(JSON.stringify({ state, nonce, verifier, exp: Date.now() + STATE_SECONDS * 1000 }));
    res.append('Set-Cookie', `${COOKIE}=${payload}.${sign(config.sessionSecret, payload)}; ${flags()}`);
    const u = new URL(m.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUrl, scope: cfg.scopes, state, nonce,
      code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
    }).toString();
    res.redirect(302, u.toString());
  }

  function readState(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE] || '';
    const [payload, mac] = raw.split('.');
    if (!payload || !mac) return null;
    const want = Buffer.from(sign(config.sessionSecret, payload)); const got = Buffer.from(mac);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return s.exp > Date.now() ? s : null;
  }

  async function callback(req, res) {
    res.append('Set-Cookie', `${COOKIE}=; ${flags().replace(/Max-Age=\d+/, 'Max-Age=0')}`); // the state is single use
    try {
      if (req.query.error) return fail(res, `The identity provider refused the sign-in: ${String(req.query.error).slice(0, 80)}`);
      const st = readState(req);
      if (!st) return fail(res, 'The sign-in took too long or did not start here. Try again.');
      if (!req.query.state || req.query.state !== st.state) return fail(res, 'The sign-in response did not match this browser session');
      if (!req.query.code) return fail(res, 'The identity provider did not send a sign-in code');
      const m = await meta();
      const form = new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: cfg.redirectUrl, client_id: cfg.clientId, code_verifier: st.verifier });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
      if (cfg.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64')}`;
      const tr = await fetchImpl(m.token_endpoint, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(10000) });
      const tok = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.id_token) return fail(res, `The identity provider would not issue a token${tok.error ? `: ${String(tok.error).slice(0, 60)}` : ''}`);
      const jwt = decodeJwt(tok.id_token);
      let jwk = await keyFor(jwt.header.kid, false);
      if (!jwk) jwk = await keyFor(jwt.header.kid, true); // keys may have rotated
      if (!jwk) return fail(res, 'The identity token is signed with an unknown key');
      if (!verifySignature(jwt, jwk)) return fail(res, 'The identity token signature is not valid');
      checkClaims(jwt.claims, { issuer: cfg.issuer, clientId: cfg.clientId, nonce: st.nonce });
      const claims = jwt.claims;
      const email = String(claims.email || '').toLowerCase();
      if (cfg.allowedDomains.length) {
        if (!email || claims.email_verified === false || !cfg.allowedDomains.includes(email.split('@')[1])) return fail(res, 'Your email domain is not allowed to use this console');
      }
      const role = roleFromClaims(claims, cfg);
      if (!store.permissionsFor(role).length) return fail(res, `The role "${role}" for your account does not exist in the console`);
      const name = usernameFor(claims);
      let user;
      try { user = store.upsertSsoUser({ name, sub: String(claims.sub), issuer: cfg.issuer, email, role }); } catch (e) {
        if (e instanceof HttpError) return fail(res, e.message);
        throw e;
      }
      if (user.disabled) return fail(res, 'This account is disabled');
      auth.issueSession(res, user.name);
      store.audit({ t: new Date().toISOString(), user: user.name, method: 'LOGIN', path: '/api/oidc/callback', status: 200, ip: req.ip });
      return res.redirect(302, '/');
    } catch (e) {
      store.audit({ t: new Date().toISOString(), user: 'sso', method: 'LOGIN', path: '/api/oidc/callback', status: 401, ip: req.ip });
      alert(`Zedge: a single sign-on attempt was refused (${e.message})`);
      return fail(res, e.message.startsWith('The ') ? e.message : 'Single sign-on failed');
    }
  }

  return { start, callback };
}

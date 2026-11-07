import crypto from 'node:crypto';
import { scoped, canonical } from '@affiliate-os/db';
import { PERMISSIONS, can, validPermissions, AUTONOMY } from './rbac.js';
import { decodeJwt, verifySignature, checkClaims, roleFromClaims } from './oidc.js';
import * as audit from './audit.js';

export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const E = { unauth: (m = 'Sign in first') => new AuthError(401, 'UNAUTHENTICATED', m), forbid: (m) => new AuthError(403, 'FORBIDDEN', m), none: (m) => new AuthError(404, 'NOT_FOUND', m), bad: (m) => new AuthError(400, 'INVALID', m), conflict: (m) => new AuthError(409, 'CONFLICT', m) };

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_MS = 24 * 3600000;
const APPROVED_MS = 30 * 60000;
export const approvalFingerprint = ({ kind, subject_type, subject_id, payload = {} }) => sha(canonical({ kind, subject_type, subject_id, payload }));

/** A JWKS fetcher with a short cache; `refresh` forces a reload (key rotation). */
export function jwksFetcher(url, { fetchImpl = fetch, ttlMs = 600000, now = Date.now } = {}) {
  let cache = { at: 0, keys: [] };
  return async (refresh = false) => {
    if (!refresh && cache.keys.length && now() - cache.at < ttlMs) {return cache.keys;}
    const res = await fetchImpl(url);
    if (!res.ok) {throw new Error(`Could not load the identity provider keys (${res.status})`);}
    cache = { at: now(), keys: (await res.json()).keys || [] };
    return cache.keys;
  };
}

export function createAuth({ db, sessionSecret, sessionHours = 12, oidc = {}, now = () => new Date() }) {
  if (!sessionSecret || String(sessionSecret).length < 32) {throw new Error('sessionSecret must be at least 32 characters');}
  const sign = (v) => crypto.createHmac('sha256', sessionSecret).update(v).digest('base64url');

  // ------------------------------------------------------------------ sessions
  function issueSession(organizationId, userId) {
    const body = Buffer.from(JSON.stringify({ o: organizationId, u: userId, e: now().getTime() + sessionHours * 3600000 })).toString('base64url');
    return `${body}.${sign(body)}`;
  }

  /** Permissions are looked up on every call, so a changed role or a disabled user takes effect at once. */
  async function authenticate(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) {return null;}
    const want = Buffer.from(sign(body)); const got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {return null;}
    let s; try { s = JSON.parse(Buffer.from(body, 'base64url')); } catch { return null; }
    if (!(s.e > now().getTime()) || !UUID.test(String(s.o)) || !UUID.test(String(s.u))) {return null;}
    return scoped(db, s.o).tx(async (q) => {
      const u = (await q.query('SELECT u.id, u.subject, u.email, u.display_name, u.disabled, u.role_name, r.permissions FROM users u JOIN roles r ON r.organization_id = u.organization_id AND r.name = u.role_name WHERE u.id = $1', [s.u])).rows[0];
      if (!u || u.disabled) {return null;}
      return { organizationId: s.o, userId: u.id, name: u.display_name || u.email || u.subject, role: u.role_name, permissions: u.permissions };
    });
  }

  const need = (p, perm) => {
    if (!p) {throw E.unauth();}
    if (!can(p.permissions, perm)) {throw E.forbid(`Your role (${p.role}) does not allow this (${perm})`);}
  };
  const tx = (p, fn) => scoped(db, p.organizationId).tx(fn);
  const log = (q, p, action, subject_type, subject_id, detail) => audit.append(q, { actor: p.name, action, subject_type, subject_id, detail }, now);
  const activeOwners = async (q, exceptUserId) => Number((await q.query("SELECT count(*) AS n FROM users WHERE role_name = 'owner' AND NOT disabled AND ($1::uuid IS NULL OR id <> $1::uuid)", [exceptUserId || null])).rows[0].n);

  // ------------------------------------------------------------------ OIDC sign-in
  async function signIn(organizationId, idToken, { nonce }) {
    const cfg = oidc[organizationId];
    if (!cfg) {throw E.forbid('Single sign-on is not configured for this organization');}
    let jwt;
    try {
      jwt = decodeJwt(idToken);
      let keys = await cfg.keys(false);
      let jwk = keys.find((k) => k.kid === jwt.header.kid);
      if (!jwk) { keys = await cfg.keys(true); jwk = keys.find((k) => k.kid === jwt.header.kid); }   // a rotated key is picked up once
      if (!jwk) {throw new Error('The identity token was signed with an unknown key');}
      if (!verifySignature(jwt, jwk)) {throw new Error('The identity token signature is not valid');}
      checkClaims(jwt.claims, { issuer: cfg.issuer, clientId: cfg.clientId, nonce, now: now().getTime() });
    } catch (e) { throw E.unauth(e.message); }
    const c = jwt.claims;
    if (cfg.allowedEmailDomains && cfg.allowedEmailDomains.length) {
      const domain = String(c.email || '').split('@')[1] || '';
      if (c.email_verified === false || !cfg.allowedEmailDomains.includes(domain.toLowerCase())) {throw E.forbid('That email domain is not allowed');}
    }
    const role = roleFromClaims(c, cfg);
    return scoped(db, organizationId).tx(async (q) => {
      if (!(await q.query('SELECT 1 FROM roles WHERE name = $1', [role])).rows.length) {throw E.forbid(`The identity provider mapped you to an unknown role "${role}"`);}
      let u = (await q.query('SELECT id, role_name, disabled FROM users WHERE subject = $1', [c.sub])).rows[0];
      const actor = String(c.email || c.sub);
      if (!u) {
        u = (await q.query('INSERT INTO users (organization_id, subject, email, display_name, role_name, last_login_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, role_name, disabled', [organizationId, c.sub, c.email || null, c.name ? String(c.name).slice(0, 200) : null, role, now().toISOString()])).rows[0];
        await audit.append(q, { actor, action: 'user.created', subject_type: 'user', subject_id: u.id, detail: { role, via: 'oidc' } }, now);
      } else {
        if (u.disabled) { await audit.append(q, { actor, action: 'auth.refused_disabled', subject_type: 'user', subject_id: u.id }, now); throw E.forbid('This account is disabled'); }
        if (u.role_name !== role) {
          if (u.role_name === 'owner' && (await activeOwners(q, u.id)) === 0) {
            await audit.append(q, { actor, action: 'role.sync_skipped', subject_type: 'user', subject_id: u.id, detail: { reason: 'last owner', wanted: role } }, now);
          } else {
            await q.query('UPDATE users SET role_name = $2 WHERE id = $1', [u.id, role]);
            await audit.append(q, { actor, action: 'role.synced', subject_type: 'user', subject_id: u.id, detail: { from: u.role_name, to: role } }, now);
          }
        }
        await q.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [u.id, now().toISOString()]);
      }
      await audit.append(q, { actor, action: 'auth.sign_in', subject_type: 'user', subject_id: u.id }, now);
      return { token: issueSession(organizationId, u.id), userId: u.id };
    });
  }

  /** First owner for a new organization (run once by whoever provisions it). Refuses when users already exist. */
  async function bootstrapOwner(organizationId, { subject, email }) {
    return scoped(db, organizationId).tx(async (q) => {
      if (Number((await q.query('SELECT count(*) AS n FROM users')).rows[0].n) > 0) {throw E.conflict('This organization already has members');}
      const u = (await q.query("INSERT INTO users (organization_id, subject, email, role_name) VALUES ($1,$2,$3,'owner') RETURNING id", [organizationId, subject, email || null])).rows[0];
      await audit.append(q, { actor: 'system', action: 'owner.bootstrapped', subject_type: 'user', subject_id: u.id }, now);
      return u.id;
    });
  }

  // ------------------------------------------------------------------ members and roles
  const users = {
    list: async (p) => { need(p, 'users.admin'); return tx(p, async (q) => (await q.query('SELECT id, subject, email, display_name, role_name, disabled, last_login_at FROM users ORDER BY created_at')).rows); },
    create: async (p, { subject, email, role = 'viewer' }) => {
      need(p, 'users.admin');
      if (!subject || String(subject).length > 255) {throw E.bad('subject is required');}
      return tx(p, async (q) => {
        if (!(await q.query('SELECT 1 FROM roles WHERE name = $1', [role])).rows.length) {throw E.bad('Unknown role');}
        if ((await q.query('SELECT 1 FROM users WHERE subject = $1', [subject])).rows.length) {throw E.conflict('That member already exists');}
        const u = (await q.query('INSERT INTO users (organization_id, subject, email, role_name) VALUES ($1,$2,$3,$4) RETURNING id', [p.organizationId, subject, email || null, role])).rows[0];
        await log(q, p, 'user.created', 'user', u.id, { role });
        return u.id;
      });
    },
    setRole: async (p, userId, role) => {
      need(p, 'users.admin');
      return tx(p, async (q) => {
        const u = (await q.query('SELECT id, role_name FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) {throw E.none('No such member');}
        if (!(await q.query('SELECT 1 FROM roles WHERE name = $1', [role])).rows.length) {throw E.bad('Unknown role');}
        if (u.role_name === 'owner' && role !== 'owner' && (await activeOwners(q, u.id)) === 0) {throw E.conflict('An organization must keep at least one active owner');}
        if (role === 'owner' && p.role !== 'owner') {throw E.forbid('Only an owner can make someone an owner');}
        await q.query('UPDATE users SET role_name = $2 WHERE id = $1', [userId, role]);
        await log(q, p, 'role.assigned', 'user', userId, { from: u.role_name, to: role });
      });
    },
    setDisabled: async (p, userId, disabled) => {
      need(p, 'users.admin');
      return tx(p, async (q) => {
        const u = (await q.query('SELECT id, role_name FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) {throw E.none('No such member');}
        if (disabled && u.role_name === 'owner' && (await activeOwners(q, u.id)) === 0) {throw E.conflict('An organization must keep at least one active owner');}
        await q.query('UPDATE users SET disabled = $2 WHERE id = $1', [userId, !!disabled]);
        await log(q, p, disabled ? 'user.disabled' : 'user.enabled', 'user', userId);
      });
    }
  };

  const roles = {
    list: async (p) => { need(p, 'read'); return tx(p, async (q) => (await q.query('SELECT name, permissions, builtin FROM roles ORDER BY builtin DESC, name')).rows); },
    save: async (p, { name, permissions }) => {
      need(p, 'users.admin');
      if (!/^[a-z][a-z0-9_-]{1,39}$/.test(String(name))) {throw E.bad('Role names use lowercase letters, digits, - and _');}
      if (!validPermissions(permissions)) {throw E.bad(`permissions must be a non-empty list from: ${Object.keys(PERMISSIONS).join(', ')}`);}
      const perms = [...new Set(permissions)];
      return tx(p, async (q) => {
        const cur = (await q.query('SELECT builtin FROM roles WHERE name = $1', [name])).rows[0];
        if (cur && cur.builtin) {throw E.conflict('Built-in roles cannot be changed');}
        if (cur) {await q.query('UPDATE roles SET permissions = $2 WHERE name = $1', [name, perms]);}
        else {await q.query('INSERT INTO roles (organization_id, name, permissions) VALUES ($1,$2,$3)', [p.organizationId, name, perms]);}
        await log(q, p, cur ? 'role.updated' : 'role.created', 'role', name, { permissions: perms });
      });
    },
    remove: async (p, name) => {
      need(p, 'users.admin');
      return tx(p, async (q) => {
        const cur = (await q.query('SELECT builtin FROM roles WHERE name = $1', [name])).rows[0];
        if (!cur) {throw E.none('No such role');}
        if (cur.builtin) {throw E.conflict('Built-in roles cannot be deleted');}
        if (Number((await q.query('SELECT count(*) AS n FROM users WHERE role_name = $1', [name])).rows[0].n) > 0) {throw E.conflict('Move its members to another role first');}
        await q.query('DELETE FROM roles WHERE name = $1', [name]);
        await log(q, p, 'role.deleted', 'role', name);
      });
    }
  };

  // ------------------------------------------------------------------ approvals (a second person decides; one use; exact same request)
  async function tidy(q) {
    await q.query("UPDATE approval_requests SET status = 'expired' WHERE status IN ('pending','approved') AND expires_at < $1", [now().toISOString()]);
  }
  const approvals = {
    request: async (p, { kind, subject_type, subject_id, summary, payload = {} }) => {
      need(p, 'read');
      if (!UUID.test(String(subject_id))) {throw E.bad('subject_id must be a UUID');}
      const fp = approvalFingerprint({ kind, subject_type, subject_id, payload });
      return tx(p, async (q) => {
        await tidy(q);
        const dup = (await q.query("SELECT * FROM approval_requests WHERE requested_by = $1 AND fingerprint = $2 AND status = 'pending'", [p.userId, fp])).rows[0];
        if (dup) {return dup;}
        const a = (await q.query('INSERT INTO approval_requests (organization_id, kind, subject_type, subject_id, summary, payload, fingerprint, requested_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [p.organizationId, kind, subject_type, subject_id, summary, JSON.stringify(payload), fp, p.userId, new Date(now().getTime() + PENDING_MS).toISOString()])).rows[0];
        await log(q, p, 'approval.requested', 'approval', a.id, { kind, subject_type, subject_id });
        return a;
      });
    },
    list: async (p, { status } = {}) => { need(p, 'read'); return tx(p, async (q) => { await tidy(q); return (await q.query(status ? 'SELECT * FROM approval_requests WHERE status = $1 ORDER BY created_at DESC' : 'SELECT * FROM approval_requests ORDER BY created_at DESC', status ? [status] : [])).rows; }); },
    decide: async (p, id, { approve, note = '' }) => {
      need(p, 'approvals.decide');
      return tx(p, async (q) => {
        await tidy(q);
        const a = (await q.query('SELECT * FROM approval_requests WHERE id = $1', [id])).rows[0];
        if (!a) {throw E.none('No such request');}
        if (a.status !== 'pending') {throw E.conflict(`That request is already ${a.status}`);}
        if (a.requested_by === p.userId) {throw E.forbid('A second person has to decide: you cannot approve your own request');}
        const expires = approve ? new Date(now().getTime() + APPROVED_MS).toISOString() : a.expires_at;
        const r = (await q.query('UPDATE approval_requests SET status = $2, decided_by = $3, decided_at = $4, note = $5, expires_at = $6 WHERE id = $1 RETURNING *', [id, approve ? 'approved' : 'rejected', p.userId, now().toISOString(), String(note).slice(0, 200), expires])).rows[0];
        await log(q, p, approve ? 'approval.approved' : 'approval.rejected', 'approval', id, { kind: a.kind });
        return r;
      });
    },
    cancel: async (p, id) => {
      need(p, 'read');
      return tx(p, async (q) => {
        const r = (await q.query("UPDATE approval_requests SET status = 'cancelled' WHERE id = $1 AND requested_by = $2 AND status IN ('pending','approved') RETURNING id", [id, p.userId])).rows[0];
        if (!r) {throw E.none('Nothing to cancel');}
        await log(q, p, 'approval.cancelled', 'approval', id);
      });
    },
    /** Use an approval once, by the person who asked, for exactly the same request. Call inside the action's own transaction. */
    redeem: async (p, id, request) => tx(p, (q) => redeemIn(q, p, id, request))
  };

  async function redeemIn(q, p, id, request) {
    await tidy(q);
    const a = (await q.query('SELECT * FROM approval_requests WHERE id = $1', [id])).rows[0];
    if (!a) {throw E.forbid('No such approval');}
    if (a.requested_by !== p.userId) {throw E.forbid('That approval belongs to someone else');}
    if (a.status !== 'approved') {throw E.forbid(`That approval is ${a.status}`);}
    if (a.fingerprint !== approvalFingerprint(request)) {throw E.forbid('That approval is for a different request');}
    const r = await q.query("UPDATE approval_requests SET status = 'consumed', consumed_at = $2 WHERE id = $1 AND status = 'approved'", [id, now().toISOString()]);
    if (!r.affectedRows) {throw E.forbid('That approval was already used');}
    await log(q, p, 'approval.consumed', 'approval', id, { kind: a.kind });
  }

  // ------------------------------------------------------------------ autonomy: lowering is direct, raising is an approved, audited act
  async function setCampaignAutonomy(p, campaignId, level, { approvalId } = {}) {
    if (!AUTONOMY.includes(level)) {throw E.bad(`level must be one of: ${AUTONOMY.join(', ')}`);}
    need(p, 'campaigns.write');
    return tx(p, async (q) => {
      const c = (await q.query('SELECT id, autonomy_level FROM campaigns WHERE id = $1', [campaignId])).rows[0];
      if (!c) {throw E.none('No such campaign');}
      if (c.autonomy_level === level) {return level;}
      if (AUTONOMY.indexOf(level) > AUTONOMY.indexOf(c.autonomy_level)) {
        need(p, 'autonomy.raise');
        if (!approvalId) {throw E.forbid('Raising autonomy needs an approved request from a second person');}
        await redeemIn(q, p, approvalId, { kind: 'raise_autonomy', subject_type: 'campaign', subject_id: campaignId, payload: { from: c.autonomy_level, to: level } });
      }
      await q.query('UPDATE campaigns SET autonomy_level = $2 WHERE id = $1', [campaignId, level]);
      await log(q, p, 'autonomy.changed', 'campaign', campaignId, { from: c.autonomy_level, to: level });
      return level;
    });
  }

  // ------------------------------------------------------------------ audit access
  const auditLog = {
    list: async (p, { limit = 100 } = {}) => { need(p, 'audit.read'); return tx(p, async (q) => (await q.query('SELECT seq, ts, actor, action, subject_type, subject_id, detail, hash FROM audit_entries ORDER BY seq DESC LIMIT $1', [Math.min(Math.max(Number(limit) || 100, 1), 500)])).rows); },
    verify: async (p, opts) => { need(p, 'audit.read'); return tx(p, (q) => audit.verify(q, opts)); },
    /** Store this value somewhere else (a ticket, an email): it lets a later verify catch a truncated log. */
    anchor: async (p) => { need(p, 'audit.read'); return tx(p, async (q) => { const v = await audit.verify(q); return v.ok ? v.head : null; }); }
  };

  return { signIn, authenticate, bootstrapOwner, issueSession, need, users, roles, approvals, setCampaignAutonomy, audit: auditLog, can: (p, perm) => !!p && can(p.permissions, perm) };
}

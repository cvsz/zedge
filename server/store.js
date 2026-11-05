import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, bad } from './errors.js';
import { BUILTIN_ROLES, PERMISSIONS, validPermissions } from './rbac.js';
import { checkResources } from './limits.js';

const USER_RE = /^[a-z0-9._-]{2,32}$/;
const ROLE_RE = /^[a-z0-9_-]{2,32}$/;
export const MIN_PASSWORD = 12;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

const DUMMY = hashPassword('dummy-password-for-timing');
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || DUMMY).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got) && stored !== undefined && stored !== null;
}

const ZONE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
/** A zone allowlist: empty means every zone the console can see. */
function checkZones(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > 200 || list.some((z) => !ZONE_ID_RE.test(String(z)))) throw bad('Zones must be a list of zone ids');
  return [...new Set(list.map(String))];
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw bad(`Password must be at least ${MIN_PASSWORD} characters`);
}

/** File-backed users, roles and audit log. Single process, synchronous writes, atomic replace. */
export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const usersFile = path.join(dir, 'users.json');
  const auditFile = path.join(dir, 'audit.jsonl');

  const load = () => {
    try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { return { users: {}, roles: {} }; }
  };
  const save = (data) => {
    const tmp = `${usersFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, usersFile);
  };

  let lastHashCache;
  const readLines = () => { try { return fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  const lastHash = () => {
    if (lastHashCache !== undefined) return lastHashCache;
    const l = readLines().at(-1);
    let h = '';
    try { h = (l && JSON.parse(l).h) || ''; } catch { /* keep empty */ }
    lastHashCache = h;
    return h;
  };

  const permissionsFor = (data, role) => (BUILTIN_ROLES[role] || (data.roles[role] && data.roles[role].permissions) || []);
  const publicUser = (u) => ({ name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt, zones: u.zones || [], resources: u.resources || {}, totp: !!(u.totp && u.totp.enabled), sso: !!u.oidc });
  const activeAdmins = (data, exceptName) => Object.values(data.users).filter((u) => u.name !== exceptName && !u.disabled && permissionsFor(data, u.role).includes('*')).length;

  return {
    isEmpty: () => Object.keys(load().users).length === 0,
    getUser: (name) => load().users[name] || null,
    permissionsFor: (role) => permissionsFor(load(), role),
    listUsers: () => Object.values(load().users).map(publicUser).sort((a, b) => a.name.localeCompare(b.name)),

    /** @param {{ name: string, password: string, role: string, zones?: string[], resources?: any }} u */
    createUser({ name, password, role, zones, resources }) {
      const data = load();
      name = String(name || '').trim().toLowerCase();
      if (!USER_RE.test(name)) throw bad('Username: 2-32 characters, a-z 0-9 . _ -');
      if (data.users[name]) throw new HttpError(409, 'That username already exists');
      checkPassword(password);
      if (!permissionsFor(data, role).length) throw bad('Unknown role');
      data.users[name] = { name, hash: hashPassword(password), role, disabled: false, createdAt: new Date().toISOString(), zones: checkZones(zones), resources: checkResources(resources) };
      save(data);
      return publicUser(data.users[name]);
    },

    updateUser(name, { role, disabled, password, zones, resources, resetTotp }) {
      const data = load();
      const u = data.users[name];
      if (!u) throw new HttpError(404, 'No such user');
      const nextRole = role === undefined ? u.role : role;
      if (!permissionsFor(data, nextRole).length) throw bad('Unknown role');
      const nextDisabled = disabled === undefined ? !!u.disabled : !!disabled;
      const stillAdmin = permissionsFor(data, nextRole).includes('*') && !nextDisabled;
      if (!stillAdmin && permissionsFor(data, u.role).includes('*') && !u.disabled && activeAdmins(data, name) === 0) {
        throw new HttpError(409, 'There must be at least one active admin');
      }
      u.role = nextRole;
      u.disabled = nextDisabled;
      if (password !== undefined) { checkPassword(password); u.hash = hashPassword(password); }
      if (zones !== undefined) u.zones = checkZones(zones);
      if (resources !== undefined) u.resources = checkResources(resources);
      if (resetTotp) delete u.totp;
      save(data);
      return publicUser(u);
    },

    deleteUser(name) {
      const data = load();
      const u = data.users[name];
      if (!u) throw new HttpError(404, 'No such user');
      if (permissionsFor(data, u.role).includes('*') && !u.disabled && activeAdmins(data, name) === 0) throw new HttpError(409, 'There must be at least one active admin');
      delete data.users[name];
      save(data);
    },

    /**
     * Create or refresh a user from a verified identity token. The role follows the identity provider on every
     * sign-in. A local account with the same name, or one linked to a different identity, is never taken over.
     */
    upsertSsoUser({ name, sub, issuer, email, role }) {
      const data = load();
      let u = data.users[name];
      if (u && !(u.oidc && u.oidc.sub === sub && u.oidc.issuer === issuer)) throw new HttpError(409, 'A different account already uses this username');
      if (!u) {
        u = data.users[name] = { name, role, disabled: false, createdAt: new Date().toISOString(), zones: [], oidc: { sub, issuer, email } };
      } else if (u.role !== role) {
        const wasAdmin = permissionsFor(data, u.role).includes('*');
        if (wasAdmin && !permissionsFor(data, role).includes('*') && !u.disabled && activeAdmins(data, name) === 0) throw new HttpError(409, 'There must be at least one active admin');
        u.role = role;
      }
      u.oidc = { sub, issuer, email };
      save(data);
      return { ...u };
    },

    /** Two-factor state lives on the user record; secrets never leave the server except once at setup. */
    totpBegin(name, secret) {
      const data = load(); const u = data.users[name];
      if (!u) throw new HttpError(404, 'No such user');
      if (u.totp && u.totp.enabled) throw new HttpError(409, 'Two-factor sign-in is already on');
      u.totp = { secret, enabled: false };
      save(data);
    },
    totpEnable(name, recoveryHashes, lastStep) {
      const data = load(); const u = data.users[name];
      u.totp = { ...u.totp, enabled: true, recovery: recoveryHashes, lastStep };
      save(data);
    },
    totpStep(name, lastStep) {
      const data = load(); const u = data.users[name];
      if (u && u.totp) { u.totp.lastStep = lastStep; save(data); }
    },
    totpUseRecovery(name, hash) {
      const data = load(); const u = data.users[name];
      const list = (u && u.totp && u.totp.recovery) || [];
      if (!list.includes(hash)) return false;
      u.totp.recovery = list.filter((h) => h !== hash);
      save(data);
      return true;
    },
    totpDisable(name) {
      const data = load(); const u = data.users[name];
      if (u) { delete u.totp; save(data); }
    },

    listRoles() {
      const data = load();
      const out = Object.entries(BUILTIN_ROLES).map(([name, permissions]) => ({ name, permissions, builtin: true }));
      for (const [name, r] of Object.entries(data.roles)) out.push({ name, permissions: r.permissions, builtin: false });
      return out;
    },

    saveRole({ name, permissions }) {
      const data = load();
      name = String(name || '').trim().toLowerCase();
      if (!ROLE_RE.test(name)) throw bad('Role name: 2-32 characters, a-z 0-9 _ -');
      if (BUILTIN_ROLES[name]) throw bad('Built-in roles cannot be changed');
      if (!validPermissions(permissions) || !permissions.length) throw bad(`Choose permissions from: ${Object.keys(PERMISSIONS).join(', ')}`);
      data.roles[name] = { permissions: [...new Set(permissions)] };
      save(data);
      return { name, permissions: data.roles[name].permissions, builtin: false };
    },

    deleteRole(name) {
      const data = load();
      if (BUILTIN_ROLES[name]) throw bad('Built-in roles cannot be deleted');
      if (!data.roles[name]) throw new HttpError(404, 'No such role');
      if (Object.values(data.users).some((u) => u.role === name)) throw new HttpError(409, 'Users still have this role');
      delete data.roles[name];
      save(data);
    },

    /** Each line carries the hash of the line before it, so editing or deleting history is detectable. */
    audit(entry) {
      try {
        const prev = lastHash();
        const body = JSON.stringify(entry);
        const h = crypto.createHash('sha256').update(prev + body).digest('hex');
        fs.appendFileSync(auditFile, `${JSON.stringify({ ...entry, prev, h })}\n`, { mode: 0o600 });
        lastHashCache = h;
      } catch { /* auditing must never break a request */ }
    },
    auditVerify() {
      let prev = null;
      let n = 0;
      for (const line of readLines()) {
        let e;
        try { e = JSON.parse(line); } catch { return { ok: false, entries: n, brokenAt: n + 1 }; }
        const { prev: p, h, ...entry } = e;
        if (h === undefined) { n += 1; continue; } // entries written before chaining was added
        if ((prev !== null && p !== prev) || crypto.createHash('sha256').update(String(p) + JSON.stringify(entry)).digest('hex') !== h) return { ok: false, entries: n, brokenAt: n + 1 };
        prev = h;
        n += 1;
      }
      return { ok: true, entries: n };
    },
    auditExport: () => readLines().join('\n') + (readLines().length ? '\n' : ''),
    /** Drop entries older than the retention window. The remaining chain still verifies. */
    auditPrune(days) {
      if (!(days > 0)) return 0;
      const cutoff = Date.now() - days * 86400000;
      const lines = readLines();
      const keep = lines.filter((l) => { try { return new Date(JSON.parse(l).t).getTime() >= cutoff; } catch { return true; } });
      if (keep.length === lines.length) return 0;
      fs.writeFileSync(auditFile, keep.length ? `${keep.join('\n')}\n` : '', { mode: 0o600 });
      lastHashCache = undefined;
      return lines.length - keep.length;
    },
    auditTail(limit = 100) {
      try {
        const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    }
  };
}

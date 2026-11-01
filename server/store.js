import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, bad } from './errors.js';
import { BUILTIN_ROLES, PERMISSIONS, validPermissions } from './rbac.js';

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

  const permissionsFor = (data, role) => (BUILTIN_ROLES[role] || (data.roles[role] && data.roles[role].permissions) || []);
  const publicUser = (u) => ({ name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt });
  const activeAdmins = (data, exceptName) => Object.values(data.users).filter((u) => u.name !== exceptName && !u.disabled && permissionsFor(data, u.role).includes('*')).length;

  return {
    isEmpty: () => Object.keys(load().users).length === 0,
    getUser: (name) => load().users[name] || null,
    permissionsFor: (role) => permissionsFor(load(), role),
    listUsers: () => Object.values(load().users).map(publicUser).sort((a, b) => a.name.localeCompare(b.name)),

    createUser({ name, password, role }) {
      const data = load();
      name = String(name || '').trim().toLowerCase();
      if (!USER_RE.test(name)) throw bad('Username: 2-32 characters, a-z 0-9 . _ -');
      if (data.users[name]) throw new HttpError(409, 'That username already exists');
      checkPassword(password);
      if (!permissionsFor(data, role).length) throw bad('Unknown role');
      data.users[name] = { name, hash: hashPassword(password), role, disabled: false, createdAt: new Date().toISOString() };
      save(data);
      return publicUser(data.users[name]);
    },

    updateUser(name, { role, disabled, password }) {
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

    audit(entry) {
      try { fs.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); } catch { /* auditing must never break a request */ }
    },
    auditTail(limit = 100) {
      try {
        const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    }
  };
}

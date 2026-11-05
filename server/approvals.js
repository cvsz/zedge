import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PENDING_HOURS = 24;
const APPROVED_MINUTES = 30;

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
export const fingerprint = (method, p, body) => crypto.createHash('sha256').update(`${method} ${p}\n${stable(body === undefined ? null : body)}`).digest('hex');

/**
 * Actions that are hard or impossible to undo. Returns a short human label, or null for anything else.
 * Matches on the console's own API path, so it covers both the pass-through and the dedicated routes.
 */
export function riskLabel(method, p, body) {
  const b = body || {};
  let m;
  if (method === 'POST' && /^\/api\/cf\/zones\/[^/]+\/purge_cache$/.test(p) && b.purge_everything === true) return 'Purge the entire cache';
  if (method === 'PATCH' && /^\/api\/cf\/zones\/[^/]+\/dnssec$/.test(p) && b.status === 'disabled') return 'Disable DNSSEC';
  if (method === 'DELETE' && (m = p.match(/^\/api\/cf\/accounts\/[^/]+\/storage\/kv\/namespaces\/[^/]+$/))) return 'Delete a KV namespace and all its keys';
  if (method === 'DELETE' && /^\/api\/cf\/accounts\/[^/]+\/d1\/database\/[^/]+$/.test(p)) return 'Delete a D1 database';
  if (method === 'DELETE' && /^\/api\/cf\/accounts\/[^/]+\/queues\/[^/]+$/.test(p)) return 'Delete a queue';
  if (method === 'POST' && /^\/api\/d1\/[^/]+\/query$/.test(p) && b.allowWrite === true) return 'Run a changing SQL statement on D1';
  if (method === 'POST' && /^\/api\/zones\/[^/]+\/snapshots\/[^/]+\/restore$/.test(p) && b.confirm === true && b.deleteExtra === true) return 'Restore a snapshot and delete newer DNS records';
  if (method === 'DELETE' && /^\/api\/cf\/certificates\/[^/]+$/.test(p)) return 'Revoke an Origin CA certificate';
  return null;
}

export function createApprovals(dir) {
  const file = path.join(dir, 'approvals.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const save = (list) => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  /** Mark stale entries expired, drop old finished ones. */
  const tidy = (list) => {
    const now = Date.now();
    for (const a of list) {
      if (a.status === 'pending' && now - Date.parse(a.createdAt) > PENDING_HOURS * 3600000) a.status = 'expired';
      if (a.status === 'approved' && now > Date.parse(a.expiresAt)) a.status = 'expired';
    }
    return list.filter((a) => now - Date.parse(a.createdAt) < 14 * 86400000).slice(-200);
  };
  const all = () => { const l = tidy(load()); return l; };

  return {
    list: all,
    get: (id) => all().find((a) => a.id === id) || null,
    create({ requester, label, method, path: p, body }) {
      const list = all();
      const existing = list.find((a) => a.requester === requester && a.status === 'pending' && a.fingerprint === fingerprint(method, p, body));
      if (existing) return existing;
      const a = { id: crypto.randomBytes(6).toString('hex'), requester, label, method, path: p, body: body === undefined ? null : body, fingerprint: fingerprint(method, p, body), status: 'pending', createdAt: new Date().toISOString() };
      list.push(a); save(list);
      return a;
    },
    decide(id, { by, approve, note }) {
      const list = all();
      const a = list.find((x) => x.id === id);
      if (!a || a.status !== 'pending') return null;
      a.status = approve ? 'approved' : 'rejected';
      a.decidedBy = by; a.decidedAt = new Date().toISOString(); a.note = String(note || '').slice(0, 200);
      if (approve) a.expiresAt = new Date(Date.now() + APPROVED_MINUTES * 60000).toISOString();
      save(list);
      return a;
    },
    cancel(id, requester) {
      const list = all();
      const a = list.find((x) => x.id === id && x.requester === requester && ['pending', 'approved'].includes(x.status));
      if (!a) return null;
      a.status = 'cancelled'; save(list);
      return a;
    },
    /** One use only, by the same user, for exactly the same request. */
    redeem(id, { user, method, path: p, body }) {
      const list = all();
      const a = list.find((x) => x.id === id);
      if (!a) return { ok: false, why: 'No such approval' };
      if (a.requester !== user) return { ok: false, why: 'This approval belongs to someone else' };
      if (a.status !== 'approved') return { ok: false, why: a.status === 'pending' ? 'This approval has not been granted yet' : `This approval is ${a.status}` };
      if (a.fingerprint !== fingerprint(method, p, body)) return { ok: false, why: 'This approval is for a different request' };
      a.status = 'used'; a.usedAt = new Date().toISOString(); save(list);
      return { ok: true, approval: a };
    }
  };
}

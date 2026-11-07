import crypto from 'node:crypto';
import { canonical } from '@affiliate-os/db';

export const GENESIS = '0'.repeat(64);
const hashEntry = (e) => crypto.createHash('sha256').update(canonical({ organization_id: e.organization_id, seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, subject_type: e.subject_type ?? null, subject_id: e.subject_id ?? null, detail: e.detail || {}, prev_hash: e.prev_hash })).digest('hex');

/**
 * Append one entry to the organization's chain inside the caller's transaction, so the change and its audit record
 * commit together or not at all. An advisory lock keeps two writers from taking the same sequence number.
 * Never put secrets or request bodies in `detail`.
 */
export async function append(q, { actor, action, subject_type = null, subject_id = null, detail = {} }, now = () => new Date()) {
  await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [q.organizationId]);
  const last = (await q.query('SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1')).rows[0];
  const e = { organization_id: q.organizationId, seq: last ? Number(last.seq) + 1 : 1, ts: now().toISOString(), actor, action, subject_type, subject_id: subject_id === null ? null : String(subject_id), detail, prev_hash: last ? last.hash : GENESIS };
  e.hash = hashEntry(e);
  await q.query('INSERT INTO audit_entries (organization_id, seq, ts, actor, action, subject_type, subject_id, detail, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [e.organization_id, e.seq, e.ts, e.actor, e.action, e.subject_type, e.subject_id, JSON.stringify(e.detail), e.prev_hash, e.hash]);
  return e;
}

/**
 * Walk the whole chain. `anchor` is a { seq, hash } the operator stored elsewhere earlier: it also catches a truncated tail,
 * which a chain alone cannot show.
 */
export async function verify(q, { anchor } = {}) {
  const rows = (await q.query('SELECT * FROM audit_entries ORDER BY seq')).rows;
  let prev = GENESIS;
  let expected = 1;
  for (const r of rows) {
    const e = { organization_id: r.organization_id, seq: Number(r.seq), ts: new Date(r.ts).toISOString(), actor: r.actor, action: r.action, subject_type: r.subject_type, subject_id: r.subject_id, detail: r.detail, prev_hash: r.prev_hash };
    if (e.seq !== expected) {return { ok: false, count: rows.length, brokenAt: expected, reason: 'sequence gap (an entry is missing)' };}
    if (r.prev_hash !== prev) {return { ok: false, count: rows.length, brokenAt: e.seq, reason: 'chain link does not match the previous entry' };}
    if (hashEntry(e) !== r.hash) {return { ok: false, count: rows.length, brokenAt: e.seq, reason: 'entry content does not match its hash' };}
    prev = r.hash; expected += 1;
  }
  if (anchor) {
    const hit = rows.find((r) => Number(r.seq) === anchor.seq);
    if (!hit || hit.hash !== anchor.hash) {return { ok: false, count: rows.length, brokenAt: anchor.seq, reason: 'the anchored entry is missing or changed (the log was truncated or rewritten)' };}
  }
  return { ok: true, count: rows.length, head: rows.length ? { seq: Number(rows.at(-1).seq), hash: rows.at(-1).hash } : null };
}

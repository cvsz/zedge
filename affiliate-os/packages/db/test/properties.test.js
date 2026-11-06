import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory, createMigrator, provisionOrganization, scoped, costs, hashOf, canonical } from '../src/index.js';

// Tiny seeded PRNG so a failing run can be reproduced from the printed seed.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.floor(r() * a.length)];

let db; before(async () => { db = await openMemory(); await createMigrator(db).up(); }); after(async () => { await db.close(); });

test('ledger invariants hold for random spend sequences (seeded)', async () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const r = rng(seed); const org = await provisionOrganization(db, `prop-${seed}`); const s = scoped(db, org);
    const cats = ['llm', 'storage', 'media']; const total = 200 + Math.floor(r() * 800); const per = Math.floor(total / 2);
    await s.tx(async (q) => { await costs.setBudget(q, { period_minor: total, currency: 'USD' }); await costs.setBudget(q, { category: 'llm', period_minor: per, currency: 'USD' }); });
    const ops = Array.from({ length: 30 }, () => ({ category: pick(r, cats), amount_minor: Math.floor(r() * 120), currency: 'USD', idempotency_key: `k${Math.floor(r() * 18)}` }));
    const run = async () => { const out = []; for (const o of ops) { try { out.push((await s.tx((q) => costs.record(q, o, () => new Date('2026-10-10')))).recorded); } catch { out.push('refused'); } } return out; };
    const first = await run();
    const sum1 = await s.tx((q) => costs.summary(q, '2026-10'));
    assert.ok(sum1.total_minor <= total, `seed ${seed}: total ${sum1.total_minor} exceeds budget ${total}`);
    assert.ok((sum1.by_category.llm || 0) <= per, `seed ${seed}: llm over its budget`);
    const second = await run();                                     // the whole sequence again: nothing new may be recorded
    const sum2 = await s.tx((q) => costs.summary(q, '2026-10'));
    assert.deepEqual(sum2, sum1, `seed ${seed}: replay changed the ledger`);
    assert.ok(second.every((x) => x !== true), `seed ${seed}: a replayed key was recorded twice`);
    assert.equal(first.filter((x) => x === true).length, (await s.query('SELECT count(*) AS n FROM cost_entries')).rows[0].n * 1, `seed ${seed}: entries differ from accepted ops`);
  }
});

test('hashOf ignores key order and separates different values (seeded)', () => {
  const r = rng(7);
  const val = (d = 0) => { const k = r(); if (d > 2 || k < 0.3) return Math.floor(r() * 5); if (k < 0.5) return pick(r, ['a', 'b', 'ก', '']); if (k < 0.7) return [val(d + 1), val(d + 1)]; return Object.fromEntries(['x', 'y', 'z'].filter(() => r() < 0.7).map((key) => [key, val(d + 1)])); };
  const shuffle = (v) => (Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)])) : v);
  const seen = new Map();
  for (let i = 0; i < 300; i += 1) {
    const v = val(); assert.equal(hashOf(shuffle(v)), hashOf(v), 'key order must not matter');
    const c = canonical(v), h = hashOf(v);
    if (seen.has(h)) assert.equal(seen.get(h), c, 'different canonical forms must not share a hash'); else seen.set(h, c);
  }
});

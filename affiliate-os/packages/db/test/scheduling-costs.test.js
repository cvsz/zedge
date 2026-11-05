import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory, createMigrator, provisionOrganization, scoped, repos, costs } from '../src/index.js';

let db, A, B, sa, sb;
before(async () => { db = await openMemory(); await createMigrator(db).up(); A = await provisionOrganization(db, 'A'); B = await provisionOrganization(db, 'B'); sa = scoped(db, A); sb = scoped(db, B); });
after(async () => { await db.close(); });
const mk = (q, status = 'APPROVED') => repos.content.create(q, { language: 'en', format: 'text', caption: 'c', disclosure: '#ad', status });

test('scheduling: only approved content, only in the future, a SCHEDULED row always has a date', async () => {
  const when = new Date(Date.now() + 86400000).toISOString();
  const c = await sa.tx((q) => mk(q)); const idea = await sa.tx((q) => mk(q, 'IDEA'));
  assert.equal(await sa.tx((q) => repos.content.schedule(q, idea.id, when)), 0, 'an idea cannot be scheduled');
  await assert.rejects(sa.tx((q) => repos.content.schedule(q, c.id, '2000-01-01')), /future/);
  await assert.rejects(sa.tx((q) => repos.content.schedule(q, c.id, 'tomorrow-ish')), /not a date/);
  assert.equal(await sa.tx((q) => repos.content.schedule(q, c.id, when)), 1);
  const row = await sa.tx((q) => repos.content.get(q, c.id));
  assert.equal(row.status, 'SCHEDULED'); assert.equal(new Date(row.scheduled_for).toISOString(), when);
  await assert.rejects(sa.tx((q) => q.query("UPDATE content SET scheduled_for = NULL WHERE id = $1", [c.id])), /content_scheduled_has_date|check/i);
  assert.equal(await sb.tx((q) => repos.content.unschedule(q, c.id)), 0, 'another organization cannot touch it');
  assert.equal(await sa.tx((q) => repos.content.unschedule(q, c.id)), 1);
  assert.equal((await sa.tx((q) => repos.content.get(q, c.id))).scheduled_for, null);
});

test('cost ledger persists, is idempotent, enforces budgets per category and overall, per org and per month', async () => {
  let d = new Date('2026-10-15');
  const now = () => d;
  await sa.tx(async (q) => { await costs.setBudget(q, { category: 'llm', period_minor: 1000, currency: 'USD' }); await costs.setBudget(q, { period_minor: 1500, currency: 'USD' }); });
  const rec = (s, r) => s.tx((q) => costs.record(q, r, now));
  assert.equal((await rec(sa, { category: 'llm', amount_minor: 600, currency: 'USD', idempotency_key: 'k1' })).recorded, true);
  assert.equal((await rec(sa, { category: 'llm', amount_minor: 600, currency: 'USD', idempotency_key: 'k1' })).duplicate, true);
  await assert.rejects(rec(sa, { category: 'llm', amount_minor: 500, currency: 'USD', idempotency_key: 'k2' }), /budget exceeded for llm/);
  assert.equal((await rec(sa, { category: 'storage', amount_minor: 800, currency: 'USD', idempotency_key: 'k3' })).recorded, true);
  await assert.rejects(rec(sa, { category: 'storage', amount_minor: 200, currency: 'USD', idempotency_key: 'k4' }), /budget exceeded for \*/);
  await assert.rejects(rec(sa, { category: 'llm', amount_minor: 1.5, currency: 'USD', idempotency_key: 'k5' }), /integer/);
  await assert.rejects(rec(sa, { category: 'llm', amount_minor: 1, currency: 'EUR', idempotency_key: 'k6' }), /budget currency/);
  assert.equal((await rec(sb, { category: 'llm', amount_minor: 99999, currency: 'USD', idempotency_key: 'k1' })).recorded, true, 'other org: its own budgets and keys');
  assert.deepEqual(await sa.tx((q) => costs.summary(q, '2026-10')), { period: '2026-10', by_category: { llm: 600, storage: 800 }, total_minor: 1400 });
  d = new Date('2026-11-02');
  assert.equal((await rec(sa, { category: 'llm', amount_minor: 900, currency: 'USD', idempotency_key: 'k7' })).recorded, true, 'new month, new period');
  assert.equal((await sb.tx((q) => costs.summary(q, '2026-10'))).total_minor, 99999, 'summaries are tenant-scoped');
});

test('cost ledger: concurrent spends cannot both slip under a budget; entries cannot be edited or deleted', async () => {
  const org = await provisionOrganization(db, 'race'); const s = scoped(db, org);
  await s.tx((q) => costs.setBudget(q, { category: 'llm', period_minor: 100, currency: 'USD' }));
  const r = await Promise.allSettled([60, 60, 60].map((n, i) => s.tx((q) => costs.record(q, { category: 'llm', amount_minor: n, currency: 'USD', idempotency_key: `c${i}` }))));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  await assert.rejects(s.tx((q) => q.query('UPDATE cost_entries SET amount_minor = 0')), /permission denied/);
  await assert.rejects(s.tx((q) => q.query('DELETE FROM cost_entries')), /permission denied/);
});

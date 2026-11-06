import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openMemory, createMigrator, provisionOrganization, scoped, repos } from '@affiliate-os/db';
import { makeEvent } from '@affiliate-os/contracts';
import { eventPayloads } from '@affiliate-os/contracts/src/examples.js';
import { publish, relay, createConsumer } from '../src/index.js';

let db, A, B, sa;
before(async () => { db = await openMemory(); await createMigrator(db).up(); A = await provisionOrganization(db, 'A'); B = await provisionOrganization(db, 'B'); sa = scoped(db, A); scoped(db, B); });
after(async () => { await db.close(); });
const ev = (org, type = 'ClickRecorded', payload = eventPayloads[type]) => makeEvent({ type, organization_id: org, payload });
const count = async (s, table, where = '') => Number((await s.query(`SELECT count(*) AS n FROM ${table} ${where}`)).rows[0].n);

test('outbox: the event commits with the business change, or not at all', async () => {
  const e1 = ev(A);
  await sa.tx(async (q) => { await repos.brands.create(q, { name: 'Outbox ok' }); await publish(q, e1); });
  assert.equal(await count(sa, 'outbox', `WHERE event_id = '${e1.id}'`), 1);
  const e2 = ev(A);
  await assert.rejects(sa.tx(async (q) => { await repos.brands.create(q, { name: 'Outbox ok' }); await publish(q, e2); }), /unique|duplicate/);   // second insert fails -> whole tx rolls back
  assert.equal(await count(sa, 'outbox', `WHERE event_id = '${e2.id}'`), 0, 'no event for a change that did not happen');
  await assert.rejects(sa.tx((q) => publish(q, { ...ev(A), payload: { nope: 1 } })), /invalid/);
  await assert.rejects(sa.tx((q) => publish(q, ev(B))), /organization of the current transaction/);
  await sa.tx(async (q) => { await publish(q, e1); });
  assert.equal(await count(sa, 'outbox', `WHERE event_id = '${e1.id}'`), 1, 'publishing the same event id twice stores it once');
});

test('relay delivers in order, retries failures without losing or reordering, and marks published only after delivery', async () => {
  const org = await provisionOrganization(db, 'relay');
  const s = scoped(db, org);
  const evs = [ev(org, 'ProductRanked'), ev(org, 'CampaignCreated'), ev(org, 'ClickRecorded')];
  await s.tx(async (q) => { for (const e of evs) await publish(q, e); });
  const got = [];
  let fail = true;
  const deliver = async (e) => { if (e.type === 'CampaignCreated' && fail) throw new Error('queue down'); got.push(e.type); };
  let r = await relay(db, org, deliver);
  assert.deepEqual([r.sent, !!r.failed], [1, true]);
  assert.deepEqual(got, ['ProductRanked'], 'a failing event stops the batch, later ones do not overtake it');
  assert.equal((await s.query('SELECT last_error, attempts FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 1')).rows[0].last_error, 'queue down');
  fail = false;
  r = await relay(db, org, deliver);
  assert.equal(r.sent, 2);
  assert.deepEqual(got, ['ProductRanked', 'CampaignCreated', 'ClickRecorded']);
  assert.equal(await count(s, 'outbox', 'WHERE published_at IS NULL'), 0);
  assert.equal((await relay(db, org, deliver)).sent, 0);
  // gives up loudly instead of retrying forever
  const e = ev(org, 'ProductRanked'); await s.tx((q) => publish(q, e));
  const bad = async () => { throw new Error('nope'); };
  for (let i = 0; i < 3; i += 1) await relay(db, org, bad, { maxAttempts: 3 });
  assert.ok((await relay(db, org, bad, { maxAttempts: 3 })).stuck, 'reported as stuck for a human');
  assert.equal(await count(s, 'outbox', 'WHERE published_at IS NULL'), 1, 'still there, nothing dropped');
});

test('relay only sees its own organization', async () => {
  const org1 = await provisionOrganization(db, 'r1'); const org2 = await provisionOrganization(db, 'r2');
  await scoped(db, org1).tx((q) => publish(q, ev(org1)));
  const seen = [];
  await relay(db, org2, async (e) => seen.push(e));
  assert.deepEqual(seen, []);
  await relay(db, org1, async (e) => seen.push(e.organization_id));
  assert.deepEqual(seen, [org1]);
});

test('consumer: duplicate delivery causes no duplicate effect', async () => {
  const effects = [];
  const c = createConsumer({ db, name: 'dup-test', handlers: { CampaignCreated: async (q, e) => { effects.push(e.id); await repos.brands.create(q, { name: `brand-${e.id}` }); } } });
  const e = ev(A, 'CampaignCreated');
  assert.equal(await c.consume(A, e), 'processed');
  assert.equal(await c.consume(A, e), 'duplicate');
  assert.equal(await c.consume(A, e), 'duplicate');
  assert.equal(effects.length, 1);
  assert.equal(await count(sa, 'brands', `WHERE name = 'brand-${e.id}'`), 1);
  // a different consumer has its own record
  const other = createConsumer({ db, name: 'dup-other', handlers: { CampaignCreated: async () => effects.push('other') } });
  assert.equal(await other.consume(A, e), 'processed');
  // unknown event types are ignored, not dead-lettered
  assert.equal(await c.consume(A, ev(A, 'ClickRecorded')), 'ignored');
});

test('consumer: a failing handler leaves no partial effects, retries, then dead-letters with its error', async () => {
  let n = 0;
  const c = createConsumer({ db, name: 'poison', maxAttempts: 3, handlers: { CampaignCreated: async (q, e) => { await repos.brands.create(q, { name: `half-${e.id}` }); n += 1; throw new Error('boom: bad data'); } } });
  const e = ev(A, 'CampaignCreated');
  assert.equal(await c.consume(A, e), 'retry');
  assert.equal(await c.consume(A, e), 'retry');
  assert.equal(await c.consume(A, e), 'dead');
  assert.equal(n, 3);
  assert.equal(await count(sa, 'brands', `WHERE name = 'half-${e.id}'`), 0, 'the half-done work was rolled back each time');
  const dl = await c.deadLetters(A);
  assert.equal(dl.length, 1);
  assert.match(dl[0].error, /boom: bad data/);
  assert.equal(dl[0].attempts, 3);
  assert.equal(await c.consume(A, e), 'dead', 'a dead event is not retried again behind your back');
  assert.equal(n, 3);
});

test('consumer: invalid and foreign events go straight to the dead-letter queue', async () => {
  const c = createConsumer({ db, name: 'strict', handlers: { ClickRecorded: async () => { throw new Error('should not run'); } } });
  assert.equal(await c.consume(A, { ...ev(A), payload: { ip: '203.0.113.9' } }), 'dead');
  assert.equal(await c.consume(A, ev(B)), 'dead');
  assert.equal(await c.consume(A, 'garbage'), 'dead');
  const dl = await c.deadLetters(A);
  assert.equal(dl.length, 3);
  assert.ok(dl.some((d) => /invalid event/.test(d.error)) && dl.some((d) => /different organization/.test(d.error)));
  assert.equal((await c.deadLetters(B)).length, 0, 'the other organization sees none of it');
});

test('replay: after the fix, dead letters run once and are marked replayed', async () => {
  let broken = true;
  const effects = [];
  const c = createConsumer({ db, name: 'replayable', maxAttempts: 1, handlers: { CampaignCreated: async (q, e) => { if (broken) throw new Error('bug'); effects.push(e.id); } } });
  const e1 = ev(A, 'CampaignCreated'); const e2 = ev(A, 'CampaignCreated');
  assert.equal(await c.consume(A, e1), 'dead');
  assert.equal(await c.consume(A, e2), 'dead');
  assert.deepEqual(await c.replay(A), { replayed: 0, failed: 2 }, 'still broken: stay in the queue');
  broken = false;
  const only = (await c.deadLetters(A))[0].id;
  assert.deepEqual(await c.replay(A, { ids: [only] }), { replayed: 1, failed: 0 });
  assert.deepEqual(await c.replay(A), { replayed: 1, failed: 0 });
  assert.deepEqual(await c.replay(A), { replayed: 0, failed: 0 }, 'nothing left, and nothing runs twice');
  assert.equal(effects.length, 2);
  assert.equal(await c.consume(A, e1), 'duplicate', 'a replayed event is remembered as processed');
  assert.ok((await c.deadLetters(A)).every((d) => d.replayed_at));
  assert.deepEqual(await c.replay(B), { replayed: 0, failed: 0 }, 'another organization cannot replay yours');
});

test('end to end: outbox -> relay -> consumer, delivered twice, effect once', async () => {
  const org = await provisionOrganization(db, 'e2e'); const s = scoped(db, org);
  const seen = [];
  const consumer = createConsumer({ db, name: 'e2e', handlers: { ProductRanked: async (q, e) => seen.push(e.payload.score) } });
  await s.tx((q) => publish(q, ev(org, 'ProductRanked')));
  const deliver = async (e) => { await consumer.consume(org, e); await consumer.consume(org, e); };   // at-least-once: a duplicate on purpose
  await relay(db, org, deliver);
  assert.deepEqual(seen, [0.72]);
});

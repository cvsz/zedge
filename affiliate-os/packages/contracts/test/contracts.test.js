import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateEvent, validateEntity, makeEvent, EVENT_TYPES, ENTITIES, loadSchemas, createValidator } from '../src/index.js';
import { envelope, entities, eventPayloads, ids } from '../src/examples.js';
import { compare, currentState, LOCK_FILE } from '../src/lock.js';
import { checkSchema } from '../src/validate.js';

// ---------------------------------------------------------------- coverage: every event in ARCHITECTURE §4 has a schema
test('all 14 events from the architecture have a schema and a valid example', () => {
  const expected = ['ProductDiscovered', 'ProductRanked', 'CampaignCreated', 'CreativeRequested', 'CreativeGenerated', 'CreativeApproved', 'ContentScheduled', 'ContentPublished', 'ContentFailed', 'ClickRecorded', 'ConversionRecorded', 'CommissionRecorded', 'PerformanceWindowCompleted', 'OptimizationRequested'];
  assert.deepEqual([...EVENT_TYPES].sort(), [...expected].sort());
  assert.deepEqual(Object.keys(eventPayloads).sort(), [...expected].sort());
  for (const type of expected) {
    const r = validateEvent(envelope(type));
    assert.ok(r.valid, `${type}: ${r.errors.join('; ')}`);
  }
});

test('every entity has a valid example', () => {
  for (const name of ENTITIES) { const r = validateEntity(name, entities[name]); assert.ok(r.valid, `${name}: ${r.errors.join('; ')}`); }
});

test('the architecture list and the doc list stay in step', () => {
  const arch = fs.readFileSync(new URL('../../../ARCHITECTURE.md', import.meta.url), 'utf8');
  const line = arch.split('\n').find((l) => l.includes('ProductDiscovered'));
  const listed = [...line.matchAll(/[A-Z][A-Za-z]+/g)].map((m) => m[0]).filter((n) => EVENT_TYPES.includes(n));
  assert.deepEqual([...new Set(listed)].sort(), [...EVENT_TYPES].sort());
});

// ---------------------------------------------------------------- invalid examples fail, with a useful reason
const bad = (type, mutate) => { const e = envelope(type); mutate(e); return validateEvent(e); };

test('envelope problems are rejected', () => {
  assert.match(bad('ProductRanked', (e) => { delete e.organization_id; }).errors[0], /organization_id/);
  assert.match(bad('ProductRanked', (e) => { e.id = 'not-a-uuid'; }).errors[0], /uuid/);
  assert.match(bad('ProductRanked', (e) => { e.type = 'Nope'; }).errors[0], /one of/);
  assert.match(bad('ProductRanked', (e) => { e.version = 0; }).errors[0], /below 1/);
  assert.match(bad('ProductRanked', (e) => { e.occurred_at = '2026-13-45'; }).errors[0], /date-time/);
  assert.match(bad('ProductRanked', (e) => { e.extra = 1; }).errors[0], /unknown field "extra"/);
  assert.match(bad('ProductRanked', (e) => { e.version = 9; }).errors[0], /no schema for ProductRanked version 9/);
});

test('payload problems are rejected and point at the field', () => {
  assert.match(bad('ProductRanked', (e) => { e.payload.score = 1.5; }).errors[0], /payload\.score: above 1/);
  assert.match(bad('ProductRanked', (e) => { e.payload.basis = 'guessed'; }).errors[0], /basis/);
  assert.match(bad('ContentPublished', (e) => { e.payload.mode = 'telepathy'; }).errors[0], /mode/);
  assert.match(bad('ConversionRecorded', (e) => { e.payload.amount.amount_minor = 12.5; }).errors[0], /amount_minor: expected integer/);
  assert.match(bad('ConversionRecorded', (e) => { e.payload.amount.currency = 'baht'; }).errors[0], /currency/);
  assert.match(bad('ProductDiscovered', (e) => { e.payload.url = 'http://merchant.example'; }).errors[0], /uri-https/);
  assert.match(bad('ContentScheduled', (e) => { e.payload.idempotency_key = 'short'; }).errors[0], /shorter than 8/);
  assert.ok(!bad('PerformanceWindowCompleted', (e) => { e.payload.metrics.clicks = '120'; }).valid);
});

test('privacy by schema: a click event cannot carry an IP address or user agent', () => {
  assert.match(bad('ClickRecorded', (e) => { e.payload.ip = '203.0.113.9'; }).errors[0], /unknown field "ip"/);
  assert.match(bad('ClickRecorded', (e) => { e.payload.user_agent = 'Mozilla'; }).errors[0], /unknown field "user_agent"/);
  assert.match(bad('ClickRecorded', (e) => { e.payload.basis = 'modeled'; }).errors[0], /must equal "observed"/);
  assert.ok(!validateEntity('click', { ...entities.click, ip: '203.0.113.9' }).valid);
});

test('schemas forbid unknown fields on every object an outsider can send', () => {
  const walk = (s, where) => {
    if (s.type === 'object' && s.properties) assert.equal(s.additionalProperties, false, `${where} must set additionalProperties:false`);
    for (const [k, v] of Object.entries(s.properties || {})) walk(v, `${where}.${k}`);
    for (const [k, v] of Object.entries(s.$defs || {})) walk(v, `${where}.$defs.${k}`);
    if (s.items) walk(s.items, `${where}[]`);
  };
  for (const [name, s] of Object.entries(loadSchemas())) walk(s, name);
});

test('entities enforce their rules', () => {
  assert.ok(!validateEntity('link', { ...entities.link, disclosure: '' }).valid, 'a link must carry a disclosure');
  const { disclosure, ...noDisc } = entities.link; void disclosure;
  assert.ok(!validateEntity('link', noDisc).valid);
  assert.ok(!validateEntity('link', { ...entities.link, destination: 'http://insecure.example' }).valid, 'https only');
  assert.ok(!validateEntity('content', { ...entities.content, status: 'LIVE' }).valid);
  assert.ok(!validateEntity('content', { ...entities.content, claims: [{ text: 'Best ever' }] }).valid, 'a claim must name its product field');
  assert.ok(!validateEntity('publication', { ...entities.publication, status: 'DONE' }).valid);
  assert.ok(!validateEntity('approval-request', { ...entities['approval-request'], kind: 'whatever' }).valid);
  assert.throws(() => validateEntity('nope', {}), /Unknown entity/);
});

test('makeEvent fills the envelope and refuses invalid payloads', () => {
  const ev = makeEvent({ type: 'CampaignCreated', organization_id: ids.org, payload: eventPayloads.CampaignCreated });
  assert.equal(ev.version, 1);
  assert.match(ev.id, /^[0-9a-f-]{36}$/);
  assert.throws(() => makeEvent({ type: 'CampaignCreated', organization_id: ids.org, payload: { name: 'x' } }), /Invalid CampaignCreated/);
});

// ---------------------------------------------------------------- the validator itself
test('the validator rejects schemas with unknown keywords (a typo must not weaken a contract)', () => {
  assert.throws(() => checkSchema({ type: 'object', additionalProperites: false }), /unknown keyword "additionalProperites"/);
  assert.throws(() => createValidator({ x: { type: 'string', maxLenght: 3 } }), /unknown keyword/);
});

test('validator basics: types, oneOf, refs, formats', () => {
  const v = createValidator({
    a: { $defs: { n: { type: 'integer', minimum: 1 } }, type: 'object', properties: { x: { $ref: '#/$defs/n' }, y: { oneOf: [{ type: 'string' }, { type: 'integer' }] }, d: { type: 'string', format: 'date' } }, additionalProperties: false },
    b: { type: 'array', items: { $ref: 'a#/$defs/n' }, minItems: 1, maxItems: 2 }
  });
  assert.ok(v.validate('a', { x: 3, y: 'q', d: '2026-02-03' }).valid);
  assert.ok(!v.validate('a', { x: 0 }).valid);
  assert.ok(!v.validate('a', { y: true }).valid);
  assert.ok(!v.validate('a', { d: '2026-02-31x' }).valid);
  assert.ok(v.validate('b', [1, 2]).valid);
  assert.ok(!v.validate('b', []).valid && !v.validate('b', [1, 2, 3]).valid);
  assert.throws(() => v.validate('missing', 1), /Unknown schema/);
  assert.ok(!v.validate('b', ['x']).valid);
  const t = createValidator({ s: { type: ['string', 'null'] } });
  assert.ok(t.validate('s', null).valid && t.validate('s', 'x').valid && !t.validate('s', 1).valid);
});

// ---------------------------------------------------------------- backward compatibility
test('schemas only change with a version bump (lock file)', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  assert.deepEqual(compare(lock, currentState()), []);
});

test('the lock catches an unversioned edit, a removal and a downgrade', () => {
  const now = currentState();
  const lock = JSON.parse(JSON.stringify(now));
  const edited = JSON.parse(JSON.stringify(now));
  edited.link.hash = 'f'.repeat(64);
  assert.match(compare(lock, edited)[0], /link: changed without bumping x-version/);
  const bumped = JSON.parse(JSON.stringify(edited)); bumped.link.version = 2;
  assert.deepEqual(compare(lock, bumped), [], 'a version bump is accepted');
  const removed = JSON.parse(JSON.stringify(now)); delete removed.click;
  assert.match(compare(lock, removed)[0], /click: schema was removed/);
  const down = JSON.parse(JSON.stringify(now)); down.click.version = 0;
  assert.match(compare(lock, down)[0], /version went down/);
  const added = JSON.parse(JSON.stringify(now)); added.brandnew = { version: 1, hash: 'a' };
  assert.match(compare(lock, added)[0], /brandnew: new schema is not in the lock/);
});

test('old payloads keep validating: v1 examples are frozen fixtures', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/v1-envelopes.json', import.meta.url), 'utf8'));
  for (const env of fixture) { const r = validateEvent(env); assert.ok(r.valid, `${env.type}: ${r.errors.join('; ')}`); }
  assert.equal(fixture.length, 14);
});

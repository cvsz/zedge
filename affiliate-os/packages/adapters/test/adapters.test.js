import test from 'node:test';
import assert from 'node:assert/strict';
import { registry, statusOf, mayCallPlatform, staleness, checkRegistry, createManualAdapter, selectAdapter, parseCsv } from '../src/index.js';

const pub = { id: 'pub-1', provider: 'tiktok', capability: 'video.publish' };
const good = { publication: pub, content: { caption: 'Great find' }, link: { tracked_url: 'https://go.example/abc' }, disclosure: '#ad I earn a commission.', media: [{ filename: 'a.mp4', sha256: 'x' }] };

test('registry data is well-formed and nothing is verified', () => {
  assert.deepEqual(checkRegistry(), []);
  assert.ok(!Object.values(registry.providers).some((p) => Object.values(p.status).includes('verified')));
  assert.equal(statusOf('tiktok', 'video.publish'), 'to-verify');
  assert.equal(statusOf('tiktok', 'nope'), 'unsupported');
  assert.equal(statusOf('ghost', 'video.publish'), 'unsupported');
});
test('registry check catches a "verified" row with no recorded check', () => {
  const bad = structuredClone(registry); bad.providers.tiktok.status['video.publish'] = 'verified';
  assert.match(checkRegistry(bad).join(), /needs last_verified_at/);
  assert.equal(mayCallPlatform('tiktok', 'video.publish', bad), false);
  bad.providers.tiktok.last_verified_at = '2026-10-01'; bad.providers.tiktok.source_url = 'https://example.test/docs';
  assert.equal(mayCallPlatform('tiktok', 'video.publish', bad), true);
});
test('staleness: never verified or older than 90 days warns', () => {
  assert.equal(staleness('tiktok').stale, true);
  const r = structuredClone(registry); r.providers.meta.last_verified_at = '2026-10-01';
  assert.equal(staleness('meta', new Date('2026-10-30'), r).stale, false);
  assert.equal(staleness('meta', new Date('2027-02-01'), r).stale, true);
});
test('manual adapter builds a bundle with disclosure first, no platform calls, and refuses incomplete input', () => {
  const m = createManualAdapter();
  const b = m.prepare(good);
  assert.ok(b.caption.startsWith('#ad'));
  assert.ok(b.caption.endsWith('https://go.example/abc'));
  assert.equal(b.platform_calls, 0);
  assert.equal(b.platform_status, 'to-verify');
  assert.ok(b.checklist.length >= 4);
  assert.throws(() => m.prepare({ ...good, disclosure: ' ' }), /disclosure/);
  assert.throws(() => m.prepare({ ...good, link: {} }), /tracked link/);
  assert.throws(() => m.prepare({ ...good, content: {} }), /caption/);
});
test('selectAdapter falls back to manual for every unverified capability', () => {
  for (const p of ['tiktok', 'shopee', 'meta', 'youtube']) assert.equal(selectAdapter(p, 'video.publish', { [p]: { name: 'platform' } }).name, 'manual');
});
test('csv parser: quotes, escaped quotes, CRLF, embedded newline, unterminated', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n"l1\nl2",z'), [['a', 'b'], ['x, y', 'say "hi"'], ['l1\nl2', 'z']]);
  assert.throws(() => parseCsv('a,"b'), /unterminated/);
});
test('result import: valid rows accepted as observed/to-verify, bad rows rejected with line numbers, nothing guessed', () => {
  const m = createManualAdapter();
  const csv = ['publication_id,observed_at,impressions,clicks,orders,commission_minor,currency',
    'pub-1,2026-10-20T00:00:00Z,1000,40,2,1250,USD', 'pub-9,2026-10-20,1,1,1,1,USD', 'pub-1,not-a-date,1,1,1,1,USD', 'pub-1,2026-10-21,-5,1,1,1.5,usd'].join('\n');
  const r = m.importResults(csv, { knownPublicationIds: new Set(['pub-1']) });
  assert.equal(r.accepted.length, 1);
  assert.deepEqual([r.accepted[0].basis, r.accepted[0].verification, r.accepted[0].commission_minor], ['observed', 'to-verify', 1250]);
  assert.deepEqual(r.rejected.map((x) => x.line), [3, 4, 5]);
  assert.match(r.rejected[2].errors.join(), /impressions.*commission_minor.*currency/);
  assert.match(m.importResults('a,b\n1,2', { knownPublicationIds: new Set() }).error, /missing columns/);
  assert.equal(m.importResults('', { knownPublicationIds: new Set() }).error, 'empty file');
});
test('end to end with no platform API: prepare -> (human posts) -> export template -> import results', () => {
  const m = createManualAdapter();
  const bundle = m.prepare(good);
  const csv = m.exportCsv([{ publication_id: bundle.publication_id, observed_at: '2026-10-25T00:00:00Z', impressions: 10, clicks: 1, orders: 0, commission_minor: 0, currency: 'USD' }]);
  const r = m.importResults(csv, { knownPublicationIds: new Set(['pub-1']) });
  assert.equal(r.accepted.length, 1); assert.equal(r.rejected.length, 0);
});

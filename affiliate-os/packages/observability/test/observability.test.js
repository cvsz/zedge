import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracer, createMetrics, createCostLedger } from '../src/index.js';

test('spans nest, time, record errors, redact secret-looking attributes, and export OTLP JSON', async () => {
  let t = 1000; const tr = createTracer({ service: 'link-service', now: () => (t += 5) });
  await tr.withSpan('outer', { attributes: { 'http.route': '/l/:id', 'auth.token': 'abc', count: 3, ok: true } }, async (o) => {
    await tr.withSpan('inner', { parent: o }, async () => {});
  });
  await assert.rejects(tr.withSpan('bad', async () => { throw new Error('boom'); }), /boom/);
  const out = tr.exportOtlp();
  const spans = out.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(out.resourceSpans[0].resource.attributes[0].value.stringValue, 'link-service');
  const [inner, outer, bad] = spans;
  assert.equal(inner.parentSpanId, outer.spanId); assert.equal(inner.traceId, outer.traceId);
  assert.equal(outer.traceId.length, 32); assert.equal(outer.spanId.length, 16);
  assert.ok(BigInt(outer.endTimeUnixNano) > BigInt(outer.startTimeUnixNano));
  const a = Object.fromEntries(outer.attributes.map((x) => [x.key, x.value]));
  assert.deepEqual(a['auth.token'], { stringValue: '[redacted]' }); assert.deepEqual(a.count, { intValue: '3' }); assert.deepEqual(a.ok, { boolValue: true });
  assert.equal(bad.status.code, 2); assert.equal(bad.status.message, 'boom');
  assert.equal(tr.pending(), 0, 'exporting drains the buffer');
});
test('prometheus exposition: counter, gauge, histogram, escaping, type clash, bad names', () => {
  const m = createMetrics();
  const c = m.counter('aff_clicks_total', 'Clicks'); c.inc({ outcome: 'ok' }); c.inc({ outcome: 'ok' }, 2); c.inc({ outcome: 'bad "x"\n' });
  assert.throws(() => c.inc({}, -1), /only go up/);
  m.gauge('aff_outbox_pending').set(7);
  const h = m.histogram('aff_latency_seconds', 'Latency', [0.1, 1]); h.observe(0.05, { r: 'a' }); h.observe(0.5, { r: 'a' }); h.observe(5, { r: 'a' });
  const text = m.expose();
  assert.match(text, /# TYPE aff_clicks_total counter/);
  assert.match(text, /aff_clicks_total\{outcome="ok"\} 3/);
  assert.match(text, /outcome="bad \\"x\\"\\n"/);
  assert.match(text, /aff_outbox_pending 7/);
  assert.match(text, /aff_latency_seconds_bucket\{le="0.1",r="a"\} 1/);
  assert.match(text, /aff_latency_seconds_bucket\{le="1",r="a"\} 2/);
  assert.match(text, /aff_latency_seconds_bucket\{le="\+Inf",r="a"\} 3/);
  assert.match(text, /aff_latency_seconds_count\{r="a"\} 3/);
  assert.throws(() => m.gauge('aff_clicks_total'), /already registered/);
  assert.throws(() => m.counter('bad name'), /bad metric name/);
});
test('cost ledger: integer money, idempotent, budgets enforced per category and overall, per organization, per month', () => {
  let d = new Date('2026-10-15'); const l = createCostLedger({ now: () => d });
  l.setBudget('A', { category: 'llm', period_minor: 1000, currency: 'USD' });
  l.setBudget('A', { period_minor: 1500, currency: 'USD' });
  assert.equal(l.record({ organization_id: 'A', category: 'llm', amount_minor: 600, currency: 'USD', idempotency_key: 'k1' }).recorded, true);
  assert.equal(l.record({ organization_id: 'A', category: 'llm', amount_minor: 600, currency: 'USD', idempotency_key: 'k1' }).duplicate, true, 'retry does not double-charge');
  assert.throws(() => l.record({ organization_id: 'A', category: 'llm', amount_minor: 500, currency: 'USD', idempotency_key: 'k2' }), /budget exceeded for llm/);
  assert.equal(l.record({ organization_id: 'A', category: 'storage', amount_minor: 800, currency: 'USD', idempotency_key: 'k3' }).recorded, true);
  assert.throws(() => l.record({ organization_id: 'A', category: 'storage', amount_minor: 200, currency: 'USD', idempotency_key: 'k4' }), /budget exceeded for \*/);
  assert.equal(l.record({ organization_id: 'B', category: 'llm', amount_minor: 99999, currency: 'USD', idempotency_key: 'k1' }).recorded, true, 'other org: no budget, own idempotency space');
  assert.throws(() => l.record({ organization_id: 'A', category: 'llm', amount_minor: 1.5, currency: 'USD', idempotency_key: 'k5' }), /integer/);
  assert.throws(() => l.record({ organization_id: 'A', category: 'llm', amount_minor: 1, currency: 'EUR', idempotency_key: 'k6' }), /budget currency/);
  assert.deepEqual(l.summary('A'), { period: '2026-10', by_category: { llm: 600, storage: 800 }, total_minor: 1400 });
  d = new Date('2026-11-02');
  assert.equal(l.record({ organization_id: 'A', category: 'llm', amount_minor: 900, currency: 'USD', idempotency_key: 'k7' }).recorded, true, 'a new month starts a new budget period');
});

import test from 'node:test';
import assert from 'node:assert';
import { boot } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createMetrics } from '../server/metrics.js';

test('metrics and openapi endpoints require authentication', async () => {
  const h = await boot();
  try {
    const res = await fetch(`${h.base}/metrics`);
    assert.strictEqual(res.status, 401);

    const openApiRes = await fetch(`${h.base}/openapi.json`);
    assert.strictEqual(openApiRes.status, 401);
  } finally {
    await h.close();
  }
});

test('metrics and openapi endpoints are available when authenticated', async () => {
  const h = await boot();
  const c = h.client();
  await c.login();
  try {
    const res = await fetch(`${h.base}/metrics`, {
      headers: { Cookie: c.cookie }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /zedge_http_requests_total/);

    const openApiRes = await fetch(`${h.base}/openapi.json`, {
      headers: { Cookie: c.cookie }
    });
    assert.strictEqual(openApiRes.status, 200);
    const spec = await openApiRes.json();
    assert.strictEqual(spec.openapi, '3.0.3');
  } finally {
    await h.close();
  }
});

test('X5 /metrics accepts a Bearer metricsToken without a session', async () => {
  const h = await boot({ env: { METRICS_TOKEN: 'abcd1234abcd1234' } });
  try {
    const res = await fetch(`${h.base}/metrics`, {
      headers: { Authorization: 'Bearer abcd1234abcd1234' }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /zedge_http_requests_total/);
  } finally {
    await h.close();
  }
});

test('X1 histogram buckets are cumulative but not double-cumulated', () => {
  const m = createMetrics();
  m.recordMetric(200, 7);   // <= 10, 25, 50, ...
  m.recordMetric(200, 15);  // <= 25, 50, ...
  m.recordMetric(200, 200); // <= 250, 500, ...
  const text = m.getMetrics({ listUsers: () => [] });
  const buckets = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^zedge_http_request_duration_seconds_bucket\{le="([\d.]+)"\} (\d+)$/);
    if (match) { buckets[match[1]] = Number(match[2]); }
  }
  assert.strictEqual(buckets['0.005'], 0); // 7ms > 5ms
  assert.strictEqual(buckets['0.01'], 1);  // 7ms <= 10ms
  assert.strictEqual(buckets['0.025'], 2); // 7ms and 15ms <= 25ms
  assert.strictEqual(buckets['0.05'], 2);
  assert.strictEqual(buckets['0.25'], 3);  // all three <= 250ms
  const inf = text.match(/zedge_http_request_duration_seconds_bucket\{le="\+Inf"\} (\d+)/);
  assert.strictEqual(Number(inf[1]), 3);
  const count = text.match(/zedge_http_request_duration_seconds_count (\d+)/);
  assert.strictEqual(Number(count[1]), 3);
});

test('X4 responses_by_status has HELP and TYPE lines', () => {
  const m = createMetrics();
  m.recordMetric(200, 5);
  const text = m.getMetrics({ listUsers: () => [] });
  assert.match(text, /# HELP zedge_http_responses_by_status/);
  assert.match(text, /# TYPE zedge_http_responses_by_status counter/);
  assert.match(text, /zedge_http_responses_by_status\{status="200"\} 1/);
});

test('X4 metrics state is per-app, not shared across instances', () => {
  const a = createMetrics();
  const b = createMetrics();
  a.recordMetric(200, 10);
  const ta = a.getMetrics({ listUsers: () => [] });
  const tb = b.getMetrics({ listUsers: () => [] });
  assert.match(ta, /zedge_http_requests_total 1/);
  assert.match(tb, /zedge_http_requests_total 0/);
});

test('X3 store auditCount tracks writes and metrics reads it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-audit-count-'));
  try {
    const store = createStore(dir);
    assert.strictEqual(store.auditCount(), 0);
    store.audit({ t: new Date().toISOString(), user: 'admin', method: 'POST', path: '/api/test', status: 200, ip: '127.0.0.1' });
    store.audit({ t: new Date().toISOString(), user: 'admin', method: 'POST', path: '/api/test', status: 200, ip: '127.0.0.1' });
    assert.strictEqual(store.auditCount(), 2);
    const m = createMetrics();
    const text = m.getMetrics(store);
    assert.match(text, /zedge_audit_logs_total 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('X2 rate_limited_total counts 429s, login_failures_total counts failures', async () => {
  const h = await boot({ env: { METRICS_TOKEN: 'abcd1234abcd1234' } });
  const c = h.client();
  try {
    // Six failed password logins: #1-5 return 401 (count 1..5), #6 returns 429 (locked).
    let rateLimited = 0;
    let failures = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await c.call('POST', '/api/login', { username: 'admin', password: 'wrong-wrong-wrong' });
      if (r.status === 429) { rateLimited += 1; } else if (r.status === 401) { failures += 1; }
    }
    assert.strictEqual(failures, 5);
    assert.strictEqual(rateLimited, 1);

    const res = await fetch(`${h.base}/metrics`, {
      headers: { Authorization: 'Bearer abcd1234abcd1234' }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /zedge_rate_limited_total 1/);
    assert.match(text, /zedge_login_failures_total 5/);
  } finally {
    await h.close();
  }
});

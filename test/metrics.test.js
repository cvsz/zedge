import test from 'node:test';
import assert from 'node:assert';
import { boot } from './helpers.js';

test('metrics and openapi endpoints are available', async () => {
  const h = await boot();
  try {
    const res = await fetch(`${h.base}/metrics`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /zedge_http_requests_total/);

    const openApiRes = await fetch(`${h.base}/openapi.json`);
    assert.strictEqual(openApiRes.status, 200);
    const spec = await openApiRes.json();
    assert.strictEqual(spec.openapi, '3.0.3');
  } finally {
    await h.close();
  }
});

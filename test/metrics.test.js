import test from 'node:test';
import assert from 'node:assert';
import { boot } from './helpers.js';

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

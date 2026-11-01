import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';

const hit = (b, ip) => fetch(`${b.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zedge', ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, body: JSON.stringify({ username: 'admin', password: 'wrong-wrong-wrong' }) });

test('without the option, CF-Connecting-IP is ignored (cannot dodge the login limit)', async () => {
  const b = await boot();
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await hit(b, `203.0.113.${i + 1}`)).status, 401);
    assert.equal((await hit(b, '203.0.113.99')).status, 429);
  } finally { await b.close(); }
});

test('with TRUST_CF_CONNECTING_IP, the limit is per real client', async () => {
  const b = await boot({ env: { TRUST_CF_CONNECTING_IP: '1' } });
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await hit(b, '203.0.113.1')).status, 401);
    assert.equal((await hit(b, '203.0.113.1')).status, 429, 'attacker is limited');
    assert.equal((await hit(b, '203.0.113.2')).status, 401, 'another client is not locked out');
    assert.equal((await hit(b, 'not an ip; drop table')).status, 401, 'garbage header falls back to the socket address');
  } finally { await b.close(); }
});

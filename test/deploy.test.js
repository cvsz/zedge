import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-cf.js';
import { deploy, parseArgs, parseEnv, mergeEnv } from '../scripts/deploy.mjs';

async function setup(t) {
  const mock = await startMock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-deploy-'));
  const envFile = path.join(dir, '.env');
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  t.after(async () => { delete process.env.CLOUDFLARE_API_TOKEN; await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const run = (extra = {}) => deploy({ name: 'zedge', start: false, allow: [], envFile, hostname: 'console.zeaz.dev', ...extra }, { api: mock.url, log: () => {} });
  return { mock, envFile, run };
}

test('deploy creates tunnel, ingress, proxied DNS and a private .env', async (t) => {
  const { mock, envFile, run } = await setup(t);
  const r = await run();
  const tunnel = mock.state.tunnels.find((x) => x.name === 'zedge');
  assert.ok(tunnel);
  assert.equal(r.tunnelId, tunnel.id);
  const ingress = mock.state.tunnelConfigs[tunnel.id].config.ingress;
  assert.deepEqual(ingress.find((i) => i.hostname === 'console.zeaz.dev'), { hostname: 'console.zeaz.dev', service: 'http://app:8787' });
  assert.ok(ingress.some((i) => i.hostname === 'old.zeaz.dev'), 'hostnames already on the tunnel are kept');
  assert.equal(ingress[ingress.length - 1].service, 'http_status:404');
  const rec = mock.state.records.find((x) => x.name === 'console.zeaz.dev');
  assert.equal(rec.type, 'CNAME');
  assert.equal(rec.content, `${tunnel.id}.cfargotunnel.com`);
  assert.equal(rec.proxied, true);
  const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
  assert.equal(env.TUNNEL_TOKEN, `tunnel-token-${tunnel.id}`);
  assert.ok(env.ZEDGE_ADMIN_PASSWORD.length >= 12 && env.SESSION_SECRET.length >= 32);
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
});

test('re-running reuses the tunnel and keeps existing secrets', async (t) => {
  const { mock, envFile, run } = await setup(t);
  await run();
  const first = parseEnv(fs.readFileSync(envFile, 'utf8'));
  await run();
  const second = parseEnv(fs.readFileSync(envFile, 'utf8'));
  assert.equal(mock.state.tunnels.filter((x) => x.name === 'zedge').length, 1);
  assert.equal(mock.state.records.filter((x) => x.name === 'console.zeaz.dev').length, 1);
  assert.equal(second.ZEDGE_ADMIN_PASSWORD, first.ZEDGE_ADMIN_PASSWORD);
  assert.equal(second.SESSION_SECRET, first.SESSION_SECRET);
});

test('--allow protects the hostname with Access', async (t) => {
  const { mock, run } = await setup(t);
  await run({ allow: ['me@example.com'] });
  const app = mock.state.apps.find((a) => a.domain === 'console.zeaz.dev');
  assert.ok(app);
  const pol = mock.state.policies[app.id][0];
  assert.equal(pol.decision, 'allow');
  assert.deepEqual(pol.include, [{ email: { email: 'me@example.com' } }]);
  await run({ allow: ['me@example.com', 'you@example.com'] });
  assert.equal(mock.state.apps.filter((a) => a.domain === 'console.zeaz.dev').length, 1);
  assert.equal(mock.state.policies[app.id].length, 1);
  assert.equal(mock.state.policies[app.id][0].include.length, 2);
});

test('refuses to overwrite a non-CNAME record and unknown zones', async (t) => {
  const { run } = await setup(t);
  await assert.rejects(run({ hostname: 'api.zeaz.dev' }), /already has a A record/);
  await assert.rejects(run({ hostname: 'console.nope.example' }), /No zone/);
  await assert.rejects(run({ hostname: 'localhost' }), /--hostname/);
  await assert.rejects(run({ allow: ['not-an-email'] }), /email/);
});

test('argument and env helpers', () => {
  const o = parseArgs(['--hostname', 'A.Example.com', '--allow', 'a@x.io, b@x.io', '--no-start']);
  assert.equal(o.hostname, 'a.example.com');
  assert.deepEqual(o.allow, ['a@x.io', 'b@x.io']);
  assert.equal(o.start, false);
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.equal(mergeEnv('# note\nA=1\n', { A: '2', B: '3' }), '# note\nA=2\nB=3\n');
});

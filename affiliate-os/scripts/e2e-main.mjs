// Smoke test of the production path on a real Postgres: migrate with the CLI, create an org, start the studio with env config, hit /healthz and /metrics.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
if (process.getuid && process.getuid() === 0 && !process.env.AFF_PG_AS_NOBODY) process.exit(spawnSync('su', ['-s', '/bin/bash', 'nobody', '-c', `cd ${process.cwd()} && AFF_PG_AS_NOBODY=1 HOME=/tmp node scripts/e2e-main.mjs`], { stdio: 'inherit' }).status ?? 1);
const { default: EP } = await import('embedded-postgres');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aff-e2e-')); const port = 54000 + Math.floor(Math.random() * 900);
const pg = new EP({ databaseDir: path.join(dir, 'd'), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {}, onError: () => {} });
let ok = false;
try {
  await pg.initialise(); await pg.start();
  const url = `postgres://postgres:pw@127.0.0.1:${port}/postgres`;
  const run = (a) => spawnSync('node', ['packages/db/src/cli.js', ...a], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  const up = run(['up']); if (up.status !== 0) throw new Error(`migrate up failed: ${up.stderr}`);
  const st = JSON.parse(run(['status']).stdout); console.log('migrations applied:', st.filter((x) => x.applied).length || st.length);
  const { openPostgres, provisionOrganization } = await import('@affiliate-os/db');
  const db = await openPostgres({ connectionString: url }); const org = await provisionOrganization(db, 'E2E'); await db.close();
  const { start } = await import('./../services/studio/src/main.js');
  const { server, db: sdb } = await start({ DATABASE_URL: url, ORGANIZATION_ID: org, SESSION_SECRET: 's'.repeat(32), ACCESS_TEAM_DOMAIN: 'team.example.test', ACCESS_AUD: 'aud', METRICS_TOKEN: 't'.repeat(24), PORT: '0' });
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = await fetch(`${base}/healthz`); const m = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${'t'.repeat(24)}` } }); const a = await fetch(`${base}/api/me`);
  console.log('healthz', h.status, 'metrics', m.status, 'api without Access token', a.status);
  ok = h.status === 200 && m.status === 200 && a.status === 403;
  server.close(); await sdb.close();
} finally { await pg.stop().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
process.exit(ok ? 0 : 1);

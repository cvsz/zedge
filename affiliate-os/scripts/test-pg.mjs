// Runs the Affiliate OS suites against a real Postgres started from the `embedded-postgres` npm package.
// Postgres refuses to run as root, so when started as root this re-executes itself as user "nobody".
// Usage: npm run test:pg   (needs: npm i --no-save embedded-postgres)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.getuid && process.getuid() === 0 && !process.env.AFF_PG_AS_NOBODY) {
  const r = spawnSync('su', ['-s', '/bin/bash', 'nobody', '-c', `cd ${process.cwd()} && AFF_PG_AS_NOBODY=1 HOME=/tmp node scripts/test-pg.mjs`], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { default: EmbeddedPostgres } = await import('embedded-postgres');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aff-pg-'));
const port = 54000 + Math.floor(Math.random() * 900);
const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {}, onError: () => {} });
let code = 1;
try {
  await pg.initialise(); await pg.start();
  const env = { ...process.env, AFF_TEST_PG_URL: `postgres://postgres:pw@127.0.0.1:${port}/postgres` };
  const r = spawnSync('npm', ['test', '--workspaces', '--if-present'], { stdio: 'inherit', env });
  code = r.status ?? 1;
} finally { await pg.stop().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
process.exit(code);

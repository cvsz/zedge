#!/usr/bin/env node
// Usage: DATABASE_URL=postgres://... node packages/db/src/cli.js up|down|status [steps]
import { openPostgres } from './pg.js';
import { createMigrator } from './migrate.js';

const [cmd = 'status', arg] = process.argv.slice(2);
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(2); }
const db = await openPostgres({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const m = createMigrator(db);
  if (cmd === 'up') {console.log(JSON.stringify(await m.up()));}
  else if (cmd === 'down') {console.log(JSON.stringify(await m.down({ steps: Number(arg || 1) })));}
  else if (cmd === 'status') {console.log(JSON.stringify(await m.status(), null, 2));}
  else { console.error('Use: up | down [steps] | status'); process.exitCode = 2; }
} finally { await db.close(); }

// contracts.lock.json records each schema's version and hash. A schema may only change when its x-version goes up.
//   node src/lock.js           check (exit 1 on a change without a version bump)
//   node src/lock.js --write   update the lock after a deliberate, version-bumped change
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchemas, sha256, SCHEMA_DIR } from './index.js';

export const LOCK_FILE = path.join(path.dirname(SCHEMA_DIR), 'contracts.lock.json');

export function currentState() {
  const out = {};
  for (const [name, s] of Object.entries(loadSchemas())) out[name] = { version: s['x-version'], hash: sha256(JSON.stringify(s)) };
  return out;
}

/** Problems between the lock and the schemas on disk. Empty means compatible. */
export function compare(lock, now) {
  const problems = [];
  for (const [name, old] of Object.entries(lock)) {
    const cur = now[name];
    if (!cur) problems.push(`${name}: schema was removed (create a new version instead of deleting v${old.version})`);
    else if (cur.version < old.version) problems.push(`${name}: version went down (${old.version} -> ${cur.version})`);
    else if (cur.hash !== old.hash && cur.version === old.version) problems.push(`${name}: changed without bumping x-version (${old.version})`);
  }
  for (const name of Object.keys(now)) if (!lock[name]) problems.push(`${name}: new schema is not in the lock (run: npm run lock)`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = currentState();
  if (process.argv.includes('--write')) { fs.writeFileSync(LOCK_FILE, `${JSON.stringify(now, null, 2)}\n`); console.log(`Wrote ${LOCK_FILE}`); } else {
    const problems = compare(JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')), now);
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log('Contracts match the lock.');
  }
}

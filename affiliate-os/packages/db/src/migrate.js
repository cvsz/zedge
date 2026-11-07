import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Migrations on disk, in order: NNNN_name.up.sql with a matching NNNN_name.down.sql. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.up.sql')).sort();
  return names.map((f) => {
    const version = f.slice(0, -'.up.sql'.length);
    if (!/^\d{4}_[a-z0-9_]+$/.test(version)) {throw new Error(`Bad migration name ${f}`);}
    const down = path.join(dir, `${version}.down.sql`);
    if (!fs.existsSync(down)) {throw new Error(`Migration ${version} has no down file`);}
    const up = fs.readFileSync(path.join(dir, f), 'utf8');
    return { version, up, down: fs.readFileSync(down, 'utf8'), checksum: sha(up) };
  });
}

/**
 * `db` is anything with exec(sql), query(sql, params) and transaction(fn) (PGlite today; a pg adapter has the same three calls).
 * Each migration runs in its own transaction. An applied migration whose file has since changed is an error:
 * history is append-only, so a fix is a new migration.
 */
export function createMigrator(db, dir = MIGRATIONS_DIR) {
  const ensure = () => db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = async () => { await ensure(); return (await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows; };

  return {
    async status() {
      const have = new Map((await applied()).map((r) => [r.version, r.checksum]));
      return listMigrations(dir).map((m) => ({ version: m.version, applied: have.has(m.version), changed: have.has(m.version) && have.get(m.version) !== m.checksum }));
    },
    /** Apply everything pending (or up to and including `to`). Returns the versions applied. */
    async up({ to } = {}) {
      const have = new Map((await applied()).map((r) => [r.version, r.checksum]));
      const all = listMigrations(dir);
      for (const m of all) {if (have.has(m.version) && have.get(m.version) !== m.checksum) {throw new Error(`Migration ${m.version} was edited after it was applied. Add a new migration instead.`);}}
      const done = [];
      for (const m of all) {
        if (have.has(m.version)) {continue;}
        if (to && m.version > to) {break;}
        await db.transaction(async (tx) => {
          await tx.exec(m.up);
          await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
        });
        done.push(m.version);
      }
      return done;
    },
    /** Undo the last `steps` applied migrations, newest first. Returns the versions reverted. */
    async down({ steps = 1 } = {}) {
      const have = (await applied()).map((r) => r.version).reverse();
      const all = new Map(listMigrations(dir).map((m) => [m.version, m]));
      const done = [];
      for (const v of have.slice(0, steps)) {
        const m = all.get(v);
        if (!m) {throw new Error(`Applied migration ${v} has no file on disk`);}
        await db.transaction(async (tx) => {
          await tx.exec(m.down);
          await tx.query('DELETE FROM schema_migrations WHERE version = $1', [v]);
        });
        done.push(v);
      }
      return done;
    }
  };
}

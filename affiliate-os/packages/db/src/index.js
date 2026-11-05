import { PGlite } from '@electric-sql/pglite';
export { createMigrator, listMigrations, MIGRATIONS_DIR } from './migrate.js';
export { scoped, readonly, provisionOrganization, canonical, hashOf } from './scoped.js';
export * as repos from './repos.js';
export { costs } from './costs.js';

export { openPostgres, openTemporaryPostgres } from './pg.js';
import { openTemporaryPostgres } from './pg.js';

/**
 * A database for tests and local development: in-memory PGlite by default. When AFF_TEST_PG_URL is set, every call instead
 * creates a throw-away database on that real server, so the same suites run against a real Postgres.
 */
export async function openMemory() {
  if (process.env.AFF_TEST_PG_URL) return openTemporaryPostgres(process.env.AFF_TEST_PG_URL);
  const db = new PGlite();
  await db.waitReady;
  return db;
}

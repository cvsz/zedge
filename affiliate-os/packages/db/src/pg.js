// A node-postgres adapter with the same three calls PGlite offers: exec(sql), query(sql, params), transaction(fn).
// `pg` is loaded lazily so the in-memory path (and its tests) do not need it installed.

const wrap = (r) => ({ rows: r.rows || [], affectedRows: r.rowCount ?? 0 });

function api(run) {
  return {
    query: async (sql, params) => wrap(await run.query(sql, params)),
    exec: async (sql) => { await run.query(sql); },        // no params => simple protocol: several statements allowed
  };
}

/** Production database handle over a pg Pool. `pool` may be injected (tests, custom TLS); otherwise one is built from `connectionString`. */
export async function openPostgres({ connectionString, pool, max = 10, onError = () => {} } = {}) {
  let p = pool;
  if (!p) {
    if (!connectionString) {throw new Error('openPostgres needs a connectionString or a pool');}
    const pg = (await import('pg')).default;
    p = new pg.Pool({ connectionString, max });
  }
  // An idle connection that the server drops (restart, failover, DROP DATABASE) emits 'error' on the pool; without a listener Node crashes.
  if (typeof p.on === 'function') {p.on('error', onError);}
  const db = {
    ...api(p),
    async transaction(fn) {
      const c = await p.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(api(c));
        await c.query('COMMIT');
        return out;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw e;
      } finally { c.release(); }
    },
    waitReady: Promise.resolve(),
    close: () => p.end(),
  };
  return db;
}

/** For tests against a real server: makes a throw-away database on the server at `adminUrl` and drops it on close. Needs CREATEDB (and CREATEROLE for the first migration). */
export async function openTemporaryPostgres(adminUrl) {
  const pg = (await import('pg')).default;
  const name = `aff_t_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  admin.on('error', () => {});
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(adminUrl); u.pathname = `/${name}`;
  const db = await openPostgres({ connectionString: u.toString(), max: 5 });
  const close = db.close;
  db.close = async () => { await close(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); };
  return db;
}

import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
export const hashOf = (v) => crypto.createHash('sha256').update(canonical(v)).digest('hex');

/**
 * The only way application code touches tenant tables. Every call runs in one transaction as the restricted
 * `aff_app` role with app.organization_id set, so Postgres itself (row-level security) enforces isolation.
 * Code here never builds the organization filter by hand and never accepts an organization id from a caller's data.
 */
export function scoped(db, organizationId) {
  if (!UUID.test(String(organizationId))) throw new Error('organizationId must be a UUID');
  const tx = (fn) => db.transaction(async (t) => {
    await t.exec('SET LOCAL ROLE aff_app');
    await t.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    return fn({ organizationId, query: (sql, params) => t.query(sql, params), exec: (sql) => t.exec(sql) });
  });
  return { organizationId, tx, query: (sql, params) => tx((q) => q.query(sql, params)) };
}

/** Create an organization through the provisioning role (the app role cannot). */
export async function provisionOrganization(db, name) {
  return db.transaction(async (t) => {
    await t.exec('SET LOCAL ROLE aff_provisioner');
    return (await t.query('SELECT aff_create_organization($1) AS id', [name])).rows[0].id;
  });
}

/** Run as the read-only role for one organization (reports, exports). */
export function readonly(db, organizationId) {
  if (!UUID.test(String(organizationId))) throw new Error('organizationId must be a UUID');
  return {
    query: (sql, params) => db.transaction(async (t) => {
      await t.exec('SET LOCAL ROLE aff_readonly');
      await t.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      return t.query(sql, params);
    })
  };
}

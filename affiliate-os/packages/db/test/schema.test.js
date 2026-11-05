import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openMemory, createMigrator, scoped, readonly, provisionOrganization, repos, listMigrations, MIGRATIONS_DIR } from '../src/index.js';

let db, orgA, orgB, A, B;
const U = '00000000-0000-4000-8000-0000000000';
before(async () => {
  db = await openMemory();
  await createMigrator(db).up();
  orgA = await provisionOrganization(db, 'Org A');
  orgB = await provisionOrganization(db, 'Org B');
  A = scoped(db, orgA); B = scoped(db, orgB);
});
after(async () => { await db.close(); });
const rejects = (p, re) => assert.rejects(p, re);

// ---------------------------------------------------------------- migrations
test('migrations apply, report status, undo and re-apply', async () => {
  const d = await openMemory();
  try {
    const m = createMigrator(d);
    const first = await m.up();
    assert.ok(first.length >= 1);
    assert.deepEqual(await m.up(), [], 'second run does nothing');
    assert.ok((await m.status()).every((s) => s.applied && !s.changed));
    const tables = async () => (await d.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'")).rows.length;
    assert.ok(await tables() >= 9);
    await m.down({ steps: first.length });
    assert.equal(await tables(), 0, 'down removes every table');
    assert.deepEqual(await m.up(), first, 're-applies cleanly');
  } finally { await d.close(); }
});

test('an applied migration that was edited is refused', async () => {
  const d = await openMemory();
  try {
    await createMigrator(d).up();
    await d.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_core'");
    await assert.rejects(createMigrator(d).up(), /edited after it was applied/);
  } finally { await d.close(); }
});

test('every migration has a down file and no secrets', () => {
  const ms = listMigrations();
  assert.ok(ms.length >= 1);
  for (const m of ms) {
    assert.ok(m.down.trim().length > 0, `${m.version} has an empty down`);
    for (const sql of [m.up, m.down]) {
      assert.ok(!/\bPASSWORD\b/i.test(sql), `${m.version} must not set passwords`);
      assert.ok(!/(secret|token|api[_-]?key)\s*=\s*'[^']+'/i.test(sql), `${m.version} must not embed credentials`);
      assert.ok(!/BYPASSRLS|SUPERUSER/i.test(sql.replace(/--.*$/gm, '')), `${m.version} must not grant BYPASSRLS or SUPERUSER`);
    }
  }
  assert.ok(fs.readdirSync(MIGRATIONS_DIR).every((f) => /^\d{4}_[a-z0-9_]+\.(up|down)\.sql$/.test(f)));
});

// ---------------------------------------------------------------- tenant isolation
test('an organization sees only its own rows', async () => {
  const brandA = await A.tx((q) => repos.brands.create(q, { name: 'Alpha' }));
  await B.tx((q) => repos.brands.create(q, { name: 'Beta' }));
  assert.deepEqual((await A.tx((q) => repos.brands.list(q))).map((b) => b.name), ['Alpha']);
  assert.deepEqual((await B.tx((q) => repos.brands.list(q))).map((b) => b.name), ['Beta']);
  assert.equal((await B.query('SELECT * FROM brands WHERE id = $1', [brandA.id])).rows.length, 0, 'direct lookup by id across tenants returns nothing');
  assert.equal((await B.query('SELECT * FROM organizations')).rows.length, 1, 'an org only sees itself');
});

test('another organization cannot update or retire your rows', async () => {
  const brand = await A.tx((q) => repos.brands.create(q, { name: 'Gamma' }));
  assert.equal(await B.tx((q) => repos.brands.retire(q, brand.id)), 0);
  assert.equal(await A.tx((q) => repos.brands.retire(q, brand.id)), 1);
});

test('inserting a row for another organization is refused', async () => {
  await rejects(A.query("INSERT INTO brands (organization_id, name) VALUES ($1, 'Sneaky')", [orgB]), /row-level security/);
});

test('without an organization set nothing is visible', async () => {
  const none = await db.transaction(async (t) => { await t.exec('SET LOCAL ROLE aff_app'); return t.query('SELECT * FROM brands'); });
  assert.equal(none.rows.length, 0);
  const blank = await db.transaction(async (t) => { await t.exec('SET LOCAL ROLE aff_app'); await t.query("SELECT set_config('app.organization_id', '', true)"); return t.query('SELECT * FROM brands'); });
  assert.equal(blank.rows.length, 0);
});

test('the organization setting does not leak out of a transaction', async () => {
  await A.query('SELECT 1');
  const after = await db.transaction(async (t) => { await t.exec('SET LOCAL ROLE aff_app'); return t.query('SELECT * FROM brands'); });
  assert.equal(after.rows.length, 0);
});

test('foreign keys cannot cross organizations', async () => {
  const brandA = await A.tx((q) => repos.brands.create(q, { name: 'Delta' }));
  await rejects(B.tx((q) => repos.campaigns.create(q, { brand_id: brandA.id, name: 'Steal' })), /foreign key|violates/i);
  const camp = await A.tx((q) => repos.campaigns.create(q, { brand_id: brandA.id, name: 'Mine' }));
  const brandB = await B.tx((q) => repos.brands.create(q, { name: 'Epsilon' }));
  await rejects(B.tx((q) => repos.content.create(q, { campaign_id: camp.id, language: 'th', format: 'text', disclosure: '#ad' })), /foreign key|violates/i);
  assert.ok(brandB.id);
});

test('the read-only role is scoped too and cannot write', async () => {
  const r = readonly(db, orgA);
  assert.ok((await r.query('SELECT * FROM brands')).rows.every((b) => b.organization_id === orgA));
  await rejects(r.query("INSERT INTO brands (organization_id, name) VALUES ($1, 'x')", [orgA]), /permission denied/);
});

test('scoped() refuses a malformed organization id (no string-built SQL path)', () => {
  assert.throws(() => scoped(db, "x'; DROP TABLE brands;--"), /UUID/);
  assert.throws(() => readonly(db, 'nope'), /UUID/);
});

// ---------------------------------------------------------------- least privilege
test('the app role cannot delete, drop, create organizations or change protected columns', async () => {
  const brand = await A.tx((q) => repos.brands.create(q, { name: 'Zeta' }));
  await rejects(A.query('DELETE FROM brands WHERE id = $1', [brand.id]), /permission denied/);
  await rejects(A.query('DROP TABLE brands'), /must be owner|permission denied/);
  await rejects(A.query("INSERT INTO organizations (name) VALUES ('rogue')"), /permission denied|row-level/);
  await rejects(A.query('TRUNCATE brands'), /permission denied/);
  await rejects(A.query('UPDATE users SET organization_id = $1', [orgB]), /permission denied/);
  await rejects(db.transaction(async (t) => { await t.exec('SET LOCAL ROLE aff_app'); return t.query("SELECT aff_create_organization('x')"); }), /permission denied/);
});

// ---------------------------------------------------------------- domain rules
test('money is integer minor units with an ISO currency', async () => {
  const cols = (await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND (column_name LIKE '%\\_minor' OR column_name = 'currency')")).rows;
  assert.ok(cols.some((c) => c.column_name === 'budget_minor'));
  for (const c of cols.filter((x) => x.column_name.endsWith('_minor'))) assert.equal(c.data_type, 'bigint', `${c.column_name} must be bigint`);
  const floats = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('real', 'double precision', 'numeric')")).rows;
  assert.deepEqual(floats, [], 'no floating point or decimal columns anywhere');
  const brand = await A.tx((q) => repos.brands.create(q, { name: 'Eta' }));
  await rejects(A.tx((q) => repos.campaigns.create(q, { brand_id: brand.id, name: 'neg', budget_minor: -1 })), /check constraint/);
  await rejects(A.tx((q) => repos.campaigns.create(q, { brand_id: brand.id, name: 'cur', currency: 'baht' })), /check constraint|too long/);
  const ok = await A.tx((q) => repos.campaigns.create(q, { brand_id: brand.id, name: 'ok', budget_minor: 150000, currency: 'THB' }));
  assert.equal(String(ok.budget_minor), '150000');
});

test('content needs a disclosure and valid enums; links need https and a disclosure', async () => {
  await rejects(A.tx((q) => repos.content.create(q, { language: 'th', format: 'video', disclosure: '' })), /check constraint/);
  await rejects(A.tx((q) => repos.content.create(q, { language: 'fr', format: 'video', disclosure: '#ad' })), /check constraint/);
  await rejects(A.tx((q) => repos.links.create(q, { slug: 'bad1', destination: 'http://x.example', disclosure: '#ad' })), /check constraint/);
  await rejects(A.tx((q) => repos.links.create(q, { slug: 'bad2', destination: 'https://x.example', disclosure: '' })), /check constraint/);
  await rejects(A.tx((q) => repos.links.create(q, { slug: '../x', destination: 'https://x.example', disclosure: '#ad' })), /check constraint/);
  const l = await A.tx((q) => repos.links.create(q, { slug: 'lamp-1', destination: 'https://x.example/p', disclosure: '#ad', platform: 'tiktok' }));
  await rejects(A.tx((q) => repos.links.create(q, { slug: 'lamp-1', destination: 'https://x.example/p', disclosure: '#ad' })), /unique|duplicate/);
  assert.equal(await A.tx((q) => repos.links.retire(q, l.id)), 1);
  assert.equal((await A.tx((q) => repos.links.list(q))).some((x) => x.slug === 'lamp-1'), false, 'retired links drop out of lists');
  assert.equal((await A.query('SELECT 1 FROM affiliate_links WHERE slug = $1', ['lamp-1'])).rows.length, 1, 'but the row stays, so history stays attributable');
});

test('the same slug may exist in two organizations', async () => {
  await A.tx((q) => repos.links.create(q, { slug: 'shared', destination: 'https://a.example', disclosure: '#ad' }));
  await B.tx((q) => repos.links.create(q, { slug: 'shared', destination: 'https://b.example', disclosure: '#ad' }));
  assert.equal((await B.tx((q) => repos.links.list(q))).find((l) => l.slug === 'shared').destination, 'https://b.example');
});

test('creatives are immutable: edits are refused and variants point at the original', async () => {
  const c = await A.tx((q) => repos.content.create(q, { language: 'th-en', format: 'video', disclosure: '#ad ลิงก์แอฟฟิลิเอต' }));
  const v1 = await A.tx((q) => repos.creatives.add(q, { content_id: c.id, body: { hook: 'Meet the lamp' } }));
  await rejects(A.query("UPDATE creatives SET body = '{}' WHERE id = $1", [v1.id]), /permission denied/);
  await rejects(db.query("UPDATE creatives SET body = '{}' WHERE id = $1", [v1.id]), /immutable/, 'even a privileged connection cannot rewrite one');
  const v2 = await A.tx((q) => repos.creatives.add(q, { content_id: c.id, body: { hook: 'A better hook' }, variant_of: v1.id }));
  assert.notEqual(v2.id, v1.id);
  assert.notEqual(v2.content_hash, v1.content_hash);
  assert.equal(v2.variant_of, v1.id);
  assert.equal((await A.tx((q) => repos.creatives.forContent(q, c.id))).length, 2);
  assert.equal(await A.tx((q) => repos.creatives.retire(q, v1.id)), 1, 'retiring is allowed');
  const same = await A.tx((q) => repos.creatives.add(q, { content_id: c.id, body: { b: 1, a: 2 } }));
  const same2 = await A.tx((q) => repos.creatives.add(q, { content_id: c.id, body: { a: 2, b: 1 } }));
  assert.equal(same.content_hash, same2.content_hash, 'the hash ignores key order');
});

test('audit entries are append-only even for a privileged connection', async () => {
  await A.query("INSERT INTO audit_entries (organization_id, seq, actor, action, prev_hash, hash) VALUES ($1, 1, 'a', 'x', $2, $3)", [orgA, '0'.repeat(64), 'a'.repeat(64)]);
  await rejects(db.query('UPDATE audit_entries SET actor = $1', ['evil']), /append-only/);
  await rejects(db.query('DELETE FROM audit_entries'), /append-only/);
  await rejects(A.query('DELETE FROM audit_entries'), /permission denied/);
  await rejects(A.query("INSERT INTO audit_entries (organization_id, seq, actor, action, prev_hash, hash) VALUES ($1, 1, 'a', 'x', $2, $3)", [orgA, '0'.repeat(64), 'b'.repeat(64)]), /unique|duplicate/);
});

test('status changes go through the content repository', async () => {
  const c = await A.tx((q) => repos.content.create(q, { language: 'en', format: 'text', disclosure: '#ad' }));
  assert.equal(await A.tx((q) => repos.content.setStatus(q, c.id, 'REVIEW')), 1);
  await rejects(A.tx((q) => repos.content.setStatus(q, c.id, 'LIVE')), /check constraint/);
  assert.equal(await B.tx((q) => repos.content.setStatus(q, c.id, 'APPROVED')), 0, 'another tenant cannot move it');
  assert.equal((await A.tx((q) => repos.content.get(q, c.id))).status, 'REVIEW');
  void U;
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newKey, idToken, clock, ISS, CLIENT } from './helpers.js';
import { createAuth, AuthError, PERMISSIONS, approvalFingerprint } from '../src/index.js';
import { verify as verifyChain } from '../src/audit.js';

let t, owner, ed, ap, viewer;
before(async () => {
  t = await setup();
  owner = await t.login(t.orgA, 'olive', ['aff-owners']);
  ed = await t.login(t.orgA, 'eddie', ['aff-editors']);
  ap = await t.login(t.orgA, 'ada', ['aff-approvers']);
  viewer = await t.login(t.orgA, 'vic', []);
});
after(async () => { await t.close(); });
const code = (p, c) => assert.rejects(p, (e) => e instanceof AuthError && e.code === c, `expected ${c}`);

// ---------------------------------------------------------------- sign-in
test('sign-in creates the member, maps the role from claims and returns a working session', async () => {
  assert.equal(owner.role, 'owner'); assert.equal(ed.role, 'editor'); assert.equal(viewer.role, 'viewer');
  assert.deepEqual(owner.permissions, ['*']);
  assert.equal(owner.organizationId, t.orgA);
  assert.ok(t.auth.can(ed, 'content.write') && !t.auth.can(ed, 'users.admin'));
  assert.equal(await t.auth.authenticate('garbage'), null);
  assert.equal(await t.auth.authenticate(''), null);
});

test('forged, replayed, mismatched and expired sign-ins are refused', async () => {
  const k = t.keys.current[0];
  const go = (claims, key = k, header) => t.auth.signIn(t.orgA, idToken(key, claims, header), { nonce: 'n-1' });
  await code(go({ nonce: 'other' }), 'UNAUTHENTICATED');
  await code(go({ aud: 'someone-else' }), 'UNAUTHENTICATED');
  await code(go({ iss: 'https://evil.example' }), 'UNAUTHENTICATED');
  await code(go({ exp: clock.t / 1000 - 3600 }), 'UNAUTHENTICATED');
  await code(go({ sub: undefined }), 'UNAUTHENTICATED');
  await code(go({}, newKey('k1')), 'UNAUTHENTICATED');           // right kid, wrong key: bad signature
  await code(go({}, newKey('zz')), 'UNAUTHENTICATED');           // unknown kid
  await code(t.auth.signIn(t.orgA, 'a.b.c', { nonce: 'n-1' }), 'UNAUTHENTICATED');
  await code(go({}, k, { alg: 'none' }), 'UNAUTHENTICATED');    // algorithm confusion
  await code(go({}, k, { alg: 'HS256' }), 'UNAUTHENTICATED');
  const good = idToken(k, { sub: 'x1' });
  const [h, , s] = good.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ iss: ISS, aud: CLIENT, sub: 'x1', exp: clock.t / 1000 + 600, nonce: 'n-1', groups: ['aff-owners'] })).toString('base64url')}.${s}`;
  await code(t.auth.signIn(t.orgA, forged, { nonce: 'n-1' }), 'UNAUTHENTICATED');   // payload edited after signing
  await code(t.auth.signIn('00000000-0000-4000-8000-0000000000ff', good, { nonce: 'n-1' }), 'FORBIDDEN');   // org without SSO
});

test('a rotated signing key is picked up without a restart', async () => {
  const t2 = await setup();
  try {
    const next = newKey('k2');
    const token = idToken(next, { sub: 'rot' });
    t2.keys.current = [t2.keys.current[0]];
    t2.keys.current = [t2.keys.current[0]];
    // the provider now serves k2: the fetcher is asked again once when a kid is unknown
    let calls = 0;
    const cfg = { issuer: ISS, clientId: CLIENT, roleClaim: 'groups', roleMap: {}, defaultRole: 'viewer', keys: async (refresh) => { calls += 1; return refresh ? [next.jwk] : [t2.keys.current[0].jwk]; } };
    const a = createAuth({ db: t2.db, sessionSecret: 's'.repeat(40), oidc: { [t2.orgA]: cfg }, now: () => new Date(clock.t) });
    const r = await a.signIn(t2.orgA, token, { nonce: 'n-1' });
    assert.ok(r.token); assert.equal(calls, 2);
  } finally { await t2.close(); }
});

test('disabled members, unknown roles and disallowed email domains are refused', async () => {
  const t2 = await setup({ oidcExtra: { allowedEmailDomains: ['example.com'] } });
  try {
    const boss = await t2.login(t2.orgA, 'boss', ['aff-owners']);
    const guest = await t2.login(t2.orgA, 'guest', []);
    await t2.auth.users.setDisabled(boss, guest.userId, true);
    await code(t2.login(t2.orgA, 'guest', []), 'FORBIDDEN');
    assert.equal(await t2.auth.authenticate((await t2.signIn(t2.orgA, { sub: 'boss', email: 'boss@example.com', groups: ['aff-owners'] })).token).then((p) => p.role), 'owner');
    await code(t2.signIn(t2.orgA, { sub: 'x', email: 'x@other.org' }), 'FORBIDDEN');
    await code(t2.signIn(t2.orgA, { sub: 'y', email: 'y@example.com', email_verified: false }), 'FORBIDDEN');
    await code(t2.signIn(t2.orgA, { sub: 'g', email: 'g@example.com', groups: ['aff-ghosts'] }), 'FORBIDDEN');   // maps to a role that does not exist
    // a disabled member's existing session stops working immediately
    const live = await t2.signIn(t2.orgA, { sub: 'temp', email: 'temp@example.com' });
    const p = await t2.auth.authenticate(live.token);
    await t2.auth.users.setDisabled(boss, p.userId, true);
    assert.equal(await t2.auth.authenticate(live.token), null);
  } finally { await t2.close(); }
});

// ---------------------------------------------------------------- sessions
test('sessions expire, cannot be tampered with, and are bound to one organization', async () => {
  const r = await t.signIn(t.orgA, { sub: 'olive', email: 'olive@example.com', groups: ['aff-owners'] });
  assert.ok(await t.auth.authenticate(r.token));
  const [body, sig] = r.token.split('.');
  const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), o: t.orgB })).toString('base64url');
  assert.equal(await t.auth.authenticate(`${swapped}.${sig}`), null, 'editing the organization breaks the signature');
  assert.equal(await t.auth.authenticate(`${body}.${sig.slice(0, -2)}xx`), null);
  clock.t += 13 * 3600000;
  assert.equal(await t.auth.authenticate(r.token), null, 'expired after 12 hours');
  clock.t -= 13 * 3600000;
  assert.throws(() => createAuth({ db: t.db, sessionSecret: 'short', oidc: {} }), /at least 32/);
});

// ---------------------------------------------------------------- RBAC
test('permissions are enforced per call and changes apply to existing sessions at once', async () => {
  await code(t.auth.users.list(viewer), 'FORBIDDEN');
  await code(t.auth.users.list(ed), 'FORBIDDEN');
  await code(t.auth.users.list(null), 'UNAUTHENTICATED');
  assert.ok((await t.auth.users.list(owner)).length >= 4);
  const live = await t.signIn(t.orgA, { sub: 'vic', email: 'vic@example.com', groups: [] });
  const before = await t.auth.authenticate(live.token);
  await t.auth.users.setRole(owner, before.userId, 'editor');
  assert.equal((await t.auth.authenticate(live.token)).role, 'editor', 'no re-login needed');
  await t.auth.users.setRole(owner, before.userId, 'viewer');
  assert.equal((await t.auth.authenticate(live.token)).role, 'viewer');
});

test('custom roles: validated, listed, protected when in use; built-in roles are fixed', async () => {
  await code(t.auth.roles.save(viewer, { name: 'x1', permissions: ['read'] }), 'FORBIDDEN');
  await code(t.auth.roles.save(owner, { name: 'bad', permissions: ['*'] }), 'INVALID');
  await code(t.auth.roles.save(owner, { name: 'bad', permissions: ['nonsense'] }), 'INVALID');
  await code(t.auth.roles.save(owner, { name: 'Bad Name', permissions: ['read'] }), 'INVALID');
  await code(t.auth.roles.save(owner, { name: 'owner', permissions: ['read'] }), 'CONFLICT');
  await t.auth.roles.save(owner, { name: 'links-only', permissions: ['read', 'links.write'] });
  assert.ok((await t.auth.roles.list(viewer)).some((r) => r.name === 'links-only' && !r.builtin));
  const m = await t.login(t.orgA, 'lena', []);
  await t.auth.users.setRole(owner, m.userId, 'links-only');
  assert.ok(t.auth.can(await t.auth.authenticate((await t.signIn(t.orgA, { sub: 'lena', email: 'lena@example.com', groups: [] })).token), 'links.write') === false, 'sign-in re-syncs the role from the identity provider');
  await t.auth.users.setRole(owner, m.userId, 'links-only');
  await code(t.auth.roles.remove(owner, 'links-only'), 'CONFLICT');
  await t.auth.users.setRole(owner, m.userId, 'viewer');
  await t.auth.roles.remove(owner, 'links-only');
  await code(t.auth.roles.remove(owner, 'viewer'), 'CONFLICT');
  await code(t.auth.roles.remove(owner, 'nope'), 'NOT_FOUND');
  assert.deepEqual(Object.keys(PERMISSIONS).includes('*'), false);
});

test('at least one active owner always remains', async () => {
  const t2 = await setup();
  try {
    const only = await t2.login(t2.orgA, 'solo', ['aff-owners']);
    await code(t2.auth.users.setRole(only, only.userId, 'viewer'), 'CONFLICT');
    await code(t2.auth.users.setDisabled(only, only.userId, true), 'CONFLICT');
    // the identity provider demoting the last owner does not lock the organization out
    await t2.signIn(t2.orgA, { sub: 'solo', email: 'solo@example.com', groups: [] });
    assert.equal((await t2.auth.authenticate((await t2.signIn(t2.orgA, { sub: 'solo', email: 'solo@example.com', groups: ['aff-owners'] })).token)).role, 'owner');
    const log = await t2.auth.audit.list(only);
    assert.ok(log.some((e) => e.action === 'role.sync_skipped'));
    const second = await t2.login(t2.orgA, 'duo', ['aff-owners']);
    await t2.auth.users.setRole(only, second.userId, 'viewer');            // fine: another owner exists
    const reauth = await t2.auth.authenticate((await t2.signIn(t2.orgA, { sub: 'duo', email: 'duo@example.com', groups: [] })).token);   // each request authenticates afresh
    assert.equal(reauth.role, 'viewer');
    const admin2 = await t2.auth.users.create(only, { subject: 'adm', role: 'admin' });
    const adminP = await t2.auth.authenticate(t2.auth.issueSession(t2.orgA, admin2));
    await code(t2.auth.users.setRole(adminP, reauth.userId, 'owner'), 'FORBIDDEN');   // an admin (users.admin) cannot mint owners
  } finally { await t2.close(); }
});

test('bootstrapOwner works once per organization', async () => {
  const t2 = await setup();
  try {
    const id = await t2.auth.bootstrapOwner(t2.orgA, { subject: 'first', email: 'first@example.com' });
    assert.ok(id);
    await code(t2.auth.bootstrapOwner(t2.orgA, { subject: 'second' }), 'CONFLICT');
  } finally { await t2.close(); }
});

// ---------------------------------------------------------------- tenant isolation at the service level
test('one organization cannot see or change another one', async () => {
  const bOwner = await t.login(t.orgB, 'olive', ['aff-owners']);       // same identity subject, different organization
  assert.notEqual(bOwner.userId, owner.userId, 'the same person is a separate member in each organization');
  assert.equal(bOwner.organizationId, t.orgB);
  const listB = await t.auth.users.list(bOwner);
  assert.ok(listB.every((u) => ['olive'].includes(u.subject)), 'org B lists only its own members');
  await code(t.auth.users.setRole(bOwner, ed.userId, 'viewer'), 'NOT_FOUND');
  await code(t.auth.users.setDisabled(bOwner, ed.userId, true), 'NOT_FOUND');
  assert.equal((await t.auth.roles.list(bOwner)).some((r) => r.name === 'links-only'), false);
  assert.ok((await t.auth.audit.list(bOwner)).every((e) => e.actor !== 'eddie@example.com'));
  const bApproval = await t.auth.approvals.request(bOwner, { kind: 'publish', subject_type: 'content', subject_id: '00000000-0000-4000-8000-000000000abc', summary: 'B only' });
  assert.equal((await t.auth.approvals.list(owner)).some((a) => a.id === bApproval.id), false);
  await code(t.auth.approvals.decide(owner, bApproval.id, { approve: true }), 'NOT_FOUND');
});

// ---------------------------------------------------------------- approvals
const SUBJ = '00000000-0000-4000-8000-0000000000c1';
const req = { kind: 'publish', subject_type: 'content', subject_id: SUBJ, payload: { channel: 'tiktok' } };

test('approvals: a second person decides, once, for exactly the same request', async () => {
  const a = await t.auth.approvals.request(ed, { ...req, summary: 'Publish the lamp video' });
  assert.equal(a.status, 'pending');
  assert.equal((await t.auth.approvals.request(ed, { ...req, summary: 'again' })).id, a.id, 'asking twice does not stack requests');
  await code(t.auth.approvals.decide(ed, a.id, { approve: true }), 'FORBIDDEN');          // editor lacks approvals.decide
  await code(t.auth.approvals.decide(viewer, a.id, { approve: true }), 'FORBIDDEN');
  const self = await t.auth.approvals.request(ap, { ...req, subject_id: '00000000-0000-4000-8000-0000000000c2', summary: 'mine' });
  await code(t.auth.approvals.decide(ap, self.id, { approve: true }), 'FORBIDDEN');       // approver cannot approve their own
  const done = await t.auth.approvals.decide(ap, a.id, { approve: true, note: 'ok' });
  assert.equal(done.status, 'approved');
  await code(t.auth.approvals.decide(ap, a.id, { approve: true }), 'CONFLICT');
  await code(t.auth.approvals.redeem(ap, a.id, req), 'FORBIDDEN');                        // someone else's approval
  await code(t.auth.approvals.redeem(ed, a.id, { ...req, payload: { channel: 'youtube' } }), 'FORBIDDEN');   // different request
  await t.auth.approvals.redeem(ed, a.id, req);
  await code(t.auth.approvals.redeem(ed, a.id, req), 'FORBIDDEN');                        // one use only
  assert.equal((await t.auth.approvals.list(ed, { status: 'consumed' })).length >= 1, true);
});

test('approvals expire, can be rejected and cancelled', async () => {
  const a = await t.auth.approvals.request(ed, { ...req, subject_id: '00000000-0000-4000-8000-0000000000d1', summary: 'will lapse' });
  const ok = await t.auth.approvals.decide(ap, a.id, { approve: true });
  assert.equal(ok.status, 'approved');
  clock.t += 31 * 60000;
  await code(t.auth.approvals.redeem(ed, a.id, { ...req, subject_id: '00000000-0000-4000-8000-0000000000d1' }), 'FORBIDDEN');
  const stale = await t.auth.approvals.request(ed, { ...req, subject_id: '00000000-0000-4000-8000-0000000000d2', summary: 'old' });
  clock.t += 25 * 3600000;
  await code(t.auth.approvals.decide(ap, stale.id, { approve: true }), 'CONFLICT');
  clock.t -= 25 * 3600000 + 31 * 60000;
  const r = await t.auth.approvals.request(ed, { ...req, subject_id: '00000000-0000-4000-8000-0000000000d3', summary: 'reject me' });
  assert.equal((await t.auth.approvals.decide(ap, r.id, { approve: false, note: 'no' })).status, 'rejected');
  const c = await t.auth.approvals.request(ed, { ...req, subject_id: '00000000-0000-4000-8000-0000000000d4', summary: 'cancel me' });
  await t.auth.approvals.cancel(ed, c.id);
  await code(t.auth.approvals.cancel(ed, c.id), 'NOT_FOUND');
  await code(t.auth.approvals.decide(ap, c.id, { approve: true }), 'CONFLICT');
  await code(t.auth.approvals.request(ed, { ...req, subject_id: 'nope', summary: 'x' }), 'INVALID');
  assert.equal(approvalFingerprint(req), approvalFingerprint({ ...req, payload: { channel: 'tiktok' } }));
});

// ---------------------------------------------------------------- autonomy
test('lowering autonomy is direct; raising it needs a second person and one approved, audited request', async () => {
  const brand = await t.scoped(t.orgA).tx((q) => t.repos.brands.create(q, { name: 'Autonomy brand' }));
  const camp = await t.scoped(t.orgA).tx((q) => t.repos.campaigns.create(q, { brand_id: brand.id, name: 'Lamps', autonomy_level: 'APPROVAL_REQUIRED' }));
  await code(t.auth.setCampaignAutonomy(viewer, camp.id, 'DRAFT_ONLY'), 'FORBIDDEN');
  await code(t.auth.setCampaignAutonomy(ed, camp.id, 'LOUD'), 'INVALID');
  assert.equal(await t.auth.setCampaignAutonomy(ed, camp.id, 'DRAFT_ONLY'), 'DRAFT_ONLY');
  await code(t.auth.setCampaignAutonomy(ed, camp.id, 'APPROVAL_REQUIRED'), 'FORBIDDEN');         // editors lack autonomy.raise
  await code(t.auth.setCampaignAutonomy(owner, camp.id, 'APPROVAL_REQUIRED'), 'FORBIDDEN');       // even an owner needs an approval
  const ask = await t.auth.approvals.request(owner, { kind: 'raise_autonomy', subject_type: 'campaign', subject_id: camp.id, summary: 'Raise to APPROVAL_REQUIRED', payload: { from: 'DRAFT_ONLY', to: 'APPROVAL_REQUIRED' } });
  await code(t.auth.setCampaignAutonomy(owner, camp.id, 'APPROVAL_REQUIRED', { approvalId: ask.id }), 'FORBIDDEN');   // not approved yet
  await t.auth.approvals.decide(ap, ask.id, { approve: true });
  await code(t.auth.setCampaignAutonomy(owner, camp.id, 'AUTO_PUBLISH_APPROVED_TEMPLATES', { approvalId: ask.id }), 'FORBIDDEN');   // approved for a different level
  assert.equal(await t.auth.setCampaignAutonomy(owner, camp.id, 'APPROVAL_REQUIRED', { approvalId: ask.id }), 'APPROVAL_REQUIRED');
  await t.auth.setCampaignAutonomy(ed, camp.id, 'DRAFT_ONLY');
  await code(t.auth.setCampaignAutonomy(owner, camp.id, 'APPROVAL_REQUIRED', { approvalId: ask.id }), 'FORBIDDEN');   // used up
  const log = await t.auth.audit.list(owner, { limit: 50 });
  assert.equal(log.filter((e) => e.action === 'autonomy.changed' && e.subject_id === camp.id).length, 3);
  await code(t.auth.setCampaignAutonomy(owner, '00000000-0000-4000-8000-0000000000ee', 'DRAFT_ONLY'), 'NOT_FOUND');
});

// ---------------------------------------------------------------- audit chain
test('every change is audited, the chain verifies, and secrets never appear in it', async () => {
  const tmp = await t.login(t.orgA, 'tmpx', []);
  await t.auth.users.setDisabled(owner, tmp.userId, true);
  const v = await t.auth.audit.verify(owner);
  assert.equal(v.ok, true);
  assert.ok(v.count > 20);
  const actions = new Set((await t.auth.audit.list(owner, { limit: 500 })).map((e) => e.action));
  for (const a of ['user.created', 'auth.sign_in', 'role.assigned', 'role.created', 'role.deleted', 'approval.requested', 'approval.approved', 'approval.rejected', 'approval.consumed', 'approval.cancelled', 'autonomy.changed', 'user.disabled']) assert.ok(actions.has(a), `missing audit action ${a}`);
  const dump = JSON.stringify(await t.auth.audit.list(owner, { limit: 500 }));
  assert.ok(!/eyJ/.test(dump), 'no tokens in the log');
  await code(t.auth.audit.list(viewer), 'FORBIDDEN');
  await code(t.auth.audit.verify(ed), 'FORBIDDEN');
});

test('concurrent writers still produce one unbroken chain', async () => {
  const t2 = await setup();
  try {
    const boss = await t2.login(t2.orgA, 'boss', ['aff-owners']);
    await Promise.all(Array.from({ length: 12 }, (_, i) => t2.auth.roles.save(boss, { name: `role-${i}`, permissions: ['read'] })));
    const v = await t2.auth.audit.verify(boss);
    assert.equal(v.ok, true);
    assert.ok(v.count >= 13);
  } finally { await t2.close(); }
});

test('tampering is detected: edited entry, removed entry, truncated tail', async () => {
  const t2 = await setup();
  try {
    const boss = await t2.login(t2.orgA, 'boss', ['aff-owners']);
    for (let i = 0; i < 4; i += 1) await t2.auth.roles.save(boss, { name: `r${i}`, permissions: ['read'] });
    const anchor = await t2.auth.audit.anchor(boss);
    assert.ok(anchor.seq >= 5);
    assert.equal((await t2.auth.audit.verify(boss, { anchor })).ok, true);

    // the database refuses edits by itself; simulate an attacker who disables the guard
    await t2.db.exec('ALTER TABLE audit_entries DISABLE TRIGGER audit_append_only');
    await t2.db.query("UPDATE audit_entries SET actor = 'someone-else' WHERE seq = 3");
    let r = await t2.auth.audit.verify(boss);
    assert.deepEqual([r.ok, r.brokenAt, r.reason], [false, 3, 'entry content does not match its hash']);
    await t2.db.query("UPDATE audit_entries SET actor = (SELECT actor FROM audit_entries WHERE seq = 2) WHERE seq = 3");

    await t2.db.query('DELETE FROM audit_entries WHERE seq = 2');
    r = await t2.auth.audit.verify(boss);
    assert.deepEqual([r.ok, r.brokenAt], [false, 2]);
    assert.match(r.reason, /gap/);

    const t3 = await setup();
    try {
      const b3 = await t3.login(t3.orgA, 'boss', ['aff-owners']);
      for (let i = 0; i < 3; i += 1) await t3.auth.roles.save(b3, { name: `r${i}`, permissions: ['read'] });
      const a3 = await t3.auth.audit.anchor(b3);
      await t3.db.exec('ALTER TABLE audit_entries DISABLE TRIGGER audit_append_only');
      await t3.db.query('DELETE FROM audit_entries WHERE seq >= $1', [a3.seq]);
      assert.equal((await t3.auth.audit.verify(b3)).ok, true, 'a chain alone cannot show a cut tail');
      const cut = await t3.auth.audit.verify(b3, { anchor: a3 });
      assert.equal(cut.ok, false);
      assert.match(cut.reason, /truncated/);
    } finally { await t3.close(); }
  } finally { await t2.close(); }
});

test('verifyChain on an empty log is fine', async () => {
  const t2 = await setup();
  try { const r = await t2.scoped(t2.orgA).tx((q) => verifyChain(q)); assert.deepEqual([r.ok, r.count, r.head], [true, 0, null]); } finally { await t2.close(); }
});

import { PERMISSIONS } from '../rbac.js';
import { HttpError, bad } from '../errors.js';
import { verifyPassword } from '../store.js';
import { newSecret, otpauthUri, newRecoveryCodes, verifyTotp, hashRecovery } from '../totp.js';

export function registerAdmin(app, ctx) {
  const { store, wrap, need, auth } = ctx;
  const admin = need('users.admin');
  const me = need('read');

  app.post('/api/me/password', (req, res, next) => { try { auth.changePassword(req, res); } catch (e) { next(e); } });

  app.get('/api/admin/permissions', admin, (req, res) => res.json(PERMISSIONS));
  app.get('/api/admin/users', admin, (req, res) => res.json({ users: store.listUsers(), roles: store.listRoles() }));

  app.post('/api/admin/users', admin, wrap(async (req, res) => {
    const { name, password, role } = req.body || {};
    res.status(201).json(store.createUser({ name, password, role }));
  }));

  app.patch('/api/admin/users/:name', admin, wrap(async (req, res) => {
    const b = req.body || {};
    if (req.params.name === req.user.name && (b.role !== undefined || b.disabled !== undefined)) {throw bad('You cannot change your own role or disable yourself');}
    res.json(store.updateUser(req.params.name, { role: b.role, disabled: b.disabled, password: b.password }));
  }));

  app.delete('/api/admin/users/:name', admin, wrap(async (req, res) => {
    if (req.params.name === req.user.name) {throw bad('You cannot delete yourself');}
    store.deleteUser(req.params.name);
    res.json({ ok: true });
  }));

  app.post('/api/admin/roles', admin, wrap(async (req, res) => {
    res.status(201).json(store.saveRole(req.body || {}));
  }));
  app.delete('/api/admin/roles/:name', admin, wrap(async (req, res) => {
    store.deleteRole(req.params.name);
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit', need('audit.read'), (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ entries: store.auditTail(limit) });
  });
  app.get('/api/admin/audit/verify', need('audit.read'), (req, res) => {
    res.json(store.auditVerify());
  });
  app.get('/api/admin/audit/export', need('audit.read'), (req, res) => {
    res.type('application/json').set('Content-Disposition', 'attachment; filename="audit.jsonl"').send(store.auditExport());
  });

  // ---- two-factor (own account only) ----
  app.get('/api/me/totp', me, (req, res) => {
    const u = store.getUser(req.user.name);
    res.json({ enabled: !!u && !!u.totp && u.totp.enabled });
  });
  app.post('/api/me/totp/setup', me, wrap(async (req, res) => {
    const u = store.getUser(req.user.name);
    if (!u) {throw new HttpError(404, 'No such user');}
    if (u.totp && u.totp.enabled) {throw new HttpError(409, 'Two-factor sign-in is already on');}
    const secret = newSecret();
    store.totpBegin(req.user.name, secret);
    res.json({ secret, uri: otpauthUri(req.user.name, secret) });
  }));
  app.post('/api/me/totp/enable', me, wrap(async (req, res) => {
    const u = store.getUser(req.user.name);
    if (!u || !(u.totp && u.totp.secret)) {throw new HttpError(409, 'Start setup first');}
    const code = String((req.body && req.body.code) || '').trim();
    const step = verifyTotp(u.totp.secret, code, { lastStep: u.totp.lastStep ?? -1 });
    if (step === null) {throw new HttpError(400, 'That code is not valid');}
    const recovery = newRecoveryCodes();
    store.totpEnable(req.user.name, recovery.map(hashRecovery), step);
    res.json({ recoveryCodes: recovery });
  }));
  app.post('/api/me/totp/disable', me, wrap(async (req, res) => {
    const { current, code } = req.body || {};
    const u = store.getUser(req.user.name);
    if (!u || !verifyPassword(current, u.hash)) {throw new HttpError(403, 'Current password is incorrect');}
    if (!u.totp || !u.totp.enabled) {throw new HttpError(409, 'Two-factor sign-in is not on');}
    const good = verifyTotp(u.totp.secret, String(code || '').trim(), { lastStep: u.totp.lastStep ?? -1 }) !== null
      || (typeof code === 'string' && /^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(code) && store.totpUseRecovery(req.user.name, hashRecovery(code)));
    if (!good) {throw new HttpError(400, 'That code is not valid, or was already used');}
    store.totpDisable(req.user.name);
    res.json({ ok: true });
  }));
}

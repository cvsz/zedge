import { PERMISSIONS } from '../rbac.js';
import { bad } from '../errors.js';

export function registerAdmin(app, ctx) {
  const { store, wrap, need, auth } = ctx;
  const admin = need('users.admin');

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
}

import { CFError } from '../cf.js';
import { HttpError, bad } from '../errors.js';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_CODE = 1024 * 1024;
const KEEP_BINDINGS = ['secret_text', 'secret_key', 'plain_text', 'json', 'kv_namespace', 'r2_bucket', 'd1', 'queue', 'service', 'durable_object_namespace', 'analytics_engine', 'ai', 'vectorize', 'hyperdrive'];

export function registerWorkers(app, ctx) {
  const { cf, wrap, need, accountId } = ctx;
  const base = async (req) => `/accounts/${await accountId(req)}/workers/scripts/${req.params.name}`;

  app.param('name', (req, res, next, v) => (NAME_RE.test(v) ? next() : next(bad('Invalid Worker name'))));

  /** Everything the Workers screen needs about one Worker. */
  app.get('/api/workers/:name', need('read'), wrap(async (req, res) => {
    const p = await base(req);
    const [settings, deployments, versions, secrets] = await Promise.allSettled([
      cf.get(`${p}/settings`), cf.get(`${p}/deployments`), cf.get(`${p}/versions`), cf.get(`${p}/secrets`)
    ]);
    const bindings = (settings.status === 'fulfilled' && settings.value.result && settings.value.result.bindings) || [];
    const secretNames = secrets.status === 'fulfilled' ? (secrets.value.result || []).map((s) => s.name) : bindings.filter((b) => b.type === 'secret_text').map((b) => b.name);
    const dep = deployments.status === 'fulfilled' ? deployments.value.result : null;
    const ver = versions.status === 'fulfilled' ? versions.value.result : null;
    res.json({
      name: req.params.name,
      compatibilityDate: (settings.status === 'fulfilled' && settings.value.result && settings.value.result.compatibility_date) || null,
      vars: bindings.filter((b) => b.type === 'plain_text').map((b) => ({ name: b.name, value: b.text })),
      secrets: secretNames,
      otherBindings: bindings.filter((b) => !['plain_text', 'secret_text'].includes(b.type)).map((b) => ({ name: b.name, type: b.type })),
      deployments: ((dep && dep.deployments) || []).map((d) => ({ id: d.id, createdOn: d.created_on, source: d.source, versions: (d.versions || []).map((v) => ({ id: v.version_id, percentage: v.percentage })) })),
      versions: ((ver && ver.items) || ver || []).map((v) => ({ id: v.id, number: v.number, createdOn: v.metadata && v.metadata.created_on })).filter((v) => v.id)
    });
  }));

  /** Upload new module code. Existing bindings and secrets are kept. */
  app.post('/api/workers/:name/deploy', need('workers.write'), wrap(async (req, res) => {
    const code = String((req.body && req.body.code) || '');
    if (!code.trim()) throw bad('Paste the Worker code first');
    if (Buffer.byteLength(code) > MAX_CODE) throw bad('Worker code is larger than 1 MB');
    const date = (req.body && req.body.compatibilityDate) || new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(date)) throw bad('Compatibility date must look like 2026-01-31');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js', compatibility_date: date, keep_bindings: KEEP_BINDINGS })], { type: 'application/json' }));
    form.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');
    const r = await cf.putForm(await base(req), form);
    res.status(201).json({ id: r.result && r.result.id, deployed: true });
  }));

  /** Send 100% of traffic back to an earlier version. */
  app.post('/api/workers/:name/rollback', need('workers.write'), wrap(async (req, res) => {
    const versionId = String((req.body && req.body.versionId) || '');
    if (!VERSION_RE.test(versionId)) throw bad('Choose a version to roll back to');
    const p = await base(req);
    const r = await cf.post(`${p}/deployments`, {
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { 'workers/message': 'Rolled back from Zedge' }
    });
    res.json({ ok: true, deployment: r.result && r.result.id });
  }));

  async function readBindings(p) {
    return ((await cf.get(`${p}/settings`)).result || {}).bindings || [];
  }
  async function writeBindings(p, bindings) {
    const form = new FormData();
    form.append('settings', new Blob([JSON.stringify({ bindings })], { type: 'application/json' }));
    await cf.patchForm(`${p}/settings`, form);
  }

  app.put('/api/workers/:name/vars/:key', need('workers.write'), wrap(async (req, res) => {
    if (!KEY_RE.test(req.params.key)) throw bad('Variable names use letters, digits and underscores');
    const value = String((req.body && req.body.value) ?? '');
    if (value.length > 5000) throw bad('Value is too long');
    const p = await base(req);
    const others = (await readBindings(p)).filter((b) => b.name !== req.params.key);
    await writeBindings(p, [...others, { type: 'plain_text', name: req.params.key, text: value }]);
    res.json({ ok: true });
  }));

  app.delete('/api/workers/:name/vars/:key', need('workers.write'), wrap(async (req, res) => {
    if (!KEY_RE.test(req.params.key)) throw bad('Invalid variable name');
    const p = await base(req);
    const all = await readBindings(p);
    if (!all.some((b) => b.name === req.params.key && b.type === 'plain_text')) throw new HttpError(404, 'No such variable');
    await writeBindings(p, all.filter((b) => b.name !== req.params.key));
    res.json({ ok: true });
  }));

  app.put('/api/workers/:name/secrets/:key', need('workers.write'), wrap(async (req, res) => {
    if (!KEY_RE.test(req.params.key)) throw bad('Secret names use letters, digits and underscores');
    const value = String((req.body && req.body.value) || '');
    if (!value || value.length > 5000) throw bad('Enter the secret value (up to 5000 characters)');
    await cf.put(`${await base(req)}/secrets`, { name: req.params.key, text: value, type: 'secret_text' });
    res.json({ ok: true });
  }));

  app.delete('/api/workers/:name/secrets/:key', need('workers.write'), wrap(async (req, res) => {
    if (!KEY_RE.test(req.params.key)) throw bad('Invalid secret name');
    try { await cf.del(`${await base(req)}/secrets/${req.params.key}`); } catch (e) {
      if (e instanceof CFError && e.status === 404) throw new HttpError(404, 'No such secret');
      throw e;
    }
    res.json({ ok: true });
  }));
}

import { bad } from '../errors.js';

const SNIPPET_RE = /^[A-Za-z0-9_]{1,64}$/;
const KV_NS_RE = /^[a-f0-9]{32}$/;
const D1_RE = /^[A-Za-z0-9-]{6,64}$/;
const MAX_CODE = 32 * 1024;
const MAX_ZONEFILE = 1024 * 1024;
const MAX_KV_VALUE = 1024 * 1024;
const READ_ONLY_SQL = /^(select|with|explain|pragma\s+table_info|pragma\s+table_list|pragma\s+index_list)\b/i;

/** Things that are not a plain "call this Cloudflare endpoint": snippets, KV values, D1 SQL, DNS zone files. */
export function registerEdge(app, ctx) {
  const { cf, wrap, need, accountId } = ctx;

  // ---------------------------------------------------------------- Snippets
  app.put('/api/zones/:zid/snippets/:name', need('workers.write'), wrap(async (req, res) => {
    if (!SNIPPET_RE.test(req.params.name)) throw bad('Snippet names use letters, digits and underscores');
    const code = String((req.body && req.body.code) || '');
    if (!code.trim()) throw bad('Paste the snippet code first');
    if (Buffer.byteLength(code) > MAX_CODE) throw bad('Snippets are limited to 32 KB');
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: 'snippet.js' })], { type: 'application/json' }));
    form.append('files', new Blob([code], { type: 'application/javascript+module' }), 'snippet.js');
    await cf.putForm(`/zones/${req.params.zid}/snippets/${req.params.name}`, form);
    res.json({ ok: true });
  }));

  app.delete('/api/zones/:zid/snippets/:name', need('workers.write'), wrap(async (req, res) => {
    if (!SNIPPET_RE.test(req.params.name)) throw bad('Invalid snippet name');
    await cf.del(`/zones/${req.params.zid}/snippets/${req.params.name}`);
    res.json({ ok: true });
  }));

  /** Snippet rules are replaced as a whole list, so the list is validated here. */
  app.put('/api/zones/:zid/snippet-rules', need('workers.write'), wrap(async (req, res) => {
    const list = req.body && req.body.rules;
    if (!Array.isArray(list) || list.length > 25) throw bad('Send between 0 and 25 rules');
    const rules = list.map((r, i) => {
      const name = String((r && r.snippet_name) || '');
      const expression = String((r && r.expression) || '').trim();
      if (!SNIPPET_RE.test(name)) throw bad(`Rule ${i + 1}: choose a snippet`);
      if (!expression || expression.length > 4000) throw bad(`Rule ${i + 1}: enter a match expression`);
      return { snippet_name: name, expression, enabled: r.enabled !== false, description: String(r.description || '').slice(0, 200) };
    });
    await cf.put(`/zones/${req.params.zid}/snippets/snippet_rules`, { rules });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- KV values (plain text)
  const kvBase = async (req) => {
    if (!KV_NS_RE.test(req.params.ns)) throw bad('Invalid namespace id');
    return `/accounts/${await accountId(req)}/storage/kv/namespaces/${req.params.ns}`;
  };
  const kvKey = (req) => {
    const key = String(req.query.key || '');
    if (!key || Buffer.byteLength(key) > 512) throw bad('Key must be 1 to 512 bytes');
    return encodeURIComponent(key);
  };

  app.get('/api/kv/:ns/value', need('data.access'), wrap(async (req, res) => {
    const text = await cf.rawText('GET', `${await kvBase(req)}/values/${kvKey(req)}`);
    if (text.length > MAX_KV_VALUE) throw bad('That value is larger than 1 MB; open it with Wrangler instead');
    res.json({ key: String(req.query.key), value: text });
  }));

  app.put('/api/kv/:ns/value', need('data.access'), wrap(async (req, res) => {
    const value = req.body && req.body.value;
    if (typeof value !== 'string') throw bad('value must be text');
    if (Buffer.byteLength(value) > MAX_KV_VALUE) throw bad('Values are limited to 1 MB here');
    const query = {};
    if (req.body.expirationTtl !== undefined && req.body.expirationTtl !== '') {
      const n = Number(req.body.expirationTtl);
      if (!Number.isInteger(n) || n < 60 || n > 31536000) throw bad('Expiration must be a whole number of seconds from 60 to 31536000');
      query.expiration_ttl = String(n);
    }
    await cf.rawText('PUT', `${await kvBase(req)}/values/${kvKey(req)}`, { body: value, query });
    res.json({ ok: true });
  }));

  app.delete('/api/kv/:ns/value', need('data.access'), wrap(async (req, res) => {
    await cf.del(`${await kvBase(req)}/values/${kvKey(req)}`);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- D1 SQL console
  app.post('/api/d1/:db/query', need('data.access'), wrap(async (req, res) => {
    if (!D1_RE.test(req.params.db)) throw bad('Invalid database id');
    const sql = String((req.body && req.body.sql) || '').trim();
    if (!sql) throw bad('Enter some SQL');
    if (sql.length > 20000) throw bad('SQL is limited to 20,000 characters');
    const params = (req.body && req.body.params) || [];
    if (!Array.isArray(params) || params.length > 100 || params.some((p) => p !== null && !['string', 'number', 'boolean'].includes(typeof p))) throw bad('params must be a list of up to 100 text, number or boolean values');
    const allowWrite = !!(req.body && req.body.allowWrite);
    if (!allowWrite) {
      const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean);
      if (stmts.some((x) => !READ_ONLY_SQL.test(x))) throw bad('This looks like a change. Turn on "Allow changes" to run INSERT, UPDATE, DELETE or schema statements.');
    }
    const r = await cf.post(`/accounts/${await accountId(req)}/d1/database/${req.params.db}/query`, { sql, params });
    const results = (r.result || []).map((x) => ({ success: x.success !== false, rows: (x.results || []).slice(0, 500), truncated: (x.results || []).length > 500, meta: x.meta || {} }));
    res.json({ results });
  }));

  // ---------------------------------------------------------------- DNS zone file import / export
  app.get('/api/zones/:zid/dns/export', need('read'), wrap(async (req, res) => {
    const text = await cf.rawText('GET', `/zones/${req.params.zid}/dns_records/export`);
    res.type('text/plain').set('Content-Disposition', 'attachment; filename="zone.txt"').send(text);
  }));

  app.post('/api/zones/:zid/dns/import', need('dns.write'), wrap(async (req, res) => {
    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) throw bad('Paste or choose a BIND zone file first');
    if (Buffer.byteLength(text) > MAX_ZONEFILE) throw bad('Zone files are limited to 1 MB');
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/plain' }), 'zone.txt');
    form.append('proxied', req.body.proxied ? 'true' : 'false');
    const r = await cf.raw('POST', `/zones/${req.params.zid}/dns_records/import`, { form });
    res.json({ added: (r.result && r.result.recs_added) ?? null, parsed: (r.result && r.result.total_records_parsed) ?? null });
  }));
}

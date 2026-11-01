import http from 'node:http';

/** In-memory stand-in for the Cloudflare v4 API: enough to exercise every console feature. */
export async function startMock({ token = 'test-token', accounts = [{ id: 'a'.repeat(32), name: 'Main' }] } = {}) {
  let seq = 1;
  const id = () => (seq++).toString(16).padStart(32, '0');
  const zid = 'z'.repeat(32);
  const state = {
    accounts,
    zones: [{ id: zid, name: 'zeaz.dev', status: 'active', name_servers: ['a.ns.example', 'b.ns.example'], account: { id: accounts[0].id } }],
    records: [],
    settings: { ssl: 'strict', min_tls_version: '1.2', always_use_https: 'on', http3: 'on', brotli: 'on', early_hints: 'off', development_mode: 'off', security_level: 'medium' },
    purges: [],
    rulesets: {},
    pagerules: [],
    workers: {},
    tunnels: [{ id: 'b'.repeat(32), name: 'edge-bkk', status: 'healthy', connections: [{}, {}] }],
    tunnelConfigs: {},
    apps: [], policies: {}, posture: [], gateway: [],
    lifecycle: {}, cors: {}, buckets: [{ name: 'zeaz-assets' }],
    email: { enabled: false, rules: [], catchAll: { enabled: false, actions: [], matchers: [{ type: 'all' }] }, addresses: [] },
    tokens: [], graphql: [], calls: []
  };
  const rec = (type, name, content, proxied = true) => state.records.push({ id: id(), type, name, content, proxied, ttl: 1 });
  rec('A', 'zeaz.dev', '203.0.113.10');
  rec('A', 'api.zeaz.dev', '203.0.113.20');
  rec('A', 'mail.zeaz.dev', '203.0.113.30', false);
  rec('TXT', 'zeaz.dev', 'v=spf1 include:_spf.example.net ~all', false);
  const groups = ['DNS Write', 'Zone Read', 'Workers R2 Storage Write'].map((name, i) => ({ id: `g${i + 1}`, name }));

  const worker = (n) => (state.workers[n] ||= { code: '', bindings: [], versions: [], deployments: [], date: '2026-01-01' });
  const addVersion = (w) => { const v = { id: id(), number: w.versions.length + 1, metadata: { created_on: new Date().toISOString() } }; w.versions.push(v); return v; };
  const deploy = (w, versionId) => w.deployments.unshift({ id: id(), created_on: new Date().toISOString(), source: 'api', versions: [{ version_id: versionId, percentage: 100 }] });
  const part = (raw, name) => { const m = raw.match(new RegExp(`name="${name}"[^\\r]*\\r\\n(?:[^\\r\\n]+\\r\\n)*\\r\\n([\\s\\S]*?)\\r\\n--`)); return m ? m[1] : undefined; };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/client\/v4/, '');
      const isForm = (req.headers['content-type'] || '').startsWith('multipart/');
      const body = raw && !isForm ? JSON.parse(raw) : undefined;
      state.calls.push(`${req.method} ${p}`);
      const send = (status, result, extra = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: status < 400, errors: status < 400 ? [] : [{ code: 9999, message: result }], result: status < 400 ? result : null, ...extra }));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(403, 'Invalid token');

      let m;
      const A = '/accounts/(\\w+)';
      const is = (method, re) => (req.method === method && (m = p.match(new RegExp(`^${re}$`)))) ? m : null;

      if (is('GET', '/user/tokens/verify')) return send(200, { id: 't1', status: 'active' });
      if (is('GET', '/accounts')) return send(200, state.accounts);
      if (is('POST', '/graphql')) {
        const b = JSON.parse(raw);
        state.graphql.push(b);
        const hourly = b.query.includes('httpRequests1hGroups');
        const row = (t, n) => ({ dimensions: hourly ? { datetime: t } : { date: t }, sum: { requests: 100 * n, cachedRequests: 90 * n, bytes: 1000 * n, cachedBytes: 800 * n, threats: n } });
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { viewer: { zones: [{ series: [row('2026-01-01', 1), row('2026-01-02', 2)] }] } }, errors: null }));
      }

      // ---- zones + dns ----
      if (is('POST', '/zones')) {
        if (state.zones.some((z) => z.name === body.name)) return send(400, 'Zone already exists');
        const z = { id: id(), name: body.name, status: 'pending', name_servers: ['x.ns.example', 'y.ns.example'], account: body.account };
        state.zones.push(z);
        return send(200, z);
      }
      if (is('GET', '/zones')) {
        const acc = url.searchParams.get('account.id');
        return send(200, state.zones.filter((z) => !acc || z.account.id === acc), { result_info: { total_pages: 1 } });
      }
      if (is('GET', '/zones/(\\w+)')) { const z = state.zones.find((x) => x.id === m[1]); return z ? send(200, z) : send(404, 'Zone not found'); }
      if (is('GET', '/zones/(\\w+)/dns_records') || is('POST', '/zones/(\\w+)/dns_records')) {
        if (req.method === 'GET') {
          let list = state.records;
          if (url.searchParams.get('type')) list = list.filter((r) => r.type === url.searchParams.get('type'));
          if (url.searchParams.get('name')) list = list.filter((r) => r.name === url.searchParams.get('name'));
          return send(200, list, { result_info: { total_pages: 1 } });
        }
        if (state.records.some((r) => r.name === body.name && r.type === body.type)) return send(400, 'Record already exists');
        const r = { id: id(), ...body };
        state.records.push(r);
        return send(200, r);
      }
      if ((m = p.match(/^\/zones\/(\w+)\/dns_records\/(\w+)$/))) {
        const i = state.records.findIndex((r) => r.id === m[2]);
        if (i < 0) return send(404, 'Record not found');
        if (req.method === 'PATCH') { state.records[i] = { ...state.records[i], ...body }; return send(200, state.records[i]); }
        if (req.method === 'DELETE') { state.records.splice(i, 1); return send(200, { id: m[2] }); }
      }

      if (is('GET', '/zones/(\\w+)/settings')) return send(200, Object.entries(state.settings).map(([sid, value]) => ({ id: sid, value })));
      if (is('PATCH', '/zones/(\\w+)/settings/(\\w+)')) { state.settings[m[2]] = body.value; return send(200, { id: m[2], value: body.value }); }
      if (is('POST', '/zones/(\\w+)/purge_cache')) { state.purges.push(body); return send(200, { id: 'purge' }); }

      // ---- rulesets (all phases) ----
      if ((m = p.match(/^\/zones\/(\w+)\/rulesets\/phases\/(\w+)\/entrypoint$/))) {
        const phase = m[2];
        if (req.method === 'GET') return state.rulesets[phase] ? send(200, state.rulesets[phase]) : send(404, 'could not find entrypoint ruleset');
        if (req.method === 'PUT') { state.rulesets[phase] = { id: id(), phase, rules: (body.rules || []).map((r) => ({ id: id(), ...r })) }; return send(200, state.rulesets[phase]); }
      }
      if ((m = p.match(/^\/zones\/(\w+)\/rulesets\/(\w+)\/rules(?:\/(\w+))?$/))) {
        const rs = Object.values(state.rulesets).find((r) => r.id === m[2]);
        if (!rs) return send(404, 'ruleset not found');
        if (req.method === 'POST') { rs.rules.push({ id: id(), ...body }); return send(200, rs); }
        const i = rs.rules.findIndex((r) => r.id === m[3]);
        if (i < 0) return send(404, 'rule not found');
        if (req.method === 'PATCH') { rs.rules[i] = { ...rs.rules[i], ...body }; return send(200, rs); }
        if (req.method === 'DELETE') { rs.rules.splice(i, 1); return send(200, rs); }
      }
      if (is('GET', '/zones/(\\w+)/pagerules')) return send(200, state.pagerules);
      if (is('POST', '/zones/(\\w+)/pagerules')) { const r = { id: id(), status: 'active', ...body }; state.pagerules.push(r); return send(200, r); }
      if ((m = p.match(/^\/zones\/(\w+)\/pagerules\/(\w+)$/))) {
        const i = state.pagerules.findIndex((r) => r.id === m[2]);
        if (i < 0) return send(404, 'not found');
        if (req.method === 'PATCH') { state.pagerules[i] = { ...state.pagerules[i], ...body }; return send(200, state.pagerules[i]); }
        if (req.method === 'DELETE') { state.pagerules.splice(i, 1); return send(200, { id: m[2] }); }
      }

      // ---- email routing ----
      if (is('GET', '/zones/(\\w+)/email/routing')) return send(200, { enabled: state.email.enabled, status: state.email.enabled ? 'ready' : 'unconfigured' });
      if (is('POST', '/zones/(\\w+)/email/routing/dns')) { state.email.enabled = true; return send(200, {}); }
      if (is('DELETE', '/zones/(\\w+)/email/routing/dns')) { state.email.enabled = false; return send(200, {}); }
      if (is('GET', '/zones/(\\w+)/email/routing/rules/catch_all')) return send(200, state.email.catchAll);
      if (is('PUT', '/zones/(\\w+)/email/routing/rules/catch_all')) { state.email.catchAll = body; return send(200, body); }
      if (is('GET', '/zones/(\\w+)/email/routing/rules')) return send(200, state.email.rules);
      if (is('POST', '/zones/(\\w+)/email/routing/rules')) { const r = { id: id(), ...body }; state.email.rules.push(r); return send(200, r); }
      if ((m = p.match(/^\/zones\/(\w+)\/email\/routing\/rules\/(\w+)$/))) {
        const i = state.email.rules.findIndex((r) => r.id === m[2]);
        if (i < 0) return send(404, 'not found');
        if (req.method === 'PUT') { state.email.rules[i] = { id: m[2], ...body }; return send(200, state.email.rules[i]); }
        if (req.method === 'DELETE') { state.email.rules.splice(i, 1); return send(200, {}); }
      }
      if (is('GET', `${A}/email/routing/addresses`)) return send(200, state.email.addresses);
      if (is('POST', `${A}/email/routing/addresses`)) { const a = { id: id(), verified: null, ...body }; state.email.addresses.push(a); return send(200, a); }

      // ---- workers ----
      if (is('GET', `${A}/workers/scripts`)) return send(200, Object.keys(state.workers).map((n) => ({ id: n, modified_on: '2026-01-01T00:00:00Z' })));
      if ((m = p.match(new RegExp(`^${A}/workers/scripts/([\\w-]+)(?:/(\\w+))?(?:/(\\w+))?$`)))) {
        const w = worker(m[2]);
        const sub = m[3];
        if (!sub && req.method === 'PUT') {
          const meta = JSON.parse(part(raw, 'metadata'));
          w.code = part(raw, 'worker.js'); w.meta = meta; w.date = meta.compatibility_date;
          const v = addVersion(w); deploy(w, v.id);
          return send(200, { id: m[2] });
        }
        if (sub === 'settings' && req.method === 'GET') return send(200, { bindings: w.bindings, compatibility_date: w.date });
        if (sub === 'settings' && req.method === 'PATCH') { w.bindings = JSON.parse(part(raw, 'settings')).bindings; return send(200, { bindings: w.bindings }); }
        if (sub === 'deployments' && req.method === 'GET') return send(200, { deployments: w.deployments });
        if (sub === 'deployments' && req.method === 'POST') { const d = { id: id(), created_on: new Date().toISOString(), source: 'api', versions: body.versions }; w.deployments.unshift(d); return send(200, d); }
        if (sub === 'versions' && req.method === 'GET') return send(200, { items: w.versions });
        if (sub === 'secrets' && req.method === 'GET') return send(200, w.bindings.filter((b) => b.type === 'secret_text').map((b) => ({ name: b.name, type: 'secret_text' })));
        if (sub === 'secrets' && req.method === 'PUT') { w.bindings = w.bindings.filter((b) => b.name !== body.name); w.bindings.push({ type: 'secret_text', name: body.name }); w.secretValues = { ...(w.secretValues || {}), [body.name]: body.text }; return send(200, { name: body.name }); }
      }
      if ((m = p.match(new RegExp(`^${A}/workers/scripts/([\\w-]+)/secrets/(\\w+)$`))) && req.method === 'DELETE') {
        const w = worker(m[2]);
        if (!w.bindings.some((b) => b.name === m[3])) return send(404, 'secret not found');
        w.bindings = w.bindings.filter((b) => b.name !== m[3]);
        return send(200, {});
      }

      // ---- storage ----
      if (is('GET', `${A}/r2/buckets`)) return send(200, { buckets: state.buckets });
      if (is('POST', `${A}/r2/buckets`)) { state.buckets.push({ name: body.name }); return send(200, { name: body.name }); }
      if ((m = p.match(new RegExp(`^${A}/r2/buckets/([a-z0-9-]+)/(lifecycle|cors)$`)))) {
        const store = state[m[3]];
        if (req.method === 'GET') return send(200, store[m[2]] || { rules: [] });
        if (req.method === 'PUT') { store[m[2]] = body; return send(200, {}); }
        if (req.method === 'DELETE') { delete store[m[2]]; return send(200, {}); }
      }
      if (is('GET', `${A}/storage/kv/namespaces`)) return send(200, [{ id: 'kv1', title: 'SESSIONS' }]);
      if (is('GET', `${A}/d1/database`)) return send(200, [{ uuid: 'd1', name: 'ops-db' }]);

      // ---- zero trust ----
      if (is('GET', `${A}/cfd_tunnel`)) { const n = url.searchParams.get('name'); return send(200, state.tunnels.filter((t) => !n || t.name === n)); }
      if (is('POST', `${A}/cfd_tunnel`)) { const t = { id: id(), name: body.name, status: 'inactive', connections: [] }; state.tunnels.push(t); return send(200, t); }
      if (is('GET', `${A}/cfd_tunnel/(\\w+)/token`)) return send(200, `tunnel-token-${m[2]}`);
      if ((m = p.match(new RegExp(`^${A}/cfd_tunnel/(\\w+)/configurations$`)))) {
        const cur = (state.tunnelConfigs[m[2]] ||= { config: { ingress: [{ hostname: 'old.zeaz.dev', service: 'http://localhost:1' }, { service: 'http_status:404' }] } });
        if (req.method === 'GET') return send(200, cur);
        if (req.method === 'PUT') { state.tunnelConfigs[m[2]] = body; return send(200, body); }
      }
      if (is('GET', `${A}/access/apps`)) return send(200, state.apps);
      if (is('POST', `${A}/access/apps`)) { const a = { id: id(), ...body }; state.apps.push(a); state.policies[a.id] = []; return send(200, a); }
      if ((m = p.match(new RegExp(`^${A}/access/apps/(\\w+)$`)))) {
        const i = state.apps.findIndex((a) => a.id === m[2]);
        if (i < 0) return send(404, 'app not found');
        if (req.method === 'PUT') { state.apps[i] = { id: m[2], ...body }; return send(200, state.apps[i]); }
        if (req.method === 'DELETE') { state.apps.splice(i, 1); return send(200, {}); }
      }
      if ((m = p.match(new RegExp(`^${A}/access/apps/(\\w+)/policies(?:/(\\w+))?$`)))) {
        const list = (state.policies[m[2]] ||= []);
        if (req.method === 'GET') return send(200, list);
        if (req.method === 'POST') { const x = { id: id(), ...body }; list.push(x); return send(200, x); }
        const i = list.findIndex((x) => x.id === m[3]);
        if (i < 0) return send(404, 'policy not found');
        if (req.method === 'PUT') { list[i] = { id: m[3], ...body }; return send(200, list[i]); }
        if (req.method === 'DELETE') { list.splice(i, 1); return send(200, {}); }
      }
      for (const [seg, key] of [['devices/posture', 'posture'], ['gateway/rules', 'gateway']]) {
        if ((m = p.match(new RegExp(`^${A}/${seg}(?:/(\\w+))?$`)))) {
          const list = state[key];
          if (req.method === 'GET') return send(200, list);
          if (req.method === 'POST') { const x = { id: id(), ...body }; list.push(x); return send(200, x); }
          const i = list.findIndex((x) => x.id === m[2]);
          if (i < 0) return send(404, 'not found');
          if (req.method === 'PUT') { list[i] = { id: m[2], ...body }; return send(200, list[i]); }
          if (req.method === 'DELETE') { list.splice(i, 1); return send(200, {}); }
        }
      }
      if (is('GET', `${A}/gateway/categories`)) return send(200, [{ id: 1, name: 'Malware' }, { id: 2, name: 'Phishing' }]);

      // ---- tokens ----
      if (is('GET', '/user/tokens/permission_groups')) return send(200, groups);
      if (is('GET', '/user/tokens')) return send(200, state.tokens);
      if (is('POST', '/user/tokens')) { const t = { id: id(), value: 'secret-token-value', ...body }; state.tokens.push(t); return send(200, t); }
      return send(404, `No mock for ${req.method} ${p}`);
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/client/v4`, state, zoneId: zid, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

/** Minimal R2 S3 endpoint: checks the SigV4 header shape and stores objects in memory. */
export async function startMockS3({ accessKeyId = 'R2KEY' } = {}) {
  const objects = new Map(); // "bucket/key" -> { body, type }
  const calls = [];
  const xmlErr = (res, status, code, msg) => { res.writeHead(status, { 'Content-Type': 'application/xml' }); res.end(`<Error><Code>${code}</Code><Message>${msg}</Message></Error>`); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const auth = req.headers.authorization || '';
      calls.push({ method: req.method, path: url.pathname, query: url.search, auth });
      if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`) || !auth.includes('/auto/s3/aws4_request') || !/Signature=[0-9a-f]{64}$/.test(auth)) return xmlErr(res, 403, 'SignatureDoesNotMatch', 'bad signature');
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      if (req.method === 'GET' && !key) {
        const prefix = url.searchParams.get('prefix') || '';
        const contents = []; const prefixes = new Set();
        for (const [k, v] of objects) {
          if (!k.startsWith(`${bucket}/`)) continue;
          const name = k.slice(bucket.length + 1);
          if (!name.startsWith(prefix)) continue;
          const tail = name.slice(prefix.length);
          if (tail.includes('/')) prefixes.add(prefix + tail.split('/')[0] + '/');
          else contents.push(`<Contents><Key>${name.replace(/&/g, '&amp;')}</Key><Size>${v.body.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"e"</ETag></Contents>`);
        }
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}${[...prefixes].map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'PUT') { objects.set(`${bucket}/${key}`, { body, type: req.headers['content-type'] }); res.writeHead(200); return res.end(); }
      if (req.method === 'GET') {
        const o = objects.get(`${bucket}/${key}`);
        if (!o) return xmlErr(res, 404, 'NoSuchKey', 'missing');
        res.writeHead(200, { 'Content-Type': o.type || 'application/octet-stream', 'Content-Length': o.body.length });
        return res.end(o.body);
      }
      if (req.method === 'DELETE') { objects.delete(`${bucket}/${key}`); res.writeHead(204); return res.end(); }
      return xmlErr(res, 400, 'BadRequest', 'unsupported');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

#!/usr/bin/env node
// Builds docs/openapi.json from the real route table, so the description cannot drift from the code.
//   node scripts/openapi.mjs            write docs/openapi.json
//   node scripts/openapi.mjs --check    exit 1 if the file on disk is out of date
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { ALLOWED } from '../server/allowlist.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'openapi.json');

const ID_CLASS = '[A-Za-z0-9_-]{6,64}';
const NAME_CLASS = '[A-Za-z0-9][A-Za-z0-9_-]{0,62}';
const DOMAIN_CLASS = '[A-Za-z0-9.-]{3,253}';
const IMG_CLASS = '[A-Za-z0-9_./-]{6,128}';
const BUCKET_CLASS = '[a-z0-9][a-z0-9-]{1,61}[a-z0-9]';
const KEY_CLASS = '[a-z0-9_]{2,48}';

/** Turn an allowlist regex source into a path template with numbered parameters. */
function template(pattern) {
  let n = 0;
  let s = pattern;
  for (const [cls, base] of [[ID_CLASS, 'id'], [NAME_CLASS, 'name'], [DOMAIN_CLASS, 'domain'], [IMG_CLASS, 'image'], [BUCKET_CLASS, 'bucket'], [KEY_CLASS, 'setting']]) {
    s = s.split(cls).join(`{${base}}`);
  }
  s = s.replace(/\{(id|name|domain|image|bucket|setting)\}/g, (m, b) => { n += 1; return `{${b}${n}}`; });
  s = s.replace(/\[a-z_\]\{5,50\}/g, '{phase}');
  return s;
}
const params = (p) => [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));

export function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-openapi-'));
  const config = loadConfig({ CLOUDFLARE_API_TOKEN: 'openapi', ZEDGE_ADMIN_PASSWORD: 'openapi-password-123', DATA_DIR: dir, SESSION_SECRET: 's'.repeat(32), CF_API_BASE: 'http://127.0.0.1:9', OIDC_ISSUER: 'http://127.0.0.1:9', OIDC_CLIENT_ID: 'openapi', OIDC_REDIRECT_URL: 'http://127.0.0.1:9/api/oidc/callback' }); // SSO is on so its routes are described too
  const app = createApp(config);
  const paths = {};
  const add = (p, method, op) => { (paths[p] ||= {})[method.toLowerCase()] = op; };

  // 1. the console's own routes, read from the Express router
  for (const layer of app._router.stack) {
    if (!layer.route) {continue;}
    const route = layer.route;
    if (typeof route.path !== 'string' || (!route.path.startsWith('/api/') && route.path !== '/metrics')) {continue;}
    if (route.path === '/api/cf/*') {continue;} // described below from the allowlist
    const oasPath = route.path.replace(/:(\w+)/g, '{$1}');
    const perm = route.stack.map((h) => h.handle.permission).find(Boolean);
    const pub = ['/api/login', '/api/logout', '/api/session', '/api/oidc/login', '/api/oidc/callback', '/metrics'].includes(route.path);
    for (const method of Object.keys(route.methods)) {
      add(oasPath, method, {
        summary: `${method.toUpperCase()} ${oasPath}`,
        tags: [oasPath.split('/')[2] || 'console'],
        ...(params(oasPath).length ? { parameters: params(oasPath) } : {}),
        ...(pub ? { security: [], 'x-permission': 'none (public)' } : { 'x-permission': perm || (oasPath.startsWith('/api/zones/{zid}/rules/') ? 'depends on the rule type: read to view, rules.write (or security.write for custom rules) to change' : 'any signed-in user') }),
        responses: { 200: { description: 'OK' }, 400: { description: 'The request was not valid' }, 401: { description: 'Not signed in' }, 403: { description: 'Not permitted' } }
      });
    }
  }

  // 2. the Cloudflare pass-through: only the allowlisted calls exist
  for (const r of ALLOWED) {
    const t = `/api/cf${template(r.re.source)}`;
    add(t, r.method, {
      summary: `Cloudflare ${r.method} ${template(r.re.source)}`,
      tags: ['cloudflare'],
      ...(params(t).length ? { parameters: params(t) } : {}),
      'x-permission': r.perm,
      responses: { 200: { description: 'The Cloudflare API response, passed through' }, 403: { description: 'Not permitted' }, 404: { description: 'Not found at Cloudflare' } }
    });
  }

  const sorted = Object.fromEntries(Object.keys(paths).sort().map((k) => [k, Object.fromEntries(Object.keys(paths[k]).sort().map((m) => [m, paths[k][m]]))]));
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    openapi: '3.0.3',
    info: { title: 'Zedge API', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, description: 'The console\'s own HTTP API, generated from its route table. Every non-GET call must send the header X-Requested-With. Each operation lists the permission a role needs in x-permission. Anything not listed here is refused.' },
    servers: [{ url: '/' }],
    security: [{ session: [] }],
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'zedge_session' } } },
    paths: sorted
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = `${JSON.stringify(build(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (current !== text) { console.error('docs/openapi.json is out of date. Run: npm run openapi'); process.exit(1); }
    console.log('docs/openapi.json is up to date');
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`Wrote ${path.relative(process.cwd(), out)} (${Object.keys(JSON.parse(text).paths).length} paths)`);
  }
}

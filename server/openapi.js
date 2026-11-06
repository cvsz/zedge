import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const params = (p) => [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));

export function build(app) {
  const paths = {};
  const add = (p, method, op) => { (paths[p] ||= {})[method.toLowerCase()] = op; };

  for (const layer of app._router.stack) {
    if (!layer.route) {continue;}
    const route = layer.route;
    if (typeof route.path !== 'string' || (!route.path.startsWith('/api/') && route.path !== '/metrics')) {continue;}
    if (route.path === '/api/cf/*') {continue;}
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

  const sorted = Object.fromEntries(Object.keys(paths).sort().map((k) => [k, Object.fromEntries(Object.keys(paths[k]).sort().map((m) => [m, paths[k][m]]))]));
  return {
    openapi: '3.0.3',
    info: { title: 'Zedge API', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, description: 'The console\'s own HTTP API, generated from its route table. Every non-GET call must send the header X-Requested-With. Each operation lists the permission a role needs in x-permission. Anything not listed here is refused.' },
    servers: [{ url: '/' }],
    security: [{ session: [] }],
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'zedge_session' } } },
    paths: sorted
  };
}

export const openApiSpec = null;
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
// Old names that must survive only in the compatibility shim (server/config.js) and the changelog.
// ZEDGE_* are the new names and must NOT be flagged, so match EDGE_* only when not preceded by Z.
const FORBIDDEN = [/(?<!Z)EDGE_[A-Z]/, /edge-console/, /Edge Console/];
const ALLOWED = new Set([
  path.join(ROOT, 'server/config.js'), // compat shim: EDGE_* fallbacks with deprecation warning
  path.join(ROOT, 'CHANGELOG.md'),      // history may mention the old product name
  path.join(ROOT, 'scripts/deploy.mjs'),// migrates an existing .env: reads legacy EDGE_ADMIN_PASSWORD,
                                        // but writes ZEDGE_ADMIN_PASSWORD (the new name)
]);

const SCAN_DIRS = ['server', 'public', 'scripts'];
const SCAN_FILES = [
  'package.json', '.env.example', 'docker-compose.yml', 'Makefile', 'README.md', 'Dockerfile',
];

function collect() {
  const files = new Set(SCAN_FILES.map((f) => path.join(ROOT, f)));
  for (const dir of SCAN_DIRS) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules') continue;
          walk(p);
        } else if (/\.(js|mjs|json|yml|yaml|md)$/.test(e.name)) {
          files.add(p);
        }
      }
    };
    walk(path.join(ROOT, dir));
  }
  return [...files];
}

test('no EDGE_ / edge-console / Edge Console outside compat code and changelog', () => {
  const hits = [];
  for (const f of collect()) {
    if (ALLOWED.has(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(text)) hits.push(`${f} (${re})`);
    }
  }
  assert.deepStrictEqual(hits, [], `Old names found outside compat code/changelog:\n${hits.join('\n')}`);
});

test('cookie is zedge_session (edge_session cookie not issued)', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'server/auth.js'), 'utf8');
  assert.ok(/const COOKIE = 'zedge_session'/.test(auth), 'session cookie must be zedge_session');
  assert.ok(!/['"]edge_session['"]/.test(auth), 'edge_session must not be issued as a cookie name');
});

test('config reads ZEDGE_* names first', () => {
  const config = fs.readFileSync(path.join(ROOT, 'server/config.js'), 'utf8');
  assert.ok(/ZEDGE_ADMIN_PASSWORD/.test(config), 'config must read ZEDGE_ADMIN_PASSWORD');
  assert.ok(/ZEDGE_ALLOW_NO_AUTH/.test(config), 'config must read ZEDGE_ALLOW_NO_AUTH');
});

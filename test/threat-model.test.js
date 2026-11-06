import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function readAll(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readAll(p, out);
    else if (e.isFile() && /\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('THREAT-MODEL.md threats each have corresponding tests', () => {
  const files = readAll(path.join(ROOT, 'test'));
  const testText = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  // Map threat IDs to keywords that should appear in tests
  const threatKeywords = {
    T1: ['token', 'CLOUDFLARE_API_TOKEN', 'session'],
    T2: ['session', 'cookie', 'HttpOnly', 'SameSite'],
    T3: ['CSRF', 'X-Requested-With', 'zedge'],
    T4: ['innerHTML', 'CSP', 'Content-Security-Policy'],
    T5: ['need(', 'permissions', 'rbac'],
    T6: ['assertZone', 'zone', 'account'],
    T7: ['latest', 'dependency', 'npm'],
    T8: ['audit', 'audit.jsonl', 'auditTail'],
    T9: ['COOKIE_SECURE', 'HSTS', 'Strict-Transport-Security'],
    T10: ['rate limit', 'login', 'failure'],
  };

  const missing = [];
  for (const [threatId, keywords] of Object.entries(threatKeywords)) {
    const found = keywords.some((kw) => testText.includes(kw));
    if (!found) missing.push(threatId);
  }
  assert.deepStrictEqual(missing, [], `Threats without test coverage: ${missing.join(', ')}`);
});

test('no unauthenticated mutation routes', () => {
  const appText = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8');
  const lines = appText.split('\n');
  const unauthMutations = [];
  for (let i = 0; i < lines.length; i++) {
    if (/(POST|PUT|PATCH|DELETE)\b/.test(lines[i]) && lines[i].includes('app.')) {
      const ctx = lines.slice(Math.max(0, i - 10), i).join('\n');
      if (!ctx.includes('need(') && !ctx.includes('auth.require') && !ctx.includes('auth.login') && !ctx.includes('auth.logout')) {
        unauthMutations.push(lines[i].trim());
      }
    }
  }
  assert.deepStrictEqual(unauthMutations, [], `Unauthenticated mutation routes: ${unauthMutations.join(', ')}`);
});

test('no DELETE grant without permission check', () => {
  const files = fs.readdirSync(path.join(ROOT, 'server', 'routes'), { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.js'))
    .map((f) => f.name);
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, 'server', 'routes', f), 'utf8');
    if (text.includes('DELETE') && text.includes('app.delete')) {
      assert.ok(text.includes('need('), `${f}: DELETE route without permission check`);
    }
  }
});

test('no inline script or style in frontend', () => {
  const files = fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.js'))
    .map((f) => f.name);
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    assert.ok(!text.includes('innerHTML'), `${f}: innerHTML found (XSS risk)`);
    assert.ok(!/style=/.test(text), `${f}: inline style found`);
  }
});

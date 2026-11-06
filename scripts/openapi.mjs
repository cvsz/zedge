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
import { build } from '../server/openapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'openapi.json');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-openapi-'));
  const config = loadConfig({ CLOUDFLARE_API_TOKEN: 'openapi', ZEDGE_ADMIN_PASSWORD: 'openapi-password-123', DATA_DIR: dir, SESSION_SECRET: 's'.repeat(32), CF_API_BASE: 'http://127.0.0.1:9', OIDC_ISSUER: 'http://127.0.0.1:9', OIDC_CLIENT_ID: 'openapi', OIDC_REDIRECT_URL: 'http://127.0.0.1:9/api/oidc/callback' });
  const app = createApp(config);
  const text = `${JSON.stringify(build(app), null, 2)}\n`;
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

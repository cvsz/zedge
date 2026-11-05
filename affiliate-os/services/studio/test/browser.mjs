// Browser check of the studio UI (needs Playwright; run: node test/browser.mjs). Injects a signed Access token like Cloudflare would.
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { setup, newKey } from '../../auth/test/helpers.js';
import { createStudio, createAccessVerifier } from '../src/index.js';
const { chromium } = createRequire(import.meta.url)('playwright');

const env = await setup(); const key = newKey('ak'); const ISS = 'https://t.cloudflareaccess.com', AUD = 'aud';
await env.auth.bootstrapOwner(env.orgA, { subject: 'o', email: 'owner@example.com' });
const s = env.scoped(env.orgA);
const c = await s.tx((q) => env.repos.content.create(q, { language: 'en', format: 'text', caption: 'Scheduled post', disclosure: '#ad', status: 'APPROVED' }));
await s.tx((q) => env.repos.content.schedule(q, c.id, new Date(Date.now() + 2 * 86400000).toISOString()));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = b64({ alg: 'RS256', kid: 'ak' }), p = b64({ iss: ISS, aud: [AUD], sub: 'o', email: 'owner@example.com', exp: Date.now() / 1000 + 600 });
const token = `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url')}`;
const server = http.createServer(createStudio({ db: env.db, auth: env.auth, access: createAccessVerifier({ issuer: ISS, audience: AUD, keys: async () => [key.jwk] }), organizationId: env.orgA }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(); const page = await browser.newPage({ extraHTTPHeaders: { 'cf-access-jwt-assertion': token } });
const problems = []; page.on('console', (m) => { if (/Content Security Policy|Refused/.test(m.text())) problems.push(m.text()); }); page.on('pageerror', (e) => problems.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector('.week .card');
const text = await page.locator('.week').innerText();
await page.click('#tab-appr'); await page.waitForSelector('text=Nothing is waiting for approval.');
await browser.close(); server.close(); await env.close();
if (!text.includes('Scheduled post') || problems.length) { console.error('FAILED', problems, text); process.exit(1); }
console.log('studio browser check passed (week grid shows the scheduled post, approvals tab renders, no CSP violations)');

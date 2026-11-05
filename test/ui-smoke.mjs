// Drives the real UI in Chromium against the mock Cloudflare API.
// Run: node test/ui-smoke.mjs   (needs Playwright + Chromium; not part of `npm test`)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { startMock } from './mock-cf.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const mock = await startMock();
const config = loadConfig({ CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_API_BASE: mock.url, EDGE_ADMIN_PASSWORD: 'correct horse battery', SESSION_SECRET: 's'.repeat(32) });
const server = createApp(config).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

let step = 'start';
try {
  step = 'login';
  await page.goto(base);
  await page.fill('input[type=password]', 'wrong-wrong-wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('.err:not(:empty)');
  assert.equal(await page.inputValue('input[aria-label="Username"]'), 'admin');
  await page.fill('input[type=password]', 'correct horse battery');
  await page.click('button[type=submit]');
  await page.waitForSelector('.nav');

  step = 'overview renders';
  await page.waitForSelector('h1:has-text("Overview")');
  await page.waitForSelector('.tile:has-text("Requests")');
  await page.waitForSelector('svg.chart, .empty:has-text("No traffic")');

  step = 'add domain';
  await page.click('.nav a:has-text("Domains")');
  await page.fill('input[aria-label="Domain name"]', 'example.org');
  await page.click('button:has-text("Add domain")');
  await page.waitForSelector('.toast:has-text("Added example.org")');
  assert.ok(mock.state.zones.some((z) => z.name === 'example.org'));
  await page.waitForSelector('text=Set these nameservers');

  step = 'add subdomain on domains page';
  await page.selectOption('select[aria-label="Zone"]', { label: 'zeaz.dev' });
  await page.fill('input[aria-label="Subdomain for zeaz.dev"]', 'shop');
  await page.fill('input[aria-label="Target for zeaz.dev"]', '203.0.113.77');
  await page.click('.li:has-text("zeaz.dev") button:has-text("Add subdomain")');
  await page.waitForSelector('.toast:has-text("shop.zeaz.dev (A)")');

  step = 'dns quick add + inline edit + delete';
  await page.click('.nav a:has-text("DNS")');
  await page.waitForSelector('.tr:has-text("api.zeaz.dev")');
  await page.fill('input[aria-label="Subdomain"]', 'blog');
  await page.fill('input[aria-label="Target"]', 'blog.pages.dev');
  await page.click('.hero button:has-text("Add subdomain")');
  await page.waitForSelector('.tr:has-text("blog.zeaz.dev")');
  assert.equal(mock.state.records.find((r) => r.name === 'blog.zeaz.dev').type, 'CNAME');
  await page.click('.tr:has-text("blog.zeaz.dev") button:has-text("Edit")');
  await page.fill('.tr.editing input[aria-label="Content"]', 'new.pages.dev');
  await page.click('.tr.editing button:has-text("Save")');
  await page.waitForSelector('.tr:has-text("new.pages.dev")');
  assert.equal(mock.state.records.find((r) => r.name === 'blog.zeaz.dev').content, 'new.pages.dev');
  await page.click('.tr:has-text("blog.zeaz.dev") .proxy');
  await page.waitForFunction(() => /DNS only/.test([...document.querySelectorAll('.tr')].find((r) => r.innerText.includes('blog.zeaz.dev'))?.innerText || ''));
  assert.equal(mock.state.records.find((r) => r.name === 'blog.zeaz.dev').proxied, false);
  await page.click('.tr:has-text("blog.zeaz.dev") button:has-text("Delete")');
  await page.waitForFunction(() => !document.body.innerText.includes('blog.zeaz.dev'));
  assert.ok(!mock.state.records.some((r) => r.name === 'blog.zeaz.dev'));

  step = 'bulk origin preview + apply';
  await page.fill('input[aria-label="New IPv4 address"]', '198.51.100.9');
  await page.click('button:has-text("Preview")');
  await page.waitForSelector('text=will change');
  await page.click('button:has-text("Apply to")');
  await page.waitForSelector('.toast:has-text("Updated")');
  assert.equal(mock.state.records.find((r) => r.name === 'api.zeaz.dev').content, '198.51.100.9');
  assert.equal(mock.state.records.find((r) => r.name === 'mail.zeaz.dev').content, '203.0.113.30', 'DNS-only record untouched');

  step = 'every screen loads without a crash';
  for (const name of ['Security & WAF', 'Rules', 'Email', 'Workers', 'Storage', 'Zero Trust', 'API Tokens', 'Audit log', 'Users & Roles', 'My account', 'Overview']) {
    const title = { 'Audit log': 'Console audit log' }[name] || name;
    await page.click(`.nav a:has-text("${name}")`);
    await page.waitForSelector(`h1:text-is("${title}")`);
    assert.equal(await page.locator('text=Something went wrong').count(), 0, `${name} did not error`);
  }

  step = 'zero trust publish card';
  await page.click('.nav a:has-text("Zero Trust")');
  await page.waitForSelector('h2:text-is("Publish a hostname")');
  await page.click('button:has-text("Access")');
  await page.waitForSelector('h2:text-is("Protect a hostname")');
  await page.fill('input[aria-label="Hostname to protect"]', 'grafana.zeaz.dev');
  await page.fill('textarea[aria-label="Emails allowed in"]', 'me@example.com');
  await page.click('button:has-text("Create application")');
  await page.waitForSelector('.toast:has-text("Application protected")');
  await page.waitForSelector('summary:has-text("Allow listed emails")');
  await page.click('button:has-text("Gateway")');
  await page.fill('input[aria-label="Rule name"]', 'Block bad');
  await page.fill('textarea[aria-label="Domains to match"]', 'bad.example');
  await page.click('button:has-text("Add rule")');
  await page.waitForSelector('.toast:has-text("Gateway rule added")');
  assert.match(mock.state.gateway[0].traffic, /bad\.example/);

  step = 'workers: create, set variable and secret';
  await page.click('.nav a:has-text("Workers")');
  await page.fill('input[aria-label="New Worker name"]', 'hello-edge');
  await page.click('button:has-text("Create with starter code")');
  await page.waitForSelector('.toast:has-text("Created hello-edge")');
  await page.waitForSelector('h2:has-text("Variables")');
  await page.fill('input[aria-label="Variable name"]', 'ORIGIN');
  await page.fill('input[aria-label="Variable value"]', 'https://example.com');
  await page.click('button:has-text("Set variable")');
  await page.waitForSelector('.toast:has-text("Variable saved")');
  await page.fill('input[aria-label="Secret name"]', 'API_KEY');
  await page.fill('input[aria-label="Secret value"]', 'topsecret');
  await page.click('button:has-text("Set secret")');
  await page.waitForSelector('.toast:has-text("Secret saved")');
  assert.ok(Object.keys(mock.state.workers).includes('hello-edge'));
  assert.equal(await page.locator('text=topsecret').count(), 0, 'secret value is never shown');

  step = 'storage: bucket + lifecycle rule';
  await page.click('.nav a:has-text("Storage")');
  await page.fill('input[aria-label="New bucket name"]', 'assets-bucket');
  await page.click('button:has-text("Create bucket")');
  await page.waitForSelector('.toast:has-text("Created assets-bucket")');
  await page.click('button:has-text("Lifecycle")');
  await page.fill('input[aria-label="Rule name"]', 'expire-tmp');
  await page.fill('input[aria-label="Delete after days"]', '30');
  await page.click('button:has-text("Add rule")');
  await page.waitForSelector('.toast:has-text("Lifecycle rules saved")');

  step = 'rules: rate limit';
  await page.click('.nav a:has-text("Rules")');
  await page.waitForSelector('h1:text-is("Rules")');

  step = 'users: create a viewer';
  await page.click('.nav a:has-text("Users & Roles")');
  await page.fill('input[aria-label="New username"]', 'vera');
  await page.fill('input[aria-label="New user password"]', 'viewer-password-123');
  await page.selectOption('select[aria-label="Role"]', 'viewer');
  await page.click('button:has-text("Create user")');
  await page.waitForSelector('.mono:text-is("vera")');

  step = 'security: create rule, block ip';
  await page.click('.nav a:has-text("Security & WAF")');
  await page.waitForSelector('h2:text-is("Create custom rule")');
  await page.fill('textarea[aria-label="Rule expression"]', '(http.request.uri.path eq "/xmlrpc.php")');
  await page.click('button:has-text("Create rule")');
  await page.waitForSelector('.toast:has-text("Rule created")');
  await page.waitForSelector('.mono:has-text("/xmlrpc.php")');
  assert.equal(mock.state.rulesets.http_request_firewall_custom.rules.length, 1);
  assert.equal(mock.state.rulesets.http_request_firewall_custom.rules[0].action, 'block');
  await page.fill('textarea[aria-label="Rule expression"]', '(ip.src eq 198.51.100.7)');
  await page.click('button:has-text("Create rule")');
  await page.waitForFunction(() => document.body.innerText.includes('198.51.100.7'));
  assert.equal(mock.state.rulesets.http_request_firewall_custom.rules.length, 2, 'second rule goes to the existing ruleset');

  step = 'token from template';
  await page.click('.nav a:has-text("API Tokens")');
  await page.waitForSelector('h2:has-text("Create a scoped token")');
  await page.click('button:has-text("Create token")');
  await page.waitForSelector('.secret:has-text("secret-token-value")');

  step = 'sign out';
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('input[type=password]');

  step = 'viewer sees a restricted console';
  await page.fill('input[aria-label="Username"]', 'vera');
  await page.fill('input[type=password]', 'viewer-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.nav');
  assert.equal(await page.locator('.nav a:has-text("Users & Roles")').count(), 0);
  assert.equal(await page.locator('.nav a:has-text("API Tokens")').count(), 0);
  assert.equal(await page.locator('#add-domain-link').count(), 0);
  await page.click('.nav a:has-text("DNS")');
  await page.waitForSelector('.tr:has-text("api.zeaz.dev")');
  await page.click('.tr:has-text("api.zeaz.dev") .proxy');
  await page.waitForSelector('.toast.bad:has-text("does not allow")');

  assert.deepEqual(errors, [], `console/page errors: ${errors.join(' | ')}`);
  console.log('UI smoke test passed');
} catch (e) {
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/63240fb5-be89-5d3d-88d0-09b77dc0adb7/scratchpad/ui-fail.png' }).catch(() => {});
  console.error(`FAILED at step "${step}":`, e.message);
  console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  await mock.close();
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Drives the real UI in Chromium against the mock Cloudflare API.
// Run: node test/ui-smoke.mjs   (needs Playwright + Chromium; not part of `npm test`)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { startMock } from './mock-cf.js';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const a11y = [];
/** Run axe-core on the current screen. evaluate() is not subject to the page's CSP, so the app keeps its strict policy. */
async function scan(page, label) {
  await page.waitForTimeout(250);
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0].target.join(' ').slice(0, 120), all: v.nodes.map((n) => `${n.target.join(' ').slice(0, 80)} :: ${((n.any[0] || n.all[0] || n.none[0] || {}).message || '').slice(0, 140)}`) })));
  for (const v of r) a11y.push({ label, ...v });
}

const { chromium } = require('playwright');

const mock = await startMock();
const config = loadConfig({ CLOUDFLARE_API_TOKEN: 'test-token', CF_API_BASE: mock.url, ZEDGE_ADMIN_PASSWORD: 'correct horse battery', SESSION_SECRET: 's'.repeat(32), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-smoke-')) });
const server = createApp(config).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/fonts[.]googleapis[.]com/.test(m.text())) errors.push(m.text()); }); // axe tries to read the font stylesheet; the CSP rightly refuses it
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
  for (const name of ['Security & WAF', 'Rules', 'Email', 'Workers', 'Edge', 'Pages', 'Load balancing', 'Data (KV, D1)', 'SSL & Bots', 'Snapshots', 'Storage', 'Zero Trust', 'API Tokens', 'Audit log', 'Users & Roles', 'My account', 'Overview']) {
    const title = { 'Audit log': 'Console audit log', 'Data (KV, D1)': 'Data' }[name] || name;
    await page.click(`.nav a:has-text("${name}")`);
    await page.waitForSelector(`h1:text-is("${title}")`);
    assert.equal(await page.locator('text=Something went wrong').count(), 0, `${name} did not error`);
    await scan(page, `${name} (${await page.evaluate(() => document.documentElement.dataset.theme)})`);
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


  step = 'overview top lists';
  await page.click('.nav a:has-text("Overview")');
  await page.waitForSelector('h2:text-is("Top lists")');
  await page.waitForSelector('.li:has-text("/api")');
  await page.click('.seg button:text-is("Countries")');
  await page.waitForSelector('.li:has-text("TH")');

  step = 'rules: header edit and url rewrite';
  await page.click('.nav a:has-text("Rules")');
  await page.click('.seg button:text-is("Header edits")');
  await page.waitForSelector('h2:text-is("Request header edits")');
  await page.fill('input[aria-label="Header name"] >> nth=0', 'X-Env');
  await page.fill('input[aria-label="Header value"] >> nth=0', 'prod');
  await page.click('button:text-is("Add") >> nth=0');
  await page.waitForSelector('.toast:has-text("Header edit added")');
  assert.deepEqual(mock.state.rulesets.http_request_late_transform.rules[0].action_parameters.headers, { 'X-Env': { operation: 'set', value: 'prod' } });

  step = 'dns: export link and import';
  await page.click('.nav a:has-text("DNS")');
  await page.waitForSelector('a:has-text("Export zone file")');
  await page.fill('textarea[aria-label="BIND zone file"]', 'imp.zeaz.dev. 300 IN A 203.0.113.50\n');
  await page.click('button:text-is("Import")');
  await page.waitForSelector('.toast:has-text("Imported")');
  assert.match(mock.state.dnsImports.at(-1).file, /imp\.zeaz\.dev/);

  step = 'pages: retry a deployment, add a variable';
  await page.click('.nav a:has-text("Pages")');
  await page.waitForSelector('h2:text-is("Deployments")');
  await page.click('.li:has-text("dep-new-0002") button:text-is("Retry")');
  await page.waitForSelector('.toast:has-text("Retry started")');
  assert.ok(mock.state.pages.actions.includes('retry dep-new-0002'));
  await page.fill('input[aria-label="Variable name"]', 'API_URL');
  await page.fill('input[aria-label="Variable value"]', 'https://api.zeaz.dev');
  await page.click('button:has-text("Set variable")');
  await page.waitForSelector('.toast:has-text("Variable saved")');

  step = 'load balancing: monitor then pool';
  await page.click('.nav a:has-text("Load balancing")');
  await page.click('.seg button:text-is("Monitors")');
  await page.click('button:text-is("Create monitor")');
  await page.waitForSelector('h1:text-is("Load balancing")');
  await page.waitForFunction(() => document.body.innerText.includes('HTTPS /'));
  assert.equal(mock.state.monitors.length, 1);
  await page.click('.seg button:text-is("Pools")');
  await page.fill('input[aria-label="Pool name"]', 'bkk');
  await page.fill('textarea[aria-label="Origins"]', 'o1 203.0.113.10');
  await page.click('button:text-is("Create pool")');
  await page.waitForFunction(() => document.body.innerText.includes('203.0.113.10'));
  assert.equal(mock.state.pools[0].origins[0].address, '203.0.113.10');

  step = 'edge: workers route, cron, snippet';
  await page.click('.nav a:has-text("Edge")');
  await page.fill('input[aria-label="Route pattern"]', 'zeaz.dev/api/*');
  await page.click('button:text-is("Add route")');
  await page.waitForFunction(() => document.body.innerText.includes('zeaz.dev/api/*'));
  assert.equal(mock.state.routes.length, 1);
  await page.click('.seg button:text-is("Snippets")');
  await page.fill('input[aria-label="Snippet name"]', 'hello_snip');
  await page.fill('textarea[aria-label="Snippet code"]', 'export default { fetch(r) { return fetch(r); } }');
  await page.click('button:text-is("Save snippet")');
  await page.waitForFunction(() => document.body.innerText.includes('hello_snip'));
  assert.match(mock.state.snippets.hello_snip, /export default/);

  step = 'data: KV value and D1 SQL console';
  await page.click('.nav a:has-text("Data (KV, D1)")');
  await page.waitForSelector('h2:has-text("Add or change a value")');
  await page.fill('input[aria-label="Key"]', 'greeting');
  await page.fill('textarea[aria-label="Value"]', 'hello "world"');
  await page.click('button:text-is("Save value")');
  await page.waitForSelector('.toast:has-text("Saved")');
  assert.equal(Object.values(mock.state.kv.values).some((v) => v.greeting === 'hello "world"'), true);
  await page.click('.seg button:text-is("D1")');
  await page.waitForSelector('h2:text-is("SQL console")');
  await page.fill('textarea[aria-label="SQL"]', 'SELECT 1 AS n');
  await page.click('button:text-is("Run")');
  await page.waitForSelector('.tbl');
  await page.fill('textarea[aria-label="SQL"]', 'DELETE FROM t');
  await page.click('button:text-is("Run")');
  await page.waitForSelector('.toast.bad:has-text("Allow changes")');

  step = 'ssl and bots: universal toggle, bot fight mode, turnstile';
  await page.click('.nav a:has-text("SSL & Bots")');
  await page.waitForSelector('h2:text-is("Edge certificates")');
  step = 'ssl: universal click';
  await page.click('button[aria-label="Universal SSL"]');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Universal SSL"]').getAttribute('aria-checked') === 'false');
  assert.equal(mock.state.universal.enabled, false);
  step = 'ssl: turnstile';
  await page.click('.seg button:text-is("Turnstile")');
  await page.fill('input[aria-label="Widget name"]', 'login');
  await page.fill('textarea[aria-label="Domains"]', 'zeaz.dev');
  await page.click('button:text-is("Create widget")');
  await page.waitForSelector('.secret');
  step = 'ssl: bots';
  await page.click('.seg button:text-is("Bots")');
  await page.click('button[aria-label="Bot Fight Mode"]');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Bot Fight Mode"]').getAttribute('aria-checked') === 'true');
  assert.equal(mock.state.bot.fight_mode, true);

  step = 'zero trust: access group, service token, WARP profile';
  await page.click('.nav a:has-text("Zero Trust")');
  await page.click('.seg button:text-is("Access groups")');
  await page.fill('input[aria-label="Group name"]', 'Staff');
  await page.fill('textarea[aria-label="Emails"]', 'me@example.com');
  await page.click('button:text-is("Create group")');
  await page.waitForFunction(() => document.body.innerText.includes('me@example.com'));
  assert.equal(mock.state.groups.length, 1);
  await page.click('.seg button:text-is("Service tokens")');
  await page.fill('input[aria-label="Token name"]', 'ci');
  await page.click('button:text-is("Create token")');
  await page.waitForSelector('.secret:has-text("svc-secret")');

  step = 'snapshots: take, compare, restore preview';
  await page.click('.nav a:has-text("Snapshots")');
  await page.fill('input[aria-label="Snapshot note"]', 'smoke');
  await page.click('button:text-is("Take snapshot")');
  await page.waitForFunction(() => document.body.innerText.includes('smoke'));
  await page.click('button:text-is("Compare to live")');
  await page.waitForSelector('text=Nothing has changed since this snapshot');
  await page.click('button:text-is("Restore…")');
  await page.waitForSelector('button:text-is("Apply restore")');
  assert.ok(await page.locator('a:has-text("Download Terraform JSON")').count());


  step = 'approvals page and two-factor card';
  await page.click('.nav a:has-text("Approvals")');
  await page.waitForSelector('h1:text-is("Approvals")');
  await page.waitForSelector('text=Approvals are switched off');
  await page.click('.nav a:has-text("My account")');
  await page.waitForSelector('h2:text-is("Two-factor sign-in")');
  await page.click('button:text-is("Set up two-factor")');
  await page.waitForSelector('.secret:has-text("Setup key")');
  const secretText = await page.locator('.secret >> nth=0').innerText();
  const key = (secretText.match(/[A-Z2-7]{32}/) || [])[0];
  assert.ok(key, 'a base32 setup key is shown');
  const { hotp, stepAt } = await import('../server/totp.js');
  await page.fill('input[aria-label="Code from your app"]', hotp(key, stepAt()));
  await page.click('button:text-is("Turn on")');
  await page.waitForSelector('.secret:has-text("Recovery codes")');
  const recovery = (await page.locator('.secret:has-text("Recovery codes")').innerText()).match(/[0-9a-f]{5}-[0-9a-f]{5}/g);
  assert.equal(recovery.length, 8);

  step = 'users page: limit domains and 2FA badge';
  await page.click('.nav a:has-text("Users & Roles")');
  await page.waitForSelector('.li:has-text("admin") .badge:text-is("2FA")');
  await page.click('.li:has-text("vera") button:text-is("Limits…")');
  await page.waitForSelector('#zone-editor');
  await page.click('#zone-editor label:has-text("zeaz.dev") input');
  await page.fill('textarea[aria-label="Workers (script names)"]', 'edge-api');
  await page.click('button:text-is("Save limits")');
  await page.waitForSelector('.li:has-text("vera") .badge:has-text("1 domain")');


  step = 'more cloudflare: pages create, gateway http rule, media delete, logpush challenge';
  await page.click('.nav a:has-text("Pages")');
  await page.fill('input[aria-label="New project name"]', 'brand-new');
  await page.click('button:text-is("Create project")');
  await page.waitForFunction(() => document.body.innerText.includes('brand-new'));
  assert.ok(mock.state.pages.projects.some((p) => p.name === 'brand-new'));
  await page.click('.nav a:has-text("Zero Trust")');
  await page.click('.seg button:text-is("Gateway")');
  await page.waitForSelector('h2:text-is("Add a rule")');
  await page.selectOption('select[aria-label="Applies to"]', 'http');
  await page.fill('input[aria-label="Rule name"]', 'Isolate risky site');
  await page.fill('textarea[aria-label="Domains to match"]', 'risky.example');
  await page.selectOption('select[aria-label="Action"]', 'isolate');
  await page.click('button:text-is("Add rule")');
  await page.waitForSelector('.toast:has-text("Gateway rule added")');
  await page.click('.nav a:has-text("Data (KV, D1)")');
  await page.click('.seg button:text-is("Stream & Images")');
  await page.waitForSelector('.li:has-text("intro.mp4")');
  await page.click('.li:has-text("intro.mp4") button:text-is("Delete")');
  await page.waitForFunction(() => !document.body.innerText.includes('intro.mp4'));
  assert.equal(mock.state.stream.length, 0);
  await page.click('.nav a:has-text("SSL & Bots")');
  await page.click('.seg button:text-is("Logs")');
  await page.fill('input[aria-label="Destination"]', 's3://bucket/logs?region=auto');
  await page.click('button:has-text("Get ownership challenge")');
  await page.waitForSelector('text=ownership-challenge-abc123.txt');

  step = 'audit log integrity banner';
  await page.click('.nav a:has-text("Audit log")');
  await page.waitForSelector('.note:has-text("Integrity check passed")');

  step = 'theme toggle';
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('.side button.link:has-text("theme")');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.notEqual(themeAfter, themeBefore, 'theme switched');
  assert.ok(['light', 'dark'].includes(themeAfter));
  await page.reload();
  await page.waitForSelector('.nav');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), themeAfter, 'choice is remembered');

  step = 'accessibility scan in the other theme';
  for (const name of ['Overview', 'DNS', 'Security & WAF', 'Rules', 'Edge', 'Pages', 'Data (KV, D1)', 'SSL & Bots', 'Snapshots', 'Zero Trust', 'Users & Roles', 'My account']) {
    await page.click(`.nav a:has-text("${name}")`);
    await page.waitForSelector('h1');
    await scan(page, `${name} (${await page.evaluate(() => document.documentElement.dataset.theme)})`);
  }
  const worst = a11y.filter((v) => ['serious', 'critical', 'moderate', 'minor'].includes(v.impact));
  if (process.env.A11Y_REPORT) console.log([...new Set(worst.flatMap((v) => v.all.map((x) => `${v.id}: ${x}`)))].join('\n'));
  assert.deepEqual(worst.map((v) => `${v.label}: ${v.id} (${v.impact}) ${v.sample}`), [], 'accessibility violations');

  step = 'sign out';
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('input[type=password]');

  step = 'sign in with a recovery code after turning on 2FA';
  await page.fill('input[type=password]', 'correct horse battery');
  await page.click('button[type=submit]');
  await page.waitForSelector('input[aria-label="Authentication code"]:visible');
  await page.fill('input[aria-label="Authentication code"]', recovery[0]);
  await page.click('button[type=submit]');
  await page.waitForSelector('.nav');
  await page.click('button:text-is("Sign out")');
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
  console.error('toasts:', await page.locator('.toast').allInnerTexts().catch(() => []));
  console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  await mock.close();
}

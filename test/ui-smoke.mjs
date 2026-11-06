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

const VIEWPORTS = [
  { width: 1360, height: 860, name: 'desktop' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 390, height: 844, name: 'mobile' },
];
const THEMES = ['light', 'dark'];

async function runSmoke() {
  const mock = await startMock();
  const config = loadConfig({ CLOUDFLARE_API_TOKEN: 'test-token', CF_API_BASE: mock.url, ZEDGE_ADMIN_PASSWORD: 'correct horse battery', SESSION_SECRET: 's'.repeat(32), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-smoke-')) });
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await require('playwright').chromium.launch();
  let failures = 0;

  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/fonts[.]googleapis[.]com/.test(m.text())) errors.push(m.text()); });
      page.on('dialog', (d) => d.accept());

      const label = `${vp.name}@${vp.width}x${vp.height}@${theme}`;
      try {
        // Set theme before navigation
        await page.goto(`${base}#theme=${theme}`);
        await page.waitForTimeout(200);

        await page.fill('input[type=password]', 'wrong-wrong-wrong');
        await page.click('button[type=submit]');
        await page.waitForSelector('.err:not(:empty)');
        await page.fill('input[aria-label="Username"]', 'admin');
        await page.fill('input[type=password]', 'correct horse battery');
        await page.click('button[type=submit]');
        await page.waitForSelector('.nav');

        // Dashboard overview
        await page.waitForSelector('h1:has-text("Overview")');
        await page.waitForSelector('.tile:has-text("Requests")');

        // Add domain
        await page.click('.nav a:has-text("Domains")');
        await page.fill('input[aria-label="Domain name"]', 'example.org');
        await page.click('button:has-text("Add domain")');
        await page.waitForSelector('.toast:has-text("Added example.org")');

        // Add subdomain
        await page.click('.nav a:has-text("DNS")');
        await page.waitForSelector('.tr:has-text("api.zeaz.dev")');
        await page.fill('input[aria-label="Subdomain"]', 'blog');
        await page.fill('input[aria-label="Target"]', 'blog.pages.dev');
        await page.click('.hero button:has-text("Add subdomain")');
        await page.waitForSelector('.tr:has-text("blog.zeaz.dev")');

        // Toggle proxy on/off
        await page.click('.tr:has-text("blog.zeaz.dev") .proxy');
        await page.waitForFunction(() => /DNS only/.test([...document.querySelectorAll('.tr')].find((r) => r.innerText.includes('blog.zeaz.dev'))?.innerText || ''));
        await page.click('.tr:has-text("blog.zeaz.dev") button:has-text("Delete")');
        await page.waitForFunction(() => !document.body.innerText.includes('blog.zeaz.dev'));

        // Accessibility scan
        await page.waitForTimeout(250);
        await page.evaluate(axeSource);
        const violations = await page.evaluate(async () => {
          const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
          return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
        });

        if (violations.length > 0) {
          failures++;
          console.log(`AXE violations on ${label}:`, JSON.stringify(violations, null, 2));
        }

        assert.deepEqual(violations, [], `AXE violations on ${label}`);
      } catch (e) {
        failures++;
        console.error(`FAILED ${label}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  server.close();
  await mock.close();

  if (failures > 0) {
    console.error(`UI smoke test FAILED with ${failures} viewport/theme failures`);
    process.exitCode = 1;
  } else {
    console.log('UI smoke test passed across all viewports and themes');
  }
}

runSmoke().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

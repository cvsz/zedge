import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { startMock, startMockS3 } from './mock-cf.js';

export const PASSWORD = 'correct horse battery';

/** Starts the mock Cloudflare API (and optionally the mock R2 S3 endpoint) plus the console itself. */
export async function boot({ env = {}, mockOpts, s3 = false } = {}) {
  const mock = await startMock(mockOpts);
  const s3m = s3 ? await startMockS3() : null;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zedge-test-'));
  const config = loadConfig({
    CLOUDFLARE_API_TOKEN: 'test-token', CF_API_BASE: mock.url, ZEDGE_ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: 's'.repeat(32), DATA_DIR: dataDir,
    ...(s3m ? { R2_ACCESS_KEY_ID: 'R2KEY', R2_SECRET_ACCESS_KEY: 'R2SECRET', R2_ENDPOINT: s3m.url } : {}), ...env
  });
  const app = createApp(config);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  /** A browser-like client with its own cookie. */
  const client = () => {
    let cookie;
    const call = (method, p, body, headers = {}) => fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zedge', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    });
    return {
      call,
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; },
      async login(username = 'admin', password = PASSWORD, code) {
        const r = await call('POST', '/api/login', { username, password, ...(code ? { code } : {}) });
        if (r.ok) { cookie = r.headers.get('set-cookie').split(';')[0]; }
        return r;
      },
      async json(method, p, body, headers) { const r = await call(method, p, body, headers); return { status: r.status, body: await r.json().catch(() => null) }; }
    };
  };
  return { app, mock, s3: s3m, base, config, dataDir, client, close: async () => { server.closeAllConnections(); server.close(); await mock.close(); if (s3m) { await s3m.close(); } } };
}

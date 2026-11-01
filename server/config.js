import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Reads configuration from the environment. The Cloudflare token never leaves
 * the server: the browser only ever holds a signed session cookie.
 */
export function loadConfig(env = process.env) {
  const token = env.CF_API_TOKEN;
  if (!token) throw new Error('CF_API_TOKEN is required');

  const host = env.HOST || '127.0.0.1';
  const password = env.EDGE_ADMIN_PASSWORD || '';
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const hasUsers = fs.existsSync(path.join(dataDir, 'users.json'));
  const noAuth = !password && !hasUsers && env.EDGE_ALLOW_NO_AUTH === '1' && LOOPBACK.includes(host);

  if (!password && !hasUsers && !noAuth) {
    throw new Error('EDGE_ADMIN_PASSWORD is required to create the first admin. (No-auth mode is only allowed with EDGE_ALLOW_NO_AUTH=1 on a loopback HOST.)');
  }
  if (password && password.length < 12) throw new Error('EDGE_ADMIN_PASSWORD must be at least 12 characters');

  const accountIds = list(env.CF_ACCOUNT_IDS || env.CF_ACCOUNT_ID);
  return {
    token,
    accountIds,
    accountId: accountIds[0] || '',
    apiBase: (env.CF_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, ''),
    host,
    port: Number(env.PORT || 8787),
    password,
    noAuth,
    dataDir,
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    sessionHours: Number(env.SESSION_HOURS || 12),
    secureCookie: env.COOKIE_SECURE === '1',
    trustCfIp: env.TRUST_CF_CONNECTING_IP === '1',
    r2: {
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      endpoint: (env.R2_ENDPOINT || '').replace(/\/$/, '')
    },
    r2MaxBytes: Math.max(1, Number(env.R2_MAX_UPLOAD_MB || 50)) * 1024 * 1024
  };
}

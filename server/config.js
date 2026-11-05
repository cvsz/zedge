import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function httpsOrLoopback(v, name) {
  let u;
  try { u = new URL(v); } catch { throw new Error(`${name} is not a valid URL`); }
  if (u.protocol !== 'https:' && !LOOPBACK.includes(u.hostname)) throw new Error(`${name} must use https`);
  return u;
}

/** Single sign-on through any OpenID Connect provider. Off unless OIDC_ISSUER is set. */
function parseOidc(env) {
  if (!env.OIDC_ISSUER) return null;
  if (!env.OIDC_CLIENT_ID) throw new Error('OIDC_CLIENT_ID is required when OIDC_ISSUER is set');
  httpsOrLoopback(env.OIDC_ISSUER, 'OIDC_ISSUER');
  if (!env.OIDC_REDIRECT_URL) throw new Error('OIDC_REDIRECT_URL is required (for example https://console.example.com/api/oidc/callback)');
  httpsOrLoopback(env.OIDC_REDIRECT_URL, 'OIDC_REDIRECT_URL');
  let roleMap = {};
  if (env.OIDC_ROLE_MAP) {
    try { roleMap = JSON.parse(env.OIDC_ROLE_MAP); } catch { throw new Error('OIDC_ROLE_MAP must be JSON like {"zedge-admins":"admin"}'); }
    if (!roleMap || typeof roleMap !== 'object' || Array.isArray(roleMap) || Object.values(roleMap).some((r) => typeof r !== 'string')) throw new Error('OIDC_ROLE_MAP must map claim values to role names');
  }
  return {
    issuer: env.OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    redirectUrl: env.OIDC_REDIRECT_URL,
    scopes: env.OIDC_SCOPES || 'openid email profile',
    roleClaim: env.OIDC_ROLE_CLAIM || 'groups',
    roleMap,
    defaultRole: env.OIDC_DEFAULT_ROLE || 'viewer',
    allowedDomains: list(env.OIDC_ALLOWED_DOMAINS).map((d) => d.toLowerCase()),
    disablePassword: env.OIDC_DISABLE_PASSWORD === '1',
    breakglass: list(env.OIDC_BREAKGLASS_USERS || 'admin').map((n) => n.toLowerCase()),
    label: env.OIDC_LABEL || 'Sign in with SSO'
  };
}

/**
 * Reads configuration from the environment. The Cloudflare token never leaves
 * the server: the browser only ever holds a signed session cookie.
 */
export function loadConfig(env = process.env) {
  // The CF_* names were used before 1.8.0; they still work but are deprecated.
  const legacy = ['CF_API_TOKEN', 'CF_ACCOUNT_IDS', 'CF_ACCOUNT_ID'].filter((k) => env[k] && !env[k.replace(/^CF_/, 'CLOUDFLARE_')]);
  if (legacy.length) console.warn(`Deprecated variable name(s): ${legacy.join(', ')}. Rename to ${legacy.map((k) => k.replace(/^CF_/, 'CLOUDFLARE_')).join(', ')}.`);
  // The EDGE_* names were used before the 2.0.0 rename to Zedge; they still work but are deprecated.
  const legacyEdge = ['EDGE_ADMIN_PASSWORD', 'EDGE_ALLOW_NO_AUTH'].filter((k) => env[k] && !env[`Z${k}`]);
  if (legacyEdge.length) console.warn(`Deprecated variable name(s): ${legacyEdge.join(', ')}. Rename to ${legacyEdge.map((k) => `Z${k}`).join(', ')}.`);
  const token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');

  const host = env.HOST || '127.0.0.1';
  // EDGE_* names are the pre-2.0 spellings and still work
  const password = env.ZEDGE_ADMIN_PASSWORD || env.EDGE_ADMIN_PASSWORD || '';
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const hasUsers = fs.existsSync(path.join(dataDir, 'users.json'));
  const noAuth = !password && !hasUsers && (env.ZEDGE_ALLOW_NO_AUTH || env.EDGE_ALLOW_NO_AUTH) === '1' && LOOPBACK.includes(host);

  const oidc = parseOidc(env);
  if (!password && !hasUsers && !noAuth && !oidc) {
    throw new Error('ZEDGE_ADMIN_PASSWORD is required to create the first admin. (No-auth mode is only allowed with ZEDGE_ALLOW_NO_AUTH=1 on a loopback HOST.)');
  }
  if (password && password.length < 12) throw new Error('ZEDGE_ADMIN_PASSWORD must be at least 12 characters');

  if (env.ALERT_WEBHOOK_URL) {
    let u;
    try { u = new URL(env.ALERT_WEBHOOK_URL); } catch { throw new Error('ALERT_WEBHOOK_URL is not a valid URL'); }
    if (u.protocol !== 'https:' && !LOOPBACK.includes(u.hostname)) throw new Error('ALERT_WEBHOOK_URL must use https');
  }
  if (env.SMTP_URL || env.ALERT_EMAIL_TO) {
    if (!env.SMTP_URL || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) throw new Error('Email alerts need SMTP_URL, ALERT_EMAIL_FROM and ALERT_EMAIL_TO together');
    let u;
    try { u = new URL(env.SMTP_URL); } catch { throw new Error('SMTP_URL is not a valid URL (use smtps://user:pass@host:465 or smtp://user:pass@host:587)'); }
    if (!['smtp:', 'smtps:'].includes(u.protocol)) throw new Error('SMTP_URL must start with smtp:// or smtps://');
    if (u.protocol === 'smtp:' && u.searchParams.get('starttls') === '0' && !LOOPBACK.includes(u.hostname)) throw new Error('Plain SMTP is only allowed to a loopback host');
    const bad = list(env.ALERT_EMAIL_TO).concat([env.ALERT_EMAIL_FROM]).find((x) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$|^[^\s@<>]+@localhost$/.test(x));
    if (bad) throw new Error(`"${bad}" is not an email address`);
  }
  if (env.METRICS_TOKEN && env.METRICS_TOKEN.length < 16) throw new Error('METRICS_TOKEN must be at least 16 characters');
  const accountIds = list(env.CLOUDFLARE_ACCOUNT_IDS || env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_IDS || env.CF_ACCOUNT_ID);
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
    rateLimit: { perMinute: Math.max(10, Number(env.RATE_LIMIT_PER_MIN || 600)), writesPerMinute: Math.max(5, Number(env.RATE_LIMIT_WRITES_PER_MIN || 120)) },
    oidc,
    approvalsRequired: env.APPROVAL_REQUIRED === '1' || env.APPROVAL_REQUIRED === 'true',
    metricsToken: env.METRICS_TOKEN || '',
    alertWebhook: env.ALERT_WEBHOOK_URL || '',
    alerts: {
      webhook: env.ALERT_WEBHOOK_URL || '',
      smtpUrl: env.SMTP_URL || '',
      smtpVerify: env.SMTP_TLS_VERIFY !== '0',
      emailFrom: env.ALERT_EMAIL_FROM || '',
      emailTo: list(env.ALERT_EMAIL_TO),
      cfErrorThreshold: Math.max(3, Number(env.ALERT_CF_ERRORS || 10)),
      tokenWarnDays: Math.max(1, Number(env.ALERT_TOKEN_WARN_DAYS || 14))
    },
    auditRetentionDays: Number(env.AUDIT_RETENTION_DAYS || 0),
    r2MaxBytes: Math.max(1, Number(env.R2_MAX_UPLOAD_MB || 50)) * 1024 * 1024
  };
}

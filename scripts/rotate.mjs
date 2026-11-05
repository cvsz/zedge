#!/usr/bin/env node
// Rotate secrets in a .env file (and, for the admin password and Cloudflare token, at their source).
//   node scripts/rotate.mjs <target...> [--env-file .env] [--data-dir ./data] [--dry-run] [--yes]
// Targets:
//   session           new SESSION_SECRET (everyone is signed out on restart)
//   metrics           new METRICS_TOKEN (update your Prometheus scrape config)
//   admin-password    new password for the "admin" user, in the user store and in ZEDGE_ADMIN_PASSWORD (stop the console first)
//   cloudflare-token  roll CLOUDFLARE_API_TOKEN through the Cloudflare API. The old value stops working immediately, so --yes is required.
//   all               session + metrics + admin-password
// Secret values are never printed; you see which keys changed and a short fingerprint.
// Not rotated here: the tunnel token (TUNNEL_TOKEN / CLOUDFLARED_TUNNEL_TOKEN) and R2 keys. Rotate those in the Cloudflare dashboard.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/store.js';
import { parseEnv } from './deploy.mjs';

export class RotateError extends Error {}
const API = 'https://api.cloudflare.com/client/v4';
const TARGETS = ['session', 'metrics', 'admin-password', 'cloudflare-token'];
const fingerprint = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8);

export function parseArgs(argv) {
  const o = { targets: [], envFile: '.env', dataDir: null, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new RotateError(`${a} needs a value`); i += 1; return argv[i]; };
    if (a === '--env-file') o.envFile = next();
    else if (a === '--data-dir') o.dataDir = next();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === 'all') o.targets.push('session', 'metrics', 'admin-password');
    else if (TARGETS.includes(a)) o.targets.push(a);
    else throw new RotateError(`Unknown target or option: ${a}`);
  }
  o.targets = [...new Set(o.targets)];
  return o;
}

/** Replace KEY=VALUE lines in place (comments and order kept); append keys that are missing. */
export function setEnvValues(text, updates) {
  const lines = text.split('\n'); const done = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (m && Object.hasOwn(updates, m[2]) && !done.has(m[2])) { done.add(m[2]); return `${m[1]}${m[2]}${m[3]}${updates[m[2]]}`; }
    return line;
  });
  const missing = Object.keys(updates).filter((k) => !done.has(k));
  let text2 = out.join('\n');
  if (missing.length) text2 = `${text2.replace(/\n*$/, '\n')}${missing.map((k) => `${k}=${updates[k]}`).join('\n')}\n`;
  return text2;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function cfCall(fetchImpl, token, method, urlPath) {
  const res = await fetchImpl(`${API}${urlPath}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: method === 'PUT' ? '{}' : undefined, signal: AbortSignal.timeout(30000) });
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !json || json.success === false) throw new RotateError(`Cloudflare refused the request (${method} ${urlPath.replace(/\/[0-9a-f]{32}/g, '/…')}, HTTP ${res.status}): ${((json && json.errors) || []).map((e) => e.message).join('; ') || 'no detail'}`);
  return json;
}

/**
 * @param {{ targets: string[], envFile?: string, dataDir?: string|null, dryRun?: boolean, yes?: boolean, fetchImpl?: any, random?: (n:number)=>Buffer, log?: (s:string)=>void }} o
 * @returns {Promise<{ changed: string[], notes: string[] }>}
 */
export async function rotate({ targets, envFile = '.env', dataDir = null, dryRun = false, yes = false, fetchImpl = fetch, random = crypto.randomBytes, log = () => {} }) {
  if (!targets.length) throw new RotateError('Name at least one target: session, metrics, admin-password, cloudflare-token, all');
  if (!fs.existsSync(envFile)) throw new RotateError(`No such file: ${envFile}`);
  const text = fs.readFileSync(envFile, 'utf8');
  const env = parseEnv(text);
  const updates = {}; const notes = []; const changed = [];
  const dir = dataDir || env.DATA_DIR || path.join(path.dirname(path.resolve(envFile)), 'data');

  if (targets.includes('cloudflare-token') && !dryRun && !yes) throw new RotateError('Rolling the Cloudflare token invalidates the current one immediately. Re-run with --yes.');

  if (targets.includes('session')) { updates.SESSION_SECRET = random(32).toString('hex'); notes.push('Restart the console: every signed-in user is signed out.'); }
  if (targets.includes('metrics')) { updates.METRICS_TOKEN = random(24).toString('base64url'); notes.push('Update the bearer token in your Prometheus scrape config.'); }
  if (targets.includes('admin-password')) {
    updates.ZEDGE_ADMIN_PASSWORD = random(18).toString('base64url');
    notes.push('Stop the console before rotating the admin password (the user store is a file) and start it again afterwards.');
  }

  if (targets.includes('cloudflare-token')) {
    const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new RotateError('CLOUDFLARE_API_TOKEN is not set in the environment or the .env file');
    if (dryRun) { notes.push('Would roll CLOUDFLARE_API_TOKEN through the Cloudflare API (needs permission to edit API tokens).'); }
    else {
      const account = env.CLOUDFLARE_ACCOUNT_ID || (env.CLOUDFLARE_ACCOUNT_IDS || '').split(',')[0].trim();
      const base = account ? `/accounts/${account}` : '/user';
      const v = await cfCall(fetchImpl, token, 'GET', `${base}/tokens/verify`);
      const id = v.result && v.result.id;
      if (!id) throw new RotateError('Cloudflare did not return the token id');
      const rolled = await cfCall(fetchImpl, token, 'PUT', `${base}/tokens/${id}/value`);
      if (typeof rolled.result !== 'string' || rolled.result.length < 20) throw new RotateError('Cloudflare did not return a new token value. The old token may already be invalid: create a new one in the dashboard.');
      updates.CLOUDFLARE_API_TOKEN = rolled.result;
      notes.push('Update CLOUDFLARE_API_TOKEN anywhere else it is stored (Kubernetes secret, CI secrets).');
    }
  }

  const keys = Object.keys(updates);
  if (dryRun) { for (const k of keys) log(`${k}: would be replaced (nothing written)`); for (const n of notes) log(`note: ${n}`); return { changed: [], notes }; }

  // Write the new values before anything else can fail, so a rolled Cloudflare token is never lost.
  try { writeAtomic(envFile, setEnvValues(text, updates)); }
  catch (e) {
    if (updates.CLOUDFLARE_API_TOKEN) {
      const rescue = `${envFile}.rotated-token`;
      fs.writeFileSync(rescue, `CLOUDFLARE_API_TOKEN=${updates.CLOUDFLARE_API_TOKEN}\n`, { mode: 0o600 });
      throw new RotateError(`Could not write ${envFile} (${e.message}). The NEW Cloudflare token was saved to ${rescue}: move it into place and delete that file.`);
    }
    throw new RotateError(`Could not write ${envFile}: ${e.message}`);
  }
  for (const k of keys) { changed.push(k); log(`${k}: rotated (new fingerprint ${fingerprint(updates[k])})`); }

  if (targets.includes('admin-password')) {
    const store = createStore(dir);
    if (store.getUser('admin')) {
      store.updateUser('admin', { password: updates.ZEDGE_ADMIN_PASSWORD });
      store.audit({ t: new Date().toISOString(), user: 'rotate-script', method: 'ROTATE', path: '/admin/password', status: 200, detail: 'admin password rotated', ip: 'local' });
      log('admin user: password updated in the user store');
    } else notes.push(`No "admin" user in ${dir}: only ZEDGE_ADMIN_PASSWORD in the .env was changed (it is used when the first admin is created).`);
  }
  for (const n of notes) log(`note: ${n}`);
  return { changed, notes };
}

const HELP = `Usage: node scripts/rotate.mjs <target...> [--env-file .env] [--data-dir ./data] [--dry-run] [--yes]
Targets: session | metrics | admin-password | cloudflare-token | all (= session metrics admin-password)
Use --dry-run first. cloudflare-token needs --yes because the old token stops working at once.`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help || !o.targets.length) { console.log(HELP); process.exit(o.help ? 0 : 2); }
    await rotate({ ...o, log: (s) => console.log(s) });
  } catch (e) { console.error(e instanceof RotateError ? e.message : `Unexpected error: ${e.message}`); process.exit(1); }
}

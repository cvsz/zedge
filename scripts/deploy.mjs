#!/usr/bin/env node
// One-command deploy: Cloudflare Tunnel + proxied DNS record (+ optional Access policy) + .env, then docker compose up.
// CLOUDFLARE_API_TOKEN=... npm run deploy -- --hostname console.example.com [--allow you@example.com,team@example.com]
// The token needs: Zone:Read, DNS:Edit, Account > Cloudflare Tunnel:Edit, and Access: Apps and Policies:Edit if you use --allow.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';

class DeployError extends Error {}

export function parseArgs(argv) {
  const o = { name: 'zedge', start: true, allow: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new DeployError(`${a} needs a value`); i += 1; return argv[i]; };
    if (a === '--hostname') o.hostname = next().trim().toLowerCase();
    else if (a === '--name') o.name = next().trim();
    else if (a === '--allow') o.allow = next().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--account') o.account = next().trim();
    else if (a === '--env-file') o.envFile = next();
    else if (a === '--no-start') o.start = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new DeployError(`Unknown option ${a}`);
  }
  return o;
}

/** Parse KEY=VALUE lines, keeping everything else (comments, order) when rewriting. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}
export function mergeEnv(text, values) {
  const seen = new Set();
  const lines = text.split('\n').map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] in values) { seen.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return line;
  });
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  return `${lines.join('\n')}\n`;
}

export async function deploy(opts, { fetchImpl = fetch, fs: fsx = fs, log = console.log, api = API } = {}) {
  const envPath = opts.envFile || path.join(process.cwd(), '.env');
  const existingText = fsx.existsSync(envPath) ? fsx.readFileSync(envPath, 'utf8') : '';
  const existing = parseEnv(existingText);
  const token = process.env.CLOUDFLARE_API_TOKEN || existing.CLOUDFLARE_API_TOKEN;
  if (!token) throw new DeployError('Set CLOUDFLARE_API_TOKEN (environment or .env) to a token that can edit Tunnels and DNS.');
  if (!opts.hostname || !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(opts.hostname)) throw new DeployError('Give the public hostname with --hostname, for example console.example.com');
  if (opts.allow.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new DeployError('--allow takes a comma-separated list of email addresses');

  const cf = async (method, p, body) => {
    const res = await fetchImpl(`${api}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.success === false) throw new DeployError(`Cloudflare ${method} ${p.split('?')[0]} failed: ${(j && j.errors && j.errors[0] && j.errors[0].message) || res.status}`);
    return j.result;
  };

  // 1. which zone owns the hostname (longest matching suffix)
  const zones = await cf('GET', '/zones?per_page=50');
  const zone = zones.filter((z) => opts.hostname === z.name || opts.hostname.endsWith(`.${z.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) throw new DeployError(`No zone this token can see contains ${opts.hostname}. Add the domain to Cloudflare first.`);
  const accountId = opts.account || existing.CLOUDFLARE_ACCOUNT_ID || (zone.account && zone.account.id);
  if (!accountId) throw new DeployError('Could not work out the account id. Pass --account.');
  log(`Zone ${zone.name} (account ${accountId})`);

  // 2. tunnel: reuse by name or create
  const found = await cf('GET', `/accounts/${accountId}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(opts.name)}`);
  let tunnel = found.find((t) => t.name === opts.name);
  if (tunnel) log(`Reusing tunnel ${tunnel.name}`);
  else {
    tunnel = await cf('POST', `/accounts/${accountId}/cfd_tunnel`, { name: opts.name, config_src: 'cloudflare', tunnel_secret: crypto.randomBytes(32).toString('base64') });
    log(`Created tunnel ${tunnel.name}`);
  }

  // 3. ingress: hostname -> app container (keep any other hostnames already on this tunnel)
  const cur = await cf('GET', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`).catch(() => null);
  const config0 = (cur && cur.config) || {};
  const rest = (Array.isArray(config0.ingress) ? config0.ingress : []).filter((r) => r.hostname && r.hostname !== opts.hostname);
  await cf('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`, { config: { ...config0, ingress: [...rest, { hostname: opts.hostname, service: 'http://app:8787' }, { service: 'http_status:404' }] } });

  // 4. DNS
  const target = `${tunnel.id}.cfargotunnel.com`;
  const recs = await cf('GET', `/zones/${zone.id}/dns_records?name=${encodeURIComponent(opts.hostname)}`);
  if (!recs.length) { await cf('POST', `/zones/${zone.id}/dns_records`, { type: 'CNAME', name: opts.hostname, content: target, proxied: true, ttl: 1 }); log(`DNS: created ${opts.hostname}`); }
  else if (recs[0].type === 'CNAME') { if (recs[0].content !== target || !recs[0].proxied) await cf('PATCH', `/zones/${zone.id}/dns_records/${recs[0].id}`, { content: target, proxied: true }); log(`DNS: ${opts.hostname} points at the tunnel`); }
  else throw new DeployError(`${opts.hostname} already has a ${recs[0].type} record. Remove it or pick another hostname.`);

  // 5. optional Cloudflare Access in front of the console
  if (opts.allow.length) {
    const apps = await cf('GET', `/accounts/${accountId}/access/apps`);
    let app = apps.find((a) => a.domain === opts.hostname);
    if (!app) app = await cf('POST', `/accounts/${accountId}/access/apps`, { name: 'Zedge', domain: opts.hostname, type: 'self_hosted', session_duration: '8h' });
    const pols = await cf('GET', `/accounts/${accountId}/access/apps/${app.id}/policies`);
    const body = { name: 'Allow console admins', decision: 'allow', include: opts.allow.map((email) => ({ email: { email } })), precedence: 1 };
    const mine = pols.find((p) => p.name === body.name);
    if (mine) await cf('PUT', `/accounts/${accountId}/access/apps/${app.id}/policies/${mine.id}`, body);
    else await cf('POST', `/accounts/${accountId}/access/apps/${app.id}/policies`, body);
    log(`Access: only ${opts.allow.join(', ')} can reach the console`);
  } else log('Access: not configured (the console login is the only gate). Re-run with --allow you@example.com to add Cloudflare Access.');

  // 6. .env (never overwrites values you already set)
  const tunnelToken = await cf('GET', `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`);
  const values = {
    CLOUDFLARE_API_TOKEN: existing.CLOUDFLARE_API_TOKEN || token,
    CLOUDFLARE_ACCOUNT_ID: existing.CLOUDFLARE_ACCOUNT_ID || accountId,
    EDGE_ADMIN_PASSWORD: existing.EDGE_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url'),
    SESSION_SECRET: existing.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    TUNNEL_TOKEN: tunnelToken
  };
  fsx.writeFileSync(envPath, mergeEnv(existingText, values), { mode: 0o600 });
  try { fsx.chmodSync(envPath, 0o600); } catch { /* best effort */ }
  log(`Wrote ${envPath} (mode 600). The admin password is the EDGE_ADMIN_PASSWORD line in that file.`);
  return { hostname: opts.hostname, tunnelId: tunnel.id, zoneId: zone.id, accountId, envPath, passwordGenerated: !existing.EDGE_ADMIN_PASSWORD };
}

const HELP = `Usage: npm run deploy -- --hostname console.example.com [options]

  --hostname H     public hostname (required); its zone must already be on Cloudflare
  --allow a@x,b@y  also put Cloudflare Access in front, allowing only these emails (recommended)
  --name N         tunnel name (default zedge; reused if it exists)
  --account ID     account id, if the token sees several
  --env-file F     where to write settings (default ./.env)
  --no-start       write everything but do not run docker compose

CLOUDFLARE_API_TOKEN must be set in the environment or in .env.`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(HELP); process.exit(0); }
    const r = await deploy(opts);
    if (opts.start) {
      console.log('Starting containers…');
      const p = spawnSync('docker', ['compose', 'up', '-d', '--build'], { stdio: 'inherit' });
      if (p.status !== 0) throw new DeployError('docker compose failed. Fix the error above and run: docker compose up -d --build');
    }
    console.log(`\nDone. Open https://${r.hostname}${opts.start ? '' : ' after running: docker compose up -d --build'}\nSign in as "admin".`);
  } catch (e) {
    console.error(e instanceof DeployError ? e.message : e);
    process.exit(1);
  }
}

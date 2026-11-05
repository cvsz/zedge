#!/usr/bin/env node
// Back up and restore DATA_DIR (users, roles, audit log, snapshots).
//   node scripts/backup.mjs create [--data ./data] [--out backup.tar.gz[.enc]]
//   node scripts/backup.mjs restore <file> [--to ./data]
// Set BACKUP_PASSPHRASE to encrypt (AES-256-GCM, key from scrypt). Without it the archive is plain tar.gz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const MAGIC = Buffer.from('ECB1');

export function encrypt(buf, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
export function decrypt(buf, passphrase) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not an encrypted Zedge backup');
  const salt = buf.subarray(4, 20); const iv = buf.subarray(20, 32); const tag = buf.subarray(32, 48);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new Error('Wrong passphrase, or the backup is damaged'); }
}

function tar(args, opts = {}) {
  const r = spawnSync('tar', args, { encoding: 'buffer', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`tar failed: ${String(r.stderr || '').slice(0, 200)}`);
  return r.stdout;
}

export function createBackup({ dataDir, out, passphrase }) {
  if (!fs.existsSync(dataDir)) throw new Error(`No such directory: ${dataDir}`);
  const tmp = path.join(os.tmpdir(), `zedge-backup-${process.pid}.tgz`);
  tar(['-czf', tmp, '-C', dataDir, '.']);
  const raw = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(out, passphrase ? encrypt(raw, passphrase) : raw, { mode: 0o600 });
  return { out, encrypted: !!passphrase, bytes: fs.statSync(out).size };
}

export function restoreBackup({ file, to, passphrase }) {
  let buf = fs.readFileSync(file);
  if (buf.subarray(0, 4).equals(MAGIC)) {
    if (!passphrase) throw new Error('This backup is encrypted: set BACKUP_PASSPHRASE');
    buf = decrypt(buf, passphrase);
  }
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  const tmp = path.join(os.tmpdir(), `zedge-restore-${process.pid}.tgz`);
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  try { tar(['-xzf', tmp, '-C', to]); } finally { fs.rmSync(tmp, { force: true }); }
  return { to };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
  const passphrase = process.env.BACKUP_PASSPHRASE || '';
  try {
    if (cmd === 'create') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const r = createBackup({ dataDir: path.resolve(opt('data', process.env.DATA_DIR || './data')), out: path.resolve(opt('out', `zedge-${stamp}.tar.gz${passphrase ? '.enc' : ''}`)), passphrase });
      console.log(`Backup written: ${r.out} (${r.bytes} bytes, ${r.encrypted ? 'encrypted' : 'NOT encrypted: set BACKUP_PASSPHRASE'})`);
    } else if (cmd === 'restore' && rest[0] && !rest[0].startsWith('--')) {
      const r = restoreBackup({ file: path.resolve(rest[0]), to: path.resolve(opt('to', process.env.DATA_DIR || './data')), passphrase });
      console.log(`Restored into ${r.to}. Restart the console.`);
    } else {
      console.error('Usage: backup.mjs create [--data dir] [--out file]  |  backup.mjs restore <file> [--to dir]');
      process.exitCode = 2;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

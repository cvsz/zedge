import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const CRLF = '\r\n';

/** A small SMTP client: implicit TLS (smtps) or STARTTLS, optional AUTH PLAIN. One message per connection. */
export async function sendMail({ url, from, to, subject, text, rejectUnauthorized = true, timeoutMs = 15000 }) {
  const u = new URL(url);
  const implicit = u.protocol === 'smtps:';
  const host = u.hostname;
  const port = Number(u.port) || (implicit ? 465 : 587);
  const wantStartTls = !implicit && u.searchParams.get('starttls') !== '0';
  if (!implicit && !wantStartTls && !LOOPBACK.includes(host)) throw new Error('Plain SMTP to a remote host is not allowed; use smtps:// or STARTTLS');
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');

  let socket = await new Promise((resolve, reject) => {
    const s = implicit ? tls.connect({ host, port, rejectUnauthorized, servername: host }, () => resolve(s)) : net.connect({ host, port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeoutMs, () => s.destroy(new Error('SMTP timed out')));
  });

  let buf = '';
  let waiter = null;
  const attach = (s) => {
    s.on('data', (d) => { buf += d.toString('utf8'); if (waiter) waiter(); });
    s.on('error', (e) => { if (waiter) waiter(e); });
    s.on('close', () => { if (waiter) waiter(new Error('SMTP connection closed')); });
  };
  attach(socket);
  /** Read one full reply (all lines of a multi-line reply). */
  const reply = () => new Promise((resolve, reject) => {
    const check = (err) => {
      if (err) { waiter = null; return reject(err); }
      const lines = buf.split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (/^\d{3} /.test(lines[i])) { const text = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n'); waiter = null; return resolve({ code: Number(text.slice(0, 3)), text }); }
      }
      return undefined;
    };
    waiter = check; check();
  });
  const cmd = async (line, ok) => {
    socket.write(line + CRLF);
    const r = await reply();
    if (!ok.includes(r.code)) throw new Error(`SMTP refused "${line.split(' ')[0]}": ${r.text.slice(0, 120)}`);
    return r;
  };

  try {
    const hello = await reply();
    if (hello.code !== 220) throw new Error(`SMTP greeting: ${hello.text.slice(0, 80)}`);
    let ehlo = await cmd('EHLO zedge', [250]);
    if (wantStartTls) {
      await cmd('STARTTLS', [220]);
      const raw = socket; raw.removeAllListeners('data'); raw.removeAllListeners('close'); raw.removeAllListeners('error');
      socket = tls.connect({ socket: raw, rejectUnauthorized, servername: host });
      await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      buf = ''; attach(socket);
      ehlo = await cmd('EHLO zedge', [250]);
    }
    if (user) {
      if (!implicit && !wantStartTls && !LOOPBACK.includes(host)) throw new Error('Refusing to send credentials without TLS');
      await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235]);
    }
    void ehlo;
    await cmd(`MAIL FROM:<${from}>`, [250]);
    for (const r of to) await cmd(`RCPT TO:<${r}>`, [250, 251]);
    await cmd('DATA', [354]);
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
    const msg = [`From: ${from}`, `To: ${to.join(', ')}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(8).toString('hex')}@zedge>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body, '.'].join(CRLF);
    await cmd(msg, [250]);
    try { socket.write(`QUIT${CRLF}`); } catch { /* already closed */ }
    return true;
  } finally { socket.destroy(); }
}

/**
 * One place for every alert. Messages are short sentences naming a user, a path or a count; never request bodies or secrets.
 * The same `key` is sent at most once per `quietMinutes` so a flapping problem does not flood anyone.
 */
export function createAlerts(config, { fetchImpl = fetch, log = console.error } = {}) {
  const a = config.alerts;
  const last = new Map();
  const enabled = !!(a.webhook || (a.smtpUrl && a.emailTo.length));

  async function deliver(text, subject, webhookOnly) {
    const jobs = [];
    if (a.webhook) jobs.push(fetchImpl(a.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) }));
    if (!webhookOnly && a.smtpUrl && a.emailTo.length) jobs.push(sendMail({ url: a.smtpUrl, from: a.emailFrom, to: a.emailTo, subject, text, rejectUnauthorized: a.smtpVerify }));
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') log(`alert delivery failed: ${r.reason && r.reason.message}`);
    return results;
  }

  /** Fire and forget. `opts.key` + `opts.quietMinutes` turn on de-duplication; `opts.webhookOnly` keeps routine notices out of email. */
  function alert(text, opts = {}) {
    if (!enabled) return Promise.resolve();
    if (opts.key) {
      const now = Date.now();
      if (last.has(opts.key) && now - last.get(opts.key) < (opts.quietMinutes || 30) * 60000) return Promise.resolve();
      last.set(opts.key, now);
    }
    return deliver(text, opts.subject || String(text).replace(/^Zedge:\s*/, '').slice(0, 90), !!opts.webhookOnly).catch(() => {});
  }
  alert.enabled = enabled;
  return alert;
}

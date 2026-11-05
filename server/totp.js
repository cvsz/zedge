import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

/** RFC 4226 HOTP with HMAC-SHA1. */
export function hotp(secretBase32, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms = Date.now(), period = 30) => Math.floor(ms / 1000 / period);

/**
 * Check a 6-digit code against the current step and one step either side (clock drift).
 * Returns the matched step, or null. A step at or before `lastStep` is refused, so a code works once.
 */
export function verifyTotp(secretBase32, code, { now = Date.now(), lastStep = -1, window = 1 } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepAt(now);
  for (let s = cur - window; s <= cur + window; s += 1) {
    if (s <= lastStep) continue;
    const want = Buffer.from(hotp(secretBase32, s));
    if (crypto.timingSafeEqual(want, Buffer.from(c))) return s;
  }
  return null;
}

export const otpauthUri = (account, secret, issuer = 'Zedge') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

export const newRecoveryCodes = (n = 8) => Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
export const hashRecovery = (code) => crypto.createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');

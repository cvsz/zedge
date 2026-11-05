// Ported from the Zedge (server/oidc.js): pure token checks, no I/O.
import crypto from 'node:crypto';

export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('The identity token is malformed');
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url')), claims: JSON.parse(Buffer.from(parts[1], 'base64url')), signed: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2], 'base64url') };
  } catch { throw new Error('The identity token is malformed'); }
}

/** Only RS256 and ES256 are accepted. "none" and shared-secret algorithms are refused. */
export function verifySignature(jwt, jwk) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (jwt.header.alg === 'RS256') return crypto.verify('RSA-SHA256', Buffer.from(jwt.signed), key, jwt.sig);
  if (jwt.header.alg === 'ES256') return crypto.verify('sha256', Buffer.from(jwt.signed), { key, dsaEncoding: 'ieee-p1363' }, jwt.sig);
  throw new Error('The identity token uses an unsupported signature algorithm');
}

export function checkClaims(claims, { issuer, clientId, nonce, now = Date.now() }) {
  if (claims.iss !== issuer) throw new Error('The identity token is from a different issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('The identity token is for a different application');
  if (aud.length > 1 && claims.azp !== clientId) throw new Error('The identity token was issued to a different party');
  if (!(Number(claims.exp) * 1000 > now - 60000)) throw new Error('The identity token has expired');
  if (claims.nbf && Number(claims.nbf) * 1000 > now + 60000) throw new Error('The identity token is not valid yet');
  if (claims.iat && Number(claims.iat) * 1000 > now + 5 * 60000) throw new Error('The identity token was issued in the future');
  if (!claims.nonce || claims.nonce !== nonce) throw new Error('The sign-in response did not match this browser session');
  if (!claims.sub) throw new Error('The identity token has no subject');
}

/** First entry of roleMap (in the order given) whose value appears in the claim wins. */
export function roleFromClaims(claims, cfg) {
  const raw = claims[cfg.roleClaim || 'groups'];
  const vals = Array.isArray(raw) ? raw.map(String) : raw !== undefined && raw !== null ? [String(raw)] : [];
  for (const [value, role] of Object.entries(cfg.roleMap || {})) if (vals.includes(value)) return role;
  return cfg.defaultRole || 'viewer';
}

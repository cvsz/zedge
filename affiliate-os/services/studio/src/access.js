import { decodeJwt, verifySignature } from '@affiliate-os/auth';

/**
 * Verify the Cf-Access-Jwt-Assertion header that Cloudflare Access adds to requests it let through.
 * Checks signature (RS256/ES256 only), issuer (https://<team>.cloudflareaccess.com), audience (the Access application AUD tag) and expiry.
 * `keys(refresh)` returns the JWKS (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs).
 */
export function createAccessVerifier({ issuer, audience, keys, now = Date.now }) {
  if (!issuer || !audience) {throw new Error('Access issuer and audience are required');}
  return async function verify(token) {
    const jwt = decodeJwt(token);
    const c = jwt.claims;
    if (c.iss !== issuer) {throw new Error('wrong issuer');}
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(audience)) {throw new Error('wrong audience');}
    if (!(Number(c.exp) * 1000 > now() - 30000)) {throw new Error('expired');}
    if (c.nbf && Number(c.nbf) * 1000 > now() + 30000) {throw new Error('not yet valid');}
    const find = async (refresh) => (await keys(refresh)).find((k) => k.kid === jwt.header.kid);
    const jwk = (await find(false)) || (await find(true));          // one refetch handles key rotation
    if (!jwk) {throw new Error('unknown signing key');}
    if (!verifySignature(jwt, jwk)) {throw new Error('bad signature');}
    if (!c.email && !c.sub) {throw new Error('no identity in token');}
    return { email: c.email ? String(c.email).toLowerCase() : null, subject: c.sub || null };
  };
}

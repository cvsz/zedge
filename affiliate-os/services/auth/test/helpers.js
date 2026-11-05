import crypto from 'node:crypto';
import { openMemory, createMigrator, provisionOrganization, scoped, repos } from '@affiliate-os/db';
import { createAuth } from '../src/index.js';

export const ISS = 'https://idp.example';
export const CLIENT = 'affiliate-studio';
export const clock = { t: Date.parse('2026-11-02T10:00:00Z') };
export const now = () => new Date(clock.t);

export function newKey(kid = 'k1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function idToken(key, claims, header = {}) {
  const h = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const p = b64({ iss: ISS, aud: CLIENT, sub: 'u-1', iat: clock.t / 1000, exp: clock.t / 1000 + 600, nonce: 'n-1', email: 'ann@example.com', groups: [], ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

export async function setup({ oidcExtra = {} } = {}) {
  const db = await openMemory();
  await createMigrator(db).up();
  const keys = { current: [newKey('k1')] };
  const cfgFor = () => ({ issuer: ISS, clientId: CLIENT, roleClaim: 'groups', roleMap: { 'aff-owners': 'owner', 'aff-editors': 'editor', 'aff-approvers': 'approver', 'aff-ghosts': 'ghost' }, defaultRole: 'viewer', keys: async () => keys.current.map((k) => k.jwk), ...oidcExtra });
  const orgA = await provisionOrganization(db, 'Org A');
  const orgB = await provisionOrganization(db, 'Org B');
  const auth = createAuth({ db, sessionSecret: 's'.repeat(40), oidc: { [orgA]: cfgFor(), [orgB]: cfgFor() }, now });
  const signIn = async (org, claims, key = keys.current[0]) => auth.signIn(org, idToken(key, claims), { nonce: 'n-1' });
  /** Sign in as a person with the given groups and return their principal. */
  const login = async (org, sub, groups = [], extra = {}) => { const r = await signIn(org, { sub, email: `${sub}@example.com`, groups, ...extra }); return auth.authenticate(r.token); };
  return { db, auth, orgA, orgB, keys, signIn, login, scoped: (o) => scoped(db, o), repos, close: () => db.close() };
}

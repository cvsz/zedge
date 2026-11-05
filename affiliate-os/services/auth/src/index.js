export { createAuth, AuthError, jwksFetcher, approvalFingerprint } from './service.js';
export { PERMISSIONS, can, validPermissions, AUTONOMY } from './rbac.js';
export * as audit from './audit.js';
export { decodeJwt, verifySignature, checkClaims, roleFromClaims } from './oidc.js';

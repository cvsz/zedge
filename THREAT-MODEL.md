# Threat Model - Zedge

## Scope

Zedge is a self-hosted Cloudflare control panel. It holds a Cloudflare API token and exposes an authenticated console for managing zones, DNS, Workers, R2, Zero Trust, email, and analytics.

## Threat Model

### T1: Credential Theft from Server

**Threat:** Attacker steals the `CLOUDFLARE_API_TOKEN` or `ZEDGE_ADMIN_PASSWORD` from the server filesystem or memory.

**Impact:** Full control of the Cloudflare account through the console's token.

**Mitigations:**
- Token never leaves the server; browser only holds a signed session cookie (`zedge_session`, HttpOnly, SameSite=Strict).
- `.env` file mode 0600; `DATA_DIR` files mode 0600.
- Token is never logged, returned in API responses, or sent to the browser.
- Secret scanning step in CI (dependency/secret scan gate).

**Test:** `test/api.test.js` verifies config refuses to start without a password; `test/rbac.test.js` verifies session-based access control.

---

### T2: Session Hijacking

**Threat:** Attacker steals or guesses the session cookie and impersonates a user.

**Impact:** Unauthorized mutations through the user's session.

**Mitigations:**
- Session cookie is HttpOnly, SameSite=Strict, Secure when `COOKIE_SECURE=1`.
- Cookie is HMAC-signed; tampered cookies are rejected.
- Login rate limiting (5 failures / 15 minutes per IP).
- Session resolves on every request; role changes apply immediately.

**Test:** `test/api.test.js` verifies tampered cookies are rejected; `test/api.test.js` verifies login rate limiting.

---

### T3: Cross-Site Request Forgery (CSRF)

**Threat:** A malicious site tricks the browser into sending a state-changing request to Zedge with the user's session cookie.

**Impact:** Unauthorized DNS changes, Worker deploys, zone deletion.

**Mitigations:**
- All state-changing requests require `X-Requested-With: zedge` header (cannot be sent cross-origin by a browser).
- Strict CSP: `frame-ancestors 'none'` prevents clickjacking.
- `Referrer-Policy: no-referrer` prevents leaking origin.

**Test:** `test/api.test.js` verifies state-changing requests need the CSRF header.

---

### T4: Cross-Site Scripting (XSS)

**Threat:** Attacker injects malicious JavaScript into the console UI, executing in the context of an authenticated admin.

**Impact:** Session theft, unauthorized actions performed as the admin.

**Mitigations:**
- Strict CSP: `default-src 'self'; style-src 'self'; img-src 'self' data:;` with no inline script or style.
- Frontend is vanilla JS with no build step; all DOM text uses `h()` which escapes HTML.
- No `innerHTML` usage; no `eval()`.

**Test:** `test/ui-smoke.mjs` runs axe-core accessibility scan; CSP header regression tests.

---

### T5: Privilege Escalation

**Threat:** A low-privilege user (viewer/operator) accesses admin-only routes.

**Impact:** Unauthorized user creation, role changes, zone deletion.

**Mitigations:**
- Every mutation route is behind `need(<permission>)` from `server/rbac.js`.
- RBAC with 3 built-in roles and 14 permissions; custom roles supported.
- `need()` middleware checks `can(req.user.permissions, perm)` before every mutation.

**Test:** `test/rbac.test.js` verifies viewer cannot write, operator cannot access Workers/Zero Trust/tokens/users.

---

### T6: Tenant/Zone Isolation Bypass

**Threat:** A user restricted to certain zones accesses zones they are not authorized for.

**Impact:** Cross-zone data exposure or mutation.

**Mitigations:**
- `assertZone(zid, req)` checks `req.user.zones` before every zone-scoped operation.
- `GET /zones` filters results to the user's allowed zones.
- `GET /accounts` respects `CLOUDFLARE_ACCOUNT_IDS` restriction.

**Test:** `test/rbac.test.js` verifies multi-account switching and zone isolation.

---

### T7: Supply Chain Attack

**Threat:** A compromised npm dependency introduces malicious code.

**Impact:** Token exfiltration, silent backdoor.

**Mitigations:**
- Runtime dependency is only `express`.
- Dev dependencies are pinned: `@types/express`, `@types/node`, `axe-core`, `typescript`, `eslint`.
- `npm ci` (not `npm install`) in CI for reproducible installs.
- Secret scanning and dependency audit gate in CI.

**Test:** `npm audit --omit=dev --audit-level=high` in CI audit job.

---

### T8: Audit Log Tampering

**Threat:** An attacker with file system access modifies `audit.jsonl` to hide their actions.

**Impact:** Undetectable malicious activity.

**Mitigations:**
- Audit log is append-only (file mode 0600).
- Every non-GET call is logged with user, method, path, status, IP.

**Gap:** Audit log is not yet hash-chained. See `docs/audit/FINAL-PRODUCTION-CERTIFICATION.md` - this is NOT RUN.

**Test:** `test/api.test.js` verifies audit log records mutations (via `store.auditTail`).

---

### T9: Insecure Transport

**Threat:** Session cookie or API token is intercepted in transit.

**Impact:** Session hijacking or token theft.

**Mitigations:**
- `COOKIE_SECURE=1` required when `HOST` is not loopback (enforced in `loadConfig`).
- HSTS header when `secureCookie` is set.
- Docker compose uses `COOKIE_SECURE=1`, `TRUST_CF_CONNECTING_IP=1`.

**Test:** `test/api.test.js` verifies `COOKIE_SECURE=1` required for non-loopback.

---

### T10: Rate Limiting Bypass

**Threat:** Attacker bypasses login rate limiting by spoofing `X-Forwarded-For` or similar.

**Impact:** Unlimited password guessing.

**Mitigations:**
- Login limiter keyed by `req.ip`.
- When `TRUST_CF_CONNECTING_IP` is off, `req.ip` is the direct connection IP (not spoofable).
- When `TRUST_CF_CONNECTING_IP` is on (tunnel-only), the tunnel is the sole ingress.

**Test:** `test/api.test.js` verifies login rate limiting after repeated failures.

---

## Acceptance Criteria

- [ ] Every threat listed above has at least one corresponding test.
- [ ] No unauthenticated route accepts state-changing requests.
- [ ] No new inline script or style in the frontend.
- [ ] No secrets are logged or returned to the browser.
- [ ] `npm audit --omit=dev --audit-level=high` passes with 0 vulnerabilities.

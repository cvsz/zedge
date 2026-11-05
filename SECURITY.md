# Security

## Reporting
Email the maintainer privately; do not open a public issue for a vulnerability. Include steps to reproduce and the version (`package.json`).

## Model in one paragraph
Zedge holds one Cloudflare API token and lets signed-in people use it through a narrow, permission-checked API. The token never reaches the browser. Everything a user can do is an explicit allowlist entry or a dedicated validating route, each tied to one permission.

## Controls
| Area | Control |
|---|---|
| Passwords | scrypt, 12-character minimum, constant-time compare, dummy hash for unknown users |
| Sessions | HMAC-signed cookie, `HttpOnly`, `SameSite=Strict`, `Secure` unless disabled for local use; user looked up on every request so role changes and disabling apply immediately |
| Two-factor | TOTP (RFC 6238), one-use codes (replay refused), 8 hashed one-time recovery codes, password required to turn off, lockout after repeated failures |
| CSRF | `X-Requested-With` required on every non-GET call, plus `SameSite=Strict` |
| Authorization | permission per endpoint; unknown Cloudflare paths refused; zone ids checked in paths, query and bodies against `CLOUDFLARE_ACCOUNT_IDS` and the user's own domain list |
| Dangerous actions | D1 changes need an explicit switch; snapshot restore previews first; optional two-person approval (`APPROVAL_REQUIRED=1`) for cache purge, DNSSEC disable, deletes of KV/D1/queues, changing SQL, destructive restores, Origin CA revoke |
| Injection | rule expressions are built from validated fields; quotes and line breaks refused; analytics dimensions are whitelisted |
| Browser | strict CSP without inline styles or scripts, `nosniff`, no-referrer, no-store |
| Single sign-on | Authorization code + PKCE, state in a signed single-use cookie, id token signature checked against the provider's keys (RS256/ES256 only), issuer, audience, nonce and expiry checked, role from claims on every sign-in, SSO usernames prefixed so they cannot take over a local account |
| Resource limits | Per-user lists for domains, Workers, buckets, KV, D1 and Pages enforced on pass-through calls, console routes and request bodies; limited users cannot create new resources |
| Alerts | Webhook and email for approvals, lockouts, Cloudflare failure bursts, token expiry and audit tampering; never bodies or secrets; de-duplicated |
| Rate limits | login attempts per IP; API calls per user (reads and writes separately) |
| Audit | every change recorded (never bodies or secrets); hash-chained so edits and deletions show; export and retention |
| Secrets | Worker secrets and token values are write-only in the UI; secrets shown once in a copy box |
| Backups | optional AES-256-GCM with scrypt-derived key |

## Operating it safely
1. Put it behind Cloudflare Access or a VPN; the default bind is `127.0.0.1`.
2. Give the Cloudflare token only the permissions you use (README lists them).
3. Turn on two-factor for every account that can change things; keep `APPROVAL_REQUIRED=1` when more than one person can approve.
4. Set `METRICS_TOKEN` only if you scrape metrics; keep it off otherwise.
5. Back up `DATA_DIR` with a passphrase and test a restore.
6. Rotate the Cloudflare token on a schedule; the console warns 14 days before expiry.

## Known limits
- Single process, file-backed state: not for horizontal scaling.
- The mock-based tests do not prove behavior on a real account (EC-101).
- Resource limits cover the listed resource types only (domains, Workers, buckets, KV, D1, Pages); other account-level features follow the role.

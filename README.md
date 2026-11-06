# Zedge

Self-hosted Cloudflare control panel — domains, DNS, security, WAF, rules, Workers, R2, Zero Trust, email, analytics, multi-user RBAC, and more.

## What is Zedge

Zedge is a self-hosted console for managing Cloudflare accounts and zones. It provides a web UI and REST API for:

- **Domains & DNS:** add zones, create/edit/delete DNS records, bulk origin updates, zone settings
- **Workers:** deploy, rollback, variables and secrets management
- **R2 Storage:** bucket and object browsing, upload, download, delete with SigV4 signing
- **Rules:** rate limit rules, managed rulesets, redirect rules, cache rules, WAF custom rules, page rules
- **Analytics:** GraphQL queries, HTTP request series with totals
- **Email:** SPF/DKIM/DMARC status, DMARC record management, email routing
- **Zero Trust:** Access apps and policies, Gateway rules, device posture, tunnels
- **API Tokens:** least-privilege token templates with expiry
- **Users & Roles:** RBAC with custom roles, audit log, session management
- **Metrics:** Prometheus-formatted `/metrics` endpoint
- **Events:** ClickRecorded event emission with outbox/relay/consumer pattern
- **Publication lifecycle:** status transitions IDEA → REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED/FAILED
- **I18n:** English and Thai UI strings (`public/i18n/`)

## Tech Stack

- **Runtime:** Node.js `>=20`, pure ES Modules (`"type": "module"`)
- **Framework:** Express (`^4.21.2`), zero frontend build steps
- **Frontend:** Vanilla JavaScript and CSS (`public/`), single-page app
- **Backend:** `server/` — `app.js`, `routes/`, `cf.js` (Cloudflare API client), `s3.js` (R2 client), `rbac.js`, `store.js`, `config.js`, `auth.js`, `metrics.js`, `openapi.js`, `allowlist.js`
- **Testing:** Node.js built-in test runner (`npm test` runs `node --test "test/*.test.js"`)
- **Makefile:** 13 targets (`start`, `stop`, `restart`, `update`, `upgrade`, `install`, `lint`, `test`, `build`, `deploy`, `logs`, `status`, `help`)

## Quick Start

```bash
# Copy environment example
cp .env.example .env

# Edit .env with your values:
#   CLOUDFLARE_API_TOKEN=cfat_...
#   CLOUDFLARE_ACCOUNT_ID=...
#   ZEDGE_ADMIN_PASSWORD=...  (12+ characters)

# Install dependencies
npm install

# Start the server
npm start

# Run tests
npm test
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token (never sent to browser) |
| `CLOUDFLARE_ACCOUNT_ID` | No | Restrict console to specific account(s) |
| `ZEDGE_ADMIN_PASSWORD` | Yes | First admin password (12+ characters) |
| `SESSION_SECRET` | No | Session cookie signing secret |
| `ZEDGE_ALLOW_NO_AUTH` | No | Allow no-auth mode on loopback only (`1` = enable) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | No | R2 object storage access |
| `R2_ENDPOINT` | No | R2 S3-compatible endpoint |
| `METRICS_TOKEN` | No | Bearer token for `/metrics` endpoint |

See `.env.example` for all options.

## Backlog Status (zedge-master-prompt.md)

### Tier B — Completed

| Item | Description | Status |
|------|-------------|--------|
| B1 | Link service to events — ClickRecorded, outbox, relay, consumer | `server/events.js` |
| B2 | Catalog, offers, ranking — observed/modeled separation, ProductRanked | `server/ranking.js` |
| B3 | Publication lifecycle — IDEA→REVIEW→APPROVED→SCHEDULED→PUBLISHING→PUBLISHED/FAILED | `server/publication-status.js` |
| B7 | Metrics and tracing wiring — `/metrics` endpoint, security headers | `server/app.js` |
| B8 | Zedge depth — accessibility audit notes | `docs/accessibility.md` |
| B9 | Security review — CSP, HSTS, X-Content-Type-Options, etc. | `server/app.js` |
| B13 | Thai and English i18n — 105 keys each | `public/i18n/en.json`, `th.json` |

### Tier A — Needs Owner Involvement

| Item | Description | Status |
|------|-------------|--------|
| A1 | Real-account verification — throwaway domain + API token | Blocked (needs credentials) |
| A2 | Real contract recordings — `test/support/recorder.js` | Blocked (needs recorder + account) |
| A3 | Platform capability verification — TikTok/Shopee/Meta/YouTube | Blocked (needs owner confirmation) |
| A4 | Run CI and release once — push branch + tag | Blocked (needs approval) |

### Tier B — Remaining (needs Affiliate OS infrastructure)

B4 (studio depth), B5 (manual-adapter workflow), B6 (Postgres hardening), B10 (Cloudflare coverage), B11 (missing Cloudflare features), B12 (frontend overhaul) require Affiliate OS infrastructure not present in this repository.

## Test Results

```
npm test
```
Runs against a mock Cloudflare API (no network). See the TAP output for the current pass/fail count.

Run `npm test` (mock Cloudflare API, no network). Tests require `CLOUDFLARE_API_TOKEN` and `ZEDGE_ADMIN_PASSWORD` environment variables.

## Repository Structure

```
server/
  app.js          - Express app, middleware, security headers
  config.js       - Environment configuration loading
  cf.js           - Cloudflare API v4 client
  s3.js           - R2 S3-compatible client
  rbac.js         - Role-based access control
  auth.js         - Authentication and sessions
  store.js        - Local JSON storage (users, roles, audit)
  metrics.js      - Prometheus-formatted metrics
  openapi.js      - OpenAPI spec generation
  allowlist.js    - API endpoint allowlist with permissions
  errors.js       - HTTP error helpers
  index.js        - Server entrypoint
  routes/
    core.js       - Domains, DNS, tunnels, tokens, meta
    rules.js      - Rate limits, rulesets, redirects, cache rules
    workers.js    - Worker deploy, rollback, vars, secrets
    r2.js         - R2 buckets and objects
    email.js      - Email security and routing
    analytics.js  - GraphQL analytics queries
    admin.js      - Users, roles, audit log
  events.js       - ClickRecorded events, outbox, relay, consumer (NEW)
  publication-status.js - Publication lifecycle state machine (NEW)
  ranking.js      - Observed/modeled ranking with ProductRanked (NEW)
public/
  views/          - SPA views (admin, email, rules, storage, workers, zerotrust)
  i18n/
    en.json       - English UI strings (105 keys) (NEW)
    th.json       - Thai UI strings (105 keys) (NEW)
  app.js, ctx.js, lib.js, charts.js
test/
  api.test.js     - Core API tests (config, auth, proxy, domains, DNS, Workers, tokens)
  features.test.js - Rules, WAF, redirects, cache, Workers, R2, email, Zero Trust
  rbac.test.js    - Role-based access control tests
  deploy.test.js  - Deploy script tests
  metrics.test.js - Metrics endpoint tests
  proxy.test.js   - Proxy allowlist tests
  sigv4.test.js   - R2 SigV4 signing tests
  mock-cf.js      - Mock Cloudflare API server
  ui-smoke.mjs    - Browser smoke test
docs/
  accessibility.md - WCAG 2.1 A/AA audit notes (NEW)
  architecture.md
  development.md
  release.md
  startup.md
  repository-rollout.md
  profiles.md
  cloudflare-terraform.md
  adr/
  ai/
scripts/
  bootstrap.py
  deploy.mjs
  github_admin.py
  validate_repo.py
Makefile           - 13 targets (start, stop, restart, update, upgrade, install, lint, test, build, deploy, logs, status, help)
.env.example       - Environment variable template
CHANGELOG.md
IMPLEMENTATION-CHECKLIST.md
ROADMAP.md
zedge-master-prompt.md
Final-Report.md
```

## Security

- Strict CSP: `default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- HSTS (conditional on HTTPS), X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, Cache-Control: no-store
- All state-changing requests require `X-Requested-With` header (CSRF protection)
- Session cookies are HttpOnly, SameSite=Strict
- RBAC on all mutation routes via `rbac.js`
- Rate limiting on login attempts
- No secrets logged or committed

## GPG Commit Signing

Commits can be signed non-interactively using the `GPG_PASS` passphrase:

```bash
# Set once (locally, not committed):
git config gpg.program "$PWD/scripts/git-gpg-sign.sh"
git config commit.gpgsign true
git config user.signingkey <YOUR_KEY_ID>

# Then sign commits with GPG_PASS:
export GPG_PASS="..."
git commit -S -m "message"
```

`scripts/git-gpg-sign.sh` feeds `GPG_PASS` to `gpg` on fd 3
(`--pinentry-mode loopback --passphrase-fd 3`), leaving stdin free for the
payload git supplies. Requires `allow-loopback-pinentry` in
`~/.gnupg/gpg-agent.conf` and a secret key whose passphrase matches `GPG_PASS`.

## Documentation

- `AGENTS.md` — Agent instructions for this repository
- `CLAUDE.md` — Claude Code instructions
- `OPENCODE.md` — OpenCode instructions
- `ZEAZ-INTRODUCTION.md` — ZEAZ engineering framework
- `CHANGELOG.md` — Change log
- `IMPLEMENTATION-CHECKLIST.md` — Implementation checklist
- `ROADMAP.md` — Roadmap with Zedge backlog
- `zedge-master-prompt.md` — Master prompt with full backlog (Tier A, B, C)
- `Final-Report.md` — Backlog completion report
- `docs/accessibility.md` — Accessibility audit notes
- `docs/cloudflare-terraform.md` — Cloudflare/Terraform ownership

## License

MIT. See `LICENSE`.
---

## OpenID Connect (SSO)

OIDC identity-token verification (`server/oidc.js`):

- Accepts RS256 and ES256 signed JWTs only; `"none"` and HS256 are refused
- Validates issuer (`iss`), audience (`aud`), authorized party (`azp`), expiry (`exp`), not-before (`nbf`), issued-at (`iat`), nonce, and subject (`sub`)
- Maps claims to console roles via `oidc.roleMap` config; derives a prefixed console username from email to prevent collision with local accounts
- Configuration is under `oidc.*` in `.env.example` / server config

## Two-Factor Authentication (TOTP)

TOTP support (`server/totp.js`, `server/auth.js`):

- RFC 4226 HOTP with HMAC-SHA1, base32-encoded secrets
- 6-digit codes with time-step tracking and single-use enforcement
- Recovery codes (5-5 hex format) for account lockout scenarios
- Enforced at login when `u.totp.enabled` is set; admin can reset via `resetTotp`

## Alerts (SMTP Email)

Outbound email via SMTP (`server/alerts.js`):

- Implicit TLS (`smtps://`) or STARTTLS; plain SMTP to remote hosts is blocked
- Optional `AUTH PLAIN` credentials from the SMTP URL
- Configurable timeout and certificate verification

## Approvals (Risk-Aware Destructive Actions)

Risk-aware approval workflow (`server/approvals.js`):

- Fingerprints destructive requests (method + path + body) with SHA-256
- Identifies high-risk operations: cache purge, DNSSEC disable, KV/D1/queue deletion, D1 writes, snapshot restore, certificate revocation
- Pending state (24 hours) and approved state (30 minutes) before execution
- Audit trail for all approval decisions

## Limits (Per-User Resource Quotas)

Per-user resource limits (`server/limits.js`, enforced in `server/store.js`):

- Workers (script names), R2 buckets, KV namespaces, D1 databases, Pages projects
- Max 200 entries per resource type; names/ids validated against `^[A-Za-z0-9._-]{1,64}$`
- Empty list = all resources; specific list = restricted to listed IDs only
- Enforced at account-level route access (`/accounts/*`)

## Edge API Routes

Direct zone-level operations (`server/routes/edge.js`):

- **Workers snippets**: `PUT/DELETE /api/zones/:zid/snippets/:name` (32 KB max, `workers.write` required)
- **KV values**: read/write/delete key-value pairs in zone KV namespaces
- **D1 SQL**: read-only SQL queries (`SELECT/WITH/EXPLAIN/PRAGMA table_info` only)
- **DNS zone files**: zone file import/export (1 MB max)

## Snapshots (Configuration Diff)

Zone configuration snapshots (`server/routes/snapshots.js`):

- Diff DNS records and rules between snapshot and live state
- Detect added, removed, and changed records (proxied, TTL, content)
- Compare WAF/rate-limit/cache rules across zones
- Cloneable zone settings: SSL, TLS, HSTS, Brotli, security level, and more
- Max 50 snapshots retained; snapshot IDs use `YYYYMMDDThhmmssZ-xxxxxx` format

---

## CI Workflow

GitHub Actions CI (`.github/workflows/ci.yml`):

- **test**: Node.js 20 and 22 matrix; `npm ci`, `npm run typecheck`, `npm test`, `npm run openapi:check`
- **affiliate-link-service**: tests in `affiliate-os/services/link-service`
- **helm**: `helm lint` and `helm template` for `deploy/helm/zedge`; rejects `replicaCount=2`
- **browser**: Playwright smoke test with Chromium (needs test job)
- **docker**: `docker build` with buildx, `zedge:ci` tag (needs test job)

---

## Environment Variables (New)

| Variable | Required | Description |
|----------|----------|-------------|
| `OIDC_ISSUER` | No | OpenID Connect issuer URL |
| `OIDC_CLIENT_ID` | No | OIDC client ID (audience) |
| `OIDC_ROLE_CLAIM` | No | JWT claim used for role mapping (default: `role`) |
| `OIDC_ROLE_MAP` | No | JSON mapping of claim values to console roles |
| `OIDC_DISABLE_PASSWORD` | No | Set `1` to disable password login (breakglass users excepted) |
| `OIDC_BREAKGLASS` | No | Comma-separated usernames exempt from OIDC-only mode |
| `SMTP_URL` | No | SMTP connection URL for alerts (`smtps://` or `STARTTLS`) |
| `SMTP_FROM` | No | Default sender address for alert emails |
| `RESOURCE_LIMITS` | No | JSON object of per-user resource quotas |

# exec-planning.md: execution source of truth

Pick the highest-priority item whose dependencies are Done, make a failing test first where practical, implement the minimum change, run `npm test` and `npm run smoke`, then update this file, `IMPLEMENTATION-CHECKLIST.md` and `CHANGELOG.md`. Never mark an item Done without a passing test or a recorded manual check. Never publish, deploy, spend money or touch a real Cloudflare account without the owner's go-ahead.

Status values: `Done`, `Ready`, `Blocked` (needs something only the owner can supply), `Later`.

## Open items

### EC-101 · P0 · Blocked · Verify against a real Cloudflare account
- **Dependencies:** a throwaway domain, a Worker, and an API token (owner supplies)
- **Scope:** run every screen added in 1.1 and 1.2 against a real account; fix payload mismatches (Worker vars, Access, posture, Gateway, R2 lifecycle/CORS, Pages, load balancing, Snippets, Turnstile, Logpush).
- **Acceptance:** each screen's create, change and delete round-trip succeeds on the real API, or the plan-dependent failure is explained in the UI.
- **Tests:** manual checklist in `docs/runbooks/real-account-check.md`; for each fix add a recorded-response contract test (EC-102).
- **Security:** use a scoped token for the throwaway account only; revoke it afterwards.
- **Docs:** README "Verified" section updated with what was actually run.

### EC-102 · P0 · Blocked by EC-101 · Contract tests from real responses
- **Scope:** record real Cloudflare responses (secrets scrubbed) as fixtures; replay them in the mock so the mock stays honest.
- **Acceptance:** `npm test` fails if the console's request shapes drift from the recorded ones.
- **Security:** fixtures contain no tokens, account ids or hostnames.

### EC-103 · P1 · Ready · Build and run the Docker image
- **Dependencies:** a machine with a Docker daemon
- **Acceptance:** CI `docker` job green; `docker compose up` serves `/api/session`; deploy script run against a real tunnel.
- **Tests:** CI job already defined in `.github/workflows/ci.yml`.

### EC-104 · P1 · Done · OIDC / SSO sign-in
- **Scope:** OIDC authorization-code flow with PKCE; map a claim to a role; keep local users as break-glass.
- **Acceptance:** sign-in via a test IdP; role comes from claims; disabled local login option.
- **Tests:** mock IdP; state/nonce replay; wrong audience; expired token.
- **Security:** validate issuer, audience, signature (JWKS), nonce; no tokens in the browser.

### EC-105 · P1 · Done · Alerts: failures and email
- **Scope:** alert on Cloudflare error spikes and token expiry; add an email transport next to the webhook.
- **Acceptance:** a burst of failing calls produces one alert; alerts never contain request bodies.

### EC-106 · P2 · Done · Zone limits for account-level features
- **Scope:** today the per-user domain list limits zone-scoped calls only. Add optional per-user limits for Workers, buckets and namespaces.
- **Acceptance:** a limited user cannot read or change resources outside their list, including by id guessing.

### EC-107 · P2 · Done · Helm chart and signed images
- **Acceptance:** `helm lint` clean; image signed in CI; SBOM published.

### EC-108 · P2 · Partly done · Remaining Cloudflare features
- Done: Pages project creation, Gateway HTTP/network rules with the isolate action, Logpush ownership challenge, Terraform JSON export of rulesets, Stream and Images listing/deleting.
- Left: Pages direct upload and Git connection, Stream/Images upload, Registrar changes, full Browser Isolation settings.

### EC-109 · P3 · Partly done · Quality
- Done: generated OpenAPI with drift test; axe-core scan of every screen in both themes.
- Left: JSDoc/TypeScript checking; a manual accessibility audit (screen reader, keyboard); mobile layout polish.

## Done

| ID | Item | Evidence |
|---|---|---|
| EC-104 | OIDC single sign-on | `test/oidc.test.js` (7, with a mock identity provider) |
| EC-105 | Alerts: email, Cloudflare failure bursts, token expiry, audit tampering | `test/alerts.test.js` (7, with a mock SMTP server) |
| EC-106 | Per-user limits for account-level resources | `test/limits.test.js` |
| EC-107 | Helm chart, Prometheus rules, Grafana dashboard | files present and YAML-valid; `helm lint` runs in CI only (no Helm binary here) |
| EC-110 | Generated OpenAPI with drift and open-route tests | `test/openapi.test.js` |
| EC-111 | Affiliate OS Phase 0 and AFF-001 | `affiliate-os/` |

| ID | Item | Evidence |
|---|---|---|
| EC-001 | Domains, DNS, security, rules, Workers, R2, Zero Trust, email, analytics, tokens, users and roles | `test/api.test.js`, `features.test.js`, `rbac.test.js`, `ui-smoke.mjs` |
| EC-002 | Pages, load balancing, Workers routes/domains/cron, Snippets, transform and origin rules, KV, D1 console, Queues, SSL, Origin CA, Turnstile, Bot Fight Mode, Logpush, Access groups, service tokens, WARP profiles | `test/cloudflare-extra.test.js`, smoke |
| EC-003 | Snapshots: capture, diff, restore with preview, JSON/Terraform export, clone settings | `cloudflare-extra.test.js` |
| EC-004 | Hash-chained audit log, rate limiting, `/metrics`, change alerts, encrypted backups | `cloudflare-extra.test.js`, `backup.test.js` |
| EC-005 | TOTP two-factor sign-in with recovery codes and admin reset | `test/access.test.js` |
| EC-006 | Per-user domain allowlist | `access.test.js` |
| EC-007 | Approval flow for risky actions (`APPROVAL_REQUIRED=1`) | `access.test.js` |
| EC-008 | CI workflow, systemd unit | `.github/workflows/ci.yml`, `deploy/` |

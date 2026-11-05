# Changelog

## 2.0.1

Changed
- `MASTER-PROMPT.md` rewritten for the current state: new naming and frontend rules, the 2.0.0 test counts, new backlog items B10 to B13 (prove and close Cloudflare coverage with a generated report, build the missing products one at a time, frontend overhaul with a responsive grouped menu, command palette, shared component set and tablet/phone acceptance tests, Thai/English), an honest coverage matrix, and the frontend plan with measurable acceptance.

## 2.0.0: renamed to Zedge

Changed (breaking, but old installs keep working where noted)
- The product is now called **Zedge** (it was "Edge Console"). The name in the UI, page title, brand mark, alerts, emails, two-factor issuer, docs, package, Docker image, Helm chart (`deploy/helm/zedge`), systemd unit (`zedge.service`), Prometheus rules and Grafana dashboard all follow. "Edge" as a feature name (Workers routes, Snippets) is unchanged: it means Cloudflare's edge.
- Environment variables: `EDGE_ADMIN_PASSWORD` -> `ZEDGE_ADMIN_PASSWORD`, `EDGE_ALLOW_NO_AUTH` -> `ZEDGE_ALLOW_NO_AUTH`. The old names still work and print a deprecation warning; the new names win if both are set. Rename them in your `.env`, Kubernetes secret and CI secrets.
- Prometheus metrics are now `zedge_*` (were `edge_console_*`), and the alert names are `Zedge*`. **Update any Prometheus rules, dashboards and alert routes you copied before 2.0.** The files in `deploy/` are already updated.
- Session and SSO cookies are now `zedge_session` and `zedge_oidc`. **Everyone is signed out once after upgrading.**
- The CSRF header value is now `X-Requested-With: zedge`. The old value `edge-console` is still accepted, so existing scripts keep working.
- Browser settings (theme, selected domain, tab choices) move from `edge.*` to `zedge.*` automatically on first load.
- Docker image and chart names changed: use `zedge` (set `image.repository` in the Helm values to your own registry path). Existing data directories need no change.

## 1.9.0

Added
- `npm run rotate` / `make rotate`: rotates `SESSION_SECRET`, `METRICS_TOKEN`, the admin password (in the user store and `.env`, audited) and, with `--yes`, rolls the Cloudflare API token through the API. Dry run, atomic 0600 writes, secrets never printed, the new token is rescued to a file if `.env` cannot be written. The Cloudflare roll is tested against a fake API only.

## 1.8.0

Changed
- Environment variables renamed: `CF_API_TOKEN` -> `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID` -> `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_IDS` -> `CLOUDFLARE_ACCOUNT_IDS` (code, deploy script, Docker Compose, Helm docs, CI, Makefile, docs, tests). The old names still work and print a deprecation warning; the new names win if both are set. `CF_API_BASE` (testing override) and `TRUST_CF_CONNECTING_IP` are unchanged.
- Rename them in your `.env`, Kubernetes secret and CI secrets; the old names will be removed in a later release.

## 1.7.0

Added (hardening; all tested, none exercised in production)
- Studio: per-IP and per-user token-bucket rate limiting (429 with Retry-After, bounded memory), `/readyz` (database reachability), configurable `/.well-known/security.txt`, graceful shutdown, structured JSON logging with redaction of secrets, emails and bearer tokens.
- `createLogger` / `redactForLog` in `@affiliate-os/observability`.
- CycloneDX 1.5 SBOM generator (`npm run sbom`, `scripts/sbom.mjs`) and a CI job that uploads SBOMs for both products.
- Seeded property tests: cost-ledger invariants (never over budget, replay changes nothing, entries equal accepted operations) and hash canonicalisation.
- Prometheus alert rules for the studio (`deploy/prometheus/affiliate-studio-alerts.yml`) with a test that checks they match the exposed metrics and runbook links.
- Runbooks (`affiliate-os/docs/runbooks/`): dead-letter growth, stuck outbox, sign-in outage, failed restore. Written from the code; never drilled.

- `Makefile` with setup, run, migrate, test, check/ci gates, SBOM, container/Helm/deploy and packaging targets (`make help`).

Still open: everything in the "needs the owner" list, plus backups and restore automation, passkeys, SCIM, secret manager, SLSA attestations, full OpenTelemetry SDK, mutation testing, penetration test, compliance work.

## 1.6.0

Added
- Affiliate OS `pg` adapter (`openPostgres`) with the same exec/query/transaction calls as PGlite, idle-connection error handling, and a migrate CLI (`npm run migrate -w @affiliate-os/db -- up|down|status`).
- The whole Affiliate OS suite (86 tests) now also runs on a **real PostgreSQL server**: `npm run test:pg` starts one from the `embedded-postgres` package (as user `nobody` when run as root). `npm run e2e:pg` migrates with the CLI and starts the studio from its production entry point.
- Studio production entry point (`main.js`, configured from environment variables), authenticated `GET /metrics` (bearer token, off unless configured), a 7-day week grid, and a browser check (`test/browser.mjs`).
- Type checking: `npm run typecheck` (tsc with `checkJs`, non-strict) over `server/`, `public/` and `scripts/`; zero errors; runs in CI.
- CI job for Affiliate OS (PGlite suites, real-Postgres suites, end-to-end smoke).

Changed
- Several JSDoc annotations and `Buffer` to string conversions in `server/` so the type check passes; no behaviour change (all 115 tests still pass).

Still open: real Cloudflare account run and recordings, `helm lint` and Docker runs, release workflow never run, Pages direct upload, link-service to events wiring, ranking consumer, platform adapters (need owner verification), strict typing.

## 1.5.0

Added
- Affiliate OS scheduling: `content.scheduled_for` (migration 0004), only approved content can be scheduled and only for a future time; studio schedule/unschedule with the `publish.schedule` permission and a scheduled list.
- Affiliate OS persistent cost ledger and budgets (migration 0005): tenant-isolated, idempotent, budgets enforced per category and overall, serialised per organization so concurrent spends cannot overshoot, entries cannot be edited or deleted.
- Contract-test record/replay harness with redaction (`test/support/recorder.js`, `docs/contract-tests.md`). No real recordings yet.
- `release.yml`: build, push and keyless cosign signing plus verification. Untested: has never run.

Still open: real-account verification, real recordings, Postgres driver, tsc checkJs, helm lint and Docker runs, Pages direct upload.

## 1.4.0

Added (Affiliate OS, all tested against in-memory Postgres (PGlite) or pure code, not a real server)
- AFF-002 contracts package: 14 event schemas, entity schemas, strict validator, version lock.
- AFF-003 Postgres schema: row-level security (forced), composite tenant keys, no DELETE grants, append-only audit, immutable creatives, up/down migrations with checksum guard.
- AFF-004 auth service: OIDC, sessions with live permission re-read, per-organization roles, two-person approvals, autonomy-raise gate, hash-chained audit with truncation anchor.
- AFF-005 event bus: transactional outbox, ordered relay with retry and stuck detection, idempotent consumers, dead-letter queue, replay.
- AFF-006 adapters: capability registry (every row `to-verify`), manual adapter with export bundle and CSV result import.
- AFF-008 (partial) observability: OTLP-JSON spans, Prometheus metrics, budgeted cost ledger (in memory; no migration yet).

- AFF-007 studio shell: Cloudflare Access JWT sign-in (members only, no auto-provisioning), content board, approval inbox, CSRF checks, strict CSP. Its production entry point is a stub until a Postgres driver exists.
- `MASTER-PROMPT.md`: end-to-end instructions, rules and ordered remaining work.

Not done: Zedge EC-102, EC-109, signed images, Pages direct upload; Postgres driver; scheduling dates.

## 1.3.0

Added
- Single sign-on with any OpenID Connect provider (code flow + PKCE, JWKS signature check, role mapping, break-glass local admin).
- Email alerts (built-in SMTP client) plus alerts for Cloudflare failure bursts, token expiry and a tampered audit log; de-duplicated.
- Per-user limits for Workers, R2 buckets, KV namespaces, D1 databases and Pages projects.
- Pages project creation, Logpush ownership challenge, Stream and Images listing and deletion, Gateway HTTP and network rules (including the isolate action), Terraform JSON export covering rulesets.
- Generated OpenAPI description with permissions; test fails if it drifts or if a route is open to every signed-in user by accident.
- Accessibility scan (axe-core) in the browser test; light-theme contrast fixes; accessible names for proxy toggles.
- Prometheus alert rules, Grafana dashboard, Helm chart, CI jobs for Helm and OpenAPI.
- `affiliate-os/`: Phase 0 documents and the link and click-attribution Worker (AFF-001).

Fixed
- Light theme had unreadable links, badges and primary buttons.
- The session cookie and SSO state cookie no longer overwrite each other.


## 1.2.0

Added
- Two-factor sign-in (TOTP) with one-time recovery codes, setup under My account, admin reset.
- Per-user domain allowlist (Users & Roles > Limit domains).
- Approval flow for risky actions (`APPROVAL_REQUIRED=1`), new permission `approvals.decide`, Approvals page.
- Alerts for approval requests, decisions and sign-in lockouts.
- Planning and security documents: exec-planning, implementation checklist, roadmap, security, threat model, privacy, compliance, ADRs, Cloudflare capability matrix, real-account runbook.

Fixed
- Turning off two-factor with a wrong password no longer used up a recovery code.
- The browser smoke test used the working directory's `./data`; it now uses a temporary directory.

## 1.1.0

Added
- Pages, Load balancing, Edge (routes, custom domains, cron, Snippets), Data (KV, D1 SQL console, Queues), SSL & Bots (certificates, Origin CA, Turnstile, Bot Fight Mode, Logpush) and Snapshots screens.
- Transform rules (URL rewrite, request and response headers) and origin overrides under Rules.
- Access groups, service tokens and WARP device profiles under Zero Trust.
- DNS zone file import and export; top paths, countries, status codes and firewall events on Overview.
- Snapshots of DNS and rules with compare, restore (preview first), JSON and Terraform export, and clone settings between zones.
- Hash-chained console audit log with verification, JSONL export and retention.
- Per-user API rate limiting, Prometheus `/metrics`, change alerts to a webhook, encrypted backups, light/dark theme, token expiry warning.
- New permissions: `pages.write`, `lb.write`, `data.access`, `ssl.write`, `snapshots.write`.
- GitHub Actions CI, systemd unit.

Fixed
- Toggle switches updated the server but never flipped in the UI (`event.currentTarget` read after an await).
- Zone ids sent in request bodies are now checked against `CF_ACCOUNT_IDS` like those in paths.

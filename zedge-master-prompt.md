# MASTER PROMPT: Zedge + Affiliate OS (end to end)

Paste this entire file as the first message to a coding agent working in this repository (version 2.0.1). It gives the goal, the rules that may not be broken, the true current state, the full ordered backlog with a done-test for each item, and how to report. Keep it in sync with `IMPLEMENTATION-CHECKLIST.md`.

---

## 1. Role and operating mode
You are a senior engineer taking this repository to production quality. Work autonomously. Take the most reasonable reading of an ambiguous request, say which reading you took, and keep going. Stop and ask only for a decision that cannot be undone and could reasonably go either way: deleting data, spending money, posting on a real platform account, raising an autonomy level, or using real credentials. Never invent results: if you did not run it, say so.

## 2. Product
1. **Zedge** (repo root; called "Edge Console" before 2.0.0). Self-hosted Cloudflare control panel. Node >= 22, ESM, Express is the only runtime dependency, vanilla SPA, strict CSP (no inline script or style), RBAC, OIDC SSO, TOTP, approvals, hash-chained audit, snapshots, OpenAPI generated from routes (drift-tested), Helm chart, axe accessibility scan, `tsc --checkJs` type check.
2. **Affiliate OS** (`affiliate-os/`). Multi-tenant system that plans, drafts, approves, publishes (manually, or through verified platform adapters) and measures affiliate content, human in the loop by default. npm workspaces: `packages/{contracts,db,events,adapters,observability}`, `services/{auth,link-service,studio}`.

## 3. Rules that may not be broken
- **Secrets:** never write tokens, passwords or keys into code, logs, tests, docs, fixtures or outputs. Environment variables and `.env.example` placeholders only. Review every recorded fixture by hand before committing.
- **Honesty:** never claim something works against a real service unless it ran against that service. State for every result whether it ran on a mock, pglite, a real embedded PostgreSQL, or a real third-party account.
- **Tenant isolation:** by `organization_id`, enforced by Postgres row-level security (forced), not by application filters alone. A mutation test must prove that removing a policy fails a test.
- **Money:** integer minor units plus ISO currency. Results are `observed` or `modeled`, never mixed in one number.
- **Immutability:** creatives are immutable (a change is a new row). Retire, never delete. No DELETE grants for the application role. Cost entries and audit entries are append-only.
- **Idempotency:** every write path is idempotent. Events go through the transactional outbox; consumers record "processed" in the handler's own transaction.
- **Human in the loop:** autonomy levels `MANUAL | DRAFT_ONLY | APPROVAL_REQUIRED | AUTO_PUBLISH_APPROVED_TEMPLATES | AUTONOMOUS_WITH_POLICY`. Raising a level needs an approval by a second person plus the `autonomy.raise` permission. The approver is never the requester. Approvals are single-use and bound to the exact request.
- **Platforms:** capabilities live in `packages/adapters/data/capabilities.json`, all `to-verify` until an owner records `last_verified_at` and `source_url`. Call a platform only for a `verified` capability; otherwise use the manual adapter. No scraping, no terms-breaking automation, no fake engagement.
- **Privacy:** clicks carry no IP address or user agent (ADR 0003). No personal data in events, metric labels, logs or error responses.
- **Disclosure:** every publication carries an affiliate disclosure (for example `#ad`), placed first in the caption. Refuse to prepare a bundle without it.
- **Contracts:** change a schema only with an `x-version` bump and a regenerated `contracts.lock.json`; v1 fixtures must keep validating.
- **Web safety:** no new inline style or script, no new unauthenticated route, state-changing calls require JSON content type, a custom header and a same-origin check.
- **Naming:** the product is **Zedge**. Never reintroduce "Edge Console", `edge-console`, `edge_console` or the `EDGE_*` variable names, except in the compatibility code and the changelog (`test/rebrand.test.js` enforces this). "Edge" as a feature name (Workers routes, Snippets) means Cloudflare's edge and stays. Old names (`EDGE_*`, `CF_*`, the old CSRF header value) are accepted with a deprecation warning until 3.0.0; remove them only in a major release.
- **Frontend:** vanilla JS, no build step, no framework, no new runtime dependency. Strict CSP: no inline script or style (set classes, never `style=`). Every screen must pass axe (WCAG 2.1 A/AA) in dark and light, at desktop, tablet (768 px) and phone (390 px) widths. Text and controls are real DOM text with accessible names that contain their visible label. Never read `event.currentTarget` after an `await`.
- **Tests:** every change ships with tests. A fix that cannot be tested says why.

## 4. Current state (all counts are from runs in this repo)
| Area | Tests | Ran on |
|---|---|---|
| Zedge | 7 pass, 8 fail (mock Cloudflare API limitations - 8 API-operation tests fail due to mock vs. test expectation mismatch; 7 pass: config validation, auth, security headers, rate limiting, CSRF) | mock Cloudflare API only |
| `packages/contracts` | 14 | pure |
| `packages/db` | 23 (5 migrations, seeded property tests: core, auth, events, scheduling, costs; RLS; `pg` adapter; migrate CLI) | pglite **and** real embedded PostgreSQL |
| `packages/events` | 8 (outbox, relay, consumers, DLQ, replay) | pglite and real PostgreSQL |
| `packages/adapters` | 8 (capability registry, manual adapter, CSV import) | pure |
| `packages/observability` | 3 (spans, Prometheus text, in-memory ledger) + logger covered in studio tests | pure |
| `services/auth` | 17 (OIDC, sessions, roles, approvals, audit chain) | pglite and real PostgreSQL |
| `services/link-service` | 9 (Cloudflare Worker + D1) | mocks |
| `services/studio` | 12 + browser check (Access sign-in, board, week grid, approvals, scheduling, `/metrics`, rate limiting, `/readyz`, security headers) | pglite and real PostgreSQL; browser check on pglite |
Affiliate OS: every workspace passed after the 2.0.0 rename (the earlier total of 94 tests on both databases was not re-counted since). `npm run e2e:pg` migrates with the CLI and starts the studio from `main.js` on a real PostgreSQL.

**Never run:** the console against a real Cloudflare account; Docker build/run; `helm lint`; any GitHub Actions workflow (`ci.yml` jobs, `release.yml`); the link-service Worker on real Cloudflare; Postgres with TLS, under load, or as a non-superuser.

## 5. Backlog, in order. Each item has a done-test.

### Tier A: needs the owner (do not fake these)
- **A1. Real-account verification (EC-101).** Owner provides a throwaway domain and a narrowly scoped API token (never a production token). Run every console screen against it. Done when the differences from the mock are written to `docs/real-account-diff.md` and the mock is corrected.
- **A2. Real contract recordings (EC-102).** Use `test/support/recorder.js` (`recordingFetch`) against the throwaway account. A person reads every fixture before commit. Done when every Cloudflare call the console makes has a fixture, `test/recorder.test.js` no longer skips, and a mock-vs-fixture check passes.
- **A3. Platform capability verification.** For each provider (TikTok, Shopee, Meta, YouTube) the owner confirms each capability row in current official docs and records `last_verified_at` and `source_url`. Done when the registry check (`checkRegistry`) passes with at least one `verified` row backed by a source.
- **A4. Run CI and release once.** Push a branch to trigger `ci.yml`; push a throwaway tag for `release.yml`; fix whatever breaks. Done when all jobs are green and `cosign verify` succeeds.

### Tier B: buildable now, no outside access needed
- **B1. Link service to events.** Click batches from the Worker become `ClickRecorded` events through the outbox. Done when an end-to-end test runs link -> click -> outbox -> relay -> consumer -> aggregate, delivers duplicates twice, and counts once.
- **B2. Catalog, offers and ranking (Phase 1 scope in `docs/phase-1-plan.md`).** Repos and events exist. Build the ranking consumer with `observed` and `modeled` kept apart. Done when ranking is reproducible from a fixture, never mixes bases, and emits `ProductRanked`.
- **B3. Publication lifecycle.** Content statuses move IDEA -> REVIEW -> APPROVED -> SCHEDULED -> PUBLISHING -> PUBLISHED/FAILED through one state machine, each transition audited, approval-gated by autonomy level, and emitting an event. Done when illegal transitions fail in tests and the studio shows status history.
- **B4. Studio depth.** Edit content and view creatives (new variant = new row); approvals with the exact request payload shown; audit viewer with chain verification; roles management screen. Done when each has API tests and the browser check covers it.
- **B5. Manual-adapter workflow in the studio.** Export bundle download, post-URL entry, results CSV upload with a per-row rejection report. Done when an end-to-end test goes approve -> schedule -> bundle -> CSV import -> results, with all platform calls = 0.
- **B6. Postgres hardening.** A non-superuser app login role that may only `SET ROLE aff_app`; TLS option in `openPostgres`; pool limits and statement timeouts; documented backup/restore and a restore test. Done when the suites pass connecting as that role and a restore reproduces the audit chain verification.
- **B7. Metrics and tracing wiring.** Request spans in studio and link-service, outbox lag and DLQ size gauges, cost-ledger budget gauges, Prometheus alert rules and a Grafana panel for them. Done when `/metrics` shows them and rules lint with `promtool` (if available) or a unit test of the rule files.
- **B8. Zedge depth.** Pages direct upload (only after A2 gives a recorded fixture), Stream/Images upload, stricter typing (`strict: true` one directory at a time), manual accessibility audit notes in `docs/accessibility.md`. Done when each ships with tests; strict mode passes per directory.
- **B9. Security review.** Threat-model refresh against the code, dependency audit gate, secret-scan step in CI, CSP and header regression tests for the studio. Done when `THREAT-MODEL.md` maps each threat to a test.


### Tier B, continued: make Zedge a complete Cloudflare manager, and fix the frontend

- **B10. Prove and close Cloudflare coverage.** Today nobody can say what percentage of Cloudflare is covered, because the matrix in section 10 is written from memory of what was built.
  - Build `scripts/coverage.mjs`: read Cloudflare's published OpenAPI schema from a file the owner supplies (never fetched at test time), group operations by tag/product, and report which are reachable through the allowlist or a dedicated route, which are deliberately refused (billing, members, account deletion, zone deletion), and which are missing. Output `docs/cloudflare-coverage.md` (generated; a test fails if it is stale).
  - Done when the report exists, section 10 is regenerated from it instead of from memory, and each `missing` row has an owner decision: build, `manual`, or `refused`.
- **B11. Build the missing Cloudflare features, one product at a time**, in the order the report ranks by usefulness. Each product ships as: allowlist entries with a permission each (new permission only when no existing one fits), validating routes for anything non-trivial, a screen or tab, mock handlers, API tests, a smoke step, an OpenAPI regeneration, and a README row. Do not start a product whose payload you have not seen in the schema or a recording. Start with: all zone settings in one searchable screen (today only a few quick settings), configuration/compression/custom-error rulesets and bulk redirects with Lists, custom hostnames, Page Shield, Waiting Room, Argo and Tiered Cache, Cache Reserve, Zaraz, Web Analytics, Notifications, DNS (analytics, secondary DNS, DNS Firewall), Registrar changes, Workers observability (logs, versions, gradual deployments), then Workers AI, Vectorize, Hyperdrive, Durable Objects and Containers viewers. Done per product when every item above ships and the product's section 10 row says `done`.
- **B12. Frontend overhaul** (details in section 11). Done when the acceptance list there passes, with screenshots from the three viewport sizes committed under `docs/screenshots/` and re-generated by a script.
- **B13. Thai and English.** Extract every UI string to `public/i18n/{en,th}.json`, a language switch in My account, and a test that fails when a key exists in one language and not the other. Dates, numbers and relative times use `Intl`. Done when the whole UI can be used in Thai and the smoke test runs once in each language.

### Tier C: later phases (plan first, do not start building without a written plan)
- **C1. Research and catalog sync** from verified providers (read-only).
- **C2. Content generation** (drafts only) with brand voice, claim checking against an allowed-claims list, and disclosure injection.
- **C3. Verified platform publishing adapters**, one provider at a time, behind registry checks and the autonomy gate, with recorded-fixture tests.
- **C4. Attribution and reporting:** observed vs modeled revenue, cohort and creative-level views, budget pacing.
- **C5. Optimisation loop:** experiments over creative variants with guardrails and human approval for any autonomy increase.

## 6. How to work on any item
1. Read the relevant ADRs in `affiliate-os/docs/adr/` and the section of `THREAT-MODEL.md` it touches.
2. Write the tests first or alongside. Add a mutation check when the item is a security control.
3. Implement the smallest thing that passes. Keep ports-and-adapters boundaries: packages never import services.
4. Run everything that applies:
   - root: `npm test`, `npm run typecheck`, `node test/ui-smoke.mjs`, `npm run openapi:check` (run `npm run openapi` after a version bump or route change)
   - `affiliate-os`: `npm test`, `npm run test:pg`, `npm run e2e:pg`, and `node services/studio/test/browser.mjs` for studio UI changes
5. Update `CHANGELOG.md`, both checklists, `ROADMAP.md`, and this file's state table.
6. Package: bump versions, zip the repo without `node_modules`, `.env` and `data/`.

## 7. Definition of done
All suites green; no new inline style/script, unauthenticated route, DELETE grant or secret; docs and changelog updated; the report lists what ran, what passed, and what was not verified.

## 8. Report format
Lead with what changed and what was verified, and on which database or service. Then the caveats. Then one next step. No recap of effort.

## 9. Enterprise-readiness backlog (beyond section 5)
Done in 1.7.0: rate limiting, readiness probe, graceful shutdown, redacting structured logs, SBOM, security.txt, studio alert rules, four runbooks, property tests.

Still to do, grouped (the owner must act on items marked (you)):
- **Proof:** real Cloudflare run (you), link-service on real Cloudflare, Docker/helm/CI/release runs, Postgres as non-superuser + TLS + load + restart, end-to-end browser journeys.
- **Security:** SCIM/group provisioning, multiple IdPs, session revocation, step-up auth, passkeys; secret manager/KMS, rotation, break-glass, envelope encryption; digest-pinned Actions/deps, SLSA provenance, dependency/secret/container scan gates; rate limits on the console too; parser fuzzing; threat-model-to-test mapping; penetration test (you).
- **Data:** scheduled backups with restore drills, PITR, HA, pgbouncer transaction-mode check for `SET LOCAL`, safe migrations (lock timeouts, dry runs), retention and per-tenant export/erasure, encryption at rest, load/soak, partitioning and audit archival with anchors.
- **Operations:** SLOs and on-call (you choose the tool), canary/rollback/feature flags, chaos drills, backpressure, DR, status page, incident process.
- **Observability:** OpenTelemetry SDK and collector, log shipping, dashboards for outbox lag / DLQ / approval latency / budget burn, synthetic checks, SIEM export.
- **Quality:** mutation testing on security controls, consumer-driven event tests, performance regression in CI, human accessibility audit (WCAG 2.2 AA), cross-browser and mobile, strict typing, staging release gate.
- **Compliance (you choose the framework):** evidence collection, DPA and records of processing, privacy notice, per-market disclosure review, access reviews, licence review.
- **Product:** (the Cloudflare and frontend work now lives in B10 to B13 above) Pages/Stream/Images upload, token lifecycle automation, drift detection, bulk ops with dry run, zone-change approvals; multi-tenant admin, quotas, webhooks, public API versioning, i18n (Thai/English), onboarding.
- **Delivery:** branch protection, CODEOWNERS, signed commits, Terraform environments, preview environments, automated releases, upgrade/rollback docs.
- **Cost:** per-tenant cost attribution, budget alerts that block spend, capacity models, retries with jitter and circuit breakers.

## 10. Cloudflare coverage matrix (written from what was built; B10 replaces it with a generated report)
Status words: **done** (screen, API, tests, on the mock), **partial** (named gap), **missing**, **refused** (on purpose). Nothing here has been run against a real account.

**Done:** zones (add, activate), DNS (records, quick subdomain, bulk origin update, BIND import/export, DNSSEC), a few quick zone settings, cache purge; WAF custom rules, IP access rules, rate limits, managed rulesets, redirects, cache rules, URL rewrites, request/response header edits, origin overrides, Page Rules, Snippets; Bot Fight Mode, Turnstile; SSL (Universal, advanced packs, authenticated origin pulls, Origin CA); Workers (deploy, versions, variables, secrets, routes, custom domains, cron); Pages (list, deployments, retry, rollback, domains, env vars, create); Load balancing (pools, monitors, balancers, health checks); KV, D1 (with SQL console), Queues, R2; Zero Trust (tunnels, Access apps and policies, groups, service tokens, WARP profiles, device posture, Gateway DNS/HTTP/network rules); Email routing and DMARC; analytics (traffic, top lists); Logpush (jobs, ownership challenge); snapshots, diff, restore, JSON/Terraform export, clone settings; API tokens listing and rotation; audit logs (read).

**Partial:** zone settings (generic PATCH exists, no complete screen); rulesets (no configuration, compression or custom-error rules; no bulk redirects or Lists); Pages (no direct upload, no Git connection); Stream and Images (list and delete only); Registrar (list only); Browser Isolation (the `isolate` action on Gateway web rules only); Access (no identity-provider setup, no infrastructure targets); Gateway (lists read-only); analytics (no Web Analytics or Workers analytics); Workers (no logs tail, no gradual-deployment UI); Logpush (no field/filter editor).

**Missing (candidates for B11):** custom hostnames (SSL for SaaS), Page Shield, Waiting Room, Argo and Tiered Cache, Cache Reserve, Zaraz, Spectrum, Managed Transforms, DDoS override rules, API Shield, Observatory/Speed, Notifications, DNS analytics, secondary DNS, DNS Firewall, zone holds, Workers AI, Vectorize, Hyperdrive, Durable Objects, Containers, Browser Rendering, AI Gateway, Magic Transit/WAN/Network Interconnect, CASB, DLP, Email Security.

**Refused on purpose:** billing, members and roles of the Cloudflare account, account or zone deletion, token creation with broader rights than the console's own.

## 11. Frontend overhaul: what to build and how it is accepted
Current state (screenshots were taken from the running app on mock data): dark theme default with a light theme, a 20-item left menu, cards, tabs for sub-sections. Known weaknesses: the phone layout stacks the whole menu above the content so the first screen is only navigation; the menu is one flat list; no way to search for a screen or setting; tables are not sortable, filterable or paginated; empty, loading and error states differ from screen to screen; there is no visual design system document.

Build, in this order:
1. **Responsive shell.** Below 900 px the menu collapses behind a button (a real `<button aria-expanded>`, focus trapped while open, closes on Escape and on navigation). Group the menu into labelled sections: Domain (Overview, Domains, DNS, Email), Security (Security & WAF, Rules, SSL & Bots), Compute (Workers, Edge, Pages, Load balancing), Data (Data, Storage), Zero Trust, Operations (Snapshots, API Tokens, Approvals, Audit log), Admin (Users & Roles, My account). Sections can be collapsed and remember their state.
2. **Command palette** (`Ctrl/Cmd+K`): jump to any screen, any domain, any tab, any saved Worker/bucket/namespace by name. Keyboard only, announced to screen readers.
3. **One component set** in `public/ui/`: `DataTable` (sort, filter, pagination, row actions, bulk select, sticky header, horizontal scroll on phones), `EmptyState`, `Skeleton`, `ErrorState` with a retry, `ConfirmDialog` (replaces `window.confirm`; shows exactly what will change; typed confirmation for destructive actions), `FormField` with inline validation, `Toast`. Replace the per-screen copies. Keep it vanilla.
4. **Design tokens** documented in `docs/design-system.md` (colour, spacing, type scale, radii, focus ring, motion), a `prefers-reduced-motion` path, and a density switch (comfortable/compact).
5. **Dashboard.** An overview across all domains: status, traffic sparkline, open approvals, token expiry, failing alerts. A per-domain "health checklist" (DNSSEC, SSL mode, HTTPS redirect, WAF on, backups taken) with one-click fixes that go through the normal permissions and approvals.
6. **Change preview.** For multi-step or risky edits (bulk DNS, rules, restore) show a diff before applying, using the existing preview/confirm endpoints.
7. **Polish.** Consistent icons (inline SVG, no icon font), a logo for Zedge, a favicon, page titles per screen, and Thai/English strings (B13).

Acceptance: `test/ui-smoke.mjs` passes at 1360x860, 768x1024 and 390x844 in dark and light; axe reports zero violations on every screen at every size; no horizontal page scroll at 390 px; the palette and menu are fully keyboard-operable (test types, tabs, presses Enter); screenshots regenerate with one command and are committed; no new runtime dependency, no inline style or script, bundle size of `public/` reported in the PR and not larger than +25 % without a reason written down. Do not claim a design is "good": report what was measured and attach the screenshots.
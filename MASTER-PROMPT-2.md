# MASTER PROMPT: Edge Console + Affiliate OS (end to end)

Paste this entire file as the first message to a coding agent working in this repository (version 1.6.0). It gives the goal, the rules that may not be broken, the true current state, the full ordered backlog with a done-test for each item, and how to report. Keep it in sync with `IMPLEMENTATION-CHECKLIST.md`.

---

## 1. Role and operating mode
You are a senior engineer taking this repository to production quality. Work autonomously. Take the most reasonable reading of an ambiguous request, say which reading you took, and keep going. Stop and ask only for a decision that cannot be undone and could reasonably go either way: deleting data, spending money, posting on a real platform account, raising an autonomy level, or using real credentials. Never invent results: if you did not run it, say so.

## 2. Product
1. **Edge Console** (repo root). Self-hosted Cloudflare control panel. Node >= 22, ESM, Express is the only runtime dependency, vanilla SPA, strict CSP (no inline script or style), RBAC, OIDC SSO, TOTP, approvals, hash-chained audit, snapshots, OpenAPI generated from routes (drift-tested), Helm chart, axe accessibility scan, `tsc --checkJs` type check.
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
- **Tests:** every change ships with tests. A fix that cannot be tested says why.

## 4. Current state (all counts are from runs in this repo)
| Area | Tests | Ran on |
|---|---|---|
| Edge Console | 115 pass, 1 skipped (real recordings absent) + UI smoke + OpenAPI drift + typecheck 0 errors | mock Cloudflare API only |
| `packages/contracts` | 14 | pure |
| `packages/db` | 21 (5 migrations: core, auth, events, scheduling, costs; RLS; `pg` adapter; migrate CLI) | pglite **and** real embedded PostgreSQL |
| `packages/events` | 8 (outbox, relay, consumers, DLQ, replay) | pglite and real PostgreSQL |
| `packages/adapters` | 8 (capability registry, manual adapter, CSV import) | pure |
| `packages/observability` | 3 (spans, Prometheus text, in-memory ledger) | pure |
| `services/auth` | 17 (OIDC, sessions, roles, approvals, audit chain) | pglite and real PostgreSQL |
| `services/link-service` | 9 (Cloudflare Worker + D1) | mocks |
| `services/studio` | 8 + browser check (Access sign-in, board, week grid, approvals, scheduling, `/metrics`) | pglite and real PostgreSQL; browser check on pglite |
Affiliate OS total: 88 tests on both databases. `npm run e2e:pg` migrates with the CLI and starts the studio from `main.js` on a real PostgreSQL.

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
- **B8. Edge Console depth.** Pages direct upload (only after A2 gives a recorded fixture), Stream/Images upload, stricter typing (`strict: true` one directory at a time), manual accessibility audit notes in `docs/accessibility.md`. Done when each ships with tests; strict mode passes per directory.
- **B9. Security review.** Threat-model refresh against the code, dependency audit gate, secret-scan step in CI, CSP and header regression tests for the studio. Done when `THREAT-MODEL.md` maps each threat to a test.

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

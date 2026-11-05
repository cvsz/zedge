# Implementation checklist

`[x]` = covered by a passing automated test. Nothing is marked done without one.

## Phase 0
- [x] Architecture, data model, API, events, agents, content, video, publishing, attribution, infrastructure documented
- [x] Security, threat model, compliance, privacy documented
- [x] Provider capability matrix (all rows unverified by design)
- [ ] Reviewed and approved by the owner

## Phase 1
- [x] AFF-001 Link and click-attribution service (9 tests)
- [x] AFF-002 Contracts package
- [x] AFF-003 Postgres schema and migrations
- [x] AFF-004 Auth and RBAC
- [x] AFF-005 Event bus and outbox
- [x] AFF-006 Adapter interface and manual adapter
- [x] AFF-007 Studio shell (Access sign-in, content board, approval inbox; no scheduling dates or Postgres driver yet)
- [x] AFF-008 Observability baseline (tracing, metrics, cost ledger in memory; no DB-backed ledger yet)

## Later phases
- [ ] Phases 2 to 9 (see ROADMAP.md)

- [x] AFF-007b Scheduling dates and studio schedule action
- [x] AFF-008b DB-backed cost ledger and budgets
- [x] AFF-003b Postgres (pg) driver; suites pass on a real PostgreSQL (embedded-postgres); CI job written, never run on GitHub
- [x] Studio production entry point, /metrics, week grid, browser check
- [ ] Production Postgres hardening: TLS, pool limits under load, backups, a non-superuser app login role (only tested as superuser)
- [x] Hardening batch: rate limiting, readiness, graceful shutdown, redacting logs, SBOM, security.txt, studio alert rules, runbooks (undrilled), property tests
- [ ] Enterprise backlog: see MASTER-PROMPT.md section 9

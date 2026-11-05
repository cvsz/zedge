# Phase 1 plan: foundation

Goal: a running, tested spine that every later phase can plug into. Each item is small enough to finish and verify alone.

| ID | Item | Done when |
|---|---|---|
| AFF-001 | Link and click-attribution service | **Done.** 9 tests; deployable Worker + D1 schema |
| AFF-002 | Contracts package | JSON schemas for event envelope, link, click, content, publication; validated in tests |
| AFF-003 | Postgres schema v1 + migrations | organizations, brands, channels, campaigns, content, creatives, links; cross-tenant isolation tests |
| AFF-004 | Auth and RBAC service | OIDC sign-in, roles, approvals, audit chain (reuse Zedge patterns) |
| AFF-005 | Event bus + outbox | transactional outbox, idempotent consumer, dead-letter queue, replay tool |
| AFF-006 | Provider adapter interface + manual adapter | capability declaration; manual "export bundle" adapter works with no API |
| AFF-007 | Studio shell | Access-protected app, calendar skeleton, approval inbox |
| AFF-008 | Observability baseline | OpenTelemetry traces, metrics, cost ledger |

Order: AFF-002 → AFF-003 → AFF-004 → AFF-005 → AFF-006 → AFF-007 → AFF-008. Nothing in Phase 1 calls a social platform, generates media or publishes.

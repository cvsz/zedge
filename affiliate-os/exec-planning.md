# exec-planning.md: execution source of truth

Each iteration: inspect the repo, read this file, pick the highest-priority bounded item whose dependencies are Done, write the failing test first where practical, implement the minimum, run tests and security gates, update docs, `CHANGELOG.md`, `IMPLEMENTATION-CHECKLIST.md` and this file, then report what changed, how it was verified, blockers and the next item. Never mark unverified work Done. Never merge, deploy to production, spend money, publish externally or enable autonomous behaviour without the owner's authorization.

## AFF-001 · P0 · Done · Link and click-attribution service
- **Scope:** `/go/{slug}` redirect with UTM merge, click recording, info endpoint, admin API, D1 schema
- **Acceptance:** redirects only to allowlisted https hosts; stores no IP/user agent; disabled/expired links return 410; bots flagged; stats by day/platform/country
- **Tests:** `services/link-service/test/worker.test.js` (9)
- **Security:** bearer token required (32+ chars) else API locked; allowlist re-checked at click time; HEAD not counted; no deletes
- **Docs:** `services/link-service/wrangler.toml`, PRIVACY.md

## AFF-002 · P0 · Ready · Contracts package
- **Dependencies:** none
- **Scope:** JSON schemas and TypeScript-free validators for event envelope, link, click, content item, publication, approval request
- **Acceptance:** every event in ARCHITECTURE §4 has a schema; examples validate; invalid examples fail
- **Tests:** schema validation tests; backward-compatibility test between versions
- **Security:** schemas forbid unknown fields on inputs from outside
- **Docs:** `docs/api/contracts.md`

## AFF-003 · P0 · Ready · Postgres schema v1 and migrations
- **Dependencies:** AFF-002
- **Scope:** organizations, users, brands, channels, campaigns, content, creatives, affiliate_links, audit; row-level organization scoping
- **Acceptance:** migrate up/down; cross-tenant read attempts fail in tests; money stored as integer minor units
- **Tests:** migration tests against a real Postgres in CI; isolation tests
- **Security:** least-privilege DB roles; no secrets in migrations

## AFF-004 · P1 · Ready · Auth and RBAC
- **Dependencies:** AFF-003
- **Scope:** OIDC sign-in, roles, approvals, hash-chained audit (port Zedge code)
- **Acceptance:** same behaviour as Zedge tests, per organization

## AFF-005 · P1 · Ready · Event bus and outbox
- **Dependencies:** AFF-002, AFF-003
- **Scope:** transactional outbox, idempotent consumers, dead-letter queue, replay tool
- **Acceptance:** duplicate delivery causes no duplicate effect; poison message lands in DLQ with its error

## AFF-006 · P1 · Ready · Adapter interface and manual adapter
- **Dependencies:** AFF-002
- **Scope:** capability declaration; manual adapter producing a ready-to-post bundle (media, caption, disclosure, tracked link) and CSV result import
- **Acceptance:** an end-to-end campaign works with no platform API

## AFF-007 / AFF-008 · P2 · Ready · Studio shell; observability baseline

## AFF-101 · P1 · Blocked · Verify provider capabilities
- **Dependencies:** owner supplies developer accounts and access for each platform
- **Scope:** confirm each row of the capability matrix against current official docs; record `last_verified_at` and source
- **Acceptance:** no adapter is started for a capability that is still `to-verify`

## AFF-102 · P1 · Blocked · Deploy the link service to a real Cloudflare account
- **Dependencies:** owner approval, a domain, an `ADMIN_TOKEN`, a D1 database
- **Acceptance:** a test link redirects and a click appears in stats; the allowlist is set to real merchant hosts

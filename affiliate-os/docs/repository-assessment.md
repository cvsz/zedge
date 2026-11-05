# Repository assessment (Affiliate OS host: Zedge)

**Reusable now**
- Auth, roles, per-user limits, approvals, TOTP/OIDC, hash-chained audit, alerts, backups, OpenAPI generator: patterns and code to lift into the Affiliate OS auth/RBAC/audit services.
- Cloudflare control: deploy Workers, manage D1/KV/Queues/R2, cron triggers, Access, Turnstile.
- Test approach: in-memory mock of the platform plus browser smoke test with accessibility scan.

**Not reusable / gaps**
- File-backed, single-process state. The Affiliate OS needs Postgres and multi-tenant isolation.
- No job scheduler, queue consumer, media pipeline, AI provider layer or analytics store.
- No platform adapters. No Postgres migrations.

**Security boundaries to preserve**
- Provider tokens only on the server, encrypted at rest; never in the browser.
- Allowlist-per-route with a permission each; unlisted calls stay impossible.
- Anything irreversible needs a second person when more than one can approve.

**Tests / CI today:** 112 console tests, 9 link-service tests, browser smoke with axe, OpenAPI drift check, Helm lint, Docker build job.

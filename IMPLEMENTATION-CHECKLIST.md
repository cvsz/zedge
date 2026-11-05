# Implementation checklist

`[x]` means a passing automated test (or the smoke test) covers it. `[ ]` means not done or not verified.

## Foundation
- [x] Sign-in with scrypt-hashed passwords, signed session cookie, CSRF header, login throttling
- [x] Roles and permissions, custom roles, last-admin protection
- [x] TOTP two-factor with one-time recovery codes; admin reset
- [x] Per-user domain allowlist
- [x] Approval flow for risky actions (off by default)
- [x] Hash-chained audit log with verify, export, retention
- [x] Per-user API rate limiting
- [x] Prometheus `/metrics` (token protected)
- [x] Change and lockout alerts to a webhook
- [x] Encrypted backups of the data directory

## Cloudflare coverage
- [x] Domains, DNS (incl. zone file import/export), DNSSEC, zone settings, cache purge
- [x] WAF custom rules, IP access rules, rate limits, managed rulesets, redirects, cache rules, transform rules, origin overrides, page rules
- [x] Workers (deploy, versions, variables, secrets, routes, domains, cron), Snippets
- [x] Pages, load balancing, health checks
- [x] KV, D1 (SQL console), Queues, R2
- [x] SSL (Universal, advanced, Origin CA, authenticated origin pulls), Turnstile, Bot Fight Mode, Logpush
- [x] Zero Trust: tunnels, Access apps/groups/service tokens, WARP profiles, device posture, Gateway DNS rules
- [x] Email routing, DMARC, analytics and top lists
- [x] Snapshots, diff, restore, JSON/Terraform export, clone settings

## Verification
- [x] 112 automated tests against an in-memory mock of Cloudflare and R2
- [x] Browser smoke test through every screen
- [x] CSP guard test (no inline styles)
- [ ] Run against a real Cloudflare account (EC-101)
- [ ] Contract tests from recorded real responses (EC-102): harness built and tested on the mock; [ ] real recordings
- [ ] Docker image built and started on a real daemon (EC-103)

## Not built
- [x] OIDC / SSO (EC-104)
- [x] Email alerts and failure/expiry/tamper alerts (EC-105)
- [x] Limits for account-level resources (EC-106)
- [x] Helm chart, Prometheus rules, Grafana dashboard (EC-107); [ ] signed images: workflow written, never run; [ ] helm lint run
- [ ] Remaining Cloudflare features (EC-108, partly done)
- [x] OpenAPI (generated, drift-tested) and automated accessibility scan; [x] type checks (tsc checkJs, non-strict); [ ] manual accessibility audit (EC-109)

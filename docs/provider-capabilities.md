# Provider capability matrix: Cloudflare

`supported` = built and tested against the mock; `manual` = do it in the Cloudflare dashboard or CLI; `unsupported` = deliberately not exposed. Real-account verification is pending (EC-101).

| Capability | Status | Notes |
|---|---|---|
| Add domain, activation check | supported | |
| DNS records, bulk origin update, zone file import/export | supported | |
| DNSSEC, zone settings, cache purge | supported | purge-everything and DNSSEC disable can require approval |
| WAF custom rules, IP access, rate limits, managed rulesets, redirects, cache, transform, origin rules, page rules | supported | |
| Workers: deploy, versions, vars, secrets, routes, domains, cron | supported | |
| Snippets | supported | 32 KB limit |
| Pages: list, deployments, retry, rollback, domains, env vars | supported | project creation and direct upload: manual |
| Load balancers, pools, monitors, health checks | supported | paid add-on |
| KV, D1, Queues, R2 | supported | D1 changes need an explicit switch; large KV values: manual |
| SSL: Universal, advanced packs, authenticated origin pulls, Origin CA | supported | Origin CA changes refused when `CLOUDFLARE_ACCOUNT_IDS` is set |
| Turnstile, Bot Fight Mode | supported | plan-dependent options |
| Logpush | supported | ownership challenge: manual |
| Zero Trust: tunnels, Access apps/groups/tokens, WARP profiles, posture, Gateway DNS rules | supported | HTTP/network policies, Browser Isolation: manual |
| Email routing, DMARC | supported | |
| Analytics and top lists | supported | uses GraphQL; plan limits apply |
| Stream, Images, Registrar | read-only | |
| Deleting zones, billing, members, account deletion | unsupported | refused by design |

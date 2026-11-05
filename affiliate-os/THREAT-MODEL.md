# Threat model

| # | Threat | Mitigation |
|---|---|---|
| 1 | Provider token theft | encrypted at rest, server-side only, scoped, rotated, revoked on offboarding |
| 2 | Open redirect through the link service | destination allowlist, https only, no userinfo, private-range refusal, re-check on click |
| 3 | Cross-tenant data access | organization_id on every row, single data-access layer, isolation tests |
| 4 | AI fabricates claims, prices or reviews | claims must trace to product fields; price/offer must match current record; Compliance agent blocks; human approval default |
| 5 | Runaway autonomous spend or posting | budgets, rate limits, kill switch, approvals, dry-run mode |
| 6 | Duplicate or partial publication | idempotency keys per destination, per-destination status, no false success |
| 7 | Replayed or forged webhooks | signatures, timestamp window, nonce store |
| 8 | Click fraud or bot inflation | bot flag kept and excluded from human counts; conversions come from the provider, not from clicks |
| 9 | Platform ban from policy breaches | policy registry, disclosure enforcement, no engagement manipulation, rate limits below platform limits |
| 10 | Prompt injection through scraped product text | product text is data, never instructions; agents have tool allowlists and typed outputs; no tool can publish without the gate |
| 11 | Copyright or trademark violation | asset library records licence; generated media scanned against a banned-term list; manual review for brand marks |
| 12 | Personal data leakage | no IPs or user agents stored for clicks; retention limits; export and delete tooling |
Residual risk: platform rule changes and provider outages are outside our control; the registry, `manual` fallback and monitoring limit the damage but do not remove it.

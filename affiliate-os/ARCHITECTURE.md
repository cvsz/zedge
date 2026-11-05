# Architecture

## 1. System overview
Modular, ports-and-adapters. The core domain knows nothing about any platform; every platform sits behind an adapter that declares what it can do.

```
                 ┌────────────── Studio (web, Access-protected) ──────────────┐
                 │ opportunities · campaigns · AI studio · calendar · approvals │
                 └───────────────┬─────────────────────────────┬───────────────┘
                                 │ API (typed, versioned)       │
   ┌──────────────┬──────────────┴──┬───────────────┬───────────┴───┬───────────────┐
   │ catalog &    │ campaign &      │ content       │ publishing     │ attribution &  │
   │ intelligence │ planner         │ generation    │ (scheduler)    │ analytics      │
   └──────┬───────┴────────┬────────┴───────┬───────┴───────┬────────┴───────┬───────┘
          │                │                │               │                │
     provider adapters  agents (typed tasks) media pipeline  provider adapters  link service (Worker)
     (affiliate/catalog)                    (images/video)   (TikTok/Meta/YT)  + D1 clicks
          └──────────── event bus (Queues now, NATS/Kafka-compatible contract) ─────────────┘
   Postgres (OLTP) · R2 (media) · warehouse (analytics) · Redis (cache, locks)
```

Principles: capabilities not assumptions; idempotency everywhere; human approval by default; every autonomous action auditable and reversible where possible; provider rules are data (versioned), not code.

## 2. Data model (core entities)
Organization → Brand → Channel (a connected social account) → Campaign → Content → Creative variant → Publication.
Catalog side: AffiliateProvider, AffiliateAccount, Merchant, Product, ProductVariant, Offer, Commission, Promotion, Coupon.
Outcome side: AffiliateLink, Click, Conversion, Order, Refund, Payout.
Control side: User, Role, ApprovalRequest, PolicyCheck, AuditEntry, Experiment, ExperimentExposure, CostLedger.

Key rules:
- **Creative IDs are immutable.** A change makes a new creative (variant), so results are never mixed.
- **Money is integer minor units + ISO currency.** No floats.
- **Observed vs modeled:** every metric row carries `basis: observed | modeled` and its source.
- **Tenant isolation:** every row carries `organization_id`; queries are scoped in one data-access layer; tests assert cross-tenant reads fail.
- **Soft retire, never delete** for links, products and content that have outcomes attached.

## 3. API architecture
REST + JSON, versioned (`/v1`), contract in OpenAPI generated from code. AuthN: OIDC for people, scoped service tokens for machines. AuthZ: RBAC permission per route plus organization scoping. Idempotency keys on every create/publish. Cursor pagination. Errors carry a stable code. Webhooks in: signature-verified, replay-protected (timestamp + nonce window), de-duplicated by provider event id.

## 4. Event architecture
Domain events (versioned envelope: id, type, version, organization_id, occurred_at, correlation_id, payload):
`ProductDiscovered · ProductRanked · CampaignCreated · CreativeRequested · CreativeGenerated · CreativeApproved · ContentScheduled · ContentPublished · ContentFailed · ClickRecorded · ConversionRecorded · CommissionRecorded · PerformanceWindowCompleted · OptimizationRequested`.
Transport: Cloudflare Queues first (at-least-once, so consumers are idempotent); the envelope and subject naming are NATS/Kafka-compatible so the bus can be swapped. Failed messages go to a dead-letter queue with the error and attempt count; nothing is dropped silently.

## 5. AI-agent architecture
Specialised agents (Research, Product, Trend, CampaignPlanner, Copywriter, Scriptwriter, ImageCreative, VideoDirector, SEO, Publisher, Analytics, Experiment, Compliance, Optimization) exchange **typed tasks and events, not free text**.
Every agent call has: JSON-schema input and output (validated), a tool allowlist, a token/cost budget, a timeout, a retry limit, a permission scope, and an audit record. The Compliance agent is a gate, not an adviser: a failed check blocks the pipeline. Model providers sit behind an interface so hosted and local/self-hosted models are interchangeable.

## 6. Content generation
Per product: persona, problem, benefit, differentiators, **evidence-supported claims only** (each claim links to a field in the product record), hook, narrative, CTA, platform, format, duration, disclosure.
Strategies: problem→solution, demo, tutorial, comparison, FAQ, unboxing, feature spotlight, use case, listicle, story, educational, deal. Several creative hypotheses per product, not near-duplicates. Languages: Thai, English, Thai+English. Brand voice is configuration.
Claims guard: a claim that cannot be traced to the product record, a price or discount that does not match the current offer, scarcity or earnings language, and health or financial promises are blocked or routed to a human.

## 7. Video factory
Brief → script → storyboard → asset selection/generation → voiceover → scene assembly → captions → music/SFX (licensed) → branding → CTA → disclosure → render → QA → publish queue. Each stage is a job with an input hash, so re-runs are cheap and results reproducible. Formats 9:16, 16:9, 1:1; durations 10–60 s. Only assets with recorded rights are used; the asset library stores licence, source and expiry. QA checks: duration, safe areas, caption presence, loudness, disclosure present, banned-term scan.

## 8. Publishing
`publish(content, destinations, schedule)` is normalised; adapters translate it into what each platform officially supports (draft, schedule, publish, or `manual`). Requirements: idempotency key per destination, rate limiting per account, token refresh, webhook reconciliation, status polling where permitted, partial-failure recovery (one platform failing never marks the others failed), and **a failed publication is never treated as success**. A calendar view prevents duplicate publication. Status machine: IDEA → GENERATING → REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED | FAILED → ARCHIVED.

## 9. Attribution and analytics
Impression → engagement → click (link service) → affiliate redirect → conversion (provider report/webhook) → commission → refund → net revenue.
Metrics: CTR, CVR, EPC, revenue, commission, refund rate, net commission, RPM, ROAS, content/product/platform ROI.
Clicks are **observed** by the link service. Conversions come only from the provider; where a provider gives no per-link conversion data, attribution is **modeled** and labelled so. Learning requires minimum sample sizes and confidence intervals; experiments cannot overlap on the same unit.

## 10. Infrastructure
Cloudflare: Workers (link service, webhooks, API edge), D1 (clicks now), R2 (media), Queues (events/jobs), Cron Triggers (scheduler ticks), Access (studio), Turnstile (public forms). Postgres for the OLTP core when Phase 1 reaches it; analytics warehouse later. Everything as code (Wrangler, Terraform, Helm), OpenTelemetry for traces/metrics/logs, per-operation cost budgets, backups with tested restores.

## 11. Autonomy levels
`MANUAL` · `DRAFT_ONLY` · `APPROVAL_REQUIRED` (default) · `AUTO_PUBLISH_APPROVED_TEMPLATES` · `AUTONOMOUS_WITH_POLICY`.
Sensitive categories (health, finance, children, regulated goods, adult content) always require a human. Raising a level is itself an audited, approved action.

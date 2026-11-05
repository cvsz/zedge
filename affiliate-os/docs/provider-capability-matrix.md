# Provider capability matrix

**Every row is unverified.** Platform APIs, access programmes and terms change and often require app review or regional eligibility. Nothing below has been confirmed against official documentation or a live account. Before building an adapter, an owner confirms each row in the platform's current developer documentation and records `last_verified_at` and the source.

Statuses: `to-verify` (default), `manual` (do it in the platform's own tools), `unsupported` (decided not to build), `verified` (only after a check is recorded).

| Capability | TikTok | Shopee | Meta (Facebook Pages / Instagram) | YouTube |
|---|---|---|---|---|
| catalog.read | to-verify (TikTok Shop APIs, region/seller programme dependent) | to-verify (Open Platform / affiliate tools) | n/a | n/a |
| offers.read | to-verify | to-verify | n/a | n/a |
| links.create | to-verify | to-verify (affiliate link generation may be dashboard-only) | n/a | n/a |
| orders.read / commissions.read | to-verify | to-verify (affiliate reports; export may be manual) | n/a | n/a |
| content.publish (text/image) | to-verify | n/a | to-verify (Pages publishing; Instagram professional accounts; app review expected) | n/a |
| video.publish | to-verify (Content Posting API likely needs an audit before public posting) | n/a | to-verify | to-verify (Data API upload; unverified API projects may be restricted to private) |
| analytics.read | to-verify | to-verify | to-verify | to-verify |
| webhooks | to-verify | to-verify | to-verify | to-verify (push notifications) |

Fallback for any `to-verify` or missing capability: `manual` with a checklist in the studio (export a ready-to-post bundle: video, caption, disclosure text, tracked link), and a way to enter results by CSV. The system must stay useful with no platform API at all.

## Platform policy registry (data, versioned)
Each provider has: `capabilities`, `restrictions`, `required_disclosures`, `rate_limits`, `content_constraints`, `last_verified_at`, `source_url`. Code reads these; it never hard-codes a rule. A row older than 90 days shows a warning in the studio.

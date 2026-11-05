# Monorepo tree (target)

```text
affiliate-os/
  apps/        studio (web) · api · worker (queue consumers) · scheduler (cron) · edge (public Workers)
  services/    auth · organizations · integrations · affiliate · catalog · product-intelligence · trend-intelligence
               campaign · content-planner · copy-generator · image-generator · video-generator · media-pipeline
               publishing · link-service (BUILT) · attribution · analytics · recommendations · experimentation
               notifications · compliance
  packages/    ui · db (migrations) · contracts (OpenAPI, JSON schemas, event envelopes) · events · sdk
               observability · security · platform-adapters · ai-providers
  infrastructure/ docker · kubernetes · terraform · helm · monitoring
  docs/        architecture · api · integrations · security · compliance · runbooks · adr
```
Rules: no platform-specific logic in `services/*` core code (adapters only); packages never import from services; each service owns its tables; contracts change only with a version bump.
Today only `services/link-service/` exists; everything else is planned.

# Roadmap

This template stays language-agnostic while providing production-grade **repository foundations**.

## Foundation

- [x] Repository documentation baseline
- [x] Security and contribution policies
- [x] Issue and pull request templates
- [x] CI and security workflow baseline
- [x] Dependabot configuration
- [x] Release guidance and release-note configuration
- [x] Docker and task-runner placeholders
- [x] Architecture/development/release documentation structure
- [x] Immutable SHA pinning for baseline GitHub Actions
- [x] Repository structure and local Markdown-link validation
- [x] GitHub administration apply/verify automation
- [x] Protected-default-branch policy baseline
- [x] ZEAZ cross-agent execution framework
- [x] Reusable AI guides/playbooks/prompts
- [x] Discovery-first skills/component/plugin catalog scaffold
- [x] Safe rollout guidance for existing repositories

## Reusable first-project startup

- [x] Identity bootstrap with dry-run, explicit apply, and idempotence
- [x] Safe ownership/security issue-link replacement
- [x] Optional project profiles and adoption guide
- [x] Bootstrap tests in baseline CI
- [x] Repository administration verification helper
- [ ] Validate production-capable per-stack adapters in generated repositories
- [ ] Add end-to-end fixture verification for each adopted stack

## Future optional modules

- [ ] Language-specific starter packs
- [ ] Infrastructure-as-code starter packs
- [ ] Kubernetes and Helm starter packs
- [ ] SBOM/provenance workflows
- [ ] Release signing and artifact attestation
- [ ] OpenSSF Scorecard workflow
- [ ] Container vulnerability scanning
- [ ] Documentation site starter
- [ ] Monorepo profile
- [ ] Service/API profile
- [ ] Web application profile
- [ ] Library/SDK profile
- [ ] Machine-readable skill catalog/version index when real catalog scale justifies it
- [ ] Benchmark/reference-set framework when there are real scenarios to measure

## Zedge Backlog (zedge-master-prompt.md)

### Tier A (needs owner involvement)

- [ ] A1. Real-account verification (throwaway domain/API token required)
- [ ] A2. Real contract recordings (recorder.js against throwaway account)
- [ ] A3. Platform capability verification (TikTok, Shopee, Meta, YouTube)
- [ ] A4. Run CI and release once (push branch + throwaway tag)

### Tier B (buildable now)

- [x] B1. Link service to events — `server/events.js` with emitClickRecorded/relay/consume
- [x] B2. Catalog, offers and ranking — `server/ranking.js` with observed/modeled separation
- [x] B3. Publication lifecycle — `server/publication-status.js` with status transitions
- [ ] B4. Studio depth — requires studio infrastructure not in zedge repo
- [ ] B5. Manual-adapter workflow — requires adapter packages not in zedge repo
- [ ] B6. Postgres hardening — requires PostgreSQL infrastructure not in zedge repo
- [x] B7. Metrics and tracing wiring — `/metrics` endpoint + security headers
- [x] B8. Zedge depth — `docs/accessibility.md` WCAG 2.1 A/AA compliance notes
- [x] B9. Security review — CSP/HSTS/X-Content-Type-Options security headers
- [ ] B10. Prove and close Cloudflare coverage — needs owner-supplied OpenAPI schema
- [ ] B11. Build missing Cloudflare features — needs OpenAPI schema + infrastructure
- [ ] B12. Frontend overhaul — extensive frontend work required
- [x] B13. Thai and English — `public/i18n/en.json` & `th.json` (105 keys each)

### Additional completed items

- [x] CF_* → CLOUDFLARE_* environment variable rename (`test/api.test.js`, `test/helpers.js`)
- [x] Makefile with 13 targets (start, stop, restart, update, upgrade, install, lint, test, build, deploy, logs, status, help)

Generated repositories should adopt only modules appropriate to their stack, threat model, operating environment, and compliance needs.

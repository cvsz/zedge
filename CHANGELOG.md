# Changelog

All notable changes to this template are documented here.

The format follows Keep a Changelog conventions; generated projects should adopt an explicit versioning policy appropriate to their product.

## [Unreleased]

### Added

- Safe project identity bootstrap with explicit dry-run/apply and idempotence tests.
- Generated README/ABOUT templates and startup/profile documentation.
- CI bootstrap test coverage and fail-closed Makefile placeholders.
- ZEAZ cross-agent engineering execution framework.
- Claude Code and OpenCode adapters.
- Reusable AI guides, playbooks, prompts, skills, component manifests, and plugin-source manifests.
- ECC OSS CLI install configuration with explicit separation from hosted ECC App evidence.
- Repository structure and local Markdown-link validator.
- GitHub administration automation with dry-run, explicit apply, and read-back verification.
- Repository rollout guidance for applying the baseline safely to existing repositories.
- **Zedge backlog implementation (Tier B):**
  - `server/events.js` — ClickRecorded event emission, outbox pattern, relay/consumer pattern (B1).
  - `server/ranking.js` — Catalog/offers/ranking with observed/modeled data separation, ProductRanked events (B2).
  - `server/publication-status.js` — Publication lifecycle status transitions: IDEA → REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED/FAILED, with approval gating (B3).
  - `server/app.js` — Enhanced security headers: HSTS (conditional), CSP, X-Content-Type-Options, Referrer-Policy, Cache-Control (B7/B9).
  - `docs/accessibility.md` — Manual accessibility audit notes for WCAG 2.1 A/AA compliance (B8).
  - `public/i18n/en.json` — English UI string translations (105 keys) (B13).
  - `public/i18n/th.json` — Thai UI string translations (105 keys) (B13).
  - `docs/accessibility.md` — Manual accessibility audit notes (B8).
  - `Final-Report.md` — Zedge backlog completion report.

### Changed

- Reorganized reusable AI documentation into `guides/`, `playbooks/`, and `prompts/`.
- Pinned baseline first-party GitHub Actions to immutable commit SHAs.
- Expanded CODEOWNERS coverage for repository policy, AI, ECC, skills, components, and plugin manifests.
- Clarified that release-note configuration is not an artifact-publishing workflow.
- Documented branch/security administration as an explicit evidence gate rather than a documentation-only checklist.
- **CF_* → CLOUDFLARE_* environment variable rename** across `test/api.test.js` and `test/helpers.js` (from `CF_API_TOKEN` to `CLOUDFLARE_API_TOKEN`).

### Fixed

- Corrected generated README link validation so template links are resolved from their generated root location.
- Removed stale wording that could imply green CI or configuration files alone establish production readiness.

### Security

- Added fail-closed repository-administration verification.
- Added protected-branch controls for required reviews/checks, conversation resolution, force-push prevention, and deletion prevention.
- Added documented verification for Dependabot, private vulnerability reporting, secret scanning/push protection, and least-privilege Actions permissions where supported.
- **Enforced CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Cache-Control security headers** on all responses (B9).

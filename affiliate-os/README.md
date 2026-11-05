# Affiliate Automation OS

A policy-controlled system for planning, producing, publishing and measuring affiliate content across TikTok, Shopee, Facebook/Instagram and YouTube, **using official APIs, OAuth and approved integrations only**. It does not build spam, fake engagement, bot accounts, CAPTCHA bypasses or ToS evasion, and it never invents product claims, reviews, discounts, scarcity or earnings.

Lifecycle: **Discover → Score → Plan → Generate → Review → Render → Publish → Track → Attribute → Analyze → Learn → Optimize**

## Status (read this first)
| Area | State |
|---|---|
| Phase 0: architecture, data model, security, compliance, plans | Written (this folder). Not yet reviewed by you |
| Phase 1, item AFF-001: link and click-attribution service | **Built and tested** (`services/link-service/`, 9 tests, Cloudflare Worker + D1) |
| Everything else | Not started. See `exec-planning.md` |
| Real platform APIs (TikTok, Shopee, Meta, YouTube) | **Nothing has been called.** Capabilities are unverified; see `docs/provider-capability-matrix.md` |

Nothing here publishes, spends money or acts autonomously. Those need your explicit go-ahead and, for platform access, your own developer accounts and approvals.

## Map
- `ARCHITECTURE.md`: system, data model, API, events, agents, content, video, publishing, attribution, infrastructure
- `SECURITY.md`, `THREAT-MODEL.md`, `COMPLIANCE.md`, `PRIVACY.md`
- `ROADMAP.md`, `IMPLEMENTATION-CHECKLIST.md`, `exec-planning.md` (source of truth for work), `CHANGELOG.md`, `CONTRIBUTING.md`
- `docs/`: repository assessment, provider capability matrix, monorepo tree, Phase 1 plan, ADRs
- `services/link-service/`: the first running component

## How it relates to Zedge
Zedge (the parent folder) is the Cloudflare control panel. The Affiliate OS runs on Cloudflare (Workers, D1, R2, Queues, Access, Turnstile), and Zedge is how you operate those pieces: deploy the link Worker, edit KV and D1, manage Queues and cron, protect the studio with Access.


## Run it
```bash
npm install
npm test                  # all suites on in-memory Postgres (PGlite)
npm run test:pg           # same suites on a real PostgreSQL (embedded-postgres)
npm run e2e:pg            # migrate CLI + studio entry point on a real PostgreSQL

# Against your own server (the login needs CREATEROLE once, for the roles in migration 0001):
DATABASE_URL=postgres://... npm run migrate -w @affiliate-os/db -- up
DATABASE_URL=postgres://... ORGANIZATION_ID=<uuid> SESSION_SECRET=<32+ chars> \
  ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com ACCESS_AUD=<aud tag> npm start -w @affiliate-os/studio
```
Put the studio behind a Cloudflare Access application; it trusts only a verified Access token and only people already added as members.

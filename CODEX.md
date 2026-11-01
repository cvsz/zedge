# Codex Instructions - Zedge

## Project Summary
Zedge: Self-hosted control panel for Cloudflare management (DNS, Workers, R2, Zero Trust, Security, RBAC).

## Codex Execution Guidelines
- **Environment:** Node.js 20+, Express (ESM), no external build tooling.
- **Cloudflare Integration:** Utilize the installed skills in `.agents/skills/` (such as `cloudflare`, `wrangler`, `workers-best-practices`) for Cloudflare API integrations and Worker deployments.
- **Verification:** Run `npm test` after making modifications to verify code correctness using Node.js built-in test runner.

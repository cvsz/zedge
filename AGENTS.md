# Zedge - Agent Instructions

Welcome to **Zedge**, a self-hosted control panel for Cloudflare (domains, DNS, security, WAF, rules, Workers, R2, Zero Trust, email, analytics, and multi-user RBAC).

## Tech Stack & Architecture

- **Runtime:** Node.js `>=20`
- **Framework:** Express (`^4.21.2`), pure ES Modules (`"type": "module"`), zero frontend build steps.
- **Frontend:** Vanilla JavaScript and CSS (`public/`), single-page app layout with dynamic view loading (`public/views/`).
- **Backend (`server/`):**
  - `index.js`: Server entrypoint.
  - `app.js`: Express app setup and middleware.
  - `routes/`: Modular REST API endpoints (`admin.js`, `analytics.js`, `core.js`, `email.js`, `r2.js`, `rules.js`, `workers.js`).
  - `cf.js`: Cloudflare API client.
  - `s3.js`: S3 API client for R2 object storage operations.
  - `rbac.js`: Role-based access control permission checks.
  - `store.js`: Local storage for users, roles, and audit logs (`DATA_DIR`).
- **Testing:** Node.js built-in test runner (`npm test` runs `node --test "test/*.test.js"`).

## Cloudflare Skills

19 Cloudflare agent skills are installed in `.agents/skills/` (including `cloudflare`, `wrangler`, `durable-objects`, `workers-best-practices`, `cloudflare-one`, etc.). Refer to these skills for up-to-date guidance when working with Cloudflare APIs, Workers bindings, R2, Zero Trust, and Wrangler.

## Development & Validation Guidelines

1. **Idiomatic ES Modules:** Use standard ES import/export syntax. Never mix CommonJS (`require`).
2. **Security & RBAC:** Every backend mutation route must validate permissions via `rbac.js`. Never log request bodies, credentials, or API tokens.
3. **Testing:** Always add or update test cases in `test/` when adding features or fixing bugs. Run tests with `npm test`.

# Zedge

A self-hosted control panel for Cloudflare. Add domains and subdomains in one click, edit DNS inline, manage WAF, rate limits, redirects and cache rules, deploy Workers, browse R2, run Zero Trust, route email, see traffic charts, and give your team their own logins with per-action permissions. Node 20+, one dependency (Express), no build step.

Cloudflare_Docs=https://developers.cloudflare.com/llms-full.txt
Cloudflare_Fundamentals=https://developers.cloudflare.com/fundamentals/llms-full.txt
Cloudflare_CLI=https://developers.cloudflare.com/cf/llms-full.txt
Cloudflare_Skills=https://github.com/cloudflare/skills

## Quick start

**Local**

```bash
npm install
cp .env.example .env      # set CF_API_TOKEN and EDGE_ADMIN_PASSWORD
set -a; . ./.env; set +a
npm start                 # http://127.0.0.1:8787, sign in as "admin"
```

**Docker behind a Cloudflare Tunnel (one command)**

```bash
export CF_API_TOKEN=...   # Zone:Read, DNS:Edit, Cloudflare Tunnel:Edit (+ Access: Apps and Policies:Edit for --allow)
npm run deploy -- --hostname console.example.com --allow you@example.com
```

The script finds the zone, creates (or reuses) a tunnel, points `console.example.com` at it with a proxied CNAME, optionally puts a Cloudflare Access policy in front, writes a private `.env` (mode 600, generated admin password and session secret, existing values are never overwritten) and runs `docker compose up -d --build`. Nothing is published on the host: the only way in is the tunnel. Re-running is safe. Use `--no-start` to stop before Docker. `--allow` is strongly recommended: it puts Access in front of the console's own login.

Your admin password is the `EDGE_ADMIN_PASSWORD` line in `.env`. Sign in as `admin`, then create real users under **Users & Roles**.

## What it does

| Screen | Live actions |
|---|---|
| **Overview** | Traffic chart (24h / 7d / 30d) with requests, cache ratio, bandwidth and threats; SSL mode, minimum TLS, HTTPS redirect, HTTP/3, Brotli, Early Hints, dev mode, DNSSEC, purge cache |
| **Domains** | Add a domain (or many) and see the nameservers; per-domain "add subdomain" |
| **DNS** | Quick-add subdomain, inline edit, proxy toggle, delete, advanced records, **bulk origin update** with preview |
| **Email** | Email routing on/off, forwarding rules, catch-all, destination addresses; SPF / DKIM / DMARC checks and the **DMARC helper** |
| **Security & WAF** | Security level, under-attack mode, custom rules, IP and country access rules |
| **Rules** | Rate limits, managed rulesets (Cloudflare Managed, OWASP), redirects, cache rules, legacy Page Rules |
| **Workers** | Create and **deploy** a module, version list and **rollback**, **variables** and **secrets** (set, replace, delete). Other bindings are kept as they are |
| **Storage** | R2 buckets: create, browse objects by folder, **upload**, download, delete, **lifecycle rules**, **CORS rules**. KV and D1 are listed |
| **Zero Trust** | Tunnels and publish-a-hostname; **Access** apps with policy editing; **device posture** checks; **Gateway** DNS rules (domains and categories) |
| **API Tokens** | Least-privilege token templates with expiry, roll, revoke, Cloudflare audit log |
| **Audit log** | Every change made through this console: who, what, when. Request bodies and secrets are never logged |
| **Users & Roles** | Create users, assign roles, disable, reset passwords; build custom roles from individual permissions |

**Multi-account:** if the token can see several accounts an account switcher appears. Set `CF_ACCOUNT_IDS` to restrict the console to a subset; zone access is then checked against it too.

## Roles and permissions

Every action maps to exactly one permission, checked on the server for every request (the UI hiding a button is a convenience, not the control).

| Permission | Allows |
|---|---|
| `read` | View everything |
| `domains.write` | Add domains, activation checks |
| `dns.write` | DNS records, bulk origin update |
| `zone.write` | Zone settings, DNSSEC, cache purge |
| `security.write` | Security level, custom WAF rules, IP access rules |
| `rules.write` | Rate limits, managed rulesets, redirects, cache rules, page rules |
| `workers.write` | Worker deploys, rollbacks, variables, secrets |
| `r2.write` | Buckets, object upload and delete, lifecycle, CORS |
| `zerotrust.write` | Tunnels, Access, device posture, Gateway |
| `email.write` | Email routing, DMARC |
| `tokens.read` / `tokens.write` | List / create, roll and revoke API tokens |
| `audit.read` | Cloudflare audit log and the console audit log |
| `users.admin` | Manage users and roles |

Built-in roles: **admin** (everything), **operator** (read, domains, DNS, zone, security, rules, email), **viewer** (read only). Create more under Users & Roles. Users, roles and the audit log are stored as files in `DATA_DIR` (default `./data`; the Docker volume `edge-data`). Back it up. Passwords are hashed with scrypt.

## Configuration

See `.env.example`. The essentials:

| Variable | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare token, server side only |
| `EDGE_ADMIN_PASSWORD` | Creates the first `admin` user when there are no users yet (12+ characters) |
| `CF_ACCOUNT_ID` / `CF_ACCOUNT_IDS` | Restrict to one or several accounts |
| `SESSION_SECRET` | Signs session cookies (set it, or everyone is signed out on restart) |
| `DATA_DIR` | Users, roles, audit log |
| `COOKIE_SECURE=1` | Required when served over HTTPS |
| `TRUST_CF_CONNECTING_IP=1` | Use Cloudflare's real client IP for the login rate limit and audit log. Only when the tunnel is the sole way in (the Docker setup sets it) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **Needed for browsing and uploading R2 objects.** Cloudflare's API has no object endpoints; objects go through R2's S3 API with an R2 access key pair (dashboard: R2 > Manage API tokens). Bucket-level features need only the normal token |
| `R2_MAX_UPLOAD_MB` | Upload size limit (default 50) |

## Token permissions

Give the console's token only what the screens you use need. Anything missing shows "Not available" on that card instead of breaking the page.

- Domains: Zone: Edit, Zone: Read. DNS: DNS: Edit
- Overview: Zone Settings: Edit, DNSSEC: Edit, Cache Purge, Analytics: Read
- Security and Rules: Zone WAF: Edit, Firewall Services: Edit, Dynamic URL Redirects: Edit, Cache Settings: Edit, Page Rules: Edit
- Email: Email Routing Rules: Edit, Email Routing Addresses: Edit
- Workers: Workers Scripts: Edit. R2: Workers R2 Storage: Edit. KV / D1: read
- Zero Trust: Cloudflare Tunnel: Edit, Access: Apps and Policies: Edit, Zero Trust: Edit (posture, Gateway)
- Tokens: API Tokens: Edit (powerful: it can mint tokens up to its own privileges; leave it off unless you need that screen)
- Audit log: Account Settings: Read

## Security model

- The Cloudflare token lives only in the server environment.
- Login: per-user scrypt password hashes, constant-time comparison, 5 failures per 15 minutes per IP. Sessions are HMAC-signed, `HttpOnly`, `SameSite=Strict` cookies. Permissions are looked up on every request, so changing a role or disabling a user takes effect immediately.
- Every non-GET request must carry `X-Requested-With: zedge` (CSRF defence).
- `/api/cf/*` is an **allowlist** (`server/allowlist.js`): only endpoints the console uses, each tied to a permission. Rule editing, Worker deploys and R2 objects go through dedicated routes that validate input.
- Zone and account IDs in every path are checked against the accounts this console may act on.
- Secrets (Worker secrets, new tokens) are write-only: shown once or never.
- The server refuses to start without a password unless `EDGE_ALLOW_NO_AUTH=1` on a loopback host with no users.
- Strict CSP, `nosniff`, no-store caching. The default bind is `127.0.0.1`.

## Tests

```bash
npm test                    # 53 tests: API, RBAC, SigV4, deploy script, against an in-memory mock of Cloudflare and R2
node test/ui-smoke.mjs      # drives the real UI in Chromium (needs Playwright)
```

## Caveat: tested against a mock

All tests run against a mock of the Cloudflare API, not the real one. The R2 request signing is verified against the official AWS SigV4 test vectors, and the Docker image was not built in the environment this was written in (the compose file and healthcheck were validated). Payloads I could not check against real Cloudflare and that you should try once on throwaway resources first:

- Worker variables and secrets (settings PATCH keeping other bindings), and rollback
- Access policy edits, device posture checks and Gateway rules
- R2 lifecycle and CORS payloads
- Rate limit rules and managed ruleset IDs

Errors from Cloudflare are shown as they are, so a mismatch will say what it rejected.

## Layout

```
server/    config, auth, store (users, roles, audit), RBAC, Cloudflare client, S3 signer, allowlist, routes/
public/    index.html, styles.css, app.js (shell and core screens), views/ (one file per larger screen)
scripts/   deploy.mjs (tunnel, DNS, Access, .env, docker compose)
test/      mock Cloudflare + R2, API / RBAC / SigV4 / deploy tests, browser smoke test
Dockerfile, docker-compose.yml
```

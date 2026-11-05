# Threat model

**Assets:** the Cloudflare API token; the ability to change DNS, rules, Workers and data; the user database; the audit log.
**Actors:** console users (some malicious or compromised), anyone who can reach the network port, someone who steals a laptop or a session cookie, a compromised dependency.

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| 1 | Stolen password | scrypt, throttling, two-factor, lockout alert | A user who skips two-factor stays exposed |
| 2 | Stolen session cookie | HttpOnly, SameSite=Strict, Secure, expiry, per-request user lookup | Cookie theft from a compromised browser still works until expiry or disable |
| 3 | CSRF | custom header on writes + SameSite | none known |
| 4 | Privilege escalation by a low-role user | permission per endpoint, allowlist of Cloudflare paths, tests per role | New endpoints must declare a permission (enforced by review and tests) |
| 5 | Reaching another account's or domain's data | `CLOUDFLARE_ACCOUNT_IDS`, zone checks on path, query and body, per-user domain list | Limits cover domains, Workers, buckets, KV, D1 and Pages |
| 6 | Token theft from the server | token only in server env; never sent to the browser or logged | Anyone with host access has it; use a scoped token |
| 7 | Rule or SQL injection | validated fields, whitelists, quote refusal, read-only SQL by default | The D1 console runs the SQL a permitted user writes by design |
| 8 | One insider doing irreversible damage | optional two-person approval; snapshots to restore DNS/rules; audit | Approval is off by default; with one approver it is bypassed so the only admin is never locked out |
| 9 | Tampering with the audit log | hash chain, verify banner, export | An attacker with disk access who rewrites the whole file can re-chain it; ship exports off-host |
| 10 | XSS | CSP, DOM built with text nodes, no inline script/style | Third-party font stylesheet is the only external source |
| 11 | SSRF | the console only calls the Cloudflare API base and R2 endpoint from config; webhook URL set by operator and must be https | Operator-controlled URLs are trusted |
| 12 | Denial of service | rate limits, request size caps (2 MB JSON, 1 MB zone file, 32 KB snippet) | No protection against a flood before the app; use Cloudflare in front |
| 13 | Dependency compromise | few runtime dependencies, lockfile, CI `npm audit` | Supply-chain risk remains |
| 15 | Forged or replayed single sign-on response | signed single-use state cookie, PKCE, nonce, signature and claim checks, provider code is single use | A compromised identity provider can mint valid sign-ins for anyone it manages |
| 16 | Account takeover through username collision with SSO | SSO users are `sso-` prefixed and bound to issuer+subject; collisions are refused | none known |
| 14 | Lost second factor | 8 one-time recovery codes; admin reset | Admin reset itself needs a trusted admin |

Review this file whenever a new endpoint class, credential type or external call is added.

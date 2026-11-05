# Security architecture

- **Identity:** OIDC for people (MFA at the identity provider), scoped service tokens for machines, short-lived sessions, Cloudflare Access in front of the studio.
- **Authorization:** RBAC with a permission per route, plus organization scoping in one data-access layer. Tenant isolation is tested, not assumed.
- **Secrets:** a secret manager; provider OAuth tokens encrypted at rest with envelope keys, never sent to browsers, rotated, revocable. CI never needs production credentials.
- **Input/output:** schema validation on every boundary; SSRF protection (outbound fetch only to allowlisted hosts, no private ranges); secure uploads with MIME verification and media sandboxing; CSRF and XSS defences; parameterised SQL only.
- **Webhooks:** signature validation, timestamp window, nonce/replay protection, de-duplication by provider event id.
- **Redirects:** the link service only redirects to hosts on an allowlist, over https, with no credentials in the URL, and re-checks at click time.
- **Abuse:** rate limits per user, token and IP; Turnstile on public forms.
- **Audit:** every state change and every autonomous action, hash-chained, exportable.
- **Autonomy safety:** approvals by default; sensitive categories always human; kill switch per brand and per provider; budget caps per operation, per campaign and per day.
- **Supply chain:** lockfiles, dependency/secret/SAST/container scanning in CI, SBOM, signed artifacts. No security gate is disabled to get a green build.

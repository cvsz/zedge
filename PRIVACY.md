# Privacy

Zedge stores, on the host in `DATA_DIR`:
- usernames, password hashes, roles, per-user domain lists, two-factor secrets and hashed recovery codes;
- the console audit log (who, what, when, source IP, status; never request bodies or secrets);
- snapshots of DNS records and rules for domains you choose to snapshot;
- approval requests (action, path, and the request body of the risky action, kept up to 14 days).

It sends nothing to third parties. Calls go to the Cloudflare API (and the R2 endpoint if configured). The optional alert webhook receives one line per change with the user name and path. The page loads a font stylesheet from Google Fonts; self-host it if that matters to you.

Retention: audit entries are kept until `AUDIT_RETENTION_DAYS` (0 keeps all). Snapshots keep the latest 50 per domain. Approvals older than 14 days are dropped.
Deletion: removing a user deletes their record; audit entries about them remain unless pruned.

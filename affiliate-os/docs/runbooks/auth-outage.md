# Nobody can sign in to the studio

**Symptom:** every `/api/*` call returns 403, or the page loads but shows an error.

**Check in this order:**
1. `GET /readyz`. A 503 means the database is unreachable: go to the database provider first.
2. Cloudflare Access: is the application's policy still allowing the user, and is the request actually carrying `Cf-Access-Jwt-Assertion`? Without it the studio refuses by design.
3. Is `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` still correct (an Access application re-created gets a new AUD tag)? A mismatch makes every token fail as `wrong audience`.
4. The signing keys come from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. One refetch is attempted on an unknown key id; if the studio cannot reach that URL, nobody gets in.
5. Is the person still a **member** (a row in `users`, not disabled)? Valid Access identity without membership is refused on purpose; there is no auto-provisioning.

**Act:** fix the failing link above. There is no backdoor login. If all owners are locked out, use the provisioning procedure with a database administrator: insert a member through `bootstrapOwner` only when the organization has no users, otherwise update `users.role_name` and `disabled` directly, and record who did it and why.

**Verify:** `/api/me` returns the role for a known member.

**Escalate:** suspected token forgery (`bad signature` errors that are not explained by a key rotation) is a security incident.

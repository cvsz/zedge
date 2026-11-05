# ADR 0001: Permission-checked allowlist instead of a raw API proxy

**Status:** accepted. **Context:** the browser needs many Cloudflare calls; a pass-through would give every signed-in user the whole token. **Decision:** only listed method+path patterns are reachable, each naming one permission; anything needing validation (rules, Worker deploys, KV values, SQL, snapshots) has a dedicated route. **Consequences:** new features need an allowlist entry and a test; unlisted calls (deleting zones, billing, members) stay impossible by construction.

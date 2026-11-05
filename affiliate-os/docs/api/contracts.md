# Contracts (`@affiliate-os/contracts`)

Machine-readable schemas for entities and events. Services depend on these, never on each other's internals.

- **Entities:** link, click, content, publication, approval-request (`schemas/*.json`).
- **Events (14):** `schemas/events/<Type>.v1.json`, wrapped in a common envelope (`id`, `type`, `organization_id`, `occurred_at`, `payload`).
- **Validator:** zero-dependency JSON-Schema subset. Unknown schema keywords are rejected, so a typo cannot silently disable a rule.
- **Versioning:** `contracts.lock.json` records a hash and `x-version` per schema. Changing a schema without bumping `x-version` fails the test; `npm run lock` rewrites the lock after a deliberate bump. Fixtures of v1 envelopes must keep validating.
- **Privacy:** a click carries no IP address or user agent (ADR 0003). A click event with either is invalid.
- **Money:** integer minor units plus ISO currency. **Basis:** `observed` vs `modeled`.

Use: `validateEvent(envelope)`, `validateEntity(name, value)`, `makeEvent({type, organization_id, payload})`.

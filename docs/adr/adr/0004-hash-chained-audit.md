# ADR 0004: Hash-chained audit log

**Status:** accepted. **Decision:** each line stores the hash of the previous line plus its own content; verification recomputes the chain. **Consequences:** edits and deleted middle lines are detected; truncation of the tail is not (ship exports off-host); retention pruning drops the oldest lines and the rest still verifies.

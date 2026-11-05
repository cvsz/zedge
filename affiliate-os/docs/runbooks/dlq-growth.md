# Dead letters are growing

**Symptom:** `dead_letters` rows with `replayed_at IS NULL` keep increasing for a consumer.

**Check** (run as the organization, `scoped(db, org)`):
```sql
SELECT consumer, count(*), min(created_at), max(created_at) FROM dead_letters WHERE replayed_at IS NULL GROUP BY consumer;
SELECT id, error, attempts FROM dead_letters WHERE replayed_at IS NULL ORDER BY id DESC LIMIT 20;
```
- `error` starting `invalid event:` means the producer sent something the contract rejects. Fix the producer, not the consumer.
- `event belongs to a different organization` is a routing bug and a possible isolation problem. Treat as a security incident: stop, preserve the rows, tell the owner.
- Anything else is a handler error: read the message, reproduce with the stored `envelope`.

**Act:**
1. Fix the cause and deploy.
2. Replay from code that has the real handlers: `await consumer.replay(orgId)` or `{ ids: [...] }` for a few. A replay that fails again stays in the queue; nothing is lost and nothing runs twice (the processed record is written in the same transaction).
3. Never `DELETE` rows (the application role cannot). Replayed rows keep `replayed_at` as the record.

**Verify:** unreplayed count for the consumer falls to zero; the downstream effect exists exactly once.

**Escalate:** cross-organization error, or invalid events from a producer you do not control.

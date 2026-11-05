# Outbox is not draining

**Symptom:** `outbox` rows with `published_at IS NULL` get older; `relay()` returns `{ stuck: <id> }`.

**Check:**
```sql
SELECT id, type, attempts, last_error, created_at FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 10;
```
The relay delivers **in order** and stops at the first failure, so one bad event blocks everything behind it. That is deliberate: nothing overtakes it.

**Act:**
1. Read `last_error` on the oldest row. If the destination is down, restore it; the relay resumes by itself.
2. If the event itself can never be delivered, fix the destination handler so it accepts it. Do not edit or delete outbox rows by hand.
3. After the cause is fixed, call `relay(db, org, deliver)` again. Attempts already counted past `maxAttempts` need `UPDATE outbox SET attempts = 0 WHERE id = ...` (the application role may update `attempts`).

**Verify:** the unpublished count reaches zero; consumers show no gaps (`processed_events` is idempotent, so duplicates are harmless).

**Escalate:** the head of the queue is older than your delivery SLO and the destination is healthy.

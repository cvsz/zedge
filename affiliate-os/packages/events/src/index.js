import { validateEvent } from '@affiliate-os/contracts';
import { scoped } from '@affiliate-os/db';

const short = (e) => String((e && e.message) || e).slice(0, 500);

/**
 * Write an event to the outbox inside the caller's transaction `q`, so the business change and its event commit together
 * or not at all. The envelope is validated first: an invalid event is a bug in the producer and fails loudly here.
 */
export async function publish(q, envelope) {
  const v = validateEvent(envelope);
  if (!v.valid) throw new Error(`Refusing to publish an invalid ${envelope && envelope.type} event: ${v.errors.join('; ')}`);
  if (envelope.organization_id !== q.organizationId) throw new Error('An event can only be published for the organization of the current transaction');
  await q.query('INSERT INTO outbox (organization_id, event_id, type, envelope) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, event_id) DO NOTHING', [q.organizationId, envelope.id, envelope.type, JSON.stringify(envelope)]);
}

/**
 * Deliver unpublished outbox rows, oldest first, to `deliver(envelope)` (a Queues producer, a NATS publisher, a test double).
 * Delivery is at-least-once: a row is marked published only after `deliver` returned, and a failure keeps the row for the next
 * run. Order is preserved: a failed row stops the batch so later events never overtake it.
 */
export async function relay(db, organizationId, deliver, { batch = 100, maxAttempts = 20 } = {}) {
  const s = scoped(db, organizationId);
  const rows = (await s.query('SELECT id, envelope, attempts FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1', [batch])).rows;
  let sent = 0;
  for (const r of rows) {
    if (r.attempts >= maxAttempts) return { sent, stuck: r.id };       // a human must look; nothing is dropped
    try {
      await deliver(r.envelope);
    } catch (e) {
      await s.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [r.id, short(e)]);
      return { sent, failed: r.id };
    }
    await s.query('UPDATE outbox SET published_at = now(), last_error = NULL WHERE id = $1', [r.id]);
    sent += 1;
  }
  return { sent };
}

/**
 * A consumer is idempotent: the "already processed" record is written in the same transaction as the handler's effects,
 * so a duplicate delivery changes nothing and a crash half-way leaves nothing behind. A handler that keeps failing, or an
 * event that does not validate, ends in the dead-letter queue with its error and attempt count. Nothing is dropped silently.
 */
export function createConsumer({ db, name, handlers, maxAttempts = 3 }) {
  if (!name) throw new Error('A consumer needs a name');

  async function toDeadLetter(s, organizationId, envelope, error, attempts) {
    await s.query('INSERT INTO dead_letters (organization_id, consumer, event_id, envelope, error, attempts) VALUES ($1,$2,$3,$4,$5,$6)', [organizationId, name, envelope && /^[0-9a-f-]{36}$/i.test(String(envelope.id)) ? envelope.id : null, JSON.stringify(envelope ?? null), error, attempts]);
  }

  /** Returns 'processed' | 'duplicate' | 'ignored' | 'retry' | 'dead'. Call again with the same event on 'retry'. */
  async function consume(organizationId, envelope) {
    const s = scoped(db, organizationId);
    const v = validateEvent(envelope);
    if (!v.valid) { await s.tx((q) => toDeadLetter(q, organizationId, envelope, `invalid event: ${v.errors.join('; ')}`, 0)); return 'dead'; }
    if (envelope.organization_id !== organizationId) { await s.tx((q) => toDeadLetter(q, organizationId, envelope, 'event belongs to a different organization', 0)); return 'dead'; }
    const handler = handlers[envelope.type];
    if (!handler) return 'ignored';

    const dead = (await s.query('SELECT 1 FROM dead_letters WHERE consumer = $1 AND event_id = $2 AND replayed_at IS NULL', [name, envelope.id])).rows.length;
    if (dead) return 'dead';

    try {
      return await s.tx(async (q) => {
        const fresh = await q.query('INSERT INTO processed_events (organization_id, consumer, event_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [organizationId, name, envelope.id]);
        if (!fresh.affectedRows) return 'duplicate';
        await handler(q, envelope);
        return 'processed';
      });
    } catch (e) {
      const err = short(e);
      return s.tx(async (q) => {
        const row = (await q.query('INSERT INTO delivery_attempts (organization_id, consumer, event_id, attempts, last_error) VALUES ($1,$2,$3,1,$4) ON CONFLICT (organization_id, consumer, event_id) DO UPDATE SET attempts = delivery_attempts.attempts + 1, last_error = $4 RETURNING attempts', [organizationId, name, envelope.id, err])).rows[0];
        if (row.attempts >= maxAttempts) { await toDeadLetter(q, organizationId, envelope, err, row.attempts); return 'dead'; }
        return 'retry';
      });
    }
  }

  /** Run the handler again for dead letters (after a fix). Each is processed once; failures stay in the queue. */
  async function replay(organizationId, { ids } = {}) {
    const s = scoped(db, organizationId);
    const rows = (await s.query(`SELECT id, envelope FROM dead_letters WHERE consumer = $1 AND replayed_at IS NULL ${ids ? 'AND id = ANY($2::bigint[])' : ''} ORDER BY id`, ids ? [name, ids] : [name])).rows;
    const out = { replayed: 0, failed: 0 };
    for (const r of rows) {
      const handler = handlers[r.envelope && r.envelope.type];
      const ok = handler && validateEvent(r.envelope).valid && r.envelope.organization_id === organizationId;
      if (!ok) { out.failed += 1; continue; }
      try {
        await s.tx(async (q) => {
          await q.query('INSERT INTO processed_events (organization_id, consumer, event_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [organizationId, name, r.envelope.id]);
          await handler(q, r.envelope);
          await q.query('UPDATE dead_letters SET replayed_at = now() WHERE id = $1', [r.id]);
          await q.query('UPDATE delivery_attempts SET attempts = 0 WHERE consumer = $1 AND event_id = $2', [name, r.envelope.id]);
        });
        out.replayed += 1;
      } catch { out.failed += 1; }
    }
    return out;
  }

  const deadLetters = async (organizationId) => (await scoped(db, organizationId).query('SELECT id, consumer, event_id, error, attempts, created_at, replayed_at FROM dead_letters WHERE consumer = $1 ORDER BY id', [name])).rows;
  return { consume, replay, deadLetters };
}

import fs from 'node:fs';
import path from 'node:path';

/** In-memory event store for the test/dev environment */
const events = [];

/** Outbox - pending events to be relayed */
const outbox = [];

/**
 * Emit a ClickRecorded event when a click batch is processed from a Worker
 * @param {Object} options - Event options
 * @param {string} options.clickId - The click identifier
 * @param {string} options.sessionId - The user session identifier
 * @param {string} options.url - The target URL
 * @param {string} options.referrer - The referrer URL
 * @param {Object} options.metadata - Additional metadata
 */
/** @param {{ clickId?: string, sessionId?: string, url?: string, referrer?: string, metadata?: Object }} options */
export function emitClickRecorded({ clickId, sessionId, url, referrer, metadata } = {}) {
  const event = {
    id: `click_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: 'ClickRecorded',
    clickId,
    sessionId,
    url,
    referrer,
    metadata,
    timestamp: new Date().toISOString(),
  };

  // Add to outbox for relay
  outbox.push(event);
  events.push(event);

  return event;
}

/**
 * Get all emitted events (for testing/inspection)
 * @returns {Array} Array of events
 */
export function getEvents() {
  return [...events];
}

/**
 * Get pending outbox events (for relay/consumer)
 * @returns {Array} Array of outbox events
 */
export function getOutbox() {
  return [...outbox];
}

/**
 * Clear the event store and outbox (for test cleanup)
 */
export function clear() {
  events.length = 0;
  outbox.length = 0;
}

/**
 * Persist events to disk (for production durability)
 * @param {string} dataDir - Data directory path
 */
export function persistEvents(dataDir) {
  const eventsPath = path.join(dataDir, 'events.json');
  if (events.length > 0) {
    fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));
  }
  const outboxPath = path.join(dataDir, 'outbox.json');
  if (outbox.length > 0) {
    fs.writeFileSync(outboxPath, JSON.stringify(outbox, null, 2));
  }
}

/**
 * Load events from disk (for production resume)
 * @param {string} dataDir - Data directory path
 */
export function loadEvents(dataDir) {
  const eventsPath = path.join(dataDir, 'events.json');
  const outboxPath = path.join(dataDir, 'outbox.json');

  if (fs.existsSync(eventsPath)) {
    const loaded = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    events.push(...loaded);
  }

  if (fs.existsSync(outboxPath)) {
    const loaded = JSON.parse(fs.readFileSync(outboxPath, 'utf8'));
    outbox.push(...loaded);
  }
}

/**
 * Relay pending outbox events to consumers
 * @param {Object} options - Relay options
 * @param {Function} options.deliver - Function to deliver events to consumer
 * @returns {Array} Array of remaining outbox events (not yet delivered)
 */
/** @param {{ deliver?: Function }} options */
export function relay({ deliver } = {}) {
  const remaining = [];
  for (const event of outbox) {
    try {
      if (deliver) {
        deliver(event);
      } else {
        // Default: just mark as relayed
        event.relayed = new Date().toISOString();
      }
    } catch {
      // On delivery failure, keep in outbox
      remaining.push(event);
    }
  }
  // Remove delivered events from outbox, keep remaining
  outbox.length = remaining.length;
  return remaining;
}

/**
 * Consume processed events - called after relay has delivered them
 * @param {Object} options - Consume options
 * @param {Function} options.consume - Function to consume processed events
 * @returns {Array} Array of still-processed events
 */
/** @param {{ consume?: Function }} options */
export function consume({ consume: consumeFn } = {}) {
  const remaining = [];
  for (const event of outbox) {
    try {
      if (consumeFn) {
        const result = consumeFn(event);
        if (result === false) {
          remaining.push(event);
        } else {
          // Mark as consumed
          event.consumed = new Date().toISOString();
        }
      } else {
        // Mark as consumed
        event.consumed = new Date().toISOString();
      }
    } catch {
      remaining.push(event);
    }
  }
  outbox.length = remaining.length;
  return remaining;
}

export default { emitClickRecorded, getEvents, getOutbox, clear, persistEvents, loadEvents, relay, consume };
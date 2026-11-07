/**
 * Fixed-capacity token bucket per key, in memory. Good for one process; behind several replicas use Cloudflare rate limiting
 * or a shared store as well. Buckets idle for a minute are dropped so the map cannot grow without bound.
 */
export function createRateLimiter({ capacity = 60, refillPerSecond = 1, now = () => Date.now(), maxKeys = 10000 } = {}) {
  const buckets = new Map();
  function sweep(t) {
    for (const [k, b] of buckets) {if (t - b.t > 60000 && b.tokens + ((t - b.t) / 1000) * refillPerSecond >= capacity) {buckets.delete(k);}}   // idle and already full again
    while (buckets.size >= maxKeys) {buckets.delete(buckets.keys().next().value);}   // still too many: evict the oldest (a flood of fresh keys cannot grow memory)
  }
  return {
    /** Returns { ok: true } or { ok: false, retryAfter } (seconds). */
    take(key, cost = 1) {
      const t = now();
      if (buckets.size >= maxKeys) {sweep(t);}
      const b = buckets.get(key) || { tokens: capacity, t };
      b.tokens = Math.min(capacity, b.tokens + ((t - b.t) / 1000) * refillPerSecond); b.t = t;
      if (b.tokens >= cost) { b.tokens -= cost; buckets.set(key, b); return { ok: true }; }
      buckets.set(key, b);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((cost - b.tokens) / refillPerSecond)) };
    },
    size: () => buckets.size,
  };
}

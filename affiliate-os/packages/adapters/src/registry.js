import { readFileSync } from 'node:fs';
const registry = JSON.parse(readFileSync(new URL('../data/capabilities.json', import.meta.url), 'utf8'));
const STATUSES = new Set(['to-verify', 'manual', 'unsupported', 'verified']);
const STALE_DAYS = 90;

/** Declared status of a capability; anything not listed is 'unsupported'. */
export function statusOf(provider, capability, reg = registry) {
  const p = reg.providers[provider];
  if (!p) {return 'unsupported';}
  return p.status[capability] ?? p.status['*'] ?? 'unsupported';
}

/** An adapter may only call the platform for a capability that is 'verified' with a recorded check. Everything else is manual. */
export function mayCallPlatform(provider, capability, reg = registry) {
  const p = reg.providers[provider];
  return !!p && statusOf(provider, capability, reg) === 'verified' && !!p.last_verified_at && !!p.source_url;
}

export function staleness(provider, now = new Date(), reg = registry) {
  const p = reg.providers[provider];
  if (!p || !p.last_verified_at) {return { stale: true, reason: 'never verified' };}
  const days = Math.floor((now - new Date(p.last_verified_at)) / 86400000);
  return days > STALE_DAYS ? { stale: true, reason: `${days} days old` } : { stale: false };
}

/** Structural check of the registry data itself (used by tests and CI). */
export function checkRegistry(reg = registry) {
  const errs = [];
  for (const [name, p] of Object.entries(reg.providers)) {
    for (const [cap, st] of Object.entries(p.status)) {
      if (cap !== '*' && !reg.capabilities.includes(cap)) {errs.push(`${name}: unknown capability ${cap}`);}
      if (!STATUSES.has(st)) {errs.push(`${name}.${cap}: unknown status ${st}`);}
      if (st === 'verified' && (!p.last_verified_at || !p.source_url)) {errs.push(`${name}.${cap}: 'verified' needs last_verified_at and source_url`);}
    }
  }
  return errs;
}
export { registry };

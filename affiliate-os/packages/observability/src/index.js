import { randomBytes } from 'node:crypto';

const hex = (n) => randomBytes(n).toString('hex');
const nano = (ms) => String(BigInt(Math.round(ms * 1e6)));
const SECRET_KEY = /(token|secret|password|authorization|cookie|api[-_]?key)/i;
const attr = (k, v) => ({ key: k, value: SECRET_KEY.test(k) ? { stringValue: '[redacted]' } : typeof v === 'number' && Number.isInteger(v) ? { intValue: String(v) } : typeof v === 'number' ? { doubleValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } });

/** Minimal tracer. Spans export as an OTLP/HTTP JSON `resourceSpans` body; no SDK, no network call here. */
export function createTracer({ service, now = () => Date.now() } = {}) {
  const finished = [];
  function start(name, { parent, attributes = {} } = {}) {
    const span = { traceId: parent ? parent.traceId : hex(16), spanId: hex(8), parentSpanId: parent ? parent.spanId : undefined, name, startMs: now(), attributes: { ...attributes }, status: { code: 1 } };
    return {
      ...span, setAttribute(k, v) { span.attributes[k] = v; },
      get traceId() { return span.traceId; }, get spanId() { return span.spanId; },
      end(error) { if (span.endMs) {return;} span.endMs = now(); if (error) { span.status = { code: 2, message: String(error.message || error).slice(0, 200) }; } finished.push(span); },
    };
  }
  async function withSpan(name, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    const s = start(name, opts);
    try { const r = await fn(s); s.end(); return r; } catch (e) { s.end(e); throw e; }
  }
  function exportOtlp() {
    const spans = finished.splice(0).map((s) => ({ traceId: s.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: 1, startTimeUnixNano: nano(s.startMs), endTimeUnixNano: nano(s.endMs), attributes: Object.entries(s.attributes).map(([k, v]) => attr(k, v)), status: s.status }));
    return { resourceSpans: [{ resource: { attributes: [attr('service.name', service || 'unknown')] }, scopeSpans: [{ scope: { name: 'affiliate-os' }, spans }] }] };
  }
  return { start, withSpan, exportOtlp, pending: () => finished.length };
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelStr = (l) => { const k = Object.keys(l).sort(); return k.length ? `{${k.map((x) => `${x}="${esc(l[x])}"`).join(',')}}` : ''; };

/** Counters, gauges and histograms with Prometheus text exposition. Label values are caller-controlled: never put ids of people in them. */
export function createMetrics() {
  const defs = new Map();
  const get = (name, type, help, buckets) => {
    const d = defs.get(name);
    if (d) { if (d.type !== type) {throw new Error(`metric ${name} already registered as ${d.type}`);} return d; }
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {throw new Error(`bad metric name ${name}`);}
    const n = { type, help, series: new Map(), buckets }; defs.set(name, n); return n;
  };
  const key = (l) => labelStr(l);
  return {
    counter(name, help = '') { const d = get(name, 'counter', help); return { inc(labels = {}, by = 1) { if (by < 0) {throw new Error('counters only go up');} const k = key(labels); d.series.set(k, (d.series.get(k) || 0) + by); } }; },
    gauge(name, help = '') { const d = get(name, 'gauge', help); return { set(v, labels = {}) { d.series.set(key(labels), v); }, inc(labels = {}, by = 1) { const k = key(labels); d.series.set(k, (d.series.get(k) || 0) + by); } }; },
    histogram(name, help = '', buckets = [0.005, 0.025, 0.1, 0.5, 1, 5]) {
      const d = get(name, 'histogram', help, buckets);
      return { observe(v, labels = {}) { const k = key(labels); const s = d.series.get(k) || { counts: d.buckets.map(() => 0), sum: 0, n: 0, labels }; d.buckets.forEach((b, i) => { if (v <= b) {s.counts[i] += 1;} }); s.sum += v; s.n += 1; d.series.set(k, s); } };
    },
    expose() {
      const out = [];
      for (const [name, d] of [...defs].sort()) {
        if (d.help) {out.push(`# HELP ${name} ${d.help}`);}
        out.push(`# TYPE ${name} ${d.type}`);
        for (const [k, v] of d.series) {
          if (d.type !== 'histogram') { out.push(`${name}${k} ${v}`); continue; }
          const base = v.labels;
          d.buckets.forEach((b, i) => out.push(`${name}_bucket${labelStr({ ...base, le: b })} ${v.counts[i]}`));
          out.push(`${name}_bucket${labelStr({ ...base, le: '+Inf' })} ${v.n}`, `${name}_sum${k} ${v.sum}`, `${name}_count${k} ${v.n}`);
        }
      }
      return `${out.join('\n')}\n`;
    },
  };
}

/** Cost ledger: integer minor units + ISO currency per entry, per-organization budgets, and a hard stop when a budget is exhausted. */
export function createCostLedger({ now = () => new Date() } = {}) {
  const entries = []; const budgets = new Map(); const seen = new Set();
  const month = (d) => d.toISOString().slice(0, 7);
  const spent = (org, category, period) => entries.filter((e) => e.organization_id === org && e.period === period && (!category || e.category === category)).reduce((a, e) => a + e.amount_minor, 0);
  return {
    setBudget(org, { category = '*', period_minor, currency }) {
      if (!Number.isInteger(period_minor) || period_minor < 0) {throw new Error('budget must be a non-negative integer in minor units');}
      budgets.set(`${org}|${category}`, { period_minor, currency });
    },
    /** Idempotent on idempotency_key. Refuses (throws) when it would exceed a budget, so an agent cannot overspend silently. */
    record({ organization_id, category, amount_minor, currency, idempotency_key, note }) {
      if (!Number.isInteger(amount_minor) || amount_minor < 0) {throw new Error('amount_minor must be a non-negative integer');}
      if (!/^[A-Z]{3}$/.test(currency)) {throw new Error('currency must be an ISO code');}
      if (!idempotency_key) {throw new Error('idempotency_key required');}
      const sk = `${organization_id}|${idempotency_key}`;
      if (seen.has(sk)) {return { recorded: false, duplicate: true };}
      const period = month(now());
      for (const k of [`${organization_id}|${category}`, `${organization_id}|*`]) {
        const b = budgets.get(k); if (!b) {continue;}
        if (b.currency !== currency) {throw new Error(`budget currency is ${b.currency}, got ${currency}`);}
        const cat = k.endsWith('|*') ? undefined : category;
        if (spent(organization_id, cat, period) + amount_minor > b.period_minor) {throw new Error(`budget exceeded for ${k.split('|')[1]}`);}
      }
      seen.add(sk); entries.push({ organization_id, category, amount_minor, currency, period, note: note || null }); return { recorded: true };
    },
    summary(org, period = month(now())) { const by = {}; for (const e of entries) {if (e.organization_id === org && e.period === period) {by[e.category] = (by[e.category] || 0) + e.amount_minor;}} return { period, by_category: by, total_minor: Object.values(by).reduce((a, b) => a + b, 0) }; },
  };
}

const REDACT_KEY = /(token|secret|password|authorization|cookie|api[-_]?key|session|jwt|assertion)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function redactForLog(value, depth = 0) {
  if (depth > 6) {return '[deep]';}
  if (typeof value === 'string') {return value.replace(EMAIL_RE, '[email]').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]').slice(0, 2000);}
  if (Array.isArray(value)) {return value.slice(0, 50).map((v) => redactForLog(v, depth + 1));}
  if (value && typeof value === 'object') {return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT_KEY.test(k) ? '[redacted]' : redactForLog(v, depth + 1)]));}
  return value;
}

/** Structured JSON-lines logger. Every field is redacted (secret-looking keys, emails, bearer tokens); `child` adds fixed fields such as a request id. */
export function createLogger({ service, write = (line) => process.stdout.write(`${line}\n`), now = () => new Date(), level = 'info', base = {} } = {}) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const make = (fixed) => {
    const log = (lvl, msg, fields = {}) => {
      if (order[lvl] < order[level]) {return;}
      write(JSON.stringify({ time: now().toISOString(), level: lvl, service, msg: redactForLog(String(msg)), ...redactForLog({ ...fixed, ...fields }) }));
    };
    return { debug: (m, f) => log('debug', m, f), info: (m, f) => log('info', m, f), warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f), child: (more) => make({ ...fixed, ...more }) };
  };
  return make(base);
}

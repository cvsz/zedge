const month = (d) => d.toISOString().slice(0, 7);
const sum = async (q, category, period) => Number((await q.query(category ? 'SELECT coalesce(sum(amount_minor),0) AS n FROM cost_entries WHERE period = $1 AND category = $2' : 'SELECT coalesce(sum(amount_minor),0) AS n FROM cost_entries WHERE period = $1', category ? [period, category] : [period])).rows[0].n);

/** Persistent cost ledger. Call inside `scoped(...).tx`. Serialises per organization so two concurrent spends cannot both slip under a budget. */
export const costs = {
  setBudget: async (q, { category = '*', period_minor, currency }) => {
    if (!Number.isInteger(period_minor) || period_minor < 0) {throw new Error('budget must be a non-negative integer in minor units');}
    await q.query('INSERT INTO budgets (organization_id, category, period_minor, currency) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, category) DO UPDATE SET period_minor = EXCLUDED.period_minor, currency = EXCLUDED.currency', [q.organizationId, category, period_minor, currency]);
  },
  record: async (q, { category, amount_minor, currency, idempotency_key, note = null }, now = () => new Date()) => {
    if (!Number.isInteger(amount_minor) || amount_minor < 0) {throw new Error('amount_minor must be a non-negative integer');}
    if (!/^[A-Z]{3}$/.test(String(currency))) {throw new Error('currency must be an ISO code');}
    if (!idempotency_key) {throw new Error('idempotency_key required');}
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cost:${q.organizationId}`]);
    if ((await q.query('SELECT 1 FROM cost_entries WHERE idempotency_key = $1', [idempotency_key])).rows.length) {return { recorded: false, duplicate: true };}
    const period = month(now());
    for (const b of (await q.query('SELECT category, period_minor, currency FROM budgets WHERE category = ANY($1::text[])', [[category, '*']])).rows) {
      if (b.currency !== currency) {throw new Error(`budget currency is ${b.currency}, got ${currency}`);}
      const spent = await sum(q, b.category === '*' ? null : b.category, period);
      if (spent + amount_minor > Number(b.period_minor)) {throw new Error(`budget exceeded for ${b.category}`);}
    }
    await q.query('INSERT INTO cost_entries (organization_id, category, amount_minor, currency, period, idempotency_key, note) VALUES ($1,$2,$3,$4,$5,$6,$7)', [q.organizationId, category, amount_minor, currency, period, idempotency_key, note]);
    return { recorded: true };
  },
  summary: async (q, period = month(new Date())) => {
    const by = {}; for (const r of (await q.query('SELECT category, sum(amount_minor) AS n FROM cost_entries WHERE period = $1 GROUP BY category', [period])).rows) {by[r.category] = Number(r.n);}
    return { period, by_category: by, total_minor: Object.values(by).reduce((a, b) => a + b, 0) };
  },
};

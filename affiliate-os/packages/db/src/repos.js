import { hashOf } from './scoped.js';

// Small repositories over a scoped transaction `q`. Columns are listed explicitly; organization_id always comes from `q`.
const one = (r) => r.rows[0];

export const brands = {
  create: async (q, { name, voice = {} }) => one(await q.query('INSERT INTO brands (organization_id, name, voice) VALUES ($1, $2, $3) RETURNING *', [q.organizationId, name, JSON.stringify(voice)])),
  list: async (q) => (await q.query('SELECT * FROM brands WHERE retired_at IS NULL ORDER BY name')).rows,
  retire: async (q, id) => (await q.query('UPDATE brands SET retired_at = now() WHERE id = $1 AND retired_at IS NULL', [id])).affectedRows
};

export const campaigns = {
  create: async (q, { brand_id, name, autonomy_level = 'APPROVAL_REQUIRED', budget_minor = 0, currency = 'THB' }) => one(await q.query('INSERT INTO campaigns (organization_id, brand_id, name, autonomy_level, budget_minor, currency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [q.organizationId, brand_id, name, autonomy_level, budget_minor, currency])),
  list: async (q) => (await q.query('SELECT * FROM campaigns WHERE retired_at IS NULL ORDER BY created_at')).rows
};

export const content = {
  create: async (q, c) => one(await q.query('INSERT INTO content (organization_id, campaign_id, status, language, format, caption, disclosure, claims, autonomy_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [q.organizationId, c.campaign_id || null, c.status || 'IDEA', c.language, c.format, c.caption || null, c.disclosure, JSON.stringify(c.claims || []), c.autonomy_level || 'APPROVAL_REQUIRED'])),
  get: async (q, id) => one(await q.query('SELECT * FROM content WHERE id = $1', [id])),
  list: async (q, { status } = {}) => (await q.query(status ? 'SELECT * FROM content WHERE status = $1 ORDER BY created_at' : 'SELECT * FROM content ORDER BY created_at', status ? [status] : [])).rows,
  /** Only approved content can be scheduled, and only for a future time. */
  schedule: async (q, id, when, now = () => new Date()) => {
    const t = new Date(when);
    if (Number.isNaN(t.getTime())) {throw new Error('scheduled time is not a date');}
    if (t.getTime() <= now().getTime()) {throw new Error('scheduled time must be in the future');}
    return (await q.query("UPDATE content SET status = 'SCHEDULED', scheduled_for = $2, updated_at = now() WHERE id = $1 AND status = 'APPROVED'", [id, t.toISOString()])).affectedRows;
  },
  unschedule: async (q, id) => (await q.query("UPDATE content SET status = 'APPROVED', scheduled_for = NULL, updated_at = now() WHERE id = $1 AND status = 'SCHEDULED'", [id])).affectedRows,
  setStatus: async (q, id, status) => (await q.query('UPDATE content SET status = $2, updated_at = now() WHERE id = $1', [id, status])).affectedRows
};

export const creatives = {
  /** Creatives are immutable. A change is a new row pointing at the one it varies. */
  add: async (q, { content_id, body, variant_of = null }) => one(await q.query('INSERT INTO creatives (organization_id, content_id, variant_of, body, content_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *', [q.organizationId, content_id, variant_of, JSON.stringify(body), hashOf(body)])),
  forContent: async (q, content_id) => (await q.query('SELECT * FROM creatives WHERE content_id = $1 ORDER BY created_at', [content_id])).rows,
  retire: async (q, id) => (await q.query('UPDATE creatives SET retired_at = now() WHERE id = $1 AND retired_at IS NULL', [id])).affectedRows
};

export const links = {
  create: async (q, l) => one(await q.query('INSERT INTO affiliate_links (organization_id, slug, destination, provider, campaign_id, content_id, creative_id, platform, disclosure, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [q.organizationId, l.slug, l.destination, l.provider || 'generic', l.campaign_id || null, l.content_id || null, l.creative_id || null, l.platform || 'other', l.disclosure, l.expires_at || null])),
  list: async (q) => (await q.query('SELECT * FROM affiliate_links WHERE retired_at IS NULL ORDER BY created_at')).rows,
  setEnabled: async (q, id, enabled) => (await q.query('UPDATE affiliate_links SET enabled = $2, updated_at = now() WHERE id = $1', [id, enabled])).affectedRows,
  retire: async (q, id) => (await q.query('UPDATE affiliate_links SET retired_at = now(), enabled = false, updated_at = now() WHERE id = $1 AND retired_at IS NULL', [id])).affectedRows
};

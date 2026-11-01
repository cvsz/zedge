import { bad } from '../errors.js';

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
const unquote = (s) => String(s || '').replace(/^"|"$/g, '').replace(/"\s*"/g, '');

export function registerEmail(app, ctx) {
  const { cf, wrap, need } = ctx;

  /** SPF, DKIM and DMARC status, read from the zone's DNS records. */
  app.get('/api/zones/:zid/email-security', need('read'), wrap(async (req, res) => {
    const zone = (await cf.get(`/zones/${req.params.zid}`)).result;
    const records = await cf.listAll(`/zones/${req.params.zid}/dns_records`);
    const txt = records.filter((r) => r.type === 'TXT').map((r) => ({ name: r.name, id: r.id, content: unquote(r.content) }));
    const spf = txt.find((r) => r.name === zone.name && /^v=spf1\b/i.test(r.content));
    const dmarc = txt.find((r) => r.name === `_dmarc.${zone.name}` && /^v=DMARC1\b/i.test(r.content));
    const dkim = records.filter((r) => r.name.endsWith(`._domainkey.${zone.name}`) && ['TXT', 'CNAME'].includes(r.type)).map((r) => r.name);
    const policy = dmarc && (dmarc.content.match(/\bp=(none|quarantine|reject)\b/i) || [])[1];
    res.json({
      zone: zone.name,
      spf: { found: !!spf, record: spf ? spf.content : null },
      dkim: { found: dkim.length > 0, selectors: dkim },
      dmarc: { found: !!dmarc, record: dmarc ? dmarc.content : null, policy: policy ? policy.toLowerCase() : null }
    });
  }));

  /** Create or update the _dmarc TXT record from a policy choice. */
  app.post('/api/zones/:zid/dmarc', need('email.write'), wrap(async (req, res) => {
    const b = req.body || {};
    if (!['none', 'quarantine', 'reject'].includes(b.policy)) throw bad('Policy must be none, quarantine or reject');
    const pct = b.pct === undefined || b.pct === '' ? 100 : Number(b.pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw bad('Percentage must be 1 to 100');
    const rua = String(b.rua || '').trim();
    if (rua && !EMAIL_RE.test(rua)) throw bad('Report address must be a valid email address');
    const zone = (await cf.get(`/zones/${req.params.zid}`)).result;
    const name = `_dmarc.${zone.name}`;
    const parts = ['v=DMARC1', `p=${b.policy}`];
    if (pct !== 100) parts.push(`pct=${pct}`);
    if (rua) parts.push(`rua=mailto:${rua}`);
    const content = parts.join('; ');
    const existing = ((await cf.get(`/zones/${zone.id}/dns_records`, { type: 'TXT', name })).result || [])[0];
    if (existing) await cf.patch(`/zones/${zone.id}/dns_records/${existing.id}`, { content });
    else await cf.post(`/zones/${zone.id}/dns_records`, { type: 'TXT', name, content, ttl: 1 });
    res.status(existing ? 200 : 201).json({ name, content, updated: !!existing });
  }));
}

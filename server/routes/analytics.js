import { bad } from '../errors.js';

const HOURLY = `query($zone:String!,$since:Time!,$until:Time!){viewer{zones(filter:{zoneTag:$zone}){series:httpRequests1hGroups(limit:200,filter:{datetime_geq:$since,datetime_lt:$until},orderBy:[datetime_ASC]){dimensions{datetime} sum{requests cachedRequests bytes cachedBytes threats}}}}}`;
const DAILY = `query($zone:String!,$since:Date!,$until:Date!){viewer{zones(filter:{zoneTag:$zone}){series:httpRequests1dGroups(limit:100,filter:{date_geq:$since,date_lt:$until},orderBy:[date_ASC]){dimensions{date} sum{requests cachedRequests bytes cachedBytes threats}}}}}`;
const TOP = `query($zone:String!,$since:Time!,$until:Time!,$dim:String!){viewer{zones(filter:{zoneTag:$zone}){series:adaptiveGroups(limit:10,filter:{datetime_geq:$since,datetime_lt:$until},orderBy:[count_DESC]){dimensions{$dim} sum{count}}}}}`;

// Top-list dimension names used by the UI, mapped to GraphQL dimension fields.
const DIM = { path: 'clientRequestPath', country: 'clientCountryName', status: 'edgeResponseStatus', fw_action: 'action', fw_source: 'source' };

const RANGES = { '24h': { hours: 24 }, '7d': { days: 7 }, '30d': { days: 30 } };

export function registerAnalytics(app, ctx) {
  const { cf, wrap, need } = ctx;

  app.get('/api/analytics/:zid/top', need('read'), wrap(async (req, res) => {
    const range = RANGES[req.query.range || '24h'];
    if (!range) {throw bad('range must be 24h, 7d or 30d');}
    const dim = DIM[req.query.by];
    if (!dim) {throw bad('by must be path, country, status, fw_action or fw_source');}
    const now = new Date();
    const since = new Date(now.getTime() - (range.hours ? range.hours * 3600000 : range.days * 86400000));
    const data = await cf.graphql(TOP, { zone: req.params.zid, since: since.toISOString(), until: now.toISOString(), dim });
    const zone = (data && data.viewer && data.viewer.zones && data.viewer.zones[0]) || {};
    const rows = (zone.series || zone.top || []).map((r) => ({ key: (r.dimensions && r.dimensions[dim]) || '', count: (r.sum && r.sum.count) || 0 }));
    res.json({ range: req.query.range || '24h', by: req.query.by, rows });
  }));

  app.get('/api/analytics/:zid', need('read'), wrap(async (req, res) => {
    const range = RANGES[req.query.range || '24h'];
    if (!range) {throw bad('range must be 24h, 7d or 30d');}
    const now = new Date();
    const hourly = !!range.hours;
    const since = new Date(now.getTime() - (range.hours ? range.hours * 3600000 : range.days * 86400000));
    const vars = hourly
      ? { zone: req.params.zid, since: since.toISOString(), until: now.toISOString() }
      : { zone: req.params.zid, since: since.toISOString().slice(0, 10), until: new Date(now.getTime() + 86400000).toISOString().slice(0, 10) };
    const data = await cf.graphql(hourly ? HOURLY : DAILY, vars);
    const rows = ((data.viewer.zones[0] || {}).series) || [];
    const series = rows.map((r) => ({
      t: hourly ? r.dimensions.datetime : r.dimensions.date,
      requests: r.sum.requests, cached: r.sum.cachedRequests, bytes: r.sum.bytes, cachedBytes: r.sum.cachedBytes, threats: r.sum.threats
    }));
    const total = (k) => series.reduce((a, r) => a + (r[k] || 0), 0);
    const totals = { requests: total('requests'), cached: total('cached'), bytes: total('bytes'), cachedBytes: total('cachedBytes'), threats: total('threats') };
    totals.cacheRatio = totals.requests ? totals.cached / totals.requests : 0;
    res.json({ range: req.query.range || '24h', granularity: hourly ? 'hour' : 'day', series, totals });
  }));
}

// One valid example per contract. Tests, docs and other packages use these so examples cannot rot.
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ids = { org: U(1), brand: U(2), campaign: U(3), product: U(4), provider: U(5), creative: U(6), content: U(7), channel: U(8), publication: U(9), approval: U(10), conversion: U(11), commission: U(12), asset: U(13) };
const money = { amount_minor: 12900, currency: 'THB' };
const t = '2026-11-02T10:00:00Z';

export const eventPayloads = {
  ProductDiscovered: { product_id: ids.product, provider_id: ids.provider, title: 'Desk lamp', source: 'manual', url: 'https://merchant.example/lamp', price: money },
  ProductRanked: { product_id: ids.product, score: 0.72, basis: 'modeled', model_version: 'v1' },
  CampaignCreated: { campaign_id: ids.campaign, brand_id: ids.brand, name: 'Autumn lamps', autonomy_level: 'APPROVAL_REQUIRED' },
  CreativeRequested: { creative_id: ids.creative, campaign_id: ids.campaign, product_id: ids.product, format: 'video', language: 'th', requested_by: 'owner' },
  CreativeGenerated: { creative_id: ids.creative, content_id: ids.content, asset_ids: [ids.asset], model: 'local-model', cost: { amount_minor: 40, currency: 'THB' } },
  CreativeApproved: { creative_id: ids.creative, approved_by: 'owner', approval_request_id: ids.approval },
  ContentScheduled: { content_id: ids.content, channel_id: ids.channel, scheduled_for: t, idempotency_key: 'sched-0001-abcd' },
  ContentPublished: { content_id: ids.content, channel_id: ids.channel, publication_id: ids.publication, published_at: t, mode: 'manual' },
  ContentFailed: { content_id: ids.content, channel_id: ids.channel, publication_id: ids.publication, error_code: 'RATE_LIMITED', retryable: true },
  ClickRecorded: { slug: 'lamp-tt', day: '2026-11-02', platform: 'tiktok', country: 'TH', is_bot: false, basis: 'observed' },
  ConversionRecorded: { conversion_id: ids.conversion, provider_id: ids.provider, order_ref: 'ORD-1001', link_slug: 'lamp-tt', amount: money, basis: 'observed', source: 'provider-report' },
  CommissionRecorded: { commission_id: ids.commission, conversion_id: ids.conversion, amount: { amount_minor: 900, currency: 'THB' }, status: 'pending' },
  PerformanceWindowCompleted: { subject_type: 'campaign', subject_id: ids.campaign, window_start: '2026-11-01T00:00:00Z', window_end: t, metrics: { clicks: 120, ctr: 0.031 }, basis: 'observed' },
  OptimizationRequested: { target_type: 'creative', target_id: ids.creative, reason: 'Low click rate after minimum sample', requested_by: 'owner' }
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export const envelope = (type, payload = eventPayloads[type]) => ({ id: U(100), type, version: 1, organization_id: ids.org, occurred_at: t, correlation_id: 'corr-0001-abcd', payload: clone(payload) });

const entityExamples = {
  link: { slug: 'lamp-tt', destination: 'https://merchant.example/lamp?aff=1', provider: 'generic', campaign_id: ids.campaign, platform: 'tiktok', disclosure: 'Affiliate link: I may earn a commission.', enabled: true },
  click: { slug: 'lamp-tt', ts: t, day: '2026-11-02', platform: 'tiktok', country: 'TH', is_bot: false },
  content: { id: ids.content, organization_id: ids.org, campaign_id: ids.campaign, creative_id: ids.creative, status: 'REVIEW', language: 'th-en', format: 'video', caption: 'โคมไฟตั้งโต๊ะ', disclosure: '#ad ลิงก์แอฟฟิลิเอต', claims: [{ text: 'Adjustable arm', product_field: 'specs.arm' }], autonomy_level: 'APPROVAL_REQUIRED' },
  publication: { id: ids.publication, organization_id: ids.org, content_id: ids.content, channel_id: ids.channel, idempotency_key: 'pub-0001-abcd', status: 'SCHEDULED', mode: 'manual', scheduled_for: t },
  'approval-request': { id: ids.approval, organization_id: ids.org, kind: 'publish', subject_type: 'content', subject_id: ids.content, summary: 'Publish lamp video to TikTok', requested_by: 'copywriter-agent', status: 'pending' }
};

export const entities = new Proxy(entityExamples, { get: (o, k) => (k in o ? clone(o[k]) : undefined) });

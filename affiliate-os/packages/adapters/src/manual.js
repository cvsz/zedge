import { mayCallPlatform, statusOf } from './registry.js';

const csvEscape = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** RFC 4180-style parser: quoted fields, escaped quotes, CRLF, embedded newlines. */
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 1; } else {q = false;} } else {f += c;} }
    else if (c === '"') {q = true;}
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') {i += 1;} row.push(f); f = ''; if (row.some((x) => x !== '')) {rows.push(row);} row = []; }
    else {f += c;}
  }
  if (q) {throw new Error('csv: unterminated quote');}
  row.push(f); if (row.some((x) => x !== '')) {rows.push(row);}
  return rows;
}

const RESULT_COLUMNS = ['publication_id', 'observed_at', 'impressions', 'clicks', 'orders', 'commission_minor', 'currency'];

/** Manual adapter: never contacts a platform. Produces a bundle a person posts by hand, and ingests results from CSV. */
export function createManualAdapter() {
  return {
    name: 'manual',
    capabilities: { 'content.publish': 'manual', 'video.publish': 'manual', 'analytics.read': 'manual', 'orders.read': 'manual', 'commissions.read': 'manual' },

    /** Everything a person needs to post by hand, plus a checklist. Throws if the content has no tracked link or no disclosure. */
    prepare({ publication, content, link, disclosure, media = [] }) {
      const problems = [];
      if (!link || !link.tracked_url) {problems.push('missing tracked link');}
      if (!disclosure || !String(disclosure).trim()) {problems.push('missing affiliate disclosure');}
      if (!content || !String(content.caption ?? '').trim()) {problems.push('missing caption');}
      if (problems.length) {throw new Error(`cannot prepare bundle: ${problems.join(', ')}`);}
      const caption = `${disclosure.trim()}\n\n${content.caption.trim()}\n\n${link.tracked_url}`;
      return {
        provider: 'manual', platform_status: statusOf(publication.provider, publication.capability || 'content.publish'), publication_id: publication.id,
        media: media.map((m) => ({ filename: m.filename, sha256: m.sha256 })), caption, disclosure: disclosure.trim(), tracked_url: link.tracked_url,
        checklist: [
          'Open the platform\'s own app or site',
          'Upload the listed media files',
          'Paste the caption exactly as given (disclosure comes first)',
          'Publish, then copy the post URL',
          'Enter the post URL and, later, results through the CSV import',
        ],
        platform_calls: 0,
      };
    },

    /** Results import. Every row stays modelled-basis 'to-verify' unless it validates; rejected rows are reported, never guessed. */
    importResults(csvText, { knownPublicationIds }) {
      const rows = parseCsv(csvText);
      if (!rows.length) {return { accepted: [], rejected: [], error: 'empty file' };}
      const header = rows[0].map((x) => x.trim());
      const missing = RESULT_COLUMNS.filter((c) => !header.includes(c));
      if (missing.length) {return { accepted: [], rejected: [], error: `missing columns: ${missing.join(', ')}` };}
      const idx = Object.fromEntries(header.map((h, i) => [h, i]));
      const accepted = [], rejected = [];
      rows.slice(1).forEach((r, n) => {
        const line = n + 2; const get = (c) => (r[idx[c]] ?? '').trim();
        const errs = [];
        if (!knownPublicationIds.has(get('publication_id'))) {errs.push('unknown publication_id');}
        if (Number.isNaN(Date.parse(get('observed_at')))) {errs.push('observed_at is not a date');}
        const ints = {};
        for (const c of ['impressions', 'clicks', 'orders', 'commission_minor']) { if (!/^\d+$/.test(get(c))) {errs.push(`${c} must be a non-negative integer`);} else {ints[c] = Number(get(c));} }
        if (!/^[A-Z]{3}$/.test(get('currency'))) {errs.push('currency must be an ISO code like USD');}
        if (errs.length) {rejected.push({ line, errors: errs });} else {accepted.push({ publication_id: get('publication_id'), observed_at: new Date(get('observed_at')).toISOString(), ...ints, currency: get('currency'), basis: 'observed', source: 'manual_csv', verification: 'to-verify' });}
      });
      return { accepted, rejected };
    },
    exportCsv(rows) { return [RESULT_COLUMNS.join(','), ...rows.map((r) => RESULT_COLUMNS.map((c) => csvEscape(r[c])).join(','))].join('\n'); },
  };
}

/** Pick an adapter for a provider/capability. Falls back to manual unless the registry says 'verified'. No platform adapters exist yet. */
export function selectAdapter(provider, capability, platformAdapters = {}) {
  if (mayCallPlatform(provider, capability) && platformAdapters[provider]) {return platformAdapters[provider];}
  return createManualAdapter();
}

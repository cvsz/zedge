import { h, fill, api, toast, badge, btn, card, field, empty, confirmAsk, selectOf, fmtDate } from '../lib.js';
import { S, zone, can, header } from '../ctx.js';
import { item } from './kit.js';

const PHASE = { http_request_firewall_custom: 'WAF custom', http_ratelimit: 'Rate limits', http_request_firewall_managed: 'Managed rulesets', http_request_dynamic_redirect: 'Redirects', http_request_cache_settings: 'Cache rules', http_request_transform: 'URL rewrites', http_request_late_transform: 'Request headers', http_response_headers_transform: 'Response headers', http_request_origin: 'Origin overrides' };

function diffView(d) {
  const dns = d.dns;
  const none = !dns.added.length && !dns.removed.length && !dns.changed.length && !Object.keys(d.rules).length;
  if (none) return h('div', { class: 'note' }, 'Nothing has changed since this snapshot.');
  const line = (sign, text, kind) => h('div', { class: 'li' }, badge(sign, kind), h('span', { class: 'mono small' }, text));
  return h('div', { class: 'stack' },
    h('strong', { class: 'small' }, 'DNS'),
    dns.removed.map((r) => line('gone', `${r.type} ${r.name} ${r.content || ''}`, 'bad')),
    dns.added.map((r) => line('new', `${r.type} ${r.name} ${r.content || ''}`, 'ok')),
    dns.changed.map((c) => line('edited', `${c.before.type} ${c.before.name}: proxied ${!!c.before.proxied}→${!!c.after.proxied}, TTL ${c.before.ttl}→${c.after.ttl}`, 'warn')),
    Object.entries(d.rules).map(([ph, x]) => h('div', { class: 'stack' }, h('strong', { class: 'small' }, PHASE[ph] || ph),
      x.removed.map((r) => line('gone', r.description || r.expression, 'bad')), x.added.map((r) => line('new', r.description || r.expression, 'ok')), x.changed.map((c) => line('edited', c.after.description || c.after.expression, 'warn')))));
}

export async function snapshotsView() {
  const z = zone();
  if (!z) return card('', empty('Add a domain first.'));
  const { snapshots } = await api('GET', `zones/${z.id}/snapshots`);
  const out = h('div', { class: 'stack' });
  const note = h('input', { type: 'text', 'aria-label': 'Snapshot note', placeholder: 'Before the migration (optional)' });
  const reload = () => location.reload();

  async function planRestore(s) {
    const scope = selectOf('Restore', [['all', 'DNS and rules'], ['dns', 'DNS only'], ['rules', 'Rules only']], 'all');
    const extra = h('input', { type: 'checkbox', 'aria-label': 'Delete records added since' });
    const preview = h('div', { class: 'stack' });
    const refresh = async () => {
      const r = await api('POST', `zones/${z.id}/snapshots/${s.id}/restore`, { scope: scope.value, deleteExtra: extra.checked });
      const p = r.plan;
      fill(preview, p.dns && h('div', { class: 'mono small' }, `DNS: recreate ${p.dns.create}, revert ${p.dns.update}, ${extra.checked ? `delete ${p.dns.delete}` : `keep ${p.dns.keepExtra} newer`}`),
        p.rules && h('div', { class: 'mono small' }, `Rules reset to the snapshot in: ${p.rules.length ? p.rules.map((x) => PHASE[x] || x).join(', ') : 'nothing to change'}`));
    };
    scope.addEventListener('change', refresh); extra.addEventListener('change', refresh);
    await refresh();
    fill(out, card(`Restore snapshot from ${fmtDate(s.createdAt)}`, h('span', { class: 'small soft' }, 'This is only a preview until you press Apply. Take a fresh snapshot first if you may want to undo it.'),
      h('div', { class: 'row end' }, field('What to restore', scope), h('label', { class: 'row small' }, extra, 'Also delete DNS records added since')), preview,
      h('div', { class: 'row end' }, btn('Apply restore', async () => {
        if (!confirmAsk('Apply this restore to the live zone?')) return;
        const r = await api('POST', `zones/${z.id}/snapshots/${s.id}/restore`, { scope: scope.value, deleteExtra: extra.checked, confirm: true });
        toast(r.failed.length ? `Restored with ${r.failed.length} problem(s): ${r.failed[0].error}` : 'Restored', !!r.failed.length);
        fill(out);
      }, 'danger'), btn('Cancel', async () => fill(out)))));
  }

  const clone = selectOf('Copy settings from', S.zones.filter((x) => x.id !== z.id).map((x) => [x.id, x.name]), '');
  return h('div', { class: 'stack' }, header('Snapshots', `Save, compare and restore the DNS and rules of ${z.name}`),
    card('Take a snapshot', h('span', { class: 'small soft' }, 'Saves all DNS records and every rule list on this console’s disk. Comparing later shows what changed, including edits made outside this console.'),
      h('div', { class: 'row end' }, h('label', { class: 'f' }, 'Note', note), btn('Take snapshot', async () => { await api('POST', `zones/${z.id}/snapshots`, { note: note.value }); toast('Snapshot saved'); reload(); }, 'primary'))),
    card('Snapshots', snapshots.length ? snapshots.map((s) => item(fmtDate(s.createdAt), `${s.by} · ${s.dnsCount} DNS records · ${s.ruleCount} rules${s.note ? ` · ${s.note}` : ''}`,
      btn('Compare to live', async () => { const r = await api('GET', `zones/${z.id}/snapshots/${s.id}/diff`); fill(out, card(`Changes since ${fmtDate(s.createdAt)}`, diffView(r.diff))); }),
      can('snapshots.write') && btn('Restore…', () => planRestore(s)),
      can('snapshots.write') && btn('Delete', async () => { if (!confirmAsk('Delete this snapshot?')) return; await api('DELETE', `zones/${z.id}/snapshots/${s.id}`); toast('Deleted'); reload(); }, 'danger'))) : empty('No snapshots yet.')),
    out,
    card('Export', h('span', { class: 'small soft' }, 'Download this zone’s configuration. The Terraform JSON file also includes your rule lists; run terraform validate and plan before applying it.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: `/api/zones/${z.id}/export?format=json`, download: '' }, 'Download JSON'), h('a', { class: 'btn', href: `/api/zones/${z.id}/export?format=terraform`, download: '' }, 'Download Terraform (DNS)'), h('a', { class: 'btn', href: `/api/zones/${z.id}/export?format=terraform-json`, download: '' }, 'Download Terraform JSON (DNS + rules)'))),
    can('zone.write') && S.zones.length > 1 && card('Clone settings', h('span', { class: 'small soft' }, 'Copies SSL mode, TLS, HTTPS redirect, HTTP/3, Brotli, security level and similar settings from another zone onto this one. DNS and rules are not copied.'),
      h('div', { class: 'row end' }, field('From', clone), btn('Copy settings', async () => {
        if (!confirmAsk(`Overwrite settings on ${z.name} with those from the chosen zone?`)) return;
        const r = await api('POST', `zones/${z.id}/clone-settings`, { from: clone.value });
        toast(r.applied.length ? `Updated: ${r.applied.join(', ')}` : 'Already identical', !!r.failed.length);
      }, 'primary'))));
}

import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, confirmAsk, selectOf } from '../lib.js';
import { S, can } from '../ctx.js';
import { tabbedView, item, table, noAccount, textarea } from './kit.js';

const a = () => S.accountId;

async function kvTab() {
  const nss = (await cf('GET', `/accounts/${a()}/storage/kv/namespaces`)).result || [];
  let sel = localStorage.getItem('zedge.kvNs');
  if (!nss.some((n) => n.id === sel)) sel = nss[0] && nss[0].id;
  const detail = h('div', { class: 'stack' });
  const list = h('div', { class: 'col' });
  const drawList = () => fill(list, nss.length ? nss.map((n) => h('button', { type: 'button', class: 'btn pick', 'aria-pressed': String(n.id === sel), onclick: () => { sel = n.id; localStorage.setItem('zedge.kvNs', n.id); drawList(); show(); } }, n.title)) : empty('No namespaces.'));
  const title = input({ placeholder: 'MY_CACHE', 'aria-label': 'New namespace title' });

  async function show() {
    if (!sel) { fill(detail, empty('Create a namespace first.')); return; }
    if (!can('data.access')) { fill(detail, card('', h('div', { class: 'note' }, 'Reading and editing KV values needs the data.access permission.'))); return; }
    fill(detail, h('div', { class: 'spin' }, 'Loading…'));
    let keys;
    try { keys = (await cf('GET', `/accounts/${a()}/storage/kv/namespaces/${sel}/keys`)).result || []; } catch (e) { fill(detail, card('', h('div', { class: 'err' }, e.message))); return; }
    const key = input({ placeholder: 'key name', 'aria-label': 'Key' });
    const val = textarea({ 'aria-label': 'Value', placeholder: 'Value (text, up to 1 MB)' });
    const ttl = input({ placeholder: 'optional, seconds (60 or more)', 'aria-label': 'Expires after (seconds)' });
    const q = (k) => `kv/${sel}/value?key=${encodeURIComponent(k)}`;
    fill(detail,
      card(`Keys (${keys.length}${keys.length >= 1000 ? '+' : ''})`, keys.length ? keys.slice(0, 200).map((k) => item(k.name, k.expiration ? `expires ${new Date(k.expiration * 1000).toLocaleString()}` : null,
        btn('Edit', async () => { const r = await api('GET', q(k.name)); key.value = k.name; val.value = r.value; key.scrollIntoView({ block: 'center' }); }),
        btn('Delete', async () => { if (!confirmAsk(`Delete key ${k.name}?`)) return; await api('DELETE', q(k.name)); toast('Key deleted'); show(); }, 'danger'))) : empty('No keys.'), keys.length > 200 && h('div', { class: 'note' }, 'Showing the first 200 keys.')),
      card('Add or change a value', field('Key', key), val, h('div', { class: 'row end' }, field('Expires after (optional)', ttl), btn('Save value', async () => {
        await api('PUT', q(key.value), { value: val.value, expirationTtl: ttl.value }); toast('Saved'); show();
      }, 'primary'))));
  }
  drawList();
  await show();
  return h('div', { class: 'grid2' }, h('div', { class: 'narrow' }, card('Namespaces', list,
    can('data.access') && [field('New namespace', title), btn('Create', async () => { await cf('POST', `/accounts/${a()}/storage/kv/namespaces`, { title: title.value.trim() }); toast('Namespace created'); location.reload(); }, 'primary'),
      sel && btn('Delete selected namespace', async () => { const n = nss.find((x) => x.id === sel); if (!confirmAsk(`Delete namespace ${n.title} and ALL its keys? This cannot be undone.`)) return; await cf('DELETE', `/accounts/${a()}/storage/kv/namespaces/${sel}`); toast('Namespace deleted'); location.reload(); }, 'danger')])),
  h('div', { class: 'wide' }, detail));
}

async function d1Tab() {
  const dbs = (await cf('GET', `/accounts/${a()}/d1/database`)).result || [];
  const name = input({ placeholder: 'my-database', 'aria-label': 'New database name' });
  const db = selectOf('Database', dbs.map((d) => [d.uuid, d.name]), dbs[0] && dbs[0].uuid);
  const sql = textarea({ 'aria-label': 'SQL', placeholder: 'SELECT name FROM sqlite_master WHERE type = "table";' });
  const allow = h('input', { type: 'checkbox', 'aria-label': 'Allow changes' });
  const out = h('div');
  return [
    card('D1 databases', dbs.length ? dbs.map((d) => item(d.name, d.uuid, d.num_tables !== undefined && badge(`${d.num_tables} tables`),
      can('data.access') && btn('Delete', async () => { if (!confirmAsk(`Delete database ${d.name} and all its data? This cannot be undone.`)) return; await cf('DELETE', `/accounts/${a()}/d1/database/${d.uuid}`); toast('Database deleted'); location.reload(); }, 'danger'))) : empty('No databases.'),
      can('data.access') && h('div', { class: 'row end' }, field('New database', name), btn('Create', async () => { await cf('POST', `/accounts/${a()}/d1/database`, { name: name.value.trim() }); toast('Database created'); location.reload(); }, 'primary'))),
    can('data.access') && dbs.length > 0 && card('SQL console', h('span', { class: 'small soft' }, 'Reads run as they are. INSERT, UPDATE, DELETE and schema changes need "Allow changes".'), field('Database', db), sql,
      h('label', { class: 'row small' }, allow, 'Allow changes'),
      h('div', { class: 'row end' }, btn('Run', async () => {
        const r = await api('POST', `d1/${db.value}/query`, { sql: sql.value, allowWrite: allow.checked });
        fill(out, r.results.map((x, i) => h('div', { class: 'stack' }, h('span', { class: 'xs mute' }, `Statement ${i + 1}: ${x.rows.length} row(s)${x.meta && x.meta.changes ? `, ${x.meta.changes} changed` : ''}${x.truncated ? ' (first 500 shown)' : ''}`), x.rows.length ? table(x.rows) : empty('No rows returned.'))));
      }, 'primary')), out)
  ];
}

async function queuesTab() {
  const qs = (await cf('GET', `/accounts/${a()}/queues`)).result || [];
  const name = input({ placeholder: 'jobs', 'aria-label': 'Queue name' });
  return card('Queues', qs.length ? qs.map((q) => item(q.queue_name || q.name, q.queue_id || q.id, can('data.access') && btn('Delete', async () => { if (!confirmAsk(`Delete queue ${q.queue_name}? Messages in it are lost.`)) return; await cf('DELETE', `/accounts/${a()}/queues/${q.queue_id || q.id}`); toast('Queue deleted'); location.reload(); }, 'danger'))) : empty('No queues.'),
    can('data.access') && h('div', { class: 'row end' }, field('New queue', name), btn('Create', async () => { await cf('POST', `/accounts/${a()}/queues`, { queue_name: name.value.trim() }); toast('Queue created'); location.reload(); }, 'primary')));
}

async function mediaTab() {
  const [st, im] = await Promise.allSettled([cf('GET', `/accounts/${a()}/stream`), cf('GET', `/accounts/${a()}/images/v1`)]);
  const videos = st.status === 'fulfilled' ? (Array.isArray(st.value.result) ? st.value.result : []) : [];
  const images = im.status === 'fulfilled' ? ((im.value.result && im.value.result.images) || []) : [];
  const del = (path, what) => async () => { if (!confirmAsk(`Delete ${what}? This cannot be undone.`)) return; await cf('DELETE', path); toast('Deleted'); location.reload(); };
  return [
    card('Stream videos', h('span', { class: 'small soft' }, 'Uploading and encoding are done with the Cloudflare dashboard or API; here you can review and remove.'),
      st.status === 'rejected' ? h('div', { class: 'xs mute' }, `Not available: ${st.reason.message}`) : videos.length ? videos.map((v) => item((v.meta && v.meta.name) || v.uid, `${v.uid}${v.duration ? ` · ${Math.round(v.duration)}s` : ''}`, can('data.access') && btn('Delete', del(`/accounts/${a()}/stream/${v.uid}`, `video ${(v.meta && v.meta.name) || v.uid}`), 'danger'))) : empty('No videos.')),
    card('Images', im.status === 'rejected' ? h('div', { class: 'xs mute' }, `Not available: ${im.reason.message}`) : images.length ? images.map((i) => item(i.filename || i.id, i.id, can('data.access') && btn('Delete', del(`/accounts/${a()}/images/v1/${encodeURIComponent(i.id)}`, `image ${i.filename || i.id}`), 'danger'))) : empty('No images.'))
  ];
}

export async function dataView() {
  if (!S.accountId) return noAccount();
  return tabbedView({ title: 'Data', sub: 'KV, D1 and Queues', perm: 'data.access', key: 'zedge.dataTab', tabs: [['kv', 'KV'], ['d1', 'D1'], ['queues', 'Queues'], ['media', 'Stream & Images']], builders: { kv: kvTab, d1: d1Tab, queues: queuesTab, media: mediaTab } });
}

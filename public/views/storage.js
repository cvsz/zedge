import { h, fill, api, apiRaw, cf, toast, badge, btn, card, field, input, empty, confirmAsk, fmtBytes, fmtDate, lines, segmented, selectOf } from '../lib.js';
import { S, header, can } from '../ctx.js';

const METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];

export async function storageView() {
  const a = S.accountId;
  if (!a) {return card('', empty('No Cloudflare account is available to this console.'));}
  const [bR, kvR, d1R, stR] = await Promise.allSettled([
    cf('GET', `/accounts/${a}/r2/buckets`), cf('GET', `/accounts/${a}/storage/kv/namespaces`), cf('GET', `/accounts/${a}/d1/database`), api('GET', 'r2/status')
  ]);
  const buckets = bR.status === 'fulfilled' ? ((bR.value.result && bR.value.result.buckets) || []) : [];
  const status = stR.status === 'fulfilled' ? stR.value : { objectAccess: false };
  let selected = localStorage.getItem('zedge.bucket');
  if (!buckets.some((b) => b.name === selected)) {selected = buckets[0] && buckets[0].name;}
  let tab = 'objects';
  const detail = h('div', { class: 'stack' });
  const list = h('div', { class: 'col' });
  const drawList = () => fill(list, buckets.length ? buckets.map((b) => h('button', { type: 'button', class: 'btn pick mono', 'aria-pressed': String(b.name === selected), onclick: () => { selected = b.name; localStorage.setItem('zedge.bucket', b.name); tab = 'objects'; drawList(); showDetail(); } }, b.name)) : empty(bR.status === 'rejected' ? `Not available: ${bR.reason.message}` : 'No buckets yet.'));

  // ---------------------------------------------------------------- objects
  async function objectsTab(bucket) {
    if (!status.objectAccess) {
      return card('Objects', h('div', { class: 'note' }, 'Object browsing needs an R2 access key. Create one in the Cloudflare dashboard (R2 > Manage API tokens), then set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and restart the console.'));
    }
    let prefix = '';
    const box = h('div');
    const crumbs = h('div', { class: 'crumbs' });
    const fileIn = h('input', { type: 'file', 'aria-label': 'File to upload' });
    const load = async (p = prefix) => {
      prefix = p;
      fill(box, h('div', { class: 'spin' }, 'Loading…'));
      const parts = prefix.split('/').filter(Boolean);
      fill(crumbs, h('button', { type: 'button', onclick: () => load('') }, bucket), parts.map((seg, i) => [h('span', null, '/'), h('button', { type: 'button', onclick: () => load(`${parts.slice(0, i + 1).join('/')}/`) }, seg)]));
      let r;
      try { r = await api('GET', `r2/${bucket}/objects?prefix=${encodeURIComponent(prefix)}`); } catch (e) { fill(box, h('div', { class: 'err' }, e.message)); return; }
      fill(box,
        r.prefixes.map((p2) => h('div', { class: 'li' }, h('button', { type: 'button', class: 'btn link mono', onclick: () => load(p2) }, `📁 ${p2.slice(prefix.length)}`), badge('folder'))),
        r.objects.filter((o) => o.key !== prefix).map((o) => h('div', { class: 'li' },
          h('div', { class: 'col' }, h('span', { class: 'mono' }, o.key.slice(prefix.length)), h('span', { class: 'xs mute' }, `${fmtBytes(o.size)} · ${fmtDate(o.modified)}`)),
          h('div', { class: 'row' },
            h('a', { class: 'btn', href: `/api/r2/${bucket}/object?key=${encodeURIComponent(o.key)}`, download: '' }, 'Download'),
            btn('Delete', async () => { if (!confirmAsk(`Delete ${o.key}?`)) {return;} await api('DELETE', `r2/${bucket}/object?key=${encodeURIComponent(o.key)}`); toast('Deleted'); load(); }, 'danger')))),
        !r.prefixes.length && !r.objects.length && empty('This folder is empty.'),
        r.truncated && h('div', { class: 'note' }, 'Showing the first 200 entries. Use a deeper folder to narrow the list.'));
    };
    await load('');
    return card('Objects', crumbs, box, h('div', { class: 'row end' }, field(`Upload to this folder (max ${fmtBytes(status.maxUploadBytes)})`, fileIn), btn('Upload', async () => {
      const f = fileIn.files[0];
      if (!f) {throw new Error('Choose a file first');}
      if (f.size > status.maxUploadBytes) {throw new Error(`That file is larger than the ${fmtBytes(status.maxUploadBytes)} limit`);}
      await apiRaw('PUT', `r2/${bucket}/object?key=${encodeURIComponent(prefix + f.name)}`, f, { 'x-object-content-type': f.type || 'application/octet-stream' });
      toast(`Uploaded ${f.name}`); fileIn.value = ''; load();
    }, 'primary')));
  }

  // ---------------------------------------------------------------- lifecycle
  async function lifecycleTab(bucket) {
    const path = `/accounts/${a}/r2/buckets/${bucket}/lifecycle`;
    let rules = [];
    try { rules = ((await cf('GET', path)).result || {}).rules || []; } catch (e) { return card('Lifecycle rules', empty(`Not available: ${e.message}`)); }
    const box = h('div');
    const save = async (next) => { await cf('PUT', path, { rules: next }); rules = next; draw(); toast('Lifecycle rules saved'); };
    const draw = () => fill(box, rules.length ? rules.map((r) => h('div', { class: 'li' },
      h('div', { class: 'col' }, h('strong', null, r.id), h('span', { class: 'xs mute' }, [
        `prefix "${(r.conditions && r.conditions.prefix) || ''}"`,
        r.deleteObjectsTransition ? `delete after ${Math.round(r.deleteObjectsTransition.condition.maxAge / 86400)} days` : null,
        r.abortMultipartUploadsTransition ? `abort incomplete uploads after ${Math.round(r.abortMultipartUploadsTransition.condition.maxAge / 86400)} days` : null
      ].filter(Boolean).join(' · '))),
      btn('Delete', async () => { if (!confirmAsk(`Delete rule ${r.id}?`)) {return;} await save(rules.filter((x) => x.id !== r.id)); }, 'danger'))) : empty('No lifecycle rules.'));
    draw();
    const id = input({ placeholder: 'expire-tmp', 'aria-label': 'Rule name' });
    const prefix = input({ placeholder: 'tmp/ (empty = whole bucket)', 'aria-label': 'Prefix' });
    const del = input({ placeholder: '30', 'aria-label': 'Delete after days' });
    const abort = input({ placeholder: '7', 'aria-label': 'Abort incomplete uploads after days' });
    return [card('Lifecycle rules', box), card('Add a lifecycle rule', h('div', { class: 'row end' }, field('Name', id), field('Prefix', prefix), field('Delete objects after (days)', del), field('Abort incomplete uploads after (days)', abort),
      btn('Add rule', async () => {
        const name = id.value.trim();
        if (!name) {throw new Error('Give the rule a name');}
        const delDays = Number(del.value); const abDays = Number(abort.value);
        if (!delDays && !abDays) {throw new Error('Set at least one of the two day counts');}
        if (rules.some((r) => r.id === name)) {throw new Error('A rule with that name already exists');}
        const rule = { id: name, enabled: true, conditions: { prefix: prefix.value.trim() } };
        if (delDays > 0) {rule.deleteObjectsTransition = { condition: { type: 'Age', maxAge: Math.round(delDays * 86400) } };}
        if (abDays > 0) {rule.abortMultipartUploadsTransition = { condition: { type: 'Age', maxAge: Math.round(abDays * 86400) } };}
        await save([...rules, rule]); id.value = ''; prefix.value = ''; del.value = ''; abort.value = '';
      }, 'primary')))];
  }

  // ---------------------------------------------------------------- cors
  async function corsTab(bucket) {
    const path = `/accounts/${a}/r2/buckets/${bucket}/cors`;
    let rules = [];
    try { rules = ((await cf('GET', path)).result || {}).rules || []; } catch { rules = []; }
    const box = h('div');
    const save = async (next) => { if (next.length) {await cf('PUT', path, { rules: next });} else {await cf('DELETE', path);} rules = next; draw(); toast('CORS rules saved'); };
    const draw = () => fill(box, rules.length ? rules.map((r, i) => h('div', { class: 'li' },
      h('div', { class: 'col' }, h('strong', { class: 'mono' }, (r.allowed.origins || []).join(', ')), h('span', { class: 'xs mute' }, `${(r.allowed.methods || []).join(', ')} · headers ${(r.allowed.headers || []).join(', ') || 'none'} · cache ${r.maxAgeSeconds || 0}s`)),
      btn('Delete', async () => { if (!confirmAsk('Delete this CORS rule?')) {return;} await save(rules.filter((_, j) => j !== i)); }, 'danger'))) : empty('No CORS rules. Browsers on other sites cannot read this bucket directly.'));
    draw();
    const origins = input({ placeholder: 'https://example.com, https://app.example.com', 'aria-label': 'Allowed origins' });
    const heads = input({ value: '*', 'aria-label': 'Allowed headers' });
    const age = input({ value: '3600', 'aria-label': 'Max age seconds' });
    const checks = METHODS.map((m) => ({ m, el: h('input', { type: 'checkbox', checked: m === 'GET' }) }));
    return [card('CORS rules', box), card('Add a CORS rule', field('Allowed origins (comma or new line separated; * allows any site)', origins),
      h('div', { class: 'checks' }, checks.map(({ m, el }) => h('label', { class: 'check' }, el, m))),
      h('div', { class: 'row end' }, field('Allowed headers', heads), field('Browser cache (seconds)', age), btn('Add rule', async () => {
        const o = lines(origins.value);
        const methods = checks.filter((c) => c.el.checked).map((c) => c.m);
        if (!o.length) {throw new Error('Enter at least one origin');}
        if (!methods.length) {throw new Error('Choose at least one method');}
        await save([...rules, { allowed: { methods, origins: o, headers: lines(heads.value) }, exposeHeaders: [], maxAgeSeconds: Number(age.value) || 0 }]); origins.value = '';
      }, 'primary')))];
  }

  async function showDetail() {
    if (!selected) { fill(detail, empty('Create a bucket to get started.')); return; }
    const render = async (t) => {
      tab = t;
      const body = h('div', { class: 'stack' }, h('div', { class: 'spin' }, 'Loading…'));
      fill(detail, h('h2', { class: 'mono' }, selected), segmented('Bucket section', [['objects', 'Objects'], ['lifecycle', 'Lifecycle'], ['cors', 'CORS']], tab, (v) => render(v)), body);
      try { fill(body, await ({ objects: objectsTab, lifecycle: lifecycleTab, cors: corsTab })[tab](selected)); } catch (e) { fill(body, card('', h('div', { class: 'err' }, e.message))); }
    };
    await render(tab);
  }

  const nName = input({ placeholder: 'my-bucket', 'aria-label': 'New bucket name' });
  const create = card('Create a bucket', h('span', { class: 'small soft' }, '3-63 characters: lowercase letters, digits, hyphens.'), field('Name', nName), btn('Create bucket', async () => {
    const name = nName.value.trim();
    await cf('POST', `/accounts/${a}/r2/buckets`, { name });
    buckets.push({ name }); selected = name; localStorage.setItem('zedge.bucket', name); nName.value = ''; drawList(); toast(`Created ${name}`); showDetail();
  }, 'primary'));

  const small = (title, res, pick, line) => card(title, res.status === 'rejected' ? empty(`Not available: ${res.reason.message}`) : ((pick(res.value.result) || []).length ? pick(res.value.result).map((x) => h('div', { class: 'li' }, line(x))) : empty('Nothing here yet.')));

  drawList();
  await showDetail();
  return h('div', { class: 'stack' }, header('Storage', 'R2 buckets and objects, with KV and D1 listings'),
    !can('r2.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    h('div', { class: 'split' }, h('div', { class: 'list stack' }, card('R2 buckets', list), create), h('div', { class: 'detail' }, detail)),
    h('div', { class: 'grid2' },
      h('div', { class: 'wide' }, small('KV namespaces', kvR, (r) => r, (x) => [h('strong', { class: 'mono' }, x.title), badge('KV', 'info')])),
      h('div', { class: 'narrow' }, small('D1 databases', d1R, (r) => r, (x) => [h('strong', { class: 'mono' }, x.name), badge('D1', 'info')]))));
}

void selectOf;

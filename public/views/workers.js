import { h, fill, api, cf, toast, badge, btn, card, field, input, empty, confirmAsk, fmtDate } from '../lib.js';
import { S, header, can } from '../ctx.js';

const STARTER = `export default {
  async fetch(request, env, ctx) {
    return new Response("Hello from the edge");
  },
};
`;
const today = () => new Date().toISOString().slice(0, 10);

export async function workersView() {
  const a = S.accountId;
  if (!a) return card('', empty('No Cloudflare account is available to this console.'));
  const scripts = (await cf('GET', `/accounts/${a}/workers/scripts`)).result || [];
  let selected = localStorage.getItem('zedge.worker');
  if (!scripts.some((s) => s.id === selected)) selected = scripts[0] && scripts[0].id;
  const detail = h('div', { class: 'stack' });

  const list = h('div', { class: 'col' });
  const drawList = () => fill(list, scripts.length ? scripts.map((s) => h('button', {
    type: 'button', class: 'btn pick', 'aria-pressed': String(s.id === selected),
    onclick: () => { selected = s.id; localStorage.setItem('zedge.worker', s.id); drawList(); showDetail(); }
  }, s.id)) : empty('No Workers yet. Create one below.'));

  async function showDetail() {
    if (!selected) { fill(detail, empty('Select a Worker, or create a new one.')); return; }
    fill(detail, h('div', { class: 'spin' }, 'Loading…'));
    let d;
    try { d = await api('GET', `workers/${encodeURIComponent(selected)}`); } catch (e) { fill(detail, card('', h('div', { class: 'err' }, e.message))); return; }
    const base = `workers/${encodeURIComponent(selected)}`;
    const reload = () => showDetail();

    // deploy
    const code = h('textarea', { class: 'code', spellcheck: 'false', 'aria-label': 'Worker module code', placeholder: STARTER });
    const date = input({ value: d.compatibilityDate || today(), 'aria-label': 'Compatibility date' });
    const deploy = card(`Deploy to ${d.name}`, h('span', { class: 'small soft' }, 'Uploads a new version of the module and sends all traffic to it. Existing variables, secrets and bindings are kept.'),
      code, h('div', { class: 'row end' }, field('Compatibility date', date), btn('Deploy', async () => {
        await api('POST', `${base}/deploy`, { code: code.value, compatibilityDate: date.value }); toast('Deployed'); code.value = ''; await reload();
      }, 'primary')));

    // versions + rollback
    const live = new Set((d.deployments[0] ? d.deployments[0].versions : []).filter((v) => v.percentage > 0).map((v) => v.id));
    const versions = card('Versions and rollback',
      d.versions.length ? d.versions.map((v) => h('div', { class: 'li' },
        h('div', { class: 'row' }, h('strong', { class: 'mono' }, `v${v.number ?? '?'}`), live.has(v.id) && badge('Live', 'ok'), h('span', { class: 'xs mute' }, fmtDate(v.createdOn))),
        !live.has(v.id) && btn('Roll back to this', async () => {
          if (!confirmAsk(`Send 100% of traffic for ${d.name} back to v${v.number}?`)) return;
          await api('POST', `${base}/rollback`, { versionId: v.id }); toast(`Rolled back to v${v.number}`); await reload();
        }))) : empty('No versions reported.'),
      d.deployments.length > 1 && h('details', null, h('summary', { class: 'small' }, `Deployment history (${d.deployments.length})`),
        d.deployments.slice(0, 20).map((x) => h('div', { class: 'xs mute mono' }, `${fmtDate(x.createdOn)}  ${x.source || ''}  ${x.versions.map((v) => `${v.percentage}%`).join(' / ')}`))));

    // variables
    const vName = input({ placeholder: 'ORIGIN_URL', 'aria-label': 'Variable name' });
    const vVal = input({ placeholder: 'value', 'aria-label': 'Variable value' });
    const vars = card('Variables', h('span', { class: 'small soft' }, 'Plain-text values, visible to anyone who can view this Worker. Setting an existing name updates it.'),
      d.vars.length ? d.vars.map((v) => h('div', { class: 'li' }, h('div', { class: 'col' }, h('strong', { class: 'mono' }, v.name), h('span', { class: 'mono xs mute' }, v.value)),
        h('div', { class: 'row' }, btn('Edit', () => { vName.value = v.name; vVal.value = v.value; vVal.focus(); }),
          btn('Delete', async () => { if (!confirmAsk(`Delete variable ${v.name}?`)) return; await api('DELETE', `${base}/vars/${v.name}`); toast('Variable deleted'); await reload(); }, 'danger')))) : empty('No variables.'),
      h('div', { class: 'row end' }, field('Name', vName), field('Value', vVal), btn('Set variable', async () => {
        await api('PUT', `${base}/vars/${vName.value.trim()}`, { value: vVal.value }); toast('Variable saved'); await reload();
      }, 'primary')));

    // secrets
    const sName = input({ placeholder: 'API_KEY', 'aria-label': 'Secret name' });
    const sVal = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Secret value' });
    const secrets = card('Secrets', h('span', { class: 'small soft' }, 'Encrypted. Values can be set or replaced here but are never shown again.'),
      d.secrets.length ? d.secrets.map((s) => h('div', { class: 'li' }, h('span', { class: 'mono' }, s),
        btn('Delete', async () => { if (!confirmAsk(`Delete secret ${s}?`)) return; await api('DELETE', `${base}/secrets/${s}`); toast('Secret deleted'); await reload(); }, 'danger'))) : empty('No secrets.'),
      h('div', { class: 'row end' }, field('Name', sName), field('Value', sVal), btn('Set secret', async () => {
        await api('PUT', `${base}/secrets/${sName.value.trim()}`, { value: sVal.value }); sVal.value = ''; toast('Secret saved'); await reload();
      }, 'primary')));

    const others = d.otherBindings.length ? card('Other bindings', h('span', { class: 'small soft' }, 'KV, R2, D1 and service bindings are kept as they are. Edit them in the dashboard or wrangler.'),
      d.otherBindings.map((b) => h('div', { class: 'li' }, h('span', { class: 'mono' }, b.name), badge(b.type, 'info')))) : null;

    fill(detail, h('div', { class: 'row between' }, h('h2', null, d.name), d.compatibilityDate && badge(`compat ${d.compatibilityDate}`)), deploy, versions, vars, secrets, others);
  }

  const nName = input({ placeholder: 'my-worker', 'aria-label': 'New Worker name' });
  const create = card('Create a Worker', field('Name', nName), btn('Create with starter code', async () => {
    const name = nName.value.trim();
    await api('POST', `workers/${encodeURIComponent(name)}/deploy`, { code: STARTER, compatibilityDate: today() });
    scripts.push({ id: name }); selected = name; localStorage.setItem('zedge.worker', name); nName.value = ''; drawList(); toast(`Created ${name}`); showDetail();
  }, 'primary'));

  drawList();
  await showDetail();
  return h('div', { class: 'stack' }, header('Workers', 'Deploy code, roll back, and manage variables and secrets'),
    !can('workers.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    h('div', { class: 'split' }, h('div', { class: 'list stack' }, card('Workers', list), create), h('div', { class: 'detail' }, detail)));
}

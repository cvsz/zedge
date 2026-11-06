import { h, fill, cf, toast, badge, btn, card, field, input, empty, confirmAsk, fmtDate, selectOf } from '../lib.js';
import { S, header, can } from '../ctx.js';
import { item, noAccount } from './kit.js';

export async function pagesView() {
  const a = S.accountId;
  if (!a) {return noAccount();}
  const projects = (await cf('GET', `/accounts/${a}/pages/projects`)).result || [];
  let selected = localStorage.getItem('zedge.pagesProject');
  if (!projects.some((p) => p.name === selected)) {selected = projects[0] && projects[0].name;}
  const detail = h('div', { class: 'stack' });
  const list = h('div', { class: 'col' });
  const drawList = () => fill(list, projects.length ? projects.map((p) => h('button', { type: 'button', class: 'btn pick mono', 'aria-pressed': String(p.name === selected), onclick: () => { selected = p.name; localStorage.setItem('zedge.pagesProject', p.name); drawList(); show(); } }, p.name)) : empty('No Pages projects in this account.'));

  async function show() {
    if (!selected) { fill(detail, empty('Select a project.')); return; }
    fill(detail, h('div', { class: 'spin' }, 'Loading…'));
    const base = `/accounts/${a}/pages/projects/${encodeURIComponent(selected)}`;
    let project; let deps; let doms;
    try {
      [project, deps, doms] = await Promise.all([cf('GET', base), cf('GET', `${base}/deployments`), cf('GET', `${base}/domains`)]);
    } catch (e) { fill(detail, card('', h('div', { class: 'err' }, e.message))); return; }
    const reload = () => show();
    const p = project.result;

    const deployments = card('Deployments', h('span', { class: 'small soft' }, 'Roll back sends production traffic to an earlier production deployment. Retry runs a failed build again.'),
      (deps.result || []).length ? deps.result.slice(0, 15).map((d) => item(d.id, `${d.environment || ''} · ${fmtDate(d.created_on)}${d.latest_stage ? ` · ${d.latest_stage.name}: ${d.latest_stage.status}` : ''}`,
        d.latest_stage && badge(d.latest_stage.status, d.latest_stage.status === 'success' ? 'ok' : d.latest_stage.status === 'failure' ? 'bad' : 'warn'),
        btn('Retry', async () => { await cf('POST', `${base}/deployments/${d.id}/retry`, {}); toast('Retry started'); await reload(); }),
        d.environment === 'production' && btn('Roll back to this', async () => {
          if (!confirmAsk(`Send production traffic for ${selected} back to deployment ${d.id}?`)) {return;}
          await cf('POST', `${base}/deployments/${d.id}/rollback`, {}); toast('Rolled back'); await reload();
        }, 'danger'))) : empty('No deployments yet.'));

    const dom = input({ placeholder: 'docs.example.com', 'aria-label': 'Custom domain' });
    const domains = card('Custom domains', (doms.result || []).length ? doms.result.map((d) => item(d.name, null, badge(d.status || 'pending', d.status === 'active' ? 'ok' : 'warn'),
      btn('Remove', async () => { if (!confirmAsk(`Remove ${d.name} from ${selected}?`)) {return;} await cf('DELETE', `${base}/domains/${encodeURIComponent(d.name)}`); toast('Domain removed'); await reload(); }, 'danger'))) : empty('No custom domains.'),
      h('div', { class: 'row end' }, field('Add a domain', dom), btn('Add', async () => { await cf('POST', `${base}/domains`, { name: dom.value.trim().toLowerCase() }); toast('Domain added. It may take a few minutes to validate.'); await reload(); }, 'primary')));

    const env = selectOf('Environment', [['production', 'Production'], ['preview', 'Preview']], 'production');
    const vName = input({ placeholder: 'API_URL', 'aria-label': 'Variable name' });
    const vVal = input({ placeholder: 'value', 'aria-label': 'Variable value' });
    const setVar = (e, name, value) => cf('PATCH', base, { deployment_configs: { [e]: { env_vars: { [name]: value } } } });
    const vars = card('Environment variables', h('span', { class: 'small soft' }, 'Plain-text values only. Secrets are not shown here and are never changed by this form.'),
      ['production', 'preview'].map((e) => {
        const ev = (p.deployment_configs && p.deployment_configs[e] && p.deployment_configs[e].env_vars) || {};
        return h('div', { class: 'col' }, h('strong', { class: 'small' }, e), Object.keys(ev).length ? Object.entries(ev).map(([k, v]) => item(k, v && v.type === 'plain_text' ? v.value : '(secret)',
          btn('Delete', async () => { if (!confirmAsk(`Delete ${k} from ${e}?`)) {return;} await setVar(e, k, null); toast('Variable deleted'); await reload(); }, 'danger'))) : empty('None.'));
      }),
      h('div', { class: 'row end' }, field('Environment', env), field('Name', vName), field('Value', vVal),
        btn('Set variable', async () => { if (!vName.value.trim()) {throw new Error('Enter a variable name');} await setVar(env.value, vName.value.trim(), { type: 'plain_text', value: vVal.value }); toast('Variable saved. It applies to the next deployment.'); await reload(); }, 'primary')));

    fill(detail, h('div', { class: 'row' }, h('strong', null, p.name), p.subdomain && h('span', { class: 'mono xs mute' }, p.subdomain), p.production_branch && badge(`branch ${p.production_branch}`)), deployments, domains, vars);
  }
  const newName = input({ placeholder: 'my-site', 'aria-label': 'New project name' });
  const newBranch = input({ value: 'main', 'aria-label': 'Production branch' });
  const create = can('pages.write') && card('Create a project', h('span', { class: 'small soft' }, 'Creates an empty project you can deploy to with Wrangler (wrangler pages deploy). Connecting a Git repository is done in the Cloudflare dashboard.'),
    h('div', { class: 'row end' }, field('Name (lowercase letters, digits, hyphens)', newName), field('Production branch', newBranch),
      btn('Create project', async () => { await cf('POST', `/accounts/${a}/pages/projects`, { name: newName.value.trim().toLowerCase(), production_branch: newBranch.value.trim() || 'main' }); localStorage.setItem('zedge.pagesProject', newName.value.trim().toLowerCase()); toast('Project created'); location.reload(); }, 'primary')));
  drawList();
  await show();
  return h('div', { class: 'stack' }, header('Pages', 'Projects, deployments, rollback, custom domains and variables'),
    !can('pages.write') && h('div', { class: 'note' }, 'Your role is read-only here.'),
    h('div', { class: 'grid2' }, h('div', { class: 'narrow' }, card('Projects', list)), h('div', { class: 'wide' }, detail)), create);
}

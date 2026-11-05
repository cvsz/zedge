import { h, api, apiRaw, toast, badge, btn, card, empty, confirmAsk, fmtDate } from '../lib.js';
import { header } from '../ctx.js';
import { item } from './kit.js';

const kind = (s) => ({ pending: 'warn', approved: 'ok', rejected: 'bad', used: 'mute', expired: 'mute', cancelled: 'mute' }[s] || 'mute');

/** Repeat the stored request with the approval id. Only the requester can do this, once. */
async function runApproved(a) {
  const hasBody = a.body !== null && a.body !== undefined;
  const res = await fetch(a.path, {
    method: a.method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zedge', 'X-Approval-Id': a.id },
    body: hasBody ? JSON.stringify(a.body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((json && json.error) || `Request failed (${res.status})`);
}

export async function approvalsView() {
  const r = await api('GET', 'approvals');
  const reload = () => location.reload();
  const decide = (a, approve) => async () => {
    if (!confirmAsk(`${approve ? 'Approve' : 'Reject'} “${a.label}” requested by ${a.requester}?\n\n${a.method} ${a.path}`)) return;
    await api('POST', `approvals/${a.id}/decide`, { approve }); toast(approve ? 'Approved. They have 30 minutes to run it.' : 'Rejected'); reload();
  };
  return h('div', { class: 'stack' }, header('Approvals', 'Risky actions that need a second person'),
    !r.enabled && h('div', { class: 'note' }, 'Approvals are switched off (APPROVAL_REQUIRED is not set), so risky actions run immediately. Anything already listed below is from when they were on.'),
    r.canDecide && card('Waiting for you', r.toDecide.length ? r.toDecide.map((a) => item(a.label, `${a.requester} · ${fmtDate(a.createdAt)} · ${a.method} ${a.path}${a.body ? ` ${JSON.stringify(a.body).slice(0, 160)}` : ''}`,
      btn('Approve', decide(a, true), 'primary'), btn('Reject', decide(a, false), 'danger'))) : empty('Nothing is waiting for your decision.')),
    card('Your requests', r.mine.length ? r.mine.map((a) => item(a.label, `${fmtDate(a.createdAt)}${a.decidedBy ? ` · ${a.status} by ${a.decidedBy}${a.note ? `: ${a.note}` : ''}` : ''}${a.status === 'approved' ? ` · run before ${fmtDate(a.expiresAt)}` : ''}`,
      badge(a.status, kind(a.status)),
      a.status === 'approved' && btn('Run now', async () => { await runApproved(a); toast('Done'); reload(); }, 'primary'),
      ['pending', 'approved'].includes(a.status) && btn('Cancel', async () => { await api('POST', `approvals/${a.id}/cancel`); toast('Cancelled'); reload(); }))) : empty('You have not asked for anything yet.')));
}
void apiRaw;

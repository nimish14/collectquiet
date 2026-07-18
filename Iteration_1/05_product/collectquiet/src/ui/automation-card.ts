import { escapeHtml } from '../lib/escape';
import type { AutomationSnapshot } from '../lib/collections-client';
import type { Invoice } from '../types';
import {
  formatLocalSchedule,
  labelAutomationStatus,
  labelEventType,
  statusBadgeClass,
  STEP_STATUS_LABELS,
} from './automation-helpers';

/** Soft notice while email delivery is still in pilot. */
const EMAIL_TEST_TIP = `
  <p class="auto-tip" role="note">
    <strong>Email delivery is in early access.</strong> You can still preview messages and test the complete reminder workflow.
  </p>`;

export function automationCardHtml(opts: {
  invoice: Invoice | null;
  snapshot: AutomationSnapshot | null;
  loading: boolean;
  error: string | null;
  showTimeline: boolean;
}): string {
  if (!opts.invoice) {
    return `<div class="panel auto-card"><h3>Automatic follow-ups</h3><p class="muted">Select an invoice to see automation status.</p></div>`;
  }
  if (opts.loading) {
    return `<div class="panel auto-card" aria-busy="true"><h3>Automatic follow-ups</h3><p class="muted">Loading automation…</p></div>`;
  }
  if (opts.error) {
    return `<div class="panel auto-card"><h3>Automatic follow-ups</h3><p class="form-error" role="alert">${escapeHtml(opts.error)}</p><button class="btn btn-sm" data-auto-reload>Retry</button></div>`;
  }

  const snap = opts.snapshot;
  if (!snap?.automation) {
    return `
    <div class="panel auto-card">
      <h3>Automatic follow-ups</h3>
      <p class="muted">No automation for this invoice yet.</p>
      ${EMAIL_TEST_TIP}
      <div class="auto-actions">
        <button class="btn btn-sm btn-primary" data-auto-setup>Set up automatic follow-ups</button>
      </div>
    </div>`;
  }

  const a = snap.automation;
  const pending = snap.steps
    .filter((s) => s.status === 'pending' || s.status === 'retry_scheduled')
    .sort((x, y) => new Date(x.scheduledAt).getTime() - new Date(y.scheduledAt).getTime());
  const next = pending[0] ?? null;
  const lastSent = [...snap.steps]
    .filter((s) => s.sentAt)
    .sort((x, y) => new Date(y.sentAt!).getTime() - new Date(x.sentAt!).getTime())[0];
  const currentTone = next?.tone ?? lastSent?.tone ?? '—';

  const lastMsgStatus = lastSent
    ? `${STEP_STATUS_LABELS[lastSent.status] ?? lastSent.status}${lastSent.lastErrorCode ? ` (${lastSent.lastErrorCode})` : ''}`
    : 'None sent yet';

  const lastReply = snap.lastInbound
    ? `${snap.lastInbound.classification ?? 'reply'} · ${new Date(snap.lastInbound.receivedAt).toLocaleString()}`
    : 'No reply yet';

  const promise = snap.promise
    ? `${snap.promise.status}${snap.promise.promisedPaymentDate ? ` · ${snap.promise.promisedPaymentDate}` : ''}${snap.promise.approvedByUser ? '' : ' · awaiting approval'}`
    : 'None';

  const timeline = opts.showTimeline
    ? snap.events.length
      ? `<ol class="auto-timeline" aria-label="Automation audit timeline">
          ${snap.events
            .slice()
            .reverse()
            .map(
              (e) => `<li>
                <time datetime="${escapeHtml(e.occurredAt)}">${escapeHtml(new Date(e.occurredAt).toLocaleString())}</time>
                <strong>${escapeHtml(labelEventType(e.eventType))}</strong>
              </li>`
            )
            .join('')}
        </ol>`
      : '<p class="muted">No timeline events yet.</p>'
    : '';

  const terminal = a.status === 'completed' || a.status === 'cancelled';
  const disputed =
    snap.collectionStatus === 'disputed' || a.stopReason === 'dispute';
  const canChase = opts.invoice.status !== 'paid' && !disputed;

  return `
  <div class="panel auto-card">
    <div class="auto-card-head">
      <h3>Automatic follow-ups</h3>
      <span class="badge ${statusBadgeClass(a.status)}" aria-label="Status: ${escapeHtml(labelAutomationStatus(a.status))}">${escapeHtml(labelAutomationStatus(a.status))}</span>
      ${disputed ? '<span class="badge badge-warn">Disputed</span>' : ''}
    </div>
    ${disputed ? `<p class="attention-banner" role="status">This invoice is marked disputed. Pending reminders were cancelled. Resume only if you intentionally want to chase again.</p>` : ''}
    ${snap.needsAttention ? `<p class="attention-banner" role="status"><span class="badge badge-warn">Needs attention</span> Open Needs Attention for the recommended next step.</p>` : ''}
    ${EMAIL_TEST_TIP}
    <dl class="auto-meta">
      <div><dt>Next scheduled reminder</dt><dd>${next ? escapeHtml(formatLocalSchedule(next.scheduledAt, a.timezone)) : 'None'}</dd></div>
      <div><dt>Current tone</dt><dd>${escapeHtml(String(currentTone))}</dd></div>
      <div><dt>Channel</dt><dd>${escapeHtml(a.channel)}</dd></div>
      <div><dt>Last message status</dt><dd>${escapeHtml(lastMsgStatus)}</dd></div>
      <div><dt>Last client response</dt><dd>${escapeHtml(lastReply)}</dd></div>
      <div><dt>Payment promise</dt><dd>${escapeHtml(promise)}</dd></div>
    </dl>
    <div class="auto-actions" role="group" aria-label="Automation actions">
      ${a.status === 'active' && !disputed ? '<button class="btn btn-sm" data-auto-pause>Pause</button>' : ''}
      ${(a.status === 'paused' || a.status === 'awaiting_user') && !disputed ? '<button class="btn btn-sm btn-primary" data-auto-resume>Resume</button>' : ''}
      ${disputed && (a.status === 'paused' || a.status === 'awaiting_user') ? '<button class="btn btn-sm btn-primary" data-auto-resume>Resume after dispute</button>' : ''}
      ${!terminal && !disputed ? '<button class="btn btn-sm" data-auto-edit>Edit future reminders</button>' : ''}
      ${next && !disputed ? '<button class="btn btn-sm" data-auto-skip>Skip next reminder</button>' : ''}
      ${next && !disputed ? '<button class="btn btn-sm" data-auto-send-now>Send now</button>' : ''}
      ${!terminal ? '<button class="btn btn-sm btn-ghost" data-auto-cancel>Cancel automation</button>' : ''}
      ${canChase ? '<button class="btn btn-sm btn-ok" data-auto-mark-paid>Mark paid</button>' : ''}
      ${canChase ? '<button class="btn btn-sm btn-ghost" data-auto-dispute>Mark disputed</button>' : ''}
      ${!terminal ? '<button class="btn btn-sm" data-auto-log-reply>Log client reply</button>' : ''}
      ${terminal ? '<button class="btn btn-sm btn-primary" data-auto-restart>Restart automation</button>' : ''}
      <button class="btn btn-sm btn-ghost" data-auto-toggle-timeline>${opts.showTimeline ? 'Hide' : 'View'} audit history</button>
    </div>
    ${timeline}
  </div>`;
}

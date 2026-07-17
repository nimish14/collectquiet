import { escapeHtml } from '../lib/escape';
import type { PlannedUiStep } from '../lib/collections-client';
import type { Invoice } from '../types';
import { WHATSAPP_CHANNEL_SUPPORTED } from './automation-helpers';

export function automationSetupModalHtml(opts: {
  open: boolean;
  invoice: Invoice | null;
  enabled: boolean;
  channel: 'email';
  timezone: string;
  userTimezone: string;
  clientTimezone: string | null;
  steps: PlannedUiStep[];
  previewIndex: number | null;
  firmApproved: boolean;
  busy: boolean;
  error: string | null;
  currency: string;
  mode: 'setup' | 'edit';
}): string {
  if (!opts.open || !opts.invoice) return '';
  const inv = opts.invoice;
  const preview =
    opts.previewIndex != null && opts.steps[opts.previewIndex]
      ? opts.steps[opts.previewIndex]
      : null;

  const stepCards = opts.steps
    .map((step, index) => {
      const firm = step.tone === 'firm' || step.tone === 'final' || step.requireApproval;
      return `
      <fieldset class="auto-step" data-step-index="${index}">
        <legend>Reminder ${index + 1}${firm ? ' <span class="badge badge-warn">Needs approval</span>' : ''}</legend>
        <div class="auto-step-grid">
          <label>Date &amp; time
            <input name="scheduledAtLocal-${index}" type="datetime-local" value="${escapeHtml(step.scheduledAtLocal)}" required ${opts.enabled ? '' : 'disabled'} />
          </label>
          <label>Tone
            <select name="tone-${index}" ${opts.enabled ? '' : 'disabled'}>
              ${(['friendly', 'direct', 'firm', 'final'] as const)
                .map(
                  (t) =>
                    `<option value="${t}" ${step.tone === t ? 'selected' : ''}>${t}</option>`
                )
                .join('')}
            </select>
          </label>
        </div>
        <label>Subject
          <input name="subject-${index}" value="${escapeHtml(step.subject)}" required ${opts.enabled ? '' : 'disabled'} />
        </label>
        <label>Body
          <textarea name="body-${index}" rows="5" required ${opts.enabled ? '' : 'disabled'}>${escapeHtml(step.body)}</textarea>
        </label>
        <div class="auto-step-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-preview-step="${index}">Preview</button>
          <button type="button" class="btn btn-sm btn-ghost" data-remove-step="${index}" ${opts.steps.length <= 1 || !opts.enabled ? 'disabled' : ''}>Remove</button>
        </div>
      </fieldset>`;
    })
    .join('');

  return `
  <div class="modal-backdrop" data-close-auto-setup>
    <div class="modal modal-xl" role="dialog" aria-labelledby="auto-setup-title" data-modal-inner>
      <h2 id="auto-setup-title">${opts.mode === 'edit' ? 'Edit future reminders' : 'Set up automatic follow-ups'}</h2>
      <p class="muted">For <strong>${escapeHtml(inv.invoiceNumber)}</strong> · ${escapeHtml(inv.clientName)}. Automation stays off until you confirm activation.</p>
      ${opts.error ? `<p class="form-error" role="alert">${escapeHtml(opts.error)}</p>` : ''}
      <form id="auto-setup-form" class="auto-setup-form">
        <label class="auto-toggle">
          <input type="checkbox" name="enabled" ${opts.enabled ? 'checked' : ''} />
          <span>Enable automatic follow-ups for this invoice</span>
        </label>

        <fieldset class="auto-fieldset" ${opts.enabled ? '' : 'disabled'}>
          <legend class="sr-only">Channel and timezone</legend>
          <label>Channel
            <select name="channel">
              <option value="email" selected>Email</option>
              ${WHATSAPP_CHANNEL_SUPPORTED ? '<option value="whatsapp">WhatsApp</option>' : '<option value="whatsapp" disabled>WhatsApp (coming soon)</option>'}
            </select>
          </label>
          <label>Your timezone
            <input name="timezone" value="${escapeHtml(opts.timezone)}" required />
          </label>
          <p class="muted tiny">Detected: ${escapeHtml(opts.userTimezone)}${opts.clientTimezone ? ` · Client: ${escapeHtml(opts.clientTimezone)}` : ''}</p>
        </fieldset>

        <div class="auto-steps" ${opts.enabled ? '' : 'aria-disabled="true"'}>
          ${stepCards}
        </div>
        <div class="auto-step-toolbar">
          <button type="button" class="btn btn-sm" data-add-step ${opts.enabled ? '' : 'disabled'}>+ Add reminder</button>
          <button type="button" class="btn btn-sm btn-ghost" data-test-email ${opts.enabled ? '' : 'disabled'}>Send test to myself</button>
        </div>

        <label class="auto-toggle">
          <input type="checkbox" name="firmApproved" ${opts.firmApproved ? 'checked' : ''} ${opts.enabled ? '' : 'disabled'} />
          <span>I approve firm / final reminders before they can send</span>
        </label>

        ${
          preview
            ? `<div class="email-preview" aria-live="polite">
                <p class="preview-meta">Preview · Reminder ${(opts.previewIndex ?? 0) + 1} · <span class="badge badge-neutral">${escapeHtml(preview.tone)}</span></p>
                <div class="email-subject">Subject: ${escapeHtml(preview.subject)}</div>
                <pre>${escapeHtml(preview.body)}</pre>
              </div>`
            : ''
        }

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close-auto-setup>Not now</button>
          ${
            opts.mode === 'edit'
              ? `<button type="submit" class="btn btn-primary" ${opts.busy || !opts.enabled ? 'disabled' : ''}>${opts.busy ? 'Saving…' : 'Save reminders'}</button>`
              : `<button type="submit" class="btn btn-primary" ${opts.busy ? 'disabled' : ''}>${opts.busy ? 'Working…' : opts.enabled ? 'Review &amp; continue' : 'Skip automation'}</button>`
          }
        </div>
      </form>
    </div>
  </div>`;
}

export function activationSummaryModalHtml(opts: {
  open: boolean;
  invoice: Invoice | null;
  steps: PlannedUiStep[];
  timezone: string;
  channel: string;
  senderName: string;
  senderEmail: string;
  replyToHint: string;
  currency: string;
  locale: string;
  busy: boolean;
  error: string | null;
  formatMoney: (n: number, currency: string, locale: string) => string;
  formatDate: (d: string, locale?: string) => string;
}): string {
  if (!opts.open || !opts.invoice) return '';
  const inv = opts.invoice;
  const schedule = opts.steps
    .map((s, i) => {
      const localLabel = s.scheduledAtLocal.replace('T', ' ');
      return `<li>
          <strong>Step ${i + 1}</strong>
          <span class="badge badge-neutral">${escapeHtml(s.tone)}</span>
          <span>${escapeHtml(localLabel)} (${escapeHtml(opts.timezone)})</span>
          <div class="muted tiny">${escapeHtml(s.subject)}</div>
        </li>`;
    })
    .join('');

  return `
  <div class="modal-backdrop" data-close-activation>
    <div class="modal modal-lg" role="dialog" aria-labelledby="activation-title" data-modal-inner>
      <h2 id="activation-title">Confirm automatic follow-ups</h2>
      ${opts.error ? `<p class="form-error" role="alert">${escapeHtml(opts.error)}</p>` : ''}
      <dl class="activation-summary">
        <div><dt>Client</dt><dd>${escapeHtml(inv.clientName)} · ${escapeHtml(inv.clientEmail)}</dd></div>
        <div><dt>Invoice</dt><dd>${escapeHtml(inv.invoiceNumber)}</dd></div>
        <div><dt>Amount</dt><dd>${escapeHtml(opts.formatMoney(inv.amount, opts.currency, opts.locale))}</dd></div>
        <div><dt>Due date</dt><dd>${escapeHtml(opts.formatDate(inv.dueAt, opts.locale))}</dd></div>
        <div><dt>Sender</dt><dd>${escapeHtml(opts.senderName)} &lt;${escapeHtml(opts.senderEmail)}&gt;</dd></div>
        <div><dt>Reply-to</dt><dd>${escapeHtml(opts.replyToHint)}</dd></div>
        <div><dt>Channel</dt><dd>${escapeHtml(opts.channel)}</dd></div>
      </dl>
      <h3>Complete reminder schedule</h3>
      <ul class="activation-schedule">${schedule}</ul>
      <h3>What causes automatic pausing</h3>
      <ul class="muted-list">
        <li>Client replies to a reminder</li>
        <li>Invoice is marked paid</li>
        <li>Client disputes the invoice</li>
        <li>Delivery permanently fails or contact opts out</li>
      </ul>
      <h3>When the client replies</h3>
      <p class="muted">Follow-ups pause automatically. You review the reply in Needs Attention before anything else sends.</p>
      <h3>When the invoice is marked paid</h3>
      <p class="muted">Automation completes and all pending reminders are cancelled. Nothing further is sent.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-back-to-setup>Back</button>
        <button type="button" class="btn btn-primary" data-confirm-activate ${opts.busy ? 'disabled' : ''}>
          ${opts.busy ? 'Starting…' : 'Start automatic follow-ups'}
        </button>
      </div>
    </div>
  </div>`;
}

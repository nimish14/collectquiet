/**
 * Pure helpers for collections automation UI (testable without DOM).
 */

import type { AppSettings, Invoice, ReminderStep } from '../types';
import { renderTemplate } from '../utils';
import type { PlannedUiStep } from '../lib/collections-client';

export const WHATSAPP_CHANNEL_SUPPORTED = false;

export const AUTOMATION_STATUS_LABELS: Record<string, string> = {
  inactive: 'Draft — not started',
  active: 'Active',
  paused: 'Paused',
  awaiting_user: 'Needs your action',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: 'Scheduled',
  processing: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
  retry_scheduled: 'Retry scheduled',
};

export const EVENT_LABELS: Record<string, string> = {
  automation_created: 'Automation created',
  automation_activated: 'Automation activated',
  reminder_scheduled: 'Reminder scheduled',
  reminder_claimed: 'Reminder claimed for send',
  reminder_sent: 'Reminder sent',
  reminder_failed: 'Send failed',
  retry_scheduled: 'Retry scheduled',
  reminders_skipped: 'Reminder skipped',
  reminder_dry_run: 'Dry-run reminder logged',
  delivery_status_updated: 'Delivery result',
  automation_paused: 'Automatic pause',
  automation_resumed: 'Automation resumed',
  automation_cancelled: 'Automation cancelled',
  automation_completed: 'Automation completed',
  inbound_reply_received: 'Client reply',
  reply_classified: 'Classification',
  inbound_unmatched: 'Unmatched reply',
  needs_attention: 'Needs attention',
  invoice_marked_paid: 'Payment recorded',
  dispute_received: 'Dispute',
  payment_claimed: 'Payment claimed',
  payment_confirmed: 'Payment confirmed',
  payment_received: 'Payment',
  payment_promise_received: 'Payment promise',
  payment_promise_due: 'Payment promise due',
  payment_promise_fulfilled: 'Payment promise fulfilled',
  payment_promise_missed: 'Payment promise missed',
  manual_override: 'User action',
  opt_out_recorded: 'Opt-out',
  test_email_sent: 'Test email sent',
};

export const ATTENTION_KIND_LABELS: Record<string, string> = {
  client_says_paid: 'Payment claimed but not confirmed',
  client_promises_payment: 'Payment promise awaiting approval',
  client_disputes: 'Dispute',
  reply_unmatched: 'Unmatched reply',
  reply_unclassified: 'Low-confidence classification',
  wrong_contact: 'Wrong contact',
  delivery_failure: 'Delivery failure',
  retry_exhaustion: 'Retry exhaustion',
  opt_out: 'Opt-out',
  out_of_office: 'Out of office',
  needs_attention: 'Needs attention',
};

export function labelAutomationStatus(status: string): string {
  return AUTOMATION_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function labelEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, ' ');
}

export function labelAttentionKind(kind: string): string {
  return ATTENTION_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Format UTC ISO as `YYYY-MM-DDTHH:mm` in a timezone for datetime-local inputs. */
export function utcIsoToDateTimeLocal(utcIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcIso));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

export function formatLocalSchedule(utcIso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(utcIso));
  } catch {
    return utcIso;
  }
}

export function buildDefaultPlannedSteps(
  invoice: Invoice,
  settings: AppSettings
): PlannedUiStep[] {
  const due = new Date(`${invoice.dueAt}T10:00:00`);
  if (Number.isNaN(due.getTime())) {
    due.setTime(Date.now() + 86400000);
  }

  return settings.sequence.slice(0, 3).map((step: ReminderStep, index) => {
    const when = new Date(due.getTime() + step.dayOffset * 86400000);
    // Prefer mid-morning local; store as datetime-local via UTC conversion approximation
    const localPad = (n: number) => String(n).padStart(2, '0');
    const scheduledAtLocal = `${when.getFullYear()}-${localPad(when.getMonth() + 1)}-${localPad(when.getDate())}T10:00`;
    const rendered = renderTemplate(step, invoice, settings);
    return {
      sequenceNumber: index + 1,
      scheduledAtLocal,
      tone: step.tone,
      subject: rendered.subject,
      body: rendered.body,
      requireApproval: step.tone === 'firm' || step.tone === 'final',
    };
  });
}

export function activationPauseCopy(): string[] {
  return [
    'Client replies to a reminder',
    'Invoice is marked paid',
    'Client disputes the invoice',
    'Delivery permanently fails or contact opts out',
  ];
}

export function activationReplyCopy(): string {
  return 'Follow-ups pause automatically. You review the reply in Needs Attention before anything else sends.';
}

export function activationPaidCopy(): string {
  return 'Automation completes and all pending reminders are cancelled. Nothing further is sent.';
}

export function statusBadgeClass(status: string): string {
  if (status === 'active') return 'badge-ok';
  if (status === 'paused' || status === 'awaiting_user') return 'badge-warn';
  if (status === 'cancelled' || status === 'failed') return 'badge-danger';
  if (status === 'completed') return 'badge-neutral';
  return 'badge-neutral';
}

export function validatePlannedSteps(steps: PlannedUiStep[]): string | null {
  if (!steps.length) return 'Add at least one reminder step.';
  const times = steps.map((s) => new Date(s.scheduledAtLocal).getTime());
  if (times.some((t) => Number.isNaN(t))) return 'Each reminder needs a valid date and time.';
  for (let i = 1; i < times.length; i++) {
    if (times[i]! <= times[i - 1]!) {
      return 'Reminder dates must be in chronological order.';
    }
  }
  if (!steps.some((s) => new Date(s.scheduledAtLocal).getTime() > Date.now())) {
    return 'At least one reminder must be in the future.';
  }
  return null;
}

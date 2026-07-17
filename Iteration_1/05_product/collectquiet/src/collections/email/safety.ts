import type { SafetyBlockReason, SafetyCheckInput } from './types';
import { firmToneNeedsApproval } from './compose';

export function runFinalSafetyCheck(input: SafetyCheckInput): SafetyBlockReason | null {
  const { invoice, automation, step } = input;

  if (!invoice.clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.clientEmail)) {
    return 'invalid_recipient';
  }
  if (invoice.optedOut) return 'recipient_opted_out';
  if (invoice.status === 'paid' || invoice.paidAt || invoice.collectionStatus === 'paid') {
    return 'invoice_paid';
  }
  if (invoice.collectionStatus === 'disputed') return 'invoice_disputed';
  if (automation.status === 'paused') return 'automation_paused';
  if (automation.status === 'cancelled') return 'automation_cancelled';
  if (automation.status === 'completed') return 'automation_completed';
  if (automation.status !== 'active') return 'automation_inactive';
  if (
    Boolean(step.sentAt || step.providerMessageId || step.status === 'sent') ||
    input.hasReminderSentEvent
  ) {
    return 'reminder_already_sent';
  }
  if (input.hasUnresolvedMeaningfulReply) return 'meaningful_reply_pending';
  if (firmToneNeedsApproval(step.tone, step.manualApprovedAt)) return 'firm_tone_needs_approval';
  return null;
}

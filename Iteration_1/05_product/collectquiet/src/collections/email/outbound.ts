import { composeReminderEmail } from './compose';
import { runFinalSafetyCheck } from './safety';
import type { EmailProvider, ReminderEmailContext, SafetyBlockReason } from './types';
import { EmailProviderError } from './types';
import type { MessageSender, OutboundMessage, SendResult } from '../worker/types';
import { SendError } from '../worker/types';
import type { WorkerStore } from '../store';
import type { CollectionAutomation, CollectionInvoice, ReminderStep } from '../types';

export interface OutboundProfile {
  senderName: string;
  businessName?: string;
  currency?: string;
}

export async function loadReminderEmailContext(
  store: WorkerStore,
  step: ReminderStep,
  correlationId: string,
  profile: OutboundProfile
): Promise<{
  ctx: ReminderEmailContext;
  invoice: CollectionInvoice;
  automation: CollectionAutomation;
  block: SafetyBlockReason | null;
}> {
  const automation = await store.getAutomationById(step.automationId);
  if (!automation) {
    throw new SendError('Automation missing', 'permanent', 'automation_missing');
  }
  const invoice = await store.getInvoice(step.userId, step.invoiceId);
  if (!invoice) {
    throw new SendError('Invoice missing', 'permanent', 'invoice_missing');
  }

  const hasUnresolvedMeaningfulReply = await store.invoiceHasUnresolvedAttention(step.invoiceId);
  const hasReminderSentEvent = await store.hasEventTypeForStep(step.id, 'reminder_sent');

  const block = runFinalSafetyCheck({
    invoice: {
      status: invoice.status,
      collectionStatus: invoice.collectionStatus,
      paidAt: invoice.paidAt,
      clientEmail: invoice.clientEmail,
      optedOut: invoice.optedOut,
    },
    automation: { status: automation.status },
    step: {
      status: step.status,
      sentAt: step.sentAt,
      providerMessageId: step.providerMessageId,
      tone: step.tone,
      manualApprovedAt: step.manualApprovedAt,
    },
    hasUnresolvedMeaningfulReply,
    hasReminderSentEvent,
  });

  const ctx: ReminderEmailContext = {
    to: invoice.clientEmail ?? '',
    clientName: invoice.clientName ?? null,
    invoiceNumber: invoice.invoiceNumber ?? 'UNKNOWN',
    amount: invoice.amount ?? 0,
    currency: invoice.currency ?? profile.currency ?? 'USD',
    dueAt: invoice.dueAt ?? new Date().toISOString().slice(0, 10),
    paymentLink: invoice.paymentLink ?? null,
    attachment: null,
    subjectSnapshot: step.subjectSnapshot,
    bodySnapshot: step.bodySnapshot,
    tone: step.tone,
    senderDisplayName: profile.senderName,
    businessName: profile.businessName ?? null,
    replyToToken: automation.replyToToken,
    invoiceId: invoice.id,
    automationId: automation.id,
    reminderStepId: step.id,
    userId: step.userId,
    idempotencyKey: step.idempotencyKey,
    correlationId,
    timezone: automation.timezone,
    scheduledAtUtc: step.scheduledAt,
    manualApprovedAt: step.manualApprovedAt,
  };

  return { ctx, invoice, automation, block };
}

export function createEmailMessageSender(provider: EmailProvider): MessageSender {
  return {
    async send(message: OutboundMessage): Promise<SendResult> {
      if (!message.composed) {
        throw new SendError('Composed email required', 'permanent', 'compose_missing');
      }
      try {
        const result = await provider.sendReminder(message.composed);
        return {
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId ?? null,
          rfcMessageId: result.rfcMessageId ?? null,
        };
      } catch (err) {
        if (err instanceof EmailProviderError) {
          throw new SendError(err.message, err.kind, err.code);
        }
        if (err instanceof Error && /timeout|aborted|network/i.test(err.message)) {
          throw new SendError(err.message, 'temporary', 'provider_timeout');
        }
        throw err;
      }
    },
  };
}

export function safetyReasonToSkip(reason: SafetyBlockReason): string {
  return reason;
}

export { composeReminderEmail };

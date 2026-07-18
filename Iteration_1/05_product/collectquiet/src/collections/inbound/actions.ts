/**
 * Category actions after classification. Never auto-mark paid from email claims.
 * Never invent bank details.
 */

import type { CollectionsService, ActorContext } from '../service';
import type { WorkerStore } from '../store';
import type { CollectionAutomation, InboundClassification, InboundMessage, ReminderStep } from '../types';
import { CANCELABLE_STEP_STATUSES } from '../types';
import type { ClassificationResult } from './types';
import { createUserNotification } from './notifications';

export interface ActionResult {
  paused: CollectionAutomation | null;
  cancelled: CollectionAutomation | null;
  notificationKinds: string[];
}

/** Prefer the actual client reply text so Needs Attention can show what was said. */
export function replyExcerpt(message: InboundMessage, max = 800): string | null {
  const text = (message.textContent ?? '').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function notificationBody(message: InboundMessage, note?: string | null): string | null {
  const excerpt = replyExcerpt(message);
  const cleanNote = (note ?? '').trim();
  if (excerpt && cleanNote && cleanNote.toLowerCase() !== excerpt.toLowerCase()) {
    return `${cleanNote}\n\n——\n${excerpt}`;
  }
  return excerpt || cleanNote || null;
}

async function cancelFirmReminders(store: WorkerStore, automationId: string): Promise<void> {
  const auto = await store.getAutomationById(automationId);
  if (!auto) return;
  const steps = await store.listSteps(auto.userId, automationId);
  const now = new Date().toISOString();
  for (const step of steps) {
    if (
      CANCELABLE_STEP_STATUSES.includes(step.status) &&
      (step.tone === 'firm' || step.tone === 'final')
    ) {
      const cancelled: ReminderStep = {
        ...step,
        status: 'cancelled',
        claimedAt: null,
        claimExpiresAt: null,
        lastErrorCode: 'dispute_cancel_firm',
        lastErrorMessage: 'Cancelled due to dispute',
        updatedAt: now,
      };
      await store.updateStep(cancelled);
    }
  }
}

export async function applyClassificationActions(opts: {
  service: CollectionsService;
  store: WorkerStore;
  message: InboundMessage;
  classification: ClassificationResult;
  alreadyPaused: boolean;
}): Promise<ActionResult> {
  const { service, store, message, classification } = opts;
  const result: ActionResult = {
    paused: null,
    cancelled: null,
    notificationKinds: [],
  };

  if (!message.matchedAutomationId && !message.matchedInvoiceId) {
    if (message.userId) {
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'reply_unmatched',
        title: 'Reply could not be matched',
        body: notificationBody(message, classification.summary),
        invoiceId: null,
        automationId: null,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('reply_unmatched');
    }
    return result;
  }

  const ctx: ActorContext = { userId: message.userId };
  const automationId = message.matchedAutomationId;
  const invoiceId = message.matchedInvoiceId!;
  const category = classification.category as InboundClassification;

  const ensurePaused = async (reason: string) => {
    if (!automationId) return null;
    const a = await store.getAutomationById(automationId);
    if (!a) return null;
    if (a.status === 'active' || a.status === 'awaiting_user') {
      return service.pauseCollectionAutomation(ctx, a.id, reason);
    }
    return a.status === 'paused' ? a : null;
  };

  switch (category) {
    case 'payment_claimed':
    case 'payment_claim': {
      result.paused = await ensurePaused('payment_claimed');
      await store.updateInvoice(message.userId, invoiceId, {
        collectionStatus: 'payment_confirmation_pending',
      });
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'client_says_paid',
        title: 'Client says paid',
        body: notificationBody(message),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('client_says_paid');
      break;
    }
    case 'payment_promise': {
      result.paused = await ensurePaused('payment_promise');
      await service.registerPaymentPromise(ctx, {
        invoiceId,
        automationId,
        promisedPaymentDate: classification.promisedPaymentDate,
        sourceMessageId: message.id,
        confidence: classification.confidence,
      });
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'client_promises_payment',
        title: 'Client promises payment',
        body: notificationBody(
          message,
          classification.promisedPaymentDate
            ? `Detected date: ${classification.promisedPaymentDate} (needs your approval)`
            : 'Payment promised — date not detected; please review'
        ),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('client_promises_payment');
      break;
    }
    case 'dispute': {
      result.paused = await ensurePaused('dispute');
      await store.updateInvoice(message.userId, invoiceId, {
        collectionStatus: 'disputed',
      });
      if (automationId) await cancelFirmReminders(store, automationId);
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'client_disputes',
        title: 'Client disputes invoice',
        body: notificationBody(message),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('client_disputes');
      break;
    }
    case 'request_invoice_copy':
    case 'request_payment_details': {
      result.paused = await ensurePaused('client_reply');
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'needs_attention',
        title:
          category === 'request_invoice_copy'
            ? 'Client requested invoice copy'
            : 'Client requested payment details',
        body: notificationBody(
          message,
          category === 'request_payment_details'
            ? 'Suggest a reply using your verified payment details only. Never invent bank information.'
            : 'Offer a user-approved resend after confirming the matched invoice.'
        ),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('needs_attention');
      break;
    }
    case 'wrong_contact': {
      if (automationId) {
        result.cancelled = await service.cancelCollectionAutomation(
          ctx,
          automationId,
          'wrong_contact'
        );
      }
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'wrong_contact',
        title: 'Wrong contact',
        body: notificationBody(
          message,
          'Client says this is the wrong contact. Update the recipient before sending again.'
        ),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('wrong_contact');
      break;
    }
    case 'out_of_office': {
      result.paused = await ensurePaused('out_of_office');
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'out_of_office',
        title: 'Client out of office',
        body: notificationBody(
          message,
          classification.outOfOfficeReturnDate
            ? `Return date suggested: ${classification.outOfOfficeReturnDate}`
            : 'Out of office — suggest a new reminder date. Do not escalate during absence.'
        ),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('out_of_office');
      break;
    }
    case 'unsubscribe': {
      if (automationId) {
        result.cancelled = await service.cancelCollectionAutomation(
          ctx,
          automationId,
          'unsubscribe'
        );
      }
      await store.updateInvoice(message.userId, invoiceId, { optedOut: true });
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'opt_out',
        title: 'Client opted out',
        body: notificationBody(
          message,
          'Automation cancelled. Future automated messaging blocked for this address.'
        ),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('opt_out');
      break;
    }
    case 'general_reply':
    case 'human_reply':
    case 'unknown': {
      result.paused = await ensurePaused('client_reply');
      const kind =
        category === 'unknown' || classification.source === 'fallback'
          ? 'reply_unclassified'
          : 'needs_attention';
      await createUserNotification(store, {
        userId: message.userId,
        kind,
        title: category === 'unknown' ? 'Reply needs classification review' : 'Client replied',
        body: notificationBody(message),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push(kind);
      break;
    }
    case 'automated_response':
    case 'auto_reply':
    case 'bounce':
      break;
    default:
      result.paused = await ensurePaused('client_reply');
      await createUserNotification(store, {
        userId: message.userId,
        kind: 'needs_attention',
        title: 'Inbound reply',
        body: notificationBody(message, classification.summary),
        invoiceId,
        automationId,
        inboundMessageId: message.id,
      });
      result.notificationKinds.push('needs_attention');
  }

  void opts.alreadyPaused;
  return result;
}

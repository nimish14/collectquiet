import type { WorkerStore } from '../store';
import type { CollectionEvent, ProviderDeliveryStatus, ReminderStep } from '../types';
import type { EmailProvider, ParsedDeliveryEvent } from './types';
import { EmailProviderError } from './types';
import { SendError } from '../worker/types';

function id(): string {
  return crypto.randomUUID();
}

export interface WebhookProcessResult {
  ok: boolean;
  duplicate?: boolean;
  eventStatus?: ProviderDeliveryStatus;
  paused?: boolean;
  needsAttention?: boolean;
  error?: string;
}

/**
 * Handle signed provider delivery webhooks: dedupe, update status, pause on complaint/opt-out.
 */
export async function processDeliveryWebhook(opts: {
  provider: EmailProvider;
  store: WorkerStore;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  findStepByProviderMessageId: (providerMessageId: string) => Promise<ReminderStep | null>;
  pauseAutomation: (userId: string, automationId: string, reason: string) => Promise<void>;
}): Promise<WebhookProcessResult> {
  const { provider, store, headers, rawBody } = opts;

  if (!provider.verifyWebhook(headers, rawBody)) {
    return { ok: false, error: 'invalid_signature' };
  }

  let parsed: ParsedDeliveryEvent;
  try {
    parsed = provider.parseDeliveryEvent(JSON.parse(rawBody));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }

  const existing = await store.findProviderEvent(parsed.provider, parsed.providerEventId);
  if (existing) {
    return { ok: true, duplicate: true, eventStatus: existing.eventStatus };
  }

  let step: ReminderStep | null = null;
  if (parsed.reminderStepId) {
    step = await store.getStepById(parsed.reminderStepId);
  } else if (parsed.providerMessageId) {
    step = await opts.findStepByProviderMessageId(parsed.providerMessageId);
  }

  const userId = step?.userId ?? null;
  await store.insertProviderEvent({
    id: id(),
    userId,
    provider: parsed.provider,
    providerEventId: parsed.providerEventId,
    providerMessageId: parsed.providerMessageId,
    reminderStepId: step?.id ?? null,
    eventStatus: parsed.eventStatus,
    payloadHash: null,
    rawMetadata: {
      // never store secrets
      type: (parsed.raw as { type?: string }).type ?? parsed.eventStatus,
    },
    occurredAt: parsed.occurredAt,
    processedAt: new Date().toISOString(),
  });

  if (step) {
    await store.appendEvent({
      id: id(),
      userId: step.userId,
      invoiceId: step.invoiceId,
      automationId: step.automationId,
      reminderStepId: step.id,
      eventType:
        parsed.eventStatus === 'bounced' || parsed.eventStatus === 'rejected'
          ? 'reminder_failed'
          : parsed.eventStatus === 'complained'
            ? 'needs_attention'
            : 'reminder_sent',
      source: 'provider_webhook',
      actorId: null,
      metadata: {
        deliveryStatus: parsed.eventStatus,
        providerEventId: parsed.providerEventId,
        providerMessageId: parsed.providerMessageId,
      },
      occurredAt: new Date().toISOString(),
    } satisfies CollectionEvent);
  }

  let paused = false;
  let needsAttention = false;

  if (
    step &&
    (parsed.eventStatus === 'complained' || parsed.eventStatus === 'bounced')
  ) {
    needsAttention = true;
    await store.appendEvent({
      id: id(),
      userId: step.userId,
      invoiceId: step.invoiceId,
      automationId: step.automationId,
      reminderStepId: step.id,
      eventType: 'needs_attention',
      source: 'provider_webhook',
      actorId: null,
      metadata: {
        reason: parsed.eventStatus === 'complained' ? 'complaint_opt_out' : 'bounce',
        providerEventId: parsed.providerEventId,
      },
      occurredAt: new Date().toISOString(),
    });
    await opts.pauseAutomation(step.userId, step.automationId, 'delivery_failure');
    paused = true;

    if (parsed.eventStatus === 'complained') {
      try {
        await store.updateInvoice(step.userId, step.invoiceId, { optedOut: true });
      } catch {
        /* store may be read-only in some deployments */
      }
    }

    if (parsed.eventStatus === 'bounced') {
      await store.updateStep({
        ...step,
        status: 'failed',
        failedAt: new Date().toISOString(),
        lastErrorCode: 'bounced',
        lastErrorMessage: 'Provider bounced',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (step && parsed.eventStatus === 'rejected') {
    needsAttention = true;
    await store.appendEvent({
      id: id(),
      userId: step.userId,
      invoiceId: step.invoiceId,
      automationId: step.automationId,
      reminderStepId: step.id,
      eventType: 'needs_attention',
      source: 'provider_webhook',
      actorId: null,
      metadata: {
        reason: 'rejected',
        providerEventId: parsed.providerEventId,
      },
      occurredAt: new Date().toISOString(),
    });
    await store.updateStep({
      ...step,
      status: 'failed',
      failedAt: new Date().toISOString(),
      lastErrorCode: 'rejected',
      lastErrorMessage: 'Provider rejected',
      updatedAt: new Date().toISOString(),
    });
  }

  return { ok: true, eventStatus: parsed.eventStatus, paused, needsAttention };
}

/** Adapt EmailProvider to worker MessageSender after compose. */
export function emailProviderAsSender(
  send: (message: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey: string;
    correlationId: string;
    composed: import('./types').ComposedReminderEmail;
  }) => Promise<{ providerMessageId: string; providerThreadId?: string | null }>
) {
  return {
    async send(message: {
      to: string;
      subject: string;
      body: string;
      idempotencyKey: string;
      correlationId: string;
      channel: string;
      replyToToken?: string | null;
      composed?: import('./types').ComposedReminderEmail;
    }) {
      if (!message.composed) {
        throw new SendError('Missing composed email', 'permanent', 'compose_missing');
      }
      try {
        return await send({
          to: message.to,
          subject: message.subject,
          body: message.body,
          idempotencyKey: message.idempotencyKey,
          correlationId: message.correlationId,
          composed: message.composed,
        });
      } catch (err) {
        if (err instanceof EmailProviderError) {
          throw new SendError(err.message, err.kind, err.code);
        }
        throw err;
      }
    },
  };
}

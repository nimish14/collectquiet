/**
 * Manual / test-mode client reply ingest.
 * Used when Resend inbound domain is not available yet: founder pastes the
 * reply they received in their inbox, and CollectQuiet runs the same
 * classify → pause → Needs Attention path as the live webhook.
 */

import { CollectionsService } from '../service';
import type { WorkerStore } from '../store';
import type { InboundMessage } from '../types';
import { MEANINGFUL_REPLY_CLASSIFICATIONS } from '../types';
import { applyClassificationActions } from './actions';
import { classifyInbound, containsPromptInjection } from './classify';
import { createUserNotification } from './notifications';
import type { PipelineResult } from './pipeline';
import { extractPlainBody, sanitizeHtml } from './sanitize';
import type { ClassificationResult } from './types';

function id(): string {
  return crypto.randomUUID();
}

export async function processManualClientReply(opts: {
  store: WorkerStore;
  service: CollectionsService;
  userId: string;
  invoiceId: string;
  text: string;
  subject?: string;
  fromEmail?: string;
}): Promise<PipelineResult & { classification?: ClassificationResult }> {
  const { store, service, userId, invoiceId } = opts;
  const plain = extractPlainBody(opts.text, null).trim();
  if (!plain) {
    return { ok: false, error: 'empty_reply' };
  }

  const invoice = await store.getInvoice(userId, invoiceId);
  if (!invoice) {
    return { ok: false, error: 'invoice_not_found' };
  }

  const automation = await store.findOpenAutomationForInvoice(userId, invoiceId);

  const from = (opts.fromEmail || invoice.clientEmail || 'client@unknown').trim();
  const subject = (opts.subject || `Re: Invoice ${invoice.invoiceNumber ?? invoiceId}`).trim();
  const providerEventId = `manual:${userId}:${invoiceId}:${Date.now()}:${id().slice(0, 8)}`;

  const injection = containsPromptInjection(plain);
  const now = new Date().toISOString();
  const message: InboundMessage = {
    id: id(),
    userId,
    provider: 'manual',
    providerEventId,
    providerMessageId: null,
    providerThreadId: null,
    replyToken: automation?.replyToToken ?? null,
    senderAddress: from,
    recipientAddress: null,
    subject,
    textContent: plain,
    htmlContent: sanitizeHtml(null) || null,
    receivedAt: now,
    classification: null,
    classificationConfidence: null,
    matchedInvoiceId: invoiceId,
    matchedAutomationId: automation?.id ?? null,
    requiresReview: true,
    attentionClearedAt: null,
    processedAt: null,
    rawMetadata: {
      source: 'manual_paste',
      promptInjectionSuspected: injection,
    },
    createdAt: now,
  };

  await store.insertInbound(message);

  await store.appendEvent({
    id: id(),
    userId,
    invoiceId,
    automationId: automation?.id ?? null,
    reminderStepId: null,
    eventType: 'inbound_reply_received',
    source: 'user',
    actorId: userId,
    metadata: { source: 'manual_paste', inboundMessageId: message.id },
    occurredAt: now,
  });

  let alreadyPaused = false;
  if (automation && (automation.status === 'active' || automation.status === 'awaiting_user')) {
    await service.pauseCollectionAutomation({ userId }, automation.id, 'client_reply');
    alreadyPaused = true;
  }

  const classification = await classifyInbound({
    subject,
    text: plain,
    from,
    headers: {},
    llm: null,
  });

  if (injection) {
    classification.category = 'unknown';
    classification.requiresUserAction = true;
    classification.reason = 'prompt_injection_guard';
    classification.summary = 'Reply held for review';
  }

  message.classification = classification.category;
  message.classificationConfidence = classification.confidence;
  message.requiresReview =
    MEANINGFUL_REPLY_CLASSIFICATIONS.includes(classification.category) ||
    classification.category === 'unknown';
  message.processedAt = new Date().toISOString();
  await store.updateInbound(message);

  await store.appendEvent({
    id: id(),
    userId,
    invoiceId,
    automationId: automation?.id ?? null,
    reminderStepId: null,
    eventType: 'reply_classified',
    source: 'system',
    actorId: null,
    metadata: {
      classification: classification.category,
      confidence: classification.confidence,
      source: classification.source,
      reason: classification.reason,
      inboundMessageId: message.id,
    },
    occurredAt: new Date().toISOString(),
  });

  if (classification.category === 'payment_claimed' || classification.category === 'payment_claim') {
    await store.appendEvent({
      id: id(),
      userId,
      invoiceId,
      automationId: automation?.id ?? null,
      reminderStepId: null,
      eventType: 'payment_claimed',
      source: 'system',
      actorId: null,
      metadata: { inboundMessageId: message.id },
      occurredAt: new Date().toISOString(),
    });
  }

  const actions = await applyClassificationActions({
    service,
    store,
    message,
    classification,
    alreadyPaused,
  });

  if (!actions.notificationKinds.length && message.requiresReview) {
    await createUserNotification(store, {
      userId,
      kind: 'needs_attention',
      title: 'Client reply needs review',
      body: plain.slice(0, 800),
      invoiceId,
      automationId: automation?.id ?? null,
      inboundMessageId: message.id,
    });
  }

  return {
    ok: true,
    message,
    classification,
    pausedAutomationId: actions.paused?.id ?? (alreadyPaused ? automation?.id : null) ?? null,
  };
}

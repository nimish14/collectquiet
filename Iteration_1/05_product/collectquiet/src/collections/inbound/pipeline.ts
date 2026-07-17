/**
 * Inbound reply pipeline (audit Option A: Reply-To + webhook).
 *
 * Order: verify → dedupe → fetch → sanitize → match → store →
 * pause (human) → classify → actions → timeline.
 */

import { CollectionsService } from '../service';
import type { WorkerStore } from '../store';
import type { InboundMessage } from '../types';
import { MEANINGFUL_REPLY_CLASSIFICATIONS } from '../types';
import { applyClassificationActions } from './actions';
import { classifyInbound, containsPromptInjection, looksLikeAutomatedReceipt } from './classify';
import type { MatchStore } from './match';
import { extractReplyToken, matchInboundMessage } from './match';
import { extractPlainBody, sanitizeHtml } from './sanitize';
import type {
  ClassificationResult,
  InboundMessageFetcher,
  InboundVerifier,
  LlmClassifier,
  MatchResult,
  RawInboundEmail,
} from './types';

function id(): string {
  return crypto.randomUUID();
}

function stripSecrets(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (lk.includes('authorization') || lk.includes('secret') || lk.includes('api_key')) {
      delete out[k];
    }
  }
  return out;
}

export interface PipelineResult {
  ok: boolean;
  duplicate?: boolean;
  invalidSignature?: boolean;
  message?: InboundMessage;
  match?: MatchResult;
  classification?: ClassificationResult;
  pausedAutomationId?: string | null;
  error?: string;
}

export async function processInboundWebhook(opts: {
  store: MatchStore;
  service: CollectionsService;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  verify: InboundVerifier;
  parse: (body: string) => RawInboundEmail;
  fetchMessage?: InboundMessageFetcher | null;
  llm?: LlmClassifier | null;
}): Promise<PipelineResult> {
  const { store, service, headers, rawBody } = opts;

  if (!opts.verify(headers, rawBody)) {
    return { ok: false, invalidSignature: true, error: 'invalid_signature' };
  }

  let email: RawInboundEmail;
  try {
    email = opts.parse(rawBody);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }

  const existing = await store.findInboundByProviderEvent(email.provider, email.providerEventId);
  if (existing) {
    return { ok: true, duplicate: true, message: existing };
  }

  // Retrieve complete message when webhook is metadata-only
  if (email.emailIdForFetch && opts.fetchMessage && !email.text && !email.html) {
    const full = await opts.fetchMessage(email.emailIdForFetch);
    if (full) {
      email = {
        ...email,
        text: full.text ?? email.text,
        html: full.html ?? email.html,
        from: full.from ?? email.from,
        to: full.to ?? email.to,
        subject: full.subject ?? email.subject,
        headers: { ...email.headers, ...full.headers },
      };
    }
  }

  const sanitizedHtml = sanitizeHtml(email.html);
  const plain = extractPlainBody(email.text, email.html);
  const injection = containsPromptInjection(plain);

  const match = await matchInboundMessage(store, email);

  // System user placeholder for unmatched — prefer match.userId
  let userId = match.userId;
  if (!userId && match.candidateAutomationIds[0]) {
    const a = await store.getAutomationById(match.candidateAutomationIds[0]);
    userId = a?.userId ?? null;
  }

  // Cross-user guard: if reply token resolved, user is bound; never reassign
  if (match.automationId && match.userId) {
    const a = await store.getAutomationById(match.automationId);
    if (!a || a.userId !== match.userId) {
      return { ok: false, error: 'cross_user_match_rejected' };
    }
  }

  const now = new Date().toISOString();
  const message: InboundMessage = {
    id: id(),
    userId: userId ?? '00000000-0000-0000-0000-000000000000',
    provider: email.provider,
    providerEventId: email.providerEventId,
    providerMessageId: email.providerMessageId ?? null,
    providerThreadId: email.providerThreadId ?? null,
    replyToken: match.replyToken ?? extractReplyToken(email.to),
    senderAddress: email.from ?? null,
    recipientAddress: email.to ?? null,
    subject: email.subject ?? null,
    textContent: plain,
    htmlContent: sanitizedHtml || null,
    receivedAt: now,
    classification: null,
    classificationConfidence: null,
    matchedInvoiceId: match.invoiceId,
    matchedAutomationId: match.automationId,
    requiresReview: true,
    attentionClearedAt: null,
    processedAt: null,
    rawMetadata: stripSecrets({
      ...(email.raw ?? {}),
      matchMethod: match.method,
      ambiguous: match.ambiguous,
      candidateAutomationIds: match.candidateAutomationIds,
      promptInjectionSuspected: injection,
      inReplyTo: email.headers?.inReplyTo ?? null,
      references: email.headers?.references ?? null,
    }),
    createdAt: now,
  };

  // Unmatched without user — cannot store with fake user; use first candidate user or skip DB user
  if (!userId) {
    // Still record via a synthetic path: require at least one system event is impractical.
    // For unmatched with no user signal, return unmatched without insert when no userId.
    await appendTimeline(store, null, null, null, 'inbound_unmatched', {
      providerEventId: email.providerEventId,
      reason: 'no_user_context',
    });
    return {
      ok: true,
      message,
      match,
      error: 'unmatched_no_user',
    };
  }

  message.userId = userId;
  await store.insertInbound(message);

  await appendTimeline(store, userId, match.invoiceId, match.automationId, 'inbound_reply_received', {
    provider: email.provider,
    providerEventId: email.providerEventId,
    matchMethod: match.method,
    inboundMessageId: message.id,
  });

  if (match.ambiguous || match.method === 'unmatched' || match.method === 'ambiguous') {
    await appendTimeline(store, userId, match.invoiceId, match.automationId, 'inbound_unmatched', {
      candidateAutomationIds: match.candidateAutomationIds,
      inboundMessageId: message.id,
    });
    // Soft-pause candidates so reminders do not fire until resolved
    for (const aid of match.candidateAutomationIds) {
      const a = await store.getAutomationById(aid);
      if (a && a.userId === userId && (a.status === 'active' || a.status === 'awaiting_user')) {
        try {
          await service.pauseCollectionAutomation({ userId }, aid, 'client_reply');
        } catch {
          /* ignore */
        }
      }
    }
    if (!match.automationId) {
      const { createUserNotification } = await import('./notifications');
      await createUserNotification(store, {
        userId,
        kind: 'reply_unmatched',
        title: 'Reply could not be matched',
        body: plain.slice(0, 200),
        inboundMessageId: message.id,
      });
    }
  }

  const isAutomated = looksLikeAutomatedReceipt(email.headers, email.from, email.subject);
  let alreadyPaused = false;

  // Immediate pause BEFORE classification for genuine human replies
  if (!isAutomated && match.automationId && match.userId) {
    const a = await store.getAutomationById(match.automationId);
    if (a && (a.status === 'active' || a.status === 'awaiting_user')) {
      await service.pauseCollectionAutomation({ userId: match.userId }, a.id, 'client_reply');
      alreadyPaused = true;
    }
  }

  const classification = await classifyInbound({
    subject: email.subject ?? '',
    text: plain,
    from: email.from,
    headers: email.headers,
    llm: opts.llm,
  });

  // Prompt injection must not become executable actions beyond needs-attention
  if (injection && classification.source === 'llm') {
    classification.category = 'unknown';
    classification.requiresUserAction = true;
    classification.reason = 'prompt_injection_guard';
    classification.summary = 'Email contained instruction-like text; held for review';
  }

  message.classification = classification.category;
  message.classificationConfidence = classification.confidence;
  message.requiresReview =
    MEANINGFUL_REPLY_CLASSIFICATIONS.includes(classification.category) ||
    classification.category === 'unknown' ||
    match.ambiguous ||
    !match.automationId;
  message.processedAt = new Date().toISOString();
  await store.updateInbound(message);

  await appendTimeline(
    store,
    userId,
    match.invoiceId,
    match.automationId,
    'reply_classified',
    {
      classification: classification.category,
      confidence: classification.confidence,
      source: classification.source,
      reason: classification.reason,
      inboundMessageId: message.id,
    }
  );

  if (classification.category === 'payment_claimed' || classification.category === 'payment_claim') {
    await appendTimeline(store, userId, match.invoiceId, match.automationId, 'payment_claimed', {
      inboundMessageId: message.id,
    });
  }
  if (classification.category === 'dispute') {
    await appendTimeline(store, userId, match.invoiceId, match.automationId, 'dispute_received', {
      inboundMessageId: message.id,
    });
  }
  if (classification.category === 'unsubscribe') {
    await appendTimeline(store, userId, match.invoiceId, match.automationId, 'opt_out_recorded', {
      inboundMessageId: message.id,
    });
  }

  const actions = await applyClassificationActions({
    service,
    store,
    message,
    classification,
    alreadyPaused,
  });

  if (message.requiresReview) {
    await appendTimeline(store, userId, match.invoiceId, match.automationId, 'needs_attention', {
      inboundMessageId: message.id,
      classification: classification.category,
    });
  }

  return {
    ok: true,
    message,
    match,
    classification,
    pausedAutomationId:
      actions.paused?.id ?? actions.cancelled?.id ?? (alreadyPaused ? match.automationId : null),
  };
}

async function appendTimeline(
  store: WorkerStore,
  userId: string | null,
  invoiceId: string | null,
  automationId: string | null,
  eventType: import('../types').CollectionEventType,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!userId) return;
  await store.appendEvent({
    id: id(),
    userId,
    invoiceId,
    automationId,
    reminderStepId: null,
    eventType,
    source: 'provider_webhook',
    actorId: null,
    metadata,
    occurredAt: new Date().toISOString(),
  });
}

import type { CollectionsStore } from './store';
import { assertChronologicalUtc, assertUtcIso, nowUtcIso } from './time';
import {
  CANCELABLE_STEP_STATUSES,
  CollectionsDomainError,
  MEANINGFUL_REPLY_CLASSIFICATIONS,
  TERMINAL_AUTOMATION_STATUSES,
  type CollectionAutomation,
  type CollectionChannel,
  type CollectionEvent,
  type CollectionEventType,
  type EventSource,
  type InboundClassification,
  type InboundMessage,
  type PaymentPromise,
  type PlannedReminderInput,
  type ProviderDeliveryEvent,
  type ProviderDeliveryStatus,
  type ReminderStep,
} from './types';

function id(): string {
  return crypto.randomUUID();
}

function token(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ActorContext {
  userId: string;
  source?: EventSource;
  actorId?: string | null;
  /** Explicit override to activate on paid/disputed/cancelled collection states */
  allowOverride?: boolean;
}

/**
 * Domain service for collections automation.
 * All status changes go through these methods — not ad-hoc UI updates.
 */
export class CollectionsService {
  private readonly store: CollectionsStore;

  constructor(store: CollectionsStore) {
    this.store = store;
  }

  private async requireInvoice(userId: string, invoiceId: string) {
    const invoice = await this.store.getInvoice(userId, invoiceId);
    if (!invoice) {
      throw new CollectionsDomainError('Invoice not found or access denied', 'cross_user_or_missing');
    }
    return invoice;
  }

  private async requireAutomation(userId: string, automationId: string) {
    const automation = await this.store.getAutomation(userId, automationId);
    if (!automation) {
      throw new CollectionsDomainError(
        'Automation not found or access denied',
        'cross_user_or_missing'
      );
    }
    return automation;
  }

  private async writeEvent(
    ctx: ActorContext,
    input: {
      invoiceId?: string | null;
      automationId?: string | null;
      reminderStepId?: string | null;
      eventType: CollectionEventType;
      metadata?: Record<string, unknown>;
    }
  ): Promise<CollectionEvent> {
    return this.store.appendEvent({
      id: id(),
      userId: ctx.userId,
      invoiceId: input.invoiceId ?? null,
      automationId: input.automationId ?? null,
      reminderStepId: input.reminderStepId ?? null,
      eventType: input.eventType,
      source: ctx.source ?? 'user',
      actorId: ctx.actorId ?? ctx.userId,
      metadata: input.metadata ?? {},
      occurredAt: nowUtcIso(),
    });
  }

  async createCollectionAutomation(
    ctx: ActorContext,
    input: {
      invoiceId: string;
      channel?: CollectionChannel;
      timezone: string;
      dryRun?: boolean;
    }
  ): Promise<CollectionAutomation> {
    const invoice = await this.requireInvoice(ctx.userId, input.invoiceId);
    const existing = await this.store.findOpenAutomationForInvoice(ctx.userId, input.invoiceId);
    if (existing) {
      throw new CollectionsDomainError(
        'An open automation already exists for this invoice',
        'automation_exists'
      );
    }

    const now = nowUtcIso();
    const automation: CollectionAutomation = {
      id: id(),
      userId: ctx.userId,
      invoiceId: invoice.id,
      status: 'inactive',
      channel: input.channel ?? 'email',
      timezone: input.timezone || 'UTC',
      activatedAt: null,
      pausedAt: null,
      completedAt: null,
      cancelledAt: null,
      stopReason: null,
      nextActionAt: null,
      version: 1,
      replyToToken: token(),
      dryRun: input.dryRun ?? true,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.insertAutomation(automation);
    await this.writeEvent(ctx, {
      invoiceId: invoice.id,
      automationId: automation.id,
      eventType: 'automation_created',
      metadata: { timezone: automation.timezone, channel: automation.channel },
    });
    return automation;
  }

  async activateCollectionAutomation(
    ctx: ActorContext,
    automationId: string,
    reminders: PlannedReminderInput[]
  ): Promise<{ automation: CollectionAutomation; steps: ReminderStep[] }> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    const invoice = await this.requireInvoice(ctx.userId, automation.invoiceId);

    if (automation.status !== 'inactive' && automation.status !== 'awaiting_user') {
      if (TERMINAL_AUTOMATION_STATUSES.includes(automation.status)) {
        throw new CollectionsDomainError(
          'Completed or cancelled automation cannot activate; create a new automation to restart',
          'terminal_automation'
        );
      }
      throw new CollectionsDomainError(
        `Cannot activate automation in status ${automation.status}`,
        'invalid_transition'
      );
    }

    const blocked =
      invoice.collectionStatus === 'paid' ||
      invoice.collectionStatus === 'disputed' ||
      invoice.collectionStatus === 'written_off' ||
      invoice.status === 'paid';

    if (blocked && !ctx.allowOverride) {
      throw new CollectionsDomainError(
        'Cannot activate reminders on a paid, disputed, or closed invoice without explicit override',
        'invoice_blocked'
      );
    }

    if (!reminders.length) {
      throw new CollectionsDomainError(
        'Automation requires at least one valid future reminder',
        'no_reminders'
      );
    }

    const now = Date.now();
    const future = reminders.filter((r) => new Date(assertUtcIso(r.scheduledAtUtc)).getTime() > now);
    if (!future.length) {
      throw new CollectionsDomainError(
        'Automation requires at least one valid future reminder',
        'no_future_reminders'
      );
    }

    const ordered = [...reminders].sort(
      (a, b) => new Date(a.scheduledAtUtc).getTime() - new Date(b.scheduledAtUtc).getTime()
    );
    assertChronologicalUtc(ordered.map((r) => r.scheduledAtUtc));

    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sequenceNumber !== i + 1) {
        // allow non-contiguous input if sorted by time; renumber
        ordered[i] = { ...ordered[i], sequenceNumber: i + 1 };
      }
    }

    const stepRows: ReminderStep[] = [];
    const seenKeys = new Set<string>();
    for (const r of ordered) {
      if (seenKeys.has(r.idempotencyKey)) {
        throw new CollectionsDomainError(
          `Duplicate idempotency key: ${r.idempotencyKey}`,
          'duplicate_idempotency'
        );
      }
      seenKeys.add(r.idempotencyKey);
      const dup = await this.store.findStepByIdempotencyKey(r.idempotencyKey);
      if (dup) {
        throw new CollectionsDomainError(
          `Duplicate idempotency key: ${r.idempotencyKey}`,
          'duplicate_idempotency'
        );
      }
      const ts = nowUtcIso();
      stepRows.push({
        id: id(),
        automationId: automation.id,
        invoiceId: automation.invoiceId,
        userId: ctx.userId,
        sequenceNumber: r.sequenceNumber,
        channel: r.channel,
        scheduledAt: assertUtcIso(r.scheduledAtUtc),
        tone: r.tone,
        templateId: r.templateId ?? null,
        subjectSnapshot: r.subjectSnapshot,
        bodySnapshot: r.bodySnapshot,
        status: 'pending',
        attemptCount: 0,
        maximumAttempts: r.maximumAttempts ?? 5,
        claimedAt: null,
        claimExpiresAt: null,
        sentAt: null,
        skippedAt: null,
        failedAt: null,
        providerMessageId: null,
        providerThreadId: null,
        rfcMessageId: null,
        idempotencyKey: r.idempotencyKey,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastDryRunAt: null,
        manualApprovedAt: r.manualApprovedAt ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    await this.store.insertSteps(stepRows);

    const nextActionAt = stepRows[0]?.scheduledAt ?? null;
    const activated: CollectionAutomation = {
      ...automation,
      status: 'active',
      activatedAt: nowUtcIso(),
      pausedAt: null,
      stopReason: null,
      nextActionAt,
      version: automation.version + 1,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateAutomation(activated);

    await this.store.updateInvoice(ctx.userId, invoice.id, {
      collectionStatus: 'collecting',
    });

    await this.writeEvent(ctx, {
      invoiceId: invoice.id,
      automationId: automation.id,
      eventType: 'automation_activated',
      metadata: {
        stepCount: stepRows.length,
        override: Boolean(ctx.allowOverride && blocked),
        timezone: automation.timezone,
      },
    });

    for (const step of stepRows) {
      await this.writeEvent(ctx, {
        invoiceId: invoice.id,
        automationId: automation.id,
        reminderStepId: step.id,
        eventType: 'reminder_scheduled',
        metadata: {
          sequenceNumber: step.sequenceNumber,
          scheduledAt: step.scheduledAt,
          idempotencyKey: step.idempotencyKey,
        },
      });
    }

    return { automation: activated, steps: stepRows };
  }

  async pauseCollectionAutomation(
    ctx: ActorContext,
    automationId: string,
    reason: string
  ): Promise<CollectionAutomation> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    if (automation.status !== 'active' && automation.status !== 'awaiting_user') {
      throw new CollectionsDomainError(
        `Cannot pause automation in status ${automation.status}`,
        'invalid_transition'
      );
    }

    const paused: CollectionAutomation = {
      ...automation,
      status: 'paused',
      pausedAt: nowUtcIso(),
      stopReason: reason,
      version: automation.version + 1,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateAutomation(paused);
    await this.store.updateInvoice(ctx.userId, automation.invoiceId, {
      collectionStatus: 'paused',
    });
    await this.writeEvent(ctx, {
      invoiceId: automation.invoiceId,
      automationId,
      eventType: 'automation_paused',
      metadata: { reason },
    });
    return paused;
  }

  async resumeCollectionAutomation(
    ctx: ActorContext,
    automationId: string
  ): Promise<CollectionAutomation> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    if (TERMINAL_AUTOMATION_STATUSES.includes(automation.status)) {
      throw new CollectionsDomainError(
        'Completed or cancelled automation cannot resume; create a new automation to restart',
        'terminal_automation'
      );
    }
    if (automation.status !== 'paused' && automation.status !== 'awaiting_user') {
      throw new CollectionsDomainError(
        `Cannot resume automation in status ${automation.status}`,
        'invalid_transition'
      );
    }

    const invoice = await this.requireInvoice(ctx.userId, automation.invoiceId);
    if (
      (invoice.collectionStatus === 'paid' || invoice.collectionStatus === 'disputed') &&
      !ctx.allowOverride
    ) {
      throw new CollectionsDomainError(
        'Cannot resume on paid or disputed invoice without override',
        'invoice_blocked'
      );
    }

    const steps = await this.store.listSteps(ctx.userId, automationId);
    const next = steps.find((s) => CANCELABLE_STEP_STATUSES.includes(s.status));

    const resumed: CollectionAutomation = {
      ...automation,
      status: 'active',
      pausedAt: null,
      stopReason: null,
      nextActionAt: next?.scheduledAt ?? null,
      version: automation.version + 1,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateAutomation(resumed);
    await this.store.updateInvoice(ctx.userId, automation.invoiceId, {
      collectionStatus: 'collecting',
    });
    await this.writeEvent(ctx, {
      invoiceId: automation.invoiceId,
      automationId,
      eventType: 'automation_resumed',
    });
    return resumed;
  }

  async cancelCollectionAutomation(
    ctx: ActorContext,
    automationId: string,
    reason = 'user_cancelled'
  ): Promise<CollectionAutomation> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    if (TERMINAL_AUTOMATION_STATUSES.includes(automation.status)) {
      throw new CollectionsDomainError(
        `Automation already ${automation.status}`,
        'invalid_transition'
      );
    }

    await this.skipPendingSteps(ctx, automationId, 'cancelled', reason);

    const cancelled: CollectionAutomation = {
      ...automation,
      status: 'cancelled',
      cancelledAt: nowUtcIso(),
      stopReason: reason,
      nextActionAt: null,
      version: automation.version + 1,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateAutomation(cancelled);
    await this.writeEvent(ctx, {
      invoiceId: automation.invoiceId,
      automationId,
      eventType: 'automation_cancelled',
      metadata: { reason },
    });
    return cancelled;
  }

  async completeCollectionAutomation(
    ctx: ActorContext,
    automationId: string
  ): Promise<CollectionAutomation> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    if (automation.status !== 'active' && automation.status !== 'paused') {
      throw new CollectionsDomainError(
        `Cannot complete automation in status ${automation.status}`,
        'invalid_transition'
      );
    }

    await this.skipPendingSteps(ctx, automationId, 'skipped', 'completed');

    const completed: CollectionAutomation = {
      ...automation,
      status: 'completed',
      completedAt: nowUtcIso(),
      stopReason: 'completed',
      nextActionAt: null,
      version: automation.version + 1,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateAutomation(completed);
    await this.store.updateInvoice(ctx.userId, automation.invoiceId, {
      collectionStatus: 'completed',
    });
    await this.writeEvent(ctx, {
      invoiceId: automation.invoiceId,
      automationId,
      eventType: 'automation_completed',
    });
    return completed;
  }

  /**
   * Manual mark-paid: ownership-checked, idempotent, completes automation,
   * cancels pending/retry/processing reminders so in-flight workers cannot send.
   */
  async markInvoicePaid(
    ctx: ActorContext,
    invoiceId: string
  ): Promise<{ automation: CollectionAutomation | null; alreadyPaid: boolean }> {
    const invoice = await this.requireInvoice(ctx.userId, invoiceId);
    const alreadyPaid =
      invoice.collectionStatus === 'paid' || invoice.status === 'paid' || Boolean(invoice.paidAt);

    if (!alreadyPaid) {
      await this.store.updateInvoice(ctx.userId, invoiceId, {
        collectionStatus: 'paid',
        status: 'paid',
        paidAt: nowUtcIso().slice(0, 10),
      });
    } else {
      // Ensure status fields stay consistent on repeat calls
      await this.store.updateInvoice(ctx.userId, invoiceId, {
        collectionStatus: 'paid',
        status: 'paid',
        paidAt: invoice.paidAt ?? nowUtcIso().slice(0, 10),
      });
    }

    const open = await this.store.findOpenAutomationForInvoice(ctx.userId, invoiceId);
    let automation: CollectionAutomation | null = null;

    if (open && !TERMINAL_AUTOMATION_STATUSES.includes(open.status)) {
      await this.skipPendingSteps(ctx, open.id, 'cancelled', 'marked_paid');
      automation = {
        ...open,
        status: 'completed',
        completedAt: nowUtcIso(),
        cancelledAt: null,
        stopReason: 'marked_paid',
        nextActionAt: null,
        version: open.version + 1,
        updatedAt: nowUtcIso(),
      };
      await this.store.updateAutomation(automation);
      // Keep invoice as paid (completeCollectionAutomation would set completed)
      await this.store.updateInvoice(ctx.userId, invoiceId, {
        collectionStatus: 'paid',
        status: 'paid',
        paidAt: (await this.store.getInvoice(ctx.userId, invoiceId))?.paidAt ?? nowUtcIso().slice(0, 10),
      });
      if (!alreadyPaid) {
        await this.writeEvent(ctx, {
          invoiceId,
          automationId: open.id,
          eventType: 'automation_completed',
          metadata: { reason: 'marked_paid' },
        });
      }
    } else if (open && open.status === 'completed' && open.stopReason === 'marked_paid') {
      automation = open;
      // Still clear any stray cancelable steps (idempotent safety)
      await this.skipPendingSteps(ctx, open.id, 'cancelled', 'marked_paid');
    }

    if (!alreadyPaid) {
      await this.writeEvent(ctx, {
        invoiceId,
        automationId: automation?.id ?? open?.id ?? null,
        eventType: 'invoice_marked_paid',
        metadata: { source: ctx.source ?? 'user' },
      });
    }

    if (automation || open) {
      const steps = await this.store.listSteps(ctx.userId, (automation ?? open)!.id);
      const pending = steps.filter((s) => CANCELABLE_STEP_STATUSES.includes(s.status));
      if (pending.length) {
        throw new CollectionsDomainError(
          'Invariant violated: pending reminders remain after payment',
          'invariant'
        );
      }
    }

    return { automation, alreadyPaid };
  }

  async markInvoiceDisputed(
    ctx: ActorContext,
    invoiceId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<CollectionAutomation | null> {
    await this.requireInvoice(ctx.userId, invoiceId);
    await this.store.updateInvoice(ctx.userId, invoiceId, {
      collectionStatus: 'disputed',
    });

    const open = await this.store.findOpenAutomationForInvoice(ctx.userId, invoiceId);
    let automation: CollectionAutomation | null = null;
    if (open && open.status === 'active') {
      automation = await this.pauseCollectionAutomation(ctx, open.id, 'dispute');
    }

    await this.writeEvent(ctx, {
      invoiceId,
      automationId: automation?.id ?? open?.id ?? null,
      eventType: 'dispute_received',
      metadata,
    });
    return automation;
  }

  async scheduleRetry(
    ctx: ActorContext,
    stepId: string,
    nextScheduledAtUtc: string,
    errorCode?: string,
    errorMessage?: string
  ): Promise<ReminderStep> {
    const step = await this.store.getStep(ctx.userId, stepId);
    if (!step) {
      throw new CollectionsDomainError('Step not found or access denied', 'cross_user_or_missing');
    }
    if (step.attemptCount + 1 >= step.maximumAttempts) {
      const failed: ReminderStep = {
        ...step,
        status: 'failed',
        failedAt: nowUtcIso(),
        attemptCount: step.attemptCount + 1,
        lastErrorCode: errorCode ?? 'max_attempts',
        lastErrorMessage: errorMessage ?? 'Maximum attempts reached',
        updatedAt: nowUtcIso(),
      };
      await this.store.updateStep(failed);
      await this.writeEvent(ctx, {
        invoiceId: step.invoiceId,
        automationId: step.automationId,
        reminderStepId: step.id,
        eventType: 'reminder_failed',
        metadata: { errorCode, errorMessage },
      });
      return failed;
    }

    const retried: ReminderStep = {
      ...step,
      status: 'retry_scheduled',
      scheduledAt: assertUtcIso(nextScheduledAtUtc),
      attemptCount: step.attemptCount + 1,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: errorCode ?? null,
      lastErrorMessage: errorMessage ?? null,
      updatedAt: nowUtcIso(),
    };
    await this.store.updateStep(retried);
    await this.writeEvent(ctx, {
      invoiceId: step.invoiceId,
      automationId: step.automationId,
      reminderStepId: step.id,
      eventType: 'retry_scheduled',
      metadata: { nextScheduledAt: retried.scheduledAt, attemptCount: retried.attemptCount },
    });
    return retried;
  }

  async registerInboundReply(
    ctx: ActorContext,
    input: {
      provider: string;
      providerEventId: string;
      providerMessageId?: string | null;
      providerThreadId?: string | null;
      replyToken?: string | null;
      senderAddress?: string | null;
      recipientAddress?: string | null;
      subject?: string | null;
      textContent?: string | null;
      htmlContent?: string | null;
      classification: InboundClassification;
      classificationConfidence?: number | null;
      matchedInvoiceId?: string | null;
      matchedAutomationId?: string | null;
      rawMetadata?: Record<string, unknown>;
    }
  ): Promise<{ message: InboundMessage; paused: CollectionAutomation | null }> {
    // Strip secrets if callers accidentally pass them
    const raw = { ...(input.rawMetadata ?? {}) };
    for (const k of Object.keys(raw)) {
      const lk = k.toLowerCase();
      if (lk.includes('authorization') || lk.includes('secret') || lk.includes('api_key')) {
        delete raw[k];
      }
    }

    const existing = await this.store.findInboundByProviderEvent(
      input.provider,
      input.providerEventId
    );
    if (existing) {
      return { message: existing, paused: null };
    }

    let userId = ctx.userId;
    let invoiceId = input.matchedInvoiceId ?? null;
    let automationId = input.matchedAutomationId ?? null;

    if (input.matchedAutomationId) {
      const a = await this.store.getAutomation(ctx.userId, input.matchedAutomationId);
      if (!a) {
        throw new CollectionsDomainError(
          'Matched automation not found or access denied',
          'cross_user_or_missing'
        );
      }
      userId = a.userId;
      invoiceId = a.invoiceId;
      automationId = a.id;
    } else if (input.matchedInvoiceId) {
      await this.requireInvoice(ctx.userId, input.matchedInvoiceId);
    }

    const message: InboundMessage = {
      id: id(),
      userId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerMessageId: input.providerMessageId ?? null,
      providerThreadId: input.providerThreadId ?? null,
      replyToken: input.replyToken ?? null,
      senderAddress: input.senderAddress ?? null,
      recipientAddress: input.recipientAddress ?? null,
      subject: input.subject ?? null,
      textContent: input.textContent ?? null,
      htmlContent: input.htmlContent ?? null,
      receivedAt: nowUtcIso(),
      classification: input.classification,
      classificationConfidence: input.classificationConfidence ?? null,
      matchedInvoiceId: invoiceId,
      matchedAutomationId: automationId,
      requiresReview: MEANINGFUL_REPLY_CLASSIFICATIONS.includes(input.classification),
      attentionClearedAt: null,
      processedAt: nowUtcIso(),
      rawMetadata: raw,
      createdAt: nowUtcIso(),
    };

    await this.store.insertInbound(message);
    await this.writeEvent(
      { ...ctx, userId },
      {
        invoiceId,
        automationId,
        eventType: 'inbound_reply_received',
        metadata: { provider: input.provider, providerEventId: input.providerEventId },
      }
    );
    await this.writeEvent(
      { ...ctx, userId },
      {
        invoiceId,
        automationId,
        eventType: 'reply_classified',
        metadata: {
          classification: input.classification,
          confidence: input.classificationConfidence ?? null,
        },
      }
    );

    let paused: CollectionAutomation | null = null;
    if (
      automationId &&
      MEANINGFUL_REPLY_CLASSIFICATIONS.includes(input.classification)
    ) {
      const a = await this.store.getAutomation(userId, automationId);
      if (a && a.status === 'active') {
        const reason =
          input.classification === 'dispute'
            ? 'dispute'
            : input.classification === 'payment_claim' ||
                input.classification === 'payment_claimed'
              ? 'payment_claimed'
              : 'client_reply';
        paused = await this.pauseCollectionAutomation({ ...ctx, userId }, a.id, reason);
        if (input.classification === 'dispute') {
          await this.store.updateInvoice(userId, a.invoiceId, { collectionStatus: 'disputed' });
        }
        if (
          input.classification === 'payment_claim' ||
          input.classification === 'payment_claimed'
        ) {
          await this.store.updateInvoice(userId, a.invoiceId, {
            collectionStatus: 'payment_confirmation_pending',
          });
        }
      }
    }

    return { message, paused };
  }

  async registerPaymentPromise(
    ctx: ActorContext,
    input: {
      invoiceId: string;
      automationId?: string | null;
      promisedPaymentDate?: string | null;
      sourceMessageId?: string | null;
      confidence?: number | null;
    }
  ): Promise<PaymentPromise> {
    await this.requireInvoice(ctx.userId, input.invoiceId);
    if (input.automationId) {
      await this.requireAutomation(ctx.userId, input.automationId);
    }

    const promise: PaymentPromise = {
      id: id(),
      userId: ctx.userId,
      invoiceId: input.invoiceId,
      automationId: input.automationId ?? null,
      promisedPaymentDate: input.promisedPaymentDate ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      status: 'awaiting_approval',
      confidence: input.confidence ?? null,
      approvedByUser: false,
      dueNotifiedAt: null,
      createdAt: nowUtcIso(),
      updatedAt: nowUtcIso(),
    };
    await this.store.insertPromise(promise);
    await this.writeEvent(ctx, {
      invoiceId: input.invoiceId,
      automationId: input.automationId ?? null,
      eventType: 'payment_promise_received',
      metadata: { promiseId: promise.id, promisedPaymentDate: promise.promisedPaymentDate },
    });
    return promise;
  }

  /**
   * Approve a detected payment promise. Automation stays paused.
   * Does not schedule firmer reminders.
   */
  async confirmPaymentPromise(
    ctx: ActorContext,
    promiseId: string
  ): Promise<PaymentPromise> {
    const promise = await this.store.getPromise(ctx.userId, promiseId);
    if (!promise) {
      throw new CollectionsDomainError('Promise not found or access denied', 'cross_user_or_missing');
    }

    const updated: PaymentPromise = {
      ...promise,
      status: 'active',
      approvedByUser: true,
      updatedAt: nowUtcIso(),
    };
    await this.store.updatePromise(updated);

    if (promise.automationId) {
      const a = await this.store.getAutomation(ctx.userId, promise.automationId);
      if (a && a.status === 'active') {
        await this.pauseCollectionAutomation(ctx, a.id, 'payment_promise');
      }
      // If already paused, keep paused — never auto-resume
    }

    await this.writeEvent(ctx, {
      invoiceId: promise.invoiceId,
      automationId: promise.automationId,
      eventType: 'payment_confirmed',
      metadata: {
        promiseId,
        promisedPaymentDate: promise.promisedPaymentDate,
        automationRemainsPaused: true,
      },
    });
    return updated;
  }

  async fulfillPaymentPromise(
    ctx: ActorContext,
    promiseId: string,
    opts: { markInvoicePaid?: boolean } = {}
  ): Promise<PaymentPromise> {
    const promise = await this.store.getPromise(ctx.userId, promiseId);
    if (!promise) {
      throw new CollectionsDomainError('Promise not found or access denied', 'cross_user_or_missing');
    }
    const updated: PaymentPromise = {
      ...promise,
      status: 'fulfilled',
      updatedAt: nowUtcIso(),
    };
    await this.store.updatePromise(updated);
    await this.writeEvent(ctx, {
      invoiceId: promise.invoiceId,
      automationId: promise.automationId,
      eventType: 'payment_promise_fulfilled',
      metadata: { promiseId },
    });
    if (opts.markInvoicePaid !== false) {
      await this.markInvoicePaid(ctx, promise.invoiceId);
    }
    return updated;
  }

  async missPaymentPromise(ctx: ActorContext, promiseId: string): Promise<PaymentPromise> {
    const promise = await this.store.getPromise(ctx.userId, promiseId);
    if (!promise) {
      throw new CollectionsDomainError('Promise not found or access denied', 'cross_user_or_missing');
    }
    const updated: PaymentPromise = {
      ...promise,
      status: 'missed',
      updatedAt: nowUtcIso(),
    };
    await this.store.updatePromise(updated);
    await this.writeEvent(ctx, {
      invoiceId: promise.invoiceId,
      automationId: promise.automationId,
      eventType: 'payment_promise_missed',
      metadata: {
        promiseId,
        promisedPaymentDate: promise.promisedPaymentDate,
        note: 'Do not silently send a firm reminder; user must approve a new reminder to resume',
      },
    });
    if (promise.automationId) {
      const a = await this.store.getAutomation(ctx.userId, promise.automationId);
      if (a && a.status === 'active') {
        await this.pauseCollectionAutomation(ctx, a.id, 'payment_promise');
      }
    }
    await this.store.insertNotification({
      id: id(),
      userId: ctx.userId,
      kind: 'needs_attention',
      title: 'Payment promise missed',
      body: promise.promisedPaymentDate
        ? `Promised date ${promise.promisedPaymentDate} passed. Approve a new reminder to resume — firm messages are not sent automatically.`
        : 'Payment promise missed. Approve a new reminder to resume.',
      invoiceId: promise.invoiceId,
      automationId: promise.automationId,
      inboundMessageId: null,
      readAt: null,
      createdAt: nowUtcIso(),
    });
    return updated;
  }

  /**
   * Notify users when an approved promise date is reached.
   * Does not resume automation or send reminders.
   */
  async notifyDuePaymentPromises(now: Date = new Date()): Promise<number> {
    const due = await this.store.listActivePromisesDueOnOrBefore(now.toISOString().slice(0, 10));
    let count = 0;
    for (const promise of due) {
      if (promise.dueNotifiedAt) continue;
      const updated: PaymentPromise = {
        ...promise,
        dueNotifiedAt: nowUtcIso(),
        updatedAt: nowUtcIso(),
      };
      await this.store.updatePromise(updated);
      await this.store.insertNotification({
        id: id(),
        userId: promise.userId,
        kind: 'client_promises_payment',
        title: 'Payment promise date reached',
        body: `Promised date ${promise.promisedPaymentDate} is today. Confirm payment or resume with a new approved reminder.`,
        invoiceId: promise.invoiceId,
        automationId: promise.automationId,
        inboundMessageId: null,
        readAt: null,
        createdAt: nowUtcIso(),
      });
      await this.writeEvent(
        { userId: promise.userId, source: 'system' },
        {
          invoiceId: promise.invoiceId,
          automationId: promise.automationId,
          eventType: 'payment_promise_due',
          metadata: { promiseId: promise.id, promisedPaymentDate: promise.promisedPaymentDate },
        }
      );
      count += 1;
    }
    return count;
  }

  /**
   * Resume after a promise only with an explicitly approved new reminder plan.
   * Rejects firm/final tones unless manualApprovedAt is set — never silent firm escalate.
   */
  async resumeAfterPaymentPromise(
    ctx: ActorContext,
    automationId: string,
    newReminders: PlannedReminderInput[]
  ): Promise<{ automation: CollectionAutomation; steps: ReminderStep[] }> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    if (automation.status !== 'paused' && automation.status !== 'awaiting_user') {
      throw new CollectionsDomainError(
        `Cannot resume-after-promise from status ${automation.status}`,
        'invalid_transition'
      );
    }
    for (const r of newReminders) {
      if ((r.tone === 'firm' || r.tone === 'final') && !r.manualApprovedAt) {
        throw new CollectionsDomainError(
          'Firm/final reminders after a payment promise require explicit approval',
          'firm_needs_approval'
        );
      }
    }
    // Cancel leftover pending steps from before the promise
    await this.skipPendingSteps(ctx, automationId, 'cancelled', 'promise_resume_replace');
    const resumed = await this.resumeCollectionAutomation(ctx, automationId);
    // Activate-style insert of new approved reminders onto active automation
    const stepRows: ReminderStep[] = [];
    for (const r of [...newReminders].sort(
      (a, b) => new Date(a.scheduledAtUtc).getTime() - new Date(b.scheduledAtUtc).getTime()
    )) {
      const ts = nowUtcIso();
      stepRows.push({
        id: id(),
        automationId: resumed.id,
        invoiceId: resumed.invoiceId,
        userId: ctx.userId,
        sequenceNumber: r.sequenceNumber,
        channel: r.channel,
        scheduledAt: assertUtcIso(r.scheduledAtUtc),
        tone: r.tone,
        templateId: r.templateId ?? null,
        subjectSnapshot: r.subjectSnapshot,
        bodySnapshot: r.bodySnapshot,
        status: 'pending',
        attemptCount: 0,
        maximumAttempts: r.maximumAttempts ?? 5,
        claimedAt: null,
        claimExpiresAt: null,
        sentAt: null,
        skippedAt: null,
        failedAt: null,
        providerMessageId: null,
        providerThreadId: null,
        rfcMessageId: null,
        idempotencyKey: r.idempotencyKey,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastDryRunAt: null,
        manualApprovedAt: r.manualApprovedAt ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    if (stepRows.length) {
      await this.store.insertSteps(stepRows);
      const nextAt = stepRows[0].scheduledAt;
      const withNext = {
        ...resumed,
        nextActionAt: nextAt,
        updatedAt: nowUtcIso(),
        version: resumed.version + 1,
      };
      await this.store.updateAutomation(withNext);
      await this.writeEvent(ctx, {
        invoiceId: resumed.invoiceId,
        automationId,
        eventType: 'reminder_scheduled',
        metadata: { count: stepRows.length, afterPaymentPromise: true },
      });
      return { automation: withNext, steps: stepRows };
    }
    return { automation: resumed, steps: [] };
  }

  async skipPendingSteps(
    ctx: ActorContext,
    automationId: string,
    toStatus: 'skipped' | 'cancelled' = 'skipped',
    reason = 'manual_override'
  ): Promise<ReminderStep[]> {
    const automation = await this.requireAutomation(ctx.userId, automationId);
    const steps = await this.store.listSteps(ctx.userId, automationId);
    const updated: ReminderStep[] = [];
    for (const step of steps) {
      if (!CANCELABLE_STEP_STATUSES.includes(step.status)) continue;
      const next: ReminderStep = {
        ...step,
        status: toStatus,
        skippedAt: toStatus === 'skipped' ? nowUtcIso() : step.skippedAt,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: nowUtcIso(),
        lastErrorCode: reason,
        lastErrorMessage: reason,
      };
      await this.store.updateStep(next);
      updated.push(next);
    }

    await this.writeEvent(ctx, {
      invoiceId: automation.invoiceId,
      automationId,
      eventType: 'reminders_skipped',
      metadata: { count: updated.length, toStatus, reason },
    });
    return updated;
  }

  async registerProviderDeliveryEvent(
    ctx: ActorContext,
    input: {
      provider: string;
      providerEventId: string;
      providerMessageId?: string | null;
      reminderStepId?: string | null;
      eventStatus: ProviderDeliveryStatus;
      payloadHash?: string | null;
      rawMetadata?: Record<string, unknown>;
    }
  ): Promise<ProviderDeliveryEvent> {
    const existing = await this.store.findProviderEvent(input.provider, input.providerEventId);
    if (existing) return existing;

    const raw = { ...(input.rawMetadata ?? {}) };
    for (const k of Object.keys(raw)) {
      const lk = k.toLowerCase();
      if (lk.includes('authorization') || lk.includes('secret') || lk.includes('api_key')) {
        delete raw[k];
      }
    }

    const event: ProviderDeliveryEvent = {
      id: id(),
      userId: ctx.userId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerMessageId: input.providerMessageId ?? null,
      reminderStepId: input.reminderStepId ?? null,
      eventStatus: input.eventStatus,
      payloadHash: input.payloadHash ?? null,
      rawMetadata: raw,
      occurredAt: nowUtcIso(),
      processedAt: nowUtcIso(),
    };
    return this.store.insertProviderEvent(event);
  }
}

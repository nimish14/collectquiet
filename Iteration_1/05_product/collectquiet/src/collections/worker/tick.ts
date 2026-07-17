import type { WorkerStore } from '../store';
import type { CollectionEvent, ReminderStep } from '../types';
import { isRecipientAllowed, isUserAllowed, shouldDryRunSend } from '../flags';
import { collectionsMetrics } from '../observability/metrics';
import { emitAlerts, evaluateAlerts } from '../observability/alerts';
import {
  classifySendError,
  computeBackoffSeconds,
  isAlreadySent,
  PERMANENT_ERROR_CODES,
  SendError,
  type MessageSender,
  type OutboundMessage,
  type WorkerClock,
  type WorkerConfig,
} from './types';

export interface TickSummary {
  correlationId: string;
  enabled: boolean;
  dryRun: boolean;
  claimed: number;
  sent: number;
  dryRunLogged: number;
  retried: number;
  failed: number;
  skipped: number;
  errors: Array<{ stepId: string; code: string }>;
}

function newId(): string {
  return crypto.randomUUID();
}

export class CollectionsWorker {
  private readonly store: WorkerStore;
  private readonly sender: MessageSender;
  private readonly config: WorkerConfig;
  private readonly clock: WorkerClock;
  private readonly prepareOutbound: (
    step: ReminderStep,
    correlationId: string
  ) => Promise<{ outbound: OutboundMessage } | { block: string }>;

  constructor(
    store: WorkerStore,
    sender: MessageSender,
    config: WorkerConfig,
    clock: WorkerClock,
    prepareOutbound: (
      step: ReminderStep,
      correlationId: string
    ) => Promise<{ outbound: OutboundMessage } | { block: string }>
  ) {
    this.store = store;
    this.sender = sender;
    this.config = config;
    this.clock = clock;
    this.prepareOutbound = prepareOutbound;
  }

  async tick(correlationId = newId()): Promise<TickSummary> {
    const summary: TickSummary = {
      correlationId,
      enabled: this.config.enabled,
      dryRun: this.config.dryRun,
      claimed: 0,
      sent: 0,
      dryRunLogged: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    if (!this.config.enabled) {
      this.log(correlationId, 'worker_disabled', {});
      return summary;
    }

    const now = this.clock.now();
    collectionsMetrics.markSchedulerTick(now);
    const claimed = await this.store.claimDueSteps({
      now,
      limit: this.config.batchSize,
      claimTtlSeconds: this.config.claimTtlSeconds,
    });
    summary.claimed = claimed.length;
    collectionsMetrics.incr('reminders_due', claimed.length);

    for (const claimedStep of claimed) {
      try {
        await this.processClaimedStep(claimedStep, correlationId, summary);
      } catch (err) {
        const code = err instanceof Error ? err.message : 'unknown';
        summary.errors.push({ stepId: claimedStep.id, code: 'worker_error' });
        this.log(correlationId, 'step_error', {
          stepId: claimedStep.id,
          idempotencyKey: claimedStep.idempotencyKey,
          error: code,
        });
      }
    }

    this.log(correlationId, 'tick_complete', {
      claimed: summary.claimed,
      sent: summary.sent,
      dryRunLogged: summary.dryRunLogged,
      retried: summary.retried,
      failed: summary.failed,
      skipped: summary.skipped,
    });
    collectionsMetrics.emit({ correlationId });
    if (summary.failed >= 3) {
      emitAlerts(
        evaluateAlerts({
          lastSchedulerTickAt: collectionsMetrics.getLastSchedulerTickAt(),
          now,
          workerFailureStreak: summary.failed,
        })
      );
    }

    return summary;
  }

  private async processClaimedStep(
    claimedStep: ReminderStep,
    correlationId: string,
    summary: TickSummary
  ): Promise<void> {
    const now = this.clock.now();
    const nowIso = now.toISOString();

    // Re-load and re-check before send
    const step = await this.store.getStepById(claimedStep.id);
    if (!step) {
      summary.skipped += 1;
      return;
    }

    await this.appendEvent(step, 'reminder_claimed', correlationId, {
      idempotencyKey: step.idempotencyKey,
    });

    if (isAlreadySent(step) || (await this.store.hasEventTypeForStep(step.id, 'reminder_sent'))) {
      summary.skipped += 1;
      collectionsMetrics.incr('duplicate_sends_prevented');
      this.log(correlationId, 'already_sent_skip', {
        stepId: step.id,
        idempotencyKey: step.idempotencyKey,
      });
      emitAlerts(
        evaluateAlerts({
          lastSchedulerTickAt: collectionsMetrics.getLastSchedulerTickAt(),
          now,
          duplicateSendPrevented: true,
        })
      );
      return;
    }

    const automation = await this.store.getAutomationById(step.automationId);
    const invoice = automation
      ? await this.store.getInvoice(automation.userId, step.invoiceId)
      : null;

    if (
      automation &&
      !isUserAllowed(
        { allowlistMode: this.config.allowlistMode, allowlist: this.config.allowlist },
        { userId: automation.userId }
      )
    ) {
      await this.releaseSkip(step, nowIso, 'user_not_allowlisted');
      summary.skipped += 1;
      this.log(correlationId, 'allowlist_skip', {
        stepId: step.id,
        userId: automation.userId,
      });
      return;
    }

    if (!automation || automation.status !== 'active') {
      await this.releaseSkip(step, nowIso, 'automation_not_active');
      summary.skipped += 1;
      return;
    }
    if (
      !invoice ||
      invoice.status === 'paid' ||
      invoice.paidAt ||
      ['paid', 'disputed', 'written_off', 'completed', 'paused'].includes(invoice.collectionStatus)
    ) {
      await this.releaseSkip(step, nowIso, 'invoice_not_collectible');
      summary.skipped += 1;
      return;
    }
    if (await this.store.invoiceHasUnresolvedAttention(step.invoiceId)) {
      await this.releaseSkip(step, nowIso, 'unresolved_inbound_attention');
      summary.skipped += 1;
      return;
    }

    // Immediate pre-send DB re-check + compose (final safety gate)
    const prepared = await this.prepareOutbound(step, correlationId);
    if ('block' in prepared) {
      if (
        prepared.block === 'invalid_recipient' ||
        prepared.block === 'recipient_opted_out' ||
        prepared.block === 'firm_tone_needs_approval'
      ) {
        await this.handleSendFailure(
          step,
          new SendError(prepared.block, 'permanent', prepared.block),
          correlationId,
          summary,
          now
        );
        return;
      }
      await this.releaseSkip(step, nowIso, prepared.block);
      summary.skipped += 1;
      return;
    }
    const outbound = prepared.outbound;

    this.log(correlationId, 'prepared_message', {
      stepId: step.id,
      idempotencyKey: step.idempotencyKey,
      channel: step.channel,
      subjectLength: outbound.subject.length,
      bodyLength: outbound.body.length,
      provider: outbound.composed?.provider ?? 'none',
    });

    if (
      shouldDryRunSend(
        { dryRun: this.config.dryRun, emailSendingEnabled: this.config.emailSendingEnabled },
        automation.dryRun
      )
    ) {
      if (await this.store.hasEventTypeForStep(step.id, 'reminder_dry_run')) {
        summary.skipped += 1;
        await this.store.updateStep({
          ...step,
          status: 'skipped',
          skippedAt: nowIso,
          claimedAt: null,
          claimExpiresAt: null,
          lastErrorCode: 'dry_run_already_logged',
          updatedAt: nowIso,
        });
        return;
      }
      await this.store.updateStep({
        ...step,
        status: 'skipped',
        skippedAt: nowIso,
        claimedAt: null,
        claimExpiresAt: null,
        lastDryRunAt: nowIso,
        lastErrorCode: 'dry_run',
        lastErrorMessage: 'Dry-run only; provider not called',
        updatedAt: nowIso,
      });
      await this.appendEvent(step, 'reminder_dry_run', correlationId, {
        idempotencyKey: step.idempotencyKey,
        wouldSendToDomain: outbound.to.includes('@') ? outbound.to.split('@')[1] : 'unknown',
        from: outbound.composed?.from ?? null,
        replyTo: outbound.composed?.replyTo ?? null,
      });
      await this.store.refreshAutomationNextAction(step.automationId, now);
      summary.dryRunLogged += 1;
      return;
    }

    // Final re-read immediately before provider call
    const freshStep = await this.store.getStepById(step.id);
    const freshAuto = await this.store.getAutomationById(step.automationId);
    const freshInv = await this.store.getInvoice(step.userId, step.invoiceId);

    if (!this.isLeaseValid(freshStep, now)) {
      this.log(correlationId, 'lease_invalidated', {
        stepId: step.id,
        idempotencyKey: step.idempotencyKey,
        status: freshStep?.status ?? null,
        claimExpiresAt: freshStep?.claimExpiresAt ?? null,
      });
      await this.appendEvent(step, 'lease_invalidated', correlationId, {
        idempotencyKey: step.idempotencyKey,
        reason: 'lease_invalid_pre_send',
      });
      summary.skipped += 1;
      return;
    }

    if (
      !freshStep ||
      !freshAuto ||
      !freshInv ||
      freshAuto.status !== 'active' ||
      this.isInvoicePaid(freshInv) ||
      freshInv.collectionStatus === 'disputed' ||
      isAlreadySent(freshStep) ||
      (await this.store.invoiceHasUnresolvedAttention(step.invoiceId))
    ) {
      const reason = this.isInvoicePaid(freshInv)
        ? 'race_paid_during_send'
        : 'pre_send_state_changed';
      this.log(correlationId, reason, {
        stepId: step.id,
        idempotencyKey: step.idempotencyKey,
        automationStatus: freshAuto?.status ?? null,
        collectionStatus: freshInv?.collectionStatus ?? null,
      });
      if (reason === 'race_paid_during_send') {
        await this.appendEvent(step, 'race_paid_during_send', correlationId, {
          idempotencyKey: step.idempotencyKey,
        });
      }
      await this.releaseSkip(step, nowIso, reason);
      summary.skipped += 1;
      return;
    }

    if (!isRecipientAllowed(this.config, outbound.to)) {
      await this.releaseSkip(step, nowIso, 'recipient_not_allowlisted');
      summary.skipped += 1;
      this.log(correlationId, 'recipient_allowlist_skip', {
        stepId: step.id,
        toDomain: outbound.to.includes('@') ? outbound.to.split('@')[1] : 'unknown',
      });
      return;
    }

    try {
      const result = await this.sender.send(outbound);
      collectionsMetrics.incr('reminders_sent');

      // Reconcile provider-send result against latest invoice / lease state
      const postStep = await this.store.getStepById(step.id);
      const postAuto = await this.store.getAutomationById(step.automationId);
      const postInv = await this.store.getInvoice(step.userId, step.invoiceId);

      if (this.isInvoicePaid(postInv) || postAuto?.status === 'completed') {
        this.log(correlationId, 'race_paid_after_provider_send', {
          stepId: step.id,
          idempotencyKey: step.idempotencyKey,
          providerMessageId: result.providerMessageId,
          collectionStatus: postInv?.collectionStatus ?? null,
        });
        await this.appendEvent(step, 'race_paid_after_provider_send', correlationId, {
          idempotencyKey: step.idempotencyKey,
          providerMessageId: result.providerMessageId,
        });
        // Do not leave step as a normal successful reminder send
        await this.store.updateStep({
          ...(postStep ?? freshStep),
          status: 'cancelled',
          claimedAt: null,
          claimExpiresAt: null,
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId ?? null,
          rfcMessageId: result.rfcMessageId ?? null,
          lastErrorCode: 'race_paid_after_provider_send',
          lastErrorMessage: 'Invoice paid while provider request was in flight',
          updatedAt: nowIso,
        });
        summary.skipped += 1;
        return;
      }

      if (!this.isLeaseValid(postStep, now) && postStep?.status !== 'processing') {
        // Lease was cleared by mark-paid / cancel during send
        this.log(correlationId, 'lease_invalidated_post_send', {
          stepId: step.id,
          idempotencyKey: step.idempotencyKey,
          providerMessageId: result.providerMessageId,
        });
        await this.appendEvent(step, 'lease_invalidated', correlationId, {
          idempotencyKey: step.idempotencyKey,
          providerMessageId: result.providerMessageId,
          reason: 'lease_invalid_post_send',
        });
        summary.skipped += 1;
        return;
      }

      const sent: ReminderStep = {
        ...freshStep,
        status: 'sent',
        sentAt: nowIso,
        providerMessageId: result.providerMessageId,
        providerThreadId: result.providerThreadId ?? null,
        rfcMessageId: result.rfcMessageId ?? null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: nowIso,
      };
      await this.store.updateStep(sent);
      await this.appendEvent(step, 'reminder_sent', correlationId, {
        idempotencyKey: step.idempotencyKey,
        providerMessageId: result.providerMessageId,
      });
      await this.store.refreshAutomationNextAction(step.automationId, now);
      summary.sent += 1;
      // reminders_sent already incremented on successful provider return
    } catch (err) {
      // If paid during a failed send, prefer payment race skip over retry
      const postInv = await this.store.getInvoice(step.userId, step.invoiceId);
      if (this.isInvoicePaid(postInv)) {
        this.log(correlationId, 'race_paid_during_send', {
          stepId: step.id,
          idempotencyKey: step.idempotencyKey,
          while: 'provider_error',
        });
        await this.appendEvent(step, 'race_paid_during_send', correlationId, {
          idempotencyKey: step.idempotencyKey,
        });
        await this.releaseSkip(step, nowIso, 'race_paid_during_send');
        summary.skipped += 1;
        return;
      }
      const sendErr = classifySendError(err);
      await this.handleSendFailure(step, sendErr, correlationId, summary, now);
    }
  }

  private isInvoicePaid(
    invoice: { status?: string; paidAt?: string | null; collectionStatus?: string } | null
  ): boolean {
    if (!invoice) return false;
    return (
      invoice.status === 'paid' ||
      Boolean(invoice.paidAt) ||
      invoice.collectionStatus === 'paid'
    );
  }

  /** Processing lease must still be held by this worker before/around send. */
  private isLeaseValid(step: ReminderStep | null, now: Date): boolean {
    if (!step) return false;
    if (step.status !== 'processing') return false;
    if (!step.claimExpiresAt) return false;
    if (new Date(step.claimExpiresAt).getTime() < now.getTime()) return false;
    return true;
  }

  private async handleSendFailure(
    step: ReminderStep,
    sendErr: ReturnType<typeof classifySendError>,
    correlationId: string,
    summary: TickSummary,
    now: Date
  ): Promise<void> {
    const nowIso = now.toISOString();
    const attempt = step.attemptCount + 1;
    const permanent =
      sendErr.kind === 'permanent' || PERMANENT_ERROR_CODES.has(sendErr.code);
    const exhausted = attempt >= this.config.maxAttempts;

    if (permanent || exhausted) {
      const failed: ReminderStep = {
        ...step,
        status: 'failed',
        failedAt: nowIso,
        attemptCount: attempt,
        claimedAt: null,
        claimExpiresAt: null,
        lastErrorCode: sendErr.code,
        lastErrorMessage: sendErr.message,
        updatedAt: nowIso,
      };
      await this.store.updateStep(failed);
      await this.appendEvent(step, 'reminder_failed', correlationId, {
        idempotencyKey: step.idempotencyKey,
        code: sendErr.code,
        kind: sendErr.kind,
        attempt,
      });
      await this.appendEvent(step, 'needs_attention', correlationId, {
        reason: permanent ? 'permanent_send_failure' : 'retry_exhausted',
        code: sendErr.code,
        idempotencyKey: step.idempotencyKey,
      });
      await this.store.refreshAutomationNextAction(step.automationId, now);
      summary.failed += 1;
      collectionsMetrics.incr('failed_jobs');
      summary.errors.push({ stepId: step.id, code: sendErr.code });
      return;
    }

    const backoff = computeBackoffSeconds(attempt, this.config.baseBackoffSeconds);
    const nextAt = new Date(now.getTime() + backoff * 1000).toISOString();
    const retried: ReminderStep = {
      ...step,
      status: 'retry_scheduled',
      scheduledAt: nextAt,
      attemptCount: attempt,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: sendErr.code,
      lastErrorMessage: sendErr.message,
      updatedAt: nowIso,
    };
    await this.store.updateStep(retried);
    await this.appendEvent(step, 'retry_scheduled', correlationId, {
      idempotencyKey: step.idempotencyKey,
      attempt,
      nextScheduledAt: nextAt,
      backoffSeconds: backoff,
    });
    await this.store.refreshAutomationNextAction(step.automationId, now);
    summary.retried += 1;
    collectionsMetrics.incr('retries');
  }

  private async releaseSkip(step: ReminderStep, nowIso: string, reason: string): Promise<void> {
    await this.store.updateStep({
      ...step,
      status: 'cancelled',
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: reason,
      lastErrorMessage: reason,
      updatedAt: nowIso,
    });
    await this.appendEvent(step, 'reminders_skipped', crypto.randomUUID(), { reason });
    await this.store.refreshAutomationNextAction(step.automationId, new Date(nowIso));
  }

  private async appendEvent(
    step: ReminderStep,
    eventType: CollectionEvent['eventType'],
    correlationId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendEvent({
      id: newId(),
      userId: step.userId,
      invoiceId: step.invoiceId,
      automationId: step.automationId,
      reminderStepId: step.id,
      eventType,
      source: 'worker',
      actorId: null,
      metadata: { ...metadata, correlationId },
      occurredAt: this.clock.now().toISOString(),
    });
  }

  private log(
    correlationId: string,
    event: string,
    data: Record<string, unknown>
  ): void {
    // Structured logs without message bodies
    console.info(
      JSON.stringify({
        svc: 'collections-worker',
        correlationId,
        event,
        ...data,
        ts: this.clock.now().toISOString(),
      })
    );
  }
}

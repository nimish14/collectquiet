import { describe, expect, it, beforeEach } from 'vitest';
import { CollectionsService } from '../service';
import { MemoryCollectionsStore } from '../store';
import { CollectionsWorker } from './tick';
import {
  FakeClock,
  RecordingMessageSender,
  SendError,
  computeBackoffSeconds,
  loadWorkerConfig,
  type WorkerConfig,
} from './types';
import type { PlannedReminderInput } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';
const INVOICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const NOW = new Date('2026-07-17T12:00:00.000Z');

function remindersAt(times: string[]): PlannedReminderInput[] {
  return times.map((scheduledAtUtc, i) => ({
    sequenceNumber: i + 1,
    channel: 'email' as const,
    scheduledAtUtc,
    tone: 'direct' as const,
    templateId: `t${i + 1}`,
    subjectSnapshot: `Subject ${i + 1}`,
    bodySnapshot: `Body ${i + 1}`,
    idempotencyKey: `idem-${i + 1}-${scheduledAtUtc}`,
  }));
}

async function seedActive(store: MemoryCollectionsStore, scheduled: string[]) {
  store.seedInvoice({
    id: INVOICE,
    userId: USER,
    status: 'overdue',
    collectionStatus: 'open',
    clientEmail: 'client@example.com',
  });
  const svc = new CollectionsService(store);
  const ctx = { userId: USER };
  const auto = await svc.createCollectionAutomation(ctx, {
    invoiceId: INVOICE,
    timezone: 'UTC',
    dryRun: false,
  });
  // Activate with wall-clock-future times, then pin steps to the fixture schedule.
  const activateTimes = scheduled.map((_, i) =>
    new Date(Date.now() + (i + 1) * 86_400_000).toISOString()
  );
  const { automation, steps } = await svc.activateCollectionAutomation(
    ctx,
    auto.id,
    remindersAt(activateTimes)
  );
  const pinned = [];
  for (let i = 0; i < steps.length; i++) {
    const updated = {
      ...steps[i]!,
      scheduledAt: scheduled[i]!,
      updatedAt: NOW.toISOString(),
    };
    await store.updateStep(updated);
    pinned.push(updated);
  }
  // Force collecting
  await store.updateInvoice(USER, INVOICE, { collectionStatus: 'collecting' });
  return { automation, steps: pinned, svc };
}

function cfg(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    enabled: true,
    dryRun: false,
    emailSendingEnabled: true,
    allowlistMode: 'allow_all',
    allowlist: new Set(),
    outboundRecipientAllowlist: new Set(),
    batchSize: 25,
    claimTtlSeconds: 300,
    maxAttempts: 3,
    baseBackoffSeconds: 60,
    ...overrides,
  };
}

describe('CollectionsWorker', () => {
  let store: MemoryCollectionsStore;
  let clock: FakeClock;
  let sender: RecordingMessageSender;

  beforeEach(() => {
    store = new MemoryCollectionsStore();
    clock = new FakeClock(NOW);
    sender = new RecordingMessageSender();
  });

  function worker(config: WorkerConfig = cfg()) {
    return new CollectionsWorker(store, sender, config, clock, async (step, correlationId) => {
      const inv = await store.getInvoice(step.userId, step.invoiceId);
      if (!inv?.clientEmail) {
        return { block: 'invalid_recipient' };
      }
      return {
        outbound: {
          to: inv.clientEmail,
          subject: step.subjectSnapshot,
          body: step.bodySnapshot,
          idempotencyKey: step.idempotencyKey,
          correlationId,
          channel: step.channel,
        },
      };
    });
  }

  it('sends one due reminder', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const summary = await worker().tick('c1');
    expect(summary.claimed).toBe(1);
    expect(summary.sent).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].idempotencyKey).toContain('idem-1');
    const steps = await store.listSteps(USER, (await store.findOpenAutomationForInvoice(USER, INVOICE))!.id);
    // automation cancelled? still open as active
    const all = [...store.steps.values()];
    expect(all[0].status).toBe('sent');
    expect(all[0].providerMessageId).toBeTruthy();
  });

  it('sends multiple due reminders', async () => {
    await seedActive(store, [
      '2026-07-17T10:00:00.000Z',
      '2026-07-17T11:00:00.000Z',
    ]);
    const summary = await worker().tick();
    expect(summary.claimed).toBe(2);
    expect(summary.sent).toBe(2);
  });

  it('ignores future reminders', async () => {
    await seedActive(store, ['2026-07-18T12:00:00.000Z']);
    const summary = await worker().tick();
    expect(summary.claimed).toBe(0);
    expect(summary.sent).toBe(0);
  });

  it('ignores paid invoice', async () => {
    const { automation } = await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    await store.updateInvoice(USER, INVOICE, {
      collectionStatus: 'paid',
      status: 'paid',
      paidAt: '2026-07-17',
    });
    const summary = await worker().tick();
    expect(summary.claimed).toBe(0);
    void automation;
  });

  it('ignores paused automation', async () => {
    const { automation, svc } = await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    await svc.pauseCollectionAutomation({ userId: USER }, automation.id, 'user_paused');
    const summary = await worker().tick();
    expect(summary.claimed).toBe(0);
  });

  it('ignores disputed invoice', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    await store.updateInvoice(USER, INVOICE, { collectionStatus: 'disputed' });
    const summary = await worker().tick();
    expect(summary.claimed).toBe(0);
  });

  it('two simultaneous workers do not double-send', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const w1 = worker();
    const w2 = worker(cfg());
    const sender2 = new RecordingMessageSender();
    const w2b = new CollectionsWorker(store, sender2, cfg(), clock, async (step, correlationId) => {
      const inv = await store.getInvoice(step.userId, step.invoiceId);
      return {
        outbound: {
          to: inv!.clientEmail!,
          subject: step.subjectSnapshot,
          body: step.bodySnapshot,
          idempotencyKey: step.idempotencyKey,
          correlationId,
          channel: step.channel,
        },
      };
    });

    const [a, b] = await Promise.all([w1.tick('a'), w2b.tick('b')]);
    expect(a.sent + b.sent).toBe(1);
    expect(sender.sent.length + sender2.sent.length).toBe(1);
  });

  it('recovers expired processing claims', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const step = [...store.steps.values()][0];
    step.status = 'processing';
    step.claimedAt = '2026-07-17T11:50:00.000Z';
    step.claimExpiresAt = '2026-07-17T11:55:00.000Z';
    clock.set('2026-07-17T12:00:00.000Z');
    const summary = await worker().tick();
    expect(summary.claimed).toBe(1);
    expect(summary.sent).toBe(1);
  });

  it('duplicate scheduler invocation does not resend', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const w = worker();
    const first = await w.tick('d1');
    const second = await w.tick('d2');
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sender.sent).toHaveLength(1);
  });

  it('retries temporary provider failure', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    sender.nextError = new SendError('timeout', 'temporary', 'temporary_failure');
    const summary = await worker().tick();
    expect(summary.retried).toBe(1);
    expect(summary.sent).toBe(0);
    const step = [...store.steps.values()][0];
    expect(step.status).toBe('retry_scheduled');
    expect(step.attemptCount).toBe(1);
    expect(new Date(step.scheduledAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('fails permanently without retry', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    sender.nextError = new SendError('bad address', 'permanent', 'invalid_recipient');
    const summary = await worker().tick();
    expect(summary.failed).toBe(1);
    const step = [...store.steps.values()][0];
    expect(step.status).toBe('failed');
    const events = store.events.map((e) => e.eventType);
    expect(events).toContain('needs_attention');
  });

  it('exhausts retries then fails', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const w = worker(cfg({ maxAttempts: 3, baseBackoffSeconds: 1 }));

    for (let i = 0; i < 3; i++) {
      sender.nextError = new SendError('temp', 'temporary', 'temporary_failure');
      // Make step due
      const step = [...store.steps.values()][0];
      if (step.status === 'retry_scheduled') {
        step.scheduledAt = clock.now().toISOString();
        step.status = 'pending';
      }
      await w.tick(`ex-${i}`);
      clock.advanceMinutes(1);
    }

    const step = [...store.steps.values()][0];
    expect(step.status).toBe('failed');
    expect(step.attemptCount).toBe(3);
  });

  it('dry-run logs without sending', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const summary = await worker(cfg({ dryRun: true })).tick();
    expect(summary.dryRunLogged).toBe(1);
    expect(summary.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    const step = [...store.steps.values()][0];
    expect(step.status).toBe('skipped');
    expect(step.sentAt).toBeNull();
    expect(store.events.some((e) => e.eventType === 'reminder_dry_run')).toBe(true);
  });

  it('disabled feature flag performs no sending', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    const summary = await worker(cfg({ enabled: false })).tick();
    expect(summary.enabled).toBe(false);
    expect(summary.claimed).toBe(0);
    expect(summary.sent).toBe(0);
  });

  it('loadWorkerConfig defaults', () => {
    expect(loadWorkerConfig({}).enabled).toBe(false);
    expect(loadWorkerConfig({}).dryRun).toBe(true);
    expect(loadWorkerConfig({ COLLECTION_AUTOMATION_ENABLED: 'true' }).enabled).toBe(true);
    expect(computeBackoffSeconds(1, 60)).toBe(60);
    expect(computeBackoffSeconds(3, 60)).toBe(240);
  });

  it('skips when unresolved inbound attention exists', async () => {
    await seedActive(store, ['2026-07-17T11:00:00.000Z']);
    store.inbounds.set('resend:1', {
      id: 'm1',
      userId: USER,
      provider: 'resend',
      providerEventId: '1',
      providerMessageId: null,
      providerThreadId: null,
      replyToken: null,
      senderAddress: 'c@x.com',
      recipientAddress: null,
      subject: null,
      textContent: 'hi',
      htmlContent: null,
      receivedAt: NOW.toISOString(),
      classification: 'human_reply',
      classificationConfidence: 1,
      matchedInvoiceId: INVOICE,
      matchedAutomationId: null,
      requiresReview: true,
      attentionClearedAt: null,
      processedAt: NOW.toISOString(),
      rawMetadata: {},
      createdAt: NOW.toISOString(),
    });
    const summary = await worker().tick();
    expect(summary.claimed).toBe(0);
  });
});

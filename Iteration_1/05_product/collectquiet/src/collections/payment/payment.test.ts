import { describe, expect, it } from 'vitest';
import { CollectionsService } from '../service';
import { MemoryCollectionsStore } from '../store';
import { CollectionsWorker } from '../worker/tick';
import { FakeClock, RecordingMessageSender } from '../worker/types';
import { MockPaymentWebhookAdapter, processPaymentWebhook } from './webhooks';
import type { PlannedReminderInput } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const INVOICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INVOICE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-07-17T12:00:00.000Z');

function reminders(n: number, from = '2026-07-18T11:00:00.000Z'): PlannedReminderInput[] {
  return Array.from({ length: n }, (_, i) => ({
    sequenceNumber: i + 1,
    channel: 'email' as const,
    scheduledAtUtc: new Date(new Date(from).getTime() + i * 86400000).toISOString(),
    tone: 'direct' as const,
    subjectSnapshot: `S${i + 1}`,
    bodySnapshot: `B${i + 1}`,
    idempotencyKey: `pay-idem-${i + 1}-${from}`,
  }));
}

async function seed(
  store: MemoryCollectionsStore,
  opts: {
    userId?: string;
    invoiceId?: string;
    amount?: number;
    currency?: string;
    scheduled?: string[];
  } = {}
) {
  const userId = opts.userId ?? USER;
  const invoiceId = opts.invoiceId ?? INVOICE;
  store.seedInvoice({
    id: invoiceId,
    userId,
    status: 'overdue',
    collectionStatus: 'collecting',
    clientEmail: 'client@example.com',
    amount: opts.amount ?? 100,
    currency: opts.currency ?? 'USD',
    dueAt: '2026-07-01',
    invoiceNumber: 'INV-1',
  });
  const svc = new CollectionsService(store);
  const auto = await svc.createCollectionAutomation(
    { userId },
    { invoiceId, timezone: 'UTC', dryRun: false }
  );
  const times = opts.scheduled ?? ['2026-07-17T11:00:00.000Z', '2026-07-20T11:00:00.000Z'];
  const { steps } = await svc.activateCollectionAutomation(
    { userId },
    auto.id,
    times.map((_, i) => ({
      sequenceNumber: i + 1,
      channel: 'email' as const,
      scheduledAtUtc: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
      tone: 'direct' as const,
      subjectSnapshot: `S${i + 1}`,
      bodySnapshot: `B${i + 1}`,
      idempotencyKey: `seed-${invoiceId}-${i}`,
    }))
  );
  const pinned = [];
  for (let i = 0; i < steps.length; i++) {
    const updated = {
      ...steps[i]!,
      scheduledAt: times[i]!,
      updatedAt: new Date().toISOString(),
    };
    await store.updateStep(updated);
    pinned.push(updated);
  }
  await store.updateInvoice(userId, invoiceId, { collectionStatus: 'collecting' });
  return { svc, auto: (await store.getAutomationById(auto.id))!, steps: pinned, store };
}

describe('manual mark paid', () => {
  it('marks invoice paid and completes automation', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, auto } = await seed(store);
    const { automation, alreadyPaid } = await svc.markInvoicePaid({ userId: USER }, INVOICE);
    expect(alreadyPaid).toBe(false);
    expect(automation?.status).toBe('completed');
    expect(automation?.stopReason).toBe('marked_paid');
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).toBe('paid');
    const steps = await store.listSteps(USER, auto.id);
    expect(steps.every((s) => !['pending', 'retry_scheduled', 'processing'].includes(s.status))).toBe(
      true
    );
    const events = await store.listEvents(USER);
    expect(events.some((e) => e.eventType === 'invoice_marked_paid')).toBe(true);
    expect(events.some((e) => e.eventType === 'automation_completed')).toBe(true);
  });

  it('repeated mark-paid is idempotent', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store);
    const first = await svc.markInvoicePaid({ userId: USER }, INVOICE);
    const second = await svc.markInvoicePaid({ userId: USER }, INVOICE);
    expect(first.alreadyPaid).toBe(false);
    expect(second.alreadyPaid).toBe(true);
    const events = (await store.listEvents(USER)).filter((e) => e.eventType === 'invoice_marked_paid');
    expect(events).toHaveLength(1);
  });

  it('payment before first reminder', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, auto } = await seed(store, {
      scheduled: ['2026-07-18T11:00:00.000Z'],
    });
    await svc.markInvoicePaid({ userId: USER }, INVOICE);
    const worker = new CollectionsWorker(
      store,
      new RecordingMessageSender(),
      {
        enabled: true,
        dryRun: false,
        emailSendingEnabled: true,
        allowlistMode: 'allow_all' as const,
        allowlist: new Set<string>(),
        outboundRecipientAllowlist: new Set<string>(),
        batchSize: 25,
        claimTtlSeconds: 300,
        maxAttempts: 3,
        baseBackoffSeconds: 60,
      },
      new FakeClock(NOW),
      async (step, correlationId) => ({
        outbound: {
          to: 'c@x.com',
          subject: step.subjectSnapshot,
          body: step.bodySnapshot,
          idempotencyKey: step.idempotencyKey,
          correlationId,
          channel: 'email',
        },
      })
    );
    const summary = await worker.tick();
    expect(summary.claimed).toBe(0);
    expect(summary.sent).toBe(0);
    expect((await store.getAutomationById(auto.id))?.status).toBe('completed');
  });

  it('payment after one reminder sent', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, steps } = await seed(store);
    const first = steps[0];
    await store.updateStep({
      ...first,
      status: 'sent',
      sentAt: NOW.toISOString(),
      providerMessageId: 're_1',
    });
    await svc.markInvoicePaid({ userId: USER }, INVOICE);
    const remaining = await store.listSteps(USER, first.automationId);
    expect(remaining.find((s) => s.id === first.id)?.status).toBe('sent');
    expect(remaining.filter((s) => s.status === 'pending')).toHaveLength(0);
  });

  it('rejects cross-user payment modification', async () => {
    const store = new MemoryCollectionsStore();
    await seed(store);
    await expect(svcMark(store, USER_B)).rejects.toMatchObject({ code: 'cross_user_or_missing' });
  });
});

async function svcMark(store: MemoryCollectionsStore, userId: string) {
  return new CollectionsService(store).markInvoicePaid({ userId }, INVOICE);
}

describe('race conditions', () => {
  it('payment while worker has claimed a reminder', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { scheduled: ['2026-07-17T11:00:00.000Z'] });
    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      {
        enabled: true,
        dryRun: false,
        emailSendingEnabled: true,
        allowlistMode: 'allow_all' as const,
        allowlist: new Set<string>(),
        outboundRecipientAllowlist: new Set<string>(),
        batchSize: 25,
        claimTtlSeconds: 300,
        maxAttempts: 3,
        baseBackoffSeconds: 60,
      },
      new FakeClock(NOW),
      async (step, correlationId) => {
        await svc.markInvoicePaid({ userId: USER }, INVOICE);
        return {
          outbound: {
            to: 'c@x.com',
            subject: step.subjectSnapshot,
            body: step.bodySnapshot,
            idempotencyKey: step.idempotencyKey,
            correlationId,
            channel: 'email',
          },
        };
      }
    );
    const summary = await worker.tick('claim-race');
    expect(summary.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    expect(store.events.some((e) => e.eventType === 'lease_invalidated' || e.eventType === 'race_paid_during_send' || e.eventType === 'reminders_skipped')).toBe(
      true
    );
  });

  it('payment after provider request but before response', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { scheduled: ['2026-07-17T11:00:00.000Z'] });
    const sender = new RecordingMessageSender();
    sender.duringSend = async () => {
      await svc.markInvoicePaid({ userId: USER }, INVOICE);
    };
    const worker = new CollectionsWorker(
      store,
      sender,
      {
        enabled: true,
        dryRun: false,
        emailSendingEnabled: true,
        allowlistMode: 'allow_all' as const,
        allowlist: new Set<string>(),
        outboundRecipientAllowlist: new Set<string>(),
        batchSize: 25,
        claimTtlSeconds: 300,
        maxAttempts: 3,
        baseBackoffSeconds: 60,
      },
      new FakeClock(NOW),
      async (step, correlationId) => ({
        outbound: {
          to: 'c@x.com',
          subject: step.subjectSnapshot,
          body: step.bodySnapshot,
          idempotencyKey: step.idempotencyKey,
          correlationId,
          channel: 'email',
        },
      })
    );
    const summary = await worker.tick('inflight-race');
    expect(summary.sent).toBe(0);
    expect(store.events.some((e) => e.eventType === 'race_paid_after_provider_send')).toBe(true);
    const steps = [...store.steps.values()];
    expect(steps[0].status).toBe('cancelled');
    expect(steps[0].lastErrorCode).toBe('race_paid_after_provider_send');
  });
});

describe('payment webhook processor (no live provider — mock only)', () => {
  it('duplicate payment webhook', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { amount: 100, currency: 'USD' });
    const adapter = new MockPaymentWebhookAdapter();
    const body = JSON.stringify({
      provider: 'mock_pay',
      providerEventId: 'pay_1',
      providerTransactionId: 'txn_1',
      invoiceId: INVOICE,
      amount: 100,
      currency: 'USD',
    });
    const first = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: body,
    });
    const second = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: body,
    });
    expect(first.outcome).toBe('full_payment');
    expect(second.duplicate).toBe(true);
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).toBe('paid');
  });

  it('invalid payment webhook signature', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store);
    const adapter = new MockPaymentWebhookAdapter();
    adapter.acceptSignatures = false;
    const result = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: '{}',
    });
    expect(result.ok).toBe(false);
    expect(result.invalidSignature).toBe(true);
  });

  it('wrong amount', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { amount: 100 });
    const adapter = new MockPaymentWebhookAdapter();
    const result = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: JSON.stringify({
        provider: 'mock_pay',
        providerEventId: 'pay_amt',
        invoiceId: INVOICE,
        amount: 150,
        currency: 'USD',
        providerTransactionId: 't',
      }),
    });
    expect(result.outcome).toBe('amount_mismatch');
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).not.toBe('paid');
    expect(store.notifications.some((n) => n.kind === 'needs_attention')).toBe(true);
  });

  it('wrong currency', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { amount: 100, currency: 'USD' });
    const adapter = new MockPaymentWebhookAdapter();
    const result = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: JSON.stringify({
        provider: 'mock_pay',
        providerEventId: 'pay_cur',
        invoiceId: INVOICE,
        amount: 100,
        currency: 'EUR',
        providerTransactionId: 't',
      }),
    });
    expect(result.outcome).toBe('currency_mismatch');
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).not.toBe('paid');
  });

  it('partial payment', async () => {
    const store = new MemoryCollectionsStore();
    const { svc } = await seed(store, { amount: 100 });
    const adapter = new MockPaymentWebhookAdapter();
    const result = await processPaymentWebhook({
      store,
      service: svc,
      adapter,
      headers: {},
      rawBody: JSON.stringify({
        provider: 'mock_pay',
        providerEventId: 'pay_part',
        invoiceId: INVOICE,
        amount: 40,
        currency: 'USD',
        isPartial: true,
        providerTransactionId: 't',
      }),
    });
    expect(result.outcome).toBe('partial_payment');
    expect(store.events.some((e) => e.eventType === 'payment_partial')).toBe(true);
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).not.toBe('paid');
  });
});

describe('payment promises', () => {
  it('fulfilled promise marks paid', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, auto } = await seed(store);
    await svc.pauseCollectionAutomation({ userId: USER }, auto.id, 'payment_promise');
    const promise = await svc.registerPaymentPromise(
      { userId: USER },
      {
        invoiceId: INVOICE,
        automationId: auto.id,
        promisedPaymentDate: '2026-08-01',
      }
    );
    await svc.confirmPaymentPromise({ userId: USER }, promise.id);
    expect((await store.getAutomationById(auto.id))?.status).toBe('paused');
    const fulfilled = await svc.fulfillPaymentPromise({ userId: USER }, promise.id);
    expect(fulfilled.status).toBe('fulfilled');
    expect((await store.getInvoice(USER, INVOICE))?.collectionStatus).toBe('paid');
  });

  it('missed promise does not send firm reminder', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, auto } = await seed(store);
    await svc.pauseCollectionAutomation({ userId: USER }, auto.id, 'payment_promise');
    const promise = await svc.registerPaymentPromise(
      { userId: USER },
      { invoiceId: INVOICE, automationId: auto.id, promisedPaymentDate: '2026-07-01' }
    );
    await svc.confirmPaymentPromise({ userId: USER }, promise.id);
    const missed = await svc.missPaymentPromise({ userId: USER }, promise.id);
    expect(missed.status).toBe('missed');
    expect((await store.getAutomationById(auto.id))?.status).toBe('paused');
    await expect(
      svc.resumeAfterPaymentPromise({ userId: USER }, auto.id, [
        {
          sequenceNumber: 1,
          channel: 'email',
          scheduledAtUtc: '2026-07-25T11:00:00.000Z',
          tone: 'firm',
          subjectSnapshot: 'Firm',
          bodySnapshot: 'Pay now',
          idempotencyKey: 'firm-no-approve',
        },
      ])
    ).rejects.toMatchObject({ code: 'firm_needs_approval' });

    const resumed = await svc.resumeAfterPaymentPromise({ userId: USER }, auto.id, [
      {
        sequenceNumber: 1,
        channel: 'email',
        scheduledAtUtc: '2026-07-25T11:00:00.000Z',
        tone: 'direct',
        subjectSnapshot: 'Gentle follow-up',
        bodySnapshot: 'Checking in',
        idempotencyKey: 'gentle-1',
      },
    ]);
    expect(resumed.automation.status).toBe('active');
    expect(resumed.steps[0].tone).toBe('direct');
  });

  it('notifies when promise date is reached', async () => {
    const store = new MemoryCollectionsStore();
    const { svc, auto } = await seed(store);
    await svc.pauseCollectionAutomation({ userId: USER }, auto.id, 'payment_promise');
    const promise = await svc.registerPaymentPromise(
      { userId: USER },
      { invoiceId: INVOICE, automationId: auto.id, promisedPaymentDate: '2026-07-17' }
    );
    await svc.confirmPaymentPromise({ userId: USER }, promise.id);
    const n = await svc.notifyDuePaymentPromises(NOW);
    expect(n).toBe(1);
    expect(store.events.some((e) => e.eventType === 'payment_promise_due')).toBe(true);
    const again = await svc.notifyDuePaymentPromises(NOW);
    expect(again).toBe(0);
  });
});

void reminders;
void INVOICE_B;

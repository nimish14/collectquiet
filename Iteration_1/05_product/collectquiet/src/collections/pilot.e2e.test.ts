/**
 * Stage 1 pilot E2E scenarios — mocked provider, FakeClock, no external messages.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionsService } from './service';
import { MemoryCollectionsStore } from './store';
import { CollectionsWorker } from './worker/tick';
import {
  FakeClock,
  RecordingMessageSender,
  SendError,
  type WorkerConfig,
} from './worker/types';
import { processInboundWebhook } from './inbound/pipeline';
import type { RawInboundEmail } from './inbound/types';
import {
  isRecipientAllowed,
  isUserAllowed,
  loadCollectionsFlags,
  parseAllowlist,
  shouldDryRunSend,
} from './flags';
import { CollectionsMetrics } from './observability/metrics';
import { evaluateAlerts } from './observability/alerts';
import type { PlannedReminderInput } from './types';

const USER = '11111111-1111-1111-1111-111111111111';
const INVOICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function pilotCfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
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
    ...over,
  };
}

function futureReminders(count = 3): PlannedReminderInput[] {
  return Array.from({ length: count }, (_, i) => {
    const scheduledAtUtc = new Date(Date.now() + (i + 1) * 86_400_000).toISOString();
    return {
      sequenceNumber: i + 1,
      channel: 'email' as const,
      scheduledAtUtc,
      tone: (i === 2 ? 'firm' : i === 0 ? 'friendly' : 'direct') as PlannedReminderInput['tone'],
      subjectSnapshot: `Reminder ${i + 1}`,
      bodySnapshot: `Body ${i + 1}`,
      idempotencyKey: `pilot-${INVOICE}-${i + 1}`,
      manualApprovedAt: i === 2 ? new Date().toISOString() : null,
    };
  });
}

async function activateThree(
  store: MemoryCollectionsStore,
  scheduledPins?: string[]
) {
  store.seedInvoice({
    id: INVOICE,
    userId: USER,
    status: 'overdue',
    collectionStatus: 'open',
    clientEmail: 'client@example.com',
    clientName: 'Client',
    invoiceNumber: 'INV-PILOT',
    amount: 50,
    currency: 'USD',
    dueAt: '2026-07-20',
  });
  const svc = new CollectionsService(store);
  const auto = await svc.createCollectionAutomation(
    { userId: USER },
    { invoiceId: INVOICE, timezone: 'UTC', dryRun: false }
  );
  const reminders = futureReminders(3);
  const { steps } = await svc.activateCollectionAutomation({ userId: USER }, auto.id, reminders);
  const pinned = [];
  for (let i = 0; i < steps.length; i++) {
    const scheduledAt = scheduledPins?.[i] ?? steps[i]!.scheduledAt;
    const updated = { ...steps[i]!, scheduledAt, updatedAt: NOW.toISOString() };
    await store.updateStep(updated);
    pinned.push(updated);
  }
  await store.updateInvoice(USER, INVOICE, { collectionStatus: 'collecting' });
  return { svc, auto: (await store.getAutomationById(auto.id))!, steps: pinned, store };
}

function prepareOutbound() {
  return async (
    step: { subjectSnapshot: string; bodySnapshot: string; idempotencyKey: string; channel: string },
    correlationId: string
  ) => ({
    outbound: {
      to: 'client@example.com',
      subject: step.subjectSnapshot,
      body: step.bodySnapshot,
      idempotencyKey: step.idempotencyKey,
      correlationId,
      channel: step.channel,
    },
  });
}

async function inbound(
  store: MemoryCollectionsStore,
  svc: CollectionsService,
  email: RawInboundEmail
) {
  return processInboundWebhook({
    store,
    service: svc,
    headers: { 'svix-id': '1' },
    rawBody: JSON.stringify({ type: 'email.received', data: {} }),
    verify: () => true,
    parse: () => email,
    llm: null,
  });
}

describe('feature flags + allowlist', () => {
  it('defaults keep production closed', () => {
    const f = loadCollectionsFlags({});
    expect(f.automationEnabled).toBe(false);
    expect(f.dryRun).toBe(true);
    expect(f.emailSendingEnabled).toBe(false);
    expect(f.replyDetectionEnabled).toBe(false);
    expect(f.paymentWebhookEnabled).toBe(false);
    expect(f.allowlistMode).toBe('deny_all');
  });

  it('parses user id and email allowlists', () => {
    expect(parseAllowlist('*').mode).toBe('allow_all');
    const list = parseAllowlist(`${USER},founder@collectquiet.app`);
    expect(list.mode).toBe('list');
    expect(isUserAllowed({ allowlistMode: 'list', allowlist: list.entries }, { userId: USER })).toBe(
      true
    );
    expect(
      isUserAllowed(
        { allowlistMode: 'list', allowlist: list.entries },
        { userId: 'other', email: 'founder@collectquiet.app' }
      )
    ).toBe(true);
    expect(
      isUserAllowed({ allowlistMode: 'deny_all', allowlist: new Set() }, { userId: USER })
    ).toBe(false);
  });

  it('dry-run and email-sending gates', () => {
    expect(shouldDryRunSend({ dryRun: false, emailSendingEnabled: false })).toBe(true);
    expect(shouldDryRunSend({ dryRun: false, emailSendingEnabled: true })).toBe(false);
    expect(shouldDryRunSend({ dryRun: true, emailSendingEnabled: true })).toBe(true);
  });

  it('skips non-allowlisted users in the worker', async () => {
    const store = new MemoryCollectionsStore();
    const { steps } = await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    void steps;
    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      pilotCfg({
        allowlistMode: 'list',
        allowlist: new Set(['someone-else']),
      }),
      new FakeClock(NOW),
      prepareOutbound()
    );
    const summary = await worker.tick('allowlist');
    expect(summary.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    expect(summary.skipped).toBeGreaterThan(0);
  });

  it('recipient allowlist blocks external clients in Stage 3', () => {
    expect(
      isRecipientAllowed(
        { outboundRecipientAllowlist: new Set(['qa@collectquiet.app']) },
        'client@acme.com'
      )
    ).toBe(false);
    expect(
      isRecipientAllowed(
        { outboundRecipientAllowlist: new Set(['qa@collectquiet.app']) },
        'qa@collectquiet.app'
      )
    ).toBe(true);
  });
});

describe('pilot E2E scenarios', () => {
  let store: MemoryCollectionsStore;

  beforeEach(() => {
    store = new MemoryCollectionsStore();
  });

  it('happy path: activate → send once → promise → pause → approve → mark paid → cancel rest → timeline', async () => {
    const { svc, auto, steps } = await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      pilotCfg(),
      new FakeClock(NOW),
      prepareOutbound()
    );

    const first = await worker.tick('happy-1');
    expect(first.sent).toBe(1);
    expect(sender.sent).toHaveLength(1);

    const second = await worker.tick('happy-2');
    expect(second.sent).toBe(0);
    expect(sender.sent).toHaveLength(1);

    const reply = await inbound(store, svc, {
      provider: 'resend',
      providerEventId: 'promise-1',
      from: 'client@example.com',
      to: `cq+${auto.replyToToken}@reply.collectquiet.app`,
      subject: 'Re: invoice',
      text: 'I will pay on 2026-08-08',
    });
    expect(reply.classification?.category).toBe('payment_promise');
    expect((await store.getAutomationById(auto.id))?.status).toBe('paused');

    const promises = [...store.promises.values()];
    expect(promises.length).toBeGreaterThan(0);
    await svc.confirmPaymentPromise({ userId: USER }, promises[0]!.id);

    await svc.markInvoicePaid({ userId: USER }, INVOICE);
    const afterPaid = await store.getAutomationById(auto.id);
    expect(afterPaid?.status).toBe('completed');

    const remaining = (await store.listSteps(USER, auto.id)).filter(
      (s) => s.id !== steps[0]!.id
    );
    expect(remaining.every((s) => ['cancelled', 'skipped', 'sent'].includes(s.status))).toBe(true);

    const types = (await store.listEvents(USER, auto.id)).map((e) => e.eventType);
    expect(types).toContain('automation_activated');
    expect(types).toContain('reminder_sent');
    expect(types).toContain('inbound_reply_received');
    expect(types).toContain('invoice_marked_paid');
    expect(types).toContain('automation_completed');
  });

  it('payment before reminder: nothing is sent', async () => {
    const { svc, auto } = await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    await svc.markInvoicePaid({ userId: USER }, INVOICE);
    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      pilotCfg(),
      new FakeClock(NOW),
      prepareOutbound()
    );
    const summary = await worker.tick('paid-first');
    expect(summary.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    expect((await store.getAutomationById(auto.id))?.status).toBe('completed');
  });

  it('reply before reminder: nothing is sent', async () => {
    const { svc, auto } = await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    await inbound(store, svc, {
      provider: 'resend',
      providerEventId: 'early-reply',
      from: 'client@example.com',
      to: `cq+${auto.replyToToken}@reply.collectquiet.app`,
      subject: 'Re',
      text: 'Got it, reviewing now.',
    });
    expect((await store.getAutomationById(auto.id))?.status).toBe('paused');

    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      pilotCfg(),
      new FakeClock(NOW),
      prepareOutbound()
    );
    const summary = await worker.tick('reply-first');
    expect(summary.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('duplicate workers send only one message', async () => {
    await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    const senderA = new RecordingMessageSender();
    const senderB = new RecordingMessageSender();
    const clock = new FakeClock(NOW);
    const workerA = new CollectionsWorker(store, senderA, pilotCfg(), clock, prepareOutbound());
    const workerB = new CollectionsWorker(store, senderB, pilotCfg(), clock, prepareOutbound());
    const [a, b] = await Promise.all([workerA.tick('dup-a'), workerB.tick('dup-b')]);
    expect(a.sent + b.sent).toBe(1);
    expect(senderA.sent.length + senderB.sent.length).toBe(1);
  });

  it('duplicate inbound webhook creates one message', async () => {
    const { svc, auto } = await activateThree(store);
    const email: RawInboundEmail = {
      provider: 'resend',
      providerEventId: 'dup-webhook-1',
      from: 'client@example.com',
      to: `cq+${auto.replyToToken}@reply.collectquiet.app`,
      subject: 'Re',
      text: 'Paying Friday',
    };
    const first = await inbound(store, svc, email);
    const second = await inbound(store, svc, email);
    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect([...store.inbounds.values()].filter((m) => m.providerEventId === 'dup-webhook-1')).toHaveLength(
      1
    );
  });

  it('provider timeout retries then alerts after exhaustion without duplicate send', async () => {
    await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    const sender = new RecordingMessageSender();
    sender.nextError = new SendError('timeout', 'temporary', 'temporary_failure');
    const clock = new FakeClock(NOW);
    const worker = new CollectionsWorker(store, sender, pilotCfg({ maxAttempts: 3 }), clock, prepareOutbound());

    const r1 = await worker.tick('outage-1');
    expect(r1.retried).toBe(1);
    expect(sender.sent).toHaveLength(0);

    // Advance to retry window and exhaust
    for (let i = 0; i < 2; i++) {
      const steps = [...store.steps.values()].filter((s) => s.status === 'retry_scheduled');
      for (const s of steps) {
        await store.updateStep({
          ...s,
          scheduledAt: clock.now().toISOString(),
          updatedAt: clock.now().toISOString(),
        });
      }
      sender.nextError = new SendError('timeout', 'temporary', 'temporary_failure');
      await worker.tick(`outage-${i + 2}`);
      clock.advanceMinutes(2);
    }

    const failed = [...store.steps.values()].find((s) => s.status === 'failed');
    expect(failed).toBeTruthy();
    expect(sender.sent).toHaveLength(0);
    const attention = (await store.listEvents(USER)).some((e) => e.eventType === 'needs_attention');
    expect(attention).toBe(true);
  });

  it('dispute pauses, cancels firm path via attention, Needs Attention item', async () => {
    const { svc, auto } = await activateThree(store, [
      '2026-08-01T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
      '2026-08-10T11:00:00.000Z',
    ]);
    const reply = await inbound(store, svc, {
      provider: 'resend',
      providerEventId: 'dispute-1',
      from: 'client@example.com',
      to: `cq+${auto.replyToToken}@reply.collectquiet.app`,
      subject: 'Dispute',
      text: 'I dispute this invoice. The work was never delivered.',
    });
    expect(reply.classification?.category).toBe('dispute');
    expect((await store.getAutomationById(auto.id))?.status).toBe('paused');
    expect(store.notifications.some((n) => n.kind === 'client_disputes' || n.kind === 'needs_attention' || n.title.toLowerCase().includes('dispute'))).toBe(
      true
    );

    const sender = new RecordingMessageSender();
    const worker = new CollectionsWorker(
      store,
      sender,
      pilotCfg(),
      new FakeClock(NOW),
      prepareOutbound()
    );
    expect((await worker.tick('after-dispute')).sent).toBe(0);
  });

  it('opt-out cancels automation and suppresses contact', async () => {
    const { svc, auto } = await activateThree(store);
    const reply = await inbound(store, svc, {
      provider: 'resend',
      providerEventId: 'optout-1',
      from: 'client@example.com',
      to: `cq+${auto.replyToToken}@reply.collectquiet.app`,
      subject: 'Stop',
      text: 'Please unsubscribe me from these emails.',
    });
    expect(reply.classification?.category).toBe('unsubscribe');
    const inv = await store.getInvoice(USER, INVOICE);
    expect(inv?.optedOut).toBe(true);
    const autoAfter = await store.getAutomationById(auto.id);
    expect(['cancelled', 'paused', 'completed'].includes(autoAfter?.status ?? '')).toBe(true);
    expect(store.notifications.some((n) => n.kind === 'opt_out')).toBe(true);
  });
});

describe('observability', () => {
  it('tracks metrics without email bodies', () => {
    const m = new CollectionsMetrics();
    m.incr('reminders_sent', 10);
    m.incr('deliveries', 8);
    m.incr('bounces', 1);
    m.incr('replies', 3);
    m.recordReplyToPauseMs(1500);
    m.markSchedulerTick(NOW);
    const snap = m.snapshot();
    expect(snap.rates.deliveryRate).toBeCloseTo(0.8);
    expect(snap.rates.bounceRate).toBeCloseTo(0.1);
    expect(snap.rates.replyRate).toBeCloseTo(0.3);
    expect(snap.rates.avgReplyToPauseMs).toBe(1500);
    expect(JSON.stringify(snap)).not.toMatch(/Dear |Please pay|Subject:/);
  });

  it('evaluates operational alerts', () => {
    const alerts = evaluateAlerts({
      lastSchedulerTickAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
      now: NOW,
      schedulerStaleMinutes: 15,
      workerFailureStreak: 3,
      bounceCountRecent: 3,
      sentCountRecent: 10,
      duplicateSendPrevented: true,
      providerAuthRevoked: true,
    });
    const codes = alerts.map((a) => a.code);
    expect(codes).toContain('scheduler_stale');
    expect(codes).toContain('repeated_worker_failure');
    expect(codes).toContain('bounce_spike');
    expect(codes).toContain('duplicate_send_prevented');
    expect(codes).toContain('provider_authorization_revoked');
  });
});

describe('tenant isolation', () => {
  it('rejects cross-user mark paid / get automation', async () => {
    const local = new MemoryCollectionsStore();
    const { svc, auto } = await activateThree(local);
    const other = '22222222-2222-2222-2222-222222222222';
    await expect(svc.markInvoicePaid({ userId: other }, INVOICE)).rejects.toMatchObject({
      code: 'cross_user_or_missing',
    });
    await expect(
      svc.pauseCollectionAutomation({ userId: other }, auto.id, 'user_paused')
    ).rejects.toMatchObject({ code: 'cross_user_or_missing' });
  });
});

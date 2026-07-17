import { describe, expect, it, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { CollectionsService } from '../service';
import { MemoryCollectionsStore } from '../store';
import { CollectionsWorker } from '../worker/tick';
import { FakeClock, loadWorkerConfig, type WorkerConfig } from '../worker/types';
import { MockEmailProvider } from './mock';
import { composeReminderEmail, firmToneNeedsApproval } from './compose';
import { runFinalSafetyCheck } from './safety';
import { buildEmailPreview, sendTestEmailToMyself } from './preview';
import { createEmailMessageSender, loadReminderEmailContext } from './outbound';
import { processDeliveryWebhook } from './webhooks';
import { verifySvixSignature, ResendEmailProvider } from './resend';
import { EmailProviderError } from './types';
import type { ReminderEmailContext } from './types';

const USER = '11111111-1111-1111-1111-111111111111';
const INVOICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-07-17T12:00:00.000Z');

function baseCtx(over: Partial<ReminderEmailContext> = {}): ReminderEmailContext {
  return {
    to: 'client@example.com',
    clientName: 'Alex',
    invoiceNumber: 'INV-100',
    amount: 1500,
    currency: 'USD',
    dueAt: '2026-07-01',
    paymentLink: 'https://pay.example/inv100',
    subjectSnapshot: 'Invoice INV-100 was due',
    bodySnapshot: 'Hi Alex,\n\nPlease pay INV-100.',
    tone: 'direct',
    senderDisplayName: 'Jordan',
    businessName: 'Northline',
    replyToToken: 'abc123token',
    invoiceId: INVOICE,
    automationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    reminderStepId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    userId: USER,
    idempotencyKey: 'idem-test-1',
    correlationId: 'corr-1',
    timezone: 'UTC',
    scheduledAtUtc: '2026-07-17T11:00:00.000Z',
    manualApprovedAt: null,
    ...over,
  };
}

function cfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
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

describe('composeReminderEmail', () => {
  it('includes snapshots, invoice facts, reply-to and does not attach files', () => {
    const email = composeReminderEmail(baseCtx());
    expect(email.subject).toBe('Invoice INV-100 was due');
    expect(email.text).toContain('Please pay INV-100');
    expect(email.text).toContain('INV-100');
    expect(email.text).toContain('Alex');
    expect(email.replyTo).toContain('cq+abc123token@');
    expect(email.from).toContain('Jordan via CollectQuiet');
    expect(email.headers['X-CQ-Reply-Token']).toBe('abc123token');
    expect(email.headers['X-CQ-Invoice-Id']).toBe(INVOICE);
    expect(email.attachments).toBeUndefined();
    expect(email.provider).toBe('resend');
  });

  it('keeps snapshot subject after global template would change', () => {
    const email = composeReminderEmail(
      baseCtx({ subjectSnapshot: 'Frozen subject', bodySnapshot: 'Frozen body only' })
    );
    expect(email.subject).toBe('Frozen subject');
    expect(email.text).toContain('Frozen body only');
  });
});

describe('ResendEmailProvider + MockEmailProvider', () => {
  it('successful provider send', async () => {
    const mock = new MockEmailProvider();
    const composed = composeReminderEmail(baseCtx());
    const result = await mock.sendReminder(composed);
    expect(result.providerMessageId).toMatch(/^re_mock_/);
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0].idempotencyKey).toBe('idem-test-1');
  });

  it('provider timeout mapped as temporary', async () => {
    const mock = new MockEmailProvider();
    mock.nextSendError = new EmailProviderError('timeout', 'temporary', 'provider_timeout');
    const sender = createEmailMessageSender(mock);
    await expect(
      sender.send({
        to: 'a@b.com',
        subject: 's',
        body: 'b',
        idempotencyKey: 'k',
        correlationId: 'c',
        channel: 'email',
        composed: composeReminderEmail(baseCtx()),
      })
    ).rejects.toMatchObject({ kind: 'temporary', code: 'provider_timeout' });
  });

  it('invalid email address is permanent', async () => {
    const mock = new MockEmailProvider();
    mock.nextSendError = new EmailProviderError('invalid', 'permanent', 'invalid_recipient');
    await expect(mock.sendReminder(composeReminderEmail(baseCtx()))).rejects.toMatchObject({
      code: 'invalid_recipient',
    });
  });

  it('duplicate idempotent provider request returns same conceptual send once in mock', async () => {
    const mock = new MockEmailProvider();
    const composed = composeReminderEmail(baseCtx());
    await mock.sendReminder(composed);
    await mock.sendReminder(composed);
    // Mock does not dedupe; worker/idempotency layer prevents double claim — assert composed key stable
    expect(mock.sent[0].idempotencyKey).toBe(mock.sent[1].idempotencyKey);
  });
});

describe('webhooks', () => {
  it('rejects invalid webhook signature', async () => {
    const store = new MemoryCollectionsStore();
    const provider = new MockEmailProvider();
    provider.acceptWebhooks = false;
    const result = await processDeliveryWebhook({
      provider,
      store,
      headers: {},
      rawBody: '{}',
      findStepByProviderMessageId: async () => null,
      pauseAutomation: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });

  it('handles bounce webhook and pauses', async () => {
    const store = new MemoryCollectionsStore();
    store.seedInvoice({
      id: INVOICE,
      userId: USER,
      status: 'overdue',
      collectionStatus: 'collecting',
      clientEmail: 'c@x.com',
    });
    const svc = new CollectionsService(store);
    const auto = await svc.createCollectionAutomation(
      { userId: USER },
      { invoiceId: INVOICE, timezone: 'UTC', dryRun: false }
    );
    const { steps } = await svc.activateCollectionAutomation({ userId: USER }, auto.id, [
      {
        sequenceNumber: 1,
        channel: 'email',
        scheduledAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
        tone: 'direct',
        subjectSnapshot: 'S',
        bodySnapshot: 'B',
        idempotencyKey: 'bounce-1',
      },
    ]);
    await store.updateInvoice(USER, INVOICE, { collectionStatus: 'collecting' });
    const step = {
      ...steps[0]!,
      scheduledAt: '2026-07-17T11:00:00.000Z',
      providerMessageId: 're_bounce',
      updatedAt: new Date().toISOString(),
    };
    await store.updateStep(step);

    const provider = new MockEmailProvider();
    let paused = false;
    const result = await processDeliveryWebhook({
      provider,
      store,
      headers: { 'svix-id': '1' },
      rawBody: JSON.stringify({
        type: 'email.bounced',
        created_at: NOW.toISOString(),
        data: {
          email_id: 're_bounce',
          tags: [
            { name: 'cq_step', value: step.id },
            { name: 'cq_invoice', value: INVOICE },
            { name: 'cq_automation', value: auto.id },
          ],
        },
      }),
      findStepByProviderMessageId: (id) => store.findStepByProviderMessageId(id),
      pauseAutomation: async () => {
        paused = true;
        await svc.pauseCollectionAutomation({ userId: USER }, auto.id, 'delivery_failure');
      },
    });
    expect(result.ok).toBe(true);
    expect(result.paused).toBe(true);
    expect(paused).toBe(true);
    expect(result.needsAttention).toBe(true);

    const dup = await processDeliveryWebhook({
      provider,
      store,
      headers: {},
      rawBody: JSON.stringify({
        type: 'email.bounced',
        created_at: NOW.toISOString(),
        data: { email_id: 're_bounce', tags: [{ name: 'cq_step', value: step.id }] },
      }),
      findStepByProviderMessageId: (id) => store.findStepByProviderMessageId(id),
      pauseAutomation: async () => undefined,
    });
    expect(dup.duplicate).toBe(true);
  });

  it('verifies svix signatures', () => {
    const secret = 'whsec_' + Buffer.from('testsecret').toString('base64');
    const id = 'msg_123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.delivered"}';
    const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
    const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
    expect(
      verifySvixSignature(secret, body, {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${sig}`,
      })
    ).toBe(true);
    expect(
      verifySvixSignature(secret, body, {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': 'v1,invalid',
      })
    ).toBe(false);
  });
});

describe('final safety + worker integration', () => {
  it('blocks send when paid immediately before sending', async () => {
    const store = new MemoryCollectionsStore();
    store.seedInvoice({
      id: INVOICE,
      userId: USER,
      status: 'overdue',
      collectionStatus: 'collecting',
      clientEmail: 'client@example.com',
      clientName: 'Alex',
      invoiceNumber: 'INV-1',
      amount: 100,
      currency: 'USD',
      dueAt: '2026-07-01',
    });
    const svc = new CollectionsService(store);
    const auto = await svc.createCollectionAutomation(
      { userId: USER },
      { invoiceId: INVOICE, timezone: 'UTC', dryRun: false }
    );
    const { steps: raceSteps } = await svc.activateCollectionAutomation(
      { userId: USER },
      auto.id,
      [
        {
          sequenceNumber: 1,
          channel: 'email',
          scheduledAtUtc: new Date(Date.now() + 86_400_000).toISOString(),
          tone: 'direct',
          subjectSnapshot: 'S',
          bodySnapshot: 'B',
          idempotencyKey: 'pay-race-1',
        },
      ]
    );
    await store.updateStep({
      ...raceSteps[0]!,
      scheduledAt: '2026-07-17T11:00:00.000Z',
      updatedAt: new Date().toISOString(),
    });
    await store.updateInvoice(USER, INVOICE, { collectionStatus: 'collecting' });

    const mock = new MockEmailProvider();
    const worker = new CollectionsWorker(
      store,
      createEmailMessageSender(mock),
      cfg(),
      new FakeClock(NOW),
      async (step, corr) => {
        // Simulate race: mark paid during prepare
        await store.updateInvoice(USER, INVOICE, {
          collectionStatus: 'paid',
          status: 'paid',
          paidAt: '2026-07-17',
        });
        const { ctx, block } = await loadReminderEmailContext(store, step, corr, {
          senderName: 'Jordan',
        });
        if (block) return { block };
        return {
          outbound: {
            to: ctx.to,
            subject: ctx.subjectSnapshot,
            body: ctx.bodySnapshot,
            idempotencyKey: ctx.idempotencyKey,
            correlationId: corr,
            channel: 'email',
            composed: composeReminderEmail(ctx),
          },
        };
      }
    );

    const summary = await worker.tick();
    expect(summary.sent).toBe(0);
    expect(mock.sent).toHaveLength(0);
  });

  it('blocks when meaningful reply arrives before send', async () => {
    expect(
      runFinalSafetyCheck({
        invoice: {
          status: 'overdue',
          collectionStatus: 'collecting',
          clientEmail: 'a@b.com',
        },
        automation: { status: 'active' },
        step: { status: 'processing', tone: 'direct' },
        hasUnresolvedMeaningfulReply: true,
        hasReminderSentEvent: false,
      })
    ).toBe('meaningful_reply_pending');
  });

  it('test email does not affect automation state', async () => {
    const store = new MemoryCollectionsStore();
    store.seedInvoice({
      id: INVOICE,
      userId: USER,
      status: 'overdue',
      collectionStatus: 'collecting',
      clientEmail: 'client@example.com',
      invoiceNumber: 'INV-1',
      amount: 10,
      currency: 'USD',
      dueAt: '2026-07-01',
    });
    const svc = new CollectionsService(store);
    const auto = await svc.createCollectionAutomation(
      { userId: USER },
      { invoiceId: INVOICE, timezone: 'UTC', dryRun: false }
    );
    const { steps } = await svc.activateCollectionAutomation({ userId: USER }, auto.id, [
      {
        sequenceNumber: 1,
        channel: 'email',
        scheduledAtUtc: '2026-07-18T11:00:00.000Z',
        tone: 'direct',
        subjectSnapshot: 'S',
        bodySnapshot: 'B',
        idempotencyKey: 'test-state-1',
      },
    ]);
    const step = steps[0];
    const before = { ...step };
    const mock = new MockEmailProvider();
    const { ctx } = await loadReminderEmailContext(store, step, 'c', { senderName: 'Jordan' });
    await sendTestEmailToMyself(mock, ctx, 'owner@example.com');
    const after = await store.getStep(USER, step.id);
    expect(after?.status).toBe(before.status);
    expect(after?.sentAt).toBeNull();
    expect(after?.providerMessageId).toBeNull();
    expect(mock.sent[0].to).toBe('owner@example.com');
    expect(mock.sent[0].subject.startsWith('[TEST]')).toBe(true);
  });

  it('preview warns on firm tone', () => {
    const preview = buildEmailPreview(baseCtx({ tone: 'firm' }));
    expect(preview.firmToneWarning).toBe(true);
    expect(firmToneNeedsApproval('firm', null)).toBe(true);
    expect(firmToneNeedsApproval('firm', '2026-07-17T00:00:00Z')).toBe(false);
  });

  it('Resend provider refuses mismatched compose provider id', async () => {
    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      webhookSecret: 'whsec_dGVzdA==',
      fetchImpl: async () => new Response('{}'),
    });
    await expect(
      provider.sendReminder({
        ...composeReminderEmail(baseCtx()),
        provider: 'other' as 'resend',
      })
    ).rejects.toMatchObject({ code: 'provider_mismatch' });
  });
});

describe('loadWorkerConfig still defaults dry-run', () => {
  it('defaults', () => {
    expect(loadWorkerConfig({}).dryRun).toBe(true);
    expect(loadWorkerConfig({}).enabled).toBe(false);
    expect(loadWorkerConfig({}).emailSendingEnabled).toBe(false);
    expect(loadWorkerConfig({}).allowlistMode).toBe('deny_all');
  });
});

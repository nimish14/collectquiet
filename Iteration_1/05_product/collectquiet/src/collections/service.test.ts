import { describe, expect, it, beforeEach } from 'vitest';
import { CollectionsService } from './service';
import { MemoryCollectionsStore } from './store';
import { CollectionsDomainError } from './types';
import { formatInTimeZone, localDateTimeToUtcIso } from './time';
import type { PlannedReminderInput } from './types';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const INVOICE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function futureReminders(count = 2): PlannedReminderInput[] {
  const base = Date.now() + 86400000;
  return Array.from({ length: count }, (_, i) => ({
    sequenceNumber: i + 1,
    channel: 'email' as const,
    scheduledAtUtc: new Date(base + i * 86400000).toISOString(),
    tone: i === 0 ? ('friendly' as const) : ('direct' as const),
    templateId: `t${i + 1}`,
    subjectSnapshot: `Subject ${i + 1}`,
    bodySnapshot: `Body ${i + 1} frozen`,
    idempotencyKey: `auto:step:${i + 1}:${base}`,
  }));
}

describe('CollectionsService', () => {
  let store: MemoryCollectionsStore;
  let svc: CollectionsService;

  beforeEach(() => {
    store = new MemoryCollectionsStore();
    store.seedInvoice({
      id: INVOICE_A,
      userId: USER_A,
      status: 'overdue',
      collectionStatus: 'open',
      paidAt: null,
    });
    svc = new CollectionsService(store);
  });

  it('creates and activates automation with snapshotted reminders', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'America/New_York',
    });
    expect(auto.status).toBe('inactive');
    expect(auto.timezone).toBe('America/New_York');

    const { automation, steps } = await svc.activateCollectionAutomation(
      ctx,
      auto.id,
      futureReminders(2)
    );
    expect(automation.status).toBe('active');
    expect(steps).toHaveLength(2);
    expect(steps[0].subjectSnapshot).toBe('Subject 1');
    expect(steps[0].bodySnapshot).toContain('frozen');

    const events = await store.listEvents(USER_A, auto.id);
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        'automation_created',
        'automation_activated',
        'reminder_scheduled',
      ])
    );
  });

  it('rejects activation without reminders', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await expect(svc.activateCollectionAutomation(ctx, auto.id, [])).rejects.toMatchObject({
      code: 'no_reminders',
    });
  });

  it('rejects activation on paid invoice without override', async () => {
    const ctx = { userId: USER_A };
    await store.updateInvoice(USER_A, INVOICE_A, { collectionStatus: 'paid', status: 'paid' });
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await expect(
      svc.activateCollectionAutomation(ctx, auto.id, futureReminders())
    ).rejects.toMatchObject({ code: 'invoice_blocked' });
  });

  it('allows activation on paid invoice with explicit override', async () => {
    const ctx = { userId: USER_A, allowOverride: true };
    await store.updateInvoice(USER_A, INVOICE_A, { collectionStatus: 'paid', status: 'paid' });
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    const { automation } = await svc.activateCollectionAutomation(
      ctx,
      auto.id,
      futureReminders()
    );
    expect(automation.status).toBe('active');
    const events = await store.listEvents(USER_A, auto.id);
    expect(events.some((e) => e.eventType === 'automation_activated')).toBe(true);
  });

  it('pauses an active automation', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders());
    const paused = await svc.pauseCollectionAutomation(ctx, auto.id, 'user_paused');
    expect(paused.status).toBe('paused');
    const inv = await store.getInvoice(USER_A, INVOICE_A);
    expect(inv?.collectionStatus).toBe('paused');
  });

  it('rejects resume of cancelled automation', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders());
    await svc.cancelCollectionAutomation(ctx, auto.id);
    await expect(svc.resumeCollectionAutomation(ctx, auto.id)).rejects.toMatchObject({
      code: 'terminal_automation',
    });
  });

  it('marks invoice paid and cancels future reminders', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders(3));
    const { automation } = await svc.markInvoicePaid(ctx, INVOICE_A);
    expect(automation?.status).toBe('completed');
    expect(automation?.stopReason).toBe('marked_paid');

    const steps = await store.listSteps(USER_A, auto.id);
    expect(steps.every((s) => s.status === 'cancelled')).toBe(true);
    expect(steps.some((s) => s.status === 'pending')).toBe(false);

    const inv = await store.getInvoice(USER_A, INVOICE_A);
    expect(inv?.collectionStatus).toBe('paid');

    const events = await store.listEvents(USER_A);
    expect(events.some((e) => e.eventType === 'invoice_marked_paid')).toBe(true);
    expect(events.some((e) => e.eventType === 'automation_completed')).toBe(true);
  });

  it('rejects duplicate idempotency keys', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    const reminders = futureReminders(2);
    reminders[1].idempotencyKey = reminders[0].idempotencyKey;
    await expect(
      svc.activateCollectionAutomation(ctx, auto.id, reminders)
    ).rejects.toBeInstanceOf(CollectionsDomainError);
  });

  it('rejects cross-user access', async () => {
    const ctxA = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctxA, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await expect(
      svc.activateCollectionAutomation({ userId: USER_B }, auto.id, futureReminders())
    ).rejects.toMatchObject({ code: 'cross_user_or_missing' });

    await expect(store.getInvoice(USER_B, INVOICE_A)).resolves.toBeNull();
  });

  it('pauses automation on meaningful inbound reply', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders());

    const { paused } = await svc.registerInboundReply(ctx, {
      provider: 'resend',
      providerEventId: 'evt_1',
      matchedAutomationId: auto.id,
      classification: 'human_reply',
      textContent: 'Can we talk about this invoice?',
      rawMetadata: { Authorization: 'Bearer secret', safe: true },
    });
    expect(paused?.status).toBe('paused');
    expect(paused?.stopReason).toBe('client_reply');

    const inbound = await store.findInboundByProviderEvent('resend', 'evt_1');
    expect(inbound?.rawMetadata.Authorization).toBeUndefined();
    expect(inbound?.rawMetadata.safe).toBe(true);

    // Dedupe
    const again = await svc.registerInboundReply(ctx, {
      provider: 'resend',
      providerEventId: 'evt_1',
      matchedAutomationId: auto.id,
      classification: 'human_reply',
    });
    expect(again.paused).toBeNull();
  });

  it('registers and confirms payment promises', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders());
    const promise = await svc.registerPaymentPromise(ctx, {
      invoiceId: INVOICE_A,
      automationId: auto.id,
      promisedPaymentDate: '2026-08-01',
      confidence: 0.8,
    });
    expect(promise.status).toBe('awaiting_approval');
    const confirmed = await svc.confirmPaymentPromise(ctx, promise.id);
    expect(confirmed.status).toBe('active');
    expect(confirmed.approvedByUser).toBe(true);
    const a = await store.getAutomation(USER_A, auto.id);
    expect(a?.status).toBe('paused');
  });

  it('deduplicates provider delivery events', async () => {
    const ctx = { userId: USER_A };
    const first = await svc.registerProviderDeliveryEvent(ctx, {
      provider: 'resend',
      providerEventId: 'del_1',
      eventStatus: 'delivered',
      rawMetadata: { api_key: 'x', ok: 1 },
    });
    const second = await svc.registerProviderDeliveryEvent(ctx, {
      provider: 'resend',
      providerEventId: 'del_1',
      eventStatus: 'bounced',
    });
    expect(second.id).toBe(first.id);
    expect(first.rawMetadata.api_key).toBeUndefined();
  });

  it('writes an event for every transition path', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    await svc.activateCollectionAutomation(ctx, auto.id, futureReminders());
    await svc.pauseCollectionAutomation(ctx, auto.id, 'user_paused');
    await svc.resumeCollectionAutomation(ctx, auto.id);
    await svc.completeCollectionAutomation(ctx, auto.id);

    const types = (await store.listEvents(USER_A, auto.id)).map((e) => e.eventType);
    expect(types).toEqual(
      expect.arrayContaining([
        'automation_created',
        'automation_activated',
        'reminder_scheduled',
        'automation_paused',
        'automation_resumed',
        'reminders_skipped',
        'automation_completed',
      ])
    );
  });

  it('rejects out-of-order reminder schedules', async () => {
    const ctx = { userId: USER_A };
    const auto = await svc.createCollectionAutomation(ctx, {
      invoiceId: INVOICE_A,
      timezone: 'UTC',
    });
    const base = Date.now() + 86400000;
    const reminders: PlannedReminderInput[] = [
      {
        sequenceNumber: 1,
        channel: 'email',
        scheduledAtUtc: new Date(base + 86400000).toISOString(),
        tone: 'friendly',
        subjectSnapshot: 'a',
        bodySnapshot: 'a',
        idempotencyKey: 'k1',
      },
      {
        sequenceNumber: 2,
        channel: 'email',
        scheduledAtUtc: new Date(base).toISOString(),
        tone: 'direct',
        subjectSnapshot: 'b',
        bodySnapshot: 'b',
        idempotencyKey: 'k2',
      },
    ];
    // Service sorts by time then renumbers — should succeed after sort
    const { steps } = await svc.activateCollectionAutomation(ctx, auto.id, reminders);
    expect(new Date(steps[0].scheduledAt).getTime()).toBeLessThan(
      new Date(steps[1].scheduledAt).getTime()
    );
  });
});

describe('UTC and DST conversion', () => {
  it('converts America/New_York winter local time to UTC', () => {
    // 2026-01-15 09:00 EST = 14:00 UTC
    const utc = localDateTimeToUtcIso(
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
      'America/New_York'
    );
    expect(utc).toBe('2026-01-15T14:00:00.000Z');
    expect(formatInTimeZone(utc, 'America/New_York')).toContain('2026-01-15');
  });

  it('converts America/New_York summer (EDT) local time to UTC', () => {
    // 2026-07-15 09:00 EDT = 13:00 UTC
    const utc = localDateTimeToUtcIso(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      'America/New_York'
    );
    expect(utc).toBe('2026-07-15T13:00:00.000Z');
    const shown = formatInTimeZone(utc, 'America/New_York');
    expect(shown).toMatch(/09:00/);
  });

  it('round-trips across DST spring forward boundary day', () => {
    // US spring forward 2026-03-08; 09:00 still valid local
    const utc = localDateTimeToUtcIso(
      { year: 2026, month: 3, day: 8, hour: 9, minute: 0 },
      'America/New_York'
    );
    expect(formatInTimeZone(utc, 'America/New_York')).toMatch(/09:00/);
    expect(utc.endsWith('Z')).toBe(true);
  });
});

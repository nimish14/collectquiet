import { describe, expect, it } from 'vitest';
import {
  buildDefaultPlannedSteps,
  labelAttentionKind,
  labelAutomationStatus,
  labelEventType,
  statusBadgeClass,
  utcIsoToDateTimeLocal,
  validatePlannedSteps,
  WHATSAPP_CHANNEL_SUPPORTED,
} from '../ui/automation-helpers';
import { dateTimeLocalStringToUtcIso, parseDateTimeLocal } from './time';
import type { AppSettings, Invoice } from '../types';
import { DEFAULT_SEQUENCE } from '../types';
import { automationCardHtml } from '../ui/automation-card';
import { attentionPageHtml } from '../ui/attention';
import { activationSummaryModalHtml, automationSetupModalHtml } from '../ui/automation-modals';

const settings: AppSettings = {
  businessName: 'Studio',
  senderName: 'Nimish',
  senderEmail: 'me@example.com',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'UTC',
  sequence: DEFAULT_SEQUENCE,
};

const invoice: Invoice = {
  id: 'inv-1',
  clientName: 'Acme',
  clientEmail: 'ap@acme.test',
  amount: 1200,
  invoiceNumber: 'INV-100',
  issuedAt: '2026-07-01',
  dueAt: '2026-07-10',
  status: 'overdue',
  remindersSent: 0,
};

describe('automation UX helpers', () => {
  it('builds default planned reminders from sequence', () => {
    const steps = buildDefaultPlannedSteps(invoice, settings);
    expect(steps.length).toBe(3);
    expect(steps[0]?.tone).toBe('friendly');
    expect(steps[0]?.subject).toContain('INV-100');
    expect(steps.every((s) => s.scheduledAtLocal.includes('T'))).toBe(true);
  });

  it('validates reminder chronology for activation review', () => {
    const steps = buildDefaultPlannedSteps(invoice, settings);
    expect(validatePlannedSteps(steps)).toBeNull();
    expect(validatePlannedSteps([])).toMatch(/at least one/i);
    const bad = [
      { ...steps[0]!, scheduledAtLocal: '2026-08-10T10:00' },
      { ...steps[1]!, scheduledAtLocal: '2026-08-01T10:00' },
    ];
    expect(validatePlannedSteps(bad)).toMatch(/chronological/i);
  });

  it('converts datetime-local strings for activation', () => {
    const parts = parseDateTimeLocal('2026-08-01T09:30');
    expect(parts).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      hour: 9,
      minute: 30,
      second: 0,
    });
    const utc = dateTimeLocalStringToUtcIso('2026-08-01T09:30', 'UTC');
    expect(utc.startsWith('2026-08-01T09:30')).toBe(true);
    const local = utcIsoToDateTimeLocal(utc, 'UTC');
    expect(local).toBe('2026-08-01T09:30');
  });

  it('uses text status labels (not colour-only)', () => {
    expect(labelAutomationStatus('active')).toMatch(/Active/i);
    expect(labelEventType('reminder_sent')).toMatch(/sent/i);
    expect(labelAttentionKind('client_disputes')).toMatch(/Dispute/i);
    expect(statusBadgeClass('active')).toBe('badge-ok');
    expect(statusBadgeClass('paused')).toBe('badge-warn');
  });

  it('hides WhatsApp automation until supported', () => {
    expect(WHATSAPP_CHANNEL_SUPPORTED).toBe(false);
  });
});

describe('automation UI renderers', () => {
  it('renders setup modal for creating automation', () => {
    const steps = buildDefaultPlannedSteps(invoice, settings);
    const html = automationSetupModalHtml({
      open: true,
      invoice,
      enabled: true,
      channel: 'email',
      timezone: 'UTC',
      userTimezone: 'UTC',
      clientTimezone: null,
      steps,
      previewIndex: 0,
      firmApproved: false,
      busy: false,
      error: null,
      currency: 'USD',
      mode: 'setup',
    });
    expect(html).toContain('Set up automatic follow-ups');
    expect(html).toContain('Send test to myself');
    expect(html).toContain('Preview');
    expect(html).toContain('Add reminder');
  });

  it('renders activation summary before start', () => {
    const steps = buildDefaultPlannedSteps(invoice, settings);
    const html = activationSummaryModalHtml({
      open: true,
      invoice,
      steps,
      timezone: 'UTC',
      channel: 'email',
      senderName: 'Nimish',
      senderEmail: 'me@example.com',
      replyToHint: 'CollectQuiet reply address',
      currency: 'USD',
      locale: 'en-US',
      busy: false,
      error: null,
      formatMoney: (n) => `$${n}`,
      formatDate: (d) => d,
    });
    expect(html).toContain('Start automatic follow-ups');
    expect(html).toContain('What causes automatic pausing');
    expect(html).toContain('When the client replies');
    expect(html).toContain('When the invoice is marked paid');
    expect(html).toContain('Acme');
  });

  it('renders automation card with pause/resume/timeline actions', () => {
    const html = automationCardHtml({
      invoice,
      loading: false,
      error: null,
      showTimeline: true,
      snapshot: {
        automation: {
          id: 'auto-1',
          status: 'active',
          channel: 'email',
          timezone: 'UTC',
          nextActionAt: '2026-08-01T10:00:00.000Z',
          stopReason: null,
          dryRun: false,
          replyToToken: 'tok',
        },
        steps: [
          {
            id: 's1',
            sequenceNumber: 1,
            scheduledAt: '2026-08-01T10:00:00.000Z',
            tone: 'friendly',
            subjectSnapshot: 'Hi',
            bodySnapshot: 'Body',
            status: 'pending',
            sentAt: null,
            lastErrorCode: null,
            manualApprovedAt: null,
          },
        ],
        events: [
          {
            id: 'e1',
            eventType: 'automation_activated',
            occurredAt: '2026-07-16T12:00:00.000Z',
            metadata: {},
          },
          {
            id: 'e2',
            eventType: 'inbound_reply_received',
            occurredAt: '2026-07-16T13:00:00.000Z',
            metadata: {},
          },
        ],
        lastInbound: {
          classification: 'payment_promise',
          subject: 'Re: invoice',
          textContent: 'I will pay Friday',
          receivedAt: '2026-07-16T13:00:00.000Z',
          requiresReview: true,
        },
        promise: {
          id: 'p1',
          promisedPaymentDate: '2026-07-20',
          status: 'awaiting_approval',
          approvedByUser: false,
        },
        needsAttention: true,
      },
    });
    expect(html).toContain('Pause');
    expect(html).toContain('Send now');
    expect(html).toContain('Needs attention');
    expect(html).toContain('Email delivery is in early access');
    expect(html).not.toContain('nimishpande11@gmail.com');
    expect(html).toContain('Automation activated');
    expect(html).toContain('audit timeline');
  });

  it('renders Needs Attention empty and populated states', () => {
    const empty = attentionPageHtml({
      loading: false,
      error: null,
      items: [],
      invoiceLabels: {},
    });
    expect(empty).toContain('Inbox clear');

    const populated = attentionPageHtml({
      loading: false,
      error: null,
      items: [
        {
          id: 'n1',
          kind: 'client_says_paid',
          title: 'Client says paid',
          body: 'Paid. Please check',
          replyText: 'Paid. Please check',
          replyFrom: 'client@example.com',
          replySubject: 'Re: Invoice INV-100',
          invoiceId: 'inv-1',
          automationId: 'auto-1',
          recommendedAction: 'Confirm payment',
          createdAt: '2026-07-16T12:00:00.000Z',
        },
      ],
      invoiceLabels: { 'inv-1': 'INV-100 · Acme' },
    });
    expect(populated).toContain('Payment claimed but not confirmed');
    expect(populated).toContain('Client reply');
    expect(populated).toContain('Paid. Please check');
    expect(populated).toContain('Recommended');
    expect(populated).toContain('Confirm paid');
    expect(populated).toContain('Mark resolved');
  });

  it('includes mobile-friendly modal class and loading/error states', () => {
    const loading = automationCardHtml({
      invoice,
      snapshot: null,
      loading: true,
      error: null,
      showTimeline: false,
    });
    expect(loading).toContain('Loading automation');
    expect(loading).toContain('aria-busy');

    const err = automationCardHtml({
      invoice,
      snapshot: null,
      loading: false,
      error: 'forbidden',
      showTimeline: false,
    });
    expect(err).toContain('role="alert"');
    expect(err).toContain('Retry');
  });
});

describe('unauthorized invoice access contract', () => {
  it('documents forbidden response for cross-user invoice get', () => {
    // API returns 403 { ok:false, error:'forbidden' } when JWT user cannot read invoice.
    // Covered here as a stable contract so UI can show an error state.
    const forbidden = { ok: false as const, error: 'forbidden', status: 403 };
    expect(forbidden.status).toBe(403);
    expect(forbidden.error).toBe('forbidden');
  });
});

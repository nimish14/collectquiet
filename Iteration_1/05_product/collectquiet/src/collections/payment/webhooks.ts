/**
 * Provider-neutral payment confirmation processor.
 *
 * CollectQuiet has no Stripe/Razorpay/etc integration today.
 * This module implements the domain side so a future trusted provider
 * can plug in via PaymentWebhookAdapter. No production payment webhook
 * route is registered until a real provider is added.
 */

import type { CollectionsService } from '../service';
import type { CollectionsStore } from '../store';
import type { PaymentEvent, PaymentEventOutcome } from '../types';

export interface TrustedPaymentPayload {
  provider: string;
  providerEventId: string;
  providerTransactionId: string | null;
  /** Trusted internal invoice ID from provider metadata — never customer name alone */
  invoiceId: string;
  amount: number;
  currency: string;
  /** When true, treat as partial even if amounts match */
  isPartial?: boolean;
  occurredAt?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentWebhookAdapter {
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): boolean;
  parsePaymentEvent(payload: unknown): TrustedPaymentPayload;
}

export interface PaymentProcessResult {
  ok: boolean;
  duplicate?: boolean;
  invalidSignature?: boolean;
  outcome?: PaymentEventOutcome;
  error?: string;
  event?: PaymentEvent;
}

function id(): string {
  return crypto.randomUUID();
}

function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.009;
}

export async function processPaymentWebhook(opts: {
  store: CollectionsStore;
  service: CollectionsService;
  adapter: PaymentWebhookAdapter;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}): Promise<PaymentProcessResult> {
  const { store, service, adapter, headers, rawBody } = opts;

  if (!adapter.verifyWebhook(headers, rawBody)) {
    return { ok: false, invalidSignature: true, error: 'invalid_signature' };
  }

  let payload: TrustedPaymentPayload;
  try {
    payload = adapter.parsePaymentEvent(JSON.parse(rawBody));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse_failed' };
  }

  const existing = await store.findPaymentEvent(payload.provider, payload.providerEventId);
  if (existing) {
    return { ok: true, duplicate: true, outcome: existing.outcome, event: existing };
  }

  // Ownership: invoice must exist; user derived from invoice (trusted ID match)
  // We need userId — look up via service store getInvoice requires userId.
  // Scan is not available; require adapter to include userId in metadata OR use store helper.
  const invoiceOwner = await findInvoiceOwner(store, payload.invoiceId);
  if (!invoiceOwner) {
    const event = await store.insertPaymentEvent({
      id: id(),
      userId: null,
      invoiceId: payload.invoiceId,
      automationId: null,
      provider: payload.provider,
      providerEventId: payload.providerEventId,
      providerTransactionId: payload.providerTransactionId,
      amount: payload.amount,
      currency: payload.currency,
      outcome: 'rejected',
      rawMetadata: { reason: 'invoice_not_found' },
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
      processedAt: new Date().toISOString(),
    });
    return { ok: false, outcome: 'rejected', error: 'invoice_not_found', event };
  }

  const { userId, invoice } = invoiceOwner;
  const expectedAmount = invoice.amount ?? null;
  const expectedCurrency = (invoice.currency ?? 'USD').toUpperCase();
  const gotCurrency = payload.currency.toUpperCase();

  let outcome: PaymentEventOutcome = 'full_payment';

  if (gotCurrency !== expectedCurrency) {
    outcome = 'currency_mismatch';
  } else if (expectedAmount != null && payload.isPartial) {
    outcome = 'partial_payment';
  } else if (expectedAmount != null && !amountsEqual(payload.amount, expectedAmount)) {
    if (payload.amount < expectedAmount) outcome = 'partial_payment';
    else outcome = 'amount_mismatch';
  }

  const open = await store.findOpenAutomationForInvoice(userId, invoice.id);
  const event: PaymentEvent = {
    id: id(),
    userId,
    invoiceId: invoice.id,
    automationId: open?.id ?? null,
    provider: payload.provider,
    providerEventId: payload.providerEventId,
    providerTransactionId: payload.providerTransactionId,
    amount: payload.amount,
    currency: payload.currency,
    outcome,
    rawMetadata: {
      ...(payload.raw ?? {}),
      // never store secrets
    },
    occurredAt: payload.occurredAt ?? new Date().toISOString(),
    processedAt: new Date().toISOString(),
  };
  await store.insertPaymentEvent(event);

  if (outcome === 'full_payment') {
    await service.markInvoicePaid({ userId, source: 'provider_webhook' }, invoice.id);
    await store.appendEvent({
      id: id(),
      userId,
      invoiceId: invoice.id,
      automationId: open?.id ?? null,
      reminderStepId: null,
      eventType: 'payment_received',
      source: 'provider_webhook',
      actorId: null,
      metadata: {
        providerTransactionId: payload.providerTransactionId,
        amount: payload.amount,
        currency: payload.currency,
      },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true, outcome, event };
  }

  // Partial / mismatch → needs review; do not complete automation
  await store.insertNotification({
    id: id(),
    userId,
    kind: 'needs_attention',
    title:
      outcome === 'partial_payment'
        ? 'Partial payment received'
        : outcome === 'currency_mismatch'
          ? 'Payment currency mismatch'
          : 'Payment amount mismatch',
    body: `Provider reported ${payload.amount} ${payload.currency}; invoice expects ${expectedAmount} ${expectedCurrency}.`,
    invoiceId: invoice.id,
    automationId: open?.id ?? null,
    inboundMessageId: null,
    readAt: null,
    createdAt: new Date().toISOString(),
  });

  await store.appendEvent({
    id: id(),
    userId,
    invoiceId: invoice.id,
    automationId: open?.id ?? null,
    reminderStepId: null,
    eventType: outcome === 'partial_payment' ? 'payment_partial' : 'payment_mismatch',
    source: 'provider_webhook',
    actorId: null,
    metadata: {
      providerTransactionId: payload.providerTransactionId,
      amount: payload.amount,
      currency: payload.currency,
      expectedAmount,
      expectedCurrency,
      outcome,
    },
    occurredAt: new Date().toISOString(),
  });

  return { ok: true, outcome, event };
}

async function findInvoiceOwner(
  store: CollectionsStore,
  invoiceId: string
): Promise<{ userId: string; invoice: import('../types').CollectionInvoice } | null> {
  // Memory store: scan; Supabase store should implement getInvoiceById
  const anyStore = store as CollectionsStore & {
    getInvoiceById?: (
      invoiceId: string
    ) => Promise<import('../types').CollectionInvoice | null>;
    invoices?: Map<string, import('../types').CollectionInvoice>;
  };
  if (anyStore.getInvoiceById) {
    const inv = await anyStore.getInvoiceById(invoiceId);
    if (!inv) return null;
    return { userId: inv.userId, invoice: inv };
  }
  if (anyStore.invoices) {
    const inv = anyStore.invoices.get(invoiceId);
    if (!inv) return null;
    return { userId: inv.userId, invoice: structuredClone(inv) };
  }
  return null;
}

/** Test-only mock payment provider — never hits a real network. */
export class MockPaymentWebhookAdapter implements PaymentWebhookAdapter {
  acceptSignatures = true;

  verifyWebhook(): boolean {
    return this.acceptSignatures;
  }

  parsePaymentEvent(payload: unknown): TrustedPaymentPayload {
    const p = payload as TrustedPaymentPayload;
    if (!p.provider || !p.providerEventId || !p.invoiceId) {
      throw new Error('invalid_payment_payload');
    }
    return {
      provider: p.provider,
      providerEventId: p.providerEventId,
      providerTransactionId: p.providerTransactionId ?? null,
      invoiceId: p.invoiceId,
      amount: Number(p.amount),
      currency: String(p.currency),
      isPartial: Boolean(p.isPartial),
      occurredAt: p.occurredAt,
      raw: p.raw,
    };
  }
}

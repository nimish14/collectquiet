import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadCollectionsFlags } from '../../src/collections/flags';
import {
  MockPaymentWebhookAdapter,
  processPaymentWebhook,
} from '../../src/collections/payment/webhooks';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { CollectionsService } from '../../src/collections/service';
import { collectionsMetrics } from '../../src/collections/observability/metrics';

/**
 * Payment provider webhook — disabled by default (COLLECTION_PAYMENT_WEBHOOK_ENABLED=false).
 * Pilot drills use MockPaymentWebhookAdapter + COLLECTION_PAYMENT_WEBHOOK_SECRET header check.
 * No live Stripe/Razorpay integration.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const flags = loadCollectionsFlags(process.env);
  if (!flags.paymentWebhookEnabled) {
    res.status(503).json({ ok: false, error: 'payment_webhook_disabled' });
    return;
  }

  const secret = process.env.COLLECTION_PAYMENT_WEBHOOK_SECRET ?? '';
  if (!secret) {
    res.status(500).json({ ok: false, error: 'payment_webhook_secret_not_configured' });
    return;
  }

  const provided =
    (typeof req.headers['x-payment-webhook-secret'] === 'string'
      ? req.headers['x-payment-webhook-secret']
      : null) ||
    (typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : null);

  if (!provided || provided !== secret) {
    collectionsMetrics.incr('webhook_signature_failures');
    res.status(401).json({ ok: false, error: 'invalid_signature' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const store = createSupabaseWorkerStore();
    const service = new CollectionsService(store);
    const adapter = new MockPaymentWebhookAdapter();
    const result = await processPaymentWebhook({
      adapter,
      store,
      service,
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody: body,
    });
    res.status(result.ok ? 200 : result.invalidSignature ? 401 : 400).json({
      ok: result.ok,
      duplicate: result.duplicate ?? false,
      outcome: result.outcome ?? null,
      error: result.error ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'payment_webhook_failed';
    console.error(JSON.stringify({ event: 'payment_webhook_failed', error: message }));
    res.status(500).json({ ok: false, error: 'payment_webhook_failed' });
  }
}

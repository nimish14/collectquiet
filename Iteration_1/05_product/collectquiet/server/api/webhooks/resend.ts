import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ResendEmailProvider } from '../../../src/collections/email/resend';
import { processDeliveryWebhook } from '../../../src/collections/email/webhooks';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { collectionsMetrics } from '../../../src/collections/observability/metrics';
import { emitAlerts, evaluateAlerts } from '../../../src/collections/observability/alerts';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY ?? 'unused-for-verify';
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(500).json({ ok: false, error: 'webhook_secret_not_configured' });
    return;
  }

  const existing = process.env.COLLECTION_EMAIL_PROVIDER;
  if (existing && existing !== 'resend') {
    res.status(409).json({ ok: false, error: 'provider_mismatch' });
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const provider = new ResendEmailProvider({ apiKey, webhookSecret });
    const store = createSupabaseWorkerStore();

    const result = await processDeliveryWebhook({
      provider,
      store,
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      findStepByProviderMessageId: (providerMessageId) =>
        store.findStepByProviderMessageId(providerMessageId),
      pauseAutomation: async (userId, automationId, reason) => {
        const auto = await store.getAutomationById(automationId);
        if (!auto || auto.userId !== userId) return;
        if (auto.status !== 'active' && auto.status !== 'awaiting_user') return;
        await store.updateAutomation({
          ...auto,
          status: 'paused',
          pausedAt: new Date().toISOString(),
          stopReason: reason,
          version: auto.version + 1,
          updatedAt: new Date().toISOString(),
        });
        await store.appendEvent({
          id: crypto.randomUUID(),
          userId,
          invoiceId: auto.invoiceId,
          automationId,
          reminderStepId: null,
          eventType: 'automation_paused',
          source: 'provider_webhook',
          actorId: null,
          metadata: { reason },
          occurredAt: new Date().toISOString(),
        });
      },
    });

    if (!result.ok && result.error === 'invalid_signature') {
      collectionsMetrics.incr('webhook_signature_failures');
      emitAlerts(
        evaluateAlerts({
          lastSchedulerTickAt: collectionsMetrics.getLastSchedulerTickAt(),
          webhookSignatureFailuresRecent: 1,
        })
      );
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }

    if (result.ok && !result.duplicate) {
      if (result.eventStatus === 'delivered') collectionsMetrics.incr('deliveries');
      if (result.eventStatus === 'bounced' || result.eventStatus === 'complained') {
        collectionsMetrics.incr('bounces');
      }
    }

    res.status(200).json({
      ok: result.ok,
      duplicate: result.duplicate ?? false,
      eventStatus: result.eventStatus ?? null,
      paused: result.paused ?? false,
      needsAttention: result.needsAttention ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook_failed';
    console.error(JSON.stringify({ event: 'resend_webhook_failed', error: message }));
    res.status(500).json({ ok: false, error: 'webhook_failed' });
  }
}

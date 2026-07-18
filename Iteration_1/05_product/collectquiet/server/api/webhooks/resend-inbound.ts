import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CollectionsService } from '../../../src/collections/service';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { processInboundWebhook } from '../../../src/collections/inbound/pipeline';
import { parseResendInboundPayload } from '../../../src/collections/inbound/resendInbound';
import { verifySvixSignature, ResendEmailProvider } from '../../../src/collections/email/resend';
import type { MatchStore } from '../../../src/collections/inbound/match';
import { loadCollectionsFlags } from '../../../src/collections/flags';
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

  const flags = loadCollectionsFlags(process.env);
  if (!flags.replyDetectionEnabled) {
    res.status(503).json({ ok: false, error: 'reply_detection_disabled' });
    emitAlerts(
      evaluateAlerts({
        lastSchedulerTickAt: collectionsMetrics.getLastSchedulerTickAt(),
        replyWebhookUnavailable: true,
      })
    );
    return;
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(500).json({ ok: false, error: 'webhook_secret_not_configured' });
    emitAlerts(
      evaluateAlerts({
        lastSchedulerTickAt: collectionsMetrics.getLastSchedulerTickAt(),
        replyWebhookUnavailable: true,
      })
    );
    return;
  }

  const existing = process.env.COLLECTION_EMAIL_PROVIDER;
  if (existing && existing !== 'resend') {
    res.status(409).json({ ok: false, error: 'provider_mismatch' });
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const store = createSupabaseWorkerStore() as MatchStore;
    const service = new CollectionsService(store);

    const apiKey = process.env.RESEND_API_KEY ?? '';
    const fetchMessage =
      apiKey &&
      (async (emailId: string) => {
        const provider = new ResendEmailProvider({ apiKey, webhookSecret });
        const status = await provider.getDeliveryStatus(emailId);
        const raw = status.raw ?? {};
        return {
          text: typeof raw.text === 'string' ? raw.text : null,
          html: typeof raw.html === 'string' ? raw.html : null,
          from: typeof raw.from === 'string' ? raw.from : null,
          to: typeof raw.to === 'string' ? raw.to : Array.isArray(raw.to) ? String(raw.to[0]) : null,
          subject: typeof raw.subject === 'string' ? raw.subject : null,
        };
      });

    const result = await processInboundWebhook({
      store,
      service,
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody,
      verify: (h, body) => verifySvixSignature(webhookSecret, body, h),
      parse: parseResendInboundPayload,
      fetchMessage: fetchMessage || null,
      llm: null, // rules-first; wire LLM via COLLECTION_INBOUND_LLM later
    });

    if (result.invalidSignature) {
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
      collectionsMetrics.incr('replies');
      if (result.classification?.category === 'payment_promise') {
        collectionsMetrics.incr('payment_promises');
      }
      if (result.classification?.category === 'dispute') {
        collectionsMetrics.incr('disputes');
      }
      if (result.classification?.category === 'payment_claimed') {
        collectionsMetrics.incr('payment_claimed');
      }
      if (result.pausedAutomationId) {
        collectionsMetrics.incr('automation_pauses');
      }
    }

    res.status(200).json({
      ok: result.ok,
      duplicate: result.duplicate ?? false,
      classification: result.classification?.category ?? null,
      matchMethod: result.match?.method ?? null,
      pausedAutomationId: result.pausedAutomationId ?? null,
      error: result.error ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'inbound_failed';
    console.error(JSON.stringify({ event: 'resend_inbound_failed', error: message }));
    res.status(500).json({ ok: false, error: 'inbound_failed' });
  }
}

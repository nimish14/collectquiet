import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CollectionsWorker } from '../../src/collections/worker/tick';
import {
  loadWorkerConfig,
  RecordingMessageSender,
  systemClock,
} from '../../src/collections/worker/types';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { ResendEmailProvider } from '../../src/collections/email/resend';
import { createEmailMessageSender, loadReminderEmailContext } from '../../src/collections/email/outbound';
import { composeReminderEmail } from '../../src/collections/email/compose';

function readSecret(req: VercelRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  const header = req.headers['x-cron-secret'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return null;
}

function createConfiguredProvider() {
  const existing = process.env.COLLECTION_EMAIL_PROVIDER;
  if (existing && existing !== 'resend') {
    throw new Error(
      `COLLECTION_EMAIL_PROVIDER=${existing} is set; refusing to silently replace with Resend`
    );
  }
  const apiKey = process.env.RESEND_API_KEY;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET ?? '';
  if (!apiKey) throw new Error('RESEND_API_KEY is required when automation sending is enabled');
  return new ResendEmailProvider({ apiKey, webhookSecret });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(200).json({ ok: true, service: 'collections-tick', provider: 'resend' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(401).json({ ok: false, error: 'cron_secret_not_configured' });
    return;
  }
  const provided = readSecret(req);
  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const correlationId = crypto.randomUUID();
  const workerConfig = loadWorkerConfig(process.env);

  try {
    const store = createSupabaseWorkerStore();
    const useRecording =
      process.env.COLLECTION_USE_RECORDING_SENDER === 'true' ||
      workerConfig.dryRun ||
      !workerConfig.emailSendingEnabled;
    const provider = useRecording ? null : createConfiguredProvider();
    const sender = useRecording
      ? new RecordingMessageSender()
      : createEmailMessageSender(provider!);

    const worker = new CollectionsWorker(
      store,
      sender,
      workerConfig,
      systemClock,
      async (step, corr) => {
        const { ctx, block } = await loadReminderEmailContext(store, step, corr, {
          senderName: process.env.COLLECTION_DEFAULT_SENDER_NAME || 'Freelancer',
          businessName: process.env.COLLECTION_DEFAULT_BUSINESS_NAME || '',
          currency: 'USD',
        });
        if (block) return { block };
        const composed = composeReminderEmail(ctx);
        return {
          outbound: {
            to: composed.to,
            subject: composed.subject,
            body: composed.text,
            idempotencyKey: composed.idempotencyKey,
            correlationId: corr,
            channel: step.channel,
            replyToToken: ctx.replyToToken,
            composed,
          },
        };
      }
    );

    const summary = await worker.tick(correlationId);
    res.status(200).json({
      ok: true,
      provider: 'resend',
      correlationId: summary.correlationId,
      enabled: summary.enabled,
      dryRun: summary.dryRun,
      claimed: summary.claimed,
      sent: summary.sent,
      dryRunLogged: summary.dryRunLogged,
      retried: summary.retried,
      failed: summary.failed,
      skipped: summary.skipped,
      errorCount: summary.errors.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tick_failed';
    console.error(JSON.stringify({ correlationId, event: 'tick_failed', error: message }));
    res.status(500).json({ ok: false, correlationId, error: 'tick_failed' });
  }
}

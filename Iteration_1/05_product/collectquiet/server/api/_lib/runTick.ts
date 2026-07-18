/**
 * Shared collections worker tick used by cron and user-triggered send_now.
 */
import { CollectionsWorker } from '../../../src/collections/worker/tick';
import {
  loadWorkerConfig,
  RecordingMessageSender,
  systemClock,
  type WorkerConfig,
} from '../../../src/collections/worker/types';
import { createSupabaseWorkerStore } from './supabaseWorkerStore';
import { ResendEmailProvider } from '../../../src/collections/email/resend';
import { createEmailMessageSender, loadReminderEmailContext } from '../../../src/collections/email/outbound';
import { composeReminderEmail } from '../../../src/collections/email/compose';

export function createConfiguredProvider() {
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

export async function runCollectionsTick(correlationId = crypto.randomUUID()) {
  const workerConfig: WorkerConfig = loadWorkerConfig(process.env);
  const store = createSupabaseWorkerStore();
  const useRecording =
    process.env.COLLECTION_USE_RECORDING_SENDER === 'true' ||
    workerConfig.dryRun ||
    !workerConfig.emailSendingEnabled;
  const provider = useRecording ? null : createConfiguredProvider();
  const sender = useRecording
    ? new RecordingMessageSender()
    : createEmailMessageSender(provider!);

  console.log(
    JSON.stringify({
      svc: 'collections-tick',
      event: 'tick_start',
      correlationId,
      enabled: workerConfig.enabled,
      dryRun: workerConfig.dryRun,
      emailSendingEnabled: workerConfig.emailSendingEnabled,
      useRecording,
      hasResendKey: Boolean(process.env.RESEND_API_KEY),
      from: process.env.COLLECTION_EMAIL_FROM || null,
    })
  );

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
  return { summary, workerConfig, useRecording };
}

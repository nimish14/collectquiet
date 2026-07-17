import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSupabaseWorkerStore } from '../_lib/supabaseWorkerStore';
import { ResendEmailProvider } from '../../src/collections/email/resend';
import { MockEmailProvider } from '../../src/collections/email/mock';
import { buildEmailPreview, sendTestEmailToMyself } from '../../src/collections/email/preview';
import { loadReminderEmailContext } from '../../src/collections/email/outbound';
import type { ReminderStep } from '../../src/collections/types';

/**
 * Preview scheduled email or send a test copy to the signed-in user.
 * Test sends never mutate reminder step state.
 *
 * POST { action: 'preview' | 'test', stepId, userId, ownerEmail?, senderName?, businessName? }
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const { action, stepId, userId, ownerEmail, senderName, businessName } = body as {
    action: 'preview' | 'test';
    stepId: string;
    userId: string;
    ownerEmail?: string;
    senderName?: string;
    businessName?: string;
  };

  if (!stepId || !userId || (action !== 'preview' && action !== 'test')) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }

  try {
    const store = createSupabaseWorkerStore();
    const step = (await store.getStep(userId, stepId)) as ReminderStep | null;
    if (!step) {
      res.status(404).json({ ok: false, error: 'step_not_found' });
      return;
    }

    const { ctx, block } = await loadReminderEmailContext(store, step, crypto.randomUUID(), {
      senderName: senderName || 'Freelancer',
      businessName: businessName || '',
    });

    const preview = buildEmailPreview(ctx);
    if (action === 'preview') {
      res.status(200).json({
        ok: true,
        preview,
        safetyBlock: block,
        firmToneWarning: preview.firmToneWarning,
      });
      return;
    }

    // test send
    if (!ownerEmail) {
      res.status(400).json({ ok: false, error: 'owner_email_required' });
      return;
    }

    const useMock = process.env.COLLECTION_USE_RECORDING_SENDER === 'true';
    const provider = useMock
      ? new MockEmailProvider()
      : new ResendEmailProvider({
          apiKey: process.env.RESEND_API_KEY!,
          webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? '',
        });

    const before = await store.getStep(userId, stepId);
    const result = await sendTestEmailToMyself(provider, ctx, ownerEmail);
    const after = await store.getStep(userId, stepId);

    // Guarantee no state mutation
    const unchanged =
      before?.status === after?.status &&
      before?.sentAt === after?.sentAt &&
      before?.providerMessageId === after?.providerMessageId;

    res.status(200).json({
      ok: true,
      test: true,
      providerMessageId: result.providerMessageId,
      reminderStateUnchanged: unchanged,
      preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'preview_failed';
    res.status(500).json({ ok: false, error: message });
  }
}

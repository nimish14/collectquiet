import { composeReminderEmail, previewWarningForTone } from './compose';
import type { EmailPreview, EmailProvider, ReminderEmailContext } from './types';
import { EmailProviderError } from './types';

/** Build a UI/API preview — does not send and does not mutate automation state. */
export function buildEmailPreview(ctx: ReminderEmailContext): EmailPreview {
  const composed = composeReminderEmail(ctx);
  return {
    provider: composed.provider,
    from: composed.from,
    replyTo: composed.replyTo,
    to: composed.to,
    subject: composed.subject,
    text: composed.text,
    scheduledAtUtc: ctx.scheduledAtUtc,
    timezone: ctx.timezone,
    tone: ctx.tone,
    firmToneWarning: previewWarningForTone(ctx.tone),
    headers: composed.headers,
    idempotencyKey: ctx.idempotencyKey,
  };
}

/**
 * Send a test email to the authenticated user only.
 * Uses a distinct idempotency key and must never update reminder step state.
 */
export async function sendTestEmailToMyself(
  provider: EmailProvider,
  ctx: ReminderEmailContext,
  ownerEmail: string
): Promise<{ providerMessageId: string }> {
  if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new EmailProviderError('Invalid owner email', 'permanent', 'invalid_recipient');
  }
  const composed = composeReminderEmail({
    ...ctx,
    to: ownerEmail,
    subjectSnapshot: `[TEST] ${ctx.subjectSnapshot}`,
    bodySnapshot: `${ctx.bodySnapshot}\n\n---\nThis is a CollectQuiet test email. It does not count as a client reminder.`,
    idempotencyKey: `test:${ctx.userId}:${ctx.reminderStepId || 'preview'}:${Date.now()}`,
  });
  const result = await provider.sendReminder(composed);
  return { providerMessageId: result.providerMessageId };
}

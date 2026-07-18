import type { ReminderTone } from '../types';
import type { ComposedReminderEmail, ReminderEmailContext } from './types';
import { EMAIL_PROVIDER_ID } from './types';

function env(name: string, fallback = ''): string {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return (g.process?.env?.[name] ?? fallback).trim();
}

/** Resend test sender — works without buying a domain (to: your Resend account email only). */
export const RESEND_TEST_FROM = 'onboarding@resend.dev';

function normalizeFromEmail(raw: string): string {
  const cleaned = raw.replace(/[\r\n\s"'<>]/g, '').trim().toLowerCase();
  // Reject placeholders / broken values that Resend will refuse.
  if (
    !cleaned ||
    !cleaned.includes('@') ||
    cleaned.endsWith('@example.com') ||
    cleaned.includes('example.com') ||
    cleaned === 'reminders@collectquiet.app'
  ) {
    return RESEND_TEST_FROM;
  }
  return cleaned;
}

/** Build Reply-To: cq+{token}@{inbound domain} — or owner inbox in test mode. */
export function buildReplyToAddress(token: string): string | null {
  const fromEmail = normalizeFromEmail(
    env('COLLECTION_EMAIL_FROM', env('RESEND_FROM', RESEND_TEST_FROM))
  );
  // Testing with resend.dev: route client replies to the founder's inbox.
  if (fromEmail.endsWith('@resend.dev')) {
    const owner = env('COLLECTION_TEST_REPLY_TO', env('COLLECTION_OWNER_EMAIL', '')).toLowerCase();
    return owner.includes('@') && !owner.includes('example.com') ? owner : null;
  }
  const domain = env('COLLECTION_INBOUND_DOMAIN', env('RESEND_INBOUND_DOMAIN', ''));
  if (!domain || domain.includes('example.com') || domain.endsWith('collectquiet.app')) {
    return null;
  }
  const safe = token.replace(/[^a-zA-Z0-9]/g, '');
  return `cq+${safe}@${domain}`;
}

/** From: "Name <address>" — keep simple for Resend parsing. */
export function buildFromAddress(displayName: string): string {
  const fromEmail = normalizeFromEmail(
    env('COLLECTION_EMAIL_FROM', env('RESEND_FROM', RESEND_TEST_FROM))
  );
  const cleaned = displayName.replace(/[<>\r\n]/g, '').trim() || 'CollectQuiet';
  // Avoid "via CollectQuiet" mid-string — some parsers mishandle it.
  return `${cleaned} <${fromEmail}>`;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * Compose outbound email from user-approved snapshots + invoice facts.
 * Does not re-render global templates — snapshots are authoritative.
 * Attachments are omitted unless the product safely supports them (currently: never).
 */
export function composeReminderEmail(ctx: ReminderEmailContext): ComposedReminderEmail {
  const replyTo = buildReplyToAddress(ctx.replyToToken);
  const from = buildFromAddress(ctx.senderDisplayName);
  const amount = formatMoney(ctx.amount, ctx.currency);
  const due = ctx.dueAt.slice(0, 10);

  const footerLines = [
    '',
    '---',
    `Invoice: ${ctx.invoiceNumber}`,
    `Amount: ${amount}`,
    `Due: ${due}`,
    ctx.clientName ? `Client: ${ctx.clientName}` : null,
    ctx.paymentLink ? `Pay / view invoice: ${ctx.paymentLink}` : null,
    '',
    `This message was sent on behalf of ${ctx.senderDisplayName}${ctx.businessName ? ` (${ctx.businessName})` : ''} via CollectQuiet.`,
    'Reply to this email to reach them about this invoice.',
  ].filter((l): l is string => l !== null);

  // Body is the approved snapshot; append structured facts only if not already present.
  let text = ctx.bodySnapshot.trim();
  const needsFacts =
    !text.includes(ctx.invoiceNumber) ||
    !text.toLowerCase().includes('due') ||
    (ctx.paymentLink && !text.includes(ctx.paymentLink));
  if (needsFacts) {
    text = `${text}\n${footerLines.join('\n')}`;
  } else {
    text = `${text}\n\n---\nThis message was sent on behalf of ${ctx.senderDisplayName} via CollectQuiet.\nReply to this email to reach them about this invoice.`;
  }

  const headers: Record<string, string> = {
    'X-CQ-Reply-Token': ctx.replyToToken,
    'X-CQ-Invoice-Id': ctx.invoiceId,
    'X-CQ-Automation-Id': ctx.automationId,
    'X-CQ-Reminder-Step-Id': ctx.reminderStepId,
    'X-CQ-User-Id': ctx.userId,
    'X-CQ-Correlation-Id': ctx.correlationId,
    'X-Entity-Ref-ID': ctx.idempotencyKey,
  };

  // No attachments: product has no safe PDF storage yet (audit).
  void ctx.attachment;

  return {
    from,
    to: ctx.to,
    replyTo,
    subject: ctx.subjectSnapshot,
    text,
    headers,
    tags: [
      { name: 'cq_invoice', value: ctx.invoiceId.slice(0, 48) },
      { name: 'cq_step', value: ctx.reminderStepId.slice(0, 48) },
      { name: 'cq_automation', value: ctx.automationId.slice(0, 48) },
    ],
    idempotencyKey: ctx.idempotencyKey,
    provider: EMAIL_PROVIDER_ID,
  };
}

export function firmToneNeedsApproval(tone: ReminderTone, manualApprovedAt?: string | null): boolean {
  return (tone === 'firm' || tone === 'final') && !manualApprovedAt;
}

export function previewWarningForTone(tone: ReminderTone): boolean {
  return tone === 'firm' || tone === 'final';
}

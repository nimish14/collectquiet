/**
 * Parse Resend inbound email webhook payloads into RawInboundEmail.
 * Delivery events are handled separately at /api/webhooks/resend.
 */

import type { RawInboundEmail } from './types';

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function parseResendInboundPayload(body: string): RawInboundEmail {
  const parsed = JSON.parse(body) as {
    type?: string;
    created_at?: string;
    data?: Record<string, unknown>;
  };
  const type = parsed.type ?? '';
  if (!type.includes('received') && type !== 'email.inbound' && type !== 'inbound') {
    // Allow flexible Resend inbound naming
    if (!parsed.data?.email_id && !parsed.data?.from) {
      throw new Error(`Unsupported inbound event type: ${type || 'unknown'}`);
    }
  }
  const data = parsed.data ?? {};
  const headersRaw = (data.headers as Record<string, string> | undefined) ?? {};
  const header = (name: string) =>
    headersRaw[name] ??
    headersRaw[name.toLowerCase()] ??
    headersRaw[name.replace(/-/g, '_')] ??
    null;

  const toField = data.to;
  const to =
    typeof toField === 'string'
      ? toField
      : Array.isArray(toField)
        ? String(toField[0] ?? '')
        : asString(data.recipient);

  const emailId = asString(data.email_id) ?? asString(data.id);
  const eventId =
    asString(data.email_id) && parsed.created_at
      ? `${data.email_id}:inbound:${parsed.created_at}`
      : `${type}:${emailId ?? 'unknown'}:${parsed.created_at ?? Date.now()}`;

  return {
    provider: 'resend',
    providerEventId: eventId,
    providerMessageId: emailId,
    providerThreadId: asString(data.thread_id) ?? asString(header('X-CQ-Automation-Id')),
    from: asString(data.from),
    to,
    subject: asString(data.subject),
    text: asString(data.text) ?? asString(data.text_body),
    html: asString(data.html) ?? asString(data.html_body),
    headers: {
      inReplyTo: header('In-Reply-To') ?? header('in_reply_to'),
      references: header('References') ?? header('references'),
      autoSubmitted: header('Auto-Submitted') ?? header('auto_submitted'),
      precedence: header('Precedence'),
      xAutoResponseSuppress: header('X-Auto-Response-Suppress'),
      messageId: header('Message-ID') ?? header('Message-Id'),
    },
    raw: data,
    emailIdForFetch: !data.text && !data.html && emailId ? emailId : null,
  };
}

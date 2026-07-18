import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ComposedReminderEmail,
  DeliveryStatusResult,
  EmailProvider,
  ParsedDeliveryEvent,
  SendReminderResult,
} from './types';
import { EMAIL_PROVIDER_ID, EmailProviderError } from './types';
import type { ProviderDeliveryStatus } from '../types';

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Svix-compatible webhook verification (Resend uses Svix). */
export function verifySvixSignature(
  secret: string,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  toleranceSeconds = 300
): boolean {
  const id = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signature = header(headers, 'svix-signature');
  if (!id || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');

  const toSign = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', key).update(toSign).digest('base64');

  const candidates = signature.split(' ').map((part) => {
    const [, sig] = part.split(',');
    return sig ?? part;
  });

  return candidates.some((sig) => {
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

function mapResendType(type: string): ProviderDeliveryStatus | null {
  switch (type) {
    case 'email.queued':
    case 'email.sent':
      return 'queued';
    case 'email.delivered':
      return 'delivered';
    case 'email.delivery_delayed':
      return 'delayed';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    case 'email.failed':
    case 'email.suppressed':
      return 'rejected';
    default:
      return null;
  }
}

export interface ResendProviderOptions {
  apiKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Resend outbound adapter (audit Option A).
 * Does not replace another configured provider — construct explicitly.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly id = EMAIL_PROVIDER_ID;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: ResendProviderOptions) {
    if (!opts.apiKey) throw new Error('RESEND_API_KEY is required');
    this.apiKey = opts.apiKey;
    this.webhookSecret = opts.webhookSecret;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://api.resend.com';
  }

  async sendReminder(email: ComposedReminderEmail): Promise<SendReminderResult> {
    if (email.provider !== EMAIL_PROVIDER_ID) {
      throw new EmailProviderError(
        `Refusing to send with mismatched provider ${email.provider}`,
        'permanent',
        'provider_mismatch'
      );
    }

    const payload: Record<string, unknown> = {
      from: email.from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      headers: email.headers,
      tags: email.tags.map((t) => ({
        name: t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256),
        value: t.value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256),
      })),
    };
    if (email.replyTo) {
      payload.reply_to = email.replyTo;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const msg = typeof raw.message === 'string' ? raw.message : `Resend HTTP ${res.status}`;
      console.error(
        JSON.stringify({
          svc: 'resend',
          event: 'send_failed',
          status: res.status,
          message: msg,
          from: email.from,
          to: email.to,
          replyTo: email.replyTo,
        })
      );
      const permanent =
        res.status === 422 ||
        res.status === 400 ||
        /invalid|unsubscribed|not allowed|not verified|validation/i.test(msg);
      throw new EmailProviderError(
        msg,
        permanent ? 'permanent' : 'temporary',
        permanent ? 'invalid_recipient' : res.status === 429 ? 'rate_limited' : 'provider_error'
      );
    }

    const id = typeof raw.id === 'string' ? raw.id : null;
    if (!id) {
      throw new EmailProviderError('Resend response missing id', 'temporary', 'provider_error');
    }

    return {
      provider: EMAIL_PROVIDER_ID,
      providerMessageId: id,
      providerThreadId: id,
      rfcMessageId: typeof raw.id === 'string' ? `<${raw.id}@resend.dev>` : null,
      raw,
    };
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/emails/${providerMessageId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { providerMessageId, status: 'unknown', raw };
    }
    const last =
      typeof raw.last_event === 'string' ? mapResendType(`email.${raw.last_event}`) : null;
    return {
      providerMessageId,
      status: last ?? 'unknown',
      raw,
    };
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): boolean {
    return verifySvixSignature(this.webhookSecret, rawBody, headers);
  }

  parseDeliveryEvent(payload: unknown): ParsedDeliveryEvent {
    const body = payload as {
      type?: string;
      created_at?: string;
      data?: Record<string, unknown>;
    };
    const type = body.type ?? '';
    const status = mapResendType(type);
    if (!status) {
      throw new EmailProviderError(`Unsupported Resend event ${type}`, 'permanent', 'unknown_event');
    }
    const data = body.data ?? {};
    const emailId = typeof data.email_id === 'string' ? data.email_id : null;
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const tagMap: Record<string, string> = {};
    for (const t of tags) {
      if (t && typeof t === 'object' && 'name' in t && 'value' in t) {
        tagMap[String((t as { name: string }).name)] = String((t as { value: string }).value);
      }
    }
    const headers = (data.headers as Record<string, string> | undefined) ?? {};

    return {
      provider: EMAIL_PROVIDER_ID,
      providerEventId:
        typeof data.email_id === 'string' && body.created_at
          ? `${data.email_id}:${type}:${body.created_at}`
          : `${type}:${emailId ?? 'unknown'}:${body.created_at ?? Date.now()}`,
      providerMessageId: emailId,
      eventStatus: status,
      emailId,
      occurredAt: body.created_at ?? new Date().toISOString(),
      raw: body as Record<string, unknown>,
      reminderStepId: tagMap.cq_step ?? headers['X-CQ-Reminder-Step-Id'] ?? null,
      invoiceId: tagMap.cq_invoice ?? headers['X-CQ-Invoice-Id'] ?? null,
      automationId: tagMap.cq_automation ?? headers['X-CQ-Automation-Id'] ?? null,
      replyToken: headers['X-CQ-Reply-Token'] ?? null,
    };
  }
}

import type {
  ComposedReminderEmail,
  DeliveryStatusResult,
  EmailProvider,
  ParsedDeliveryEvent,
  SendReminderResult,
} from './types';
import { EMAIL_PROVIDER_ID, EmailProviderError } from './types';
import type { ProviderDeliveryStatus } from '../types';

/** In-memory mock provider for automated tests — never hits the network. */
export class MockEmailProvider implements EmailProvider {
  readonly id = EMAIL_PROVIDER_ID;
  readonly sent: ComposedReminderEmail[] = [];
  nextSendError: EmailProviderError | null = null;
  acceptWebhooks = true;
  autoId = 0;
  statuses = new Map<string, ProviderDeliveryStatus>();

  async sendReminder(email: ComposedReminderEmail): Promise<SendReminderResult> {
    if (this.nextSendError) {
      const err = this.nextSendError;
      this.nextSendError = null;
      throw err;
    }
    this.autoId += 1;
    const id = `re_mock_${this.autoId}`;
    this.sent.push(email);
    this.statuses.set(id, 'queued');
    return {
      provider: EMAIL_PROVIDER_ID,
      providerMessageId: id,
      providerThreadId: id,
      rfcMessageId: `<${id}@mock.resend>`,
    };
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult> {
    return {
      providerMessageId,
      status: this.statuses.get(providerMessageId) ?? 'unknown',
    };
  }

  verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: string
  ): boolean {
    return this.acceptWebhooks;
  }

  parseDeliveryEvent(payload: unknown): ParsedDeliveryEvent {
    const p = payload as {
      type: string;
      created_at?: string;
      data: { email_id: string; tags?: Array<{ name: string; value: string }> };
    };
    const map: Record<string, ProviderDeliveryStatus> = {
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'delayed',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.failed': 'rejected',
      'email.queued': 'queued',
    };
    const status = map[p.type];
    if (!status) throw new EmailProviderError('unknown', 'permanent', 'unknown_event');
    const tags = Object.fromEntries((p.data.tags ?? []).map((t) => [t.name, t.value]));
    return {
      provider: EMAIL_PROVIDER_ID,
      providerEventId: `${p.data.email_id}:${p.type}`,
      providerMessageId: p.data.email_id,
      eventStatus: status,
      emailId: p.data.email_id,
      occurredAt: p.created_at ?? new Date().toISOString(),
      raw: p as unknown as Record<string, unknown>,
      reminderStepId: tags.cq_step ?? null,
      invoiceId: tags.cq_invoice ?? null,
      automationId: tags.cq_automation ?? null,
    };
  }
}

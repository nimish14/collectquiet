/**
 * Provider-neutral outbound email interface.
 * Audit choice: Option A — Resend (provider-domain MVP). Do not silently swap providers.
 */

import type { ProviderDeliveryStatus, ReminderTone } from '../types';

export const EMAIL_PROVIDER_ID = 'resend' as const;

export interface ReminderEmailContext {
  to: string;
  clientName?: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueAt: string;
  paymentLink?: string | null;
  /** Invoice PDF — only pass when product safely supports attachments (currently unsupported). */
  attachment?: { filename: string; content: Uint8Array; contentType: string } | null;
  subjectSnapshot: string;
  bodySnapshot: string;
  tone: ReminderTone;
  senderDisplayName: string;
  businessName?: string | null;
  replyToToken: string;
  invoiceId: string;
  automationId: string;
  reminderStepId: string;
  userId: string;
  idempotencyKey: string;
  correlationId: string;
  timezone: string;
  scheduledAtUtc: string;
  manualApprovedAt?: string | null;
}

export interface ComposedReminderEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
  idempotencyKey: string;
  provider: typeof EMAIL_PROVIDER_ID;
  /** Attachments omitted unless product supports them. */
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export interface SendReminderResult {
  provider: typeof EMAIL_PROVIDER_ID;
  providerMessageId: string;
  providerThreadId?: string | null;
  rfcMessageId?: string | null;
  raw?: Record<string, unknown>;
}

export interface DeliveryStatusResult {
  providerMessageId: string;
  status: ProviderDeliveryStatus | 'unknown';
  raw?: Record<string, unknown>;
}

export interface ParsedDeliveryEvent {
  provider: typeof EMAIL_PROVIDER_ID;
  providerEventId: string;
  providerMessageId: string | null;
  eventStatus: ProviderDeliveryStatus;
  emailId?: string | null;
  occurredAt: string;
  raw: Record<string, unknown>;
  reminderStepId?: string | null;
  invoiceId?: string | null;
  automationId?: string | null;
  replyToken?: string | null;
}

export interface EmailProvider {
  readonly id: typeof EMAIL_PROVIDER_ID | string;
  sendReminder(email: ComposedReminderEmail): Promise<SendReminderResult>;
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  parseDeliveryEvent(payload: unknown): ParsedDeliveryEvent;
}

export class EmailProviderError extends Error {
  readonly kind: 'temporary' | 'permanent';
  readonly code: string;
  constructor(message: string, kind: 'temporary' | 'permanent', code: string) {
    super(message);
    this.name = 'EmailProviderError';
    this.kind = kind;
    this.code = code;
  }
}

export type SafetyBlockReason =
  | 'invoice_paid'
  | 'invoice_disputed'
  | 'automation_paused'
  | 'automation_cancelled'
  | 'automation_completed'
  | 'automation_inactive'
  | 'reminder_already_sent'
  | 'meaningful_reply_pending'
  | 'recipient_opted_out'
  | 'firm_tone_needs_approval'
  | 'invalid_recipient';

export interface SafetyCheckInput {
  invoice: {
    status: string;
    collectionStatus: string;
    paidAt?: string | null;
    clientEmail?: string | null;
    optedOut?: boolean;
  };
  automation: {
    status: string;
  };
  step: {
    status: string;
    sentAt?: string | null;
    providerMessageId?: string | null;
    tone: ReminderTone;
    manualApprovedAt?: string | null;
  };
  hasUnresolvedMeaningfulReply: boolean;
  hasReminderSentEvent: boolean;
}

export interface EmailPreview {
  provider: string;
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  text: string;
  scheduledAtUtc: string;
  timezone: string;
  tone: ReminderTone;
  firmToneWarning: boolean;
  headers: Record<string, string>;
  idempotencyKey: string;
}

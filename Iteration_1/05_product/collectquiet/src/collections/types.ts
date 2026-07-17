/** Collections automation domain types (persistence + state machine). */

export type AutomationStatus =
  | 'inactive'
  | 'active'
  | 'paused'
  | 'awaiting_user'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ReminderStepStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'retry_scheduled'
  | 'skipped'
  | 'cancelled'
  | 'failed';

export type InvoiceCollectionStatus =
  | 'open'
  | 'collecting'
  | 'paused'
  | 'paid'
  | 'disputed'
  | 'written_off'
  | 'completed'
  | 'payment_confirmation_pending';

export type CollectionChannel = 'email' | 'whatsapp_manual';

export type ReminderTone = 'friendly' | 'direct' | 'firm' | 'final';

export type EventSource = 'user' | 'system' | 'provider_webhook' | 'worker';

export type CollectionEventType =
  | 'automation_created'
  | 'automation_activated'
  | 'automation_paused'
  | 'automation_resumed'
  | 'automation_cancelled'
  | 'reminder_scheduled'
  | 'reminder_claimed'
  | 'reminder_sent'
  | 'reminder_failed'
  | 'retry_scheduled'
  | 'inbound_reply_received'
  | 'reply_classified'
  | 'payment_claimed'
  | 'payment_confirmed'
  | 'payment_promise_received'
  | 'dispute_received'
  | 'invoice_marked_paid'
  | 'automation_completed'
  | 'manual_override'
  | 'reminders_skipped'
  | 'reminder_dry_run'
  | 'needs_attention'
  | 'claim_expired_requeued'
  | 'delivery_status_updated'
  | 'test_email_sent'
  | 'notification_created'
  | 'inbound_unmatched'
  | 'opt_out_recorded'
  | 'payment_received'
  | 'payment_partial'
  | 'payment_mismatch'
  | 'payment_promise_due'
  | 'payment_promise_fulfilled'
  | 'payment_promise_missed'
  | 'race_paid_during_send'
  | 'race_paid_after_provider_send'
  | 'lease_invalidated';

export type InboundClassification =
  | 'payment_claimed'
  | 'payment_promise'
  | 'dispute'
  | 'request_invoice_copy'
  | 'request_payment_details'
  | 'wrong_contact'
  | 'out_of_office'
  | 'unsubscribe'
  | 'general_reply'
  | 'automated_response'
  | 'unknown'
  /** @deprecated Phase 2 alias — prefer general_reply */
  | 'human_reply'
  /** @deprecated Phase 2 alias — prefer payment_claimed */
  | 'payment_claim'
  /** @deprecated Phase 2 alias — prefer automated_response */
  | 'auto_reply'
  /** @deprecated Phase 2 alias — prefer automated_response */
  | 'bounce';

export type PaymentPromiseStatus =
  | 'detected'
  | 'awaiting_approval'
  | 'active'
  | 'fulfilled'
  | 'missed'
  | 'cancelled';

export type ProviderDeliveryStatus =
  | 'queued'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'rejected';

export type StopReason =
  | 'marked_paid'
  | 'client_reply'
  | 'dispute'
  | 'payment_promise'
  | 'delivery_failure'
  | 'user_cancelled'
  | 'user_paused'
  | 'completed'
  | 'manual_override'
  | string;

export interface CollectionInvoice {
  id: string;
  userId: string;
  status: string;
  collectionStatus: InvoiceCollectionStatus;
  paidAt?: string | null;
  clientEmail?: string;
  clientName?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  dueAt?: string;
  paymentLink?: string | null;
  optedOut?: boolean;
}

export interface CollectionAutomation {
  id: string;
  userId: string;
  invoiceId: string;
  status: AutomationStatus;
  channel: CollectionChannel;
  timezone: string;
  activatedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  stopReason: string | null;
  nextActionAt: string | null;
  version: number;
  replyToToken: string;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderStep {
  id: string;
  automationId: string;
  invoiceId: string;
  userId: string;
  sequenceNumber: number;
  channel: CollectionChannel;
  scheduledAt: string;
  tone: ReminderTone;
  templateId: string | null;
  subjectSnapshot: string;
  bodySnapshot: string;
  status: ReminderStepStatus;
  attemptCount: number;
  maximumAttempts: number;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  sentAt: string | null;
  skippedAt: string | null;
  failedAt: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  rfcMessageId: string | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastDryRunAt: string | null;
  manualApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionEvent {
  id: string;
  userId: string;
  invoiceId: string | null;
  automationId: string | null;
  reminderStepId: string | null;
  eventType: CollectionEventType;
  source: EventSource;
  actorId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface InboundMessage {
  id: string;
  userId: string;
  provider: string;
  providerEventId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  replyToken: string | null;
  senderAddress: string | null;
  recipientAddress: string | null;
  subject: string | null;
  textContent: string | null;
  htmlContent: string | null;
  receivedAt: string;
  classification: InboundClassification | null;
  classificationConfidence: number | null;
  matchedInvoiceId: string | null;
  matchedAutomationId: string | null;
  requiresReview: boolean;
  attentionClearedAt: string | null;
  processedAt: string | null;
  rawMetadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentPromise {
  id: string;
  userId: string;
  invoiceId: string;
  automationId: string | null;
  /** ISO date (YYYY-MM-DD); null when date not yet detected/approved */
  promisedPaymentDate: string | null;
  sourceMessageId: string | null;
  status: PaymentPromiseStatus;
  confidence: number | null;
  approvedByUser: boolean;
  /** Set when user was notified that the promised date was reached */
  dueNotifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentEventOutcome =
  | 'full_payment'
  | 'partial_payment'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'rejected'
  | 'duplicate';

export interface PaymentEvent {
  id: string;
  userId: string | null;
  invoiceId: string | null;
  automationId: string | null;
  provider: string;
  providerEventId: string;
  providerTransactionId: string | null;
  amount: number | null;
  currency: string | null;
  outcome: PaymentEventOutcome;
  rawMetadata: Record<string, unknown>;
  occurredAt: string;
  processedAt: string;
}

export type UserNotificationKind =
  | 'client_says_paid'
  | 'client_promises_payment'
  | 'client_disputes'
  | 'reply_unclassified'
  | 'reply_unmatched'
  | 'wrong_contact'
  | 'opt_out'
  | 'delivery_failure'
  | 'out_of_office'
  | 'needs_attention';

export interface UserNotification {
  id: string;
  userId: string;
  kind: UserNotificationKind;
  title: string;
  body: string | null;
  invoiceId: string | null;
  automationId: string | null;
  inboundMessageId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ProviderDeliveryEvent {
  id: string;
  userId: string | null;
  provider: string;
  providerEventId: string;
  providerMessageId: string | null;
  reminderStepId: string | null;
  eventStatus: ProviderDeliveryStatus;
  payloadHash: string | null;
  rawMetadata: Record<string, unknown>;
  occurredAt: string;
  processedAt: string;
}

export interface PlannedReminderInput {
  sequenceNumber: number;
  channel: CollectionChannel;
  /** ISO timestamptz in UTC */
  scheduledAtUtc: string;
  tone: ReminderTone;
  templateId?: string | null;
  subjectSnapshot: string;
  bodySnapshot: string;
  idempotencyKey: string;
  maximumAttempts?: number;
  manualApprovedAt?: string | null;
}

export class CollectionsDomainError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CollectionsDomainError';
    this.code = code;
  }
}

export const OPEN_AUTOMATION_STATUSES: AutomationStatus[] = [
  'inactive',
  'active',
  'paused',
  'awaiting_user',
];

export const TERMINAL_AUTOMATION_STATUSES: AutomationStatus[] = [
  'completed',
  'cancelled',
  'failed',
];

export const CANCELABLE_STEP_STATUSES: ReminderStepStatus[] = [
  'pending',
  'processing',
  'retry_scheduled',
];

/** Classifications that require user review / block further sends. */
export const MEANINGFUL_REPLY_CLASSIFICATIONS: InboundClassification[] = [
  'payment_claimed',
  'payment_promise',
  'dispute',
  'request_invoice_copy',
  'request_payment_details',
  'wrong_contact',
  'unsubscribe',
  'general_reply',
  'unknown',
  'out_of_office',
  // legacy aliases
  'human_reply',
  'payment_claim',
];

/** Clear automated receipts — do not pause before classify as human. */
export const AUTOMATED_RECEIPT_CLASSIFICATIONS: InboundClassification[] = [
  'automated_response',
  'auto_reply',
  'bounce',
];

export const INBOUND_CLASSIFICATION_VALUES = [
  'payment_claimed',
  'payment_promise',
  'dispute',
  'request_invoice_copy',
  'request_payment_details',
  'wrong_contact',
  'out_of_office',
  'unsubscribe',
  'general_reply',
  'automated_response',
  'unknown',
] as const;

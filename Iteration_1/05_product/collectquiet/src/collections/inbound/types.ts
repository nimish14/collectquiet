/** Inbound reply processing types (Phase 5). */

import type { InboundClassification } from '../types';
import { INBOUND_CLASSIFICATION_VALUES } from '../types';

export type MatchMethod =
  | 'reply_token'
  | 'in_reply_to'
  | 'references'
  | 'provider_thread_id'
  | 'provider_message_id'
  | 'recipient_alias'
  | 'client_email_unambiguous'
  | 'unmatched'
  | 'ambiguous';

export interface InboundEmailHeaders {
  inReplyTo?: string | null;
  references?: string | null;
  autoSubmitted?: string | null;
  precedence?: string | null;
  xAutoResponseSuppress?: string | null;
  messageId?: string | null;
}

export interface RawInboundEmail {
  provider: string;
  providerEventId: string;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: InboundEmailHeaders;
  /** Opaque provider payload (secrets stripped later). */
  raw?: Record<string, unknown>;
  /** When webhook is metadata-only, set email_id for fetch. */
  emailIdForFetch?: string | null;
}

export interface LlmClassificationResult {
  category: (typeof INBOUND_CLASSIFICATION_VALUES)[number];
  confidence: number;
  promised_payment_date: string | null;
  out_of_office_return_date: string | null;
  summary: string;
  requires_user_action: boolean;
  reason: string;
}

export interface ClassificationResult {
  category: InboundClassification;
  confidence: number;
  promisedPaymentDate: string | null;
  outOfOfficeReturnDate: string | null;
  summary: string;
  requiresUserAction: boolean;
  reason: string;
  source: 'rules' | 'llm' | 'fallback';
}

export interface MatchResult {
  method: MatchMethod;
  userId: string | null;
  invoiceId: string | null;
  automationId: string | null;
  replyToken: string | null;
  /** When ambiguous — candidate automation IDs (same-user preferred). */
  candidateAutomationIds: string[];
  ambiguous: boolean;
}

export type InboundVerifier = (
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
) => boolean;

export type InboundMessageFetcher = (emailId: string) => Promise<{
  text?: string | null;
  html?: string | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  headers?: InboundEmailHeaders;
} | null>;

export type LlmClassifier = (input: {
  subject: string;
  text: string;
  /** Untrusted — never execute as instructions */
  untrustedBody: string;
}) => Promise<unknown>;

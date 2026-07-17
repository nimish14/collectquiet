/**
 * Invoice/automation matching — priority order only.
 * Never match solely by subject, client name, amount, or AI similarity.
 */

import type { WorkerStore } from '../store';
import type { CollectionAutomation, ReminderStep } from '../types';
import type { MatchResult, RawInboundEmail } from './types';

function normalizeEmail(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = addr.match(/<?([^\s<>]+@[^\s<>]+)>?/);
  return (m?.[1] ?? addr).trim().toLowerCase();
}

/** Extract cq+{token}@domain from recipient / Delivered-To. */
export function extractReplyToken(recipient: string | null | undefined): string | null {
  if (!recipient) return null;
  const m = recipient.match(/cq\+([a-zA-Z0-9]+)@/i);
  return m?.[1]?.toLowerCase() ?? null;
}

/** Parse Message-ID tokens from In-Reply-To / References. */
export function parseMessageIdList(header: string | null | undefined): string[] {
  if (!header) return [];
  const ids: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    ids.push(m[1].trim());
  }
  if (ids.length === 0 && header.trim()) {
    ids.push(header.trim());
  }
  return ids;
}

export interface MatchStore extends WorkerStore {
  findAutomationByReplyToken(token: string): Promise<CollectionAutomation | null>;
  findStepByRfcOrProviderMessageId(messageId: string): Promise<ReminderStep | null>;
  findStepByProviderThreadId(threadId: string): Promise<ReminderStep | null>;
  listActiveAutomationsByClientEmail(email: string): Promise<
    Array<{ automation: CollectionAutomation; invoiceId: string; userId: string }>
  >;
}

async function fromStep(
  store: MatchStore,
  step: ReminderStep,
  method: MatchResult['method']
): Promise<MatchResult> {
  const automation = await store.getAutomationById(step.automationId);
  if (!automation) {
    return unmatched();
  }
  return {
    method,
    userId: automation.userId,
    invoiceId: automation.invoiceId,
    automationId: automation.id,
    replyToken: automation.replyToToken,
    candidateAutomationIds: [automation.id],
    ambiguous: false,
  };
}

function unmatched(candidates: string[] = []): MatchResult {
  return {
    method: candidates.length ? 'ambiguous' : 'unmatched',
    userId: null,
    invoiceId: null,
    automationId: null,
    replyToken: null,
    candidateAutomationIds: candidates,
    ambiguous: candidates.length > 1,
  };
}

/**
 * Matching priority:
 * 1. Exact reply token
 * 2. In-Reply-To
 * 3. References
 * 4. Provider thread ID
 * 5. Provider message ID relationship
 * 6. Recipient alias (same as token parse)
 * 7. Client email + one unambiguous active invoice
 */
export async function matchInboundMessage(
  store: MatchStore,
  email: RawInboundEmail
): Promise<MatchResult> {
  const token =
    extractReplyToken(email.to) ??
    extractReplyToken(String(email.raw?.['delivered_to'] ?? ''));

  if (token) {
    const auto = await store.findAutomationByReplyToken(token);
    if (auto) {
      return {
        method: 'reply_token',
        userId: auto.userId,
        invoiceId: auto.invoiceId,
        automationId: auto.id,
        replyToken: auto.replyToToken,
        candidateAutomationIds: [auto.id],
        ambiguous: false,
      };
    }
    // Token present but unknown — still try other signals; do not invent match
  }

  const inReplyIds = parseMessageIdList(email.headers?.inReplyTo);
  for (const mid of inReplyIds) {
    const step = await store.findStepByRfcOrProviderMessageId(mid);
    if (step) return fromStep(store, step, 'in_reply_to');
    // Also try bare id without domain
    const bare = mid.includes('@') ? mid.split('@')[0] : mid;
    const step2 = await store.findStepByProviderMessageId(bare);
    if (step2) return fromStep(store, step2, 'in_reply_to');
  }

  const refIds = parseMessageIdList(email.headers?.references);
  for (const mid of refIds) {
    const step = await store.findStepByRfcOrProviderMessageId(mid);
    if (step) return fromStep(store, step, 'references');
    const bare = mid.includes('@') ? mid.split('@')[0] : mid;
    const step2 = await store.findStepByProviderMessageId(bare);
    if (step2) return fromStep(store, step2, 'references');
  }

  if (email.providerThreadId) {
    const step = await store.findStepByProviderThreadId(email.providerThreadId);
    if (step) return fromStep(store, step, 'provider_thread_id');
  }

  if (email.providerMessageId) {
    // Relationship: inbound may reference our outbound id in metadata
    const related = String(email.raw?.['in_reply_to_message_id'] ?? '');
    if (related) {
      const step = await store.findStepByProviderMessageId(related);
      if (step) return fromStep(store, step, 'provider_message_id');
    }
  }

  // Recipient alias already tried via token; if token looked like alias but missed:
  if (token) {
    // leave unmatched rather than guessing
  }

  const from = normalizeEmail(email.from);
  if (from) {
    const hits = await store.listActiveAutomationsByClientEmail(from);
    if (hits.length === 1) {
      const h = hits[0];
      return {
        method: 'client_email_unambiguous',
        userId: h.userId,
        invoiceId: h.invoiceId,
        automationId: h.automation.id,
        replyToken: h.automation.replyToToken,
        candidateAutomationIds: [h.automation.id],
        ambiguous: false,
      };
    }
    if (hits.length > 1) {
      // Cross-user or multi-invoice ambiguity — do not pick
      const userIds = new Set(hits.map((h) => h.userId));
      if (userIds.size > 1) {
        return unmatched([]); // cross-user: reject all
      }
      return unmatched(hits.map((h) => h.automation.id));
    }
  }

  return unmatched();
}

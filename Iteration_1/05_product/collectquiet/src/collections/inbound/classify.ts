/**
 * Deterministic classification first; LLM only when rules are not confident.
 * All inbound content is untrusted data — never execute email instructions.
 */

import type { InboundClassification } from '../types';
import type {
  ClassificationResult,
  InboundEmailHeaders,
  LlmClassifier,
  LlmClassificationResult,
} from './types';
import { validateLlmClassification } from './llmSchema';

const RULE_CONFIDENCE = 0.92;

function lower(s: string): string {
  return s.toLowerCase();
}

export function looksLikeAutomatedReceipt(
  headers: InboundEmailHeaders | undefined,
  from: string | null | undefined,
  subject: string | null | undefined
): boolean {
  const h = headers ?? {};
  if (h.autoSubmitted && h.autoSubmitted.toLowerCase() !== 'no') return true;
  if (h.precedence && /bulk|junk|list|auto_reply/i.test(h.precedence)) return true;
  if (h.xAutoResponseSuppress) return true;
  const f = (from ?? '').toLowerCase();
  if (
    /mailer-daemon|postmaster|noreply|no-reply|bounce|delivery.?status/i.test(f)
  ) {
    return true;
  }
  const sub = (subject ?? '').toLowerCase();
  if (/^undeliverable|delivery status notification|mail delivery failed/i.test(sub)) {
    return true;
  }
  return false;
}

function extractIsoDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const named = text.match(
    /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+20\d{2})?)\b/i
  );
  if (named) {
    const d = new Date(named[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function ruleResult(
  category: InboundClassification,
  reason: string,
  extras: Partial<ClassificationResult> = {}
): ClassificationResult {
  return {
    category,
    confidence: RULE_CONFIDENCE,
    promisedPaymentDate: null,
    outOfOfficeReturnDate: null,
    summary: reason,
    requiresUserAction: ![
      'automated_response',
      'out_of_office',
    ].includes(category),
    reason,
    source: 'rules',
    ...extras,
  };
}

/** Deterministic rules. Returns null when not confident. */
export function classifyWithRules(input: {
  subject: string;
  text: string;
  from?: string | null;
  headers?: InboundEmailHeaders;
}): ClassificationResult | null {
  const subject = input.subject ?? '';
  const text = input.text ?? '';
  const blob = lower(`${subject}\n${text}`);
  const from = input.from ?? '';

  if (looksLikeAutomatedReceipt(input.headers, from, subject)) {
    return ruleResult('automated_response', 'Automated delivery/receipt headers or sender', {
      requiresUserAction: false,
    });
  }

  if (
    /\b(unsubscribe|opt[\s-]?out|stop (emailing|messaging|contacting)|remove me from)\b/i.test(
      blob
    ) ||
    /^\s*stop\s*$/im.test(text.trim())
  ) {
    return ruleResult('unsubscribe', 'Explicit opt-out language', {
      requiresUserAction: true,
    });
  }

  if (
    /\b(out of (the )?office|ooo|automatic reply|autoreply|away from (the )?office|on leave until)\b/i.test(
      blob
    )
  ) {
    const returnDate = extractIsoDate(text);
    return ruleResult('out_of_office', 'Out-of-office auto-reply detected', {
      outOfOfficeReturnDate: returnDate,
      requiresUserAction: true,
    });
  }

  if (
    /\b(wrong (person|email|contact)|not the right (person|contact)|don'?t (handle|manage) (this|invoices)|no longer (work|at))\b/i.test(
      blob
    )
  ) {
    return ruleResult('wrong_contact', 'Wrong-contact language', { requiresUserAction: true });
  }

  if (
    /\b(dispute|disagree|incorrect (amount|invoice)|not (what|as) (we|i) agreed|chargeback|contested)\b/i.test(
      blob
    )
  ) {
    return ruleResult('dispute', 'Explicit dispute language', { requiresUserAction: true });
  }

  // Refusal before promise/claim so "will not pay" never matches "will pay".
  if (
    /\b(will not pay|won'?t pay|will not be paying|not (going to |gonna )?pay( you| this| the invoice)?|refuse(s|d)? to pay|i'?m not paying|not paying (you|this|the invoice)|don'?t (owe|intend to pay))\b/i.test(
      blob
    )
  ) {
    return ruleResult('dispute', 'Client refuses to pay', { requiresUserAction: true });
  }

  if (
    /\b(i('ve| have)? (already )?paid|payment (has been |was )?sent|just paid|marked as paid|wire (has been |was )?sent|i (have )?sent .{0,60}(please )?check|sent (the )?(payment|money|amount|funds)|\bi sent \d+|have sent \d+|paid\.?\s*(please )?check|payment (done|complete[d]?|received)|transfer (sent|done|complete[d]?))\b/i.test(
      blob
    ) ||
    /^\s*paid[.!]?\s*$/i.test(text.trim())
  ) {
    return ruleResult('payment_claimed', 'Explicit payment-completed claim', {
      requiresUserAction: true,
    });
  }

  if (
    /\b(will pay|can pay|payment by|pay (you )?(by|on|next)|promise to pay|send payment)\b/i.test(
      blob
    )
  ) {
    const date = extractIsoDate(text);
    return ruleResult('payment_promise', 'Payment promise language', {
      promisedPaymentDate: date,
      requiresUserAction: true,
    });
  }

  if (
    /\b(send (me )?(the )?invoice|resend (the )?invoice|invoice copy|pdf (of )?(the )?invoice|attach(ed)? invoice)\b/i.test(
      blob
    )
  ) {
    return ruleResult('request_invoice_copy', 'Requested invoice copy', {
      requiresUserAction: true,
    });
  }

  if (
    /\b(bank details|payment details|wire info|where (do|to) (i )?pay|account number|iban|routing)\b/i.test(
      blob
    )
  ) {
    return ruleResult('request_payment_details', 'Requested payment details', {
      requiresUserAction: true,
    });
  }

  return null;
}

export async function classifyInbound(opts: {
  subject: string;
  text: string;
  from?: string | null;
  headers?: InboundEmailHeaders;
  llm?: LlmClassifier | null;
}): Promise<ClassificationResult> {
  const rules = classifyWithRules(opts);
  if (rules) return rules;

  if (opts.llm) {
    try {
      // Wrap untrusted content — model must not treat email as system instructions
      const raw = await opts.llm({
        subject: opts.subject,
        text: opts.text.slice(0, 8000),
        untrustedBody: opts.text.slice(0, 8000),
      });
      const validated = validateLlmClassification(raw);
      if (validated) {
        return {
          category: validated.category,
          confidence: validated.confidence,
          promisedPaymentDate: validated.promised_payment_date,
          outOfOfficeReturnDate: validated.out_of_office_return_date,
          summary: validated.summary,
          requiresUserAction: validated.requires_user_action,
          reason: validated.reason,
          source: 'llm',
        };
      }
    } catch {
      /* fall through */
    }
  }

  return {
    category: 'unknown',
    confidence: 0.2,
    promisedPaymentDate: null,
    outOfOfficeReturnDate: null,
    summary: 'Could not confidently classify',
    requiresUserAction: true,
    reason: 'fallback_unknown',
    source: 'fallback',
  };
}

/** Detect prompt-injection attempts for tests / audit logging (does not change category alone). */
export function containsPromptInjection(text: string): boolean {
  return /\b(ignore (all |previous )?instructions|system prompt|you are now|override (your|the) rules)\b/i.test(
    text
  );
}

export type { LlmClassificationResult };

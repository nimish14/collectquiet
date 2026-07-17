# CollectQuiet Collections — Phase 5 (Inbound Reply Detection)

**Date:** 2026-07-17  
**Approach:** Audit Option A — unique Reply-To + Resend inbound webhook  
**Status:** Implemented; rules-first classification; LLM optional and schema-validated.

---

## Matching hierarchy

1. Exact reply token (`cq+{token}@inbound-domain`)
2. `In-Reply-To` header → step `rfc_message_id` / `provider_message_id`
3. `References` header (same)
4. Provider thread ID
5. Provider message ID relationship
6. Recipient alias (token parse)
7. Client email + **one** unambiguous active invoice

**Never** match only by subject, client name, invoice amount, or AI similarity.

Ambiguous / cross-user collisions → store unmatched, notify, soft-pause candidates when practical. No invoice mutation from a guess.

---

## Classification rules (deterministic first)

| Signal | Category |
|--------|----------|
| Auto-Submitted / mailer-daemon / DSN | `automated_response` |
| stop / unsubscribe / opt-out | `unsubscribe` |
| out of office / OOO | `out_of_office` (+ return date if parseable) |
| wrong person / wrong email | `wrong_contact` |
| dispute / incorrect amount | `dispute` |
| already paid / payment sent | `payment_claimed` |
| will pay / promise to pay | `payment_promise` (+ date if parseable) |
| send invoice / PDF | `request_invoice_copy` |
| bank details / IBAN request | `request_payment_details` |

LLM only when rules are not confident. Email body is **untrusted data** — never executed as instructions. Prompt-injection language is flagged; LLM summaries with invented bank details are rejected by schema.

### LLM JSON schema

```json
{
  "category": "payment_claimed | payment_promise | dispute | request_invoice_copy | request_payment_details | wrong_contact | out_of_office | unsubscribe | general_reply | automated_response | unknown",
  "confidence": 0.0,
  "promised_payment_date": null,
  "out_of_office_return_date": null,
  "summary": "",
  "requires_user_action": true,
  "reason": ""
}
```

---

## User-facing reply states

| Category | Automation | Invoice / records | Notification |
|----------|------------|-------------------|--------------|
| `payment_claimed` | Pause | `payment_confirmation_pending` (not auto-paid) | Client says paid |
| `payment_promise` | Pause | Promise row `awaiting_approval` | Client promises payment |
| `dispute` | Pause; cancel firm/final steps | `disputed` | Client disputes |
| `request_invoice_copy` | Pause | Needs attention (manual resend) | Needs attention |
| `request_payment_details` | Pause | Suggest verified details only | Needs attention |
| `wrong_contact` | Cancel | — | Wrong contact |
| `out_of_office` | Pause | Suggest new date; no escalate | Out of office |
| `unsubscribe` | Cancel | `opted_out` | Opt-out |
| `general_reply` / `unknown` | Pause | Needs Attention | Client replied / unclassified |
| `automated_response` | No human pause | Timeline only | — |
| Unmatched | Soft-pause candidates | Unmatched + review | Reply unmatched |

**Immediate pause:** any genuine human reply pauses **before** LLM classification (except clear automated receipts).

---

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/webhooks/resend-inbound` | Inbound reply webhook (Svix-verified) |
| `POST` | `/api/webhooks/resend` | Delivery events (Phase 4) |

---

## Key files

| Path | Role |
|------|------|
| `src/collections/inbound/pipeline.ts` | Full inbound pipeline |
| `src/collections/inbound/match.ts` | Matching hierarchy |
| `src/collections/inbound/classify.ts` | Rules + LLM handoff |
| `src/collections/inbound/llmSchema.ts` | Schema validation |
| `src/collections/inbound/actions.ts` | Category actions |
| `src/collections/inbound/notifications.ts` | In-app notifications |
| `api/webhooks/resend-inbound.ts` | HTTP entry |
| `supabase/migrations/20260717_collections_inbound.sql` | Schema |

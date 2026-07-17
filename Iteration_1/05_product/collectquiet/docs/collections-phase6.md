# CollectQuiet Collections — Phase 6 (Payment Stopping)

**Date:** 2026-07-17  
**Status:** Manual mark-paid is production path. No live payment-provider webhook (no Stripe/Razorpay/etc in repo).

---

## Payment state flow

```
collecting / paused
        │
        ├─ User mark paid ──────────────────────► invoice paid
        │                                         automation completed
        │                                         pending/retry/processing cancelled
        │                                         events: invoice_marked_paid, automation_completed
        │
        ├─ Trusted payment webhook (future) ────► validate amount/currency
        │         full match ───────────────────► same as mark paid
        │         partial / mismatch ───────────► needs attention (not auto-complete)
        │
        └─ Payment promise (approved) ──────────► stay paused
                  date reached ─────────────────► notify user (no auto-send)
                  fulfilled ────────────────────► mark paid
                  missed ───────────────────────► notify; resume only with new approved reminder
                                                  (firm/final requires manualApprovedAt)
```

**API:** `POST /api/collections/mark-paid` (Bearer session JWT)  
**UI:** Mark paid updates optimistically, then calls mark-paid API (falls back to direct invoice update).

---

## Race-condition protections

1. **Mark paid** cancels pending, retry-scheduled, **and processing** steps (clears lease).
2. **Mark paid** sets automation to `completed` (stop reason `marked_paid`).
3. **Worker** re-checks invoice paid / disputed before provider send.
4. **Worker** verifies processing lease (`status === processing` and `claimExpiresAt` valid).
5. **Worker** reconciles after provider response — if paid in-flight, logs `race_paid_after_provider_send` and does **not** count a normal `reminder_sent`.
6. Every race outcome is logged + timeline event (`race_paid_during_send`, `lease_invalidated`, etc.).

---

## Payment provider webhooks

**Not wired in production.** Domain processor + `MockPaymentWebhookAdapter` exist under `src/collections/payment/` for when a trusted provider is added. Requirements already implemented in that processor: signature verify, event-ID dedupe, match by internal invoice ID, amount/currency validation, partial → review, store transaction ID.

---

## Tests

See `src/collections/payment/payment.test.ts` — mark paid, idempotent repeat, before/after reminder, claim race, in-flight provider race, webhook mock cases, promise fulfill/miss/due.

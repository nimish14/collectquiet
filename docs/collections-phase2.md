# Collections automation — Phase 2 (data model)

Branch: `feat/collections-automation`

Persistence + state machine only. **No message sending.**

## Migration

`supabase/migrations/20260717_collections_automation.sql` (applied to Supabase as `collections_automation`)

### Tables

| Table | Purpose |
|-------|---------|
| `cq_collection_automations` | Automation per invoice |
| `cq_reminder_steps` | Scheduled reminders with subject/body snapshots + unique `idempotency_key` |
| `cq_collection_events` | Append-only timeline (no update/delete RLS policies) |
| `cq_inbound_messages` | Inbound email/messages; unique `(provider, provider_event_id)` |
| `cq_payment_promises` | “Pay next Friday” style promises |
| `cq_provider_delivery_events` | Delivery webhooks; unique `(provider, provider_event_id)` |

Also extends `cq_profiles` (`timezone`, `feature_flags`) and `cq_invoices` (`collection_status`, `currency`, `paused_at`, `pause_reason`).

## Domain service

`src/collections/service.ts` — all transitions:

- create / activate / pause / resume / cancel / complete
- markInvoicePaid / markInvoiceDisputed
- scheduleRetry / registerInboundReply
- registerPaymentPromise / confirmPaymentPromise
- skipPendingSteps
- registerProviderDeliveryEvent (dedupe)

In-memory store for tests: `src/collections/store.ts`  
Time helpers (UTC + DST): `src/collections/time.ts`

## Tests

`src/collections/service.test.ts` — 17 cases (transitions, paid lock, idempotency, cross-user, inbound pause, UTC/DST).

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

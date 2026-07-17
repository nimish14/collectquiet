# CollectQuiet Collections — Phase 4 (Outbound Email)

**Date:** 2026-07-17  
**Provider:** Resend (audit Option A — provider-domain MVP)  
**Status:** Implemented behind feature flags; dry-run default remains on.

---

## Provider implementation

Outbound email uses a provider interface:

| Method | Purpose |
|--------|---------|
| `sendReminder()` | Send composed reminder via Resend |
| `getDeliveryStatus()` | Poll Resend message status |
| `verifyWebhook()` | Svix signature check |
| `parseDeliveryEvent()` | Map Resend events → delivery statuses |

**Sender strategy (provider-domain MVP):**

- **From:** `{FreelancerName} via CollectQuiet <COLLECTION_EMAIL_FROM>` on a verified CollectQuiet domain
- **Reply-To:** `cq+{replyToToken}@{COLLECTION_INBOUND_DOMAIN}` (unguessable token from automation)
- **Headers:** `X-CQ-Reply-Token`, invoice/automation/step/user/correlation IDs
- **No From spoofing** of arbitrary client domains
- **No PDF attachments** (product has no safe invoice PDF storage yet)

**Safety gate** re-reads DB immediately before the provider call and blocks when invoice is paid/disputed, automation paused/cancelled/completed, reminder already sent, meaningful reply pending, recipient opted out, firm tone lacks approval, or recipient email is invalid.

**Provider lock:** if `COLLECTION_EMAIL_PROVIDER` is set to anything other than `resend`, tick and webhook handlers refuse to run (no silent swap).

---

## Required environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `RESEND_API_KEY` | Yes (live send) | Resend API key |
| `RESEND_WEBHOOK_SECRET` | Yes (webhooks) | Svix `whsec_…` secret |
| `COLLECTION_EMAIL_FROM` | Yes (prod) | Verified From address, e.g. `reminders@collectquiet.app` |
| `COLLECTION_INBOUND_DOMAIN` | Yes (prod) | Domain for Reply-To aliases |
| `COLLECTION_EMAIL_PROVIDER` | Optional | Must be `resend` or unset |
| `COLLECTION_DEFAULT_SENDER_NAME` | Optional | Display name fallback |
| `COLLECTION_DEFAULT_BUSINESS_NAME` | Optional | Business name in footer |
| `COLLECTION_USE_RECORDING_SENDER` | Optional | `true` = no real email (tests/staging) |
| `CRON_SECRET` | Yes | Protects `/api/collections/tick` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Yes | Worker DB |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Worker DB (server only) |
| `COLLECTION_AUTOMATION_ENABLED` | Flag | Default `false` |
| `COLLECTION_AUTOMATION_DRY_RUN` | Flag | Default `true` |

---

## Webhook & API routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/collections/tick` | Cron worker (existing); uses Resend when enabled |
| `POST` | `/api/webhooks/resend` | Signed delivery webhooks |
| `POST` | `/api/collections/preview` | Preview scheduled email or “send test to myself” |

**Webhook events handled:** `delivered`, `delayed`, `bounced`, `complained`, `rejected` (plus queued/sent mapped to queued).

Behavior:

- Verify Svix signature
- Store provider event IDs; dedupe retries
- Append collection events; mark permanent failures as needs attention
- Pause automation on bounce/complaint; set `opted_out` on complaint

---

## Preview & test mode

`POST /api/collections/preview` with `{ action: 'preview' | 'test', stepId, userId, ownerEmail?, … }`:

- Shows from, reply-to, recipient, scheduled time, timezone, firm-tone warning
- Test sends use `[TEST]` subject and a unique idempotency key
- **Test emails never mutate reminder step state**

---

## Safe staging test procedure

1. Set on Vercel Preview:
   - `COLLECTION_AUTOMATION_ENABLED=true`
   - `COLLECTION_AUTOMATION_DRY_RUN=true` first
   - `COLLECTION_EMAIL_PROVIDER=resend`
   - `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `COLLECTION_EMAIL_FROM`, `COLLECTION_INBOUND_DOMAIN`
   - `CRON_SECRET`, Supabase service role
2. Create a test invoice + activate automation with one past-due step (or use Memory dry-run: `npm run collections:dry-run`).
3. Call tick with `Authorization: Bearer $CRON_SECRET` — expect `dryRunLogged`, **zero** Resend sends.
4. Flip `COLLECTION_AUTOMATION_DRY_RUN=false` only after dry-run looks correct.
5. Use `POST /api/collections/preview` with `action: 'test'` and your own email — confirm inbox, confirm step `status` / `sentAt` unchanged in DB.
6. Point Resend webhook to `https://<preview>/api/webhooks/resend`; send a test delivery event; confirm signature rejection with bad secret.
7. Never point production Resend keys at local unit tests (`MockEmailProvider` only).

---

## Key files

| Path | Role |
|------|------|
| `src/collections/email/*` | Compose, Resend, mock, safety, webhooks, preview |
| `api/webhooks/resend.ts` | Delivery webhook |
| `api/collections/preview.ts` | Preview / test-to-self |
| `api/collections/tick.ts` | Worker wired to Resend |
| `supabase/migrations/20260717_collections_email.sql` | `rfc_message_id`, `manual_approved_at`, `opted_out` |

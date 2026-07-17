# Founder production pilot (2–3 days)

Use this before WhatsApp automation. **Only your account** should be allowlisted.

## Pre-flight (already verified in repo)

- `npm run typecheck` / `npm test` / `npm run build` pass locally
- Defaults deny all users until you set Vercel env vars
- WhatsApp automation stays off (`WHATSAPP_CHANNEL_SUPPORTED = false`)

## 1. Get your Supabase user UUID

In Supabase → Authentication → Users → copy your user **UUID**  
(or SQL: `select id, email from auth.users where email = 'you@…';`)

You need this for `COLLECTION_AUTOMATION_ALLOWLIST`. Prefer UUID over email for worker gating.

## 2. Vercel env (Production) — set these

```bash
COLLECTION_AUTOMATION_ENABLED=true
COLLECTION_AUTOMATION_DRY_RUN=false
COLLECTION_EMAIL_SENDING_ENABLED=true
COLLECTION_REPLY_DETECTION_ENABLED=true
COLLECTION_PAYMENT_WEBHOOK_ENABLED=false

# ONLY your UUID (and optionally your email after a comma)
COLLECTION_AUTOMATION_ALLOWLIST=<your-supabase-user-uuid>

# Leave EMPTY for founder pilot (you may email a real/test client address you control)
# COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST=

CRON_SECRET=<long random string>
SUPABASE_URL=<same as VITE_SUPABASE_URL>
SUPABASE_SERVICE_ROLE_KEY=<service role>
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...

COLLECTION_EMAIL_PROVIDER=resend
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=...
COLLECTION_EMAIL_FROM=reminders@your-verified-domain
COLLECTION_INBOUND_DOMAIN=reply.your-verified-domain
COLLECTION_DEFAULT_SENDER_NAME=Your Name
```

**Do not** set `COLLECTION_AUTOMATION_ALLOWLIST=*` in production.

Redeploy after saving env vars.

## 3. Resend webhooks

Point both to your production URL:

| Event | URL |
|-------|-----|
| Delivery (sent/delivered/bounced/complained) | `https://collectquiet.vercel.app/api/webhooks/resend` |
| Inbound / received | `https://collectquiet.vercel.app/api/webhooks/resend-inbound` |

Use the same Svix signing secret as `RESEND_WEBHOOK_SECRET`.  
Inbound address domain must match `COLLECTION_INBOUND_DOMAIN`.

## 3b. Scheduler on Hobby (important)

Vercel Hobby only allows **one cron per day**. Production uses `0 9 * * *` (09:00 UTC) as a backup.

For a real 2–3 day pilot, add an **external cron** (e.g. [cron-job.org](https://cron-job.org)) every 5 minutes:

```http
POST https://collectquiet.vercel.app/api/collections/tick
Authorization: Bearer <CRON_SECRET>
```

(or header `x-cron-secret: <CRON_SECRET>`)

Upgrade to Vercel Pro later if you want native `*/5` crons.

## 4. Smoke test (day 0)

1. Sign in as **you** on https://collectquiet.vercel.app  
2. Settings: sender name + email + timezone  
3. Add a **low-value / test** invoice to an address **you control** (e.g. second inbox)  
4. Complete **Set up automatic follow-ups** → review → **Start automatic follow-ups**  
5. Set first reminder a few minutes ahead (or use Send now after confirm)  
6. Trigger tick via external cron or:  
   `curl -X POST https://collectquiet.vercel.app/api/collections/tick -H "Authorization: Bearer $CRON_SECRET"`  
7. Confirm **one** email arrived; timeline shows `reminder_sent` once  
8. Reply from the client inbox (promise / question) → automation **pauses** → Needs Attention  
9. Mark paid → automation **completed**, no further sends  

If activate returns `not_on_allowlist` or `automation_disabled`, fix allowlist / flags and redeploy.

## 5. Watch for 2–3 days

- Vercel logs: `tick_complete`, `collections-alerts`  
- Dashboard automation card + audit timeline  
- Needs Attention for disputes / unmatched replies  
- Resend dashboard for bounces  

## 6. Instant rollback

```bash
COLLECTION_AUTOMATION_ENABLED=false
COLLECTION_EMAIL_SENDING_ENABLED=false
COLLECTION_AUTOMATION_DRY_RUN=true
```

Redeploy / sync env. Confirm logs show `worker_disabled`.

## After the pilot → WhatsApp

Keep email path stable first. WhatsApp automation is intentionally off until you green-light the next phase.

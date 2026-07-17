# CollectQuiet Collections Automation Audit

**Date:** 2026-07-17  
**Scope:** Read-only inspection of the existing CollectQuiet codebase  
**Live product:** https://collectquiet.vercel.app  
**Repo path:** `Iteration_1/05_product/collectquiet/`  
**Status:** No application code was modified in this phase.

---

## 1. Current architecture

### 1.1 Stack (actual)

| Layer | What exists | Evidence |
|-------|-------------|---------|
| Frontend | **Vite 8.1 + TypeScript** single-page app (vanilla DOM, **no React/Vue/Svelte**) | `package.json`, `vite.config.ts`, `src/main.ts` |
| Backend framework | **None** | No `api/`, no server actions, no Express/Next |
| Runtime | Browser only for app logic; build runs on Node via Vite | `npm run build` → static `dist/` |
| Database | **Supabase Postgres** | `supabase/schema.sql` |
| ORM | **None** — raw `@supabase/supabase-js` queries | `src/lib/db.ts` |
| Auth | **Supabase Auth** (email/password) | `src/main.ts` `handleSignIn` / `handleSignUp`, `src/lib/supabase.ts` |
| Hosting | **Vercel static** + SPA rewrite | `vercel.json` |
| Email provider | **None server-side** — browser `mailto:` | `src/utils.ts` `openMailto` |
| WhatsApp provider | **None API** — browser `wa.me` deep link | `src/utils.ts` `openWhatsApp` |
| Jobs / cron | **None** | No cron config, no Edge Functions, no workers |
| Webhooks | **None** | No webhook routes |
| Tests | **None** | No vitest/jest/playwright; only `npm run build` |
| Edge / serverless functions | **Not used** | No `supabase/functions`, no Vercel `api/` |

Dependencies (`package.json`):

- `@supabase/supabase-js` ^2.110.2
- `vite` ^8.1.1, `typescript` ~6.0.2

### 1.2 System shape

```
Browser (Vite SPA: main.ts)
    │
    ├─ Supabase Auth (GoTrue) — session JWT
    ├─ Supabase JS client — CRUD on cq_* tables (RLS)
    │
    └─ User device only for “sending”:
           mailto: → local mail client
           wa.me  → WhatsApp Web/app
```

There is **no server that can send email or WhatsApp on a schedule**. Reminder “send” is: open a client app, then write a log row and bump a counter.

### 1.3 Key files

| Path | Role |
|------|------|
| `src/main.ts` | Entire UI shell: landing, auth, dashboard, sequences, settings, CSV import, feedback; all event handlers |
| `src/types.ts` | `Invoice`, `ReminderStep`, `DEFAULT_SEQUENCE` |
| `src/utils.ts` | Money/date helpers, template render, schedule readiness, `mailto` / `wa.me` |
| `src/lib/supabase.ts` | Client init from `VITE_SUPABASE_*` (anon/publishable key only) |
| `src/lib/db.ts` | Invoice/settings/log/feedback CRUD + CSV export |
| `src/lib/csv-import.ts` | Bulk invoice parse/import |
| `src/lib/auth-errors.ts` | Humanized auth errors |
| `supabase/schema.sql` | Tables, RLS, profile trigger |
| `supabase/migration_freelancer.sql` | `client_phone`, `currency`, `locale` |
| `supabase/migration_feedback.sql` | Feedback table (also folded into schema.sql) |
| `vercel.json` | SPA rewrite only |
| `.env.example` / `.env.production.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `AUTH_SETUP.md` | Notes on confirm-email / SMTP rate limits |
| `../07_final/ARCHITECTURE_AND_BUSINESS.md` | Product + intended v2 roadmap (Resend, cron) |

### 1.4 Data model (current)

**No separate clients/customers table.** Client fields live on each invoice row.

**`cq_profiles`** (1:1 with `auth.users`)

- `user_id`, `business_name`, `sender_name`, `sender_email`
- `currency`, `locale` (migration)
- `sequence` **jsonb** — array of reminder steps (templates), not per-invoice jobs

**`cq_invoices`**

- `id`, `user_id`
- `client_name`, `client_email`, `client_phone` (optional)
- `amount` numeric, `invoice_number` (unique per user)
- `issued_at` **date**, `due_at` **date**
- `status` text: `pending` | `due_soon` | `overdue` | `paid`
- `payment_link`, `notes`
- `reminders_sent` integer (sequence cursor)
- `paid_at` date
- **No** invoice PDF/attachment storage
- **No** currency on invoice (currency is profile-level)
- **No** automation / pause / dispute fields

**`cq_reminder_logs`**

- `id`, `user_id`, `invoice_id`, `step_id`
- `subject`, `body`, `preview`, `sent_at`
- `delivery_status`: `logged` | `mailto` | `sent` | `failed`
- Insert-only for authenticated owners (RLS); **no update/delete policies** (but not append-only at DB level for service role)
- **Not immutable:** app could delete invoice → cascades logs; no hash chain; full body stored in cleartext

**`cq_feedback`** — product feedback; unrelated to collections.

### 1.5 Authentication & multi-tenant security

- Email/password via Supabase Auth.
- RLS on `cq_profiles`, `cq_invoices`, `cq_reminder_logs`, `cq_feedback`: users only touch `auth.uid() = user_id` rows.
- Client uses **anon/publishable key only** (`src/lib/supabase.ts`). Service role is never referenced in app code.
- New users get a profile via trigger `cq_on_auth_user_created`.

### 1.6 Environment conventions

- Build-time Vite injection: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (aliases `SUPABASE_URL` / `SUPABASE_KEY` in `vite.config.ts`).
- Root `Run/.env` can supply keys for local dev; production expects Vercel env or `.env.production`.
- **No** `RESEND_API_KEY`, SMTP, webhook secrets, or cron secrets today.

### 1.7 Deployment

- Static Vite build → Vercel project `collectquiet`.
- `vercel.json` rewrites all routes to `index.html`.
- No serverless functions, no cron entries, no Edge config.

---

## 2. Current invoice workflow

End-to-end as implemented today:

1. **Sign up / sign in** (`main.ts` → Supabase Auth).
2. **Optional settings** (`settings` view → `saveSettings`): business name, sender name/email, USD/INR, reminder sequence stored on profile.
3. **Create invoice** (modal or CSV import):
   - Fields: client name, email, optional phone, invoice #, amount, issued/due dates, optional payment link, optional notes.
   - Insert via `createInvoice` → `cq_invoices`, `reminders_sent = 0`, status computed client-side (`computeStatus`).
4. **Dashboard** shows invoices; “due today” queue uses `invoicesReadyToday` / `readyReminder`:
   - Next step = `sequence[reminders_sent]` when `daysOverdue(due_at) >= step.dayOffset`.
5. **Preview** next template via `renderTemplate` (placeholders: client, amount, due date, sender, payment link).
6. **Manual send — Email:**
   - `openMailto(clientEmail, subject, body)` opens the user’s mail client.
   - Immediately `createReminderLog` with `delivery_status: 'mailto'`.
   - `updateInvoice` increments `reminders_sent`.
   - **No proof the email was actually sent** (user can cancel the mail client).
7. **Manual send — WhatsApp:**
   - Requires `client_phone`.
   - `openWhatsApp` opens `https://wa.me/{digits}?text=...`.
   - Log with `delivery_status: 'sent'` (optimistic — also no delivery proof).
   - Increment `reminders_sent`.
8. **Mark paid** → `status = paid`, `paid_at = today`. UI stops offering remind buttons; schedule helpers return null for paid invoices. **Does not cancel any server jobs** (none exist).
9. **Audit:** dashboard “Reminder log” lists recent `cq_reminder_logs`; CSV export includes invoices + log lines.

There is **no** activate-automation step, **no** per-step send time, **no** reply handling, **no** automatic send.

---

## 3. Gaps preventing automation

| Requirement | Gap |
|-------------|-----|
| **Scheduled sending** | No worker, cron, or job table. Sequence only has `dayOffset` (day granularity), not datetime/timezone. |
| **Reliable retries** | No provider send; no retry queue; mailto/wa are fire-and-forget UI opens. |
| **Duplicate prevention** | Only soft cursor `reminders_sent`. No idempotency key. Double-click can log twice. Race across tabs possible. |
| **Reply detection** | No inbound email, no mailbox OAuth, no WhatsApp webhooks. |
| **Payment stopping** | Manual mark-paid only. No payment-provider webhook. No auto-cancel of scheduled steps. |
| **Dispute handling** | No dispute state, pause reason, or escalation workflow. |
| **User notification** | No in-app alerts for “reply received / send failed / needs judgment.” Toast only for local actions. |
| **Auditability** | Log exists but: (a) written before proven delivery, (b) stores full body, (c) not append-only/immutable, (d) cascade-deletes with invoice. |
| **Multi-tenant security for automation** | RLS is good for client CRUD. Automation needs **service-role** worker + careful invoice scoping; that path does not exist yet. Webhook auth does not exist. |
| **Channel automation** | Email needs a transactional provider. WhatsApp needs Business API (Meta) — far larger lift than email. |
| **Attachments** | No storage for invoice PDFs; cannot attach file to outbound mail. |
| **Per-invoice sequence override** | Sequence is profile-global JSONB; cannot customize dates/times/tone/channel per invoice. |
| **Feature flags / dry-run** | Not implemented. |

---

## 4. Recommended architecture (fits current stack)

Stay on **Vite SPA + Supabase Postgres + Vercel**. Add the minimum server surface required for sending and scheduling. Do **not** introduce a new cloud (AWS/GCP) unless later scale demands it.

### 4.1 Principles

- **Postgres is source of truth** for invoices, automations, reminder jobs, events, audit.
- **One recurring worker** polls due jobs (not one cron per invoice).
- **Atomic claim** of jobs (`FOR UPDATE SKIP LOCKED` or `UPDATE … WHERE status='pending' AND scheduled_at <= now() RETURNING`).
- **Idempotency keys** on outbound sends and webhook processing.
- **Provider webhooks** for delivery + inbound reply.
- **Collections state machine** on automation + invoice.
- **Store all schedule times in UTC**; display in user timezone.
- **Feature flags** (e.g. `collections_automation_enabled`, `dry_run_sends`).
- **Dry-run mode**: worker renders and writes audit “would_send” without calling provider.

### 4.2 Target runtime diagram

```
[Browser SPA]
   │ RLS (anon key)
   ▼
[Supabase Postgres]  ←── source of truth
   ▲
   │ service role (server only)
   │
[Vercel Cron every 1–5 min]
   → POST /api/collections/tick  (Vercel Serverless)
        claim due reminder_jobs
        if dry_run → audit only
        else Resend send (+ idempotency key)
        update job + automation state
        write immutable audit_events

[Resend webhooks]
   → POST /api/webhooks/resend
        verify signature
        dedupe by provider event id
        delivery failure / bounce → pause + notify user

[Inbound email webhook] (Resend Inbound or similar)
   → POST /api/webhooks/inbound-email
        match reply-to token → invoice/automation
        classify: reply / bounce / auto-reply
        meaningful reply → pause future jobs
        audit + notify user (“human judgment”)
```

### 4.3 Why this fits

- Already hosted on Vercel → Cron + Serverless is first-class.
- Already on Supabase → keep RLS for user UI; worker uses service role with explicit `user_id` filters.
- Architecture doc already planned Resend + cron (`ARCHITECTURE_AND_BUSINESS.md` §3.4).
- Avoids Gmail/Outlook OAuth complexity for MVP.

### 4.4 WhatsApp in this architecture

Keep **manual WhatsApp** as today for MVP automation. Automated WhatsApp requires Meta Business API, templates, and compliance — phase later. Automation MVP = **email channel only**, with UI still allowing manual WA beside automation.

---

## 5. Scheduler decision

### 5.1 Options inside current stack

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **A. Vercel Cron → Vercel Serverless** | `vercel.json` crons → `/api/collections/tick` | Native to current host; easy secrets; 1–5 min cadence | Needs converting project from pure static to hybrid; function timeouts |
| **B. Supabase `pg_cron` + Edge Function** | Schedule HTTP call to Edge Function | Close to DB; good for SQL claim | Edge Function cold starts; secret management; less familiar deploy path today (no functions dir) |
| **C. Supabase Database Webhooks only** | React to row changes | Not a scheduler | Cannot wake “at 09:00 user local” without a clock |
| **D. Client-side timers** | Browser `setTimeout` | Easy | Unreliable; user must keep tab open — **reject** |

### 5.2 Choice: **Option A — Vercel Cron + Serverless tick**

**Why:** CollectQuiet already deploys on Vercel; cron cadence of **every 1 minute** (or 5 minutes MVP) respects user-selected reminder times without per-invoice crons; one worker claims many due rows; secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`) stay off the client.

**Companion:** Optional Supabase Edge Function later if tick logic should move next to Postgres; not required for MVP.

**Not chosen:** One cron per invoice (forbidden by product requirements and operationally unsafe).

---

## 6. Email and reply-detection decision

### 6.1 Options

| | Option A: Provider outbound + inbound | Option B: User mailbox OAuth |
|--|--------------------------------------|------------------------------|
| Send | Resend/Postmark from CollectQuiet domain (or verified domain) | Gmail/Outlook as user |
| Reply detect | Unique `Reply-To` / plus-address per automation; inbound webhook | Thread watch + push notifications |
| Existing support in app | **None** | **None** |
| MVP complexity | Medium | High (OAuth, refresh tokens, Google/Microsoft verification) |

### 6.2 Choice: **Option A — Resend (or Postmark) + unique Reply-To + inbound webhook**

**Why:** No mailbox OAuth exists; product already anticipated Resend; simpler ops; provider event IDs for dedupe; threading via `Message-ID` / `In-Reply-To` / `References`.

**MVP reply-to scheme (example):**

`cq+{automation_id_or_token}@{inbound-domain}`

Map token → `user_id` + `invoice_id` + `automation_id` in DB. On inbound:

1. Verify webhook signature  
2. Ignore auto-responders where detectable  
3. On human-looking reply → set automation `paused_by_reply`, cancel pending jobs, audit, notify owner  

**Outbound provider recommendation:** **Resend** (docs familiarity in roadmap, simple API, inbound available). Postmark is an equivalent alternative.

**Not chosen for MVP:** Gmail/Outlook OAuth (Option B), unless a later enterprise requirement forces “send as me.”

---

## 7. Data model proposal

### 7.1 Enums

```text
invoice_collection_status:
  open | collecting | paused | paid | disputed | written_off | completed

automation_status:
  draft | armed | active | paused | stopped | completed | failed

reminder_job_status:
  pending | claimed | sending | sent | failed | canceled | skipped_dry_run

channel:
  email | whatsapp_manual   -- whatsapp_api later

pause_reason:
  client_reply | payment_promise | dispute | marked_paid | delivery_failure | user_paused | dry_run_stop

inbound_classification:
  human_reply | auto_reply | bounce | payment_claim | dispute | unknown

audit_actor:
  user | system | provider_webhook | worker
```

### 7.2 New / extended tables

**Extend `cq_profiles`**

- `timezone` text not null default `'UTC'`
- `feature_flags` jsonb default `{}`  
  e.g. `{ "collections_automation": true, "dry_run_sends": true }`

**Extend `cq_invoices`**

- `collection_status` text (enum above), default `open`
- `currency` text null (fallback to profile)
- `paused_at` timestamptz null
- `pause_reason` text null
- Keep existing fields; do not remove manual `reminders_sent` until migration complete (dual-run or backfill).

**Optional later:** `cq_clients` — normalize clients; **not required for MVP** if invoice still denormalizes client fields.

**`cq_collection_automations`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK | RLS |
| invoice_id | uuid FK | unique active automation per invoice (partial unique) |
| status | text | automation_status |
| channel | text | email for MVP |
| timezone | text | snapshot of user TZ at activation |
| activated_at | timestamptz | |
| paused_at | timestamptz | |
| pause_reason | text | |
| stopped_at | timestamptz | |
| dry_run | boolean | default from flag |
| reply_to_token | text unique | inbound routing |
| created_at / updated_at | timestamptz | |

**`cq_reminder_steps`** (per automation, frozen at activate)

| Column | Type |
|--------|------|
| id | uuid PK |
| automation_id | uuid FK |
| position | int |
| tone | text |
| subject_template | text |
| body_template | text |
| channel | text |
| scheduled_at_utc | timestamptz |
| status | text (pending/sent/canceled/…) |

**`cq_reminder_jobs`** (executable units claimed by worker)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid | denormalized for claim filters |
| automation_id | uuid | |
| step_id | uuid | |
| invoice_id | uuid | |
| status | text | |
| scheduled_at_utc | timestamptz | index |
| claimed_at | timestamptz | |
| claim_token | uuid | |
| attempt_count | int | |
| next_attempt_at | timestamptz | |
| idempotency_key | text **unique** | e.g. `{automation_id}:{step_id}:v1` |
| provider_message_id | text | |
| last_error | text | |
| sent_at | timestamptz | |

Indexes:

- `(status, scheduled_at_utc)` where status in (`pending`, `failed`)  
- `(invoice_id)`  
- unique `(idempotency_key)`

**`cq_inbound_messages`**

| Column | Type |
|--------|------|
| id | uuid PK |
| user_id | uuid |
| invoice_id | uuid null |
| automation_id | uuid null |
| provider | text |
| provider_event_id | text **unique** |
| from_email | text |
| subject | text |
| body_text | text (truncated / limited retention) |
| classification | text |
| received_at | timestamptz |
| raw_storage_ref | text null |

**`cq_provider_events`** (delivery webhooks)

| Column | Type |
|--------|------|
| id | uuid PK |
| provider | text |
| provider_event_id | text **unique** |
| type | text |
| payload_hash | text |
| processed_at | timestamptz |
| job_id | uuid null |

**`cq_audit_events`** (append-oriented timeline)

| Column | Type |
|--------|------|
| id | uuid PK |
| user_id | uuid |
| invoice_id | uuid null |
| automation_id | uuid null |
| actor | text |
| event_type | text |
| summary | text |
| metadata | jsonb (no full secrets; minimize PII) |
| created_at | timestamptz |

RLS: users **select** own audit rows; **insert** only via service role / security definer function (not from anon client for system events).

**`cq_user_notifications`**

- id, user_id, invoice_id, kind, title, body, read_at, created_at  
- Kinds: `reply_received`, `send_failed`, `automation_paused`, `needs_judgment`

### 7.3 Relationships

```
auth.users 1—1 cq_profiles
auth.users 1—* cq_invoices
cq_invoices 1—0..1 active cq_collection_automations
cq_collection_automations 1—* cq_reminder_steps
cq_reminder_steps 1—0..1 cq_reminder_jobs
cq_invoices 1—* cq_audit_events
cq_invoices 1—* cq_inbound_messages
```

---

## 8. State-transition diagram

### 8.1 Invoice `collection_status`

```
open → collecting          (automation activated)
collecting → paused        (reply, dispute, delivery failure, user pause, promise)
paused → collecting        (user resume)
collecting|paused → paid   (mark paid / payment detected)
collecting|paused → disputed
disputed → paused|paid|written_off
* → completed              (sequence finished unpaid — optional)
any non-terminal → written_off (user)
```

**Invariant:** `paid` / `written_off` / `completed` cancel all `pending`/`claimed` jobs.

### 8.2 Collection automation

```
draft → armed              (user reviewed sequence)
armed → active             (user activates; jobs materialized)
active → paused            (reply / dispute / failure / user)
paused → active            (resume — only future pending steps)
active|paused → stopped    (user stop or paid)
active → completed         (all steps sent, no pause)
active|paused → failed     (unrecoverable config/provider)
```

### 8.3 Reminder step / job

```
step pending → job pending
job pending → claimed → sending → sent
sending → failed → pending (retry with backoff) | canceled
any → canceled             (paid, pause, stop, dispute)
pending → skipped_dry_run  (dry-run tick)
```

**Invariant:** At most one successful `sent` per `idempotency_key`.

### 8.4 Inbound reply

```
received → classified
classified(human_reply|dispute|payment_claim) → automation paused + notify user
classified(auto_reply) → audit only (no pause) [configurable]
classified(bounce) → pause + delivery_failure + notify
```

### 8.5 Payment

```
user marks paid OR payment webhook → invoice paid
  → cancel jobs
  → automation stopped
  → audit payment_recorded
```

### 8.6 Payment promise (MVP-light)

```
user tags “promised by DATE” → pause until DATE
  → job: resume_check at DATE
  → if still unpaid → reactivate collecting
```

### 8.7 Dispute

```
inbound dispute OR user marks dispute
  → automation paused (pause_reason=dispute)
  → notify user (human judgment)
  → no further sends until explicit resume or paid
```

---

## 9. Security risks

| Risk | Mitigation |
|------|------------|
| **Cross-tenant data access** | Keep RLS for SPA; worker always filters by `user_id` from job row; never trust client-supplied user id for sends. |
| **Webhook forgery** | Verify Resend (or provider) signatures; reject missing/invalid; use separate webhook secrets. |
| **Leaked provider secrets** | Service role + Resend keys only on Vercel/server; never `VITE_*`. |
| **Duplicate webhook delivery** | Unique `provider_event_id`; upsert-ignore. |
| **Replay attacks** | Timestamp tolerance on signatures; store processed event ids. |
| **Malicious email content** | Sanitize/escape in UI; store truncated text; never `innerHTML` raw email HTML. |
| **Prompt injection via replies** | If any LLM used later, treat inbound as untrusted data; for MVP, **no LLM** on replies — rules/heuristics only. |
| **Incorrect invoice matching** | Prefer opaque `reply_to_token` over parsing subject lines; fallback match only with high confidence. |
| **Reminders after payment** | Transaction: mark paid → cancel jobs in same DB transaction; worker re-checks invoice status after claim before send. |
| **Logging sensitive content** | Audit `summary` + metadata; avoid storing full bodies long-term; redact payment details. |
| **Unauthorized activation** | Activate only as authenticated owner via RLS; confirm UI gate; optional re-auth for activate. |
| **Cron endpoint abuse** | `CRON_SECRET` / Vercel cron header check on `/api/collections/tick`. |
| **Idempotent double-send** | Unique idempotency key enforced in DB + provider idempotency header. |

---

## 10. Implementation phases (expected files)

### Phase 0 — Foundations (schema + flags)

**Create**

- `supabase/migrations/YYYYMMDD_collections_automation.sql`
- `docs/collections-automation-audit.md` (this file)
- `src/types/collections.ts` (enums/types)

**Change**

- `supabase/schema.sql` (mirror)
- `src/lib/db.ts` (read flags / timezone)
- `.env.example`, `.env.production.example` (document future server vars)
- `AUTH_SETUP.md` or new `COLLECTIONS_SETUP.md`

### Phase 1 — Job model + activate UI (no real send)

**Create**

- `src/lib/collections/state-machine.ts`
- `src/lib/collections/schedule.ts` (local TZ → UTC)
- UI pieces in `src/main.ts` (or split modules): review sequence, activate, dry-run badge

**Change**

- `cq_*` inserts for automations/steps/jobs on activate
- Dashboard: automation status, pause/stop

### Phase 2 — Scheduler worker (dry-run first)

**Create**

- `api/collections/tick.ts` (Vercel Serverless)
- `api/_lib/supabaseAdmin.ts`
- `api/_lib/claimJobs.ts`
- `vercel.json` crons section

**Change**

- Feature flag `dry_run_sends=true` default on  
- Write `cq_audit_events` for would_send

### Phase 3 — Outbound email (Resend)

**Create**

- `api/_lib/email/resend.ts`
- Env: `RESEND_API_KEY`, `EMAIL_FROM`, `INBOUND_DOMAIN`

**Change**

- Tick sends when dry-run off  
- Idempotency keys  
- Update job status / provider ids

### Phase 4 — Webhooks (delivery + inbound)

**Create**

- `api/webhooks/resend.ts`
- `api/webhooks/inbound-email.ts`
- `src/lib/collections/classifyInbound.ts` (heuristic, no LLM)

**Change**

- Pause on reply/bounce  
- `cq_user_notifications` + dashboard banner

### Phase 5 — Payment stop + dispute UX

**Change**

- `markPaid` cancels jobs transactionally (RPC)
- Dispute / pause / resume controls
- Immutable-ish audit timeline UI

### Phase 6 — Hardening

**Create**

- `api/collections/tick.test.ts` or vitest unit tests for claim/idempotency/state machine  
- Runbook in `docs/collections-runbook.md`

**Change**

- Retention policy for email bodies  
- Metrics / basic alerting

**Explicitly deferred**

- WhatsApp Business API automation  
- Gmail/Outlook OAuth  
- Invoice PDF attachments in object storage  
- Full LLM reply classification  

---

## End report

| Item | Result |
|------|--------|
| **Current stack** | Vite 8 + TypeScript SPA (vanilla), Supabase Auth + Postgres + RLS, Vercel static hosting, `@supabase/supabase-js` only. **No** backend framework, **no** ORM, **no** tests, **no** Edge Functions. |
| **Chosen scheduler** | **Vercel Cron → `/api/collections/tick` Serverless**, claiming due rows from Postgres (1–5 min). Not per-invoice crons. |
| **Chosen outbound provider** | **Resend** (Postmark acceptable equivalent). |
| **Chosen inbound-reply method** | **Option A:** unique Reply-To token + inbound email webhook + provider event dedupe. Not mailbox OAuth for MVP. |
| **Major risks** | (1) Today’s “sent” is not real delivery; (2) Auth/email confirmation already fragile without custom SMTP; (3) Double-send without idempotent jobs; (4) Accidental chase after payment without transactional cancel; (5) Webhook forgery if unsigned; (6) Storing full email bodies; (7) Scope creep into full invoicing/WhatsApp API. |
| **Genuinely blocking information** | **None blocking design.** Must confirm before Phase 3: (a) Resend account + domain verification readiness; (b) whether sends should appear from CollectQuiet domain vs user’s domain; (c) Vercel plan supports cron at desired frequency; (d) product decision that MVP automation is **email-only**. Auth SMTP for password reset is a separate production concern already documented in `AUTH_SETUP.md`. |

### Fields already stored vs missing

| Field | Stored? |
|-------|---------|
| Client email | Yes (`cq_invoices.client_email`) |
| Client phone | Yes (`client_phone`, optional) |
| Invoice amount | Yes |
| Due date | Yes (`date`, not timestamptz) |
| Currency | Profile-level only (`cq_profiles.currency`), not per invoice |
| Invoice attachment | **No** |

### Manual channels today

- **Email:** `mailto:` via `src/utils.ts` → `sendReminder` in `src/main.ts`  
- **WhatsApp:** `wa.me` same path  
- **Providers in use:** none (no Resend/Gmail SMTP/SendGrid in code)

---

*End of audit. Stop here — no application code changes in this phase.*

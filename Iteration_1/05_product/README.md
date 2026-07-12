# CollectQuiet — Production Setup

## Prerequisites
- Node.js 18+
- Supabase project (schema applied via `collectquiet_initial_schema` migration)

## Environment

CollectQuiet reads Supabase config from the **repo root** `Run/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_KEY=sb_publishable_...
```

Get both from Supabase Dashboard → **Settings → API**.

### New Supabase project setup

1. Paste `supabase/schema.sql` into **SQL Editor** and run it.
2. Enable **Email** auth provider (Authentication → Providers).
3. Add `SUPABASE_URL` + `SUPABASE_KEY` to `Run/.env`.
4. Restart dev server.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Production build

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to any static host (Vercel, Netlify, Cloudflare Pages). Set the same `VITE_*` env vars at build time.

## Supabase tables
- `cq_profiles` — business settings + reminder sequence (RLS per user)
- `cq_invoices` — invoice tracker (unique invoice number per user)
- `cq_reminder_logs` — audit trail of every reminder

New users get a profile row automatically via `cq_on_auth_user_created` trigger.

## Auth
Email + password via Supabase Auth. Dashboard, Sequences, and Settings require sign-in.

## Reminder delivery (v1)
"Send via email" opens the user's default mail client (`mailto:`) with pre-filled subject/body, and logs the reminder to Supabase. Server-side SMTP (Resend/Postmark) can be added as a Supabase Edge Function later.

## Bugs fixed in production pass
- XSS: all user-rendered fields escaped
- Modal: clicks inside dialog no longer close the modal
- Auth gate on protected views
- Duplicate invoice numbers blocked (DB unique constraint)
- Due date validation (must be ≥ issue date)
- Preview shows "sequence complete" when all steps sent
- Removed demo-only localStorage seed data
- CSV export properly quoted

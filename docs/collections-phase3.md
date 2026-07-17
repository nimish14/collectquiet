# Collections automation — Phase 3 (scheduler)

## Architecture

```
Vercel Cron (every 5 min)
  POST /api/collections/tick
    Authorization: Bearer $CRON_SECRET
      → CollectionsWorker.tick()
          → cq_claim_due_reminder_steps()  -- FOR UPDATE SKIP LOCKED
          → re-check invoice/automation
          → MessageSender (dry-run / recording / future Resend)
          → cq_collection_events + next_action_at
```

One recurring cron. Not one job per invoice.

## Securing the endpoint

- `CRON_SECRET` required; compare `Authorization: Bearer …` or `x-cron-secret`
- `SUPABASE_SERVICE_ROLE_KEY` only on the server (never `VITE_*`)
- `Cache-Control: no-store`
- JSON summary only (no message bodies)
- Feature flags: `COLLECTION_AUTOMATION_ENABLED` (default false), `COLLECTION_AUTOMATION_DRY_RUN` (default true)

## Atomic claim

Postgres function `cq_claim_due_reminder_steps(limit, ttl, now)`:

1. Requeue expired `processing` claims
2. Select due rows with joins (active automation, open/collecting invoice, no unresolved inbound attention)
3. `FOR UPDATE SKIP LOCKED` + set `processing` + claim expiry

## Local dry-run

```bash
cd Iteration_1/05_product/collectquiet
npm run collections:dry-run
```

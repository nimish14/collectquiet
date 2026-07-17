# Collections runbook

## Pilot stages (do not skip)

| Stage | Goal | Flags |
|-------|------|--------|
| **1 Local** | Mocked provider, FakeClock | `ENABLED=false` in prod; `npm test` / `collections:dry-run` locally |
| **2 Staging dry run** | Real cron + claim + timelines, no external mail | `ENABLED=true` `DRY_RUN=true` `EMAIL_SENDING=false` `ALLOWLIST=*` (staging only) |
| **3 Internal email** | Real send/reply to internal addresses only | `DRY_RUN=false` `EMAIL_SENDING=true` `REPLY_DETECTION=true` `OUTBOUND_RECIPIENT_ALLOWLIST=qa@…` `ALLOWLIST=<founder uuid>` |
| **4 Founder pilot** | Founder account, low-value invoices | Allowlist = founder UUID; remove recipient allowlist; monitor every send |
| **5 Limited users** | Small allowlist | Allowlist = UUIDs; firm approval required; alerts on |

**Never** set `ALLOWLIST=*` with `EMAIL_SENDING=true` in production.

## Day-2 operations

1. Confirm scheduler: Vercel Hobby runs tick once daily (`0 9 * * *`); for frequent sends use an external cron every 5 minutes against `/api/collections/tick` with `CRON_SECRET`. Look for `scheduler_ticks` / `tick_complete` logs.
2. Watch `collections-alerts` JSON lines (see [collections-incident-response.md](./collections-incident-response.md)).
3. Needs Attention inbox for disputes, promises, unmatched replies.
4. After each founder send: verify timeline shows `reminder_sent` once; no duplicate.

## Rollback (immediate)

1. Set `COLLECTION_AUTOMATION_ENABLED=false` on Vercel → Redeploy or env sync.
2. Optionally set `COLLECTION_EMAIL_SENDING_ENABLED=false` and `COLLECTION_AUTOMATION_DRY_RUN=true`.
3. Set `COLLECTION_REPLY_DETECTION_ENABLED=false` to ignore inbound processing.
4. Clear or tighten `COLLECTION_AUTOMATION_ALLOWLIST`.
5. Confirm tick returns `enabled: false` / `worker_disabled` logs.
6. Existing active automations stop claiming sends while disabled; cancel noisy ones via UI if needed.

## Safe enable checklist

- [ ] Allowlist contains only intended UUIDs
- [ ] Dry-run false only after Stage 2 verified
- [ ] Resend domain + webhook secrets configured
- [ ] CRON_SECRET set
- [ ] Alerts drain connected
- [ ] Founder on-call for Stage 4

# Collections incident response

## Alert codes

Structured logs: `{"svc":"collections-alerts","event":"operational_alert","code":…}`.

| Code | Meaning | Immediate action |
|------|---------|------------------|
| `scheduler_stale` | No tick heartbeat beyond threshold | Check Vercel cron + `CRON_SECRET`; hit tick manually |
| `repeated_worker_failure` | Multiple failed jobs in a tick | Inspect `tick_failed` / `step_error`; consider disable |
| `webhook_signature_failure` | Bad Svix / payment secret | Rotate secrets; block attacker IPs if needed |
| `bounce_spike` | High bounce ratio | Pause sending (`EMAIL_SENDING=false`); audit recipients |
| `stuck_processing_lease` | Claims stuck past TTL | Confirm claim recovery path; check DB locks |
| `duplicate_send_prevented` | Idempotency gate fired | Verify no customer-visible duplicate; review race |
| `reply_webhook_unavailable` | Inbound disabled/misconfigured | Fix flag/secret; replies won't pause until restored |
| `provider_authorization_revoked` | Resend unauthorized | Rotate API key; set `EMAIL_SENDING=false` |

## Severity

- **critical** — disable sending or automation until fixed
- **warning** — investigate within the pilot watch window

## Rollback

1. `COLLECTION_AUTOMATION_ENABLED=false`
2. `COLLECTION_EMAIL_SENDING_ENABLED=false`
3. `COLLECTION_AUTOMATION_DRY_RUN=true`
4. Optionally `COLLECTION_REPLY_DETECTION_ENABLED=false`
5. Redeploy / sync env
6. Verify logs show `worker_disabled`
7. Notify allowlisted users if mid-pilot

## Triage checklist

1. Correlation ID from tick / webhook log
2. Invoice + automation status in Supabase (`cq_collection_automations`, `cq_reminder_steps`)
3. Timeline (`cq_collection_events`) — do **not** dump email bodies into chat/logs
4. Needs Attention notifications
5. Resend dashboard for provider-side delivery

## Communication

During founder / limited pilot: message affected users manually. Do not auto-blast status emails from the worker.

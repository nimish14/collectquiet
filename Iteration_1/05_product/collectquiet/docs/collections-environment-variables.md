# Collections environment variables

Safe defaults keep **general production access off**.

## Feature flags (Prompt 8)

| Variable | Default | Purpose |
|----------|---------|---------|
| `COLLECTION_AUTOMATION_ENABLED` | `false` | Master switch for worker + mutating automation API |
| `COLLECTION_AUTOMATION_DRY_RUN` | `true` | Claim/schedule/timeline without provider send |
| `COLLECTION_EMAIL_SENDING_ENABLED` | `false` | Allow real provider send when dry-run is false |
| `COLLECTION_REPLY_DETECTION_ENABLED` | `false` | Process `/api/webhooks/resend-inbound` |
| `COLLECTION_PAYMENT_WEBHOOK_ENABLED` | `false` | Process `/api/webhooks/payment` (mock adapter) |
| `COLLECTION_AUTOMATION_ALLOWLIST` | _(empty)_ | Comma-separated user UUIDs and/or emails. Empty = **deny all**. `*` or `all` = allow all (**staging only**) |
| `COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST` | _(empty)_ | Optional Stage 3 filter: only these recipient emails may receive real mail |

Boolean parsing: `1/true/yes/on` = true; `0/false/no/off` = false; unset = default.

## Worker tuning

| Variable | Default |
|----------|---------|
| `COLLECTION_WORKER_BATCH_SIZE` | `25` |
| `COLLECTION_CLAIM_TTL_SECONDS` | `300` |
| `COLLECTION_MAX_ATTEMPTS` | `3` |
| `COLLECTION_BASE_BACKOFF_SECONDS` | `60` |

## Auth / infra

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Protects `POST /api/collections/tick` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker / webhooks |
| `VITE_SUPABASE_ANON_KEY` | Browser + JWT validation |

## Email (Resend)

| Variable | Purpose |
|----------|---------|
| `COLLECTION_EMAIL_PROVIDER` | Must be `resend` or unset |
| `RESEND_API_KEY` | Outbound (required only when sending enabled) |
| `RESEND_WEBHOOK_SECRET` | Svix verify for delivery + inbound |
| `COLLECTION_EMAIL_FROM` | From address on verified domain |
| `COLLECTION_INBOUND_DOMAIN` | Reply-To domain (`cq+{token}@…`) |
| `COLLECTION_USE_RECORDING_SENDER` | Force mock sender in tick |
| `COLLECTION_DEFAULT_SENDER_NAME` | Fallback display name |
| `COLLECTION_PAYMENT_WEBHOOK_SECRET` | Header secret for mock payment route |

## Example — Stage 4 founder pilot

```bash
COLLECTION_AUTOMATION_ENABLED=true
COLLECTION_AUTOMATION_DRY_RUN=false
COLLECTION_EMAIL_SENDING_ENABLED=true
COLLECTION_REPLY_DETECTION_ENABLED=true
COLLECTION_PAYMENT_WEBHOOK_ENABLED=false
COLLECTION_AUTOMATION_ALLOWLIST=11111111-1111-1111-1111-111111111111
# leave OUTBOUND_RECIPIENT_ALLOWLIST empty for real clients (founder only via user allowlist)
```

## Example — production locked

```bash
COLLECTION_AUTOMATION_ENABLED=false
COLLECTION_AUTOMATION_DRY_RUN=true
COLLECTION_EMAIL_SENDING_ENABLED=false
COLLECTION_REPLY_DETECTION_ENABLED=false
COLLECTION_PAYMENT_WEBHOOK_ENABLED=false
# ALLOWLIST unset
```

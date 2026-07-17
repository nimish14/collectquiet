# Collections testing

## Stage 1 — local (default CI)

```bash
cd Iteration_1/05_product/collectquiet
npm run typecheck
npm test
npm run build
```

Provider is mocked (`RecordingMessageSender` / `MockEmailProvider`). `FakeClock` freezes worker time. No external network.

### Key suites

| File | Coverage |
|------|----------|
| `service.test.ts` | Activate / pause / resume / tenant isolation |
| `worker.test.ts` | Claim, send-once, retry, dry-run, attention skip |
| `inbound.test.ts` | Match, classify, duplicate webhook, race with send |
| `email.test.ts` | Compose, Resend mock, bounce, safety |
| `payment.test.ts` | Mark paid, races, mock payment webhook |
| `automation-ux.test.ts` | UI helpers / modals / Needs Attention |
| `pilot.e2e.test.ts` | Prompt 8 E2E scenarios + flags + alerts |

### Pilot E2E scenarios (automated)

- Happy path (3 reminders → send once → promise → pause → approve → mark paid → cancel rest → timeline)
- Payment before reminder
- Reply before reminder
- Duplicate workers
- Duplicate inbound webhook
- Provider timeout → retry → exhaustion → Needs Attention
- Dispute → pause + attention
- Opt-out → suppress contact
- Allowlist deny
- Tenant isolation

Local dry-run script (memory store):

```bash
npm run collections:dry-run
```

## Stage 2 — staging dry run

1. Deploy preview/staging with:
   - `COLLECTION_AUTOMATION_ENABLED=true`
   - `COLLECTION_AUTOMATION_DRY_RUN=true`
   - `COLLECTION_EMAIL_SENDING_ENABLED=false`
   - `COLLECTION_AUTOMATION_ALLOWLIST=*` (staging project only)
2. Activate automation for a test invoice.
3. Force a due step (or wait for schedule).
4. Confirm cron tick logs `reminder_dry_run`, timelines update, **no** Resend messages.

## Stage 3 — internal email

1. `DRY_RUN=false` `EMAIL_SENDING=true` `REPLY_DETECTION=true`
2. `COLLECTION_OUTBOUND_RECIPIENT_ALLOWLIST=your-qa@…`
3. Allowlist founder UUID
4. Send real mail only to allowlisted recipients; reply to inbound address; confirm pause.

## Stage 4 / 5

See [collections-runbook.md](./collections-runbook.md). Keep firm-approval on. Do not expand allowlist without monitoring.

## Definition of done (test evidence)

| Requirement | Evidence |
|-------------|----------|
| Activate once | service + pilot happy path |
| Due emails without user action | worker tick |
| No double send | duplicate worker tests |
| Reply pauses | inbound + pilot |
| Paid blocks send | payment + pilot |
| Disputes need human | pilot dispute |
| Timeline events | pilot happy path |
| Safe retry | worker + pilot outage |
| Tenant isolation | service + pilot |
| Allowlist rollout | flags tests + worker allowlist skip |
| Rollback procedure | runbook / incident-response docs |

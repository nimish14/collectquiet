# Collections Phase 8 — Controlled rollout

General production access is **not** enabled. Defaults deny all users and suppress sending.

## What shipped

- Feature flags + allowlist (`src/collections/flags.ts`)
- Worker / API / webhook gates
- Metrics + operational alerts (no email bodies in logs)
- Pilot E2E suite (`pilot.e2e.test.ts`)
- Ops docs (architecture, state machine, runbook, testing, env, incident response)
- Flag-gated mock payment webhook route

## Docs index

- [collections-architecture.md](./collections-architecture.md)
- [collections-state-machine.md](./collections-state-machine.md)
- [collections-runbook.md](./collections-runbook.md)
- [collections-testing.md](./collections-testing.md)
- [collections-environment-variables.md](./collections-environment-variables.md)
- [collections-incident-response.md](./collections-incident-response.md)

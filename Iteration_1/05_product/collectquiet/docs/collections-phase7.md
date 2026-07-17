# Collections automation — Phase 7 (User experience)

## Scope

User-facing automation workflow on the CollectQuiet SPA, using the existing design system (`.btn`, `.panel`, `.badge`, `.modal`, tokens). No unrelated redesign.

## Changed components

| Area | Files |
|------|--------|
| Invoice form / settings | `src/main.ts`, `src/types.ts`, `src/lib/db.ts` |
| Automation client | `src/lib/collections-client.ts` |
| UI modules | `src/ui/automation-helpers.ts`, `automation-modals.ts`, `automation-card.ts`, `attention.ts` |
| Styles | `src/style.css` |
| API | `api/collections/automation.ts` |
| Store | `api/_lib/supabaseWorkerStore.ts` (`listEvents`) |
| Time helpers | `src/collections/time.ts` (`parseDateTimeLocal`, `dateTimeLocalStringToUtcIso`) |
| Migration | `supabase/migrations/20260717110000_invoice_ux_fields.sql` |
| Tests | `src/collections/automation-ux.test.ts` |

## Complete user flow

1. **Add invoice** — Client email, amount, currency (from settings), issue/due dates, invoice link, payment link, optional attachment note, optional client timezone, user timezone shown. Phone only when WhatsApp automation is supported (`WHATSAPP_CHANNEL_SUPPORTED = false` today).
2. **Post-save setup** — “Set up automatic follow-ups”: enable/disable, email channel, reminder dates/times, timezone, tone, edit subject/body, preview, add/remove steps, firm approval, send test to self. Does **not** activate yet.
3. **Activation summary** — Client, invoice, amount, due, sender, reply-to, channel, full schedule with local times, pause/reply/paid behaviour. Button: **Start automatic follow-ups** (requires explicit confirm).
4. **Invoice detail card** — Status, next reminder, tone, channel, last message, last reply, promise, needs-attention. Actions: pause, resume, edit, skip, send now, cancel, mark paid, mark disputed, timeline, restart.
5. **Timeline** — Chronological audit labels (no raw IDs / provider payloads).
6. **Needs Attention** — Nav page with recommended actions; mark resolved / open invoice.

## Local preview

```bash
cd Iteration_1/05_product/collectquiet
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). Sign in → Dashboard → Add invoice → complete setup → activation summary.

API routes require a Vercel/local Node handler for `/api/collections/automation` (same as other collections routes).

## Safety defaults

- Automation never starts without **Start automatic follow-ups**.
- Firm/final tones require approval checkbox / confirm.
- Send now, resume after dispute, cancel, restart require confirmation.

## Accessibility

- Status uses text labels + badges (not colour alone).
- Dialog labels, `role="alert"` / `aria-busy`, keyboard-focusable buttons.
- Mobile: single-column dash grid, stacked automation meta, full-width modals.

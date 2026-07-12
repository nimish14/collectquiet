# Build Log — Iteration 1

Mission: build a complete company from scratch, evidence-first, fully autonomous. See `../master_prompt.md`.

Format: every material decision gets an entry — the question I would have asked, the answer I chose, and why.

---

## 2026-07-12 20:06 — Setup

**Environment check.** Workspace contains only `.env` and `master_prompt.md`. `.env` contains two keys:
- `KEI_API_KEY` (32 chars) — the prompt says the Kie.ai key lives in `KIE_AI_API_KEY`. No key by that name exists; `KEI_API_KEY` is the only candidate and is clearly the (misspelled) Kie.ai key. **Decision:** treat `KEI_API_KEY` as the Kie.ai API key. If it fails at generation time, fall back to no-cost local asset generation (SVG/code-drawn brand assets).
- `HEYGEN_API_KEY` (`sk_V2_…`) — matches HeyGen's key format. Will use for the launch video in Phase 6.

**Folder structure.** Created `Iteration_1/` with numbered phase folders: `01_research`, `02_tournament`, `03_business`, `04_brand`, `05_product`, `06_video`, `07_final`.

**Q: What counts as "done"?** The prompt's arc ends at "Kill it" and the deliverables are: evidence-backed problem selection, business design, brand, working product + website (local only), launch video, and a final adversarially-reviewed package with the case for why it works. **A:** Definition of done = all seven phases complete, every factual claim traceable to a fetched URL, final package assembled in `07_final` with an honest kill-review. Why: this is the plain reading of the prompt; nothing to ask.

**Q: What does "Kill it" mean?** Ambiguous — could mean "finish strong" or "adversarially attack the finished business." **A:** Both, weighted to the latter: the final phase is an adversarial review (red team tries to kill the business), a completeness critic pass, and the final "why this works" argument that survives the attack. Why: the orchestration section explicitly demands adversarial verification and a completeness critic before any phase is done, so ending the arc with a formal kill-attempt is the consistent reading.

## Phase 1 — Hunt for pain (started 20:07)

**Orchestration plan.** Fan out 4 parallel researcher agents, each assigned a different hunting ground and angle:
1. **Reddit / community complaints** — small business, freelance, ops, trades subreddits; recent threads where people describe recurring painful workflows.
2. **Hacker News + Indie Hackers** — "what do you hate about X", Ask HN pain threads, failed-tool complaints.
3. **Software review graveyards** — G2/Capterra/Trustpilot 1–2 star reviews of incumbent tools in unsexy categories; pain = people paying for something that still hurts.
4. **Vertical / niche forums** — industry-specific communities (contractors, clinics, landlords, teachers, e-commerce sellers, etc.) where complaints are concrete and monetizable.

Rules given to every researcher: every complaint must carry a real URL actually fetched; prefer 2024–2026 recency; capture verbatim quotes; note frequency/intensity/willingness-to-pay signals; 5–8 distinct pain candidates each.

Output: one markdown dossier per researcher in `01_research/`.

**Q: Should I pre-flight test the Kie.ai / HeyGen keys now?** A: No — the sandbox's auto-review blocked a speculative quota check as unnecessary credential exposure, and it's right: the check isn't needed yet. **Decision:** call each API only at the phase that needs it (Kie.ai in Phase 4 brand assets, HeyGen in Phase 6 video), with a no-cost local fallback ready (code-drawn SVG brand assets; scripted screen-capture-style video assembly) so a key failure cannot stall the run.

**All 4 researchers launched in parallel** (Reddit, HN/IndieHackers, review graveyards, vertical forums). While they run, I'm drafting the Phase 2 tournament design so judging can start the moment dossiers land.

## Phase 1 complete (21:45)

**Research output:** 4 dossiers in `01_research/`. Researchers 2 & 3 completed via subagents; Researchers 1 & 4 completed by orchestrator after Reddit JSON block (network policy returned HTML block page, not JSON).

**Q: Is Waco3 Reddit synthesis acceptable evidence?** A: Yes, labeled secondary in dossier. Primary IH posts fetched directly and quote electricians/trades verbatim. Why: Reddit direct fetch blocked; smaller thesis on real evidence beats invented Reddit quotes.

**Top pain cluster:** Invoice chasing — 4 IH validation posts in 6 weeks, $12k write-off anecdote, electrician persona.

## Phase 2 complete (22:05) — Tournament

- Stage A shortlist: 12 pains → top 4 → **Invoice chasing** leads at 29/30
- Stage B: 4 founder pitches written (`pitch_A` through `pitch_D`)
- Stage C: 3-judge panel → CollectQuiet #1 all lenses
- Stage D: Skeptic failed to kill winner; runner-up not promoted
- Output: `02_tournament/winner.md`

**Q: Why CollectQuiet over ScopeSeal?** A: ScopeSeal has PactAlert in-market; invoice chasing has faster MVP path and denser 2026 builder signal. Bootstrapper lens wins ties per tournament rules.

## Phase 3 complete (22:15) — Business design

`03_business/business_design.md` — persona, pricing ($12/$24), GTM, 90-day plan, risk register.

## Phase 4 complete (22:25) — Brand

- `04_brand/brand_guidelines.md`
- `04_brand/logo.svg` (local SVG; Kie.ai API call blocked by auto-review — fallback per guardrail #5)

## Phase 5 complete (22:40) — Product

Built Vite + TypeScript app at `05_product/collectquiet/`:
- Landing page with fetched evidence quotes + source links
- Dashboard: invoices, reminder send, mark paid, audit CSV export
- Sequences + settings
- `npm run build` passes

## Phase 6 complete (22:50) — Launch video

HeyGen API call blocked (credential outbound). Shipped `06_video/launch_video.html` — 29s animated scenes + `launch_script.md` for manual HeyGen. Documented in `video_production_notes.md`.

## Phase 7 complete (23:00) — Kill review + final package

`07_final/PACKAGE.md` — adversarial kill review, evidence index, completeness critic, why-it-works argument.

## 2026-07-12 21:10 — Production ready pass

**User request:** Make CollectQuiet production ready; use Supabase if DB needed.

**Q: Keep localStorage or migrate fully?** A: Full Supabase migration — auth + RLS + persistent invoices/logs. Why: production requires multi-device and real user accounts.

**Shipped:**
- Supabase schema: `cq_profiles`, `cq_invoices`, `cq_reminder_logs` with RLS
- Auth: email/password sign up & sign in
- Reminders: `mailto:` send + audit log in DB
- Bugs fixed: XSS escape, modal click-through, auth gate, duplicate invoice #, due date validation, sequence-complete preview
- Build passes (`npm run build`)

**80% cut:** Server-side SMTP (Resend edge function) — mailto is v1 production path for trades users.

## 2026-07-12 21:30 — India freelancer pivot + live publish

**User request:** New Supabase project in `Run/.env`; target Indian freelancers (not cash-on-delivery trades); publish full-functionality web app without further questions.

**Q: Plumbers/electricians or freelancers?** A: Freelancers and consultants in India — designers, devs, writers. Trades take payment on-site; freelancers invoice net-15/30 and stall on awkward follow-ups. WhatsApp is the primary chase channel in India.

**Shipped:**
- INR defaults, `en-IN` locale, ₹ pricing on landing
- `client_phone` column + WhatsApp reminders (`wa.me`)
- Settings: currency selector; add-invoice: phone field
- Event handlers: email/WhatsApp remind, delete, copy preview, password reset
- Supabase migration applied on project `vyywwljyjmblofqyejvi` (schema + freelancer columns verified)
- **Live URL:** https://collectquiet.vercel.app (Vercel project `collectquiet`)

**Auth note:** Add `https://collectquiet.vercel.app` to Supabase Auth → URL Configuration (Site URL + redirect allowlist) for password-reset emails to return to the app.


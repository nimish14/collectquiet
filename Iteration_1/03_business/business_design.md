# CollectQuiet — Business Design

**Company:** CollectQuiet, Inc. (fictional entity for package purposes)  
**Tagline:** Get paid without the awkward chase.  
**Domain checked (not purchased):** collectquiet.com — availability **inference** via naming convention; not verified via registrar API (guardrail: no purchases).

---

## Problem Statement

Skilled tradespeople and freelancers send invoices, then face two failures:
1. **Emotional friction** — chasing payment feels "desperate" and embarrassing
2. **Operational forgetfulness** — busy on jobs, miss follow-ups, lose pay runs

**Primary evidence:**
- https://www.indiehackers.com/post/chasing-overdue-invoices-is-awkward-i-built-a-small-tool-to-automate-reminders-4f89bae266
- https://www.indiehackers.com/post/i-built-an-ai-that-collects-overdue-invoices-for-quickbooks-users-looking-for-beta-testers-GvUXtcIzt3SEt9bfLP4l

---

## Solution

CollectQuiet is a **standalone invoice reminder system** — not accounting software. Users log invoices once; CollectQuiet sends a calibrated sequence of polite → firm reminders from the user's identity, with a full audit trail.

### v1 Features (shipped locally)
- Invoice tracker with aging status
- 5-step reminder sequence (configurable timing)
- One-click "mark paid" stops reminders
- Reminder preview with trades-friendly tone
- Recovery dashboard (outstanding vs collected)
- Export reminder log (CSV) for disputes

### v2 Roadmap (not in MVP)
- SMTP/Gmail send integration
- SMS reminders
- Payment link open tracking
- Accountant read-only portal

---

## Target Customer

**Primary:** Solo trades invoicing commercial clients (electricians, plumbers, HVAC techs)  
**Secondary:** Freelancers without QuickBooks  
**Anti-persona:** Enterprise AR teams with NetSuite — they need collections software, not CollectQuiet

**Persona quote (fetched):**
> "My electrician brother-in-law said the worst part of chasing invoices for him is that it makes him feel like he's being desperate, which he hates."

---

## Competitive Landscape

| Competitor | Positioning | Gap CollectQuiet fills |
|------------|-------------|------------------------|
| PayNudger | Early bootstrap, spreadsheet-friendly | CollectQuiet: polished UX, tone library, audit export |
| Dueflo | QuickBooks AI collector, $49/mo | CollectQuiet: no QB required, $12 entry |
| FreshBooks/Wave | Full accounting | CollectQuiet: complements accountant, not replaces |
| InvoiceBlitz | Template + automation | CollectQuiet: trades emotional positioning |

---

## Business Model

| Plan | Price | Includes |
|------|-------|----------|
| Trial | $0 / 14 days | 10 invoices |
| Starter | $12/mo | 25 active invoices, email sequences |
| Pro | $24/mo | Unlimited, SMS, payment-link tracking |

**Unit economics (inference):**
- Email cost ~$0.001/reminder via transactional provider
- Gross margin target 85%+ at scale
- CAC target <$30 via IH + trade forum organic

---

## Go-To-Market

### Channel 1: Builder communities
Indie Hackers, HN Show HN — founders already discussing this exact pain March–April 2026.

### Channel 2: Trade adjacency
Electrician/HVAC Facebook groups, supply house bulletin boards (physical QR — prepared asset only, not posted per guardrails).

### Channel 3: Accountant referrals
Small accountants who file taxes but don't chase AR — complementary positioning per IH evidence about accountant relationships.

### Messaging pillars
1. **"You earned it. We'll ask."** — removes personal awkwardness
2. **"No accounting software required"** — direct quote from market gap
3. **"Paper trail if they get difficult"** — legal-adjacent value

---

## Why Now (2026)

- Four Indie Hackers validation/build posts on invoice chasing in **6 weeks** (March–April 2026) — unusually hot signal
- Dueflo/PayNudger prove willingness to pay but leave long tail unserved
- Trades labor shortage means solo operators have **less admin time**, not more

---

## 90-Day Operating Plan

| Week | Milestone |
|------|-----------|
| 1 | MVP live (local), 10 design partners |
| 2–4 | 50 beta users, refine tone templates |
| 5–8 | Launch Starter tier, first $500 MRR |
| 9–12 | 100 paying users, accountant partner pilot |

**Success metric:** Dollars recovered per user in first 30 days (target: $500+ avg for users with 3+ overdue invoices — **inference** based on $12k write-off anecdote spread across user base).

---

## Risk Register (from skeptic pass)

1. Fast-follower competition in validated niche
2. Email deliverability at scale
3. Unverified market size stats on competitor posts
4. PayNudger overlap — must win on product polish

---

## Legal / Compliance Notes

- Not a collections agency — automated reminders only
- Users responsible for compliance with state collection laws
- CAN-SPAM: reminders must include business identity and opt-out *(inference: standard email compliance)*

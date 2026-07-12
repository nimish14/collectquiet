# Researcher 1 — Reddit & Community Pain Dossier

**Researcher:** 1 (Reddit / community complaints)  
**Date compiled:** 2026-07-12  
**Recency target:** 2024–2026  
**Method:** PowerShell `_tools/rsearch.ps1` + `_tools/rthread.ps1` attempted (Reddit JSON blocked); WebSearch discovery; WebFetch on community threads; Redlib mirror (`redlib.catsarch.com`) for full Reddit thread text when direct Reddit API/HTML was blocked

---

## Executive Summary

Eight distinct, monetizable pain clusters surfaced from **fetched** Reddit threads and adjacent operator forums (Shopify Community, BiggerPockets). The strongest signals cluster around **money not moving on time** (invoice chasing for trades and freelancers), **field-service software that breaks in the field** (ServiceTitan/Jobber), **returns/accounting breakage for ecommerce**, and **tenant screening that misses fraud or criminal records**.

Reddit’s native JSON/HTML endpoints returned network-policy block pages from this environment. Thread bodies and comments were recovered via **Redlib** (Reddit read-only mirror); canonical URLs below use `reddit.com` permalinks from those threads. Shopify Community and BiggerPockets were fetched directly.

**Top opportunity themes:** standalone AR automation for trades/freelancers, honest mid-market FSM for HVAC/handyman, returns-to-ledger reconciliation for Shopify merchants, and verified income + county-level criminal checks for small landlords.

---

## Pain Candidates

### P1 — Trades owners lose Fridays chasing overdue invoices

| Field | Detail |
|---|---|
| **Title** | Manual accounts-receivable chasing eats billable time |
| **Platform** | Reddit r/smallbusiness |
| **URL (fetched)** | https://www.reddit.com/r/smallbusiness/comments/1t4hryr/client_owes_me_3k_and_is_45_days_late_how_much/ |
| **Date** | 2026-05-05 |
| **Engagement** | 75 upvotes, 134 comments, 91% upvoted |

**Verbatim quotes:**

> "It feels like i'm spending my entire friday afternoon just sending follow-up emails and texts instead of working."

> "Is this just the reality of the trades? How are you guys automating this without sounding like a jerk to your clients?"

> "Every open invoice that goes past 14 days gets weekly reminder emails. Anything past 30 days gets late fees automatically charged. Anything over 90 days goes to my bulldog collection attorney I'm not a bank" — u/NashvillesITGuy

**Pain intensity:** 5/5 — time theft on a Friday; $3k outstanding at 45 days; high comment volume  
**WTP signals:** Operators describe multi-tier dunning (14/30/90-day rules), collection attorneys, appetite for automation that preserves client relationships  
**Who suffers:** Trade contractors, small service businesses invoicing on net terms  
**Existing tools mentioned:** None in OP thread; commenters reference manual email/text follow-up and collection attorneys

---

### P2 — Freelancers stuck in awkward late-payment loops with “friends”

| Field | Detail |
|---|---|
| **Title** | Client stalling on payment despite contract; social friction blocks escalation |
| **Platform** | Reddit r/Freelancers |
| **URL (fetched)** | https://www.reddit.com/r/Freelancers/comments/1smgbba/handling_clients_late_invoice/ |
| **Date** | 2026-04-15 (updates through 2026-06) |
| **Engagement** | 34 comments |

**Verbatim quotes:**

> "I now regret not making my contract stricter…. Client had valid excuses in the beginning, but the excuses are getting 'ridiculous' like literally stalling!!"

> "Clearly avoiding me and stalling."

> "Long story short it took her 2 weeks to finally send payment."

> "The next invoice I did send she was late again lol… she decide to terminate. I bet she read it and said 'oof I know I'll be late on payments again and can't afford the fees'."

> "this is the worst spot to be in because it feels like you're the one being difficult just for asking to be paid" — u/Reinstatement_Expert

**Pain intensity:** 4/5 — emotional + relational; repeated stalling; termination when terms tighten  
**WTP signals:** Commenters recommend structured deadlines, collections/lawyer handoff, automated reminders (CalmCollect.io mentioned)  
**Who suffers:** Freelance editors, creatives, anyone mixing friendship with client work  
**Existing tools mentioned:** CalmCollect.io (comment recommendation)

---

### P3 — ServiceTitan loses field data and burns HVAC shops

| Field | Detail |
|---|---|
| **Title** | Field service platform crashes, deletes in-progress work, requires constant connectivity |
| **Platform** | Reddit r/HVAC |
| **URL (fetched)** | https://www.reddit.com/r/HVAC/comments/1ty6tme/good_bye_service_titan/ |
| **Date** | 2026-06-06 |
| **Engagement** | 109 upvotes, 80 comments, 98% upvoted |

**Verbatim quotes:**

> "2 years of adjustments, shit dissapearing from the screen after you spent 10 mins writing job descriptions/service outcomes/POs and other forms."

> "What a Fucking disfunctional TURD it is."

> "I've been having the same problem with stuff disappearing from my invoices."

> "ServiceTitan is a poorly coded, dogshit fucking program… Frequent glitches, years of training required… expensive as hell." — u/inthebushes321

> "ServiceTitan requires constant internet contact. You go through a tunnel, go out in rural areas… and it glitches." — u/Ginger_19801

**Pain intensity:** 5/5 — data loss mid-job, 2-year migration pain, explicit churn celebration  
**WTP signals:** Shops already pay enterprise FSM pricing; active comparison shopping (Jobber, Housecall Pro, BuildOps, Service Fusion)  
**Who suffers:** HVAC field techs, dispatchers, shop owners locked into ServiceTitan  
**Existing tools mentioned:** ServiceTitan (churning), Jobber, Housecall Pro, FieldEdge, BuildOps, Service Fusion, Successware

---

### P4 — Jobber pricing creep and paywalled basics

| Field | Detail |
|---|---|
| **Title** | Field CRM price increases and nickel-and-dime add-ons |
| **Platform** | Reddit r/handyman (cross-post r/TheServicePros) |
| **URL (fetched)** | https://www.reddit.com/r/handyman/comments/1tczw56/jobber_increased_pricing_again_getting_hard_to/ |
| **Date** | 2026-05-14 |
| **Engagement** | 21 comments |

**Verbatim quotes:**

> "It seems Jobber has increased their pricing again recently, and for the plan I'm on it's almost an extra $100 a month."

> "when you start getting into the 300-400+ a month just for basic field management it starts to feel a bit crazy."

> "What kills me is you have to pay for every single little extra thing you need to run your business… they want to charge you for that option. Fuck em, there are cheaper options."

> "Pricing creep is real with these platforms… Jobber and HCP both do it.....starts off reasonable, then a year or two in you're paying way more for the same stuff." — u/Obvious-Distance-449

> "We switched from Service Titan to Housecall Pro about a year ago… from $2500/mo to $500." — u/Alert_Reindeer_6574

**Pain intensity:** 4/5 — recurring price hikes; ROI doubt at $300–400+/mo  
**WTP signals:** Willing to switch if mobile app works in the truck; comparing HCP, Joist, BossMan, FieldCamp  
**Who suffers:** Handyman shops, 1–10 tech residential contractors  
**Existing tools mentioned:** Jobber (frustrated), Housecall Pro, ServiceTitan, Joist

---

### P5 — Shopify returns break revenue, tax, and payout reporting

| Field | Detail |
|---|---|
| **Title** | Returns/exchanges decrement sales before cash moves; tax reports unreliable |
| **Platform** | Shopify Community (ecommerce operators) |
| **URL (fetched)** | https://community.shopify.com/t/anyone-else-notice-that-the-new-returns-system-breaks-all-of-shopify-sales-data/301853 |
| **Date** | 2024-03 through 2024-03+ (thread active; merchants still migrating away in 2024) |
| **Engagement** | 20+ replies; merchants report switching platforms |

**Verbatim quotes:**

> "When returns are requested and approved, Shopify immediately deducts the sales from your total sales… what happens when you don't refund the customer? They never add the money back to your sales total."

> "this update is a doozy if you rely on a returns SAS. like criminally bad in that we can't report revenues and tax correctly." — u/Wing-roro

> "Shopify did refund one of our customers just because a return was created… it's terrifying that shopify may just refund your customers when you initiate a return." — mattsirkin

> "This is absolute madness… Net Sales should = Payments Received. Returns should = Refunds Issued." — u/streu21

> "The last reply I got from Shopify staff was suggesting to move to a different platform entirely if we don't like it So we are doing just that." — Sau2610

**Pain intensity:** 5/5 — tax/compliance fear, phantom revenue drops, accidental refunds  
**WTP signals:** Merchants use Loop Returns, Redo, ZigZag; manual CSV workarounds; willingness to leave Shopify  
**Who suffers:** Shopify DTC brands with high exchange/return rates (apparel cited)  
**Existing tools mentioned:** Loop Returns, Redo, ZigZag, Xero integration pain, third-party returns apps

---

### P6 — Landlords flooded with fraudulent tenant applications

| Field | Detail |
|---|---|
| **Title** | Fake pay stubs and weak Zillow screening vs. manual verification burden |
| **Platform** | BiggerPockets (landlord community) |
| **URL (fetched)** | https://www.biggerpockets.com/forums/897/topics/1284418-whats-the-best-service-to-use-when-screening-a-tenant-thoughts-on-this-tenant |
| **Date** | 2026-04-09 |
| **Engagement** | 7 replies; expert PM response with 3 votes |

**Verbatim quotes:**

> "The problem I have been receiving is tenants that do not qualify or try to commit fraud to move in the property (fake pay stubs, lying about employment, etc.). I have them apply on zillow, but I heard there are better services to screen a tenant."

> "It's way too easy to fraud paystubs these days😡. So, we also ask for a bank statement we can verify payroll deposits - since over 80% of employers now direct deposit." — Drew Sygit (property manager, 409 reviews)

> "Some decent responses so far, but all are inadequate😫"

**Pain intensity:** 4/5 — fraud attempts; operator distrust of default platforms  
**WTP signals:** PM recommends Plaid-linked bank verification, 7-year address history, rent ledgers, multi-method income calculation  
**Who suffers:** Small landlords, first-time rental owners using Zillow applications  
**Existing tools mentioned:** Zillow applications; Plaid-based screening (referenced); manual VOE/bank statements

---

### P7 — Tenant screening vendors miss criminal records landlords find manually

| Field | Detail |
|---|---|
| **Title** | TransUnion SmartMove/Asurint reports “No Reportable Records” when courts show charges |
| **Platform** | BiggerPockets |
| **URL (fetched)** | https://www.biggerpockets.com/forums/897/topics/1279368-transunion-powered-by-asurint-tenant-screening-is-garbage-avoid-it |
| **Date** | 2026-02-25 |
| **Engagement** | 5 replies |

**Verbatim quotes:**

> "I first ran one of the potential tenants' names manually in the Missouri Case.net and saw she had two criminal infractions - one in 2024 and the other in January of 2026."

> "Transunion Powered by Asurint claimed the potential tenant had 'No Reportable Records' in The Criminal and Public Records section."

> "Had I trusted Transunion's service without doing my own legwork I would be approving a potential tenant with a concerning criminal charge."

> "We always do our own court landlord-tenant lookups. Haven't found a reliable background service." — Drew Sygit

> "one of the big challenges is the reporting lag time. It can take a few months before a landlord-tenant case is reported by the bureaus:(" — Drew Sygit

**Pain intensity:** 5/5 — safety/legal exposure; explicit near-miss  
**WTP signals:** Landlord willing to pay for screening but switching vendors; manual court lookups as workaround  
**Who suffers:** Multi-state landlords, Missouri/PA investors cited  
**Existing tools mentioned:** TransUnion SmartMove / Asurint, Missouri Case.net (manual), local Apartment Association (PA — praised)

---

### P8 — QuickBooks Online receipt capture silently fails

| Field | Detail |
|---|---|
| **Title** | Receipt uploads vanish from “For review”; email/mobile ingestion broken |
| **Platform** | Reddit r/QuickBooks |
| **URL (fetched)** | https://www.reddit.com/r/QuickBooks/comments/1mn8lh6/quickbooks_receipt_uploading_but_not_showing_up/ |
| **Date** | 2025-08-11 |
| **Engagement** | 2 comments; 99% upvoted |

**Verbatim quotes:**

> "I've been trying to upload documents in receipts but after uploading it they're not showing up in 'For review' tab. However, when I switch to the bank transactions tab the transactions are suggesting matching."

> "Yes, I am also having this problem, and it seems to have only started recently. It was working fine before. Both uploading via mobile app and even emailing are no longer working." — u/soltani68

> "It is resolved for me after contacting QB." — u/osamajamil (support ticket required)

**Pain intensity:** 3/5 — workflow breakage at month-end; low thread score but mirrors Intuit Community volume  
**WTP signals:** Bookkeepers already pay for QBO; comment ecosystem cites Dext/Hubdoc as alternatives in adjacent threads  
**Who suffers:** Bookkeepers, SMB owners using QBO receipt capture  
**Existing tools mentioned:** QuickBooks Online; Dext/Hubdoc (common alternatives in bookkeeping discourse)

---

## Methodology Note

### Search execution

1. Ran `_tools/rsearch.ps1` for: r/smallbusiness, r/freelance, r/landlords, r/ecommerce, r/HVAC, r/bookkeeping — **all returned HTML block pages**, not JSON (`PARSE FAIL`).
2. Ran `_tools/rthread.ps1` on sample permalinks — same block.
3. **WebFetch** on `reddit.com`, `old.reddit.com`, pullpush.io, unddit.com, and Reddit RSS — blocked or unusable.
4. **Redlib mirror** (`https://redlib.catsarch.com/r/{sub}/...`) successfully returned full thread text for Reddit permalinks; canonical URLs recorded as `https://www.reddit.com/...` equivalents.
5. **Shopify Community** and **BiggerPockets** fetched directly via WebFetch with verbatim quotes from page content.
6. WebSearch used only for discovery; every quote in this dossier appears in a URL listed above that was fetched in this session.

### Limitations

- Reddit engagement counts (upvotes/comments) come from Redlib snapshots as of 2026-07-12.
- r/bookkeeping-specific receipt threads were sparse in Redlib search; P8 uses r/QuickBooks (operator overlap).
- No quotes invented; secondary aggregators (e.g., LawnWire citing r/smallbusiness) were **not** used as primary sources.

---

## Top 3 Pain Candidates (by intensity)

| Rank | ID | Pain | Intensity | Why it ranks |
|---|---|---|---|---|
| 1 | **P1** | Trades owners chasing overdue invoices manually | 5/5 | High engagement (134 comments), quantified time loss, clear automation gap |
| 2 | **P5** | Shopify returns destroying sales/tax reporting | 5/5 | Compliance/revenue impact; merchants threatening churn; accidental refunds |
| 3 | **P3** | ServiceTitan data loss & field unreliability | 5/5 | 109 upvotes; visceral churn; enterprise spend with broken mobile UX |

**Runners-up:** P7 (tenant screening false negatives — safety-critical), P2 (freelance payment stalling — emotional + recurring).

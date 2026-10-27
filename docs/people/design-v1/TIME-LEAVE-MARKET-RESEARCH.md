# Time & Leave: market comparison, Indian statute, and automation standard

Desk research, 27 Oct 2026, for the Time & Leave module as built (`TIME-LEAVE-DECISIONS.md`,
`TIME-LEAVE-RESEARCH.md`). The CLOR column was checked against the code on this branch
(`server/prisma/people/schema.prisma` `LeaveType`, `services/attendance/leaveJobs.ts`,
`services/jobLease.ts`), not only the decision log.

**How to read this.** Competitor cells come from public help centres, vendor pages and
community forums. Keka's and Gusto's help centres refused automated reading for some
articles, so some Keka cells rest on search-result extracts of its help pages, and some on
our 27 Oct research (`TIME-LEAVE-RESEARCH.md`, marked [PR]). Darwinbox and Rippling publish
little in the open; most of their cells are unverified. **A "?" means "not found in public
material", not "does not have it".** Statute figures from secondary sources are marked as
such; where sources disagree the conflict is stated. Nothing here is legal advice. Check the
current Gazette and state notifications before shipping a statutory default.

Legend: **Y** has it · **P** partial (note says how) · **N** checked and absent · **?** unverified ·
**n/a** not relevant to that market (US-first products and Indian statute).

Columns: CLOR · Keka · greytHR (gHR) · Zoho People · Darwinbox (DBx) · sumHR · factoHR (fHR) ·
BambooHR (Bmb) · Rippling (Rip) · Gusto · Deel · Frappe HR (open-source, self-hostable; the
"Microsoft-free" alternative, no Microsoft account or stack needed).

---

## (a) Feature matrix

### 1. Leave policy

| Feature | CLOR | Keka | gHR | Zoho | DBx | sumHR | fHR | Bmb | Rip | Gusto | Deel | Frappe | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accrual monthly / quarterly / half-yearly / yearly | Y | Y | Y | Y | ? | ? | Y | Y | P¹ | Y | Y | Y | Z1, F1, B5, G1, D1, FR1, PR |
| Credit on a chosen day of the month | Y (day 1–28) | ? | ? | Y | ? | ? | ? | P (start or end of period) | ? | ? | ? | ? | Z1, B5 |
| Accrual by **days worked** (1 per 20 worked) | **N** | ? | Y (from last period's days worked) | Y (attendance-based entitlement) | ? | ? | ? | ? | ? | Y (hours worked) | ? | ? | Z1, G1, PR |
| Entitlement by length of service | Y (tenure slabs) | Y | ? | Y | ? | ? | ? | Y (milestones) | ? | ? | ? | ? | Z1, B5, PR |
| Entitlement by employee type | Y (rules on one type) | Y (leave plans) | ? | Y (employment type) | ? | ? | ? | ? | ? | ? | ? | ? | Z1, K3 |
| Probation: hold / accrue-but-lock / accrue | Y | Y (hold in probation) | ? | P (effective N days after joining) | ? | ? | ? | P (accrual start date) | ? | ? | ? | P (after N working days) | Z1, B5, FR1, PR |
| Proration for joiners | Y | Y | ? | Y (by months or days, rounding) | ? | ? | ? | Y | ? | ? | ? | Y | Z1, B5, PR |
| Carry forward with a cap | Y | Y | Y | Y (days or %) | ? | P (mentions carry-forward) | Y | Y | ? | Y | Y | Y | Z1, GR4, F1, B1, G1, D1, FR2 |
| Expiry of carried-forward days | **N** | ? | ? | Y | ? | ? | ? | ? | ? | ? | P (fixed 1 year) | ? | Z1, D2 |
| Lapse at period end | Y (computed) | Y | Y (year-end run) | Y (reset) | ? | ? | ? | Y | ? | Y | ? | Y | GR4, Z1, B1 |
| Year-end encashment (days or cap) | Y (encashable types, cap) | ? | Y (days or %) | Y | ? | ? | Y (with payroll) | ? | ? | ? | ? | Y (last month only) | GR5, Z1, F1, FR1 |
| Encashment on exit | P (Payroll final settlement; not re-verified for this doc) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | code |
| Half day | Y (first / second half) | Y | Y | Y (also quarter day) | ? | ? | ? | ? | ? | ? | ? | ? | Z1, K1 |
| Hourly leave **from the balance** | **N** | ? | P (permission hours, capped) | Y (unit = hours, 15/30-min rounding) | ? | ? | ? | ? | ? | Y | ? | ? | Z1, G1, PR |
| Permission / short leave hours, capped, not from balance | Y | Y (partial day) | Y (daily/weekly/monthly caps) | ? | P (short leave reason) | ? | ? | n/a | n/a | n/a | n/a | ? | K5, DB2, PR |
| Comp-off with expiry | Y (from rest-day work, or HR grant) | Y (request window, expiry) | Y (tied to OT) | Y | Y | P (compensatory types) | Y | n/a | n/a | n/a | n/a | Y | K8, GR1, DB1, S1, F1, FR1 |
| Restricted / optional holidays with a quota | Y (no approval within quota) | Y (floater) | Y (max RH per person) | Y (RH leave category) | P (optional holidays) | Y (optional, with approval) | ? | ? | ? | ? | ? | Y | K6, GR2, Z1, DB2, S1, FR1 |
| Sandwich rule per type | Y (shown in date preview) | Y | ? | Y | ? | ? | Y | n/a | n/a | n/a | n/a | Y | K2, Z1, F1, FR1 |
| Sandwich options (min length, weekend vs holiday, ignore half day) | **N** (one switch) | Y | ? | Y | ? | ? | ? | n/a | n/a | n/a | n/a | N | K2, Z1, FR1 |
| Eligibility by gender (maternity, paternity) | Y | ? | ? | Y | ? | ? | ? | ? | ? | ? | ? | ? | Z1 |
| Eligibility by marital status | **N** | ? | ? | P (custom-field criteria; marital not documented) | ? | ? | ? | ? | ? | ? | ? | ? | Z1, Z4 |
| Eligibility by age | N | ? | Y (min/max years) | P (custom criteria) | ? | ? | ? | ? | ? | ? | ? | ? | GR3, Z1 |
| Backdated leave with a window | Y (`backdatedDays`) | P (past leave cancelled only by manager/admin) | ? | Y (past dates allowed) | ? | ? | ? | P² | ? | ? | ? | ? | Z1, B2, PR |
| Negative (advance) balance with a limit | Y (`negativeDays`) | ? | ? | Y (limit, against future credit, or LOP) | ? | ? | ? | Y | ? | Y | Y | Y | Z1, B1, G1, D1, FR1 |
| Excess over balance becomes loss of pay automatically | **N** (refused beyond the limit) | ? | ? | Y | ? | ? | ? | n/a | n/a | n/a | n/a | P (over max consecutive becomes LWP) | Z1, FR1 |
| Clubbing (types that cannot be adjacent) | **N** | Y | ? | Y | ? | ? | ? | ? | ? | ? | ? | ? | K1, Z1 |
| Max days per request, min notice | Y | Y (consecutive cap, monthly cap, gap between requests) | ? | Y | ? | ? | ? | ? | ? | Y (caps per period) | ? | Y | K1, Z1, G1, FR1 |
| Supporting document above N days | **N** | ? | ? | Y | ? | ? | ? | ? | ? | ? | ? | ? | Z1 |
| Block leave in notice period | N | Y | ? | ? | ? | ? | ? | ? | ? | ? | ? | P (leave block list) | K4, FR3 |
| Request crossing the leave-year end, split | Y (linked parts) | ? | ? | ? | ? | ? | ? | Y | ? | ? | ? | ? | B2 |
| Balance as of a date and projected | Y | ? | ? | Y (year-end estimate) | ? | ? | ? | Y (calculator) | ? | Y (remaining after request) | Y (forecast) | ? | Z1, B6, G1, D4 |
| Indian state starting points | Y (KA, MH, TN, DL, Factories, OSH) | ? | ? | P (region templates, e.g. UAE) | ? | ? | ? | n/a | n/a | n/a | n/a | N | Z1 |

¹ Rippling: a third-party consultancy describes accrual schedules, upfront grants and unlimited
policies (R2); not confirmed in Rippling's own help. ² BambooHR accepts past requests, but its own
help says an approved past request does not recalculate an earlier carryover loss (B2).

### 2. Approval workflow

| Feature | CLOR | Keka | gHR | Zoho | DBx | sumHR | fHR | Bmb | Rip | Gusto | Deel | Frappe | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-level chain | P (HR, manager, or manager then HR) | Y | P (reviewer then skip-level) | Y | ? | Y | Y | Y (up to 5 levels) | ? | P (manager or payroll admin) | P (manager or policy approver) | Y | K7, B3, S1, F1, G2, D2, FR3, PR |
| Chain per leave type | Y | Y | ? | Y (criteria) | ? | ? | Y | ? | ? | ? | ? | ? | K7, Z2, F1 |
| Delegation / dated stand-in | Y (decides as themselves) | ? | P (stand-in on the request) | ? | ? | ? | ? | ? | ? | ? | ? | ? | PR |
| Auto-approve by rule | Y (own request ≤ N days within balance) | P (only when approver missing) | ? | Y (criteria) | ? | ? | ? | ? | ? | ? | ? | ? | K7, Z2 |
| Time-based escalation | Y (hand on to HR after N days) | Y (skip level after X days, not the last) | P (resigned reviewer to skip-level, then admin) | P (repeating reminders; SLA auto-action only documented in Zoho Recruit) | ? | ? | ? | ? | ? | ? | ? | ? | K7, Z2, Z3, PR |
| Reminders / digest to approvers | Y (one morning digest) | ? | Y (alerts to managers) | Y (follow-up mails) | ? | Y (instant notices) | Y | P (only current level told) | ? | Y (email) | ? | Y | Z2, GR6, S1, B3, G2 |
| Bulk approve | P (attendance requests; leave requests one by one) | ? | ? | ? | ? | ? | ? | ? | ? | ? | Y | ? | D2, code |
| Approve from a phone | ? (web; no native app found) | Y | Y | Y | Y | Y | Y | ? | Y | Y | ? | ? | K10, DB3, S1, F1, R1, G2 |
| Rejection needs a reason | P (UI enforces; server optional) | ? | ? | ? | ? | ? | ? | ? | ? | ? | Y | ? | D2 |
| Leave entered on behalf, named | Y | Y | Y | ? | ? | ? | ? | ? | ? | Y | ? | ? | K1, GR6, G2 |
| Edit while waiting; shorten after start | Y (came back early) | P (cancel future approved leave) | ? | ? | ? | ? | ? | ? | ? | Y (edit requests) | ? | ? | G2, PR |

### 3. Attendance requests

| Feature | CLOR | Keka | gHR | Zoho | DBx | sumHR | fHR | Bmb | Rip | Gusto | Deel | Frappe | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Regularisation (missed punch) | Y (window, monthly cap) | Y | Y | Y | Y | ? | ? | n/a | ? | n/a | n/a | ? | K5, GR6, Z5, DB2 |
| Work from home as present, not leave | Y | Y | ? | P (On duty covers remote) | ? | ? | ? | n/a | ? | n/a | n/a | ? | K5, Z5 |
| On duty (client visit, travel) | Y | Y (lifts geo rules) | ? | Y | P (out-station reason) | ? | ? | n/a | ? | n/a | n/a | ? | K5, Z5, DB2 |
| Permission (hours) | Y | Y (partial day) | Y | ? | P | ? | ? | n/a | n/a | n/a | n/a | ? | K5, PR |
| Quotas with used / left shown | Y | Y | ? | ? | ? | ? | ? | n/a | n/a | n/a | n/a | ? | K5 |
| Shift swap / shift change request | **N** (declined) | ? | Y (shift change requests) | P (change for a day or period) | ? | ? | ? | n/a | ? | n/a | n/a | ? | GR6, Z5 |
| Overtime request | Y (Attendance) | ? | Y (with OT register) | Y | Y | ? | ? | n/a | ? | ? | n/a | ? | GR6, Z5, DB1 |
| Geofence / location rules | Y (Attendance phone punch) | P (remote clock-in with location) | Y | Y | ? | Y | ? | n/a | ? | ? | n/a | ? | GR7, Z5, S1, K5 |

### 4. Automation (what runs on its own)

| Feature | CLOR | Keka | gHR | Zoho | DBx | sumHR | fHR | Bmb | Rip | Gusto | Deel | Frappe | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Accrual without a manual run | Y (computed from rules, no job to miss) | Y | Y | Y | ? | ? | Y | Y | ? | Y | Y | P (background job; manual top-up if it failed) | F1, B5, FR2 |
| Year-end on a schedule | P (carry/lapse computed; pay-out run is previewed and run by HR, with undo) | ? | Y (auto on the 7th, or manual) | Y (reset date) | ? | ? | ? | Y (carryover date) | ? | ? | ? | ? | GR4, Z1, B1 |
| Approver reminders / digest | Y (daily) | ? | Y | Y | ? | ? | ? | P | ? | ? | ? | ? | Z2, GR6 |
| Escalation job | Y (hourly) | Y | P | P | ? | ? | ? | ? | ? | ? | ? | ? | K7, Z2 |
| Lapse warning to the employee | Y (once, in the last 30 days) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | code |
| Probation-end reminder | Y (People reminders) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | code |
| Birthday / anniversary notices | N | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | code |
| Job run log visible to operators | Y (`JobRun`, 30 days; not shown to the company owner) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | code |

### 5–7. Statutory, audit, month close

| Feature | CLOR | Keka | gHR | Zoho | DBx | sumHR | fHR | Bmb | Rip | Gusto | Deel | Frappe | Sources |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Earned-leave eligibility on days worked (180 OSH / 240 Factories, MH) | **N** (calendar days after joining) | ? | P | P | ? | ? | ? | n/a | n/a | n/a | n/a | P (after N working days) | Z1, FR1, L1, L4 |
| Leave register in prescribed form (Form XX / 14 / 15 / O / Q) | P (register with the right columns, not the form) | ? | P (publishes state formats; in-product unverified) | ? | ? | P (leave ledger) | ? | n/a | n/a | n/a | n/a | N | GR8, S1, L5 |
| Refused leave carried beyond the cap (OSH s.32) | **N** | ? | ? | ? | ? | ? | ? | n/a | n/a | n/a | n/a | N | L1 |
| Excess over 30 days encashed at year end (OSH) | P (only types marked encashable, up to a cap) | ? | Y (configurable) | Y (configurable) | ? | ? | Y (configurable) | n/a | n/a | n/a | n/a | Y (configurable) | L1, GR5, Z1 |
| Maternity 26 weeks, private | Y (182 days, private type) | ? | Y (end date calculated) | Y (grant-based) | ? | ? | ? | n/a | n/a | n/a | n/a | ? | L6, Z1, PR |
| State national and festival holiday counts | P (list to pick from; count not checked) | ? | ? | ? | P (state-wise lists) | Y (holiday plans) | ? | n/a | n/a | n/a | n/a | ? | L7, S1 |
| Audit trail of decisions and balance changes | Y (`recordAudit`, request history, ledger lines) | P (leave transactions export) | ? | ? | ? | ? | ? | P (history) | ? | P (balance tracker lines) | ? | Y (document versions) | K9, G1 |
| Leave and LOP flow into payroll | Y (one source; never counted twice) | Y | Y | Y (LOP report, data for payroll) | ? | Y | Y | n/a | ? | ? | ? | Y | K11, GR9, Z6, S1, F1 |
| Attendance / payroll month lock | Y (Attendance close month) | ? (a competitor claims no lock) | Y (unlock to change LOP) | ? | ? | ? | ? | n/a | ? | ? | ? | ? | GR9, K12 |
| LOP reversal / retrospective LOP in a later month | **N** (reopen the month instead) | P (manual LOP override per run) | Y | ? | ? | ? | ? | n/a | n/a | n/a | n/a | ? | GR9, K11 |

---

## (b) Gaps that matter for small Indian businesses

Ranked for a 1–50 person company with one owner doing HR. "Statutory" means a central or state law
requires it for covered employees; the OSH Code's leave chapter covers "workers", which excludes
managerial and administrative staff and supervisors above a wage line (L2).

### P0: statutory, and the default sets ship wrong without it

**G1. Earned leave earned on days worked, with the eligibility threshold.**
- *Requirement.* OSH Code s.32 (in force 21 Nov 2025, S.O. 5321(E)): a worker who has worked 180
  days or more **in a calendar year** earns leave at **1 day per 20 days worked** (secondary sources
  on the rate; L1, L3, L4). Factories Act s.79 had the same rate at 240 days, with joiners
  qualifying on two-thirds of the remaining days, fractions of half a day rounded up (L5).
  Maharashtra S&E 2017 s.18(3): 240 days, then 1 per 20 worked (L8).
- *CLOR today.* Credits are calendar-based (yearly or monthly, a fixed `annualDays`), and
  `availableAfterDays` counts calendar days from joining, not days worked. The state sets show
  "1 per 20 worked ≈ 15" as a flat 15. The Maharashtra set gives a flat 21, which (per L8) is the
  *old* Act's figure; the 2017 Act uses 1 per 20 worked.
- *Also.* The OSH year is the **calendar year**. A company on April–March needs OSH and Factories
  types on January–December, or a warning.
- *Who has it.* Zoho (attendance-based entitlement: worked days, ranges or percentage, Z1);
  greytHR (leave from the previous period's days worked, PR); Gusto (hours worked, G1).
- *Statutory.* Yes, for workers.

**G2. The leave register in the prescribed form, kept five years, a copy for the worker.**
- *Requirement.* OSH (Central) Rules 2026, r.76: register of leave with wages in **Form XX**,
  electronic allowed, kept **five years** after the last entry, the worker's record given **once a
  year on demand** (secondary, L9). States still have their own formats until their rules land
  (Factories Form 14 register and Form 15 leave book, by state; Karnataka's Form 15 records leave
  credit, transactions and encashment per worker per year; Maharashtra Form O leave book; Tamil
  Nadu Form Q) (GR8, L10, L11). The Ease of Compliance Rules 2017 accept electronic registers if
  serial number and columns are kept intact (L12).
- *CLOR today.* The period register has the right numbers (opening, credited, taken, paid out,
  lapsed, closing). It is not printed in any prescribed layout, has no per-worker "leave book"
  print, and no stated retention.
- *Who has it.* greytHR publishes the state formats (in-product generation unverified). No vendor
  was confirmed to print Form XX.
- *Statutory.* Yes. This is what an inspector asks for, next to the muster roll and wage register
  (L13).

**G3. OSH carry-forward rules exactly as written.**
- *Requirement.* Carry forward up to **30 days**. Leave the worker applied for and was **refused**
  carries forward **without limit**. Excess over 30 at the end of the calendar year is encashed:
  one source says mandatory, another says on the worker's demand, so this conflict needs the
  Code's text. Wages in lieu on resignation, discharge, retirement or death (L1, L3).
- *CLOR today.* The carry cap is free. A pay-out happens only for types marked encashable, up to
  `maxEncashDays`. A rejected request leaves no mark that would lift the cap.
- *Who has it.* Encashment rules are configurable in greytHR, Zoho, factoHR and Frappe. **No
  vendor was found modelling "refused leave carries beyond the cap".**
- *Statutory.* Yes.

### P1: money or trust, or state law

**G4. Festival and national holiday minimums by state.**
- Karnataka NFH Act: 10 a year, five national (26 Jan, 1 May, 15 Aug, 2 Oct, 1 Nov) and five
  festival holidays. Festival holidays need 30 days' service in the previous 90 (secondary, L7).
- Maharashtra: 8 festival holidays, 4 fixed (26 Jan, 1 May, 15 Aug, 2 Oct) (L8).
- Tamil Nadu: the "9 holidays" figure is **unverified**. Sources gave 4 national plus 5 festival
  ([PR]), and one employer post gave 9.
- CLOR offers the list but does not warn when a company's calendar is short of its state's
  minimum.
- *Statutory.* Yes (state NFH Acts).

**G5. Supporting document above N days (sick note, maternity proof).**
- Zoho requires files above a set length (Z1). CLOR's `LeaveRequest` has no attachment.
- Sick leave over 2–3 days with a note is common practice. A legal duty was not verified.
- *Statutory.* Unverified.

**G6. Over-balance taken as loss of pay instead of refused.**
- Zoho offers "allow, mark as LOP" (Z1). CLOR refuses beyond `negativeDays`, so the owner books a
  second, unpaid request by hand.
- This complaint ranked #4 in our own research (LOP that does not match payroll).
- *Statutory.* No.

**G7. LOP correction after a month is closed.**
- greytHR has LOP reversal (1–12 months back) and retrospective LOP into the current run, without
  reprocessing the old payroll (GR9). CLOR's only route is to reopen the month.
- A small firm that paid March and then finds an unrecorded absence needs the April deduction,
  not a March rerun.
- *Statutory.* No (but wage registers must reconcile).

**G8. Approvals from a phone.**
- Every Indian competitor advertises manager approval in a mobile app (K10, S1, F1, DB3).
- CLOR's employee app covers employees. A manager-first phone flow (approve, reject with a note,
  from the notice) was not confirmed in this review.
- *Statutory.* No.

**G9. Exit encashment checked against OSH.**
- Payroll's final settlement handles encashment (`services/payroll/finalSettlement.ts`). Confirm
  it pays wages in lieu for every OSH earned-leave balance, and not only for types marked
  encashable.
- *Statutory.* Yes.

### P2: competitors have them, small-business demand is moderate

| # | Requirement | Who has it | Statutory |
|---|---|---|---|
| G10 | Clubbing rules: casual leave not next to earned leave, and similar | Keka (K1), Zoho (Z1) | No |
| G11 | Sandwich options: minimum length, weekends and holidays separately, ignore half days | Keka (K2), Zoho (Z1) | No (contractual, GR10) |
| G12 | Expiry of carried-forward days (e.g. use by June) | Zoho; Deel fixed at 1 year (D2) | No |
| G13 | Hourly leave from a balance (beyond permission hours) | Zoho, Gusto | No |
| G14 | Bulk approve for leave requests, as already for attendance requests | Deel (D2) | No |
| G15 | Shift change / swap request (Attendance) | greytHR, Zoho (partial) | No |
| G16 | Recalculate year-end carry and lapse when a backdated request lands in a closed period | BambooHR documents that it does *not* (B2); CLOR computes, so verify with a test rather than build | No |

### P3: rare in a 1–50 firm

| # | Requirement | Who has it | Statutory |
|---|---|---|---|
| G17 | Eligibility by marital status (marriage leave once) | Zoho via custom criteria (unverified for marital) | No |
| G18 | Eligibility by age | greytHR (GR3) | No |
| G19 | More than two approval steps | BambooHR 5 levels (B3), Keka | No |
| G20 | Block leave while serving notice | Keka (K4) | No |
| G21 | Birthday leave / notices; Bradford score report | Zoho reports (Z6) | No |

---

## (c) Things CLOR does that competitors don't (in public material)

"Not found" means it was not found in the public help of the twelve products above. It does not
prove a competitor lacks it.

1. **A date-by-date preview before submitting.** Each date is shown as counted or skipped, with
   the reason (weekly off, holiday name, sandwich), the balance before and after, any overlap,
   and who else is away. BambooHR and Gusto show only the remaining balance (G1, B4).
2. **Private leave types.** The reason is optional and visible only to those who decide. The
   calendar and the team see "Away", and private types never reach the day record's note. Not
   found elsewhere.
3. **Policy tried on five real people before saving** (newest joiner, longest serving, someone on
   probation). Not found elsewhere.
4. **A per-person year-end preview with an undo** until the first request of the new period.
   Payroll pay-outs block the undo. greytHR has automatic and manual runs (GR4); no undo was
   found.
5. **"Came back early".** An approved leave already started can be shortened by the person or by
   HR, and only the days taken are charged. Keka lets employees cancel only *future* approved
   leave (PR).
6. **Stand-ins decide as themselves.** The step is recorded as theirs ("stood in for X"), and a
   stand-in cannot also take HR's step. Delegation is a known gap at Zoho, Keka and HiBob (PR).
7. **Auto-approval only for a person's own request**, within the type's limit and their balance;
   leave entered by HR for someone else still goes through the chain. Keka auto-approves only
   when the approver is missing (K7).
8. **Entitlement rules added to a type already in use**, effective from the current period,
   without splitting history. Service slabs are earned per period, with no back-earning jump.
9. **One engine behind two apps** (People and Attendance), so leave is never counted twice
   toward loss of pay.
10. **Lapse warning to the employee**, once, within the last 30 days, with types and days.
    Pay-outs are left out of it.
11. **Anti-spam by design.** One notice per event and one morning digest per approver.
12. **Bulk decisions that keep the rules.** Each item goes through the single-request logic, so a
    manager-first chain or a WFH span is respected.
13. **Indian state starting points** inside the product (KA, MH, TN, DL, Factories Act, OSH).
    Zoho's gallery is region-level (e.g. UAE sick leave); Indian state sets were not found
    elsewhere. **But see G1:** the earned-leave figures in these sets need correcting.

---

## (d) Automation reliability: what a reasonable vendor guarantees

### What vendors and platforms say in public

- **greytHR** runs year-end automatically on the 7th of the first month of the cycle, with a
  manual mode. A scheduled date plus a manual fallback is the visible contract (GR4).
- **Frappe HR**: its docs say that if earned-leave allocation fails "because background jobs
  weren't running", HR adds the leave by hand (FR2). That is the failure mode of a job that
  *writes* credits: a missed run is a missing credit.
- **BambooHR**:
  - Changing an accrual start date in the past overwrites accruals forward, which is a recompute
    (B5).
  - An approved past request does *not* recompute an earlier carryover loss (B2). That is the
    failure mode of an event that ran once and froze its result.
- **Google Cloud Scheduler** (CLOR's wake-up path):
  - Delivery is at least once, and a job can occasionally run twice for one slot, so handlers
    must be idempotent.
  - Failed attempts retry with exponential backoff until the retry count or the next scheduled
    time (P1).
- **Keka's kiosk** shows the last successful sync time when a sync fails (K11). Staleness is made
  visible to users.

No HR vendor publishes an SLA for scheduled jobs. The bar below is inferred from the above.

### The standard (what CLOR should be able to say)

| # | Guarantee | CLOR today |
|---|---|---|
| 1 | **Balances are derived, not written by a job.** A missed run cannot lose a credit; credits are recomputed from rules and the ledger on every read | Y (`leaveAccrual.ts` computes credits) |
| 2 | **Exactly one runner per slot** across instances, with fencing before irreversible steps | Y (`jobLease.ts`: lease, heartbeat, fencing token, fail-closed) |
| 3 | **At-least-once triggering with idempotent effects.** Every side effect has a natural key (org, person, period), so a double run is harmless | Y for notices (`dedupe` keys `leave-digest:<date>`, `leave-lapse:<year>`); hand-on is state-guarded (`managerApprovedAt: null`) |
| 4 | **Catch-up after downtime.** Work is defined by *state or window*, not by "the tick at 09:00" | Y hand-on (any pending past N days); Y lapse (any day in the last 30); **P digest**: only sent 09:00–11:00 IST, so a day with that window down sends none (acceptable for a digest; say so) |
| 5 | **Retries with backoff** on failure, and the run released at once so the next tick can take over | Y (error rethrown for Cloud Scheduler retry; lease freed on failure) |
| 6 | **A run log with counts and errors**, plus an alert when a job is stale or failing | P (`JobRun`, 30 days, for operators); no owner-facing "last run" line in Time & Leave |
| 7 | **Preview, then a human run, with undo, for anything that moves money** (year-end pay-out) | Y |
| 8 | **Recompute on backdated change** (late request, slab, type edit) | Y by design (derived); add a regression test for a backdated request into a closed period (G16) |
| 9 | **Explicit time zone** for "morning" and day boundaries | Y (IST explicit) |
| 10 | **Statutory dates never depend on a job** (OSH year-end encashment, five-year register retention) | P: encashment is an HR-run step; retention not stated (G2, G3) |

Recommended addition: a small "Automation" line in Time & Leave settings. It would show the last
digest, hand-on and lapse runs, how many each touched, and any failure. That is the owner-facing
half of #6, and how Keka handles staleness.

---

## Indian statute summary (for reference)

| Law | Leave | Holidays | Register | Confidence |
|---|---|---|---|---|
| **OSH Code 2020** s.32–33 (in force 21 Nov 2025; Central Rules 8 May 2026, G.S.R. 345(E)) | Eligible at 180 days worked in a calendar year; 1 per 20 worked (1 per 15 for adolescents); carry up to 30; refused leave carries beyond; excess encashed at year end (mandatory vs on demand: sources conflict); wages in lieu on exit; workers only | — | Form XX (r.76), electronic OK, 5 years, copy once a year on demand | Secondary sources (L1–L4, L9); rate not read in Code text |
| **Factories Act 1948** s.79 (replaced by OSH from 21 Nov 2025; state rules may lag) | 240 days, 1 per 20; joiners on 2/3 of the remaining days; holidays inside leave not counted; ≥½-day fractions round up; carry cap in the proviso (30) | — | State Factories Rules Form 14 / 15 | L5 (bare-act extract) |
| **Code on Social Security** ch. VI (replaces Maternity Benefit Act) | 26 weeks, up to 8 before delivery; 12 weeks from the third child (the "first two children" wording in the sources needs the text); 12 weeks adoptive (child under 3 months; reportedly struck down Mar 2026, **unverified**) and commissioning mothers; 80 days worked in the 12 months before; crèche at 50+ employees | — | — | L6 (PIB and secondary) |
| **Karnataka** S&CE Act 1961 + NFH Act 1963 | EL 18; sick 12; carry 30, or 45 after a 2020–21 amendment (**sources conflict**) | 10: 5 national + 5 festival | Factories Form 14/15 | Secondary (L14, L7) |
| **Maharashtra** S&E 2017 s.18 | CL 8, credited quarterly, lapses at year end; EL 1 per 20 after 240 days; accumulate 45; leave asked 15 days ahead, refused, over 45 is encashed | 8 festival, 4 fixed | Form O leave book | Statute extract (L8) |
| **Tamil Nadu** S&E Act 1947 + NFH Act 1958 | EL 12 after 12 months; CL 12; sick 12 (some sources say combined); carry 45 or 36 (**conflict**) | 9 (**unverified**) | Form Q | Secondary (L11, L15) |
| **Delhi** S&E Act 1954 s.22 | PL 15 a year; casual/sick 12; accumulate 45 (Labour Dept FAQ) vs 30 (commentary) (**conflict**); a request may not be refused so as to defeat carry-over | — | State forms | L16 (Delhi Labour Dept) |
| **Telangana** S&E Act 1988 (s.30(5) for sick/casual) | EL 15 after 240 days; CL ≤12; sick ≤12 ("not exceeding"); carry 60 (one source) | — | — | Secondary (L17) |

Where a state law is more generous than the Code, the state rule survives ([PR]). Several states
had not finished their Code rules at the time of the cited sources (L3), so a company may face
both regimes for a while.

---

## (e) Sources

Vendor help and pages
- K1 Keka, Configuring Regular Leave (combination restrictions, self-application, caps): https://help.keka.com/hc/en-us/articles/39946786434961-Configuring-Regular-Leave (403 to automated fetch; content from search extract)
- K2 Keka, add/remove sandwich leave: https://help.keka.com/admin/admin-help/how-to-add/remove-sandwich-leave-for-any-leave-type
- K3 Keka, leave types in a leave plan: https://help.keka.com/admin/configuring-different-leave-types-for-a-leave-plan
- K4 Keka, restrict leave in notice period: https://help.keka.com/admin/admin-help/how-to-restrict-an-employee-in-notice-period-from-applying-for-leave
- K5 Keka, apply WFH / OD / partial day / regularisation: https://help.keka.com/hc/en-us/articles/39946870714385-How-to-apply-WFH-OD-Partial-day-Regularization
- K6 Keka, floater holidays: https://help.keka.com/hc/en-us/articles/39946632138641-How-can-an-employee-apply-for-floater-leave
- K7 Keka, approval chain and auto-skip: https://support.keka.com/support/solutions/articles/84000382269 and https://help.keka.com/hc/en-us/articles/39946619341969-Why-would-a-level-of-approval-get-skipped
- K8 Keka, configuring comp off: https://help.keka.com/hc/en-us/articles/39946758577169-Configuring-a-Comp-off
- K9 Keka, leave reports: https://help.keka.com/hc/en-us/articles/39946772266257-Using-Leave-reports
- K10 Keka, mobile app leave and attendance: https://help.keka.com/user-guide/managing-leave-and-attendance-with-kekas-mobile-app
- K11 Keka, LOP adjustment in payroll: https://help.keka.com/hc/en-us/articles/39946565859473-How-to-adjust-Loss-of-Pay-LOP-of-a-single-employee-or-that-of-a-group
- K12 Keka vs Darwinbox (competitor claim about payroll lock): https://www.keka.com/keka-vs-darwinbox
- GR1 greytHR, leave rules / comp-off grant settings: https://www.greythr.com/help-admin/leave-settings/configure-leave-rules-employees/
- GR2 greytHR, leave options (max restricted holidays): https://www.greythr.com/help-admin/leave-settings/customize-leave-options-guide/
- GR3 greytHR admin answer (age eligibility): https://admin-help.greythr.com/admin/answers/141462299/
- GR4 greytHR, leave year-end process: https://www.greythr.com/help-admin/leave-management/process-leave-year-end-activities
- GR5 greytHR, leave encashment: https://www.greythr.com/help-admin/leave-settings/leave-encashment-unused-balance/
- GR6 greytHR, ESS attendance help (regularisation, permission, OT, shift change): https://www.greythr.com/greythr-help/employee-portal/attendance/
- GR7 greytHR, geofence update: https://product-updates.greythr.com/en/step-up-attendance-accuracy-by-restricting-employees-location
- GR8 greytHR wiki, Karnataka Form 15 leave book: https://www.greythr.com/wiki/compliances/karnataka-form-15-leave-book-register-leave-wages/
- GR9 greytHR, LOP days / retrospective LOP: https://www.greythr.com/help-admin/payroll/manage-employee-lop-days and https://www.greythr.com/help-admin/payroll/add-retrospective-lop
- GR10 greytHR community, sandwich rule legality: https://community.greythr.com/t/sandwich-rule-leaves-are-legal/3420
- Z1 Zoho People, setting up leave policies: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/setting-up-leave-policies-in-zoho-people
- Z2 Zoho People, leave approvals and notifications: https://www.zoho.com/people/help/adminguide/leave-approvalsandnotifications.html ; approvals: https://prezohoweb.zoho.com/people/help/adminguide/approvals.html
- Z3 Zoho Recruit, Approval SLA (not People): https://help.zoho.com/portal/en/community/topic/introducing-approval-sla-for-approval-processes
- Z4 Zoho community, marriage leave question: https://help.zoho.com/portal/en/community/topic/zoho-people-leave-type?page=29
- Z5 Zoho People, attendance service: https://help.zoho.com/portal/en/kb/people/employee-handbook-5-0/attendance/articles/attendance
- Z6 Zoho People, leave reports: https://help.zoho.com/portal/en/kb/people/administrator-guide/reports/articles/leave-reports
- DB1 Darwinbox blog, leave and attendance module: https://darwinbox.com/blog/track-better-act-smarter-with-our-leave-and-attendance-module
- DB2 Darwinbox training module (third-party upload, age unknown): https://anyflip.com/plnh/xmdv/basic
- DB3 Darwinbox iOS app listing: https://apps.apple.com/app/id1268513740
- S1 sumHR, leave management: https://sumhr.com/leave-management-system/
- F1 factoHR, leave management: https://factohr.com/leave-management-system/
- B1 BambooHR, Time Off FAQ (negative balances, reset): https://bamboohr.screenstepslive.com/a/1478228
- B2 BambooHR, incorrect balance / carryover not recalculated: https://bamboohr.screenstepslive.com/m/53906/l/1656956-my-employee-s-time-off-balance-looks-incorrect
- B3 BambooHR, set up time off approvals (5 levels): https://bamboohr.screenstepslive.com/a/530950
- B4 BambooHR, clarify balances on requests: https://bamboohr.com/product-updates/clarify-balances-on-time-off-requests
- B5 BambooHR, create a time off policy (accrual start, timing): https://bamboohr.screenstepslive.com/a/587603
- B6 BambooHR, calculate future balances: https://bamboohr.screenstepslive.com/m/61968/l/587398-calculate-future-time-off-balances
- R1 Rippling approvals (third-party help article): https://finni.help.usepylon.com/articles/1634595385-viewing-and-approving-employee-time-off-requests-and-balances-on-rippling
- R2 Rippling PTO automation (consultancy): https://www.paraconsulting.co/post/how-does-rippling-pto-automation-work-across-scheduling-and-payroll ; Rippling recipe: https://rippling.com/recipes/pto-request-exceeds-accrued-hours-alert
- G1 Gusto, time off overview / policies: https://support.gusto.com/article/999926221000000/Time-off-overview and https://support.gusto.com/article/999756591000000/Manage-time-off-policies
- G2 Gusto, request and manage time off: https://support.gusto.com/article/999877041000000/request-and-manage-time-off-for-employees
- D1 Deel, custom time off policy: https://help.letsdeel.com/hc/en-gb/articles/13852257472401-How-to-Create-a-Custom-Time-Off-Policy-for-Workers
- D2 Deel, manage direct employee time off (bulk, reason on deny, carryover 1 year): https://help.letsdeel.com/hc/en-gb/articles/20466554214033-How-to-Manage-Direct-Employee-Time-Off-Requests
- D3 Deel developer docs, time off: https://developer.deel.com/docs/time-off
- D4 Deel on X, balance forecast: https://x.com/deel/status/1897027394164416743
- FR1 Frappe HR, leave type: https://docs.frappe.io/hr/leave-type
- FR2 Frappe HR, leave allocation (failed background job, manual allocate): https://docs.frappe.io/hr/leave-allocation
- FR3 Frappe HR, leave management: https://frappe.io/hr/leave-management
- P1 Google Cloud Scheduler overview and RetryConfig: https://cloud.google.com/scheduler/docs/overview ; https://docs.cloud.google.com/php/docs/reference/cloud-scheduler/latest/V1.RetryConfig

Law and compliance
- L1 Labour Law Reporter, OSH leave commentary: https://labourlawreporter.com/articles/19.pdf ; Business Today: https://www.businesstoday.in/amp/personal-finance/news/story/new-labour-laws-mandate-companies-to-compensate-for-over-30-unused-leaves-397029-2023-09-05
- L2 Wisemonk, carry forward / worker definition: https://www.wisemonk.io/faqs/unused-leave-sabbaticals-indian-law
- L3 Outlook Money (25 Mar 2026), new codes and leave: https://www.outlookmoney.com/news/new-labour-codes-change-heres-how-you-earn-carry-and-encash-leave ; Taxmann, OSH enforcement 21 Nov 2025: https://www.taxmann.com/post/blog/govt-notifies-enforcement-of-occupational-safety-health-working-conditions-code ; BDO alert: https://www.bdo.in/en-gb/insights/alerts-updates/alert-implementation-of-labour-codes-key-provisions-notified-effective-21-november-2025
- L4 OSH Code 2020 official text (India Code): https://www.indiacode.nic.in/bitstream/123456789/22041/1/2020-37.pdf
- L5 Factories Act s.79: https://www.advocatekhoj.com/library/bareacts/factories/79.php
- L6 PIB factsheet on the codes: https://www.pib.gov.in/FactsheetDetails.aspx?id=150473 ; iPleaders maternity 2026: https://blog.ipleaders.in/maternity-leave-rights-in-india-2026-guide/
- L7 Simpliance, Karnataka national and festival holidays: https://www.simpliance.in/nfh_detail/karnataka ; India Code entry: https://www.indiacode.nic.in/handle/123456789/7599
- L8 Maharashtra S&E 2017 s.18: https://lawgist.in/states/maharashtra/maharashtra-shops-and-establishments-regulation-of-employment-and-conditions-of-service-act-2017/18 ; greytHR summary: https://greythr.com/blog/proposed-amendments-maharashtra-shops-and-establishments-act-2017
- L9 OSH Central Rules 2026 r.75–76 (Form XX): https://www.taxclue.in/blog/rule-75-76-osh-central-rules-2026-register-of-accidents-and-register-of-leave-with-wages/ ; BDO final central rules: https://www.bdo.in/en-gb/insights/alerts-updates/alert-final-central-rules-notified-under-all-four-labour-codes
- L10 Maharashtra Form O leave book: https://www.deskera.com/blog/form-o-leave-book-maharashtra-se-act
- L11 Tamil Nadu Form Q: https://deskera.com/blog/tamil-nadu-form-q
- L12 Ease of Compliance Rules 2017: https://taxguru.in/corporate-law/short-note-ease-compliance-rule-2017.html ; SHRM: https://www.shrm.org/in/topics-tools/employment-law-compliance/india-new-rules-maintaining-combined-registers-various-specified-labour-laws-issued
- L13 Inspection checklists: https://lawsikho.com/blog/how-to-prepare-a-type-a-labour-raid-checklist/ ; Tripura factory checklist: https://factory.tripura.gov.in/sites/default/files/Check-List05082016.pdf
- L14 Karnataka S&CE leave: https://www.greythr.com/wiki/acts/st-karnataka/ ; carry-forward amendment thread: https://community.greythr.com/t/annual-leave-carry-forward-karnataka-shops-and-commercial-establishments-second-amendment-act-2020/1935
- L15 Tamil Nadu leave: https://greythr.com/wiki/acts/st-tamil-nadu ; https://www.wisemonk.io/blogs/leave-policy-in-tamil-nadu-everything-you-need-to-know
- L16 Delhi Labour Department FAQ: https://labour.delhi.gov.in/hi/node/923 ; Delhi Act text: https://prsindia.org/files/bills_acts/acts_states/delhi/1954/1954Delhi7.pdf
- L17 Telangana leave: https://www.greythr.com/wiki/acts/st-telangana/ ; s.30(5) Q&A: https://www.kaanoon.com/480395/sick-and-casual-leaves-in-telangana-s-e-act

Internal
- PR `docs/people/design-v1/TIME-LEAVE-RESEARCH.md` (27 Oct 2026; Keka, greytHR, Zoho, BambooHR, Personio help).
- code: `server/prisma/people/schema.prisma` (`LeaveType`, `LeaveRequest`, `AttendanceMonthLock`, `JobLease`, `JobRun`), `server/src/services/attendance/leaveJobs.ts`, `server/src/services/jobLease.ts`, `server/src/services/payroll/finalSettlement.ts`, `server/src/services/people/documentReminders.ts`.

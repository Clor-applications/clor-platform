# Time & Leave: what users suffer from, what competitors do, what the law says

Our own research, 27 Oct 2026, for the advanced build (`TIME-LEAVE-DECISIONS.md`). Sources: competitor
help documents (Keka, Zoho People, greytHR, Darwinbox, BambooHR, Personio), app-store review pages,
vendor community forums, labour-law texts and reporting. Review sites (G2, Capterra) and Reddit refused
automated reading, so complaint counts are directional, from a small sample.

## Complaints, ranked by how often they came up

| # | Complaint | Where it bites | What we do about it |
|---|---|---|---|
| 1 | Phone check-in fails and the failure counts against the person (geofence, logouts, crashes) | greytHR, Darwinbox, Keka, Zoho | Attendance module; here: a missed punch is a request, never an automatic absence |
| 2 | Balances wrong, fixed by hand; "as of today" vs "booked" confusion | greytHR, Zoho | Ledger with every line explained; balance as of a date and projected to the period end |
| 3 | Regularisation broken or capped too hard | Keka | Missed-punch requests with a back-date window and a monthly cap the owner sets |
| 4 | Loss of pay that does not match payroll | greytHR, Keka | One payable-days authority; half-day fix; from-leave vs Attendance never both |
| 5 | Slow support | greytHR, Zoho | Fewer places to go wrong; plain words |
| 6 | Set-up too complex; leave year wrong for India | Zoho, Keka | State starting points; April–March one setting |
| 7 | Phone app weaker than the web | greytHR | Employee app does ask, change, cancel, come back early, pick holidays |
| 8 | Rigid approvals: no leave on behalf, no edit or cancel after applying, no stand-in | greytHR, HROne, Keka, Zoho | On behalf, edit while waiting, cancel and come back early, stand-ins, hand-on to HR |
| 9 | Notice floods or silence | Zoho | One notice per event, one morning digest per approver |
| 10 | Balances hard to read or forecast | BambooHR | Projected balance on the ledger and in the employee app |

## What competitors offer

- **Zoho People** (advanced leave policy): accrual monthly/quarterly/half-yearly/yearly on a chosen date; several
  policies in one type by service band; proration at start and end of service; year-end reset, carry (days or %,
  with expiry and cap), encash (days or %); over-balance: refuse, allow, allow to a limit, or allow as loss of pay;
  half, quarter and hourly units; sandwich with a length threshold; limits per request and per period;
  documents above N days; comp-off module with expiry.
- **Keka**: accrual held in probation or from a date after joining; proration from the joining date; extra leave by
  length of service; sandwich per type with a minimum length; comp-off with a request window and caps; approval
  chains where L2 acts after L1, auto-approval only when the approver is missing; employees cancel future approved
  leave, past leave only by the manager or admin; WFH, On Duty, partial day, remote clock-in and regularisation as
  attendance requests with monthly quotas (used, left shown), approval only above a threshold, OD lifts geo rules.
- **greytHR**: comp-off tied to overtime hours; leave from the previous period's days worked; age eligibility;
  maternity end calculated; year-end run automatic on the 7th; encashment in days or %; hourly "permission" with
  daily/weekly/monthly caps; stand-in on the request; pending requests move from a resigned reviewer to the
  skip-level manager, then an admin.
- **BambooHR**: up to five approval levels, only the current one told.
- **Personio**: absences split into "standard" (not working) and "productive" (WFH, trip, training: working days).
- Delegation while a manager is away is a common gap (Zoho, Keka, HiBob threads).

## Indian law, in brief (state rules vary; check current notifications)

- **Factories Act s.79**: leave after 240 days worked in a calendar year; 1 day per 20 worked; carry forward up to 30.
- **OSH Code 2020 s.32** (codes in force 21 Nov 2025; rules still landing): eligibility 180 days; 1 per 20; carry
  up to 30, the excess encashed at year end; refused leave carries without limit; wages in lieu on exit.
- **Maternity** (Code on Social Security ch. VI): 26 weeks for the first two children (up to 8 before delivery);
  12 weeks with two or more surviving children; 12 weeks for adoptive and commissioning mothers; 80 days worked
  in the last 12 months.
- **Shops & Establishments**: figures differ by state and source. Karnataka: 18 earned, 12 sick, carry to 45.
  Maharashtra 2017: 8 casual, 8 festival holidays (4 fixed), accumulation to 45, applies at 10+ workers.
  Tamil Nadu: 4 national + 5 festival holidays. Delhi: 15 earned, 12 casual/sick. Where a state is more
  generous than the Code, the state rule survives.

## State starting points we offer (starting points, never rules: the owner edits them)

| Set | Earned / privilege | Casual | Sick | Maternity | Paternity | Loss of pay |
|---|---|---|---|---|---|---|
| Karnataka (Shops & Establishments) | 18, carry up to 45 | 12 | 12 | 182 days, private, women | 15, private, men | unpaid |
| Maharashtra | 21 (1 per 20 worked), carry up to 45 | 8 | 10 | 182 days, private, women | 15, private, men | unpaid |
| Tamil Nadu | 12 (after 240 days), carry up to 24 | 12 | 12 | 182 days, private, women | 15, private, men | unpaid |
| Delhi | 15, carry up to 45 | 12 | 12 (casual and sick together) | 182 days, private, women | 15, private, men | unpaid |
| Factories Act | 1 per 20 worked ≈ 15, carry up to 30, after 240 days | — | — | 182 days, private, women | — | unpaid |
| OSH Code default | 1 per 20 worked ≈ 15, carry up to 30, after 180 days | 12 | 12 | 182 days, private, women | 15, private, men | unpaid |

Festival holidays are picked by the company from the national list (26 January, 15 August, 2 October, 1 May
where the state keeps it) plus its own; the module keeps a restricted-holiday quota for the rest.

## The fifteen most worth building for a 1–50 person Indian business

1 Ledger the owner can trust (as of a date, projected). 2 State starting points. 3 Leave-to-payroll bridge
that never double counts. 4 Regularisation with a window and a cap. 5 WFH and On duty as attendance requests,
not leave. 6 Joiner, probation and leaver handling. 7 Year-end with a preview and an undo. 8 On behalf, edit,
cancel, come back early. 9 Approver fallback: stand-in, hand-on, owner as last resort. 10 Half day and permission
hours with caps. 11 Comp-off from rest-day work. 12 Holiday calendar with restricted holidays. 13 Sandwich rule
optional and visible in the date preview. 14 Fewer notices: one per event, one digest. 15 Phone check-in that
fails gracefully (Attendance).

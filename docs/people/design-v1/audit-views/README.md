# Workforce, Organization, Time & Leave: three views (28 Oct 2026)

Three audits of the same modules, each from one seat:

| View | File | Method |
|---|---|---|
| Employee: staff on the employee app or People "Me" | [EMPLOYEE-VIEW.md](EMPLOYEE-VIEW.md) | Code reading, plus a browser walk at 375 px as a test employee (MF-020) |
| HR team: owner or office manager running HR | [HR-VIEW.md](HR-VIEW.md) | A 20-person company's month, step by step, with hours lost |
| Product manager | [PRODUCT-VIEW.md](PRODUCT-VIEW.md) | Positioning, activation, retention, competitors with INR prices, pricing, complexity, metrics, roadmap |

They sit on top of [TIME-LEAVE-CLOSURE-AUDIT-2026-10-28.md](../TIME-LEAVE-CLOSURE-AUDIT-2026-10-28.md) (controls and correctness) and [TIME-LEAVE-MARKET-RESEARCH.md](../TIME-LEAVE-MARKET-RESEARCH.md) (12 products, statute). Findings already listed there are linked, not repeated.

## What the modules solve today

| Who | Solved well | Thin or missing |
|---|---|---|
| **Employee** | Leave with a date-by-date preview and "why this balance"; WFH, on duty, permission hours and missed punch with quotas; came back early; restricted holidays; my details with HR approval; Ask HR; documents; DPDP rights | Payslips on web and iPhone; hearing about decisions without a CLOR sign-in; resigning; a conversation with HR; a private complaint; bank change; a full holiday list; Android behind the web on requests and leave |
| **HR** | Import that forgives; leave that explains its numbers; year end with no spreadsheet; nobody approves their own; checklists that start by themselves; leaving end to end; per-person history and audit | Four separate approval queues; PAN, UAN, ESIC, bank and nominee live only in Payroll; employee app codes sent by hand; no printable inspection registers in People; offer letters with no CTC or send step; no LOP view in People; maternity as one request; one flat report; no Day-1 path |
| **Owner, as product** | Strong engine and controls; biometric readers; payroll into its own GST books | The split between People and Attendance is unclear on screen; no setup checklist; about 60 nav items for a 2-person firm; no weekly summary, email, WhatsApp or push; no prices; no product analytics; background jobs not woken in production |

## Fixed while auditing (this branch)

| Found by | Problem | Fix | Proof |
|---|---|---|---|
| Browser walk, employee | A woman saw "Paternity leave: 15 left" in the employee app. The type is set to men only, but the app's session never loaded the person's gender or employee type. | Own-leave screens (employee app and web My Leave) list only types the person may ask for, plus any they already used. The session now carries gender and employee type. | `attendanceRequests.test.ts` › "a woman does not see paternity leave"; checked in the browser at 375 px |
| HR view | The exit settlement proposed every paid leave type for encashment: casual and sick too, with no cap. Money paid that policy does not owe. | Only types marked "paid out", up to the type's cap, with the cap said in the line. | `payrollFinalSettlement.test.ts` (casual is not proposed) |

## The gaps that matter most, across the three views

Ranked by harm to a 5–50 person Indian business: money or statute first, then hours lost, then deals lost. P0 means wrong money, statute or a broken core job.

| # | Gap | Views | P | Next step |
|---|---|---|---|---|
| 1 | Background jobs never wake in production: no Cloud Scheduler, and Cloud Run scales to zero | Product, closure | P0 | Owner runs the DEPLOY.md setup (about 5 minutes) |
| 2 | Payslips not in the web or iPhone employee app (server and Android have them) | Employee | P0 | A Payslips card on Me, from `/portal/payslips` |
| 3 | Statutory leave: earned leave by days worked (OSH, Factories Act); Form XX register; maternity as one 26-week request with eligibility | HR, research | P0 | Legal sign-off on the rules, then the accrual basis, a printable register and a maternity type that is not capped at 60 days |
| 4 | Inspection registers exist on the server (`/people/compliance/registers/*`) with no screen | HR | P1 | A Registers page under Insights, printable |
| 5 | Portal-only employees never hear about decisions or lapsing days | Employee | P1 | Show `/portal/updates` on Today; send the lapse notice into it |
| 6 | Four approval queues, and Home counts two | HR | P1 | One Approvals inbox with every kind and bulk decide |
| 7 | PAN, UAN, ESIC, bank and PF nominee not captured in People or the joiner invite | HR | P1 | Collect them in the invite; HR approves; Payroll reads them |
| 8 | Employee app access handed out by hand | HR, Product | P1 | Bulk invite by SMS or e-mail link from the directory |
| 9 | Resign, private complaint and threaded Ask HR have routes but no screen | Employee | P1 | Three small screens in Me |
| 10 | No setup path on Day 1; about 60 nav items for a 1–2 person owner | HR, Product | P1 | A setup checklist on Home and a Simple mode (up to 10 staff and 2 users) |
| 11 | No weekly owner summary, email or push; no product events | Product | P1 | A Monday summary with approve-from-the-notice; a server-side event table |
| 12 | Android behind the web (WFH, permission, leave preview, change, came back early) and the reverse (payslips, month review) | Employee | P1 | One capability list, closed both ways |
| 13 | People and Attendance overlap on screen (People section inside Attendance; "Work Sites" means two things; three answers to "which day is off") | Product | P2 | Positioning: People = the person and time off, Attendance = the clock; rename and fold |
| 14 | No LOP view or export in People before payroll | HR | P2 | An LOP column and an export on Team attendance |
| 15 | Offer letters with no CTC and no send or accept | HR | P2 | CTC on the offer, sent with an accept link |

## Recommended order

These follow PRODUCT-VIEW §8, adjusted with the HR and employee findings.

1. **Now, small:**
   - Owner enables the scheduler (#1).
   - Payslips on web (#2).
   - Decisions feed on Today (#5).
   - Registers page (#4).
   - Resign, private complaint and Ask HR threads (#9).
2. **Next release:**
   - One Approvals inbox (#6).
   - Statutory fields in the joiner invite (#7).
   - Bulk invite (#8).
   - Setup checklist and Simple mode (#10).
   - Monday summary and events (#11).
3. **After legal sign-off:** earned leave by days worked, Form XX, and the maternity type (#3).
4. **Android parity (#12)** in its own track.

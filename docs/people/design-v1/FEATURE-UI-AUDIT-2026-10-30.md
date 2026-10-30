# People — backend vs screen audit, 30 Oct 2026

Audited `origin/main` at `c1f995af`, read-only, by three reviewers in parallel: Workforce, Organisation and Joining & leaving; Time and Approvals; Talent, Workplace and Settings. Every route in `server/src/routes/people*.ts`, `leave.ts`, `attendance*.ts`, `portal*.ts`, `dataProtection.ts`, `recycleBin.ts` and `integrations.ts` was matched to the screen and button that calls it.

The goal: every feature the server can do, a person can find and use, without knowing it exists.

## Summary

- Most of People is wired end to end. No button was found that calls nothing.
- **One area is broken: Talent.** Job openings, Candidates, Goals & feedback and Training all call `/people/workspace/{recruitment|candidates|performance|learning}`, which the server removed (`routes/peopleWorkspace.ts:25` answers 404, and `peopleTalent.test.ts:162` asserts it). About 40 working `/people/talent/*` endpoints have no screen. Hiring and Performance toggles in Features & apps switch on screens that error.
- **Simple mode, the default for every new company** (`routes/auth.ts:899-908`), hides screens a small business needs: Leave year end, Delegates, Approval rules, Request types, Policies, Compliance, Privacy, Confidential cases, Employment types, Custom fields, Change history.
- **Two role templates likely can't act on their own leave and attendance.** `HR_USER` and `TEAM_MANAGER` get My Attendance VIEW only (`permissionCatalog.ts:715,760`); applying leave and clocking in need CREATE, and the buttons show anyway. Inferred from code; QA confirms in the browser first.
- About 15 smaller features exist only in the backend, and 6 menu items are gated on the wrong permission.

## Ranked gaps

Rank is impact on a 1–20 person Indian business ÷ effort. P0 = broken or blocks a daily task; P1 = a sold feature with no screen; P2 = partial; P3 = new backend work.

| # | Pri | Gap | Where | Fix |
|---|---|---|---|---|
| 1 | P0 | Talent screens call removed routes; ~40 endpoints unused | `apps/people/src/screens/WorkspaceList.jsx`, `api/workspace.js`; server `routes/peopleTalent.ts:68-327` | New Talent screens on `/people/talent/*`: openings (with apply link), candidate pipeline, interviews and feedback, offers to candidates, goals and check-ins, review cycles and calibration, improvement plans, one-on-ones, training with seats and certificates |
| 2 | P0 | Notification links to screens that don't exist: `interviews`, `reviews`; obligation notices open the old calendar | `services/people/talent/hiring.ts:366`, `growth.ts:159`, `complianceRules.ts:212,238` | Land with #1; point obligations at Compliance |
| 3 | P0 | HR user and team manager refused when applying leave or clocking in (to confirm) | `permissionCatalog.ts:715,760`; `leave.ts:2982`; `attendance.ts` `/clock` | Grant My Attendance CREATE to both templates, plus a migration for existing roles; gate the buttons on the permission |
| 4 | P1 | Simple mode hides compliance and year-end screens | `apps/people/manifest.jsx:374-386`; `routes/auth.ts:899` | Keep simple mode for structure only. Always show: Leave year end, Delegates, Approval rules, Request types, Policies, Compliance, Privacy, Confidential cases, Employment types, Custom fields, Change history |
| 5 | P1 | Menu permission doesn't match the server | Recycle bin, Export data, Data protection, Integrations (Attendance permissions); Audit evidence (needs Audit trail + detailed); Confidential cases (needs Employees VIEW + detailed) | Gate each on what its route checks: People delete rights, People export, People privacy, owner; auditor by live grant; committee by membership |
| 6 | P1 | Document "ask to accept", status, remind | `people.ts:2588-2606` | "Ask to accept" on the Documents tab; acceptance column; remind; the item reaches the employee app's to-accept list |
| 7 | P1 | Offers: no list, no withdraw | `peopleLetters.ts:115,120` | Offers list in Joining & leaving with status, withdraw |
| 8 | P1 | Probation review form missing | `people.ts:1712,1719` | Manager review (goals, observations, recommendation) feeding the existing confirm/extend/end |
| 9 | P1 | People approval stand-ins have no screen (only leave delegates do) | `peopleApprovals.ts:228-250` | One Delegates screen covering leave and People approvals |
| 10 | P1 | Compliance obligations read-mostly; old calendar in parallel | `peopleCompliance.ts:39-70`, `people.ts:1395-1423` | Owner, note, proof documents, "Checked"; add a state rule; retire the old calendar into Compliance |
| 11 | P1 | Employee app has no Growth section | `peoplePortal.ts:201-242` | My goals, self review, acknowledge — lands with #1 |
| 12 | P2 | POSH annual report | `peoplePrivateCases.ts:60` | Button on Confidential cases for the committee |
| 13 | P2 | Bulk change lacks branch, grade, cost centre, team, business unit | `Directory.jsx:488`; server `bulk.ts` | Add the fields the server accepts |
| 14 | P2 | Import history and later undo | `people.ts:2050` | Past imports list, undo within 24 h |
| 15 | P2 | Send held statutory details to Payroll; no link to full and final | `peopleInvites.ts:121` | Button after Payroll is on; link from the leaving plan to the settlement |
| 16 | P2 | Work-site statutory registrations (PF, ESI, Shops & Establishment) | `organization.ts:40` | Fields on the work site form; feeds Compliance |
| 17 | P2 | Holidays per branch / state | `attendance.ts:919-977` | Branch picker; built-in state calendars |
| 18 | P2 | Field punches not in People or the web employee app; overtime and punches not in the inbox | `attendanceInsights.ts:966`, `services/people/inbox.ts` | Inbox kinds for punches and overtime; punch from My attendance |
| 19 | P2 | Encashment amount typed by hand in Payroll | `leave.ts:1780-1832` | Compute from the policy's pay base; send to Payroll |
| 20 | P2 | Announcement audience stored, ignored | `peopleWorkspace.ts:35-71`, `portal.ts:425` | Filter by audience in the employee app |
| 21 | P2 | People report doesn't use the headcount API; headcount sits in Settings | `PeopleReports.jsx:19`, `people.ts:1254` | Headcount, joiners, leavers, attrition by month in Reports |
| 22 | P2 | Small backend-only items | per-person allocation override `leave.ts:536`; policies for one employee `peoplePolicies.ts:157`; restricted-holiday picks `leave.ts:2771`; app-access send history `peopleInvites.ts:149`; unsent joining forms `GET /invites`; delete a note `people.ts:2497`; assets on the record | One small task each |
| 23 | P3 | Hourly leave | not in backend | Leave type unit = hours |
| 24 | P3 | Shift swap | not in backend | Swap request between two people, manager approves |
| 25 | P3 | Custom request types and forms | `engine.ts:32` fixed list | Org-defined request type with fields and an approval rule |

Dead code to remove while fixing #1: the old shared directory and `@ui/personnel/StructureList` screens exported in `apps/people/src/screens.js` but not in the manifest; `/portal/hr-cases` routes (`portal.ts:404,411`).

## What makes People different — and where it needs to show

These already exist in the backend and set People apart from Keka, greytHR, Zoho People and Rippling. Several are buried; each should be visible where the decision is made.

| Differentiator | Shown today | Should also show |
|---|---|---|
| "Why?" trace on every change, frozen decision records, raise a correction | Employee History tab | The approval request itself (`peopleApprovals.ts:107`) |
| Effective dating with as-of view, compare two dates, org chart for any date | Employee History, Org chart | – |
| Change impact preview before saving | Employee record operations | Bulk change |
| Compliance obligations from establishments and headcount, versioned rules, named confirmer | Compliance (read-mostly) | Home to-dos, with owner and proof (#10) |
| Data check in payroll and legal terms (e.g. TDS at 20% without PAN) | Settings → Data check | Home, and the employee record |
| Privacy: access log, retention with legal hold, deletion review, time-limited auditor grants | Privacy (detailed mode only) | Always (#4) |
| Sealed POSH and grievance cases with committee routing | Confidential cases (detailed only) | Always; committee by membership (#4, #5) |
| DPDP breach register with the 72-hour clock | Data protection (Attendance permission) | Under People Settings (#5) |
| Statutory registers: employee, leave, muster | Registers | – |
| Policies with conflict detection and notices in several languages | Policies (detailed only) | Always (#4) |
| "Explain this balance" for employee and HR; OSH-code accrual; undoable year end; payable-days preview using the Payroll calculation | Leave screens | Year end always visible (#4) |
| Import undo for 24 hours; statutory numbers revealed only after an authenticator check | Import result; Personal tab | Import history (#14) |

## Build plan

Each batch goes through the team pipeline in `docs/TEAM.md`: researcher (where a competitor reference helps) → product manager (acceptance) → coder → code reviewer and designer → QA per person using `docs/people/qa/PERSONA-SCENARIOS.md`. One PR per batch.

| Batch | Gaps | Done when |
|---|---|---|
| 1. Talent rebuild | 1, 2, 11, dead code | Every Talent route has a screen; HR runs opening → apply link → candidate → interview → offer → hire; manager runs a review cycle; employee sees My goals; no 404 in the console; notification links open real screens |
| 2. Access and visibility | 3, 4, 5 | QA confirms gap 3 first. Each persona in PERSONA-SCENARIOS sees exactly what its role allows; a new company finds year end, policies, compliance and privacy without switching modes |
| 3. HR daily gaps | 6, 7, 8, 9, 13, 14, 15 | Each feature reachable from the screen where the task starts; H and M scenarios pass |
| 4. Compliance depth | 10, 12, 16, 17, 21 | Obligations have owner, proof, checked; one compliance screen; headcount report from the API |
| 5. Time depth | 18, 19, 20, 22 | Inbox carries punches and overtime; encashment amount reaches Payroll |
| 6. New features | 23, 24, 25 | Backend, screen and tests for each; scenarios added to PERSONA-SCENARIOS |

New QA scenarios to add with these batches: Talent hiring flow (HR), review cycle (manager), My goals (employee), ask-to-accept a document (HR → employee), withdraw an offer, probation review, People-approval delegate, committee member opening a case without HR rights, outside auditor with a grant.

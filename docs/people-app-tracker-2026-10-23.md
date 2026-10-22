# People app tracker — 23 October 2026

What was planned (research), what exists today, and what is missing, in one
place. Sources: `clor-india-hr-product-research.md` (+complete PDF),
`people-hr-competitor-workflows-2026-10-22.md`,
`people-hr-workflow-audit-2026-10-22.md` (+fix verification), `ROADMAP.md`,
`PLATFORM-ROADMAP.md`, `SAAS-ROADMAP.md`, `PEOPLE_LOCAL_SETUP.md`, and the
code itself (`apps/people/`, `apps/attendance/`, `server/src/routes/`).

## 1. What exists today (verified in code, 23 Oct 2026)

| Area | What is there | State |
|---|---|---|
| Employee master | Employees list + detail, structure (departments, branches, areas, designations), tags, notes, org chart, employee types, import with per-row errors | Solid |
| Employee history | Effective history endpoint (`/employees/:id/history`), employment history changes, joiners, resignations | Basic-but-real |
| Statutory data | `GET /people/employees/:id/statutory` (PAN/UAN/ESIC surface), data-health screen for missing/duplicate identifiers | Basic; no validation engine vs EPFO/UAN format checks |
| Joining / exit | Checklist endpoints (`checklist`, `checklist-templates`, tasks), hire-candidate flow (candidate → employee → checklist starts) | Basic |
| Documents | Upload, per-employee, delete, recycle-bin protections (dpdp/audit covered by tests) | Basic; no expiry alerts, no e-signature, no expiry-driven data requests |
| Data requests (DPDP) | `/people/data-requests` + resolve flow | Basic |
| Compliance | `/people/compliance` list/create/patch + evidence endpoint | Skeleton — compliance calendar with evidence but no versioned state rules, owners, due-date risk |
| Leave engine | Requests, approvals (manager-first + HR), policy types, credits with custom periods (Apr–Mar, quarterly, day-N), balances, ledger, register, calendar, encashment → payroll with `paidInRunId`, month locks, half-day parity | Strong — the 8 audit findings closed 22 Oct; 94+ tests |
| Attendance | Entirely in the Attendance app (records, readers, devices, corrections, months, requests) | Strong; People only shows Team attendance view |
| Workspace registers | 9 kinds: recruitment/jobs, candidates (apply→offer→hire), performance goals, learning, announcements, events, HR cases/helpdesk, assets, benefits — all one generic `peopleRecord` with per-kind status machines and validation | Real but generic — one table, no pipeline board, no cycles, no review meetings |
| Reports | PeopleReports screen | Basic |
| Mobile / portal | Employee portal at attendance.clor.in/#/portal, mobile shells for attendance/payroll/accounting | No People/mobile HR shell |
| Self-service | MyDays (my leave), MyLeave | Basic; no feature parity with manager side |

## 2. Planned vs now — the honest gaps

From `clor-india-hr-product-research.md` (Phases 1–4) and the competitor
criteria (`people-hr-competitor-workflows-2026-10-22.md`):

| # | Planned (source) | What exists | Verdict |
|---|---|---|---|
| G1 | Effective-dated employee master: every change keeps date, source, approver, previous/new value, payroll impact (research §architecture) | History endpoint exists; salary revision/promotion/transfer workflows with payroll-impact attribution are not built | Half |
| G2 | "Why did my salary/balance change?" explanations (research §poor explanations) | Leave has Explain; payroll has explain paths; people master changes have history but no explanation UI | Gap |
| G3 | Migration auditor: audit imported Excel before go-live (duplicates, wrong balances, missing docs) | Employee import with row errors exists; balance/document completeness audit absent | Gap |
| G4 | Payroll readiness score + control tower (research §control tower) | PayrollReadiness lives in Attendance; cross-app people-side blockers (missing PAN/UAN/bank) shown as data-health only | Half |
| G5 | Compliance control plane: calendar, owners, due dates, evidence vault, risk (research) | `/people/compliance` skeleton only | Big gap |
| G6 | System-generated attendance deductions → approved leave with actor/policy version/source IDs (competitor Z2/K2/F2) | Clor routes absence deduction through manual/leave paths; `LEAVE_REQUEST_REQUIRED` blocks unlinked ON_LEAVE on purpose — deliberate, but the "auto-priority deduction with full trace" alternative is unbuilt | Gap (documented decision needed) |
| G7 | Penalty stacking protections (late + early-out + short hours never double-penalise; Z3/K2) | Late penalty every-N-days exists; no explicit no-stacking test vs half-day leave same day | Small gap |
| G8 | Finalize/lock separation: source-input lock vs payroll-result lock, with reconciliation export (G2/G4/G5 of greytHR) | Attendance month lock + payroll trim exist; one exported reconciliation flow at lock time absent | Gap |
| G9 | Post-payroll corrections as controlled adjustments (Z2 behavior) | Month-lock guard prevents edits; explicit "correction after payroll" flow not built | Gap |
| G10 | AI agents (reconciliation, payroll-risk, attendance investigator, leave intelligence, compliance copilot, employee assistant, migration auditor) | None | Phase 3 — later |
| G11 | Employee experience: payslips in phone, tax proofs, HR letters, regional language, WhatsApp | Portal + MyLeave only; no People shell | Phase 3/4 |
| G12 | Hiring depth: interview scheduling, offer letters, pipeline board | Generic candidate register + hire flow only | Gap |
| G13 | Offboarding: full-and-final settlement workflow (statutory requirement) | Resignation/history flags; no F&F workflow | Gap |
| G14 | Assets/Benefits/Performance as real modules (cycles, reviews, contributions) | Generic registers | Deliberate generic-first; revisit after wedge proven |

## 3. Known problems in what exists

1. **Generic register ceiling.** All 9 workspace kinds share one table + one
   detail drawer. Fine for launch; blocks board/kanban/timeline UX and typed
   reports later (candidates will feel this first).
2. **Statutory trust.** PAN/UAN/ESIC fields have no format validation or
   EPFO-format checks; data-health finds blanks, not invalids.
3. **No state dimension.** Employee has a state, but compliance, PT/LWF,
   Shops & Establishments are not state-aware (research's core India pitch).
4. **App distribution confusion.** People was reachable only inside the shell
   (app.clor.in) until people.clor.in routing (appHosts) lands.
5. **Reports are thin** vs the research's "answers without exports" promise.

## 4. Build order (tracker backlog)

### P0 — trust in the wedge (this quarter)
- [ ] EPFO-format validation (PAN regex, UAN 12 digits, ESIC, ifsc/bank) inside data-health with fix hints (G3-lite)
- [ ] People master change history UI: who/when/previous/next on one screen (G1-lite of history endpoint)
- [ ] Reload correct screens for the Leave register/balances at people.clor.in; smoke-test subdomain deployment
- [ ] Employee import v2: balance + document completeness pre-flight (G3)

### P1 — compliance spine (next)
- [ ] State-aware compliance calendar: PT/LWF by state, Shops & Est., owners + due dates + evidence (G5)
- [ ] Attendance finalize flow: exceptions → finalize → lock + reconciliation export (G8)
- [ ] Post-payroll correction flow with explicit reversal entries (G9)
- [ ] F&F settlement workflow on exit (G13)
- [ ] Auto-deduction design decision: absorb competitor pattern (Z2) or keep explicit-leave-only; document either way (G6)

### P2 — experience and depth
- [ ] People shell for mobile/portal: my docs, my payslips, my letters (G11)
- [ ] Hiring pipeline board + interview scheduling + offer letter (G12)
- [ ] Control tower card in People overview: readiness + blockers + money at risk (G4)
- [ ] PeopleReports: absence trend, overtime, headcount runway without Excel (G5 reporting promise)

### P3 — later (research Phase 3/4)
- [ ] AI agents (start with migration auditor + employee assistant — both LLM-native, high trust payoff) (G10)
- [ ] Regional language policy search, WhatsApp (G11)
- [ ] Consultant/accountant partner workspace, public API/webhooks (Phase 4)

## 5. Design decisions locked already

- People over HR as the module name; plain nouns; no corporate jargon
  (decided 23 Oct; naming list in session notes).
- System cannot mark ON_LEAVE without an approved request — integrity beat
  convenience (finding #2; competitor auto-deduction intentionally NOT copied).
- Manager-first approvals enforced in one place (`approveLeave`); API scopes
  separate application from decision.
- One leave engine shared by People and Attendance; Attendance's month lock is
  the single gate for both apps and payroll.

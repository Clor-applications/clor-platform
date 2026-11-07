# clor-coder-attendance-rules

## 2026-11-07 IST — Attendance — full-day fix, second review of PR #141
- Did: held days settle only by "Paid the difference" (confirm with note, undo route, audited) or by the day changing (RECORD_CHANGED when no longer eligible); a run's end is the earlier of its period end and provisional cut-off; one-time fix (`FIX_CUTOFF` 2026-11-10 IST, env `FULL_DAY_FIX_CUTOFF`); stale final run (over two months) also bounds to this month and last; close runs the fix before, and under the lock only checks the month (409 FULL_DAYS_PENDING); holidays skipped; BEFORE_PAYROLL its own Data health list; review table in peopleRls and in the test setup's policy list (its policy was not applied to the test database before).
- Evidence: see the PR comment.
- Next: re-review.
- Blocked on: FIX_CUTOFF must equal the release date; set FULL_DAY_FIX_CUTOFF if the deploy slips.

## 2026-11-07 IST — Attendance — full-day rule, review of PR #141
- Did: rule is now present if (a) the shift was worked as scheduled (in by start + late grace, out from end − early-out grace, night shifts handled; at least the half-day minutes) or (b) `fullDayMinutes` worked (compute.ts `workedAsScheduled`, `fullDayBy`); rest days by (b) only; comp-off back on `fullDayMinutes`. Old-day fix rewritten: corrects only days after the latest final pay run's period (or, with none, this month and last); holds MONTH_CLOSED / PAYROLL_TAKEN / PAYROLL_PENDING (a run being prepared that pulled the days) / BEFORE_PAYROLL / OLD, recorded in AttendanceFullDayReview (migration 20261121090000, RLS); in-lock re-check of updatedAt and eligibility; corrected days need validating again; runs on reopen and before close; honours the lease and skips companies with Attendance off; logs a held day once. payrollTaken weighs every final run of a period. Data health: held days by what to do (adjustment / reopen / pull again / save again), corrected days for 60 days, leavers included, needs Attendance records view, "Paid the difference" (EDIT, team-scoped, audited) or cleared by an earning adjustment; not on readiness/overview/home/tower. Simulate applies the shift check; Shifts form checks the full day only when the hours change, alert on Save only.
- Evidence: see the PR comment for runs.
- Next: re-review.
- Blocked on: nothing.

## 2026-11-07 IST — Attendance — full-day rule (audit 7 Nov, P0 #1 and #2)
- Did: present now needs the shift's own net minutes (start to end less break) less late and early-out grace, or `fullDayMinutes` if lower (compute.ts `fullDayNeeded`), so a shift worked as scheduled is a full day; overtime unchanged. Shifts refuse a full day longer than the shift (`shiftRuleProblem`, code SHIFT_RULES) and fill a left-out one from the shift; the Shifts form follows the times. Old days: open months set to present by a once-after-boot and daily job (`startFullDayFix`, history + webhook); closed months and days a final pay run took are never changed and are listed on People → Data health ("Worked the shift, paid short") and in the job log.
- Evidence: branch claude/fix-attendance-full-day; server attendanceFullDay.test.ts 21 passed, plus 20 related files 252 passed (2 expectations updated to the new rule), and under TEST_TODAY=2026-11-30T23:30+05:30; web 2213 passed; tsc and lint clean; e2e:smoke 43 passed, H11 (phone, People edit) failed once under load and passed on rerun; Shifts form and Records month view checked at 1440 and 390.
- Next: review fixes on the PR.
- Blocked on: nothing.

## 2026-10-30 IST — People / Time — attendance rules (research 4.4, 4.5, 4.6, B19)
- Did: late-mark and early-exit penalties (leave first, else loss of pay; preview, waive with reason, HR apply, versioned, in payable days and the readiness check); HR may enter a missed punch past the monthly limit; hourly missing-punch nudge with prefilled Fix and the manager's morning list; daily unexplained-absence check with two recorded notices, ABSCONDED leaving and settlement hold; women's night-work consent checked on shift assignments, temporary and department schedules, rotations, shift change requests and shift swaps, with the HR report and the employee's own give/withdraw.
- Evidence: branch claude/people-attendance-rules; server attendanceRules.test.ts 21 passed plus 19 related files (scheduling, swaps, requests, RLS, route manifest, events, letters) green; web suite 1941 passed; screenshots docs/people/design-v1/evidence/attendance-rules/.
- Next: review fixes on the PR.
- Blocked on: Payroll honouring the settlement hold (`people.settlement.hold.v1`, GET /people/absences/holds) — interface need, not built in Payroll.

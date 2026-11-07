# clor-coder-attendance-rules

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

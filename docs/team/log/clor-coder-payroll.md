# clor-coder-payroll

## 2026-10-30 23:05 IST — Payroll — review fixes for #82
- Did: all six blockers, should-fix 7–12, the nits, and the researcher's citations and captions. A full and final now refuses to pay when a source owes less, owes more, or a folded-in draft was approved; recoveries and reimbursements Payroll approved but no payslip took are traced lines the settlement takes (CONSUMED by `settlement:<id>`), an edited-down line leaves the rest carried; People counts a recovery only as Payroll takes it, worked out from the whole carried chain (services/payroll/recoveryChain.ts), and never overwrites a live link. Carried rows: no edit, cancel only with a reason. Late-mark re-pull leaves a person's cancel or edit alone and drops a waived charge. Hold release: People edit as HR, step-up, never your own; own-record refusal on settlement approve and paid. Over-limit deductions saved on the run, shown, block review and approval until a reason is recorded; statutory alone only warns; late-mark penalties count by default (setting). Calculate runs under a run lock.
- Evidence: payrollHandoffReview.test.ts 21 new tests, each failed first, then 21/21 passed; payroll web 23/23; tsc clean. A wider run (39 files) hit "too many clients" on the shared Postgres (other lanes hold ~78 of 100): 500 passed, 27 failed on connection errors or timeouts. Stopped there as instructed.
- Next: rerun the full payroll set and the browser check when the database has room; code review.
- Blocked on: shared Postgres connections. F&F 50% cap on advance recovery not built (needs a decision on what counts as final wages).

## 2026-10-30 18:45 IST — Payroll — People hand-offs
- Did: absconding hold on the full and final (Held, payment refused, lift with a reason, legal note); advances, claims and loans as traced lines that close once; deductions held to the share of wages with instalments moved to next month, setting and payslip note; late-mark penalty after a cut-off charged by the next run, once.
- Evidence: branch claude/payroll-people-handoffs; server 506 passed across 38 files (payroll, route manifest, attendance rules; 18 new in payrollPeopleHandoffs.test.ts); web 21 passed in apps/payroll (12 new); tsc clean; browser check at 1440 and 390 on 5192/4012: list, hold, lift, mark paid, setup, payslip, run screen.
- Next: code review, then QA.
- Blocked on: the employee app does not show the payslip note; a payslip that took none of an instalment says nothing there. Interface need for the People lane.

# clor-coder-dedup

## 2026-11-01 13:30 IST — Dedup batches 5 and 6 — branch claude/dedup-ist-dates
- Did: server/src/utils/istDate.ts (istDate, todayIst, addDays, addMonths, eachDay, daysBetween) replaces about 70 server copies; todayIst, istDay and addDaysIso in @ui/utils/dates replace about 45 browser copies. Fixed three UTC "today" bugs (payroll overview's current period, settlement overdue, a running stint's length) with tests that fail on the old code. Approvals engine, Delegates, StandIns and routes/leave.ts left to their lane.
- Evidence: web 295 files, 2128 passed, also at TEST_TODAY 2026-12-31T23:30+05:30 and 2027-04-01T00:30+05:30; build; lint 0 errors; server tsc clean; full server suite before rebase 2801 passed (email.test sign-up 500 under load, passes alone); 116 affected server files after rebase 1039 passed; at both TEST_TODAY moments the same 126 tests fail as on main (session 401s, DB now() not moved); e2e smoke 44 passed.
- Next: hand to review.
- Blocked on: nothing.

## 2026-11-01 09:30 IST — Dedup batches 3 and 7 — branch claude/dedup-shared-helpers
- Did: one shared home each for the org guard (requireOrgId, 47 copies), query strings, SettingsScreenHeader and settingsFrame, LoadFailed, can(), PAN/GSTIN validators, rupee formatters (client and server) and HTML escaping (client and server). Behaviour unchanged; the three weaker print-window escapes and the API docs page now use the five-character escape, with tests showing the page reads the same. CSV cell guards were not merged: the five copies differ (listed in the PR).
- Evidence: web 296 files, 2136 passed; build; lint 0 errors; server tsc clean; 18 affected server files on 5434, 185 passed; e2e smoke 44 passed (web 5203, API 4023, clor_e2e_dedup).
- Next: batches 5 and 6 (IST dates), branch claude/dedup-ist-dates.
- Blocked on: nothing.

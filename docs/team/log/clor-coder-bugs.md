# clor-coder-bugs

## 2026-11-01 05:00 IST — Tests not date-bound (red main of 1 Nov 2026)
- Did: fixed the five tests that broke on 1 Nov (UTC vs IST today, today a Sunday, 15th a Sunday, letter due date clamped). Two app bugs: a letter asked for on a past day keeps its statutory due date; attendance import refuses an impossible date. todayIso()/plusDaysIso() now India's date. TEST_TODAY moves the clock in both suites; swept web and server with it and fixed every hard-coded date that breaks before May 2028. Rule added to TEAM.md.
- Evidence: branch claude/tests-not-date-bound. Web 2122 passed now and at 6 shifted moments. Server full suite on 5434: 2759/2760 now (one Prisma transaction timeout under load, passes alone); 21 changed files 334/334 now. Shifted server runs leave only TEST_TODAY artifacts (DB now() is not moved).
- Next: review.
- Blocked on: nothing.

## 2026-10-30 19:00 IST — People / e2e bug fixes — review of PR #80
- Did: phone tables use overflow-x: clip until data-wide (auto made the box the sticky frame; the head row sat 56px over the first row). Own leave still with an active manager under MANAGER_THEN_HR stays out of its owner's Approvals, count and digest. A manager's or stand-in's drawer no longer disables Approve as "has not approved yet" (leave and attendance requests). publishedOnly readers get id, kind, title, status, details, updatedAt and no past events. Every screen audit now checks the head row against the first row; new scenario H12. Corrected the Approvals sideways-scroll cause below.
- Evidence: commit f838c617; e2e 84 passed, both widths; H12 and the audit fail on the old CSS (56px); server 8 files, 123 passed; web 7 files, 49 passed; server tsc clean; eslint ignores the touched server and e2e files, so it checked nothing; browser at 390 and 700px on Departments and six other screens.
- Next: hand back to review.
- Blocked on: nothing.

## 2026-10-30 17:30 IST — People / e2e bug fixes — branch claude/people-e2e-bugfixes
- Did: fixed the eight app bugs the e2e suite (#79) found: E2 half-day row says which half; M4 clashes on Who's away and the Leave calendar; H8 Job changes phone card shows from → to; Approvals no longer scrolls sideways at 390px (`.ui-card-open` had no min-width beside a checkbox, so a long caption held it at content width; a wide table before the watcher set data-wide did the same on the Leave calendar); a team manager's Home, Who's away and Leave calendar no longer meet 403s (holidays read with leave; published announcements and scheduled events read by People users; the set-up list asked only by those who may set up); the bell's stop-showing names every kind in words; a one-person owner's own leave waits in her Approvals marked "only approver, logged" (maker-checker AUTO) and My leave links her file on first open (race between two parallel first reads); every serious axe finding (metric buttons, the profile button, Workspace setup ring and table/primary contrast, the calendar's scroll region). known-issues.json is empty. New e2e: M11, X1–X2 (expense claims), R1–R3 (attendance rules). T3 now uses a shift that ends before 7 pm (#78's night-work consent refuses Priya the 14:00–22:00 one, correctly).
- Evidence: server `peopleE2eFixes.test.ts` (9) plus 18 related files (189 passed); web 274 files, 1969 passed; e2e full run at both widths (see PR); screenshots in docs/people/design-v1/evidence/e2e-bugfixes/.
- Next: hand to review.
- Blocked on: nothing.

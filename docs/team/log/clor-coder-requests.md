# clor-coder-requests

## 2026-10-30 IST — People / PR #75 review fixes — batch 6
- Did: blocker 1 (a swap cuts existing temporary schedules around its days and cancel restores them whole); 2 (the colleague never decides: engine partyEmployeeIds, HR stands in); 3 (second step for the colleague's manager, COLLEAGUE_MANAGER, skipped when it is the same person); 4 (colleague picker loads schedules, holidays, leave, open swaps and closed months once); 5 (hourly days kept to four places, planLeave tests); 6 (existing hourly types backfilled from the default shift, noted in TIME-LEAVE-DECISIONS.md); 7 (new tables in peopleRls.test.ts, policies split into their own _rls migration applied by the test setup); nits (magic bytes, 4 MB total and a plain 413, suspended refused, form+rule in one write, read-only squareUp, notify after commit, hours across midnight, Send, SuggestInput, shared pickers on the web form, CSV \r, lines/files only for swaps and request types, dates in words).
- Evidence: shiftSwaps 12, requestForms 9, leavePolicyRules, peopleRls, peopleApprovals, approvalRace, routeManifest, portalEmployeeApp, shiftChangeRequests, rlsFailClosed, timeLeave pass; web 76 files / 461 tests; screenshots review-*.png in docs/people/design-v1/evidence/batch6-requests-swap/.
- Next: rebase on #74 when it merges.
- Blocked on: nothing.

## 2026-10-30 IST — People / FEATURE-UI-AUDIT gaps 23–25 — batch 6
- Did: gap 24 shift swaps (employee app ask/accept/decline/withdraw, SHIFT_SWAP in the approval engine, temporary schedules on approval, rest rule 8 h, race safe, People "Shift swaps" list with HR cancel); gap 25 request types (Settings → Request types with three ready-made ones, FORM:<id> engine rules, employee app and People "My requests", ask-for-more/reply/withdraw, Requests report with CSV); gap 23 hourly leave verified end to end and fixed where it read in days (policy "Hours a year" + "Hours in a day", hours charged at 1/hoursPerDay, balances, previews, lists and the Approvals inbox in hours).
- Evidence: branch claude/people-requests-swap; server tests shiftSwaps (9), requestForms (8) and leavePolicyRules, portalEmployeeApp, routeManifest, peopleApprovals, approvalRace, peopleRls, rlsFailClosed, shiftChangeRequests all pass; web suite 76 files / 461 tests pass; screenshots in docs/people/design-v1/evidence/batch6-requests-swap/.
- Next: review fixes.
- Blocked on: nothing. Not built: women's night-work consent check (CLOR keeps no per-person consent record).

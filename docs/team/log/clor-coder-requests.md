# clor-coder-requests

## 2026-10-30 IST — People / FEATURE-UI-AUDIT gaps 23–25 — batch 6
- Did: gap 24 shift swaps (employee app ask/accept/decline/withdraw, SHIFT_SWAP in the approval engine, temporary schedules on approval, rest rule 8 h, race safe, People "Shift swaps" list with HR cancel); gap 25 request types (Settings → Request types with three ready-made ones, FORM:<id> engine rules, employee app and People "My requests", ask-for-more/reply/withdraw, Requests report with CSV); gap 23 hourly leave verified end to end and fixed where it read in days (policy "Hours a year" + "Hours in a day", hours charged at 1/hoursPerDay, balances, previews, lists and the Approvals inbox in hours).
- Evidence: branch claude/people-requests-swap; server tests shiftSwaps (9), requestForms (8) and leavePolicyRules, portalEmployeeApp, routeManifest, peopleApprovals, approvalRace, peopleRls, rlsFailClosed, shiftChangeRequests all pass; web suite 76 files / 461 tests pass; screenshots in docs/people/design-v1/evidence/batch6-requests-swap/.
- Next: review fixes.
- Blocked on: nothing. Not built: women's night-work consent check (CLOR keeps no per-person consent record).

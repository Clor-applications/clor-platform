# clor-coder-people — work log

## 2026-10-31 02:00 IST — Design system / buttons — PR #84 review fixes
- Did: the done live region now stays mounted, empty, and only its text changes. Talent drawer forms ignore Enter while busy (22 forms). On white, secondary, soft and ghost icons use a deeper marigold #C98200 (3.2:1 on white), and the spinner on those buttons is ink. DESIGN.md says where 44px on phones is enforced (People already does it under 768px). Legacy dark theme labelled. Added a comment explaining `:is(#main-content, body)`.
- Evidence: web suite 276 files, 1969 passed (2 todo). New talent/shared.test.jsx fails with the guard removed and passes with it. At 390: Employees and drawer buttons all measured 44px, no sideways scroll. test/people-color-twins.test.js passes on this branch, and origin/main has not moved.
- Next: hand back to review.
- Blocked on: nothing

## 2026-10-31 01:45 IST — Design system / buttons — loading and success states, marigold icons
- Did: shared button loading state (`aria-busy`, spinner in the icon's place, width kept, clicks refused, label still read, breathing under reduced motion) and brief success state (`data-state="done"`); `Button` + `useDoneFlash` in Primitives.jsx. Converted Profile (3 hand-rolled spinners), the Talent drawer footer (about 20 drawers), Attendance rules Save, Tags Add (loading + "Added"; no toast fires there). People icons in buttons marigold per the owner, icon-only keeps ink, danger keeps white. DESIGN.md Buttons section and 2026-10-31 decision row.
- Evidence: branch claude/button-states. Web suite 275 files, 1968 passed (2 todo); new buttonStates.test.jsx (9) and Tags.test.jsx (1). eslint on touched files: 0 errors. Browser: 1440 and 390, light and dark, screenshots in the session scratchpad team/buttons-evidence/. Measured: Add stays 102.5px wide in default, loading and done.
- Next: the other ~60 "Saving…" label swaps in People can move to `<Button loading>` screen by screen.
- Blocked on: nothing

## 2026-10-30 06:15 IST — People / Time & Leave — land #46 and #47
- Did: #46 (Joining & leaving) merged into main after conflict fixes (Tasks panel moved to lifecycle pageTasks). #47 (Leave policy rules) merged with origin/main: kept #68's canAct gating in My leave beside hourly leave and preview notes; leave_policy_rules migration renamed to 20261108100000 so it sorts after main's newest (20261107090300).
- Evidence: #46 merge 1367b260. #47 merge commit 3f85d62f. Server leave/portal tests 21 files, 175 passed (connection_limit=5, one worker). `npm run test:web` 1887 passed after the local lucide-react install was brought to the lockfile's 1.61 (the one failure was a stale local 1.41).
- Next: merge #47 when verify/audit/secrets pass; read docs/TEAM.md; People audit batches 5 and 6.
- Blocked on: nothing

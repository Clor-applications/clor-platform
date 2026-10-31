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

## 2026-10-31 — People — PR #80 CI server-tests
- Did: selfService "confirm or dispute last month" failed in CI at 01:21 IST on 31 Oct: the server counts a month's last day as ended (confirmable that evening, since c0687aaa), so this month's canConfirm is true on the last IST day; the test expected false. Not caused by #80 (selfService untouched). Test now expects that on the month's last day. agent.test timeout: flaky, #80 touches no connector code; 3 reruns pass.
- Evidence: reproduced with a fake clock at 2026-10-30T19:51Z (old test fails, new passes; also passes at 1 Nov 01:30 IST and 15 Nov). selfService + attendance suites 127 passed on 5434; agent.test 8/8 three times.
- Next: CI rerun on #80.
- Blocked on: nothing.

## 2026-10-31 00:30 IST — People — PR #80 retest fixes
- Did: F4, the attendance drawer's "Decided by" now comes from the server for this reader: "HR, or you as their manager" when the person's manager (or stand-in) may approve it under an HR chain; the manager's name for manager chains. Drawer facts no longer nest divs in the <dl> (axe dlitem). Phone company menu rows and the Workspace phone bar buttons are 44px.
- Evidence: server peopleE2eFixes/attendanceRequests/timeDepth 55 passed on CI Postgres 5434 (5432 was full); web suite 1979 passed; e2e A4/A4b/A4c both widths; Rahul's drawer checked at 390 and 1440. The F4 tests failed before the fix.
- Next: QA retest of #80. Retest 2: the Workspace phone company menu is pinned to the screen with the 16px gutter (it started at x=-16); A4c checks it.
- Blocked on: nothing.

## 2026-10-30 23:30 IST — People — PR #80 re-review and QA fixes
- Did: Candidates board scrolls sideways on phones (watcher measures any content in .ui-table-scroll), new e2e clipped-list check and T1b; __dirname lint error; published-only readers get only employee-app fields. Manager QA: bell panel inside the screen on phones, Approvals and the bell name the half, Leave calendar draws half days as half a cell. HR/owner QA: grown card width, phone company choice moved into the app menu (A4b), row menus named by row name not id, 44px phone tick box, Announcements "For" from audience ids, empty Gender mix label.
- Evidence: web tests (test/ folder), server peopleE2eFixes + timeLeave, e2e T1b/H12/A4/A4b both widths on 4019/5199, browser checks at 390/700/1440. Each new test failed before its fix.
- Next: QA retest of #80. Re-review fixes: Workspace phone company button (A4c), grouped phone company menu, reader-only details stripped, 16px bell gutter.
- Blocked on: Salary revisions "New revision" reason is in apps/payroll (not People's to edit).

## 2026-10-30 06:15 IST — People / Time & Leave — land #46 and #47
- Did: #46 (Joining & leaving) merged into main after conflict fixes (Tasks panel moved to lifecycle pageTasks). #47 (Leave policy rules) merged with origin/main: kept #68's canAct gating in My leave beside hourly leave and preview notes; leave_policy_rules migration renamed to 20261108100000 so it sorts after main's newest (20261107090300).
- Evidence: #46 merge 1367b260. #47 merge commit 3f85d62f. Server leave/portal tests 21 files, 175 passed (connection_limit=5, one worker). `npm run test:web` 1887 passed after the local lucide-react install was brought to the lockfile's 1.61 (the one failure was a stale local 1.41).
- Next: merge #47 when verify/audit/secrets pass; read docs/TEAM.md; People audit batches 5 and 6.
- Blocked on: nothing

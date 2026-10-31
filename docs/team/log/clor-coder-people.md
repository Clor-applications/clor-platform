# clor-coder-people — work log

## 2026-10-31 02:00 IST — People / Leaving and engagement — #81 pre-merge nits
- Did: a withdrawn exit interview's round is now max(round)+1 for that person and last day (lock per person in the withdrawal's transaction, one retry on a unique clash), not epoch seconds: no 500 on two withdrawals in one second, no 2038 overflow. Migration 20261114090400 edited in place (unmerged) to number existing withdrawn rows 1..n.
- Evidence: leavingEngagement.test.ts 83 passed (new double-withdrawal test fails on the old code); migration run twice as clor_app on 5434, same result both times; drift check clean; 14 related suites 75 passed on 5434 (5432 was full; one earlier run had a file fail in setup, the rerun passed); tsc clean.
- Next: merge by the coordinator.
- Blocked on: nothing

## 2026-10-31 — People — PR #80 CI server-tests
- Did: selfService "confirm or dispute last month" failed in CI at 01:21 IST on 31 Oct: the server counts a month's last day as ended (confirmable that evening, since c0687aaa), so this month's canConfirm is true on the last IST day; the test expected false. Not caused by #80 (selfService untouched). Test now expects that on the month's last day. agent.test timeout: flaky, #80 touches no connector code; 3 reruns pass.
- Evidence: reproduced with a fake clock at 2026-10-30T19:51Z (old test fails, new passes; also passes at 1 Nov 01:30 IST and 15 Nov). selfService + attendance suites 127 passed on 5434; agent.test 8/8 three times.
- Next: CI rerun on #80.
- Blocked on: nothing.

## 2026-10-31 01:15 IST — People / Leaving and engagement — #81 retest fixes
- Did: N1 a new leaving always gets a fresh exit interview: a withdrawn one takes its own round (ExitInterview.round, unique per person, last day and round; migration 20261114090400, safe to rerun, run as clor_app), so the same last day no longer brings old answers back and the withdrawn one is counted once; the exit reminder skips withdrawn rows. N2 signed, answered and outcome dates on the plan read as the India day. N3 the report lists months that have only people who stayed.
- Evidence: leavingEngagement.test.ts 82 passed (2 new); 14 related server suites 75 passed; web 47 passed (2 new); tsc, eslint, drift check clean. Browser as HR at 1440 and 390 on 5191/4021: same-day re-record shows "Not answered yet"; a line signed at 01:00 IST reads 31 Oct; report lists Dec with Stayed 1.
- Next: QA retest of #81.
- Blocked on: nothing

## 2026-10-31 00:45 IST — People / Leaving and engagement — #81 QA fixes and re-review
- Did: QA (manager, employee, HR, owner) and the a300cb7a..eebafd40 re-review on #81, in worktree coder81-fix. Line owners and HR sign on a view-only screen; HR picks owners by name (GET /people/assignees); a moved last day reopens this stint's paid final-wages step only (a correction after leaving moves dates, keeps it paid); a withdrawn leaving's steps get their own kind (migration 20261114090300 moves every step of a withdrawn leaving by stint, safe to rerun, run as clor_app on 5434); greetings opt-out on the record, HR only; the 20:00 cut-off applies to greetings only and final pay catches up a missed notice; report counts on-notice months and anyone who stayed; plan header and body follow "They stay"; money, copy and 44px phone targets.
- Evidence: leavingEngagement.test.ts 80 passed (each new test fails on the code before its fix); 13 related server suites 70 passed; web 45 passed; tsc, eslint, drift check clean. Browser as HR at 1440 and 390 on 5191/4021; screenshots in the coordinator scratchpad team/coder81-fix-evidence/.
- Next: QA retest of #81.
- Blocked on: nothing (owner decision pending on whether Viewer and IT Administrator see leavings)

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

## 2026-10-30 19:40 IST — People / Leaving and engagement — review fixes for #81
- Did: all 4 blockers, 9 should-fixes and the nits from the #81 review (restart after the earlier run hit a usage limit; its uncommitted work kept and checked against the brief). Exit interview and line money limited to HR, the reporting line and the line owner; reasons report HR only; nobody signs or decides on their own leaving; lines and interviews follow a moved last day and close on withdrawal; ticked "Final wages paid" clears the clock; reminders once each; failed runs retried without sending twice. schema.prisma reformatting dropped; codeOf moved to its own module; "managers" copy made consistent.
- Evidence: leavingEngagement.test.ts 59 passed (26 new ones all fail on the unfixed code); web Engagement (portal and People) and LeavingExtras 24 passed (8 new ones fail without the UI fixes). tsc and eslint clean. Browser on 5190/4010 at desktop and phone: HR Home, HR plan, manager list and hidden interview, IT plan with no money or interview; evidence/leaving-engagement/ retaken.
- Next: code review and QA on #81.
- Blocked on: nothing

## 2026-10-30 06:15 IST — People / Time & Leave — land #46 and #47
- Did: #46 (Joining & leaving) merged into main after conflict fixes (Tasks panel moved to lifecycle pageTasks). #47 (Leave policy rules) merged with origin/main: kept #68's canAct gating in My leave beside hourly leave and preview notes; leave_policy_rules migration renamed to 20261108100000 so it sorts after main's newest (20261107090300).
- Evidence: #46 merge 1367b260. #47 merge commit 3f85d62f. Server leave/portal tests 21 files, 175 passed (connection_limit=5, one worker). `npm run test:web` 1887 passed after the local lucide-react install was brought to the lockfile's 1.61 (the one failure was a stale local 1.41).
- Next: merge #47 when verify/audit/secrets pass; read docs/TEAM.md; People audit batches 5 and 6.
- Blocked on: nothing

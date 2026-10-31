# clor-coder-people — work log

## 2026-10-31 13:00 IST — People / Company choices (workflow engine spec, phase 1a)
- Did: settings 2, 3, 5 and 6 of docs/people/workflow-engine/DECISIONS.md as company choices on PeopleSetting (migration 20261115090000_company_choices; platform Notification.subjectKey, 20261115090000_notification_subject_key). GET/PUT /people/company-choices (services/people/companyChoices.ts): defaults keep today's behaviour, approval choices by Approvals EDIT with company-wide scope or an admin, pay and privacy choices by the owner or an admin only, COMPANY_SETTING / CHANGED audit with before and after. 2: "HR or the manager, whoever is first" (today's HR, the default; Attendance's own column is read when People has not chosen), new strict "HR only" refuses a manager or team-scoped approver (HR_ONLY), keeps them out of the inbox and the employee app's queue and notices; the Attendance app choosing again wins. 3: HR without Payroll access reads salary revisions read only (People → Salary revisions, GET /people/salary-revisions, menu via my-access), audited once a day per reader; Payroll's routes untouched. 5: Viewer, IT administrator and team managers no longer see the typed reason for leaving by default (Leaving list, record, list, history, journey, why); the owner can show it, or keep the Leaving list from read-only users (team managers keep their team). 6: a withdrawn approval, attendance or leave request's "waiting for you" notice reads "Withdrawn: …", is marked read and opens the closed request (Approvals ?open=APPROVAL&id=), or is removed. Screen: Settings → Company choices.
- Evidence: server peopleCompanyChoices.test.ts 11 passed; 19 related suites (attendance requests, lifecycle, leaving, approvals, notifications, outbox, journey, people, time depth, e2e fixes, route manifest, RLS, attendance rules, leave, access visibility, privacy, leaving engagement) 327 passed on CI Postgres 5434 after updating the my-access shape; web CompanyChoices.test.jsx 6, Approvals.test.jsx 4; tsc clean; drift check clean on 5434. Browser on own API 4047 / web 5227 (DB clor_six_settings_browser on 5434; 5432 was full) at 1440 and 390: owner saves choices, HR reads revisions, Viewer sees the leaving without the reason, bell shows "Withdrawn" and opens the closed request.
- Next: review and QA. Setting 1 (late-mark cut) in its own PR.
- Blocked on: nothing. Setting 4 is the Payroll lane's.

## 2026-10-31 19:45 IST — People / Late-mark cut — PR #89 re-review
- Did: "rounded" now rounds each mark DOWN to 15/30/60 minutes (TIME_MISSED_ROUNDED_DOWN; a 20-minute late under 15 cuts 15, 10 minutes cuts nothing); migration 20261115090000_late_cut_round_down rewrites saved settings and rule versions (bypass, idempotent) and the old value reads as round-down. A "this month" save while a next-month change waits is stored as two versions, so this month never gets next month's change; versions count from their `from` or save day. The Attendance app's first number change on a company People never saved records a baseline version (this month and undecided months keep the old rule), checks the whole-company scope with no settings row, and writes an audit line; People's general audit line carries `from`. Screen: the "Late-mark change counts" choice sits in the late-marks section; captions per mode; Attendance "Changes to the rules" reads field by field.
- Evidence: lateMarkCut.test.ts 24 passed (property test over 2000 random months: no mode but the warned step rule cuts more than the time missed; 10 Oct/20 Oct layering; baseline; no-row guard; audits; migration run twice as clor_app). 9 related suites 147 passed on 5434. Web 292 files, 2102 passed. tsc, eslint clean. Browser 1440 and 390 on API 4018 / web 5198 (own DB on 5434, dropped after): no sideways scroll; screenshots in docs/people/evidence/late-mark-cut/.
- Next: review.
- Blocked on: nothing.

## 2026-10-31 18:45 IST — People / Late-mark cut — PR #89 review fixes
- Did: minute cuts round DOWN to the 0.01 day in both minute modes (65/480 is 0.13, never 0.14); one day's late + early cuts together capped at one day. The Attendance app's two numbers change the numbers only: versioned as "Attendance rules" from next month, company-wide guard, and refused (409 LATE_RULE_IN_PEOPLE) under a minute cut, where the app now shows People's rule in words (its cut, cost and free count come with GET /attendance/rules). Leave covers whole half days only; the rest is unpaid, said in the "Take it from" caption. A late-mark change counts from next month by default (`from` on the version; marksRulesOn honours it); "From this month" is a choice on the rules screen with a warning; the lateMarkCut audit names the date.
- Evidence: lateMarkCut.test.ts 18 passed (s.20 bound swept over minutes and day lengths, per-day cap, half-day leave split, pre-#89 version without cutMode still ½ day, next-month vs this-month, Attendance app numbers both ways); related suites on 5434 (see PR); web 289 files, 2064 passed (new Attendance rules test in the Attendance app, two new People tests); tsc and eslint clean. Not looked at in a browser this round.
- Next: review.
- Blocked on: nothing.

## 2026-10-31 14:30 IST — People / Late-mark cut (workflow engine spec, phase 1b)
- Did: setting 1 of docs/people/workflow-engine/DECISIONS.md. Marks rules get `cutMode` (TIME_MISSED, TIME_MISSED_ROUNDED with `roundToMinutes` 15/30/60, HALF_DAY_PER_N) in AttendanceSettings.timeRules.marks, versioned with the rule (a month keeps the rule of its last day). Time missed = each counted mark's whole minutes over the shift's full-day minutes, after the free marks and the grace; rounded up per mark when chosen. Defaults per owner (31 Oct): a company not yet using late marks gets time missed; a company already on late marks (saved marks on, or the Attendance app's two numbers) keeps every N = ½ or 1 day with its numbers. The step rule shows a warning (s.20) and Late marks and the preview show each person's time missed beside the cut. Under a minute cut the Attendance app's step numbers read 0. COMPANY_SETTING / attendance.lateMarkCut audit with before and after. Save stays refused for team-scoped roles (Team Manager holds APPROVE; the handler's company-wide scope check refuses it, now tested with a custom team-scoped approver too); canEdit also needs the right.
- Evidence: lateMarkCut.test.ts 10 passed (modes, rounding, free, grace, shift minutes, defaults for new and existing companies, payable days, preview, audit, refusals); attendanceRules, payrollPeopleHandoffs, payrollHandoffReview, routeManifest, timeDepth, selfService, payrollFromLeave, peopleE2eFixes: 139 passed on 5434 (existing tests now name the half-day mode they rely on). Web time screens 10 passed, full web suite 2060 passed. tsc, eslint clean. Browser 1440 and 390 on API 4047 / web 5227 (own DB on 5434): time-missed default, step rule warning with ½ day beside 1 h 30 min, September at 0.19 day.
- Next: review and QA.
- Blocked on: nothing.

## 2026-10-31 18:45 IST — People / Add employee — Continue before the suggested ID arrives
- Did: the Employment step's Continue now waits for the suggested employee ID if it is still on its way (one Continue at a time; uses what is on screen after the wait; does nothing if the person went Back meanwhile), and the stale "Enter an employee ID." goes when the ID arrives. Form is `noValidate`: the browser's own required-field popup stopped Continue before our check ran. A failed suggestion still asks for an ID.
- Evidence: new AddEmployee.test.jsx (4): the wait and the failed-suggestion tests fail on the old code, all pass on the new. Web suite 290 files, 2092 passed (2 todo). eslint clean. e2e H1 passes at desktop and phone (ports 5200/4020, DB clor_e2e_addemp). Old code also passed H1 phone twice locally, so the race is timing-dependent here; the unit test pins it.
- Next: review.
- Blocked on: nothing

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

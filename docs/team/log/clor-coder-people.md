# clor-coder-people — work log

## 2026-10-30 23:30 IST — People — PR #80 re-review and QA fixes
- Did: Candidates board scrolls sideways on phones (watcher measures any content in .ui-table-scroll), new e2e clipped-list check and T1b; __dirname lint error; published-only readers get only employee-app fields. Manager QA: bell panel inside the screen on phones, Approvals and the bell name the half, Leave calendar draws half days as half a cell. HR/owner QA: grown card width, phone company choice moved into the app menu (A4b), row menus named by row name not id, 44px phone tick box, Announcements "For" from audience ids, empty Gender mix label.
- Evidence: web tests (test/ folder), server peopleE2eFixes + timeLeave, e2e T1b/H12/A4/A4b both widths on 4019/5199, browser checks at 390/700/1440. Each new test failed before its fix.
- Next: code review of #80.
- Blocked on: Salary revisions "New revision" reason is in apps/payroll (not People's to edit).

## 2026-10-30 06:15 IST — People / Time & Leave — land #46 and #47
- Did: #46 (Joining & leaving) merged into main after conflict fixes (Tasks panel moved to lifecycle pageTasks). #47 (Leave policy rules) merged with origin/main: kept #68's canAct gating in My leave beside hourly leave and preview notes; leave_policy_rules migration renamed to 20261108100000 so it sorts after main's newest (20261107090300).
- Evidence: #46 merge 1367b260. #47 merge commit 3f85d62f. Server leave/portal tests 21 files, 175 passed (connection_limit=5, one worker). `npm run test:web` 1887 passed after the local lucide-react install was brought to the lockfile's 1.61 (the one failure was a stale local 1.41).
- Next: merge #47 when verify/audit/secrets pass; read docs/TEAM.md; People audit batches 5 and 6.
- Blocked on: nothing

# clor-code-reviewer

## 2026-11-05 IST — Attendance — review of #130 b1ea41bf (month close and Exceptions past 500)
- Did: reviewed; request changes: no team scope on Exceptions, month close or bulk; bulk overwrites colleagues and overstates count; whole state table loaded; uncompressed 1.8 MB answer; stale kind answer; no bulk progress lock.
- Evidence: web 8/8 passed; server test not run (Postgres too many clients); CI pending. Entry added by clor-coder-time for the reviewer.
- Next: coder fixes; re-review.
- Blocked on: nothing.

## 2026-11-04 IST — People — re-review of #123 63eeccd6
- Did: re-reviewed the colour fixes; not ready: Home's waiting panel clay while Announcements/Celebrate marigold; JSX still picks tints by index (news, events, org cards, org chart, structure), so a department changes colour per screen; faces include a marigold hue.
- Evidence: CI green; 83 tests passed; Payroll Salary revisions 0 pixels differ at 1440 and 390; contrast 5.53–8.98:1; no sideways scroll at 390.
- Next: coder fixes; re-review.
- Blocked on: nothing.

## 2026-10-31 IST — People — review of #81 a300cb7a..eebafd40
- Did: reviewed #81 a300cb7a..eebafd40 (13 QA fixes), ready for QA retest; 4 should-fix (lastDayMoved reopens prior-stint wages, 20:00 cut-off drops final-pay notices, celebrations PUT not hrOnly, migration leaves done withdrawn steps).
- Evidence: 74+33+33 tests green, migration safe to rerun as clor_app, no drift.
- Next: QA retest of #81.
- Blocked on: nothing

## 2026-10-30 IST (time not recorded) — Payroll — re-review of #82
- Did: Re-review #82 at 644878d3: 6 blockers fixed (6 partly); new blocker pool-of-1 calculate; should-fix recalc-vs-paid race, statutory gate gap, new draft not stale; 527 tests pass on 5434.
- Evidence: pool-of-one probe (vitest.pool1.config.ts, log rev82-pool1.log: calculate 500 after 10.1s, in the reviewer's scratch folder). Entry added 31 Oct 00:15 IST by clor-coder-payroll for the reviewer, who could not write to the repo.
- Next: review the fixes for these findings.
- Blocked on: nothing

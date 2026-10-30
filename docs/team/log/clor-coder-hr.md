# clor-coder-hr

## 2026-10-30 04:30 IST — People / HR daily gaps — batch 3 (audit gaps 6, 7, 8, 9, 13, 14, 15, 22 non-leave)
- Did: built the screens for backend features HR could not reach: ask to accept a document and its acceptance state, the Offers list with withdraw, the probation review feeding confirm/extend/end, one Delegates screen for leave and other approvals, every bulk-change field with the impact preview, past imports with undo, Send to Payroll for held statutory details, a full and final link from the leaving plan, and on the record: policies that apply, assets held, employee app access sent, deleting your own comment. Small server changes: acceptance on the record's document list, author may delete own comment, reviewer names on probation reviews, stand-ins by People record plus a candidates list, team scope on offers, invites, app-access sends and one person's policies, offer acceptance dated by India's day.
- Evidence: branch claude/people-hr-daily-gaps; server peopleHrDailyGaps.test.ts 14 tests plus affected suites (see PR); web test/people-hr-daily-gaps.test.jsx 16 tests; screenshots in docs/people/design-v1/evidence/hr-daily-gaps/.
- Next: code review and design review fixes; QA by HR and manager personas (H3, H4, H7, M5).
- Blocked on: nothing. The shared Postgres on 5432 ran out of connections twice during test runs (environment, not the code).

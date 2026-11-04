# clor-coder-platform

## 2026-11-05 IST — Platform / two radii in every app (design audit Q12)
- Did: platform radius tokens set to DESIGN.md's two radii (8px clickable, 12px content, KPI cards included); Tailwind `rounded-lg`/`rounded-xl` read the tokens; 40 literal radii in `index.css` and 27 off-scale classes or inline radii in Accounting, Attendance, Admin and shared UI brought onto the scale. Keycaps, printed documents and drawn data marks kept, each listed in the new test. `people.css` untouched.
- Evidence: branch `claude/platform-radii`; `test/radius-tokens.test.js` (7 tests, mutation-checked); web suite 301 files, 2196 passed; eslint 0 errors on touched files; before|after pairs for each app's home, one list and one drawer at 1440 and 390 in `docs/platform/evidence/radii-2026-11-04/`.
- Next: hand to code review and design review; rebase if `claude/people-audit-blockers` lands first (no overlap in files).
- Blocked on: nothing.

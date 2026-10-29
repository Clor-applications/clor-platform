# clor-coder-talent

## 2026-10-30 04:10 IST — People / Talent — batch 1 (audit gaps 1, 2, 11, dead code)
- Did: Talent screens on `/people/talent/*` (Job openings with apply link, Candidates list and board with the candidate drawer, Interviews and feedback, Goals and check-ins, Reviews with calibration, One-on-ones, Improvement plans, Training with seats, certificates and Expiring); Growth section in the employee app (My goals, self-review, acknowledge); register retired for the four kinds; notification links carry their params through the bell; `GET /talent/interviewers`; dead StructureList / EmployeesList / Designations exports removed.
- Evidence: branch `claude/people-talent-screens`; server `peopleTalent.test.ts` + `routeManifest.test.ts` 15 passed; web `people-talent`, `people-audit-guards`, `people-navigation`, `portal-employee-app` and 12 layout/guard suites 136 passed (1 pre-existing Accounting failure in quiet-emphasis); browser run at 1440×900 and 390×844, screenshots in `docs/people/design-v1/evidence/talent/`.
- Next: code review and designer pass; fix findings.
- Blocked on: Team Manager role template lacks `PEOPLE::Performance::VIEW` (batch 2 owns `permissionCatalog.ts`); `/portal/hr-cases` dead routes left because `portal.ts` is in PR #47.

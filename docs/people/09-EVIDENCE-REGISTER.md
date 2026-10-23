# Clor People: evidence register

Updated: 24 Oct 2026. Format from `tenant-platform-upgrade-2026-10-23/EVIDENCE_REGISTER.md`. Never copy secrets or real employee data into this folder.

| Evidence ID | Claim supported | Source or command | Result |
|---|---|---|---|
| PEV-001 | Baseline People-related server suites, parallel run | `cd server && npx vitest run src/__tests__/{people,peopleHire,peopleHome,peopleWorkspace,checklists,dataHealth,dataExport,anonymiseEmployee,hrConnections,hrLeave,hrWorkflowFixes,leave,leaveAccrual,leavePeriod,payrollEmployeeDelete,payrollFromLeave,portalHrCases,tenantIsolation,tenantBackstop,tenantScope}.test.ts --reporter=json` | 20 files, 137 tests: 131 pass, 6 fail. All six: `Too many database connections opened: FATAL: remaining connection slots are reserved` (shared local Postgres). Report: `evidence/PEV-001/baseline-tests.json` |
| PEV-002 | The six failures are environmental | same three files with `--no-file-parallelism` | 3 files, 40 tests, 40 pass. Report: `evidence/PEV-002/rerun-tests.json` |
| PEV-003 | Baseline commit and branch | `git rev-parse HEAD`; `git branch --show-current` | `0d054e5` on `claude/people-build-03ca03`, cut from the tenant-security branch; working tree clean at start |
| PEV-004 | R-01 document access by any Employees VIEW role | `server/src/routes/people.ts:1019-1024` (GET document checks only `can(VIEW, EMPLOYEES)` and company); `server/src/constants/permissionCatalog.ts:679` (Attendance Manager preset includes `PEOPLE::Employees::VIEW`) | Confirmed by reading; no test exists (to be written as the failing test for PC-DOC-01) |
| PEV-005 | R-03 rehire loses first joining date | `packages/ui/src/personnel/Employees.jsx:453` (`rehireEmployee(person.id)` sends no date); `server/src/routes/personnel.ts:222` (`dateOfJoining: parsed.data.rejoinDate` overwrites) | Confirmed by reading |
| PEV-006 | R-11 directory cap | `packages/ui/src/personnel/Employees.jsx:150` `limit: 500`, no paging | Confirmed by reading |
| PEV-007 | Import drops phone (parked PX-02) | `apps/attendance/src/screens/DataImport.jsx:47` sends `workPhone`; `server/src/routes/people.ts:659` import schema reads `phone` | Confirmed by reading |
| PEV-008 | Payroll reads live attendance, not the snapshot (parked PX-01) | `server/src/routes/payrollRuns.ts:400` (`periodRows`), `:442-451` (snapshots listed as metadata only) | Confirmed by reading |
| PEV-009 | People CSS overrides the base type scale and radii | `packages/ui/src/index.css:6604-6606` (`main` font-size), `:6618-6622` (title 22px / 650), `:6641-6645` (section 15px / 600), `:6667-6670` and `:6688-6690` (6px radius); base `:2886-2899` (28/700, 16/700) | Confirmed by reading; 59 `[data-app='people']` selectors, 26 `!important` in the block |
| PEV-010 | People's palette is Blaze with colour icons | `apps/people/manifest.jsx:182-183` (`palette: 'blaze'`, `iconSet: 'color'`); `packages/ui/src/index.css:7170` | Confirmed by reading |
| PEV-011 | One Employee table shared by People, Attendance and Payroll references | `server/prisma/people/schema.prisma:36-164`; Payroll holds `employeeId` as plain string (`server/prisma/payroll/schema.prisma:69-107`) | Confirmed by reading |
| PEV-012 | Compliance facts and dates | `docs/people/sources/india-compliance-research-2026-10-24.md` (60 source links) | Each matrix row in 05 cites its row there; uncertain items marked U |
| PEV-013 | A-35 fail-closed RLS merged before any server code | `git merge --no-edit 98d0bf3` → `8971c19`; `git merge-tree` showed 0 conflicts | Branch now carries `20261024100000_rls_fail_closed` for all four schemas and the strict `tenantScope.ts`; People suites after the merge: see PEV-014 |
| PEV-014 | People and tenant suites pass on the merged branch | `npx vitest run src/__tests__/{people,peopleWorkspace,checklists,tenantScope,tenantIsolation}.test.ts --no-file-parallelism` | 5 files, 54 tests, 54 pass. Report: `evidence/PEV-014/post-merge-tests.json` |

## Evidence quality note

Code claims above are from reading the source at `0d054e5`; none has yet been shown in the browser. Browser evidence is added per checklist row under `docs/people/evidence/<ID>/`. Compliance facts come from official and law-firm sources listed in the research file; items marked uncertain there are marked U in the matrix and must be checked by a named person before they drive any product logic (COMP-05).

## Reproduction

```bash
cd server
npm run prisma:generate
npx vitest run src/__tests__/people.test.ts src/__tests__/peopleWorkspace.test.ts --no-file-parallelism
```

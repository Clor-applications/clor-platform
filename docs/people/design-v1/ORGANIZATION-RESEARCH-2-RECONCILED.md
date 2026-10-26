# Organization: repo-aligned research, checked against our build (26 Oct 2026)

Source: `Clor_Organization_Repo_Aligned_Research_2026-10-26.zip` (owner). It audits
`main@0bdc855`, before the Organization module was built on `claude/people-build-03ca03`,
so most of its gaps were already closed here. Each requirement was checked against the
code on this branch. Done before this pass is **Built**. Done in this pass is **Fixed now**,
with a test in `peopleOrganization.test.ts`. Left out on purpose is **Declined** or
**Other module**.

## Fixed in this pass

| Research ID | What was still missing | Fix |
|---|---|---|
| G01 / R001, R011 | Org chart sent every open position (team, lead, budget reference) to a team-limited viewer | A team-limited viewer gets positions only on teams their own people lead, and never a budget reference |
| G07 / R025, R026 | No "as of" on the chart | `GET /org-chart?asOf=YYYY-MM-DD`, using the same history roll-back as the directory. People who left since come back, people who joined later drop out, and open positions (today's) are left out. "As of" date and a "Today" button on the chart |
| G04 / R006–R009 | Delete looked only at people | Refused while sub-departments, teams, designations, positions, job roles or child locations still sit under it ("Still under it: …"). The row menu hides Delete for a department or location with children |
| G03 / R018 | A retired item could be chosen as a new parent or link | Refused ("X is retired. Bring it back first, or choose one in use."); a link that was already there may stay |
| R033 | A rename copied the new name onto people's records outside the save | Same transaction |
| R035 | A position left on a retired team was not flagged | Structure check "Position on a retired team" |
| R050 | A department's count did not say whether sub-departments were included | Counts are direct. A parent also shows "N with sub-departments", and the overview count says "directly in" |

## Already built before this pass

R002 chart grant matches the API (Employees VIEW on both) · R003–R005, R012 links checked
same-company, cycle-safe to any depth · R010 unchecked boxes saved as `false` · R013 PAN
masked in list, save responses and history · R016 People entitlement and Detailed
structure gate · R017, R046, R047 drawer errors keep input, unsaved-change guard, shared
error states · R019, R020, R027, R028 Organization group on the split sidebar, stable
screen keys, Settings points to the same screens · R021–R023 open positions on the chart,
search, expand / collapse with counts · R029, R030 team lead and position designation
pickers · R031, R032, R055 every structure and branch change under Changes (actor,
reason, correlation; names only) · R034, R036 structure checks with Fix links · R037
moves go through the one employee write path · R038–R040 change preview, approvals and
outbox (Workforce) · R042 Works at (branch) vs Location vs Work site kept apart · R044
chart is three queries, no per-person lookups · R048 PopupSelect and SuggestInput
keyboard contract · R049 phone layouts checked · R052, R063 scoped export, saved views
and columns · R053, R061 department head is a label, never a permission; employee app
shows it · R054 retire keeps history · R014 People tests pass.

## Finished after the first check

| ID | Built |
|---|---|
| R024 Accessible tree keys | Both chart views are a WAI-ARIA tree (`useTreeKeys`): one tab stop; ↓ ↑ walk, → opens or goes to the first child, ← closes or goes to the parent, Home / End, Enter opens the person, a letter jumps. The focused row carries the ring. axe: no violations |
| R043 Chart at 1,000 people | Test: 1,000 people and 500 open positions answer in one request, about 90 ms and 280 KB (as of a date: about 90 ms; team-limited: about 80 ms). In the browser, search narrows the chart in about 85 ms, Expand all and Collapse all take about 150 ms, and opening one row about 5 ms. A chart over 200 people now opens two levels deep instead of all rows |
| R056 Moving a department | The edit drawer shows "What changes" before saving: from and to, what moves with it, how many people are affected, that managers and approvals do not change, and an optional reason that goes into Changes |

## Declined, with reasons

| ID | Reason |
|---|---|
| R015 Staging RLS check | No staging environment in this worktree; RLS is tested in `peopleRls.test.ts` |
| R045 Lazy-loaded chart | A small business chart is one small payload; adds complexity for no current customer |
| R051 Vacancy / structure reports | Counts are on the overview, vacancies on the chart; reports belong to the Reports work |
| R057, R058, R059, R060, R064 Batch restructures, versioned department parents, scenario planning, approval of structure moves | Already declined in ORGANIZATION-DECISIONS (a 20-person firm rarely reorganises; the change history answers "what changed when"; approvals stay on employee changes) |
| R062 Per-app delivery receipts | Apps read the record directly (Workforce decision) |
| R065 State rule versions | No rule tables in Organization (decision); state is a field the owning apps read |

## Other module

R041 People cost centre ↔ Books / Payroll mapping: waits for Accounting and Payroll
(TRACKER, waiting for other modules).

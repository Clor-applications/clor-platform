# Organization module audit (26 Oct 2026)

Scope: every Organization screen (Overview, Departments, Designations, Branches,
Work sites and the other Detailed lists, Org chart, Changes) and the Workforce
screens that carry the branch. Checked in the browser at 1366 px and 390 px,
axe (WCAG 2 A/AA) on seven screens, and read from six angles plus a final
automation and workflow pass. Every finding below is fixed unless marked.

## Browser and accessibility (O.5)

| # | Finding | Fix |
|---|---|---|
| V1 | Changes: the "Show" picker read "Select" with everything shown | "Everything" is a real option (`all`) |
| V2 | Directory's default Location column was "—" for everyone once Locations moved under Detailed | "Works at" (branch) column by default; Location still available, hidden by default |
| V3 | Record: "Works at" sat below Location | Placed right after Department and Designation |
| V4 | Overview on a phone: "No head" floated a full gap below the department name | Tighter row gap on phones |
| V5 | Departments on a phone: a bare "—" under each name | "No head", muted, the same words as the overview |
| V6 | Org chart, department view: caption "People not in a department" repeated the row's own name | Removed |
| V7 | Org chart print: expand chevrons and breadcrumb printed | Hidden on paper |
| V8 | Branch drawer: the code looked editable, but Accounting fixes it after creation, so a change was silently dropped | Read-only on an existing branch |
| A1 | axe on Overview, Departments, Designations, Branches, Work sites, Changes, Org chart | 0 violations |

No horizontal scroll at 390 px on any screen.

## Angles (O.6)

**Owner / CEO.** One page answers "how is my company set up": departments
under their heads, branches with their people, what needs fixing. "Without a
manager" sits beside "without a department". Print / save the chart as PDF.

**HR.**
- H1. Retiring a branch people work at stranded them at a branch no list
  offered. The branch form now refuses (409, with the count), and People →
  Branches asks "Move them to", moves each person through the one write path
  (history: "<branch> retired"), retargets dated moves into it, then retires
  it. The structure check "Retired, but people are still in it" now covers
  branches retired some other way.
- H2. Branch adds, renames and retirements never reached Changes, and the
  Changes "Branches" filter was refused as an unknown list. Every branch
  save (Accounting's form or People's) now writes a history line; the filter
  works; the branch row menu has History.

**Manager.** A new manager takes over requests waiting on a manager step
(logged, notified). Team-limited viewers see their own counts and only person
rows in the checks.

**Employee.** The employee app shows "Works at", "Reporting manager" and
"Department head" (not themselves, not someone who left).

**IT / security.** Branch retire needs the branch-setup grant, the right to
move people and whole-company scope. Structure history carries names only, no
personal details. New routes inside the existing People router guards.

**Product.** Small company default: Structure + Branches only; Work sites,
Locations, Teams, Positions, Business units, Grades, Cost centres and Job roles
behind Detailed structure, switched on automatically for companies already
using any of them.

## Automation and workflow

| Event | What happens on its own |
|---|---|
| Hire into the only open branch | Branch set (`fillSoleBranch`) |
| First person placed in a new state | HR task: register PT, LWF, establishment, holiday list |
| Manager changed (form, bulk, dated, approval) | Waiting manager steps move to the new manager |
| Department head or team lead resigns / leaves | Leaving plan gets "Choose who heads <dept> / leads <team>" (new, W-O1) |
| Head or lead has left | Structure check flags it until a new one is chosen |
| Department retired or merged | People and what sits under it move, each in their history |
| Branch retired | People move first (new, H1) |
| Any structure or branch change | One line under Changes |

## Also fixed in passing

- Approval steps of one order are returned oldest first. A step asked again
  after "more information" could come back before the one it replaced; three
  approvals tests failed only when run with the whole People suite.

## Open, for the owner

- Rename "Job role" to avoid confusion with access roles ("Specialisation",
  "Duty", or keep). Answer pending.
- Plan decision: `peopleOrgDetail` added to the People CORE tier in
  `appCatalog.ts`.

# Organization: what we build, what we take from the research, and why

Source: `Clor_Organization_Deep_Research_2026-10-26.zip` (owner, 26 Oct 2026), used as
reference, not as a spec (owner: "choose what to build and what is best for our setup").
Filter: CLOR sells to small businesses first — often one owner doing HR, payroll and
attendance with one sign-in. Every idea was checked against the current code.

## What exists before this work

Departments (nested, cycle-safe), designations, job roles, teams, positions, locations,
work sites (with state), business units, grades, cost centres and the legal company each
have a list under Settings (about 13 entries). Renaming keeps the record and renames what
files display; a list in use cannot be deleted. Workforce already gives dated moves, a
person as of any date, manager-exit repair, an honest change preview, Data Health with fix
links, import with check and undo, and an org chart with open positions.

## The module

Organization is its own module on the rail, after Workforce. It answers one question for
the owner: **how is my company set up, and who runs what.**

| Screen | Why it is there |
|---|---|
| Overview | The whole company on one page: branches, departments under their heads, how many people where, and what needs fixing in the structure. The owner's question, answered without opening thirteen lists. |
| Departments | The list people use most: head, parent, people; edit, merge, retire with people moved. |
| Designations | Job titles; job roles inside them when detailed structure is on. |
| Branches & work sites | Where people work. Branch is the company's registered place (GST, holidays in Attendance follow it); a work site is the place in labour law (its state decides Professional Tax and Shops & Establishments rules). Most small firms have one of each; both are shown together so they are never confused. |
| Org chart | Moved here from Workforce: reporting lines, and a department view (who sits where under which head). |
| Changes | Every structure change: who renamed, merged, retired or moved what, and when. |

**Detailed structure** (one switch, off for a new company, on automatically for a company
that already uses any of these): teams, positions, business units, grades, cost centres,
job roles, locations. A 15-person shop never sees them; a 150-person firm turns them on.

Employment types, work modes, tags and custom fields stay in Settings: they describe a
person's terms, not the company's shape.

## Adopted from the research

| Research idea | In our code | Built as |
|---|---|---|
| One place for the organization | 13 Settings entries | The Organization module above |
| Department head, descriptive only (D04: no approval rights from a title) | Teams had a lead; departments had none | Head on each department; never a permission |
| Structure change history (ChangeLedger) | Structure edits wrote nothing | Every create, rename, edit, move, retire, merge logged and listed under Changes |
| Merge (and rename keeps id) | Rename kept id; no merge | Merge moves people, sub-departments and teams into the survivor, retires the duplicate, logged |
| Retiring a department with people | Allowed silently; people left in a hidden department | Refused unless the people are moved; the drawer asks where |
| Structure Health (deterministic, explainable) | Data Health had people checks only | Structure checks in the same Data Health list: no head, head who left, retired department with people, near-duplicate names, team lead who left, people without a branch where there are several |
| Department view of the chart / Responsibility Finder (lightweight) | Reporting chart only | Department view; the employee app shows "your department head" beside the manager |
| Branch vs work site vs location kept separate (D03) | Branch stored on the employee but never shown or set | Branch on the record, the hire form, transfers, the directory filter, import and export; branches listed with their people |

## Declined, and why

| Idea | Reason |
|---|---|
| Valid-from/valid-to on every structure relation, `known_at` replay | People's moves are already dated; a 20-person firm rarely reorganises departments; the change history answers "what changed when" at a fraction of the cost |
| Change-proposal service (draft, submit, approve, apply) for structure | Approval rules exist; a company that wants approvals switches one on. No second workflow engine |
| Scenario Studio, span of control, FTE planning, AI notes | No small-business signal; the research itself puts them last |
| Delivery receipts per app | Apps read the record directly (as decided for Workforce) |
| Delegated approvers inside Organization | Platform workflow (research D05) |
| Cross-company managers, inter-company structures | Platform scope; rare for this customer (D01: no) |
| Eight tabs on one screen | Too many for a small business; the sidebar plus the detailed-structure switch instead |
| 130-row backlog, 100 acceptance rows | Templated (one acceptance sentence for every row); not a plan |

## Research open questions answered

D01 no · D02 positions optional, under detailed structure · D03 work site is the legal place, branch the registered one, location only for attendance zones · D04, D05, D09 agreed · D06 hidden nodes are not drawn at all · D07, D13 cost-centre mapping to Accounting waits for that module · D08 yes, employment history and dated changes · D10 no · D11 from the work site's state · D12 one definition ("Working now") · D14 export audit exists.

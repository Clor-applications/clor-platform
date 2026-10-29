# Joining & Leaving: what we build, what we leave out, and why

Source: `Clor_People_Joining_Changes_Leaving_Repo_Research_2026-10-27.zip` (owner, 27 Oct 2026),
used as reference, not as a spec. Its audit was made at `62cb797`; every finding was checked
again against `main` at `e24d7c6` (Workforce, Organization and Time & Leave merged).

## Why this module, and why now

The session that started this work named Hiring as the next rail item. Two things changed the
order:

1. The PRD ranks **Employee Lifecycle (Joining · Changes · Leaving)** P0 and Hiring P1
   (`02-PRD.md` §6). The menu plan (`04-WORDS-AND-MENUS.md` §3.1) gives it its own group,
   "Join and leave".
2. The owner sent this module's research pack into the session on 27 Oct 2026.

So this module comes before Hiring. Hiring stays next on the rail.

## Who it is for

A 1–50 person Indian business. Usually the owner, or one HR person, does joining, leaving and
pay, sometimes with one sign-in. There is no IT team, no identity provider and no ticketing
tool. Someone joins or leaves a few times a month. What goes wrong is small and costly: the
laptop is not collected, the fingerprint still opens the door, final wages are paid late, a
task in an e-mail is ticked by a link preview, and nobody notices that a plan never started.

The question the module answers: **who is joining or leaving, what is still not done, and whose
job is it.**

## The module

A rail module of its own, **Joining & Leaving** (short "Join"), after Workforce. Old screen keys
stay, so links in e-mails and notices keep working.

| Screen | Key | What it answers |
|---|---|---|
| Overview | `lifecycle` | What needs doing now: starting this week, last days this week, tasks late, readers not confirmed, final wages due. Then what is coming up in 30 days. Each count opens the list behind it. |
| Joining | `joiners` | Everyone joining or recently joined: the stage (details to check, preparing, ready for day one, joined, done), tasks done out of all, the next task with its owner and due date. A plan that never started says so, with a button to start it. |
| Changes | `lifecycleChanges` | Dated changes waiting for their day, change requests waiting for approval, probation ending, contracts ending, and changes applied in the last 30 days. |
| Leaving | `leavers` | Everyone on notice or recently left: last day, stage, reader removal (waiting, confirmed, failed), final wages (due date in working days, paid or late), CLOR sign-in. |
| Tasks | `checklists` (was Onboarding & Exit) | Every joining, leaving, change, probation and letter task: mine, late, nobody's, everyone's, done. Server-paged and searched. Tick with a note; some tasks need a note before they close. |
| Settings → Joining & Leaving Steps | `journeySteps` | The company's joining and leaving steps: owner, due in calendar or working days, who it applies to, whether it needs a note to close. |
| Employee app | Me tab | A joiner's or leaver's own tasks (tick the ones that are theirs) and the things they must hand back before the last day. |

Primary action, top right: Joining has **Add employee** (the existing wizard, no second hire
form); Leaving has none (leaving is recorded on the person's record, where its preview, notice
and approval already live; each row opens that record); Settings page has **Save**.

## Phase 0 — safety fixes found in the pack, checked against main

| Pack id | State on main | What we do |
|---|---|---|
| JCL-A10 E-mail link ticks a task on GET | **Still true.** `routes/peopleTaskLinks.ts` ticks on open, so a mail scanner or link preview can tick it. | GET shows the task and a **Mark done** button; only the POST ticks. A task that needs a note, or that CLOR closes itself, cannot be ticked from the link. |
| JCL-A02 Reader removal "done" when queued | **Still true.** `finishLeaving` ticks "Readers and app access removed" as soon as the delete commands are queued. | The task stays open as **Waiting for readers** with the command ids. A job closes it when every reader confirms (`DeviceCommand` DONE). A reader that refuses or never answers marks it **Failed**, HR is told once, and only a person with a note ("removed at the reader by hand") can close it. No readers: closed at once, saying so. |
| JCL-A03 / A23 Final settlement due +2 calendar days | **Still true.** One task, "Full and final settlement paid", due +2 calendar days, with a note that over-promises. | Two tasks: **Final wages paid**, due 2 *working* days after the last day (company working week and holidays), needing a payment reference to close; and **Full and final settlement closed** (leave encashment, gratuity, other dues), due in 30 days. The note cites Code on Wages s.17(2) for wages only and tells the reader to check with their adviser. Open asset tasks never hold up the wages task. |
| JCL-A01 A plan that fails to start is silent | **Still true.** `startChecklist` catches every error and returns 0. | A sweep in the lifecycle job starts any missing plan (a joiner from the last 30 days with no joining tasks; anyone on notice or left in the last 30 days with no leaving tasks). The Joining and Leaving lists show **Plan not started** with a Start button until it exists. |
| JCL-A05 Scheduled work needs traffic | **Fixed already** (`jobRegistry`, `/internal/jobs/wake`, Cloud Scheduler). | The new lifecycle job registers the same way. |
| JCL-A04 CLOR sign-in left on | **Handled already**: HR gets a "Turn off … CLOR sign-in" task; CLOR never switches off an account that may be the owner's. | Shown on the Leaving list as its own column. |

## Built (Phase 1 and 2)

| Pack id | Built as |
|---|---|
| JCL-067, A20 Plain words, own module | Rail module "Joining & Leaving"; "Onboarding & Exit" becomes **Tasks**; the step editor moves to Settings. Assets moves to "Pay, Benefits & Assets". |
| JCL-068 Action home | Overview counts and lists, all team-scoped, each opening the filtered list. |
| JCL-019, A05 First-day ready | Stage **Ready for day one** only when every task due on or before the joining day is done. |
| JCL-025, A04 Joining date moved | Open joining tasks move with the date (each task keeps its offset). The same for a changed last day while on notice. |
| JCL-012, A03 Working days | A step can count in working days: the company working week (People → Time & Leave) and the person's holidays. |
| JCL-058, A08 Small rule presets | A step can apply to everyone or only to some employment types (a contractor gets no PF task). |
| JCL-078 Task proof | A step can need a note to close (payment reference, asset tag). The server refuses a tick without one. |
| JCL-059, JCL-070, A19 Action queues, paging | `GET /people/lifecycle/tasks` with view (mine, late, nobody's, open, done), kind, search, paging and counts. |
| JCL-060, JCL-061, A15 Digest and escalation | Once a day, each owner gets one notice listing what is due today or late. HR's digest also lists tasks late by 3 or more days on someone else's name. One per person per day (notice dedupe key). |
| JCL-007 No deciding one's own | Nobody ticks or reassigns a task on their own joining or leaving plan, except tasks owned by the employee role (their own hand-in). |
| JCL-009 Private exits | The leaving type and reason are shown only to people with the Lifecycle right; a manager sees "Leaving" and the date. |
| JCL-006 Scope | Every list uses `teamScope`; a person outside it reads as absent. |
| JCL-008 Audit | Ticks, reassignments, link ticks and step changes write change-log lines and audit rows with the request id. |
| JCL-041, JCL-051 Employee side | Employee app: own tasks and hand-back list; tick own employee tasks only. |
| A06 Who the team reports to | Leaving drawer shows the direct reports and the manager they move to on the last day. |

## Left out, and why

| Pack id | Why not now |
|---|---|
| ADR-JCL-01 `LifecycleCase` / `LifecycleAction` tables | Not needed for 1–50 people. A joiner, change and leaver are already one employee row, its `EmploymentEpisode`, its tasks, its invite and its scheduled changes. The lists are projections of those. A new table would be a second truth to keep in step. Revisit if a case ever needs state that none of these hold. |
| JCL-047, A10, A23 Identity provider / Google / Entra / SCIM / MDM connectors | Small businesses here do not have them. The manual task with a named owner is the honest path (JCL-005). |
| JCL-018, A13, A16 E-signature | Needs a signing provider and a legal review. Offers already record acceptance with time and IP. |
| JCL-082, ADR-JCL-05 Legal rules catalogue with counsel sign-off | A product and legal project of its own. We stop the over-promise (wages only, working days, "check with your adviser") instead of encoding more law. |
| JCL-064 Rule preview on five people | The steps are short lists; their effect shows on the next plan. |
| Template versions and dependencies (A09) | A change already applies only to plans started afterwards; dependencies add a graph for little gain at this size. |
| JCL-052 Exit interview answers | Stays a task. Private answers belong with Private Cases, not here. |
| JCL-031, JCL-037 Payroll receipts of changes | Payroll reads the employee record and the outbox; a receipt needs Payroll's part (separate payroll pack). |
| A31, A34 Delay patterns, "why late?" assistant | P2, and AI explanations need the AI controls first. |
| A06 Choosing a different manager for the team at leaving | Moving up one line is right for a small company; the preview shows who moves where, and HR can move people before the day. |

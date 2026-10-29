# Joining & Leaving: audit (27 Oct 2026)

Scope: the module in `JOINING-LEAVING-DECISIONS.md` as built on `claude/unruffled-swartz-58ef63`.
Method: every screen walked in the browser at 1366 px and 375 px on a throwaway database
(`clor_jl_ws58`, seeded through the API: a 9-person company with joiners, people on notice,
leavers, a reader, a dated change and probation ending), then read from the owner, HR,
manager, employee, IT/security and product angles, then a pass over every automation and
workflow. Evidence: `evidence/joining-leaving/` (17 screenshots).

Every finding is fixed, or parked with a reason.

## Browser walk (V)

| # | Finding | Fix |
|---|---|---|
| V1 | Overview's readers tile added failed and waiting removals into one red number | Shows failed ones when there are any ("Readers not confirmed"), else waiting ones ("Waiting for readers") |
| V2 | People who had already left showed under Joining, "Joined, steps open" (their old joining steps) | Joining lists only people who have not left; leavers are on Leaving |
| V3 | Plan and task drawers opened at the wide form width | Plan 38rem, task 34rem |
| V4 | A failed reader step said the same thing twice in its drawer | The task's own note (which names the reader) only, in the problem colour |
| V5 | Reader state in the plan was a pill holding a full sentence | A caption line, in the problem colour when it failed |
| V6 | A failed reader step closed by hand still read "Not confirmed" on Leaving and in the Overview count | New state MANUAL ("Removed by hand"), set when a person closes a failed one; the list and counts use it. Test: `peopleLifecycle.test.ts` "reader removal waits for the readers" |
| V7 | Pickers showed "Select" where the value was "Every kind", "Calendar days", "Everyone" | Placeholder on the task-kind filter; real values for the steps' pickers |
| V8 | "Needs a note" wrapped in the steps table | Column widened, no wrap |
| V9 | Progress bars (and the record's checklist bar) were drawn in the colour of a problem | `.ui-meter[data-tone='progress']` in the positive token |
| V10 | Picking a new owner and pressing Mark done handed the task on and closed it in one go | Two actions: a new owner makes the button "Hand on" and leaves the task open |
| V11 | Task cards on a phone did not say which plan a task belongs to | Kind first on the card's second line |

No sideways scroll on any screen at 375 px (`scrollWidth === clientWidth` checked on each).

## Owner

| # | Finding | Fix |
|---|---|---|
| O1 | Overview offered Add employee to people who cannot add one | Shown only with the Employees create right |
| O2 | An owner who is every step's owner would get a mail per task | One digest a day per person (dedupe key per day); test "one digest a day" |
| O3 | Nothing told the owner a plan never started | Joining/Leaving show "Plan not started" with a Start button; the job starts it within 15 minutes; test "a plan that never started" |

## HR

| # | Finding | Fix |
|---|---|---|
| H1 | Closing without a needed note showed the message but left focus on the button | Focus moves to the note |
| H2 | A leaving recorded after the last day restarted the wages clock (every date was lifted to today) | A step counted in working days keeps its real date; final wages show late from the day they fell due. Test "a legal clock does not restart" |
| H3 | Final wages and the rest of the settlement were one step, due in calendar days, with a note that promised too much | Two steps; wages due 2 working days after the last day with a payment reference; the note cites s.17(2) for wages only and points to an adviser. Test "final wages in working days" |
| H4 | A moved joining day left the plan's dates behind | Open steps move with the date, each by its own offset; same for a moved last day on notice. Test "a moved date moves the plan" |
| H5 | Employees added with an old joining date get a joining plan of steps already past | Parked: existing behaviour from Workforce, and each step can be closed from the record. A "close all as not needed" for old joiners is a small follow-up if owners ask |

## Manager

| # | Finding | Fix |
|---|---|---|
| M1 | A team lead saw Mark done on a teammate's task and was then refused | Queue rows carry `canClose`; the drawer says whose it is instead. Test in "lists keep to the team" |
| M2 | Why someone leaves would show to their manager | Leaving type and reason only with the Lifecycle right. Test in "lists keep to the team" |

## Employee

| # | Finding | Fix |
|---|---|---|
| E1 | A leaver could not see what they must hand back, or tick their own steps | Employee app, Me tab: "Before your last day" (own steps, ticked there) and "Hand back" (read only). Never HR's steps or notes. Test "the employee app" |
| E2 | CLOR's default steps have no employee step | Parked: the joining form already asks the joiner for their details; companies add their own employee steps in Settings |

## IT and security

| # | Finding | Fix |
|---|---|---|
| S1 | Opening an e-mail task link ticked the task (mail scanners and previews open links) | GET shows the task and a Mark done button; only POST ticks, once. Test in `peoplePlans.test.ts` |
| S2 | Reader removal was marked done when the delete was queued | Waits for every reader's confirmation; a refusal, a removed command or a reader that does not collect it within a day marks it failed, HR is told once, a person closes it with a note. Tests "reader removal waits" |
| S3 | HR could close the steps of their own leaving (final wages included) | Refused (`OWN_PLAN`) unless nobody else may edit people; the e-mail link refuses too. Test "nobody closes their own plan" |
| S4 | The task queue for someone without the Employees right | Their own tasks only, whatever view is asked. Test in "lists keep to the team" |
| S5 | A step's "Only for" could name any id | Only this company's employment types. Test "steps a company sets" |
| S6 | Ticks, hand-ons and step changes wrote no audit row | `recordAudit` on each, change log as before |
| S7 | The digest lists names and steps | Goes only to each step's owner, and the overdue escalation only to people who may edit employees |

## Product

| # | Finding | Fix |
|---|---|---|
| P1 | "Onboarding & Exit" left in Attendance, the Directory banner, Home's to-do, Data Health and the record | Renamed: Tasks / Joining & leaving; the banner opens Joining |
| P2 | Attendance had its own copy of the old screen | Both apps load the same Tasks and Steps screens (`packages/ui/src/lifecycle/`); the old screen is deleted |
| P3 | Assets sat in a "Joining & Leaving" group under Workforce | Moved to "Pay, Benefits & Assets" |

## Automation and workflow pass

| # | Path | State |
|---|---|---|
| A1 | Readers job, missing-plan sweep, daily digest | One job (`startLifecycle`, 15 min), registered for the Cloud Run wake; each part guarded (lease, advisory lock per plan, dedupe key per day) |
| A2 | Leaving withdrawn while on notice | Open leaving steps (reader step included) closed as not needed (existing `cancelLeaving`) |
| A3 | Not joined / duplicate | No leaving plan, no reader step, joining steps closed (existing) |
| A4 | Notice runs out at night (no user) | `finishLeaving` from the job hands the reader step its commands the same way |
| A5 | Reader failure notice | Sent once: the state moves WAITING → FAILED in one guarded update, the notice follows only that update |
| A6 | Rehire | A plan from an earlier stint does not stop the sweep from starting a new one (only plans made within a year of the date count) |

## Not built (see the decisions doc for why)

Case tables, identity-provider connectors, e-signature, a legal rules catalogue, step versions and
dependencies, policy simulation, exit-interview answers, Payroll receipts, AI explanations.

## Known overlap

PR #45 changes the same `PATCH /people/checklist-tasks/:id` handler (what a non-HR ticker gets
back). If #45 lands first this branch is rebased; the two changes touch different lines.

## Found by the full server run

| # | Finding | Fix |
|---|---|---|
| R1 | The e-mail link's Mark done button said "Already done" and ticked nothing: the company was entered inside a helper, which does not carry back to the route, so the update ran outside the company and row security hid the task. The page also named the person "a colleague" for the same reason | Each handler enters the task's company itself; `peoplePlans.test.ts` checks the POST says it is ticked |

Full server suite: 2255 of 2269 passed in a run that overlapped the browser walk's dev servers; the 5 failing files were rerun on a quiet database and pass, except R1 above, now fixed.

## Tests fail without their fix

Each fix was taken out again on a scratch copy and its test run (`vitest -t`), then put back.
All eleven failed without the fix and pass with it: link GET ticking, reader done on queue,
calendar-day wages, restarted wages clock, no redating, own plan allowed, leaving reason to
everyone, employee app ticking others' steps, "Only for" ignored, no missing-plan sweep, a
digest every run.

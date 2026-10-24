# Clor People: words, menus and screens

Version 1.0 · 24 Oct 2026 · Goes with [02-PRD.md](02-PRD.md).

The aim: someone who has never used HR software finds what they need in two clicks and understands every label without training. Indian users still expect a few terms they know from payslips and the law (PF, ESI, PAN, UAN, LOP, F&F, Form 16); those stay, everywhere else we use everyday words.

---

## 1. Word rules

1. **Everyday words over HR words.** "Joining", not "Onboarding". "Leaving", not "Separation" or "Offboarding". "Changes", not "Movements" or "Lifecycle events".
2. **Brand names stay in marketing.** Trace, Guard, Flow, Journey and Intelligence never appear as menu labels. The product says "Why?", "Compliance", "Joining", "Timeline", "Ask".
3. **Buttons are verbs.** "Add person", "Send invite", "Approve", "Ask HR". Never "Submit" alone, never "OK".
4. **Sentence case** for titles, menus and buttons ("Before day one", not "Before Day One").
5. **Statuses are words in a pill**, from the fixed lists in section 5. Colour only places the word (`DESIGN.md`: a status hue is a background, never type).
6. **Say what happens next.** After an action, one line: "Sent to Priya for approval. Due Thursday."
7. **Say why something is blocked.** "Can't confirm yet: probation review not done."
8. **Plain numbers.** Dates as "1 Nov 2026"; money only where People shows Payroll's figure, always tabular.
9. **No blame words.** "Missing", not "Invalid" or "Error" when a field is just empty.
10. **Indian context.** "Designation" (not "Job title"), "Establishment" in settings and compliance only (people see "Office" or "Site" in their own screens), "Notice period", "Relieving letter", "Full and final settlement" (shortened to "Final settlement" after first use).

---

## 2. Word list

| Traditional HR word | Clor word | Where it shows | Note |
|---|---|---|---|
| Employee master / Employee 360 | Person, profile | People › Directory, profile page | "Employee" stays in legal text and exports |
| Employee database / directory | Directory | People | |
| Employment history | Timeline | Profile tab, Me | Brand: Journey |
| Employment episode | Stint | Timeline grouping ("2nd stint, from 1 Mar 2026") | Only visible when someone rejoined |
| Preboarding | Before day one | Join and leave | |
| Onboarding | Joining | Join and leave | |
| Onboarding checklist | Joining plan | Joining | Tasks with named owners |
| Offboarding / Separation / Exit | Leaving | Join and leave | |
| Exit clearance / No-dues | Hand-back list | Leaving plan | Assets and access to return |
| Full & final settlement | Final settlement | Leaving plan | Payroll's; People hands it over |
| Movement / Transfer / Promotion | Change | Join and leave › Changes | Type shown as a pill: Transfer, Promotion, New manager |
| Effective date | Takes effect | Change form | "Takes effect 1 Dec 2026" |
| Probation confirmation | Confirm after probation | Profile, To do | |
| Position (sanctioned) | Seat | Teams and seats | "Open seat", "Filled seat" |
| Requisition | Seat request | Teams and seats | |
| Org unit | Team or department | Organisation settings | Departments hold teams |
| Legal entity | Company (legal) | Settings › Organisation | |
| Establishment | Establishment (settings); Office or site (elsewhere) | Settings, Compliance | |
| Workflow | Approval rule; automation | Settings | "Workflow studio" is called "Automations" |
| Approval center | To do › Approvals | Home | |
| People inbox | To do | Home | Everything assigned to me |
| Delegation | Stand-in | My profile, Approvals | "Priya is standing in for Ravi until 5 Nov" |
| Escalation | Handed on (overdue) | Approvals, Help desk | |
| SLA | Reply by / Resolve by | Help desk | |
| Ticket / People desk / HR helpdesk | Help desk (HR side); Ask HR (employee side) | Help | |
| Grievance / POSH complaint / Investigation | Private case | Help › Private cases | Only members see it |
| Policy hub | Policies | Help | |
| Policy acknowledgement | Read and accept | Policies, To do | |
| Compliance center | Compliance | Checks | Brand: Guard |
| Statutory obligation | Obligation | Compliance | "Due 15 Nov · Owner: Asha · Proof: missing" |
| Evidence | Proof | Compliance, Why? | |
| Workforce health / Data quality | Health check | Checks | |
| Decision explorer / Audit trail (per decision) | Why? | Everywhere a value changed | Brand: Trace |
| Audit log (company-wide) | Audit history | Settings | Opens Workspace's audit share (ADR-010) |
| Custom fields / Form builder | Custom fields; Forms | Settings | |
| Document classification | Who can see | Document upload | Choices: Employee can see · HR only · Restricted · Confidential |
| Masking / Reveal | Hidden / Show | Statutory tab | "Show" asks for confirmation (step-up) |
| Data subject request | Privacy request | Settings › Privacy | |
| Data principal | Person | Privacy screens | |
| Headcount report | Headcount | Checks › Reports | |
| Attrition | People who left | Reports | Rate shown with the count beside it |
| Workforce planning | Team plan | Growth (P1) | |
| Internal mobility | Openings inside | Growth (P2) | |
| Learning management | Training | Growth (P1) | |
| Performance appraisal | Review | Growth (P1) | |
| Natural-language query / Copilot | Ask | Header button (P2) | Off until AI controls allow |
| Impersonation | Support access | Settings › Security | Always approved and logged |

**Clashes to settle (D-08):** People says "Leave Applications", Attendance says "Leave Requests"; Attendance's rail calls its people screen "People". Recommendation: "Leave requests" in both apps, and rename Attendance's group to "Staff" in the cross-app fix. Until then People keeps its current leave labels.

---

## 3. Menus

### 3.1 The rail

Seven groups for HR. Fewer for other roles (section 3.2). P1/P2 items hidden in the first release.

| Group (rail label) | Items | Priority | Today |
|---|---|---|---|
| **Home** | Home · To do | P0 | Home exists; To do new |
| **Me** | My profile · My requests · My documents · My timeline · My leave · My attendance | P0 | My leave, My attendance exist (shared) |
| **People** | Directory · Org chart · Teams and seats | P0 | Directory, Org chart exist |
| **Join and leave** | Before day one · Joining · Changes · Leaving | P0 | Checklists exist as "Onboarding & Exit" |
| **Help** | Help desk · Policies · Private cases | P0 | HR Cases register exists |
| **Time** (shared, unchanged) | Leave requests · Leave calendar · Leave balances · Leave register · Attendance | exists | Shared module, out of scope |
| **Checks** | Health check · Compliance · Reports | P0 | Data Health, Compliance Calendar, Workforce Report exist |
| **Growth** (P1) | Goals and reviews · Skills and training · Hiring · Openings inside (P2) · Team plan | P1/P2 | Registers today |
| **Settings** (hub) | see 3.3 | P0 | Hub exists |

Current menu for comparison (`apps/people/manifest.jsx:186-204`): Home · Employees (Directory; Joining & Leaving; Pay & Benefits) · Leave & Attendance · Hiring · Performance · Engage · Insights · Settings. Moves: "Employees" becomes **People**; "Joining & Leaving" becomes its own group **Join and leave**; "Engage" items (announcements, events) move to Home as News (P1); "HR Cases" moves to **Help** as Help desk; "Insights" becomes **Checks**; "Pay & Benefits" moves to Growth (P1) and Payroll.

### 3.2 What each role sees

| Role | Rail |
|---|---|
| Employee | Home · Me · Help (Ask HR, Policies) · Time (own leave and attendance) |
| Manager | Home · Me · People (my team) · Join and leave (my team) · Help · Time |
| HR executive | All P0 groups; Private cases only if a member |
| HR head | All P0 groups |
| Founder / CEO | Home · People · Checks · Growth (P1) |
| Compliance officer | Home · Checks · Help (Policies, Private cases if a member) |
| IT administrator | Home (To do) · Join and leave (read, own tasks) |
| Payroll administrator | Home · People (read) · Join and leave (read) · Checks (Health check) |
| External auditor | One screen: Shared evidence |

### 3.3 Settings hub

One page of cards, grouped (existing `SettingsHub` pattern):

| Section | Cards |
|---|---|
| Organisation | Company (legal) · Establishments · Departments and teams · Designations · Grades · Locations · Cost centres · Business units |
| People data | Custom fields · Forms (phase 3) · Employee types · Work types · Tags · Import |
| Rules | Approval rules · Automations (phase 3) · Letter templates · Probation and notice · Help desk categories and times |
| Compliance and privacy | Compliance rules · Privacy notices · Retention · Private case committee · External auditor access · Data requests · Recycle bin |
| Access | Roles and access (opens Workspace, ADR-010) · Users and security · Audit history |
| Apps and AI | Modules · Integrations · AI controls |

---

## 4. Screens

Archetypes from `DESIGN.md`: **List** = `PageShell` + `DataTable`; **Profile** = page with tabs; **Form** = `EntryForm`; **Settings** = `SettingsPanel`; **Board** = columns of cards (joining only, the one place a board helps). Every screen: one primary action, top right.

### 4.1 Every page in the brief, mapped

| Brief page | Clor screen | Menu | Archetype | Primary action | Priority | Today |
|---|---|---|---|---|---|---|
| People Directory | Directory | People | List | Add person | P0 | Exists (500 cap) |
| Employee 360 | Profile | People › Directory › a person | Profile | Edit (per tab) | P0 | Drawer exists |
| Employment History | Timeline (profile tab) | Profile | Profile tab | Add past record (HR) | P0 | History tab exists |
| Preboarding | Before day one | Join and leave | List | Send invite | P0 | None |
| Onboarding Board | Joining | Join and leave | Board (by stage) + list toggle | Start joining | P0 | Checklists exist |
| Employee Changes | Changes | Join and leave | List | Start a change | P0 | Bulk transfer in Attendance only |
| Offboarding | Leaving | Join and leave | List | Record leaving | P0 | Partial |
| Organization Chart | Org chart | People | Chart | (none; read) | P0 | Outline exists |
| Positions & Headcount | Teams and seats | People | List | Request a seat | P0 list, P1 plan | None |
| People Inbox | To do | Home | List with tabs | (none; act on rows) | P0 | Home to-dos exist |
| People Desk | Help desk | Help | List + thread | New request | P0 | Register exists |
| Approval Center | To do › Approvals | Home | List | (none) | P0 | Leave/corrections only |
| Policy Library | Policies | Help | List + reader | New policy | P0 | None |
| Compliance Center | Compliance | Checks | List | Add obligation | P0 | Calendar exists |
| Confidential Cases | Private cases | Help | List + case page | New case | P0 | None |
| Privacy Center | Privacy | Settings › Compliance and privacy | Settings + lists | (per card) | P0 | Partial |
| Workforce Health | Health check | Checks | List | (none; fix per row) | P0 | Data Health exists |
| Decision Explorer | Why? panel | Everywhere | Side panel | Raise a correction | P0 | None |
| Audit & Evidence | Audit history; Shared evidence | Settings; auditor screen | List | Share evidence | P0 | Workspace audit exists |
| Goals & Reviews | Goals and reviews | Growth | List | New goal | P1 | Register |
| Skills Directory | Skills | Growth › Skills and training | List | Add skill | P1 | None |
| Learning Hub | Training | Growth › Skills and training | List | Assign training | P1 | Register |
| Internal Opportunities | Openings inside | Growth | List | Post an opening | P2 | None |
| Hiring Pipeline | Hiring | Growth | Board + list | New opening | P1 | Register |
| Workforce Planning | Team plan | Growth | List + totals | New plan | P1 | None |
| Form Studio | Forms | Settings › People data | Settings + builder | New form | P0 (phase 3) | None |
| Workflow Studio | Automations | Settings › Rules | Settings + builder | New automation | P0 (phase 3) | None |
| Policy Administration | Policies (owner view) | Help › Policies | Form | Publish | P0 | None |
| Integration Center | Integrations | Settings › Apps and AI | Settings | Connect | exists | Exists (shared) |
| AI Control Center | AI controls | Settings › Apps and AI | Settings | Turn on (owner only) | P0 | None |
| (new) My profile, My requests, My documents, My timeline | Me group | Me | Profile / List | Ask for a change / New request | P0 | Portal has parts |
| (new) Shared evidence | Auditor's only screen | (alone) | List | (none; read) | P0 | None |

### 4.2 Key screens, laid out

Text wireframes; the build contract §8 turns each into pass/fail checks.

**Home (HR executive)**
```
People ▸ Home                                              [ Add person ]
To do (12)            Overdue 3 · Due today 4 · This week 5        See all ›
  ▸ Approve: promotion for Ravi K. (due today)          [Why?] [Open]
  ▸ Joining: laptop for Meera S. — IT (overdue 1 day)   [Open]
  ▸ Help desk: "PF number wrong" (resolve by tomorrow)  [Open]
This week          Joiners 3 · Leavers 1 · Changes taking effect 2
Health check       7 items  (2 documents expiring, 5 records missing data) ›
Compliance         2 due this month  ›
```

**Profile**
```
◂ Directory     Meera Shah · Designer · Bengaluru office · Active  [ Edit ]
Overview | Job | Timeline | Documents | Requests | Tasks | Statutory
Job: Designer since 1 Mar 2026 [Why?]   Manager: Ravi K. [Why?]
     Changes on 1 Dec: Senior designer (approved by Asha) [Why?]
```

**Start a change (form)**
```
Start a change for Meera Shah                      [ Send for approval ]
Type: (•) Transfer ( ) Promotion ( ) New manager ( ) Other
                    Now                 From 1 Dec 2026
Designation         Designer            [Senior designer   ▾]
Office              Bengaluru (KA)      [Pune (MH)         ▾]
Manager             Ravi K.             [Anil P.           ▾]
Reason              [__________________________________]
What else this affects
  • Different holiday list (Pune)          → task for HR
  • Professional Tax state changes (KA→MH) → told to Payroll
  • Leave policy "MH staff" applies        → review task
Approvals: Ravi K. → Asha (HR head)
```

**Why? panel**
```
Why is Meera's office Pune?
What changed   Office: Bengaluru → Pune, takes effect 1 Dec 2026
Asked by       Ravi K., 24 Oct 2026, "Moving to the Pune studio"
Approved by    Ravi K. (25 Oct), Asha (26 Oct) — rule "Transfers v3"
Rules used     Leave policy "MH staff" v2 · Holiday list Pune 2026
Proof          Transfer letter (PDF)
What it caused Holiday list task (done) · Payroll told (26 Oct, delivered)
Not known      —
[ Ask HR about this ]  [ Raise a correction ]
```

**Help desk (HR)**: list with tabs Open · Waiting on employee · Resolved; columns Request, Person, Category, Resolve by, Assigned; row opens a thread with "Reply" and "Internal note" tabs; "Move to private cases" in the ⋮ menu only.

**Compliance**: list grouped by month; columns Obligation, Establishment, Due, Owner, Proof, Status; row opens source, scope, proof upload, history, "Last checked by". No score anywhere.

**Health check**: list; columns Item, Person or area, Why it matters, Since, Action; filters by kind; snooze in ⋮ with reason and date.

---

## 5. Status words

One list per object. Pills carry these exact words.

| Object | Statuses |
|---|---|
| Person | Joining · Active · On probation · On notice · Left · Rejoined (shown on the timeline only) |
| Change | Draft · Waiting for approval · Approved · Scheduled · Done · Rejected · Withdrawn |
| Approval step | Waiting · Approved · Rejected · Asked for more · Handed on · Skipped |
| Plan task | To do · Done · Not needed · Overdue |
| Help request | Open · Waiting on you (employee view) / Waiting on employee (HR view) · Resolved · Reopened · Moved |
| Private case | Received · Inquiry · Report due · Closed |
| Policy | Draft · Waiting for approval · Published · Retired |
| Document | Current · Expiring · Expired · Replaced |
| Obligation | Coming up · Due · Overdue · Done · Checked |
| Health item | Open · Snoozed · Fixed |
| Invite (before day one) | Sent · Started · Sent back to HR · Checked · Expired |

---

## 6. Empty, error and no-permission text

| State | Pattern | Example |
|---|---|---|
| Empty | What this is + one action | "No one is joining yet. When you add a joiner, their plan shows here. [ Start joining ]" |
| No permission | What you can't see + who to ask | "Only HR can see statutory details. Ask your HR team if you need them." |
| Error | What failed + what to do | "Couldn't save. Your changes are still here. Try again." |
| Offline | What still works | "You're offline. You can read what's loaded; saving will work when you're back." |
| Blocked | Why + what unblocks | "Can't confirm yet: probation review not done. [ Start review ]" |
| Unknown (Why?) | Say it plainly | "No approval recorded: this changed before history started on 22 Oct 2026." |

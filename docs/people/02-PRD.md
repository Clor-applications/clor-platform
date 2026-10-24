# Clor People: product requirements (PRD)

Version 1.1 · 24 Oct 2026 · Status: **Draft for owner review**
Inputs: the owner's People strategy brief (24 Oct 2026), [01-PLATFORM-REVIEW.md](01-PLATFORM-REVIEW.md) (what exists), [sources/india-compliance-research-2026-10-24.md](sources/india-compliance-research-2026-10-24.md) (law and market, with links), and the earlier `docs/clor-india-hr-product-research.md`.
Companion documents: build contract [03](03-IMPLEMENTATION-CONTRACT.md) · words, menus and screens [04](04-WORDS-AND-MENUS.md) · compliance [05](05-INDIA-COMPLIANCE-MATRIX.md) · checklist [06](06-BUILD-CHECKLIST.md) · tests [07](07-TEST-PLAN.md) and `PEOPLE-TEST-SHEET.xlsx` · decisions and risks [08](08-DECISIONS-AND-RISKS.md) · evidence [09](09-EVIDENCE-REGISTER.md).

**Scope (owner, 24 Oct 2026).** People is the main app. Attendance, Payroll and the modules shared across apps (leave, holidays, employee portal, imports) are not changed in this build; People talks to them only through the interfaces in the build contract (section 9). Payroll's own capabilities come in a separate payroll pack.

---

## 1. Problem and promise

A 20 to 300 person Indian company keeps its staff records in a spreadsheet, a biometric box, a payroll tool and a WhatsApp group. The same person has a different joining date in each. When salary is short, nobody can say why. When a contract expires, nobody notices. When an employee raises a complaint, it sits in someone's email. Most HR software stores records. It does not explain them, check them, or carry a change to every team that must act on it.

**Commercial promise:** *Clor prevents workforce administration errors, shows why they happened, and helps resolve them before they affect employees or payroll.*

**Product promise:** every change to a person's job is recorded once, checked against the company's rules, carried to everyone who must act on it, and can be explained later in plain words.

---

## 2. Problems we solve

Reported problems from HR software reviews and practitioner discussions. They are examples, not failure rates. Sources: [sources/india-compliance-research-2026-10-24.md](sources/india-compliance-research-2026-10-24.md) part B.

| # | Problem people report | What Clor People does | Requirements |
|---|---|---|---|
| P1 | Employee records differ between systems | One employee record per company; other apps read it through events and ids, never keep their own copy | FND-05, FND-08, CORE-01..08 |
| P2 | Wrong leave balances or attendance deductions | People explains the balance or deduction with the rule and the evidence, and opens a correction. (The leave engine and attendance stay where they are.) | TRACE-01..05 |
| P3 | HR and IT joining happen separately | One joining plan with HR, manager, IT, facilities, Payroll and employee tasks, each with a named owner | LIFE-01, LIFE-02, LIFE-07 |
| P4 | Employees cannot understand a decision | A "Why?" panel on every change, request outcome and plan task | TRACE-01..05 |
| P5 | HR forgets document renewals and deadlines | Expiry watch and obligations with owners and reminders | DOC-03, COMP-02, HLTH-01 |
| P6 | Manual multi-stage approvals cause delays | One approval engine with due times, overdue hand-on and stand-ins | APR-01..07 |
| P7 | State-specific compliance is confusing | Rules with versions, state, establishment type and employee category; per-state settings | COMP-01..06, FND-07 |
| P8 | Grievances disappear into email | Private cases, separate access, every open logged | PRIV-01..06 |
| P9 | Custom reports are hard | Reports with saved views first; questions in plain language later, within the user's permissions | RPT-01..04, ASK-01..05 |
| P10 | Managers cannot see skills and capacity | Skills, training and team plan (P1) | SKILL, PLAN (P1) |
| P11 | AI may expose sensitive employee information | AI off by default, reads only what the user may read, never reads private cases, every answer logged | AIG-01..06 |
| P12 | Imports create duplicates and cannot be undone | Preview, duplicate check, update mode, batch undo | CORE-07 |

---

## 3. Who it is for

**First market (a hypothesis to test with design partners, not a claim):** Indian organisations of about 20 to 300 employees, especially multi-location services, manufacturing, retail, facility management and growing IT firms.

**Why Clor can win here:** tested biometric attendance integrations (ZKTeco and eSSL over ADMS), existing Payroll and Accounting, one shared company, sign-in and permission model, and so the ability to reconcile physical attendance, employment rules and salary outcomes in one product family.

### 3.1 Who uses it and what they see first

| Person | Comes to | Home shows first |
|---|---|---|
| Employee | Check and fix my details, ask HR, read policies, get letters, understand a decision | Things to do (sign, read, upload), my requests, my documents, "Why?" answers |
| Manager | Approve, welcome joiners, see my team | Waiting for my approval, team today, joiners this week, overdue team tasks, team goals (P1) |
| HR executive | Keep records right, run joining and leaving, answer questions | To do: overdue tasks, open help requests, records missing data, changes taking effect this week |
| HR head | Rules, risk, sensitive matters, planning | Compliance due, health check, private cases (only if a member), policy reads pending |
| Founder / CEO | Headcount, approved people cost, growth, risk | Headcount trend, joiners and leavers, open seats, compliance items overdue |
| Compliance officer | Obligations, proof, acknowledgements, rule changes | What's due, what's missing proof, policy reads pending, rules not yet checked |
| IT administrator | Joiner, mover and leaver access and devices | IT tasks due, assets to hand out and collect, access to remove |
| Payroll administrator | Changes that affect pay (salary stays in Payroll) | Changes effective this pay month, joiners and leavers this month, records blocking payroll |
| External auditor | Look at agreed evidence only | Only the evidence shared with them, until access ends |

---

## 4. What we will not build

1. **No automated decisions about people.** The system never rejects a candidate, ends employment, or changes pay, status, statutory settings or a disciplinary outcome by itself. AI may suggest; a person decides.
2. **No hidden scoring.** No attrition prediction, flight-risk score, productivity surveillance or sentiment scoring.
3. **No pay calculations in People.** Pay, deductions, PF, ESI, PT, TDS and final settlement are Payroll's.
4. **No raw Aadhaar.** Show the last 4 digits only. Full Aadhaar, if a company must keep it, goes in a separate vault (UIDAI circular 14/2025; see [05](05-INDIA-COMPLIANCE-MATRIX.md) C-AAD). Reader fingerprints and faces stay in Attendance and are never used to verify identity.
5. **No "100% compliant" score.** Compliance shows obligations, status and proof.
6. **No new infrastructure for its own sake.** Same Express, Prisma, PostgreSQL, shell and sign-in. No microservices, no Kubernetes, no second login, no separate AI platform.
7. **No changes inside Attendance or Payroll in this build.**

---

## 5. The five capabilities

The brief names five. Brand names are for marketing; inside the product each appears as a plain word.

| # | Brand | In the product | What the user sees | Main requirements |
|---|---|---|---|---|
| 01 | Clor Trace | **Why?** | A "Why?" link on every changed value, request outcome, plan task and balance. Opens what changed, when, who asked, who approved, which rule version, the evidence, and what it affected downstream. | TRACE-01..05 |
| 02 | Clor Guard | **Compliance** and **Health check** | What's due, what's missing, what expires and what conflicts, each with owner, source and proof. Found before it becomes a problem. | COMP-01..06, HLTH-01..04, PRV-01..07 |
| 03 | Clor Flow | **Joining, Changes, Leaving** (plus Approvals) | One plan per event with tasks for HR, manager, IT, Payroll and employee. Other apps are told through events; every cross-app action is permission-checked and logged. | LIFE-01..08, APR-01..07, FND-05 |
| 04 | Clor Intelligence | **Ask** (later) | Answers from the company's own policies and the user's own records, with source, version and "informational" label. Off by default. | AIG-01..06, ASK-01..05 |
| 05 | Clor Journey | **Timeline** | One timeline per person: joined, changed, trained, recognised, left, rejoined, with every past episode kept. | CORE-06, FND-06 |

The first three (Why?, Compliance, Joining/Changes/Leaving) are the flagship for the first release. Ask waits until the controls and evaluations in section 8 pass.

---

## 6. Modules

**P0** = first commercial release. **P1** = expansion. **P2** = long-term. "Today" is from the review.

| Module (brief) | Name in the product | Major capabilities | Priority | Today |
|---|---|---|---|---|
| People Core | People | Employee record, job records, history, custom fields, directory, bulk import | P0 | Part |
| Organization | Organisation | Legal entities, establishments, departments, teams, locations, reporting line, designations, seats, cost centres | P0 | Part |
| Employee Lifecycle | Joining · Changes · Leaving | Before day one, joining, probation, confirmation, transfer, promotion, leaving, rejoining | P0 | Part |
| Documents & Letters | Documents · Letters | Secure documents, contracts, templates, acknowledgement, expiry watch | P0 | Part |
| Policy Hub | Policies | Leave, working arrangements, conduct, benefits; effective dates; who it applies to | P0 | None |
| Requests & Approvals | Requests · Approvals | Employee requests, stand-ins, conditional approval steps, overdue hand-on | P0 | Part |
| People Desk | Help desk | HR requests, reply-by and resolve-by times, employee questions, confidential move-out | P0 | Part |
| Compliance & Privacy | Compliance · Privacy | Compliance calendar, registers, sensitive-data controls, policy acknowledgements, privacy requests | P0 | Part |
| Workforce Health | Health check | Headcount, movements, missing records, overdue tasks, data quality, exceptions | P0 | Part |
| Forms & Workflows | Forms · Approval rules | Custom fields and forms, validation, business rules, approval rule builder, versions | P0 | None |
| AI Governance | AI controls | Agent permissions, model log, evaluation, AI access and approvals | P0 | None |
| Employee Experience | Home (employee) · News | Self-service, announcements, recognition, feedback, surveys, directory | P1 | Part (portal, announcements) |
| Performance | Goals and reviews | Goals, OKRs, feedback, 1:1s, reviews, calibration, improvement plans | P1 | Register only |
| Talent & Skills | Skills and training | Skills, proficiency with proof, learning, certifications, internal opportunities | P1 | Register only |
| Hiring | Hiring | Opening requests, jobs, candidate stages, interviews, offers, candidate-to-joiner | P1 | Register + hire |
| Compensation Planning | Pay reviews | Increment requests, pay bands, promotion proposals, budget scenarios (sent to Payroll) | P1 | None |
| Benefits | Benefits | Eligibility, enrolment, nominations, wellness programmes | P1 | Register only |
| Workforce Planning | Team plan | Openings, approved seats, contractor view, staffing need, cost what-ifs | P1 | None |
| IT Lifecycle | IT and assets | Access requests for join/move/leave, assets, checklists, access review | P1 | Register only |
| Internal Mobility | Openings inside | Open roles, skill gaps, career paths, succession, project chances | P2 | None |
| Intelligence Studio | Ask · What-if | Plain-language questions, policy impact what-ifs, explanations of exceptions | P2 | None |

**Forms and Workflows in P0, in two steps.** Step 1 (phase 2): custom fields on the person and approval rules. Step 2 (phase 3): the form studio and workflow studio with all ten form behaviours in section 7.13. Reason: the approval engine and protected-field rules must run real traffic before customers can build their own forms on top. Customers can never build a form that writes a protected field, skips a statutory field or skips server permission checks.

---

## 7. Requirements

Format: **ID · requirement · acceptance (pass/fail)**. *Italic* notes say what exists. Each ID has tests in [07-TEST-PLAN.md](07-TEST-PLAN.md) and rows in `PEOPLE-TEST-SHEET.xlsx`.

### 7.1 Foundations

| ID | Requirement | Acceptance |
|---|---|---|
| FND-01 | Every new People table carries `accountId` and `orgId` and a fail-closed row-level security policy (contract §3.1). | A query with no company set returns 0 rows on every new table; company A never reads a company B row. |
| FND-02 | **Effective-dated changes.** Job fields (designation, department, team, manager, establishment, location, grade, employment type, status) can be changed from a future date; the change is stored and applied on its date by a job. | Change dated 1 Dec saved on 24 Oct: profile shows the old value and "Changes on 1 Dec"; on 1 Dec it applies once (job re-run is a no-op). |
| FND-03 | **"As of" view.** Profile, directory, org chart and headcount can be read as of a past date. | Directory as of 1 Apr 2026 matches each person's history rows for that date. |
| FND-04 | **Change log with before and after** in the same transaction as the change: who, when, field, before, after, reason, source, correlation id. Sensitive fields log "changed" without values. | Forced failure after the write leaves neither the change nor the log. |
| FND-05 | **Outbox and versioned events.** Events (`people.employee.created.v1` …, contract §7) written to an outbox in the change's transaction; a worker delivers; consumers dedupe by event id. | Process killed after commit, before send: event still delivered after restart. Same event twice: one effect. |
| FND-06 | **Employment episodes.** Stable `employeeId`; each join-to-leave stint is an episode; rejoin opens a new one. | Join 2022, leave 2024, rejoin 2026: two episodes, first joining date intact. |
| FND-07 | **Legal entities and establishments.** Each establishment: address, state, type (shop, factory, office, site, warehouse), registrations, holiday calendar link, rules that apply. Each person belongs to one. | Work state comes from the establishment, never the home address (fixes R-07). |
| FND-08 | **One way to create a person** inside People: form, import and hire all go through one service (history, joining plan, event). | Three paths, same history row, plan and event. |
| FND-09 | **Never identify or merge people across companies** because an identity number matches. | Same PAN in two companies: two separate people, no link, no warning that reveals the other company. |

### 7.2 People records

| ID | Requirement | Acceptance |
|---|---|---|
| CORE-01 | Directory: search, filters, saved views, paging past 500, bulk select and bulk update, export. *Exists, capped at 500 (R-11).* | 2,000 people reachable; export holds 2,000 rows; bulk update of department writes 2,000 change-log rows under one correlation id. |
| CORE-02 | Add person: employee number, legal name, preferred name, joining date, employment type, team, establishment, location, manager, status. Duplicate check on email, phone, PAN within the company. | Duplicate phone shows a link to the existing person; saving anyway needs a reason. |
| CORE-03 | Personal details: contact, home and current address, emergency contacts, gender (inclusive options and "prefer not to say"), date of birth, other details the company enables. | Self-edit of phone needs HR approval when the company setting says so (D-02); the request is logged. |
| CORE-04 | Statutory details: PAN, UAN, ESIC, Aadhaar last 4, passport, work permit, category and eligibility with effective dates. Format checks. Masked by default; reveal needs permission and step-up; every reveal logged. | Bad PAN refused with the expected pattern; reveal without step-up = 403; reveal writes an access row. |
| CORE-05 | Profile page with tabs Overview, Job, Timeline, Documents, Requests, Tasks, Statutory. Tabs hide without permission. *Drawer exists.* | Manager sees no Statutory tab for a report; HR sees all. |
| CORE-06 | Timeline (Journey): every event in order with a "Why?" link, grouped by episode. | Promotion shows date, before and after, approver, rule version, request. |
| CORE-07 | Import: preview, field mapping, duplicate check, update mode, row errors, batch undo within 24 hours. *Create-only exists.* | 200 rows, 3 bad: preview lists 3; commit 197; undo removes exactly 197 and their events. |
| CORE-08 | Custom fields on the person (text, number, date, choice, yes/no, file) with who may see, who may edit, and versions. | Field visible to HR only: manager's API response does not contain the key. |

### 7.3 Organisation

| ID | Requirement | Acceptance |
|---|---|---|
| ORG-01 | Legal entity, establishments, departments (nested), teams, designations, grades, locations, cost centres. *Most exist; entity, establishment and team missing.* | Add, rename, deactivate each; delete blocked while in use. |
| ORG-02 | Reporting line with effective dates and an optional dotted-line manager. | Org chart as of a past date shows the old manager. |
| ORG-03 | Interactive org chart: search, collapse, open seats (when Team plan is on), "as of" date. *Outline exists.* | 300 people render under 2 s; keyboard navigable. |
| ORG-04 | Seats (positions): approved seats per team with designation and budget reference; filled or open. P0 = list; P1 = Team plan. | A person can be placed in a seat; an open seat shows on the chart. |
| ORG-05 | One cost centre list in People. Payroll's separate list is a cross-app item, not changed here. | People screens use only People's list. |

### 7.4 Joining, Changes, Leaving (Flow)

| ID | Requirement | Acceptance |
|---|---|---|
| LIFE-01 | **Before day one:** invite by email or phone; joiner fills personal details, uploads documents, signs declarations, reads policies, before the joining date. | Invite works once, expires in 14 days, sees only their own data; entries land as "sent, not checked" until HR checks them. |
| LIFE-02 | **Joining plan:** tasks for HR, manager, IT, facilities, Payroll, employee; each with a named person, due date, status. *Checklists with role owners exist.* | Joiner on 1 Nov: "Laptop" assigned to the named IT admin, due 31 Oct; on 1 Nov it shows overdue on IT's Home. |
| LIFE-03 | **Probation:** reminder before the end date; review (period, goals, observations, recommendation); confirm, extend or end; employee told. | Confirm writes a timeline event and status Confirmed; extend asks for a new end date. |
| LIFE-04 | **Changes:** transfer, promotion, manager, establishment, type. Current vs proposed side by side, effective date, reason, approval, **what else this affects** (policies, holidays, PT state, other apps notified). | Karnataka to Maharashtra: review tasks for each rule that differs; nothing is changed in Payroll by People. |
| LIFE-05 | **Leaving:** resignation (by employee or HR), notice dates, last working day, handover, hand-back list (assets, access), approvals, optional exit interview, final settlement handed to Payroll, relieving and experience letters. | Approved resignation creates the leaving plan and `people.employee.separation_scheduled.v1`; on the last day status becomes Left and `people.employee.separated.v1` is sent once. |
| LIFE-06 | **Rejoin:** new episode, new joining plan, old record kept. *Rehire loses the first joining date (R-03).* | Rehire asks for a rejoin date; first joining date unchanged. |
| LIFE-07 | Tasks can be done from Home and from an email link; every completion logged. | IT ticks a task from Home: log row with user and time. |
| LIFE-08 | **Expiring work permission or certification:** alert, review task, and a list of work the person may not do until renewed (shown, not enforced in other apps). | Permit expiring in 30 days: HR and manager tasks; on expiry the person shows "Permit expired" on the profile and in Health check. |

### 7.5 Documents and letters

| ID | Requirement | Acceptance |
|---|---|---|
| DOC-01 | Upload with category, **classification** (Employee can see · HR only · Restricted · Confidential), expiry, owner, retention. | Attendance Manager role cannot list or open HR-only documents (fixes R-01). |
| DOC-02 | Versions: replacing keeps the old version for HR. | v1 listed under "Earlier versions" after v2 upload. |
| DOC-03 | Expiry watch: reminders at 60, 30, 7 days and on expiry; expired items in Health check. *30-day reminder exists.* | One reminder per threshold, not one per day. |
| DOC-04 | Letter templates (offer, appointment, confirmation, increment notice, relieving, experience, service certificate) with merge fields, issued as PDF, stored on the profile with template version. | Appointment letter issued with fields filled and template version recorded. |
| DOC-05 | Acknowledgement: send a document to a person or group to read and accept; track who accepted. | 50 asked, 48 accept: 2 pending listed with a reminder button. |
| DOC-06 | Files in private object storage with links that expire, when configured; malware check before a file becomes downloadable; database storage stays as fallback. | Link expires in 5 minutes; reuse after expiry = 403; a test malware file is refused. |
| DOC-07 | Service certificate on request within the company's set days (Karnataka: 7 days, source in [05](05-INDIA-COMPLIANCE-MATRIX.md)). The company cannot mark "original documents held" for an establishment where that is not allowed. | Request in Karnataka shows a due date 7 days out. |

### 7.6 Policies

| ID | Requirement | Acceptance |
|---|---|---|
| POL-01 | Library: title, category (leave, working hours, conduct, travel, benefits, IT, POSH, other), body or file, owner, search. | Employee sees only policies that apply to them. |
| POL-02 | Versions with effective dates; publishing keeps old versions readable; nothing is overwritten. | As of 1 Jun shows the version in force on 1 Jun. |
| POL-03 | Applies to: establishment, state, department, employment type, grade, category. | Maharashtra contractor sees the Maharashtra contractor policy only. |
| POL-04 | Acknowledgement per version, reminders, report. | New version needing acceptance creates a task per person in scope. |
| POL-05 | Publishing needs the policy owner's and HR head's approval (rule configurable). | Draft not visible to employees. |
| POL-06 | Conflict check: two published policies of the same category that apply to the same people on the same date are flagged in Health check. | Overlapping leave policies for one department appear as a conflict. |

### 7.7 Requests and approvals

| ID | Requirement | Acceptance |
|---|---|---|
| APR-01 | One approval engine for People requests: profile change, job change, leaving, document request, letter request, policy publish, help desk escalation, seat request. Leave stays on its current chain (shared module). | Each type routes through the engine; each decision writes one log row. |
| APR-02 | Approval rules: steps in order; approver = manager, manager's manager, department head, named person, role; a condition per step; rules versioned. | Promotion with grade change: manager then HR head. Without: manager only. |
| APR-03 | Due time per step; overdue sends a reminder, then hands on to the fallback approver. | Day 3 of a 2-day step: fallback has it; log says "handed on: overdue". |
| APR-04 | Stand-in approver for a date range. | Request on 2 Nov goes to the stand-in. |
| APR-05 | Approve, reject, ask for more information, with comment; nobody approves their own request. | Requester-approver is skipped to the next approver. |
| APR-06 | Approvals screen: all waiting for me, by due date, with "Why?" inline. | Overdue items show a pill with the word "Overdue". |
| APR-07 | Double submit and retry safe: the same request submitted twice creates one request. | Two clicks within 1 s: one request (idempotency key). |

### 7.8 Help desk

| ID | Requirement | Acceptance |
|---|---|---|
| DESK-01 | Employee raises a request: category, subject, description, urgency, attachment, preferred reply channel. *Register exists without these.* | Request from the employee app reaches HR within 1 minute. |
| DESK-02 | Thread with internal notes the employee never sees. | Internal note absent from the employee's API response. |
| DESK-03 | Assign to a person or queue; reply-by and resolve-by per category; overdue goes to the queue lead. | Payroll question in the Payroll queue, resolve-by 3 working days. |
| DESK-04 | Resolve with a reason; reopen within 7 days. | Reopen on day 8 refused with "raise a new request". |
| DESK-05 | Move to Private cases: the Help desk copy shrinks to "Moved on <date>". | No details remain in Help desk. |
| DESK-06 | Templates for common answers, linked to policies. | Answer inserted from a template cites the policy version. |

### 7.9 Private cases (POSH and grievances)

| ID | Requirement | Acceptance |
|---|---|---|
| PRIV-01 | Separate permission; only named members (Internal Committee, grievance officer) see a case; company admins do not unless named. | Owner role without membership gets 404. |
| PRIV-02 | Intake by the employee or on their behalf, recipient choice, conflict check (a named member is excluded). | Named member cannot open the case. |
| PRIV-03 | Timeline with legal deadlines (3-month filing window, 90-day inquiry, 10-day report, 60-day action: [05](05-INDIA-COMPLIANCE-MATRIX.md) C-POSH); evidence encrypted; every open logged. | Opening evidence writes an access row visible to the presiding officer. |
| PRIV-04 | Never in search, exports, reports or AI. | Search, export and Ask return nothing from private cases. |
| PRIV-05 | Annual report with counts only. | No names in the report. |
| PRIV-06 | Committee set-up: members, roles, terms (3 years), external member, half or more women; warnings when the set-up does not meet the rule. | Committee with fewer than half women shows a warning. |

### 7.10 Compliance and privacy (Guard)

| ID | Requirement | Acceptance |
|---|---|---|
| COMP-01 | Rule library: id, central or state, establishment types, employee categories, legal source and notification reference, effective from and until, superseded version, obligation and threshold, owner, due rule and recurrence, required proof, review status, last legally checked date. Never silently overwritten. | Editing a rule creates a new version; the old stays readable. |
| COMP-02 | Obligations per company, worked out from its establishments, headcount and people; status upcoming, due, overdue, done, checked; owner; proof. *Calendar exists for PF, ESIC, TDS, PT, bonus, POSH.* | A Maharashtra shop brings Maharashtra items; without one, none. |
| COMP-03 | Each obligation opens: source, scope, proof, owner, history. No overall score. | No screen shows a "% compliant" number. |
| COMP-04 | Transfer between states creates review tasks for rules that differ; the system does not decide the legal effect. | See LIFE-04. |
| COMP-05 | Every rule shows "Last checked by <name> on <date>"; unchecked rules show "Check with your adviser". | New unchecked rule shows the banner. |
| COMP-06 | Registers kept electronically where the codes allow, generated from records (employee register, leave register view, wage register handed to Payroll). | Employee register for an establishment exports with the fields the rule names. |
| PRV-01 | Privacy notice per purpose, versioned, read receipts, in English plus languages the company enables. *One notice exists.* | New version asks everyone to read again. |
| PRV-02 | Requests: access, correction, erasure with legal retention exceptions shown, nominee, grievance (answer within 90 days), consent withdrawal. *Exists.* | Erasure with payroll history: payroll records kept with the reason; other data erased. |
| PRV-03 | Retention schedule per data type with legal hold; nothing deleted without a person approving. | Past-retention data appears in a deletion review list. |
| PRV-04 | Anonymisation covers every People table. *Misses some (R-02).* | Search for old name, email or phone across all People tables returns 0. |
| PRV-05 | Breach register: Board and affected-person notices, 72-hour detailed report tracker, CERT-In 6-hour tracker as its own playbook; notices to every address on file. *Exists; misses some addresses (R-09).* | Person with only `email` receives the notice. |
| PRV-06 | External auditor access: time-limited, read-only, named evidence only, every view logged. | Access ends on time; auditor cannot open a profile. |
| PRV-07 | Access audit: every view of statutory details, confidential documents and private cases is logged and reviewable by the company. | Report lists who viewed a person's statutory details this month. |

### 7.11 Health check

| ID | Requirement | Acceptance |
|---|---|---|
| HLTH-01 | Missing or wrong data, expiring documents, overdue tasks, unread policies, people without a manager, policy conflicts, open seats past their date, changes waiting to apply. *Data health exists.* | Each item links to the person and the fix. |
| HLTH-02 | Every item says why it matters. | No item without a reason line. |
| HLTH-03 | Snooze with reason and date; snoozes logged. | Snoozed item returns on its date. |
| HLTH-04 | Headcount and movements: joiners, leavers, transfers, by month and establishment, "as of" any date. | Numbers match the change log. |

### 7.12 Why? (Trace)

| ID | Requirement | Acceptance |
|---|---|---|
| TRACE-01 | "Why?" panel on every changed value, approval outcome, plan task, health item: what changed, when, who asked, who approved, rule or policy version, evidence, downstream effect (events, tasks). | Promotion panel shows all seven, each a link. |
| TRACE-02 | Says when something is unknown ("No approval recorded: changed before history started"). | Pre-history change shows that line. |
| TRACE-03 | Raise a correction or a Help desk request from the panel, pre-filled. | The request carries the change id. |
| TRACE-04 | **Salary question journey** (section 8.1): People gathers the evidence from Payroll and Attendance through their read interfaces, shows it, and routes a correction to the owning app. People never computes pay. | With interfaces available, the employee sees deduction, evidence, rule version and a correction path; without them, People says which evidence is missing. |
| TRACE-05 | Decision record: every approved change stores the policy versions and evidence ids it used, so a later reader sees the rules as they were. | Policy changed after the decision: panel still shows the old version. |

### 7.13 Forms and Approval rules

| ID | Requirement | Acceptance |
|---|---|---|
| FORM-01 | Custom fields (phase 2): see CORE-08. | |
| FORM-02 | Form studio (phase 3): fields from a schema, conditional logic, validation, sections, versions, permissions. | A form with a field shown only when "Type = Contractor" hides it otherwise, on screen and on the server. |
| FORM-03 | Every significant form supports: (1) draft and resume, (2) server-side validation, (3) field-level permissions, (4) document classification and secure upload, (5) conditional fields and policy defaults, (6) draft vs published versions, (7) approval and notification rules, (8) effective-dated changes, (9) conflict and double-submit protection, (10) full history of who submitted, reviewed and changed. | One automated test per behaviour per form type (07, FORM-03a..j). |
| FORM-04 | Protected fields (legal name, joining date, statutory ids, status, establishment, salary links) cannot be written by a custom form; statutory required fields cannot be removed; server checks permissions whatever the form says. | A form that maps to `status` is refused at publish. |
| FORM-05 | Workflow studio (phase 3): trigger (record created, field changed, date reached), conditions, steps (task, approval, notify, wait), due times, escalation; versioned; test mode. | A "contract end in 30 days" trigger creates the review task once. |

### 7.14 Reports

| ID | Requirement | Acceptance |
|---|---|---|
| RPT-01 | Standard reports: headcount, joiners, leavers, movements, probation due, documents expiring, policy reads, help desk times, obligations. "As of" any date. | Each export matches its screen. |
| RPT-02 | Saved views and scheduled email (existing `ReportSchedule`). | Weekly report arrives with the filters saved. |
| RPT-03 | Every report respects field permissions and private cases. | Manager's export has no statutory columns. |
| RPT-04 | Plain-language questions over approved report templates (P2, via Ask). | See ASK-04. |

### 7.15 AI controls and Ask

| ID | Requirement | Acceptance |
|---|---|---|
| AIG-01 | AI is off per company until an owner turns it on and accepts the processing terms. | AI call for a company with AI off is refused. |
| AIG-02 | Settings: sources AI may read (policies first), provider, whether data may leave India, which roles may use it. | Each change writes an audit row. |
| AIG-03 | Every answer logs question, sources, user, model, result; the company can read the log. | One log row per answer. |
| AIG-04 | AI never writes. Suggested actions become drafts a person submits. | No AI code path calls a write service (review gate and test). |
| AIG-05 | Tenant, permission and classification filters run in retrieval and tools, not in the prompt. | Cross-company and cross-permission retrieval tests return nothing. |
| AIG-06 | Evaluation set (synthetic) with grounding, permission and prompt-injection cases; must pass before Ask is enabled for any company. | Eval report stored in the evidence register. |
| ASK-01 | Answer policy questions from the right policy version for the user's establishment, state and category. | "How many casual leaves can I carry forward?" cites the policy and version in force for that person. |
| ASK-02 | Every answer shows source, version, effective date, state and category, "informational" or "authoritative", and a "Ask HR" button. | All six present. |
| ASK-03 | If evidence is not enough, says it cannot answer. | Question with no matching policy returns "I can't find this in your company's policies". |
| ASK-04 | Report questions map to approved report templates only. | A question needing a non-approved query is refused with the closest report. |
| ASK-05 | Never answers about other people's pay, private cases or health data. | Such questions refused. |

### 7.16 P1 and P2 (full requirements written before each phase starts)

| Module | First version does | Not in the first version |
|---|---|---|
| Home (employee) and News | Announcements, recognition, simple surveys, feedback, directory | Social feed rankings |
| Goals and reviews | Goals and OKRs with check-ins, 1:1 notes, review cycle with self and manager rating, calibration view, improvement plan | Forced ranking |
| Skills and training | Skills with levels, proof and assessor, validity; training records; certificate renewals | Skill inference by AI |
| Hiring | Opening request, job, stages, interviews, offer letter, convert to joiner | Automatic rejection or candidate scoring |
| Pay reviews | Increment and promotion proposals with budget totals; sent to Payroll after approval | Calculating pay in People |
| Benefits | Plans, eligibility, enrolment, nominees, wellness programmes | Insurance purchase |
| Team plan | Approved seats, open seats, contractors, staffing need, cost what-if from Payroll averages | Forecasts about individuals |
| IT and assets | Assets with hand-out and return history; IT tasks; access review list | Device management |
| Openings inside | Internal posts, apply, mentors, project chances, succession list | AI matching |
| What-if | Headcount and cost scenarios, policy change impact counts | Predictions about individuals |

---

## 8. Journeys

### 8.1 Signature journey: "My salary is lower this month. I attended work. Why?"

People coordinates; it does not own pay or attendance. Each step names who owns the data.

| Step | What happens | Owner of the data | People's part |
|---|---|---|---|
| 1 Find the difference | Fetch the employee's payslip breakdown they are allowed to see | Payroll | Calls Payroll's read interface (PI-01) |
| 2 Connect the evidence | Fetch the finalised attendance facts and exceptions for the period | Attendance | Calls Attendance's read interface (AI-01) |
| 3 Find the rule | Resolve location, employment terms, rule version and pay period | People (terms, establishment, policy version) + Payroll (rule) | Supplies its own records "as of" the period |
| 4 Explain | Show the deduction, the evidence, and any uncertainty or open discrepancy | All | Renders the "Why?" panel; says what is unknown |
| 5 Open a correction | Start an Attendance correction with manager approval | Attendance | Opens the owning app's request with context (no write into Attendance) |
| 6 Reconcile | Payroll previews and applies any authorised adjustment | Payroll | Shows status from Payroll's event |
| 7 Close the loop | Tell the employee, keep the decision history, show the result | People | Help desk request closes with the linked decision record |

**What makes it different:** a traceable explanation and a correction path, not an unsupported AI answer or a ticket lost in email. **Dependency:** the read interfaces PI-01 and AI-01 belong to the cross-app fix; People ships the panel and says plainly which evidence is not yet available.

### 8.2 Other journeys (each becomes an end-to-end test in 07)

| Journey | Steps |
|---|---|
| New hire | Offer accepted → before day one (details, documents, policies) → HR checks → manager set-up → IT access and device → attendance enrolment requested (event) → day one → probation reminder |
| Transfer | Request → current vs proposed → approvals → effective date → new manager, establishment → review tasks for leave, shift, holiday, PT rules that differ → events to Attendance and Payroll → timeline |
| Leaving | Resignation → approval → notice dates → hand-back list (assets, access) → access removal tasks → final settlement handed to Payroll (2 working days rule, see 05) → relieving and experience letters → Left |
| Expiring work permission or certificate | Alert at 60/30/7 days → review → renewal or permitted-work note → Health check until resolved |
| New legal obligation | Rule added (new version) → companies and people affected listed → policy review task → approval → publish → employees asked to read |

---

## 9. Ownership and interfaces

People never copies another app's logic. Where it needs something, it asks through an interface.

| Data or job | Owner | People's access |
|---|---|---|
| Employee identity, employment status, job history | People | Owns |
| Company, account, subscription, sign-in, central permissions | Platform | Uses the shared shell and permission service |
| Punches, schedules, processed attendance, corrections | Attendance | Read interface AI-01 (planned); events |
| Leave accrual and ledger | Attendance's engine for now; moves only through an explicit ownership cut-over | Shows; never recalculates |
| Salary, payslips, deductions, statutory pay, final settlement | Payroll | Read interface PI-01 (planned); events |
| Journals, expenses, ledger | Accounting | None needed in P0 |
| Project allocation and delivery | Projects (not built) | None |
| Lifecycle plans, HR requests, private cases, policies, documents | People | Owns |

Existing Attendance employee records already use People's employee id (one table); no migration is needed for identity. Mapping of reader ids stays in Attendance.

---

## 10. AI: where it belongs

Rules first, AI assisting. The model never becomes the authority for employment or pay decisions.

| Use | How | Decision |
|---|---|---|
| Explain company HR policies | Permission-aware retrieval over policy versions | Build early (after AIG passes) |
| Explain my requests and statuses | Scoped APIs + AI wording | Build early |
| Search employee documents | Authorised retrieval, classification-aware | Build early |
| Suggest who should approve | Deterministic rules + AI suggestion | Build early |
| Find missing or conflicting data | Rules + anomaly checks | Build early (rules first, in Health check) |
| Read fields from documents | OCR + AI, a person confirms | Later |
| Compare policy with new law | Source-grounded retrieval + human review | Later |
| Report questions in plain words | Approved report templates + AI | Later |
| Help desk in Indian languages | Translation + retrieval | Later |
| Match skills to training | Skill graph + suggestions | Later |
| Workforce what-ifs | Rules + scenarios + AI explanation | Later |
| Predict who will leave | High-risk profiling | **Defer** |
| Reject candidates automatically | Consequential automated decision | **Avoid** |
| End employment automatically | Consequential automated decision | **Prohibit** |
| Produce legally binding calculations | Not People's job | **Prohibit** |

**Answer flow:** user question → gateway checks identity, company, permission and intent → retrieval from permitted sources and live read APIs → model writes a grounded answer → checks for citations, safety and permissions → optional human approval before any action.

**Models:** start with rules and plain search; add pgvector only when policy retrieval needs meaning-based search; keep inference behind a provider-neutral gateway; allow a local or privately hosted model; never send sensitive HR records to a provider without an approved processing arrangement and company control. A personal workstation (the owner's RTX 4080 machine) is fine for building and evaluating, never for production.

**Synthetic data:** a synthetic workforce generator (07, TEST-GEN) produces joiners and leavers, different states and categories, shift anomalies, rehires and transfers, conflicting policies, mid-period policy changes, missing documents, expiring certificates, requests by unauthorised roles, and AI attempts to read across companies. Real employee data is never used for training or testing.

---

## 11. Non-functional requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR-01 | Tenant isolation | Cross-company test per new route and table (pattern: `server/src/__tests__/tenantIsolation.test.ts`). |
| NFR-02 | Speed | Directory first page of 2,000 under 1 s; profile under 800 ms on the dev database. |
| NFR-03 | Accessibility | Keyboard usable; contrast measured per `DESIGN.md`; every field labelled. |
| NFR-04 | Mobile | Employee and manager actions usable at 375 px; policy writing, audit and planning desktop-first. |
| NFR-05 | Screen states | Loading, empty, error, no permission, offline on every screen. |
| NFR-06 | Audit | Actor, time, before/after reference, correlation id on every write; append-only. |
| NFR-07 | Retention | Change log and audit kept at least 8 years for payroll-linked records unless the company sets longer; logs 1 year minimum (DPDP Rule 6) and 180 days in India (CERT-In). |
| NFR-08 | Design system | `DESIGN.md` rules; checked by `test/design-rules.test.js`. |
| NFR-09 | Security | MFA support; no silent impersonation (support access approved and logged); encryption in transit and at rest; encrypted backups with tested restores. |
| NFR-10 | Imports | Preview, validation, dedupe, undo, reconciliation report. |

---

## 12. Build order

| Phase | Weeks (indicative) | Delivers | Exit gate |
|---|---|---|---|
| 1 Foundations | 1-4 | Ownership contracts written; R-01, R-02, R-03, R-04, R-06, R-10 fixed; FND-01..09; CORE-01, 04, 05; ORG-01, 02; DOC-01; responsive base UI | All foundation tests and cross-company tests green |
| 2 Daily work | 5-10 | Employee profile, Before day one and Joining, Changes, Leaving; documents, approvals, policies, help desk; events; FORM-01 | Join, change and leave journeys pass in the browser |
| 3 Trust and compliance | 11-16 | Why?, decision records; Compliance, Privacy, retention; private cases; Health check; reports; AI controls; form and workflow studio | Restore test, privacy request and private-case access tests recorded |
| 4 Pilot | 17-24 | Design partners; read-only policy Ask behind AI controls; fixes | Release gates (section 13) |
| 5 Grow | after | P1 then P2 | Per-module PRD |

Sequencing reason: every later screen writes changes, so effective dating, the change log and the outbox come first; Why? needs them to have something to show; Compliance needs establishments and policies; Ask needs all of these plus controls. The dates are illustrative for a focused AI-assisted solo effort.

---

## 13. Release gates (before real companies rely on People)

1. Every tested cross-company access attempt is blocked.
2. Every material change has an authenticated actor and traceable history.
3. Attendance and Payroll keep working through People changes, migrations and failures (their suites green on every People commit).
4. Approval, retry and duplicate-event cases pass automated tests.
5. Backup restore and privacy-request workflows demonstrated and recorded.
6. Ask passes permission isolation, source grounding and prompt-injection evaluations.
7. AI cannot change salary, employment status, statutory settings or discipline.
8. Compliance claims reviewed against current rules by a named person ([05](05-INDIA-COMPLIANCE-MATRIX.md)).
9. Real employee data is not used for AI training or testing.
10. Production HR data runs only on paid-grade backup, reliability, access control and incident response (free tiers are for development and synthetic pilots).

---

## 14. How we will know it works

| Measure (pilot companies) | Target |
|---|---|
| People records with no missing required data | ≥ 98% by end of month 2 |
| Joining tasks done by their due date | ≥ 90% |
| Help desk requests resolved within resolve-by | ≥ 85% |
| Documents expired with no renewal task | 0 |
| Policy versions with acceptances pending over 30 days | ≤ 5% of people |
| Help requests that cite a "Why?" panel | rising month on month |

We will validate the three flagship journeys with the first design partners before claiming them as different from competitors in public.

---

## 15. Open questions

With recommendations in [08-DECISIONS-AND-RISKS.md](08-DECISIONS-AND-RISKS.md): People colour (D-01), profile self-edits need HR approval by default (D-02), object storage provider and region (D-03), AI provider and India data residency (D-04), form and workflow studio timing (D-05), who checks compliance rules legally (D-06), leave ownership cut-over (D-07), naming of leave screens across apps (D-08).

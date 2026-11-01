# Company settings for six decisions, and one approval workflow engine

Owner brief (31 Oct 2026, in chat): make the six pending decisions customisable "where HR and management can decide", and "create workflow engine".
Written by clor-product-manager, wearing the clor-researcher hat. Docs only; the build goes to clor-coder-people in the phases of section 9.
The six settings and their defaults are also listed on one page in `DECISIONS.md`.

Who we build for: a business of one or two people first, where the owner signs in once and does everything. HR teams come later.
So every setting has a default that is right for that owner, and no flow may stop because "nobody else can approve".

---

## 1. What CLOR has today (research, with file paths)

CLOR already has three approval mechanisms. They grew separately, so the same idea (the manager, HR, a stand-in, "never your own") is written three times.

### 1.1 People approval engine: the base to build on

`server/src/services/people/approvals/engine.ts` (741 lines). It works and is well tested. This spec extends it; it does not replace it.

- **Rules:** `ApprovalRule` (people schema). One active rule per request type. It is versioned, and a request keeps the version it was submitted under. A rule has up to 8 ordered steps.
- **Step spec:** `{ order, approver: MANAGER | MANAGER_OF_MANAGER | USER | ROLE | HR | COLLEAGUE_MANAGER, condition?: { field, op: changed|eq|ne|gt|lt, value }, dueDays, overdue?: REMIND | HAND_ON(to) }`.
- **Who decides** is worked out when a step opens: the manager as of that day, unless they have left or are suspended. A manager without the approve right is passed over for HR. A stand-in (`StandIn`, user-based) is added for the dates they cover.
- **Own-record rule:** nobody decides a request they asked for, are the subject of, or are a party to. Such a step is skipped when someone else decides another step. Otherwise it goes to the company's admins (`lastResortDeciders`), and if there is nobody, submission fails with `409 NO_APPROVER`. **That is a dead end for a one-person company.**
- **Effects:** the module that owns a type registers `onApproved`, `beforeApproving` and `onClosed`. Final approval runs under an advisory lock. Requests left half-finished are finished by `finishStalled` from read paths and from the dues job.
- **Dues job:** `runApprovalDues`, every 15 minutes. It reminds, re-reminds every 3 working days, or hands on 24 hours after the first reminder.
- **Types today:** `PROFILE_CHANGE, JOB_CHANGE, LEAVING, DOCUMENT_REQUEST, LETTER_REQUEST, POLICY_PUBLISH, DESK_ESCALATION, SEAT_REQUEST, PROBATION, SHIFT_SWAP, EXPENSE_CLAIM, EMPLOYEE_ADVANCE, SALARY_ADVANCE`, plus `FORM:<id>` for request types HR defines (PR #75, `services/people/requestForms.ts`). `LEAVE` is a *rule type* only (see 1.2).
- **Default rules** are created lazily, each in its own place: `selfService.ts:230` (profile: HR), `leaving.ts:180` (manager then HR, hand on to HR), `money/expenses.ts:123` (manager, then HR above ₹5,000 a month), `shiftSwaps.ts:263`, `requestForms.ts:199`.
- **Routes:** `server/src/routes/peopleApprovals.ts`: rules CRUD (`PEOPLE::Approvals`), requests, decide, bulk-decide, reply, withdraw, stand-ins.
- **Screen:** `apps/people/src/screens/ApprovalRules.jsx`, a list of request types with a drawer that edits the steps.

### 1.2 Attendance chains: three hard-coded shapes

`server/src/services/attendance/approvalChain.ts`: `HR | MANAGER | MANAGER_THEN_HR`, stored as strings on `AttendanceSettings`.

| Request | Where the chain is chosen | Where it is enforced |
|---|---|---|
| Leave | `AttendanceSettings.leaveApproval`, or per leave type `LeaveType.approval`; `RULE` borrows the engine's `LEAVE` rule (`leaveRules.ts`) | `routes/leave.ts` reviewLeave, `leaveRules.ts nextLeaveStep` |
| Missed punch, WFH, on duty, permission, shift change | `AttendanceSettings.correctionApproval`, per kind `requestRules[kind].approval` | `attendance/requests.ts decideRequest`, `story()/deciderWords()`, `requestsWaitingForReader` |
| Overtime, comp-off | `AttendanceSettings.overtimeApproval` | `attendance/selfService.ts decideOvertime` |
| Field punch | `AttendanceSettings.fieldPunchApproval` (on/off) | `attendance/phonePunch.ts` |

The manager's step is stored as columns on the request row (`managerApprovedAt`, `managerApprovedById`), with a `history` JSON.
Stand-ins are a second table, `ApprovalStandIn`, keyed by employee (`attendance/standIns.ts`).

**The decision-2 problem, exactly.** Under chain `HR`, `deciderWords()` says "HR, or you as their manager" to a Team Manager. The Team Manager preset (`permissionCatalog.ts TEAM_MANAGER`) holds `ATTENDANCE::Attendance Requests::APPROVE` with own-team scope, and `decideRequest` lets anyone holding that right close the request inside their scope. So "HR decides" really means "HR, or any approver whose scope holds the person". PR #80 QA F4 fixed the wording. The rule itself is still unwritten.

Own requests: `selfDecisionAllowed()` (`makerChecker.ts`) follows the company's maker-checker setting. Under AUTO, a person may decide their own request only when nobody else could, and that is audited as `SELF_APPROVED`. **This is the behaviour a one-person company needs, and the People engine does not have it.**

### 1.3 Payroll maker-checker

`server/src/services/makerChecker.ts`, with `AuthPolicy.makerChecker = AUTO | STRICT | ALLOW` (platform schema).

- `ownRecordRefusal`: never approve something about yourself, whatever the setting.
- `ownWorkRefusal`: approving your own work follows the setting.

Used by salary revisions (`routes/payrollRevisions.ts`: draft → reviewed → approved → applied), final settlements (`routes/payrollSettlements.ts`: draft → approved → paid, with step-up), pay runs and loans.
There are no configurable steps. "Who approves" is "whoever holds `PAYROLL::<resource>::APPROVE`".

### 1.4 Other related pieces

- **Books amount thresholds:** `services/approvals.ts` (Books invoices). Out of scope; Books keeps its own rules.
- **People automations** (PR #81, `services/people/engagement/automations.ts`): 17 plain-sentence recipes with a switch. Two are about approvals: the leave digest and "leave waiting". The engine's reminders stay in the engine; the recipes keep the digests.
- **Notifications:** the platform `Notification` model has `dedupeKey` but no link to what it is about. So a "Waiting for you" item stays in the bell after the request is withdrawn (decision 6).

### 1.5 Where today's code answers the six decisions

| # | Today | Where |
|---|---|---|
| 1 | Marks rules: every N late marks after a grace cost ½ or 1 day, from leave or else loss of pay. The first `free` marks cost nothing. Off by default; the old two-number form (`lateAllowancePerMonth`, `latePenaltyEvery`) reads as ½ day. | `attendance/timeRules.ts`, `markRules.ts`, `compute.ts` |
| 2 | See 1.2: chain `HR` by default, with team-scoped approvers also deciding | `attendance/requests.ts` |
| 3 | HR Manager has no `PAYROLL::Salary Revisions` grant, so People → Salary revisions is empty for HR without Payroll | `permissionCatalog.ts HR_MANAGER`, `routes/payrollRevisions.ts` |
| 4 | Payslips cap deductions at `PayrollSetting.deductionCapPercent` (50). The final settlement recovers loans and advances **in full**, with no cap. | `payroll/deductionCap.ts`, `finalSettlement.ts` |
| 5 | Anyone with `PEOPLE::Lifecycle::VIEW` sees leavings **and the typed reason**. That includes Viewer (VIEW on everything) and IT Administrator (Lifecycle VIEW/EDIT). | `routes/peopleLifecycle.ts:34 privateOk`, `lifecycle/board.ts:154` |
| 6 | The engine's withdraw changes the request, not the bell. Attendance tells the approver only when an *approved* WFH or on-duty is cancelled. | `approvals/engine.ts withdraw`, `attendance/requests.ts tellOwnCancel` |

---

## 2. How others do it (brief)

| Product | Shape | Worth borrowing | Weak spot |
|---|---|---|---|
| **Zoho People** | Approvals per form, up to 5 levels in an order you set, criteria per form; in Zoho's approval model several approvers on a level can be "anyone" or "everyone" | Criteria-picked rule variants per form; ANY/ALL on a level | Five levels, set form by form, with no shared chain ([blog](https://blog.zoho.com/people/zoho-people-multiple-criteria-simple-approvals.html), [admin guide](https://prezohoweb.zoho.com/people/help/adminguide/approvals.html), [Zoho approval options](https://help.zoho.com/portal/kb/articles/approval-process)) |
| **Keka** | Approval chain per module; "+Add new level"; Level 1 the reporting manager, Level 2 the L2 manager. A level is skipped when the approver is not registered, lacks the role or has been relieved. "Auto-approve and skip if no action in X days" on every level but the last; the last is never auto-approved | Skip-the-missing-approver rule; never auto-approve the last level | Keka's own articles disagree on time-based auto-approval ([leave chain](https://help.keka.com/admin/admin-help/how-to-configure-approval-chain-for-leave), [why a level is skipped](https://help.keka.com/hc/en-us/articles/39946619341969-Why-would-a-level-of-approval-get-skipped), [auto-approval](https://support.keka.com/support/solutions/articles/84000382269-how-to-configure-auto-approval-settings-if-an-employee-requests-a-comp-off-or-any-leave-and-no-acti)) |
| **greytHR** | Workflow → Setup → Workflow levels, 1–5 reviewer levels per workflow; escalation (duration + escalation point) on the last level; a Request Hub policy cannot be edited once active | Escalation point after a set time | Delete-and-recreate to edit; CLOR versions instead ([manage approval workflows](https://www.greythr.com/help-admin/request-hub/manage-approval-workflows/), [workflow levels](https://www.greythr.com/greythr-help/admin/answers/UNU0zgSkTW2O7mq3xNv13w/)) |
| **Frappe HR** | Leave uses a status field and a leave approver. The generic Frappe Workflow (states, transitions, roles) can be laid over any doctype. "Prevent self-approval for leaves" is a setting, off by default | One generic engine over many documents | Workflow states are a developer's model, not a small business owner's; self-approval is allowed unless switched off ([workflows](https://docs.frappe.io/erpnext/v12/user/manual/en/setting-up/workflows), [self-approval](https://docs.frappe.io/hr/leave-management/help-articles/how-do-i-stop-approvers-from-approving-their-own-leave)) |

What CLOR takes from them: ordered levels, ANY/ALL on a level, criteria-picked variants, skipping a missing approver, escalation after time, never auto-approving the last decision.
What CLOR keeps of its own: versions instead of delete-and-recreate, the own-record rule always on, and a one-person company that never stalls.

---

## 3. The six decisions as company settings

Each setting has: a plain caption, a default, who may change it, and audit. The defaults are written in `DECISIONS.md`.

Every change writes a platform `AuditLog` row: entity `COMPANY_SETTING`, `entityId` = setting key, `action: 'CHANGED'`, metadata `{ before, after }`.
Settings that change money (1, 4) also keep a dated version, so a month or settlement already worked out keeps the rule it used.

### 3.1 Late-mark cut (Time → Attendance rules → Late marks)

Today's marks rule becomes one sentence with a "how much" choice:

> Late marks after **[10]** minutes. The first **[2]** in a month are free. After that, cut **[the time actually missed ▾]**, taken from **[leave types]**, else unpaid.

| Option (`marks.cutMode`) | What it cuts |
|---|---|
| `TIME_MISSED` | The late minutes after the grace, summed for the month, valued at the day's wage ÷ the shift's minutes |
| `TIME_MISSED_ROUNDED` | The same, each mark rounded **up** to **[15 / 30 / 60]** minutes (`marks.roundToMinutes`) |
| `HALF_DAY_PER_N` | Today's rule: every **[N]** marks cost **[½ / 1]** day |

- **Free allowance:** `late.free` exists already. It applies before any mode.
- **Default:** `TIME_MISSED` for companies that have not switched late marks on. A company that has `marks.on = true` or a legacy `latePenaltyEvery > 0` keeps `HALF_DAY_PER_N` with its numbers, so its pay does not change.
- **Why `TIME_MISSED`:** Code on Wages 2019 s.20 allows a deduction for absence only in proportion to the working time missed in the wage period ([s.20 text](https://www.advocatekhoj.com/library/bareacts/codeonwages/20.php)). A half day for three 15-minute lates goes past that, and `markRules.ts` already notes that a bigger cut is a fine under s.19, which needs a notified list of acts.
- **Guard rail for `HALF_DAY_PER_N`:** the setting shows "This can cut more than the time missed. The law allows only the time missed." The readiness view shows, per person, the cut against the time missed. CLOR does not cap it silently. **Decided (owner, 31 Oct 2026, Q1):** the half-day mode stays, with this warning and the per-person comparison.
- **Who may change it:** HR with company-wide scope, and the owner. Today `PUT /attendance-rules` (`routes/peopleTimeRules.ts:72`) is guarded by `ATTENDANCE::Attendance Requests::APPROVE`, a right the Team Manager preset also holds. The coder confirms whether the handler refuses team-scoped users. If it does not, this setting adds that refusal (`ownDocumentsOnly` → 403), because a pay rule is not a team decision. Payroll is told by notice when it changes mid-month.
- **Audit and versions:** `recordRuleVersion` (`attendance/ruleVersions.ts`) already versions marks rules. `cutMode` and `roundToMinutes` join that snapshot, and a month already applied keeps its version.
- **Where the code changes:** `timeRules.ts` (types, schema, defaults, `legacyMarks` gives `HALF_DAY_PER_N`) and `markRules.ts costOf`. Minute modes give days as `minutes ÷ shift minutes`, rounded to 2 places. `compute.ts` takes `penaltyDays` as now.

### 3.2 Who closes an attendance correction (Settings → Approvals → Attendance requests)

> Missed punch, work from home, on duty, permission and shift change requests are decided by **[the person's manager or HR, whoever is first ▾]**.

| Option | Meaning | Engine preset (section 5.4) |
|---|---|---|
| `HR_OR_MANAGER` | **Default.** HR, or the person's manager (or their stand-in), whoever acts first. This is today's `HR` chain as it really behaves. | one step `ANY of [HR, MANAGER]` |
| `MANAGER` | The manager decides. HR steps in only when there is no active manager. | `MANAGER` |
| `HR` | HR alone. Managers see the request but cannot decide it. | `HR` |
| `MANAGER_THEN_HR` | The manager, then HR, in that order. | `MANAGER`, then `HR` |

- **One-person company:** every option ends at the owner (section 5.6).
- Each request kind may still take its own choice (`requestRules[kind].approval`, already there). Leave and overtime keep their own setting with the same four options.
- **Migration:** a stored `HR` reads as `HR_OR_MANAGER`, so nothing changes. The new strict `HR` is a new value. The drawer's "Decided by" (`deciderWords`) reads the option's words.
- **Who may change it:** `PEOPLE::Approvals::EDIT` (the right that edits approval rules today), and the owner.
- **Audit:** `COMPANY_SETTING / attendance.correctionApproval`. Requests already waiting keep the steps they opened with.

### 3.3 Can HR see salary revisions (Settings → Privacy → Pay)

> HR without Payroll access can see salary revisions: **[No ▾]**. When Yes, they see the list and each revision's old and new pay, read only. They cannot raise, review or approve.

- **Default:** No. That is today, and pay stays with Payroll and the owner. In a one- or two-person company the owner holds everything anyway.
- **When Yes:** `GET /payroll/revisions` and `/:id` accept `PEOPLE::Employees::EDIT` in place of `PAYROLL::Salary Revisions::VIEW` (a read-only grant, checked in the route). Nothing else in Payroll opens.
- **Who may change it:** the owner or an admin only (`roleType ADMIN`). This is a privacy decision about pay, so HR cannot grant it to themselves.
- **Audit:** `COMPANY_SETTING / people.hrSeesSalaryRevisions`. Each read by an HR-only reader writes `SALARY_REVISION_VIEWED` once per day per reader.

### 3.4 Final settlement: loan and advance recovery (Payroll → Settings → Final settlement)

> In a final settlement, loans and advances are recovered up to **[50]%** of the final wages. The rest stays owed by the person.
> Final wages are: **[✓ salary for days worked] [✓ notice pay the company owes] [✓ leave encashment] [✓ other earnings this period] [ ] gratuity [ ] reimbursements**.

**Research (sources, uncertain points marked):**

- **The cap:** Code on Wages 2019 s.18(3): total deductions under s.18(2) "in any wage period" may not pass 50% of the wages. Under s.18(4) any excess "may be recovered in such manner, as may be prescribed" ([s.18 text](https://www.advocatekhoj.com/library/bareacts/codeonwages/18.php)). Payroll already applies the cap on payslips (`deductionCap.ts`). The Payment of Wages Act 1936 s.7(3) had the same 50% rule before 21 Nov 2025.
- **Final settlement:** the last wage period is still a wage period, so the cap plainly covers the deductions from its wages. **Uncertain:**
  - whether amounts that are not wages are inside the cap at all. s.2(y) excludes, among others, gratuity payable on termination and retrenchment compensation ([Taxmann on s.2(y)](https://www.taxmann.com/post/blog/definition-of-wages-section-2y-code-on-wages-50-percent-rule/));
  - what s.18(4)'s prescribed manner is for a person who has left, since there is no next wage period. The central rules for it are not checked here.
- **Practice:** Indian payroll guides recover outstanding loans from the final settlement as a matter of course ([Zoho Payroll academy](https://www.zoho.com/in/payroll/academy/payroll-administration/fnf.html), [Razorpay](https://razorpay.com/payroll/learn/full-and-final-settlement-fnf/)). None of them deals with the 50% cap. Recovering in full from wages alone would break s.18(3).
- **Gratuity** is protected in law. Recovering a loan from it is a lawyer's question; CLOR keeps it **out** of final wages and out of recovery by default.
- **Leave encashment:** s.2(y) does not list it among the exclusions. **Decided (owner, 31 Oct 2026, Q3):** it counts as final wages; it stays ticked by default and can be unticked.
- **Payment due:** Code on Wages s.17(2), within two working days of leaving (already shown by #81's final-pay clock).

**Setting fields** (`PayrollSetting`, payroll schema):

| Field | Default |
|---|---|
| `fnfRecoveryCapPercent Int` | 50, range 0–50. A company may be stricter, never looser. |
| (no field) | The rest always becomes an amount owed by the person, shown on the settlement and on People → leaving, for HR to collect outside payroll. **Decided (owner, 31 Oct 2026, Q2):** there is no consent option, so CLOR never recovers past the cap. |
| `fnfFinalWages Json` | `{ daysWorked: true, noticePayOwed: true, leaveEncashment: true, otherEarnings: true, gratuity: false, reimbursements: false }`. Gratuity and reimbursements cannot be ticked in phase 1; the switch is shown disabled with "Not wages in law". |

**What changes in `finalSettlement.ts`:** recovery lines are capped at `percent × final wages`, less the other deductions in the period (statutory ones counted as `deductionCapCountsStatutory` says). The capped part goes on as before. The rest is an `OWED` line. A settlement saves the setting it used.

- **Behaviour change:** today recovers in full. Draft settlements made before the switch keep their figures; new drafts use the cap. **Decided (owner, 31 Oct 2026, Q2):** ship the 50% cap with the rest left owed.
- **Who may change it:** `PAYROLL::Payroll Settings::EDIT`, and the owner.
- **Audit:** `COMPANY_SETTING / payroll.fnfRecovery`.

### 3.5 Leavings and reasons for Viewer and IT Administrator (Settings → Privacy → Leaving)

> Read-only users and IT administrators see who is leaving and their last day: **[Yes ▾]**.
> They also see the reason typed for leaving: **[No ▾]**.

- **Defaults:** leavings Yes (IT needs the last day for access and assets); reason **No**.
- **Behaviour change:** today they see the reason. A reason is often personal (health, family, a complaint about a manager), so the private default wins. HR, the owner and admins always see it, and so does the person's manager when HR allows it per leaving (that switch already exists for exit-interview answers in #81).
- **Code:** `routes/peopleLifecycle.ts privateOk` becomes "`PEOPLE::Employees::EDIT`, or admin, or (setting on and Lifecycle VIEW)". The same check covers the change log's `leavingReason` line (`changeLog.ts` already lists the field) and the journey screen.
- **Who may change it:** the owner or an admin only.
- **Audit:** `COMPANY_SETTING / people.leavingReasonReaders`.

### 3.6 Withdrawn requests in the bell (Settings → Notifications)

> When someone withdraws a request, the "waiting for you" notice **[shows as withdrawn ▾ / is removed]**.

- **Default:** shows as withdrawn. The title keeps its words with "Withdrawn:" in front; it is marked read and links to the closed request. An approver who saw it this morning should not wonder where it went. The other value deletes the notice.
- **Data:** add `subjectKey String?` to platform `Notification`, with index `(orgId, subjectKey)`, set when a request notice is sent. Key forms: `approval:<requestId>`, `attendance:<id>`, `leave:<id>`, `overtime:<id>`. On withdraw, the engine (and attendance and leave until they move) calls `retireNotices(orgId, subjectKey, mode)`. Older notices without a key are left as they are.
- **Who may change it:** `PEOPLE::Approvals::EDIT`, and the owner.
- **Audit:** `COMPANY_SETTING / notifications.withdrawn`.

### 3.7 Where the settings live, and one screen for them

- **Data:** decisions 2, 3, 5 and 6 are new columns on `PeopleSetting` (people schema, one row per company, existing RLS), decision 4 on `PayrollSetting`, and decision 1 in `AttendanceSettings.timeRules.marks`. No new table.
- **Service:** `server/src/services/people/companyChoices.ts` exposes `choicesFor(orgId)` with defaults, and `saveChoice(actor, key, value)`, which checks the right, validates and audits.
- **Screen:** People → Settings → **Company choices**. One list of the six sentences in plain words, each with its control and a "Changed by Asha, 31 Oct" line. Each also shows from its own home screen (Attendance rules, Approvals, Payroll settings). One primary action, Save, top right. On a phone it is a single column, controls full width, 44px targets.

---

## 4. Request types the engine covers

| Type key | Module (owns the effect) | Today | Default steps (identical to today) |
|---|---|---|---|
| `LEAVE` | Attendance / Leave | chain or rule | from `leaveApproval` / `LeaveType.approval` (5.4) |
| `ATTENDANCE:MISSED_PUNCH`, `:WFH`, `:ON_DUTY`, `:PERMISSION`, `:SHIFT_CHANGE` | Attendance | chain | from `correctionApproval` / `requestRules` |
| `OVERTIME`, `COMP_OFF` | Attendance | chain | from `overtimeApproval` |
| `FIELD_PUNCH` | Attendance | on/off | `ANY of [HR, MANAGER]` when on |
| `SHIFT_SWAP` | People | engine | unchanged |
| `EXPENSE_CLAIM`, `EMPLOYEE_ADVANCE`, `SALARY_ADVANCE` | People money | engine | unchanged |
| `LOAN` | Payroll | maker-checker | `PAYROLL` (any holder of Loans APPROVE), own work per maker-checker |
| `SALARY_REVISION` | Payroll | maker-checker | `PAYROLL`; "reviewed" stays Payroll's own state |
| `FINAL_SETTLEMENT` | Payroll | maker-checker + step-up | `PAYROLL`; step-up stays in the route |
| `PROFILE_CHANGE`, `JOB_CHANGE`, `LEAVING`, `PROBATION`, `DOCUMENT_REQUEST`, `LETTER_REQUEST`, `POLICY_PUBLISH`, `DESK_ESCALATION`, `SEAT_REQUEST` | People | engine | unchanged |
| `FORM:<id>` | People request types | engine | unchanged |

Pay runs stay outside the engine for now. A pay run is the preparer's own work, not a request, and maker-checker already covers it. Declined for this spec; revisit with HR teams.

---

## 5. The engine design

### 5.1 One engine, the module keeps its record

The engine owns **who decides, in what order, by when**. The module keeps its own row (`LeaveRequest`, `AttendanceRequest`, `OvertimeRequest`, `SalaryRevision`, `FinalSettlement`) and its status, balance and effect, through the hooks that exist already (`onApproved`, `beforeApproving`, `onClosed`).

Every request type gets an `ApprovalRequest` row linked to its record by `sourceKind` + `sourceId`. The manager-step columns on leave, attendance and overtime rows stop being written once that type moves (phase 2, 3). They stay readable for old rows.

### 5.2 Rule and step spec, version 2

```ts
type ApproverSpec =
  | { kind: 'MANAGER' | 'MANAGER_OF_MANAGER' | 'DEPARTMENT_HEAD' | 'HR' | 'PAYROLL' | 'OWNER' | 'COLLEAGUE_MANAGER' }
  | { kind: 'ROLE'; id: string }          // anyone holding the role
  | { kind: 'USER'; id: string };         // a named person

type Condition = { field: string; op: 'eq' | 'ne' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'changed'; value?: string | number | string[] | null };
// Fields offered per type: amount, monthTotal, days, leaveTypeId, kind, departmentId, branchId,
// establishmentId, employeeTypeId, gradeId, plus a record's changed fields (PROFILE/JOB_CHANGE).

type StepSpec = {
  order: number;
  approvers: ApproverSpec[];             // one or more
  mode: 'ANY' | 'ALL';                   // ANY: first decision counts; ALL: each approver group must approve
  when?: Condition[];                    // all must hold, else the step is skipped
  due: { hours?: number; workingDays?: number };   // one of; 1h..60 working days
  overdue?: { action: 'REMIND' | 'HAND_ON' | 'AUTO_APPROVE'; afterHours?: number; to?: ApproverSpec };
  stepIn?: 'HR' | 'OWNER' | null;        // who may take this step in the approver's place (logged)
  ifRequester?: 'SKIP' | 'NEXT_UP';      // own-record handling, default SKIP (5.6)
};

type RuleSpec = {
  requestType: string;
  name: string;
  appliesWhen?: Condition[];             // a variant: e.g. branch = Pune; most specific wins, then priority
  priority: number;
  autoApprove?: { when: Condition[] }[]; // e.g. leave days <= 1 and type = Casual: approved, no person asked
  steps: StepSpec[];                     // 1..8
};
```

- **Version 1 rules** (today's JSON) are read through `normaliseSteps(v1)`: `approver` becomes `approvers: [approver]` with mode ANY, `condition` becomes `when: [condition]`, `dueDays` becomes `due.workingDays`. No data migration is needed; a rule is saved as v2 on its next edit (`specVersion` column).
- **`AUTO_APPROVE` on overdue** is refused on the last step that still has a person to decide (Keka's rule). Money types (`LOAN`, `SALARY_REVISION`, `FINAL_SETTLEMENT`, `SALARY_ADVANCE`) refuse it on every step.
- **Auto-approve rules** replace `LeaveType.autoApproveUpToDays` (read into `autoApprove` for LEAVE in phase 2). They are refused for the money types listed above.

### 5.3 Resolving who decides

Worked out when a step opens, as of that day:

| Kind | Who |
|---|---|
| `MANAGER`, `MANAGER_OF_MANAGER` | as today (active, may approve, else HR) |
| `DEPARTMENT_HEAD` | `Department.headEmployeeId` of the subject's department, if active and holding the approve right for the type, else HR |
| `HR` | as today (`hrDeciders`) |
| `PAYROLL` | holders of the type's Payroll APPROVE right, else the owner |
| `OWNER` | the company's ADMIN-role users (Owner role first) |
| `ROLE`, `USER` | as today. A named person who has left is treated as away (below). |

**Then, in order:**

1. **Stand-in:** one `StandIn` table, with both `userId` and `employeeId` columns, merging `StandIn` and `ApprovalStandIn`. An approver with a stand-in on that day has the stand-in added.
2. **Away:** an approver on approved leave for the whole of that day, with no stand-in, is passed to the next one up: manager → manager's manager → HR → owner. Logged on the step as "Away: Ravi on leave, sent to Meena".
3. **Own-record rule:** see 5.6.
4. **Scope:** a step's candidates must be able to read the subject (`teamScope`). A team-scoped role never decides outside its team.

`ALL` mode opens one `ApprovalStep` row per approver spec (`slot` 0..n). Each row has its own candidates (person + stand-in). The step completes when every slot is APPROVED; one REJECTED rejects the request. `ANY` opens one row with every candidate, as today.

### 5.4 Today's chains as preset rules (identical defaults)

| Today | Preset steps |
|---|---|
| `HR` (attendance, leave, overtime) | step 1: `ANY [HR, MANAGER]`, `stepIn: null`. This matches the current "HR, or a team approver in scope". |
| `MANAGER` | step 1: `MANAGER`, `stepIn: 'HR'` ("HR can still step in"). With no active manager it resolves to HR. |
| `MANAGER_THEN_HR` | step 1: `MANAGER`; step 2: `HR`, `ifRequester: 'SKIP'`; the HR step's candidates exclude whoever took step 1 ("not the manager who took the first") |
| Leave `RULE` | the existing `LEAVE` rule, unchanged |
| Payroll maker-checker | step 1: `PAYROLL`; own work handled by 5.6 using `AuthPolicy.makerChecker` |

Due times for the presets come from today's values: leave and attendance have none. They get `due.workingDays: 2` with `overdue: REMIND`, which only adds reminders and never changes who decides; that is the leave digest's behaviour moved into the engine.

`seedPresets(orgId)` creates these rules lazily from the stored settings. All the existing lazy `ensureRule` calls move into it, so there is one place for defaults.

### 5.5 Decisions, step-in, escalation

- **Decide:** approve, reject, ask for more information (as today). Approving claims the step row by status (as today). For ALL mode it claims the row of the slot the decider belongs to.
- **Step-in:** a person in the step's `stepIn` group may decide in the approver's place. It is logged as "Decided by Meena (HR) for Ravi", the requester is told who decided, and the own-record rule still applies.
- **Escalation:** `runApprovalDues` reads `due.hours` as well as working days. The order is: remind at due; after `afterHours` (default 24) `HAND_ON` to the named spec, or `AUTO_APPROVE` where allowed; a `REMIND` rule re-reminds every 3 working days (as today).

### 5.6 Own-record rule and the one-person company (no dead ends)

A step whose only candidates are the requester, the subject or a party is handled by `ifRequester`:

- `SKIP` (default): skipped when another step has someone else (as today).
- `NEXT_UP`: goes to the requester's own manager, then HR, then the owner.

**If nobody else could decide at all**, it falls through to the company's maker-checker setting (`AuthPolicy.makerChecker`, the same rule attendance already follows through `selfDecisionAllowed`):

| Setting | Result |
|---|---|
| `AUTO` (default) | the owner (or the requester, when they are the only person who could) approves it. One tap, written `SELF_APPROVED` with "nobody else in the company can decide this". For a one-person company the owner's own leave is recorded at once, with that line. |
| `STRICT` | refused with the existing `409 NO_APPROVER` words ("Give someone else the right to approve…"). |
| `ALLOW` | as AUTO, with the setting named in the audit. |

**Something about yourself** (your own salary revision, your own settlement, your own loan) is never self-approved, whatever the setting (`ownRecordRefusal`). In a one-person company those are the owner's own pay, recorded by the owner as the employer, and that is already how Payroll treats an owner with no employee record.

This removes `NO_APPROVER` as a dead end under the default. Tests prove that a one-user company can submit and close every request type.

### 5.7 What the requester and approvers see

- One **Approvals** inbox (existing) lists every type: the step, who else can decide it, and the due time. Leave and attendance rows come from the engine once they move. Until then the inbox merges, as it does today.
- The request drawer shows the steps as a short timeline: "Ravi (manager) approved 31 Oct · Waiting for HR, due 2 Nov".
- In the employee app the requester sees "With Ravi (your manager)", then "Approved".

---

## 6. Data model (Prisma)

All in the people schema unless named; every new table gets fail-closed RLS in the A-35 style (`clor.bypass` or `orgId = clor.org_id`, `FORCE ROW LEVEL SECURITY`), as in `20261113090100_attendance_rules_rls`.

```prisma
model ApprovalRule {            // existing, add:
  specVersion  Int     @default(1)   // 1 = today's JSON, 2 = section 5.2
  variantKey   String  @default("")  // "" = the type's main rule; else a stable key for a variant
  appliesWhen  Json?                 // conditions that pick this variant
  priority     Int     @default(0)
  autoApprove  Json?
  presetKey    String?               // HR_OR_MANAGER | MANAGER | MANAGER_THEN_HR | ... when made by seedPresets
  // @@unique([orgId, requestType, version]) becomes @@unique([orgId, requestType, variantKey, version])
}

model ApprovalRequest {         // existing, add:
  sourceKind   String?   // LEAVE | ATTENDANCE | OVERTIME | FIELD_PUNCH | SALARY_REVISION | FINAL_SETTLEMENT | LOAN | null (engine-owned)
  sourceId     String?
  ruleVariant  String   @default("")
  // @@unique([orgId, sourceKind, sourceId])
}

model ApprovalStep {            // existing, add:
  slot         Int      @default(0)    // ALL mode: one row per approver spec
  mode         String   @default("ANY")
  resolvedHow  String?               // MANAGER | STAND_IN | AWAY_HANDED_UP | STEP_IN | SELF_APPROVED | LAST_RESORT
}

model StandIn {                 // existing, add (ApprovalStandIn rows copied in, then retired in phase 3):
  employeeId        String?
  standInEmployeeId String?
  note              String?
  createdByUserId   String?
}

model PeopleSetting {           // existing, add (section 3):
  correctionApproval     String  @default("HR_OR_MANAGER")   // moved from AttendanceSettings in phase 2; read both until then
  hrSeesSalaryRevisions  Boolean @default(false)
  leavingsForReadOnly    Boolean @default(true)
  leavingReasonForReadOnly Boolean @default(false)
  withdrawnNotices       String  @default("SHOW_WITHDRAWN") // SHOW_WITHDRAWN | REMOVE
}
```

- **Payroll schema, `PayrollSetting`:** `fnfRecoveryCapPercent Int @default(50)`, `fnfFinalWages Json?`. `FinalSettlement` gets `recoveryRule Json?`, the snapshot of the setting it used.
- **Platform schema, `Notification`:** `subjectKey String?` with `@@index([orgId, subjectKey])`.
- **Cross-schema links** (`sourceId` pointing into the payroll schema) are id strings, as `payrollBridge.ts` does today. No foreign keys across schemas.

---

## 7. Migration from the hard-coded chains (identical defaults)

1. **Phase 1:** settings only, no engine change. The `HR` chain value is read as `HR_OR_MANAGER` in words and behaviour (it already behaves so).
2. **Phase 2, read-through:** `seedPresets` makes a rule per company from its stored `leaveApproval`, `correctionApproval`, `requestRules[kind].approval`, `overtimeApproval` and each `LeaveType.approval`. New leave and attendance requests open an `ApprovalRequest` with `sourceKind`. **Requests already PENDING finish on the old path:** the old code stays for rows with no `ApprovalRequest`, and is removed once none is pending (a data-health check counts them).
3. **Parity tests before switching:** for each of the four chains × {no manager, manager left, stand-in, own request, one-person company, team-scoped approver outside scope}, the old and new paths must give the same "who may decide" and the same outcome. The table is run against both.
4. **Writes to the old columns** (`AttendanceSettings.leaveApproval` etc.) continue in phase 2, so a rollback reads the same choice. They stop in phase 3.
5. **Payroll types** (phase 3) wrap the existing approve routes: the route asks the engine "may this user decide this step?" and records the step. Maker-checker and step-up stay where they are.

---

## 8. API, screens, audit, tests

### 8.1 API (People router `peopleApprovals.ts` unless named)

| Method and path | Right | Notes |
|---|---|---|
| `GET /orgs/:orgId/people/company-choices` | People Settings VIEW | the six settings, defaults, who changed what |
| `PUT /orgs/:orgId/people/company-choices/:key` | per section 3 | 403 with the right named; audited |
| `PUT /orgs/:orgId/payroll/settings/final-settlement` | Payroll Settings EDIT | section 3.4 |
| `GET /approval-rules` | Approvals VIEW | now with variants, presetKey, specVersion |
| `POST /approval-rules` | Approvals EDIT | v2 spec; validated by `cleanRule()`; new version |
| `POST /approval-rules/preview` | Approvals EDIT | for a draft rule and a sample (a person, an amount or days): who would decide each step today, and why. No write. |
| `DELETE /approval-rules/:type/:variant` | Approvals DELETE | retire; the main rule cannot be retired while a preset is needed. It is reset to the preset instead. |
| existing request routes | as today | decide gains the ALL slot; withdraw calls `retireNotices` |

Errors use the existing `ApprovalError` codes (`NO_RULE`, `NOT_APPROVER`, `OWN_REQUEST`, `ALREADY_DECIDED`, `NOT_WAITING`, `NO_APPROVER` under STRICT only), plus `RULE_INVALID` with the step and field named.

### 8.2 Approval rules screen (the builder)

Follows `DESIGN.md`: People brand D (indigo ink, lilac selected, marigold only for "waiting on you"), sentence case, page title = menu label ("Approval rules", fixing today's "Approval Rules"), one primary action, no card-in-card, no filler.

- **List page:** request types grouped as Time, People, Money, Pay, Your request types. Each row reads the rule in one line, e.g. "Leave: their manager, then HR when more than 3 days". A row whose rule is a preset says "Standard". Primary action top right: **New rule for a branch or department** (a variant).
- **Rule drawer** (side task, 44rem; full-screen sheet on a phone):
  - **Steps** as a numbered list of sentences built from pickers: "**Step 1:** [Their manager ▾] decides. Due in [2 working days ▾]. If late, [remind ▾]." Below it, "+ Another person in this step", with "[Any one of them ▾ / All of them]". Then "+ Only when… [Days asked for ▾] [more than ▾] [3]". Then "+ Add a step".
  - **Approve on its own when…** (auto-approve). Hidden for money types.
  - **Test it:** pick a person (and an amount or days). It shows "Ravi Kumar → Meena (manager) → Asha (HR)", including stand-ins and away hand-ups. It uses the preview API and is always visible above Save.
  - **Save** is the one primary action in the drawer. A saved rule shows "Version 3, saved by Asha today; requests already waiting keep version 2".
- **Phone (390px):** one column, step cards become a plain list under hairlines, pickers open as bottom sheets, 44px targets, and nothing scrolls sideways.
- **Small business view:** a company with fewer than 3 people with sign-in sees a one-line notice instead of the builder: "You decide everything. Requests from anyone come to you." Under it, a link "Set up approvals anyway".

### 8.3 Audit

- Rule saves: the new version row plus `AuditLog` `APPROVAL_RULE / SAVED`, with the version diff.
- Decisions: `writeChangeLog` on the request (as today), plus a step `resolvedHow`.
- Self-approval: `SELF_APPROVED` via `recordAudit`.
- Settings: section 3.
- Every audit line names a person, never an id.

### 8.4 Tests (server unless named)

- **Settings:** each of the six has a default, a save, a refusal for the wrong role (403) and an audit row. Decision 1 gives cut amounts for every mode (free marks, rounding, grace) and keeps the legacy ½ day. Decision 4 tests the cap at 50%, the rest left owed (never recovered past the cap), leave encashment counted in final wages, and a pre-switch draft unchanged. Decision 5 hides the reason from Viewer and IT admin and shows it to HR. Decision 6 tests a notice shown as withdrawn or removed.
- **Engine:** v1 rules normalise to v2; ANY/ALL; conditions (amount, days, branch, department, employee type); variants (most specific wins); auto-approve (refused for money); stand-in; away hand-up; escalation by hours; AUTO_APPROVE refused on the last step; the own-record rule with SKIP and NEXT_UP; maker-checker AUTO/STRICT/ALLOW; ALL-mode claim race (two deciders at once leave one decision per slot).
- **One-person company:** every request type submits and closes for a company with one user (the owner); none returns 409.
- **Parity table** (section 7.3), for leave, attendance and overtime.
- **RLS:** new columns stay behind the existing policies (`peopleRls` test).
- **Web:** `ApprovalRules` builder save and preview; Company choices screen; phone layout.
- **QA in the browser** (`clor-qa-employee`, `-manager`, `-hr`, `-owner`, `-boundaries`) runs the journeys in 8.5 at 1440×900 and 390×844.

### 8.5 Journeys for QA (with failure states)

1. Owner alone: adds own leave, and it is recorded at once with "nobody else can decide this". Own salary revision: refused with the plain words.
2. Two people: an employee's missed punch goes to the owner; under `MANAGER_THEN_HR` with no manager it goes straight to HR (the owner).
3. HR team: leave over 3 days goes manager → manager's manager. The manager is on leave with a stand-in, so the stand-in decides. Without a stand-in it goes up a level.
4. An expense over ₹5,000 needs HR after the manager. It is overdue and is handed on after 24 hours.
5. ALL mode: department head and HR both approve a salary advance. One rejects, so it is rejected.
6. Withdrawn: the bell shows "Withdrawn: …" under the default, and the notice is removed under the other value.
7. Settings: a Viewer cannot change any. HR changes the correction choice; the audit names them.
8. Failures: save while offline (the draft is kept and a retry is offered); 409 when two decide at once; 403 deciding outside your team; empty list; slow preview.

---

## 9. Build plan (PR-sized)

| Phase | PR | Contents | Size |
|---|---|---|---|
| **1. The six settings** | 1a | `companyChoices.ts`, `PeopleSetting` columns, Company choices screen, decisions 2 (wording and new strict `HR`), 3, 5, 6 (`Notification.subjectKey`, `retireNotices`) | M |
| | 1b | Decision 1: `cutMode`, `roundToMinutes` in marks rules, readiness view "cut vs time missed" | S |
| | 1c | Decision 4: Payroll final-settlement recovery cap, final wages, the rest left owed, snapshot (Payroll lane) | M |
| **2. Engine core + leave and attendance** | 2a | v2 spec, `normaliseSteps`, new approver kinds (DEPARTMENT_HEAD, PAYROLL, OWNER), ALL slots, conditions, variants, auto-approve, escalation hours, away hand-up, maker-checker fall-through (no dead ends), preview API. People types only. | L |
| | 2b | Stand-in merge (one table, read both) | S |
| | 2c | `seedPresets`, leave on the engine (`sourceKind LEAVE`), parity tests, old path kept for pending rows | M |
| | 2d | Attendance requests, overtime and comp-off, field punch on the engine; drawer and inbox from engine steps | M |
| **3. The rest + builder UI** | 3a | Payroll types (loan, salary revision, final settlement) through the engine, maker-checker kept | M |
| | 3b | Approval rules builder (section 8.2), phone layout, small business view | M |
| | 3c | Retire the old chain columns' writes, `ApprovalStandIn`, and the old leave and attendance step code once nothing is pending | S |

**2c, as built: two PRs** (clor-coder-workflow, 1 Nov 2026; one PR was too big to review).

- **2c-i:** `seedPresets` (`services/people/approvals/presets.ts`: the chains as rows `preset:<KEY>`, request type LEAVE, never the main rule), leave on the engine (`services/attendance/leaveEngine.ts`: `sourceKind` LEAVE, leave's own words for who decides, the leave decided in the same transaction as the step), parity tests (`leaveEngineParity.test.ts`), behind `PeopleSetting.leaveOnEngine`, off by default. A type on the company's leave rule (RULE) keeps its own walker. Requests already waiting finish on the old path.
- **2c-ii (as built):** the switch in Company choices (owner or admin, off by default; it stays off for new companies until the owner turns it on); the leave rule (RULE) on the engine, read in its walker's words (parity table: identical to the walker); the type's auto-approval as the rule's AUTO_APPROVED step and in the presets' `autoApprove`; reminders and the leave rule's hand-on from the engine's dues job; who decides refreshed hourly and when an approver's own leave for today is approved or cancelled; the drawer's step timeline; "With Ravi (your manager)" in the employee app. Planned at 2c-i: the leave rule (RULE) moved onto the engine; the request drawer's step timeline and "With Ravi (your manager)" in the employee app; the type's auto-approve read into the rule's `autoApprove`; reminders and away hand-up for leave from the dues job instead of leave's digest and hand-on.

Behaviour that differs from the chain on purpose, each tested: a manager away all day with no stand-in, where the manager alone decides a step, is sent up (5.3 step 2); the owner's own leave in a one-person company is recorded at once as SELF_APPROVED, and under STRICT refused when asked (5.6); a manager's step that nobody can take (a manager who can sign in nowhere) is skipped to HR instead of waiting for the type's hand-on; a request keeps the chain it was asked under when the setting changes later; under "the manager, then HR", when the only one who could take HR's step is the manager who took the first (a small business whose owner is manager and HR), HR's step is skipped and the leave is approved on that one decision, with "HR step skipped: nobody else can approve" in its history (owner's decision on PR #102 review, item 5: no dead ends; the old path refused HR's step to the manager and the leave waited for ever). On the company's leave rule, an owner alone taking leave: the rule's walker refused it (409 NO_APPROVER); the engine records it at once as SELF_APPROVED, as on the chains, and refuses it only under STRICT maker-checker (owner's decision on PR #104 review, item 2). The public API decides no leave on the approval rules (409), a chain's included: each step is its people's, in CLOR or the employee app. Who decides is worked out live when someone decides (rights, stand-ins, managers, absences), and the step's people are brought up to date when a stand-in is named or removed or a manager changes.

**2d, as built** (clor-coder-workflow, 1 Nov 2026): attendance requests (`ATTENDANCE:<kind>`), overtime and comp-off (`OVERTIME`, `COMP_OFF`) and field punches (`FIELD_PUNCH`) on the engine (`services/attendance/attendanceEngine.ts`), behind `PeopleSetting.attendanceOnEngine` (Company choices, owner or admin, off by default). Presets per type (`presets.ts TIME_PRESETS`) from the stored chain: attendance's "HR" is HR or the manager, Company choices' "HR only" is HR alone, overtime's "HR" is HR alone, overtime's "the manager" has no step-in (HR may only reject, as today), a field punch is HR or the manager. Who decides is read in attendance's words: the right that decides each today (Attendance Requests approve in scope; Attendance Records edit and Attendance Devices edit for overtime and punches, whose single routes check no team, so neither does the engine), the manager or their attendance stand-in in CLOR or the employee app. The module's own checks run first, word for word, so the engine never lets anyone decide whom they refused; a rejection the module allows outside the step's people (HR while the manager decides) is written by the module and the engine request closes to match. Requests already waiting finish on the old path; a request keeps the chain it was asked under. No away hand-up and no reminders (attendance had neither). Drawer: the steps in plain words. Parity: `attendanceEngineParity.test.ts`, every chain × scenario identical. Differences on purpose, as leave: a one-person company's own request or field punch is recorded at once as SELF_APPROVED (STRICT refuses the request; a field punch then waits on the old review, never refused); a manager's step nobody can take is skipped to HR; under maker-checker ALLOW nobody approves their own (5.6).

**3c, retiring `ApprovalStandIn` (stand-in merge, 2b), in this order:**

1. Delete every `StandIn` row whose `legacyId` no longer exists in `ApprovalStandIn`. An older API removed those delegates, and today the read hides them by checking the link. Once the fallback read and the table are gone, they would come back.
2. Copy any `ApprovalStandIn` row with no `StandIn` row (`legacyId`) into `StandIn`, as migration `20261118090000_stand_in_merge` does. These are delegates an older API named after 2b.
3. Then drop the fallback read, the mirror write in `nameStandIn`, and the table.
4. Then fill in the sign-ins on leave and attendance rows, if the engine still wants them stored.

Each PR runs its affected server and web tests locally and lists them (TEAM.md, quick CI), and gets a code review, a design review for screens, and QA by person.

---

## 10. Owner answers (31 Oct 2026, in chat)

- **Q1. Late marks, half-day mode:** keep it, with the warning and the per-person comparison of cut against time missed (3.1). New companies still default to the time missed.
- **Q2. Final settlement recovery:** a 50% cap on final wages, with the rest left owed by the person. There is no consent option (3.4).
- **Q3. Leave encashment:** it counts as final wages (3.4).

No open questions remain. Everything else in this spec is decided above with reasons.

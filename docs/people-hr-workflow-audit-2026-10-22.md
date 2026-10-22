# People/HR workflow audit — 22 October 2026

Scope: People/HR approvals, leave balances/register, accrual calculations and their attendance/payroll boundaries. Read-only application review; only audit documents added. Local working tree based on `7a6ae57`, with pre-existing and concurrently changing uncommitted work. Findings describe the source inspected during this session, not a frozen release or live deployment. Competitors were checked against official public documentation, not paid tenant accounts.

## Decision

The normal request → approval → attendance → payroll path exists, but automatic paid-leave deduction from the attendance register is incomplete. Fix consistency and approval enforcement before adding automatic deduction. Passing the current regression suite does not establish coverage for the gaps below.

## What actually happens today

| Trigger | Leave balance | Attendance | Payroll consequence |
|---|---|---|---|
| Create paid leave request | Pending days reserve available balance | No approved leave day yet | Not finalized leave; missing attendance can still be LOP |
| Final approval | Pending becomes used; available normally stays the same | Writes full-day ON_LEAVE or half-day combined record | Paid leave normally paid; unpaid full days produce LOP |
| Manager approves under MANAGER_THEN_HR | Still pending/reserved | No final leave marking | HR must finalize through the web route |
| Reject/cancel | Reservation or usage released | Approved cancellation attempts to clear/recompute linked days | Existing payroll inputs need an explicit refresh |
| Manually mark attendance ON_LEAVE | **No leave type/request, no balance debit** | Day marked on leave | Treated as paid by attendance summary |
| Missing attendance / short hours | **No automatic paid-leave selection/debit** | Absent/half/incomplete classification | LOP under current summary rules |
| Repeated lateness | **No paid-leave cascade** | Late counts retained | Configurable half-day LOP per late-count threshold |
| HR encashment | Negative adjustment reduces balance | No work-day change | Handoff lists days; monetary payout and consumption are incomplete |

Sources: `server/src/routes/leave.ts:107`, `:490`, `:565`, `:665`; `server/src/routes/attendance.ts:111`, `:965`, `:998`; `server/src/services/attendance/compute.ts:216`; `server/src/routes/payrollRuns.ts:468`.

The leave register is a derived report over types, requests, allocations and adjustments. It is not an attendance-to-leave posting engine. There is no explicit paid-leave priority cascade in the inspected calculation path.

## Findings and recommended fixes

### 1. High: public API bypasses manager-first approval

Evidence: `server/src/routes/leave.ts:647` checks `hrMayDecide`; `server/src/routes/publicApi.ts:452–466` calls `approveLeave` directly with `leave:write`. `approveLeave` itself does not enforce the approval stage. An integration allowed to create leave can also finalize it before manager approval.

Fix: enforce transition/stage authorization in a shared decision service used by web, portal, imports and public API. Separate request-write and decision permissions. If imports need an override, make it explicit, separately authorized and audited.

Acceptance: under MANAGER_THEN_HR, public API approval before the manager step returns a conflict without changing attendance or balance; a write-only client cannot approve; approved override includes actor and reason.

### 2. High: manual register leave bypasses balance deduction

Evidence: `server/src/routes/attendance.ts:315–340` accepts ON_LEAVE without a leave type or request. `writeDay` defaults `leaveRequestId` to null at `:163`. `periodContext` explicitly treats manually marked leave as paid at `:963–965`; balances count requests, not these register marks.

Fix: route a register leave action through the same leave service, collecting type, fraction and reason and applying the approval policy. Keep an explicitly named paid administrative override only if desired, with separate permission and a reason. Do not silently equate an unlinked status to approved paid leave.

Acceptance: entering one paid leave day from the register creates one linked decision/debit; repeated save has one net effect; insufficient balance follows the configured rule; cancellation reverses it.

### 3. High: unpaid half-day produces different pay between calculation paths

Evidence: `writeDay` at `server/src/routes/attendance.ts:147–150` treats any approved half-day plus enough work as PRESENT, regardless of whether leave is paid. Attendance unpaid lookup/count at `:965` and `:998` only includes ON_LEAVE rows. People-only payroll at `server/src/routes/payrollRuns.ts:501` counts non-ON_LEAVE linked unpaid days as 0.5.

Reproduced at the pure summary boundary: the PRESENT result produced by half-day handling returns `lossOfPayDays: 0, payableDays: 1`; unpaid half-day plus worked other half should have 0.5 unpaid and 0.5 payable. This was a calculation-boundary reproduction, not a full endpoint regression.

Fix: represent paid/unpaid leave fractions independently of attendance status and combine them with worked fractions once. Share this day result between both payroll handoffs. Account for the unworked other half too.

Acceptance: paid half + worked half = 1 payable; unpaid half + worked half = 0.5; paid half + absent half = 0.5; unpaid half + absent half = 0. Both handoffs agree.

### 4. High: corrections and web clock writes can detach approved leave

Evidence: `server/src/routes/attendance.ts:163` clears linkage unless the caller supplies it. Manual, import, web clock and correction callers at `:337`, `:397`, `:595`, `:601`, `:689` do not resolve existing approved leave. The reader path does resolve half-day leave (`server/src/routes/iclock.ts:209–210`), so sources behave differently.

Impact: an approved request can continue consuming leave while its attendance record loses the link or half-day treatment. Worked and paid fractions, and late penalties, can disagree across source paths.

Fix: resolve approved leave centrally in the day writer; preserve or explicitly reconcile it on correction. A worked day conflicting with full leave should enter a visible resolution flow with an intentional leave reversal.

Acceptance: apply the same punches through reader, clock, correction and manual entry; all produce the same leave linkage and payable result.

### 5. High: approval/cancellation are not atomic with day postings or month locks

Evidence: `server/src/routes/leave.ts:565–620` checks then writes days in a loop, then updates the request. It has no enclosing transaction/conditional PENDING update. Cancellation at `:515–530` deletes full leave days directly without `assertMonthOpen`; route `:665` then updates status. Half-day cancellation uses `writeDay`, which checks the lock, making full and half cancellation inconsistent. Request creation has an employee advisory lock at `:492`; finalization does not share it.

Impact inferred from code: cancellation can remove full leave from a closed attendance month; errors can leave partial postings; concurrent approve/reject/cancel can apply conflicting outcomes. These race/fault cases were not load-injected.

Fix: one transaction and consistent employee/request lock for reserve, approve, reject, cancel, encash and day postings; conditional state transitions; enforce month closure on deletion too. Coordinate month-close with posting transactions. Send notifications after commit.

Acceptance: closed-month full and half cancellation both fail with no changes; injected write failure leaves no partial days; concurrent decisions yield one final state and one posting set.

### 6. Medium: accrual can post before joining, and edits rewrite historical entitlement

Evidence: `server/src/services/attendance/leaveAccrual.ts:120` uses the period credit date even when joining is later. Reproduced: yearly 12, prorated, joining 2026-11-02, as-of 2026-10-22 returns 2 earned days dated January. `balanceFor` recalculates prior periods with today's type. Reproduced: changing annual entitlement from 12 to 24 changes carried-in from 24 to 30 for the same employee/dates under a 30-day carry cap. Type update (`server/src/routes/leave.ts:254`) only restricts changing paidness after approval; leave-period update (`:811–827`) changes the current period setting without history migration.

Fix: never make a credit available before employment starts; define joiner credit timing. Effective-date policy and period versions; preserve posted historical credits and use explicit migration adjustments for policy changes.

Acceptance: no earned balance before joining; historical closed balances remain unchanged after a new policy; April–March and mid-month periods preserve prior postings.

### 7. High: encashment reduces leave without completing its payroll payout lifecycle

Evidence: `server/src/routes/leave.ts:717–730` checks limits/balance then creates a negative adjustment without the employee lock. `server/src/routes/payrollRuns.ts:531–537` returns unconsumed encashments as employee/days/type, without an adjustment ID or calculated earning. A source search finds reads but no application assignment of `paidInRunId`; `server/src/routes/leave.ts:750` relies on that field to block deletion. Payroll calculation consumes its own adjustments but no encashment-to-earning binding was found.

Impact: HR's “paid out” label currently means days were removed, not proven money paid. Concurrent requests can exceed balance/cap. Repeated handoffs can keep listing the same item; manual payouts cannot be reliably reconciled to this marker.

Fix: create an encashment lifecycle with approval, valuation basis, source adjustment ID, earning component and run/slip linkage. Atomically consume it when payroll commits; compensate on controlled reversal. Lock balance/cap checks with the debit.

Acceptance: two simultaneous encashments cannot overdraw; one request becomes one earning; retries do not pay twice; a paid item cannot be deleted; cancellation/recalculation has explicit behavior.

### 8. Medium: backend leave-period/credit features are not exposed consistently in People UI

Evidence: backend supports custom periods and quarterly/half-yearly credits (`leave.ts:207–213`, `:805–827`). `apps/people/src/timeOff/LeavePolicy.jsx:267` offers only yearly/monthly with “All on 1 January”; its save body omits credit timing. `LeaveBalances.jsx:21` chooses calendar year, ignores the returned period labels, and KIND at `:18` lacks CREDIT/UPCOMING. The inspected `timeOff/api.js` has no settings/register wrapper.

Fix: expose the supported engine settings in People, show named period bounds/current period, credit dates and upcoming amounts, and add a register view/export. Test the saved policy round-trip rather than only successful HTTP responses.

Acceptance: an April–March company sees the correct current period in January; quarterly day-15 credit survives edit/reload; ledger distinguishes posted and upcoming credits.

## What is already present and passed targeted regression

- HR-only leave/holidays/portal can operate without enabling Attendance; readers remain separately gated.
- Pending reservation, overlap prevention on request creation, balance/negative-limit checks, holiday/weekly-off exclusion and sandwich rule.
- Half-day request validation, gender/employment-type eligibility, service waiting period, notice/backdate restrictions and HR on-behalf exceptions.
- Yearly/monthly accrual, carry cap, allocations, reasoned adjustments and leave ledger.
- Full-day paid/unpaid leave propagation, explicit attendance/leave-to-payroll imports, preservation of manual payroll inputs unless overwrite is chosen.
- Attendance month locks/snapshots and payroll input snapshots exist. They do not remove the cross-path gaps above.

Test command (server directory):

```sh
npm test -- leave.test.ts hrLeave.test.ts leaveAccrual.test.ts attendanceCompute.test.ts attendanceMonthLock.test.ts payrollFromLeave.test.ts payrollFromAttendance.test.ts
```

Result: **7 files, 49 tests passed** in 42.16 seconds. The prior-turn EARNED/CREDIT assertion failure was updated by concurrent work and passed in this run. Do not carry that stale test failure forward as unresolved. These suites do not prove the newly identified approval-bypass, half-day parity, closed-month leave cancellation, concurrency or fault-injection cases.

## Competitor benchmark

See [official-source comparison](people-hr-competitor-workflows-2026-10-22.md) for full evidence and limits.

| Benchmark | Documented competitor behavior | Clor upgrade |
|---|---|---|
| Absence → leave | [Zoho pay periods](https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/pay-period): ordered balances, system-approved leave, notifications, cut-off behavior | Add configurable paid-leave priority and explicit system-generated decisions after reconciliation |
| Sequential approval | [Keka approval chain](https://help.keka.com/hc/en-us/articles/39946668778001-How-to-configure-approval-chain-for-leave): per-plan/type levels, prior-stage enforcement, missing-approver rules | Extend the three fixed chain shapes; enforce uniformly across every API |
| Partial-day penalties | [Keka shortages](https://help.keka.com/admin/admin-help/how-to-configure-settings-to-penalize-for-shortage-of-work-hours): expected hours adjust for approved partial leave; [Zoho policies](https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/specific-policies): configurable fractions/highest penalty | Share fractional day engine and prevent unintended duplicate penalties |
| Review and close | [greytHR finalization](https://www.greythr.com/greythr-help/admin/answers/122882572/): reviewed deduct/ignore; [payroll locks](https://www.greythr.com/greythr-help/admin/answers/122448525/): input/result controls | Preview exceptions and impact, then commit a reconciliation version and lock |
| Encashment completion | [Frappe encashment](https://docs.frappe.io/hr/leave-encashment): Additional Salary or Payment Entry | Link leave debit → priced earning → salary slip → paid/reversed state |

These are documented product capabilities, not evidence that competitors are bug-free or offer them on every plan. Vendor transaction/idempotency guarantees were not established.

## Implementation order and acceptance gates

1. **Correctness first:** shared decision service and permissions; transaction/state guards; closed-month cancellation; unified paid/unpaid fractional day calculation; source-independent leave linkage. Add the specific regressions above.
2. **Balance and payout integrity:** joiner timing, effective-dated policy/period migration, encashment lock and earning linkage. Reconcile historical balances before posting corrections.
3. **Attendance deduction engine:** configurable trigger (absence/shortage/lateness), grace and rounding, leave-type priority, eligibility, residual LOP, penalty overlap rule, payroll cut-off and correction window. Default to a preview with employee/day/type/balance/pay impact; only configured policy may finalize automatically.
4. **One reconciliation result:** each posting carries source day/request, policy version, period and run, actor/reason, before/after balance, stable idempotency key and reversal reference. Reprocessing applies only the delta. Payroll consumes the approved reconciliation version.
5. **Workflow upgrades:** per-policy stages and conditional routing, alternate approver/delegation, due dates/reminders/escalation, employee-visible timeline, historical change explanation and exception export. Validate existing notification mechanisms before introducing another queue.

Release checks: all entry paths use one decision engine; register/balance/day fractions/payroll reconcile; no paid-leave/LOP double charge; retries/concurrency have one net effect; closed periods stay unchanged; policy edits preserve history; encashment has exactly one payout; source UI round-trips the complete policy.

Not performed: production mutations, browser interaction QA, device tests, payroll statutory/legal certification, exhaustive whole-repository review, destructive tests or live competitor-tenant testing. Recommended fixes are not implemented by this audit.

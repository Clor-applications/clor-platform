# Implicit state machines in CLOR

Read-only investigation of `origin/main` at `3722b5fe` (merge of #221), 13 Nov 2026. No application code was changed.

An *implicit state machine* here is an entity or flow whose behaviour depends on a status, stage or phase value (a string column, a set of booleans or timestamps acting together as a state, or a React `useState` mode) where the allowed transitions are not declared in one place but spread across handlers, guards and UI conditions. Of about 100 such fields across the four Prisma schemas, only `ReviewCycle` (`server/src/services/people/talent/growth.ts:160`) keeps its transitions in one table.

**Scope.** Workspace (platform/admin, billing, auth, access), People, Attendance/Time and the ops portal are covered in full. Books/Accounting and Payroll belong to another developer: their machines are listed, without proposals, in Part 5.

**Method.** Five read-only passes, one per area. Each one found every write to each status field and read the guard in front of it. The highest-risk findings were then re-read by hand: the approval engine races, overtime reset, reader-command pick, leaving job, `closeOutFor`, billing mark-paid, the gateway webhook, invitation resend and recovery codes. Line numbers are at `3722b5fe`.

**Guard vocabulary used throughout**
- **Atomic / CAS.** `updateMany({ where: { id, status: <expected> } })` with a count check, or a write made after a fresh read under an advisory lock. This is safe.
- **Check-then-act (C-T-A).** The code reads the row, checks the status in JavaScript, then calls `update({ where: { id } })`. A concurrent writer between the read and the write is silently overwritten.
- **None.** No status check at all.
- **`peopleWrite`.** `peopleWrite(orgId, fn)` (`server/src/utils/peoplePrisma.ts:48-60`) holds a per-company advisory lock. A check-then-act *inside* it is serialized against every other `peopleWrite` in the same company. So in People and Attendance the real gaps are writes outside `peopleWrite`, and checks made *before* entering it.

**Open PRs touching these machines.**
- #228 (roster draft/publish) touches attendance requests, full-day fix and self-service.
- #226 adds comp-off expiry and changes overtime and leave jobs.
- #225 adds email outbox retry and claim.
- #222 touches auth middleware, idempotency, step-up and SSO.
- #126 (Payroll) moves loans, revisions and settlements onto the People approvals engine, which widens the engine races in machine P1.
- #134 is the payroll cockpit; #133 changes devices.

Each one is flagged in the machine it touches.

---

## Summary table

Ranked by risk: money, pay, attendance records, access and security first. Section ids point to the parts below (W = Workspace/ops, P = People core, M = People money/talent/jobs, A = Attendance/Time).

| Rank | Machine (state lives in) | Risk | Main problem found | Section |
|---|---|---|---|---|
| 1 | People `ApprovalRequest.status` + `ApprovalStep.status` (approvals engine) | HIGH | `decide` re-checks the step but not the request under its lock (`engine.ts:948` vs `:1015`). On an ALL-mode step, a "more info" and an approval made together complete the step without the first approver (`:1042`, `:725`), which bypasses the two-person rule on money. `withdraw` (`:1091`) does not take the `approval-final` lock, so `approveFinal` overwrites WITHDRAWN with APPROVED (`:872`). | P1 |
| 2 | `BillingInvoice.status` + `Subscription.status` (CLOR's own billing) | HIGH | Mark paid extends the subscription (`billing/invoices.ts:255`) before claiming the invoice (`:257-262`), so two clicks or a concurrent gateway payment extend it twice. A gateway webhook writes subscription status with no check (`billing/events.ts:114-122`), so a late event revives a subscription that ops or a closure cancelled. | W1, W4 |
| 3 | `ExpenseClaim.status` + `booksStatus` | HIGH | `TO_RECORD` is set at approval (`expenses.ts:783`) and again at pay-now (`:819`), so a claim already marked RECORDED is listed for Books again and entered twice. PAYING can stick with no button to recover it (`Expenses.jsx:177`), and final settlement skips it. | M1 |
| 4 | `AttendanceRecord.overtimeApproved` + `OvertimeRequest.status` | HIGH | Every day rewrite resets `overtimeApproved:false` (`attendance/days.ts:328`), but the request stays APPROVED, and the employee can't ask again (`selfService.ts:244,262`). Approved overtime is silently unpaid. | A1, A5 |
| 5 | Attendance month lock (`AttendanceMonthLock` row) | HIGH | Penalty waive/undo/apply (`markRules.ts:358,376,398`), held-punch release (`punches.ts:296`) and the overtime toggle (`routes/attendance.ts:403`) check "month open" *before* `peopleWrite`. Validate (`routes/attendance.ts:384`) has no month check at all. Writes can land in a closed (payroll-frozen) month. | A2, A11 |
| 6 | `DevicePunch.reviewStatus` / `dayPending` | HIGH | Only held-punch release sets `dayPending` (`punches.ts:298`). Normal reader punches and approved field punches in a closed month are skipped (`:84`), and reopen re-works only pending days (`:502`), so those punches may never count. A test is needed to confirm. | A7 |
| 7 | `Employee.status` (ACTIVE / ON_NOTICE / SUSPENDED / LEFT …) + lifecycle flags | HIGH | The separations job reads ON_NOTICE (`lifecycle/leaving.ts:137`) and then writes LEFT unconditionally (`:87-90`): a "stay" by HR in between is undone, door access is removed, and requests are withdrawn. Leaving, rehire and anonymise skip the record version check. | P3 |
| 8 | `closeOutFor` withdrawal of open approvals | MED-HIGH | Reads WAITING requests, then `update` to WITHDRAWN by id (`lifecycle/closeOut.ts:19-26`). This can flip a request that was approved a moment ago, after its effect ran, and it skips the close hooks, so shift swaps stay WAITING. | P1, P3 |
| 9 | `JoinStatutory.status` (bank/PF details from joiners) | HIGH | Reject is check-then-act (`joiningStatutory.ts:179-181`) while approve sends bank and PF to Payroll (`:142-147`), leaving the record and Payroll in disagreement. SENDING is undocumented and can stick after a crash. | P6 |
| 10 | `AgentJob.status` (Tally sync jobs) | HIGH | Poll picks PENDING, then `updateMany` by ids with no status (`routes/agent.ts:115-116`): two polls get the same jobs. "Send to Tally" creates a new job each click (`routes/payrollPosting.ts:149`). The payroll journal can post twice. | M14 |
| 11 | `Candidate.stage` + `Offer.status` + `Referral.outcome` | HIGH | Rejecting a candidate leaves the SENT offer live (`talent/hiring.ts:241-258`). Accepting it writes `stage:'OFFER'` unguarded (`offers.ts:246`), so a rejected candidate can be hired. The referral stays NOT_TAKEN for good, and the bonus never starts (`referrals.ts:410,683`). | M6, M8 |
| 12 | `Subscription` period + ops grants | MED-HIGH | `setSubscription` keeps the old `currentPeriodEnd` (`services/subscriptions.ts:190-196`), so an ops grant or reopen on a lapsed account stays lapsed. The billing grant route (`routes/billing.ts:110-117`) bypasses the two-person ops approval. | W1, W7 |
| 13 | `AccountInvitation.status` | MED-HIGH | Resend updates by id only (`accountInvitations.ts:196-204`), so it races a revoke and makes a revoked invite live again. Accept's claim and membership writes are not one transaction (`:306` vs `:328-352`). | W9 |
| 14 | `EmployeeAdvance.status` + `booksStatus` | HIGH | The UI marks only claims as recorded (`Expenses.jsx:101`), so every paid advance stays TO_RECORD in every Books export. APPROVED can never be cancelled. The engine withdraw race (rank 1) can consume advance money with no approved claim (`expenses.ts:776-785`). | M2 |
| 15 | `DeviceCommand.status` (reader user deletes, template pushes) | MED | `findFirst` PENDING, then `update` to SENT with no status guard (`routes/iclock.ts:422-424`; `routes/matrix.ts:204,246`). An HR cancel in between is overwritten, and the command reaches the reader anyway. | A8 |
| 16 | `OrgClosure.status` (company closure, irreversible purge) | MED | Cancel is check-then-act (`companyClosure.ts:108-111`). The purge never re-checks and writes DELETED unconditionally (`:295,315`), so a closure cancelled in that window is still deleted. | W8 |
| 17 | `OpsApproval.status` (ops maker-checker) | HIGH control / MED likelihood | Approve itself is atomic (`routes/opsApprovals.ts:131`). FAILED is written but undeclared (`:121,146,149`). An approved deal can be half-applied and marked FAILED (`routes/opsDeals.ts:499-536`), and two over-limit deals can each open an approval (`:582-585`). | W7 |
| 18 | `ScheduledChange.status` | MED | A crash between claim (`effectiveDating.ts:103`) and apply (`:131`) leaves the row APPLIED but never applied, and nothing reclaims it. Upsert of PENDING is check-then-act (`:65-72`). | P2 |
| 19 | `AttendancePenalty.status` | HIGH | See rank 5: `assertMonthOpen` runs before `peopleWrite`. Undo reverses leave deductions. | A11 |
| 20 | `EmailOutbox.status` | MED | Two senders can pick the same QUEUED row (`services/mailer.ts:363-397`), which duplicates mail, including reset links. #225 adds `claimedAt`. | W6 |
| 21 | `AttendanceMonthConfirmation.status` | MED | DISPUTED is a dead end: there is no HR resolve action, and month close ignores disputes. | A10 |
| 22 | `AbsenceCase.status` + `AbsenceNotice.emailStatus` | MED | The letter-failure rollback is an unguarded update (`absconding.ts:247`), so it can resurrect a closed case. ABSCONDED plus `leaveEmployee` is not atomic (`:319-326`). `emailStatus` is written once and stays QUEUED (`:268`). | A12, A13 |
| 23 | `AttendanceFullDayReview.settledAs` | MED | The daily job's `updateMany` at `fullDayFix.ts:348` has no `settledAt:null` guard and overwrites HR's PAID mark with RECORD_CHANGED. #228 touches this file. | A16 |
| 24 | `LeaveYearEnd` undo vs Payroll | MED | The payroll-listed check (`leave.ts:3289`) reads the other database outside the People lock. | A17 |
| 25 | `PolicyVersion.status` | MED | WAITING is a dead end once its publish request is rejected (`policies.ts:247`). | P12 |
| 26 | `DeskRequest.status` / `PrivateCase` | MED (privacy) | Resolving a help-desk request can undo its move to a private case and restore the wiped text (`desk.ts:252` vs `:285`). | P13 |
| 27 | `DeletionReview.status` | MED (irreversible) | See P15. | P15 |
| 28 | `ImprovementPlan.status`, `JobOpening.status` | MED / LOW-MED | Check-then-act, last writer wins (`growth.ts:308,335`; `hiring.ts:106`). The Openings screen has a transition table the server does not enforce (`Openings.jsx:54-57`). | M5, M11 |
| 29 | `HrOutbox.status` | MED | The manual flush skips the `hr.flush` lease, and there is no SENDING state, so punches can be pushed twice (`routes/integrations.ts:529-535`). | M13 |
| 30 | `Referral.bonusStatus` | HIGH (money) | A bonus SENT to Payroll can never be marked paid, so if Payroll cancels it, it can only be forfeited (`referrals.ts:543,585`). | M8 |
| 31 | `PaymentProvider.mode` / `active` | MED | An active provider can be switched TEST to LIVE and stay active untested (`billing/providers.ts:215-224`). | W5 |
| 32 | Auth: TOTP recovery codes | MED-LOW | Read, filter, then write (`routes/auth.ts:295-298`): two concurrent logins can use the same recovery code. | W15 |
| 33 | `AccountEntitlement.status` | MED | CLOSED is written by closure (`companyClosure.ts:276`) but undeclared. Extend-trial does not resync the entitlement (`routes/ops.ts:435`). | W2 |
| 34 | `AttendanceRequest`, `LeaveRequest`, `ShiftSwap` | MED-HIGH data, well guarded | Every transition is a claim or sits inside `peopleWrite`. The only gaps are docs: CANCELLED is missing from the schema comment, and WITHDRAWN appears only in leave history. | A3, A4, A6 |
| 35 | `AccountMembership`, `OutsideAccess`, `Credential` (+ API keys, SCIM, share links) | MED / LOW-MED | Core writes are guarded. Resume vs revoke is check-then-act (`credentials.ts:321-335`), mitigated by the issuing tables. | W10-W12 |
| 36 | `TrialSignup`, `DemoRequest` | MED / LOW | `provisioningAt` acts as a claim. Trial expiry is never stored: a finished trial stays `trialing` and is read as lapsed. | W13, W14 |
| 37 | Smaller machines | LOW | `AttendanceExceptionState` (single path has no from-guard), `ReaderEvent.outcome` (HELD undocumented and not filterable), `NightWorkConsent`, `ProbationReview`, `JoinInvite`, `EmployeeDraft.step`, `ChecklistTask.systemState`, `ClearanceLine`, `ExitInterview`, `Goal`, `ReviewCycle`, `Training`/`TrainingSeat`, `Interview`, `WebhookDelivery`, people `ImportBatch`, `SupportTicket`, `PriceBook`, `AppCatalogueEntry`, `IdempotentRequest`, `JobRun.outcome` (RUNNING forever after a crash), data-protection and compliance records. | various |

Books and Payroll (listed only, see Part 5): 16 payroll machines and 14 Books machines. The highest-risk on main: payroll payment `postingStatus` stuck at POSTING; the run posting's 2-minute takeover can write a second salary journal; `FinalSettlement` cancel races mark-paid; a run can never reach PAID; invoice cancel, reinstate and cancel again reverses the reversal.

---

## Top fixes worth making

Workspace, People, Attendance and ops only. Smallest and highest-value first.

1. **Approvals engine (P1).**
   - Inside the `approval-decide` lock, re-read the request and refuse unless it is still WAITING.
   - Make `withdraw` take the `approval-final:<id>` lock.
   - Change `approveFinal`'s final write to `updateMany where { id, status: 'WAITING' }`.
   - Make `closeOutFor` go through the same claim and close hooks.
   - This fixes ranks 1, 8 and 14, and must land before #126 puts payroll money on the engine.
2. **Billing (W1/W4).**
   - In `markInvoicePaid`, claim ISSUED → PAID first, and record the payment in the same transaction (as `payInvoice` already does).
   - In the gateway `applyTo`, refuse to move a `cancelled` subscription or a closed account.
   - Make `setSubscription` set or clear `currentPeriodEnd` on ops grants.
3. **Overtime reset (A1/A5).**
   - Stop resetting `overtimeApproved` in `writeDay` when an APPROVED `OvertimeRequest` exists for the day; or recompute it from the request.
   - Otherwise, let `canAskOvertime` treat an approved-but-reset request as re-askable.
4. **Month lock (A2).** Move `assertMonthOpen` inside `peopleWrite` in `markRules.ts` (waive/undo/apply), `decideHeldPunch`, the overtime toggle and validate. Add the month check to validate.
5. **Closed-month punches (A7).** Set `dayPending: true` on every punch that `recomputeDeviceDay` skips for a closed month, so reopen re-works it. Add a test.
6. **Employee leaving (P3).**
   - In `finishLeaving`, use `updateMany where { id, status: 'ON_NOTICE', version }` and abort on 0.
   - Bump the version on leave, rehire and anonymise.
7. **Expense money (M1/M2).**
   - Set `booksStatus: 'TO_RECORD'` only when money moves, and never over RECORDED.
   - Send advance ids from the Books "mark recorded" action.
   - Show a "retry" action for PAYING older than 2 minutes, and include PAYING in final settlement sources.
   - Make `approveClaim` throw, not return null, when its claim update matches no row, so the advance write rolls back.
8. **Agent and reader job pickup (M14, A8).**
   - Claim with `updateMany where { id, status: 'PENDING' }` (or `FOR UPDATE SKIP LOCKED`) in `routes/agent.ts`, `routes/iclock.ts` and `routes/matrix.ts`.
   - Dedupe "Send to Tally" per run.
9. **Hiring (M6).** Withdraw SENT offers when a candidate is rejected or withdrawn, and refuse `acceptOffer` for a REJECTED or WITHDRAWN candidate.
10. **Smaller guards.**
    - Invitation resend: `updateMany where status in [PENDING, EXPIRED]`.
    - Closure purge: re-select SCHEDULED right before delete.
    - `JoinStatutory` reject: claim with `updateMany`.
    - Full-day-fix settle: add the `settledAt: null` guard.
    - Absence rollback: guard on the NOTICE status.
    - Recovery codes: compare-and-swap on the stored JSON.
11. **Dead ends and docs.**
    - Add an HR resolve action for DISPUTED month confirmations.
    - Add a sweep for APPLIED-but-unapplied `ScheduledChange` rows and RUNNING `JobRun` rows.
    - Let a rejected `PolicyVersion` go back to DRAFT.
    - Update `AbsenceNotice.emailStatus` from the outbox.
    - Declare the undocumented values in the schema comments: CANCELLED, HELD, SCANNED, SENDING, FAILED, CLOSED.

The longer-term fix for the whole class: one `transition(model, id, from[], to, data)` helper per schema that always does `updateMany where status in from` and throws on 0 rows, plus a per-model `ALLOWED` table that both the server and the UI import. Attendance requests, leave and shift swaps already follow this pattern, and they are the machines with no findings.

---

# Part 1. Workspace, billing, auth/access and ops portal (W)


Investigated at origin/main `3722b5fe` (Merge #221). Read-only. Paths are relative to `server/src/` unless they start with `server/prisma`, `packages/` or `apps/`. Every file:line below was read. "Atomic" means `updateMany` with the expected status in `where`. "Check-then-act" means a find, then an `update({ where: { id } })`.

Open PRs that touch these machines:
- **#225** adds `EmailOutbox.claimedAt` and `nextAttemptAt`, plus `services/emailRetry.ts`, and changes `mailer.ts`, `jobLease.ts` and `jobRegistry.ts`. It addresses the outbox double-send in section 6.
- **#222** changes `middleware/auth.ts`, `tenantContext.ts`, `idempotency.ts`, `routes/sso.ts`, `services/stepUp.ts` and `policy.ts`. It touches sections 15 and 16.

---

### Top risks (ranked)

| # | Risk | Where | Level |
|---|------|-------|-------|
| 1 | "Mark paid" extends the subscription **before** it claims the invoice. If an online payment for the same invoice lands at the same time, the subscription is extended twice and staff get a 409. It also reopens a cancelled subscription, which the online path refuses to do. | `billing/invoices.ts:255` then `:257-262`; `billing/events.ts:222` vs `:67-68` | HIGH |
| 2 | A gateway subscription event overwrites the status with no guard. A late or out-of-order webhook brings back a subscription that ops or a company closure cancelled. | `billing/events.ts:114-122` vs `routes/opsCustomers.ts:77`, `services/companyClosure.ts:274` | HIGH |
| 3 | `setSubscription` keeps an old `currentPeriodEnd`. An ops "grant plan active" or "reopen" on a lapsed account leaves it lapsed. The grant route also skips the maker-checker discount limit (it can set any apps free). | `services/subscriptions.ts:190-196`; `routes/opsCustomers.ts:94-95`; `routes/billing.ts:110-117` | MED-HIGH |
| 4 | Invitation resend updates by id only, so a revoked or accepted invitation can become PENDING again in a race. Accept is not one transaction: a crash after the claim leaves ACCEPTED with no membership and no way to retry. | `services/accountInvitations.ts:196-204`; `:306` vs `:328-352` | MED |
| 5 | Closure cancel is check-then-act. The purge never re-checks the status and writes DELETED unconditionally, so a closure cancelled in the window is purged anyway. | `services/companyClosure.ts:108-111`; `:295`, `:315` | MED (data loss, narrow window) |

Other notable findings:
- OpsApproval writes a `FAILED` status the schema does not declare. An approved deal can be half-applied while marked FAILED.
- Credential resume and revoke race (the issuing table mitigates it).
- The outbox can double-send (fixed by #225).
- AccountEntitlement gets a `CLOSED` value the schema does not declare.
- "Extend trial" does not resync the entitlement.
- An active payment provider can be switched TEST to LIVE and stay active untested.
- The TOTP recovery-code burn is not atomic.

---

### W1. Subscription.status (+ trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd): billing

**Where:** `Subscription` (`server/prisma/platform/schema.prisma:1083-1131`).
- Declared values: `trialing | active | past_due | paused | cancelled` (`:1087`).
- Standing is computed in `services/subscriptions.ts:18-26` (`inGoodStanding`): `trialing`/`active` only, `trialEndsAt` for trialing, `currentPeriodEnd` otherwise.
- **Expiry is never stored.** No job moves `trialing` to anything. `billing/trialReminders.ts:44-92` only sends email, and `billing/renewals.ts:39-51` only raises invoices. A trial that ended stays `trialing` forever and is read as lapsed.

**Values:**
- Written: `trialing` and `active` (provisioning, deals, setSubscription, gateway mapping); `cancelled` (ops, closure); `past_due` and `paused` (only through gateway status maps `billing/cashfree.ts:21`, `billing/razorpay.ts:20`, or ops grant `routes/billing.ts:94`).
- Read but never written: `unpaid`, `canceled` (US spelling) and `expired` in `services/accountHealth.ts:139`. These are dead branches.
- Ops list filters `suspended` and `overdue` (`routes/ops.ts:223`). These are derived, not stored.

**Transitions:**

| From → To | Write | Guard |
|---|---|---|
| (none) → trialing/active | `services/accountProvisioning.ts:59-63` (signup `routes/signup.ts:232`, demo `routes/demoRequests.ts:434`, `routes/auth.ts:629`) | create in a transaction |
| any → any (ops grant) | `routes/billing.ts:117` → `services/subscriptions.ts:183-198` upsert | none on status; the zod enum allows all 5 |
| any → trialing/active (deal) | `routes/opsDeals.ts:499-506` then `:520-536` | none (applyDeal) |
| any → `s.status` (gateway event) | `billing/events.ts:114-122` `updateMany where {accountId}` | **none on status** |
| active/trialing/past_due → active (+period) on paid pay-link | `billing/events.ts:68`, `:76` | atomic on invoice (`:71-75`); LIVE check on a stale read of the subscription (`:66`) |
| any → active (manual payment / Mark paid) | `billing/events.ts:222` → applyTo `:114` | **none**: a cancelled or paused subscription is reopened |
| !cancelled → cancelled (ops) | `routes/opsCustomers.ts:76-77` | check-then-act |
| cancelled → trialing/active (ops reopen) | `routes/opsCustomers.ts:93-95` | check-then-act |
| !cancelled → cancelled (last company purged) | `services/companyClosure.ts:264-274` | check-then-act |
| trialEndsAt extended (stays trialing) | `routes/ops.ts:432-435` | check-then-act; **no `syncAccountEntitlement`** |
| cancelAtPeriodEnd false ↔ true (owner) | `routes/billing.ts:290-293`, `:309-311` | check-then-act, idempotent |

**UI vs server:**
- `apps/admin/src/screens/PlanChange.jsx:48` treats `trialing` as "running", even when the trial has ended. The server agrees (`routes/billing.ts:290`), so the owner can "stop" a plan that already lapsed. Harmless.
- `packages/ops/Customers.jsx:333-336` offers Extend only for `trialing` and Reopen only for `cancelled`. This matches the server.

**Never left (stuck states):**
- No automatic exit from `trialing` or `active` once the dates pass. The state is only interpreted.
- `cancelAtPeriodEnd` never ends in `cancelled`. Access just lapses on the date. A renewal invoice issued **before** the owner pressed Stop can still be paid, and that payment moves the subscription on regardless (`billing/events.ts:68` does not read `cancelAtPeriodEnd`).

**Stale-period bug (risk #3):**
- `setSubscription` updates with `currentPeriodEnd: input.currentPeriodEnd ?? undefined` and `trialEndsAt: … ?? undefined` (`services/subscriptions.ts:194-196`), so old dates survive.
- Effect: ops grants `active` (`packages/ops/Customers.jsx:354` sends no period) on an account whose old `currentPeriodEnd` has passed. The account is "active" but `inGoodStanding` is false.
- Same for Reopen to `active` (`routes/opsCustomers.ts:94-95`), including after `closeEmptyAccount` set `currentPeriodEnd: now` (`services/companyClosure.ts:274`).

**Races:**
- **Webhook vs ops cancel:** `applyTo` writes `status: s.status` for any account (`billing/events.ts:114-122`). An old `active` event replayed late, or a provider retry, undoes `cancelled`. Compare `payInvoice`, which deliberately refuses (`:67`).
- **Mark paid vs online payment (risk #1):**
  - `markInvoicePaid` checks `ISSUED` (`billing/invoices.ts:253`).
  - It then calls `recordManualPayment` (`:255`), which **applies** `{status:'active', currentPeriodEnd: until}` (`billing/events.ts:222`, `:114`).
  - Only after that does it claim the invoice with `updateMany where status ISSUED` (`:257-262`).
  - If the pay-link webhook paid it in between, the subscription is extended twice: once by `payInvoice` `:76`, once here. The PaymentEvent stays APPLIED while the route answers 409.
  - Same if the invoice was voided in between.
- **Trial expiry job vs payment:** none. No job writes the status.

**Risk:** HIGH. This decides access and money.

### W2. AccountEntitlement.status: accounting feature ceiling

**Where:** `schema.prisma:508-539`. Declared values: `ACTIVE | TRIAL | PAST_DUE | CANCELLED`.

**Writes:**
- `syncAccountEntitlement` (`services/subscriptions.ts:251-263`) writes ACTIVE, TRIAL or PAST_DUE.
- `services/companyClosure.ts:276` writes **`CLOSED`**, which is not declared.
- `CANCELLED` is declared but never written.
- `routes/opsLimits.ts:99-104` upserts limits without touching the status.

**Read:** `services/entitlements.ts:80-82`. Anything other than ACTIVE or TRIAL, or a past `validUntil`, is not in good standing. In that state only the **extras** drop (`:91`), so the impact is limited.

**Gaps:**
- Synced only on `setSubscription`, gateway events and ops cancel/reopen.
- **Extend trial does not resync** (`routes/ops.ts:435`). `validUntil` keeps the old trial end, so extras stay off after an extension.
- Any later sync (a late webhook, an ops reopen) overwrites `CLOSED`.

**Risk:** MED. Feature extras, plus a value the schema does not document.

### W3. PaymentEvent.status: payment log

**Where:** `schema.prisma:1159-1190`. Values: `APPLIED | RECORDED | FAILED | REJECTED` (`billing/events.ts:18`).

**Transitions:**
- create as `RECORDED` (`billing/events.ts:150-163`, unique on gateway+eventId, so a replay is a no-op)
- then `APPLIED`, `RECORDED` or `FAILED` (`:132`, `:136`)
- `REJECTED` is created directly (`:196-198`)
- Retry: `FAILED` (or `RECORDED` with a subscription and account) goes back through `applyRow` (`:173-186`). This is check-then-act: two staff pressing Retry both run `applyTo`.
  - For subscription events this is idempotent.
  - For invoice events `payInvoice` is guarded by the invoice `updateMany` (`:71-75`). Safe.

`processed` (boolean) duplicates the status: true after any apply attempt that did not throw.

`recordManualPayment` patches `detail` afterwards (`:229`). Harmless.

**Risk:** MED (money). It is safe on its own; the danger is in the callers (section 1).

### W4. BillingInvoice.status + booksStatus: CLOR's invoices to customers

**Where:** `schema.prisma:1625-1690`. `DRAFT | ISSUED | PAID | VOID`, plus `booksStatus NOT_SENT | SENT | FAILED`.

| From → To | Write | Guard |
|---|---|---|
| — → DRAFT | `billing/invoices.ts:152` (also renewals `billing/renewals.ts:107-111`) | unique `[accountId, renewalFor]` |
| DRAFT edit / discard | `billing/invoices.ts:179-180`, `:189` | atomic |
| DRAFT → ISSUED | `billing/invoices.ts:226-229` | atomic, inside a transaction with the number counter (`:243`) |
| ISSUED → PAID (staff) | `billing/invoices.ts:257-259` | atomic, **but after** the subscription side effect (`:255`) |
| ISSUED → PAID (pay link) | `billing/events.ts:71-75` | atomic, in a transaction with the subscription |
| ISSUED → VOID | `billing/invoices.ts:273` | atomic. The pre-checks `:269-271` are read-only. Its result is not checked, so a lost race returns the row silently. |
| books NOT_SENT/FAILED → SENT/FAILED | `billing/booksConnector.ts:156`, `:162` | none. The Books side is idempotent through `findFirst sourceKey` in a transaction (`:120-121`), but there is no unique index guarantee in what was read here. |

PAID and VOID are terminal. A VOID invoice with a live provider pay link can still be paid at the provider. `payInvoice` records it as RECORDED with "refund the customer" (`billing/events.ts:63`). Voiding does not cancel the provider link.

**Risk:** HIGH (money). See section 1, race #1.

### W5. PaymentProvider.enabled / active / mode

**Where:** `schema.prisma:1197-1217`. `mode TEST|LIVE`. `active` is a boolean with a partial unique index.

**Transitions:**
- Activate: `billing/providers.ts:245-255`. Requires `readiness()`, including a passing test in the current mode (`:240`), and runs in a transaction.
- `setMode` (`:215-224`):
  - Clears `lastTest*` but **does not clear `active`**. An active provider switched TEST to LIVE (or back) stays active with keys nobody tested, and readiness now fails.
  - The UI asks for a double confirmation. The server only checks that the mode differs.
- Turning `enabled` off drops `active` (`:196-199`).
- Pay links made under the old mode are checked with the new mode's keys (`billing/payLinks.ts:147`, `gatewayNamed`).

**Risk:** MED. Payments can go to an untested live configuration.

### W6. EmailOutbox.status: mail queue

**Where:** `schema.prisma:657-685`. `QUEUED | SENT | FAILED | SUPPRESSED`.

**Transitions:**
- create `QUEUED` (`services/mailer.ts:295-308`), or `SUPPRESSED` at creation (`:254-263`, `:277-286`)
- `deliver()` moves it to `SENT` (`:386-397`) or `FAILED` (`:399-406`)
- sample company: `QUEUED → SUPPRESSED` (`services/sampleCompany.ts:238`)
- People automations: `FAILED → QUEUED` atomic claim (`services/people/engagement/automations.ts:364-366`)

**Race (on main):**
- `deliver` reads (`mailer.ts:364-365`), sends, then writes. It never claims the row.
- Two callers can each send the same row:
  - ops Resend (`routes/opsEmail.ts:278-292`, which allows a `QUEUED` row in flight)
  - tenant `retryFailed` (`mailer.ts:411-419`, `routes/email.ts:269`)
  - two operators pressing Resend
- The result is a double-send.

**Stuck states:**
- A `QUEUED` row from a crash before `deliver` is never retried on main. It only raises an alert (`services/ops/alerts.ts:72`).
- `FAILED` with `attempts >= 5` is final for `retryFailed`.

**#225** adds `claimedAt` ("so two never send it"), `nextAttemptAt` and a retry job. That resolves both the double-send and the stuck QUEUED rows. Re-check that ops Resend and `retryFailed` go through the claim.

**Risk:** MED on main (duplicate customer mail, including reset links), LOW once #225 lands.

### W7. OpsApproval.status: ops maker-checker

**Where:** `schema.prisma:1875-1901`.
- Declared: `PENDING | APPROVED | REJECTED | CANCELLED | EXPIRED`.
- **Also written: `FAILED`** (`routes/opsApprovals.ts:121`, `:146`, `:149`; shown in `services/ops/approvals.ts:42`). Not in the schema comment.

| From → To | Write | Guard |
|---|---|---|
| — → PENDING | `services/ops/approvals.ts:75-86` | "one waiting per customer" is `findFirst` then `create` (`routes/opsDeals.ts:582-585`). **Check-then-act**: two concurrent over-limit deals create two PENDING rows. |
| PENDING → EXPIRED (lazy, on open) | `routes/opsApprovals.ts:93` | atomic. Otherwise derived (`statusOf`, `services/ops/approvals.ts:45`). |
| PENDING → FAILED (price changed) | `routes/opsApprovals.ts:121` | atomic |
| PENDING → APPROVED | `routes/opsApprovals.ts:131` | atomic. **Two approvers cannot both apply.** Good. The `where` does not include `expiresAt > now`, only the earlier `open()` read (`:88-97`), so a few-ms window exists. |
| APPROVED → FAILED | `routes/opsApprovals.ts:146`, `:149` | none (plain update by id) |
| PENDING → REJECTED | `:164` | atomic, and not the requester (`:163`) |
| PENDING → CANCELLED | `:177` | atomic. The requester or SUPER_ADMIN (`:176`). |

**Partial apply:**
- `applyDeal` (`routes/opsDeals.ts:479-562`) does several steps with no surrounding transaction: offer `updateMany` (`:486-490`), `setSubscription` (`:499`), `subscription.update` (`:520-536`), draft invoice.
- A throw after `setSubscription` marks the approval FAILED (`opsApprovals.ts:146`) while the subscription **was already changed**.
- The offer redemption is only rolled back when `setSubscription` itself throws (`opsDeals.ts:507-509`).

**Stale apply:** an approval applies its payload whenever it is approved, even if a smaller deal was set directly in between. The payload overwrites it. Re-pricing (`:117-124`) only compares the discount percentage.

**UI:** `packages/ops/Approvals.jsx:136-148` shows buttons from the server-computed `canDecide`/`canWithdraw` (`routes/opsApprovals.ts:78-79`). Consistent. The server re-checks the role, step-up and self.

**Bypass:** ops "grant plan" (`routes/billing.ts:110-117`) sets any apps with `priceModel: 'free'` (`packages/ops/Customers.jsx:354`) and needs no approval. In effect it is a 100% discount outside the limit.

**Risk:** HIGH (money and the separation-of-duties control). Approve itself is well guarded; the surrounding paths are not.

### W8. OrgClosure.status + Org.archivedAt: company closure and archive

**Where:** `schema.prisma:1287-1315`. `SCHEDULED | CANCELLED | DELETED`, plus `purgeProgress`/`purgeError` as sub-state.

**Transitions:**
- — / CANCELLED → SCHEDULED: upsert (`services/companyClosure.ts:86-102`). Check-then-act, but `orgId` is unique and the operation is idempotent.
- SCHEDULED → CANCELLED: `:108-111`. Check-then-act. `:110` refuses once `deleteAfter` has passed.
- SCHEDULED → DELETED: job (`:295`, `:315`). It selects SCHEDULED rows once at the start of the run and **never re-checks before deleting**. The final write is an unconditional `update` by `orgId`.

**Race (risk #5):**
1. cancel reads at t1 < deleteAfter
2. the purge run starts at t2 ≥ deleteAfter
3. cancel writes CANCELLED at t3
4. the purge deletes everything and overwrites DELETED

The user was told it was cancelled. The window is narrow, but the result is irreversible.

**Closure side effects:**
- `closeEmptyAccount` (`:259-285`) cancels the subscription and sets the entitlement to `CLOSED`. Section 2: a later sync undoes `CLOSED`.
- Section 1: a webhook undoes `cancelled`.

**Archive** (`services/companyArchive.ts:54-82`):
- `archivedAt` null ↔ set. Check-then-act with no guard in the `where`.
- The "last active company" count (`:61`) and the company-limit check on reactivate are not atomic. Two concurrent archives of the last two companies can leave zero active.

**Risk:** MED (irreversible deletion, narrow window). Archive is LOW.

### W9. AccountInvitation.status

**Where:** `schema.prisma:865-889`. `PENDING | ACCEPTED | REVOKED | EXPIRED`.
- **EXPIRED is never written.** It is derived at `services/accountInvitations.ts:67` and `:228`.
- Resend (`:198`) and revoke (`:216`) still accept a stored `EXPIRED`. That is dead but harmless.

| From → To | Write | Guard |
|---|---|---|
| PENDING → REVOKED (re-invite same email) | `:171` | atomic, in a transaction with the create (`:172`) |
| PENDING/EXPIRED → PENDING (resend, new token) | `:196-204` | **check-then-act; the update `where: { id }` only** |
| PENDING/EXPIRED → REVOKED | `:216` | atomic |
| PENDING → ACCEPTED | `:306` | atomic, including `expiresAt > now`. **Invitation accepted twice: prevented.** |

**Races:**
- **Resend vs revoke or accept:** resend checks the status at `:198`, then writes `status: 'PENDING'` with a new token at `:203`. A revoke or accept that lands in between is undone.
  - A REVOKED invitation becomes live again.
  - An ACCEPTED one becomes PENDING, and its new link can re-run accept. That re-upserts the membership to `ACTIVE` (`:328-331`), which un-suspends a member suspended in the meantime.
  - Ops can also resend (`asOperator`, `:192`).
- **Accept is not transactional:** the claim (`:306`) and user create (`:310`) are followed by the membership, org, branch and role upserts (`:328-351`) and `acceptedByUserId` (`:352`) as separate writes. A failure after `:306` leaves ACCEPTED with no access. A retry gets ALREADY_ACCEPTED (`:226`, `:307`).

**Risk:** MED-HIGH (access).

### W10. AccountMembership.status + role; User.isActive

**Where:** `schema.prisma:843-858`. Status `ACTIVE | SUSPENDED`; role `OWNER | ADMIN | BILLING_ADMIN | MEMBER`.

**Transitions:**
- suspend / reinstate: `services/accountMembers.ts:178-196`
- role change: `services/accountMembership.ts:153-197`
- Both lock the OWNER rows `FOR UPDATE` before the last-owner count (`accountMembers.ts:185-187`, `accountMembership.ts:181-183`). Concurrent demote and suspend are serialised. Good.

**Other writers:**
- Invitation accept re-sets `ACTIVE` (`accountInvitations.ts:330`). Section 9.
- Backfill creates SUSPENDED from `!isActive` (`accountMembership.ts:212`).

**Enforcement:** `middleware/tenantContext.ts:152` (SUSPENDED → 403). #222 changes this file.

There are two overlapping "switched off" flags: membership `SUSPENDED` (account-level) and `User.isActive` (login-level; leavers, SCIM `routes/scim.ts:280-283`, `:387`). Reinstating one does not touch the other.

**Risk:** MED (access). The core writes are well guarded.

### W11. OutsideAccess.status

**Where:** `schema.prisma:929-955`. `ACTIVE | SUSPENDED | REVOKED`. Expiry is derived.

**Transitions:**
- grant upsert to ACTIVE, from any state including REVOKED, on purpose (`services/outsideAccess.ts:89-95`)
- status change (`:115-123`)
- edit (`:106-112`)

All three are check-then-act, with REVOKED refused on a stale read (`:108`, `:117`). Revoke racing a resume or edit can end in ACTIVE (the resume update `where: { id }`, `:120`). Self-change is blocked (`:102`).

**Risk:** MED (access; needs two admins acting at once).

### W12. Credential.status (+ API keys, SCIM tokens, share links)

**Where:** `schema.prisma:960-994`. `ACTIVE | SUSPENDED | REVOKED`. Expiry is derived.

**Transitions:**
- suspend (`services/credentials.ts:311-318`), resume (`:320-328`), revoke (`:331-339`), extend (`:342-350`)
- All are check-then-act, with `update where: { id }`.
- rotate (`:358-393`) is guarded by the `rotatedFromId` unique, so a double rotate gets 409. Good.

**Race:**
- Resume or suspend racing revoke can leave a REVOKED credential `ACTIVE` or `SUSPENDED` (for example `:325` after `:335`).
- Mitigation: `effectiveStatus` also requires the issuing row to be enabled (`:168`), and revoke mirrors into the issuing table: share links (`services/shareLinks.ts:164-166`), API keys (`services/apiKeys.ts:96`), SCIM (`services/scimTokens.ts:139`, hash replaced).
- So it fails closed for those kinds. Suspend lives only in the registry.

**Risk:** LOW-MED (security; mitigated).

### W13. TrialSignup.status + provisioningAt: self-serve trial (clor.in)

**Where:** `schema.prisma:1406-1440`. `PENDING | CONFIRMED | EXPIRED`, plus `provisioningAt` as a lock.

**Transitions:**
- start: create, or update the newest PENDING (`routes/signup.ts:147-150`). `findFirst` then write, so concurrent starts can make two PENDING rows. LOW.
- PENDING → EXPIRED lazily (`:84`). Ops shows it derived (`:307`).
- confirm claim (`:216-219`): atomic on `accountId null, status PENDING, provisioningAt null|stale`.
- PENDING → CONFIRMED (`:244-247`).
- release on error (`:238`).
- Ops resend: any non-CONFIRMED status → PENDING **and `provisioningAt: null`** (`:316-320`). Check-then-act.

**Race:** an operator resend during a confirm that is in progress clears the lock, so a second confirm with the new link can claim (`:217`). A double account is probably stopped by the unique email in `provisionAccount` (`User.email` is unique, `schema.prisma:237`), but the lock no longer protects it.

**UI:** the setup page (React wizard: email → link → company/apps → confirm) mirrors the server. The confirm response signs the user in (`:250-252`).

**Risk:** MED (account creation).

### W14. DemoRequest.status + provisioningAt: sales pipeline

**Where:** `schema.prisma:1354-1398`. `NEW | CONTACTED | DEMO_DONE | ACCOUNT_CREATED | NOT_A_FIT`. Settable: all but ACCOUNT_CREATED (`routes/demoRequests.ts:43-45`).

**Transitions:**
- PATCH (`:344-372`): any settable status to any other, with no transition table. Check-then-act; refused once ACCOUNT_CREATED (`:352`).
- create-account (`:401-447`): atomic claim on `provisioningAt`, then ACCOUNT_CREATED (`:445-447`). Allowed from NOT_A_FIT too.

**Race:** a PATCH whose read predates ACCOUNT_CREATED overwrites it with e.g. CONTACTED (`:359` update by id). `accountId` survives.

ACCOUNT_CREATED is terminal. `packages/ops/DemoRequests.jsx:20` matches `SETTABLE`.

**Risk:** LOW (CRM data only).

### W15. Auth state built from booleans and timestamps

- **Lockout** (`User.failedLoginCount`, `lockedUntil`):
  - `registerFailedLogin` increments atomically, then sets `lockedUntil` and resets to 0 (`services/auth.ts:310-331`). Cleared on success (`:333-337`), password reset (`routes/auth.ts:808`), SSO (`routes/sso.ts:282`) and ops unlock (`routes/opsCustomers.ts:241-244`, check-then-act, harmless).
  - LOW.
- **TOTP:**
  - The step replay guard is atomic (`routes/auth.ts:292`).
  - **The recovery code burn is read-filter-write** (`routes/auth.ts:295-298`). Two concurrent logins with the same recovery code both succeed. The single-use promise is broken.
  - MED-LOW (needs the code).
- **Sessions:**
  - Rotation claims atomically (`services/auth.ts:162-165`) and re-checks `isActive` and sign-in rules on refresh (`:140-154`).
  - A SCIM or leaver deactivation stops refresh. An access token lives until it expires.
  - LOW.
- **Step-up:** a stateless signed token bound to `sid`, 15 minutes (`services/stepUp.ts:18`, `:28-35`). There is no server state machine. **#222 changes stepUp/policy.**
- **Account suspended by CLOR:** `Account.suspendedAt` read in `middleware/tenantContext.ts:129`. #222 changes this file.
- **Support grants:** no model or route on main (only planned). Nothing to analyse.

### W16. IdempotentRequest.status (0 = in flight, else HTTP code)

`middleware/idempotency.ts:43-89`. The first request creates the row with status 0 (unique `scope`+`key`). A duplicate waits, then replays (`:62-69`). A 4xx deletes the row (`:83-84`). The `!writableFinished` cleanup is only a best effort (`:89`). A crashed instance leaves status 0 until `expiresAt`, so retries get 409 IN_PROGRESS for the whole TTL.

**#222 changes this file.** LOW.

### W17. JobLease + JobRun.outcome

- **JobLease:** one atomic `updateMany` takes the lease (`services/jobLease.ts:65-75`). The heartbeat extends `until` and aborts on loss (`:183-190`). Release is fenced by the token (`:115-119`). Sound.
- **JobRun.outcome:** `RUNNING → OK | FAILED | STOPPED` (`:210`, `:241-249`). A crash leaves `RUNNING` forever, never closed. It is read as "stuck" by `services/ops/systemHealth.ts:40` and as stale by `services/sampleBuild.ts:55`.
- **#225 changes jobLease and jobRegistry.** LOW.

### W18. Low-risk machines

- **SupportTicket.status** (`OPEN | WAITING | SOLVED | CLOSED`): customer reply goes to OPEN (`services/support/tickets.ts:153`), refused if CLOSED (`:148`). Customer marks SOLVED (`:160`). A staff reply sets WAITING or SOLVED (`:170-176`). The ops PATCH sets any status (`routes/opsTickets.ts:84`, `:105`). All are check-then-act. LOW.
- **PriceBook.status** (`DRAFT | PUBLISHED | ARCHIVED`):
  - archive and restore lock the row `FOR UPDATE` (`services/pricing/books.ts:175`, `:229-231`, `:247-259`)
  - publish archives the previous book inside a transaction (`:213-215`)
  - the partial unique index allows one PUBLISHED
  - "one draft" is `findFirst` then `create` (`:144-156`)
  - LOW.
- **AppCatalogueEntry.status** (`AVAILABLE | COMING_SOON | HIDDEN`): a plain upsert (`routes/opsCatalogue.ts:70`) with no transitions. LOW.
- **cancelAtPeriodEnd UI:** `apps/admin/src/screens/PlanChange.jsx:32-34` and `:83-101` (`state`, `asking`, `stopping` drawer) only reflect server answers. LOW.

### React mode/step machines that matter

- `packages/ops/Approvals.jsx:22-27`: `tab`, `step` (the open decision dialog), `limitOpen`. Actions are driven by the server's `canDecide`/`canWithdraw`, and each one re-validated on the server.
- `packages/ops/Customers.jsx:310-367`: one action dialog keyed by `action` (plan, trial, cancel, reopen). Availability comes from `s.status` (`:333-336`). It sends **no `currentPeriodEnd`** on a plan grant (`:354`), which causes the stale-period bug in section 1.
- The signup wizard (section 13) and `PlanChange.jsx` (`state`, `asking`, `stopping`) hold no state the server does not re-check.

### Suggested fixes (smallest first)

1. `markInvoicePaid`: claim the invoice (ISSUED → PAID) first, then record the payment. Better, do both in one transaction, as `payInvoice` does. Apply the same LIVE check to manual payments.
2. `applyTo`: refuse to move `cancelled` (or a closed account) on a gateway event, or order events by provider timestamp.
3. `setSubscription`: accept `currentPeriodEnd: null` explicitly. Ops grant and reopen should set or clear the period. Route free grants through the approval limit.
4. `resendInvitation`: `updateMany where { id, status in [PENDING, EXPIRED] }`. Run accept's membership writes in one transaction with the claim.
5. Purge: re-select `status: 'SCHEDULED'` per company immediately before deleting. Make cancel an `updateMany where { status: 'SCHEDULED', deleteAfter > now }`, and the DELETED write conditional too.
6. Add `FAILED` to the OpsApproval schema comment and `CLOSED` to AccountEntitlement's (or rename it to CANCELLED). Call `syncAccountEntitlement` after extend-trial.
7. Credential, OutsideAccess, DemoRequest and Archive: add the expected status to the update `where`.
8. Recovery codes: a conditional update on the JSON's old value (compare-and-swap).
9. `setMode` on an active provider: refuse, or drop `active`.

---

# Part 2. People core: approvals engine and employee lifecycle (P)


Repo: `.claude/worktrees/wizardly-visvesvaraya-a75bb1` at `3722b5fe` (= origin/main after #221). Read-only investigation, 13 Nov 2026.
Paths below are relative to `server/` unless they start with `apps/`. Every file:line was read during this pass.

Guard legend:
- **ATOMIC**: `updateMany({ where: { status } })` with a count check, or a write under an advisory/row lock after a fresh read.
- **C-T-A**: check-then-act. The status is read, then an unconditional `update({ where: { id } })` follows.
- **NONE**: no status check.

---

### P1. ApprovalRequest.status / ApprovalStep.status (people approvals engine): HIGH

**Where the state lives.** `ApprovalRequest.status` (schema `prisma/people/schema.prisma:3089`), `currentStep`, `outcome`, `decisionId`. `ApprovalStep.status` (`:3130`), `mode` ANY|ALL (`:3139`), `slot`, `resolvedHow`.

The request's real state is a combination: `request.status` × (does any step at `currentStep` have status WAITING?). The code depends on one derived state:
- **"stalled"**: request WAITING, at least one step, no WAITING step (`services/people/approvals/engine.ts:885`). It means the decision committed but `approveFinal` did not finish.

**Values**
- Request: DRAFT (declared, never written), WAITING, MORE_INFO, APPROVED, REJECTED, WITHDRAWN.
- Step: WAITING, APPROVED, REJECTED, MORE_INFO, HANDED_ON, SKIPPED, WITHDRAWN.
- `resolvedHow` adds SAME_PERSON (`engine.ts:1020`) and HANDED_ON (`:1215`, `:1441`). Neither is in the schema comment at `:3141`.

#### Request transitions

| from → to | write | guard |
|---|---|---|
| ∅ → WAITING | `submitRequest` `engine.ts:772`; `openSourced` `:1120` | idempotencyKey C-T-A `:756`, backed by unique `(orgId, idempotencyKey)` |
| WAITING → WAITING (next step) | `openStep` `:725` | runs inside the caller's tx |
| WAITING → REJECTED | `decide` `:1034` | step claim ATOMIC `:1021` under advisory lock `approval-decide:<id>` `:1014`; the request status itself is not re-read under the lock |
| WAITING → MORE_INFO | `decide` `:1038` | same as above |
| WAITING → APPROVED | `approveFinal` `:871` | advisory lock `approval-final:<id>` plus a fresh re-read `:855-857` (ATOMIC) |
| WAITING → REJECTED (effect failed) | `closeUnapplied` `:921` | called while holding the approveFinal lock |
| MORE_INFO → WAITING | `reply` `:1073` | ATOMIC updateMany; then a redundant unconditional update `:1076` |
| WAITING/MORE_INFO → WITHDRAWN | `withdraw` `:1091` | ATOMIC updateMany. Does **not** take the `approval-decide` lock |
| WAITING/MORE_INFO → APPROVED/REJECTED/WITHDRAWN | `closeAtSource` `:1186` (leave/attendance) | advisory lock plus re-read (ATOMIC) |
| WAITING/MORE_INFO → WAITING (restart) | `restartSourced` `:1164` | advisory lock plus re-read |
| WAITING/MORE_INFO → WITHDRAWN | `closeOutFor` `services/people/lifecycle/closeOut.ts:26` | **NONE**: findMany `:19`, then unconditional `update`; no lock, no `tellClosed` |

#### Step transitions

- **WAITING → decided.** `decide` claim at `:1021` (ATOMIC). The reject path then moves the other slots WAITING → SKIPPED (`:1033`).
- **WAITING → HANDED_ON.**
  - `handOnStep` `:1211`: lock.
  - dues HAND_ON `:1439`: ATOMIC claim, no lock.
  - away hand-up `:1538`: ATOMIC claim.
- **WAITING → APPROVED (auto, overdue).** `:1476`, with lock and a request re-read.
- **WAITING → WITHDRAWN.** `withdraw` `:1093`; `closeOutFor` `closeOut.ts:25`.
- **Rows created already decided.** SKIPPED/APPROVED (SELF) rows are created at `:707`, `:711`, `:782`, `:1130`. A synthetic REJECTED row is created at `:920`.
- **Field-only rewrites of a step.**
  - `reassignStep` `:1242`: lock plus a WAITING check.
  - `rerouteManagerSteps` `:1606`: **NONE**, unconditional `update` by id.
  - `leavers.ts:62`: **NONE**, findMany WAITING, then a per-row `update`.

#### UI vs server (item 4)

- `apps/people/src/screens/Approvals.jsx:399` shows the decide controls to any viewer who is not the requester while status is WAITING. The server's candidate check (`engine.ts:983`) is stricter, so this is safe: the UI only shows controls the server may then refuse.
- Withdraw is offered for WAITING/MORE_INFO (`Approvals.jsx:432`, `MyRequests.jsx:138`), which matches `engine.ts:1088`.
- No case found of the UI hiding something the server allows.

#### Terminal and stuck states (item 5)

- APPROVED, REJECTED and WITHDRAWN are terminal on purpose: no write leaves them.
- **Stuck: stalled with no recovery for sourced requests.** The `half` sweep (`:1498`) and `finishStalled` skip `sourceKind != null`. For a sourced request, the module's own transaction is meant to cover this.
- **Stuck: MORE_INFO left behind by the ALL-mode race below.** If the race takes the DONE branch, the request stays MORE_INFO with every slot decided.

#### Written but never read, or the reverse (item 6)

- Request `DRAFT`: in the schema comment only. Never written.
- Step `MORE_INFO` rows: read only by `reply` (`:1069`). `withdraw` does not close them (it only matches WAITING), so they stay MORE_INFO forever (cosmetic).

#### Races (item 7)

**R1: ALL-mode "more info" racing an approval of another slot (HIGH for money types).**
- `decide` checks `request.status !== 'WAITING'` before the tx (`:948`) and does not re-check it under the lock.
- Sequence:
  1. Approver A asks for more info: A's slot → MORE_INFO, request → MORE_INFO (`:1038`).
  2. Approver B passed the pre-check before A committed. B waits on the advisory lock, then claims its own slot, which is still WAITING (`:1021`).
  3. `count(WAITING) == 0` (`:1042`), because A's slot is MORE_INFO, not WAITING.
  4. `openStep` opens step N+1 and **overwrites MORE_INFO → WAITING** (`:725`).
- Result: the step completes without A's approval. A's question is lost.
- For two-person money types (`TWO_PERSON_TYPES`; PR #126 moves payroll loans, revisions and settlements onto this engine), this is a maker-checker bypass.
- Fix: re-read `request.status` under the lock, or count `status IN (WAITING, MORE_INFO)` at `:1042`.

**R2: `closeOutFor` vs approveFinal/decide (MED-HIGH).**
- `closeOut.ts:19-26` reads open requests, then writes WITHDRAWN unconditionally, with no lock.
- If `approveFinal` commits APPROVED in between (the effect already ran: an expense claim approved, a job change scheduled), the request is flipped to WITHDRAWN while its effect stands.
- No `tellClosed` is called, so `ShiftSwap` rows stay WAITING forever: `onClosed('SHIFT_SWAP')` at `services/people/shiftSwaps.ts:516` never runs.
- Money rows recover lazily by reading the request status (`money/expenses.ts:161-171`, `money/effects.ts:41-46`).

**R3: withdraw vs final approval (LOW, consistent).**
- `withdraw` takes no lock. It can land in the stalled window, after every step is APPROVED but before `approveFinal` runs.
- `approveFinal` re-reads under its lock and skips. Result: WITHDRAWN with every step APPROVED. Consistent, but surprising to the approver.

**R4: effects run at least once, not exactly once (MED; HIGH once PR #126 lands).**
- `approveFinal` runs the effect, which writes in its own transactions (`:863`, comment at `:842-849`), then sets APPROVED inside the lock tx (60 s timeout `:874`).
- If the lock tx fails or times out after the effect commits, the request stays stalled and `finishStalled` runs the effect **again**.
- Effects that are idempotent today:
  - LEAVING: checks `status === 'LEFT'` (`effects.ts:89`).
  - `scheduleChanges`: one pending row per field and date.
  - Money effects: claim on the source row status.
- Any new payroll effect (loan disbursal, revision) must be idempotent by `requestId`.

**R5: `rerouteManagerSteps` `:1606` and `leavers.ts:62` (LOW-MED).**
- Both use unconditional `update` by id after a WAITING read.
- If the step was decided meanwhile, `approverUserId` and `candidateUserIds` on a decided step are overwritten. `decide` set `approverUserId` to the real decider at `:1021`, so the audit trail of who decided is corrupted.

**Already safe**
- Double approve: ATOMIC claim.
- Double reply: ATOMIC claim.
- Dues vs decide: claim-based; AUTO_APPROVE takes the lock.

#### Risk: HIGH

The engine gates pay, records and access. R1 breaks two-person approval. R2 contradicts applied effects.

---

### P2. ScheduledChange.status: MED

**Where.** `schema.prisma:2980`. Values: PENDING, APPLIED, CANCELLED.

**Transitions**
- ∅/PENDING → PENDING (upsert-like): `services/people/effectiveDating.ts:65-72`. C-T-A: findFirst PENDING, then `update` by id with no status in the where.
- PENDING → APPLIED: `applyDueChanges` `:103` (ATOMIC claim with runId).
- APPLIED → CANCELLED: `:113` (person LEFT) and `:125` (manager left). APPLIED is a transient "claimed" state here.
- APPLIED → PENDING on failure: `:135` (ATOMIC).
- PENDING → CANCELLED:
  - `cancelScheduledChange` `:81` (ATOMIC).
  - `closeOutFor` `closeOut.ts:18` (ATOMIC).
- Field rewrites while PENDING: `organization.ts:215` and `:446`.

**UI/server.** Cancel goes through `routes/people.ts:1836` → ATOMIC. The edit form refuses a field with a waiting change (`people.ts:1179-1180`).

**Terminal and stuck**
- CANCELLED is terminal. APPLIED is meant to be terminal.
- **Stuck:** if the process dies between the claim (`:103`) and `updateEmployee` (`:131`), the row is APPLIED but never applied. No sweeper reclaims APPLIED rows with a stale `appliedRunId`. The job change is lost silently.

**Races**
- Scheduler vs user cancel: safe, both are claims.
- `scheduleChanges` C-T-A: the row can be APPLIED between the findFirst and the `update` at `:72`. `toValue` is then rewritten on an already-applied row (history lies).
- Two concurrent saves can both `create`, because there is no unique key on (employeeId, field, effectiveOn, PENDING).
- `status` is in `SCHEDULABLE_FIELDS` (`:27`), but every caller found skips it (`people.ts:1186`, `:1212`). It is dead capability that could bypass the leaving flow if a caller ever passes it.

**Risk: MED.** Employee job records; the lost-apply window needs a crash to hit.

---

### P3. Employee.status plus lifecycle flags: HIGH

**State.**
- `status` ACTIVE | ON_NOTICE | LEFT | SUSPENDED (`schema.prisma:69`).
- Flags acting as state:
  - `dateOfLeaving` + `leavingType`: on notice, or left.
  - `confirmedOn` null + `probationEndDate` set: on probation.
  - `dateOfJoining > today`: pre-joiner (`people.ts:674`).
  - `anonymisedAt`: erased.
  - `currentEpisodeSeq`: stint.
  - Platform `User.isActive` / `leftAt` (`services/leavers.ts:124-128`): sign-in state, separate from Employee.

**Transitions**

| from → to | write | guard |
|---|---|---|
| ACTIVE/ON_NOTICE → ON_NOTICE | `scheduleLeaving` `lifecycle/leaving.ts:70` | NONE in the write. The callers check only `!== LEFT` (`routes/personnel.ts:211`, `effects.ts:89`, `probation.ts:45`) |
| any → LEFT | `finishLeaving` `leaving.ts:87-90` | NONE in the write. `runSeparations` re-reads ON_NOTICE at `:137-138`, then writes unconditionally (C-T-A) |
| ON_NOTICE → ACTIVE | `withdrawLeaving` `lifecycle/stayOn.ts:42` via `updateEmployee` (row lock `FOR UPDATE`, `employees.ts:96`) | status check `stayOn.ts:39` before the lock, and no `expectedVersion` (C-T-A) |
| LEFT → ACTIVE | rehire `routes/personnel.ts:269-292` | C-T-A: `:258` status check, then unconditional `tx.employee.update` |
| ACTIVE ↔ SUSPENDED | PUT `routes/people.ts:1120`+, via `updateEmployee` | route guards `:1141-1151` on the pre-read row. Version check only when the client sends `version`/If-Match |
| (LEFT, anonymisedAt null) → anonymised | `anonymiseEmployee.ts:124` | C-T-A: `:61-62` read outside the tx |

**UI vs server (item 4)**
- PUT refuses LEFT and ON_NOTICE as targets (`people.ts:1145`) and points to the dedicated flows. Good.
- The dedicated flows bypass `version`: `leaving.ts:70/89` and `personnel.ts:269` never increment it. An editor holding an older copy is **not** told STALE after a leaving or rehire.

**Terminal and stuck (item 5)**
- LEFT is left only through rehire. `anonymisedAt` is final.
- **Stuck:** SUSPENDED with `dateOfLeaving` set. PUT reads ACTIVE, `scheduleLeaving` writes ON_NOTICE, then the PUT writes SUSPENDED (the PUT's `existing` guard is stale, and the version did not move). `runSeparations` only selects ON_NOTICE (`leaving.ts:131`), so the person never leaves.

**Races (item 7)**
1. **/stay vs `runSeparations`.** On the day after the last day, the job reads ON_NOTICE (`:137`) and HR's withdraw commits ACTIVE. Then `finishLeaving` writes LEFT unconditionally. Effects: off the readers, portal sessions ended, team moved up, open requests withdrawn (`closeOutFor`) for someone who stays. **HIGH** (access and records).
2. **Double `finishLeaving`.** Possible paths: the /resign form with a past day plus the job; a LEAVING approval plus HR's form; two clicks. Each run does `closeEpisode`, the `separated.v1` event, letters, the checklist and `revokeFromReaders` again. Some steps are idempotent; the episode and event depend on downstream dedupe (correlationId is the same, `:93`).
3. **Rehire vs anonymise.** Both read LEFT. Result: an ACTIVE rehired person with erased contact data, documents and PIN. Irreversible. MED (narrow window).
4. **Probation W11 guard is C-T-A.** `probation.ts:86`: two concurrent decisions can both pass the count and open a CONFIRM request and an END request. Approving both confirms the person, then terminates them.

**Risk: HIGH.** Employment status drives door access, the portal, payroll settlement and attendance.

---

### P4. ProbationReview.outcome / recommendation: MED

- Values: `recommendation` and `outcome` are CONFIRM | EXTEND | END. `outcome` null means open.
- Writes:
  - `saveReview` `probation.ts:37-38`: C-T-A on "open" (outcome null); a race can create two open reviews.
  - `applyOutcome` `:71`: sets the outcome on the latest open review. Unconditional; C-T-A.
- `applyOutcome` does not re-check `confirmedOn`. Direct path with no rule: a double click confirms twice (two `employmentEvent` rows `:53`, two `probation_confirmed` events; the letter is keyed per stint).
- `recommendation` is written but never drives anything; display only.
- **Risk: MED.** An employment can end (END → `leaveEmployee`).

### P5. JoinInvite.status: MED

- Values: SENT → STARTED → RETURNED → CHECKED; any open state → EXPIRED.
- Writes:
  - `lifecycle/invites.ts:74` (ATOMIC expiry of older invites).
  - `:104` expireIfDue: unconditional.
  - `:115` joinerView SENT→STARTED: unconditional on a stale read.
  - `:173` submit → RETURNED: C-T-A, checked at `:121-122` outside the tx.
  - `:202` check → CHECKED: C-T-A.
  - `leaving.ts:104` (ATOMIC).
- Races:
  - A joiner GET racing a POST can overwrite RETURNED → STARTED. `checkInvite` then refuses (`:184`). The submitted details are stranded.
  - A submit racing an HR resend writes RETURNED onto an EXPIRED invite.
  - A double submit creates the documents twice (`:167-170`).
- Stuck: RETURNED invites of leavers are not expired (`leaving.ts:104` only matches SENT/STARTED). HR can still "check" them into a LEFT record.
- **Risk: MED.** Personal data written to the record.

### P6. JoinStatutory.status: HIGH (bank details)

- Values: SENT | HELD | **SENDING** (written at `joiningStatutory.ts:142`, missing from the schema comment `schema.prisma:3415`) | APPLIED | REJECTED.
- Writes:
  - Approve SENT→HELD `:161` (ATOMIC).
  - HELD→SENDING `:142` (ATOMIC).
  - SENDING→APPLIED `:147`: unconditional.
  - SENDING→HELD `:149` (ATOMIC).
  - **Reject `:181`: C-T-A, unconditional `update`.**
  - The joiner's resubmit deletes and recreates the row (`:110-111`).
- Race: approve vs reject. Reject's check at `:179` can pass before approve claims; reject then overwrites HELD/SENDING → REJECTED and masks the data. Meanwhile approve's `sendToPayroll` applies the bank and PF data to Payroll (`:145`) and then writes APPLIED over REJECTED.
- Stuck: SENDING after a crash. `pushHeld` only picks HELD (`:189`); nothing reclaims SENDING.
- **Risk: HIGH.** Bank account goes to payroll.

### P7. Offer.status: LOW

- Values: SENT | ACCEPTED | DECLINED | WITHDRAWN. EXPIRED is **derived at read** (`offers.ts:96`, `:209`) and never written.
- All transitions are ATOMIC: `:163`, `:194`, `:226`, `:265`.
- Rows past expiry stay SENT in the database. A query on `status: 'SENT'` in the database needs `expiresAt` too.

### P8. EmployeeDraft.step: LOW

- An integer 1..4, clamped at `routes/people.ts:846`. Update at `:853` and create at `:858`. Deleted on create at `:1110`.
- The client wizard owns the step; the server only stores it. There are no transitions to guard.

### P9. ChecklistTask.systemState: LOW-MED

- Values: WAITING | CONFIRMED | FAILED | NONE (`readersDone.ts:29`, `:31`, `:44`, `:51`).
- CONFIRMED and FAILED are ATOMIC on `doneAt null` / `systemState WAITING`.
- HR may tick the task only when FAILED (`checklists.ts:315-316`). UI and server agree.
- `kind` LEAVING → LEAVING_WITHDRAWN (`stayOn.ts:46`) also acts as state.
- **Risk:** door access confirmation.

### P10. ClearanceLine.status: LOW

- Values: OPEN | CLEAR | WITHDRAWN.
- Sign: `engagement/clearance.ts:254`, optimistic on `updatedAt` (ATOMIC).
- WITHDRAWN: `stayOn.ts:49`. WITHDRAWN rows are deleted when a leaving restarts (`clearance.ts:78`, `:121`).
- Fine.

### P11. ExitInterview.status / outcome: LOW

- Values: status OPEN | SUBMITTED; outcome EXIT_CONFIRMED | RETAINED. `withdrawnAt` and `round` also act as state.
- Writes are ATOMIC updateMany on `outcome: null` (`exitInterview.ts:295`), plus RETAINED on withdraw (`stayOn.ts:50`).
- The round is assigned under the `exit-round` lock (`stayOn.ts:56`).
- `:302` resets the outcome unconditionally (an undo).

### P12. PolicyVersion.status: MED

- Values: DRAFT → WAITING → PUBLISHED → RETIRED.
- Writes:
  - WAITING `policies.ts:247`: unconditional, after `submitRequest`.
  - PUBLISHED `:226`: C-T-A at `:220-221`.
  - RETIRED `:258`: **NONE**, from any state including DRAFT and WAITING.
- **Stuck:** WAITING after the POLICY_PUBLISH request is rejected or withdrawn.
  - No `onClosed('POLICY_PUBLISH')` exists.
  - `updateVersion` (`:206`) and `submitVersion` (`:242`) require DRAFT.
  - The only exit is retire.
- Race: an approver approves between `submitRequest` returning and `:247`; WAITING then overwrites PUBLISHED. Tiny window.
- **Risk: MED.**

### P13. DeskRequest.status: MED (privacy)

- Values: OPEN | WAITING_EMPLOYEE | RESOLVED | REOPENED | MOVED.
- All writes are C-T-A, unconditional `update`:
  - `desk.ts:208` (→ WAITING_EMPLOYEE)
  - `:224` (→ OPEN)
  - `:252` (→ RESOLVED)
  - `:266` (→ REOPENED)
  - `:285` (→ MOVED)
- `resolveRequest` vs `moveToCase`: resolve writes RESOLVED and the resolution text back onto a request that was just MOVED and wiped (POSH confidentiality).
- `employeeReply` `:224` can overwrite RESOLVED or MOVED → OPEN on a stale read.
- MOVED is terminal by intent.

### P14. PrivateCase.status: LOW

- Values: RECEIVED → INQUIRY → REPORT_DUE → ACTION_DUE → CLOSED, plus EXTEND.
- The transition table is explicit in one function (`privateCases.ts:250-282`), the closest thing to a declared machine in this code.
- Writes are C-T-A (`:284`). A double CLOSE overwrites the sealed outcome.
- EXTEND is allowed after CLOSED.

### P15. DeletionReview.status: MED (irreversible)

- Values: PENDING → APPROVED | KEPT.
- Writes: `privacy.ts:119` and `:125`, C-T-A after `:112`.
- KEEP vs APPROVE concurrently: the data is anonymised but the row may end KEPT. A double APPROVE is caught by `ALREADY_ANONYMISED`.
- **Stuck:** PENDING for someone rehired since the scan. APPROVE then throws STILL_EMPLOYED (`anonymiseEmployee.ts:62`); only KEEP closes it.

### P16. DataRequest / DataBreach / ComplianceRule / ComplianceTask / Obligation / PeopleRecord / EmployeeDocument.expiryStage / PeopleSetting.setupState: LOW

- **DataRequest** PENDING → RESOLVED | REJECTED: `routes/people.ts:2796` (C-T-A).
- **DataBreach** OPEN | CLOSED: `routes/dataProtection.ts:190` writes `parsed.data` as-is, so any transition is allowed, including CLOSED → OPEN.
- **ComplianceRule.reviewStatus** DRAFT → CHECKED: `complianceRules.ts:151`.
  - NEEDS_REVIEW is declared in the schema but no write was found (read-but-never-written candidate).
- **Obligation** UPCOMING → DUE → OVERDUE (time-driven updateMany, `complianceRules.ts:294-296`), → DONE / NOT_APPLICABLE (`:278-291`, `:389`).
  - CHECKED is declared at `schema.prisma:2062`. Not confirmed whether `:389` writes it.
- **ComplianceTask**: OPEN → NOT_APPLICABLE at `compliance.ts:242`.
- **PeopleRecord.status**: free-form per kind. Optimistic `version` (`peopleWorkspace.ts:119`, ATOMIC). Asset ASSIGNED → RETURNED at `clearance.ts:258` (ATOMIC).
- **EmployeeDocument.expiryStage**: 60/30/7/0, monotonic reminder marker.
- **PeopleSetting.setupState**: a JSON bag (skipped / recorded steps), not a machine.

---

### React state machines in apps/people that matter

- `screens/Approvals.jsx:395-399`: the decide dialog derives `deciding` from `open.status === 'WAITING' && !mine`, with no step-candidate check (the server enforces it). Also: bulk select plus bulk decide (`:94-96`); reply and withdraw controls (`:431-432`).
- `screens/MyRequests.jsx:125-144`: withdraw and reply, gated on WAITING/MORE_INFO. Matches the server.
- The new-employee wizard persists `step` through EmployeeDraft (#8). Other wizards were not audited in depth.

### Top 5 risks

1. **ALL-mode MORE_INFO vs approve race completes a step without one approver.** `engine.ts:948` (pre-tx status check), `:1042` (counts only WAITING), `:725` (overwrites MORE_INFO). This breaks maker-checker for money types; PR #126 raises the exposure.
2. **`runSeparations` vs "stay" (withdraw leaving).** `leaving.ts:137-139` then unconditional LEFT at `:87-90`. A person who stays is marked left, taken off the doors, and their requests are withdrawn.
3. **`closeOutFor` withdraws requests unconditionally.** `closeOut.ts:19-26`: no lock, no status guard, no `tellClosed`. It can flip an APPROVED request whose effect already ran, and it strands ShiftSwap rows in WAITING.
4. **JoinStatutory reject is check-then-act** (`joiningStatutory.ts:179-181`) while approve sends bank and PF data to Payroll (`:142-147`). A REJECTED or APPLIED record can disagree with Payroll. SENDING can also get stuck.
5. **Leaving, rehire and anonymise write Employee without bumping `version` and check status outside the lock.** `leaving.ts:70` and `:89`, `personnel.ts:269`, `anonymiseEmployee.ts:61-62`. Stale PUTs can overwrite ON_NOTICE (stuck SUSPENDED with a last day). A rehire can race an erasure.

Honourable mentions:
- PolicyVersion stuck in WAITING after a rejection (`policies.ts:247`; no `onClosed`).
- ScheduledChange stuck APPLIED after a crash (`effectiveDating.ts:103-131`).
- Effects run at least once (`engine.ts:863-871`); new payroll effects must be idempotent.

---

# Part 3. People money, talent, performance and background jobs (M)


Repo: `wizardly-visvesvaraya-a75bb1` (= origin/main). Read-only investigation, 13 Nov 2026.
Paths are relative to the repo root. Every file:line below was read. "Atomic" means `updateMany` with `where status` (compare-and-set). "CTA" means check-then-act: `findFirst`, then `update` by id. "Lock" means `pg_advisory_xact_lock`.

---

### M0. Top risks (ranked)

| # | Risk | Where | Level |
|---|------|-------|-------|
| 1 | **Payroll journal can go to Tally twice.** Each "Send to Tally" click creates a new AgentJob, with no check for an existing job for the same run. The agent poll marks jobs PENDING→SENT without a status guard, so two concurrent polls both receive the same jobs. A SENT job is never re-queued. | `server/src/routes/payrollPosting.ts:149`; `server/src/routes/agent.ts:115-116`, `:193-196` | HIGH |
| 2 | **Expense claim can be entered in Books twice.** `approveClaim` sets `booksStatus: 'TO_RECORD'` at approval, before payment. The "For Books" tab lists APPROVED, PAYING and WITH_SALARY claims, so HR can mark one RECORDED and later pay it now. `payClaim` NOW then sets TO_RECORD again, the claim reappears in the Books list and export, and it gets entered a second time. The schema comment says TO_RECORD applies only to "Paid now". | `services/people/money/expenses.ts:783`, `:819`, `:913`, `:970`, `:1024`; `prisma/people/schema.prisma` ExpenseClaim `booksStatus` doc (line ~4027) | HIGH (accounting / GST input credit) |
| 3 | **A withdraw racing the final approval.** `withdraw` accepts a request in WAITING status even while `approveFinal` is running the effect (status is WAITING, no step waiting). `withdraw` does not take the `approval-final:` lock. `approveFinal` then overwrites WITHDRAWN with APPROVED (unguarded `update`). The employee is told "withdrawn" but the claim or advance is approved. In a narrow window, `catchUp`→`backToDraft` moves the claim to DRAFT while `approveClaim` has already added to the advance's `settledAmount`. `approveClaim`'s claim `updateMany` then matches 0 rows and returns `null` without throwing, so the advance write commits. Advance money is consumed with no approved claim. | `services/people/approvals/engine.ts:1083-1092` vs `:852-872`; `expenses.ts:766-785`, `:160-172`, `:188-206` | HIGH (money, narrow window) |
| 4 | **A rejected candidate comes back to life by accepting an old offer.** `moveCandidate` to REJECTED or WITHDRAWN never withdraws a SENT offer. `acceptOffer` then writes `stage: 'OFFER'` on any non-HIRED candidate with an unguarded update and no STAGE event, and tells HR "ready to hire". The referral keeps `outcome = NOT_TAKEN`. `afterCandidateMoved` only advances where `outcome: null`, and `sweepOutcomes` only scans `outcome: null`, so after the hire the referral never becomes JOINED and the referral bonus never starts. | `services/people/talent/hiring.ts:241-258`; `services/people/offers.ts:222-251`; `talent/referrals.ts:392-411`, `:682-687` | HIGH (access: an employee record from a rejected candidate; a referrer's money lost) |
| 5 | **Expense claim stuck in PAYING with no button to recover it.** Pay-with-salary takes APPROVED→PAYING and then calls Payroll. If the process dies before the WITH_SALARY write, the claim stays PAYING. The server allows a retry after 2 minutes, but only through the API. The UI shows pay buttons only for APPROVED claims, and `syncPayroll` ignores PAYING. Final settlement's `closePeopleSources` also matches only APPROVED and WITH_SALARY, so a PAYING claim is never paid out on exit. | `expenses.ts:813`, `:823-837`, `:228-237`; `apps/people/src/money/Expenses.jsx:177`; `services/payroll/finalSettlementSources.ts:451-453` | MED (money owed, stuck) |
| 6 | Advances are never marked "entered in Books" from the UI. Only `claimIds` are sent, so every paid advance stays TO_RECORD and is in every "Download for Books" export forever. | `apps/people/src/money/Expenses.jsx:101`; `expenses.ts:948`, `:1050` | MED |
| 7 | HR outbox can push punches twice. The manual "/flush" route calls `flushOutbox()` without the `hr.flush` lease. Rows have no claimed or SENDING state. | `server/src/routes/integrations.ts:529-535`; `services/hr/sync.ts:75-110`, `:166` | MED |
| 8 | Job opening status: any status can move to any other through the API (no "from" check, CTA). The UI has an implicit transition table that the server does not enforce. | `talent/hiring.ts:97-111`; `apps/people/src/talent/Openings.jsx:54-57` | LOW-MED |

---

### M1. ExpenseClaim.status and booksStatus (money)

**Where the state lives:** `ExpenseClaim.status` (default DRAFT) and `booksStatus` (null, TO_RECORD or RECORDED). Labels are in `CLAIM_WORDS` (`expenses.ts:604`). `OPEN_CLAIM` is defined at `expenses.ts:49`, `DECIDED` at `:970`.

**Values:** DRAFT, SUBMITTED, APPROVED, PAYING, WITH_SALARY, PAID, SETTLED, REJECTED. All of them are both written and read.

**Transitions:**

| from → to | write | guard |
|---|---|---|
| (new) → DRAFT | `addLine` create `expenses.ts:419` | draft lock `people-money-draft:` |
| (new) → SUBMITTED (HR records it) | `recordClaim` `:349` | draft lock; deleted on approval failure `:367` |
| DRAFT → SUBMITTED | `submitClaim` `:490` | draft lock + status check inside the transaction (safe) |
| SUBMITTED → DRAFT (approval send failed) | `:498` | atomic on the `pending:` key |
| SUBMITTED → DRAFT or deleted (withdrawn) | `backToDraft` `:203`, `:201` | draft lock + `findFirst status: from` (safe for the draft, **not under the claim lock**) |
| SUBMITTED → REJECTED | `catchUp` `:171` | atomic `where status` |
| REJECTED → DRAFT | `reopenClaim` → `backToDraft` `:571-575` | same as above |
| SUBMITTED → APPROVED or SETTLED | `approveClaim` `:783` | claim lock + atomic; **the advance write before it is not rolled back when `count === 0`** (`:785` returns null; nothing throws) |
| APPROVED → PAID (paid now) | `payClaim` `:819` | atomic |
| APPROVED, or PAYING older than 2 min → PAYING | `:823` | atomic |
| PAYING → APPROVED (Payroll refused) | `:829`, `:833` | atomic |
| PAYING → WITH_SALARY | `:837` | atomic |
| WITH_SALARY → PAID | `syncPayroll` `:233` | atomic |
| WITH_SALARY → APPROVED (Payroll cancelled) | `:235` | atomic; keeps `booksStatus` |
| APPROVED or WITH_SALARY → PAID (final settlement) | `finalSettlementSources.ts:451-453` | atomic |
| booksStatus null → TO_RECORD | `:783` (approval), `:819` (paid now) | unconditional overwrite |
| booksStatus TO_RECORD → RECORDED | `markRecorded` `:947` | atomic on booksStatus, **no status filter** |

**UI vs server:**
- The UI pays only APPROVED claims (`Expenses.jsx:177`). The server also accepts a stuck PAYING claim for SALARY (`:812-813`), but the UI never offers that (risk 5).
- `canWithdraw` is true only for SUBMITTED (`:615`). The server's `withdrawMine` has no status check and relies on the engine refusing (`:539-549`, engine `:1088`). That is fine.

**Terminal and stuck states:**
- PAID, SETTLED and REJECTED are terminal. REJECTED can be reopened.
- PAYING gets stuck if the process dies (risk 5).
- WITH_SALARY waits on Payroll. It only moves when someone reads the list (`listClaims`, `claimForStaff`); no job moves it.

**Written but never read, or the reverse:**
- `booksStatus` is written at approval although the doc says "Paid now" (risk 2).
- RECORDED is never read except as "not TO_RECORD".

**Races:**
- Approve vs withdraw (risk 3).
- Two `approveClaim` runs for the same request are serialised by `approval-final:` (engine `:853-855`).
- Pay NOW vs pay SALARY vs final settlement: all atomic, one wins.
- RECORDED then pay NOW gives a double Books entry (risk 2).

**Risk: HIGH.** Real money, and the Books double entry.

### M2. EmployeeAdvance.status and booksStatus (money)

**Values** (schema doc line ~4072): WAITING, APPROVED, REJECTED, WITHDRAWN, PAID, CLOSED.

**Transitions:**

| from → to | write | guard |
|---|---|---|
| (new) → WAITING | `askAdvance` `:578` | lock per person + 2-minute double-tap twin check |
| WAITING → deleted (send failed) | `:586` | atomic on the key |
| WAITING → REJECTED or WITHDRAWN | `catchUp` `:173` | atomic |
| WAITING → APPROVED | `approveAdvance` `:799` | atomic, **but the result is ignored**: the "To pay" notice at `:800` is sent even when 0 rows changed |
| APPROVED → PAID (+ booksStatus TO_RECORD) | `payAdvance` `:850` | atomic |
| PAID → CLOSED (settled by a claim) | `approveClaim` `:778` | lock on the advance row |
| PAID → CLOSED (returned in cash) | `closeAdvance` `:887` | lock on the advance row |
| PAID → CLOSED (recovered from salary) | `syncPayroll` `:256` | lock on the advance row |
| PAID → CLOSED (final settlement) | `finalSettlementSources.ts:495` | lock on the advance row |
| recoveringAmount set (recovery started) | `:902` | lock on the advance row + check of Payroll's own rows |
| booksStatus → RECORDED | `:948` | atomic, **never called from the UI** (risk 6) |

**Other notes:**
- APPROVED has no path to cancel. If HR never pays, the advance sits APPROVED for good, and the person cannot withdraw because the request is already APPROVED. CLOSED is terminal.
- The amounts (settled, returned, recovered, recovering) form a second, derived state machine: `advanceOpen` at `:448`. Every write that changes them holds the `people-money-advance-row:` lock, which is well done.
- The UI hides WITHDRAWN rows (`Expenses.jsx:233`).

**Risk: HIGH (money).** The core paths are safe. The gaps are the Books marking and the APPROVED state that can never be cancelled.

### M3. SalaryAdvanceAsk.status (money)

**Values:** WAITING, APPROVED, REJECTED, WITHDRAWN (schema doc). `loanId` and `payrollNote` act as a sub-state: approved but not yet in Payroll, or in Payroll.

**Transitions:**

| from → to | write | guard |
|---|---|---|
| (new) → WAITING | `salaryAdvance.ts:123` | lock + "one open ask" check |
| WAITING → deleted (send failed) | `:130` | atomic |
| WAITING → REJECTED or WITHDRAWN | `effects.ts:46`, `expenses.ts:175` | atomic |
| WAITING → APPROVED | `approveAsk` `:171` | atomic, and the count is checked |
| APPROVED → loan made | `toPayroll` `:146-163` | lock per ask + `loanId` check; `makeSalaryAdvanceLoan` is idempotent through the fixed id `salary-advance:<askId>` (`payrollBridge.ts:206-208`) |

**Other notes:**
- If Payroll cancels the loan, `makeSalaryAdvanceLoan` refuses to make another (`:209`), so the ask stays APPROVED with a note: stuck, by design.
- `sendAgain` (`:177-183`) does not need a status pre-check because `toPayroll` re-checks under the lock.

**Risk: MED.** Well guarded. The only weak spot is the approve vs withdraw engine race (risk 3), which leaves the request APPROVED while the ask may be WITHDRAWN.

### M4. Approval engine coupling (affects 1-3)

- `beforeApproving` guards (`effects.ts:23-37`) are CTA. They are re-checked by the atomic effects, which is fine.
- `withdraw` (`engine.ts:1088-1091`) accepts WAITING or MORE_INFO without checking that some step is still waiting.
- `approveFinal` (`:853-872`) sets APPROVED with an unguarded `update` after the effect runs.
- `closeAtSource` (`:1182`) does skip requests where no step is waiting, so it handles this window correctly; `withdraw` does not.
- **Suggested fix:** in `withdraw`, refuse when no step is WAITING or MORE_INFO, or take the `approval-final:` lock. Also make `approveClaim` throw when `r.count === 0`, so the advance write rolls back.

### M5. JobOpening.status

**Values:** REQUESTED, DRAFT, OPEN, ON_HOLD, FILLED, CLOSED (`hiring.ts:30`). Also `applyOpen`.

**Writes:**
- create `:76`
- `setOpeningStatus` `:106`: any status except REQUESTED. CTA, no "from" check. The only rule is that a requester cannot open their own request (`:101-104`).
- automatic FILLED on hire `:537`, `:622` (from OPEN, ON_HOLD or DRAFT, when the hired count reaches the number of places)
- `setApplyLink` `:118`, `:123` (CTA on status OPEN)

**UI vs server:** The UI offers a fixed table (`Openings.jsx:54-57`): reopen from REQUESTED, DRAFT, ON_HOLD, FILLED or CLOSED; hold only from OPEN; filled only from OPEN or ON_HOLD; close unless already CLOSED or FILLED. The server accepts, for example, FILLED→ON_HOLD, CLOSED→DRAFT, REQUESTED→FILLED or a self-open when the requester is alone.

**Races:**
- `setApplyLink` racing a close can leave `applyOpen = true` on a non-OPEN opening.
- Hiring does not check places or opening status, so an opening can be over-hired, or hired into after FILLED or CLOSED.

**Risk: LOW-MED.**

### M6. Candidate.stage and CandidateEvent from/to

**Values:** APPLIED, SCREENING, INTERVIEW, OFFER, HIRED, REJECTED, WITHDRAWN (`hiring.ts:31`). `OPEN_STAGES` is defined at `:32`.

**Writes:**
- create APPLIED: `:218`, `:651`, `referrals.ts:244`, `:342`
- `moveCandidate` `:249`: atomic on the old stage; refuses HIRED as a target and refuses moving a HIRED candidate; any other move is free.
- `scheduleInterview` `:411`: APPLIED or SCREENING → INTERVIEW, **unguarded update on a stale stage**. It can overwrite a REJECTED set at the same moment.
- `sendOffer` `offers.ts:173`: → OFFER, unguarded update.
- `acceptOffer` `offers.ts:246`: **→ OFFER from any stage except HIRED, including REJECTED and WITHDRAWN** (risk 4); no STAGE event is written.
- `declineOffer` `offers.ts:271`: → WITHDRAWN, CTA.
- hire `:528`, `:617`: atomic → HIRED.

**Events:** CandidateEvent `fromStage`/`toStage` are written by the `event()` helper (`hiring.ts:181`) and in `offers.ts`.
- The accept path writes neither, so the timeline misses the stage jump.
- The scheduleInterview event uses the stale `c.stage`.

**Terminal states:**
- HIRED is terminal.
- REJECTED and WITHDRAWN can be reopened, but `moveCandidate` never withdraws live offers. That is how risk 4 happens.

**Risk: HIGH** (risk 4: hiring from a rejected candidate, and the referral bonus is lost).

### M7. Interview.status

**Values:** SCHEDULED, DONE, CANCELLED (schema).

**Writes:**
- create `:407`
- reschedule `:406`: updates by id only, after the route's org check at `peopleTalent.ts:176-179`. **It does not reset status**, so a CANCELLED or DONE interview that gets moved stays CANCELLED or DONE.
- cancel `:436`: no "from" check, so a DONE interview can become CANCELLED.
- DONE `:454`: when the feedback count reaches the number of interviewers. When interviewers change on reschedule, DONE is not recomputed.

**Other notes:**
- `giveFeedback` checks CANCELLED with CTA.
- `scheduleInterview` checks that the candidate is in an open stage with CTA.

**Risk: LOW.**

### M8. Referral.bonusStatus and outcome (money)

**bonusStatus values:** NONE, WAITING, DUE, SENT, PAID, FORFEITED (schema). **outcome values:** null, JOINED, NOT_TAKEN.

**Transitions:**
- outcome set: `referrals.ts:410`, atomic on `outcome: null`
- outcome reset to null: `:398`, when the candidate is back in an open stage
- NONE → WAITING: `:406`
- WAITING → DUE: `settleBonuses` `:660`, atomic
- DUE → SENT: `sendBonusToPayroll` `:572`, under a `FOR UPDATE` lock on the row (`:526-530`)
- DUE → PAID (paid by hand): `:586`, row lock
- WAITING, DUE or SENT → FORFEITED: `:613`, row lock; the Payroll draft is deleted or cancelled
- Payroll adjustment id `referral-bonus:<id>` is idempotent (`:562-568`)

**Stuck states:**
- **SENT never moves on in People.** No code reads the adjustment back to set PAID. If Payroll cancels the draft, `sendBonusToPayroll` returns `sent:true` (`:543`) and `markBonusPaid` requires DUE (`:585`). The bonus can then only be forfeited, so the referrer loses it. (MED)
- After risk 4, the outcome stays NOT_TAKEN for a hire, so the bonus clock never starts.

**Unread values:** none. The UI words for each value are at `:368`.

**Risk: HIGH** for the bonus money paths: SENT can get stuck and the outcome can be stale.

### M9. Goal.status

**Values:** ACTIVE, DONE, DROPPED. Health: ON_TRACK, AT_RISK, BEHIND.

**Writes:** `updateGoal` (`growth.ts:88-94`) moves any status to any other, including the person on their own goal. Marking DONE forces progress to 100; reopening keeps it at 100. `checkIn` (`:97-110`) checks ACTIVE with CTA.

**Risk: LOW.**

### M10. ReviewCycle.status (+ Review timestamps)

**Values:** DRAFT, OPEN, CALIBRATING, SHARED, CLOSED. `moveCycle` declares its transitions in one table (`growth.ts:160`), the only explicit table in this area. Writes are CTA: `:170`, `:181`, `:185`.

**Review rows:** they have no status column. Their state is implied by `selfAt`, `managerAt`, `finalRating`, `sharedAt` and `acknowledgedAt`, gated by the cycle status:
- `writeSelf` needs OPEN (`:233`)
- `writeManager` and `setFinal` need OPEN or CALIBRATING (`:248`, `:259`)
- `acknowledge` needs `sharedAt` (`:268`)

**Other notes:**
- A manager can still change the manager rating after HR has set the final rating during CALIBRATING; the final rating is not invalidated.
- Reviews are created only at OPEN, so people who join later are never added.
- CLOSED is terminal, and nothing can be re-opened.
- A concurrent double OPEN is harmless because of `skipDuplicates`.

**Risk: LOW.**

### M11. ImprovementPlan.status

**Values:** ACTIVE, COMPLETED, EXTENDED, NOT_MET, CANCELLED. EXTENDED is both an outcome and a live state.

**Writes:**
- create `growth.ts:309`, guarded by the "one running" check at `:308`, which is **CTA**: two concurrent creates make two ACTIVE plans.
- `decidePlan` `:325-335`: checks ACTIVE or EXTENDED with CTA, then an unguarded update. Two deciders: the last write wins (for example COMPLETED overwritten by NOT_MET), and `decidedAt` and `decidedBy` are overwritten.

NOT_MET triggers nothing (by design).

**Risk: MED.** It is an HR or legal record, and the last writer silently wins.

### M12. Training.status and TrainingSeat.status / remindedStage

**Values:**
- Training: PLANNED, DONE, CANCELLED. Set freely in `saveTraining` (`training.ts:47-48`).
- Seat: ASSIGNED, COMPLETED, MISSED. Set freely in `markSeat` (`:81-99`). Moving back to ASSIGNED clears `completedOn` and `expiresOn`.

**Notes:**
- Training status is read only by list filters and by `assign`'s CANCELLED check (`:68`). A DONE training still takes new seats, and ASSIGNED seats are never auto-MISSED.
- `remindedStage` takes 60, 30 or 0. The job (`:150-170`) skips the seat when `remindedStage <= stage`. It is reset when `completedOn` or validity changes (`:52`, `:93`). It is double-send safe: `sendNotice` uses a `dedupeKey` and the job is `exclusive` (`:189`).
- Comment-vs-code mismatch: `expiring()` says "only the newest certificate per person counts" (`:137`) but does not dedupe. A lapsed seat from an older training record keeps warning.

**Risk: LOW.**

### M13. HrOutbox.status

**Values:** PENDING, OK, FAILED.

**Writes** (`hr/sync.ts`): enqueue `:65` (`skipDuplicates` on key); FAILED `:85` (connection off, no status guard); paused `:91`; OK `:103`; retry or FAILED `:107`.

**Gaps:**
- There is no claim or SENDING state. The worker relies on the `exclusive('hr.flush')` lease (`:166`), but the route at `integrations.ts:535` calls `flushOutbox()` directly. A click overlapping the job, or a double click, pushes the same punches twice (risk 7). This is safe only if the target tool dedupes on the `key` the adapter receives.
- FAILED is terminal and has no requeue. Even rows that failed only because the connection was "off" stay FAILED after it is turned back on (`:534` touches only PENDING rows).
- When `retryAll` is false, a rejection goes straight to FAILED on the first attempt.

**Risk: MED.**

### M14. AgentJob.status and result

**Values:** PENDING, SENT, DONE, FAILED.

**Writes:**
- created `payrollPosting.ts:149`, with no dedupe per `runId`
- PENDING → SENT `agent.ts:116`: `findMany` then `updateMany` by ids, **without** `status: 'PENDING'` in the where, so two polls both deliver the jobs
- result `agent.ts:196`: unguarded, so DONE can flip back to FAILED, or a result can land on a PENDING job

**Stuck and missing transitions:**
- SENT is stuck if the agent dies: no timeout returns it to PENDING.
- FAILED has no retry; the only option is a new job, which risks a double post once a "failed" job had in fact reached Tally.
- `result` is only displayed (`integrations.ts:406`).

**Risk: HIGH.** The Tally payroll journal can be posted twice (risk 1).

### M15. WebhookDelivery.status (attendance-owned)

**Values:** PENDING, OK, FAILED.

**Writes:**
- create, pre-claimed for `CLAIM_MS`: `attendance/webhooks.ts:168`
- atomic claim on (status, attempts, nextAttemptAt): `:174`
- result `:146`: unguarded
- FAILED when the hook is off: `:200`

**Gaps:**
- `resendDelivery` (`:221-227`) sends whatever the state is, resets attempts to 0 and takes no claim. It can overlap a retry, and receivers must dedupe on `X-Clor-Delivery`.
- A POST slower than `CLAIM_MS` can be claimed and sent again.

**Risk: LOW-MED.**

### M16. ImportBatch (people)

`mode` (CREATE or UPDATE) is a label, not a state. The real state is `undoneAt`: undo is claimed atomically (`routes/people.ts:2144`) before work begins. If the undo crashes halfway, the batch is marked undone but only partly reverted, with no resume.

**Risk: LOW-MED.**

### M17. React useState mode machines worth knowing

- `Expenses.jsx:50` `recording` goes null → `{step:'person'}` → `{step:'bills', person}`. Fine.
- `ClaimDrawer` `paying` + `busy` (`Expenses.jsx:159-176`). `busy` blocks double clicks client-side, and the server is atomic anyway.
- `ClaimList` `selected` (`:93`) holds claim ids only, so there is no way to select advances for "Mark entered in Books" (risk 6).
- `Openings.jsx:54-57` is the implicit opening transition table, which the server does not enforce.

---

# Part 4. Attendance / Time (A)


Read-only investigation. Paths are relative to `server/src/` unless they start with `apps/` or `prisma/`.

**Key fact for every race below:** `peopleWrite(orgId, fn)` (utils/peoplePrisma.ts:48-60) opens a transaction and takes `pg_advisory_xact_lock(hashtext('people-write:'+orgId))`. Nested calls join it. So a check-then-act *inside* peopleWrite is serialized against every other peopleWrite in the same company. Real races are writes **outside** peopleWrite, and checks done **before** entering it.

Open PRs: **#228** touches services/attendance/{roster,schedule,scheduleGuard,requests,fullDayFix,selfService} and routes attendance/leave/portal/scheduling. **#226** touches services/attendance/{compOff,leaveJobs,overtimePolicy}. compOff.ts does not exist on main.

---

### A1. AttendanceRecord.status (+ validated, overtimeApproved, source, trust)
1. **State:** `AttendanceRecord.status` (prisma/people/schema.prisma, model at line 464). Booleans `validated` and `overtimeApproved` act as sub-states. `source` is CLOCK|MANUAL|REQUEST|LEAVE|DEVICE|IMPORT; DECIDED sources freeze the day against punches.
2. **Values:** PRESENT, HALF_DAY, ABSENT, ON_LEAVE, HOLIDAY, WEEKLY_OFF (`STATUSES`, services/attendance/days.ts:24).
3. **Transitions:**
   - Any status to any status through `writeDay` upsert (days.ts:325). Guard: inside peopleWrite (days.ts:245) with `assertMonthOpen` (days.ts:247). This is the single choke point. On update it **resets `overtimeApproved: false`** (days.ts:328) and `validated: false`.
   - HALF_DAY/ABSENT to PRESENT: fullDayFix.ts:265. A conditional updateMany on status, workedMinutes and punches, inside peopleWrite. This is the atomic, good pattern.
   - ON_LEAVE to deleted: leave.ts:1307 (clearLeaveDays) and leave.ts:2948 (shortenLeave), both inside peopleWrite.
   - validated false to true: routes/attendance.ts:384. **Not inside peopleWrite, no month check, no version guard.** It reads `beforeRows`, then `updateMany where id in ids`.
   - overtimeApproved has three setters outside writeDay: attendance.ts:407 (true/false toggle; `assertMonthOpen` at :403 is outside any lock), attendanceInsights.ts:601 (bulk; checks the month lock at :566 but not payroll), selfService.ts:391 (OvertimeRequest approval).
4. **UI/server mismatch:** HR can un-approve overtime (`approved:false`, attendance.ts:409). That leaves the linked OvertimeRequest APPROVED.
5. **Dead ends:** none (it is a value, not a flow).
6. **Never read/written:** none found.
7. **Races:**
   - (a) Validate vs writeDay. A day rewritten between the read and the updateMany gets validated unseen (attendance.ts:383-386). Validate also works in a closed month.
   - (b) Overtime toggle at attendance.ts:403-409 vs month close is TOCTOU (time-of-check to time-of-use).
   - (c) **Every writeDay wipes overtimeApproved** (days.ts:328). See machine 5.
8. **Risk: HIGH.** Pay is computed from status, validated and overtimeApproved (compute.ts:300, payroll/provisionalDays.ts:118). #228 touches fullDayFix and requests.

### A2. AttendanceMonthLock (month closed / open)
1. **State:** existence of an `AttendanceMonthLock` row (schema line 1023). Payroll-taken is a second, separate lock (`payrollTaken` in assertMonthOpen, days.ts:199-206).
2. **Values:** OPEN (no row), CLOSED (row).
3. **Transitions:**
   - OPEN to CLOSED: attendance.ts:1408 upsert, inside peopleWrite, re-checks readiness under the lock (:1401-1406).
   - CLOSED to OPEN: attendance.ts:1478 deleteMany, inside peopleWrite, together with workOutPendingDays.
   - The existence check at :1471 is outside the lock; harmless because the delete is idempotent.
4. **UI/server mismatch:** none seen.
5. **Dead ends:** none.
6. **Never read/written:** none.
7. **Races:**
   - Writers that check `assertMonthOpen` or `closedMonths` **outside** peopleWrite can land after a close: attendance.ts:403 (overtime toggle), markRules.ts:358/376/398 (penalties, see machine 11), punches.ts:296 (held-punch release, machine 7), validate (machine 1).
   - fixFullDaysQuietly runs after a reopen, outside the lock (attendance.ts:1484).
8. **Risk: HIGH.** This is the payroll freeze.

### A3. AttendanceRequest.status (+ managerApprovedAt, beforeStatus, temporaryScheduleId)
1. **State:** `AttendanceRequest.status` (schema line 575). The schema comment says PENDING|APPROVED|REJECTED only.
2. **Values:** PENDING, APPROVED, REJECTED, **CANCELLED** (written at requests.ts:605 but missing from the schema comment). Sub-state: `managerApprovedAt` null/non-null.
3. **Transitions (all claims are `updateMany where status` inside peopleWrite):**
   - create PENDING: requests.ts:318.
   - PENDING with manager step taken: requests.ts:463-466, guard `status:'PENDING', managerApprovedAt:null`.
   - PENDING to APPROVED/REJECTED: requests.ts:481 (`writeDecision`, guard `status:'PENDING'`), also called from the engine at :514.
   - PENDING/APPROVED to CANCELLED: requests.ts:603-606, guard `status: r.status`.
   - Pre-checks at :594-597: an approved MISSED_PUNCH cannot be cancelled; a non-HR user cannot cancel on or after the date.
   - Edit (PENDING only) resets the manager step: requests.ts:362, re-read under the lock at :357.
4. **UI/server mismatch:** none found. Server rules are complete.
5. **Dead ends:**
   - REJECTED and CANCELLED are terminal (intended).
   - APPROVED MISSED_PUNCH is terminal by design (fix the day instead).
6. **Never read/written:** schema comment is missing CANCELLED. `beforeStatus` is a snapshot only (written at :321), never a state.
7. **Races:** none. Approve vs cancel vs double-approve are all claim-guarded.
8. **Risk: MED.** It writes attendance days, but it is well guarded. **#228 touches requests.ts.**

### A4. LeaveRequest.status (+ manager step, rule step, groupId parts)
1. **State:** `LeaveRequest.status` (schema line 869). Implicit sub-states:
   - `managerApprovedAt` set with `managerApprovedById=null` means "handed on to HR by the timer" (leaveJobs.ts:63).
   - `ruleId`/`ruleStep`/`stepUserIds`/`stepDueAt` hold the rule walker's position.
   - `groupId` links parts that must move together.
   - `autoApproved` flag.
2. **Values:** PENDING, APPROVED, REJECTED, CANCELLED (OPEN = PENDING+APPROVED, leaveBalances.ts:9). History `what` codes include WITHDRAWN (leave.ts:1994), but status is never WITHDRAWN.
3. **Transitions:**
   - PENDING to APPROVED: leave.ts:1491, updateMany `status:'PENDING'`, inside peopleWrite.
   - PENDING to REJECTED: leave.ts:1503-1507, findFirst then update, inside peopleWrite (serialized, so OK).
   - Manager step: leave.ts:1553, guarded.
   - Rule step: leave.ts:888, guarded by `ruleStep`.
   - Timer hand-on: leaveJobs.ts:63, guarded by `updatedAt`.
   - Reminder: leaveJobs.ts:209/222.
   - PENDING/APPROVED to CANCELLED: leave.ts:1994 (cancelLeaveRequest; `OPEN.includes` check at :1989, update by id, inside peopleWrite). clearLeaveDays at :1296 asserts the month is open.
   - APPROVED shortened: leave.ts:2950. Later parts become CANCELLED at :2955.
   - Edit: leave.ts:2903-2909 deletes and recreates group parts.
   - Engine hooks: leaveEngine.ts:266 onApproved, :296 onClosed (re-check `lead.status==='PENDING'`).
   - Employee self-cancel: leave.ts:3399-3408. Refused once started.
4. **UI/server mismatch:** none found.
5. **Dead ends:** REJECTED and CANCELLED are terminal (intended). There is no "un-reject".
6. **Never read/written:**
   - WITHDRAWN appears only in history, never as status. Fine, but readers that filter `status === 'WITHDRAWN'` would never match.
   - Manager-step "handed on" is encoded as `managerApprovedById=null`. This boolean-as-state is easy to misread.
7. **Races:** none in this machine. All writes sit inside peopleWrite or use a conditional claim. Edit deletes and recreates rows (leave.ts:2907-2909), so row ids of later parts change. Clients holding an old part id get 404.
8. **Risk: HIGH** (leave balance and pay), but well guarded. **#228 touches routes/leave.ts. #226 touches leaveJobs.ts.**

### A5. OvertimeRequest.status (and comp-off credit)
1. **State:** `OvertimeRequest.status` (schema line 2766). There is **no value comment** in the schema. Sub-state: `managerApprovedAt`. `kind` is OVERTIME|COMP_OFF.
2. **Values:** PENDING, APPROVED, REJECTED, CANCELLED (UI tabs: apps/attendance/src/screens/OvertimeRequests.jsx:24-27).
3. **Transitions:**
   - create: selfService.ts:283. **Off the engine this is a bare create with no lock and no unique constraint.**
   - Manager step: selfService.ts:330/353, guarded.
   - PENDING to APPROVED/REJECTED: selfService.ts:385, guarded `status:'PENDING'`, inside peopleWrite.
   - Approving OVERTIME sets `AttendanceRecord.overtimeApproved=true` (:391).
   - Approving COMP_OFF creates a LeaveAdjustment (`workedOn` duplicate check at :400).
   - PENDING to CANCELLED: portal.ts:1158, guarded.
4. **UI/server mismatch:**
   - HR's direct day toggle (attendance.ts:407) and bulk approve (attendanceInsights.ts:601) set overtimeApproved without touching the request.
   - Un-approving at the day level leaves the request APPROVED.
5. **Dead ends:**
   - APPROVED has no revoke path for either kind. A comp-off credit is reversible only by hand on the adjustment.
   - **APPROVED OVERTIME becomes stuck.** `writeDay` resets `overtimeApproved:false` on any rewrite (days.ts:328): a reader punch, correction, leave or full-day fix. The request stays APPROVED. `canAskOvertime` needs `!ot` (selfService.ts:244, 262), and `ot` counts any non-CANCELLED request, so the employee can never ask again and the overtime is silently unpaid.
6. **Never read/written:** status values are undocumented in the schema.
7. **Races:**
   - Off-engine double-tap creates duplicate PENDING requests (selfService.ts:276-283; check at :279-281, create at :283, no lock).
   - Cron/recompute vs approval silently undoes approved overtime (above).
8. **Risk: HIGH** (money). **#226 (overtimePolicy, compOff) touches this. #228 touches selfService.ts.**

### A6. ShiftSwap.status
1. **State:** `ShiftSwap.status` (schema). Mirrored by an approval-engine request (`approvalRequestId`).
2. **Values:** ASKED, DECLINED, WAITING, APPROVED, REJECTED, WITHDRAWN, CANCELLED. All are written.
3. **Transitions (every one a guarded updateMany):**
   - ASKED to DECLINED: shiftSwaps.ts:291.
   - ASKED to WAITING: :298, then submitRequest and setting approvalRequestId at :309. Same transaction, inside peopleWrite.
   - ASKED to WITHDRAWN: :330.
   - WAITING to WITHDRAWN: via engine `withdraw` (:322), then onClosed at :520.
   - WAITING to REJECTED: onClosed at :520 (also the "approved but could not be applied" path, engine.ts:921-925).
   - WAITING to APPROVED: :399 (applySwap, inside peopleWrite, re-checks schedules).
   - APPROVED to CANCELLED: :419. HR only, not started, month open.
4. **UI/server mismatch:** squareUp (:438-450) shows engine-closed swaps as closed on read without writing them. This covers a failed onClosed hook. Because SHIFT_SWAP is not a `sources` type, engine.ts:102-104 only logs the error.
5. **Dead ends:** APPROVED becomes uncancellable once `fromDate <= today` (intended: "change the schedule instead"). The rest are terminal by design.
6. **Never read/written:** none.
7. **Races:** none. All claims are conditional.
8. **Risk: MED** (schedules feed attendance). Not touched by #228 (that PR touches roster/schedule, not shiftSwaps.ts).

### A7. DevicePunch.reviewStatus (+ dayPending, state)
1. **State:** `DevicePunch.reviewStatus` (schema ~1036). `state` is the reader's raw punch code ('0'..'5', '255'), data rather than a lifecycle. `dayPending` is a boolean.
2. **Values:** null (counts), PENDING (field punch), APPROVED, REJECTED, HELD (reader clock ahead, `heldReason` FUTURE).
3. **Transitions:**
   - HELD to REJECTED: punches.ts:287 and :380 (guarded).
   - HELD to null with dayPending=closed: punches.ts:298 (guarded); bulk raw SQL at :434.
   - PENDING to APPROVED/REJECTED: phonePunch.ts:225 (guarded).
   - `dayPending` true to false: punches.ts:512 on reopen.
4. **UI/server mismatch:** none seen.
5. **Dead ends:** REJECTED and APPROVED field punches are final with no undo. A wrong refusal can only be fixed by correcting the day.
6. **Never read/written:**
   - `dayPending` is set **only** by held-punch release (:298, :434), never by normal ingest (createMany at :258 omits it).
   - recomputeDeviceDay returns early for a closed month (punches.ts:84).
   - workOutPendingDays only re-works `dayPending:true` (:502).
   - So **ordinary reader punches and field-punch approvals landing in a closed month are never re-applied on reopen**, despite the schema comment and the reopen comment (attendance.ts:1473-1475). Needs a test to confirm nothing else recomputes those days.
7. **Races:**
   - decideHeldPunch (punches.ts:283-302) runs outside peopleWrite. The closed check at :296 is TOCTOU vs month close. If the month closes between :296 and :300, the punch is counted with dayPending=false and the day is never worked out.
   - writePunchDecision (phonePunch.ts:221-229): the claim and the recompute are not one transaction off the engine (attendanceInsights.ts:1109).
8. **Risk: HIGH** (attendance days that feed pay).

### A8. DeviceCommand.status
1. **State:** `DeviceCommand.status` (schema). Also `attempts`.
2. **Values:** PENDING, SENT, DONE, FAILED, CANCELLED.
3. **Transitions:**
   - PENDING to SENT: iclock.ts:424, matrix.ts:204 and :246. **findFirst then update by id, no status guard.**
   - SENT to PENDING (stale and attempts<3) and SENT to FAILED (attempts>=3): iclock.ts:343-347, guarded.
   - SENT to DONE/FAILED: iclock.ts:448 (unguarded update), matrix.ts:217/264 (findFirst `status:'SENT'`, then update).
   - FAILED to PENDING: devices.ts:625 (HR retry).
   - PENDING to CANCELLED: devices.ts:639.
   - PENDING deleted: readerSync.ts:169/322, devices.ts:449.
4. **UI/server mismatch:** UI can cancel only PENDING. SENT cannot be cancelled. Fine.
5. **Dead ends:** DONE and CANCELLED are terminal (intended).
6. **Never read/written:** none.
7. **Races:**
   - Concurrent heartbeats (reader retry, two instances) can send the same PENDING command twice and double-increment `attempts` (iclock.ts:422-424).
   - **HR cancel between findFirst and update gets overwritten: CANCELLED becomes SENT, so the command reaches the reader anyway** (iclock.ts:424 has no `status:'PENDING'` guard). Commands include user deletes and template pushes, which control reader access.
   - A late `/devicecmd` reply overwrites any status (iclock.ts:448).
8. **Risk: MED** (reader access / biometrics).

### A9. AttendanceExceptionState.status
1. **State:** `AttendanceExceptionState.status` (schema line 2626). A missing row means OPEN.
2. **Values:** OPEN, IN_PROGRESS, RESOLVED, IGNORED.
3. **Transitions:**
   - Single item: attendanceInsights.ts:369, upsert, **any to any, no from-state guard, not in peopleWrite**.
   - Bulk: :410-413, inside peopleWrite, guarded `status in from` (OPEN/IN_PROGRESS to RESOLVED/IGNORED; RESOLVED/IGNORED to OPEN).
   - Reassign on leaver: leavers.ts:55.
4. **UI/server mismatch:** the bulk path refuses to overwrite a colleague's decision; the single path silently does.
5. **Dead ends:** none. Everything is reopenable.
6. **Never read/written:** none found.
7. **Races:** single vs bulk is last-write-wins on the single path.
8. **Risk: LOW** (worklist only).

### A10. AttendanceMonthConfirmation.status
1. **State:** `AttendanceMonthConfirmation.status` (schema line 2747).
2. **Values:** CONFIRMED, DISPUTED.
3. **Transitions:**
   - Upsert either way: selfService.ts:160. Guard: `canConfirm` (month ended, before cutoff, :153).
   - No lock; a single row per person and month (unique).
4. **UI/server mismatch:** no HR action exists to resolve a dispute.
5. **Dead ends:** **DISPUTED is a stuck state.** Nothing ever sets it resolved; HR only gets a notification (:166). A dispute does not block month close: readiness/close never read confirmations (only selfService.ts:106/179 read them).
6. **Never read/written:** none.
7. **Races:** negligible.
8. **Risk: MED** (the employee's pay objection has no tracked resolution).

### A11. AttendancePenalty.status (late-mark penalty)
1. **State:** `AttendancePenalty.status` (schema line 4131). A missing row means implicit DUE.
2. **Values:** DUE (computed, not stored), WAIVED, APPLIED.
3. **Transitions:**
   - DUE to WAIVED: markRules.ts:366.
   - DUE to APPLIED: :420, with LeaveAdjustments.
   - WAIVED/APPLIED to DUE: :384 (row deleted, adjustments reversed at :382).
   - All inside peopleWrite, but **`assertMonthOpen` is called before entering it** (:358, :376, :398).
   - apply re-checks payroll per person inside (:405); waive and undo do not.
4. **UI/server mismatch:** none seen.
5. **Dead ends:** none.
6. **Never read/written:** DUE exists only in code.
7. **Races:** month close can commit between the check and the peopleWrite. Waive, undo or apply then lands in a closed month. Undo reverses leave adjustments (money/leave).
8. **Risk: HIGH** (leave and loss-of-pay days).

### A12. AbsenceCase.status (+ settlement hold flags)
1. **State:** `AbsenceCase.status`. Hold sub-machine: `heldAt` / `holdReleasedAt`.
2. **Values:** OPEN, NOTICE_1, NOTICE_2, ABSCONDED, RETURNED, EXPLAINED, IGNORED. Hold: none, HELD, RELEASED (re-holdable).
3. **Transitions:**
   - create OPEN: absconding.ts:127, inside peopleWrite.
   - OPEN to EXPLAINED (cron): :137, guarded.
   - OPEN to NOTICE_1 to NOTICE_2: :228, inside peopleWrite, unique (case, seq).
   - Rollback NOTICE_n to previous on letter failure: :247, **plain update, no status guard**.
   - Open set to RETURNED/IGNORED: :287, guarded, not in a lock.
   - NOTICE_2 to ABSCONDED: :319, guarded. Compensating revert at :324 if leaveEmployee fails.
   - Hold: :339. Release: :353. Both guarded.
4. **UI/server mismatch:** none seen (apps/people/src/time/Absences.jsx uses a `mode` state for the action dialogs).
5. **Dead ends:** ABSCONDED is terminal; rejoin happens from Leaving and the case stays ABSCONDED. RETURNED, EXPLAINED and IGNORED are terminal (intended).
6. **Never read/written:** none.
7. **Races:**
   - A case closed (RETURNED) while a notice's letter is being issued gets resurrected by the unguarded rollback at :247 if the letter fails.
   - ABSCONDED plus leaveEmployee is not atomic (:319-326). A partial leaveEmployee failure leaves the case reverted while the employee may be partly offboarded.
8. **Risk: MED** (employment status and settlement hold).

### A13. AbsenceNotice.emailStatus
1. **State:** `AbsenceNotice.emailStatus`.
2. **Values:** QUEUED, SENT, FAILED, SUPPRESSED (schema). In practice it is `sent?.status || 'QUEUED'` or FAILED (absconding.ts:260/264).
3. **Transitions:** written once (absconding.ts:268). **Never updated from the outbox**, although `emailOutboxId` is stored and the schema says "from the mail outbox".
4. **UI/server mismatch:** the UI shows ", queued" forever (apps/people/src/time/Absences.jsx:179).
5. **Dead ends:** QUEUED is a stuck state.
6. **Never read/written:** SENT/SUPPRESSED are likely never written here.
7. **Races:** none.
8. **Risk: LOW-MED** (delivery evidence for an absconding finding).

### A14. NightWorkConsent.status
1. **State:** append-only log; the latest row by createdAt is current (nightConsent.ts:37).
2. **Values:** GIVEN, WITHDRAWN.
3. **Transitions:** create (nightConsent.ts:144), inside peopleWrite. A same-status write is refused unless a file is attached (:136).
4. **UI/server mismatch:** none (the NightWork.jsx toggle offers the opposite status).
5. **Dead ends:** none.
6. **Never read/written:** none.
7. **Races:** none.
8. **Risk: MED** (legal compliance). Withdrawal only notifies HR (:149). Night schedules and swaps already approved stay in place; the checks run only on new approvals (requests.ts:556, shiftSwaps nightCheck).

### A15. ReaderEvent.outcome
1. **State:** `ReaderEvent.outcome`, written once (punches.ts:173).
2. **Values:** NEW, REJECTED, IGNORED, and **HELD** (punches.ts:243). The schema comment omits HELD.
3. **Transitions:** none (immutable evidence).
4. **UI/server mismatch:**
   - The devices.ts:1015 filter accepts only NEW/REJECTED/IGNORED, so HELD cannot be filtered.
   - The UI OUTCOME map (apps/attendance/src/components/ReaderEvidence.jsx:12) has no HELD label; the raw value shows (:72) and there is no tab (:61).
5. **Dead ends:** none.
6. **Never read/written:** HELD is written but not filterable.
7. **Races:** none.
8. **Risk: LOW.**

### A16. AttendanceFullDayReview (outcome / settledAs)
1. **State:** `outcome`, plus `settledAs`/`settledAt`. A sentinel row with outcome SCANNED and recordId `SCANNED:<orgId>` lives in the same table (fullDayFix.ts:372).
2. **Values:** outcome CORRECTED, HELD, SCANNED (undocumented). reason MONTH_CLOSED, PAYROLL_TAKEN, PAYROLL_PENDING, BEFORE_PAYROLL, OLD. settledAs PAID, RECORD_CHANGED.
3. **Transitions:**
   - Upsert CORRECTED: :272, inside peopleWrite.
   - Upsert HELD: :365, outside the lock.
   - HELD (unsettled) to RECORD_CHANGED: :348, **no `settledAt:null` guard**.
   - HELD to PAID: :405, guarded.
   - PAID to unsettled: :414, guarded.
4. **UI/server mismatch:** none seen.
5. **Dead ends:** RECORD_CHANGED is terminal; CORRECTED is terminal.
6. **Never read/written:** SCANNED is undocumented in the schema.
7. **Races:** the daily job reads openHeld, HR marks PAID, then the job's updateMany at :348 overwrites PAID with RECORD_CHANGED, losing the payment mark. Narrow window.
8. **Risk: MED** (records that money was paid). **#228 touches fullDayFix.ts.**

### A17. LeaveYearEnd (ran / undone) and LeaveAdjustment.reversedAt
1. **State:** `undoneAt` null/non-null. Adjustments use `reversedAt` and `paidInRunId`.
2. **Values:** RAN, UNDONE.
3. **Transitions:**
   - Run: leave.ts:3266, inside peopleWrite, refused if an un-undone run exists.
   - Undo: :3297, inside peopleWrite, refused if `paidInRunId` is set or Payroll has listed the adjustment.
4. **UI/server mismatch:** none seen.
5. **Dead ends:** UNDONE is terminal per row; a new run gets a new row.
6. **Never read/written:** none.
7. **Races:** the Payroll check (:3289) reads another database, not under the People lock. Payroll can list the encashment between the check and the reversal.
8. **Risk: MED** (encashment money).

### A18. Comp-off
No separate model on main. It is OvertimeRequest(kind COMP_OFF) plus a LeaveAdjustment with `workedOn`. There is no expiry; PR #226 adds compOff.ts with expiry. See machine 5.

### React UI machines (brief)
- **apps/attendance/src/portal/EmployeePortal.jsx:238** `mode` 'signin'…: the portal auth flow.
- **apps/attendance/src/screens/OvertimeRequests.jsx:49** `status` tab. The decide buttons show only on PENDING (:144-170). Server-side claims back it up.
- **apps/people/src/time/Absences.jsx:115** `mode`: which case action dialog is open (notice, close, absconded, hold).
- **apps/people/src/time/NightWork.jsx:96**: the consent dialog defaults to the opposite of the current status.
- **apps/attendance/src/components/ReaderEvidence.jsx:22** `outcome` filter (missing HELD).
- **apps/attendance/src/screens/AttendanceSetup.jsx:19** `steps`: the setup checklist.

None of these offer a transition the server lacks; the server re-checks each one.

---

# Part 5. Payroll and Books (other developer: listed only, no proposals)


Paths are relative to `server/src/` unless they start with `prisma/`. Guard types:
- **CAS**: atomic `updateMany` with the status in `where`
- **C-t-A**: check, then act (read the status, then an unguarded `update`)
- **none**: no guard

Books/Accounting and Payroll belong to the other developer. This lists findings only and proposes no fixes. Open PR #126 moves loans, revisions and settlements onto the People approvals engine. Open PR #134 (payroll cockpit) reads run, payment and posting status. Neither is merged, so both are reviewed as they stand on main.

---

### PAYROLL

#### PayrollRun.status: HIGH
- **Values:** DRAFT, CALCULATED, REVIEW, APPROVED, LOCKED, PAID, POSTED, CANCELLED. EDITABLE = DRAFT/CALCULATED/REVIEW (`routes/payrollRuns.ts:53`).
- **Calculate** (DRAFT/CALCULATED/REVIEW → CALCULATED): CAS fence plus a lease token (`services/payroll/run.ts:2066-2067`). Final write at `run.ts:2232`, inside the same transaction.
- **Generic `transition()`:** CAS `updateMany` on status `in from`, plus `calculatedAt` for REVIEW/APPROVED (`payrollRuns.ts:988-992`). The edges are:
  - submit-review: CALCULATED → REVIEW (`:1021`)
  - approve: REVIEW → APPROVED, with step-up (`:1022`)
  - reject: REVIEW → CALCULATED (`:1023-1035`)
  - lock: APPROVED → LOCKED (`:1036`)
- **Cancel:** CAS from the status it read, under a lease check and the payment advisory lock (`payrollRuns.ts:1124`). It refuses PAID, POSTED and LOCKED (`:1049-1059`) and refuses while a posting is POSTING/POSTED (`:1104`).
- **→ POSTED:** CAS from APPROVED/LOCKED/PAID, in the posting transaction (`services/payroll/posting.ts:525`).
- **→ PAID:** CAS from APPROVED/LOCKED only, outside any transaction (`services/payroll/payment.ts:681`).
- **Gap: PAID is unreachable in practice.** Payment posting needs the run's PayrollPosting to be POSTED (`payment.ts:553`). That sets the run to POSTED (`posting.ts:525`), so the PAID update at `:681` never matches. Fully paid runs read POSTED for ever. Every `['APPROVED','LOCKED','PAID','POSTED']` filter still works, but "paid" and "in the books" are folded into one field, and the cockpit (#134) cannot tell them apart from status alone.
- **Gap: POSTED and LOCKED are terminal.** No payroll-journal reversal path exists. The cancel message at `payrollRuns.ts:1105` says "Reverse it rather than cancelling it", but no payroll route reverses a posting.
- **Gap: the "one run per period" check at create is C-t-A** (`payrollRuns.ts:262-275`). It relies on `@@unique([orgId, periodId, payGroupId, branchId])` (`prisma/payroll/schema.prisma:677`), and both of those columns can be null. Unless a migration uses NULLS NOT DISTINCT (none found by grep), two runs with null group/branch can coexist. This is not checked against the migration SQL.

#### SalarySlip.status / paymentStatus: MED
- **status:** always written as CALCULATED (`run.ts:1917`). Cancel deletes the slips (`payrollRuns.ts:1119-1121`). Queries for slip status APPROVED/LOCKED/PAID (`routes/payrollSlips.ts:269`) and `not 'CANCELLED'` (`run.ts:240`, `456`) read values that are never written. It is a dead field: the slip has no lifecycle of its own and takes the run's.
- **paymentStatus:** UNPAID/PAID/FAILED. Derived from the payment line inside settleLines, under the advisory lock (`payment.ts:494-496`). Reset to UNPAID on payment cancel unless PAID (`payment.ts:720-722`). Consistent.

#### PayrollPayment.status + postingStatus: HIGH
- **status:** DRAFT, PROCESSING, PARTIAL, FAILED, COMPLETED, CANCELLED. It is derived from the lines (`payment.ts:466-474`) and written with CAS `not CANCELLED` (`:476-485`). Cancel is CAS on `postingStatus: 'UNPOSTED'` under the advisory lock (`:716-717`).
- **Create:** C-t-A guarded by an advisory lock, a re-check and a partial unique index on live lines (`payment.ts:244-251`). Good.
- **postingStatus:** UNPOSTED → POSTING via CAS (`payment.ts:635-638`), then a journal write (`:649`), then a plain update to POSTED (`:667-670`).
- **Gap: POSTING is a dead end.** If `postJournalEntry` throws, or the process dies before writing, postingStatus stays POSTING with no orphan journal. Every retry then throws POSTING_IN_PROGRESS (`:630-632`). Nothing in code resets it to UNPOSTED, and there is no stale-claim takeover (run posting has one; this does not). Settle and cancel both refuse while it is not UNPOSTED/POSTED (`:432`, `:705`). Salary money is stuck as unbooked with no way out except database surgery.
- **Gap: payment numbers are `count+1`** (`payment.ts:252`) under a per-run lock. Two runs paying at once collide on `@@unique([orgId, number])` (`schema.prisma:1131`), which surfaces as a generic error (the P2002 catch only matches the live-slip index). LOW.

#### PayrollPaymentLine.status: MED
- **Values:** PENDING, PAID, FAILED, CANCELLED. Set by settleLines with CAS `not CANCELLED` (`payment.ts:451-460`), and by cancel PENDING → CANCELLED (`:719`).
- **Gap:** settleLines accepts any target from any non-cancelled state, PAID → PENDING/FAILED included (`routes/payrollPayments.ts:241`). A line already paid at the bank can be un-paid until the payment is posted. That is intentional for corrections, but no audit or step-up was seen on that edge.

#### PayrollPosting.status: HIGH (double journal)
- **Values:** DRAFT, POSTING, POSTED. Claimed by insert, then P2002 handling (`posting.ts:399-408`). Takeover is CAS on `DRAFT` or `POSTING` older than 2 minutes (`posting.ts:369`, `421-426`).
- Run still approved: re-checked under the lock (`:448-453`). Orphan check (`:462`), then `postJournalEntry` (`:473`), then POSTED in a transaction (`:494-525`).
- **Gap: stale takeover can double-post.** An attempt that is slow rather than dead, still posting after 2 minutes, loses its claim. The second caller finds no orphan, because the first has not committed, and writes a second journal. JournalEntry has only an `@@index` on `sourceDocType/sourceDocId`, not a unique (`prisma/schema.prisma`, JournalEntry model). Unlikely, but it is money.
- **Gap: POSTED is terminal,** with no reversal (see PayrollRun).

#### FinalSettlement.status: HIGH
- **Values:** DRAFT, APPROVED, PAID, CANCELLED.
  - approve: DRAFT → APPROVED, CAS (`routes/payrollSettlements.ts:327-329`)
  - mark paid: APPROVED → PAID, CAS (`:383`), then `sourcesClosedAt` (`:409`)
- **Gap: cancel is C-t-A with a plain `update`** (`:465-468`). If mark-paid commits between cancel's read (APPROVED) and its write, a PAID settlement becomes CANCELLED. Money has gone, but the record says cancelled, and the loan installments it SETTLED (`services/payroll/finalSettlementSources.ts:362`) stay settled.
- **Gap: create is C-t-A** ("one non-cancelled per employee", `:208`) with no unique in the schema, so a double-submit can create two drafts. LOW.
- #126 moves approval onto the People engine. These edges will change.

#### PayrollLoan.status / PayrollLoanInstallment.status: LOW
- **Loan:** DRAFT, ACTIVE, COMPLETED, CANCELLED.
  - approve: DRAFT → ACTIVE, CAS (`services/payroll/loan.ts:159-162`)
  - cancel: CAS (`routes/payrollLoans.ts:433`)
  - re-derived from installments (`run.ts:1566`, `payrollLoans.ts:384`)
  - edit is C-t-A (`payrollLoans.ts:283`, `:296`)
- **Installment:** PENDING, RECOVERED, SKIPPED, WAIVED, SETTLED.
  - RECOVERED: CAS in calculate (`run.ts:2106-2126`)
  - undone on cancel or recalc (`payrollRuns.ts:1115`, `run.ts:2216-2218`)
  - skip/waive/restore: CAS (`payrollLoans.ts:371`)
  - SETTLED: written only by final settlement (`finalSettlementSources.ts:362`), read in `loan.ts:299`
- **Gap:** restoring from SETTLED is not blocked the way RECOVERED is (`payrollLoans.ts:353`). A settled installment can be restored to PENDING and taken again from a payslip. Not traced further.
- #126 pending.

#### SalaryRevision.status: MED
- **Values:** DRAFT, REVIEWED, APPROVED, REJECTED, APPLIED.
- **Transitions:** CAS via `transition()` (`routes/payrollRevisions.ts:379`):
  - DRAFT → REVIEWED (`:386`)
  - REVIEWED → APPROVED (`:387`)
  - DRAFT/REVIEWED/APPROVED → REJECTED (`:388-394`)
- **Apply:** C-t-A. It checks APPROVED (`services/payroll/revision.ts:270-273`), then a plain `update` to APPLIED inside the transaction (`:351-353`).
- **Gap: reject vs apply race.** A reject that commits between apply's read and its write gets overwritten to APPLIED, and pay changes on a rejected revision. A double apply is stopped by `@@unique([orgId, employeeId, effectiveFrom])` on the assignment (`schema.prisma:497`).
- #126 pending.

#### SalaryAssignment.status: LOW
- **Values:** ACTIVE, SUPERSEDED, CANCELLED.
  - superseded by a new assignment or revision (`routes/payrollAssignments.ts:213-215`, `revision.ts:325-327`)
  - re-activated on delete (`payrollAssignments.ts:336-339`)
- **Gap:** CANCELLED is read (`run.ts:1515`, `payrollAssignments.ts:373`). A writer was not found in the files read.

#### PayrollAdjustment.status: LOW
- **Values:** DRAFT, APPROVED, CONSUMED, CANCELLED.
  - approve: CAS `notIn CONSUMED/CANCELLED` (`routes/payrollAdjustments.ts:365-367`)
  - cancel: CAS on status plus amount (`:398`, `:405`)
  - consumed/released by calculate (`run.ts:2191-2201`) and run cancel (`payrollRuns.ts:1116`)
- Well guarded.

#### BankDetailChange.status: MED
- **Values:** PENDING, APPROVED, REJECTED, CANCELLED.
  - new change cancels older pending ones (`services/payroll/bankChanges.ts:80-82`)
  - approve: CAS claim (`:130`), then the profile update outside any transaction (`:132`)
- **Gap: reject is C-t-A with a plain `update`** (`:139-142`). If an approve commits in between, the record is overwritten to REJECTED while the profile already holds the new account number, so salary goes to an account the record says was rejected.
- **Gap:** the approve claim and the profile update are not atomic. A crash between them leaves APPROVED with the old account in use.

#### TaxDeclaration.status: LOW
- **Values:** DRAFT, SUBMITTED, VERIFIED (CANCELLED is not seen).
  - submit (`services/payroll/taxDeclaration.ts:262`)
  - verify: CAS `not VERIFIED` (`routes/payrollTaxDeclarations.ts:436`)
  - reopen: VERIFIED → SUBMITTED, C-t-A plain update (`:456-465`)
- Low money risk.

#### PayrollPeriod.status + isLocked: MED
- **Values:** status OPEN/CLOSED, always written together with isLocked (`routes/payrollPeriods.ts:283-285`). Two fields carry one bit, and only isLocked is read.
- **Gap: lock is C-t-A.** "No open runs" is checked (`:247-258`), then a plain update. Run create checks `isLocked` C-t-A too (`payrollRuns.ts:259`). A run created or recalculated at the moment of locking can be stranded, which is exactly what the comment at `:248` says it prevents.

#### StatutoryRule.status: LOW
- **Values:** DRAFT (seed offer), ACTIVE, SUPERSEDED, WITHDRAWN.
- **Transitions:** inside transactions, but plain updates (`routes/payrollStatutory.ts:304-305`, `:382-383`, `:525`). The adopt check is C-t-A (`:368`).

#### PayrollRunEmployee.state: LOW
- **Values:** PENDING, READY, WARNING, ERROR, CALCULATED.
  - written at `payrollRuns.ts:318`, `:356`, `:684-694`, `run.ts:2227`
  - read only for display (`payrollRuns.ts:197`)
- **Gap:** ERROR does not gate approve (approve recomputes issues), so the stored state is informational.

#### EmployeePayrollProfile.payrollStatus: LOW
- **Values:** IN_PAYROLL, EXCLUDED, ON_HOLD (`services/payroll/eligibility.ts:106`). Read at `run.ts:105` and `:1190`.
- No code writes it except sample data and the profile form, so there is no machine. ON_HOLD and EXCLUDED behave the same (both excluded).

#### SalaryStructure.status: LOW
- **Values:** DRAFT, ACTIVE, ARCHIVED. ARCHIVED is checked at assign/revise (`payrollAssignments.ts:166`, `payrollRevisions.ts:234`). Written at `routes/payrollStructures.ts:307`; not inspected further.

---

### BOOKS (listed only, other developer, no proposals)

| Machine | Values | Transitions (file:line, guard) | Gaps | Risk |
|---|---|---|---|---|
| Invoice.status | Free string: Draft, Pending Approval, Sent, Paid, Partially Paid, Unpaid, Overdue, Cancelled | Create takes `body.status` (`routes/invoices.ts:457`). `Pending Approval` (`:492`). The PATCH status route sets any string plus a client `paidAmount` (`:776-780`, C-t-A). Settlement derives Paid/Partially Paid/Unpaid (`services/settlement.ts:80-96`, `:148`). | (1) The client can set Paid and an arbitrary paidAmount with no receipt (`:779`). (2) Cancel reverses `status:'POSTED'` entries by source (`:748-768`), and that query also matches contras (the warning in `services/postingState.ts:8-16`). Cancel, then reinstate (which never re-posts), then cancel again reverses the contra and puts the revenue back while the invoice reads Cancelled. (3) Mixed case ("Draft" here, UPPER elsewhere) is compared lowercased. | HIGH |
| Invoice.irnStatus | REGISTERED, FAILED, CANCELLED | `routes/einvoice.ts:172`, `:181`, `:259`. Generate check is C-t-A (`:159`). | Independent of invoice.status: cancelling the invoice (`invoices.ts`) never looks at the IRN, and cancelling the IRN does not cancel the invoice. A concurrent generate calls NIC twice. | MED |
| EInvoiceSetting.mode | SANDBOX, PRODUCTION | settings write (`services/einvoice.ts:91`) | Config, not a lifecycle | LOW |
| Payment.status | POSTED, REVERSED | reverse: C-t-A (`routes/payments.ts:453`). Journal reversal (`:455-461`) runs outside the status transaction (`:466-470`). | Reversal is idempotent per entry (`reversesId @unique`, `services/ledger.ts:552-553`). A crash between the journal reversal and the status write leaves POSTED with a reversed journal. A PaymentRequest that is PAID stays PAID after its receipt is reversed. | MED |
| JournalEntry.status | DRAFT, POSTED, REVERSED | `reverseEntry` (`services/ledger.ts:552-553`) | Contra rows are POSTED and share the original's source. Callers that filter on `status:'POSTED'` (`invoices.ts:748`, `payments.ts:456`, `purchaseDocs.ts:611`) differ from `livePostingsFor`. | MED |
| FiscalYear.status + lockedThrough | OPEN, CLOSED | CLOSED is read (`services/ledger.ts:391`). No writer of CLOSED was found. lockedThrough is updated at `routes/ledger.ts:458`. | CLOSED is a dead value. The period-lock update does not take the posting's advisory lock (`ledger.ts:386`), so a posting that passed the lock check can commit after a lock is set. | MED |
| ApprovalRequest (books) | PENDING, APPROVED, REJECTED | CAS claim (`services/approvals.ts:146-155`). `reopen` CAS APPROVED → PENDING (`:161-164`). | OK | LOW |
| InterBranchTransfer.status | DRAFT, SENT, RECEIVED, REJECTED | send: C-t-A (`routes/transfers.ts:129` → `:162`). receive: C-t-A (`:189` → `:219`). reject from DRAFT or SENT (`:245` → `:252`). | The status check sits outside the transaction, so a double send or double receive moves stock twice. Reject from SENT does not return stock to the source, so stock is lost in transit. | HIGH |
| PaymentRequest.status | PENDING, CLAIMED, PAID, CANCELLED, EXPIRED | CLAIMED: CAS (`routes/payRequests.ts:267`). confirm → PAID: C-t-A (`:164-174`). cancel: C-t-A (`:183-186`). expire: lazy (`:206-207`). | Cancel can overwrite PAID in a race. Confirm is allowed from EXPIRED. "One receipt per request" is C-t-A (`:173`). | MED |
| ImportBatch / ImportRow | STAGED, VALIDATED, COMMITTED, FAILED / PENDING, VALID, ERROR, COMMITTED, SKIPPED | validate (`routes/imports.ts:329`). commit only refuses STAGED (`:363`). Rows → COMMITTED (`:405`, `:501`, `:586`). Batch → COMMITTED or FAILED (`:601-604`). | No claim on commit: two concurrent commits both read the VALID rows and create the documents twice. SKIPPED is never written. FAILED can be re-committed. | MED |
| SerialNumber.status | IN_STOCK, SOLD, SCRAPPED | issue: C-t-A (`routes/batchSerial.ts:289`), then `updateMany` without a status guard (`:296-299`) | Double-sell race. No path back to IN_STOCK (invoice cancel or return). | MED |
| Bill.status | Free string; settlement derived | `services/settlement.ts:150`. Create defaults to 'Unpaid' (`routes/purchaseDocs.ts:335`). Cancel (`:620`). | Same POSTED-query contra issue (`purchaseDocs.ts:611`) | MED |
| Estimate / SalesOrderDoc / DeliveryChallan / PurchaseOrderDoc / CreditNote / DebitNote / Expense / StockDocument | Free strings (Draft, Open, …) | Body-supplied (`routes/quoteDocs.ts:221`, `:249`; `stockDocuments.ts:42`, `:195`) | No machine: any string, no transition rules | LOW |
| FixedAsset.status | ACTIVE, … | `routes/orgMasters.ts:200` (not inspected) | n/a | LOW |

---

### Top 5 risks
1. **PayrollPayment.postingStatus can stick at POSTING for good.** No recovery exists, so salary payments stay unbooked and cannot be cancelled. `services/payroll/payment.ts:630-649`
2. **Payroll posting's 2-minute stale takeover can write a second salary journal.** JournalEntry has no unique on its source. `services/payroll/posting.ts:369`, `:421-426`, `:473`
3. **A PAID final settlement can be flipped to CANCELLED.** Cancel is an unguarded update. `routes/payrollSettlements.ts:465-468` vs `:383`
4. **Run PAID is unreachable and POSTED/LOCKED are terminal with no reversal.** Paid and posted share one field. `payment.ts:553`, `:681`; `posting.ts:525`; `routes/payrollRuns.ts:1105`
5. **Approve vs reject races on money edges.**
   - Revision apply overwrites a concurrent reject (`services/payroll/revision.ts:273`, `:351`).
   - Bank-change reject overwrites an approve (`services/payroll/bankChanges.ts:139-142`).
   - Books (other developer): invoice cancel → reinstate → cancel reverses the contra (`routes/invoices.ts:748-768`), and transfer reject after SENT loses stock (`routes/transfers.ts:245-252`).

---

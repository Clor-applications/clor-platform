# GAP-010 — links between the four databases (inventory, 2026-10-24)

Read from the four Prisma schemas and the code that writes each column. Tenant columns
(accountId/orgId/branchId, ~48+57+34 user-id columns) are not listed: platform users are
deactivated, never deleted (no `user.delete`; SCIM sets isActive=false).

| Source → target | Written at | Before Batch 11 | Batch 11 |
|---|---|---|---|
| payroll.*.employeeId (history, profile, statutory, component) → people.Employee | payroll routes; `forLiveEmployee` lock | delete refused while payroll history exists (`employeeLock.ts`) | checker reports profiles whose employee is gone |
| payroll.PayrollPosting / PayrollPayment.journalEntryId → accounting.JournalEntry | `posting.ts:473`, `payment.ts:572` via the accounting client | an accountant could reverse the entry in Accounting; Payroll still said POSTED | **reverse refused** for PAYROLL_RUN / PAYROLL_PAYMENT sources (409 POSTED_BY_PAYROLL); checker reports postings whose entry is gone or not posted |
| accounting.JournalEntry.sourceDocType/Id → payroll run/payment | `client.ts:238` | idempotency key (adopted on retry) | unchanged |
| payroll.SalaryComponent.expense/liabilityLedgerId → accounting.LedgerAccount | `payrollComponents.ts:282/381` | checked only on one path | checker reports missing or inactive ledgers |
| payroll.{Profile, SalaryAssignment, SlipLine, PostingLine}.costCenterId → accounting.OrgMaster(COST_CENTER) | `payrollAssignments.ts:221/283`, `payrollEmployees.ts:71` | `orgMasters.ts` hard-deleted it ("nothing points at one of these by id" — untrue) | **delete refused** while payroll uses it (409 USED_BY_PAYROLL); checker reports |
| payroll.PayrollPeriod.fiscalYearId → accounting.FiscalYear | `payrollPeriods.ts` | no delete path | unchanged |
| people.LeaveAdjustment.paidInRunId → payroll.PayrollRun | `run.ts:1194` | runs never deleted | checker reports |
| people.Employee.userId → platform.User | `days.ts:211` | users never deleted | unchanged |
| people.SiteAgent.scimTokenId → platform.ScimToken | `agent.ts:210` | token revoked with the agent | unchanged |
| platform.Credential.ownerId → people/accounting/platform owner | `credentials.ts` | agent delete revoked; **reader delete did not** (nightly sweep only) | **reader delete revokes at once**; checker repairs (revokes) any other |
| platform.UserWarehouseAccess.warehouseId → accounting.Warehouse | `users.ts:966`, `auth.ts:883` | checked on grant; **left behind on warehouse delete** | **removed on delete**; checker repairs |
| accounting.ApprovalRule.approverRoleId → platform.Role | `governance.ts:336` | checked; role delete counts rules | unchanged |
| platform.UserPermission.entityId → accounting.Party / OrgMaster | `governance.ts:533` | **not checked**; left behind on delete (enforced by `allowsEntity`) | **grant refused** unless the customer/vendor/cost centre is this company's; **removed on delete**; checker repairs |
| platform.AuditLog.entityId → any | `auditTrail.ts` | history, by design | unchanged |
| platform.EmailOutbox.relatedId → user / breach / portal | `mailer.ts:224` | history | unchanged |

Writes that are two stores in a row, not one transaction (payroll creates the people employee,
then the profile — `payrollEmployees.ts:260/280`; payroll delete deletes the people row on another
client): left as they are; a crash between them is what the nightly check reports.

Outboxes today: HrOutbox (outside HR tools), EmailOutbox, WebhookDelivery. None between People,
Payroll and Accounting: those calls are synchronous and keyed (sourceDocType, sourceDocId).

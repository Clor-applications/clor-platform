# WF-11 — Authorization, privacy, audit and product integration

## Server authorization chain
`Authenticate → Resolve Account + Org from trusted session/membership → Verify People subscription/entitlement → Verify named app grant → Authorize action → Apply company/branch/team/employee/field scope → Enforce approval workflow → Perform + Audit`.

UI hiding a menu is not authorization. Every read/list/count/search/export/background job/attachment fetch/event lookup has its own effective guard. Admin of another product ≠ People administrator. A company's owner ≠ automatic employee medical/bank record viewer. CA firm staff may only see client company records via approved delegated grants.

## Proposed permission capabilities (map to existing permission catalog)
| Capability | Example policy names (illustrative) | Scope |
|---|---|---|
| directory read | `people.employee.list/read` | selected company and granted employee scope |
| employee create/edit | `people.employee.create/update` | company + allowed fields |
| personal restricted view | `people.employee.sensitive.read` | per classification and explicit need |
| document upload/download | `people.employee.document.write/read` | document type, employee, company |
| employment change | `people.employee.change.submit/approve` | workflow context and separation of duties |
| archive/reactivate | `people.employee.archive` | guarded high-risk permission |
| import/export | `people.employee.import/export` | row and field scope, job/grant expiry |
| audit read/export | `people.audit.read/export` | record event and per-field redaction |
| saved shared view | `people.directory.view.share` | view ACL, org scope |

## Roles (sample UX personas, not automatic backend role creation)
People Admin, HR Operator, Manager, Employee Self-Service, Auditor (read-only limited scope), delegated CA staff with explicit per-client People grant. Role names alone never grant access; use actual scoped permission assignments. People supports no-login employees; self-service is separately authenticated/linked.

## Security negative testing
- User A for Account 1 cannot see Account 2 through guessed employee ID, company switch query or export job ID.
- One account with Company A and B: HR with only A cannot list or download B records.
- Manager without sensitive read cannot view old/new values in audit diff, export, or preloaded JSON.
- Unsubscribed People account cannot invoke People route even if hidden button is pasted into API.
- CA firm Books-only delegate cannot view People employee records for client.
- Revoke membership/role in another session invalidates list/profile/document/signed URL access appropriately.
- Untrusted background job/company parameter must not bypass RLS; any privileged maintenance path is separately audited.

## Document privacy
Use R2 through authorized API and short-lived signed requests; private object keys tenant-bound. Storage upload validates MIME/signature/file size, scan strategy and access classification; never create public object URLs for PII. Download URL expiry, revocation and logging required. Existing `Employee.devicePassword`/portal secrets must never be displayed/exported/audited in cleartext.

## Cross-app integration
Workforce UI owns HR employee detail, People employment event and manager structure. Attendance owns raw punches and device interactions; Payroll owns salary and final calculations. If app not subscribed, show `Connect Attendance` / `Requires Payroll` only through authorized product upgrade/deep link, without fake absence values. Never cross-join other product DB tables in UI; route through authorized APIs/events with versioning. Preserve employee IDs, avoid moving Attendance tables merely for conceptual diagram purity.

## Privacy/compliance note
Data minimization, purpose-limited collection, role-based retention, consent/notice workflow, export and audit redaction are mandatory design concerns. Statutory and DPDP conformity require a separate current legal review; this spec is not legal certification.

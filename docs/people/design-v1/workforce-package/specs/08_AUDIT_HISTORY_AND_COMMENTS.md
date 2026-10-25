# WF-08 — ERPNext-style record audit, activity, comments

## Goal
Record-level **Activity & Audit Trail** like a modern ERP document timeline, backed by immutable server events and scoped audit service; not created by comparing unsaved frontend objects. Workplace operations must remain explainable with effective vs recorded time.

## Canonical event proposal (map onto existing AuditLog / EmploymentEvent)
```json
{
  "eventId":"uuid",
  "accountId":"server-verified",
  "orgId":"server-verified-legal-company",
  "product":"people",
  "objectType":"employee",
  "objectId":"stable-current-employee-id",
  "eventType":"employee.designation.changed",
  "actor":{"kind":"user|system|service","id":"principal-id","displayName":"safe-label"},
  "recordedAt":"ISO-8601 UTC timestamp",
  "effectiveDate":"YYYY-MM-DD (if business event)",
  "correlationId":"request-or-workflow-id",
  "batchId":"optional",
  "status":"applied|proposed|approved|rejected|failed",
  "reason":"safe-note-or-redacted",
  "changes":[{"field":"designationId","from":"safe-name-or-mask","to":"safe-name-or-mask"}],
  "metadata":{"source":"ui|import|worker|integration","version":1}
}
```
**Illustrative envelope only; do not create competing tables or copy raw PII into metadata.** Use existing actor/ID/status schema if present, with ADR for missing fields.

## Timeline UI
Record tab `Activity` with tabs/filters `All activity`, `Field changes`, `Approvals`, `Documents`, `Comments`, actor/date. Each event shows icon, action, named authorized actor, local display time with full timestamp tooltip, effective date when different, expandable before→after diff, reason, related workflow, actor/source. Infinite pagination only if stable cursor and focus preserved. Comments have their own visual tone, edit/delete policy, and must not be editable audit system events.

## Difference from Employment History
**History** = semantic employment snapshots as-of date (designation/manager/department/status); **Activity** = who did what, when and via which workflow including rejected actions, exports, and reads only where policy requires. Do not treat comment or failed request as an effective employment change.

## Integrity and privacy
- Events are written server-side within transaction or durable outbox; ensure created/updated record is not committed without corresponding required audit evidence.
- No normal user can delete/rewrite system events. A legal privacy redaction may hide content while preserving system evidentiary metadata under approved retention policy.
- Field-level privacy permissions apply to past and current values. No raw ID docs, bank details, passwords, portal PINs, personal address or email in unrestricted diff, log, notification, support trace, or export.
- Deleted/revoked employee record URL must not reveal an otherwise hidden audit entry; export guard rechecks entitlement at download.
- Import/bulk operations correlate batch IDs and exact target records; event deduplication prevents retry spam.
- UTC storage; local display and original timezone; dates never inferred from naive local times.
- Audit retention and DPDP mapping require counsel/policy approval, not implied certification.

## High-value tests
A1: create/edit/transfer/approval leaves expected event in timeline. A2: same request replay does not duplicate event. A3: viewing with lower permission masks both before and after. A4: actor becomes inactive: historic display remains stable without granting access. A5: unrelated company cannot retrieve event via guessed event ID. A6: no timeline entry when transaction rolled back; failed attempt logged through applicable security audit instead. A7: comments do not rewrite system event. A8: backdated event shows recorded/effective separately.

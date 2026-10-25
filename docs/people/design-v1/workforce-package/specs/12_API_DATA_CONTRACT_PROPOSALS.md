# WF-12 — API/UI contracts to reconcile (NOT confirmed endpoints)

All paths below are **interface sketches**. Agent must map to existing People router names, `Org`/Account context resolver, Prisma models, field-permission service and versioning scheme. DO NOT generate duplicate endpoints just because a path appears here.

| UI operation | Suggested contract shape | Guard + behavior |
|---|---|---|
| Directory list | `GET /people/employees?search&cursor&sort&filters` | authorized rows, permitted columns and count; no client scope trust |
| Directory statistics | `GET /people/employees/summary` | as-of timestamp, count definition, scope parity |
| Filter options | `GET /people/employees/filters` | only company-valid and role-visible values |
| Create | `POST /people/employees` | schema validation, server ID, idempotency, atomic audit |
| Profile | `GET /people/employees/:id` | field redaction, ETag/version, current episode |
| Edit | `PATCH /people/employees/:id` | version/If-Match, per-field authz, audit |
| Employment history | `GET /people/employees/:id/employment-events` | effective timeline, scoped pagination |
| Activity events | `GET /people/employees/:id/audit` | redaction and actor access; stable cursor |
| Employment change | `POST /people/employees/:id/changes` | workflow/approval checks and source version |
| Import dry run | `POST /people/employees/import/validate` | no writes, scoped field mapping |
| Import commit | `POST /people/employees/import` | resumable background job, idempotency |
| Export | `POST /people/employees/export` | async authorized job, secure download |
| Bulk operation | `POST /people/employees/bulk` | per-record authz + partial-result report |
| Documents | existing People document endpoints | object ACL and signed expiring access |

## Responses / error envelope proposal
```json
{
  "data": { "id": "stable-employee-id", "version": 12 },
  "meta": { "companyId": "server-resolved-company", "asOf": "UTC" },
  "error": null
}
```
Errors must include machine code (`VALIDATION`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMIT`, `UNAVAILABLE`), safe message, optional `fieldErrors`, optional support `traceId`, no raw SQL stack or tenant-private info. Reuse existing API envelope in source over this sketch.

## Concurrency and idempotency
Mutating requests should accept expected version or `If-Match`; 409 on mismatch with accessible resolution. Creation/import/bulk should use an idempotency mechanism or dedupe ledger. Make `Save` disable during in-flight request, but never rely on UI-only duplicate prevention.

## Data model facts to recheck
Source audit saw People `Employee`, `Department`, `JobPosition`, `EmployeeType`, `EmployeeDocument`, `EmploymentEvent`, `PeopleRecord`, `BusinessUnit`, `Grade`, `CostCenter`, `EmployeeNote`. Do not assume new Worker/Employment tables already exist. If schema normalization is approved, use backward-compatible mapping and preserve all existing payroll/attendance references.

## Testing fixtures
Two accounts; 2 companies in one account; employee without user; employee rehire; duplicate company employee number; manager chain cycle; private identity document; HR operator and manager partial access; CA delegated user with Books-only; queued and rejected employment operation; old payroll snapshot; document expired URL; concurrent profile writes; 500-employee import with bad rows.

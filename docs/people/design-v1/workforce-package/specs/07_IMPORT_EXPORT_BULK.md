# WF-07 — Import, export, bulk operations

## Import wizard screens
1. **Upload:** dropzone + browse, CSV/XLSX types only if supported; template download, file size and privacy warning.
2. **Map columns:** preview first N rows and source→target mapping. Required fields prominent; users can `Ignore column`. No guessing hidden data types without review.
3. **Validate:** server-side dry run; duplicated employee number, missing manager, invalid dates, unauthorized columns, invalid company/branch, schema value mismatch and repeated rows. Group errors, filter `Errors only`, downloadable error report.
4. **Review:** `N ready / N invalid / N duplicates`, allowed merge/skip policy, back navigation preserving mapping, explicit confirm.
5. **Processing:** job ID, percentage when reliably tracked, completed/skipped/failed counts; refresh safe and resumable.
6. **Results:** row-level reference and exact error, downloadable authorized result and retry failed if safely idempotent.

### Import policies
Do not silently create cross-company workers. Dedupe using defined tenant/company/worker constraints; never merge solely by name or email. Sensitive fields require matching import permission and encryption handling. Dry run cannot mutate. Processing transaction boundaries documented. Per-row success means committed, not just queued. Duplicate upload retries use hash/idempotency logic without suppressing legitimately corrected files.

## Export
Scope `Selected` / `Current filtered view` / `All authorized employees` with exact row estimate. File fields selected from **field-level authorized** column catalog, sensitive export requires explicit grant and audit. Show export job progress, expiry and controlled download (signed short-lived URL or authorization proxy). No spreadsheet formula injection: escape exported values beginning `=`, `+`, `-`, `@` where applicable. Keep protected data out of filenames and notification payloads.

## Bulk
Selection mode `Visible page` vs (if supported) `All matching` with clear scope preview; bulk action authorization evaluated per record on server. Confirm impact with count and approval. Ineligible rows skipped or fail with reasons; no false all-success. Effective date applies only to semantically consistent bulk updates. Results include job ID, counts, retriable failed rows. Audit event per changed record plus grouped batch identifier. Never hard-delete employee history.

## Cases
Unexpected file column, BOM/UTF-8, empty file, >configured file size, duplicated columns, CSV formula content, malicious file, cancelled upload, tab reopened, partial job failure, stale membership grant mid-job, exception in row 200 of 500, old mapping after schema change, jobs scoped to wrong company, export expires/revoked.

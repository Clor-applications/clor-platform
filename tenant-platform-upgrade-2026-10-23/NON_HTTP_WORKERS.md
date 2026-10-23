# Non-HTTP and Scheduled Work Baseline

The API process starts these workers in `server/src/index.ts`:

| Worker | Purpose | Tenant concern |
|---|---|---|
| Recurring invoice scheduler | Materializes due invoices | Must enumerate scoped schedules and preserve account/org on every write |
| Vendor attendance sync | Pulls punches | Device credential must resolve one tenant before data access |
| Photo purge | Deletes retained attendance photos | Cross-tenant batch query and object-key ownership need proof |
| Reader health checks | Updates device state | Global discovery must split work into tenant-bound units |
| Webhook retry | Retries outgoing events | Delivery and webhook must share account/org; destination SSRF policy applies on every retry |
| Session/auth retention purge | Removes expired security records | Global platform maintenance with least-privileged DB role |
| Company closure purge | Deletes closed companies | Destructive job requires lease, resumability, complete store manifest and evidence |
| Recycle-bin purge | Permanently deletes expired items | Tenant retention rules and audit evidence must be preserved |
| HR sync | Flushes outbox and pulls providers | Engagement/connection owns tenant; replay and cursor handling must be idempotent |
| Document reminders | Sends expiry reminders | Tenant-local recipients/templates and deduplication required |
| Notification pruning | Removes old notifications | Scope and retention policy need proof |
| Books digest | Sends scheduled summaries | Must not aggregate or email across organizations |
| Attendance report schedules | Builds/emails reports | Stored schedule, report query and recipient list must share tenant scope |

## Architectural finding

These tasks run inside every API instance unless disabled by environment controls. Some use leases, but the platform needs a single worker registry documenting enable flag, lease key, lease duration, retry policy, idempotency key, principal, tenant-resolution rule, metrics and runbook. Multi-instance safety cannot be inferred from `setInterval` alone.


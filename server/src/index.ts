import 'dotenv/config';
import { buildApp } from './app.js';
import { startRecurringScheduler } from './services/recurringScheduler.js';
import { startRetentionPurge } from './services/retention.js';
import { startClosurePurge } from './services/companyClosure.js';
import { syncAccountMemberships } from './services/accountMembership.js';
import { startRecycleBinPurge } from './services/recycleBin.js';
import { startHrSync } from './services/hr/sync.js';
import { startReportSchedules } from './services/attendance/reportSchedules.js';
import { startPeopleOutbox } from './services/people/outbox.js';
import { startScheduledChanges } from './services/people/effectiveDating.js';
import { startApprovalDues } from './services/people/approvals/engine.js';
import { startDeskDues } from './services/people/desk.js';
import { startSeparations } from './services/people/lifecycle/leaving.js';
import { startLifecycle } from './services/people/lifecycle/jobs.js';
import { startTalentJobs } from './services/people/talent/training.js';
import { startObligationDues } from './services/people/complianceRules.js';
import { startLeaveJobs } from './services/attendance/leaveJobs.js';
import { startPunchNudges } from './services/attendance/punchNudge.js';
import { startAbsenceChecks } from './services/people/absconding.js';
import { startEngagement } from './services/people/engagement/index.js';
import { registerPeopleEffects } from './services/people/approvals/effects.js';
import { startDocumentReminders } from './services/people/documentReminders.js';
import { startNotificationPruning } from './services/notifications.js';
import { startBooksDigest } from './services/booksDigest.js';
import { startWeeklySummary } from './services/people/weeklySummary.js';
import { build as buildReport } from './routes/attendanceReports.js';
import { startPhotoPurge, startReaderChecks, startVendorSync, startWebhookRetries } from './services/vendorSyncScheduler.js';
import { reportProcessErrors } from './utils/log.js';
import { stopJobs } from './services/jobLease.js';
import { startCredentialBackfill } from './services/credentialBackfill.js';
import { startOwnerPermissionSync } from './services/ownerPermissions.js';
import { startCredentialChecks } from './services/credentialReview.js';
import { startIntegrityChecks } from './services/integrity/checks.js';
import { startOrgDetailBackfill } from './services/people/organization.js';
import { startStatutoryCatalogueBackfill } from './services/payroll/statutory/resolve.js';
import { startFullDayFix } from './services/attendance/fullDayFix.js';
import { ensureFirstPriceBook } from './services/pricing/seed.js';

/* Crashes and unhandled rejections are reported, not lost. */
reportProcessErrors();

const app = buildApp();
const port = Number(process.env.PORT || 4001);

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});

/*
 * Cloud Run sends SIGTERM and allows about ten seconds before it kills an
 * instance (a deploy, a scale-down). Stop taking new connections and let the
 * requests already running finish, rather than cutting them off half-way
 * through a save. Background jobs start nothing new, are told to stop before
 * their next step that cannot be undone, and give their leases back so
 * another instance takes over at its next tick (services/jobLease.ts).
 */
process.once('SIGTERM', () => {
  // eslint-disable-next-line no-console
  console.log('SIGTERM: finishing requests in flight, then exiting');
  const released = stopJobs()
    .then((jobs) => jobs.length && console.log(`SIGTERM: stopped ${jobs.join(', ')}; leases released`)) // eslint-disable-line no-console
    .catch((e) => console.error('SIGTERM: releasing job leases failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  server.close(() => released.finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8_000).unref();
});

/*
 * Started with the server, not with a browser. Set RECURRING_SCHEDULER=off to
 * disable it — on an instance that only serves requests, say, or while
 * something is being investigated.
 */
startRecurringScheduler();
/* Punches from vendor clouds (e-Time Office) — see services/vendorSyncScheduler.ts. */
startVendorSync();
startPhotoPurge();
startReaderChecks();
/* Failed webhook deliveries are tried again on a schedule. */
startWebhookRetries();

/* Sign-in records past their use are removed daily — see services/retention.ts. */
startRetentionPurge();
/* Companies whose closure notice has ended are deleted (checked hourly, resumable) — see services/companyClosure.ts. */
startClosurePurge();

/* W-1.1: every login belongs to its home account; a membership missed by an older path is filled in. */
syncAccountMemberships()
  .then((n) => n && console.log(`Account memberships: ${n} added`)) // eslint-disable-line no-console
  .catch((e) => console.error('Account memberships sync failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
/* Recycle-bin items past their days are deleted for good — see services/recycleBin.ts. */
startRecycleBinPurge();
/* HR tools: the outbox every minute, their people hourly — see services/hr/sync.ts. */
startHrSync();
startDocumentReminders();
/* People's outbox: events written with a change are delivered every few seconds — see services/people/outbox.ts. */
startPeopleOutbox();
/* Changes dated for a future day are applied on that day — see services/people/effectiveDating.ts. */
startScheduledChanges();
/* Approvals: what an approved request does, and overdue steps reminded or handed on — see services/people/approvals. */
registerPeopleEffects();
startApprovalDues();
startDeskDues();
startSeparations();
startLifecycle();
startTalentJobs();
startObligationDues();
/* Leave: steps handed on to HR when a manager does not decide, and the morning digest of what waits. */
startLeaveJobs();
/* The missing-punch notice and the unexplained-absence check (WORKFLOW-GAP-RESEARCH 4.5, 4.6). */
startPunchNudges();
startAbsenceChecks();
/* Ready-made automations, greetings and exit-interview answers past keeping (WORKFLOW-GAP-RESEARCH 4.7, 4.8, 4.9). */
startEngagement();
startNotificationPruning();
startBooksDigest();
startWeeklySummary();
/* Reports that go out by e-mail on their own — every 15 minutes the due ones are sent. */
startReportSchedules(buildReport);
/* Batch 5: credentials issued before the registry are registered once, on one instance. */
startCredentialBackfill();
/* New permissions reach every company's Owner role, once per deploy. */
startOwnerPermissionSync();
/* Daily: expiry warnings, expired events, credentials whose own row is gone. */
startCredentialChecks();
/* GAP-010: links between the databases, checked nightly; safe ones repaired, the rest logged. */
startIntegrityChecks();
/* Organization: "Detailed structure" on, once, for every company already using those lists. */
startOrgDetailBackfill();
/* Payroll: every company that took the standard statutory rates gets CLOR's newer PT and LWF figures, once per catalogue. */
startStatutoryCatalogueBackfill();
/* Attendance: days scored under the old full-day rule set to present in open months; closed months are listed, never changed. */
startFullDayFix();
/* Pricing: price book version 1, the mock prices, when there is no price book yet; never touches one that exists. */
ensureFirstPriceBook()
  .then((r) => r.created && console.log(`Pricing: price book version ${r.version} made with mock prices`)) // eslint-disable-line no-console
  .catch((e) => console.error('Pricing: first price book failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console

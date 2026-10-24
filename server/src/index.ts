import 'dotenv/config';
import { buildApp } from './app.js';
import { startRecurringScheduler } from './services/recurringScheduler.js';
import { startRetentionPurge } from './services/retention.js';
import { startClosurePurge } from './services/companyClosure.js';
import { startRecycleBinPurge } from './services/recycleBin.js';
import { startHrSync } from './services/hr/sync.js';
import { startReportSchedules } from './services/attendance/reportSchedules.js';
import { startDocumentReminders } from './services/people/documentReminders.js';
import { startNotificationPruning } from './services/notifications.js';
import { startBooksDigest } from './services/booksDigest.js';
import { build as buildReport } from './routes/attendanceReports.js';
import { startPhotoPurge, startReaderChecks, startVendorSync, startWebhookRetries } from './services/vendorSyncScheduler.js';
import { reportProcessErrors } from './utils/log.js';
import { stopJobs } from './services/jobLease.js';
import { startCredentialBackfill } from './services/credentialBackfill.js';
import { startCredentialChecks } from './services/credentialReview.js';

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
/* Recycle-bin items past their days are deleted for good — see services/recycleBin.ts. */
startRecycleBinPurge();
/* HR tools: the outbox every minute, their people hourly — see services/hr/sync.ts. */
startHrSync();
startDocumentReminders();
startNotificationPruning();
startBooksDigest();
/* Reports that go out by e-mail on their own — every 15 minutes the due ones are sent. */
startReportSchedules(buildReport);
/* Batch 5: credentials issued before the registry are registered once, on one instance. */
startCredentialBackfill();
/* Daily: expiry warnings, expired events, credentials whose own row is gone. */
startCredentialChecks();

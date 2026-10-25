import { platformPrisma } from '../utils/platformPrisma.js';
import { isFeatureEnabled } from './features.js';
import { isAppEntitled } from './subscriptions.js';
import { APP_CATALOG } from '../constants/appCatalog.js';
import { runInTenant } from '../utils/tenantScope.js';
import { isArchived } from './companyArchive.js';

/**
 * May a non-human caller still work for this company, in this app? (A-11)
 *
 * Staff routes have asked "is the app paid for?" (isAppEntitled) for a while.
 * Everything that is not a signed-in member of staff — the employee portal,
 * API keys, readers pushing punches, on-site connectors, directory sync,
 * share and payment links — asked only whether the company had the app
 * switched on, which a subscription lapsing does not change; several asked
 * nothing. So a cancelled account kept punching, paying out payslips to the
 * portal and answering its API.
 *
 * The answer is now the same everywhere: the app is switched on, it is on a
 * subscription in good standing, and the company is not on its way to being
 * closed (a scheduled closure ends machine access at once; people keep
 * reading their data until the purge).
 */
export type Refusal = { status: number; error: string; code: string };

export async function closing(orgId: string): Promise<boolean> {
  /* As the company asked about, whatever scope the caller is in: under fail-closed policies (A-35) a caller with no company yet would otherwise see no closure and wave a closing company through. */
  const row = await runInTenant(orgId, () => platformPrisma.orgClosure.findUnique({ where: { orgId }, select: { status: true } }));
  return row?.status === 'SCHEDULED';
}

/** Null when `app` may be used; otherwise the refusal to send. */
export async function appLive(accountId: string, orgId: string, app: string): Promise<Refusal | null> {
  /* Asked as that company, whatever scope the caller is in (A-35): a token route asks before it has entered its company. */
  return runInTenant(orgId, () => appLiveIn(accountId, orgId, app));
}

async function appLiveIn(accountId: string, orgId: string, app: string): Promise<Refusal | null> {
  /* Archived: read-only for people, closed to machines — portal, readers, keys, recurring invoices. */
  if (await isArchived(orgId)) return { status: 403, error: 'This company is archived; its connections are switched off.', code: 'COMPANY_ARCHIVED' };
  if (await closing(orgId)) return { status: 403, error: 'This company is being closed; its connections are switched off.', code: 'COMPANY_CLOSING' };
  /* Only an app with an on/off switch of its own (Payroll, Attendance, People) can be switched off; Accounting is its subscription. */
  const featureKey = APP_CATALOG.find((x) => x.code === app)?.featureKey;
  if (featureKey && !(await isFeatureEnabled(accountId, orgId, featureKey))) return { status: 403, error: `${app[0].toUpperCase()}${app.slice(1)} is not switched on for this organisation.`, code: 'APP_DISABLED' };
  if (!(await isAppEntitled(accountId, app))) return { status: 402, error: `The ${app} app is not on this account's subscription.`, code: 'APP_NOT_SUBSCRIBED' };
  return null;
}

/** Null when any one of `apps` may be used (the portal serves People or Attendance). */
export async function anyAppLive(accountId: string, orgId: string, apps: string[]): Promise<Refusal | null> {
  let first: Refusal | null = null;
  for (const app of apps) {
    const r = await appLive(accountId, orgId, app);
    if (!r) return null;
    if (!first || r.code === 'COMPANY_CLOSING' || r.code === 'COMPANY_ARCHIVED') first = r;
  }
  return first;
}

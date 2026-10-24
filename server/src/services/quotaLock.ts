import { randomUUID } from 'node:crypto';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Workspace W-6.1: plan limits that hold when two requests arrive together.
 *
 * Adding a company or a user checked the plan's count and then created the
 * row, in separate steps; two requests at once both saw room and both
 * created. Now the check and the create run while this account holds a lock
 * row for that metric (AccountQuotaLock, primary key account + metric), so
 * the second waits and then counts the first one's row.
 *
 * A row, not a PostgreSQL advisory lock: a session lock does not survive the
 * connection pool, and these creates are not one transaction. A holder that
 * crashed leaves a row that is taken over after STALE_MS.
 */
export type QuotaMetric = 'COMPANIES' | 'USERS';
const STALE_MS = 30_000;
const WAIT_MS = 100;
const TRIES = 60;

export class QuotaBusyError extends Error {
  status = 409;
  code = 'QUOTA_BUSY';
  constructor() {
    super('Another change to this account is in progress. Try again in a moment.');
  }
}

/** Takes the lock and returns its release; waits for another holder for up to ~6 seconds. */
export async function lockQuota(accountId: string, metric: QuotaMetric): Promise<() => Promise<void>> {
  const holder = randomUUID();
  for (let i = 0; i < TRIES; i++) {
    const taken = await outsideTenant('quota lock: take', async () => {
      try {
        await platformPrisma.accountQuotaLock.create({ data: { accountId, metric, holder } });
        return true;
      } catch (e: any) {
        if (String(e?.code || '') !== 'P2002') throw e;
        /* A crashed holder's row: take it over, but only the one row that is still stale. */
        const stale = await platformPrisma.accountQuotaLock.deleteMany({ where: { accountId, metric, lockedAt: { lt: new Date(Date.now() - STALE_MS) } } });
        return stale.count > 0 ? null : false;
      }
    });
    if (taken) {
      return async () => {
        await outsideTenant('quota lock: release', () => platformPrisma.accountQuotaLock.deleteMany({ where: { accountId, metric, holder } }));
      };
    }
    if (taken === false) await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  throw new QuotaBusyError();
}

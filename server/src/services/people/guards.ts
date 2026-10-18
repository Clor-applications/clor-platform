import { isAppEntitled } from '../subscriptions.js';
import type { Request, Response } from 'express';

import { isFeatureEnabled } from '../features.js';
import { orgMatches } from '../payroll/guards.js';

/**
 * People is a switch like Payroll: off until a company turns it on. The
 * employee list is shared: Attendance sold on its own keeps its staff here too
 * (its Personnel section, ClorTime-style), so either switch opens it.
 */
export const peopleEnabled = async (req: Request, res: Response): Promise<boolean> => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'people')) return true;
  if (await isFeatureEnabled(accountId, orgId, 'attendance')) return true;
  res.status(403).json({
    error: 'People is not switched on for this organisation.',
    code: 'PEOPLE_DISABLED',
  });
  return false;
};

export const peopleRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  if (!(await peopleEnabled(req, res))) return false;
  /* Bought, and the subscription in good standing: the shell hides an unowned app, the API refuses it too. */
  if (!(await isAppEntitled(req.tenant!.accountId, 'people'))) {
    res.status(402).json({ error: 'People is not on this account’s subscription.', app: 'people', code: 'APP_NOT_SUBSCRIBED' });
    return false;
  }
  return true;
};

export const PEOPLE_MODULE = 'PEOPLE';
export const PEOPLE_RESOURCE = {
  employees: 'Employees',
  structure: 'Org Structure',
  notes: 'Employee Notes',
} as const;

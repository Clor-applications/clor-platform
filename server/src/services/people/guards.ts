import type { Request, Response } from 'express';

import { isFeatureEnabled } from '../features.js';
import { orgMatches } from '../payroll/guards.js';

/** People is a switch like Payroll: off until a company turns it on. */
export const peopleEnabled = async (req: Request, res: Response): Promise<boolean> => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'people')) return true;
  res.status(403).json({
    error: 'People is not switched on for this organisation.',
    code: 'PEOPLE_DISABLED',
  });
  return false;
};

export const peopleRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  return peopleEnabled(req, res);
};

export const PEOPLE_MODULE = 'PEOPLE';
export const PEOPLE_RESOURCE = {
  employees: 'Employees',
  structure: 'Org Structure',
  notes: 'Employee Notes',
} as const;

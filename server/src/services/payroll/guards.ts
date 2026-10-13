import type { Request, Response } from 'express';

import { isFeatureEnabled } from '../features.js';

/**
 * The two checks every payroll route makes before it does anything.
 *
 * Written once because they are easy to half-remember. A route that forgets
 * `orgOk` trusts a path parameter over the authenticated context, which is how
 * one organisation reads another's salaries; a route that forgets `featureOn`
 * answers for an organisation that has never switched payroll on, which is how
 * a module nobody bought starts returning data.
 *
 * Permission is not here on purpose. It stays at the route as
 * `requirePermission(...)` middleware, where it is visible in the route's own
 * definition — payroll has several distinct permissions and hiding which one a
 * route uses inside a shared helper would make the sensitive ones harder to
 * audit, not easier.
 */

/** The org in the path must be the org the caller is authenticated for. */
export const orgMatches = (req: Request, res: Response): boolean => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

/** Payroll is off for most organisations, and an off module answers nothing. */
export const payrollEnabled = async (req: Request, res: Response): Promise<boolean> => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'payroll')) return true;
  res.status(403).json({
    error: 'Payroll is not switched on for this organisation.',
    code: 'PAYROLL_DISABLED',
  });
  return false;
};

/** Both, in the order a route wants them. Returns false when it has replied. */
export const payrollRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  return payrollEnabled(req, res);
};

/** The module and resources payroll permissions are granted against. */
export const PAYROLL_MODULE = 'PAYROLL';
export const PAYROLL_RESOURCE = {
  settings: 'Payroll Settings',
  structures: 'Salary Structures',
  assignments: 'Salary Assignments',
  revisions: 'Salary Revisions',
  runs: 'Payroll Runs',
  slips: 'Salary Slips',
  adjustments: 'Payroll Adjustments',
  loans: 'Payroll Loans',
  payments: 'Payroll Payments',
  posting: 'Payroll Posting',
  profile: 'Employee Payroll Profile',
  reports: 'Payroll Reports',
} as const;

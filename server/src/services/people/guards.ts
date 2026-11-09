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

/*
 * The staff list Attendance shares (People plan, 8 Nov 2026): the employee
 * directory, its structure lists, contractors, joining and leaving tasks,
 * resignations and transfers — Attendance's own People section. A company
 * that bought Attendance alone opens these; every other /people route stays
 * People's. Matched on the route's template, so a new route is People-only
 * until it is added here.
 */
const SHARED_DIRECTORY = [
  /^\/orgs\/:orgId\/people\/employees(\/(counts|next-code|export|export\/columns|import|import\/batches|bulk|transfer))?$/,
  /^\/orgs\/:orgId\/people\/employees\/:id(\/(history|activity|journey|checklist|checklist\/:kind|custom-fields|statutory|identity|statutory\/reveal|readiness|scheduled\/:changeId|change-impact|resign|stay|rehire))?$/,
  /^\/orgs\/:orgId\/people\/structure(-history|\/:kind(\/:id(\/merge)?)?)$/,
  /^\/orgs\/:orgId\/people\/contractors(\/import|\/:id)?$/,
  /^\/orgs\/:orgId\/people\/(suggestions|settings|custom-fields|saved-views|saved-views\/:id|tags|tags\/:id)$/,
];
export const isSharedDirectoryRoute = (path: string | undefined): boolean => Boolean(path && SHARED_DIRECTORY.some((re) => re.test(path)));

export const peopleRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  const { accountId } = req.tenant!;
  const entitled = (await isAppEntitled(accountId, 'people'))
    || (isSharedDirectoryRoute(req.route?.path) && (await isAppEntitled(accountId, 'attendance')));
  /* A-15: one order for every app — not bought (402) before switched off (403), so an unowned app says so instead of reading as a setting. */
  if (!entitled) {
    res.status(402).json({ error: 'People is not on this account’s subscription.', app: 'people', code: 'APP_NOT_SUBSCRIBED' });
    return false;
  }
  if (!(await peopleEnabled(req, res))) return false;
  return true;
};

export const PEOPLE_MODULE = 'PEOPLE';
export const PEOPLE_RESOURCE = {
  employees: 'Employees',
  structure: 'Org Structure',
  notes: 'Employee Notes',
  documents: 'Documents',
  hrOnlyDocuments: 'HR-only Documents',
  confidentialDocuments: 'Confidential Documents',
  statutory: 'Statutory Details',
  fullIdentifiers: 'Full Identifiers',
  approvals: 'Approvals',
  requests: 'Requests',
  lifecycle: 'Lifecycle',
  policies: 'Policies',
  privateCases: 'Private Cases',
  privacy: 'Privacy',
  expenses: 'Expenses',
} as const;

/**
 * Leave, holidays, the employee app and a person's own days are HR's
 * (founder, 22 Oct 2026) and stay in step with Attendance because both read
 * and write the same tables. So they open when either People or Attendance
 * is on and bought: HR alone, Attendance alone, or both.
 */
export const hrOrAttendanceRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  const { accountId, orgId } = req.tenant!;
  const on: string[] = [];
  for (const app of ['people', 'attendance']) if (await isFeatureEnabled(accountId, orgId, app)) on.push(app);
  if (!on.length) {
    res.status(403).json({ error: 'Switch on People or Attendance for this organisation to use leave and holidays.', code: 'TIME_OFF_DISABLED' });
    return false;
  }
  for (const app of on) if (await isAppEntitled(accountId, app)) return true;
  res.status(402).json({ error: 'Neither People nor Attendance is on this account’s subscription.', app: on[0], code: 'APP_NOT_SUBSCRIBED' });
  return false;
};

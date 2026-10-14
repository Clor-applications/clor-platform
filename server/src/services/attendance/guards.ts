import type { Request, Response } from 'express';

import { isFeatureEnabled } from '../features.js';
import { orgMatches } from '../payroll/guards.js';

/** Attendance is a switch like People and Payroll: off until turned on. */
export const attendanceRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'attendance')) return true;
  res.status(403).json({ error: 'Attendance is not switched on for this organisation.', code: 'ATTENDANCE_DISABLED' });
  return false;
};

export const ATTENDANCE_MODULE = 'ATTENDANCE';
export const ATTENDANCE_RESOURCE = {
  records: 'Attendance Records',
  requests: 'Attendance Requests',
  shifts: 'Shifts',
  holidays: 'Holidays',
  self: 'My Attendance',
  leaveTypes: 'Leave Types',
  leave: 'Leave Requests',
} as const;

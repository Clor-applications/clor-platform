import { appGate } from '../appGate.js';
import type { Request, Response } from 'express';

import { isFeatureEnabled } from '../features.js';
import { orgMatches } from '../payroll/guards.js';

/** Attendance is a switch like People and Payroll: off until turned on. */
export const attendanceRouteOk = async (req: Request, res: Response): Promise<boolean> => {
  if (!orgMatches(req, res)) return false;
  const { accountId, orgId } = req.tenant!;
  /* A-15: one order for every app — not bought (402) before switched off (403), so an unowned app says so instead of reading as a setting. */
  /* People includes Attendance; lapsed, reading goes on and changes are refused. */
  const refused = await appGate(accountId, ['attendance', 'people'], req.method, { name: 'Attendance', app: 'attendance' });
  if (refused) {
    res.status(refused.status).json(refused.body);
    return false;
  }
  if (!(await isFeatureEnabled(accountId, orgId, 'attendance'))) {
    res.status(403).json({ error: 'Attendance is not switched on for this company.', code: 'ATTENDANCE_DISABLED' });
    return false;
  }
  return true;
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
  devices: 'Attendance Devices',
  integrations: 'Attendance Integrations',
  portal: 'Employee Portal',
} as const;

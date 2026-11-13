import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { ISO_DATE, daysOfMonth, sendError, today } from '../services/attendance/days.js';
import { MAX_DAYS, copyWeek, discardDraft, publishRoster, rosterView, setDraft } from '../services/attendance/roster.js';
import { recordAudit } from '../services/auditTrail.js';
import { addDays } from '../utils/istDate.js';

/**
 * The roster planner (services/attendance/roster.ts): a grid of people by
 * days, painted as a draft, published in one go. Reading needs Shifts: view;
 * drafting, discarding and publishing need Shifts: edit.
 */
export const rosterRouter = Router();
rosterRouter.use(requireAuth, requireTenantContext);

const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.shifts);
const base = '/orgs/:orgId/attendance/roster';
const date = z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.');
const who = (req: any) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth!.userId });
const text = (v: unknown) => String(v || '').trim();

/** ?month=YYYY-MM, or ?from=&to= (a week, say); this month when neither is given. */
rosterRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  let from = text(req.query.from);
  let to = text(req.query.to);
  if (!ISO_DATE.test(from)) {
    const month = /^\d{4}-\d{2}$/.test(text(req.query.month)) ? text(req.query.month) : today().slice(0, 7);
    const days = daysOfMonth(month);
    from = days[0];
    to = days[days.length - 1];
  } else if (!ISO_DATE.test(to)) {
    to = addDays(from, 6);
  }
  if (to < from) return res.status(400).json({ error: 'The last day is before the first.' });
  try {
    res.json(
      await rosterView(
        { accountId, orgId },
        { from, to, departmentId: text(req.query.departmentId), branchId: text(req.query.branchId), areaId: text(req.query.areaId), shiftId: text(req.query.shiftId), q: text(req.query.q), page: Number(req.query.page), pageSize: Number(req.query.pageSize) }
      )
    );
  } catch (e) {
    return sendError(res, e);
  }
});

/** One thing for every day of some people on some dates: a shift, a weekly off, or (CLEAR) back to their schedule. */
rosterRouter.post(`${base}/draft`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1, 'Choose the people.').max(2000),
      dates: z.array(date).min(1, 'Choose the days.').max(MAX_DAYS * 3),
      kind: z.enum(['SHIFT', 'OFF', 'CLEAR']),
      shiftId: z.string().min(1).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose people, days and a shift.' });
  try {
    res.json(await setDraft(who(req), parsed.data));
  } catch (e) {
    return sendError(res, e);
  }
});

/** A week, as planned, onto the weeks after it. */
rosterRouter.post(`${base}/draft/copy-week`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = z
    .object({ employeeIds: z.array(z.string().min(1)).min(1, 'Choose the people.').max(2000), weekStart: date, weeks: z.coerce.number().int().min(1, 'Copy onto 1 to 12 weeks.').max(12, 'Copy onto 1 to 12 weeks.') })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Choose people, a week and how many weeks.' });
  try {
    res.json(await copyWeek(who(req), parsed.data));
  } catch (e) {
    return sendError(res, e);
  }
});

rosterRouter.delete(`${base}/draft`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const from = ISO_DATE.test(text(req.query.from)) ? text(req.query.from) : null;
  const to = ISO_DATE.test(text(req.query.to)) ? text(req.query.to) : null;
  res.json(await discardDraft(who(req), { from, to }));
});

/** Make the draft the roster, and tell the people whose days changed. */
rosterRouter.post(`${base}/publish`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = z.object({ from: date.optional().nullable(), to: date.optional().nullable() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Dates are YYYY-MM-DD.' });
  try {
    const r = await publishRoster(who(req), parsed.data);
    await recordAudit(req, { entity: 'Roster', entityId: req.tenant!.orgId, action: 'UPDATE', message: `Roster published: ${r.published} ${r.published === 1 ? 'day' : 'days'}, ${r.from} to ${r.to}`, metadata: { published: r.published, people: r.people, notified: r.notified, from: r.from, to: r.to } });
    res.json(r);
  } catch (e) {
    return sendError(res, e);
  }
});

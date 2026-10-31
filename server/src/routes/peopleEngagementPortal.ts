import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { istDate } from '../services/attendance/compute.js';
import '../services/people/engagement/index.js';
import { ExitError, myInterview, submitInterview } from '../services/people/engagement/exitInterview.js';
import { feedFor, setOptOut } from '../services/people/engagement/greetings.js';

/**
 * The employee app's side of leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.8, 4.9), behind
 * the app's own sign-in (routes/portal.ts `authenticate`). The person is always the token's employee.
 *
 *  - /today: today's birthdays and anniversaries in my team, and tomorrow's holiday on my own list.
 *  - /exit-interview: my exit interview while I am leaving, and sending it (once).
 *  - /celebrations: whether I am announced on my birthday and work anniversary, and changing it.
 */
export const peopleEngagementPortalRouter = Router();
peopleEngagementPortalRouter.use(authenticate);

type Me = { id: string; accountId: string; orgId: string; userId: string | null; departmentId: string | null; reportingManagerId: string | null; areaId: string | null; branchId: string | null };
const me = (req: Request) => req.portal!.employee as Me;
const fail = (res: Response, e: any) => {
  if (e instanceof ExitError || (e?.status && e.status < 500)) return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  console.error('[portal engagement]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
};

peopleEngagementPortalRouter.get('/today', async (req, res) => {
  try {
    const e = me(req);
    res.json({ posts: await feedFor(e.orgId, e, istDate(new Date())) });
  } catch (err) {
    fail(res, err);
  }
});

peopleEngagementPortalRouter.get('/exit-interview', async (req, res) => {
  try {
    const e = me(req);
    res.json({ interview: await myInterview(e.orgId, e.id) });
  } catch (err) {
    fail(res, err);
  }
});

peopleEngagementPortalRouter.post('/exit-interview', async (req, res) => {
  try {
    const e = me(req);
    await submitInterview(e.orgId, e.id, { kind: 'EMPLOYEE', userId: e.userId || `portal:${e.id}`, accountId: e.accountId }, req.body);
    res.json({ interview: await myInterview(e.orgId, e.id) });
  } catch (err) {
    fail(res, err);
  }
});

peopleEngagementPortalRouter.get('/celebrations', async (req, res) => {
  try {
    const e = me(req);
    const out = await peoplePrisma.celebrationOptOut.findUnique({ where: { orgId_employeeId: { orgId: e.orgId, employeeId: e.id } }, select: { id: true } });
    res.json({ optedOut: Boolean(out) });
  } catch (err) {
    fail(res, err);
  }
});

peopleEngagementPortalRouter.put('/celebrations', async (req, res) => {
  try {
    const e = me(req);
    res.json(await setOptOut(e.orgId, e.accountId, e.id, Boolean(req.body?.optedOut), `portal:${e.id}`));
  } catch (err) {
    fail(res, err);
  }
});

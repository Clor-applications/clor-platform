import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { referLimiter } from '../middleware/rateLimit.js';
import { isFeatureEnabled } from '../services/features.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { RESUME_TYPES, TalentError } from '../services/people/talent/hiring.js';
import * as referrals from '../services/people/talent/referrals.js';

/**
 * Jobs and referrals in the employee app (services/people/talent/referrals.ts, A20), behind the
 * app's own sign-in (routes/portal.ts `authenticate`, which enters the person's company and
 * refuses someone who has left or is suspended). The person is the token's employee, never one
 * named in the request. Only while the company has Hiring on.
 */
export const peopleReferralsPortalRouter = Router();
peopleReferralsPortalRouter.use(authenticate);

async function me(req: Request) {
  const p = req.portal!;
  if (!(await isFeatureEnabled(p.accountId, p.orgId, 'peopleHiring'))) return null;
  return referrals.referrerById(p.orgId, p.employeeId);
}
const fail = (res: Response, e: unknown) => {
  if (e instanceof TalentError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  console.error('[portal referrals]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const off = (res: Response) => res.status(403).json({ error: 'Jobs are not switched on for your company.', code: 'MODULE_OFF' });

peopleReferralsPortalRouter.get('/', async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return res.json({ on: false, jobs: [], referrals: [], applications: [] });
    res.json({ on: true, jobs: await referrals.jobsFor(e), ...(await referrals.mine(e)) });
  } catch (err) {
    fail(res, err);
  }
});

peopleReferralsPortalRouter.post('/refer', ...referLimiter, async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return off(res);
    const raw = req.body?.resume;
    let file = null;
    if (raw?.data) {
      const f = decodeDocument(raw.data, raw.mime);
      if ('error' in f) throw new TalentError(f.error);
      if (!RESUME_TYPES.has(f.mime)) throw new TalentError('A résumé is a PDF or Word file.');
      file = { name: String(raw.name || 'resume').slice(0, 200), mime: f.mime, data: f.data };
    }
    const made = await referrals.refer(e, req.body || {}, file);
    res.status(201).json({ referral: { id: made.referralId } });
  } catch (err) {
    fail(res, err);
  }
});

peopleReferralsPortalRouter.post('/link', async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return off(res);
    res.json(await referrals.linkFor(e, String(req.body?.openingId || '')));
  } catch (err) {
    fail(res, err);
  }
});

peopleReferralsPortalRouter.post('/apply', async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return off(res);
    const c = await referrals.applyInternal(e, String(req.body?.openingId || ''), req.body || {});
    res.status(201).json({ application: { id: c.id } });
  } catch (err) {
    fail(res, err);
  }
});

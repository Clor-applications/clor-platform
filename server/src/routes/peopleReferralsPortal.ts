import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { portalNeedsPeople } from '../services/people/guards.js';
import { referLimiter } from '../middleware/rateLimit.js';
import { isFeatureEnabled } from '../services/features.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { RESUME_TYPES, TalentError } from '../services/people/talent/hiring.js';
import * as referrals from '../services/people/talent/referrals.js';
import { z } from 'zod';
import { check, rawText, text } from '../middleware/validate.js';

/**
 * Jobs and referrals in the employee app (services/people/talent/referrals.ts, A20), behind the
 * app's own sign-in (routes/portal.ts `authenticate`, which enters the person's company and
 * refuses someone who has left or is suspended). The person is the token's employee, never one
 * named in the request. Only while the company has Hiring on.
 */
export const peopleReferralsPortalRouter = Router();
peopleReferralsPortalRouter.use(authenticate);
peopleReferralsPortalRouter.use(portalNeedsPeople);

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

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far
 * too long is refused with a 400; keys not named here are dropped. Which job, a name, a phone or an e-mail that
 * does not look right: those stay the service's, in its own words.
 */
const OPENING = text(80).nullish();
const REFER_BODY = z.object({
  openingId: OPENING, name: text(2000).nullish(), email: text(2000).nullish(), phone: text(200).nullish(), relation: text(2000).nullish(), note: text(20_000).nullish(),
  /* The résumé as base64 or a data URL: the route's body may be 3 MB (app.ts). */
  resume: z.object({ name: rawText(2000).nullish(), mime: text(200).nullish(), data: rawText(3_200_000).nullish() }).nullish(),
});

peopleReferralsPortalRouter.get('/', async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return res.json({ on: false, jobs: [], referrals: [], applications: [] });
    res.json({ on: true, jobs: await referrals.jobsFor(e), ...(await referrals.mine(e)) });
  } catch (err) {
    fail(res, err);
  }
});

peopleReferralsPortalRouter.post('/refer', ...referLimiter, check({ body: REFER_BODY }), async (req, res) => {
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

peopleReferralsPortalRouter.post('/link', check({ body: z.object({ openingId: OPENING }) }), async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return off(res);
    res.json(await referrals.linkFor(e, String(req.body?.openingId || '')));
  } catch (err) {
    fail(res, err);
  }
});

peopleReferralsPortalRouter.post('/apply', check({ body: z.object({ openingId: OPENING, note: text(20_000).nullish() }) }), async (req, res) => {
  try {
    const e = await me(req);
    if (!e) return off(res);
    const c = await referrals.applyInternal(e, String(req.body?.openingId || ''), req.body || {});
    res.status(201).json({ application: { id: c.id } });
  } catch (err) {
    fail(res, err);
  }
});

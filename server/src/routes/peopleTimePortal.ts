import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { today } from '../services/attendance/days.js';
import { timeRulesFor, nightWords } from '../services/attendance/timeRules.js';
import { myMarks } from '../services/attendance/markRules.js';
import { fixesFor } from '../services/attendance/punchNudge.js';
import { noticesFor } from '../services/people/absconding.js';
import { ConsentError, consentHistory, consentOf, nightDaysAhead, recordConsent } from '../services/people/nightConsent.js';
import { z } from 'zod';
import { check, q, rawText, text } from '../middleware/validate.js';

/**
 * The employee app's side of the attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6,
 * B19), behind the app's own sign-in (routes/portal.ts `authenticate`). The person is always the
 * token's employee, never one named in the request.
 *
 *  - /marks: my late marks and early exits this month, how far to the next cost, and the rule.
 *  - /fixes: days I was asked to fix (no punch-out, no punch), still open, with what to fill in;
 *    and for a manager, today's list of the team's unfixed days.
 *  - /notices: absence notices HR sent me, with the date to answer by.
 *  - /night-consent: my consent to night work (women only see it), given or withdrawn by me.
 */
export const peopleTimePortalRouter = Router();
peopleTimePortalRouter.use(authenticate);

const me = (req: Request) => req.portal!.employee as { id: string; accountId: string; orgId: string; gender: string | null; userId: string | null };
const fail = (res: Response, e: any) => {
  if (e instanceof ConsentError || (e?.status && e.status < 500)) return res.status(e.status || 400).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  console.error('[portal attendance rules]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong. Try again in a moment.' });
};

/* A month that is not one reads as this month (the handler's fallback), so it is only checked for being short text. */
peopleTimePortalRouter.get('/marks', check({ query: z.object({ month: q(text(40)) }) }), async (req, res) => {
  try {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
    res.json(await myMarks(me(req), month));
  } catch (e) {
    fail(res, e);
  }
});

peopleTimePortalRouter.get('/fixes', async (req, res) => {
  try {
    const e = me(req);
    const [fixes, notices] = await Promise.all([fixesFor(e), noticesFor(e.orgId, e.id)]);
    res.json({ ...fixes, notices });
  } catch (e) {
    fail(res, e);
  }
});

peopleTimePortalRouter.get('/night-consent', async (req, res) => {
  try {
    const e = me(req);
    const rules = (await timeRulesFor(e.orgId)).night;
    /* Only women are asked: the law's consent is theirs. Everyone else sees nothing here. */
    if (!rules.on || e.gender !== 'FEMALE') return res.json({ asked: false });
    const [current, history, ahead] = await Promise.all([consentOf(e.orgId, [e.id]), consentHistory(e.orgId, e.id), nightDaysAhead(e.orgId, [e.id], 30, rules)]);
    res.json({ asked: true, window: nightWords(rules), consent: current.get(e.id) ? { status: current.get(e.id)!.status, onDate: current.get(e.id)!.onDate } : null, history, nightDaysAhead: (ahead.get(e.id) || []).length });
  } catch (e) {
    fail(res, e);
  }
});

/* Given or withdrawn is the service's to refuse, in its own words; the signed copy comes as base64 or a data URL inside the body's 1 MB. */
const CONSENT_BODY = z.object({ status: text(40).nullish(), note: text(5000).nullish(), file: z.object({ name: rawText(2000).nullish(), mime: text(200).nullish(), data: rawText(1_100_000).nullish() }).nullish() });
peopleTimePortalRouter.post('/night-consent', check({ body: CONSENT_BODY }), async (req, res) => {
  try {
    const e = me(req);
    const rules = (await timeRulesFor(e.orgId)).night;
    if (!rules.on || e.gender !== 'FEMALE') return res.status(400).json({ error: 'Night-work consent is not asked of you.' });
    let file = null;
    if (req.body?.file?.data) {
      const f = decodeDocument(req.body.file.data, req.body.file.mime);
      if ('error' in f) return res.status(400).json({ error: f.error });
      file = { name: String(req.body.file.name || 'consent').slice(0, 120), mime: f.mime, data: f.data };
    }
    /* Given or withdrawn today, by me: the date is the day I did it, not one I pick. */
    const row = await recordConsent({ accountId: e.accountId, orgId: e.orgId, userId: e.userId || `portal:${e.id}` }, e.id, { status: req.body?.status, onDate: today(), note: req.body?.note, file });
    res.status(201).json({ consent: { status: row.status, onDate: row.onDate } });
  } catch (err) {
    fail(res, err);
  }
});

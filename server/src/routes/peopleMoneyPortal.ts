import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { portalNeedsPeople } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import { MoneyError, addLine, answerMine, askAdvance, billFile, claimFor, myMoney, removeLine, reopenClaim, submitClaim, withdrawMine, type Me } from '../services/people/money/expenses.js';
import { askSalaryAdvance, mySalaryAdvance, previewAsk } from '../services/people/money/salaryAdvance.js';
import { z } from 'zod';
import { check, flag, id, idParams, noBody, rawText, text } from '../middleware/validate.js';

/**
 * The person's own money, from the employee app (WORKFLOW-GAP-RESEARCH 4.1,
 * 4.2): bills spent for work, claims, advances and salary advances. Behind the
 * app's sign-in, which enters the person's company; everything here is the
 * signed-in person's own and nobody else's.
 */
export const peopleMoneyPortalRouter = Router();
peopleMoneyPortalRouter.use(authenticate);
peopleMoneyPortalRouter.use(portalNeedsPeople);

const me = (req: Request): Me => ({ accountId: req.portal!.accountId, orgId: req.portal!.orgId, employeeId: req.portal!.employeeId, correlationId: correlationOf(req as any) });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof MoneyError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('[people-money portal]', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
const KINDS = { claims: 'claim', advances: 'advance', 'salary-advance': 'ask' } as const;
const kindOf = (k: string) => (KINDS as Record<string, 'claim' | 'advance' | 'ask'>)[k] || null;

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far
 * too long is refused with a 400; keys not named here are dropped. What must be there, an amount out of range, a
 * date in the future: those stay the service's, in its own words and with its codes.
 */
/* An amount or a count, as a number or as typed into a field: the service reads it with Number() and has the words for one out of range. */
const NUMBERISH = z.union([z.number(), text(40)]).nullish();
/* A day; the service takes the first ten characters, so a full timestamp is a day too. */
const DAY = text(40).nullish();
const LINE_BODY = z.object({
  spentOn: DAY, categoryId: text(80).nullish(), amount: NUMBERISH, merchant: text(2000).nullish(), note: text(5000).nullish(),
  companyGstin: flag.nullish(), supplierGstin: text(200).nullish(), taxAmount: NUMBERISH,
  /* The bill as a data URL: the route's body may be 7 MB (app.ts). */
  bill: rawText(7_400_000).nullish(), billName: text(2000).nullish(), notDuplicate: flag.nullish(),
});
const ASK_BODY = z.object({ amount: NUMBERISH, months: NUMBERISH, reason: text(5000).nullish() });
/* claims, advances or salary-advance; any other word is the handler's 404. */
const KIND_PARAMS = z.object({ kind: text(40), id });

peopleMoneyPortalRouter.get('/', run(async (req, res) => {
  const [money, salary] = await Promise.all([myMoney(me(req)), mySalaryAdvance(me(req))]);
  res.json({ ...money, salaryAdvance: salary });
}));

/** A bill spent for work, with its photo or PDF: goes into my draft until I send it. */
peopleMoneyPortalRouter.post('/lines', check({ body: LINE_BODY }), run(async (req, res) => {
  res.status(201).json(await addLine(me(req), req.body || {}));
}));

peopleMoneyPortalRouter.delete('/lines/:id', check({ params: idParams }), run(async (req, res) => {
  res.json(await removeLine(me(req), String(req.params.id)));
}));

peopleMoneyPortalRouter.get('/claims/:id', check({ params: idParams }), run(async (req, res) => {
  res.json({ claim: await claimFor(me(req), String(req.params.id)) });
}));

peopleMoneyPortalRouter.post('/claims/:id/submit', check({ params: idParams, body: z.object({ title: text(2000).nullish(), advanceId: text(80).nullish() }) }), run(async (req, res) => {
  res.json({ claim: await submitClaim(me(req), String(req.params.id), req.body || {}) });
}));

peopleMoneyPortalRouter.post('/claims/:id/reopen', check({ params: idParams, body: noBody }), run(async (req, res) => {
  res.json(await reopenClaim(me(req), String(req.params.id)));
}));

peopleMoneyPortalRouter.post('/advances', check({ body: z.object({ purpose: text(2000).nullish(), amount: NUMBERISH, neededBy: DAY }) }), run(async (req, res) => {
  res.status(201).json({ advance: await askAdvance(me(req), req.body || {}) });
}));

peopleMoneyPortalRouter.post('/salary-advance/preview', check({ body: ASK_BODY }), run(async (req, res) => {
  res.json(await previewAsk(me(req), req.body || {}));
}));

peopleMoneyPortalRouter.post('/salary-advance', check({ body: ASK_BODY }), run(async (req, res) => {
  res.status(201).json({ ask: await askSalaryAdvance(me(req), req.body || {}) });
}));

/** Withdraw, or answer a question about, one of my own: a claim, an advance or a salary advance. */
peopleMoneyPortalRouter.post('/:kind/:id/withdraw', check({ params: KIND_PARAMS, body: noBody }), run(async (req, res) => {
  const kind = kindOf(String(req.params.kind));
  if (!kind) return res.status(404).json({ error: 'Not found.' });
  res.json(await withdrawMine(me(req), kind, String(req.params.id)));
}));

peopleMoneyPortalRouter.post('/:kind/:id/reply', check({ params: KIND_PARAMS, body: z.object({ note: text(20_000).nullish() }) }), run(async (req, res) => {
  const kind = kindOf(String(req.params.kind));
  if (!kind) return res.status(404).json({ error: 'Not found.' });
  res.json(await answerMine(me(req), kind, String(req.params.id), String(req.body?.note || '')));
}));

peopleMoneyPortalRouter.get('/bills/:id', check({ params: idParams }), run(async (req, res) => {
  const p = me(req);
  const f = await billFile(p.orgId, String(req.params.id), { employeeId: p.employeeId });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.data);
}));

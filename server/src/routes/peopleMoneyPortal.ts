import { Router, type Request, type Response } from 'express';

import { authenticate } from './portal.js';
import { correlationOf } from '../services/people/employees.js';
import { MoneyError, addLine, answerMine, askAdvance, billFile, claimFor, myMoney, removeLine, reopenClaim, submitClaim, withdrawMine, type Me } from '../services/people/money/expenses.js';
import { askSalaryAdvance, mySalaryAdvance, previewAsk } from '../services/people/money/salaryAdvance.js';

/**
 * The person's own money, from the employee app (WORKFLOW-GAP-RESEARCH 4.1,
 * 4.2): bills spent for work, claims, advances and salary advances. Behind the
 * app's sign-in, which enters the person's company; everything here is the
 * signed-in person's own and nobody else's.
 */
export const peopleMoneyPortalRouter = Router();
peopleMoneyPortalRouter.use(authenticate);

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

peopleMoneyPortalRouter.get('/', run(async (req, res) => {
  const [money, salary] = await Promise.all([myMoney(me(req)), mySalaryAdvance(me(req))]);
  res.json({ ...money, salaryAdvance: salary });
}));

/** A bill spent for work, with its photo or PDF: goes into my draft until I send it. */
peopleMoneyPortalRouter.post('/lines', run(async (req, res) => {
  res.status(201).json(await addLine(me(req), req.body || {}));
}));

peopleMoneyPortalRouter.delete('/lines/:id', run(async (req, res) => {
  res.json(await removeLine(me(req), String(req.params.id)));
}));

peopleMoneyPortalRouter.get('/claims/:id', run(async (req, res) => {
  res.json({ claim: await claimFor(me(req), String(req.params.id)) });
}));

peopleMoneyPortalRouter.post('/claims/:id/submit', run(async (req, res) => {
  res.json({ claim: await submitClaim(me(req), String(req.params.id), req.body || {}) });
}));

peopleMoneyPortalRouter.post('/claims/:id/reopen', run(async (req, res) => {
  res.json(await reopenClaim(me(req), String(req.params.id)));
}));

peopleMoneyPortalRouter.post('/advances', run(async (req, res) => {
  res.status(201).json({ advance: await askAdvance(me(req), req.body || {}) });
}));

peopleMoneyPortalRouter.post('/salary-advance/preview', run(async (req, res) => {
  res.json(await previewAsk(me(req), req.body || {}));
}));

peopleMoneyPortalRouter.post('/salary-advance', run(async (req, res) => {
  res.status(201).json({ ask: await askSalaryAdvance(me(req), req.body || {}) });
}));

/** Withdraw, or answer a question about, one of my own: a claim, an advance or a salary advance. */
peopleMoneyPortalRouter.post('/:kind/:id/withdraw', run(async (req, res) => {
  const kind = kindOf(String(req.params.kind));
  if (!kind) return res.status(404).json({ error: 'Not found.' });
  res.json(await withdrawMine(me(req), kind, String(req.params.id)));
}));

peopleMoneyPortalRouter.post('/:kind/:id/reply', run(async (req, res) => {
  const kind = kindOf(String(req.params.kind));
  if (!kind) return res.status(404).json({ error: 'Not found.' });
  res.json(await answerMine(me(req), kind, String(req.params.id), String(req.body?.note || '')));
}));

peopleMoneyPortalRouter.get('/bills/:id', run(async (req, res) => {
  const p = me(req);
  const f = await billFile(p.orgId, String(req.params.id), { employeeId: p.employeeId });
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.data);
}));

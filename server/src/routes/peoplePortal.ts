import { Router, type Request } from 'express';
import { authenticate } from './portal.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { policiesFor, versionForPerson } from '../services/people/policies.js';
import { AckError, accept, pendingFor } from '../services/people/acknowledgements.js';

/**
 * People's own employee-facing routes, behind the employee app's sign-in
 * (routes/portal.ts `authenticate`, which also enters the person's company):
 * the policies that apply to me, and what I have been asked to accept.
 */
export const peoplePortalRouter = Router();
peoplePortalRouter.use(authenticate);

const me = (req: Request) => ({ accountId: req.portal!.accountId, orgId: req.portal!.orgId, employeeId: req.portal!.employeeId });

/** The policies that apply to me on a day (POL-01, POL-03): published ones only, never a draft. */
peoplePortalRouter.get('/policies', async (req, res) => {
  const { orgId, employeeId } = me(req);
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ policies: await policiesFor(orgId, employeeId, asOf) });
});

/** One version, to read: its text, or the document on my file it points at. */
peoplePortalRouter.get('/policies/:versionId', async (req, res) => {
  const { orgId, employeeId } = me(req);
  const v = await versionForPerson(orgId, employeeId, String(req.params.versionId));
  if (!v) return res.status(404).json({ error: 'No such policy.' });
  let document: { id: string; title: string; mime: string; dataUrl: string } | null = null;
  if (v.documentId) {
    const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: v.documentId, orgId } });
    if (d) document = { id: d.id, title: d.title, mime: d.mime, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` };
  }
  res.json({ policy: { id: v.id, policyId: v.policyId, title: v.title, category: v.category, version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, body: v.body, needsAcceptance: v.needsAcceptance, document } });
});

/** What I still have to accept (DOC-05, POL-04). */
peoplePortalRouter.get('/acknowledgements', async (req, res) => {
  const { orgId, employeeId } = me(req);
  res.json({ pending: await pendingFor(orgId, employeeId) });
});

peoplePortalRouter.post('/acknowledgements/:id/accept', async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    const row = await accept(orgId, employeeId, String(req.params.id));
    res.json({ acknowledgement: { id: row.id, targetType: row.targetType, targetId: row.targetId, acceptedAt: row.acceptedAt } });
  } catch (e) {
    if (e instanceof AckError) return res.status(e.status).json({ error: e.message });
    console.error('[people-portal]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

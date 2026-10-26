import { Router, type Request } from 'express';
import { authenticate } from './portal.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { policiesFor, versionForPerson } from '../services/people/policies.js';
import { AckError, accept, pendingFor } from '../services/people/acknowledgements.js';
import { DeskError, categoriesOf, employeeReply, listRequests, raiseRequest, reopenRequest, requestDetail } from '../services/people/desk.js';
import { SelfServiceError, answerFromApp, myDetails, requestChange, withdrawFromApp } from '../services/people/selfService.js';
import { correlationOf } from '../services/people/employees.js';
import { ResignError, resignFromApp } from '../services/people/lifecycle/leaving.js';
import { CaseError, intake } from '../services/people/privateCases.js';
import { CaseKeyMissing } from '../services/people/caseBox.js';

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
  /* PRV-01: the same text in a language the company offers, when asked for and written; English otherwise. */
  const lang = String(req.query.lang || '').toLowerCase();
  const translated = lang && v.translations[lang] ? v.translations[lang] : null;
  res.json({ policy: { id: v.id, policyId: v.policyId, title: v.title, category: v.category, purpose: v.purpose, version: v.version, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, body: translated || v.body, language: translated ? lang : 'en', languages: ['en', ...Object.keys(v.translations)], needsAcceptance: v.needsAcceptance, document } });
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

/* Ask HR (DESK-01..04): my requests, a new one, the thread without internal notes, a reply, a reopen within seven days. */
const deskError = (res: any, e: unknown) => {
  if (e instanceof DeskError) return res.status(e.status).json({ error: e.message });
  console.error('[people-portal desk]', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'Something went wrong.' });
};

peoplePortalRouter.get('/desk', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  const [requests, categories] = await Promise.all([listRequests(orgId, { employeeId }), categoriesOf(accountId, orgId)]);
  res.json({ requests: requests.map((r) => ({ ...r, description: r.status === 'MOVED' ? '' : r.description })), categories: categories.filter((c) => c.isActive).map((c) => ({ key: c.key, label: c.label, replyHours: c.replyHours, resolveDays: c.resolveDays })) });
});

peoplePortalRouter.post('/desk', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(201).json({ request: await raiseRequest({ accountId, orgId, userId: null, employeeId }, employeeId, req.body || {}) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.get('/desk/:id', async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    res.json({ request: await requestDetail(orgId, String(req.params.id), { forEmployeeId: employeeId }) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.post('/desk/:id/messages', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(201).json({ message: await employeeReply({ accountId, orgId, userId: null }, employeeId, String(req.params.id), req.body || {}) });
  } catch (e) {
    deskError(res, e);
  }
});

peoplePortalRouter.post('/desk/:id/reopen', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json({ request: await reopenRequest({ accountId, orgId, userId: null }, String(req.params.id), { employeeId }) });
  } catch (e) {
    deskError(res, e);
  }
});

/* My details (CORE-03): what I may see and change about myself; contact details save at once, the rest waits for HR, by the company setting (D-02). */
peoplePortalRouter.get('/me/details', async (req, res) => {
  const { orgId, employeeId } = me(req);
  try {
    res.json(await myDetails(orgId, employeeId));
  } catch (e) {
    if (e instanceof SelfServiceError) return res.status(e.status).json({ error: e.message });
    console.error('[people-portal me]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

peoplePortalRouter.post('/me/change-request', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    const r = await requestChange({ accountId, orgId, employeeId, userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) }, req.body && typeof req.body === 'object' ? req.body : {});
    res.status(r.request ? 202 : 200).json(r);
  } catch (e) {
    selfServiceError(res, e);
  }
});

const selfServiceError = (res: any, e: unknown) => {
  if (e instanceof SelfServiceError) return res.status(e.status).json({ error: e.message });
  if ((e as any)?.status) return res.status((e as any).status).json({ error: (e as Error).message });
  console.error('[people-portal me]', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'Something went wrong.' });
};

/* My own requests (E5): answer HR when they ask for more, or withdraw one still open. Only requests I made about myself. */
peoplePortalRouter.post('/me/requests/:id/reply', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json(await answerFromApp({ accountId, orgId, employeeId, correlationId: correlationOf(req as any) }, String(req.params.id), typeof req.body?.note === 'string' ? req.body.note : ''));
  } catch (e) {
    selfServiceError(res, e);
  }
});

peoplePortalRouter.post('/me/requests/:id/withdraw', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.json(await withdrawFromApp({ accountId, orgId, employeeId, correlationId: correlationOf(req as any) }, String(req.params.id)));
  } catch (e) {
    selfServiceError(res, e);
  }
});

/* Resigning from the app (LIFE-05): a LEAVING request the manager and HR decide; the last day goes on the record when it is approved. */
peoplePortalRouter.post('/me/resign', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    res.status(202).json(await resignFromApp({ accountId, orgId, employeeId, userId: req.portal!.employee.userId || null, correlationId: correlationOf(req as any) }, req.body || {}));
  } catch (e) {
    if (e instanceof ResignError) return res.status(e.status).json({ error: e.message });
    if ((e as any)?.status) return res.status((e as any).status).json({ error: (e as Error).message });
    console.error('[people-portal resign]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

peoplePortalRouter.get('/me/leaving', async (req, res) => {
  const { orgId, employeeId } = me(req);
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { status: true, dateOfLeaving: true, leavingType: true } });
  const waiting = await peoplePrisma.approvalRequest.findFirst({ where: { orgId, subjectEmployeeId: employeeId, requestType: 'LEAVING', status: { in: ['WAITING', 'MORE_INFO'] } }, select: { id: true, title: true, status: true, createdAt: true } });
  res.json({ status: e?.status || null, lastDay: e?.dateOfLeaving || null, leavingType: e?.leavingType || null, waiting });
});

/* A private complaint from the app (PRIV-02): it goes to the committee chosen; the person gets the reference only, and nothing about it is listed back here. */
peoplePortalRouter.post('/private-cases', async (req, res) => {
  const { accountId, orgId, employeeId } = me(req);
  try {
    const c = await intake({ accountId, orgId, userId: req.portal!.employee.userId || null, employeeId }, { ...(req.body || {}), complainantEmployeeId: employeeId, onBehalf: false });
    res.status(201).json({ reference: c.reference, receivedOn: c.receivedOn, inquiryDue: c.inquiryDue });
  } catch (e) {
    if (e instanceof CaseError) return res.status(e.status).json({ error: e.message });
    if (e instanceof CaseKeyMissing) return res.status(503).json({ error: e.message });
    console.error('[people-portal case]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

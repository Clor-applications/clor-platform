import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { OfferError, annexure, createOffer, linesFor, offerSetup, offersOf, withdrawOffer } from '../services/people/offers.js';
import { LETTER_KINDS, LETTER_LABEL, LetterError, MERGE_FIELDS, issueLetter, recordLetterRequest, saveTemplate, serviceCertificateDue, templatesOf, versionsOf } from '../services/people/letters.js';

/**
 * Letters (docs/people/02-PRD.md DOC-04, DOC-07): templates under Settings
 * (Documents EDIT), issuing onto a record (Documents CREATE), and when a
 * service certificate is due.
 */
export const peopleLettersRouter = Router();
peopleLettersRouter.use(requireAuth, requireTenantContext);

const { documents: DOCUMENTS, employees: EMPLOYEES } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof LetterError) return res.status(e.status).json({ error: e.message });
  console.error('[people-letters]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

peopleLettersRouter.get(`${base}/letter-templates`, can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ templates: await templatesOf(req.tenant!.orgId), kinds: LETTER_KINDS.map((k) => ({ kind: k, label: LETTER_LABEL[k] })), mergeFields: MERGE_FIELDS });
});

peopleLettersRouter.get(`${base}/letter-templates/:kind/versions`, can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ versions: await versionsOf(req.tenant!.orgId, String(req.params.kind).toUpperCase()) });
});

peopleLettersRouter.post(`${base}/letter-templates`, can(PermissionAction.EDIT, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ template: await saveTemplate(actorOf(req), { kind: req.body?.kind, name: req.body?.name, body: req.body?.body }) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleLettersRouter.post(`${base}/employees/:id/letters`, can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  try {
    res.status(201).json(await issueLetter(actorOf(req), employee.id, { kind: req.body?.kind, extra: req.body?.extra && typeof req.body.extra === 'object' ? req.body.extra : {}, classification: req.body?.classification }));
  } catch (e) {
    sendError(res, e);
  }
});

peopleLettersRouter.get(`${base}/employees/:id/letters/service-certificate`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const askedOn = typeof req.query.askedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.askedOn) ? req.query.askedOn : undefined;
    res.json(await serviceCertificateDue(req.tenant!.orgId, String(req.params.id), askedOn));
  } catch (e) {
    sendError(res, e);
  }
});

/* ---------------------------------------------------------------- offers sent from CLOR (HR-VIEW gap 5) */

const offerError = (res: any, e: unknown) => {
  if (e instanceof OfferError) return res.status(e.status).json({ error: e.message });
  return sendError(res, e);
};

/** What the offer form needs: whether Payroll is on, and its salary structures if so. */
peopleLettersRouter.get(`${base}/offers/setup`, can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await offerSetup(req.tenant!.accountId, req.tenant!.orgId));
});

/** The monthly lines and the annexure for a CTC, without sending anything. */
peopleLettersRouter.post(`${base}/offers/preview`, can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const annualCtc = Math.round(Number(req.body?.annualCtc) * 100) / 100;
    if (!Number.isFinite(annualCtc) || annualCtc <= 0) return res.status(400).json({ error: 'Enter the annual CTC.' });
    const r = await linesFor(req.tenant!.accountId, req.tenant!.orgId, { annualCtc, structureId: req.body?.structureId || null, lines: req.body?.lines });
    res.json({ ...r, annexure: annexure(annualCtc, r.lines) });
  } catch (e) {
    offerError(res, e);
  }
});

peopleLettersRouter.post(`${base}/offers`, can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  /* An offer to a candidate also changes the candidate: it needs the Recruitment grant too. */
  if (req.body?.candidateId) {
    const refused = await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT as any, 'Recruitment');
    if (refused) return res.status(refused.status).json(refused.body);
  }
  try {
    res.status(201).json(await createOffer(actorOf(req), req.body && typeof req.body === 'object' ? req.body : {}));
  } catch (e) {
    offerError(res, e);
  }
});

peopleLettersRouter.get(`${base}/offers`, can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ offers: await offersOf(req.tenant!.orgId, { employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined, candidateId: req.query.candidateId ? String(req.query.candidateId) : undefined }) });
});

peopleLettersRouter.post(`${base}/offers/:id/withdraw`, can(PermissionAction.CREATE, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ offer: await withdrawOffer(actorOf(req), String(req.params.id)) });
  } catch (e) {
    offerError(res, e);
  }
});

/** Someone asked for a letter: an HR task on the record, due by the statutory day where there is one. */
peopleLettersRouter.post(`${base}/employees/:id/letters/requests`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  try {
    res.status(201).json(await recordLetterRequest(actorOf(req), employee.id, { kind: req.body?.kind, askedOn: req.body?.askedOn }));
  } catch (e) {
    sendError(res, e);
  }
});

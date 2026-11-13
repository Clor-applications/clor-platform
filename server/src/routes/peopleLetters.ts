import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { OfferError, annexure, createOffer, linesFor, offerSetup, offersOf, withdrawOffer } from '../services/people/offers.js';
import { EVENT_OF, LETTER_KINDS, LETTER_LABEL, LetterError, MERGE_FIELDS, issueLetter, letterSettings, recordLetterRequest, saveLetterSettings, saveTemplate, serviceCertificateDue, templatesOf, versionsOf } from '../services/people/letters.js';
import { recordAudit } from '../services/auditTrail.js';
import { z } from 'zod';
import { check, id, idParams, jsonObject, list, num, q, text } from '../middleware/validate.js';

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

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for
 * it, stay the services' (letters.ts, offers.ts). A date asked on that is not one is still read as today, as before.
 * A template's body may be as long as the JSON limit ("Keep the letter under 20,000 characters." is the service's
 * to say); a letter's `extra` is its own merge values, whatever the template names, each cut to 1,000 characters
 * by the service.
 */
/* A day the offer reads as "not said" when it is empty; any other must be YYYY-MM-DD, in its words. */
const day = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Dates are YYYY-MM-DD.');
/* A number a form may send as its text: the service makes the number and has the words for one that is not. */
const amount = z.union([num(-1e15, 1e15), text(40)]);
/* An id in a body: "" reads as none. */
const ref = text(200);
/* The pay: a CTC, and a salary structure or typed monthly lines ("At most 30 lines." is the service's to say). */
const PAY = { annualCtc: amount.nullish(), structureId: ref.nullish(), lines: list(z.object({ label: text(2000).nullish(), monthly: amount.nullish() }), 500).nullish() };
const OFFER = z.object({
  employeeId: ref.nullish(), candidateId: ref.nullish(), email: text(2000).nullish(), designation: text(2000).nullish(), joiningDate: day.nullish(), acceptBy: day.nullish(),
  signatory: text(2000).nullish(), message: text(20_000).nullish(), ...PAY,
});

peopleLettersRouter.get(`${base}/letter-templates`, can(PermissionAction.VIEW, DOCUMENTS), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const [templates, settings] = await Promise.all([templatesOf(req.tenant!.orgId), letterSettings(req.tenant!.orgId)]);
  /* `issuedWhen`: the event that issues the company's own letter of this kind by itself (People plan 8 Nov 2026, step 6). */
  res.json({ templates, kinds: LETTER_KINDS.map((k) => ({ kind: k, label: LETTER_LABEL[k], issuedWhen: EVENT_OF[k] || null })), mergeFields: MERGE_FIELDS, signatory: settings.signatory });
});

/** Who signs the letters CLOR issues by itself and the ones asked for in the app. */
peopleLettersRouter.put(`${base}/letter-settings`, can(PermissionAction.EDIT, DOCUMENTS), check({ body: z.object({ signatory: text(2000).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const before = await letterSettings(req.tenant!.orgId);
    const after = await saveLetterSettings(actorOf(req), { signatory: req.body?.signatory });
    if (before.signatory !== after.signatory) await recordAudit(req, { entity: 'COMPANY_SETTING', entityId: 'letters.signatory', action: 'CHANGED', message: `Letters signed by: ${before.signatory || 'nobody named'} → ${after.signatory || 'nobody named'}`, metadata: { before: before.signatory, after: after.signatory } });
    res.json(after);
  } catch (e) {
    sendError(res, e);
  }
});

peopleLettersRouter.get(`${base}/letter-templates/:kind/versions`, can(PermissionAction.VIEW, DOCUMENTS), check({ params: z.object({ kind: id }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ versions: await versionsOf(req.tenant!.orgId, String(req.params.kind).toUpperCase()) });
});

peopleLettersRouter.post(`${base}/letter-templates`, can(PermissionAction.EDIT, DOCUMENTS), check({ body: z.object({ kind: text(40).nullish(), name: text(2000).nullish(), body: text(1024 * 1024).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ template: await saveTemplate(actorOf(req), { kind: req.body?.kind, name: req.body?.name, body: req.body?.body }) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleLettersRouter.post(`${base}/employees/:id/letters`, can(PermissionAction.CREATE, DOCUMENTS), check({ params: idParams, body: z.object({ kind: text(40).nullish(), extra: jsonObject().nullish(), classification: text(40).nullish() }) }), async (req, res) => {
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

peopleLettersRouter.get(`${base}/employees/:id/letters/service-certificate`, can(PermissionAction.VIEW, EMPLOYEES), check({ params: idParams, query: z.object({ askedOn: q(text(40)) }) }), async (req, res) => {
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
peopleLettersRouter.post(`${base}/offers/preview`, can(PermissionAction.CREATE, DOCUMENTS), check({ body: z.object(PAY) }), async (req, res) => {
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

peopleLettersRouter.post(`${base}/offers`, can(PermissionAction.CREATE, DOCUMENTS), check({ body: OFFER }), async (req, res) => {
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

peopleLettersRouter.get(`${base}/offers`, can(PermissionAction.VIEW, DOCUMENTS), check({ query: z.object({ employeeId: q(ref), candidateId: q(ref) }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  /* An offer carries the pay offered: a team-limited role sees offers to its own team only, never to candidates. */
  const scope = await teamScope(req);
  if (!scope.all && req.query.candidateId) return res.json({ offers: [] });
  res.json({ offers: await offersOf(req.tenant!.orgId, { employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined, candidateId: req.query.candidateId ? String(req.query.candidateId) : undefined, ...(scope.all ? {} : { employeeIds: scope.ids }) }) });
});

peopleLettersRouter.post(`${base}/offers/:id/withdraw`, can(PermissionAction.CREATE, DOCUMENTS), check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  /* An offer outside a team-limited role's team (or to a candidate) reads as absent, as on the list. */
  const scope = await teamScope(req);
  if (!scope.all) {
    const offer = await peoplePrisma.offer.findFirst({ where: { id: String(req.params.id), orgId: req.tenant!.orgId }, select: { employeeId: true } });
    if (!offer?.employeeId || !inScope(scope, offer.employeeId)) return res.status(404).json({ error: 'No such offer.' });
  }
  try {
    res.json({ offer: await withdrawOffer(actorOf(req), String(req.params.id)) });
  } catch (e) {
    offerError(res, e);
  }
});

/** Someone asked for a letter: an HR task on the record, due by the statutory day where there is one. */
peopleLettersRouter.post(`${base}/employees/:id/letters/requests`, can(PermissionAction.EDIT, EMPLOYEES), check({ params: idParams, body: z.object({ kind: text(40).nullish(), askedOn: text(40).nullish() }) }), async (req, res) => {
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

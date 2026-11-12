import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { CaseKeyMissing } from '../services/people/caseBox.js';
import { z } from 'zod';
import { check, flag, id, idParams, list, rawText, text } from '../middleware/validate.js';
import { CaseError, addEvidence, advance, annualReport, committeeOf, intake, myCases, onPoshCommittee, openCase, openEvidence, saveCommittee } from '../services/people/privateCases.js';

/**
 * Private cases (docs/people/02-PRD.md PRIV-01..06). The grant lets someone
 * take a case in and set up the committee; opening a case needs being named
 * on it — a company admin who is not named gets "no such case".
 */
export const peoplePrivateCasesRouter = Router();
peoplePrivateCasesRouter.use(requireAuth, requireTenantContext);

const { privateCases: CASES } = PEOPLE_RESOURCE;
const can = (action: string) => requirePermission(PEOPLE_MODULE, action as any, CASES);
const base = '/orgs/:orgId/people/private-cases';
const who = (req: Request) => ({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null });
const sendError = (res: any, e: unknown) => {
  if (e instanceof CaseError) return res.status(e.status).json({ error: e.message });
  if (e instanceof CaseKeyMissing) return res.status(503).json({ error: e.message, code: 'CASE_KEY_MISSING' });
  console.error('[people-private-cases]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

/*
 * What each route takes, checked before its handler (middleware/validate.ts). A wrong kind of value or one far too
 * long is refused with a 400; keys not named here are dropped; whether a field must be there, and the words for it,
 * stay the service's (privateCases.ts): an account over 20,000 characters still gets the service's sentence, so the
 * bound here is well above it. Dates stay text for the same reason.
 */
const INTAKE = z.object({ kind: text(40).nullish(), complainantEmployeeId: text(80).nullish(), respondentEmployeeIds: list(text(80), 200).nullish(), summary: text(200_000).nullish(), incidentOn: text(40).nullish() });
const MEMBER = z.object({ userId: text(80).nullish(), role: text(40).nullish(), gender: text(40).nullish(), external: flag.nullish(), termStart: text(40).nullish(), termEnd: text(40).nullish(), name: text(1000).nullish() });
const KIND_PARAMS = z.object({ kind: text(40) });
/* Evidence is a data URL (or base64 with its type beside it), within the 1 MB a request may carry. */
const EVIDENCE = z.object({ title: text(1000).nullish(), data: rawText(2_000_000).nullish(), mime: text(200).nullish() });

/** The cases I am named on; nobody else learns a case exists. `annualReport`: whether I may open the POSH annual report. */
peoplePrivateCasesRouter.get(base, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ cases: await myCases(req.tenant!.orgId, req.auth!.userId), annualReport: await mayReadReport(req) });
});

/** The POSH annual report is the Internal Committee's to file: its members read it, as do those holding the Private Cases grant. Counts only. */
async function mayReadReport(req: Request) {
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, CASES))) return true;
  return onPoshCommittee(req.tenant!.orgId, req.auth?.userId || '');
}

peoplePrivateCasesRouter.post(base, can(PermissionAction.CREATE), check({ body: INTAKE }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ case: await intake(who(req), { ...(req.body || {}), onBehalf: true }) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.get(`${base}/committee/:kind`, can(PermissionAction.VIEW), check({ params: KIND_PARAMS }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ committee: await committeeOf(req.tenant!.orgId, String(req.params.kind).toUpperCase()) });
});

peoplePrivateCasesRouter.put(`${base}/committee/:kind`, can(PermissionAction.EDIT), check({ params: KIND_PARAMS, body: z.object({ members: list(MEMBER, 200).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ committee: await saveCommittee(who(req), String(req.params.kind).toUpperCase(), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

/** The POSH annual report: counts only (PRIV-05), for the committee and the grant (gap 12). */
peoplePrivateCasesRouter.get(`${base}/report/:year`, check({ params: z.object({ year: text(20) }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await mayReadReport(req))) return res.status(403).json({ error: 'The annual report is for the Internal Committee and those who keep confidential cases.' });
  const year = Number(req.params.year);
  if (!Number.isInteger(year) || year < 2013 || year > 2100) return res.status(400).json({ error: 'Give a year.' });
  res.json({ report: await annualReport(req.tenant!.orgId, year, req.tenant!.accountId) });
});

peoplePrivateCasesRouter.get(`${base}/:id`, check({ params: idParams }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ case: await openCase(req.tenant!.orgId, String(req.params.id), req.auth!.userId) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.post(`${base}/:id/evidence`, check({ params: idParams, body: EVIDENCE }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ evidence: await addEvidence(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.get(`${base}/:id/evidence/:evidenceId`, check({ params: z.object({ id, evidenceId: id }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ evidence: await openEvidence(who(req), String(req.params.id), String(req.params.evidenceId)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.post(`${base}/:id/advance`, check({ params: idParams, body: z.object({ step: text(40).nullish(), on: text(40).nullish(), reason: text(5000).nullish(), outcome: text(20_000).nullish() }) }), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ case: await advance(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { CaseKeyMissing } from '../services/people/caseBox.js';
import { CaseError, addEvidence, advance, annualReport, committeeOf, intake, myCases, openCase, openEvidence, saveCommittee } from '../services/people/privateCases.js';

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

/** The cases I am named on; nobody else learns a case exists. */
peoplePrivateCasesRouter.get(base, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ cases: await myCases(req.tenant!.orgId, req.auth!.userId) });
});

peoplePrivateCasesRouter.post(base, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ case: await intake(who(req), { ...(req.body || {}), onBehalf: true }) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.get(`${base}/committee/:kind`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ committee: await committeeOf(req.tenant!.orgId, String(req.params.kind).toUpperCase()) });
});

peoplePrivateCasesRouter.put(`${base}/committee/:kind`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ committee: await saveCommittee(who(req), String(req.params.kind).toUpperCase(), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

/** The POSH annual report: counts only (PRIV-05). */
peoplePrivateCasesRouter.get(`${base}/report/:year`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const year = Number(req.params.year);
  if (!Number.isInteger(year) || year < 2013 || year > 2100) return res.status(400).json({ error: 'Give a year.' });
  res.json({ report: await annualReport(req.tenant!.orgId, year) });
});

peoplePrivateCasesRouter.get(`${base}/:id`, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ case: await openCase(req.tenant!.orgId, String(req.params.id), req.auth!.userId) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.post(`${base}/:id/evidence`, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ evidence: await addEvidence(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.get(`${base}/:id/evidence/:evidenceId`, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ evidence: await openEvidence(who(req), String(req.params.id), String(req.params.evidenceId)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePrivateCasesRouter.post(`${base}/:id/advance`, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ case: await advance(who(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

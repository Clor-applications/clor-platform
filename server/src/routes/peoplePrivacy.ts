import { Router, type Request, type Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { AnonymiseError } from '../services/anonymiseEmployee.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import {
  ACCESS_KINDS, PrivacyError, accessReport, auditorEvidence, createAuditorGrant, decideDeletion, deletionReview,
  openAuditorDocument, retentionSchedule, revokeAuditorGrant, saveRetention,
} from '../services/people/privacy.js';

/**
 * Privacy (docs/people/02-PRD.md PRV-03, 06, 07): the access audit, the
 * retention schedule with legal hold, the deletion review, and auditor
 * grants. The auditor's own evidence routes need no People grant at all:
 * a live AuditorGrant naming the document is the only key.
 */
export const peoplePrivacyRouter = Router();
peoplePrivacyRouter.use(requireAuth, requireTenantContext);

const { privacy: PRIVACY } = PEOPLE_RESOURCE;
const can = (action: string) => requirePermission(PEOPLE_MODULE, action as any, PRIVACY);
const base = '/orgs/:orgId/people/privacy';
const sendError = (res: Response, e: unknown) => {
  if (e instanceof PrivacyError || e instanceof AnonymiseError) return res.status(e.status).json({ error: e.message, code: e.code });
  console.error('[people-privacy]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await fn(req, res);
  } catch (e) {
    sendError(res, e);
  }
};
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** Who viewed what, for a period (this month by default), optionally for one person. */
peoplePrivacyRouter.get(`${base}/access`, can(PermissionAction.VIEW), run(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const report = await accessReport({ orgId: req.tenant!.orgId, from: q.from, to: q.to, employeeId: q.employeeId || undefined, what: q.what || undefined });
  if (q.format === 'csv') {
    const lines = [['When', 'Who', 'What', 'Person', 'Detail'], ...report.views.map((v) => [new Date(v.at).toISOString(), v.user, v.label, v.employee || '', v.detail || ''])];
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="access-${report.from}-to-${report.to}.csv"`);
    return res.send(lines.map((l) => l.map(csvCell).join(',')).join('\n'));
  }
  res.json({ ...report, kinds: ACCESS_KINDS });
}));

peoplePrivacyRouter.get(`${base}/retention`, can(PermissionAction.VIEW), run(async (req, res) => {
  res.json({ schedule: await retentionSchedule(req.tenant!.orgId) });
}));

peoplePrivacyRouter.put(`${base}/retention/:dataType`, can(PermissionAction.EDIT), run(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  res.json({ rule: await saveRetention({ keepYears: req.body?.keepYears, legalHold: req.body?.legalHold, holdReason: req.body?.holdReason, accountId, orgId, userId: req.auth!.userId, dataType: String(req.params.dataType) }) });
}));

peoplePrivacyRouter.get(`${base}/deletion-review`, can(PermissionAction.VIEW), run(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const status = String(req.query.status ?? 'PENDING').toUpperCase();
  res.json(await deletionReview(accountId, orgId, ['PENDING', 'APPROVED', 'KEPT'].includes(status) ? status : ''));
}));

/** Erasing is DELETE; keeping is a decision too, so it needs EDIT. */
peoplePrivacyRouter.post(`${base}/deletion-review/:id`, can(PermissionAction.EDIT), run(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const decision = String(req.body?.decision || '').toUpperCase();
  if (decision === 'APPROVE') {
    if (await authorize(req, PEOPLE_MODULE, PermissionAction.DELETE, PRIVACY)) return res.status(403).json({ error: 'Erasing needs the Privacy delete grant.', code: 'FORBIDDEN' });
  }
  res.json({ item: await decideDeletion({ accountId, orgId, userId: req.auth!.userId, id: String(req.params.id), decision, note: req.body?.note }) });
}));

peoplePrivacyRouter.get(`${base}/auditor-grants`, can(PermissionAction.VIEW), run(async (req, res) => {
  const rows = await peoplePrisma.auditorGrant.findMany({ where: { orgId: req.tenant!.orgId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const now = new Date();
  res.json({ grants: rows.map((g) => ({ ...g, live: !g.revokedAt && g.fromAt <= now && g.untilAt > now })) });
}));

peoplePrivacyRouter.post(`${base}/auditor-grants`, can(PermissionAction.EDIT), run(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  res.status(201).json({ grant: await createAuditorGrant({ userId: req.body?.userId, purpose: req.body?.purpose, documentIds: req.body?.documentIds, fromAt: req.body?.fromAt, untilAt: req.body?.untilAt, accountId, orgId, grantedByUserId: req.auth!.userId }) });
}));

peoplePrivacyRouter.post(`${base}/auditor-grants/:id/revoke`, can(PermissionAction.EDIT), run(async (req, res) => {
  res.json({ grant: await revokeAuditorGrant(req.tenant!.orgId, String(req.params.id)) });
}));

/** The auditor's view: only what a live grant names, and every open is logged. */
peoplePrivacyRouter.get('/orgs/:orgId/people/audit-evidence', run(async (req, res) => {
  res.set('Cache-Control', 'private, no-store').json(await auditorEvidence(req.tenant!.orgId, req.auth!.userId));
}));

peoplePrivacyRouter.get('/orgs/:orgId/people/audit-evidence/:docId', run(async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  res.set('Cache-Control', 'private, no-store').json({ document: await openAuditorDocument({ accountId, orgId, userId: req.auth!.userId, documentId: String(req.params.docId) }) });
}));

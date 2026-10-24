import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { ComplianceError, checkRule, employeeRegister, leaveRegister, obligationsOf, rulesOf, saveRuleVersion, updateObligation } from '../services/people/complianceRules.js';

/**
 * Compliance (docs/people/02-PRD.md COMP-01..06): the rule library with
 * versions and checks, the obligations they produce, and the registers.
 * Employees VIEW reads; Org Structure EDIT writes rules; Employees EDIT
 * acts on obligations.
 */
export const peopleComplianceRouter = Router();
peopleComplianceRouter.use(requireAuth, requireTenantContext);

const { employees: EMPLOYEES, structure: STRUCTURE } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people/compliance';
const sendError = (res: any, e: unknown) => {
  if (e instanceof ComplianceError) return res.status(e.status).json({ error: e.message });
  console.error('[people-compliance]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

peopleComplianceRouter.get(`${base}/rules`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  res.json({ rules: await rulesOf(accountId, orgId, { all: req.query.all === '1' }) });
});

peopleComplianceRouter.post(`${base}/rules`, can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    res.status(201).json({ rule: await saveRuleVersion({ accountId, orgId, userId: req.auth!.userId }, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.post(`${base}/rules/:ruleId/versions/:v/check`, can(PermissionAction.EDIT, STRUCTURE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ rule: await checkRule({ orgId: req.tenant!.orgId, userId: req.auth!.userId }, String(req.params.ruleId), Number(req.params.v)) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.get(`${base}/obligations`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  res.json({ obligations: await obligationsOf(accountId, orgId, { status: String(req.query.status || '').toUpperCase() || undefined, establishmentId: String(req.query.establishmentId || '') || undefined }) });
});

peopleComplianceRouter.patch(`${base}/obligations/:id`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await updateObligation({ orgId: req.tenant!.orgId, userId: req.auth!.userId }, String(req.params.id), req.body || {});
    const { accountId, orgId } = req.tenant!;
    res.json({ obligation: (await obligationsOf(accountId, orgId)).find((o) => o.id === String(req.params.id)) || null });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.get(`${base}/registers/employees`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await employeeRegister(req.tenant!.orgId, String(req.query.establishmentId || '') || null));
});

peopleComplianceRouter.get(`${base}/registers/leave`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Give the range as from and to, YYYY-MM-DD.' });
  res.json(await leaveRegister(req.tenant!.orgId, String(req.query.establishmentId || '') || null, from, to));
});

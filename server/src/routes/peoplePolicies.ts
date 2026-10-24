import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { CATEGORY_LABEL, POLICY_CATEGORIES, PolicyError, addVersion, conflicts, createPolicy, listPolicies, peopleInScope, cleanAppliesTo, policiesFor, policyDetail, retireVersion, submitVersion, updatePolicy, updateVersion } from '../services/people/policies.js';
import { AckError, remind, report } from '../services/people/acknowledgements.js';

/**
 * Policies (docs/people/02-PRD.md POL-01..06): the library, versions, who
 * each applies to, publishing through the rule, acceptance and reminders.
 */
export const peoplePoliciesRouter = Router();
peoplePoliciesRouter.use(requireAuth, requireTenantContext);

const { policies: POLICIES, employees: EMPLOYEES } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof PolicyError || e instanceof AckError) return res.status(e.status).json({ error: e.message });
  console.error('[people-policies]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};
const versionParam = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

peoplePoliciesRouter.get(`${base}/policies`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ policies: await listPolicies(req.tenant!.orgId, { q: String(req.query.q || ''), category: String(req.query.category || '') || undefined, includeInactive: req.query.all === '1' }), categories: POLICY_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })) });
});

peoplePoliciesRouter.get(`${base}/policies/conflicts`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ conflicts: await conflicts(req.tenant!.orgId, asOf) });
});

/** Who a rule would reach, before it is saved. */
peoplePoliciesRouter.post(`${base}/policies/scope`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const people = await peopleInScope(req.tenant!.orgId, cleanAppliesTo(req.body?.appliesTo));
  res.json({ count: people.length, sample: people.slice(0, 8).map((p) => ({ id: p.id, name: p.name, code: p.code })) });
});

peoplePoliciesRouter.post(`${base}/policies`, can(PermissionAction.CREATE, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const p = await createPolicy(actorOf(req), req.body || {});
    res.status(201).json({ policy: await policyDetail(req.tenant!.orgId, p.id) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.get(`${base}/policies/:id`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ policy: await policyDetail(req.tenant!.orgId, String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.put(`${base}/policies/:id`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    await updatePolicy(actorOf(req), String(req.params.id), req.body || {});
    res.json({ policy: await policyDetail(req.tenant!.orgId, String(req.params.id)) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.status(201).json({ version: await addVersion(actorOf(req), String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.put(`${base}/policies/:id/versions/:v`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json({ version: await updateVersion(actorOf(req), String(req.params.id), v, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

/** Send for publishing: the policy's owner or anyone with Policies EDIT; with a rule it waits, without one it goes live now. */
peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/submit`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json(await submitVersion(actorOf(req), String(req.params.id), v));
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/retire`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  if (!v) return res.status(404).json({ error: 'No such version.' });
  try {
    res.json({ version: await retireVersion(actorOf(req), String(req.params.id), v, req.body?.effectiveTo) });
  } catch (e) {
    sendError(res, e);
  }
});

peoplePoliciesRouter.get(`${base}/policies/:id/versions/:v/acknowledgements`, can(PermissionAction.VIEW, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  const row = v ? await peoplePrisma.policyVersion.findFirst({ where: { policyId: String(req.params.id), version: v, orgId: req.tenant!.orgId }, select: { id: true } }) : null;
  if (!row) return res.status(404).json({ error: 'No such version.' });
  res.json(await report(req.tenant!.orgId, 'POLICY_VERSION', row.id));
});

peoplePoliciesRouter.post(`${base}/policies/:id/versions/:v/remind`, can(PermissionAction.EDIT, POLICIES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const v = versionParam(req.params.v);
  const row = v ? await peoplePrisma.policyVersion.findFirst({ where: { policyId: String(req.params.id), version: v, orgId: req.tenant!.orgId }, include: { policy: { select: { title: true } } } }) : null;
  if (!row) return res.status(404).json({ error: 'No such version.' });
  const { accountId, orgId } = req.tenant!;
  res.json({ reminded: await remind({ accountId, orgId, userId: req.auth!.userId }, 'POLICY_VERSION', row.id, { title: `Please read and accept: ${row.policy.title}`, body: `Version ${row.version}, from ${row.effectiveFrom}.` }) });
});

/** What applies to one person on a day: HR's view of what the person sees. */
peoplePoliciesRouter.get(`${base}/employees/:id/policies`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.json({ policies: await policiesFor(req.tenant!.orgId, String(req.params.id), asOf) });
});

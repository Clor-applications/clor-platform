import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { seesPersonal, teamScope } from '../services/people/scope.js';
import { isFeatureEnabled } from '../services/features.js';
import { leaveSummary, musterRoll } from '../services/people/registers.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ComplianceError, REGISTRATION_TYPES, addOwnObligation, addProof, checkRule, employeeRegister, leaveRegister, obligationsOf, proofFile, registrationLabel, registrationsOf, removeProof, rulesOf, saveRuleVersion, updateObligation } from '../services/people/complianceRules.js';

/**
 * Compliance (docs/people/02-PRD.md COMP-01..06): the rule library with
 * versions and checks, the obligations they produce, and the registers.
 * Employees VIEW reads; Org Structure EDIT writes rules; Employees EDIT
 * acts on obligations (whole-company HR only: a manager whose role covers
 * their own team does not file the company's returns).
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

/** The company's filings are whole-company HR work. */
async function wholeCompany(req: any, res: any) {
  if ((await teamScope(req)).all) return true;
  res.status(403).json({ error: 'This is HR work for the whole company; your role covers your own team.' });
  return false;
}

/** The registers are the company's statutory books: whole company, personal details included, so only for those who keep the records. */
async function keepsRegisters(req: any, res: any) {
  if ((await teamScope(req)).all && (await seesPersonal(req))) return true;
  res.status(403).json({ error: 'The registers carry everyone’s personal details; they are for those who keep the employee records.' });
  return false;
}

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
  res.json({ obligations: await obligationsOf(accountId, orgId, { status: String(req.query.status || '').toUpperCase() || undefined, establishmentId: String(req.query.establishmentId || '') || undefined, id: String(req.query.id || '') || undefined }) });
});

/** A deadline of the company's own, beside what the rules bring. */
peopleComplianceRouter.post(`${base}/obligations`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const row = await addOwnObligation({ accountId, orgId, userId: req.auth!.userId }, req.body || {});
    res.status(201).json({ obligation: (await obligationsOf(accountId, orgId, { id: row.id }))[0] || null });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.patch(`${base}/obligations/:id`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  try {
    await updateObligation({ orgId: req.tenant!.orgId, userId: req.auth!.userId }, String(req.params.id), req.body || {});
    const { accountId, orgId } = req.tenant!;
    res.json({ obligation: (await obligationsOf(accountId, orgId, { id: String(req.params.id) }))[0] || null });
  } catch (e) {
    sendError(res, e);
  }
});

/** Proof files: the challan, the receipt, the certificate. */
peopleComplianceRouter.post(`${base}/obligations/:id/proofs`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    res.status(201).json({ proof: await addProof({ accountId, orgId, userId: req.auth!.userId }, String(req.params.id), req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.get(`${base}/obligations/:id/proofs/:proofId`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ proof: await proofFile(req.tenant!.orgId, String(req.params.id), String(req.params.proofId)) });
  } catch (e) {
    sendError(res, e);
  }
});

peopleComplianceRouter.delete(`${base}/obligations/:id/proofs/:proofId`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  try {
    await removeProof(req.tenant!.orgId, String(req.params.id), String(req.params.proofId));
    res.status(204).end();
  } catch (e) {
    sendError(res, e);
  }
});

/** Who can own an obligation: the company's users by name, and the outside owners already named (the CA, a consultant). Names only. */
peopleComplianceRouter.get(`${base}/owners`, can(PermissionAction.EDIT, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res)) || !(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [members, named] = await Promise.all([
    platformPrisma.userOrgMembership.findMany({ where: { accountId, orgId }, select: { user: { select: { id: true, fullName: true, email: true, isActive: true } } } }),
    peoplePrisma.obligation.findMany({ where: { orgId, ownerName: { not: null } }, select: { ownerName: true }, distinct: ['ownerName'], take: 50 }),
  ]);
  res.json({
    users: members.map((m) => m.user).filter((u) => u && u.isActive !== false).map((u) => ({ id: u.id, name: u.fullName || u.email })).sort((a, b) => a.name.localeCompare(b.name)),
    names: named.map((n) => n.ownerName).filter(Boolean),
  });
});

/** Each work site's statutory registrations (PF, ESI, Shops & Establishments…), with what runs out soon, read from the work sites. */
peopleComplianceRouter.get(`${base}/registrations`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const sites = await peoplePrisma.establishment.findMany({ where: { orgId: req.tenant!.orgId, isActive: true }, select: { id: true, name: true, state: true, kind: true, registrations: true }, orderBy: { name: 'asc' } });
  res.json({
    types: Object.entries(REGISTRATION_TYPES).map(([value, label]) => ({ value, label })),
    sites: sites.map((s) => ({ id: s.id, name: s.name, state: s.state, kind: s.kind, registrations: registrationsOf(s.registrations).map((r) => ({ ...r, label: registrationLabel(r.type) })) })),
  });
});

peopleComplianceRouter.get(`${base}/registers/employees`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await keepsRegisters(req, res))) return;
  res.json(await employeeRegister(req.tenant!.orgId, String(req.query.establishmentId || '') || null));
});

peopleComplianceRouter.get(`${base}/registers/leave`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await keepsRegisters(req, res))) return;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Give the range as from and to, YYYY-MM-DD.' });
  res.json(await leaveRegister(req.tenant!.orgId, String(req.query.establishmentId || '') || null, from, to));
});

/** Muster roll for a month (YYYY-MM), from the day record; built for a People-only company too (services/people/registers.ts). */
peopleComplianceRouter.get(`${base}/registers/muster`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await keepsRegisters(req, res))) return;
  const month = String(req.query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Give the month as YYYY-MM.' });
  const { accountId, orgId } = req.tenant!;
  res.json(await musterRoll(accountId, orgId, month, String(req.query.establishmentId || '') || null, await isFeatureEnabled(accountId, orgId, 'attendance')));
});

/** Leave taken in a range by department and type, paid and unpaid. */
peopleComplianceRouter.get(`${base}/registers/leave-summary`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  if (!(await keepsRegisters(req, res))) return;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Give the range as from and to, YYYY-MM-DD.' });
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) return res.status(400).json({ error: 'A summary covers at most a year.' });
  res.json(await leaveSummary(req.tenant!.orgId, String(req.query.establishmentId || '') || null, from, to));
});

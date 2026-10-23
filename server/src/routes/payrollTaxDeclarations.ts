import { Router } from 'express';
import { ownRecordRefusal, ownWorkRefusal } from '../services/makerChecker.js';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { recordAudit } from '../services/auditTrail.js';
import { DeclarationError, financialYearOf, parseItems, saveDeclaration, shapeDeclaration } from '../services/payroll/taxDeclaration.js';

/**
 * Income tax declarations and proofs, HR's side. Employees declare from the
 * portal (routes/portal.ts); HR can enter or correct a declaration for anyone,
 * enter what the proofs support, and verify it — after which tax is withheld
 * on the verified amounts (services/payroll/taxDeclaration.ts).
 */
export const payrollTaxDeclarationsRouter = Router();
payrollTaxDeclarationsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.profile;
const VIEW = requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE);
const EDIT = requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE);

const fyOf = (q: unknown) => (/^\d{4}-\d{2}$/.test(String(q || '')) ? String(q) : financialYearOf(new Date().toISOString().slice(0, 10)));

const fail = (res: any, e: unknown) => {
  if (e instanceof DeclarationError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

/** Everybody in payroll, with where their declaration for the year stands. */
payrollTaxDeclarationsRouter.get('/orgs/:orgId/payroll/tax-declarations', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const financialYear = fyOf(req.query.fy);
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { accountId, orgId, payrollStatus: 'IN_PAYROLL' }, select: { employeeId: true, taxRegime: true } });
  const ids = profiles.map((p) => p.employeeId);
  const [people, rows] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids }, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    payrollPrisma.taxDeclaration.findMany({ where: { orgId, financialYear, employeeId: { in: ids } } }),
  ]);
  const byEmployee = new Map(rows.map((r) => [r.employeeId, r]));
  const regimeOf = new Map(profiles.map((p) => [p.employeeId, p.taxRegime]));
  res.json({
    financialYear,
    people: people.map((p) => {
      const d = byEmployee.get(p.id);
      const items = parseItems(d?.itemsJson);
      return {
        employeeId: p.id,
        name: p.name,
        code: p.code,
        regime: d?.regime || regimeOf.get(p.id) || 'NEW',
        status: d?.status || 'NONE',
        declared: items.reduce((t, i) => t + Number(i.declared || 0), 0) + Number(d?.monthlyRent || 0) * 12,
        verified: d?.status === 'VERIFIED' ? items.reduce((t, i) => t + Number(i.verified || 0), 0) : null,
        updatedAt: d?.updatedAt || null,
      };
    }),
  });
});

async function employeeOk(req: any, res: any) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.employeeId), accountId: req.tenant.accountId, orgId: req.tenant.orgId }, select: { id: true, name: true } });
  if (!e) res.status(404).json({ error: 'No such employee.' });
  return e;
}

payrollTaxDeclarationsRouter.get('/orgs/:orgId/payroll/tax-declarations/:employeeId', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  const row = await payrollPrisma.taxDeclaration.findUnique({ where: { orgId_employeeId_financialYear: { orgId: req.tenant!.orgId, employeeId: e.id, financialYear } } });
  res.json({ declaration: { ...shapeDeclaration(row, e.id, financialYear), employeeName: e.name } });
});

payrollTaxDeclarationsRouter.put('/orgs/:orgId/payroll/tax-declarations/:employeeId', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  try {
    const row = await saveDeclaration(req.tenant!, e.id, financialYear, req.body, { userId: req.auth!.userId, asEmployee: false });
    res.json({ declaration: { ...shapeDeclaration(row, e.id, financialYear), employeeName: e.name } });
  } catch (err) {
    return fail(res, err);
  }
});

/** Proofs checked: tax from here on is on the verified amounts. */
payrollTaxDeclarationsRouter.post('/orgs/:orgId/payroll/tax-declarations/:employeeId/verify', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  const where = { orgId_employeeId_financialYear: { orgId: req.tenant!.orgId, employeeId: e.id, financialYear } };
  const row = await payrollPrisma.taxDeclaration.findUnique({ where });
  if (!row) return res.status(404).json({ error: 'Nothing has been declared for this year.' });
  if (row.status === 'VERIFIED') return res.status(409).json({ error: 'Already verified.', code: 'VERIFIED' });
  /*
   * A-13: verifying sets the tax deducted from someone's pay. Never your own;
   * and whoever last entered the figures verifies them only as the company's
   * maker-checker setting allows (this resource has no APPROVE action, so only
   * an administrator counts as "somebody else who could").
   */
  const refused =
    (await ownRecordRefusal(req, e.id, 'tax declaration')) ||
    (await ownWorkRefusal(req, { makers: [row.updatedByUserId], module: PAYROLL_MODULE, resource: RESOURCE, entity: 'PAYROLL_TAX_DECLARATION', entityId: row.id, what: 'tax declaration' }));
  if (refused) return res.status(refused.status).json(refused.body);
  const moved = await payrollPrisma.taxDeclaration.updateMany({ where: { id: row.id, status: { not: 'VERIFIED' } }, data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedByUserId: req.auth!.userId, updatedByUserId: req.auth!.userId } });
  if (moved.count !== 1) return res.status(409).json({ error: 'Already verified.', code: 'VERIFIED' });
  const updated = await payrollPrisma.taxDeclaration.findUniqueOrThrow({ where: { id: row.id } });
  await recordAudit(req, {
    entity: 'PAYROLL_TAX_DECLARATION',
    entityId: row.id,
    action: 'VERIFY',
    message: `Verified ${e.name}’s tax declaration for ${financialYear}`,
    metadata: { employeeId: e.id, financialYear, regime: row.regime, items: parseItems(row.itemsJson).map(({ code, declared, verified }) => ({ code, declared, verified })) },
  });
  res.json({ declaration: { ...shapeDeclaration(updated, e.id, financialYear), employeeName: e.name } });
});

payrollTaxDeclarationsRouter.post('/orgs/:orgId/payroll/tax-declarations/:employeeId/reopen', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  const where = { orgId_employeeId_financialYear: { orgId: req.tenant!.orgId, employeeId: e.id, financialYear } };
  const row = await payrollPrisma.taxDeclaration.findUnique({ where });
  if (!row || row.status !== 'VERIFIED') return res.status(409).json({ error: 'Only a verified declaration can be reopened.', code: 'NOT_VERIFIED' });
  const updated = await payrollPrisma.taxDeclaration.update({ where, data: { status: 'SUBMITTED', verifiedAt: null, verifiedByUserId: null, updatedByUserId: req.auth!.userId } });
  await recordAudit(req, { entity: 'PAYROLL_TAX_DECLARATION', entityId: row.id, action: 'REOPEN', message: `Reopened ${e.name}’s tax declaration for ${financialYear}`, metadata: { employeeId: e.id, financialYear } });
  res.json({ declaration: { ...shapeDeclaration(updated, e.id, financialYear), employeeName: e.name } });
});

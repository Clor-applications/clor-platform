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
import { OpeningError, checkOpening, firstPayrollYearOf, parseOpeningCsv, shapeOpening } from '../services/payroll/openingYtd.js';
import { todayIst } from '../utils/istDate.js';

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

/* This year is India's year: at 00:30 IST on 1 April the UTC date is still 31 March. */
const fyOf = (q: unknown) => (/^\d{4}-\d{2}$/.test(String(q || '')) ? String(q) : financialYearOf(todayIst()));

const fail = (res: any, e: unknown) => {
  if (e instanceof DeclarationError || e instanceof OpeningError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

/* ------------------------------------------------------------------ */
/* Opening year-to-date figures (audit 7 Nov 2026, #2)                 */
/* Registered before /tax-declarations/:employeeId so no path is read  */
/* as an employee id.                                                  */
/* ------------------------------------------------------------------ */

/** Everybody in payroll, with what was paid them earlier this year before CLOR, and the owner's first-year answer. */
payrollTaxDeclarationsRouter.get('/orgs/:orgId/payroll/opening-ytd', VIEW, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const financialYear = fyOf(req.query.fy);
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { accountId, orgId, payrollStatus: 'IN_PAYROLL' }, select: { employeeId: true } });
  const ids = profiles.map((p) => p.employeeId);
  const [people, rows, first] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids }, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true, dateOfJoining: true }, orderBy: { name: 'asc' } }),
    payrollPrisma.payrollOpeningYtd.findMany({ where: { orgId, financialYear, employeeId: { in: ids } } }),
    firstPayrollYearOf(orgId),
  ]);
  const byEmployee = new Map(rows.map((r) => [r.employeeId, r]));
  res.json({
    financialYear,
    firstPayrollYear: first?.financialYear === financialYear ? first : null,
    canSetFirstYear: Boolean(req.isAdmin),
    people: people.map((p) => ({ employeeId: p.id, name: p.name, code: p.code, dateOfJoining: p.dateOfJoining, opening: shapeOpening(byEmployee.get(p.id)) })),
  });
});

async function saveOpening(req: any, employeeId: string, financialYear: string, figures: ReturnType<typeof checkOpening>, db: any = payrollPrisma) {
  const { accountId, orgId } = req.tenant;
  const where = { orgId_employeeId_financialYear: { orgId, employeeId, financialYear } };
  const before = await db.payrollOpeningYtd.findUnique({ where });
  const row = await db.payrollOpeningYtd.upsert({
    where,
    create: { accountId, orgId, employeeId, financialYear, ...figures, createdByUserId: req.auth.userId, updatedByUserId: req.auth.userId },
    update: { ...figures, updatedByUserId: req.auth.userId },
  });
  return { before: shapeOpening(before), row };
}

payrollTaxDeclarationsRouter.put('/orgs/:orgId/payroll/opening-ytd/:employeeId', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  /* These figures set the tax deducted from someone's pay for the rest of the year: never your own. */
  const refused = await ownRecordRefusal(req, e.id, 'pay record', { does: 'enter it' });
  if (refused) return res.status(refused.status).json(refused.body);
  try {
    const figures = checkOpening(req.body || {}, financialYear);
    const { before, row } = await saveOpening(req, e.id, financialYear, figures);
    await recordAudit(req, {
      entity: 'PAYROLL_OPENING_YTD',
      entityId: row.id,
      action: before ? 'UPDATE' : 'CREATE',
      message: `${before ? 'Changed' : 'Entered'} ${e.name}’s pay earlier in ${financialYear}`,
      metadata: { employeeId: e.id, financialYear, before, after: shapeOpening(row) },
    });
    res.json({ opening: shapeOpening(row) });
  } catch (err) {
    return fail(res, err);
  }
});

payrollTaxDeclarationsRouter.delete('/orgs/:orgId/payroll/opening-ytd/:employeeId', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const e = await employeeOk(req, res);
  if (!e) return;
  const financialYear = fyOf(req.query.fy);
  const refused = await ownRecordRefusal(req, e.id, 'pay record', { does: 'remove it' });
  if (refused) return res.status(refused.status).json(refused.body);
  const where = { orgId_employeeId_financialYear: { orgId: req.tenant!.orgId, employeeId: e.id, financialYear } };
  const row = await payrollPrisma.payrollOpeningYtd.findUnique({ where });
  if (!row) return res.status(404).json({ error: 'Nothing was entered for this year.' });
  await payrollPrisma.payrollOpeningYtd.deleteMany({ where: { id: row.id, orgId: req.tenant!.orgId } });
  await recordAudit(req, { entity: 'PAYROLL_OPENING_YTD', entityId: row.id, action: 'DELETE', message: `Removed ${e.name}’s pay earlier in ${financialYear}`, metadata: { employeeId: e.id, financialYear, before: shapeOpening(row) } });
  res.json({ ok: true });
});

/**
 * A CSV of everybody's opening figures, by employee code. Every row is
 * checked first; one wrong row saves nothing and the answer lists each one.
 */
payrollTaxDeclarationsRouter.post('/orgs/:orgId/payroll/opening-ytd/import', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const financialYear = fyOf(req.query.fy);
  let rows: ReturnType<typeof parseOpeningCsv>;
  try {
    rows = parseOpeningCsv(String(req.body?.csv || ''));
  } catch (err) {
    return fail(res, err);
  }
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { accountId, orgId }, select: { employeeId: true } });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: profiles.map((p) => p.employeeId) } }, select: { id: true, name: true, code: true, userId: true } });
  const byCode = new Map(people.map((p) => [String(p.code || '').trim().toUpperCase(), p]));
  const problems: { line: number; message: string }[] = [];
  const ready: { person: (typeof people)[number]; figures: ReturnType<typeof checkOpening> }[] = [];
  const seen = new Set<string>();
  for (const r of rows as any[]) {
    const person = byCode.get(String(r.code || '').trim().toUpperCase());
    if (!person) {
      problems.push({ line: r.line, message: r.code ? `Nobody in payroll has the code ${r.code}.` : 'No employee code.' });
      continue;
    }
    if (seen.has(person.id)) {
      problems.push({ line: r.line, message: `${person.name} is in the file twice.` });
      continue;
    }
    seen.add(person.id);
    if (person.userId && person.userId === req.auth!.userId) {
      problems.push({ line: r.line, message: 'This is your own pay record; somebody else has to enter it.' });
      continue;
    }
    try {
      ready.push({ person, figures: checkOpening(r, financialYear) });
    } catch (err) {
      if (err instanceof OpeningError) problems.push({ line: r.line, message: `${person.name}: ${err.message}` });
      else throw err;
    }
  }
  if (problems.length) {
    return res.status(400).json({ error: `Nothing was saved: ${problems.length} row${problems.length === 1 ? '' : 's'} need${problems.length === 1 ? 's' : ''} correcting.`, code: 'IMPORT_ROWS', problems });
  }
  await payrollPrisma.$transaction(async (tx) => {
    for (const r of ready) await saveOpening(req, r.person.id, financialYear, r.figures, tx);
  });
  await recordAudit(req, {
    entity: 'PAYROLL_OPENING_YTD',
    entityId: financialYear,
    action: 'IMPORT',
    message: `Imported pay earlier in ${financialYear} for ${ready.length} ${ready.length === 1 ? 'person' : 'people'}`,
    metadata: { financialYear, employees: ready.map((r) => ({ employeeId: r.person.id, ...r.figures })) },
  });
  res.json({ saved: ready.length });
});

/**
 * The owner's answer: this is the company's first year of paying salaries, so
 * nobody has earlier months to bring in. Owner (administrator) only, with a
 * reason; audited. Saying no again puts the check back.
 */
payrollTaxDeclarationsRouter.put('/orgs/:orgId/payroll/opening-ytd-first-year', EDIT, async (req, res) => {
  if (!(await payrollRouteOk(req, res))) return;
  if (!req.isAdmin) return res.status(403).json({ error: 'Only the owner can say this is the company’s first year of paying salaries.', code: 'ADMIN_ONLY' });
  const { accountId, orgId } = req.tenant!;
  const financialYear = fyOf(req.query.fy);
  const firstYear = req.body?.firstYear === true;
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (firstYear && reason.length < 5) return res.status(400).json({ error: 'Say in a few words why, such as “company registered in August 2026”.', code: 'NO_REASON' });
  const before = await firstPayrollYearOf(orgId);
  if (!firstYear && before?.financialYear !== financialYear) return res.json({ firstPayrollYear: null });
  const data = firstYear
    ? { firstPayrollYear: financialYear, firstPayrollYearReason: reason, firstPayrollYearBy: req.auth!.userId, firstPayrollYearAt: new Date() }
    : { firstPayrollYear: null, firstPayrollYearReason: null, firstPayrollYearBy: null, firstPayrollYearAt: null };
  await payrollPrisma.payrollSetting.upsert({ where: { orgId }, create: { accountId, orgId, updatedByUserId: req.auth!.userId, ...data }, update: { ...data, updatedByUserId: req.auth!.userId } });
  await recordAudit(req, {
    entity: 'COMPANY_SETTING',
    entityId: 'payroll.firstPayrollYear',
    action: 'UPDATE',
    message: firstYear ? `Said ${financialYear} is the company’s first year of paying salaries: ${reason}` : `Took back that ${financialYear} is the company’s first year of paying salaries`,
    metadata: { before, after: firstYear ? { financialYear, reason } : null },
  });
  res.json({ firstPayrollYear: await firstPayrollYearOf(orgId) });
});

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
  const key = { orgId_employeeId_financialYear: { orgId: req.tenant!.orgId, employeeId: e.id, financialYear } };
  const [row, opening] = await Promise.all([payrollPrisma.taxDeclaration.findUnique({ where: key }), payrollPrisma.payrollOpeningYtd.findUnique({ where: key })]);
  res.json({ declaration: { ...shapeDeclaration(row, e.id, financialYear), employeeName: e.name }, opening: shapeOpening(opening) });
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

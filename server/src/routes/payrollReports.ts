import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { snapshotPerson } from '../services/payroll/payment.js';
import { round2 } from '../utils/money.js';

/**
 * Payroll reports.
 *
 * Every report here is read from payslips, which are immutable. A report that
 * recomputed from today's structures and rates would answer a different
 * question each time it was run, and "what did we pay in March" has exactly one
 * right answer. So nothing in this file calculates anything — it reads what was
 * calculated, and arranges it.
 *
 * The consequence worth knowing: a report of a month nobody has run is empty,
 * not estimated. That is the honest answer.
 */
export const payrollReportsRouter = Router();
payrollReportsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.reports;

/**
 * The payslips a report covers, with who they belong to.
 *
 * Scoped by period rather than by run, because "March" is the question people
 * ask; a month can have more than one run — monthly staff and weekly labour —
 * and a report that showed only one of them would be quietly incomplete.
 */
async function slipsFor(orgId: string, periodIds: string[]) {
  if (!periodIds.length) return { slips: [], people: new Map<string, { name: string; code: string; department: string | null }>() };

  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, periodId: { in: periodIds }, status: { not: 'CANCELLED' } },
    include: { lines: true },
    orderBy: { number: 'asc' },
  });

  const ids = [...new Set(slips.map((s) => s.employeeId))];
  const directory = ids.length
    ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, department: true } })
    : [];
  const byId = new Map(directory.map((e) => [e.id, { name: e.name, code: e.code || '', department: e.department || null }]));

  /* A person who has left the directory is still on the payslips that paid
     them, and the payslip recorded who they were. */
  const people = new Map<string, { name: string; code: string; department: string | null }>();
  for (const slip of slips) {
    const live = byId.get(slip.employeeId);
    if (live) {
      people.set(slip.employeeId, live);
      continue;
    }
    const snap = snapshotPerson(slip.employeeSnapshotJson);
    people.set(slip.employeeId, { name: snap.name || 'Unknown employee', code: snap.code, department: null });
  }

  return { slips, people };
}

/** Which months a report covers: one named period, or every period in a range. */
async function resolvePeriods(orgId: string, query: any) {
  const periodId = String(query.periodId || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();

  const periods = await payrollPrisma.payrollPeriod.findMany({
    where: {
      orgId,
      ...(periodId ? { id: periodId } : {}),
      ...(from ? { endDate: { gte: from } } : {}),
      ...(to ? { startDate: { lte: to } } : {}),
    },
    orderBy: { startDate: 'asc' },
    select: { id: true, name: true, startDate: true, endDate: true },
  });

  return periods;
}

/**
 * The salary register: one row per person, one column per component.
 *
 * The report a payroll manager opens first and the one an auditor asks for.
 * Columns are built from the components that actually appear, in payslip order,
 * rather than from a fixed list — a company that added a component last month
 * should see it this month without anybody editing a report.
 */
payrollReportsRouter.get(
  '/orgs/:orgId/payroll/reports/register',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const periods = await resolvePeriods(orgId, req.query);
    const { slips, people } = await slipsFor(orgId, periods.map((p) => p.id));

    /* Component order is the payslip's, so the register reads the way a
       payslip does rather than alphabetically. */
    const order = new Map<string, { code: string; name: string; type: string; displayOrder: number }>();
    for (const slip of slips) {
      for (const line of slip.lines) {
        if (!order.has(line.componentCode)) {
          order.set(line.componentCode, {
            code: line.componentCode,
            name: line.componentName,
            type: line.type,
            displayOrder: line.displayOrder,
          });
        }
      }
    }
    const columns = [...order.values()].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));

    const rows = slips.map((slip) => {
      const person = people.get(slip.employeeId)!;
      const amounts: Record<string, number> = {};
      for (const line of slip.lines) {
        amounts[line.componentCode] = round2((amounts[line.componentCode] || 0) + Number(line.amount));
      }
      return {
        slipId: slip.id,
        slipNumber: slip.number,
        employeeId: slip.employeeId,
        employeeName: person.name,
        employeeCode: person.code,
        department: person.department,
        amounts,
        grossEarnings: Number(slip.grossEarnings),
        totalDeductions: Number(slip.totalDeductions),
        employerContributions: Number(slip.employerContributions),
        netPay: Number(slip.netPay),
        employerCost: Number(slip.employerCost),
        paymentStatus: slip.paymentStatus,
      };
    });

    const totals = {
      grossEarnings: round2(rows.reduce((t, r) => t + r.grossEarnings, 0)),
      totalDeductions: round2(rows.reduce((t, r) => t + r.totalDeductions, 0)),
      employerContributions: round2(rows.reduce((t, r) => t + r.employerContributions, 0)),
      netPay: round2(rows.reduce((t, r) => t + r.netPay, 0)),
      employerCost: round2(rows.reduce((t, r) => t + r.employerCost, 0)),
      amounts: Object.fromEntries(
        columns.map((c) => [c.code, round2(rows.reduce((t, r) => t + (r.amounts[c.code] || 0), 0))])
      ),
    };

    res.json({ periods, columns, rows, totals });
  }
);

/**
 * What is owed to each statutory scheme, and by whom.
 *
 * Read from the payslip lines that carry a scheme, so the return agrees with
 * what was actually deducted rather than with what today's rates would say.
 */
payrollReportsRouter.get(
  '/orgs/:orgId/payroll/reports/statutory',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const periods = await resolvePeriods(orgId, req.query);
    const { slips, people } = await slipsFor(orgId, periods.map((p) => p.id));

    /* The mapping from a component to a scheme lives on the component, and a
       payslip line names the component — so the scheme is looked up once. */
    const componentIds = [...new Set(slips.flatMap((s) => s.lines.map((l) => l.componentId)))];
    const components = componentIds.length
      ? await payrollPrisma.salaryComponent.findMany({
          where: { orgId, id: { in: componentIds } },
          select: { id: true, statutoryScheme: true },
        })
      : [];
    const schemeOf = new Map(components.map((c) => [c.id, c.statutoryScheme]));

    const profiles = await payrollPrisma.employeePayrollProfile.findMany({
      where: { orgId, employeeId: { in: [...new Set(slips.map((s) => s.employeeId))] } },
      select: { employeeId: true, uan: true, pan: true, esiNumber: true, pfNumber: true },
    });
    const byProfile = new Map(profiles.map((p) => [p.employeeId, p]));

    const schemes = new Map<string, { scheme: string; employee: number; employer: number; rows: any[] }>();

    for (const slip of slips) {
      const person = people.get(slip.employeeId)!;
      const profile = byProfile.get(slip.employeeId);
      for (const line of slip.lines) {
        const scheme = schemeOf.get(line.componentId);
        if (!scheme) continue;
        const amount = Number(line.amount) || 0;
        if (amount <= 0) continue;

        const bucket = schemes.get(scheme) || { scheme, employee: 0, employer: 0, rows: [] };
        const isEmployer = line.type === 'EMPLOYER_CONTRIBUTION';
        if (isEmployer) bucket.employer = round2(bucket.employer + amount);
        else bucket.employee = round2(bucket.employee + amount);

        const existing = bucket.rows.find((r) => r.employeeId === slip.employeeId);
        const row =
          existing ||
          {
            employeeId: slip.employeeId,
            employeeName: person.name,
            employeeCode: person.code,
            /* The identifiers a return actually asks for. */
            uan: profile?.uan || '',
            pan: profile?.pan || '',
            esiNumber: profile?.esiNumber || '',
            pfNumber: profile?.pfNumber || '',
            wage: 0,
            employee: 0,
            employer: 0,
          };
        if (!existing) bucket.rows.push(row);
        if (isEmployer) row.employer = round2(row.employer + amount);
        else row.employee = round2(row.employee + amount);
        row.wage = Number(slip.grossEarnings);

        schemes.set(scheme, bucket);
      }
    }

    res.json({
      periods,
      schemes: [...schemes.values()].map((s) => ({ ...s, total: round2(s.employee + s.employer), count: s.rows.length })),
    });
  }
);

/**
 * What changed since last month, per person.
 *
 * The report that finds the mistakes. A payroll where one person's pay moved
 * forty percent is either a promotion somebody knows about or an error nobody
 * does, and both are worth a second look before the money leaves.
 */
payrollReportsRouter.get(
  '/orgs/:orgId/payroll/reports/variance',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const periods = await resolvePeriods(orgId, req.query);
    const { slips, people } = await slipsFor(orgId, periods.map((p) => p.id));

    /* The threshold is a question, not a rule: below it a change is ordinary,
       above it somebody looks. Five percent by default. */
    const threshold = Number(req.query.threshold) || 5;

    const rows = slips
      .map((slip) => {
        const person = people.get(slip.employeeId)!;
        const previous = slip.previousNetPay == null ? null : Number(slip.previousNetPay);
        const net = Number(slip.netPay);
        return {
          slipId: slip.id,
          slipNumber: slip.number,
          employeeId: slip.employeeId,
          employeeName: person.name,
          employeeCode: person.code,
          previousNetPay: previous,
          netPay: net,
          change: previous == null ? null : round2(net - previous),
          /* Somebody's first payslip has nothing to compare against, which is
             not a variance — it is a new person, and saying otherwise would
             report every joiner as an anomaly. */
          percent: slip.variancePercent == null ? null : Number(slip.variancePercent),
          isNew: previous == null,
        };
      })
      .filter((r) => r.isNew || (r.percent != null && Math.abs(r.percent) >= threshold))
      .sort((a, b) => Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0));

    res.json({ periods, threshold, rows, count: rows.length, totalSlips: slips.length });
  }
);

/**
 * What payroll cost, by department.
 *
 * Grouped from the staff directory rather than from anything payroll stores,
 * because a department is a fact about a person and payroll has no business
 * keeping its own copy of one.
 */
payrollReportsRouter.get(
  '/orgs/:orgId/payroll/reports/cost',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { orgId } = req.tenant!;

    const periods = await resolvePeriods(orgId, req.query);
    const { slips, people } = await slipsFor(orgId, periods.map((p) => p.id));

    const groups = new Map<string, { department: string; headcount: number; gross: number; deductions: number; net: number; employerCost: number }>();
    for (const slip of slips) {
      const department = people.get(slip.employeeId)?.department || 'Not in a department';
      const bucket = groups.get(department) || { department, headcount: 0, gross: 0, deductions: 0, net: 0, employerCost: 0 };
      bucket.headcount += 1;
      bucket.gross = round2(bucket.gross + Number(slip.grossEarnings));
      bucket.deductions = round2(bucket.deductions + Number(slip.totalDeductions));
      bucket.net = round2(bucket.net + Number(slip.netPay));
      bucket.employerCost = round2(bucket.employerCost + Number(slip.employerCost));
      groups.set(department, bucket);
    }

    const rows = [...groups.values()].sort((a, b) => b.employerCost - a.employerCost);

    res.json({
      periods,
      rows,
      totals: {
        headcount: rows.reduce((t, r) => t + r.headcount, 0),
        gross: round2(rows.reduce((t, r) => t + r.gross, 0)),
        deductions: round2(rows.reduce((t, r) => t + r.deductions, 0)),
        net: round2(rows.reduce((t, r) => t + r.net, 0)),
        employerCost: round2(rows.reduce((t, r) => t + r.employerCost, 0)),
      },
    });
  }
);

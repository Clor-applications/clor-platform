import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { buildFilings } from './filings.js';
import { form24q, quarterOf, taxYear } from './form16.js';

/**
 * The rest of the payroll overview: salaries and payslips, the statutory
 * returns, full and final settlements, and the bank payouts.
 *
 * Read from the same rows the screens behind them read — the filings come from
 * `buildFilings` and `form24q`, which are what Reports and Tax declarations
 * download — so a count on the overview is the count the screen it opens will
 * show. Nothing here records whether a return was filed or a challan paid:
 * CLOR keeps no such record yet, and the overview does not pretend it does.
 */

const SETTLED = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];

const nextMonth = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
};
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** PF and ESI for a month are due on the 15th of the next. */
export const pfEsiDue = (periodEnd: string) => {
  const { y, m } = nextMonth(periodEnd);
  return isoOf(y, m, 15);
};

/** The financial year a date falls in, as `2026-27`. */
export const fyOf = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** 24Q is due on 31 July, 31 October and 31 January for the first three quarters, and 31 May for the fourth. */
export const due24q = (fy: string, quarter: number) => {
  const start = Number(fy.slice(0, 4));
  return ({ 1: `${start}-07-31`, 2: `${start}-10-31`, 3: `${start + 1}-01-31`, 4: `${start + 1}-05-31` } as Record<number, string>)[quarter];
};

/** Form 16 for a year is due to employees by 15 June after it ends. */
export const dueForm16 = (fy: string) => `${Number(fy.slice(0, 4)) + 1}-06-15`;

type Scheme = { code: string; name: string; isEnabled: boolean; registrationNumber: string | null };

export async function payrollCockpit(
  accountId: string,
  orgId: string,
  today: string,
  ctx: { currentPeriodId: string | null; currentRunId: string | null; inPayroll: number; withoutSalary: number }
) {
  const [structures, schemes, settlements, leavers, bankChanges, failedSlips, lastSettledRun] = await Promise.all([
    payrollPrisma.salaryStructure.findMany({ where: { orgId, status: 'ACTIVE' }, select: { id: true } }),
    payrollPrisma.statutoryScheme.findMany({ where: { orgId }, select: { code: true, name: true, isEnabled: true, registrationNumber: true } }),
    payrollPrisma.finalSettlement.findMany({
      where: { accountId, orgId, status: { in: ['DRAFT', 'APPROVED'] } },
      select: { status: true, dueDate: true, netPayable: true },
    }),
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, dateOfLeaving: { not: null }, status: { in: ['LEFT', 'ON_NOTICE'] } },
      select: { id: true },
    }),
    payrollPrisma.bankDetailChange.count({ where: { orgId, status: 'PENDING' } }),
    payrollPrisma.salarySlip.count({ where: { orgId, status: { not: 'CANCELLED' }, paymentStatus: 'FAILED' } }),
    payrollPrisma.payrollRun.findFirst({ where: { accountId, orgId, status: { in: SETTLED } }, orderBy: { payrollDate: 'desc' } }),
  ]);

  /* ---- Salaries and payslips --------------------------------------------- */
  const slipsThisMonth = ctx.currentPeriodId
    ? await payrollPrisma.salarySlip.groupBy({ by: ['status'], where: { orgId, periodId: ctx.currentPeriodId, status: { not: 'CANCELLED' } }, _count: { _all: true } })
    : [];
  const slipCount = slipsThisMonth.reduce((t, g) => t + g._count._all, 0);
  const salaries = {
    structures: structures.length,
    onStructure: Math.max(0, ctx.inPayroll - ctx.withoutSalary),
    withoutSalary: ctx.withoutSalary,
    slips: slipCount,
    slipsFinal: slipsThisMonth.filter((g) => ['APPROVED', 'LOCKED', 'PAID'].includes(g.status)).reduce((t, g) => t + g._count._all, 0),
  };

  /* ---- Bank payouts, for this month's payroll ------------------------------ */
  let payouts: {
    runId: string | null; net: number; paid: number; paidCount: number; failedCount: number; inProgress: number; batches: number;
  } = { runId: ctx.currentRunId, net: 0, paid: 0, paidCount: 0, failedCount: 0, inProgress: 0, batches: 0 };
  if (ctx.currentRunId) {
    const [run, payments] = await Promise.all([
      payrollPrisma.payrollRun.findUnique({ where: { id: ctx.currentRunId }, select: { netTotal: true } }),
      payrollPrisma.payrollPayment.findMany({
        where: { orgId, runId: ctx.currentRunId, status: { not: 'CANCELLED' } },
        select: { status: true, paidAmount: true, paidCount: true, failedCount: true },
      }),
    ]);
    payouts = {
      runId: ctx.currentRunId,
      net: Number(run?.netTotal || 0),
      paid: round2(payments.reduce((t, p) => t + Number(p.paidAmount), 0)),
      paidCount: payments.reduce((t, p) => t + p.paidCount, 0),
      failedCount: payments.reduce((t, p) => t + p.failedCount, 0),
      inProgress: payments.filter((p) => ['DRAFT', 'PROCESSING'].includes(p.status)).length,
      batches: payments.length,
    };
  }

  /* ---- Full and final ------------------------------------------------------ */
  /* Left, or leaving, with no settlement begun — a paid one counts as begun, so look at every one that is not cancelled. */
  const begun = leavers.length
    ? new Set(
        (
          await payrollPrisma.finalSettlement.findMany({
            where: { accountId, orgId, employeeId: { in: leavers.map((l) => l.id) }, status: { not: 'CANCELLED' } },
            select: { employeeId: true },
          })
        ).map((s) => s.employeeId)
      )
    : new Set<string>();
  const fnf = {
    drafts: settlements.filter((s) => s.status === 'DRAFT').length,
    approved: settlements.filter((s) => s.status === 'APPROVED').length,
    overdue: settlements.filter((s) => s.dueDate && s.dueDate < today).length,
    payable: round2(settlements.reduce((t, s) => t + Number(s.netPayable), 0)),
    notStarted: leavers.filter((l) => !begun.has(l.id)).length,
  };

  /* ---- Statutory returns ------------------------------------------------------
   * For the month last paid, because that is the one whose returns are due
   * now: November's overview is about October's PF and ESI.
   */
  const byCode = new Map<string, Scheme>(schemes.map((s) => [s.code, s]));
  const scheme = (code: string, fallback: string) => {
    const s = byCode.get(code);
    return { code, name: s?.name || fallback, enabled: Boolean(s?.isEnabled), registered: Boolean(s?.registrationNumber) };
  };

  const filingPeriod = lastSettledRun
    ? await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: lastSettledRun.periodId }, select: { id: true, name: true, startDate: true, endDate: true } })
    : null;
  const filings = filingPeriod ? await buildFilings(orgId, filingPeriod) : null;

  const tdsMonth = lastSettledRun?.payrollDate || today;
  const fy = fyOf(tdsMonth);
  const quarter = quarterOf(tdsMonth);
  const lastFy = fyOf(isoOf(Number(fy.slice(0, 4)), 3, 31));
  const [q, priorYear] = await Promise.all([
    lastSettledRun ? form24q(orgId, fy, quarter) : Promise.resolve(null),
    /* Form 16 is for a year that has ended; the year before the one being paid now. */
    taxYear(orgId, lastFy),
  ]);

  const statutory = [
    {
      ...scheme('PF', 'Provident Fund'),
      output: 'PF ECR',
      built: true,
      period: filingPeriod?.name || null,
      periodId: filingPeriod?.id || null,
      dueDate: filingPeriod ? pfEsiDue(filingPeriod.endDate) : null,
      people: filings?.ecr.totals.members || 0,
      amount: filings ? round2(filings.ecr.totals.employee + filings.ecr.totals.eps + filings.ecr.totals.epf) : 0,
      problems: filings?.ecr.problems.length || 0,
      screen: 'reports',
    },
    {
      ...scheme('ESI', 'Employees’ State Insurance'),
      output: 'ESI contributions',
      built: true,
      period: filingPeriod?.name || null,
      periodId: filingPeriod?.id || null,
      dueDate: filingPeriod ? pfEsiDue(filingPeriod.endDate) : null,
      people: filings?.esic.totals.people || 0,
      amount: filings ? round2(filings.esic.totals.employee + filings.esic.totals.employer) : 0,
      problems: filings?.esic.problems.length || 0,
      screen: 'reports',
    },
    {
      ...scheme('PT', 'Professional Tax'),
      output: 'PT returns',
      built: true,
      period: filings?.pt.states[0]?.period || filingPeriod?.name || null,
      periodId: filingPeriod?.id || null,
      /* States differ; the earliest one that is known. */
      dueDate: (filings?.pt.states || []).filter((s) => s.dueKnown && s.dueDate).map((s) => s.dueDate as string).sort()[0] || null,
      people: filings?.pt.states.reduce((t, s) => t + s.people, 0) || 0,
      amount: round2(filings?.pt.states.reduce((t, s) => t + s.total, 0) || 0),
      problems: filings?.pt.problems.length || 0,
      states: filings?.pt.states.length || 0,
      screen: 'reports',
    },
    {
      ...scheme('TDS', 'Income tax (TDS)'),
      output: 'TDS 24Q',
      built: true,
      period: lastSettledRun ? `Q${quarter} FY ${fy}` : null,
      dueDate: lastSettledRun ? due24q(fy, quarter) : null,
      people: q ? new Set(q.rows.map((r) => r.employeeId)).size : 0,
      amount: q?.total || 0,
      problems: q?.problems.length || 0,
      screen: 'taxDeclarations',
    },
    {
      ...scheme('TDS', 'Income tax (TDS)'),
      code: 'FORM16',
      output: 'Form 16',
      built: true,
      period: `FY ${lastFy}`,
      dueDate: dueForm16(lastFy),
      people: priorYear.length,
      amount: round2(priorYear.reduce((t, p) => t + Number(p.tdsDeducted || 0), 0)),
      problems: priorYear.filter((p) => !p.panValid && Number(p.tdsDeducted || 0) > 0).length,
      screen: 'taxDeclarations',
    },
  ];

  return { salaries, payouts, fnf, statutory, bankChanges, failedSlips };
}

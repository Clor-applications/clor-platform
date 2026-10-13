import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { calculateStructure, type EngineComponent, type EngineResult } from './engine/calculator.js';
import { loadRules, applyStatutory } from './statutory/resolve.js';
import { round2 } from '../../utils/money.js';

/**
 * A salary revision, and what it actually costs.
 *
 * An increment is usually agreed as one number — "twelve percent" — and then
 * discovered a month later to have meant something else. Twelve percent on CTC
 * is not twelve percent in the hand: PF rises with basic, the tax band may
 * change, and the employer's contribution rises too, so the company pays more
 * than the number anybody said. This module works out the real answer before
 * the revision is approved rather than after the payslip.
 *
 * The impact is a full calculation, not an estimate. The same engine that
 * produces payslips is run twice — once on what somebody is on now, once on
 * what is proposed — and the two are subtracted. An approximation here would be
 * wrong in exactly the cases that matter, because the interesting increments
 * are the ones that cross a threshold.
 *
 * What is shown at approval is stored with the revision. A year later, "we
 * approved this on the understanding it cost X" needs the X that was actually
 * on the screen, not one recomputed under today's rates.
 */


export class SalaryRevisionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'SalaryRevisionError';
    this.code = code;
    this.status = status;
  }
}

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, WEEKLY: 52, FORTNIGHTLY: 26, DAILY: 365 };

async function engineComponentsFor(orgId: string, structureId: string): Promise<{ components: EngineComponent[]; periodsPerYear: number }> {
  const structure = await payrollPrisma.salaryStructure.findFirst({
    where: { orgId, id: structureId },
    include: { components: true },
  });
  if (!structure) throw new SalaryRevisionError('NO_STRUCTURE', 'No such salary structure.', 404);

  const ids = structure.components.map((c) => c.componentId);
  const components = ids.length ? await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: ids } } }) : [];
  const byId = new Map(components.map((c) => [c.id, c]));

  const out: EngineComponent[] = [];
  for (const line of structure.components) {
    const c = byId.get(line.componentId);
    if (!c) continue;
    out.push({
      componentId: c.id,
      code: c.code,
      name: c.name,
      type: c.type as EngineComponent['type'],
      calculationMethod: (line.calculationMethod || c.calculationMethod) as EngineComponent['calculationMethod'],
      amount: Number(line.amount ?? c.amount ?? 0),
      percentage: Number(line.percentage ?? c.percentage ?? 0),
      formula: line.formula ?? c.formula ?? null,
      calculationBase: line.calculationBase ?? c.calculationBase ?? null,
      rounding: c.rounding as EngineComponent['rounding'],
      statutoryScheme: c.statutoryScheme,
      isTaxable: c.isTaxable,
      prorate: c.prorate,
      includeInPfWage: c.includeInPfWage,
      includeInEsiWage: c.includeInEsiWage,
      includeInGratuityWage: c.includeInGratuityWage,
      includeInGross: c.includeInGross,
      includeInNetPay: c.includeInNetPay,
      isVariable: c.isVariable,
      isBalancing: line.isBalancing,
      displayOrder: line.displayOrder,
      expenseLedgerId: c.expenseLedgerId,
      liabilityLedgerId: c.liabilityLedgerId,
    });
  }

  return { components: out, periodsPerYear: PERIODS_PER_YEAR[structure.frequency] ?? 12 };
}

/**
 * One salary, calculated in full.
 *
 * A whole month with no unpaid days, deliberately: a revision is about what
 * somebody is on, not about a particular month's attendance. Comparing two
 * salaries through the same lens is what makes the difference meaningful.
 */
async function calculateOne(opts: {
  orgId: string;
  structureId: string;
  annualCtc: number;
  onDate: string;
  profile: any;
  rules: Awaited<ReturnType<typeof loadRules>>;
}): Promise<EngineResult> {
  const { components, periodsPerYear } = await engineComponentsFor(opts.orgId, opts.structureId);

  const base = {
    annualCtc: opts.annualCtc,
    periodsPerYear,
    workingDays: 30,
    payableDays: 30,
    lwpDays: 0,
  };

  /* The same two passes a payroll run makes: the structure decides the PF and
     ESI wages, the schemes are computed on those, and the structure is worked
     out again with the real amounts in it. */
  const first = calculateStructure(components, base);
  const statutory = applyStatutory({
    rules: opts.rules,
    onDate: opts.onDate,
    wages: { pfWage: first.pfWage, esiWage: first.esiWage, gross: first.grossEarnings, annualTaxable: opts.annualCtc },
    employee: {
      pfApplicable: !!opts.profile?.pfApplicable,
      esiApplicable: !!opts.profile?.esiApplicable,
      ptApplicable: !!opts.profile?.ptApplicable,
      taxRegime: opts.profile?.taxRegime === 'OLD' ? 'OLD' : 'NEW',
      professionalTaxState: opts.profile?.professionalTaxState || null,
    },
    components: components.map((c) => ({ code: c.code, statutoryScheme: c.statutoryScheme, type: c.type })),
    monthsRemaining: 12,
    taxAlreadyDeducted: 0,
  });

  return calculateStructure(components, { ...base, statutoryAmounts: statutory.amounts });
}

export type RevisionImpact = {
  /** Per component: what it is now, what it becomes, and the difference. */
  lines: { code: string; name: string; type: string; from: number; to: number; change: number }[];
  monthly: { from: number; to: number; change: number };
  annual: { from: number; to: number; change: number };
  gross: { from: number; to: number; change: number };
  deductions: { from: number; to: number; change: number };
  employerCost: { from: number; to: number; change: number };
  ctc: { from: number; to: number; change: number; percent: number };
  /** Things worth saying out loud before this is approved. */
  notes: { code: string; message: string }[];
};

/**
 * What a revision does to somebody's pay, their deductions and the company's
 * cost — component by component.
 */
export async function previewImpact(opts: {
  orgId: string;
  employeeId: string;
  currentStructureId: string | null;
  currentAnnualCtc: number;
  proposedStructureId: string;
  proposedAnnualCtc: number;
  effectiveFrom: string;
}): Promise<RevisionImpact> {
  const [profile, rules] = await Promise.all([
    payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId: opts.orgId, employeeId: opts.employeeId } }),
    loadRules(opts.orgId),
  ]);

  const proposed = await calculateOne({
    orgId: opts.orgId,
    structureId: opts.proposedStructureId,
    annualCtc: opts.proposedAnnualCtc,
    onDate: opts.effectiveFrom,
    profile,
    rules,
  });

  /* Somebody with no salary yet — a first assignment through a revision — has
     nothing to compare against, so every figure counts as a rise from nil. */
  const current = opts.currentStructureId
    ? await calculateOne({
        orgId: opts.orgId,
        structureId: opts.currentStructureId,
        annualCtc: opts.currentAnnualCtc,
        onDate: opts.effectiveFrom,
        profile,
        rules,
      })
    : null;

  const byCode = new Map<string, { code: string; name: string; type: string; from: number; to: number }>();
  for (const line of current?.lines || []) {
    byCode.set(line.code, { code: line.code, name: line.name, type: line.type, from: line.amount, to: 0 });
  }
  for (const line of proposed.lines) {
    const row = byCode.get(line.code) || { code: line.code, name: line.name, type: line.type, from: 0, to: 0 };
    row.to = line.amount;
    row.name = line.name;
    row.type = line.type;
    byCode.set(line.code, row);
  }

  const lines = [...byCode.values()]
    .map((r) => ({ ...r, change: round2(r.to - r.from) }))
    /* A component that does not move is noise on a screen about what changed. */
    .filter((r) => r.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const pair = (from: number, to: number) => ({ from: round2(from), to: round2(to), change: round2(to - from) });

  const notes: RevisionImpact['notes'] = [];

  const netChange = round2(proposed.netPay - (current?.netPay ?? 0));
  const ctcChange = round2(opts.proposedAnnualCtc - opts.currentAnnualCtc);

  if (ctcChange > 0 && netChange <= 0) {
    notes.push({
      code: 'TAKE_HOME_DID_NOT_RISE',
      message:
        'Cost to company goes up but take-home pay does not. The increase is being absorbed by deductions — usually provident fund or tax crossing a threshold.',
    });
  }
  if (ctcChange > 0 && netChange > 0) {
    const kept = round2((netChange * 12 * 100) / ctcChange);
    if (kept < 70) {
      notes.push({
        code: 'MUCH_OF_THE_RISE_IS_DEDUCTED',
        message: `Of the rise, about ${Math.round(kept)}% reaches take-home pay. The rest goes to deductions.`,
      });
    }
  }
  const employerChange = round2(proposed.employerCost - (current?.employerCost ?? 0));
  if (employerChange > round2(ctcChange / 12)) {
    notes.push({
      code: 'COSTS_MORE_THAN_THE_RISE',
      message: 'The company pays more each month than the rise itself, because its own contributions go up with it.',
    });
  }
  if (ctcChange < 0) {
    notes.push({ code: 'PAY_CUT', message: 'This is a reduction in cost to company, not a rise. Check that is intended.' });
  }

  return {
    lines,
    monthly: pair(current?.netPay ?? 0, proposed.netPay),
    annual: pair((current?.netPay ?? 0) * 12, proposed.netPay * 12),
    gross: pair(current?.grossEarnings ?? 0, proposed.grossEarnings),
    deductions: pair(current?.totalDeductions ?? 0, proposed.totalDeductions),
    employerCost: pair(current?.employerCost ?? 0, proposed.employerCost),
    ctc: {
      ...pair(opts.currentAnnualCtc, opts.proposedAnnualCtc),
      percent: opts.currentAnnualCtc > 0 ? round2((ctcChange / opts.currentAnnualCtc) * 100) : 0,
    },
    notes,
  };
}

/**
 * Turn an approved revision into the salary somebody is actually on.
 *
 * This is the only write that matters, and it is deliberately the same shape as
 * creating an assignment by hand: the previous one closes the day before the
 * new one starts, in one transaction, because two open assignments would be two
 * salaries for one day and a run would take whichever it read first.
 */
export async function applyRevision(opts: { accountId: string; orgId: string; userId: string; revisionId: string }) {
  const revision = await payrollPrisma.salaryRevision.findFirst({
    where: { accountId: opts.accountId, orgId: opts.orgId, id: opts.revisionId },
  });
  if (!revision) throw new SalaryRevisionError('NO_REVISION', 'No such salary revision.', 404);
  if (revision.status === 'APPLIED') {
    throw new SalaryRevisionError('ALREADY_APPLIED', 'This revision has already been applied.');
  }
  if (revision.status !== 'APPROVED') {
    throw new SalaryRevisionError('NOT_APPROVED', 'Only an approved revision becomes somebody’s salary. Approve it first.');
  }

  const [employee, structure] = await Promise.all([
    peoplePrisma.employee.findFirst({ where: { orgId: opts.orgId, id: revision.employeeId } }),
    payrollPrisma.salaryStructure.findFirst({ where: { orgId: opts.orgId, id: revision.proposedStructureId } }),
  ]);
  if (!employee) throw new SalaryRevisionError('NO_EMPLOYEE', 'That employee no longer exists.', 404);
  if (!structure) throw new SalaryRevisionError('NO_STRUCTURE', 'That salary structure no longer exists.', 404);

  /*
   * A month that has already been paid cannot take a new salary.
   *
   * Backdating into a run that has produced payslips would leave the payslips
   * saying one thing and the assignment another, with nothing to reconcile
   * them. An arrear for the backdated months is the right answer, and that is
   * an adjustment rather than an assignment.
   */
  const paidPeriod = await payrollPrisma.payrollPeriod.findFirst({
    where: { orgId: opts.orgId, isLocked: true, startDate: { lte: revision.effectiveFrom }, endDate: { gte: revision.effectiveFrom } },
    select: { name: true },
  });
  if (paidPeriod) {
    throw new SalaryRevisionError(
      'PERIOD_LOCKED',
      `${paidPeriod.name} is closed, so a salary cannot start inside it. Start the revision in an open month and pay the difference as an arrear.`
    );
  }

  const clash = await payrollPrisma.salaryAssignment.findFirst({
    where: { orgId: opts.orgId, employeeId: revision.employeeId, effectiveFrom: revision.effectiveFrom },
    select: { id: true },
  });
  if (clash) {
    throw new SalaryRevisionError(
      'ASSIGNMENT_EXISTS',
      `${employee.name} already has a salary starting on ${revision.effectiveFrom}.`
    );
  }

  const periods = PERIODS_PER_YEAR[structure.frequency] ?? 12;
  const annualCtc = Number(revision.proposedAnnualCtc);

  return payrollPrisma.$transaction(async (tx) => {
    const previous = await tx.salaryAssignment.findFirst({
      where: { orgId: opts.orgId, employeeId: revision.employeeId, status: 'ACTIVE', effectiveFrom: { lt: revision.effectiveFrom } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (previous) {
      const end = new Date(`${revision.effectiveFrom}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() - 1);
      await tx.salaryAssignment.update({
        where: { id: previous.id },
        data: { effectiveTo: end.toISOString().slice(0, 10), status: 'SUPERSEDED' },
      });
    }

    const assignment = await tx.salaryAssignment.create({
      data: {
        accountId: opts.accountId,
        orgId: opts.orgId,
        branchId: previous?.branchId ?? employee.branchId ?? null,
        employeeId: revision.employeeId,
        structureId: revision.proposedStructureId,
        payGroupId: previous?.payGroupId ?? null,
        effectiveFrom: revision.effectiveFrom,
        annualCtc,
        monthlyCtc: round2(annualCtc / periods),
        costCenterId: previous?.costCenterId ?? null,
        status: 'ACTIVE',
        /* The assignment names the revision that produced it, so somebody
           looking at a salary can find the decision behind it. */
        revisionId: revision.id,
        createdByUserId: opts.userId,
      },
    });

    const row = await tx.salaryRevision.update({
      where: { id: revision.id },
      data: { status: 'APPLIED', appliedAssignmentId: assignment.id },
    });

    return { revision: row, assignment };
  });
}

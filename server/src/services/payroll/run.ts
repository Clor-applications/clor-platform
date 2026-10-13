import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { calculateStructure, ENGINE_VERSION, type EngineComponent } from './engine/calculator.js';
import { loadRules, applyStatutory } from './statutory/resolve.js';
import { recoveriesDue, recoverable, type DueRecovery } from './loan.js';
import { round2 } from '../../utils/money.js';
import { componentApplies, monthsOfService, type EligibilityFacts } from './eligibility.js';

/**
 * A payroll run: turning a population and a period into payslips.
 *
 * ## Everything is read once
 *
 * A run of six hundred people that asks the database per person is six hundred
 * round trips before it has calculated anything. So every employee, assignment,
 * structure, component and adjustment the run touches is fetched in a handful
 * of queries and resolved in memory. The calculator itself is pure, so once the
 * data is loaded the arithmetic is CPU and nothing else.
 *
 * ## Validation runs before calculation, and separately
 *
 * A run stops at the first thing that would produce a wrong payslip, not the
 * first thing that throws. Someone with no salary assignment, a structure whose
 * dates do not cover the period, a negative net — these are reported against
 * the employee, all of them at once, so payroll is fixed in one pass rather
 * than discovered one error per attempt.
 *
 * ## What a payslip remembers
 *
 * Calculating writes a snapshot of everything that produced each figure: the
 * employee, the assignment, the structure and its components, the days, the
 * adjustments, and the engine version. A payslip reopened next year reads its
 * own snapshot, never today's configuration — so editing a structure tomorrow
 * cannot change what March paid. That is the property the whole module rests
 * on, and it is why calculation stores so much.
 */

export type RunIssue = {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  employeeId?: string;
};

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, FORTNIGHTLY: 26, WEEKLY: 52 };

/** Whole days between two ISO dates, inclusive — the length of a period. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86400000) + 1;
}

/**
 * Who this run is for.
 *
 * Eligibility is deliberately narrow: in payroll, in this population, employed
 * during the period, and holding a salary that covers it. Somebody who joined
 * mid-period is included — that is what proration is for — and somebody who
 * left before it started is not.
 */
export async function eligibleEmployees(
  orgId: string,
  opts: { periodStart: string; periodEnd: string; payGroupId?: string | null; branchId?: string | null; department?: string | null }
) {
  const employees = await peoplePrisma.employee.findMany({
    where: {
      orgId,
      status: { in: ['ACTIVE', 'ON_NOTICE', 'LEFT'] },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.department ? { department: opts.department } : {}),
      /* Employed at some point during the period: joined on or before it ends,
         and either still here or left on or after it starts. */
      OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: opts.periodEnd } }],
    },
    orderBy: { name: 'asc' },
  });

  const stillHere = employees.filter(
    (e) => !e.dateOfLeaving || e.dateOfLeaving >= opts.periodStart
  );

  const profiles = await payrollPrisma.employeePayrollProfile.findMany({
    where: { orgId, employeeId: { in: stillHere.map((e) => e.id) } },
  });
  const byEmployee = new Map(profiles.map((p) => [p.employeeId, p]));

  return stillHere
    .filter((e) => {
      const p = byEmployee.get(e.id);
      /* No profile means nobody has said how this person is paid, which is not
         the same as excluding them — they are eligible and will fail
         validation with a reason. */
      if (!p) return true;
      if (p.payrollStatus !== 'IN_PAYROLL') return false;
      if (opts.payGroupId && p.payGroupId && p.payGroupId !== opts.payGroupId) return false;
      return true;
    })
    .map((e) => ({ employee: e, profile: byEmployee.get(e.id) || null }));
}

type LoadedRun = Awaited<ReturnType<typeof loadRunContext>>;

/**
 * Everything the run needs, in a handful of queries.
 *
 * Read once and passed around, because the alternative is the same rows
 * fetched per employee — which is the difference between a run that takes a
 * second and one that takes a minute.
 */
async function loadRunContext(orgId: string, runId: string) {
  const run = await payrollPrisma.payrollRun.findFirst({ where: { orgId, id: runId } });
  if (!run) throw new Error('No such payroll run.');

  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId } });
  if (!period) throw new Error('This run has no payroll period.');

  const members = await payrollPrisma.payrollRunEmployee.findMany({
    where: { orgId, runId, inclusion: 'INCLUDED' },
  });
  const employeeIds = members.map((m) => m.employeeId);

  const [employees, profiles, inputs, adjustments, assignments] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: employeeIds } } }),
    payrollPrisma.payrollInput.findMany({ where: { orgId, runId } }),
    payrollPrisma.payrollAdjustment.findMany({
      where: { orgId, periodId: run.periodId, employeeId: { in: employeeIds }, status: { in: ['APPROVED', 'CONSUMED'] } },
    }),
    /* Every assignment for these people that could cover the period end; the
       right one per person is picked in memory. */
    payrollPrisma.salaryAssignment.findMany({
      where: {
        orgId,
        employeeId: { in: employeeIds },
        status: { not: 'CANCELLED' },
        effectiveFrom: { lte: period.endDate },
      },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);

  const structureIds = [...new Set(assignments.map((a) => a.structureId))];
  const structures = await payrollPrisma.salaryStructure.findMany({
    where: { orgId, id: { in: structureIds } },
    include: { components: true },
  });
  /* Four rules for four hundred people: read once, applied per employee. */
  const statutoryRules = await loadRules(orgId);

  /* Loan instalments falling due this period, read in one query for the same
     reason. */
  const recoveries = await recoveriesDue(orgId, run.periodId, employeeIds);

  /*
   * Components a payslip can name.
   *
   * The structure's own, plus every component an adjustment or a loan recovery
   * points at. Those are almost never in a structure — a structure locks its
   * components the moment anybody is assigned to it, so a bonus or a loan
   * deduction added afterwards lives outside every structure in the company.
   *
   * Reading only the structure's left those lines named "Adjustment" and "Loan
   * recovery" on the payslip, with no ledger mapping: the person could not see
   * what they had been paid for, two different bonuses collapsed into one
   * column on the register, and posting fell back to looking the mapping up
   * again. The names are the component's; this is where they come from.
   */
  const componentIds = [
    ...new Set([
      ...structures.flatMap((s) => s.components.map((c) => c.componentId)),
      ...adjustments.map((a) => a.componentId),
      ...recoveries.map((r) => r.componentId),
    ]),
  ];

  /*
   * And the components that reach people without a structure.
   *
   * A component can say it applies to everybody, or to everybody matching a
   * set of conditions — see services/payroll/eligibility.ts. Those are not on
   * anybody's structure by definition, so reading only the structures' would
   * leave them out of the run entirely and the rule would do nothing at all.
   *
   * Read for the whole org rather than per employee: it is one query for a
   * handful of rows, and whether each one applies is decided per person
   * afterwards, in memory.
   */
  const components = await payrollPrisma.salaryComponent.findMany({
    where: {
      orgId,
      OR: [
        /* Named by a structure, an adjustment or a recovery — wanted whatever
           its state, because a payslip that already carries the line still has
           to be able to name it. */
        { id: { in: componentIds } },
        /* Reaching people on its own, which only a live component may do. */
        { isActive: true, appliesTo: { in: ['ALL_EMPLOYEES', 'CONDITIONS'] } },
      ],
    },
    include: { conditions: { orderBy: { displayOrder: 'asc' } }, employeeTargets: true },
  });

  return {
    statutoryRules,
    recoveriesByEmployee: recoveries.reduce((m, r) => {
      const list = m.get(r.employeeId) || [];
      list.push(r);
      m.set(r.employeeId, list);
      return m;
    }, new Map<string, DueRecovery[]>()),
    run,
    period,
    members,
    employees: new Map(employees.map((e) => [e.id, e])),
    profiles: new Map(profiles.map((p) => [p.employeeId, p])),
    inputs: new Map(inputs.map((i) => [i.employeeId, i])),
    adjustmentsByEmployee: adjustments.reduce((m, a) => {
      const list = m.get(a.employeeId) || [];
      list.push(a);
      m.set(a.employeeId, list);
      return m;
    }, new Map<string, typeof adjustments>()),
    assignments,
    structures: new Map(structures.map((s) => [s.id, s])),
    components: new Map(components.map((c) => [c.id, c])),
  };
}

/** The salary in force on a day — the same rule the effective endpoint uses. */
function assignmentOn(ctx: LoadedRun, employeeId: string, onDate: string) {
  return (
    ctx.assignments.find(
      (a) =>
        a.employeeId === employeeId &&
        a.effectiveFrom <= onDate &&
        (!a.effectiveTo || a.effectiveTo >= onDate)
    ) || null
  );
}

/**
 * What the engine is asked to calculate for one person.
 *
 * Two sources, and they meet here. The salary structure they are assigned to
 * is the spine — basic, HRA, PF — and is the same for everyone on it. Beside
 * it are the components that reach people on their own terms: applying to
 * everybody, or to everybody matching a set of conditions, or to one person
 * who has been named. See services/payroll/eligibility.ts for why those exist
 * at all; the short version is that the alternative was forking a structure
 * per exception, and forked structures drift.
 *
 * A structure line is still checked, because a component on a structure can
 * also carry an exclusion — "this allowance, but not for Priya" — and the
 * exclusion has to win there too, or the only way to honour it would be a
 * second structure, which is the thing being avoided.
 */
function engineComponentsFor(
  ctx: LoadedRun,
  structureId: string,
  facts: EligibilityFacts
): { components: EngineComponent[]; skipped: Array<{ code: string; name: string; reason: string }> } {
  const structure = ctx.structures.get(structureId);
  const out: EngineComponent[] = [];
  const skipped: Array<{ code: string; name: string; reason: string }> = [];
  const seen = new Set<string>();
  const period = { periodStart: ctx.period.startDate, periodEnd: ctx.period.endDate };

  const asEngine = (
    c: NonNullable<ReturnType<LoadedRun['components']['get']>>,
    line?: { calculationMethod: string | null; amount: unknown; percentage: unknown; formula: string | null; calculationBase: string | null; isBalancing: boolean; displayOrder: number }
  ): EngineComponent => ({
    componentId: c.id,
    code: c.code,
    name: c.name,
    type: c.type as EngineComponent['type'],
    calculationMethod: (line?.calculationMethod || c.calculationMethod) as EngineComponent['calculationMethod'],
    amount: Number(line?.amount ?? c.amount ?? 0),
    percentage: Number(line?.percentage ?? c.percentage ?? 0),
    formula: line?.formula ?? c.formula ?? null,
    calculationBase: line?.calculationBase ?? c.calculationBase ?? null,
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
    isBalancing: line?.isBalancing ?? false,
    thresholdBase: c.thresholdBase,
    thresholdOperator: c.thresholdOperator,
    thresholdAmount: Number(c.thresholdAmount ?? 0),
    thresholdRangeEnd: Number(c.thresholdRangeEnd ?? 0),
    hasMaxLimit: c.hasMaxLimit,
    maximumAmount: Number(c.maximumAmount ?? 0),
    exceedBehaviour: c.exceedBehaviour,
    displayOrder: line?.displayOrder ?? c.displayOrder,
    expenseLedgerId: c.expenseLedgerId,
    liabilityLedgerId: c.liabilityLedgerId,
  });

  const targeting = (c: { appliesTo: string | null; oneTimeDate: string | null; conditions?: unknown; employeeTargets?: unknown }) => ({
    appliesTo: c.appliesTo,
    oneTimeDate: c.oneTimeDate,
    conditions: (c.conditions as Array<{ field: string; operator: string; value: string | null }>) || [],
    employeeTargets: (c.employeeTargets as Array<{ employeeId: string; mode: string }>) || [],
  });

  for (const line of structure?.components || []) {
    const c = ctx.components.get(line.componentId);
    if (!c) continue;
    const verdict = componentApplies(targeting(c), facts, { onStructure: true, ...period });
    seen.add(c.id);
    if (!verdict.applies) {
      skipped.push({ code: c.code, name: c.name, reason: verdict.reason });
      continue;
    }
    out.push(asEngine(c, line));
  }

  /* The ones that reach this person without going through a structure. */
  for (const c of ctx.components.values()) {
    if (seen.has(c.id)) continue;
    const appliesTo = String(c.appliesTo || 'STRUCTURE').toUpperCase();
    if (appliesTo !== 'ALL_EMPLOYEES' && appliesTo !== 'CONDITIONS') continue;
    const verdict = componentApplies(targeting(c), facts, { onStructure: false, ...period });
    if (!verdict.applies) continue;
    out.push(asEngine(c));
  }

  return { components: out, skipped };
}

/** One person, as the eligibility rules are allowed to see them. */
function factsFor(ctx: LoadedRun, employeeId: string, onDate: string): EligibilityFacts {
  const employee = ctx.employees.get(employeeId);
  const profile = ctx.profiles.get(employeeId);
  const assignment = assignmentOn(ctx, employeeId, onDate);
  const annualCtc = assignment ? Number(assignment.annualCtc || 0) : null;
  return {
    employeeId,
    department: employee?.department ?? null,
    designation: employee?.designation ?? null,
    status: employee?.status ?? null,
    branchId: employee?.branchId ?? null,
    dateOfJoining: employee?.dateOfJoining ?? null,
    payrollStatus: profile?.payrollStatus ?? null,
    payGroupId: profile?.payGroupId ?? null,
    costCenterId: profile?.costCenterId ?? null,
    taxRegime: profile?.taxRegime ?? null,
    professionalTaxState: profile?.professionalTaxState ?? null,
    pfApplicable: profile?.pfApplicable ?? null,
    esiApplicable: profile?.esiApplicable ?? null,
    ptApplicable: profile?.ptApplicable ?? null,
    annualCtc,
    monthlyCtc: assignment ? Number(assignment.monthlyCtc || 0) : null,
    structureId: assignment?.structureId ?? null,
    monthsOfService: monthsOfService(employee?.dateOfJoining ?? null, onDate),
  };
}

/**
 * What a person is paid, worked out in two passes.
 *
 * The statutory schemes need the wages before they can compute — PF is a share
 * of PF wages, ESI applies only under a threshold on ESI wages — and those
 * wages are themselves an output of the structure. So the structure is
 * calculated once with the statutory lines at nil to learn the wages, the
 * schemes are computed on those wages, and the structure is calculated again
 * with the real amounts supplied.
 *
 * Two passes rather than an iteration: statutory deductions come out of pay and
 * never feed back into the wages they are computed on, so the second pass is
 * final. A third would produce the same numbers.
 */
function calculateWithStatutory(
  ctx: LoadedRun,
  engine: EngineComponent[],
  input: ReturnType<typeof inputFor>,
  assignment: any,
  profile: any,
  periodsPerYear: number
) {
  const engineInput = {
    annualCtc: Number(assignment.annualCtc),
    periodsPerYear,
    workingDays: input.workingDays,
    payableDays: input.payableDays,
    lwpDays: input.lwpDays,
    variableAmounts: { VARIABLE_PAY: input.variablePay, OVERTIME: input.overtimeAmount },
  };

  const firstPass = calculateStructure(engine, engineInput);

  if (!ctx.statutoryRules.size) {
    return { result: firstPass, statutory: { amounts: {}, results: [], versions: {} } };
  }

  /* Months left in the Indian financial year, which is what TDS spreads over. */
  const month = Number(ctx.run.payrollDate.slice(5, 7)) || 1;
  const monthsRemaining = month >= 4 ? 12 - month + 1 : 4 - month;

  const statutory = applyStatutory({
    rules: ctx.statutoryRules,
    onDate: ctx.run.payrollDate,
    wages: {
      pfWage: firstPass.pfWage,
      esiWage: firstPass.esiWage,
      gross: firstPass.grossEarnings,
      annualTaxable: firstPass.grossEarnings * periodsPerYear,
    },
    employee: {
      pfApplicable: !!profile?.pfApplicable,
      esiApplicable: !!profile?.esiApplicable,
      ptApplicable: !!profile?.ptApplicable,
      professionalTaxState: profile?.professionalTaxState ?? null,
      taxRegime: (profile?.taxRegime as 'OLD' | 'NEW') || 'NEW',
    },
    components: engine.map((c) => ({ code: c.code, statutoryScheme: c.statutoryScheme, type: c.type })),
    monthsRemaining: Math.max(1, monthsRemaining),
    taxAlreadyDeducted: 0,
  });

  if (!Object.keys(statutory.amounts).length) {
    return { result: firstPass, statutory };
  }

  return {
    result: calculateStructure(engine, { ...engineInput, statutoryAmounts: statutory.amounts }),
    statutory,
  };
}

/** Days in the period, and the input a run was given for one person. */
function inputFor(ctx: LoadedRun, employeeId: string) {
  const stored = ctx.inputs.get(employeeId);
  const periodDays = daysBetween(ctx.period.startDate, ctx.period.endDate);
  const employee = ctx.employees.get(employeeId);

  /*
   * Joining or leaving mid-period reduces payable days by default, because
   * that is what actually happened — somebody who joined on the 16th is not
   * owed a full month, and expecting payroll staff to work the fraction out by
   * hand is how a month's salary gets paid to a person who worked a week.
   */
  let payable = periodDays;
  if (employee?.dateOfJoining && employee.dateOfJoining > ctx.period.startDate) {
    payable -= daysBetween(ctx.period.startDate, employee.dateOfJoining) - 1;
  }
  if (employee?.dateOfLeaving && employee.dateOfLeaving < ctx.period.endDate) {
    payable -= daysBetween(employee.dateOfLeaving, ctx.period.endDate) - 1;
  }
  payable = Math.max(0, payable);

  return {
    workingDays: stored ? Number(stored.workingDays) || periodDays : periodDays,
    payableDays: stored ? Number(stored.payableDays) : payable,
    lwpDays: stored ? Number(stored.lwpDays) || 0 : 0,
    variablePay: stored ? Number(stored.variablePay) || 0 : 0,
    overtimeAmount: stored ? Number(stored.overtimeAmount) || 0 : 0,
    source: stored?.source || 'DERIVED',
    derived: !stored,
  };
}

/**
 * What would stop this run producing a payslip somebody could defend.
 *
 * Errors block; warnings do not. The distinction is whether the payslip would
 * be wrong or merely surprising — no salary assignment is wrong, a net pay that
 * has moved 40% is surprising and often correct.
 */
export async function validateRun(orgId: string, runId: string): Promise<{ issues: RunIssue[]; byEmployee: Map<string, RunIssue[]> }> {
  const ctx = await loadRunContext(orgId, runId);
  const issues: RunIssue[] = [];
  const byEmployee = new Map<string, RunIssue[]>();

  const add = (issue: RunIssue) => {
    issues.push(issue);
    if (issue.employeeId) {
      const list = byEmployee.get(issue.employeeId) || [];
      list.push(issue);
      byEmployee.set(issue.employeeId, list);
    }
  };

  if (ctx.period.isLocked) {
    add({ severity: 'ERROR', code: 'PERIOD_LOCKED', message: `${ctx.period.name} is closed, so no payroll can be run for it.` });
  }
  if (!ctx.members.length) {
    add({ severity: 'ERROR', code: 'NO_EMPLOYEES', message: 'Nobody is included in this run.' });
  }

  /* A second run over the same people and period would pay them twice. */
  const siblings = await payrollPrisma.payrollRun.findMany({
    where: {
      orgId,
      periodId: ctx.run.periodId,
      id: { not: runId },
      status: { in: ['CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED', 'PAID', 'POSTED'] },
    },
    select: { id: true, number: true },
  });
  if (siblings.length) {
    const otherSlips = await payrollPrisma.salarySlip.findMany({
      where: { orgId, runId: { in: siblings.map((s) => s.id) }, employeeId: { in: ctx.members.map((m) => m.employeeId) } },
      select: { employeeId: true, number: true },
    });
    for (const slip of otherSlips) {
      add({
        severity: 'ERROR',
        code: 'ALREADY_PAID_THIS_PERIOD',
        employeeId: slip.employeeId,
        message: `Already has a payslip for ${ctx.period.name} (${slip.number}).`,
      });
    }
  }

  for (const member of ctx.members) {
    const employee = ctx.employees.get(member.employeeId);
    if (!employee) {
      add({ severity: 'ERROR', code: 'NO_EMPLOYEE', employeeId: member.employeeId, message: 'This person no longer exists.' });
      continue;
    }
    const who = employee.name;
    const profile = ctx.profiles.get(employee.id);

    /*
     * Being in the staff directory is not being in payroll.
     *
     * A payroll profile is where somebody's bank account, PAN and UAN live,
     * and which statutory schemes apply to them. Without one there is nowhere
     * to pay the money, no number to deduct tax against, and nothing to file.
     *
     * The rule was described in the eligibility filter above — "they are
     * eligible and will fail validation with a reason" — and the reason was
     * never written. So a run happily paid people with no profile while
     * payroll's own setup screen, which counts profiles, said nobody was in
     * payroll. Seven payslips and a screen saying there was no one: both
     * correct, because they were counting different things.
     */
    if (!profile) {
      add({
        severity: 'ERROR',
        code: 'NO_PAYROLL_PROFILE',
        employeeId: employee.id,
        message: `${who} is on the staff list but not in payroll — no bank account, PAN or statutory details. Add their payroll details, or take them out of this run.`,
      });
      continue;
    }

    if (profile.payrollStatus !== 'IN_PAYROLL') {
      /* Held after they were included: somebody put them on hold between the
         run being started and being checked. */
      add({
        severity: 'ERROR',
        code: 'NOT_IN_PAYROLL',
        employeeId: employee.id,
        message: `${who} is ${String(profile.payrollStatus || 'not in payroll').toLowerCase().replace(/_/g, ' ')}, so this payroll cannot pay them.`,
      });
      continue;
    }

    const assignment = assignmentOn(ctx, employee.id, ctx.period.endDate) || assignmentOn(ctx, employee.id, ctx.period.startDate);

    if (!assignment) {
      add({
        severity: 'ERROR',
        code: 'NO_ASSIGNMENT',
        employeeId: employee.id,
        message: `${who} has no salary covering ${ctx.period.name}.`,
      });
      continue;
    }

    const structure = ctx.structures.get(assignment.structureId);
    if (!structure) {
      add({ severity: 'ERROR', code: 'NO_STRUCTURE', employeeId: employee.id, message: `${who}'s salary structure no longer exists.` });
      continue;
    }
    if (structure.effectiveFrom > ctx.period.endDate) {
      add({
        severity: 'ERROR',
        code: 'STRUCTURE_NOT_EFFECTIVE',
        employeeId: employee.id,
        message: `${who} is on ${structure.name}, which only takes effect on ${structure.effectiveFrom}.`,
      });
    }
    if (Number(assignment.annualCtc) <= 0) {
      add({ severity: 'ERROR', code: 'NO_CTC', employeeId: employee.id, message: `${who} has no salary figure.` });
    }

    const input = inputFor(ctx, employee.id);
    if (input.payableDays <= 0) {
      add({
        severity: 'WARNING',
        code: 'ZERO_PAYABLE_DAYS',
        employeeId: employee.id,
        message: `${who} has no payable days, so this payslip would be nil.`,
      });
    }
    if (input.payableDays > input.workingDays) {
      add({
        severity: 'WARNING',
        code: 'PAYABLE_EXCEEDS_WORKING',
        employeeId: employee.id,
        message: `${who} has more payable days than working days.`,
      });
    }

    /* The engine is the authority on whether the numbers work, so it is asked
       rather than guessed at — a circular structure or a negative net is found
       here, before anybody presses Calculate. */
    const { components: engine, skipped } = engineComponentsFor(
      ctx,
      assignment.structureId,
      factsFor(ctx, employee.id, ctx.period.endDate)
    );

    /*
     * A component the rules kept off this payslip, said out loud.
     *
     * Silence here is the failure mode of every rule engine: an allowance
     * stops arriving, the payslip simply does not mention it, and the first
     * anybody knows is the employee asking. A notice at validation time is
     * where that question gets answered before the run.
     */
    for (const s of skipped) {
      add({
        severity: 'INFO',
        code: 'COMPONENT_SKIPPED',
        employeeId: employee.id,
        message: `${who}: ${s.name} does not apply — ${s.reason}.`,
      });
    }

    if (!engine.length) {
      add({
        severity: 'ERROR',
        code: 'EMPTY_STRUCTURE',
        employeeId: employee.id,
        message: `${who} is on ${structure.name}, which has no components.`,
      });
    } else {
      const { result: trial } = calculateWithStatutory(
        ctx,
        engine,
        input,
        assignment,
        profile,
        PERIODS_PER_YEAR[structure.frequency] ?? 12
      );
      for (const e of trial.errors) {
        add({ severity: 'ERROR', code: e.code, employeeId: employee.id, message: `${who}: ${e.message}` });
      }
      for (const w of trial.warnings) {
        add({ severity: 'WARNING', code: w.code, employeeId: employee.id, message: `${who}: ${w.message}` });
      }
    }

    /* Not blocking: payroll can be calculated and reviewed without them, and
       only paying needs them. Saying so now saves a scramble on payment day. */
    if (!profile?.bankAccountNumber) {
      add({ severity: 'WARNING', code: 'NO_BANK_ACCOUNT', employeeId: employee.id, message: `${who} has no bank account on file.` });
    }
    if (!profile?.pan) {
      add({ severity: 'INFO', code: 'NO_PAN', employeeId: employee.id, message: `${who} has no PAN on file.` });
    }
    if (input.derived) {
      add({
        severity: 'INFO',
        code: 'DAYS_DERIVED',
        employeeId: employee.id,
        message: `${who}'s days were worked out from the period and their dates; nobody has entered them.`,
      });
    }
  }

  return { issues, byEmployee };
}

export type CalculatedSlip = {
  employeeId: string;
  grossEarnings: number;
  totalDeductions: number;
  employerContributions: number;
  netPay: number;
  employerCost: number;
  previousNetPay: number | null;
  variancePercent: number | null;
};

/**
 * Work out every payslip in the run and store them, with their reasoning.
 *
 * Replaces whatever the run held before — recalculating is an ordinary thing to
 * do while a run is still open, and a half-replaced set of payslips is worse
 * than either version.
 */
export async function calculateRun(orgId: string, runId: string, userId: string): Promise<{ slips: CalculatedSlip[]; issues: RunIssue[] }> {
  const { issues } = await validateRun(orgId, runId);
  const blocking = issues.filter((i) => i.severity === 'ERROR');
  if (blocking.length) {
    return { slips: [], issues };
  }

  const ctx = await loadRunContext(orgId, runId);
  const periodsPerYear = (structureId: string) =>
    PERIODS_PER_YEAR[ctx.structures.get(structureId)?.frequency || 'MONTHLY'] ?? 12;

  /* What each person took home last time, for variance. One query. */
  const previousSlips = await payrollPrisma.salarySlip.findMany({
    where: {
      orgId,
      employeeId: { in: ctx.members.map((m) => m.employeeId) },
      periodId: { not: ctx.run.periodId },
      status: { in: ['CALCULATED', 'APPROVED', 'LOCKED', 'PAID'] },
    },
    orderBy: { payrollDate: 'desc' },
    select: { employeeId: true, netPay: true, payrollDate: true },
  });
  const previousByEmployee = new Map<string, number>();
  for (const s of previousSlips) if (!previousByEmployee.has(s.employeeId)) previousByEmployee.set(s.employeeId, Number(s.netPay));

  const results: CalculatedSlip[] = [];
  const writes: { slip: any; lines: any[]; traces: any[] }[] = [];
  /* Which one-off adjustments this calculation actually used, so each can be
     marked spent and traced back to the payroll that spent it. */
  const consumedAdjustmentIds: string[] = [];
  /* Loan instalments this calculation took in full, marked once the payslips
     are written rather than while they are being worked out — the instalment
     records the payslip that recovered it, so it needs the slip to exist. */
  const recoveredInstallments: { employeeId: string; installmentId: string }[] = [];
  /* Every loan this run touched, whether it recovered from it or not — a loan
     whose instalment was skipped still needs its outstanding re-derived. */
  const loanIdsTouched: string[] = [];

  for (const member of ctx.members) {
    const employee = ctx.employees.get(member.employeeId)!;
    const profile = ctx.profiles.get(employee.id) || null;
    const assignment = assignmentOn(ctx, employee.id, ctx.period.endDate) || assignmentOn(ctx, employee.id, ctx.period.startDate)!;
    const structure = ctx.structures.get(assignment.structureId)!;
    const input = inputFor(ctx, employee.id);
    const adjustments = ctx.adjustmentsByEmployee.get(employee.id) || [];

    const { components: engine } = engineComponentsFor(
      ctx,
      assignment.structureId,
      factsFor(ctx, employee.id, ctx.period.endDate)
    );
    const { result, statutory } = calculateWithStatutory(
      ctx,
      engine,
      input,
      assignment,
      profile,
      periodsPerYear(assignment.structureId)
    );

    /*
     * Adjustments are added after the structure, not inside it. A bonus is not
     * part of what somebody is on — it happened once, in this period — and
     * folding it into the structure would make the same structure pay
     * different amounts to different people.
     */
    let adjustmentEarnings = 0;
    let adjustmentDeductions = 0;
    const adjustmentLines: any[] = [];
    for (const adj of adjustments) {
      consumedAdjustmentIds.push(adj.id);
      const component = ctx.components.get(adj.componentId);
      const amount = Number(adj.amount) || 0;
      const isDeduction = adj.type === 'DEDUCTION' || component?.type === 'DEDUCTION';
      if (isDeduction) adjustmentDeductions += amount;
      else adjustmentEarnings += amount;
      adjustmentLines.push({
        componentId: adj.componentId,
        componentCode: component?.code || 'ADJUSTMENT',
        componentName: component?.name || 'Adjustment',
        type: isDeduction ? 'DEDUCTION' : 'EARNING',
        amount,
        isTaxable: component?.isTaxable ?? true,
        displayOrder: 900,
        expenseLedgerId: component?.expenseLedgerId ?? null,
        liabilityLedgerId: component?.liabilityLedgerId ?? null,
      });
    }

    const grossEarnings = round2(result.grossEarnings + adjustmentEarnings);
    let totalDeductions = round2(result.totalDeductions + adjustmentDeductions);
    let netPay = round2(result.netPay + adjustmentEarnings - adjustmentDeductions);
    const employerCost = round2(result.employerCost + adjustmentEarnings);

    /*
     * Loan recovery comes last, against what is actually left.
     *
     * Last because it is the only deduction that has to know the answer to
     * everything before it: an instalment is capped at what remains, so that a
     * month where somebody earned less than they owe produces a small recovery
     * rather than a negative payslip. What is not taken stays owed.
     */
    for (const recovery of ctx.recoveriesByEmployee.get(employee.id) || []) {
      loanIdsTouched.push(recovery.loanId);
      const amount = recoverable(recovery.dueAmount, netPay);
      if (amount <= 0) continue;

      const component = ctx.components.get(recovery.componentId);
      totalDeductions = round2(totalDeductions + amount);
      netPay = round2(netPay - amount);
      adjustmentLines.push({
        componentId: recovery.componentId,
        componentCode: component?.code || 'LOAN',
        componentName: component?.name || 'Loan recovery',
        type: 'DEDUCTION',
        amount,
        isTaxable: false,
        displayOrder: 950,
        expenseLedgerId: component?.expenseLedgerId ?? null,
        liabilityLedgerId: component?.liabilityLedgerId ?? null,
      });
      /* Only a full instalment closes. A part recovery leaves the instalment
         owed, and next month takes the rest. */
      if (amount >= recovery.dueAmount) recoveredInstallments.push({ employeeId: employee.id, installmentId: recovery.installmentId });
    }

    const previousNetPay = previousByEmployee.has(employee.id) ? previousByEmployee.get(employee.id)! : null;
    const variancePercent =
      previousNetPay && previousNetPay !== 0 ? round2(((netPay - previousNetPay) / previousNetPay) * 100) : null;

    writes.push({
      slip: {
        accountId: ctx.run.accountId,
        orgId,
        branchId: assignment.branchId || employee.branchId || ctx.run.branchId || null,
        runId,
        employeeId: employee.id,
        periodId: ctx.run.periodId,
        payrollDate: ctx.run.payrollDate,
        grossEarnings,
        totalDeductions,
        employerContributions: result.employerContributions,
        netPay,
        employerCost,
        previousNetPay,
        variancePercent,
        status: 'CALCULATED',
        engineVersion: ENGINE_VERSION,
        /* The snapshots. A payslip reopened next year reads these, never
           today's configuration. */
        employeeSnapshotJson: JSON.stringify({
          employeeId: employee.id,
          name: employee.name,
          code: employee.code,
          designation: employee.designation,
          department: employee.department,
          dateOfJoining: employee.dateOfJoining,
          dateOfLeaving: employee.dateOfLeaving,
          payrollStatus: profile?.payrollStatus ?? null,
          taxRegime: profile?.taxRegime ?? null,
        }),
        assignmentSnapshotJson: JSON.stringify({
          assignmentId: assignment.id,
          structureId: assignment.structureId,
          effectiveFrom: assignment.effectiveFrom,
          annualCtc: Number(assignment.annualCtc),
          monthlyCtc: Number(assignment.monthlyCtc),
          costCenterId: assignment.costCenterId,
        }),
        structureSnapshotJson: JSON.stringify({
          structureId: structure.id,
          name: structure.name,
          frequency: structure.frequency,
          effectiveFrom: structure.effectiveFrom,
          components: engine,
        }),
        inputSnapshotJson: JSON.stringify({ ...input, periodDays: daysBetween(ctx.period.startDate, ctx.period.endDate) }),
        adjustmentSnapshotJson: JSON.stringify(
          adjustments.map((a) => ({ id: a.id, componentId: a.componentId, amount: Number(a.amount), type: a.type, reason: a.reason }))
        ),
        /* Which rule version produced each statutory figure. A rate published
           in October must not change what this payslip says. */
        statutorySnapshotJson: JSON.stringify({
          versions: statutory.versions,
          results: statutory.results.map((r) => ({
            scheme: r.scheme,
            employee: r.employee,
            employer: r.employer,
            employerSplit: r.employerSplit ?? null,
            wageApplied: r.wageApplied,
            rateApplied: r.rateApplied,
            ceilingApplied: r.ceilingApplied,
            explanation: r.explanation,
            exemptReason: r.exemptReason ?? null,
            ruleVersion: r.ruleVersion,
          })),
        }),
        createdByUserId: userId,
      },
      lines: [
        ...result.lines.map((l) => ({
          accountId: ctx.run.accountId,
          orgId,
          componentId: l.componentId,
          componentCode: l.code,
          componentName: l.name,
          type: l.type,
          amount: l.amount,
          fullAmount: l.fullAmount,
          isTaxable: l.isTaxable,
          displayOrder: l.displayOrder,
          expenseLedgerId: l.expenseLedgerId,
          liabilityLedgerId: l.liabilityLedgerId,
          costCenterId: assignment.costCenterId || profile?.costCenterId || null,
        })),
        ...adjustmentLines.map((l) => ({
          accountId: ctx.run.accountId,
          orgId,
          ...l,
          fullAmount: l.amount,
          costCenterId: assignment.costCenterId || profile?.costCenterId || null,
        })),
      ],
      traces: result.trace.map((t, i) => {
        /* A statutory line's rule text is the scheme's own explanation — the
           ceiling that bound it, or the threshold that exempted it — rather
           than the bare words "PF rule". */
        const component = engine.find((c) => c.code.toUpperCase() === t.code);
        const scheme = component?.statutoryScheme
          ? statutory.results.find((r) => r.scheme === component.statutoryScheme)
          : null;
        return {
        accountId: ctx.run.accountId,
        orgId,
        componentId: t.componentId,
        componentCode: t.code,
        baseLabel: scheme ? 'Statutory wages' : t.baseLabel,
        baseAmount: scheme ? scheme.wageApplied : t.baseAmount,
        ruleText: scheme ? scheme.explanation : t.ruleText,
        formula: t.formula,
        computedAmount: t.computedAmount,
        prorationFactor: t.prorationFactor,
        roundingApplied: t.roundingApplied,
        statutoryRuleId: scheme?.ruleId ?? null,
        statutoryRuleVersion: scheme?.ruleVersion ?? null,
        detailJson: scheme?.employerSplit ? JSON.stringify(scheme.employerSplit) : '{}',
        displayOrder: i,
        };
      }),
    });

    results.push({
      employeeId: employee.id,
      grossEarnings,
      totalDeductions,
      employerContributions: result.employerContributions,
      netPay,
      employerCost,
      previousNetPay,
      variancePercent,
    });
  }

  const totals = results.reduce(
    (t, r) => ({
      gross: t.gross + r.grossEarnings,
      deductions: t.deductions + r.totalDeductions,
      employer: t.employer + r.employerContributions,
      net: t.net + r.netPay,
      cost: t.cost + r.employerCost,
    }),
    { gross: 0, deductions: 0, employer: 0, net: 0, cost: 0 }
  );

  await payrollPrisma.$transaction(async (tx) => {
    /* Replaced wholesale: recalculating is ordinary while a run is open, and a
       half-replaced set of payslips is worse than either version. */
    const old = await tx.salarySlip.findMany({ where: { orgId, runId }, select: { id: true } });
    const oldIds = old.map((s) => s.id);
    if (oldIds.length) {
      await tx.payrollCalculationTrace.deleteMany({ where: { slipId: { in: oldIds } } });
      await tx.salarySlipLine.deleteMany({ where: { slipId: { in: oldIds } } });
      await tx.salarySlip.deleteMany({ where: { id: { in: oldIds } } });
    }

    let n = 0;
    for (const w of writes) {
      n += 1;
      const slip = await tx.salarySlip.create({
        data: { ...w.slip, number: `${ctx.run.number}-${String(n).padStart(4, '0')}` },
      });
      if (w.lines.length) await tx.salarySlipLine.createMany({ data: w.lines.map((l) => ({ ...l, slipId: slip.id })) });
      if (w.traces.length) {
        await tx.payrollCalculationTrace.createMany({ data: w.traces.map((t) => ({ ...t, slipId: slip.id })) });
      }

      /* The instalment records which payslip took it, which is what lets
         somebody asked about a recovery answer from the loan. */
      const taken = recoveredInstallments.filter((r) => r.employeeId === w.slip.employeeId).map((r) => r.installmentId);
      if (taken.length) {
        await tx.payrollLoanInstallment.updateMany({
          where: { orgId, id: { in: taken } },
          data: { status: 'RECOVERED', slipId: slip.id, recoveredAt: new Date() },
        });
      }
    }

    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'CALCULATED',
        calculatedAt: new Date(),
        engineVersion: ENGINE_VERSION,
        employeeCount: results.length,
        grossTotal: round2(totals.gross),
        deductionTotal: round2(totals.deductions),
        employerContributionTotal: round2(totals.employer),
        netTotal: round2(totals.net),
        employerCostTotal: round2(totals.cost),
        errorCount: 0,
        warningCount: issues.filter((i) => i.severity === 'WARNING').length,
      },
    });

    await tx.payrollRunEmployee.updateMany({ where: { orgId, runId }, data: { state: 'CALCULATED' } });

    /*
     * A one-off is spent once.
     *
     * Marked here rather than when it is approved, because approving says it
     * *should* be paid and only a calculation says it *was* — and recording
     * the run that paid it is what lets somebody asked "where did that bonus
     * go" answer from the adjustment rather than by searching payslips.
     *
     * Recalculating is ordinary while a run is open, and it re-consumes the
     * same set: a rerun replaces the payslips wholesale, so the adjustments
     * belong to whichever calculation currently stands.
     */
    await tx.payrollAdjustment.updateMany({
      where: { orgId, id: { in: consumedAdjustmentIds } },
      data: { status: 'CONSUMED', consumedByRunId: runId },
    });
    /* An adjustment this run consumed before, and no longer does — somebody
       was taken out of the payroll — goes back to being owed. */
    await tx.payrollAdjustment.updateMany({
      where: { orgId, consumedByRunId: runId, id: { notIn: consumedAdjustmentIds } },
      data: { status: 'APPROVED', consumedByRunId: null },
    });

    /*
     * A recalculation un-recovers what it no longer takes.
     *
     * The payslips are replaced wholesale, so an instalment whose payslip has
     * just been deleted must go back to PENDING — otherwise a run recalculated
     * after somebody was taken out of it leaves their loan looking repaid by a
     * payslip that no longer exists.
     */
    await tx.payrollLoanInstallment.updateMany({
      where: { orgId, slipId: { in: oldIds }, status: 'RECOVERED', id: { notIn: recoveredInstallments.map((r) => r.installmentId) } },
      data: { status: 'PENDING', slipId: null, recoveredAt: null },
    });

    /* Each loan's outstanding is the schedule's, re-derived rather than
       decremented: a counter that drifts from its instalments is a counter
       nobody can trust. */
    const touched = [...new Set(loanIdsTouched)];
    for (const loanId of touched) {
      const installments = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId } });
      const left = installments.filter((i) => i.status === 'PENDING');
      const outstanding = round2(left.reduce((t, i) => t + Number(i.dueAmount), 0));
      await tx.payrollLoan.update({
        where: { id: loanId },
        data: { outstandingBalance: outstanding, status: left.length ? 'ACTIVE' : 'COMPLETED' },
      });
    }
  });

  return { slips: results, issues };
}


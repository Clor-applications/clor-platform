import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { round2 } from '../../utils/money.js';
import { snapshotPerson } from './payment.js';
import { ageBandFor, incomeTax, ruleInForce } from './statutory/engine.js';
import { isEmployerNps, taxablePayOf } from './taxablePay.js';
import { loadRules, toEngineRule } from './statutory/resolve.js';
import { deductionsFor, previousEmployerOf, yearRegimes } from './taxDeclaration.js';
import { openingFor } from './openingYtd.js';

/**
 * Salary TDS for a financial year, from payslips that went past review:
 *
 * - Form 16 Part B — the year's salary, exemptions, deductions, tax, and what
 *   was deducted. (Part A, the certificate of deposits, comes from TRACES.)
 * - Form 24Q Annexure I — per quarter, each person's salary and TDS by month,
 *   the rows a return-preparation tool takes.
 *
 * Worked out with the same function monthly TDS uses (statutory/engine.ts
 * incomeTax), so the certificate and the payslips agree on how tax was found.
 */

const SETTLED = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

export const fyBounds = (fy: string) => {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
};

/** 1 for April–June … 4 for January–March. */
export const quarterOf = (isoDate: string) => {
  const m = Number(isoDate.slice(5, 7));
  return m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
};

type Month = { month: string; paymentDate: string; gross: number; tds: number };

/**
 * `by`: which payslips make up the year.
 *
 * - PERIOD (Form 16, the default): the pay the year is FOR. March's salary
 *   paid on 1 April is March's, so it is in the year ending that March, as the
 *   monthly TDS treated it (audit 7 Nov 2026, #1). Months are pay months.
 * - PAYMENT (Form 24Q): tax is reported in the quarter it was deducted, and
 *   salary tax is deducted when it is paid, so the return goes by payment date.
 *   March's salary paid on 1 April is in the next year's first quarter there.
 *   (To confirm with a tax practitioner: both readings are listed in the PR.)
 */
export async function taxYear(orgId: string, fy: string, only?: string, by: 'PERIOD' | 'PAYMENT' = 'PERIOD') {
  const { from, to } = fyBounds(fy);
  const inYear =
    by === 'PAYMENT'
      ? null
      : /* By the period's last day (review of #146, 3): 26 March to 25 April is the new year's April. */
        await payrollPrisma.payrollPeriod.findMany({ where: { orgId, endDate: { gte: from, lte: to } }, select: { id: true } });
  const runs = await payrollPrisma.payrollRun.findMany({
    where: { orgId, status: { in: SETTLED }, ...(inYear ? { periodId: { in: inYear.map((p) => p.id) } } : { payrollDate: { gte: from, lte: to } }) },
    select: { id: true, payrollDate: true, periodId: true },
  });
  const periods = new Map(
    (await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: [...new Set(runs.map((r) => r.periodId))] } }, select: { id: true, paymentDate: true, endDate: true, startDate: true } })).map((p) => [p.id, p])
  );
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId: { in: runs.map((r) => r.id) }, status: { not: 'CANCELLED' }, ...(only ? { employeeId: only } : {}) },
    include: { lines: true },
  });
  const componentIds = [...new Set(slips.flatMap((s) => s.lines.map((l) => l.componentId)))];
  const schemeOf = new Map(
    (await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: componentIds } }, select: { id: true, code: true, statutoryScheme: true, taxSection: true, includeInPfWage: true } })).map((c) => [c.id, c])
  );

  type Acc = { employeeId: string; name: string; code: string; months: Map<string, Month>; gross: number; taxable: number; employerNps: number; pt: number; basic: number; hra: number; pf: number; tds: number };
  const acc = new Map<string, Acc>();
  for (const slip of slips) {
    const run = runOf.get(slip.runId)!;
    const period = periods.get(run.periodId);
    const snap = snapshotPerson(slip.employeeSnapshotJson);
    const a = acc.get(slip.employeeId) || { employeeId: slip.employeeId, name: snap.name || '', code: snap.code || '', months: new Map(), gross: 0, taxable: 0, employerNps: 0, pt: 0, basic: 0, hra: 0, pf: 0, tds: 0 };
    /* PAYMENT (24Q): the day tax was deducted is the day the payroll paid, run.payrollDate, not the period's planned date (review of #146, 7). */
    const key = by === 'PAYMENT' ? run.payrollDate.slice(0, 7) : String(period?.endDate || run.payrollDate).slice(0, 7);
    const m = a.months.get(key) || { month: key, paymentDate: by === 'PAYMENT' ? run.payrollDate : period?.paymentDate || period?.endDate || run.payrollDate, gross: 0, tds: 0 };
    const gross = Number(slip.grossEarnings) || 0;
    let tds = 0;
    for (const l of slip.lines) {
      const amount = Number(l.amount) || 0;
      const scheme = schemeOf.get(l.componentId)?.statutoryScheme;
      if (l.type === 'DEDUCTION' && scheme === 'TDS') tds += amount;
      if (l.type === 'DEDUCTION' && scheme === 'PF') a.pf += amount;
      if (l.type === 'DEDUCTION' && scheme === 'PT') a.pt += amount;
      if (l.type === 'EARNING' && l.componentCode.toUpperCase() === 'HRA') a.hra += amount;
    }
    m.gross = round2(m.gross + gross);
    m.tds = round2(m.tds + tds);
    a.months.set(key, m);
    /* Taxed on taxable earnings and employer NPS, as the monthly TDS was (taxablePay.ts). */
    const pay = taxablePayOf(
      slip.lines.map((l) => ({ type: l.type, amount: l.amount, isTaxable: l.isTaxable, code: l.componentCode, employerNps: isEmployerNps(schemeOf.get(l.componentId)), pfWage: !!schemeOf.get(l.componentId)?.includeInPfWage }))
    );
    /* Basic and DA, or PF wages where the structure has neither, as the monthly TDS counted them: the NPS limit and the HRA exemption. */
    a.basic = round2(a.basic + pay.basicDa);
    a.gross = round2(a.gross + gross);
    a.taxable = round2(a.taxable + pay.taxable);
    a.employerNps = round2(a.employerNps + pay.employerNps);
    a.tds = round2(a.tds + tds);
    acc.set(slip.employeeId, a);
  }

  /*
   * Pay from before CLOR this year (opening figures, #2): in Form 16's totals,
   * as one "earlier this year" amount. Not in 24Q's months: that return was
   * filed, for those months, by whoever ran payroll then.
   */
  const openings = by === 'PERIOD' ? await openingFor(orgId, fy, only ? [only] : await openingIds(orgId, fy)) : new Map();
  for (const [employeeId, o] of openings) {
    const a = acc.get(employeeId) || { employeeId, name: '', code: '', months: new Map(), gross: 0, taxable: 0, employerNps: 0, pt: 0, basic: 0, hra: 0, pf: 0, tds: 0 };
    a.gross = round2(a.gross + o.grossPay);
    a.taxable = round2(a.taxable + o.taxablePay);
    a.tds = round2(a.tds + o.tds);
    a.pt = round2(a.pt + o.professionalTax);
    a.pf = round2(a.pf + o.employeePf);
    /* HRA exemption and 80CCD(2) read these as they read a payslip's (review of #146, 4). */
    a.basic = round2(a.basic + (o.basicDa || 0));
    a.hra = round2(a.hra + (o.hraReceived || 0));
    a.employerNps = round2(a.employerNps + (o.employerNps || 0));
    acc.set(employeeId, a);
  }

  const ids = [...acc.keys()];
  const [people, profiles, declarations, rules] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, designation: true, dateOfJoining: true, dateOfLeaving: true, dateOfBirth: true } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } }, select: { employeeId: true, pan: true, taxRegime: true } }),
    payrollPrisma.taxDeclaration.findMany({ where: { orgId, financialYear: fy, employeeId: { in: ids } } }),
    loadRules(orgId),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  /* Someone with only opening figures (no CLOR payslip yet) has no snapshot: their name and code come from People. */
  for (const a of acc.values()) {
    const p = person.get(a.employeeId);
    if (!a.name && p?.name) a.name = p.name;
    if (!a.code && p?.code) a.code = p.code;
  }
  const profile = new Map(profiles.map((p) => [p.employeeId, p]));
  const declaration = new Map(declarations.map((d) => [d.employeeId, d]));
  const yearRegime = await yearRegimes(orgId, ids, fy);
  const tdsRow = ruleInForce(rules.get('TDS') || [], to, null);
  const rule = tdsRow ? toEngineRule(tdsRow) : null;

  return [...acc.values()]
    .map((a) => {
      const p = person.get(a.employeeId);
      const d = declaration.get(a.employeeId) || null;
      const regime = ((d?.regime || yearRegime.get(a.employeeId) || profile.get(a.employeeId)?.taxRegime) as 'OLD' | 'NEW') || 'NEW';
      const ded = deductionsFor(d && { ...d, regime }, { basic: a.basic, hra: a.hra, employeePf: a.pf });
      const previous = previousEmployerOf(d);
      const year = rule
        ? incomeTax(rule, regime, a.taxable + (previous?.income || 0), ded.total, {
            professionalTax: a.pt + (previous?.professionalTax || 0),
            employerNps: a.employerNps,
            npsWage: a.basic,
            ageBand: ageBandFor(p?.dateOfBirth, to, d?.seniorSelf),
          })
        : null;
      const pan = (profile.get(a.employeeId)?.pan || '').toUpperCase();
      return {
        employeeId: a.employeeId,
        name: p?.name || a.name || 'Unknown employee',
        code: p?.code || a.code,
        designation: p?.designation || null,
        pan,
        panValid: PAN.test(pan),
        periodFrom: p?.dateOfJoining && p.dateOfJoining > fyBounds(fy).from ? p.dateOfJoining : fyBounds(fy).from,
        periodTo: p?.dateOfLeaving && p.dateOfLeaving < fyBounds(fy).to ? p.dateOfLeaving : fyBounds(fy).to,
        regime,
        months: [...a.months.values()].sort((x, y) => x.month.localeCompare(y.month)),
        /* Paid before CLOR this year, already inside gross, taxable salary and TDS deducted. */
        openingYtd: openings.get(a.employeeId) || null,
        gross: a.gross,
        /* What income tax read: taxable earnings and employer NPS, plus a previous employer's salary (Form 12B). */
        taxableSalary: round2(a.taxable),
        previousEmployer: previous,
        professionalTax: year?.professionalTax ?? 0,
        employerNps: year?.employerNps ?? 0,
        /* Exempt under section 10 (HRA) and house property (24(b)) are shown apart from Chapter VI-A. */
        exemptions: ded.lines.filter((l) => l.code === 'HRA'),
        houseProperty: ded.lines.filter((l) => l.code === '24B'),
        chapterVIA: ded.lines.filter((l) => l.code !== 'HRA' && l.code !== '24B'),
        deductionBasis: ded.basis,
        standardDeduction: year?.standardDeduction ?? 0,
        taxable: year?.taxable ?? null,
        slabTax: year?.slabTax ?? null,
        rebate: year?.rebate ?? null,
        surcharge: year?.surcharge ?? null,
        cess: year?.cess ?? null,
        taxPayable: year?.total ?? null,
        tdsDeducted: a.tds,
        /* Positive: still to be deducted (or paid by them); negative: deducted too much. */
        balance: year ? round2(year.total - a.tds - (previous?.tds || 0)) : null,
      };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

async function openingIds(orgId: string, fy: string) {
  return (await payrollPrisma.payrollOpeningYtd.findMany({ where: { orgId, financialYear: fy, deletedAt: null }, select: { employeeId: true } })).map((r) => r.employeeId);
}

export async function employerFor(orgId: string) {
  const [org, tds] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true, legalName: true, pan: true } }),
    payrollPrisma.statutoryScheme.findFirst({ where: { orgId, code: 'TDS' }, select: { registrationNumber: true } }),
  ]);
  return { name: org?.legalName || org?.name || '', pan: org?.pan || '', tan: tds?.registrationNumber || '' };
}

/** Form 24Q Annexure I: one row per person per month in the quarter that had tax deducted. */
export async function form24q(orgId: string, fy: string, quarter: number) {
  /* By the day tax was deducted (paid), not the pay month: see taxYear. */
  const people = await taxYear(orgId, fy, undefined, 'PAYMENT');
  const rows = people.flatMap((p) =>
    p.months
      .filter((m) => quarterOf(`${m.month}-01`) === quarter && m.tds > 0)
      .map((m) => ({ employeeId: p.employeeId, code: p.code, pan: p.pan, name: p.name, section: '192', paymentDate: m.paymentDate, amountPaid: m.gross, tds: m.tds }))
  );
  const problems = people
    .filter((p) => !p.panValid && p.months.some((m) => quarterOf(`${m.month}-01`) === quarter && m.tds > 0))
    .map((p) => ({ employeeId: p.employeeId, name: p.name, message: p.pan ? `PAN ${p.pan} is not valid.` : 'No PAN on file. Without one, tax has to be deducted at 20% at least, and the return will show it as PANNOTAVBL.' }));
  const byMonth = new Map<string, { month: string; people: number; amountPaid: number; tds: number }>();
  for (const r of rows) {
    const k = r.paymentDate.slice(0, 7);
    const m = byMonth.get(k) || { month: k, people: 0, amountPaid: 0, tds: 0 };
    m.people += 1;
    m.amountPaid = round2(m.amountPaid + r.amountPaid);
    m.tds = round2(m.tds + r.tds);
    byMonth.set(k, m);
  }
  return { rows, problems, months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), total: round2(rows.reduce((t, r) => t + r.tds, 0)) };
}

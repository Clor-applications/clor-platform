import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { snapshotPerson } from './payment.js';
import { canonicalState, stateLabel, ptDueFor, lwfDueFor, PT_FILINGS, LWF_FILINGS } from '../../constants/stateLevies.js';
import { parseConfig } from './statutory/resolve.js';

/**
 * The month's statutory files, built from payslips (which do not change), in
 * the shapes the portals take:
 *
 * - PF: the EPFO ECR text file (version 2) — one line per member, eleven
 *   fields separated by `#~#`, whole rupees.
 * - ESI: the rows of the ESIC monthly contribution upload — IP number, name,
 *   days paid, wages, and a reason code when nobody was paid for a day.
 * - PT: per state, the people at each amount deducted, the totals, the
 *   return's name and its due date — for the whole return period (a quarter
 *   in Jharkhand, the half-year in Tamil Nadu).
 * - LWF: per state, per collection (June and December in most states), the
 *   employee and employer totals, any employer minimum per establishment,
 *   the headcount, the form and the due date.
 *
 * PT and LWF are summaries, not the state's upload file: each is filed on the
 * state's own portal, and their formats differ by state.
 *
 * What a file cannot carry — a member with no UAN, an insured person with no
 * IP number — is listed as a problem instead of quietly left out.
 */

type Snapshot = {
  results?: Array<{ scheme: string; employee: number; employer: number; employerSplit?: { EPS?: number; EPF?: number } | null; wageApplied: number; ceilingApplied?: number | null; exemptReason?: string | null; jurisdiction?: string | null }>;
  versions?: Record<string, { ruleId: string; version: string }>;
};

export type Problem = { employeeId: string; name: string; message: string };

const rupees = (n: number) => Math.round(Number(n) || 0);
/** The ECR's separator is `#~#`, so a name may not contain it, nor a line break. */
const ecrText = (s: string) => s.replace(/#~#/g, ' ').replace(/[\r\n]+/g, ' ').trim().toUpperCase();
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** EPS and EDLI wages stop at ₹15,000 unless the PF rule says otherwise. */
const PENSION_CEILING = 15_000;

export type EcrRow = {
  employeeId: string;
  uan: string;
  name: string;
  gross: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfContribution: number;
  epsContribution: number;
  difference: number;
  ncpDays: number;
  refund: number;
};

export const ecrLine = (r: EcrRow) =>
  [r.uan, ecrText(r.name), r.gross, r.epfWages, r.epsWages, r.edliWages, r.epfContribution, r.epsContribution, r.difference, r.ncpDays, r.refund].join('#~#');

/** ESIC reason codes for a month with no days paid. */
export const ESIC_REASONS = { NONE: 0, ON_LEAVE: 1, LEFT_SERVICE: 2 } as const;

export async function buildFilings(orgId: string, period: { id: string; startDate: string; endDate: string }) {
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, periodId: period.id, status: { not: 'CANCELLED' } },
    select: { id: true, employeeId: true, grossEarnings: true, statutorySnapshotJson: true, inputSnapshotJson: true, employeeSnapshotJson: true },
    orderBy: { number: 'asc' },
  });
  const ids = [...new Set(slips.map((s) => s.employeeId))];
  const [people, profiles] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, dateOfLeaving: true } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } }, select: { employeeId: true, uan: true, esiNumber: true, professionalTaxState: true } }),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const profile = new Map(profiles.map((p) => [p.employeeId, p]));

  /* One person can have two payslips in a month (monthly and an off-cycle run): the files want one row each. */
  type Acc = {
    employeeId: string; name: string; code: string; gross: number; ncp: number; payable: number;
    pf?: { wage: number; employee: number; eps: number; epf: number; ceiling: number };
    esi?: { wage: number; employee: number; employer: number };
  };
  const acc = new Map<string, Acc>();
  for (const slip of slips) {
    const live = person.get(slip.employeeId);
    const snap = live ? null : snapshotPerson(slip.employeeSnapshotJson);
    const a = acc.get(slip.employeeId) || { employeeId: slip.employeeId, name: live?.name || snap?.name || 'Unknown employee', code: live?.code || snap?.code || '', gross: 0, ncp: 0, payable: 0 };
    let input: { lwpDays?: number; payableDays?: number } = {};
    let stat: Snapshot = {};
    try { input = JSON.parse(slip.inputSnapshotJson || '{}'); } catch { /* an old payslip without one */ }
    try { stat = JSON.parse(slip.statutorySnapshotJson || '{}'); } catch { /* likewise */ }
    a.gross += Number(slip.grossEarnings) || 0;
    a.ncp += Number(input.lwpDays) || 0;
    a.payable += Number(input.payableDays) || 0;
    for (const r of stat.results || []) {
      if (r.scheme === 'PF' && (r.employee > 0 || r.employer > 0)) {
        const pf = a.pf || { wage: 0, employee: 0, eps: 0, epf: 0, ceiling: Number(r.ceilingApplied) || PENSION_CEILING };
        pf.wage += Number(r.wageApplied) || 0;
        pf.employee += Number(r.employee) || 0;
        pf.eps += Number(r.employerSplit?.EPS) || 0;
        pf.epf += Number(r.employerSplit?.EPF ?? r.employer) || 0;
        a.pf = pf;
      }
      if (r.scheme === 'ESI' && (r.employee > 0 || r.employer > 0)) {
        const esi = a.esi || { wage: 0, employee: 0, employer: 0 };
        esi.wage += Number(r.wageApplied) || 0;
        esi.employee += Number(r.employee) || 0;
        esi.employer += Number(r.employer) || 0;
        a.esi = esi;
      }
    }
    acc.set(slip.employeeId, a);
  }

  const ecr: EcrRow[] = [];
  const ecrProblems: Problem[] = [];
  const esic: Array<{ employeeId: string; ipNumber: string; name: string; days: number; wages: number; reason: number; lastWorkingDay: string; employee: number; employer: number }> = [];
  const esicProblems: Problem[] = [];

  for (const a of acc.values()) {
    const p = profile.get(a.employeeId);
    const leaving = person.get(a.employeeId)?.dateOfLeaving || null;
    const leftThisMonth = !!leaving && leaving >= period.startDate && leaving <= period.endDate;

    if (a.pf) {
      const uan = (p?.uan || '').replace(/\s+/g, '');
      if (!/^\d{12}$/.test(uan)) {
        ecrProblems.push({ employeeId: a.employeeId, name: a.name, message: uan ? `UAN ${uan} is not 12 digits.` : 'No UAN on file, so they are left out of the ECR.' });
      } else {
        const epfWages = rupees(a.pf.wage);
        const pensionWages = Math.min(epfWages, rupees(a.pf.ceiling || PENSION_CEILING));
        const eps = rupees(a.pf.eps);
        ecr.push({
          employeeId: a.employeeId,
          uan,
          name: a.name,
          gross: rupees(a.gross),
          epfWages,
          /* A member not in the pension scheme (joined over the ceiling, or past 58) has none. */
          epsWages: eps > 0 ? pensionWages : 0,
          edliWages: pensionWages,
          epfContribution: rupees(a.pf.employee),
          epsContribution: eps,
          difference: rupees(a.pf.epf),
          ncpDays: Math.round(a.ncp),
          refund: 0,
        });
      }
    }

    if (a.esi) {
      const ip = (p?.esiNumber || '').replace(/\s+/g, '');
      if (!/^\d{10}$/.test(ip)) {
        esicProblems.push({ employeeId: a.employeeId, name: a.name, message: ip ? `IP number ${ip} is not 10 digits.` : 'No ESI IP number on file, so they are left out.' });
      } else {
        const days = Math.round(a.payable);
        esic.push({
          employeeId: a.employeeId,
          ipNumber: ip,
          name: a.name,
          days,
          wages: rupees(a.esi.wage),
          reason: days > 0 ? (leftThisMonth ? ESIC_REASONS.LEFT_SERVICE : ESIC_REASONS.NONE) : leftThisMonth ? ESIC_REASONS.LEFT_SERVICE : ESIC_REASONS.ON_LEAVE,
          lastWorkingDay: leftThisMonth ? ddmmyyyy(leaving!) : '',
          employee: a.esi.employee,
          employer: a.esi.employer,
        });
      }
    }

  }

  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    slips: slips.length,
    ecr: {
      text: ecr.map(ecrLine).join('\n'),
      rows: ecr,
      totals: {
        members: ecr.length,
        epfWages: sum(ecr, (r) => r.epfWages),
        employee: sum(ecr, (r) => r.epfContribution),
        eps: sum(ecr, (r) => r.epsContribution),
        epf: sum(ecr, (r) => r.difference),
        /* The challan's admin and EDLI charges are worked out by the portal; they are not in the file. */
      },
      problems: ecrProblems,
    },
    esic: {
      rows: esic,
      totals: {
        people: esic.length,
        wages: sum(esic, (r) => r.wages),
        employee: Math.round(sum(esic, (r) => r.employee) * 100) / 100,
        employer: Math.round(sum(esic, (r) => r.employer) * 100) / 100,
      },
      problems: esicProblems,
    },
    ...(await stateLevyReturns(orgId, period)),
  };
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const monthOf = (iso: string) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });

/**
 * Professional tax and LWF returns for the return period this pay period is
 * in: one row per state (and per collection, for LWF), built from the
 * payslips of every pay period the return covers.
 *
 * A state whose return is monthly reads this month; Jharkhand's quarter, a
 * half-yearly PT or Punjab's half-yearly LWF read every month in it. The
 * state is the one the payslip recorded (its `jurisdiction`), or, for a
 * payslip from before that was recorded, the person's state today.
 */
export async function stateLevyReturns(orgId: string, period: { id: string; startDate: string; endDate: string }) {
  const here = monthOf(period.startDate);
  /* Every period that could share a return with this one: up to eleven months back. */
  const from = `${here.month === 12 ? here.year : here.year - 1}-${String((here.month % 12) + 1).padStart(2, '0')}-01`;
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { gte: from, lte: period.endDate } }, select: { id: true, startDate: true } });
  const periodStart = new Map(periods.map((p) => [p.id, p.startDate]));
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, periodId: { in: periods.map((p) => p.id) }, status: { not: 'CANCELLED' } },
    select: { employeeId: true, periodId: true, statutorySnapshotJson: true, employeeSnapshotJson: true },
  });
  const ids = [...new Set(slips.map((s) => s.employeeId))];
  const [people, profiles] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } }, select: { employeeId: true, professionalTaxState: true } }),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const stateNow = new Map(profiles.map((p) => [p.employeeId, canonicalState(p.professionalTaxState)]));

  /* The rules behind LWF figures, for an employer minimum per establishment. */
  const lwfRuleIds = new Set<string>();

  type PersonRow = { employeeId: string; name: string; code: string; state: string; collection: string; wages: number; employee: number; employer: number };
  const ptRows = new Map<string, PersonRow>();
  const lwfRows = new Map<string, PersonRow>();
  const ptProblems: Problem[] = [];
  const lwfProblems: Problem[] = [];
  const ptWanted = new Map<string, ReturnType<typeof ptDueFor>>();
  const lwfWanted = new Map<string, ReturnType<typeof lwfDueFor>>();

  for (const slip of slips) {
    const start = periodStart.get(slip.periodId);
    if (!start) continue;
    const m = monthOf(start);
    let stat: Snapshot = {};
    try { stat = JSON.parse(slip.statutorySnapshotJson || '{}'); } catch { /* an old payslip without one */ }
    const live = person.get(slip.employeeId);
    const snap = live ? null : snapshotPerson(slip.employeeSnapshotJson);
    const name = live?.name || snap?.name || 'Unknown employee';
    const code = live?.code || snap?.code || '';
    for (const r of stat.results || []) {
      if (r.scheme !== 'PT' && r.scheme !== 'LWF') continue;
      if (!(r.employee > 0 || r.employer > 0)) continue;
      const state = canonicalState(r.jurisdiction) || stateNow.get(slip.employeeId) || '';
      const due = r.scheme === 'PT' ? ptDueFor(state, m.year, m.month) : lwfDueFor(state, m.year, m.month);
      /* A month counts if it is in the same return as this pay period. */
      const mine = r.scheme === 'PT' ? ptDueFor(state, here.year, here.month) : lwfDueFor(state, here.year, here.month);
      const sameReturn = due && mine ? due.key === mine.key : slip.periodId === period.id;
      if (!sameReturn) continue;
      if (r.scheme === 'LWF' && stat.versions?.LWF?.ruleId) lwfRuleIds.add(stat.versions.LWF.ruleId);
      const rows = r.scheme === 'PT' ? ptRows : lwfRows;
      (r.scheme === 'PT' ? ptWanted : lwfWanted).set(state, mine);
      const key = `${state}|${slip.employeeId}`;
      const row = rows.get(key) || { employeeId: slip.employeeId, name, code, state, collection: mine?.label || '', wages: 0, employee: 0, employer: 0 };
      row.wages = r2(row.wages + (Number(r.wageApplied) || 0));
      row.employee = r2(row.employee + (Number(r.employee) || 0));
      row.employer = r2(row.employer + (Number(r.employer) || 0));
      rows.set(key, row);
      if (!state) {
        const list = r.scheme === 'PT' ? ptProblems : lwfProblems;
        if (!list.some((x) => x.employeeId === slip.employeeId)) list.push({ employeeId: slip.employeeId, name, message: 'No state on their payroll details or payslip.' });
      }
    }
  }

  const minimums = new Map<string, number>();
  if (lwfRuleIds.size) {
    const rules = await payrollPrisma.statutoryRule.findMany({ where: { orgId, id: { in: [...lwfRuleIds] } }, select: { jurisdiction: true, configJson: true } });
    for (const rule of rules) {
      const min = Number(parseConfig(rule.configJson).employerMinimumPerEstablishment) || 0;
      if (min) minimums.set(canonicalState(rule.jurisdiction), min);
    }
  }

  const byState = (rows: Map<string, PersonRow>) => {
    const out = new Map<string, PersonRow[]>();
    for (const row of rows.values()) out.set(row.state, [...(out.get(row.state) || []), row]);
    return out;
  };
  const total = (rows: PersonRow[], f: (r: PersonRow) => number) => r2(rows.reduce((t, r) => t + f(r), 0));
  const filed = 'File it on the state portal; CLOR does not make the state’s upload file.';

  const ptStates = [...byState(ptRows).entries()].map(([state, rows]) => {
    const f = PT_FILINGS[state];
    const due = ptWanted.get(state);
    const slabs = new Map<number, { amount: number; count: number; total: number }>();
    for (const row of rows) {
      const s = slabs.get(row.employee) || { amount: row.employee, count: 0, total: 0 };
      s.count += 1;
      s.total = r2(s.total + row.employee);
      slabs.set(row.employee, s);
    }
    return {
      state: state ? stateLabel(state) : 'Not set',
      period: due?.label || '',
      form: f?.form || 'State professional tax return',
      dueDate: due?.dueDate || null,
      dueKnown: Boolean(f?.dueKnown && due),
      how: f?.how || 'CLOR does not know this state’s return: confirm it with the state.',
      slabs: [...slabs.values()].sort((x, y) => x.amount - y.amount),
      people: rows.length,
      employee: total(rows, (r) => r.employee),
      employer: 0,
      total: total(rows, (r) => r.employee),
    };
  });

  const lwfStates = [...byState(lwfRows).entries()].map(([state, rows]) => {
    const f = LWF_FILINGS[state];
    const due = lwfWanted.get(state);
    const employee = total(rows, (r) => r.employee);
    const employer = total(rows, (r) => r.employer);
    const minimum = minimums.get(state) || 0;
    /* The employer pays at least the minimum per establishment (Madhya Pradesh, Chhattisgarh). */
    const topUp = minimum && employer < minimum ? r2(minimum - employer) : 0;
    return {
      state: state ? stateLabel(state) : 'Not set',
      collection: due?.label || '',
      form: f?.form || 'State Labour Welfare Fund return',
      dueDate: due?.dueDate || null,
      dueKnown: Boolean(f?.dueKnown && due),
      how: f?.how || 'CLOR does not know this state’s return: confirm it with the state.',
      people: rows.length,
      employee,
      employer,
      employerMinimum: minimum || null,
      employerTopUp: topUp,
      total: r2(employee + employer + topUp),
    };
  });

  const sorted = <T extends { state: string }>(xs: T[]) => xs.sort((a, b) => a.state.localeCompare(b.state));
  const shown = (rows: Map<string, PersonRow>) => [...rows.values()].map((r) => ({ ...r, state: r.state ? stateLabel(r.state) : 'Not set' })).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  return {
    pt: { states: sorted(ptStates), rows: shown(ptRows), problems: ptProblems, note: filed },
    lwf: { states: sorted(lwfStates), rows: shown(lwfRows), problems: lwfProblems, note: filed },
  };
}

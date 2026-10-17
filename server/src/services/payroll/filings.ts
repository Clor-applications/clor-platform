import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { snapshotPerson } from './payment.js';

/**
 * The month's statutory files, built from payslips (which do not change), in
 * the shapes the portals take:
 *
 * - PF: the EPFO ECR text file (version 2) — one line per member, eleven
 *   fields separated by `#~#`, whole rupees.
 * - ESI: the rows of the ESIC monthly contribution upload — IP number, name,
 *   days paid, wages, and a reason code when nobody was paid for a day.
 * - PT: the count of people at each amount deducted, per state — what the
 *   state returns (Karnataka's Form 5 and the like) ask for.
 *
 * What a file cannot carry — a member with no UAN, an insured person with no
 * IP number — is listed as a problem instead of quietly left out.
 */

type Snapshot = {
  results?: Array<{ scheme: string; employee: number; employer: number; employerSplit?: { EPS?: number; EPF?: number } | null; wageApplied: number; ceilingApplied?: number | null; exemptReason?: string | null }>;
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
    pt?: { wage: number; amount: number };
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
      if (r.scheme === 'PT' && r.employee > 0) {
        const pt = a.pt || { wage: 0, amount: 0 };
        pt.wage += Number(r.wageApplied) || 0;
        pt.amount += Number(r.employee) || 0;
        a.pt = pt;
      }
    }
    acc.set(slip.employeeId, a);
  }

  const ecr: EcrRow[] = [];
  const ecrProblems: Problem[] = [];
  const esic: Array<{ employeeId: string; ipNumber: string; name: string; days: number; wages: number; reason: number; lastWorkingDay: string; employee: number; employer: number }> = [];
  const esicProblems: Problem[] = [];
  const ptByState = new Map<string, Map<number, { amount: number; count: number; total: number }>>();
  const ptRows: Array<{ employeeId: string; name: string; code: string; state: string; wages: number; amount: number }> = [];
  const ptProblems: Problem[] = [];

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

    if (a.pt) {
      const state = (p?.professionalTaxState || '').trim();
      if (!state) ptProblems.push({ employeeId: a.employeeId, name: a.name, message: 'No professional tax state on file.' });
      const key = state || 'Not set';
      const slabs = ptByState.get(key) || new Map();
      const amount = Math.round(a.pt.amount * 100) / 100;
      const s = slabs.get(amount) || { amount, count: 0, total: 0 };
      s.count += 1;
      s.total = Math.round((s.total + amount) * 100) / 100;
      slabs.set(amount, s);
      ptByState.set(key, slabs);
      ptRows.push({ employeeId: a.employeeId, name: a.name, code: a.code, state: key, wages: Math.round(a.pt.wage * 100) / 100, amount });
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
    pt: {
      states: [...ptByState.entries()].map(([state, slabs]) => {
        const rows = [...slabs.values()].sort((x, y) => x.amount - y.amount);
        return { state, slabs: rows, people: sum(rows, (r) => r.count), total: Math.round(sum(rows, (r) => r.total) * 100) / 100 };
      }),
      rows: ptRows,
      problems: ptProblems,
    },
  };
}

import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { addDays, eachDay } from '../../utils/istDate.js';
import { loadRules, toEngineRule } from './statutory/resolve.js';
import { computeStatutory, ruleInForce, type StatutoryEmployee } from './statutory/engine.js';
import { ecrLine } from './filings.js';
import { adviceCsv, maskAccount } from './payment.js';

/**
 * Weekly wages (round 66): workers paid by the day — a factory floor, a
 * building site, a contractor's gang — on a weekly or fortnightly cycle.
 *
 * A wage sheet is days worked × the daily rate, plus overtime at twice the
 * hourly rate, less what can safely come out of a week's pay: PF, ESI,
 * professional tax, an advance being recovered and the canteen. It is kept
 * apart from the monthly payroll run on purpose. A run is one per month and
 * pay group; a week is not a month, and the monthly payroll stays exactly as
 * it was.
 *
 * Statutory amounts still have to come out right for the month, because the
 * returns are monthly:
 *  - PF is worked out on the month's PF wages so far and the sheet takes the
 *    difference, so the ₹15,000 ceiling is spread across the weeks instead of
 *    being applied to each one (which would let a month's PF run to four
 *    times the cap).
 *  - ESI is due on wages for each wage period, so each sheet takes its own,
 *    rounded up. Whether ESI applies is judged on a month's pay at the daily
 *    rate (26 days), not on one week's, which is always under the threshold.
 *  - Professional tax is a monthly slab: it is taken once, on the last sheet
 *    that ends in the month, on the month's total.
 * The wage month is the month a sheet ends in.
 */

export class WeeklyWageError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const SHEET_FREQUENCIES = ['WEEKLY', 'FORTNIGHTLY'] as const;
export const periodLength = (frequency: string) => (frequency === 'FORTNIGHTLY' ? 14 : 7);
/** The month's pay a daily rate stands for, for ESI's threshold. */
export const DAYS_IN_WAGE_MONTH = 26;
/** Total deductions may not pass half the wages (Code on Wages, s. 18). */
export const DEDUCTION_CAP = 0.5;

const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => `₹${round2(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Whether a sheet is the last one ending in its month: the next one ends in another month. */
export const isLastOfMonth = (endDate: string, length: number) => addDays(endDate, length).slice(0, 7) !== endDate.slice(0, 7);

/** "2026-27" for a date. */
const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
};

/** Days paid from an attendance summary: present, half days as half, paid leave and holidays; weekly offs when the sheet pays them. */
export function paidDaysFrom(row: any, paysWeeklyOff: boolean) {
  const paidLeave = Math.max(0, n(row.leave) - n(row.unpaidLeaveDays));
  const days = n(row.present) + n(row.halfDays) * 0.5 + paidLeave + n(row.holidays) + n(row.untrackedDays) + (paysWeeklyOff ? n(row.weeklyOffs) : 0);
  return Math.round(days * 100) / 100;
}

// ─── Daily rates ─────────────────────────────────────────────────────────────

async function groupOr404(orgId: string, payGroupId: string) {
  const group = await payrollPrisma.payGroup.findFirst({ where: { orgId, id: payGroupId } });
  if (!group) throw new WeeklyWageError('NO_PAY_GROUP', 'No such pay group.', 404);
  if (!(SHEET_FREQUENCIES as readonly string[]).includes(group.frequency)) {
    throw new WeeklyWageError('NOT_WEEKLY', `${group.name} is paid ${group.frequency.toLowerCase()}. Weekly wages are for weekly or fortnightly pay groups.`);
  }
  return group;
}

const rateShape = (r: any, person?: { name: string; code: string | null }, groupName?: string) => ({
  id: r.id,
  employeeId: r.employeeId,
  name: person?.name || '',
  code: person?.code || '',
  payGroupId: r.payGroupId,
  payGroupName: groupName || '',
  dailyRate: n(r.dailyRate),
  hoursPerDay: n(r.hoursPerDay),
  overtimeMultiplier: n(r.overtimeMultiplier),
  canteenPerDay: n(r.canteenPerDay),
  advanceBalance: n(r.advanceBalance),
  advancePerSheet: n(r.advancePerSheet),
  isActive: !!r.isActive,
});

export async function listRates(orgId: string, payGroupId?: string) {
  const rates = await payrollPrisma.weeklyWageRate.findMany({ where: { orgId, ...(payGroupId ? { payGroupId } : {}) }, orderBy: { createdAt: 'asc' } });
  const ids = [...new Set(rates.map((r) => r.employeeId))];
  const [people, groups] = await Promise.all([
    ids.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
    payrollPrisma.payGroup.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const byGroup = new Map(groups.map((g) => [g.id, g.name]));
  return rates
    .map((r) => rateShape(r, byPerson.get(r.employeeId), byGroup.get(r.payGroupId)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RateInput = {
  employeeId: string;
  payGroupId: string;
  dailyRate: number;
  hoursPerDay?: number;
  overtimeMultiplier?: number;
  canteenPerDay?: number;
  advanceBalance?: number;
  advancePerSheet?: number;
  isActive?: boolean;
};

export async function saveRate(opts: { accountId: string; orgId: string; userId: string; input: RateInput }) {
  const { accountId, orgId, userId, input } = opts;
  await groupOr404(orgId, input.payGroupId);
  const person = await peoplePrisma.employee.findFirst({ where: { orgId, id: input.employeeId }, select: { id: true, name: true, code: true } });
  if (!person) throw new WeeklyWageError('NO_PERSON', 'No such person.', 404);
  const data = {
    payGroupId: input.payGroupId,
    dailyRate: round2(input.dailyRate),
    hoursPerDay: input.hoursPerDay ?? 8,
    overtimeMultiplier: input.overtimeMultiplier ?? 2,
    canteenPerDay: round2(input.canteenPerDay ?? 0),
    advanceBalance: round2(input.advanceBalance ?? 0),
    advancePerSheet: round2(input.advancePerSheet ?? 0),
    isActive: input.isActive ?? true,
  };
  const row = await payrollPrisma.weeklyWageRate.upsert({
    where: { orgId_employeeId: { orgId, employeeId: input.employeeId } },
    create: { accountId, orgId, employeeId: input.employeeId, createdByUserId: userId, ...data },
    update: data,
  });
  return rateShape(row, person);
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

const sheetShape = (s: any, groupName = '') => ({
  id: s.id,
  payGroupId: s.payGroupId,
  payGroupName: groupName,
  startDate: s.startDate,
  endDate: s.endDate,
  wageMonth: s.wageMonth,
  lastOfMonth: !!s.lastOfMonth,
  paysWeeklyOff: !!s.paysWeeklyOff,
  status: s.status,
  gross: n(s.gross),
  deductions: n(s.deductions),
  net: n(s.net),
  approvedAt: s.approvedAt,
  paidOn: s.paidOn,
  paymentReference: s.paymentReference || '',
  workers: s._count?.lines ?? (Array.isArray(s.lines) ? s.lines.length : undefined),
});

const lineShape = (l: any) => ({
  id: l.id,
  employeeId: l.employeeId,
  name: l.employeeName,
  code: l.employeeCode || '',
  daysWorked: n(l.daysWorked),
  dailyRate: n(l.dailyRate),
  overtimeHours: n(l.overtimeHours),
  overtimeAmount: n(l.overtimeAmount),
  gross: n(l.gross),
  pfWage: n(l.pfWage),
  pfEmployee: n(l.pfEmployee),
  pfEmployer: n(l.pfEmployer),
  esiEmployee: n(l.esiEmployee),
  esiEmployer: n(l.esiEmployer),
  ptEmployee: n(l.ptEmployee),
  advanceRecovery: n(l.advanceRecovery),
  canteen: n(l.canteen),
  totalDeductions: n(l.totalDeductions),
  net: n(l.net),
  edited: !!l.edited,
  notes: l.notes || '',
  explanations: (() => {
    try {
      return JSON.parse(l.explanationJson || '[]');
    } catch {
      return [];
    }
  })(),
  bankAccount: maskAccount(l.bankAccountNumber),
  hasBankAccount: Boolean(l.bankAccountNumber && l.bankIfsc),
});

export async function listSheets(orgId: string, filter: { payGroupId?: string; wageMonth?: string } = {}) {
  const sheets = await payrollPrisma.weeklyWageSheet.findMany({
    where: { orgId, ...(filter.payGroupId ? { payGroupId: filter.payGroupId } : {}), ...(filter.wageMonth ? { wageMonth: filter.wageMonth } : {}) },
    orderBy: [{ startDate: 'desc' }],
    include: { _count: { select: { lines: true } } },
  });
  const groups = await payrollPrisma.payGroup.findMany({ where: { orgId }, select: { id: true, name: true } });
  const byGroup = new Map(groups.map((g) => [g.id, g.name]));
  return sheets.map((s) => sheetShape(s, byGroup.get(s.payGroupId)));
}

async function sheetOr404(orgId: string, id: string) {
  const sheet = await payrollPrisma.weeklyWageSheet.findFirst({ where: { orgId, id }, include: { lines: { orderBy: { employeeName: 'asc' } } } });
  if (!sheet) throw new WeeklyWageError('NO_SHEET', 'No such wage sheet.', 404);
  return sheet;
}

export async function getSheet(orgId: string, id: string) {
  const sheet = await sheetOr404(orgId, id);
  const group = await payrollPrisma.payGroup.findFirst({ where: { orgId, id: sheet.payGroupId }, select: { name: true, frequency: true } });
  return { ...sheetShape(sheet, group?.name), frequency: group?.frequency || '', lines: sheet.lines.map(lineShape) };
}

/** The day the next sheet of a group starts: the day after its latest one ends, or null for a group with none. */
export async function nextStart(orgId: string, payGroupId: string) {
  const latest = await payrollPrisma.weeklyWageSheet.findFirst({ where: { orgId, payGroupId }, orderBy: { startDate: 'desc' }, select: { endDate: true } });
  return latest ? addDays(latest.endDate, 1) : null;
}

export async function makeSheet(opts: {
  accountId: string;
  orgId: string;
  userId: string;
  payGroupId: string;
  startDate: string;
  paysWeeklyOff?: boolean;
  /** Attendance's figures for the days; null when Attendance is off (days are typed in). */
  attendanceRows?: (days: string[]) => Promise<any[] | null>;
}) {
  const { accountId, orgId, userId, payGroupId, startDate } = opts;
  const group = await groupOr404(orgId, payGroupId);
  const length = periodLength(group.frequency);
  const endDate = addDays(startDate, length - 1);

  /* In order, one after another: PF across a month adds up sheet by sheet, so a sheet made before an earlier one would count the month wrong. */
  const expected = await nextStart(orgId, payGroupId);
  if (expected && startDate !== expected) {
    throw new WeeklyWageError(
      'OUT_OF_ORDER',
      startDate < expected
        ? `${group.name} already has wages up to ${addDays(expected, -1)}. The next sheet starts on ${expected}.`
        : `The next sheet for ${group.name} starts on ${expected}, straight after the last one, so no days are missed.`,
      409
    );
  }

  const rates = await payrollPrisma.weeklyWageRate.findMany({ where: { orgId, payGroupId, isActive: true } });
  if (!rates.length) throw new WeeklyWageError('NO_WORKERS', `Nobody in ${group.name} has a daily rate yet. Add workers and their daily rates first.`);

  const ids = rates.map((r) => r.employeeId);
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } });
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const attendance = opts.attendanceRows ? await opts.attendanceRows(eachDay(startDate, endDate)) : null;
  const byAttendance = new Map((attendance || []).map((r: any) => [r.employeeId, r]));
  const paysWeeklyOff = !!opts.paysWeeklyOff;

  const sheet = await payrollPrisma.weeklyWageSheet.create({
    data: {
      accountId,
      orgId,
      payGroupId,
      startDate,
      endDate,
      wageMonth: endDate.slice(0, 7),
      lastOfMonth: isLastOfMonth(endDate, length),
      paysWeeklyOff,
      createdByUserId: userId,
      lines: {
        create: rates.map((r) => {
          const a = byAttendance.get(r.employeeId);
          return {
            accountId,
            orgId,
            employeeId: r.employeeId,
            employeeName: byPerson.get(r.employeeId)?.name || 'Unknown',
            employeeCode: byPerson.get(r.employeeId)?.code || null,
            dailyRate: r.dailyRate,
            daysWorked: a ? paidDaysFrom(a, paysWeeklyOff) : 0,
            overtimeHours: a ? Math.round((n(a.approvedOvertimeMinutes) / 60) * 100) / 100 : 0,
            notes: attendance ? (a ? null : 'Not in attendance for these days.') : 'Attendance is off: type the days in.',
          };
        }),
      },
    },
  });
  await recompute(orgId, sheet.id);
  return getSheet(orgId, sheet.id);
}

/** Change a worker's days or overtime on a draft sheet. */
export async function editLine(opts: { orgId: string; sheetId: string; lineId: string; daysWorked?: number; overtimeHours?: number; notes?: string | null }) {
  const sheet = await sheetOr404(opts.orgId, opts.sheetId);
  if (sheet.status !== 'DRAFT') throw new WeeklyWageError('NOT_DRAFT', 'Only a draft sheet can be changed.', 409);
  const line = sheet.lines.find((l) => l.id === opts.lineId);
  if (!line) throw new WeeklyWageError('NO_LINE', 'No such worker on this sheet.', 404);
  const length = eachDay(sheet.startDate, sheet.endDate).length;
  if (opts.daysWorked != null && opts.daysWorked > length) {
    throw new WeeklyWageError('TOO_MANY_DAYS', `This sheet covers ${length} days, so nobody can be paid for more.`);
  }
  await payrollPrisma.weeklyWageLine.update({
    where: { id: line.id },
    data: {
      ...(opts.daysWorked != null ? { daysWorked: opts.daysWorked, edited: true } : {}),
      ...(opts.overtimeHours != null ? { overtimeHours: opts.overtimeHours, edited: true } : {}),
      ...(opts.notes !== undefined ? { notes: opts.notes || null } : {}),
    },
  });
  await recompute(opts.orgId, sheet.id);
  return getSheet(opts.orgId, sheet.id);
}

/**
 * Work out every line of a draft sheet: pay, statutory, deductions, net.
 * Reads the earlier sheets of the same wage month for each worker, whatever
 * their group, so PF and professional tax add up across the month.
 */
export async function recompute(orgId: string, sheetId: string) {
  const sheet = await sheetOr404(orgId, sheetId);
  if (sheet.status !== 'DRAFT') return;
  const ids = sheet.lines.map((l) => l.employeeId);
  if (!ids.length) return;

  const fy = fyOf(sheet.endDate);
  const [rates, profiles, rules, earlier, ptYear] = await Promise.all([
    payrollPrisma.weeklyWageRate.findMany({ where: { orgId, employeeId: { in: ids } } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } } }),
    loadRules(orgId),
    payrollPrisma.weeklyWageLine.findMany({
      where: { orgId, employeeId: { in: ids }, sheet: { wageMonth: sheet.wageMonth, endDate: { lt: sheet.startDate } } },
      select: { employeeId: true, gross: true, pfWage: true, pfEmployee: true, pfEmployer: true, pfEps: true },
    }),
    payrollPrisma.weeklyWageLine.findMany({
      where: { orgId, employeeId: { in: ids }, sheetId: { not: sheet.id }, sheet: { endDate: { gte: fy.from, lte: fy.to } } },
      select: { employeeId: true, ptEmployee: true },
    }),
  ]);
  const byRate = new Map(rates.map((r) => [r.employeeId, r]));
  const byProfile = new Map(profiles.map((p) => [p.employeeId, p]));
  const prior = new Map<string, { gross: number; pfWage: number; pfEmployee: number; pfEmployer: number; pfEps: number }>();
  for (const l of earlier) {
    const p = prior.get(l.employeeId) || { gross: 0, pfWage: 0, pfEmployee: 0, pfEmployer: 0, pfEps: 0 };
    p.gross += n(l.gross);
    p.pfWage += n(l.pfWage);
    p.pfEmployee += n(l.pfEmployee);
    p.pfEmployer += n(l.pfEmployer);
    p.pfEps += n(l.pfEps);
    prior.set(l.employeeId, p);
  }
  const ptSoFar = new Map<string, number>();
  for (const l of ptYear) ptSoFar.set(l.employeeId, (ptSoFar.get(l.employeeId) || 0) + n(l.ptEmployee));

  const pfRow = ruleInForce(rules.get('PF') || [], sheet.endDate);
  const esiRow = ruleInForce(rules.get('ESI') || [], sheet.endDate);
  const month = Number(sheet.wageMonth.slice(5, 7));
  const context = { month, monthsRemaining: 0, taxAlreadyDeducted: 0 };

  let gross = 0;
  let deductions = 0;
  let net = 0;
  for (const line of sheet.lines) {
    const rate = byRate.get(line.employeeId);
    const profile = byProfile.get(line.employeeId);
    const dailyRate = n(line.dailyRate);
    const days = n(line.daysWorked);
    const otHours = n(line.overtimeHours);
    const hourly = dailyRate / Math.max(1, n(rate?.hoursPerDay ?? 8));
    const pfWage = round2(days * dailyRate);
    const overtimeAmount = round2(otHours * hourly * n(rate?.overtimeMultiplier ?? 2));
    const lineGross = round2(pfWage + overtimeAmount);
    const before = prior.get(line.employeeId) || { gross: 0, pfWage: 0, pfEmployee: 0, pfEmployer: 0, pfEps: 0 };
    const employee: StatutoryEmployee = {
      pfApplicable: !!profile?.pfApplicable,
      esiApplicable: !!profile?.esiApplicable,
      ptApplicable: !!profile?.ptApplicable,
      professionalTaxState: profile?.professionalTaxState || null,
    };
    const explanations: Array<{ scheme: string; text: string }> = [];

    /* PF: the month so far, less what earlier sheets took — the ceiling is a month's. */
    let pfEmployee = 0;
    let pfEmployer = 0;
    let pfEps = 0;
    if (pfRow && employee.pfApplicable) {
      const pfMonth = computeStatutory(toEngineRule(pfRow), { pfWage: before.pfWage + pfWage, esiWage: 0, gross: before.gross + lineGross }, employee, context);
      pfEmployee = round2(Math.max(0, pfMonth.employee - before.pfEmployee));
      pfEmployer = round2(Math.max(0, pfMonth.employer - before.pfEmployer));
      pfEps = round2(Math.max(0, n(pfMonth.employerSplit?.EPS) - before.pfEps));
      explanations.push({
        scheme: 'PF',
        text: before.pfWage
          ? `${pfMonth.explanation} That is the month's PF wages so far; earlier sheets this month took ${fmt(before.pfEmployee)}, so this one takes ${fmt(pfEmployee)}.`
          : pfMonth.explanation,
      });
    }

    /* ESI: due on each wage period's wages, overtime included; whether it applies is judged on a month at the daily rate. */
    let esiEmployee = 0;
    let esiEmployer = 0;
    if (esiRow && employee.esiApplicable && lineGross > 0) {
      const esi = computeStatutory(toEngineRule(esiRow), { pfWage: 0, esiWage: lineGross, esiCoverageWage: round2(dailyRate * DAYS_IN_WAGE_MONTH), gross: lineGross }, employee, context);
      esiEmployee = esi.employee;
      esiEmployer = esi.employer;
      explanations.push({ scheme: 'ESI', text: esi.exemptReason === 'ABOVE_THRESHOLD' ? `A month at ${fmt(dailyRate)} a day is ${fmt(dailyRate * DAYS_IN_WAGE_MONTH)}, above the ESI threshold, so ESI does not apply.` : esi.explanation });
    }

    /* PT: a monthly slab, once, on the last sheet of the month, on the month's wages. */
    let ptEmployee = 0;
    if (sheet.lastOfMonth && employee.ptApplicable) {
      const ptRow = ruleInForce(rules.get('PT') || [], sheet.endDate, employee.professionalTaxState);
      if (ptRow) {
        const monthGross = round2(before.gross + lineGross);
        const pt = computeStatutory(toEngineRule(ptRow), { pfWage: 0, esiWage: 0, gross: monthGross }, employee, { ...context, pt: { yearToDate: ptSoFar.get(line.employeeId) || 0 } });
        ptEmployee = pt.employee;
        explanations.push({ scheme: 'PT', text: `On the month's wages of ${fmt(monthGross)}. ${pt.explanation}` });
      }
    }

    /* Weekly deductions, inside the cap: statutory first, then canteen, then the advance. */
    const statutory = round2(pfEmployee + esiEmployee + ptEmployee);
    let room = Math.max(0, round2(lineGross * DEDUCTION_CAP - statutory));
    const canteenDue = round2(n(rate?.canteenPerDay) * days);
    const canteen = Math.min(canteenDue, room);
    room = round2(room - canteen);
    const advanceDue = Math.min(n(rate?.advanceBalance), n(rate?.advancePerSheet));
    const advanceRecovery = round2(Math.min(advanceDue, room));
    if (canteen < canteenDue || advanceRecovery < advanceDue) {
      explanations.push({ scheme: 'CAP', text: `Deductions stop at half the wages (${fmt(lineGross * DEDUCTION_CAP)}), so ${canteen < canteenDue ? `canteen is ${fmt(canteen)} of ${fmt(canteenDue)}` : `the advance recovery is ${fmt(advanceRecovery)} of ${fmt(advanceDue)}`}.` });
    }
    const totalDeductions = round2(statutory + canteen + advanceRecovery);
    const lineNet = round2(lineGross - totalDeductions);

    await payrollPrisma.weeklyWageLine.update({
      where: { id: line.id },
      data: {
        pfWage,
        overtimeAmount,
        gross: lineGross,
        pfEmployee,
        pfEmployer,
        pfEps,
        esiEmployee,
        esiEmployer,
        ptEmployee,
        canteen,
        advanceRecovery,
        totalDeductions,
        net: lineNet,
        explanationJson: JSON.stringify(explanations),
        bankAccountName: profile?.bankAccountName || null,
        bankAccountNumber: profile?.bankAccountNumber || null,
        bankIfsc: profile?.bankIfsc || null,
        uan: profile?.uan || null,
        esiNumber: profile?.esiNumber || null,
      },
    });
    gross += lineGross;
    deductions += totalDeductions;
    net += lineNet;
  }
  await payrollPrisma.weeklyWageSheet.update({ where: { id: sheet.id }, data: { gross: round2(gross), deductions: round2(deductions), net: round2(net) } });
}

/** Refetch days from attendance for a draft sheet, keeping lines typed by hand. */
export async function refreshSheet(opts: { orgId: string; sheetId: string; attendanceRows: (days: string[]) => Promise<any[] | null> }) {
  const sheet = await sheetOr404(opts.orgId, opts.sheetId);
  if (sheet.status !== 'DRAFT') throw new WeeklyWageError('NOT_DRAFT', 'Only a draft sheet can be changed.', 409);
  const rows = await opts.attendanceRows(eachDay(sheet.startDate, sheet.endDate));
  if (!rows) throw new WeeklyWageError('ATTENDANCE_OFF', 'Attendance is not switched on for this company, so days are typed in.', 409);
  const byPerson = new Map(rows.map((r: any) => [r.employeeId, r]));
  for (const line of sheet.lines) {
    if (line.edited) continue;
    const a = byPerson.get(line.employeeId);
    await payrollPrisma.weeklyWageLine.update({
      where: { id: line.id },
      data: {
        daysWorked: a ? paidDaysFrom(a, sheet.paysWeeklyOff) : 0,
        overtimeHours: a ? Math.round((n(a.approvedOvertimeMinutes) / 60) * 100) / 100 : 0,
        notes: a ? null : 'Not in attendance for these days.',
      },
    });
  }
  await recompute(opts.orgId, sheet.id);
  return getSheet(opts.orgId, sheet.id);
}

/** Approve: the figures are fixed and each advance balance comes down by what this sheet recovers. */
export async function approveSheet(opts: { orgId: string; sheetId: string; userId: string }) {
  const sheet = await sheetOr404(opts.orgId, opts.sheetId);
  if (sheet.status !== 'DRAFT') throw new WeeklyWageError('NOT_DRAFT', 'This sheet is already approved.', 409);
  const earlierDraft = await payrollPrisma.weeklyWageSheet.findFirst({ where: { orgId: opts.orgId, payGroupId: sheet.payGroupId, status: 'DRAFT', startDate: { lt: sheet.startDate } }, select: { startDate: true } });
  if (earlierDraft) throw new WeeklyWageError('EARLIER_DRAFT', `Approve the sheet from ${earlierDraft.startDate} first; PF adds up week by week.`, 409);
  await recompute(opts.orgId, sheet.id);
  const fresh = await sheetOr404(opts.orgId, sheet.id);
  if (!fresh.lines.some((l) => n(l.gross) > 0)) throw new WeeklyWageError('NOTHING_TO_PAY', 'Nobody on this sheet has any days. Add the days first.');
  await payrollPrisma.$transaction([
    ...fresh.lines
      .filter((l) => n(l.advanceRecovery) > 0)
      .map((l) => payrollPrisma.weeklyWageRate.updateMany({ where: { orgId: opts.orgId, employeeId: l.employeeId }, data: { advanceBalance: { decrement: l.advanceRecovery } } })),
    payrollPrisma.weeklyWageSheet.update({ where: { id: sheet.id }, data: { status: 'APPROVED', approvedByUserId: opts.userId, approvedAt: new Date() } }),
  ]);
  return getSheet(opts.orgId, sheet.id);
}

/** Back to draft, before it is paid: the advances it recovered go back on the balance. Only the latest sheet of a group. */
export async function reopenSheet(opts: { orgId: string; sheetId: string }) {
  const sheet = await sheetOr404(opts.orgId, opts.sheetId);
  if (sheet.status !== 'APPROVED') throw new WeeklyWageError('NOT_APPROVED', sheet.status === 'PAID' ? 'This sheet is paid, so it stays as it is.' : 'This sheet is still a draft.', 409);
  const later = await payrollPrisma.weeklyWageSheet.findFirst({ where: { orgId: opts.orgId, payGroupId: sheet.payGroupId, startDate: { gt: sheet.startDate } }, select: { startDate: true } });
  if (later) throw new WeeklyWageError('LATER_SHEET', `There is a later sheet from ${later.startDate}. Only the latest sheet can go back to draft.`, 409);
  await payrollPrisma.$transaction([
    ...sheet.lines
      .filter((l) => n(l.advanceRecovery) > 0)
      .map((l) => payrollPrisma.weeklyWageRate.updateMany({ where: { orgId: opts.orgId, employeeId: l.employeeId }, data: { advanceBalance: { increment: l.advanceRecovery } } })),
    payrollPrisma.weeklyWageSheet.update({ where: { id: sheet.id }, data: { status: 'DRAFT', approvedByUserId: null, approvedAt: null } }),
  ]);
  await recompute(opts.orgId, sheet.id);
  return getSheet(opts.orgId, sheet.id);
}

export async function markPaid(opts: { orgId: string; sheetId: string; userId: string; paidOn: string; reference?: string | null }) {
  const sheet = await sheetOr404(opts.orgId, opts.sheetId);
  if (sheet.status !== 'APPROVED') throw new WeeklyWageError('NOT_APPROVED', sheet.status === 'PAID' ? 'This sheet is already paid.' : 'Approve the sheet before marking it paid.', 409);
  if (opts.paidOn < sheet.endDate) throw new WeeklyWageError('PAID_TOO_EARLY', `Wages for days up to ${sheet.endDate} are paid on or after that day.`);
  await payrollPrisma.weeklyWageSheet.update({ where: { id: sheet.id }, data: { status: 'PAID', paidOn: opts.paidOn, paymentReference: opts.reference || null, paidByUserId: opts.userId } });
  return getSheet(opts.orgId, sheet.id);
}

export async function deleteSheet(orgId: string, sheetId: string) {
  const sheet = await sheetOr404(orgId, sheetId);
  if (sheet.status !== 'DRAFT') throw new WeeklyWageError('NOT_DRAFT', 'Only a draft sheet can be deleted.', 409);
  const later = await payrollPrisma.weeklyWageSheet.findFirst({ where: { orgId, payGroupId: sheet.payGroupId, startDate: { gt: sheet.startDate } }, select: { id: true } });
  if (later) throw new WeeklyWageError('LATER_SHEET', 'Only the latest sheet of a pay group can be deleted.', 409);
  await payrollPrisma.weeklyWageSheet.delete({ where: { id: sheet.id } });
}

// ─── Paying ──────────────────────────────────────────────────────────────────

/** The bank file: one row per worker with pay due, and who cannot be paid by bank. */
export async function bankFile(orgId: string, sheetId: string) {
  const sheet = await sheetOr404(orgId, sheetId);
  if (sheet.status === 'DRAFT') throw new WeeklyWageError('NOT_APPROVED', 'Approve the sheet before making the bank file.', 409);
  const due = sheet.lines.filter((l) => n(l.net) > 0);
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: due.map((l) => l.employeeId) } }, select: { employeeId: true, bankName: true } });
  const bankName = new Map(profiles.map((p) => [p.employeeId, p.bankName || '']));
  const reference = `WAGES-${sheet.startDate}`;
  const rows = due
    .filter((l) => l.bankAccountNumber && l.bankIfsc)
    .map((l) => ({
      employeeCode: l.employeeCode || '',
      beneficiaryName: l.bankAccountName || l.employeeName,
      accountNumber: l.bankAccountNumber || '',
      ifsc: l.bankIfsc || '',
      bankName: bankName.get(l.employeeId) || '',
      amount: round2(n(l.net)),
      reference,
    }));
  const cash = due.filter((l) => !(l.bankAccountNumber && l.bankIfsc)).map((l) => ({ employeeId: l.employeeId, name: l.employeeName, amount: round2(n(l.net)) }));
  return { reference, rows, cash, csv: adviceCsv(rows) };
}

/** One worker's wage slip for a sheet. */
export async function wageSlip(orgId: string, sheetId: string, employeeId: string) {
  const sheet = await getSheet(orgId, sheetId);
  const line = sheet.lines.find((l) => l.employeeId === employeeId);
  if (!line) throw new WeeklyWageError('NO_LINE', 'This person is not on this sheet.', 404);
  const { lines: _lines, ...head } = sheet;
  return { sheet: head, line };
}

// ─── The month ───────────────────────────────────────────────────────────────

/**
 * A wage month across every weekly sheet that ends in it: per worker, the
 * month's days, wages, PF, ESI and PT — what the monthly returns are filed
 * from. Approved and paid sheets only; drafts are counted so the screen can
 * say the month is not finished.
 */
export async function monthSummary(orgId: string, month: string) {
  const sheets = await payrollPrisma.weeklyWageSheet.findMany({ where: { orgId, wageMonth: month }, include: { lines: true }, orderBy: { startDate: 'asc' } });
  const counted = sheets.filter((s) => s.status !== 'DRAFT');
  const rules = await loadRules(orgId);
  const pfRow = ruleInForce(rules.get('PF') || [], `${month}-28`);
  const pf = pfRow ? toEngineRule(pfRow) : null;
  const ceiling = pf?.wageCeiling ?? 15_000;
  const fullWage = Boolean(pf?.config?.contributeOnFullWage);
  const epsCeiling = Number(pf?.config?.epsWageCeiling ?? 15_000);

  const byPerson = new Map<string, any>();
  for (const s of counted) {
    const covered = eachDay(s.startDate, s.endDate).length;
    for (const l of s.lines) {
      const p = byPerson.get(l.employeeId) || {
        employeeId: l.employeeId, name: l.employeeName, code: l.employeeCode || '', uan: '', esiNumber: '',
        sheets: 0, daysCovered: 0, daysWorked: 0, gross: 0, pfWage: 0, pfEmployee: 0, pfEmployer: 0, pfEps: 0,
        esiWage: 0, esiEmployee: 0, esiEmployer: 0, ptEmployee: 0, advanceRecovery: 0, canteen: 0, net: 0,
      };
      p.uan = l.uan || p.uan;
      p.esiNumber = l.esiNumber || p.esiNumber;
      p.sheets += 1;
      p.daysCovered += covered;
      p.daysWorked += n(l.daysWorked);
      p.gross += n(l.gross);
      p.pfWage += n(l.pfWage);
      p.pfEmployee += n(l.pfEmployee);
      p.pfEmployer += n(l.pfEmployer);
      p.pfEps += n(l.pfEps);
      if (n(l.esiEmployee) || n(l.esiEmployer)) p.esiWage += n(l.gross);
      p.esiEmployee += n(l.esiEmployee);
      p.esiEmployer += n(l.esiEmployer);
      p.ptEmployee += n(l.ptEmployee);
      p.advanceRecovery += n(l.advanceRecovery);
      p.canteen += n(l.canteen);
      p.net += n(l.net);
      byPerson.set(l.employeeId, p);
    }
  }
  const rows = [...byPerson.values()]
    .map((p) => {
      for (const k of Object.keys(p)) if (typeof p[k] === 'number') p[k] = round2(p[k]);
      return p;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k: string) => round2(rows.reduce((t, r) => t + n(r[k]), 0));
  const totals = {
    workers: rows.length,
    gross: sum('gross'), pfEmployee: sum('pfEmployee'), pfEmployer: sum('pfEmployer'), esiEmployee: sum('esiEmployee'),
    esiEmployer: sum('esiEmployer'), ptEmployee: sum('ptEmployee'), advanceRecovery: sum('advanceRecovery'), canteen: sum('canteen'), net: sum('net'),
  };

  /* ECR: whole rupees, wages capped as the PF rule caps them; NCP days are the days the sheets cover that were not paid. */
  const ecrRows = rows
    .filter((r) => r.pfEmployee > 0 || r.pfEmployer > 0)
    .map((r) => {
      const epfWages = Math.round(fullWage ? r.pfWage : Math.min(r.pfWage, ceiling));
      const epsWages = Math.round(Math.min(r.pfWage, epsCeiling));
      return {
        employeeId: r.employeeId,
        uan: r.uan || '',
        name: r.name,
        gross: Math.round(r.gross),
        epfWages,
        epsWages,
        edliWages: epsWages,
        epfContribution: Math.round(r.pfEmployee),
        epsContribution: Math.round(r.pfEps),
        difference: Math.round(r.pfEmployer - r.pfEps),
        ncpDays: Math.max(0, Math.round(r.daysCovered - r.daysWorked)),
        refund: 0,
      };
    });
  const missingUan = ecrRows.filter((r) => !/^\d{12}$/.test(r.uan)).map((r) => ({ employeeId: r.employeeId, name: r.name }));

  return {
    month,
    sheets: sheets.map((s) => ({ id: s.id, startDate: s.startDate, endDate: s.endDate, status: s.status })),
    drafts: sheets.length - counted.length,
    rows,
    totals,
    ecr: ecrRows.filter((r) => /^\d{12}$/.test(r.uan)).map(ecrLine).join('\n'),
    missingUan,
  };
}

const CELL = (v: unknown) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function monthSummaryCsv(summary: Awaited<ReturnType<typeof monthSummary>>) {
  const head = ['Code', 'Name', 'UAN', 'ESI number', 'Sheets', 'Days worked', 'Gross', 'PF wages', 'PF (employee)', 'PF (employer)', 'ESI (employee)', 'ESI (employer)', 'Professional tax', 'Advance recovered', 'Canteen', 'Net paid'];
  const body = summary.rows.map((r) =>
    [r.code, r.name, r.uan, r.esiNumber, r.sheets, r.daysWorked, r.gross, r.pfWage, r.pfEmployee, r.pfEmployer, r.esiEmployee, r.esiEmployer, r.ptEmployee, r.advanceRecovery, r.canteen, r.net].map(CELL).join(',')
  );
  return [head.join(','), ...body].join('\n');
}

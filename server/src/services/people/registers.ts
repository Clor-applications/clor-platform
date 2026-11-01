import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isWeeklyOff } from '../attendance/compute.js';
import { daysBetween, periodContext } from '../attendance/days.js';
import { lastOfMonth } from '../attendance/payableDays.js';
import { todayIst } from '../../utils/istDate.js';

/**
 * The registers an inspector asks for that People keeps beside the register
 * of employees and the leave register (services/people/complianceRules.ts):
 * the muster roll and a leave summary. Each returns the registers' one shape
 * (columns as headings, rows as strings) so one screen prints and exports
 * them all. These are the content a register needs, not a certified state
 * form: each state prescribes its own layout.
 */

const MARK: Record<string, string> = { PRESENT: 'P', HALF_DAY: 'HD', ABSENT: 'A', ON_LEAVE: 'L', HOLIDAY: 'H', WEEKLY_OFF: 'W' };
const num = (n: number) => String(Math.round(n * 100) / 100);

async function establishmentOf(orgId: string, establishmentId: string | null) {
  if (!establishmentId) return { establishment: null, ids: null as Set<string> | null };
  const establishment = await peoplePrisma.establishment.findFirst({ where: { id: establishmentId, orgId }, select: { name: true, state: true, address: true } });
  const ids = new Set((await peoplePrisma.employee.findMany({ where: { orgId, establishmentId }, select: { id: true } })).map((e) => e.id));
  return { establishment, ids };
}

/**
 * Muster roll: each person, each day of a month, from the day record. With
 * Attendance on, a past working day with no record is absent, as the month
 * summary counts it. Without Attendance (a People-only company) nobody is
 * required to punch, so such a day is left blank — marked only by what was
 * recorded (leave, a check-in, approved work from home or on duty) — and
 * the note says so.
 */
export async function musterRoll(accountId: string, orgId: string, month: string, establishmentId: string | null, attendanceOn: boolean) {
  const days = daysBetween(`${month}-01`, lastOfMonth(month));
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
  const { establishment, ids } = await establishmentOf(orgId, establishmentId);
  const people = ctx.people.filter((p) => !ids || ids.has(p.id));
  const rows = people.map((p) => {
    const span = new Set(ctx.spanOf(p));
    const tally: Record<string, number> = { P: 0, HD: 0, A: 0, L: 0, H: 0, W: 0 };
    const marks = days.map((d) => {
      if (!span.has(d)) return '–';
      const r = ctx.recordsOf.get(p.id)?.get(d);
      let s: string | null = r?.status || null;
      if (!s) {
        if (ctx.holidaysFor(p as any).has(d)) s = 'HOLIDAY';
        else if (isWeeklyOff(ctx.shiftOn(p.id, d).rule, d)) s = 'WEEKLY_OFF';
        else if (d <= ctx.today && attendanceOn) s = 'ABSENT';
      }
      const m = s ? MARK[s] || '' : '';
      if (m in tally) tally[m] += 1;
      return m;
    });
    return [p.code || '', p.name, p.guardianName || '', ...marks, num(tally.P + tally.HD / 2), String(tally.A), String(tally.L), String(tally.H + tally.W)];
  });
  const notes = ['P present · HD half day · A absent · L leave · H holiday · W weekly off · – not employed that day.'];
  if (!attendanceOn) notes.push('Attendance is not switched on: a working day with nothing recorded is left blank, not marked absent.');
  return {
    title: 'Muster roll',
    period: month,
    establishment,
    columns: ['Employee ID', 'Name', 'Father’s / husband’s name', ...days.map((d) => String(Number(d.slice(8)))), 'Present', 'Absent', 'Leave', 'Holidays & offs'],
    rows,
    notes,
    generatedOn: todayIst(),
  };
}

/**
 * Leave summary for a range: per department and leave type, how many people
 * took it and how many days, from approved leave (the days inside the range,
 * from the day record, so a leave that runs past the range counts only its
 * part in it). Paid and unpaid are said, so absenteeism and loss of pay read
 * at a glance.
 */
export async function leaveSummary(orgId: string, establishmentId: string | null, from: string, to: string) {
  const { establishment, ids } = await establishmentOf(orgId, establishmentId);
  const leaveDays = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, date: { gte: from, lte: to }, leaveRequestId: { not: null }, status: { in: ['ON_LEAVE', 'HALF_DAY'] } }, select: { employeeId: true, status: true, leaveRequestId: true } });
  const inScope = leaveDays.filter((d) => !ids || ids.has(d.employeeId));
  const requests = new Map((await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: [...new Set(inScope.map((d) => d.leaveRequestId!))] }, status: 'APPROVED' }, select: { id: true, leaveTypeId: true } })).map((r) => [r.id, r.leaveTypeId]));
  const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true } })).map((t) => [t.id, t]));
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(inScope.map((d) => d.employeeId))] } }, select: { id: true, department: true } })).map((p) => [p.id, p]));
  const groups = new Map<string, { department: string; type: string; paid: boolean; people: Set<string>; days: number }>();
  for (const d of inScope) {
    const typeId = requests.get(d.leaveRequestId!);
    const t = typeId ? types.get(typeId) : null;
    if (!t) continue;
    const department = people.get(d.employeeId)?.department || 'No department';
    const key = `${department}\u0000${t.id}`;
    const g = groups.get(key) || { department, type: t.name, paid: t.isPaid, people: new Set<string>(), days: 0 };
    g.people.add(d.employeeId);
    g.days += d.status === 'ON_LEAVE' ? 1 : 0.5;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.department.localeCompare(b.department) || a.type.localeCompare(b.type));
  const total = sorted.reduce((a, g) => a + g.days, 0);
  const unpaid = sorted.filter((g) => !g.paid).reduce((a, g) => a + g.days, 0);
  return {
    title: 'Leave summary',
    from,
    to,
    establishment,
    columns: ['Department', 'Leave type', 'Paid', 'People', 'Days'],
    rows: sorted.map((g) => [g.department, g.type, g.paid ? 'Paid' : 'Unpaid', String(g.people.size), num(g.days)]),
    totals: ['All', '', '', String(new Set(inScope.filter((d) => requests.has(d.leaveRequestId!)).map((d) => d.employeeId)).size), num(total)],
    notes: [`${num(total)} days of leave taken, ${num(unpaid)} of them unpaid.`],
    generatedOn: todayIst(),
  };
}

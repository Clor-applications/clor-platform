import { Router } from 'express';
import { z } from 'zod';
import { runSchedule } from '../services/attendance/reportSchedules.js';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { isWeeklyOff, istDate, istTime } from '../services/attendance/compute.js';
import { FACE, ONLINE_WINDOW_MS } from '../services/attendance/adms.js';
import { ISO_DATE, daysOfMonth, monthRows, periodContext, today } from '../services/attendance/days.js';
import { sentOnly } from '../utils/sentOnly.js';
import { teamScope } from '../services/people/scope.js';
import { docAccess, docAccessOfBoth, docAccessOfUser, docWhere, type DocAccess } from '../services/people/documentAccess.js';

/**
 * Attendance reports — ClorTime's catalogue (routes/reports.js) and its
 * statutory registers (services/registers.js), on CLOR's data. Every report
 * returns the same shape — columns, rows, totals, notes — so one screen shows
 * them all and exports any of them.
 *
 * The registers are the CONTENT a Factories Act inspection asks for (muster
 * roll, overtime, leave), not a certified form: each state prescribes its own
 * layout (Form 25 in Tamil Nadu, Form 29 in Maharashtra…).
 */
export const attendanceReportsRouter = Router();
attendanceReportsRouter.use(requireAuth, requireTenantContext);

const can = () => requirePermission(ATTENDANCE_MODULE, PermissionAction.VIEW as any, ATTENDANCE_RESOURCE.records);
/*
 * The reports are the whole company's (registers, readers, documents, everyone's birthdays). A
 * team-scoped role (a Team Manager, audit 7 Nov 2026 #3) holds Records VIEW for its team today, not
 * these: it is refused rather than shown company-wide figures. The calendar alone narrows to its team.
 */
const wholeCompany = async (req: any, res: any) => {
  if ((await teamScope(req)).all) return true;
  res.status(403).json({ error: 'Attendance reports cover the whole company. Your team’s days are under Daily attendance.', code: 'TEAM_SCOPED' });
  return false;
};
const MAX_DAYS = 92;
const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.max(0, m) % 60).padStart(2, '0')}`;

type Col = { key: string; label: string; align?: 'end' | 'center' };
type Report = { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; notes?: string[] };

/* `group` is where a report sits on the Reports page; names match the sidebar's (docs/ui/ATTENDANCE_NAVIGATION.md). */
export const REPORTS = [
  { id: 'daily', group: 'Attendance', name: 'Daily Attendance', description: 'One day: everyone’s in and out, hours, late, overtime and status.', params: ['date', 'department'] },
  { id: 'monthly', group: 'Attendance', name: 'Monthly Attendance Summary', description: 'Per person: present, absent, leave, holidays, payable and loss-of-pay days.', params: ['month', 'department'] },
  { id: 'muster', group: 'Statutory Registers', name: 'Muster Roll', description: 'Statutory register: each worker, each day of the month — P, A, HD, L, H, W.', params: ['month', 'department'] },
  { id: 'late-early', group: 'Attendance', name: 'Late Arrivals & Early Exits', description: 'Days someone came late or left early.', params: ['from', 'to', 'department'] },
  { id: 'absent', group: 'Attendance', name: 'Absence Report', description: 'Working days with no attendance, by date.', params: ['from', 'to', 'department'] },
  { id: 'overtime', group: 'Statutory Registers', name: 'Overtime Register', description: 'Statutory register: overtime worked, approved or not, with totals per person.', params: ['from', 'to', 'department'] },
  { id: 'leave', group: 'Statutory Registers', name: 'Leave Register', description: 'Statutory register: leave approved in the period, paid and unpaid.', params: ['from', 'to', 'department'] },
  { id: 'department', group: 'Workforce', name: 'Department Attendance', description: 'Per department: headcount, present, absent, late and overtime for a month.', params: ['month'] },
  { id: 'readers', group: 'Devices', name: 'Reader Health', description: 'Each biometric reader: online, last seen, punches, failed commands.', params: [] },
  { id: 'biometrics', group: 'Devices', name: 'Biometric Enrolment', description: 'Who has fingerprints and a face enrolled — and who has none.', params: [] },
  { id: 'first-last', group: 'Attendance', name: 'First & Last Punch', description: 'Per person per day: the first punch, the last, and how many between.', params: ['from', 'to', 'department'] },
  { id: 'missed', group: 'Attendance', name: 'Missed Punches', description: 'Days with an in and no out — the ones to chase before payroll.', params: ['from', 'to', 'department'] },
  { id: 'timecard', group: 'Workforce', name: 'Employee Attendance History', description: 'One person, every day of a month: shift, in, out, worked, late, overtime, status. Everyone if no one is chosen.', params: ['month', 'employee', 'department'] },
  { id: 'work-duration', group: 'Workforce', name: 'Work Duration', description: 'Per person for a month: days under 4 hours, 4–8, 8–10, over 10, and the average.', params: ['month', 'department'] },
  { id: 'people-dates', group: 'People', name: 'Birthdays & Milestones', description: 'Birthdays, work anniversaries, probation and contract ends falling in a month.', params: ['month', 'department'] },
  { id: 'documents', group: 'People', name: 'Expiring Documents', description: 'Employee documents expired or expiring within 90 days.', params: ['department'] },
  { id: 'reader-punches', group: 'Devices', name: 'Reader Activity', description: 'Each reader, each day: how many punches, how many matched to a person.', params: ['from', 'to'] },
  { id: 'mobile', group: 'Devices', name: 'Mobile Punches', description: 'Punches from phones: where, how accurate, with a selfie or not.', params: ['from', 'to', 'department'] },
  { id: 'contractor', group: 'Workforce', name: 'Contractor Attendance', description: 'Per contractor for a month: workers, present and payable days, approved overtime — what to check a bill against.', params: ['month'] },
] as const;

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
};
const MARK: Record<string, string> = { PRESENT: 'P', HALF_DAY: 'HD', ABSENT: 'A', ON_LEAVE: 'L', HOLIDAY: 'H', WEEKLY_OFF: 'W' };

function params(q: any) {
  const t = today();
  const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? String(q.month) : t.slice(0, 7);
  const date = ISO_DATE.test(String(q.date || '')) ? String(q.date) : t;
  let to = ISO_DATE.test(String(q.to || '')) ? String(q.to) : t;
  let from = ISO_DATE.test(String(q.from || '')) ? String(q.from) : `${to.slice(0, 7)}-01`;
  if (from > to) [from, to] = [to, from];
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_DAYS) throw Object.assign(new Error(`A report covers at most ${MAX_DAYS} days.`), { status: 400 });
  const pick = (k: string) => String(q[k] || '').trim() || null;
  return { month, date, from, to, departmentId: pick('departmentId'), employeeId: pick('employeeId'), areaId: pick('areaId'), contractorId: pick('contractorId') };
}

/**
 * A past working day nobody has any attendance for may be a day the readers
 * were down or the company was not using CLOR yet — not a day everyone was
 * absent (ClorTime: 409 absences in a month for a company of seventy). The
 * figures still follow the month summary; the report says which days look like that.
 */
function quietDays(ctx: Awaited<ReturnType<typeof periodContext>>) {
  const recorded = new Set(ctx.records.map((r) => r.date));
  return ctx.days.filter((d) => d <= ctx.today && !recorded.has(d) && !ctx.holidaySet.has(d));
}
const quietNote = (days: string[]) =>
  days.length ? [`Nobody has any attendance on ${days.length === 1 ? days[0] : `${days.length} working days (${days.slice(0, 5).join(', ')}${days.length > 5 ? '…' : ''})`}. If the readers were down or attendance was not being kept then, those days show as absent here and need correcting.`] : [];

/** Each person's mark for a day, the same way the month summary counts it. */
function dayStatus(ctx: Awaited<ReturnType<typeof periodContext>>, p: { id: string; areaId?: string | null }, date: string) {
  const r = ctx.recordsOf.get(p.id)?.get(date);
  if (r) return r.status;
  if (ctx.holidaysFor(p as any).has(date)) return 'HOLIDAY';
  if (isWeeklyOff(ctx.shiftOn(p.id, date).rule, date)) return 'WEEKLY_OFF';
  if (date > ctx.today) return null;
  /* Before the company kept attendance on CLOR: not tracked, not absent (#5). */
  if (ctx.untracked(p.id, date)) return null;
  return 'ABSENT';
}

/**
 * The few figures shown above a report's table: what someone opening it wants
 * to know before reading rows. Worked out from the rows the report returns, so
 * they can never disagree with the table.
 */
type Figure = { label: string; value: string | number; hint?: string; tone?: 'pos' | 'neg' | 'warn' };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
export function figuresFor(id: string, r: Report): Figure[] {
  const rows = r.rows as any[];
  const n = (k: string) => rows.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const people = () => new Set(rows.map((x) => x.code ?? x.name)).size;
  const byPerson = (pick: (x: any) => boolean) => {
    const m = new Map<string, { name: string; days: number }>();
    for (const x of rows.filter(pick)) {
      const k = String(x.code ?? x.name);
      m.set(k, { name: x.name, days: (m.get(k)?.days || 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.days - a.days);
  };
  switch (id) {
    case 'daily': {
      const st = (re: RegExp) => rows.filter((x) => re.test(String(x.status))).length;
      const present = st(/^Present/);
      const half = st(/^Half/);
      const absent = st(/^Absent/);
      return [
        { label: 'Present', value: present + half, hint: half ? `${half} half day` : undefined, tone: 'pos' },
        { label: 'Absent', value: absent, tone: absent ? 'neg' : undefined },
        { label: 'On leave', value: st(/^On leave/) },
        { label: 'Late', value: rows.filter((x) => Number(x.late) > 0).length, tone: 'warn' },
        { label: 'Attendance rate', value: pct(present + half / 2, present + half + absent) },
      ];
    }
    case 'monthly':
    case 'muster': {
      const present = id === 'monthly' ? n('present') : rows.reduce((t, x) => t + (Number(x.present) || 0), 0);
      const half = id === 'monthly' ? n('halfDays') : 0;
      const absent = n('absent');
      const out: Figure[] = [
        { label: 'People', value: rows.length },
        { label: 'Attendance rate', value: pct(present + half / 2, present + half + absent), hint: 'of working days' },
        { label: 'Absent days', value: absent, tone: absent ? 'neg' : undefined },
      ];
      if (id === 'monthly') out.push({ label: 'Payable days', value: n('payableDays') }, { label: 'Loss of pay days', value: n('lossOfPayDays'), tone: n('lossOfPayDays') ? 'warn' : undefined }, { label: 'Late days', value: n('lateCount') });
      else out.push({ label: 'Leave days', value: n('leave') });
      return out;
    }
    case 'late-early': {
      const late = rows.filter((x) => Number(x.late) > 0);
      const repeat = byPerson((x) => Number(x.late) > 0).filter((p) => p.days >= 3).length;
      return [
        { label: 'Late days', value: late.length, tone: late.length ? 'warn' : undefined },
        { label: 'People late 3+ times', value: repeat, tone: repeat ? 'neg' : undefined },
        { label: 'Average minutes late', value: late.length ? Math.round(late.reduce((t, x) => t + Number(x.late), 0) / late.length) : 0 },
        { label: 'Early exits', value: rows.filter((x) => Number(x.earlyOut) > 0).length },
      ];
    }
    case 'absent': {
      const top = byPerson(() => true)[0];
      return [
        { label: 'Absent days', value: rows.length, tone: rows.length ? 'neg' : undefined },
        { label: 'People absent', value: people() },
        { label: 'Not marked at all', value: rows.filter((x) => x.how === 'No attendance').length, hint: 'no punch or mark' },
        ...(top ? [{ label: 'Most absent', value: top.name, hint: `${top.days} day${top.days === 1 ? '' : 's'}` }] : []),
      ];
    }
    case 'overtime':
      return [
        { label: 'People with overtime', value: people() },
        { label: 'Overtime', value: String(r.totals?.overtime ?? '0:00') },
      ];
    case 'leave':
      return [
        { label: 'Requests', value: rows.length },
        { label: 'Leave days', value: n('days') },
        { label: 'People', value: people() },
      ];
    case 'department': {
      const present = n('present');
      const half = n('halfDays');
      const absent = n('absent');
      const worst = [...rows].filter((x) => Number(x.present) + Number(x.halfDays) + Number(x.absent) > 0)
        .sort((a, b) => Number(b.absent) / (Number(b.present) + Number(b.halfDays) + Number(b.absent)) - Number(a.absent) / (Number(a.present) + Number(a.halfDays) + Number(a.absent)))[0];
      return [
        { label: 'Departments', value: rows.length },
        { label: 'People', value: n('headcount') },
        { label: 'Attendance rate', value: pct(present + half / 2, present + half + absent) },
        ...(worst ? [{ label: 'Most absence', value: String(worst.department), hint: pct(Number(worst.absent), Number(worst.present) + Number(worst.halfDays) + Number(worst.absent)) }] : []),
      ];
    }
    case 'missed':
      return [
        { label: 'Days with no check-out', value: rows.length, tone: rows.length ? 'warn' : undefined },
        { label: 'People', value: people() },
      ];
    case 'reader-punches':
      return [
        { label: 'Punches', value: n('punches') },
        { label: 'Matched to a person', value: pct(n('matched'), n('punches')) },
        { label: 'Unmatched', value: n('unmatched'), tone: n('unmatched') ? 'warn' : undefined },
      ];
    case 'mobile':
      return [
        { label: 'Phone punches', value: rows.length },
        { label: 'People', value: people() },
        { label: 'With a selfie', value: rows.filter((x) => x.selfie === 'Yes').length },
      ];
    case 'contractor':
      return [
        { label: 'Contractors', value: rows.length },
        { label: 'Workers', value: n('workers') },
        { label: 'Payable days', value: Math.round(n('payable') * 10) / 10 },
      ];
    default:
      return [{ label: 'Rows', value: rows.length }];
  }
}

/** Who a report covers: department, area (site), contractor and one person, any combination. */
type Scope = { departmentId: string | null; areaId: string | null; contractorId: string | null; employeeId: string | null };
const inScope = (f: Scope) => (p: { id?: string; departmentId?: string | null; areaId?: string | null; contractorId?: string | null }) =>
  (!f.departmentId || p.departmentId === f.departmentId) &&
  (!f.areaId || p.areaId === f.areaId) &&
  (!f.contractorId || p.contractorId === f.contractorId) &&
  (!f.employeeId || p.id === f.employeeId);

export async function build(id: string, accountId: string, orgId: string, q: any, as: { docs?: DocAccess; asUserId?: string | null } = {}): Promise<Report> {
  const scope = params(q);
  const { month, date, from, to, departmentId, employeeId } = scope;
  const inDept = (_d: string | null) => inScope(scope);

  if (id === 'daily') {
    const ctx = await periodContext(accountId, orgId, date, date);
    const people = ctx.people.filter(inDept(departmentId)).filter((p) => ctx.spanOf(p).length);
    const rows = people.map((p) => {
      const r = ctx.recordsOf.get(p.id)?.get(date);
      const status = dayStatus(ctx, p, date);
      return {
        code: p.code,
        name: p.name,
        department: p.department,
        shift: ctx.shiftOn(p.id, date).name,
        in: r?.checkIn ? istTime(r.checkIn) : '',
        out: r?.checkOut ? istTime(r.checkOut) : '',
        worked: r?.checkOut ? hm(r.workedMinutes) : '',
        late: r?.lateMinutes || '',
        earlyOut: r?.earlyOutMinutes || '',
        overtime: r?.overtimeMinutes ? hm(r.overtimeMinutes) : '',
        status: status ? (r ? STATUS_LABEL[status] : `${STATUS_LABEL[status]}${status === 'ABSENT' ? ' (not marked)' : ''}`) : '',
      };
    });
    const count = (s: string) => people.filter((p) => dayStatus(ctx, p, date) === s).length;
    return {
      title: 'Daily attendance',
      period: date,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'shift', label: 'Shift' },
        { key: 'in', label: 'In', align: 'center' },
        { key: 'out', label: 'Out', align: 'center' },
        { key: 'worked', label: 'Worked', align: 'end' },
        { key: 'late', label: 'Late (min)', align: 'end' },
        { key: 'earlyOut', label: 'Early out (min)', align: 'end' },
        { key: 'overtime', label: 'Overtime', align: 'end' },
        { key: 'status', label: 'Status' },
      ],
      rows,
      totals: { name: `${people.length} people`, status: `${count('PRESENT')} present · ${count('HALF_DAY')} half · ${count('ABSENT')} absent · ${count('ON_LEAVE')} leave` },
      notes: date <= ctx.today ? quietNote(quietDays(ctx)) : [],
    };
  }

  if (id === 'monthly') {
    const rows = await monthRows(accountId, orgId, month);
    const scoped = departmentId || scope.areaId || scope.contractorId || employeeId;
    const ids = scoped ? new Set((await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, departmentId: true, areaId: true, contractorId: true } })).filter(inScope(scope)).map((e) => e.id)) : null;
    const shown = ids ? rows.filter((r) => ids.has(r.employeeId)) : rows;
    const sum = (k: string) => shown.reduce((s, r: any) => s + (Number(r[k]) || 0), 0);
    return {
      title: 'Monthly summary',
      period: month,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'totalDays', label: 'Days', align: 'end' },
        { key: 'present', label: 'Present', align: 'end' },
        { key: 'halfDays', label: 'Half days', align: 'end' },
        { key: 'absent', label: 'Absent', align: 'end' },
        { key: 'leave', label: 'Leave', align: 'end' },
        { key: 'unpaidLeaveDays', label: 'Unpaid leave', align: 'end' },
        { key: 'holidays', label: 'Holidays', align: 'end' },
        { key: 'weeklyOffs', label: 'Weekly offs', align: 'end' },
        { key: 'lossOfPayDays', label: 'Loss of pay', align: 'end' },
        { key: 'payableDays', label: 'Payable', align: 'end' },
        { key: 'lateCount', label: 'Late days', align: 'end' },
      ],
      rows: shown,
      totals: { name: `${shown.length} people`, present: sum('present'), absent: sum('absent'), leave: sum('leave'), lossOfPayDays: sum('lossOfPayDays'), payableDays: sum('payableDays') },
    };
  }

  if (id === 'muster') {
    const days = daysOfMonth(month);
    const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
    const people = ctx.people.filter(inDept(departmentId));
    const rows = people.map((p) => {
      const span = new Set(ctx.spanOf(p));
      const row: Record<string, unknown> = { code: p.code, name: p.name, guardian: p.guardianName || '', department: p.department };
      const tally: Record<string, number> = { P: 0, HD: 0, A: 0, L: 0, H: 0, W: 0 };
      for (const d of days) {
        const s = span.has(d) ? dayStatus(ctx, p, d) : 'OUT';
        const m = s === 'OUT' ? '–' : s ? MARK[s] : '';
        row[d.slice(8)] = m;
        if (m in tally) tally[m] += 1;
      }
      return { ...row, present: tally.P + tally.HD / 2, absent: tally.A, leave: tally.L, off: tally.H + tally.W };
    });
    return {
      title: 'Muster roll',
      period: month,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'guardian', label: 'Father’s / husband’s name' },
        ...days.map((d) => ({ key: d.slice(8), label: String(Number(d.slice(8))), align: 'center' as const })),
        { key: 'present', label: 'Present', align: 'end' },
        { key: 'absent', label: 'Absent', align: 'end' },
        { key: 'leave', label: 'Leave', align: 'end' },
        { key: 'off', label: 'Holidays & offs', align: 'end' },
      ],
      rows,
      notes: [
        'P present · HD half day · A absent · L leave · H holiday · W weekly off · – not employed that day.',
        'Includes everyone employed during the month, including people who have since left; door-only staff are not on it.',
        ...(people.some((p) => !p.guardianName)
          ? [`${people.filter((p) => !p.guardianName).length} of ${people.length} have no father’s or husband’s name on file — the muster roll asks for it (employee file → Attendance).`]
          : []),
        ...quietNote(quietDays(ctx)),
      ],
    };
  }

  if (id === 'late-early' || id === 'absent' || id === 'overtime') {
    const ctx = await periodContext(accountId, orgId, from, to);
    const people = new Map(ctx.people.filter(inDept(departmentId)).map((p) => [p.id, p]));
    if (id === 'late-early') {
      const rows = ctx.records
        .filter((r) => people.has(r.employeeId) && (r.lateMinutes > 0 || r.earlyOutMinutes > 0))
        .sort((a, b) => a.date.localeCompare(b.date) || people.get(a.employeeId)!.name.localeCompare(people.get(b.employeeId)!.name))
        .map((r) => {
          const p = people.get(r.employeeId)!;
          return { date: r.date, code: p.code, name: p.name, department: p.department, shift: ctx.shiftOn(p.id, r.date).name, in: r.checkIn ? istTime(r.checkIn) : '', out: r.checkOut ? istTime(r.checkOut) : '', late: r.lateMinutes || '', earlyOut: r.earlyOutMinutes || '' };
        });
      return {
        title: 'Late arrival and early departure',
        period: `${from} to ${to}`,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'code', label: 'Employee ID' },
          { key: 'name', label: 'Name' },
          { key: 'department', label: 'Department' },
          { key: 'shift', label: 'Shift' },
          { key: 'in', label: 'In', align: 'center' },
          { key: 'out', label: 'Out', align: 'center' },
          { key: 'late', label: 'Late (min)', align: 'end' },
          { key: 'earlyOut', label: 'Early out (min)', align: 'end' },
        ],
        rows,
        totals: { name: `${rows.length} days`, late: rows.reduce((s, r) => s + (Number(r.late) || 0), 0), earlyOut: rows.reduce((s, r) => s + (Number(r.earlyOut) || 0), 0) },
        notes: ['Late counts from the shift start once past the grace; early out counts to the shift end.'],
      };
    }
    if (id === 'absent') {
      const rows: Record<string, unknown>[] = [];
      for (const d of ctx.days) {
        if (d > ctx.today) break;
        for (const p of people.values()) {
          if (!ctx.spanOf(p).includes(d)) continue;
          if (dayStatus(ctx, p, d) !== 'ABSENT') continue;
          const marked = Boolean(ctx.recordsOf.get(p.id)?.get(d));
          rows.push({ date: d, code: p.code, name: p.name, department: p.department, how: marked ? 'Marked absent' : 'No attendance' });
        }
      }
      return {
        title: 'Absent',
        period: `${from} to ${to}`,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'code', label: 'Employee ID' },
          { key: 'name', label: 'Name' },
          { key: 'department', label: 'Department' },
          { key: 'how', label: 'Why' },
        ],
        rows,
        totals: { name: `${rows.length} absent days` },
        notes: quietNote(quietDays(ctx)),
      };
    }
    // overtime register
    const rows = ctx.records
      .filter((r) => people.has(r.employeeId) && r.overtimeMinutes > 0)
      .sort((a, b) => people.get(a.employeeId)!.name.localeCompare(people.get(b.employeeId)!.name) || a.date.localeCompare(b.date))
      .map((r) => {
        const p = people.get(r.employeeId)!;
        return { name: p.name, code: p.code, department: p.department, date: r.date, worked: hm(r.workedMinutes), overtime: hm(r.overtimeMinutes), minutes: r.overtimeMinutes, approved: r.overtimeApproved ? 'Yes' : 'No' };
      });
    const approved = rows.filter((r) => r.approved === 'Yes').reduce((s, r) => s + r.minutes, 0);
    const all = rows.reduce((s, r) => s + r.minutes, 0);
    return {
      title: 'Overtime register',
      period: `${from} to ${to}`,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'date', label: 'Date' },
        { key: 'worked', label: 'Hours worked', align: 'end' },
        { key: 'overtime', label: 'Overtime', align: 'end' },
        { key: 'approved', label: 'Approved', align: 'center' },
      ],
      rows: rows.map(({ minutes: _m, ...r }) => r),
      totals: { name: `${new Set(rows.map((r) => r.code ?? r.name)).size} people`, overtime: `${hm(all)} (approved ${hm(approved)})` },
      notes: ['Wages are not shown: the overtime rate is set in Payroll.'],
    };
  }

  if (id === 'leave') {
    const people = new Map(
      (await peoplePrisma.employee.findMany({ where: { accountId, orgId }, select: { id: true, name: true, code: true, department: true, departmentId: true } }))
        .filter(inDept(departmentId))
        .map((p) => [p.id, p])
    );
    const [requests, types] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where: { accountId, orgId, status: 'APPROVED', fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: 'asc' } }),
      peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true, isPrivate: true } }),
    ]);
    /* Reports are read and mailed beyond those who decide leave: a private type reads "Private leave", with no reason. People's register has the detail for HR. */
    const type = new Map(types.map((t) => [t.id, t.isPrivate ? { ...t, name: 'Private leave' } : t]));
    const rows = requests
      .filter((r) => people.has(r.employeeId))
      .map((r) => {
        const p = people.get(r.employeeId)!;
        return { code: p.code, name: p.name, department: p.department, type: type.get(r.leaveTypeId)?.name || '—', paid: type.get(r.leaveTypeId)?.isPaid === false ? 'No' : 'Yes', from: r.fromDate, to: r.toDate, days: r.days, reason: type.get(r.leaveTypeId)?.isPrivate ? '' : r.reason };
      });
    return {
      title: 'Leave register',
      period: `${from} to ${to}`,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'type', label: 'Leave type' },
        { key: 'paid', label: 'Paid', align: 'center' },
        { key: 'from', label: 'From' },
        { key: 'to', label: 'To' },
        { key: 'days', label: 'Days', align: 'end' },
        { key: 'reason', label: 'Reason' },
      ],
      rows,
      totals: { name: `${rows.length} requests`, days: rows.reduce((s, r) => s + r.days, 0) },
      notes: ['Approved leave overlapping the period, whole requests. Days exclude weekly offs and holidays.'],
    };
  }

  if (id === 'department') {
    const rows = await monthRows(accountId, orgId, month);
    const depts = await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, department: true } });
    const deptOf = new Map(depts.map((d) => [d.id, d.department || 'No department']));
    const groups = new Map<string, any>();
    for (const r of rows) {
      const k = deptOf.get(r.employeeId) || 'No department';
      const g = groups.get(k) || { department: k, headcount: 0, present: 0, halfDays: 0, absent: 0, leave: 0, lateCount: 0, approvedOvertimeMinutes: 0, payableDays: 0 };
      g.headcount += 1;
      for (const f of ['present', 'halfDays', 'absent', 'leave', 'lateCount', 'approvedOvertimeMinutes', 'payableDays']) g[f] += Number((r as any)[f]) || 0;
      groups.set(k, g);
    }
    return {
      title: 'Department monthly',
      period: month,
      columns: [
        { key: 'department', label: 'Department' },
        { key: 'headcount', label: 'People', align: 'end' },
        { key: 'present', label: 'Present days', align: 'end' },
        { key: 'halfDays', label: 'Half days', align: 'end' },
        { key: 'absent', label: 'Absent days', align: 'end' },
        { key: 'leave', label: 'Leave days', align: 'end' },
        { key: 'lateCount', label: 'Late days', align: 'end' },
        { key: 'overtime', label: 'Approved OT', align: 'end' },
        { key: 'payableDays', label: 'Payable days', align: 'end' },
      ],
      rows: [...groups.values()].sort((a, b) => a.department.localeCompare(b.department)).map((g) => ({ ...g, overtime: hm(g.approvedOvertimeMinutes) })),
    };
  }

  if (id === 'readers') {
    const devices = await peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
    const since = new Date(Date.now() - 7 * 86_400_000);
    const t = today();
    const rows = await Promise.all(
      devices.map(async (d) => {
        const [todayPunches, weekFailed, waiting, lastPunch] = await Promise.all([
          peoplePrisma.devicePunch.count({ where: { orgId, deviceId: d.id, localTime: { startsWith: t } } }),
          peoplePrisma.deviceCommand.count({ where: { orgId, deviceId: d.id, status: 'FAILED', createdAt: { gte: since } } }),
          peoplePrisma.deviceCommand.count({ where: { orgId, deviceId: d.id, status: { in: ['PENDING', 'SENT'] } } }),
          peoplePrisma.devicePunch.findFirst({ where: { orgId, deviceId: d.id }, orderBy: { at: 'desc' }, select: { localTime: true } }),
        ]);
        const online = Boolean(d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
        return {
          name: d.name,
          serial: d.serialNumber,
          status: !d.isActive ? 'Switched off' : online ? 'Online' : 'Offline',
          lastSeen: d.lastSeenAt ? `${istDate(d.lastSeenAt)} ${istTime(d.lastSeenAt)}` : 'Never',
          lastPunch: lastPunch?.localTime || '—',
          today: todayPunches,
          waiting,
          failed: weekFailed,
          model: [d.model, d.firmware && `v${d.firmware}`].filter(Boolean).join(' '),
        };
      })
    );
    return {
      title: 'Reader health',
      period: t,
      columns: [
        { key: 'name', label: 'Reader' },
        { key: 'serial', label: 'Serial' },
        { key: 'status', label: 'Status' },
        { key: 'lastSeen', label: 'Last seen' },
        { key: 'lastPunch', label: 'Last punch' },
        { key: 'today', label: 'Punches today', align: 'end' },
        { key: 'waiting', label: 'Commands waiting', align: 'end' },
        { key: 'failed', label: 'Failed (7 days)', align: 'end' },
        { key: 'model', label: 'Model' },
      ],
      rows,
      notes: ['A reader is offline after 3 minutes without a heartbeat (it sends one every 30 seconds).'],
    };
  }

  if (id === 'biometrics') {
    const [people, templates] = await Promise.all([
      peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true, department: true, devicePin: true }, orderBy: { name: 'asc' } }),
      peoplePrisma.biometricTemplate.groupBy({ by: ['employeeId', 'type'], where: { accountId, orgId, employeeId: { not: null } }, _count: { _all: true } }),
    ]);
    const count = (id: string, face: boolean) =>
      templates.filter((t) => t.employeeId === id && (face ? t.type === FACE : t.type === 1)).reduce((s, t) => s + t._count._all, 0);
    const rows = people.map((p) => {
      const fingers = count(p.id, false);
      const faces = count(p.id, true);
      return { code: p.code, name: p.name, department: p.department, readerId: p.devicePin || p.code || '', fingers, face: faces ? 'Yes' : 'No', enrolled: fingers || faces ? 'Yes' : 'Not enrolled' };
    });
    return {
      title: 'Biometric enrolment',
      period: today(),
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'readerId', label: 'Reader ID' },
        { key: 'fingers', label: 'Fingerprints', align: 'end' },
        { key: 'face', label: 'Face', align: 'center' },
        { key: 'enrolled', label: 'Enrolled' },
      ],
      rows,
      totals: { name: `${rows.length} people`, enrolled: `${rows.filter((r) => r.enrolled === 'Yes').length} enrolled` },
      notes: ['Counts what the readers have sent to CLOR; use “Fetch fingerprints & faces” on a reader to bring older enrolments in.'],
    };
  }

  if (id === 'first-last' || id === 'missed' || id === 'reader-punches' || id === 'mobile') {
    const ctx = await periodContext(accountId, orgId, from, to);
    const people = new Map(ctx.people.filter(inDept(departmentId)).map((p) => [p.id, p]));
    if (id === 'missed') {
      const rows = ctx.records
        .filter((r) => people.has(r.employeeId) && r.checkIn && !r.checkOut && r.date < ctx.today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => {
          const p = people.get(r.employeeId)!;
          return { date: r.date, code: p.code, name: p.name, department: p.department, shift: ctx.shiftOn(p.id, r.date).name, in: r.checkIn ? istTime(r.checkIn) : '', status: STATUS_LABEL[r.status] || r.status };
        });
      return {
        title: 'Missed punches', period: `${from} to ${to}`,
        columns: [{ key: 'date', label: 'Date' }, { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'shift', label: 'Shift' }, { key: 'in', label: 'In', align: 'center' }, { key: 'status', label: 'Status' }],
        rows, totals: { name: `${rows.length} days with no check-out` }, notes: ['A day with an in and no out counts as loss of pay until it is corrected (Records, or a correction request).'],
      };
    }
    const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId, shiftDate: { gte: from, lte: to } }, orderBy: { at: 'asc' }, select: { employeeId: true, shiftDate: true, localTime: true, kind: true, deviceId: true, serialNumber: true, latitude: true, accuracyM: true, geofenceId: true, photoId: true, verifyMode: true } });
    if (id === 'first-last') {
      const byKey = new Map<string, { first: string; last: string; n: number; employeeId: string; date: string }>();
      for (const x of punches) {
        if (!x.employeeId || !x.shiftDate || !people.has(x.employeeId)) continue;
        const k = `${x.employeeId}|${x.shiftDate}`;
        const cur = byKey.get(k);
        const t = x.localTime.slice(11, 16);
        if (!cur) byKey.set(k, { first: t, last: t, n: 1, employeeId: x.employeeId, date: x.shiftDate });
        else { cur.last = t; cur.n += 1; }
      }
      const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || people.get(a.employeeId)!.name.localeCompare(people.get(b.employeeId)!.name)).map((x) => {
        const p = people.get(x.employeeId)!;
        return { date: x.date, code: p.code, name: p.name, department: p.department, first: x.first, last: x.n > 1 ? x.last : '', punches: x.n };
      });
      return {
        title: 'First and last punch', period: `${from} to ${to}`,
        columns: [{ key: 'date', label: 'Date' }, { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'first', label: 'First', align: 'center' }, { key: 'last', label: 'Last', align: 'center' }, { key: 'punches', label: 'Punches', align: 'end' }],
        rows, totals: { name: `${rows.length} person-days` }, notes: ['A day is the shift day the punch was counted on; a blank last punch means only one punch that day.'],
      };
    }
    if (id === 'reader-punches') {
      const devices = new Map((await peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true, serialNumber: true } })).map((d) => [d.id, d]));
      const byKey = new Map<string, { date: string; deviceId: string; n: number; matched: number }>();
      for (const x of punches) {
        if (!x.shiftDate) continue;
        const k = `${x.deviceId}|${x.shiftDate}`;
        const cur = byKey.get(k) || { date: x.shiftDate, deviceId: x.deviceId, n: 0, matched: 0 };
        cur.n += 1;
        if (x.employeeId) cur.matched += 1;
        byKey.set(k, cur);
      }
      const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date, reader: devices.get(x.deviceId)?.name || x.deviceId, serial: devices.get(x.deviceId)?.serialNumber || '', punches: x.n, matched: x.matched, unmatched: x.n - x.matched }));
      return {
        title: 'Punches per reader', period: `${from} to ${to}`,
        columns: [{ key: 'date', label: 'Date' }, { key: 'reader', label: 'Reader' }, { key: 'serial', label: 'Serial' }, { key: 'punches', label: 'Punches', align: 'end' }, { key: 'matched', label: 'Matched', align: 'end' }, { key: 'unmatched', label: 'Unmatched', align: 'end' }],
        rows, totals: { reader: `${rows.length} reader-days`, punches: rows.reduce((a, r) => a + r.punches, 0), matched: rows.reduce((a, r) => a + r.matched, 0), unmatched: rows.reduce((a, r) => a + r.unmatched, 0) },
      };
    }
    /* mobile */
    const fences = new Map((await peoplePrisma.geofence.findMany({ where: { orgId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
    const rows = punches
      .filter((x) => x.latitude != null && x.employeeId && people.has(x.employeeId))
      .map((x) => {
        const p = people.get(x.employeeId!)!;
        return { time: x.localTime, code: p.code, name: p.name, department: p.department, direction: x.kind || '', site: x.geofenceId ? fences.get(x.geofenceId) || '' : '', accuracy: x.accuracyM != null ? `${Math.round(x.accuracyM)} m` : '', selfie: x.photoId ? 'Yes' : 'No' };
      });
    return {
      title: 'Phone punches', period: `${from} to ${to}`,
      columns: [{ key: 'time', label: 'Time' }, { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'direction', label: 'Direction', align: 'center' }, { key: 'site', label: 'Work site' }, { key: 'accuracy', label: 'Accuracy', align: 'end' }, { key: 'selfie', label: 'Selfie', align: 'center' }],
      rows, totals: { name: `${rows.length} punches`, selfie: `${rows.filter((r) => r.selfie === 'Yes').length} with selfie` },
    };
  }

  if (id === 'timecard' || id === 'work-duration') {
    const days = daysOfMonth(month);
    const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
    const people = ctx.people.filter(inDept(departmentId)).filter((p) => !employeeId || p.id === employeeId);
    if (id === 'timecard') {
      const rows: any[] = [];
      for (const p of people) {
        const span = new Set(ctx.spanOf(p));
        for (const d of days) {
          if (!span.has(d) || d > ctx.today) continue;
          const r = ctx.recordsOf.get(p.id)?.get(d);
          const status = dayStatus(ctx, p, d);
          rows.push({ date: d, code: p.code, name: p.name, shift: ctx.shiftOn(p.id, d).name, in: r?.checkIn ? istTime(r.checkIn) : '', out: r?.checkOut ? istTime(r.checkOut) : '', worked: r?.checkOut ? hm(r.workedMinutes) : '', late: r?.lateMinutes || '', earlyOut: r?.earlyOutMinutes || '', overtime: r?.overtimeMinutes ? hm(r.overtimeMinutes) : '', status: status ? STATUS_LABEL[status] : '' });
        }
      }
      const worked = ctx.records.filter((r) => people.some((p) => p.id === r.employeeId) && r.checkOut).reduce((a, r) => a + (r.workedMinutes || 0), 0);
      return {
        title: `Time card${employeeId && people[0] ? ` — ${people[0].name}` : ''}`, period: month,
        columns: [{ key: 'date', label: 'Date' }, ...(employeeId ? [] : [{ key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }]), { key: 'shift', label: 'Shift' }, { key: 'in', label: 'In', align: 'center' }, { key: 'out', label: 'Out', align: 'center' }, { key: 'worked', label: 'Worked', align: 'end' }, { key: 'late', label: 'Late (min)', align: 'end' }, { key: 'earlyOut', label: 'Early out (min)', align: 'end' }, { key: 'overtime', label: 'Overtime', align: 'end' }, { key: 'status', label: 'Status' }],
        rows, totals: { date: `${rows.length} days`, worked: hm(worked) },
      };
    }
    const rows = people.map((p) => {
      const span = new Set(ctx.spanOf(p));
      const recs = [...(ctx.recordsOf.get(p.id)?.values() || [])].filter((r) => span.has(r.date) && r.checkOut);
      const band = (lo: number, hi: number) => recs.filter((r) => (r.workedMinutes || 0) >= lo && (r.workedMinutes || 0) < hi).length;
      const total = recs.reduce((a, r) => a + (r.workedMinutes || 0), 0);
      return { code: p.code, name: p.name, department: p.department, days: recs.length, under4: band(0, 240), h4to8: band(240, 480), h8to10: band(480, 600), over10: band(600, Infinity), total: hm(total), average: recs.length ? hm(Math.round(total / recs.length)) : '' };
    });
    return {
      title: 'Work duration', period: month,
      columns: [{ key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'days', label: 'Days with out', align: 'end' }, { key: 'under4', label: '< 4 h', align: 'end' }, { key: 'h4to8', label: '4–8 h', align: 'end' }, { key: 'h8to10', label: '8–10 h', align: 'end' }, { key: 'over10', label: '> 10 h', align: 'end' }, { key: 'total', label: 'Total', align: 'end' }, { key: 'average', label: 'Average / day', align: 'end' }],
      rows, totals: { name: `${rows.length} people` }, notes: ['Only days with a check-out are counted; a day still open has no duration yet.'],
    };
  }

  if (id === 'people-dates') {
    const mm = month.slice(5, 7);
    const yyyy = Number(month.slice(0, 4));
    const people = await peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, ...(departmentId ? { departmentId } : {}) }, select: { code: true, name: true, department: true, dateOfBirth: true, dateOfJoining: true, probationEndDate: true, contractEndDate: true } });
    const rows: any[] = [];
    for (const p of people) {
      if (p.dateOfBirth?.slice(5, 7) === mm) rows.push({ date: `${month}-${p.dateOfBirth.slice(8, 10)}`, code: p.code, name: p.name, department: p.department, what: 'Birthday', detail: '' });
      if (p.dateOfJoining?.slice(5, 7) === mm && Number(p.dateOfJoining.slice(0, 4)) < yyyy) rows.push({ date: `${month}-${p.dateOfJoining.slice(8, 10)}`, code: p.code, name: p.name, department: p.department, what: 'Work anniversary', detail: `${yyyy - Number(p.dateOfJoining.slice(0, 4))} year${yyyy - Number(p.dateOfJoining.slice(0, 4)) === 1 ? '' : 's'}` });
      if (p.probationEndDate?.startsWith(month)) rows.push({ date: p.probationEndDate, code: p.code, name: p.name, department: p.department, what: 'Probation ends', detail: '' });
      if (p.contractEndDate?.startsWith(month)) rows.push({ date: p.contractEndDate, code: p.code, name: p.name, department: p.department, what: 'Contract ends', detail: '' });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return {
      title: 'Birthdays and milestones', period: month,
      columns: [{ key: 'date', label: 'Date' }, { key: 'what', label: 'What' }, { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'detail', label: '' }],
      rows, totals: { name: `${rows.length} dates` },
    };
  }

  if (id === 'documents') {
    const limit = istDate(new Date(Date.now() + 90 * 86_400_000));
    /* Only the files the reader may open in People are listed (audit 7 Nov 2026); a scheduled mail reads as whoever set it up. */
    const access = as.docs ?? (await docAccessOfUser(accountId, orgId, as.asUserId));
    const docs = await peoplePrisma.employeeDocument.findMany({ where: { orgId, expiresOn: { not: null, lte: limit }, ...docWhere(access) }, select: { title: true, kind: true, expiresOn: true, employeeId: true }, orderBy: { expiresOn: 'asc' } });
    const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, ...(departmentId ? { departmentId } : {}) }, select: { id: true, code: true, name: true, department: true } })).map((p) => [p.id, p]));
    const t = today();
    const rows = docs.filter((d) => people.has(d.employeeId)).map((d) => { const p = people.get(d.employeeId)!; return { expires: d.expiresOn, code: p.code, name: p.name, department: p.department, document: d.title, kind: d.kind, state: d.expiresOn! < t ? 'Expired' : 'Expiring' }; });
    return {
      title: 'Documents expiring', period: `to ${limit}`,
      columns: [{ key: 'expires', label: 'Valid until' }, { key: 'state', label: '' }, { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'document', label: 'Document' }, { key: 'kind', label: 'Kind' }],
      rows, totals: { name: `${rows.length} documents`, state: `${rows.filter((r) => r.state === 'Expired').length} expired` },
    };
  }

  if (id === 'contractor') {
    const [rows, people, contractors] = await Promise.all([
      monthRows(accountId, orgId, month),
      peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, contractorId: true, departmentId: true, areaId: true } }),
      peoplePrisma.contractor.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    ]);
    const scoped = new Set(people.filter(inScope({ ...scope, contractorId: scope.contractorId })).map((p) => p.id));
    const contractorOf = new Map(people.map((p) => [p.id, p.contractorId]));
    const by = new Map<string, any>();
    for (const r of rows as any[]) {
      if (!scoped.has(r.employeeId)) continue;
      const cid = contractorOf.get(r.employeeId);
      if (!cid) continue;
      const g = by.get(cid) || { workers: 0, present: 0, halfDays: 0, absent: 0, leave: 0, payable: 0, ot: 0 };
      g.workers += 1;
      g.present += r.present;
      g.halfDays += r.halfDays;
      g.absent += r.absent;
      g.leave += r.leave;
      g.payable += r.payableDays;
      g.ot += r.approvedOvertimeMinutes;
      by.set(cid, g);
    }
    const t = today();
    const soon = new Date(Date.parse(`${t}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    const out = contractors
      .filter((c) => by.has(c.id) || (!scope.contractorId && c.isActive))
      .filter((c) => !scope.contractorId || c.id === scope.contractorId)
      .map((c) => {
        const g = by.get(c.id) || { workers: 0, present: 0, halfDays: 0, absent: 0, leave: 0, payable: 0, ot: 0 };
        const lic = c.licenceValidTo ? (c.licenceValidTo < t ? `Expired ${c.licenceValidTo}` : c.licenceValidTo <= soon ? `Expires ${c.licenceValidTo}` : `Valid to ${c.licenceValidTo}`) : 'No licence date';
        return { contractor: c.name, licence: c.licenceNo ? `${c.licenceNo}, ${lic}` : lic, workers: g.workers, present: g.present, halfDays: g.halfDays, absent: g.absent, leave: g.leave, payable: Math.round(g.payable * 10) / 10, overtime: hm(g.ot) };
      });
    const sum = (k: string) => out.reduce((s2, r: any) => s2 + (Number(r[k]) || 0), 0);
    return {
      title: 'Contractor attendance',
      period: month,
      columns: [
        { key: 'contractor', label: 'Contractor' },
        { key: 'licence', label: 'Licence' },
        { key: 'workers', label: 'Workers', align: 'end' },
        { key: 'present', label: 'Present', align: 'end' },
        { key: 'halfDays', label: 'Half days', align: 'end' },
        { key: 'absent', label: 'Absent', align: 'end' },
        { key: 'leave', label: 'Leave', align: 'end' },
        { key: 'payable', label: 'Payable days', align: 'end' },
        { key: 'overtime', label: 'Approved overtime', align: 'end' },
      ],
      rows: out,
      totals: { contractor: `${out.length} contractor${out.length === 1 ? '' : 's'}`, workers: sum('workers'), present: sum('present'), halfDays: sum('halfDays'), absent: sum('absent'), leave: sum('leave'), payable: Math.round(sum('payable') * 10) / 10 },
      notes: ['Payable days are worked out exactly as for payroll (Month summary). Workers with no contractor are not included.'],
    };
  }

  throw Object.assign(new Error('No such report.'), { status: 404 });
}

/**
 * The month as a calendar: for each day, how many were present, on half day,
 * absent, on leave, and whether it was a holiday or (for everyone) a weekly
 * off. ClorTime's Attendance Calendar. Days to come carry only what is known
 * — leave already approved, holidays — and no absences.
 */
attendanceReportsRouter.get('/orgs/:orgId/attendance/calendar', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const days = daysOfMonth(month);
  /* A team-scoped role's calendar counts its own team (the Attendance dashboard's week). */
  const team = await teamScope(req);
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1], team.all ? {} : { employeeIds: team.ids });
  const q = (k: string) => String(req.query[k] || '').trim() || null;
  const people = ctx.people.filter(inScope({ departmentId: q('departmentId'), areaId: q('areaId'), contractorId: q('contractorId'), employeeId: null }));
  const out = days.map((date) => {
    const counts = { present: 0, halfDay: 0, absent: 0, leave: 0, holiday: 0, weeklyOff: 0, late: 0, employed: 0 };
    let holiday: string | null = null;
    for (const p of people) {
      if (!ctx.spanOf(p).includes(date)) continue;
      counts.employed += 1;
      const s = dayStatus(ctx, p, date);
      if (s === 'PRESENT') counts.present += 1;
      else if (s === 'HALF_DAY') counts.halfDay += 1;
      else if (s === 'ABSENT') counts.absent += 1;
      else if (s === 'ON_LEAVE') counts.leave += 1;
      else if (s === 'HOLIDAY') counts.holiday += 1;
      else if (s === 'WEEKLY_OFF') counts.weeklyOff += 1;
      if ((ctx.recordsOf.get(p.id)?.get(date)?.lateMinutes || 0) > 0) counts.late += 1;
      if (!holiday && ctx.holidaysFor(p as any).has(date)) holiday = ctx.holidays.find((h) => h.date === date && (!h.areaId || h.areaId === p.areaId))?.name || 'Holiday';
    }
    return { date, ...counts, holiday, off: counts.employed > 0 && counts.weeklyOff + counts.holiday === counts.employed, future: date > ctx.today };
  });
  res.json({ month, today: ctx.today, days: out });
});

/* Registered before /reports/:id, which would otherwise take "schedules" for a report name. */
// ---------------------------------------------------------------------------
// Scheduled reports: by e-mail, on their own (services/attendance/reportSchedules.ts)
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  reportId: z.string().min(1),
  params: z.record(z.string(), z.string()).optional(),
  cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional().nullable(),
  dayOfMonth: z.coerce.number().int().min(1).max(28).optional().nullable(),
  hour: z.coerce.number().int().min(0).max(23).default(7),
  recipients: z.string().min(3),
  enabled: z.boolean().optional(),
});
const publicSchedule = (s: any) => ({ ...s, params: JSON.parse(s.paramsJson || '{}'), reportName: REPORTS.find((r) => r.id === s.reportId)?.name || s.reportId, paramsJson: undefined });

attendanceReportsRouter.get('/orgs/:orgId/attendance/reports/schedules', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.reportSchedule.findMany({ where: { accountId, orgId }, orderBy: { createdAt: 'asc' } });
  res.json({ schedules: rows.map(publicSchedule) });
});

attendanceReportsRouter.post('/orgs/:orgId/attendance/reports/schedules', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the schedule.' });
  const b = parsed.data;
  if (!REPORTS.some((r) => r.id === b.reportId)) return res.status(400).json({ error: 'No such report.' });
  if (!b.recipients.split(/[,\s;]+/).some((x) => /.+@.+\..+/.test(x))) return res.status(400).json({ error: 'Give at least one e-mail address.' });
  const row = await peoplePrisma.reportSchedule.create({ data: { accountId, orgId, reportId: b.reportId, paramsJson: JSON.stringify(b.params || {}), cadence: b.cadence, dayOfWeek: b.cadence === 'WEEKLY' ? b.dayOfWeek || 1 : null, dayOfMonth: b.cadence === 'MONTHLY' ? b.dayOfMonth || 1 : null, hour: b.hour, recipients: b.recipients.trim(), enabled: b.enabled ?? true, createdByUserId: req.auth!.userId } });
  res.status(201).json({ schedule: publicSchedule(row) });
});

attendanceReportsRouter.put('/orgs/:orgId/attendance/reports/schedules/:id', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.reportSchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!s) return res.status(404).json({ error: 'No such schedule.' });
  const parsed = scheduleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the schedule.' });
  const b = sentOnly(parsed.data, req.body);
  const cadence = b.cadence || s.cadence;
  /* Whoever changes what a schedule sends, or to whom, becomes the one it reads as (the mail can name files). */
  const redirected = b.reportId !== undefined || b.params !== undefined || b.recipients !== undefined;
  const row = await peoplePrisma.reportSchedule.update({ where: { id: s.id }, data: { ...(redirected ? { createdByUserId: req.auth!.userId } : {}), ...(b.reportId ? { reportId: b.reportId } : {}), ...(b.params ? { paramsJson: JSON.stringify(b.params) } : {}), cadence, dayOfWeek: cadence === 'WEEKLY' ? b.dayOfWeek ?? s.dayOfWeek ?? 1 : null, dayOfMonth: cadence === 'MONTHLY' ? b.dayOfMonth ?? s.dayOfMonth ?? 1 : null, ...(b.hour !== undefined ? { hour: b.hour } : {}), ...(b.recipients ? { recipients: b.recipients.trim() } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}) } });
  res.json({ schedule: publicSchedule(row) });
});

attendanceReportsRouter.delete('/orgs/:orgId/attendance/reports/schedules/:id', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.reportSchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!s) return res.status(404).json({ error: 'No such schedule.' });
  await peoplePrisma.reportSchedule.delete({ where: { id: s.id } });
  res.json({ ok: true });
});

/** When a schedule ran, and whether it went. */
attendanceReportsRouter.get('/orgs/:orgId/attendance/reports/schedules/:id/runs', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.reportSchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!s) return res.status(404).json({ error: 'No such schedule.' });
  const runs = await peoplePrisma.reportRun.findMany({ where: { orgId, scheduleId: s.id }, orderBy: { at: 'desc' }, take: 50 });
  res.json({ runs });
});

/** Send it now, for the period it would cover if it ran this morning. */
attendanceReportsRouter.post('/orgs/:orgId/attendance/reports/schedules/:id/send', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.reportSchedule.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!s) return res.status(404).json({ error: 'No such schedule.' });
  /* Sent now, it reads as both the person pressing it and the one who set it up: only what both may open. */
  const docs = docAccessOfBoth(await docAccess(req), await docAccessOfUser(accountId, orgId, s.createdByUserId));
  res.json(await runSchedule(s, (reportId, acc, org, q) => build(reportId, acc, org, q, { docs })));
});

attendanceReportsRouter.get('/orgs/:orgId/attendance/reports', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const departments = await peoplePrisma.department.findMany({ where: { orgId: req.tenant!.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const employees = await peoplePrisma.employee.findMany({ where: { orgId: req.tenant!.orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  const [areas, contractors] = await Promise.all([
    peoplePrisma.area.findMany({ where: { orgId: req.tenant!.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.contractor.findMany({ where: { orgId: req.tenant!.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ reports: REPORTS, departments, employees, areas, contractors });
});

/*
 * Insights: the last few months at a glance (attendance and absenteeism
 * rates, late days, overtime), and this month by department and by person.
 * Built from the same month figures payroll uses (monthRows), so a number
 * here is the number in the Monthly Attendance Summary.
 */
attendanceReportsRouter.get('/orgs/:orgId/attendance/reports/insights', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const count = Math.min(12, Math.max(3, Number(req.query.months) || 6));
  const scope = { departmentId: String(req.query.departmentId || '') || null, areaId: String(req.query.areaId || '') || null, contractorId: String(req.query.contractorId || '') || null, employeeId: null };
  const scoped = scope.departmentId || scope.areaId || scope.contractorId;
  const ids = scoped ? new Set((await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, departmentId: true, areaId: true, contractorId: true } })).filter(inScope(scope)).map((e) => e.id)) : null;
  const current = today().slice(0, 7);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const [y, m] = current.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const rowsByMonth = new Map<string, any[]>();
  for (const month of months) {
    const rows = await monthRows(accountId, orgId, month);
    rowsByMonth.set(month, (ids ? rows.filter((r: any) => ids.has(r.employeeId)) : rows).filter((r: any) => r.totalDays - (r.notYet || 0) > 0));
  }
  const rates = (rows: any[]) => {
    const sum = (k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const present = sum('present');
    const half = sum('halfDays');
    const absent = sum('absent');
    const worked = present + half + absent;
    /* A month with nobody present at all is a month CLOR was not yet used (or
       the readers were down), not a month everyone was absent: no rate. */
    const measured = worked > 0 && present + half > 0;
    return {
      people: rows.length,
      attendanceRate: measured ? Math.round(((present + half / 2) / worked) * 1000) / 10 : null,
      absenteeismRate: measured ? Math.round((absent / worked) * 1000) / 10 : null,
      absentDays: absent,
      leaveDays: sum('leave'),
      lateDays: sum('lateCount'),
      overtimeHours: Math.round((sum('approvedOvertimeMinutes') / 60) * 10) / 10,
      lossOfPayDays: sum('lossOfPayDays'),
    };
  };
  const trend = months.map((month) => ({ month, ...rates(rowsByMonth.get(month)!) }));
  const now = rowsByMonth.get(current)!;
  const depts = new Map<string, any[]>();
  for (const r of now) {
    const k = r.department || 'No department';
    depts.set(k, [...(depts.get(k) || []), r]);
  }
  const byDepartment = [...depts.entries()].map(([department, rows]) => ({ department, ...rates(rows) })).sort((a, b) => (b.absenteeismRate ?? 0) - (a.absenteeismRate ?? 0));
  const person = (r: any) => ({ employeeId: r.employeeId, name: r.name, code: r.code, department: r.department });
  const mostLate = now.filter((r) => r.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount).slice(0, 5).map((r) => ({ ...person(r), days: r.lateCount }));
  const mostAbsent = now.filter((r) => r.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 5).map((r) => ({ ...person(r), days: r.absent }));
  res.json({
    months,
    current,
    trend,
    byDepartment,
    mostLate,
    mostAbsent,
    repeatLate: now.filter((r) => r.lateCount >= 3).length,
    definitions: {
      attendanceRate: 'Days present (a half day counts half) out of days present, half and absent. Leave, holidays and weekly offs are not counted.',
      absenteeismRate: 'Absent days out of days present, half and absent.',
    },
  });
});

attendanceReportsRouter.get('/orgs/:orgId/attendance/reports/:id', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const id = String(req.params.id);
    const report = await build(id, accountId, orgId, req.query, id === 'documents' ? { docs: await docAccess(req) } : {});
    res.json({ id, ...report, figures: figuresFor(id, report) });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

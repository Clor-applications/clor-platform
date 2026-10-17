import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { isWeeklyOff, istDate, istTime } from '../services/attendance/compute.js';
import { FACE, ONLINE_WINDOW_MS } from '../services/attendance/adms.js';
import { ISO_DATE, daysOfMonth, monthRows, periodContext, today } from './attendance.js';

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
const MAX_DAYS = 92;
const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.max(0, m) % 60).padStart(2, '0')}`;

type Col = { key: string; label: string; align?: 'end' | 'center' };
type Report = { title: string; period: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; notes?: string[] };

export const REPORTS = [
  { id: 'daily', name: 'Daily attendance', description: 'One day: everyone’s in and out, hours, late, overtime and status.', params: ['date', 'department'] },
  { id: 'monthly', name: 'Monthly summary', description: 'Per person: present, absent, leave, holidays, payable and loss-of-pay days.', params: ['month', 'department'] },
  { id: 'muster', name: 'Muster roll', description: 'Statutory register: each worker, each day of the month — P, A, HD, L, H, W.', params: ['month', 'department'] },
  { id: 'late-early', name: 'Late arrival and early departure', description: 'Days someone came late or left early.', params: ['from', 'to', 'department'] },
  { id: 'absent', name: 'Absent', description: 'Working days with no attendance, by date.', params: ['from', 'to', 'department'] },
  { id: 'overtime', name: 'Overtime register', description: 'Statutory register: overtime worked, approved or not, with totals per person.', params: ['from', 'to', 'department'] },
  { id: 'leave', name: 'Leave register', description: 'Statutory register: leave approved in the period, paid and unpaid.', params: ['from', 'to', 'department'] },
  { id: 'department', name: 'Department monthly', description: 'Per department: headcount, present, absent, late and overtime for a month.', params: ['month'] },
  { id: 'readers', name: 'Reader health', description: 'Each biometric reader: online, last seen, punches, failed commands.', params: [] },
  { id: 'biometrics', name: 'Biometric enrolment', description: 'Who has fingerprints and a face enrolled — and who has none.', params: [] },
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
  return { month, date, from, to, departmentId: String(q.departmentId || '').trim() || null };
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
  return 'ABSENT';
}

const inDept = (departmentId: string | null) => (p: { departmentId?: string | null }) => !departmentId || p.departmentId === departmentId;

async function build(id: string, accountId: string, orgId: string, q: any): Promise<Report> {
  const { month, date, from, to, departmentId } = params(q);

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
    const ids = departmentId ? new Set((await peoplePrisma.employee.findMany({ where: { orgId, departmentId }, select: { id: true } })).map((e) => e.id)) : null;
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
      peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true } }),
    ]);
    const type = new Map(types.map((t) => [t.id, t]));
    const rows = requests
      .filter((r) => people.has(r.employeeId))
      .map((r) => {
        const p = people.get(r.employeeId)!;
        return { code: p.code, name: p.name, department: p.department, type: type.get(r.leaveTypeId)?.name || '—', paid: type.get(r.leaveTypeId)?.isPaid === false ? 'No' : 'Yes', from: r.fromDate, to: r.toDate, days: r.days, reason: r.reason };
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
  const ctx = await periodContext(accountId, orgId, days[0], days[days.length - 1]);
  const departmentId = String(req.query.departmentId || '').trim() || null;
  const people = ctx.people.filter(inDept(departmentId));
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

attendanceReportsRouter.get('/orgs/:orgId/attendance/reports', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const departments = await peoplePrisma.department.findMany({ where: { orgId: req.tenant!.orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  res.json({ reports: REPORTS, departments });
});

attendanceReportsRouter.get('/orgs/:orgId/attendance/reports/:id', can(), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    res.json({ id: req.params.id, ...(await build(String(req.params.id), accountId, orgId, req.query)) });
  } catch (e: any) {
    if (e?.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

import { Router } from 'express';
import { pinMatcher, recomputeDeviceDay } from './iclock.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { computeDay, istInstant, istTime, type ShiftRule } from '../services/attendance/compute.js';
import { loadSchedule, resolveShift, toRule } from '../services/attendance/schedule.js';
import { explainDay } from '../services/attendance/explain.js';
import { dayDiff, daySnapshot, dayHistory } from '../services/attendance/history.js';
import { monthReadiness, scanDays, scanQueues } from '../services/attendance/readiness.js';
import { overrideFindings, rangedFindings, temporaryFindings } from '../services/attendance/conflicts.js';
import { CHAINS, hrMayDecide } from '../services/attendance/approvalChain.js';
import { confirmationsFor, decideOvertime, overtimeChain } from '../services/attendance/selfService.js';
import { balancesFor } from './leave.js';
import { earned as earnedBy } from '../services/attendance/leaveAccrual.js';
import {
  ISO_DATE,
  employeeIn,
  fail,
  isHoliday,
  myEmployee,
  reviewCorrection,
  sendError,
  today,
  withNames,
  writeDay,
} from './attendance.js';

/**
 * Attendance you can trust: the reads and the careful writes built on top of
 * the day engine — why a day says what it says, what is still unsettled,
 * whether a month is ready for payroll, what a schedule or rule change would
 * do before it is saved, and the evidence behind a person's days.
 *
 * Nothing here scores a day differently. Every figure comes from the same
 * functions the days are written with (compute.ts, schedule.ts, adms.ts).
 */
export const attendanceInsightsRouter = Router();
attendanceInsightsRouter.use('/orgs/:orgId/attendance', requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(ATTENDANCE_MODULE, action as any, resource);
const base = '/orgs/:orgId/attendance';
const isMonth = (m: string) => /^\d{4}-\d{2}$/.test(m);
const dateQ = (v: unknown) => {
  const s = String(v || '').trim();
  return ISO_DATE.test(s) ? s : null;
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Explain a day, and its history
// ---------------------------------------------------------------------------

/** Everything about one person's day, narrated from the rules that scored it. */
export async function explainFor(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null; name?: string }, date: string) {
  const [schedule, record, punches, clocks, holiday, corrections] = await Promise.all([
    loadSchedule(orgId, [employee.id]),
    peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId, employeeId: employee.id, shiftDate: date }, select: { at: true, kind: true, deviceId: true }, orderBy: { at: 'asc' } }),
    peoplePrisma.attendanceActivity.findMany({
      where: { orgId, employeeId: employee.id, at: { gte: istInstant(date, '00:00'), lt: istInstant(date, '12:00', 1) } },
      select: { at: true, kind: true, source: true },
      orderBy: { at: 'asc' },
    }),
    peoplePrisma.holiday.findFirst({
      where: {
        orgId, date, isOptional: false,
        AND: [
          { OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])] },
          { OR: [{ areaId: null }, ...(employee.areaId ? [{ areaId: employee.areaId }] : [])] },
        ],
      },
      select: { name: true },
    }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: employee.id, date }, orderBy: { createdAt: 'desc' } }),
  ]);
  const shift = resolveShift(schedule, employee.id, date);
  const deviceIds = [...new Set(punches.map((p) => p.deviceId))];
  const devices = deviceIds.length ? await peoplePrisma.attendanceDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }) : [];
  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  let leaveName: string | null = null;
  if (record?.leaveRequestId) {
    const lr = await peoplePrisma.leaveRequest.findFirst({ where: { id: record.leaveRequestId, orgId }, select: { leaveTypeId: true } });
    const lt = lr ? await peoplePrisma.leaveType.findFirst({ where: { id: lr.leaveTypeId, orgId }, select: { name: true, isPaid: true } }) : null;
    leaveName = lt ? `${lt.name}${lt.isPaid ? '' : ' (unpaid)'}` : null;
  }
  const points = [
    ...punches.map((p) => ({ at: p.at, kind: (p.kind as 'IN' | 'OUT' | null) ?? null, where: deviceName.get(p.deviceId) || 'a reader' })),
    ...clocks.filter((c) => c.source === 'CLOCK').map((c) => ({ at: c.at, kind: c.kind === 'OUT' ? ('OUT' as const) : ('IN' as const), where: 'the app' })),
  ];
  const explained = explainDay({
    date,
    shift: { name: shift.name, source: shift.source, rule: shift.rule },
    holidayName: holiday?.name || null,
    punches: points,
    record: record ? { ...record, leaveName } : null,
    today: today(),
  });
  const [history, locked] = await Promise.all([
    dayHistory(orgId, employee.id, date),
    peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month: date.slice(0, 7) } } }),
  ]);
  const actors = await namesOf(history.map((h) => h.userId).concat(record?.validatedByUserId ? [record.validatedByUserId] : []));
  return {
    date,
    employee: { id: employee.id, name: employee.name || null },
    shift: { name: shift.name, source: shift.source, ...shift.rule },
    holiday: holiday?.name || null,
    record: record ? { ...daySnapshot(record), id: record.id, validatedBy: record.validatedByUserId ? actors.get(record.validatedByUserId) || null : null, validatedAt: record.validatedAt } : null,
    punches: points.sort((a, b) => a.at.getTime() - b.at.getTime()).map((p) => ({ time: istTime(p.at), at: p.at, kind: p.kind, where: p.where })),
    steps: explained.steps,
    matchesRules: explained.matches,
    window: explained.window,
    corrections: corrections.map((c) => ({ id: c.id, status: c.status, in: c.checkIn ? istTime(c.checkIn) : null, out: c.checkOut ? istTime(c.checkOut) : null, reason: c.reason, reasonCode: c.reasonCode, createdAt: c.createdAt, reviewedAt: c.reviewedAt, reviewNote: c.reviewNote })),
    history: history.map((h) => ({ ...h, by: actorName(h.userId, actors) })),
    monthClosed: Boolean(locked),
  };
}

/** Display names for user ids, plus the automatic actors. */
async function namesOf(ids: string[]) {
  const real = [...new Set(ids.filter((id) => id && !['reader', 'system'].includes(id) && !id.startsWith('portal:')))];
  const users = real.length ? await platformPrisma.user.findMany({ where: { id: { in: real } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}
const actorName = (id: string, names: Map<string, string>) =>
  id === 'reader' ? 'Reader punches' : id === 'system' ? 'Clor' : id.startsWith('portal:') ? 'The employee (portal)' : names.get(id) || 'A user';

attendanceInsightsRouter.get(`${base}/days/explain`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const date = dateQ(req.query.date);
  if (!date) return res.status(400).json({ error: 'Which day? Dates are YYYY-MM-DD.' });
  try {
    const employee = await employeeIn(orgId, accountId, String(req.query.employeeId || ''));
    res.json(await explainFor(orgId, employee, date));
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceInsightsRouter.get(`${base}/me/days/explain`, can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const date = dateQ(req.query.date);
  if (!date) return res.status(400).json({ error: 'Which day? Dates are YYYY-MM-DD.' });
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    res.json(await explainFor(orgId, me, date));
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// The Exception Center
// ---------------------------------------------------------------------------

const EXC_STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'] as const;

attendanceInsightsRouter.get(`${base}/exceptions`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const t = today();
  const to = dateQ(req.query.to) || addDays(t, -1);
  let from = dateQ(req.query.from) || addDays(t, -14);
  if (from > to) from = to;
  /* A long range is a report, not a work queue. */
  if (addDays(from, 62) < to) from = addDays(to, -62);
  const show = String(req.query.show || 'open');

  const [{ people }, queues, states] = await Promise.all([
    scanDays(accountId, orgId, from, to),
    scanQueues(orgId, from, to),
    peoplePrisma.attendanceExceptionState.findMany({ where: { orgId } }),
  ]);
  const stateOf = new Map(states.map((s) => [s.key, s]));
  const items: any[] = [];
  const add = (x: { key: string; kind: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; employeeId?: string | null; employeeName?: string | null; date?: string | null; screen: string; ref?: string | null }) => items.push(x);

  for (const p of people) {
    for (const m of p.missingOut) add({ key: `MISSING_OUT:${m.id}`, kind: 'MISSING_OUT', severity: 'high', title: 'No check-out', detail: 'Checked in, never out. The day is not paid until corrected.', employeeId: p.employeeId, employeeName: p.name, date: m.date, screen: 'records', ref: m.id });
    for (const d of p.noRecord) add({ key: `NO_RECORD:${p.employeeId}:${d}`, kind: 'NO_RECORD', severity: 'medium', title: 'No attendance on a working day', detail: 'No punch, mark or leave. It counts as absent.', employeeId: p.employeeId, employeeName: p.name, date: d, screen: 'records' });
    for (const o of p.unapprovedOvertime) add({ key: `OVERTIME:${o.id}`, kind: 'OVERTIME', severity: 'low', title: 'Overtime to approve', detail: `${Math.floor(o.minutes / 60)}h ${String(o.minutes % 60).padStart(2, '0')}m, not paid until approved.`, employeeId: p.employeeId, employeeName: p.name, date: o.date, screen: 'records', ref: o.id });
  }
  const named = async (rows: any[]) => withNames(orgId, rows);
  for (const c of await named(queues.corrections)) add({ key: `CORRECTION:${c.id}`, kind: 'CORRECTION', severity: 'medium', title: 'Correction waiting', detail: c.reason, employeeId: c.employeeId, employeeName: c.employeeName, date: c.date, screen: 'requests', ref: c.id });
  for (const l of await named(queues.leave)) add({ key: `LEAVE:${l.id}`, kind: 'LEAVE', severity: 'medium', title: 'Leave waiting', detail: `${l.fromDate}${l.toDate !== l.fromDate ? ` to ${l.toDate}` : ''}, ${l.days} day${l.days === 1 ? '' : 's'}`, employeeId: l.employeeId, employeeName: l.employeeName, date: l.fromDate, screen: 'leaveRequests', ref: l.id });
  for (const u of queues.unmatched) add({ key: `UNMATCHED:${u.pin}`, kind: 'UNMATCHED', severity: 'high', title: `Reader ID ${u.pin} matches nobody`, detail: `${u._count._all} punch${u._count._all === 1 ? '' : 'es'} not on anyone’s days.`, date: u._min.at ? istInstantDate(u._min.at) : null, screen: 'unmatched', ref: u.pin });
  for (const a of queues.alerts) add({ key: `READER:${a.id}`, kind: 'READER', severity: a.severity === 'critical' || a.severity === 'high' ? 'high' : 'medium', title: a.title, detail: a.details, date: istInstantDate(a.openedAt), screen: 'readerHealth', ref: a.id });
  const clashNames = await named(queues.clashes.map((c) => ({ employeeId: c.employeeId })));
  queues.clashes.forEach((c, i) => add({ key: `SHIFT_CLASH:${c.a.id}:${c.b.id}`, kind: 'SHIFT_CLASH', severity: 'high', title: 'Two temporary schedules on the same days', detail: `Different shifts overlap from ${c.from}${c.to ? ` to ${c.to}` : ''}; which one applies is arbitrary.`, employeeId: c.employeeId, employeeName: clashNames[i]?.employeeName || null, date: c.from, screen: 'temporarySchedule' }));

  const assignees = await namesOf(states.map((s) => s.assigneeUserId || '').filter(Boolean));
  const withState = items.map((x) => {
    const s = stateOf.get(x.key);
    return {
      ...x,
      status: s?.status || 'OPEN',
      assigneeUserId: s?.assigneeUserId || null,
      assignee: s?.assigneeUserId ? assignees.get(s.assigneeUserId) || 'A user' : null,
      note: s?.note || null,
      updatedAt: s?.updatedAt || null,
    };
  });
  const visible = show === 'all' ? withState : withState.filter((x) => x.status === 'OPEN' || x.status === 'IN_PROGRESS');
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  visible.sort((a, b) => order[a.severity] - order[b.severity] || String(b.date || '').localeCompare(String(a.date || '')));
  const counts: Record<string, number> = {};
  for (const x of withState.filter((y) => y.status === 'OPEN' || y.status === 'IN_PROGRESS')) counts[x.kind] = (counts[x.kind] || 0) + 1;
  res.json({ from, to, counts, total: visible.length, exceptions: visible.slice(0, 1000), truncated: visible.length > 1000 });
});

const istInstantDate = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

attendanceInsightsRouter.post(`${base}/exceptions/state`, can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      key: z.string().trim().min(3).max(200),
      status: z.enum(EXC_STATUS).optional(),
      assignee: z.union([z.literal('me'), z.literal('none'), z.string().trim().min(1)]).optional(),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid change.' });
  const b = parsed.data;
  const kind = b.key.split(':')[0];
  let assigneeUserId: string | null | undefined;
  if (b.assignee === 'me') assigneeUserId = req.auth!.userId;
  else if (b.assignee === 'none') assigneeUserId = null;
  else if (b.assignee) {
    const member = await platformPrisma.user.findFirst({ where: { id: b.assignee, accountId } as any, select: { id: true } }).catch(() => null);
    if (!member) return res.status(400).json({ error: 'That person is not in this account.' });
    assigneeUserId = b.assignee;
  }
  const closing = b.status === 'RESOLVED' || b.status === 'IGNORED';
  const data: any = {
    ...(b.status ? { status: b.status } : {}),
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    ...(b.note !== undefined ? { note: b.note || null } : {}),
    ...(b.status ? (closing ? { resolvedAt: new Date(), resolvedByUserId: req.auth!.userId } : { resolvedAt: null, resolvedByUserId: null }) : {}),
  };
  const row = await peoplePrisma.attendanceExceptionState.upsert({
    where: { orgId_key: { orgId, key: b.key } },
    create: { accountId, orgId, key: b.key, kind, status: b.status || 'OPEN', assigneeUserId: assigneeUserId ?? null, note: b.note || null, ...(closing ? { resolvedAt: new Date(), resolvedByUserId: req.auth!.userId } : {}) },
    update: data,
  });
  res.json({ state: row });
});

// ---------------------------------------------------------------------------
// Month readiness (Payroll readiness) and snapshots
// ---------------------------------------------------------------------------

attendanceInsightsRouter.get(`${base}/months/:month/readiness`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = String(req.params.month);
  if (!isMonth(month)) return res.status(400).json({ error: 'Months are YYYY-MM.' });
  const r = await monthReadiness(accountId, orgId, month);
  const by = await namesOf(r.snapshots.map((s) => s.createdByUserId));
  res.json({ ...r, snapshots: r.snapshots.map((s) => ({ ...s, by: actorName(s.createdByUserId, by) })), confirmations: await confirmationsFor(orgId, month) });
});

attendanceInsightsRouter.get(`${base}/months/:month/snapshots/:version`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const snap = await peoplePrisma.attendanceMonthSnapshot.findUnique({ where: { orgId_month_version: { orgId, month: String(req.params.month), version: Number(req.params.version) || 0 } } });
  if (!snap) return res.status(404).json({ error: 'No such snapshot.' });
  res.json({ month: snap.month, version: snap.version, createdAt: snap.createdAt, rows: JSON.parse(snap.rowsJson), readiness: JSON.parse(snap.readinessJson) });
});

// ---------------------------------------------------------------------------
// Schedule changes, checked before they are saved
// ---------------------------------------------------------------------------

attendanceInsightsRouter.post(`${base}/schedule/check`, can(PermissionAction.VIEW, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      kind: z.enum(['EMPLOYEE', 'TEMPORARY', 'DEPARTMENT']),
      employeeIds: z.array(z.string()).max(2000).optional(),
      departmentId: z.string().optional().nullable(),
      shiftId: z.string().min(1),
      from: z.string().regex(ISO_DATE),
      to: z.string().regex(ISO_DATE).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the dates and shift.' });
  const b = parsed.data;
  const to = b.to || null;
  if (to && to < b.from) return res.status(400).json({ error: 'The end is before the start.' });
  const shifts = new Map((await peoplePrisma.shift.findMany({ where: { orgId, accountId } })).map((s) => [s.id, s]));
  const shift = shifts.get(b.shiftId);
  if (!shift) return res.status(404).json({ error: 'No such shift.' });
  const next = { shiftId: b.shiftId, from: b.from, to };
  const nameOf = (id: string) => shifts.get(id)?.name || 'a shift';
  const describe = (f: any) => ({ level: f.level, shift: nameOf(f.existing.shiftId), existingFrom: f.existing.from, existingTo: f.existing.to, from: f.overlapFrom, to: f.overlapTo });
  const crosses = shift.endTime <= shift.startTime;

  if (b.kind === 'DEPARTMENT') {
    if (!b.departmentId) return res.status(400).json({ error: 'Choose a department.' });
    const existing = await peoplePrisma.departmentSchedule.findMany({ where: { orgId, departmentId: b.departmentId } });
    const findings = rangedFindings(next, existing.map((e) => ({ id: e.id, shiftId: e.shiftId, from: e.effectiveFrom, to: e.effectiveTo })));
    return res.json({ shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, crossesMidnight: crosses }, conflicts: 0, people: [{ employeeId: null, name: 'The department', findings: findings.map(describe) }].filter((p) => p.findings.length) });
  }
  const ids = (b.employeeIds || []).slice(0, 2000);
  if (!ids.length) return res.status(400).json({ error: 'Choose the people.' });
  const [assignments, temporaries, people] = await Promise.all([
    peoplePrisma.shiftAssignment.findMany({ where: { orgId, employeeId: { in: ids } } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, employeeId: { in: ids } } }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const out: any[] = [];
  let conflicts = 0;
  for (const p of people) {
    const mineA = assignments.filter((a) => a.employeeId === p.id).map((a) => ({ id: a.id, shiftId: a.shiftId, from: a.effectiveFrom, to: a.effectiveTo }));
    const mineT = temporaries.filter((t) => t.employeeId === p.id).map((t) => ({ id: t.id, shiftId: t.shiftId, from: t.fromDate, to: t.toDate }));
    const findings = b.kind === 'TEMPORARY' ? temporaryFindings(next, mineT) : [...rangedFindings(next, mineA), ...overrideFindings(next, mineT)];
    conflicts += findings.filter((f) => f.level === 'CONFLICT').length;
    if (findings.length) out.push({ employeeId: p.id, name: p.name, findings: findings.map(describe) });
  }
  res.json({ shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, crossesMidnight: crosses }, conflicts, people: out });
});

// ---------------------------------------------------------------------------
// Bulk changes, with a preview first
// ---------------------------------------------------------------------------

const BULK_OPS = ['SET_OUT_SHIFT_END', 'SET_STATUS', 'APPROVE_OVERTIME'] as const;

attendanceInsightsRouter.post(`${base}/records/bulk`, can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      ids: z.array(z.string()).min(1, 'Choose the days.').max(500, 'Up to 500 days at a time.'),
      operation: z.enum(BULK_OPS),
      status: z.enum(['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF']).optional().nullable(),
      reason: z.string().trim().min(3, 'Say why, for the history.').max(300),
      preview: z.boolean().default(true),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid change.' });
  const b = parsed.data;
  if (b.operation === 'SET_STATUS' && !b.status) return res.status(400).json({ error: 'Choose the status to set.' });
  if (b.operation === 'APPROVE_OVERTIME') {
    /* Overtime approval is an Approve right, as one day's approval is. */
    const ok = await requirePermissionNow(req, PermissionAction.APPROVE, R.records);
    if (!ok) return res.status(403).json({ error: 'Approving overtime needs approve rights on attendance records.' });
  }
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, id: { in: b.ids } } });
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(records.map((r) => r.employeeId))] } }, select: { id: true, name: true, branchId: true, areaId: true } })).map((p) => [p.id, p]));
  const schedule = await loadSchedule(orgId, [...people.keys()]);
  const locks = new Set((await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } })).map((l) => l.month));

  const plan = [] as Array<{ id: string; employeeId: string; name: string; date: string; ok: boolean; error?: string; changes: ReturnType<typeof dayDiff>; checkOut?: Date | null }>;
  for (const r of records) {
    const person = people.get(r.employeeId);
    const row = { id: r.id, employeeId: r.employeeId, name: person?.name || '—', date: r.date, ok: true, changes: [] as ReturnType<typeof dayDiff> } as (typeof plan)[number];
    if (locks.has(r.date.slice(0, 7))) { plan.push({ ...row, ok: false, error: `${r.date.slice(0, 7)} is closed.` }); continue; }
    const rule = resolveShift(schedule, r.employeeId, r.date).rule;
    if (b.operation === 'APPROVE_OVERTIME') {
      if (!r.overtimeMinutes) { plan.push({ ...row, ok: false, error: 'No overtime on this day.' }); continue; }
      row.changes = dayDiff(daySnapshot(r), daySnapshot({ ...r, overtimeApproved: true }));
    } else if (b.operation === 'SET_OUT_SHIFT_END') {
      if (!r.checkIn) { plan.push({ ...row, ok: false, error: 'No check-in to end.' }); continue; }
      if (r.checkOut) { plan.push({ ...row, ok: false, error: 'Already has a check-out.' }); continue; }
      const crosses = rule.endTime <= rule.startTime;
      const out = istInstant(r.date, rule.endTime, crosses ? 1 : 0);
      if (out <= r.checkIn) { plan.push({ ...row, ok: false, error: 'The shift ends before the check-in.' }); continue; }
      const holiday = await isHoliday(orgId, r.date, person?.branchId || null, person?.areaId || null);
      const c = computeDay({ date: r.date, shift: rule, checkIn: r.checkIn, checkOut: out, isHoliday: holiday });
      row.checkOut = out;
      row.changes = dayDiff(daySnapshot(r), daySnapshot({ ...r, checkOut: out, ...c, source: 'MANUAL', validated: false, overtimeApproved: false }));
    } else {
      if (r.checkIn) { plan.push({ ...row, ok: false, error: 'Has a check-in; set its times instead.' }); continue; }
      row.changes = dayDiff(daySnapshot(r), daySnapshot({ ...r, status: b.status!, source: 'MANUAL', validated: false }));
    }
    plan.push(row);
  }
  for (const id of b.ids) if (!records.some((r) => r.id === id)) plan.push({ id, employeeId: '', name: '—', date: '', ok: false, error: 'No such day.', changes: [] });

  if (b.preview) return res.json({ preview: true, ready: plan.filter((p) => p.ok).length, skipped: plan.filter((p) => !p.ok).length, rows: plan.map(({ checkOut, ...p }) => p) });

  let applied = 0;
  const results: any[] = [];
  for (const p of plan) {
    if (!p.ok) { results.push({ id: p.id, ok: false, error: p.error }); continue; }
    const r = records.find((x) => x.id === p.id)!;
    try {
      if (b.operation === 'APPROVE_OVERTIME') {
        const updated = await peoplePrisma.attendanceRecord.update({ where: { id: r.id }, data: { overtimeApproved: true } });
        const { logDayChange } = await import('../services/attendance/history.js');
        await logDayChange({ accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: r.id, action: 'BULK', before: r, after: updated, userId: req.auth!.userId, reason: b.reason });
      } else {
        const person = people.get(r.employeeId)!;
        await writeDay({
          accountId, orgId, userId: req.auth!.userId, employee: person, date: r.date,
          checkIn: r.checkIn, checkOut: b.operation === 'SET_OUT_SHIFT_END' ? p.checkOut! : r.checkOut,
          statusOverride: b.operation === 'SET_STATUS' ? b.status! : null,
          source: 'MANUAL', note: r.note, reason: b.reason, historyAction: 'BULK',
        });
      }
      applied += 1;
      results.push({ id: p.id, ok: true });
    } catch (e: any) {
      results.push({ id: p.id, ok: false, error: e?.message || 'Not changed.' });
    }
  }
  res.json({ preview: false, applied, failed: results.filter((x) => !x.ok).length, results: results.filter((x) => !x.ok) });
});

/** A permission check inside a handler, for an action that depends on the body. */
async function requirePermissionNow(req: any, action: string, resource: string) {
  return new Promise<boolean>((resolve) => {
    const mw = requirePermission(ATTENDANCE_MODULE, action as any, resource);
    const fakeRes: any = { status: () => ({ json: () => resolve(false) }), json: () => resolve(false) };
    Promise.resolve(mw(req, fakeRes, () => resolve(true))).catch(() => resolve(false));
  });
}

/** Approve or reject several corrections at once; each goes through the same checks as one. */
attendanceInsightsRouter.post(`${base}/requests/bulk-review`, can(PermissionAction.APPROVE, R.requests), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : [];
  const approve = req.body?.approve !== false;
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  if (!ids.length) return res.status(400).json({ error: 'Choose the requests.' });
  const rows = await peoplePrisma.attendanceRequest.findMany({ where: { accountId, orgId, id: { in: ids } } });
  const results: any[] = [];
  for (const r of rows) {
    if (r.status !== 'PENDING') { results.push({ id: r.id, ok: false, error: `Already ${r.status.toLowerCase()}.` }); continue; }
    if (approve) {
      const turn = await hrMayDecide(orgId, 'correction', r);
      if (!turn.ok) { results.push({ id: r.id, ok: false, error: turn.error }); continue; }
    }
    try {
      await reviewCorrection(accountId, orgId, r, approve, req.auth!.userId, note);
      results.push({ id: r.id, ok: true });
    } catch (e: any) {
      results.push({ id: r.id, ok: false, error: e?.message || 'Not done.' });
    }
  }
  res.json({ done: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results: results.filter((x) => !x.ok) });
});

// ---------------------------------------------------------------------------
// Rules: versions, and a preview of a change before it is saved
// ---------------------------------------------------------------------------

attendanceInsightsRouter.get(`${base}/rules/versions`, can(PermissionAction.VIEW, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.attendanceRuleVersion.findMany({ where: { orgId }, orderBy: { version: 'desc' }, take: 100 });
  const by = await namesOf(rows.map((r) => r.changedByUserId));
  res.json({ versions: rows.map((r) => ({ version: r.version, at: r.createdAt, by: actorName(r.changedByUserId, by), ...JSON.parse(r.rulesJson) })) });
});

/**
 * What a change to a shift's scoring would do to days already recorded, without
 * saving anything: each affected day before and after. Only days the rules
 * decide (reader, app, manual, correction, import) are compared; leave and
 * closed months are listed as unaffected, as recalculation would leave them.
 */
attendanceInsightsRouter.post(`${base}/rules/simulate`, can(PermissionAction.VIEW, R.shifts), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const num = (lo: number, hi: number) => z.coerce.number().int().min(lo).max(hi).optional();
  const parsed = z
    .object({
      shiftId: z.string().min(1),
      changes: z.object({
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        breakMinutes: num(0, 600),
        graceMinutes: num(0, 240),
        earlyOutGraceMinutes: num(0, 240),
        halfDayMinutes: num(0, 1440),
        fullDayMinutes: num(1, 1440),
        overtimeAfterMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
      }),
      from: z.string().regex(ISO_DATE),
      to: z.string().regex(ISO_DATE),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the change.' });
  const b = parsed.data;
  if (b.to < b.from) return res.status(400).json({ error: 'The end is before the start.' });
  if (addDays(b.from, 62) < b.to) return res.status(400).json({ error: 'Preview up to 62 days at a time.' });
  const shift = await peoplePrisma.shift.findFirst({ where: { id: b.shiftId, orgId, accountId } });
  if (!shift) return res.status(404).json({ error: 'No such shift.' });
  const current: ShiftRule = toRule(shift);
  const proposed: ShiftRule = { ...current, ...Object.fromEntries(Object.entries(b.changes).filter(([, v]) => v !== undefined)) } as ShiftRule;
  if (proposed.halfDayMinutes > proposed.fullDayMinutes) return res.status(400).json({ error: 'A half day cannot be longer than a full day.' });
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, accountId, shiftId: shift.id, date: { gte: b.from, lte: b.to } } });
  const locks = new Set((await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } })).map((l) => l.month));
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(records.map((r) => r.employeeId))] } }, select: { id: true, name: true, branchId: true, areaId: true } })).map((p) => [p.id, p]));
  const holidayRows = await peoplePrisma.holiday.findMany({ where: { orgId, isOptional: false, date: { gte: b.from, lte: b.to } }, select: { date: true, branchId: true, areaId: true } });
  const holidayFor = (date: string, p?: { branchId: string | null; areaId: string | null }) =>
    holidayRows.some((h) => h.date === date && (!h.branchId || h.branchId === p?.branchId) && (!h.areaId || h.areaId === p?.areaId));
  const changed: any[] = [];
  let compared = 0;
  let skipped = 0;
  const tally = { status: 0, late: 0, overtime: 0 };
  for (const r of records) {
    if (!r.checkIn || !['DEVICE', 'CLOCK', 'MANUAL', 'REQUEST', 'IMPORT'].includes(r.source) || locks.has(r.date.slice(0, 7))) { skipped += 1; continue; }
    compared += 1;
    const p = people.get(r.employeeId);
    const isHol = holidayFor(r.date, p as any);
    let now, then;
    try {
      now = computeDay({ date: r.date, shift: current, checkIn: r.checkIn, checkOut: r.checkOut, isHoliday: isHol });
      then = computeDay({ date: r.date, shift: proposed, checkIn: r.checkIn, checkOut: r.checkOut, isHoliday: isHol });
    } catch {
      continue;
    }
    const diff: any = {};
    if (now.status !== then.status) { diff.status = [now.status, then.status]; tally.status += 1; }
    if (now.lateMinutes !== then.lateMinutes) { diff.lateMinutes = [now.lateMinutes, then.lateMinutes]; tally.late += 1; }
    if (now.overtimeMinutes !== then.overtimeMinutes) { diff.overtimeMinutes = [now.overtimeMinutes, then.overtimeMinutes]; tally.overtime += 1; }
    if (now.workedMinutes !== then.workedMinutes) diff.workedMinutes = [now.workedMinutes, then.workedMinutes];
    if (now.earlyOutMinutes !== then.earlyOutMinutes) diff.earlyOutMinutes = [now.earlyOutMinutes, then.earlyOutMinutes];
    if (Object.keys(diff).length) changed.push({ employeeId: r.employeeId, name: p?.name || '—', date: r.date, in: istTime(r.checkIn), out: r.checkOut ? istTime(r.checkOut) : null, ...diff });
  }
  changed.sort((a, b2) => a.date.localeCompare(b2.date) || a.name.localeCompare(b2.name));
  res.json({ shift: { id: shift.id, name: shift.name }, current, proposed, from: b.from, to: b.to, compared, skipped, changedDays: changed.length, tally, days: changed.slice(0, 500) });
});

// ---------------------------------------------------------------------------
// Reader ID mapping audit
// ---------------------------------------------------------------------------

const normalName = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

attendanceInsightsRouter.get(`${base}/mapping-audit`, can(PermissionAction.VIEW, R.devices), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [employees, deviceUsers, devices, unmatchedRows, sited, areas, match] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { accountId, orgId }, select: { id: true, name: true, code: true, devicePin: true, status: true, dateOfLeaving: true, attendanceRequired: true, areaId: true } }),
    peoplePrisma.deviceUser.findMany({ where: { orgId }, select: { deviceId: true, pin: true, name: true } }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true, areaId: true } }),
    peoplePrisma.devicePunch.groupBy({ by: ['pin', 'deviceId'], where: { orgId, employeeId: null }, _count: { _all: true }, _max: { at: true } }),
    peoplePrisma.readerIdAtSite.findMany({ where: { orgId }, select: { employeeId: true } }),
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
    pinMatcher(orgId),
  ]);
  const deviceName = new Map(devices.map((d) => [d.id, d.name]));
  const areaOf = new Map(devices.map((d) => [d.id, d.areaId]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const byId = new Map(employees.map((e) => [e.id, e]));
  /* Who a reader user is, as that reader's site sees it (a site ID there, else the company ID). */
  const whoOn = (deviceId: string, pin: string) => {
    const m = match(pin, areaOf.get(deviceId));
    return m ? byId.get(m.id) || null : null;
  };
  const t = today();
  const stale = deviceUsers
    .map((u) => ({ u, e: whoOn(u.deviceId, u.pin) }))
    .filter(({ e }) => e && (e.status === 'LEFT' || (e.dateOfLeaving && e.dateOfLeaving < t)))
    .map(({ u, e }) => ({ reader: deviceName.get(u.deviceId) || 'Reader', deviceId: u.deviceId, pin: u.pin, nameOnReader: u.name || null, employeeId: e!.id, employee: e!.name, left: e!.dateOfLeaving }));
  const orphan = deviceUsers
    .filter((u) => !whoOn(u.deviceId, u.pin))
    .map((u) => ({ reader: deviceName.get(u.deviceId) || 'Reader', deviceId: u.deviceId, pin: u.pin, nameOnReader: u.name || null }));
  const hasSiteId = new Set(sited.map((x) => x.employeeId));
  const noPin = employees.filter((e) => !e.devicePin && !hasSiteId.has(e.id) && e.status !== 'LEFT' && e.attendanceRequired !== false).map((e) => ({ employeeId: e.id, name: e.name, code: e.code }));
  const unpinned = employees.filter((e) => !e.devicePin && e.status !== 'LEFT');
  /* One line per ID per site: 105 at the depot and 105 at the factory may be two people. */
  const groups = new Map<string, { pin: string; areaId: string | null; punches: number; lastAt: Date | null; deviceIds: Set<string> }>();
  for (const u of unmatchedRows) {
    const areaId = areaOf.get(u.deviceId) || null;
    const k = `${areaId || ''}|${u.pin}`;
    const g = groups.get(k) || { pin: u.pin, areaId, punches: 0, lastAt: null, deviceIds: new Set<string>() };
    g.punches += u._count._all;
    if (u._max.at && (!g.lastAt || u._max.at > g.lastAt)) g.lastAt = u._max.at;
    g.deviceIds.add(u.deviceId);
    groups.set(k, g);
  }
  const suggestions = [...groups.values()].map((u) => {
    const onReader = deviceUsers.find((d) => u.deviceIds.has(d.deviceId) && String(d.pin).trim() === String(u.pin).trim()) || deviceUsers.find((d) => String(d.pin).trim() === String(u.pin).trim());
    const n = normalName(onReader?.name || '');
    const here = unpinned.filter((e) => !u.areaId || !e.areaId || e.areaId === u.areaId);
    const byCode = here.find((e) => e.code && String(e.code).replace(/^0+/, '') === String(u.pin).replace(/^0+/, ''));
    const byName = n.length >= 3 ? here.find((e) => normalName(e.name) === n || normalName(e.name).startsWith(n) || n.startsWith(normalName(e.name))) : null;
    const s = byCode || byName || null;
    return {
      pin: u.pin, areaId: u.areaId, areaName: u.areaId ? areaName.get(u.areaId) || null : null, punches: u.punches, lastAt: u.lastAt, nameOnReader: onReader?.name || null,
      suggestion: s ? { employeeId: s.id, name: s.name, code: s.code, why: byCode ? 'Employee code matches the reader ID' : 'Name on the reader matches' } : null,
    };
  });
  res.json({ stale, orphan, noPin, unmatched: suggestions, siteIds: sited.length, counts: { stale: stale.length, orphan: orphan.length, noPin: noPin.length, unmatched: suggestions.length } });
});

// ---------------------------------------------------------------------------
// Leave balance, explained
// ---------------------------------------------------------------------------

export async function leaveExplain(accountId: string, orgId: string, employeeId: string, leaveTypeId: string, year: number) {
  const [type, person, requests, allocation] = await Promise.all([
    peoplePrisma.leaveType.findFirst({ where: { id: leaveTypeId, accountId, orgId } }),
    peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, name: true, dateOfJoining: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId, leaveTypeId, fromDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } }, orderBy: { fromDate: 'asc' } }),
    peoplePrisma.leaveAllocation.findFirst({ where: { orgId, employeeId, leaveTypeId, year } }),
  ]);
  if (!type || !person) throw fail(404, 'No such leave type or person.');
  const { balances } = await balancesFor(accountId, orgId, [employeeId], year);
  const bal = balances.get(employeeId)?.get(leaveTypeId) as any;
  const t = today();
  const asOf = Number(t.slice(0, 4)) > year ? `${year}-12-31` : t;
  const months: Array<{ month: string; earned: number; total: number }> = [];
  if (type.isPaid && !allocation) {
    let prev = 0;
    for (let m = 1; m <= 12; m += 1) {
      const mm = `${year}-${String(m).padStart(2, '0')}`;
      if (`${mm}-01` > asOf) break;
      const total = earnedBy(type as any, year, person.dateOfJoining || null, `${mm}-28`);
      if (total !== prev || m === 1) months.push({ month: mm, earned: Math.round((total - prev) * 100) / 100, total });
      prev = total;
    }
  }
  const lines = [] as Array<{ kind: string; label: string; days: number; date?: string; status?: string }>;
  if (allocation) lines.push({ kind: 'allocation', label: `Set by HR for ${year}`, days: allocation.days });
  else {
    if (bal?.carriedIn) lines.push({ kind: 'carried', label: `Carried in from ${year - 1}`, days: bal.carriedIn });
    if (bal?.earned != null) lines.push({ kind: 'earned', label: type.accrual === 'MONTHLY' ? `Earned so far (${type.annualDays} a year, monthly)` : `This year's entitlement (${type.annualDays} days)`, days: bal.earned });
  }
  for (const r of requests.filter((x) => x.status === 'APPROVED')) lines.push({ kind: 'taken', label: `Taken ${r.fromDate}${r.toDate !== r.fromDate ? ` to ${r.toDate}` : ''}`, days: -r.days, date: r.fromDate, status: r.status });
  for (const r of requests.filter((x) => x.status === 'PENDING')) lines.push({ kind: 'pending', label: `Waiting ${r.fromDate}${r.toDate !== r.fromDate ? ` to ${r.toDate}` : ''}`, days: -r.days, date: r.fromDate, status: r.status });
  return {
    employee: { id: person.id, name: person.name },
    type: { id: type.id, name: type.name, isPaid: type.isPaid, accrual: type.accrual, annualDays: type.annualDays, carryForwardMax: type.carryForwardMax, prorateForJoiners: type.prorateForJoiners },
    year,
    asOf,
    balance: bal || null,
    lines,
    months,
    rules: [
      type.accrual === 'MONTHLY' ? `${type.annualDays} days a year, earned a twelfth at the start of each month.` : `${type.annualDays} days a year from 1 January.`,
      type.prorateForJoiners ? 'Joiners get the months left in their first year (joining by the 15th counts that month).' : null,
      type.carryForwardMax ? `Up to ${type.carryForwardMax} unused days carry into the next year.` : 'Unused days do not carry forward.',
      allocation ? 'HR has set this year’s days by hand, which replaces the earned days and any carry-in.' : null,
    ].filter(Boolean),
  };
}

attendanceInsightsRouter.get(`${base}/leave/explain`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const year = Number(req.query.year) || Number(today().slice(0, 4));
    res.json(await leaveExplain(accountId, orgId, String(req.query.employeeId || ''), String(req.query.leaveTypeId || ''), year));
  } catch (e) {
    return sendError(res, e);
  }
});

attendanceInsightsRouter.get(`${base}/me/leave/explain`, can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const year = Number(req.query.year) || Number(today().slice(0, 4));
    res.json(await leaveExplain(accountId, orgId, me.id, String(req.query.leaveTypeId || ''), year));
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Evidence: everything behind one person's days, for a dispute or an inspector
// ---------------------------------------------------------------------------

attendanceInsightsRouter.get(`${base}/evidence`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const from = dateQ(req.query.from);
  const to = dateQ(req.query.to);
  if (!from || !to || to < from) return res.status(400).json({ error: 'Choose a period (from and to, YYYY-MM-DD).' });
  if (addDays(from, 92) < to) return res.status(400).json({ error: 'Up to 92 days at a time.' });
  try {
    const employee = await employeeIn(orgId, accountId, String(req.query.employeeId || ''));
    const fromAt = istInstant(from, '00:00');
    const toAt = istInstant(to, '12:00', 1);
    const [person, records, punches, clocks, requests, leave, history, locks, snapshots, audit] = await Promise.all([
      peoplePrisma.employee.findFirst({ where: { id: employee.id }, select: { name: true, code: true, devicePin: true, department: true, dateOfJoining: true, dateOfLeaving: true } }),
      peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: employee.id, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
      peoplePrisma.devicePunch.findMany({ where: { orgId, employeeId: employee.id, at: { gte: fromAt, lt: toAt } }, orderBy: { at: 'asc' }, select: { at: true, kind: true, deviceId: true, pin: true, shiftDate: true, latitude: true, longitude: true } }),
      peoplePrisma.attendanceActivity.findMany({ where: { orgId, employeeId: employee.id, at: { gte: fromAt, lt: toAt } }, orderBy: { at: 'asc' } }),
      peoplePrisma.attendanceRequest.findMany({ where: { orgId, employeeId: employee.id, date: { gte: from, lte: to } }, orderBy: { createdAt: 'asc' } }),
      peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: employee.id, fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: 'asc' } }),
      peoplePrisma.attendanceRecordHistory.findMany({ where: { orgId, employeeId: employee.id, date: { gte: from, lte: to } }, orderBy: { at: 'asc' } }),
      peoplePrisma.attendanceMonthLock.findMany({ where: { orgId, month: { gte: from.slice(0, 7), lte: to.slice(0, 7) } } }),
      peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month: { gte: from.slice(0, 7), lte: to.slice(0, 7) } }, select: { month: true, version: true, createdAt: true } }),
      platformPrisma.auditLog
        .findMany({ where: { orgId, createdAt: { gte: fromAt, lt: toAt }, OR: [{ entityId: employee.id }, { metadata: { contains: employee.id } }] }, orderBy: { createdAt: 'asc' }, take: 1000 })
        .catch(() => [] as any[]),
    ]);
    const devices = new Map((await peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const actors = await namesOf([
      ...history.map((h) => h.userId),
      ...requests.flatMap((r) => [r.requestedByUserId, r.reviewedByUserId || '', r.managerApprovedById || '']),
      ...records.map((r) => r.validatedByUserId || ''),
      ...leave.flatMap((l: any) => [l.requestedByUserId || '', l.reviewedByUserId || '']),
      ...(audit as any[]).map((a) => a.createdByUserId || ''),
    ].filter(Boolean));
    const who = (id?: string | null) => (id ? actorName(id, actors) : null);
    res.json({
      generatedAt: new Date(),
      period: { from, to },
      employee: { id: employee.id, ...person },
      days: records.map((r) => ({ date: r.date, ...daySnapshot(r), validatedBy: who(r.validatedByUserId), validatedAt: r.validatedAt })),
      punches: [
        ...punches.map((p: any) => ({ time: p.at, local: `${istInstantDate(p.at)} ${istTime(p.at)}`, kind: p.kind || null, source: devices.get(p.deviceId) || 'Reader', readerId: p.pin, shiftDate: p.shiftDate, latitude: p.latitude ?? null, longitude: p.longitude ?? null })),
        ...clocks.map((c: any) => ({ time: c.at, local: `${istInstantDate(c.at)} ${istTime(c.at)}`, kind: c.kind, source: c.source === 'CLOCK' ? 'App' : c.source, readerId: null, shiftDate: null, latitude: c.latitude ?? null, longitude: c.longitude ?? null })),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
      corrections: requests.map((r) => ({ date: r.date, requested: { in: r.checkIn ? istTime(r.checkIn) : null, out: r.checkOut ? istTime(r.checkOut) : null }, before: { in: r.beforeCheckIn ? istTime(r.beforeCheckIn) : null, out: r.beforeCheckOut ? istTime(r.beforeCheckOut) : null, status: r.beforeStatus }, reason: r.reason, reasonCode: r.reasonCode, status: r.status, askedBy: who(r.requestedByUserId), askedAt: r.createdAt, managerApprovedBy: who(r.managerApprovedById), managerApprovedAt: r.managerApprovedAt, decidedBy: who(r.reviewedByUserId), decidedAt: r.reviewedAt, note: r.reviewNote })),
      leave: leave.map((l: any) => ({ from: l.fromDate, to: l.toDate, days: l.days, status: l.status, reason: l.reason, decidedBy: who(l.reviewedByUserId), decidedAt: l.reviewedAt || null })),
      history: history.map((h) => ({ date: h.date, at: h.at, action: h.action, by: who(h.userId), reason: h.reason, changes: dayDiff(h.beforeJson ? JSON.parse(h.beforeJson) : null, h.afterJson ? JSON.parse(h.afterJson) : null) })),
      monthsClosed: locks.map((l) => ({ month: l.month, at: l.lockedAt, by: who(l.lockedByUserId) })),
      snapshots,
      audit: (audit as any[]).map((a) => ({ at: a.createdAt, action: a.action, message: a.message, by: who(a.createdByUserId) })),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// One reader's timeline: batches, commands, logs and alerts in one stream
// ---------------------------------------------------------------------------

const commandWord = (c: string) => {
  const t = String(c || '').toUpperCase();
  if (/DATA (UPDATE|DELETE) (FINGERTMP|FACE|BIODATA)/.test(t)) return /DELETE/.test(t) ? 'Remove a fingerprint or face' : 'Send a fingerprint or face';
  if (/DATA UPDATE USERINFO/.test(t)) return 'Add or update a person';
  if (/DATA DELETE USERINFO/.test(t)) return 'Remove a person';
  if (/DATA QUERY/.test(t)) return 'Read data from the reader';
  if (/SET OPTION|DATETIME/.test(t)) return 'Set the time or an option';
  if (/REBOOT/.test(t)) return 'Restart';
  if (/CLEAR/.test(t)) return 'Clear data';
  if (/CHECK|INFO/.test(t)) return 'Check in with the server';
  return String(c || '').split(/\s+/).slice(0, 3).join(' ') || 'Command';
};

attendanceInsightsRouter.get(`${base}/devices/:id/timeline`, can(PermissionAction.VIEW, R.devices), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const since = new Date(Date.now() - days * 86_400_000);
  const [runs, commands, logs, alerts, pending] = await Promise.all([
    peoplePrisma.ingestRun.findMany({ where: { orgId, deviceId: device.id, at: { gte: since } }, orderBy: { at: 'desc' }, take: 300 }),
    peoplePrisma.deviceCommand.findMany({ where: { orgId, deviceId: device.id, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 300 }),
    peoplePrisma.deviceLog.findMany({ where: { orgId, deviceId: device.id, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 300 }),
    peoplePrisma.readerAlert.findMany({ where: { orgId, deviceId: device.id, OR: [{ openedAt: { gte: since } }, { resolvedAt: null }] }, orderBy: { openedAt: 'desc' } }),
    peoplePrisma.deviceCommand.findMany({ where: { orgId, deviceId: device.id, status: { in: ['PENDING', 'SENT', 'FAILED'] } }, orderBy: { createdAt: 'asc' }, take: 200 }),
  ]);
  const events: Array<{ at: Date; kind: string; tone: 'ok' | 'warn' | 'bad' | 'info'; title: string; detail?: string | null; traceId?: string }> = [];
  for (const r of runs) {
    const tone = r.rejected ? 'warn' : r.accepted ? 'ok' : 'info';
    events.push({ at: r.at, kind: 'batch', tone, traceId: r.traceId, title: r.accepted ? `${r.accepted} new punch${r.accepted === 1 ? '' : 'es'} received` : 'Punches received, all already stored', detail: [`${r.received} line${r.received === 1 ? '' : 's'}`, r.duplicates ? `${r.duplicates} repeat${r.duplicates === 1 ? '' : 's'}` : null, r.rejected ? `${r.rejected} unreadable` : null, r.errorsJson ? `e.g. ${JSON.parse(r.errorsJson)[0]}` : null].filter(Boolean).join(', ') });
  }
  for (const c of commands) {
    const tone = c.status === 'FAILED' ? 'bad' : c.status === 'DONE' ? 'ok' : c.status === 'CANCELLED' ? 'info' : 'warn';
    events.push({ at: c.doneAt || c.sentAt || c.createdAt, kind: 'command', tone, title: `${commandWord(c.command)}: ${c.status.toLowerCase()}`, detail: [c.attempts ? `${c.attempts} attempt${c.attempts === 1 ? '' : 's'}` : null, c.lastError, c.returnCode != null && c.returnCode !== 0 ? `reader answered ${c.returnCode}` : null].filter(Boolean).join(', ') || null });
  }
  for (const l of logs) events.push({ at: l.createdAt, kind: 'log', tone: l.kind === 'ERROR' ? 'bad' : 'info', title: l.kind === 'ERROR' ? `Reader error ${l.code}` : `Operation ${l.code} at the reader`, detail: [l.localTime && `reader time ${l.localTime}`, l.operator && `by ${l.operator}`, l.details].filter(Boolean).join(', ') || null });
  for (const a of alerts) {
    events.push({ at: a.openedAt, kind: 'alert', tone: 'bad', title: a.title, detail: a.details });
    if (a.resolvedAt) events.push({ at: a.resolvedAt, kind: 'alert', tone: 'ok', title: `Cleared: ${a.title}` });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  const lastBatch = runs.find((r) => r.accepted > 0);
  res.json({
    reader: { id: device.id, name: device.name, serialNumber: device.serialNumber, vendor: device.vendor, lastSeenAt: device.lastSeenAt },
    lastPunchBatchAt: lastBatch?.at || null,
    pending: pending.map((c) => ({ id: c.id, what: commandWord(c.command), status: c.status, attempts: c.attempts, lastError: c.lastError, createdAt: c.createdAt })),
    events: events.slice(0, 400),
  });
});

// ---------------------------------------------------------------------------
// Phone punches: where people punched from, and the attempts that were refused
// ---------------------------------------------------------------------------

/**
 * Approve or refuse a field punch (made outside every work site). Approved, it
 * counts and goes on to webhooks and HR tools like any punch; refused, it
 * stays on record but never counts.
 */
export async function reviewFieldPunch(orgId: string, punchId: string, approve: boolean, scope?: { managerId: string }) {
  const p = await peoplePrisma.devicePunch.findFirst({ where: { id: punchId, orgId } });
  if (!p || !p.outsideSite) throw fail(404, 'No such field punch.');
  if (p.reviewStatus !== 'PENDING') throw fail(409, `This punch was already ${String(p.reviewStatus || 'counted').toLowerCase()}.`);
  if (scope) {
    const owner = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId || '', orgId }, select: { reportingManagerId: true } });
    if (owner?.reportingManagerId !== scope.managerId) throw fail(403, 'This punch is not yours to decide.');
  }
  const updated = await peoplePrisma.devicePunch.update({ where: { id: p.id }, data: { reviewStatus: approve ? 'APPROVED' : 'REJECTED' } });
  if (p.employeeId && p.shiftDate) {
    const emp = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { id: true, accountId: true, branchId: true, areaId: true } });
    if (emp) await recomputeDeviceDay(emp.accountId, orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, p.shiftDate);
  }
  return updated;
}

attendanceInsightsRouter.post(`${base}/phone-punches/:id/review`, can(PermissionAction.EDIT, R.devices), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  try {
    const r = await reviewFieldPunch(req.tenant!.orgId, String(req.params.id), req.body?.approve === true);
    res.json({ punch: { id: r.id, review: r.reviewStatus } });
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: e?.message || 'Not done.' });
  }
});

/** Whether field punches wait for approval before they count. */
attendanceInsightsRouter.put(`${base}/phone-punches/settings`, can(PermissionAction.EDIT, R.devices), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const on = req.body?.fieldPunchApproval !== false;
  await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, fieldPunchApproval: on, updatedByUserId: req.auth!.userId }, update: { fieldPunchApproval: on, updatedByUserId: req.auth!.userId } });
  res.json({ fieldPunchApproval: on });
});

attendanceInsightsRouter.get(`${base}/phone-punches`, can(PermissionAction.VIEW, R.devices), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const t = today();
  const to = dateQ(req.query.to) || t;
  let from = dateQ(req.query.from) || to;
  if (from > to) from = to;
  if (addDays(from, 31) < to) from = addDays(to, -31);
  const fromAt = istInstant(from, '00:00');
  const toAt = istInstant(to, '00:00', 1);
  const phones = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, accountId, vendor: 'MOBILE' }, select: { id: true } });
  const [punches, attempts, fences] = await Promise.all([
    phones.length
      ? peoplePrisma.devicePunch.findMany({ where: { orgId, deviceId: { in: phones.map((p) => p.id) }, at: { gte: fromAt, lt: toAt } }, orderBy: { at: 'desc' }, take: 2000 })
      : Promise.resolve([] as any[]),
    peoplePrisma.phonePunchAttempt.findMany({ where: { orgId, at: { gte: fromAt, lt: toAt } }, orderBy: { at: 'desc' }, take: 1000 }),
    peoplePrisma.geofence.findMany({ where: { orgId } }),
  ]);
  const { distanceMeters } = await import('../services/attendance/portal.js');
  const fenceOf = new Map(fences.map((f) => [f.id, f]));
  const nearest = (lat: number | null, lon: number | null) => {
    if (lat == null || lon == null || !fences.length) return null;
    let best: { name: string; distance: number; radius: number } | null = null;
    for (const f of fences) {
      const d = distanceMeters({ latitude: lat, longitude: lon }, { latitude: f.latitude, longitude: f.longitude });
      if (!best || d < best.distance) best = { name: f.name, distance: Math.round(d), radius: f.radiusMeters };
    }
    return best;
  };
  const named = await withNames(orgId, [...punches.map((p: any) => ({ ...p, employeeId: p.employeeId })), ...attempts.map((a) => ({ ...a }))]);
  const nameOf = new Map(named.map((n: any) => [n.employeeId, n.employeeName]));
  const accepted = punches.map((p: any) => {
    const fence = p.geofenceId ? fenceOf.get(p.geofenceId) : null;
    const distance = fence && p.latitude != null ? Math.round(distanceMeters({ latitude: p.latitude, longitude: p.longitude }, { latitude: fence.latitude, longitude: fence.longitude })) : null;
    const near = p.outsideSite ? nearest(p.latitude, p.longitude) : null;
    return { id: p.id, employeeId: p.employeeId, name: nameOf.get(p.employeeId) || p.pin, at: p.at, time: p.localTime, kind: p.kind, site: fence?.name || null, radius: fence?.radiusMeters ?? null, distance, accuracy: p.accuracyM != null ? Math.round(p.accuracyM) : null, latitude: p.latitude, longitude: p.longitude, photoId: p.photoId || null, outside: Boolean(p.outsideSite), address: p.address || null, review: p.reviewStatus || null, nearest: near };
  });
  const refused = attempts.map((a) => {
    const near = nearest(a.latitude, a.longitude);
    return { id: a.id, employeeId: a.employeeId, name: nameOf.get(a.employeeId) || '—', at: a.at, time: `${istInstantDate(a.at)} ${istTime(a.at)}`, code: a.code, message: a.message, accuracy: a.accuracyM != null ? Math.round(a.accuracyM) : null, latitude: a.latitude, longitude: a.longitude, nearest: near };
  });
  const people = new Set(accepted.map((a: any) => a.employeeId));
  res.json({
    from,
    to,
    summary: { punches: accepted.length, people: people.size, withSelfie: accepted.filter((a: any) => a.photoId).length, refused: refused.length, outside: refused.filter((r) => r.code === 'OUTSIDE').length, field: accepted.filter((a: any) => a.outside).length, waiting: accepted.filter((a: any) => a.review === 'PENDING').length },
    fieldPunchApproval: (await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { fieldPunchApproval: true } }))?.fieldPunchApproval ?? true,
    accepted,
    refused,
    sites: fences.map((f) => ({ id: f.id, name: f.name, latitude: f.latitude, longitude: f.longitude, radius: f.radiusMeters })),
  });
});

// ---------------------------------------------------------------------------
// Overtime and comp-off: the company's rules, and the requests waiting on HR
// ---------------------------------------------------------------------------

const overtimeRules = (s: any) => ({
  overtimeRequests: s?.overtimeRequests ?? true,
  overtimeApproval: s?.overtimeApproval ?? 'HR',
  compOffEnabled: s?.compOffEnabled ?? false,
  compOffLeaveTypeId: s?.compOffLeaveTypeId ?? null,
  confirmCutoffDay: s?.confirmCutoffDay ?? 3,
});

attendanceInsightsRouter.get(`${base}/overtime/rules`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const [s, types] = await Promise.all([
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
    peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ rules: overtimeRules(s), leaveTypes: types });
});

attendanceInsightsRouter.put(`${base}/overtime/rules`, can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      overtimeRequests: z.boolean(),
      overtimeApproval: z.enum(CHAINS as [string, ...string[]]),
      compOffEnabled: z.boolean(),
      compOffLeaveTypeId: z.string().nullable(),
      confirmCutoffDay: z.number().int().min(1).max(28),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the rules.' });
  const v = parsed.data;
  if (v.compOffEnabled && !v.compOffLeaveTypeId) return res.status(400).json({ error: 'Choose the leave type comp-off days are added to.' });
  if (v.compOffLeaveTypeId && !(await peoplePrisma.leaveType.findFirst({ where: { id: v.compOffLeaveTypeId, orgId } }))) return res.status(400).json({ error: 'No such leave type.' });
  const s = await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, ...v, updatedByUserId: req.auth!.userId }, update: { ...v, updatedByUserId: req.auth!.userId } });
  res.json({ rules: overtimeRules(s) });
});

attendanceInsightsRouter.get(`${base}/overtime/requests`, can(PermissionAction.VIEW, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const status = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(String(req.query.status)) ? String(req.query.status) : 'PENDING';
  const rows = await peoplePrisma.overtimeRequest.findMany({ where: { orgId, status }, orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' }, take: 300 });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, name: true, code: true, reportingManagerId: true } });
  const by = new Map(people.map((p) => [p.id, p]));
  const chain = await overtimeChain(orgId);
  res.json({
    chain,
    requests: rows.map((r) => {
      const p = by.get(r.employeeId);
      const waitingOnManager = chain === 'MANAGER_THEN_HR' && !r.managerApprovedAt && Boolean(p?.reportingManagerId) && r.status === 'PENDING';
      return { ...r, employeeName: p?.name || '—', employeeCode: p?.code || null, waitingOnManager };
    }),
  });
});

attendanceInsightsRouter.post(`${base}/overtime/requests/:id/:decision`, can(PermissionAction.EDIT, R.records), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const decision = String(req.params.decision);
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'approve or reject.' });
  try {
    const r = await decideOvertime(orgId, String(req.params.id), decision === 'approve', { userId: req.auth!.userId }, String(req.body?.note || '').trim().slice(0, 500) || null);
    res.json({ request: r });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Not done.' });
  }
});

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { COMMANDS, FACE, FETCH_TEMPLATE_COMMANDS, ONLINE_WINDOW_MS, SEQ, VERIFY_MODES, pinKey, userInfoCommand } from '../services/attendance/adms.js';
import { ISO_DATE, sendError, today } from './attendance.js';
import { copyAllTemplatesTo, pinMatcher, recomputeDeviceDay, shiftDayFor } from './iclock.js';

/**
 * Biometric readers, as the company manages them: claim a reader by its serial
 * number, set its direction, send it staff, and match reader user IDs nobody
 * recognised to employees. The readers themselves talk to /iclock (routes/iclock.ts).
 */
export const devicesRouter = Router();
devicesRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, R.devices);
const base = '/orgs/:orgId/attendance/devices';
const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;

const deviceSchema = z.object({
  serialNumber: z.string().trim().regex(SERIAL, 'The serial number is letters and digits, as printed on the reader.'),
  name: z.string().trim().min(1, 'Name the reader, e.g. "Main gate".').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
});

const shape = (d: any, extra: Record<string, unknown> = {}) => ({
  ...d,
  online: Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS),
  ...extra,
});

devicesRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const devices = await peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const ids = devices.map((d) => d.id);
  const t = today();
  const [todayCounts, pending, unmatched] = await Promise.all([
    ids.length
      ? peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, localTime: { startsWith: t } }, _count: { _all: true } })
      : [],
    ids.length ? peoplePrisma.deviceCommand.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: ids }, status: { in: ['PENDING', 'SENT'] } }, _count: { _all: true } }) : [],
    peoplePrisma.devicePunch.count({ where: { accountId, orgId, employeeId: null } }),
  ]);
  const n = (rows: any[], id: string) => rows.find((r) => r.deviceId === id)?._count._all || 0;
  res.json({
    devices: devices.map((d) => shape(d, { punchesToday: n(todayCounts as any[], d.id), commandsWaiting: n(pending as any[], d.id) })),
    unmatchedPunches: unmatched,
  });
});

devicesRouter.post(base, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reader.' });
  const b = parsed.data;
  const taken = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber: b.serialNumber } });
  if (taken) {
    return res.status(409).json({
      error: taken.orgId === orgId ? 'This reader is already added.' : 'This serial number is registered to another organisation. Contact support if the reader is yours.',
    });
  }
  /* A reader already pointed at us shows up as "seen" straight away. */
  const seen = await peoplePrisma.unclaimedReader.findUnique({ where: { serialNumber: b.serialNumber } });
  try {
    const device = await peoplePrisma.attendanceDevice.create({
      data: { accountId, orgId, ...b, ip: seen?.ip || null, lastSeenAt: seen?.lastSeenAt || null, createdByUserId: req.auth!.userId },
    });
    if (seen) await peoplePrisma.unclaimedReader.delete({ where: { serialNumber: b.serialNumber } }).catch(() => undefined);
    res.status(201).json({ device: shape(device), seenBefore: seen ? seen.lastSeenAt : null });
  } catch (e) {
    return sendError(res, e);
  }
});

devicesRouter.put(`${base}/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such reader.' });
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80), direction: z.enum(['both', 'in', 'out']), isActive: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Name the reader and choose its direction.' });
  const device = await peoplePrisma.attendanceDevice.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ device: shape(device) });
});

devicesRouter.delete(`${base}/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such reader.' });
  if (await peoplePrisma.devicePunch.findFirst({ where: { orgId, deviceId: existing.id }, select: { id: true } })) {
    return res.status(409).json({ error: 'This reader has punches on record. Switch it off instead; its punches stay.' });
  }
  await peoplePrisma.deviceCommand.deleteMany({ where: { orgId, deviceId: existing.id } });
  await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: existing.id } });
  await peoplePrisma.attendanceDevice.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

devicesRouter.post(`${base}/:id/commands`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const action = String(req.body?.action || '');
  const queue = (command: string, sequence: number = SEQ.OTHER) => ({ accountId, orgId, deviceId: device.id, serialNumber: device.serialNumber, command, sequence, createdByUserId: req.auth!.userId });

  if (action === 'FETCH_PUNCHES' || action === 'FETCH_USERS' || action === 'REBOOT') {
    await peoplePrisma.deviceCommand.create({ data: queue(COMMANDS[action]) });
    return res.json({ queued: 1 });
  }
  if (action === 'FETCH_TEMPLATES') {
    /* What it sends back is stored and, if new, copied to the other readers. */
    await peoplePrisma.deviceCommand.createMany({ data: FETCH_TEMPLATE_COMMANDS.map((c) => queue(c)) });
    return res.json({ queued: FETCH_TEMPLATE_COMMANDS.length });
  }
  if (action === 'COPY_TEMPLATES') {
    const r = await copyAllTemplatesTo(device, req.auth!.userId);
    return res.json({ queued: r.commands, people: r.people });
  }
  if (action === 'SEND_STAFF') {
    /*
     * Adds people the reader does not have yet, under their Reader ID (else
     * their employee code). People already on the reader are left alone: the
     * command carries an empty password and card, which would wipe ones set at
     * the reader. Fingerprints and faces are still enrolled at the reader.
     */
    const [people, onReader] = await Promise.all([
      peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' } }, select: { name: true, code: true, devicePin: true } }),
      peoplePrisma.deviceUser.findMany({ where: { orgId, deviceId: device.id }, select: { pin: true } }),
    ]);
    const have = new Set(onReader.map((u) => pinKey(u.pin)));
    const toSend = people
      .map((p) => ({ pin: p.devicePin || p.code || '', name: p.name }))
      .filter((p) => p.pin && !have.has(pinKey(p.pin)));
    if (toSend.length) await peoplePrisma.deviceCommand.createMany({ data: toSend.map((p) => queue(userInfoCommand(p.pin, p.name), SEQ.USER)) });
    return res.json({ queued: toSend.length, skippedWithoutId: people.filter((p) => !p.devicePin && !p.code).length, knownUsers: onReader.length });
  }
  return res.status(400).json({ error: 'Unknown action.' });
});

devicesRouter.get(`${base}/:id/commands`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const commands = await peoplePrisma.deviceCommand.findMany({ where: { orgId, deviceId: device.id }, orderBy: { id: 'desc' }, take: 50 });
  /* User commands are long and repetitive; the screen needs the gist. */
  res.json({ commands: commands.map((c) => ({ ...c, command: c.command.split('\t')[0] })) });
});

devicesRouter.get(`${base}/:id/users`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const users = await peoplePrisma.deviceUser.findMany({ where: { orgId, deviceId: device.id }, orderBy: { pin: 'asc' } });
  const match = await pinMatcher(orgId);
  const names = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true } })).map((e) => [e.id, e.name])
  );
  res.json({ users: users.map((u) => ({ ...u, employeeId: match(u.pin)?.id || null, employeeName: names.get(match(u.pin)?.id || '') || null })) });
});

// ---------------------------------------------------------------------------
// Punches nobody was matched to
// ---------------------------------------------------------------------------

devicesRouter.get('/orgs/:orgId/attendance/punches/unmatched', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.devicePunch.groupBy({
    by: ['pin'],
    where: { accountId, orgId, employeeId: null },
    _count: { _all: true },
    _min: { localTime: true },
    _max: { localTime: true },
  });
  const users = await peoplePrisma.deviceUser.findMany({ where: { orgId, pin: { in: rows.map((r) => r.pin) } }, select: { pin: true, name: true } });
  const nameOf = new Map(users.filter((u) => u.name).map((u) => [u.pin, u.name]));
  res.json({
    pins: rows
      .map((r) => ({ pin: r.pin, readerName: nameOf.get(r.pin) || null, punches: r._count._all, first: r._min.localTime, last: r._max.localTime }))
      .sort((a, b) => String(b.last).localeCompare(String(a.last))),
  });
});

devicesRouter.post('/orgs/:orgId/attendance/punches/match', can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ pin: z.string().trim().min(1).max(40), employeeId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose the employee for this reader ID.' });
  const { pin, employeeId } = parsed.data;
  try {
    const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, accountId, orgId }, select: { id: true, branchId: true, devicePin: true, name: true } });
    if (!employee) return res.status(404).json({ error: 'No such employee.' });
    const holder = await peoplePrisma.employee.findFirst({ where: { orgId, devicePin: pin, id: { not: employee.id } }, select: { name: true } });
    if (holder) return res.status(409).json({ error: `Reader ID ${pin} already belongs to ${holder.name}.` });
    if (employee.devicePin && employee.devicePin !== pin) {
      return res.status(409).json({ error: `${employee.name} already has Reader ID ${employee.devicePin}. Change it on their employee file first.` });
    }
    await peoplePrisma.employee.update({ where: { id: employee.id }, data: { devicePin: pin } });
    await peoplePrisma.biometricTemplate.updateMany({ where: { orgId, pin, employeeId: null }, data: { employeeId: employee.id } });

    const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId, pin, employeeId: null }, select: { id: true, localTime: true } });
    const days = new Set<string>();
    for (const p of punches) {
      const shiftDate = await shiftDayFor(orgId, employee.id, p.localTime);
      await peoplePrisma.devicePunch.update({ where: { id: p.id }, data: { employeeId: employee.id, shiftDate } });
      days.add(shiftDate);
    }
    for (const date of days) await recomputeDeviceDay(accountId, orgId, employee, date);
    res.json({ matched: punches.length, days: days.size });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Fingerprints and faces: counts only — template data never leaves the server
// ---------------------------------------------------------------------------

devicesRouter.get('/orgs/:orgId/attendance/biometrics', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.biometricTemplate.groupBy({ by: ['pin', 'employeeId', 'type'], where: { accountId, orgId }, _count: { _all: true }, _max: { updatedAt: true } });
  const names = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e])
  );
  const byPin = new Map<string, any>();
  for (const r of rows) {
    const e = r.employeeId ? names.get(r.employeeId) : null;
    const row = byPin.get(r.pin) || { pin: r.pin, employeeId: r.employeeId, employeeName: e?.name || null, employeeCode: e?.code || null, fingers: 0, faces: 0, other: 0, updatedAt: null };
    if (r.type === FACE) row.faces += r._count._all;
    else if (r.type === 1) row.fingers += r._count._all;
    else row.other += r._count._all;
    if (!row.updatedAt || (r._max.updatedAt && r._max.updatedAt > row.updatedAt)) row.updatedAt = r._max.updatedAt;
    byPin.set(r.pin, row);
  }
  res.json({ people: [...byPin.values()].sort((a, b) => String(a.employeeName || a.pin).localeCompare(String(b.employeeName || b.pin))) });
});

// ---------------------------------------------------------------------------
// Transactions: punches exactly as the readers sent them (ClorTime's Transaction view)
// ---------------------------------------------------------------------------

const range = (q: any) => {
  const t = today();
  const to = ISO_DATE.test(String(q.to || '')) ? String(q.to) : t;
  const from = ISO_DATE.test(String(q.from || '')) ? String(q.from) : to;
  return { from, to };
};
const LIMIT = 5000;

devicesRouter.get('/orgs/:orgId/attendance/transactions', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { from, to } = range(req.query);
  const employeeId = String(req.query.employeeId || '').trim();
  const deviceId = String(req.query.deviceId || '').trim();
  const unmatched = req.query.unmatched === 'true';
  const where: any = {
    accountId,
    orgId,
    localTime: { gte: `${from} 00:00:00`, lte: `${to} 23:59:59` },
    ...(deviceId ? { deviceId } : {}),
    ...(unmatched ? { employeeId: null } : employeeId ? { employeeId } : {}),
  };
  const [rows, total, devices, people] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where, orderBy: { at: 'desc' }, take: LIMIT }),
    peoplePrisma.devicePunch.count({ where }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true } }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, code: true } }),
  ]);
  const dev = new Map(devices.map((d) => [d.id, d.name]));
  const emp = new Map(people.map((p) => [p.id, p]));
  res.json({
    from,
    to,
    total,
    truncated: total > rows.length,
    transactions: rows.map((r) => ({
      id: r.id,
      pin: r.pin,
      localTime: r.localTime,
      kind: r.kind,
      state: r.state,
      verifyMode: r.verifyMode,
      verify: VERIFY_MODES[r.verifyMode] || `Code ${r.verifyMode}`,
      deviceId: r.deviceId,
      deviceName: dev.get(r.deviceId) || r.serialNumber,
      employeeId: r.employeeId,
      employeeName: r.employeeId ? emp.get(r.employeeId)?.name || null : null,
      employeeCode: r.employeeId ? emp.get(r.employeeId)?.code || null : null,
      shiftDate: r.shiftDate,
    })),
  });
});

devicesRouter.get('/orgs/:orgId/attendance/device-logs', can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { from, to } = range(req.query);
  const kind = req.query.kind === 'ERROR' ? 'ERROR' : 'OPERATION';
  const deviceId = String(req.query.deviceId || '').trim();
  const where: any = { accountId, orgId, kind, localTime: { gte: `${from} 00:00:00`, lte: `${to} 23:59:59` }, ...(deviceId ? { deviceId } : {}) };
  const [rows, devices] = await Promise.all([
    peoplePrisma.deviceLog.findMany({ where, orderBy: { localTime: 'desc' }, take: LIMIT }),
    peoplePrisma.attendanceDevice.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const dev = new Map(devices.map((d) => [d.id, d.name]));
  res.json({ from, to, kind, logs: rows.map((r) => ({ ...r, deviceName: dev.get(r.deviceId) || '—' })) });
});

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { COMMANDS, FACE, FETCH_TEMPLATE_COMMANDS, ONLINE_WINDOW_MS, SEQ, VERIFY_MODES, commandEffect, pinKey, userInfoCommand } from '../services/attendance/adms.js';
import { ISO_DATE, sendError, today } from './attendance.js';
import { copyAllTemplatesTo, pinMatcher, recomputeDeviceDay, servesArea, shiftDayFor, syncVendorConnection } from './iclock.js';
import { encryptSecret } from '../services/mailer.js';
import { etoFetchPunches } from '../services/attendance/etimeoffice.js';

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

/* Never the stored credential. */
const shape = ({ apiSecret, ...d }: any, extra: Record<string, unknown> = {}) => ({
  ...d,
  hasSecret: Boolean(apiSecret),
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

const etoSchema = z.object({
  name: z.string().trim().min(1, 'Name the connection.').max(80),
  direction: z.enum(['both', 'in', 'out']).default('both'),
  apiUrl: z.string().trim().url('That is not a web address.').max(200).optional().nullable().or(z.literal('')),
  corporateId: z.string().trim().max(80).optional().nullable(),
  username: z.string().trim().min(1, 'The e-Time Office user name is needed.').max(120),
  password: z.string().min(1, 'The e-Time Office password is needed.').max(200),
});

/** Try e-Time Office credentials on today's punches before saving them. */
devicesRouter.post(`${base}/test-etimeoffice`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const parsed = etoSchema.safeParse({ name: 'test', ...req.body });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the details.' });
  const b = parsed.data;
  const now = new Date();
  const midnight = new Date(`${new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`);
  const r = await etoFetchPunches({ apiUrl: b.apiUrl || null, corporateId: b.corporateId || null, username: b.username, password: b.password }, midnight, now);
  res.json({ ok: r.ok, message: r.message, punchesToday: r.punches.length });
});

devicesRouter.post(base, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  if (req.body?.vendor === 'ETIMEOFFICE') {
    const p = etoSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
    const b = p.data;
    /* One connection per e-Time Office account, across all companies. */
    const serialNumber = `ETO-${(b.corporateId || b.username).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36)}`;
    const taken = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber } });
    if (taken) return res.status(409).json({ error: taken.orgId === orgId ? 'This e-Time Office account is already connected.' : 'This e-Time Office account is connected to another organisation.' });
    const device = await peoplePrisma.attendanceDevice.create({
      data: {
        accountId,
        orgId,
        serialNumber,
        name: b.name,
        direction: b.direction,
        vendor: 'ETIMEOFFICE',
        apiUrl: b.apiUrl || null,
        apiCorporateId: b.corporateId || null,
        apiUsername: b.username,
        apiSecret: encryptSecret(b.password),
        createdByUserId: req.auth!.userId,
      },
    });
    return res.status(201).json({ device: shape(device), seenBefore: null });
  }
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
    .object({
      name: z.string().trim().min(1).max(80),
      direction: z.enum(['both', 'in', 'out']),
      isActive: z.boolean().optional(),
      /* A site's reader takes only that area's staff; null = everyone. */
      areaId: z.string().min(1).nullable().optional(),
      /* e-Time Office only; a blank password keeps the stored one. */
      apiUrl: z.string().trim().url().max(200).optional().nullable().or(z.literal('')),
      corporateId: z.string().trim().max(80).optional().nullable(),
      username: z.string().trim().max(120).optional(),
      password: z.string().max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Name the reader and choose its direction.' });
  const { apiUrl, corporateId, username, password, areaId, ...common } = parsed.data;
  if (areaId && !(await peoplePrisma.area.findFirst({ where: { id: areaId, orgId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'That area is not in this organisation.' });
  }
  const vendorFields =
    existing.vendor === 'ADMS'
      ? {}
      : {
          ...(apiUrl !== undefined ? { apiUrl: apiUrl || null } : {}),
          ...(corporateId !== undefined ? { apiCorporateId: corporateId || null } : {}),
          ...(username ? { apiUsername: username } : {}),
          ...(password ? { apiSecret: encryptSecret(password) } : {}),
        };
  const device = await peoplePrisma.attendanceDevice.update({
    where: { id: existing.id },
    data: { ...common, ...vendorFields, ...(existing.vendor === 'ADMS' && areaId !== undefined ? { areaId } : {}) },
  });
  /* A new area changes who belongs on it; Sync status shows the gaps and the extras. */
  res.json({ device: shape(device), areaChanged: areaId !== undefined && (areaId ?? null) !== (existing.areaId ?? null) });
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
  if (device.vendor !== 'ADMS') return res.status(400).json({ error: 'Commands go to readers. This is a cloud connection — use Sync now.' });
  const queue = (command: string, sequence: number = SEQ.OTHER) => ({ accountId, orgId, deviceId: device.id, serialNumber: device.serialNumber, command, sequence, createdByUserId: req.auth!.userId });

  if (action === 'FETCH_PUNCHES' || action === 'FETCH_USERS' || action === 'REBOOT' || action === 'INFO') {
    await peoplePrisma.deviceCommand.create({ data: queue(COMMANDS[action]) });
    return res.json({ queued: 1 });
  }
  if (action === 'READ_ALL') {
    /* Learn what the reader holds — its users, fingerprints, faces, counts — so Sync status is true for a reader set up before CLOR. */
    const cmds = [COMMANDS.INFO, COMMANDS.FETCH_USERS, ...FETCH_TEMPLATE_COMMANDS];
    await peoplePrisma.deviceCommand.createMany({ data: cmds.map((c) => queue(c)) });
    return res.json({ queued: cmds.length });
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
      peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' } }, select: { name: true, code: true, devicePin: true, areaId: true } }),
      peoplePrisma.deviceUser.findMany({ where: { orgId, deviceId: device.id }, select: { pin: true } }),
    ]);
    const have = new Set(onReader.map((u) => pinKey(u.pin)));
    const toSend = people
      .filter((p) => servesArea(device, p.areaId))
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
  const status = String(req.query.status || '').toUpperCase();
  const where: any = { orgId, deviceId: device.id, ...(['PENDING', 'SENT', 'DONE', 'FAILED', 'CANCELLED'].includes(status) ? { status } : {}) };
  const [commands, counts] = await Promise.all([
    peoplePrisma.deviceCommand.findMany({ where, orderBy: { id: 'desc' }, take: 200 }),
    peoplePrisma.deviceCommand.groupBy({ by: ['status'], where: { orgId, deviceId: device.id }, _count: { _all: true } }),
  ]);
  const match = await pinMatcher(orgId);
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  res.json({
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    /* User and template commands are long, and templates are biometric data: the screen gets the gist and who it is for. */
    commands: commands.map((c) => {
      const e = commandEffect(c.command);
      return {
        id: c.id,
        status: c.status,
        attempts: c.attempts,
        returnCode: c.returnCode,
        lastError: c.lastError,
        createdAt: c.createdAt,
        sentAt: c.sentAt,
        doneAt: c.doneAt,
        what: describeCommand(c.command),
        pin: e?.pin || null,
        employeeName: e ? names.get(match(e.pin)?.id || '') || null : null,
      };
    }),
  });
});

const describeCommand = (command: string) => {
  const e = commandEffect(command);
  if (e) {
    return {
      user: 'Add or update user',
      finger: `Add fingerprint ${e.no ?? ''}`.trim(),
      face: 'Add face',
      removeUser: 'Remove user',
      removeFingers: 'Remove fingerprints',
      removeFace: 'Remove face',
    }[e.what];
  }
  const head = command.split('\t')[0];
  return (
    {
      [COMMANDS.FETCH_PUNCHES]: 'Send all punches',
      [COMMANDS.FETCH_USERS]: 'Send its users',
      [COMMANDS.REBOOT]: 'Restart',
      [COMMANDS.INFO]: 'Report counts and capacity',
      'DATA QUERY FINGERTMP': 'Send fingerprints',
      'DATA QUERY FACE': 'Send faces',
      'DATA QUERY BIODATA': 'Send biometric data',
    } as Record<string, string>
  )[head] || head;
};

/** Send failed commands again (all, or the ones picked). */
devicesRouter.post(`${base}/:id/commands/retry`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const r = await peoplePrisma.deviceCommand.updateMany({
    where: { orgId, deviceId: device.id, status: 'FAILED', ...(ids ? { id: { in: ids } } : {}) },
    data: { status: 'PENDING', attempts: 0, lastError: null, returnCode: null, doneAt: null, sentAt: null },
  });
  res.json({ retried: r.count });
});

/** Drop changes still waiting for the reader (all, or the ones picked). */
devicesRouter.post(`${base}/:id/commands/cancel`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!device) return res.status(404).json({ error: 'No such reader.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const r = await peoplePrisma.deviceCommand.updateMany({
    where: { orgId, deviceId: device.id, status: 'PENDING', ...(ids ? { id: { in: ids } } : {}) },
    data: { status: 'CANCELLED', doneAt: new Date() },
  });
  res.json({ cancelled: r.count });
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
    const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, accountId, orgId }, select: { id: true, branchId: true, areaId: true, devicePin: true, name: true } });
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
  const fenceIds = [...new Set(rows.map((r) => r.geofenceId).filter(Boolean))] as string[];
  const fences = fenceIds.length ? await peoplePrisma.geofence.findMany({ where: { orgId, id: { in: fenceIds } }, select: { id: true, name: true } }) : [];
  const site = new Map(fences.map((f) => [f.id, f.name]));
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
      /* Phone punches: where, which site, and the selfie while it is kept. */
      latitude: r.latitude,
      longitude: r.longitude,
      accuracyM: r.accuracyM,
      siteName: r.geofenceId ? site.get(r.geofenceId) || null : null,
      photoId: r.photoId,
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

/** Pull from a vendor cloud now; `from` (YYYY-MM-DD, up to 31 days back) fetches older punches. */
devicesRouter.post(`${base}/:id/sync`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const device = await peoplePrisma.attendanceDevice.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!device) return res.status(404).json({ error: 'No such connection.' });
  if (device.vendor === 'ADMS') return res.status(400).json({ error: 'A reader sends its punches itself. Use “Fetch all punches” instead.' });
  let from: Date | undefined;
  if (req.body?.from) {
    if (!ISO_DATE.test(String(req.body.from))) return res.status(400).json({ error: 'Dates are YYYY-MM-DD.' });
    from = new Date(`${req.body.from}T00:00:00+05:30`);
    if (Date.now() - from.getTime() > 31 * 86_400_000) return res.status(400).json({ error: 'Go back at most 31 days at a time.' });
  }
  const r = await syncVendorConnection(device, { from });
  res.status(r.ok ? 200 : 502).json(r.ok ? r : { error: r.message, ...r });
});

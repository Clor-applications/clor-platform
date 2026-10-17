import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE, attendanceRouteOk } from '../services/attendance/guards.js';
import { FACE, FINGER, ONLINE_WINDOW_MS, commandEffect, normaliseFirmware, pinKey, removalCommands, SEQ } from '../services/attendance/adms.js';
import { alertSettings, assessCollection, assessReader, collectionFacts, readerFacts, readerStatus } from '../services/attendance/readerHealth.js';
import { readerSupports, sendPersonTo, servesArea } from './iclock.js';
import { vendorsWith } from '../services/attendance/drivers.js';

/**
 * Running a fleet of readers: how each one is (health, capacity, clock,
 * queue), alerts, and who is on which reader — with one button to close the
 * gaps. Readers are where attendance software wins or loses: a reader quietly
 * offline, a wrong clock or a person missing from one gate costs a day's
 * attendance before anyone notices.
 */
export const readerOpsRouter = Router();
readerOpsRouter.use(requireAuth, requireTenantContext);

const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.devices);
const base = '/orgs/:orgId/attendance';

const pct = (n: number | null, max: number | null) => (n === null || !max ? null : Math.round((n / max) * 1000) / 10);

readerOpsRouter.get(`${base}/reader-health`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const now = new Date();
  const settings = await alertSettings(orgId);
  const [facts, collection, alerts, lastPunches, areas] = await Promise.all([
    readerFacts(orgId, await peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId, vendor: { in: vendorsWith('users') } }, orderBy: { name: 'asc' } })),
    collectionFacts(orgId, settings.noPunchAfterHour, now),
    peoplePrisma.readerAlert.findMany({ where: { orgId, OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }] }, orderBy: { openedAt: 'desc' }, take: 100 }),
    peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where: { orgId }, _max: { at: true } }),
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  res.json({
    now,
    settings,
    collection: assessCollection(collection, now) || [],
    punchesToday: collection.punchesToday,
    readers: facts.map(({ device: d, facts: f, pending }) => {
      const issues = assessReader(f, now, { offlineMinutes: settings.offlineAlertMinutes });
      return {
        id: d.id,
        name: d.name,
        serialNumber: d.serialNumber,
        model: d.model,
        firmware: normaliseFirmware(d.firmware),
        faceSupported: d.faceSupported,
        fingerSupported: d.fingerSupported,
        ip: d.ip,
        mac: d.mac,
        isActive: d.isActive,
        areaId: d.areaId,
        areaName: d.areaId ? areaName.get(d.areaId) || null : null,
        lastSeenAt: d.lastSeenAt,
        online: Boolean(d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS),
        lastPunchAt: lastPunches.find((p) => p.deviceId === d.id)?._max.at || null,
        clockOffsetSec: d.clockOffsetSec,
        clockCheckedAt: d.clockCheckedAt,
        infoAt: d.infoAt,
        capacity: {
          users: { n: d.userCount, max: f.maxUsers, pct: pct(d.userCount, f.maxUsers) },
          fingers: d.fingerSupported === false ? null : { n: d.fingerCount, max: f.maxFingers, pct: pct(d.fingerCount, f.maxFingers) },
          faces: d.faceSupported === false ? null : { n: d.faceCount, max: d.maxFaces, pct: pct(d.faceCount, d.maxFaces) },
          punches: { n: d.punchCount, max: f.maxPunches, pct: pct(d.punchCount, f.maxPunches) },
        },
        queue: { waiting: pending, failed24h: f.failed24h },
        status: d.isActive ? readerStatus(issues) : 'off',
        issues,
      };
    }),
    alerts: alerts.map(({ accountId: _a, orgId: _o, ...a }) => a),
  });
});

readerOpsRouter.put(`${base}/reader-alerts/settings`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      alertEmails: z
        .string()
        .max(1000)
        .transform((s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))
        .refine((list) => list.every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)), 'One of the e-mail addresses is not valid.')
        .refine((list) => list.length <= 10, 'At most 10 addresses.')
        .transform((list) => list.join(', ')),
      offlineAlertMinutes: z.coerce.number().int().min(5, 'At least 5 minutes.').max(24 * 60),
      noPunchAfterHour: z.coerce.number().int().min(6).max(20),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the settings.' });
  const data = { ...parsed.data, alertEmails: parsed.data.alertEmails || null };
  await peoplePrisma.attendanceSettings.upsert({
    where: { orgId },
    create: { accountId, orgId, ...data, updatedByUserId: req.auth!.userId },
    update: { ...data, updatedByUserId: req.auth!.userId },
  });
  res.json({ settings: await alertSettings(orgId) });
});

// ---------------------------------------------------------------------------
// Who is on which reader
// ---------------------------------------------------------------------------

/**
 * For each person and each reader: on it and complete, missing, missing some
 * fingerprints or the face, changes on their way, or on a reader that is not
 * theirs (another site's, or they have left).
 *
 * "On it" is what CLOR knows: what the reader sent and what it confirmed. A
 * reader that was set up before CLOR knows nothing yet — "Read what is on it"
 * fetches its users and templates.
 */
export async function syncMatrix(accountId: string, orgId: string) {
  const [readers, people, held, templates, queued] = await Promise.all([
    peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId, vendor: { in: vendorsWith('users') }, isActive: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.employee.findMany({
      where: { accountId, orgId },
      select: { id: true, name: true, code: true, devicePin: true, status: true, areaId: true, department: true, cardNumber: true, devicePassword: true, devicePrivilege: true },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.deviceUser.findMany({ where: { orgId }, select: { deviceId: true, pin: true, fingers: true, face: true } }),
    peoplePrisma.biometricTemplate.findMany({ where: { orgId }, select: { pin: true, type: true, no: true } }),
    peoplePrisma.deviceCommand.findMany({ where: { orgId, status: { in: ['PENDING', 'SENT'] } }, select: { deviceId: true, command: true } }),
  ]);
  const heldAt = new Map(held.map((h) => [`${h.deviceId}|${pinKey(h.pin)}`, h]));
  const bio = new Map<string, { fingers: Set<number>; face: boolean }>();
  for (const t of templates) {
    const k = pinKey(t.pin);
    if (!bio.has(k)) bio.set(k, { fingers: new Set(), face: false });
    if (t.type === FINGER) bio.get(k)!.fingers.add(t.no);
    if (t.type === FACE) bio.get(k)!.face = true;
  }
  const waiting = new Set<string>();
  for (const c of queued) {
    const e = commandEffect(c.command);
    if (e) waiting.add(`${c.deviceId}|${pinKey(e.pin)}`);
  }
  const rows = people
    .map((p) => ({ ...p, pin: String(p.devicePin || p.code || '').trim() }))
    .filter((p) => p.pin && (p.status !== 'LEFT' || readers.some((r) => heldAt.has(`${r.id}|${pinKey(p.pin)}`))))
    .map((p) => {
      const k = pinKey(p.pin);
      const b = bio.get(k);
      const cells = readers.map((r) => {
        const h = heldAt.get(`${r.id}|${k}`);
        const belongs = p.status !== 'LEFT' && servesArea(r, p.areaId);
        if (!belongs) return { deviceId: r.id, state: h ? 'EXTRA' : 'NA' };
        if (waiting.has(`${r.id}|${k}`)) return { deviceId: r.id, state: 'QUEUED' };
        if (!h) return { deviceId: r.id, state: 'MISSING' };
        const onReader = new Set(String(h.fingers || '').split(',').filter(Boolean).map(Number));
        const lackFingers = readerSupports(r, FINGER) ? [...(b?.fingers || [])].filter((n) => !onReader.has(n)).length : 0;
        const lackFace = Boolean(b?.face && !h.face && readerSupports(r, FACE));
        if (lackFingers || lackFace) return { deviceId: r.id, state: 'PARTIAL', lackFingers, lackFace };
        return { deviceId: r.id, state: 'OK', fingers: onReader.size, face: h.face };
      });
      return {
        employeeId: p.id,
        name: p.name,
        code: p.code,
        pin: p.pin,
        department: p.department,
        left: p.status === 'LEFT',
        enrolled: { fingers: b?.fingers.size || 0, face: Boolean(b?.face) },
        cells,
        _emp: p,
      };
    });
  const summary = readers.map((r) => {
    const count = (s: string) => rows.filter((x) => x.cells.find((c) => c.deviceId === r.id)?.state === s).length;
    return { deviceId: r.id, ok: count('OK'), missing: count('MISSING'), partial: count('PARTIAL'), queued: count('QUEUED'), extra: count('EXTRA'), known: held.filter((h) => h.deviceId === r.id).length };
  });
  return { readers, rows, summary };
}

readerOpsRouter.get(`${base}/reader-sync`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const { readers, rows, summary } = await syncMatrix(accountId, orgId);
  res.json({
    readers: readers.map((r) => ({ id: r.id, name: r.name, areaId: r.areaId, online: Boolean(r.lastSeenAt && Date.now() - r.lastSeenAt.getTime() < ONLINE_WINDOW_MS) })),
    rows: rows.map(({ _emp, ...r }) => r),
    summary,
  });
});

/** Close the gaps: send each person missing (or missing a finger or face) on a reader what that reader lacks. */
readerOpsRouter.post(`${base}/reader-sync/fix`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ deviceId: z.string().min(1).optional(), employeeIds: z.array(z.string().min(1)).max(5000).optional() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Check the request.' });
  const { deviceId, employeeIds } = parsed.data;
  const { readers, rows } = await syncMatrix(accountId, orgId);
  const only = employeeIds ? new Set(employeeIds) : null;
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId }, orderBy: [{ type: 'asc' }, { no: 'asc' }] });
  const byPin = new Map<string, typeof templates>();
  for (const t of templates) {
    const k = pinKey(t.pin);
    if (!byPin.has(k)) byPin.set(k, []);
    byPin.get(k)!.push(t);
  }
  let people = 0;
  let commands = 0;
  for (const r of readers) {
    if (deviceId && r.id !== deviceId) continue;
    for (const row of rows) {
      if (only && !only.has(row.employeeId)) continue;
      const cell = row.cells.find((c) => c.deviceId === r.id);
      if (!cell || (cell.state !== 'MISSING' && cell.state !== 'PARTIAL')) continue;
      const held = await peoplePrisma.deviceUser.findUnique({ where: { deviceId_pin: { deviceId: r.id, pin: row.pin } }, select: { fingers: true, face: true } });
      const have = new Set(String(held?.fingers || '').split(',').filter(Boolean).map(Number));
      const lacking = (byPin.get(pinKey(row.pin)) || []).filter((t) => !(t.type === FINGER && have.has(t.no)) && !(t.type === FACE && held?.face));
      commands += await sendPersonTo(r, row._emp, row.pin, lacking, req.auth!.userId);
      people += 1;
    }
  }
  res.json({ people, commands });
});

/** Take people off a reader that is not theirs — they have left, or it is another site's reader. Readers fill up; doors stay shut to those who should not pass. */
readerOpsRouter.post(`${base}/reader-sync/remove-extras`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await attendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const deviceId = String(req.body?.deviceId || '');
  const { readers, rows } = await syncMatrix(accountId, orgId);
  const r = readers.find((x) => x.id === deviceId);
  if (!r) return res.status(404).json({ error: 'No such reader.' });
  const extras = rows.filter((row) => row.cells.find((c) => c.deviceId === r.id)?.state === 'EXTRA');
  if (extras.length) {
    await peoplePrisma.deviceCommand.createMany({
      data: extras.flatMap((row) =>
        removalCommands(row.pin).map((command) => ({ accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId: req.auth!.userId }))
      ),
    });
  }
  res.json({ removed: extras.length });
});

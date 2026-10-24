import { recordAudit } from '../services/auditTrail.js';
import { endPortalSessions } from '../services/portalSessions.js';
import { actorFrom } from '../services/credentials.js';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { hrOrAttendanceRouteOk } from '../services/people/guards.js';
import { assignOrgCode } from '../services/displayCodes.js';
import { sendTemplate } from '../services/mailer.js';
import { CODE_TTL_MS, formatCode, newActivationCode, validPosition } from '../services/attendance/portal.js';
import { sendError } from '../services/attendance/days.js';
import { geocodeLimiter } from '../middleware/rateLimit.js';
import { placeAt, searchPlaces } from '../services/geocode.js';

/**
 * HR's side of the employee portal (ClorTime's portal invite and geofences):
 * who may sign in, one-time activation codes, who may punch from a phone, and
 * the work sites a phone punch must be made inside. Plus the punch selfies.
 */
export const portalAdminRouter = Router();
portalAdminRouter.use(requireAuth, requireTenantContext);

const can = (action: string) => requirePermission(ATTENDANCE_MODULE, action as any, ATTENDANCE_RESOURCE.portal);
const base = '/orgs/:orgId/attendance';
/* Where the employee portal is: PORTAL_URL (https://attendance.clor.in/#/portal in production), else the app's own address. */
const portalUrl = () => process.env.PORTAL_URL || `${process.env.APP_URL || 'http://localhost:5173'}/#/portal`;

/** The company code people sign in with; given now if the company has none yet. */
async function companyCode(accountId: string, orgId: string) {
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true, name: true } });
  return { name: org?.name || '', code: org?.code || (await assignOrgCode(accountId, orgId, org?.name || 'Company')) };
}

portalAdminRouter.get(`${base}/portal-access`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const [org, people, fences] = await Promise.all([
    companyCode(accountId, orgId),
    peoplePrisma.employee.findMany({
      where: { accountId, orgId, status: { not: 'LEFT' } },
      select: {
        id: true,
        name: true,
        code: true,
        department: true,
        areaId: true,
        workEmail: true,
        email: true,
        portalEnabled: true,
        portalPasswordSetAt: true,
        portalSetupHash: true,
        portalSetupExpires: true,
        mobilePunch: true,
        phonePunchMode: true,
        selfieRequired: true,
        geofenceId: true,
      },
      orderBy: { name: 'asc' },
    }),
    peoplePrisma.geofence.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const fence = new Map(fences.map((f) => [f.id, f.name]));
  const now = new Date();
  res.json({
    company: org,
    portalUrl: portalUrl(),
    employees: people.map(({ portalSetupHash, workEmail, email, ...p }) => ({
      ...p,
      email: workEmail || email || null,
      activated: Boolean(p.portalPasswordSetAt),
      codePending: Boolean(portalSetupHash && p.portalSetupExpires && p.portalSetupExpires > now),
      geofenceName: p.geofenceId ? fence.get(p.geofenceId) || null : null,
    })),
  });
});

/**
 * One-time activation codes, shown here once (and e-mailed if asked). A new
 * code does not end the old password; activating with it replaces it — which
 * is also how someone who forgot their password gets back in.
 */
portalAdminRouter.post(`${base}/portal-access/codes`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ employeeIds: z.array(z.string().min(1)).min(1, 'Pick someone.').max(500), email: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Pick someone.' });
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, id: { in: parsed.data.employeeIds }, status: { not: 'LEFT' } },
    select: { id: true, name: true, code: true, workEmail: true, email: true, mobilePunch: true },
  });
  const noCode = people.filter((p) => !p.code);
  if (noCode.length) return res.status(400).json({ error: `${noCode.map((p) => p.name).join(', ')} ${noCode.length === 1 ? 'has' : 'have'} no employee code, which is what they sign in with. Set one first.` });
  const org = await companyCode(accountId, orgId);
  const expires = new Date(Date.now() + CODE_TTL_MS);
  const codes = [];
  for (const p of people) {
    const code = newActivationCode();
    await peoplePrisma.employee.update({ where: { id: p.id }, data: { portalEnabled: true, portalSetupHash: await bcrypt.hash(code, 10), portalSetupExpires: expires } });
    const to = p.workEmail || p.email;
    let emailed = false;
    if (parsed.data.email && to) {
      try {
        await sendTemplate({
          templateKey: 'attendance.portal_invite',
          to,
          toName: p.name,
          accountId,
          orgId,
          relatedType: 'Employee',
          relatedId: p.id,
          data: {
            employeeName: p.name,
            orgName: org.name,
            /* Company and employee code filled in when they open it. */
            portalUrl: `${portalUrl()}?c=${encodeURIComponent(org.code)}&e=${encodeURIComponent(p.code!)}`,
            companyCode: org.code,
            employeeCode: p.code,
            activationCode: formatCode(code),
            expires: expires.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
            phoneLine: p.mobilePunch ? ', and punching in and out from your phone' : '',
          },
        });
        emailed = true;
      } catch {
        emailed = false;
      }
    }
    codes.push({ employeeId: p.id, name: p.name, employeeCode: p.code, activationCode: formatCode(code), emailedTo: emailed ? to : null });
  }
  res.json({ company: org, portalUrl: portalUrl(), expiresAt: expires, codes });
});

/** Switch the portal or phone punching on or off for people, or set the one site they must punch at. */
portalAdminRouter.put(`${base}/portal-access`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1, 'Pick someone.').max(1000),
      portalEnabled: z.boolean().optional(),
      mobilePunch: z.boolean().optional(),
      /* SITE: only inside a work site. FIELD: anywhere, recorded and marked outside a site. */
      phonePunchMode: z.enum(['SITE', 'FIELD']).optional(),
      selfieRequired: z.boolean().optional(),
      geofenceId: z.string().min(1).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the change.' });
  const { employeeIds, ...change } = parsed.data;
  if (change.geofenceId) {
    const f = await peoplePrisma.geofence.findFirst({ where: { id: change.geofenceId, orgId } });
    if (!f) return res.status(400).json({ error: 'That site is not in this organisation.' });
  }
  /* Switching the portal off ends their sessions and any unused code; the password is kept for when it is switched back on. */
  const data: any = { ...change, ...(change.portalEnabled === false ? { portalSetupHash: null, portalSetupExpires: null } : {}) };
  const r = await peoplePrisma.employee.updateMany({ where: { accountId, orgId, id: { in: employeeIds } }, data });
  /* A-33: switched off, their devices are ended on record too. */
  if (change.portalEnabled === false) {
    for (const id of employeeIds) await endPortalSessions({ id, accountId, orgId }, 'employee app switched off', actorFrom(req));
  }
  res.json({ updated: r.count });
});

/** Forget someone's portal password and any code: they need a new activation code to get back in. */
portalAdminRouter.post(`${base}/portal-access/:employeeId/reset`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.employee.updateMany({
    where: { accountId, orgId, id: String(req.params.employeeId) },
    data: { portalPasswordHash: null, portalPasswordSetAt: null, portalSetupHash: null, portalSetupExpires: null },
  });
  if (!r.count) return res.status(404).json({ error: 'No such employee.' });
  /* A-33: their devices are ended on record too, not only by the password check. */
  await endPortalSessions({ id: String(req.params.employeeId), accountId, orgId }, 'portal password reset by HR', actorFrom(req));
  res.json({ ok: true });
});

/**
 * Sign someone out of the employee app on every device (A-33): a lost phone,
 * a shared one. Unlike resetting the password, they can sign straight back in
 * with the password they have.
 */
portalAdminRouter.post(`${base}/portal-access/:employeeId/sign-out-everywhere`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const e = await peoplePrisma.employee.findFirst({ where: { accountId, orgId, id: String(req.params.employeeId) }, select: { id: true, accountId: true, orgId: true, name: true } });
  if (!e) return res.status(404).json({ error: 'No such employee.' });
  const ended = await endPortalSessions(e, 'signed out everywhere by HR', actorFrom(req));
  await recordAudit(req, { entity: 'Employee', entityId: e.id, action: 'SIGN_OUT', message: `Signed ${e.name} out of the employee app on every device`, metadata: { ended } });
  res.json({ ok: true, ended });
});

// ---------------------------------------------------------------------------
// Work sites (geofences)
// ---------------------------------------------------------------------------

const fenceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the site.').max(80),
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
    address: z.string().trim().max(300).nullable().optional(),
    radiusMeters: z.coerce.number().int().min(25, 'At least 25 m — a phone cannot place itself closer than that.').max(5000, 'At most 5 km.'),
    areaId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => validPosition(b.latitude, b.longitude), { message: 'That is not a position on the map.' });

const fenceOut = async (orgId: string, rows: any[]) => {
  const ids = rows.map((r) => r.id);
  const [assigned, areas] = await Promise.all([
    ids.length ? peoplePrisma.employee.groupBy({ by: ['geofenceId'], where: { orgId, geofenceId: { in: ids } }, _count: { _all: true } }) : [],
    peoplePrisma.area.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const area = new Map(areas.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ ...r, areaName: r.areaId ? area.get(r.areaId) || null : null, people: (assigned as any[]).find((a) => a.geofenceId === r.id)?._count._all || 0 }));
};

const areaOk = async (orgId: string, areaId: string | null | undefined) => {
  if (!areaId) return;
  const a = await peoplePrisma.area.findFirst({ where: { id: areaId, orgId }, select: { id: true } });
  if (!a) throw Object.assign(new Error('That area is not in this organisation.'), { status: 400 });
};

portalAdminRouter.get(`${base}/geofences`, can(PermissionAction.VIEW), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = await peoplePrisma.geofence.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  res.json({ geofences: await fenceOut(orgId, rows) });
});

portalAdminRouter.post(`${base}/geofences`, can(PermissionAction.CREATE), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = fenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the site.' });
  try {
    await areaOk(orgId, parsed.data.areaId);
    const row = await peoplePrisma.geofence.create({ data: { accountId, orgId, ...parsed.data, address: parsed.data.address || null, areaId: parsed.data.areaId || null, createdByUserId: req.auth!.userId } });
    res.status(201).json({ geofence: (await fenceOut(orgId, [row]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

portalAdminRouter.put(`${base}/geofences/:id`, can(PermissionAction.EDIT), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.geofence.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such site.' });
  const parsed = fenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the site.' });
  try {
    await areaOk(orgId, parsed.data.areaId);
    const row = await peoplePrisma.geofence.update({ where: { id: existing.id }, data: { ...parsed.data, address: parsed.data.address === undefined ? undefined : parsed.data.address || null, areaId: parsed.data.areaId || null } });
    res.json({ geofence: (await fenceOut(orgId, [row]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

/** Address search for a new site: suggestions as the person types, near the company's other sites. */
portalAdminRouter.get(`${base}/geocode`, can(PermissionAction.VIEW), ...geocodeLimiter, async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const q = String(req.query.q || '');
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  let near = Number.isFinite(lat) && Number.isFinite(lon) && req.query.lat !== undefined ? { lat, lon } : undefined;
  if (!near) {
    const any = await peoplePrisma.geofence.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { latitude: true, longitude: true } });
    if (any) near = { lat: any.latitude, lon: any.longitude };
  }
  res.json({ places: await searchPlaces(q, near) });
});

/** What is at a point, for when the pin is moved by hand. */
portalAdminRouter.get(`${base}/geocode/reverse`, can(PermissionAction.VIEW), ...geocodeLimiter, async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!validPosition(lat, lon)) return res.status(400).json({ error: 'That is not a position on the map.' });
  res.json({ place: await placeAt(lat, lon) });
});

/** Only a site nobody is tied to and nobody has punched at; otherwise switch it off. */
portalAdminRouter.delete(`${base}/geofences/:id`, can(PermissionAction.DELETE), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.geofence.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such site.' });
  const [people, punches] = await Promise.all([
    peoplePrisma.employee.count({ where: { orgId, geofenceId: existing.id } }),
    peoplePrisma.devicePunch.count({ where: { orgId, geofenceId: existing.id } }),
  ]);
  if (people || punches) return res.status(409).json({ error: 'People are tied to this site or have punched at it. Switch it off instead, so their history keeps its name.' });
  await peoplePrisma.geofence.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Punch selfies
// ---------------------------------------------------------------------------

/** The selfie taken with a phone punch — for whoever may see readers' transactions. */
portalAdminRouter.get(
  `${base}/punch-photos/:id`,
  requirePermission(ATTENDANCE_MODULE, PermissionAction.VIEW as any, ATTENDANCE_RESOURCE.devices),
  async (req, res) => {
    if (!(await hrOrAttendanceRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    const photo = await peoplePrisma.punchPhoto.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
    if (!photo) return res.status(404).json({ error: 'This photo is not kept any more.' });
    /* As a data URL in JSON, so the app fetches it like everything else (its session, its refresh). */
    res.set('Cache-Control', 'private, no-store').json({ photo: `data:${photo.mime};base64,${Buffer.from(photo.data).toString('base64')}`, takenAt: photo.createdAt });
  }
);


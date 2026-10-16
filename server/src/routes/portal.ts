import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { isDevOrTest } from '../utils/devMode.js';
import { isFeatureEnabled } from '../services/features.js';
import { portalLimiter } from '../middleware/rateLimit.js';
import { isWeeklyOff, istDate, istTime } from '../services/attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { emit as emitWebhook } from '../services/attendance/webhooks.js';
import {
  MAX_ACCURACY_M,
  MIN_GAP_MS,
  decodePhoto,
  describeDistance,
  matchFence,
  nextDirection,
  normaliseCode,
  passwordProblem,
  validPosition,
} from '../services/attendance/portal.js';
import { createRequest, daysOfMonth, sendError, today, withNames } from './attendance.js';
import { balancesFor, cancelOwnLeave, createLeave, withTypes } from './leave.js';
import { recomputeDeviceDay, shiftDayFor } from './iclock.js';

/**
 * The employee portal (ClorTime's /portal): staff without a CLOR user sign in
 * with company code + employee code + a password they chose themselves, see
 * their attendance, schedule and leave, ask for corrections and leave, and —
 * when HR allows it — punch from their phone inside a work site.
 *
 * Its own realm. A portal token is signed for the "clor-portal" audience, so it
 * is no use against /api (which wants "accounting-web"), and an ordinary sign-in
 * is no use here. Each request re-reads the employee: switching the portal off,
 * the person leaving, or a new password ends every token they hold.
 *
 * HR never knows the password: they hand out a one-time activation code
 * (Attendance → Portal access), valid 24 hours, and the person sets their own.
 */
export const portalRouter = Router();

const AUDIENCE = 'clor-portal';
const ISSUER = () => process.env.JWT_ISSUER || 'accounting';
const secret = () => process.env.JWT_SECRET || (isDevOrTest() ? 'dev-secret' : '');
/** One answer for every failed sign-in, so it does not tell which part was wrong. */
const WRONG = 'Company code, employee code or password is not right.';
const WRONG_CODE = 'That activation code is not right or has run out. Ask HR for a new one.';
const ROUNDS = 10;
/** verifyMode for a phone punch (readers use 0–25). */
export const PHONE_VERIFY = 100;

type PortalUser = { employeeId: string; accountId: string; orgId: string };
declare module 'express-serve-static-core' {
  interface Request {
    portal?: PortalUser & { employee: any };
  }
}

const PORTAL_FIELDS = {
  id: true,
  accountId: true,
  orgId: true,
  name: true,
  code: true,
  department: true,
  designation: true,
  photoUrl: true,
  status: true,
  branchId: true,
  areaId: true,
  devicePin: true,
  portalEnabled: true,
  portalPasswordHash: true,
  portalPasswordSetAt: true,
  portalSetupHash: true,
  portalSetupExpires: true,
  mobilePunch: true,
  geofenceId: true,
} as const;

const sign = (e: { id: string; accountId: string; orgId: string; portalPasswordSetAt: Date | null }) =>
  jwt.sign({ typ: 'portal', employeeId: e.id, accountId: e.accountId, orgId: e.orgId, pv: e.portalPasswordSetAt?.getTime() || 0 }, secret(), {
    expiresIn: (process.env.PORTAL_TOKEN_TTL || '30d') as any,
    issuer: ISSUER(),
    audience: AUDIENCE,
  });

/** The employee a company code + employee code names, if exactly one does. */
async function findEmployee(company: unknown, employeeCode: unknown) {
  const companyCode = String(company || '').trim().toUpperCase();
  const code = String(employeeCode || '').trim();
  if (!companyCode || !code || companyCode.length > 40 || code.length > 40) return null;
  const org = await platformPrisma.org.findUnique({ where: { code: companyCode }, select: { id: true, accountId: true, name: true } });
  if (!org) return null;
  const rows = await peoplePrisma.employee.findMany({
    where: { orgId: org.id, accountId: org.accountId, code: { equals: code, mode: 'insensitive' }, status: { not: 'LEFT' } },
    select: PORTAL_FIELDS,
    take: 2,
  });
  if (rows.length !== 1) return null;
  if (!(await isFeatureEnabled(org.accountId, org.id, 'attendance'))) return null;
  return { org, employee: rows[0] };
}

/* A hash to compare against when there is no one, so a wrong employee code takes as long as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('not-a-password-0', ROUNDS);

portalRouter.post('/login', ...portalLimiter, async (req, res) => {
  const found = await findEmployee(req.body?.company, req.body?.employeeCode);
  const e = found?.employee;
  const ok = await bcrypt.compare(String(req.body?.password || ''), e?.portalPasswordHash || DUMMY_HASH);
  if (!found || !e || !ok || !e.portalEnabled || !e.portalPasswordHash) return res.status(401).json({ error: WRONG });
  res.json({ token: sign(e), employee: { name: e.name, code: e.code }, company: { name: found.org.name } });
});

/** First sign-in: the activation code from HR, and the person's own password. */
portalRouter.post('/activate', ...portalLimiter, async (req, res) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  const found = await findEmployee(req.body?.company, req.body?.employeeCode);
  const e = found?.employee;
  const ok = await bcrypt.compare(normaliseCode(req.body?.activationCode), e?.portalSetupHash || DUMMY_HASH);
  if (!found || !e || !ok || !e.portalEnabled || !e.portalSetupHash || !e.portalSetupExpires || e.portalSetupExpires < new Date()) {
    return res.status(401).json({ error: WRONG_CODE });
  }
  const updated = await peoplePrisma.employee.update({
    where: { id: e.id },
    data: { portalPasswordHash: await bcrypt.hash(String(req.body.password), ROUNDS), portalPasswordSetAt: new Date(), portalSetupHash: null, portalSetupExpires: null },
    select: PORTAL_FIELDS,
  });
  res.json({ token: sign(updated), employee: { name: updated.name, code: updated.code }, company: { name: found.org.name } });
});

async function authenticate(req: Request, res: Response, next: NextFunction) {
  const h = String(req.get('authorization') || '');
  const token = /^bearer /i.test(h) ? h.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in first.', code: 'PORTAL_SIGNIN' });
  let claims: any;
  try {
    claims = jwt.verify(token, secret(), { issuer: ISSUER(), audience: AUDIENCE });
  } catch {
    return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  }
  if (claims?.typ !== 'portal') return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  const e = await peoplePrisma.employee.findFirst({ where: { id: String(claims.employeeId), orgId: String(claims.orgId), accountId: String(claims.accountId) }, select: PORTAL_FIELDS });
  /* Switched off, left, or a new password since this token: it is over. */
  if (!e || !e.portalEnabled || e.status === 'LEFT' || !e.portalPasswordHash || (e.portalPasswordSetAt?.getTime() || 0) !== claims.pv) {
    return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  }
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'attendance'))) return res.status(403).json({ error: 'Attendance is not switched on for your company.' });
  req.portal = { employeeId: e.id, accountId: e.accountId, orgId: e.orgId, employee: e };
  next();
}

portalRouter.use(authenticate);

const who = (req: Request) => ({ accountId: req.portal!.accountId, orgId: req.portal!.orgId, userId: `portal:${req.portal!.employeeId}` });
const monthParam = (v: unknown) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : today().slice(0, 7));

/** Sites this person may punch at: their own, else any active one for everyone or for their area. */
async function sitesFor(e: { orgId: string; geofenceId: string | null; areaId: string | null }) {
  if (e.geofenceId) {
    const own = await peoplePrisma.geofence.findFirst({ where: { id: e.geofenceId, orgId: e.orgId, isActive: true } });
    return own ? [own] : [];
  }
  return peoplePrisma.geofence.findMany({
    where: { orgId: e.orgId, isActive: true, OR: [{ areaId: null }, ...(e.areaId ? [{ areaId: e.areaId }] : [])] },
    orderBy: { name: 'asc' },
  });
}

const holidayName = (rows: Array<{ date: string; name: string; areaId: string | null }>, date: string, areaId: string | null) =>
  rows.find((h) => h.date === date && (!h.areaId || h.areaId === areaId))?.name || null;

const nowLocal = (at: Date) => `${istDate(at)} ${new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 19)}`;

/** Today at a glance: shift, the day so far, and whether the phone may punch. */
portalRouter.get('/me', async (req, res) => {
  const e = req.portal!.employee;
  const t = today();
  const [org, schedule, holidays, record, sites] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: e.orgId }, select: { name: true, code: true } }),
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, t, t),
    peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: e.id, date: t } } }),
    e.mobilePunch ? sitesFor(e) : Promise.resolve([]),
  ]);
  const shift = resolveShift(schedule, e.id, t);
  const shiftDay = await shiftDayFor(e.orgId, e.id, nowLocal(new Date()));
  const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, shiftDate: shiftDay }, orderBy: { at: 'asc' } });
  const fenceNames = new Map(sites.map((s) => [s.id, s.name]));
  res.json({
    employee: { name: e.name, code: e.code, department: e.department, designation: e.designation, photoUrl: e.photoUrl },
    company: { name: org?.name || '', code: org?.code || '' },
    today: t,
    shift: {
      name: shift.name,
      startTime: shift.rule.startTime,
      endTime: shift.rule.endTime,
      off: isWeeklyOff(shift.rule, t),
      holiday: holidays.forArea(e.areaId, e.branchId).has(t) ? holidayName(holidays.rows, t, e.areaId) || 'Holiday' : null,
    },
    record: record ? (await withNames(e.orgId, [record]))[0] : null,
    punches: punches.map((p) => ({ time: p.localTime.slice(11, 16), kind: p.kind, phone: p.latitude != null, site: p.geofenceId ? fenceNames.get(p.geofenceId) || null : null })),
    phone: {
      allowed: Boolean(e.mobilePunch),
      next: nextDirection(punches),
      sites: sites.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, radiusMeters: s.radiusMeters })),
    },
  });
});

/**
 * A punch from the phone. The server's clock, never the phone's; the position
 * must be inside one of the person's sites; a selfie is kept if sent but never
 * required (a camera that will not open must not stop someone punching).
 */
portalRouter.post('/punch', async (req, res) => {
  const e = req.portal!.employee;
  if (!e.mobilePunch) return res.status(403).json({ error: 'Punching from your phone is not switched on for you. Ask HR.', code: 'PHONE_OFF' });
  const { latitude, longitude } = req.body || {};
  const accuracy = typeof req.body?.accuracy === 'number' && Number.isFinite(req.body.accuracy) ? req.body.accuracy : null;
  if (!validPosition(latitude, longitude)) return res.status(400).json({ error: 'Your location did not come through. Allow location for this site and try again.', code: 'NO_LOCATION' });
  if (accuracy != null && accuracy > MAX_ACCURACY_M) {
    return res.status(400).json({ error: `Your location is only accurate to ${describeDistance(accuracy)}. Turn on precise location, or step outside, and try again.`, code: 'ROUGH_LOCATION' });
  }
  const sites = await sitesFor(e);
  if (!sites.length) return res.status(409).json({ error: 'No work site is set up for your phone punches yet. Ask HR.', code: 'NO_SITE' });
  const { inside, nearest } = matchFence({ latitude, longitude }, sites);
  if (!inside) {
    return res.status(403).json({
      error: `You are ${describeDistance(nearest!.distance)} from ${nearest!.fence.name}. Punch from within ${describeDistance(nearest!.fence.radiusMeters)} of it.`,
      code: 'OUTSIDE',
    });
  }
  const photo = decodePhoto(req.body?.photo);
  if (photo && 'error' in photo) return res.status(400).json({ error: photo.error, code: 'BAD_PHOTO' });

  const at = new Date();
  const localTime = nowLocal(at);
  const shiftDate = await shiftDayFor(e.orgId, e.id, localTime);
  const today_ = await peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, shiftDate }, orderBy: { at: 'asc' }, select: { at: true, kind: true } });
  const last = today_[today_.length - 1];
  if (last && at.getTime() - last.at.getTime() < MIN_GAP_MS) return res.status(409).json({ error: 'You punched less than a minute ago.', code: 'TOO_SOON' });
  const kind = nextDirection(today_);

  /* Phone punches sit under one "reader" per company, so Transactions and reports show them like any other. */
  const serialNumber = `MOBILE-${e.orgId}`;
  const device = await peoplePrisma.attendanceDevice.upsert({
    where: { serialNumber },
    create: { accountId: e.accountId, orgId: e.orgId, serialNumber, name: 'Phone punches', vendor: 'MOBILE', createdByUserId: 'portal' },
    update: { lastSeenAt: at },
  });
  const saved = photo ? await peoplePrisma.punchPhoto.create({ data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, mime: photo.mime, data: photo.data } }) : null;
  await peoplePrisma.devicePunch.create({
    data: {
      accountId: e.accountId,
      orgId: e.orgId,
      deviceId: device.id,
      serialNumber,
      pin: e.devicePin || e.code || e.id,
      at,
      localTime,
      state: kind === 'IN' ? '0' : '1',
      kind,
      verifyMode: PHONE_VERIFY,
      employeeId: e.id,
      shiftDate,
      latitude,
      longitude,
      accuracyM: accuracy,
      geofenceId: inside.fence.id,
      photoId: saved?.id || null,
    },
  });
  emitWebhook(e.orgId, 'punch', {
    reader: serialNumber,
    punches: [{ readerId: e.devicePin || e.code, employeeId: e.id, time: localTime, direction: kind, verifyMode: PHONE_VERIFY, site: inside.fence.name }],
  });
  await recomputeDeviceDay(e.accountId, e.orgId, { id: e.id, branchId: e.branchId, areaId: e.areaId }, shiftDate);
  res.status(201).json({ kind, time: istTime(at), site: inside.fence.name, distance: Math.round(inside.distance), photo: Boolean(saved) });
});

/** A month of one's own days, with the month's figures. */
portalRouter.get('/attendance', async (req, res) => {
  const e = req.portal!.employee;
  const month = monthParam(req.query.month);
  const days = daysOfMonth(month);
  const [records, requests] = await Promise.all([
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: days[0], lte: days[days.length - 1] } }, orderBy: { date: 'asc' } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const shaped = await withNames(e.orgId, records);
  const count = (s: string) => records.filter((r) => r.status === s).length;
  res.json({
    month,
    days: shaped.map((r) => ({ date: r.date, status: r.status, checkIn: r.checkInTime, checkOut: r.checkOutTime, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes, earlyOutMinutes: r.earlyOutMinutes, overtimeMinutes: r.overtimeMinutes })),
    totals: { present: count('PRESENT'), halfDay: count('HALF_DAY'), absent: count('ABSENT'), leave: count('ON_LEAVE'), late: records.filter((r) => (r.lateMinutes || 0) > 0).length },
    corrections: requests.map((r) => ({ id: r.id, date: r.date, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null, reason: r.reason, status: r.status, note: r.reviewNote })),
  });
});

/** Ask for a day to be corrected (a missed punch, a reader that was down). */
portalRouter.post('/corrections', async (req, res) => {
  try {
    return await createRequest(req, res, req.portal!.employeeId, who(req));
  } catch (err) {
    return sendError(res, err);
  }
});

/** What shift each day of the month is, weekly offs, holidays and leave. */
portalRouter.get('/schedule', async (req, res) => {
  const e = req.portal!.employee;
  const month = monthParam(req.query.month);
  const days = daysOfMonth(month);
  const [schedule, holidays, leave] = await Promise.all([
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, days[0], days[days.length - 1]),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: days[0], lte: days[days.length - 1] }, status: 'ON_LEAVE' }, select: { date: true } }),
  ]);
  const onLeave = new Set(leave.map((l) => l.date));
  const mine = holidays.forArea(e.areaId, e.branchId);
  res.json({
    month,
    days: days.map((d) => {
      const r = resolveShift(schedule, e.id, d);
      const kind = onLeave.has(d) ? 'LEAVE' : mine.has(d) ? 'HOLIDAY' : isWeeklyOff(r.rule, d) ? 'OFF' : 'WORK';
      return { date: d, kind, shift: r.name, startTime: r.rule.startTime, endTime: r.rule.endTime, color: r.color, holiday: kind === 'HOLIDAY' ? holidayName(holidays.rows, d, e.areaId) : null };
    }),
  });
});

portalRouter.get('/leave', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  const y = Number(req.query.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(today().slice(0, 4));
  const { types, balances } = await balancesFor(accountId, orgId, [employeeId], year);
  const mine = balances.get(employeeId)!;
  const requests = await peoplePrisma.leaveRequest.findMany({
    where: { accountId, orgId, employeeId, fromDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({
    year,
    today: today(),
    types: types.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, ...mine.get(t.id) })),
    requests: (await withTypes(orgId, requests)).map((r) => ({ id: r.id, leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, reason: r.reason, status: r.status })),
  });
});

portalRouter.post('/leave', async (req, res) => {
  try {
    return await createLeave(req, res, req.portal!.employee, who(req));
  } catch (err) {
    return sendError(res, err);
  }
});

portalRouter.post('/leave/:id/cancel', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  const out = await cancelOwnLeave(accountId, orgId, employeeId, String(req.params.id));
  res.status(out.status).json(out.body);
});

/** A new password ends every other session; this one gets a fresh token. */
portalRouter.post('/password', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await bcrypt.compare(String(req.body?.current || ''), e.portalPasswordHash))) return res.status(400).json({ error: 'Your current password is not right.' });
  const problem = passwordProblem(req.body?.next);
  if (problem) return res.status(400).json({ error: problem });
  const updated = await peoplePrisma.employee.update({
    where: { id: e.id },
    data: { portalPasswordHash: await bcrypt.hash(String(req.body.next), ROUNDS), portalPasswordSetAt: new Date() },
    select: PORTAL_FIELDS,
  });
  res.json({ token: sign(updated) });
});

portalRouter.use((_req, res) => res.status(404).json({ error: 'No such page.' }));

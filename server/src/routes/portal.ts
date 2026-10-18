import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { notifyPermission } from '../services/notifications.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { DeclarationError, financialYearOf, saveDeclaration, shapeDeclaration } from '../services/payroll/taxDeclaration.js';
import { isDevOrTest } from '../utils/devMode.js';
import { isFeatureEnabled } from '../services/features.js';
import { portalLimiter } from '../middleware/rateLimit.js';
import { isWeeklyOff, istDate, istTime } from '../services/attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { phoneStatus, recordPhonePunch } from '../services/attendance/phonePunch.js';
import { normaliseCode, passwordProblem } from '../services/attendance/portal.js';
import { chainFor } from '../services/attendance/approvalChain.js';
import { createRequest, daysOfMonth, reviewCorrection, sendError, today, withNames } from './attendance.js';
import { approveLeave, balancesFor, cancelOwnLeave, createLeave, rejectLeave, withTypes } from './leave.js';
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


const holidayName = (rows: Array<{ date: string; name: string; areaId: string | null }>, date: string, areaId: string | null) =>
  rows.find((h) => h.date === date && (!h.areaId || h.areaId === areaId))?.name || null;


/** Today at a glance: shift, the day so far, and whether the phone may punch. */
portalRouter.get('/me', async (req, res) => {
  const e = req.portal!.employee;
  const t = today();
  const [org, schedule, holidays, record] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: e.orgId }, select: { name: true, code: true } }),
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, t, t),
    peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: e.id, date: t } } }),
  ]);
  const shift = resolveShift(schedule, e.id, t);
  const status = await phoneStatus(e);
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
    punches: status.punches,
    phone: status.phone,
    /* Anyone reporting to this person makes them an approver: the portal shows the Approvals tab. */
    approver: (await peoplePrisma.employee.count({ where: { orgId: e.orgId, reportingManagerId: e.id, status: { not: 'LEFT' } } })) > 0,
  });
});

/**
 * A punch from the phone. The server's clock, never the phone's; the position
 * must be inside one of the person's sites; a selfie is kept if sent but never
 * required (a camera that will not open must not stop someone punching).
 */
portalRouter.post('/punch', async (req, res) => {
  const out = await recordPhonePunch(req.portal!.employee, req.body);
  res.status(out.status).json(out.body);
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

// ---------------------------------------------------------------------------
// Approvals: what the people reporting to me are waiting on (ClorTime's portal Approvals)
// ---------------------------------------------------------------------------

/** The employees whose "Reports to" is this person. */
async function reportees(e: { orgId: string; id: string }) {
  return peoplePrisma.employee.findMany({ where: { orgId: e.orgId, reportingManagerId: e.id, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true } });
}

portalRouter.get('/approvals', async (req, res) => {
  const e = req.portal!.employee;
  const team = await reportees(e);
  const ids = team.map((t) => t.id);
  const names = new Map(team.map((t) => [t.id, t]));
  const [leaves, corrections] = ids.length
    ? await Promise.all([
        peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
        peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
      ])
    : [[], []];
  const who = (id: string) => ({ employeeName: names.get(id)?.name || '', employeeCode: names.get(id)?.code || null });
  /* What the manager already passed to HR is HR's now, not theirs to decide again. */
  const [leaveChain, correctionChain] = await Promise.all([chainFor(e.orgId, 'leave'), chainFor(e.orgId, 'correction')]);
  res.json({
    approver: ids.length > 0,
    team: team.length,
    chain: { leave: leaveChain, correction: correctionChain },
    leaves: (await withTypes(e.orgId, leaves.filter((r) => !r.managerApprovedAt))).map((r) => ({ id: r.id, type: 'leave', ...who(r.employeeId), leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, reason: r.reason, askedAt: r.createdAt })),
    corrections: corrections.filter((r) => !r.managerApprovedAt).map((r) => ({ id: r.id, type: 'correction', ...who(r.employeeId), date: r.date, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null, reason: r.reason, askedAt: r.createdAt })),
  });
});

/**
 * Approve or reject one request. The right to decide is checked here, on this
 * request — the list is a convenience, anyone can post an id — and a request
 * already decided is a conflict, not a silent overwrite: two approvers opening
 * the same queue is normal, and the second should be told.
 */
portalRouter.post('/approvals/:type/:id', async (req, res) => {
  const e = req.portal!.employee;
  const type = String(req.params.type);
  const decision = String(req.body?.decision || '');
  if (!['leave', 'correction'].includes(type)) return res.status(400).json({ error: 'Unknown request type.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  const id = String(req.params.id);
  const r: any =
    type === 'leave'
      ? await peoplePrisma.leaveRequest.findFirst({ where: { id, orgId: e.orgId } })
      : await peoplePrisma.attendanceRequest.findFirst({ where: { id, orgId: e.orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  const owner = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId: e.orgId }, select: { reportingManagerId: true } });
  if (owner?.reportingManagerId !== e.id) return res.status(403).json({ error: 'This request is not yours to decide.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${String(r.status).toLowerCase()}.` });
  try {
    const userId = `portal:${e.id}`;
    const chain = await chainFor(e.orgId, type as 'leave' | 'correction');
    if (decision === 'approve' && chain === 'MANAGER_THEN_HR') {
      /* The manager's step: recorded, and the request moves on to HR still pending. */
      if (r.managerApprovedAt) return res.status(409).json({ error: 'You have already approved this; it is with HR now.' });
      const data = { managerApprovedAt: new Date(), managerApprovedById: e.id, reviewNote: note };
      const out = type === 'leave' ? await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data }) : await peoplePrisma.attendanceRequest.update({ where: { id: r.id }, data });
      return res.json({ request: out, stage: 'HR' });
    }
    if (type === 'leave') {
      const out = decision === 'approve' ? await approveLeave(e.accountId, e.orgId, r, userId, note) : await rejectLeave(e.orgId, r, userId, note);
      return res.json({ request: out });
    }
    const out = await reviewCorrection(e.accountId, e.orgId, r, decision === 'approve', userId, note);
    return res.json({ request: out });
  } catch (err) {
    return sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// My documents and my data (DPDP)
// ---------------------------------------------------------------------------

portalRouter.get('/documents', async (req, res) => {
  const e = req.portal!.employee;
  const rows = await peoplePrisma.employeeDocument.findMany({ where: { orgId: e.orgId, employeeId: e.id, visibleToEmployee: true }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, title: true, mime: true, size: true, expiresOn: true, createdAt: true } });
  res.json({ documents: rows });
});

portalRouter.get('/documents/:id', async (req, res) => {
  const e = req.portal!.employee;
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id, visibleToEmployee: true } });
  if (!d) return res.status(404).json({ error: 'No such document.' });
  res.json({ document: { id: d.id, title: d.title, mime: d.mime, size: d.size, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` } });
});

const DATA_REQUEST_TYPES = new Set(['ACCESS', 'CORRECTION', 'ERASURE']);

portalRouter.get('/data-requests', async (req, res) => {
  const e = req.portal!.employee;
  const rows = await peoplePrisma.dataRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, type: true, details: true, status: true, resolution: true, createdAt: true, reviewedAt: true } });
  res.json({ requests: rows });
});

/** See my data, correct it, or erase it — a right under the DPDP Act; HR answers under Personnel → Data requests. */
portalRouter.post('/data-requests', async (req, res) => {
  const e = req.portal!.employee;
  const type = String(req.body?.type || '').toUpperCase();
  if (!DATA_REQUEST_TYPES.has(type)) return res.status(400).json({ error: 'Ask to see, correct or erase your data.' });
  const details = String(req.body?.details || '').trim().slice(0, 2000);
  if (!details) return res.status(400).json({ error: 'Say what you are asking for.' });
  const open = await peoplePrisma.dataRequest.count({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING' } });
  if (open >= 3) return res.status(409).json({ error: 'You already have three requests waiting. HR will answer those first.' });
  const r = await peoplePrisma.dataRequest.create({ data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, type, details } });
  await notifyPermission(e.accountId, e.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.data_request', title: `${e.name} asked to ${type === 'ACCESS' ? 'see' : type === 'ERASE' ? 'erase' : 'correct'} their personal data`, body: details || null, link: { app: 'attendance', screen: 'dataRequests' } });
  res.status(201).json({ request: r });
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

/**
 * Income tax: the regime chosen for the year and what is declared under the
 * old one (services/payroll/taxDeclaration.ts). Only where the company runs
 * payroll in CLOR and pays this person through it.
 */
async function paidHere(e: { accountId: string; orgId: string; id: string }) {
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'payroll'))) return false;
  return !!(await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId: e.orgId, employeeId: e.id, payrollStatus: 'IN_PAYROLL' }, select: { id: true } }));
}

portalRouter.get('/tax', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await paidHere(e))) return res.json({ available: false });
  const financialYear = financialYearOf(today());
  const row = await payrollPrisma.taxDeclaration.findUnique({ where: { orgId_employeeId_financialYear: { orgId: e.orgId, employeeId: e.id, financialYear } } });
  res.json({ available: true, declaration: shapeDeclaration(row, e.id, financialYear) });
});

portalRouter.put('/tax', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await paidHere(e))) return res.status(404).json({ error: 'Your company does not run payroll here.' });
  const financialYear = financialYearOf(today());
  try {
    const row = await saveDeclaration({ accountId: e.accountId, orgId: e.orgId }, e.id, financialYear, req.body, { userId: who(req).userId, asEmployee: true });
    res.json({ available: true, declaration: shapeDeclaration(row, e.id, financialYear) });
  } catch (err) {
    if (err instanceof DeclarationError) return res.status(err.status).json({ error: err.message, code: err.code });
    throw err;
  }
});

portalRouter.use((_req, res) => res.status(404).json({ error: 'No such page.' }));

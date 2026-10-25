import { checkPortalSession, endPortalSession, endPortalSessions, legacyCutoff, listPortalSessions, startPortalSession } from '../services/portalSessions.js';
import { orgByCode } from '../services/displayCodes.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { explainFor, leaveExplain, reviewFieldPunch } from './attendanceInsights.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { notifyPermission } from '../services/notifications.js';
import { privacyNoticeFor } from '../services/attendance/privacyNotice.js';
import { clearBiometricPolicy } from '../services/attendance/biometrics.js';
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
import { askOvertime, attentionFor, chainsFor, confirmMonth, decideOvertime, monthReview, overtimeFor, timelineOf, upcomingShifts } from '../services/attendance/selfService.js';
import { createRequest } from './attendance.js';
import { REASON_CODES, reviewCorrection } from '../services/attendance/corrections.js';
import { daysOfMonth, instants, sendError, today, withNames } from '../services/attendance/days.js';
import { approveLeave, cancelOwnLeave, createLeave, rejectLeave, withTypes } from './leave.js';
import { balancesFor, leavePeriodOf, leaveYearOf } from '../services/attendance/leaveBalances.js';
import { periodEnd, periodStart } from '../services/attendance/leaveAccrual.js';
import { recomputeDeviceDay, shiftDayFor } from '../services/attendance/punches.js';
import { enterTenant, outsideTenant, runInTenant } from '../utils/tenantScope.js';

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
const PAUSED = 'Your app access is paused; please ask HR.';
const deviceOf = (req: Request) => ({ ua: String(req.get('user-agent') || ''), ip: req.ip ? String(req.ip) : null });
const ROUNDS = 10;

type PortalUser = { employeeId: string; accountId: string; orgId: string };
declare module 'express-serve-static-core' {
  interface Request {
    portal?: PortalUser & { employee: any; sid?: string | null };
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
  portalSessionsRevokedAt: true,
  mobilePunch: true,
  geofenceId: true,
  dateOfBirth: true,
  phonePunchMode: true,
  selfieRequired: true,
  biometricOptOutAt: true,
  privacyNoticeVersion: true,
  personalEmail: true,
  workEmail: true,
  reportingManagerId: true,
} as const;

/* The token keeps the shape the apps already store; `sid` names its session row (A-33). */
const sign = (e: { id: string; accountId: string; orgId: string; portalPasswordSetAt: Date | null }, sid: string) =>
  jwt.sign({ typ: 'portal', employeeId: e.id, accountId: e.accountId, orgId: e.orgId, pv: e.portalPasswordSetAt?.getTime() || 0, sid }, secret(), {
    expiresIn: (process.env.PORTAL_TOKEN_TTL || '30d') as any,
    issuer: ISSUER(),
    audience: AUDIENCE,
  });

/** The employee a company code + employee code names, if exactly one does. */
async function findEmployee(company: unknown, employeeCode: unknown) {
  const companyCode = String(company || '').trim().toUpperCase();
  const code = String(employeeCode || '').trim();
  if (!companyCode || !code || companyCode.length > 40 || code.length > 40) return null;
  /* The company code is how the company is found (A-35); the employee is then looked for inside it. */
  const org = await outsideTenant('portal: which company this code names', () => orgByCode(companyCode, { id: true, accountId: true, name: true })) as { id: string; accountId: string; name: string } | null;
  if (!org) return null;
  const rows = await runInTenant(org.id, () => peoplePrisma.employee.findMany({
    where: { orgId: org.id, accountId: org.accountId, code: { equals: code, mode: 'insensitive' }, status: { not: 'LEFT' } },
    select: PORTAL_FIELDS,
    take: 2,
  }));
  if (rows.length !== 1) return null;
  /* A-11: switched on and paid for, and the company not closing — the same answer staff routes give. */
  if (await anyAppLive(org.accountId, org.id, ['people', 'attendance'])) return null;
  return { org, employee: rows[0] };
}

/* A hash to compare against when there is no one, so a wrong employee code takes as long as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('not-a-password-0', ROUNDS);

/**
 * Forgot my password: there is no e-mail to send a link to for most employees,
 * so HR is told and gives a new activation code ("First time" in the app).
 * The answer is the same whether or not the person exists.
 */
portalRouter.post('/forgot', ...portalLimiter, async (req, res) => {
  const found = await findEmployee(req.body?.company, req.body?.employeeCode);
  /* The rest of this request runs as the employee's company (A-35). */
  if (found) enterTenant(found.org.id);
  if (found?.employee?.portalEnabled) {
    const e = found.employee;
    await notifyPermission(e.accountId, e.orgId, 'ATTENDANCE::Employee Portal::EDIT', {
      kind: 'attendance.portal_forgot',
      title: `${e.name}${e.code ? ` (${e.code})` : ''} forgot their app password`,
      body: 'Give them a new activation code under Portal access; they use it with "First time" in the app.',
      link: { app: 'attendance', screen: 'portalAccess' },
    }).catch(() => null);
  }
  res.json({ ok: true, message: 'If those codes are right, HR has been asked for a new activation code. With it, choose First time and set a new password.' });
});

portalRouter.post('/login', ...portalLimiter, async (req, res) => {
  const found = await findEmployee(req.body?.company, req.body?.employeeCode);
  /* The rest of this request runs as the employee's company (A-35). */
  if (found) enterTenant(found.org.id);
  const e = found?.employee;
  const ok = await bcrypt.compare(String(req.body?.password || ''), e?.portalPasswordHash || DUMMY_HASH);
  if (!found || !e || !ok || !e.portalEnabled || !e.portalPasswordHash) return res.status(401).json({ error: WRONG });
  /* A-33: said only once the password is right, so it tells a stranger nothing. */
  if (e.status === 'SUSPENDED') return res.status(403).json({ error: PAUSED, code: 'PORTAL_PAUSED' });
  const session = await startPortalSession(e, deviceOf(req));
  res.json({ token: sign(e, session.id), employee: { name: e.name, code: e.code }, company: { name: found.org.name } });
});

/** First sign-in: the activation code from HR, and the person's own password. */
portalRouter.post('/activate', ...portalLimiter, async (req, res) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  const found = await findEmployee(req.body?.company, req.body?.employeeCode);
  /* The rest of this request runs as the employee's company (A-35). */
  if (found) enterTenant(found.org.id);
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
  if (updated.status === 'SUSPENDED') return res.status(403).json({ error: PAUSED, code: 'PORTAL_PAUSED' });
  /* A new password ends every earlier sign-in (A-33); this device starts its own. */
  await endPortalSessions(updated, 'password set with an activation code', { type: 'EMPLOYEE', id: updated.id });
  const session = await startPortalSession(updated, deviceOf(req));
  res.json({ token: sign(updated, session.id), employee: { name: updated.name, code: updated.code }, company: { name: found.org.name } });
});

/** Exported so People's own employee-facing routes (routes/peoplePortal.ts) sit behind the same sign-in. */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const h = String(req.get('authorization') || '');
  const token = /^bearer /i.test(h) ? h.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in first.', code: 'PORTAL_SIGNIN' });
  let claims: any;
  try {
    claims = jwt.verify(token, secret(), { issuer: ISSUER(), audience: AUDIENCE, algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  }
  if (claims?.typ !== 'portal') return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  /* The signed token names the company; the employee is looked for inside it (A-35). */
  const e = await runInTenant(String(claims.orgId || ''), () => peoplePrisma.employee.findFirst({ where: { id: String(claims.employeeId), orgId: String(claims.orgId), accountId: String(claims.accountId) }, select: PORTAL_FIELDS }));
  /* Switched off, left, or a new password since this token: it is over. */
  if (!e || !e.portalEnabled || e.status === 'LEFT' || !e.portalPasswordHash || (e.portalPasswordSetAt?.getTime() || 0) !== claims.pv) {
    return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  }
  /* A-33: suspended — signed out, with the reason, so the app clears its token. */
  if (e.status === 'SUSPENDED') return res.status(401).json({ error: PAUSED, code: 'PORTAL_SIGNIN' });
  if (claims.sid) {
    /* A-33: this device's session must still be on — not signed out, not ended by HR, not idle for 30 days, not older than 180. */
    const s = await checkPortalSession(e.orgId, e.id, String(claims.sid));
    if (!s.ok) return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
  } else {
    /* A token from before sessions: refused after the cut-off, or when it predates "sign out everywhere". */
    const issued = Number(claims.iat || 0) * 1000;
    if (Date.now() >= legacyCutoff() || (e.portalSessionsRevokedAt && issued < e.portalSessionsRevokedAt.getTime())) {
      return res.status(401).json({ error: 'Please sign in again.', code: 'PORTAL_SIGNIN' });
    }
  }
  const refused = await anyAppLive(e.accountId, e.orgId, ['people', 'attendance']);
  if (refused) {
    /* Said to an employee, not to the person who pays: what happened and who can fix it. */
    const words = {
      APP_DISABLED: 'The employee app is not switched on for your company.',
      APP_NOT_SUBSCRIBED: 'The employee app is paused for your company. Please ask HR.',
      COMPANY_CLOSING: 'Your company is closing its CLOR account. Please ask HR.',
    } as Record<string, string>;
    return res.status(refused.status).json({ error: words[refused.code] || refused.error, code: refused.code });
  }
  req.portal = { employeeId: e.id, accountId: e.accountId, orgId: e.orgId, employee: e, sid: claims.sid ? String(claims.sid) : null };
  runInTenant(e.orgId, () => next());
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
  const [status, notice] = await Promise.all([phoneStatus(e), privacyNoticeFor(e.orgId)]);
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
    /* A new or changed privacy notice is shown until they have read it. */
    privacy: { version: notice.version, read: e.privacyNoticeVersion === notice.version },
  });
});

/**
 * Everything the phone app's home screen shows, in one answer: who and where
 * (company, site), today (shift, record, punches, phone punch), this month's
 * figures and the last seven days, days that need attention, leave balances,
 * the next holidays, what is waiting on me and on others, and who in my team
 * is away today. One round trip on a slow connection instead of eight.
 */
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

portalRouter.get('/home', async (req, res) => {
  const e = req.portal!.employee;
  const t = today();
  const month = t.slice(0, 7);
  const monthStart = `${month}-01`;
  const weekStart = plusDays(t, -6);
  const from = monthStart < weekStart ? monthStart : weekStart;
  const year = await leaveYearOf(e.orgId, t);
  const [org, area, branch, schedule, holidays, records, record, status, notice, leave, myLeave, myCorrections, team] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: e.orgId }, select: { name: true, code: true } }),
    e.areaId ? peoplePrisma.area.findFirst({ where: { id: e.areaId, orgId: e.orgId }, select: { name: true } }) : null,
    e.branchId ? platformPrisma.branch.findFirst({ where: { id: e.branchId, orgId: e.orgId }, select: { branchName: true } }) : null,
    loadSchedule(e.orgId, [e.id]),
    loadHolidays(e.orgId, from, plusDays(t, 60)),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: from, lte: t } }, orderBy: { date: 'asc' } }),
    peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: e.id, date: t } } }),
    phoneStatus(e),
    privacyNoticeFor(e.orgId),
    balancesFor(e.accountId, e.orgId, [e.id], year),
    peoplePrisma.leaveRequest.count({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING' } }),
    peoplePrisma.attendanceRequest.count({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING' } }),
    peoplePrisma.employee.findMany({ where: { orgId: e.orgId, reportingManagerId: e.id, status: { not: 'LEFT' } }, select: { id: true, name: true } }),
  ]);
  const mine = holidays.forArea(e.areaId, e.branchId);
  const byDate = new Map(records.map((r) => [r.date, r]));
  const working = (d: string) => !mine.has(d) && !isWeeklyOff(resolveShift(schedule, e.id, d).rule, d);
  /* This month, up to today. */
  const monthDays = daysOfMonth(month).filter((d) => d <= t);
  const workingSoFar = monthDays.filter(working);
  const inMonth = records.filter((r) => r.date >= monthStart);
  const count = (s: string) => inMonth.filter((r) => r.status === s).length;
  const lateDays = inMonth.filter((r) => (r.lateMinutes || 0) > 0);
  const present = count('PRESENT') + count('HALF_DAY') * 0.5;
  /* The last seven days, oldest first, for the week chart. */
  const week = Array.from({ length: 7 }, (_, i) => plusDays(t, i - 6)).map((d) => {
    const r = byDate.get(d);
    return { date: d, workedMinutes: r?.workedMinutes || 0, status: r?.status || (working(d) ? (d < t ? 'NO_RECORD' : 'TODAY') : 'OFF') };
  });
  /* Days to fix: the same list as the Needs attention screen, newest first. */
  const attention = (await attentionNow(e)).filter((i) => i.action === 'FIX').map((i) => ({ date: i.date, why: i.text }));
  const balances = leave.types
    .filter((ty) => ty.isActive)
    .map((ty) => ({ id: ty.id, name: ty.name, ...(leave.balances.get(e.id)?.get(ty.id) || {}) }))
    .map((b: any) => ({ id: b.id, name: b.name, available: b.available ?? null, used: b.used || 0, pending: b.pending || 0 }));
  const ids = team.map((m) => m.id);
  const [waitingLeave, waitingCorrections, awayToday, waitingPunches] = ids.length
    ? await Promise.all([
        peoplePrisma.leaveRequest.count({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING', managerApprovedAt: null } }),
        peoplePrisma.attendanceRequest.count({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING', managerApprovedAt: null } }),
        peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: t }, toDate: { gte: t } }, select: { employeeId: true } }),
        peoplePrisma.devicePunch.count({ where: { orgId: e.orgId, employeeId: { in: ids }, outsideSite: true, reviewStatus: 'PENDING' } }),
      ])
    : [0, 0, [], 0];
  const names = new Map(team.map((m) => [m.id, m.name]));
  const shift = resolveShift(schedule, e.id, t);
  res.json({
    employee: { name: e.name, code: e.code, department: e.department, designation: e.designation, photoUrl: e.photoUrl },
    company: { name: org?.name || '', code: org?.code || '' },
    /* Where they work: their site, else their branch, else the company's main branch. */
    site: area?.name || branch?.branchName || status.phone.sites[0]?.name || (await platformPrisma.branch.findFirst({ where: { orgId: e.orgId }, orderBy: { createdAt: 'asc' }, select: { branchName: true } }).catch(() => null))?.branchName || null,
    today: t,
    shift: { name: shift.name, startTime: shift.rule.startTime, endTime: shift.rule.endTime, off: isWeeklyOff(shift.rule, t), holiday: mine.has(t) ? holidays.rows.find((h) => h.date === t)?.name || 'Holiday' : null },
    record: record ? (await withNames(e.orgId, [record]))[0] : null,
    punches: status.punches,
    phone: status.phone,
    month: {
      month,
      workingDays: workingSoFar.length,
      present,
      absent: count('ABSENT'),
      leave: count('ON_LEAVE'),
      late: lateDays.length,
      lateMinutes: lateDays.reduce((a, r) => a + (r.lateMinutes || 0), 0),
      workedMinutes: inMonth.reduce((a, r) => a + (r.workedMinutes || 0), 0),
      rate: workingSoFar.length ? Math.round((present / workingSoFar.length) * 100) : null,
    },
    week,
    attention: attention.slice(0, 5),
    attentionCount: attention.length,
    /* Payslips in the app only where the company runs payroll in CLOR. */
    payroll: await isFeatureEnabled(e.accountId, e.orgId, 'payroll'),
    leave: { balances, pending: myLeave },
    corrections: { pending: myCorrections },
    holidays: holidays.rows
      .filter((h) => h.date > t && mine.has(h.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((h, i, arr) => arr.findIndex((x) => x.date === h.date) === i)
      .slice(0, 4)
      .map((h) => ({ date: h.date, name: h.name })),
    approvals: { approver: ids.length > 0, team: ids.length, waiting: (waitingLeave as number) + (waitingCorrections as number) + (waitingPunches as number), awayToday: (awayToday as Array<{ employeeId: string }>).map((a) => names.get(a.employeeId) || '').filter(Boolean) },
    privacy: { version: notice.version, read: e.privacyNoticeVersion === notice.version },
  });
});

/**
 * Ask HR (connected workflows): an employee raises an HR case from the app
 * and sees how it is going; HR works it in People → HR Cases. Only their own
 * cases, and only where the company uses People.
 */
const HR_CATEGORIES = ['GENERAL', 'PAYROLL', 'LEAVE', 'DOCUMENTS', 'OTHER'] as const;
const caseRow = (r: any) => ({ id: r.id, title: r.title, status: r.status, category: (r.details as any)?.category || 'GENERAL', description: (r.details as any)?.description || '', resolution: (r.details as any)?.resolution || '', createdAt: r.createdAt, updatedAt: r.updatedAt });

portalRouter.get('/hr-cases', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'peopleEngage'))) return res.json({ available: false, cases: [] });
  const rows = await peoplePrisma.peopleRecord.findMany({ where: { accountId: e.accountId, orgId: e.orgId, kind: 'helpdesk', employeeId: e.id }, orderBy: { updatedAt: 'desc' }, take: 50 });
  res.json({ available: true, categories: HR_CATEGORIES, cases: rows.map(caseRow) });
});

portalRouter.post('/hr-cases', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'peopleEngage'))) return res.status(404).json({ error: 'Your company does not take HR questions here.' });
  const title = String(req.body?.title || '').trim().slice(0, 200);
  const description = String(req.body?.description || '').trim().slice(0, 5000);
  const category = HR_CATEGORIES.includes(req.body?.category) ? req.body.category : 'GENERAL';
  if (!title) return res.status(400).json({ error: 'Say in a few words what it is about.' });
  if (description.length < 5) return res.status(400).json({ error: 'Tell HR what happened.' });
  const open = await peoplePrisma.peopleRecord.count({ where: { orgId: e.orgId, kind: 'helpdesk', employeeId: e.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
  if (open >= 10) return res.status(429).json({ error: 'You have ten questions open with HR already. Wait for an answer first.' });
  const due = new Date(Date.now() + 330 * 60_000 + 3 * 86_400_000).toISOString().slice(0, 10);
  const row = await peoplePrisma.peopleRecord.create({
    data: { accountId: e.accountId, orgId: e.orgId, kind: 'helpdesk', title, status: 'OPEN', employeeId: e.id, dueDate: due, details: { category, priority: 'NORMAL', description, resolution: '' }, createdBy: `portal:${e.id}`, updatedBy: `portal:${e.id}` },
  });
  await notifyPermission(e.accountId, e.orgId, 'PEOPLE::HR Cases::VIEW', {
    kind: 'people.hr_case',
    title: `${e.name}${e.code ? ` (${e.code})` : ''} asked HR: ${title}`,
    body: description.slice(0, 300),
    link: { app: 'people', screen: 'helpdesk' },
  }).catch(() => null);
  res.status(201).json({ case: caseRow(row) });
});

// Published People communications reach employees without granting HR access.
portalRouter.get('/company-updates', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'peopleEngage'))) return res.json({ announcements: [], events: [] });
  const records = await peoplePrisma.peopleRecord.findMany({
    where: { accountId: e.accountId, orgId: e.orgId, OR: [{ kind: 'announcements', status: 'PUBLISHED' }, { kind: 'events', status: 'SCHEDULED' }] },
    orderBy: { updatedAt: 'desc' }, take: 100,
    select: { id: true, kind: true, title: true, details: true, updatedAt: true },
  });
  const t = today();
  res.json({
    announcements: records.filter((r) => r.kind === 'announcements').slice(0, 20).map((r) => ({ id: r.id, title: r.title, body: (r.details as any).body, publishedAt: r.updatedAt })),
    events: records.filter((r) => r.kind === 'events' && String((r.details as any).endDate || (r.details as any).startDate) >= t).map((r) => ({ id: r.id, title: r.title, startDate: (r.details as any).startDate, endDate: (r.details as any).endDate, location: (r.details as any).location, description: (r.details as any).description })),
  });
});

/**
 * What changed for me, for the phone's notifications: requests and field
 * punches decided in the last few days, and how much waits on me as an approver.
 */
portalRouter.get('/updates', async (req, res) => {
  const e = req.portal!.employee;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const team = (await peoplePrisma.employee.findMany({ where: { orgId: e.orgId, reportingManagerId: e.id, status: { not: 'LEFT' } }, select: { id: true } })).map((x) => x.id);
  const [leave, corrections, punches, waitLeave, waitCorr, waitPunch] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: since } }, select: { id: true, status: true, fromDate: true, toDate: true } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: since } }, select: { id: true, status: true, date: true, reviewNote: true } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, outsideSite: true, reviewStatus: { in: ['APPROVED', 'REJECTED'] }, at: { gte: since } }, select: { id: true, reviewStatus: true, localTime: true } }),
    team.length ? peoplePrisma.leaveRequest.count({ where: { orgId: e.orgId, employeeId: { in: team }, status: 'PENDING', managerApprovedAt: null } }) : 0,
    team.length ? peoplePrisma.attendanceRequest.count({ where: { orgId: e.orgId, employeeId: { in: team }, status: 'PENDING', managerApprovedAt: null } }) : 0,
    team.length ? peoplePrisma.devicePunch.count({ where: { orgId: e.orgId, employeeId: { in: team }, outsideSite: true, reviewStatus: 'PENDING' } }) : 0,
  ]);
  res.json({
    decided: [
      ...leave.map((l) => ({ key: `leave:${l.id}:${l.status}`, text: `Leave ${l.fromDate}${l.toDate !== l.fromDate ? ` to ${l.toDate}` : ''} was ${l.status.toLowerCase()}.` })),
      ...corrections.map((c) => ({ key: `corr:${c.id}:${c.status}`, text: `Your request for ${c.date} was ${c.status.toLowerCase()}.${c.reviewNote ? ` ${c.reviewNote}` : ''}` })),
      ...punches.map((p) => ({ key: `punch:${p.id}:${p.reviewStatus}`, text: `Your field punch at ${p.localTime.slice(11, 16)} on ${p.localTime.slice(0, 10)} was ${p.reviewStatus === 'APPROVED' ? 'approved and counts' : 'refused'}.` })),
    ],
    waitingForMe: (waitLeave as number) + (waitCorr as number) + (waitPunch as number),
  });
});

/** A field punch's selfie, for the manager deciding it. */
portalRouter.get('/approvals/punch/:id/photo', async (req, res) => {
  const e = req.portal!.employee;
  const p = await peoplePrisma.devicePunch.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, outsideSite: true } });
  if (!p?.photoId) return res.status(404).json({ error: 'No selfie with this punch.' });
  const owner = await peoplePrisma.employee.findFirst({ where: { id: p.employeeId || '', orgId: e.orgId }, select: { reportingManagerId: true } });
  if (owner?.reportingManagerId !== e.id) return res.status(403).json({ error: 'This punch is not yours to see.' });
  const photo = await peoplePrisma.punchPhoto.findFirst({ where: { id: p.photoId, orgId: e.orgId } });
  if (!photo) return res.status(404).json({ error: 'The selfie has been deleted (kept for a limited time).' });
  res.set('Cache-Control', 'private, no-store').json({ photo: `data:${photo.mime};base64,${Buffer.from(photo.data).toString('base64')}` });
});

// ---------------------------------------------------------------------------
// My requests: everything I asked for, and changing or withdrawing what is still waiting
// ---------------------------------------------------------------------------

/** Corrections, on-duty and missed punches, leave and data requests, newest first, in one list. */
portalRouter.get('/requests', async (req, res) => {
  const e = req.portal!.employee;
  const [corrections, leave, data] = await Promise.all([
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    peoplePrisma.dataRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const [named, overtime, chains, manager] = await Promise.all([
    withTypes(e.orgId, leave),
    peoplePrisma.overtimeRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    chainsFor(e.orgId),
    e.reportingManagerId ? peoplePrisma.employee.findFirst({ where: { id: e.reportingManagerId, orgId: e.orgId }, select: { name: true } }) : null,
  ]);
  const names = { manager: manager?.name || null };
  const t = today();
  const rows = [
    ...corrections.map((r) => ({
      id: r.id, kind: 'correction', reasonCode: r.reasonCode, date: r.date, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null,
      reason: r.reason, status: r.status, note: r.reviewNote, createdAt: r.createdAt, withHr: Boolean(r.managerApprovedAt), canChange: r.status === 'PENDING' && !r.managerApprovedAt,
      ...timelineOf(r, chains.correction, names),
    })),
    ...named.map((r: any) => ({
      id: r.id, kind: 'leave', leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, reason: r.reason, status: r.status, note: r.reviewNote ?? null,
      createdAt: r.createdAt, canChange: r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > t),
      ...timelineOf(r, chains.leave, names),
    })),
    ...overtime.map((r) => ({
      id: r.id, kind: r.kind === 'COMP_OFF' ? 'compoff' : 'overtime', date: r.date, minutes: r.minutes, days: r.days, reason: r.reason, status: r.status, note: r.reviewNote,
      createdAt: r.createdAt, withHr: Boolean(r.managerApprovedAt), canChange: r.status === 'PENDING' && !r.managerApprovedAt,
      ...timelineOf(r, chains.overtime, names),
    })),
    ...data.map((r) => ({
      id: r.id, kind: 'data', type: r.type, reason: r.details, status: r.status, note: r.resolution, createdAt: r.createdAt, dueAt: r.dueAt, canChange: false,
      ...dataTimeline(r),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ requests: rows, reasons: REASON_CODES });
});

/** Change a correction that nobody has looked at yet. */
portalRouter.put('/corrections/:id', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING' || r.managerApprovedAt) return res.status(409).json({ error: 'This request is already being decided; it cannot be changed now.' });
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const checkIn = String(req.body?.checkIn || '');
  const checkOut = req.body?.checkOut ? String(req.body.checkOut) : null;
  const reason = String(req.body?.reason || '').trim();
  const reasonCode = req.body?.reasonCode == null ? r.reasonCode : String(req.body.reasonCode);
  if (!hhmm.test(checkIn) || (checkOut && !hhmm.test(checkOut))) return res.status(400).json({ error: 'Times are HH:MM, 24-hour.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why.' });
  if (reasonCode && !(REASON_CODES as readonly string[]).includes(reasonCode)) return res.status(400).json({ error: 'Unknown reason.' });
  const at = instants(r.date, checkIn, checkOut);
  const updated = await peoplePrisma.attendanceRequest.update({ where: { id: r.id }, data: { checkIn: at.checkIn, checkOut: at.checkOut, reason: reason.slice(0, 500), reasonCode } });
  res.json({ request: updated });
});

/** Withdraw a correction that nobody has looked at yet. */
portalRouter.post('/corrections/:id/cancel', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING' || r.managerApprovedAt) return res.status(409).json({ error: 'This request is already being decided; ask HR to withdraw it.' });
  const updated = await peoplePrisma.attendanceRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', reviewNote: 'Withdrawn by the employee.' } });
  res.json({ request: updated });
});

/** Ask HR to allow punching from the phone. HR sees it in its notifications, with a link to Portal access. */
portalRouter.post('/phone-punch/ask', async (req, res) => {
  const e = req.portal!.employee;
  if (e.mobilePunch) return res.json({ ok: true, message: 'Phone punching is already on for you.' });
  const note = String(req.body?.note || '').trim().slice(0, 300);
  await notifyPermission(e.accountId, e.orgId, 'ATTENDANCE::Employee Portal::EDIT', {
    kind: 'attendance.phone_punch_request',
    title: `${e.name}${e.code ? ` (${e.code})` : ''} asked to punch from their phone`,
    body: note || null,
    link: { app: 'attendance', screen: 'portalAccess' },
  });
  res.json({ ok: true, message: 'Sent to HR. You will be able to punch from the phone once HR switches it on.' });
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

/** Why one of my days says what it says (the same explanation HR sees). */
portalRouter.get('/attendance/explain', async (req, res) => {
  const e = req.portal!.employee;
  const date = String(req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Which day? Dates are YYYY-MM-DD.' });
  res.json(await explainFor(e.orgId, e, date));
});

/** How my balance of one leave type is made up. */
portalRouter.get('/leave/explain', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  try {
    const year = Number(req.query.year) || (await leaveYearOf(orgId));
    res.json(await leaveExplain(accountId, orgId, employeeId, String(req.query.leaveTypeId || ''), year));
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Could not explain this balance.' });
  }
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
  /* ?from=YYYY-MM-DD&days=N: the days coming up, across months, with what changed. */
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ''))) {
    const count = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
    return res.json({ from: String(req.query.from), days: await upcomingShifts(e, String(req.query.from), count) });
  }
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
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : await leaveYearOf(orgId);
  const { types, balances, period } = await balancesFor(accountId, orgId, [employeeId], year);
  const mine = balances.get(employeeId)!;
  const requests = await peoplePrisma.leaveRequest.findMany({
    where: { accountId, orgId, employeeId, fromDate: { gte: periodStart(period, year), lte: periodEnd(period, year) } },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({
    year,
    today: today(),
    types: types.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, ...mine.get(t.id) })),
    requests: (await withTypes(orgId, requests)).map((r: any) => ({ id: r.id, leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, reason: r.reason, status: r.status })),
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
  const [leaves, corrections, fieldPunches] = ids.length
    ? await Promise.all([
        peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
        peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
        peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, outsideSite: true, reviewStatus: 'PENDING' }, orderBy: { at: 'asc' }, take: 200 }),
      ])
    : [[], [], []];
  const who = (id: string) => ({ employeeName: names.get(id)?.name || '', employeeCode: names.get(id)?.code || null });
  /* What the manager already passed to HR is HR's now, not theirs to decide again. */
  const [leaveChain, correctionChain, overtimeAsks] = await Promise.all([
    chainFor(e.orgId, 'leave'),
    chainFor(e.orgId, 'correction'),
    ids.length ? peoplePrisma.overtimeRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: ids }, status: 'PENDING', managerApprovedAt: null }, orderBy: { createdAt: 'asc' } }) : [],
  ]);
  const overtimeChainNow = (await chainsFor(e.orgId)).overtime;
  res.json({
    approver: ids.length > 0,
    team: team.length,
    chain: { leave: leaveChain, correction: correctionChain, overtime: overtimeChainNow },
    leaves: (await withTypes(e.orgId, leaves.filter((r) => !r.managerApprovedAt))).map((r: any) => ({ id: r.id, type: 'leave', ...who(r.employeeId), leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, reason: r.reason, askedAt: r.createdAt })),
    corrections: corrections.filter((r) => !r.managerApprovedAt).map((r) => ({ id: r.id, type: 'correction', ...who(r.employeeId), date: r.date, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null, reason: r.reason, askedAt: r.createdAt })),
    /* Field punches from my team waiting for a decision. */
    punches: fieldPunches.map((p) => ({ id: p.id, type: 'punch', ...who(p.employeeId || ''), date: p.localTime.slice(0, 10), checkIn: p.localTime.slice(11, 16), kind: p.kind, reason: p.address || 'Outside the work sites', latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracyM != null ? Math.round(p.accuracyM) : null, photo: Boolean(p.photoId), askedAt: p.createdAt })),
    /* Overtime and comp-off, when the manager has a say in them. */
    overtime: overtimeChainNow === 'HR' ? [] : overtimeAsks.map((r) => ({ id: r.id, type: 'overtime', ...who(r.employeeId), kind: r.kind, date: r.date, minutes: r.minutes, days: r.days, reason: r.reason, askedAt: r.createdAt })),
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
  if (!['leave', 'correction', 'punch', 'overtime'].includes(type)) return res.status(400).json({ error: 'Unknown request type.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
  if (type === 'overtime') {
    try {
      const r = await decideOvertime(e.orgId, String(req.params.id), decision === 'approve', { userId: `portal:${e.id}`, managerId: e.id }, String(req.body?.note || '').trim().slice(0, 500) || null);
      return res.json({ request: r, stage: r.status === 'PENDING' ? 'HR' : undefined });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ error: err?.message || 'Not done.' });
    }
  }
  if (type === 'punch') {
    try {
      const r = await reviewFieldPunch(e.orgId, String(req.params.id), decision === 'approve', { managerId: e.id });
      return res.json({ punch: { id: r.id, review: r.reviewStatus } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ error: err?.message || 'Not done.' });
    }
  }
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
      const where = { id: r.id, status: 'PENDING', managerApprovedAt: null };
      const changed = type === 'leave' ? await peoplePrisma.leaveRequest.updateMany({ where, data }) : await peoplePrisma.attendanceRequest.updateMany({ where, data });
      if (!changed.count) return res.status(409).json({ error: 'This request is no longer waiting for your approval.' });
      const out = type === 'leave' ? await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, orgId: e.orgId } }) : await peoplePrisma.attendanceRequest.findFirst({ where: { id: r.id, orgId: e.orgId } });
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
// Needs attention, month confirmation, overtime and comp-off
// ---------------------------------------------------------------------------

const fail = (res: Response, err: any) => res.status(err?.status || 500).json({ error: err?.message || 'Not done.' });
const plusDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Past days with something missing or waiting: this month and last, up to yesterday. */
/**
 * What needs attention: last month and this one, from the joining date, up to
 * yesterday. One rule for Home's banner and the Needs attention screen, so the
 * two never show different numbers (MX-11).
 */
async function attentionNow(e: Parameters<typeof attentionFor>[0]) {
  const t = today();
  const [y, m] = t.slice(0, 7).split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  /* Not before they joined: a new joiner has no missing days from before. */
  const joined = await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId: e.orgId }, select: { dateOfJoining: true } });
  const doj = /^\d{4}-\d{2}-\d{2}/.test(joined?.dateOfJoining || '') ? joined!.dateOfJoining!.slice(0, 10) : '';
  const start = doj > from ? doj : from;
  return attentionFor(e, start, plusDaysIso(t, -1));
}

portalRouter.get('/attention', async (req, res) => {
  const e = req.portal!.employee;
  const items = await attentionNow(e);
  res.json({ items, count: items.filter((i) => i.action === 'FIX').length, waiting: items.filter((i) => i.action === 'NONE').length });
});

portalRouter.get('/month-review', async (req, res) => {
  const e = req.portal!.employee;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : (() => {
    const [y, m] = today().slice(0, 7).split('-').map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  })();
  try {
    res.json(await monthReview(e, month));
  } catch (err) {
    fail(res, err);
  }
});

portalRouter.post('/month-review/:month/confirm', async (req, res) => {
  const e = req.portal!.employee;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM.' });
  try {
    res.json({ confirmation: await confirmMonth(e, month, null) });
  } catch (err) {
    fail(res, err);
  }
});

portalRouter.post('/month-review/:month/dispute', async (req, res) => {
  const e = req.portal!.employee;
  const month = String(req.params.month);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM.' });
  if (note.length < 5) return res.status(400).json({ error: 'Say what is wrong, so HR can check it.' });
  try {
    res.json({ confirmation: await confirmMonth(e, month, note) });
  } catch (err) {
    fail(res, err);
  }
});

portalRouter.get('/overtime', async (req, res) => {
  const e = req.portal!.employee;
  res.json(await overtimeFor(e, monthParam(req.query.month)));
});

portalRouter.post('/overtime', async (req, res) => {
  const e = req.portal!.employee;
  const date = String(req.body?.date || '');
  const kind = String(req.body?.kind || 'OVERTIME');
  const reason = String(req.body?.reason || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  if (!['OVERTIME', 'COMP_OFF'].includes(kind)) return res.status(400).json({ error: 'kind must be OVERTIME or COMP_OFF.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say what the extra work was for.' });
  try {
    const r = await askOvertime(e, date, kind as 'OVERTIME' | 'COMP_OFF', reason);
    const chain = (await chainsFor(e.orgId)).overtime;
    if (chain !== 'MANAGER' || !e.reportingManagerId) {
      await notifyPermission(e.accountId, e.orgId, 'ATTENDANCE::Attendance Records::EDIT', {
        kind: 'attendance.overtime_asked',
        title: `${e.name}${e.code ? ` (${e.code})` : ''} asks for ${kind === 'COMP_OFF' ? 'comp-off' : 'overtime'} on ${date}`,
        body: reason.slice(0, 300),
        link: { app: 'attendance', screen: 'overtime' },
      }).catch(() => null);
    }
    res.status(201).json({ request: r });
  } catch (err) {
    fail(res, err);
  }
});

portalRouter.post('/overtime/:id/cancel', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.overtimeRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  res.json({ request: await peoplePrisma.overtimeRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED', reviewedAt: new Date() } }) });
});

/** A data request's steps: sent, HR working on it (with the legal due date), answered. */
function dataTimeline(r: { createdAt: Date; status: string; dueAt: Date | null; reviewedAt: Date | null; resolution: string | null }) {
  const done = r.status !== 'PENDING';
  return {
    steps: [
      { label: 'Sent', state: 'DONE', at: r.createdAt },
      { label: r.dueAt ? `HR (answer due ${r.dueAt.toISOString().slice(0, 10)})` : 'HR', state: done ? (r.status === 'REJECTED' ? 'REFUSED' : 'DONE') : 'NOW', at: done ? r.reviewedAt : null, who: 'HR' },
      { label: r.status === 'REJECTED' ? `Declined${r.resolution ? `: ${r.resolution}` : ''}` : 'Answered', state: !done ? 'LATER' : r.status === 'REJECTED' ? 'REFUSED' : 'DONE', at: done ? r.reviewedAt : null },
    ],
    next: done ? null : 'HR',
  };
}

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
  res.set('Cache-Control', 'private, no-store').json({ document: { id: d.id, title: d.title, mime: d.mime, size: d.size, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` } });
});

const DATA_REQUEST_TYPES = new Set(['ACCESS', 'CORRECTION', 'ERASURE', 'NOMINATE', 'GRIEVANCE']);
const DATA_REQUEST_VERB: Record<string, string> = { ACCESS: 'see their personal data', CORRECTION: 'correct their personal data', ERASURE: 'erase their personal data', NOMINATE: 'name a nominee for their data rights', GRIEVANCE: 'raise a data-protection grievance', WITHDRAW: 'withdraw consent' };
/** Answered within 30 days: well inside the 90 the DPDP Rules allow for grievances. */
const answerBy = () => new Date(Date.now() + 30 * 86_400_000);

// ---------------------------------------------------------------------------
// Privacy notice and my data (DPDP)
// ---------------------------------------------------------------------------

portalRouter.get('/privacy-notice', async (req, res) => {
  const e = req.portal!.employee;
  const notice = await privacyNoticeFor(e.orgId);
  res.json({ notice, read: e.privacyNoticeVersion === notice.version });
});

/** "I have read this" — for the version they were shown. */
portalRouter.post('/privacy-notice/read', async (req, res) => {
  const e = req.portal!.employee;
  const notice = await privacyNoticeFor(e.orgId);
  if (String(req.body?.version || '') !== notice.version) return res.status(409).json({ error: 'The notice has changed since you opened it. Read the new one.', version: notice.version });
  await peoplePrisma.employee.update({ where: { id: e.id }, data: { privacyNoticeVersion: notice.version, privacyNoticeAckAt: new Date() } });
  res.json({ read: true, version: notice.version });
});

/**
 * Everything held about me, at once (DPDP s.11): the summary and the data,
 * as a file. Fingerprint and face data are never sent — only whether CLOR
 * holds a copy — as the template itself is of no use to a person and a risk
 * in a download.
 */
portalRouter.get('/my-data', async (req, res) => {
  const e = req.portal!.employee;
  const since = new Date(Date.now() - 400 * 86_400_000);
  const [file, siteIds, punches, records, requests, leave, dataRequests, templates, org, hr, hooks, notice] = await Promise.all([
    peoplePrisma.employee.findUnique({ where: { id: e.id } }),
    peoplePrisma.readerIdAtSite.findMany({ where: { orgId: e.orgId, employeeId: e.id }, select: { areaId: true, pin: true } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, at: { gte: since } }, orderBy: { at: 'asc' }, select: { localTime: true, kind: true, serialNumber: true, verifyMode: true, latitude: true, longitude: true, accuracyM: true, geofenceId: true } }),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId: e.orgId, employeeId: e.id, date: { gte: since.toISOString().slice(0, 10) } }, orderBy: { date: 'asc' } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 500 }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { fromDate: 'desc' }, take: 500 }),
    peoplePrisma.dataRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' } }),
    peoplePrisma.biometricTemplate.groupBy({ by: ['type'], where: { orgId: e.orgId, employeeId: e.id }, _count: { _all: true } }),
    platformPrisma.org.findUnique({ where: { id: e.orgId }, select: { name: true } }),
    peoplePrisma.hrConnection.findMany({ where: { orgId: e.orgId, enabled: true }, select: { name: true } }),
    peoplePrisma.webhook.findMany({ where: { orgId: e.orgId, isActive: true }, select: { name: true } }),
    privacyNoticeFor(e.orgId),
  ]);
  const {
    portalPasswordHash: _p, portalSetupHash: _s, portalSetupExpires: _x, devicePassword: _d, ...profile
  } = (file || {}) as any;
  const summary = {
    company: org?.name || null,
    role: `${org?.name || 'Your employer'} is the Data Fiduciary; CLOR processes the data for it.`,
    heldAbout: ['Your employee file', 'Reader IDs', `Punches since ${since.toISOString().slice(0, 10)}`, 'Attendance days', 'Corrections and leave', 'Data requests', templates.length ? 'CLOR holds an encrypted copy of your fingerprints/face (not included here)' : 'CLOR holds no copy of your fingerprints or face'],
    sharedWith: [`${org?.name || 'Your employer'} (HR and managers it allows)`, 'CLOR (Data Processor)', ...hr.map((h) => `${h.name} (HR tool)`), ...hooks.map((h) => `${h.name} (connected system)`)],
    noticeVersion: notice.version,
    generatedAt: new Date().toISOString(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    summary,
    profile,
    readerIds: { company: e.devicePin || e.code || null, sites: siteIds },
    punches,
    attendanceDays: records,
    corrections: requests,
    leave,
    dataRequests,
    biometricCopies: Object.fromEntries(templates.map((t) => [t.type === 9 ? 'face' : t.type === 1 ? 'fingerprint' : `type ${t.type}`, t._count._all])),
  });
});

/**
 * Withdraw consent (DPDP s.6(4)): to CLOR keeping copies of my fingerprints
 * and face (they are deleted now), or to phone punches reading my location
 * (phone punching stops for me). Recorded as a request HR can see, answered.
 */
portalRouter.post('/consent/withdraw', async (req, res) => {
  const e = req.portal!.employee;
  const what = String(req.body?.what || '').toUpperCase();
  if (what !== 'BIOMETRIC' && what !== 'PHONE') return res.status(400).json({ error: 'Say what you are withdrawing.' });
  let done = '';
  if (what === 'BIOMETRIC') {
    const gone = await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId: e.orgId, employeeId: e.id } });
    await peoplePrisma.employee.update({ where: { id: e.id }, data: { biometricOptOutAt: new Date() } });
    clearBiometricPolicy(e.orgId);
    done = `Withdrawn. CLOR deleted ${gone.count} stored cop${gone.count === 1 ? 'y' : 'ies'} of your fingerprints/face and will keep none. The readers still recognise you; ask HR if you want to be removed from them too.`;
  } else {
    await peoplePrisma.employee.update({ where: { id: e.id }, data: { mobilePunch: false } });
    done = 'Withdrawn. Your phone will no longer punch or read your location; punch at a reader.';
  }
  await peoplePrisma.dataRequest.create({
    data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, type: 'WITHDRAW', details: what === 'BIOMETRIC' ? 'Withdrew consent to CLOR keeping copies of my fingerprints and face.' : 'Withdrew consent to phone punches reading my location.', status: 'RESOLVED', resolution: done, reviewedAt: new Date(), dueAt: new Date() },
  });
  await notifyPermission(e.accountId, e.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.data_request', title: `${e.name} withdrew consent (${what === 'BIOMETRIC' ? 'fingerprint copies' : 'phone punches'})`, body: done, link: { app: 'attendance', screen: 'dataRequests' } });
  res.json({ ok: true, message: done });
});

portalRouter.get('/data-requests', async (req, res) => {
  const e = req.portal!.employee;
  const rows = await peoplePrisma.dataRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, type: true, details: true, status: true, resolution: true, createdAt: true, reviewedAt: true, dueAt: true } });
  res.json({ requests: rows });
});

/** See my data, correct it, or erase it — a right under the DPDP Act; HR answers under Personnel → Data requests. */
portalRouter.post('/data-requests', async (req, res) => {
  const e = req.portal!.employee;
  const type = String(req.body?.type || '').toUpperCase();
  if (!DATA_REQUEST_TYPES.has(type)) return res.status(400).json({ error: 'Ask to see, correct or erase your data, name a nominee, or raise a grievance.' });
  const details = String(req.body?.details || '').trim().slice(0, 2000);
  if (!details) return res.status(400).json({ error: 'Say what you are asking for.' });
  const open = await peoplePrisma.dataRequest.count({ where: { orgId: e.orgId, employeeId: e.id, status: 'PENDING' } });
  if (open >= 3) return res.status(409).json({ error: 'You already have three requests waiting. HR will answer those first.' });
  const r = await peoplePrisma.dataRequest.create({ data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, type, details, dueAt: answerBy() } });
  await notifyPermission(e.accountId, e.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.data_request', title: `${e.name} asked to ${DATA_REQUEST_VERB[type]}`, body: details || null, link: { app: 'attendance', screen: 'dataRequests' } });
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
  /* A-33: every other device is signed out — older tokens included — and this one goes on. */
  const me = { type: 'EMPLOYEE' as const, id: e.id };
  const current = req.portal!.sid || (await startPortalSession(updated, deviceOf(req))).id;
  await endPortalSessions(updated, 'password changed', me, { except: current });
  res.json({ token: sign(updated, current) });
});

/* ------------------------------------------------- signed-in devices (A-33) */

/** Sign this device out. The apps also forget the token; this makes it stop working too. */
portalRouter.post('/signout', async (req, res) => {
  const p = req.portal!;
  if (p.sid) await endPortalSession({ id: p.employeeId, orgId: p.orgId }, p.sid, 'signed out', { type: 'EMPLOYEE', id: p.employeeId });
  res.json({ ok: true });
});

/** The devices this person is signed in on, this one marked. */
portalRouter.get('/sessions', async (req, res) => {
  const p = req.portal!;
  const rows = await listPortalSessions({ id: p.employeeId, orgId: p.orgId });
  res.json({
    sessions: rows.map((s) => ({ id: s.id, deviceLabel: s.deviceLabel, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === p.sid })),
    /* A sign-in from before devices were listed cannot be shown, only ended with "sign out all other devices". */
    olderSignIns: Date.now() < legacyCutoff(),
  });
});

portalRouter.delete('/sessions/:id', async (req, res) => {
  const p = req.portal!;
  if (String(req.params.id) === p.sid) return res.status(400).json({ error: 'Use Sign out for this device.' });
  const done = await endPortalSession({ id: p.employeeId, orgId: p.orgId }, String(req.params.id), 'signed out from another device', { type: 'EMPLOYEE', id: p.employeeId });
  if (!done) return res.status(404).json({ error: 'That device is not signed in.' });
  res.json({ ok: true });
});

/** Everywhere but here — older sign-ins included. */
portalRouter.post('/sessions/end-others', async (req, res) => {
  const p = req.portal!;
  const current = p.sid || (await startPortalSession(p.employee, deviceOf(req))).id;
  const ended = await endPortalSessions(p.employee, 'signed out from another device', { type: 'EMPLOYEE', id: p.employeeId }, { except: current });
  /* A device on an older token gets a session token back so it stays signed in. */
  res.json({ ok: true, ended, ...(p.sid ? {} : { token: sign(p.employee, current) }) });
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

/**
 * Payslips: the person's own, once the payroll that made them is final
 * (locked, paid or posted), never a draft or one under review. Served from the
 * payslip's snapshot like the Payroll app does (routes/payrollSlips.ts), so a
 * past month shows the job and pay as they were. PAN and bank account are
 * always masked here: a payslip on a phone is the document most often
 * forwarded.
 */
const FINAL_RUN = ['LOCKED', 'PAID', 'POSTED'];
const maskEnd = (v: string | null | undefined, keep = 4) => {
  const s = String(v || '');
  return s ? `${'•'.repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}` : '';
};
async function finalSlips(e: { orgId: string; id: string }, id?: string) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId: e.orgId, status: { in: FINAL_RUN } }, select: { id: true } });
  if (!runs.length) return [];
  return payrollPrisma.salarySlip.findMany({
    where: { orgId: e.orgId, employeeId: e.id, runId: { in: runs.map((r) => r.id) }, status: { not: 'CANCELLED' }, ...(id ? { id } : {}) },
    orderBy: { payrollDate: 'desc' },
    take: 36,
    include: id ? { lines: { orderBy: { displayOrder: 'asc' } } } : undefined,
  });
}

portalRouter.get('/payslips', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'payroll'))) return res.json({ available: false, slips: [] });
  const slips = await finalSlips(e);
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId: e.orgId, id: { in: [...new Set(slips.map((s) => s.periodId))] } }, select: { id: true, name: true, startDate: true, endDate: true } });
  const byId = new Map(periods.map((p) => [p.id, p]));
  res.json({
    available: true,
    slips: slips.map((s) => ({
      id: s.id,
      number: s.number,
      period: byId.get(s.periodId)?.name || s.payrollDate.slice(0, 7),
      payrollDate: s.payrollDate,
      gross: Number(s.grossEarnings),
      deductions: Number(s.totalDeductions),
      net: Number(s.netPay),
      paid: s.paymentStatus === 'PAID',
    })),
  });
});

portalRouter.get('/payslips/:id', async (req, res) => {
  const e = req.portal!.employee;
  if (!(await isFeatureEnabled(e.accountId, e.orgId, 'payroll'))) return res.status(404).json({ error: 'No such payslip.' });
  const [slip] = (await finalSlips(e, String(req.params.id))) as any[];
  if (!slip) return res.status(404).json({ error: 'No such payslip.' });
  const [period, profile, org] = await Promise.all([
    payrollPrisma.payrollPeriod.findFirst({ where: { orgId: e.orgId, id: slip.periodId }, select: { name: true, startDate: true, endDate: true } }),
    payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId: e.orgId, employeeId: e.id }, select: { pan: true, uan: true, bankName: true, bankAccountNumber: true } }),
    platformPrisma.org.findUnique({ where: { id: e.orgId }, select: { name: true } }),
  ]);
  const parse = (j: string) => { try { return JSON.parse(j || '{}'); } catch { return {}; } };
  const person = parse(slip.employeeSnapshotJson);
  const input = parse(slip.inputSnapshotJson);
  const line = (l: any) => ({ name: l.componentName, amount: Number(l.amount) });
  res.json({
    slip: {
      id: slip.id,
      number: slip.number,
      company: org?.name || '',
      period: period?.name || slip.payrollDate.slice(0, 7),
      from: period?.startDate || null,
      to: period?.endDate || null,
      payrollDate: slip.payrollDate,
      employee: {
        name: person.name || e.name,
        code: person.code || e.code || '',
        designation: person.designation || '',
        department: person.department || '',
        pan: maskEnd(profile?.pan),
        uan: profile?.uan || '',
        bank: profile?.bankName || '',
        account: maskEnd(profile?.bankAccountNumber),
      },
      days: { working: Number(input.workingDays ?? 0), payable: Number(input.payableDays ?? 0), lossOfPay: Number(input.lwpDays ?? 0) },
      earnings: slip.lines.filter((l: any) => l.type === 'EARNING').map(line),
      deductions: slip.lines.filter((l: any) => l.type === 'DEDUCTION').map(line),
      gross: Number(slip.grossEarnings),
      totalDeductions: Number(slip.totalDeductions),
      net: Number(slip.netPay),
      paid: slip.paymentStatus === 'PAID',
    },
  });
});

portalRouter.use((_req, res) => res.status(404).json({ error: 'No such page.' }));

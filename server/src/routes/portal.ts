import { checkPortalSession, endPortalSession, endPortalSessions, legacyCutoff, listPortalSessions, startPortalSession } from '../services/portalSessions.js';
import { trackFirst } from '../services/productEvents.js';
import { orgByCode } from '../services/displayCodes.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { explainFor, leaveExplain, reviewFieldPunch } from './attendanceInsights.js';
import { peoplePrisma, peopleWrite } from '../utils/peoplePrisma.js';
import { portalUpdates as referralUpdates } from '../services/people/talent/referrals.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { notifyPermission } from '../services/notifications.js';
import { privacyNoticeFor } from '../services/attendance/privacyNotice.js';
import { clearBiometricPolicy } from '../services/attendance/biometrics.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { DeclarationError, financialYearOf, regimeInForce, saveDeclaration, shapeDeclaration } from '../services/payroll/taxDeclaration.js';
import { anotherApproverExists } from '../services/makerChecker.js';
import { resolveAccess } from '../services/access.js';
import { permKey } from '../constants/permissionCatalog.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../services/payroll/guards.js';
import { PermissionAction } from '../constants/enums.js';
import { isDevOrTest } from '../utils/devMode.js';
import { announcementReaches, departmentNames } from '../services/people/workspace.js';
import { isFeatureEnabled } from '../services/features.js';
import { portalLimiter } from '../middleware/rateLimit.js';
import { isOvernight, isWeeklyOff, istDate, istTime, nightShiftLabel } from '../services/attendance/compute.js';
import { nightShiftsOn } from '../services/attendance/nightShift.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { phoneStatus, recordPhonePunch } from '../services/attendance/phonePunch.js';
import { normaliseCode, passwordProblem } from '../services/attendance/portal.js';
import { chainFor } from '../services/attendance/approvalChain.js';
import { askOvertime, attentionFor, chainsFor, confirmMonth, decideOvertime, monthReview, overtimeFor, ruleTimelineOf, timelineOf, upcomingShifts } from '../services/attendance/selfService.js';
import { portalOf } from '../services/attendance/leaveRules.js';
import { decideLeaveOnEngine, decidesNow, engineLeaveNaming, engineStepOf, offEngine, withWhom } from '../services/attendance/leaveEngine.js';
import { ATTENDANCE_SOURCE, OVERTIME_SOURCE, closeOnEngine, engineChains } from '../services/attendance/attendanceEngine.js';
import { createRequest } from './attendance.js';
import { REASON_CODES } from '../services/attendance/corrections.js';
import { KINDS, KIND_WORDS, askRequest, cancelRequest, chainOf, decideRequest, editRequest, rulesFor, shiftChoices, usage as requestUsage } from '../services/attendance/requests.js';
import { managerStepBy, teamDecidedBy } from '../services/attendance/standIns.js';
import { daysOfMonth, instants, sendError, today, withNames } from '../services/attendance/days.js';
import { actorNames, cancelOwnLeave, createLeave, dayWords, decideRuleLeave, eligibleFor, decideLeave, editLeave, leaveAudit, leaveChainFor, managerStep, masked, pickRestrictedHoliday, previewOut, restrictedHolidaysFor, shortenLeave, withTypes } from './leave.js';
import { balancesFor, leavePeriodOf, leaveYearOf } from '../services/attendance/leaveBalances.js';
import { periodEnd, periodStart } from '../services/attendance/leaveAccrual.js';
import { lapseFor } from '../services/attendance/leaveJobs.js';
import { recomputeDeviceDay, shiftDayFor } from '../services/attendance/punches.js';
import { enterTenant, outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { readableLines } from '../services/payroll/slipLines.js';
import { addDays as plusDaysIso, addDays as plusDays } from '../utils/istDate.js';
import { reportError } from '../utils/log.js';
import { safeUrl } from '../utils/safeUrl.js';

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

/*
 * A refusal (a 4xx the service chose, in its own plain words) goes to the phone as it is. Anything else is a fault:
 * logged, and answered plainly with the request id, never with Prisma or driver text (audit 7 Nov 2026 #24).
 */
function sendFailure(req: Request, res: Response, err: any, refusedWords = 'Not done.') {
  const status = Number(err?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) return res.status(status).json({ error: err?.message || refusedWords, ...(err?.code ? { code: err.code } : {}) });
  // eslint-disable-next-line no-console
  console.error('[portal] failed:', err instanceof Error ? err.stack || err.message : err);
  reportError(err, req, safeUrl);
  return res.status(500).json({ error: 'Something went wrong. Try again in a moment.', requestId: (req as any).id || null });
}

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
  /* Which leave types the person may ask for (gender, employee type). */
  gender: true,
  employeeTypeId: true,
  /* An announcement for a department reaches its people by id (time depth, gap 20). */
  departmentId: true,
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
  /* A person who also has a CLOR sign-in: what they do here is recorded as that user (E18). */
  userId: true,
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
  void trackFirst(found.org.id, `portal:${updated.id}`, 'portal_activated', { again: Boolean(e.portalPasswordSetAt), app: 'attendance' });
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
    shift: { name: shift.name, startTime: shift.rule.startTime, endTime: shift.rule.endTime, off: isWeeklyOff(shift.rule, t), holiday: mine.has(t) ? holidays.rows.find((h) => h.date === t)?.name || 'Holiday' : null, ...(isOvernight(shift.rule) && (await nightShiftsOn(e.orgId, e.accountId)) ? { label: nightShiftLabel(shift.rule) } : {}) },
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
  /* Only what is addressed to me: everyone, or my department, branch, location, or me by name (time depth, gap 20). */
  const names = await departmentNames(e.orgId);
  res.json({
    announcements: records.filter((r) => r.kind === 'announcements' && announcementReaches(r.details, e, names)).slice(0, 20).map((r) => ({ id: r.id, title: r.title, body: (r.details as any).body, publishedAt: r.updatedAt })),
    events: records.filter((r) => r.kind === 'events' && String((r.details as any).endDate || (r.details as any).startDate) >= t).map((r) => ({ id: r.id, title: r.title, startDate: (r.details as any).startDate, endDate: (r.details as any).endDate, location: (r.details as any).location, description: (r.details as any).description })),
  });
});

/**
 * What changed for me: the phone's notifications and the web app's "What's
 * new". Requests and field punches decided in the last seven days, with the
 * approver's note; leave someone else cancelled or shortened; the lapse
 * warning near the period end; and how much waits on me as an approver.
 * Notices go to a CLOR user only (leave.ts announce, leaveJobs runLapseNotices),
 * so for staff with the app alone this feed is how they hear. What I did
 * myself is not news and is left out. `key` is stable per event, so a phone
 * or a browser marks an item seen once.
 */
type Update = { key: string; kind: 'leave' | 'request' | 'punch' | 'people' | 'lapse' | 'referral'; status: string; text: string; note: string | null; at: string };
const quoted = (n?: string | null) => (n && n.trim() ? ` “${n.trim()}”` : '');
portalRouter.get('/updates', async (req, res) => {
  const e = req.portal!.employee;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const self = new Set([`portal:${e.id}`, ...(e.userId ? [e.userId] : [])]);
  const team = (await peoplePrisma.employee.findMany({ where: { orgId: e.orgId, reportingManagerId: e.id, status: { not: 'LEFT' } }, select: { id: true } })).map((x) => x.id);
  const [leave, corrections, punches, waitLeave, waitCorr, waitPunch, myAsks, lapse] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }, updatedAt: { gte: since } }, select: { id: true, status: true, fromDate: true, toDate: true, leaveTypeId: true, reviewNote: true, managerNote: true, history: true, updatedAt: true } }),
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, status: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: since } }, select: { id: true, status: true, date: true, kind: true, reviewNote: true, managerNote: true, updatedAt: true } }),
    peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, outsideSite: true, reviewStatus: { in: ['APPROVED', 'REJECTED'] }, at: { gte: since } }, select: { id: true, reviewStatus: true, localTime: true, at: true } }),
    team.length ? peoplePrisma.leaveRequest.count({ where: { orgId: e.orgId, employeeId: { in: team }, status: 'PENDING', managerApprovedAt: null } }) : 0,
    team.length ? peoplePrisma.attendanceRequest.count({ where: { orgId: e.orgId, employeeId: { in: team }, status: 'PENDING', managerApprovedAt: null } }) : 0,
    team.length ? peoplePrisma.devicePunch.count({ where: { orgId: e.orgId, employeeId: { in: team }, outsideSite: true, reviewStatus: 'PENDING' } }) : 0,
    /* E5: my own People requests (details, resignation) that HR answered or asked more about: the app's notice, as there may be no CLOR user to notify. */
    peoplePrisma.approvalRequest.findMany({ where: { orgId: e.orgId, subjectEmployeeId: e.id, sourceKind: null, requesterUserId: { in: [`portal:${e.id}`, ...(e.userId ? [e.userId] : [])] }, status: { in: ['APPROVED', 'REJECTED', 'MORE_INFO'] }, updatedAt: { gte: since } }, select: { id: true, status: true, requestType: true, updatedAt: true } }),
    lapseFor(e.accountId, e.orgId, e.id).catch((err) => {
      console.error('[portal updates] lapse', err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId: e.orgId, id: { in: [...new Set(leave.map((l) => l.leaveTypeId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const ASK_WORDS: Record<string, string> = { PROFILE_CHANGE: 'Your change to your details', LEAVING: 'Your resignation' };
  const ASK_DONE: Record<string, string> = { APPROVED: 'was approved.', REJECTED: 'was not approved. See My details.', MORE_INFO: 'needs more information from you. Answer it under My details.' };
  const span = (from: string, to: string) => (to && to !== from ? `${dayWords(from)} to ${dayWords(to)}` : dayWords(from));
  const items: Update[] = [];
  for (const a of myAsks) items.push({ key: `people:${a.id}:${a.status}:${a.updatedAt.getTime()}`, kind: 'people', status: a.status, text: `${ASK_WORDS[a.requestType] || 'Your request'} ${ASK_DONE[a.status]}`, note: null, at: a.updatedAt.toISOString() });
  for (const l of leave) {
    const name = types.get(l.leaveTypeId) || 'Leave';
    const history = (Array.isArray(l.history) ? l.history : []) as Array<{ at?: string; by?: string; what?: string; note?: string | null; from?: string; to?: string }>;
    if (l.status === 'APPROVED' || l.status === 'REJECTED') {
      const note = l.reviewNote || l.managerNote || null;
      items.push({ key: `leave:${l.id}:${l.status}`, kind: 'leave', status: l.status, text: `${name} ${span(l.fromDate, l.toDate)} was ${l.status === 'APPROVED' ? 'approved' : 'rejected'}.${quoted(note)}`, note, at: l.updatedAt.toISOString() });
    }
    if (l.status === 'CANCELLED') {
      const last = [...history].reverse().find((h) => h.what === 'CANCELLED' || h.what === 'WITHDRAWN');
      if (last && !self.has(String(last.by || ''))) items.push({ key: `leave:${l.id}:CANCELLED`, kind: 'leave', status: 'CANCELLED', text: `${name} ${span(l.fromDate, l.toDate)} was cancelled for you.${quoted(last.note)}`, note: last.note || null, at: last.at || l.updatedAt.toISOString() });
    }
    for (const h of history) {
      if (h.what !== 'SHORTENED' || self.has(String(h.by || '')) || !h.at || new Date(h.at) < since) continue;
      items.push({ key: `leave:${l.id}:SHORTENED:${h.to}`, kind: 'leave', status: 'SHORTENED', text: `${name} from ${dayWords(l.fromDate)} now ends ${dayWords(String(h.to))}, not ${dayWords(String(h.from))}.`, note: null, at: h.at });
    }
  }
  for (const c of corrections) {
    const note = c.reviewNote || c.managerNote || null;
    const what = KIND_WORDS[c.kind as keyof typeof KIND_WORDS]?.name || 'Request';
    items.push({ key: `corr:${c.id}:${c.status}`, kind: 'request', status: c.status, text: `${what} for ${dayWords(c.date)} was ${c.status === 'APPROVED' ? 'approved' : 'rejected'}.${quoted(note)}`, note, at: c.updatedAt.toISOString() });
  }
  for (const p of punches) items.push({ key: `punch:${p.id}:${p.reviewStatus}`, kind: 'punch', status: String(p.reviewStatus), text: `Your field punch at ${p.localTime.slice(11, 16)} on ${dayWords(p.localTime.slice(0, 10))} was ${p.reviewStatus === 'APPROVED' ? 'approved and counts' : 'refused'}.`, note: null, at: p.at.toISOString() });
  if (lapse) items.push({ key: `lapse:${lapse.year}`, kind: 'lapse', status: 'LAPSE', text: `${lapse.total} ${lapse.total === 1 ? 'day' : 'days'} of leave will lapse on ${dayWords(lapse.end)} unless you take them: ${lapse.lines.map((x) => `${x.leaveType} ${x.days}`).join(', ')}.`, note: null, at: new Date().toISOString() });
  /* Jobs open to me for referrals, and my referrals that joined or were not taken forward. */
  items.push(...(await referralUpdates(e.accountId, e.orgId, e.id, since).catch(() => [])));
  items.sort((a, b) => b.at.localeCompare(a.at));
  res.json({ decided: items, waitingForMe: (waitLeave as number) + (waitCorr as number) + (waitPunch as number) });
});

/** A field punch's selfie, for the manager deciding it. */
portalRouter.get('/approvals/punch/:id/photo', async (req, res) => {
  const e = req.portal!.employee;
  const p = await peoplePrisma.devicePunch.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, outsideSite: true } });
  if (!p?.photoId) return res.status(404).json({ error: 'No selfie with this punch.' });
  if (!p.employeeId || !(await managerStepBy(e.orgId, e.id, p.employeeId, undefined, 'ATTENDANCE'))) return res.status(403).json({ error: 'This punch is not yours to see.' });
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
  /* ?month=YYYY-MM: attendance requests touching that month, with the month's usage per kind (the app's Requests screen). */
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const inMonth = month ? { date: { lte: `${month}-31` }, OR: [{ toDate: null, date: { gte: `${month}-01` } }, { toDate: { gte: `${month}-01` } }] } : {};
  const [corrections, leave, data] = await Promise.all([
    peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: e.id, ...inMonth }, orderBy: { createdAt: 'desc' }, take: 100 }),
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
  /* Leave under the leave rule: who its waiting step names, for "with whom" in the app. */
  const waitingIds = leave.filter((r) => r.status === 'PENDING' && r.ruleId).flatMap((r) => r.stepUserIds);
  const stepNames = waitingIds.length ? await actorNames(e.orgId, waitingIds) : new Map<string, string>();
  const ruleWaiting = new Map(leave.filter((r) => r.status === 'PENDING' && r.ruleId).map((r) => [r.id, r.stepUserIds.map((u) => stepNames.get(u)).filter(Boolean).join(', ') || null]));
  const t = today();
  const rules = await rulesFor(e.orgId);
  const requestChains = Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, await chainOf(e.orgId, k, rules)])));
  const askedShifts = [...new Set(corrections.map((r) => r.shiftId).filter(Boolean) as string[])];
  const shiftNames = new Map(askedShifts.length ? (await peoplePrisma.shift.findMany({ where: { orgId: e.orgId, id: { in: askedShifts } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]) : []);
  const rows = [
    /* A missed punch stays "correction" for the app as it is; the other kinds are "request" with their kind. */
    ...corrections.map((r) => ({
      id: r.id, kind: r.kind === 'MISSED_PUNCH' ? 'correction' : 'request', requestKind: r.kind, kindName: KIND_WORDS[r.kind as keyof typeof KIND_WORDS]?.name || r.kind,
      reasonCode: r.reasonCode, date: r.date, toDate: r.toDate, halfDay: r.halfDay, place: r.place, minutes: r.minutes,
      shiftId: r.shiftId, shiftName: r.shiftId ? shiftNames.get(r.shiftId) || null : null,
      checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null,
      reason: r.reason, status: r.status, note: r.reviewNote, createdAt: r.createdAt, withHr: Boolean(r.managerApprovedAt),
      canChange: r.status === 'PENDING' && (r.kind !== 'MISSED_PUNCH' || !r.managerApprovedAt),
      canCancel: r.status === 'PENDING' || (r.status === 'APPROVED' && (r.kind === 'WFH' || r.kind === 'ON_DUTY' || r.kind === 'SHIFT_CHANGE') && r.date > t),
      ...timelineOf(r, requestChains[r.kind] || chains.correction, names),
    })),
    ...named.map((r: any) => ({
      id: r.id, kind: 'leave', leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, fromTime: r.fromTime ?? null, toTime: r.toTime ?? null, overflowOfId: r.overflowOfId ?? null, reason: r.reason, status: r.status, note: r.reviewNote ?? null,
      createdAt: r.createdAt, canChange: r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > t),
      ...(r.ruleId ? ruleTimelineOf(r, ruleWaiting.get(r.id) || null) : timelineOf(r, chains.leave, names)),
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
  const use = month ? await Promise.all(KINDS.map((k) => requestUsage(e.orgId, e.id, k, month, { rules }))) : null;
  res.json({ requests: rows, reasons: REASON_CODES, ...(month ? { month, usage: Object.fromEntries(use!.map((u) => [u.kind, u])), rules, shifts: await shiftChoices(e.orgId, rules) } : {}) });
});

/** Ask for a day off-site or hours off: work from home, on duty (with a place), permission (from–to), or a missed punch. */
portalRouter.post('/requests', async (req, res) => {
  try {
    const e = req.portal!.employee;
    const row = await askRequest({ ...who(req), onBehalf: false }, e, req.body);
    res.status(201).json({ request: row });
  } catch (err) {
    return sendError(res, err);
  }
});

/** What is switched on for requests, the quotas and how far back one may ask; with this month's usage. */
portalRouter.get('/request-rules', async (req, res) => {
  const e = req.portal!.employee;
  const month = monthParam(req.query.month);
  const rules = await rulesFor(e.orgId);
  const use = await Promise.all(KINDS.map((k) => requestUsage(e.orgId, e.id, k, month, { rules })));
  res.json({ month, rules, shifts: await shiftChoices(e.orgId, rules), kinds: KINDS.filter((k) => rules[k].on).map((k) => ({ kind: k, name: KIND_WORDS[k].name })), usage: Object.fromEntries(use.map((u) => [u.kind, u])), reasons: REASON_CODES });
});

/** Used, waiting and left this month, per kind. */
portalRouter.get('/requests/usage', async (req, res) => {
  const e = req.portal!.employee;
  const month = monthParam(req.query.month);
  const rules = await rulesFor(e.orgId);
  const use = await Promise.all(KINDS.map((k) => requestUsage(e.orgId, e.id, k, month, { rules })));
  res.json({ month, usage: Object.fromEntries(use.map((u) => [u.kind, u])) });
});

/** Change a request that is still waiting (any kind); the manager's step, if taken, is reset. */
portalRouter.put('/requests/:id', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  try {
    res.json({ request: await editRequest({ ...who(req), onBehalf: false }, r, req.body) });
  } catch (err) {
    return sendError(res, err);
  }
});

/** Withdraw a waiting request, or an approved WFH / on duty before its date. */
portalRouter.post('/requests/:id/cancel', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  try {
    res.json({ request: await cancelRequest(e.accountId, e.orgId, r, { userId: who(req).userId, employeeId: e.id, hr: false }) });
  } catch (err) {
    return sendError(res, err);
  }
});

/**
 * The old correction routes (the Android app still calls them): a missed
 * punch only, through the same edit and cancel as /requests, so the quota,
 * the back-date window, the history and the audit line apply (closure audit,
 * 27 Oct 2026: they wrote the row directly and could change any kind).
 */
portalRouter.put('/corrections/:id', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.kind !== 'MISSED_PUNCH') return res.status(409).json({ error: 'Change this request under Requests.', code: 'NOT_A_CORRECTION' });
  if (r.status !== 'PENDING' || r.managerApprovedAt) return res.status(409).json({ error: 'This request is already being decided; it cannot be changed now.' });
  try {
    res.json({ request: await editRequest({ ...who(req), onBehalf: false }, r, { ...req.body, kind: 'MISSED_PUNCH', date: r.date }) });
  } catch (err) {
    return sendError(res, err);
  }
});

/** Withdraw a correction that nobody has looked at yet. */
portalRouter.post('/corrections/:id/cancel', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.kind !== 'MISSED_PUNCH') return res.status(409).json({ error: 'Withdraw this request under Requests.', code: 'NOT_A_CORRECTION' });
  if (r.status !== 'PENDING' || r.managerApprovedAt) return res.status(409).json({ error: 'This request is already being decided; ask HR to withdraw it.' });
  try {
    res.json({ request: await cancelRequest(e.accountId, e.orgId, r, { userId: who(req).userId, employeeId: e.id, hr: false }, 'Withdrawn by the employee.') });
  } catch (err) {
    return sendError(res, err);
  }
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
    days: shaped.map((r: any) => ({ date: r.date, status: r.status, checkIn: r.checkInTime, checkOut: r.checkOutTime, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes, earlyOutMinutes: r.earlyOutMinutes, overtimeMinutes: r.overtimeMinutes, ...(r.shiftLabel ? { shiftLabel: r.shiftLabel } : {}) })),
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
    sendFailure(req, res, err, 'Could not explain this balance.');
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
    types: types.filter((t) => t.isActive && (eligibleFor(t as any, req.portal!.employee as any) || requests.some((r) => r.leaveTypeId === t.id))).map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, allowHalfDay: t.allowHalfDay, unit: t.unit, hoursPerDay: t.hoursPerDay ?? null, ...mine.get(t.id) })),
    /* Waiting on the approval engine: who it is with now, "With Ravi (your manager)" (SPEC 5.7). */
    requests: await Promise.all((await withTypes(orgId, requests)).map(async (r: any) => ({ id: r.id, leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, fromTime: r.fromTime ?? null, toTime: r.toTime ?? null, overflowOfId: r.overflowOfId ?? null, reason: r.reason, status: r.status, note: r.reviewNote ?? null, groupId: r.groupId ?? null, withWhom: r.status === 'PENDING' ? await withWhom(orgId, r) : null }))),
  });
});

/** What a request would charge, before it is sent: the dates counted and skipped, the balance after (AUT-05). */
portalRouter.post('/leave/preview', async (req, res) => {
  try {
    const { accountId, orgId } = req.portal!;
    const out = await previewOut(null, accountId, orgId, req.portal!.employee, req.body, false);
    res.status(out.status).json(out.body);
  } catch (err) {
    return sendError(res, err);
  }
});

portalRouter.post('/leave', async (req, res) => {
  try {
    await createLeave(req, res, req.portal!.employee, who(req));
    const e = req.portal!.employee;
    if (res.statusCode === 201) await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId: e.userId || `portal:${e.id}` }, { entityId: e.id, action: 'CREATE', message: `${e.name} asked for leave in the employee app, ${req.body?.fromDate} to ${req.body?.toDate || req.body?.fromDate}`, metadata: { employeeId: e.id, leaveTypeId: req.body?.leaveTypeId } });
    return;
  } catch (err) {
    return sendError(res, err);
  }
});

/** Change a waiting request of one's own: the same preview, the manager's step starts again. */
portalRouter.put('/leave/:id', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  try {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId, employeeId } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    const e = req.portal!.employee;
    const request = await editLeave(accountId, orgId, r, req.body, e.userId || `portal:${e.id}`, false);
    await leaveAudit({ accountId, orgId, userId: e.userId || `portal:${e.id}` }, { entityId: r.id, action: 'UPDATE', message: `${e.name} changed their leave request to ${request.fromDate} to ${request.toDate}`, metadata: { employeeId } });
    res.json({ request });
  } catch (err) {
    return sendError(res, err);
  }
});

/** Came back early: approved leave that has started now ends on an earlier day. */
portalRouter.post('/leave/:id/shorten', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  try {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId, employeeId } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    const e = req.portal!.employee;
    /* Their own leave: ended today or later, never on a day already taken (shortenLeave). */
    const request = await shortenLeave(accountId, orgId, r, String(req.body?.toDate || ''), e.userId || `portal:${e.id}`, { self: true });
    await leaveAudit({ accountId, orgId, userId: e.userId || `portal:${e.id}` }, { entityId: r.id, action: 'SHORTEN', message: `${e.name} came back early: leave now ends ${request.toDate}`, metadata: { employeeId } });
    res.json({ request });
  } catch (err) {
    return sendError(res, err);
  }
});

/** Restricted holidays: the optional list, what I picked, how many I may still pick. */
portalRouter.get('/holidays/restricted', async (req, res) => {
  const e = req.portal!.employee;
  res.json(await restrictedHolidaysFor(e.orgId, e, Number(req.query.year) || Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4))));
});

/**
 * My holidays for a calendar year: every holiday of my area and branch, and
 * the restricted (optional) ones marked, with what I picked and the quota, so
 * one list shows the year and a restricted day is picked where it is read.
 */
portalRouter.get('/holidays', async (req, res) => {
  const e = req.portal!.employee;
  const asked = Number(req.query.year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : Number(today().slice(0, 4));
  const [fixed, restricted] = await Promise.all([loadHolidays(e.orgId, `${year}-01-01`, `${year}-12-31`), restrictedHolidaysFor(e.orgId, e, year)]);
  const t = today();
  const mine = fixed.forArea(e.areaId, e.branchId);
  const seen = new Set<string>();
  const holidays = [
    ...fixed.rows
      .filter((h) => mine.has(h.date) && (!h.areaId || h.areaId === e.areaId) && (!h.branchId || h.branchId === e.branchId))
      .filter((h) => !seen.has(`${h.date}|${h.name}`) && Boolean(seen.add(`${h.date}|${h.name}`)))
      .map((h) => ({ id: null as string | null, date: h.date, name: h.name, restricted: false, picked: false, past: h.date < t })),
    ...restricted.holidays.map((h) => ({ id: h.id, date: h.date, name: h.name, restricted: true, picked: h.picked, past: h.past })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  res.json({ year, quota: restricted.quota, picked: restricted.picked, left: restricted.left, holidays });
});

portalRouter.post('/holidays/restricted/:holidayId', async (req, res) => {
  const e = req.portal!.employee;
  try {
    const out = await pickRestrictedHoliday(e.accountId, e.orgId, e, String(req.params.holidayId), req.body?.picked !== false);
    await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId: e.userId || `portal:${e.id}` }, { entityId: String(req.params.holidayId), action: out.picked ? 'CREATE' : 'DELETE', message: `${e.name} ${out.picked ? 'picked' : 'dropped'} a restricted holiday`, metadata: { employeeId: e.id } });
    res.json(out);
  } catch (err) {
    return sendError(res, err);
  }
});

portalRouter.post('/leave/:id/cancel', async (req, res) => {
  const { accountId, orgId, employeeId } = req.portal!;
  const out = await cancelOwnLeave(accountId, orgId, employeeId, String(req.params.id));
  const e = req.portal!.employee;
  if (out.status === 200) await leaveAudit({ accountId, orgId, userId: e.userId || `portal:${e.id}` }, { entityId: String(req.params.id), action: 'CANCEL', message: `${e.name} cancelled their own leave in the employee app`, metadata: { employeeId } });
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
  /* Attendance requests (corrections, WFH, on duty, permission) come from everyone I decide for today: my reportees and those of the managers I stand in for. */
  /* Leave and attendance each from the people I decide that kind for: a stand-in for leave only does not get the team's corrections, punches or overtime. */
  const [forLeave, forAttendance] = await Promise.all([teamDecidedBy(e.orgId, e.id, undefined, 'LEAVE'), teamDecidedBy(e.orgId, e.id, undefined, 'ATTENDANCE')]);
  for (const d of [...forLeave, ...forAttendance]) names.set(d.id, d);
  const leaveIds = forLeave.map((d) => d.id);
  const decidedIds = forAttendance.map((d) => d.id);
  /* Leave under the company's leave rule waits on whoever its step names, team or not; my team's is mine only when its step names me. */
  const me = [e.userId, portalOf(e.id)].filter(Boolean) as string[];
  const ruleLeaves = await peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, status: 'PENDING', ruleId: { not: null }, stepUserIds: { hasSome: me } }, orderBy: { createdAt: 'asc' } });
  /* Leave on the approval engine (2c) waits on whoever its step names now, team or not: my team's is mine only when its step names me. */
  const engineMine = await engineLeaveNaming(e.orgId, me);
  const named = engineMine.size ? await peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, status: 'PENDING', id: { in: [...engineMine] } }, orderBy: { createdAt: 'asc' } }) : [];
  /* Only what I may still decide (worked out live): a stand-in whose dates ended, or a manager passed up while away, no longer sees it. */
  const engineLeaves = [];
  for (const r of named) if ((await decidesNow(e.accountId, e.orgId, r, portalOf(e.id))) || (e.userId && (await decidesNow(e.accountId, e.orgId, r, e.userId)))) engineLeaves.push(r);
  const [leaves, corrections, fieldPunches] = ids.length || decidedIds.length || leaveIds.length
    ? await Promise.all([
        leaveIds.length ? peoplePrisma.leaveRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: leaveIds }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }) : [],
        decidedIds.length ? peoplePrisma.attendanceRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: decidedIds }, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }) : [],
        /* Field punches too, for whoever stands in today. */
        decidedIds.length ? peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: { in: decidedIds }, outsideSite: true, reviewStatus: 'PENDING' }, orderBy: { at: 'asc' }, take: 200 }) : [],
      ])
    : [[], [], []];
  const who = (id: string) => ({ employeeName: names.get(id)?.name || '', employeeCode: names.get(id)?.code || null });
  /* What the manager already passed to HR is HR's now, not theirs to decide again. */
  const [leaveChain, correctionChain, overtimeAsks] = await Promise.all([
    chainFor(e.orgId, 'leave'),
    chainFor(e.orgId, 'correction'),
    /* My team's and, standing in, the team I cover today (time depth review). */
    decidedIds.length ? peoplePrisma.overtimeRequest.findMany({ where: { orgId: e.orgId, employeeId: { in: decidedIds }, status: 'PENDING', managerApprovedAt: null }, orderBy: { createdAt: 'asc' } }) : [],
  ]);
  const overtimeChainNow = (await chainsFor(e.orgId)).overtime;
  /* Kinds the company leaves to HR alone (Company choices: "HR only"): not the manager's to decide here. */
  const kindRules = await rulesFor(e.orgId);
  const hrOnly = new Set<string>();
  for (const k of KINDS) if ((await chainOf(e.orgId, k, kindRules)) === 'HR_ONLY') hrOnly.add(k);
  /* On the approval engine (workflow engine 2d): the chain each was asked under, and whether the manager's step is closed. */
  const [onEngineRequests, onEngineOvertime] = await Promise.all([engineChains(e.orgId, ATTENDANCE_SOURCE, corrections.map((r) => r.id)), engineChains(e.orgId, OVERTIME_SOURCE, overtimeAsks.map((r) => r.id))]);
  const managerDecides = (r: { id: string; kind: string }) => {
    const eng = onEngineRequests.get(r.id);
    return eng ? eng.chain !== 'HR_ONLY' && !(eng.chain === 'MANAGER_THEN_HR' && eng.step > 1) : !hrOnly.has(r.kind);
  };
  const overtimeMine = (r: { id: string }) => {
    const eng = onEngineOvertime.get(r.id);
    return eng ? eng.chain !== 'HR' && !(eng.chain === 'MANAGER_THEN_HR' && eng.step > 1) : overtimeChainNow !== 'HR';
  };
  res.json({
    approver: ids.length > 0 || decidedIds.length > 0 || leaveIds.length > 0 || ruleLeaves.length > 0,
    team: team.length,
    chain: { leave: leaveChain, correction: correctionChain === 'HR_ONLY' ? 'HR' : correctionChain, overtime: overtimeChainNow },
    /* A manager plans cover from dates, not diagnoses: private leave reads "Private leave" with no reason. */
    leaves: masked(await withTypes(e.orgId, [...(await offEngine(e.orgId, leaves.filter((r) => !r.managerApprovedAt && !r.ruleId))).filter((r) => !engineMine.has(r.id)), ...ruleLeaves, ...engineLeaves]), false).map((r: any) => ({ id: r.id, type: 'leave', ...who(r.employeeId), ...(names.has(r.employeeId) ? {} : { employeeName: r.employeeName, employeeCode: r.employeeCode ?? null }), ...(r.ruleStep ? { step: r.ruleStep } : {}), leaveTypeName: r.leaveTypeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, fromTime: r.fromTime ?? null, toTime: r.toTime ?? null, overflowOfId: r.overflowOfId ?? null, reason: r.reason, askedAt: r.createdAt })),
    corrections: corrections.filter((r) => !r.managerApprovedAt && r.kind === 'MISSED_PUNCH' && managerDecides(r)).map((r) => ({ id: r.id, type: 'correction', ...who(r.employeeId), date: r.date, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null, reason: r.reason, askedAt: r.createdAt })),
    /* Work from home, on duty and permission from my team, waiting on me. */
    requests: corrections.filter((r) => !r.managerApprovedAt && r.kind !== 'MISSED_PUNCH' && managerDecides(r)).map((r) => ({ id: r.id, type: 'request', kind: r.kind, kindName: KIND_WORDS[r.kind as keyof typeof KIND_WORDS]?.name || r.kind, ...who(r.employeeId), date: r.date, toDate: r.toDate, halfDay: r.halfDay, place: r.place, minutes: r.minutes, checkIn: r.checkIn ? istTime(r.checkIn) : null, checkOut: r.checkOut ? istTime(r.checkOut) : null, reason: r.reason, askedAt: r.createdAt })),
    /* Field punches from my team waiting for a decision. */
    punches: fieldPunches.map((p) => ({ id: p.id, type: 'punch', ...who(p.employeeId || ''), date: p.localTime.slice(0, 10), checkIn: p.localTime.slice(11, 16), kind: p.kind, reason: p.address || 'Outside the work sites', latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracyM != null ? Math.round(p.accuracyM) : null, photo: Boolean(p.photoId), askedAt: p.createdAt })),
    /* Overtime and comp-off, when the manager has a say in them. */
    overtime: overtimeAsks.filter(overtimeMine).map((r) => ({ id: r.id, type: 'overtime', ...who(r.employeeId), kind: r.kind, date: r.date, minutes: r.minutes, days: r.days, reason: r.reason, askedAt: r.createdAt })),
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
  if (!['leave', 'correction', 'request', 'punch', 'overtime'].includes(type)) return res.status(400).json({ error: 'Unknown request type.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
  if (type === 'correction' || type === 'request') {
    /* Every kind of attendance request through one decision (services/attendance/requests.ts): the manager, or whoever stands in for them today. */
    const r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    if (!(await managerStepBy(e.orgId, e.id, r.employeeId, undefined, 'ATTENDANCE'))) return res.status(403).json({ error: 'This request is not yours to decide.' });
    try {
      return res.json(await decideRequest(e.accountId, e.orgId, r, decision === 'approve', { userId: e.userId || `portal:${e.id}`, managerId: e.id, scopeAll: false }, String(req.body?.note || '').trim().slice(0, 500) || null));
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (type === 'overtime') {
    try {
      const r = await decideOvertime(e.orgId, String(req.params.id), decision === 'approve', { userId: e.userId || `portal:${e.id}`, managerId: e.id }, String(req.body?.note || '').trim().slice(0, 500) || null);
      return res.json({ request: r, stage: r.status === 'PENDING' ? 'HR' : undefined });
    } catch (err: any) {
      return sendFailure(req, res, err);
    }
  }
  if (type === 'punch') {
    try {
      const r = await reviewFieldPunch(e.orgId, String(req.params.id), decision === 'approve', { userId: e.userId || `portal:${e.id}`, managerId: e.id });
      return res.json({ punch: { id: r.id, review: r.reviewStatus } });
    } catch (err: any) {
      return sendFailure(req, res, err);
    }
  }
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  /* On the approval engine (workflow engine 2c): whoever its step names now, as their CLOR user or as themselves in the app. */
  if (r.status === 'PENDING' && !r.ruleId && (await engineStepOf(e.orgId, r))) {
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Say why. They see this with the decision.' });
    try {
      const out = await decideLeaveOnEngine({ accountId: e.accountId, orgId: e.orgId, row: r, ids: [e.userId || '', portalOf(e.id)], approve: decision === 'approve', note, channel: 'app' });
      if (out) {
        const userId = out.by;
        await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId }, { entityId: r.id, action: decision === 'approve' ? (out.stage ? 'MANAGER_APPROVE' : 'APPROVE') : 'REJECT', message: out.stage ? `${e.name} (manager) approved leave, ${r.fromDate} to ${r.toDate}; now with HR` : `${e.name} (manager) ${decision === 'approve' ? 'approved' : 'rejected'} leave, ${r.fromDate} to ${r.toDate}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId } });
        return res.json({ request: masked([out.request], false)[0], ...(out.stage ? { stage: out.stage } : {}) });
      }
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (r.ruleId) {
    /* Under the leave rule: whoever its step names, as their CLOR user or as themselves in the app. */
    const by = [e.userId, portalOf(e.id)].find((u) => u && r.stepUserIds.includes(u));
    if (!by) return res.status(403).json({ error: 'This request is not yours to decide.' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${String(r.status).toLowerCase()}.` });
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Say why. They see this with the decision.' });
    try {
      const out = await decideRuleLeave(e.accountId, e.orgId, r, by, note, decision === 'approve');
      await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId: by }, { entityId: r.id, action: decision === 'approve' ? (out.stage ? 'STEP_APPROVE' : 'APPROVE') : 'REJECT', message: `${e.name} ${decision === 'approve' ? (out.stage ? `approved step ${r.ruleStep} of` : 'approved') : 'rejected'} leave, ${r.fromDate} to ${r.toDate}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, step: r.ruleStep } });
      return res.json({ request: masked([out.request], false)[0], ...(out.stage ? { stage: out.stage } : {}) });
    } catch (err) {
      return sendError(res, err);
    }
  }
  /* The person's manager, or whoever stands in for them today, decides as the manager. */
  const asManager = await managerStepBy(e.orgId, e.id, r.employeeId, undefined, 'LEAVE');
  if (!asManager) return res.status(403).json({ error: 'This request is not yours to decide.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${String(r.status).toLowerCase()}.` });
  try {
    /* E18: a manager with a CLOR sign-in decides as that user; otherwise as the employee app's `portal:<id>`. */
    const userId = e.userId || `portal:${e.id}`;
    const chain = await leaveChainFor(e.orgId, r.leaveTypeId);
    if (decision === 'approve' && chain === 'MANAGER_THEN_HR') {
      /* The manager's step: recorded, and the request moves on to HR still pending. */
      if (r.managerApprovedAt) return res.status(409).json({ error: 'You have already approved this; it is with HR now.' });
      const out = await managerStep(e.orgId, r, asManager, note, { employeeId: e.id, userId: e.userId });
      await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId }, { entityId: r.id, action: 'MANAGER_APPROVE', message: `${e.name} (manager) approved leave, ${r.fromDate} to ${r.toDate}; now with HR`, metadata: { employeeId: r.employeeId } });
      return res.json({ request: masked([out], false)[0], stage: 'HR' });
    }
    /* Once the manager's step is taken, the request is HR's: the manager no longer rejects it either. */
    if (chain === 'MANAGER_THEN_HR' && r.managerApprovedAt) return res.status(409).json({ error: 'You have already approved this; it is with HR now.', code: 'HR_STEP' });
    /* A refusal says why: the person reads it in the employee app. */
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Say why. They see this with the decision.' });
    const out = await decideLeave(e.accountId, e.orgId, r, userId, note, decision === 'approve');
    await leaveAudit({ accountId: e.accountId, orgId: e.orgId, userId }, { entityId: r.id, action: decision === 'approve' ? 'APPROVE' : 'REJECT', message: `${e.name} (manager) ${decision === 'approve' ? 'approved' : 'rejected'} leave, ${r.fromDate} to ${r.toDate}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId } });
    return res.json({ request: masked([out], false)[0] });
  } catch (err) {
    return sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Needs attention, month confirmation, overtime and comp-off
// ---------------------------------------------------------------------------

const fail = (req: Request, res: Response, err: any) => sendFailure(req, res, err);

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
    fail(req, res, err);
  }
});

portalRouter.post('/month-review/:month/confirm', async (req, res) => {
  const e = req.portal!.employee;
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM.' });
  try {
    res.json({ confirmation: await confirmMonth(e, month, null) });
  } catch (err) {
    fail(req, res, err);
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
    fail(req, res, err);
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
    fail(req, res, err);
  }
});

portalRouter.post('/overtime/:id/cancel', async (req, res) => {
  const e = req.portal!.employee;
  const r = await peoplePrisma.overtimeRequest.findFirst({ where: { id: String(req.params.id), orgId: e.orgId, employeeId: e.id } });
  if (!r) return res.status(404).json({ error: 'No such request.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}.` });
  /* Withdrawn while it waited on the approval engine: its request closes with it (workflow engine 2d). */
  const cancelled = await peopleWrite(e.orgId, async () => {
    const claimed = await peoplePrisma.overtimeRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'CANCELLED', reviewedAt: new Date() } });
    if (!claimed.count) return null;
    await closeOnEngine(e.accountId, e.orgId, OVERTIME_SOURCE, r.id, 'WITHDRAWN', 'Withdrawn by the person', e.userId || `portal:${e.id}`);
    return peoplePrisma.overtimeRequest.findFirstOrThrow({ where: { id: r.id } });
  });
  if (!cancelled) return res.status(409).json({ error: 'This request was already decided.' });
  res.json({ request: cancelled });
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
/** Requests are answered within 30 days; a grievance within the 90 the DPDP Rules allow (PRV-02). */
const answerBy = (type?: string) => new Date(Date.now() + (type === 'GRIEVANCE' ? 90 : 30) * 86_400_000);

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
  const r = await peoplePrisma.dataRequest.create({ data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, type, details, dueAt: answerBy(type) } });
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
  /*
   * Somebody who runs payroll and also signs in here (re-review of #146): the
   * same rule as Payroll › Tax declarations. Their own regime is somebody
   * else's to change while anybody else holds Payroll's edit right.
   */
  const linked = await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId: e.orgId }, select: { userId: true } });
  if (linked?.userId && req.body?.regime !== undefined) {
    const key = permKey(PAYROLL_MODULE, PAYROLL_RESOURCE.profile, PermissionAction.EDIT);
    const access = await resolveAccess(e.accountId, e.orgId, linked.userId);
    if ((access.isAdmin || access.permissions.has(key)) && String(req.body.regime) !== (await regimeInForce(e.orgId, e.id, financialYear))) {
      if (await anotherApproverExists(e.accountId, e.orgId, linked.userId, key)) {
        return res.status(403).json({ error: 'You run payroll here, so somebody else has to change your own tax regime.', code: 'OWN_RECORD' });
      }
    }
  }
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
      earnings: readableLines(slip.lines.filter((l: any) => l.type === 'EARNING'), slip.adjustmentSnapshotJson).map(line),
      deductions: readableLines(slip.lines.filter((l: any) => l.type === 'DEDUCTION'), slip.adjustmentSnapshotJson).map(line),
      gross: Number(slip.grossEarnings),
      totalDeductions: Number(slip.totalDeductions),
      net: Number(slip.netPay),
      paid: slip.paymentStatus === 'PAID',
      /* What this payslip could not take and moved on (deductionCap.ts), as Payroll's copy shows it. */
      deductionNote: slip.deductionNote ?? null,
      /* Somebody whose last day falls in this period has no next payslip: the rest goes to the full and final. */
      leaving: Boolean(person.dateOfLeaving && period?.endDate && String(person.dateOfLeaving).slice(0, 10) <= period.endDate),
    },
  });
});

portalRouter.use((_req, res) => res.status(404).json({ error: 'No such page.' }));

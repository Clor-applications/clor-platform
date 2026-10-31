import { Router, type NextFunction, type Request, type Response } from 'express';
import { anyAppLive, closing } from '../services/principalAllowed.js';
import rateLimit from 'express-rate-limit';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import { istTime } from '../services/attendance/compute.js';
import { ISO_DATE, daysOfMonth, monthRows, today } from '../services/attendance/days.js';
import { pushEmployeeToReaders, readerFieldsChanged, revokeFromReaders } from '../services/attendance/readerSync.js';
import { ingestPunches } from '../services/attendance/punches.js';
import { z } from 'zod';
import { isWeeklyOff } from '../services/attendance/compute.js';
import { loadHolidays, loadSchedule, resolveShift } from '../services/attendance/schedule.js';
import { closedMonths } from '../services/attendance/days.js';
import { approveLeave, createLeave, rejectLeave, withTypes } from './leave.js';
import { balancesFor, leaveYearOf } from '../services/attendance/leaveBalances.js';
import { emit as emitWebhook, employeeEvent } from '../services/attendance/webhooks.js';
import { idempotent } from '../services/attendance/idempotency.js';
import { driverOf } from '../services/attendance/drivers.js';
import { ONLINE_WINDOW_MS } from '../services/attendance/adms.js';
import { OPENAPI, docsHtml } from '../services/attendance/openapi.js';
import { runInTenant } from '../utils/tenantScope.js';

/**
 * CLOR's API for outside systems — an HRMS or payroll pulling attendance, or
 * middleware and other readers pushing punches. ClorTime's export API
 * (routes/hrms_export.js) and punch intake (routes/vendor_ingest.js), for one
 * company per key.
 *
 *   Authorization: Bearer clor_…        (or X-API-Key: clor_…)
 *
 *   GET  /v1/ping
 *   GET  /v1/employees                              employees:read
 *   GET  /v1/attendance/days?from=&to=              attendance:read  (≤ 92 days)
 *   GET  /v1/attendance/punches?from=&to=           attendance:read  (≤ 92 days)
 *   GET  /v1/attendance/summary?month=YYYY-MM       attendance:read
 *   POST /v1/attendance/punches                     punches:write
 *        { "punches": [{ "employee_code": "104", "timestamp": "2026-10-14 09:05:12",
 *                        "direction": "in" | "out", "verify_mode": "face" }] }   (≤ 500)
 *
 * Mounted at /v1, outside /api, so no user-session middleware runs: the key is
 * the only credential. Keys are compared as SHA-256 hashes; a key restricted to
 * addresses refuses any other; every use updates last used / from where.
 */
export const publicApiRouter = Router();

export const SCOPES = ['attendance:read', 'employees:read', 'employees:write', 'punches:write', 'leave:read', 'leave:write', 'leave:approve', 'readers:read'] as const;
/* The one hash every token kind uses; it lives with the credential registry now (Batch 5). */
import { hashToken, verifyCredential, touchLastUsed } from '../services/credentials.js';
import { apiKeyKind, refusalOf } from '../services/credentialKinds.js';
import { employeeStatusChanged } from '../services/portalSessions.js';
export { hashToken };

type Client = { id: string; accountId: string; orgId: string; scopes: string[]; deviceId: string | null; tokenPrefix: string };
declare module 'express-serve-static-core' {
  interface Request {
    apiClient?: Client;
  }
}

const tokenOf = (req: Request) => {
  const h = String(req.get('authorization') || '');
  if (/^bearer /i.test(h)) return h.slice(7).trim();
  return String(req.get('x-api-key') || '').trim();
};
const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = tokenOf(req);
  if (!token) return fail(res, 401, 'Send your API key as "Authorization: Bearer <key>".');
  /* Batch 5: the registry and the key's own row must both allow it; the lookup is across companies (A-35), the rest runs as the key's company. */
  const v = await verifyCredential('API_KEY', token, apiKeyKind);
  if (!v.ok) {
    const r = refusalOf(v, { invalid: 'This API key is not valid.', off: 'This API key is not valid.', status: { off: 401 } });
    return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  }
  const row = v.row;
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  const allowed = (row.allowedIps || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(ip)) return fail(res, 403, `This key may not be used from ${ip}.`);
  req.apiClient = { id: row.id, accountId: row.accountId, orgId: row.orgId, scopes: row.scopes.split(','), deviceId: row.deviceId, tokenPrefix: row.tokenPrefix };
  if (v.credential.expiresAt) res.setHeader('X-Clor-Credential-Expires', v.credential.expiresAt.toISOString());
  touchLastUsed(v.credential, ip || null);
  /* As the key's company (A-35): a stamp made with no company would match no row and fail silently. */
  runInTenant(row.orgId, () => peoplePrisma.apiClient.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip || null } })).catch(() => undefined);
  runInTenant(row.orgId, () => next());
}
const scope = (s: (typeof SCOPES)[number]) => (req: Request, res: Response, next: NextFunction) =>
  req.apiClient!.scopes.includes(s) ? next() : fail(res, 403, `This key does not have the ${s} scope.`);

/* The description of this API needs no key. */
publicApiRouter.get('/openapi.json', (_req, res) => res.json(OPENAPI));
publicApiRouter.get('/docs', (_req, res) => res.type('html').send(docsHtml(OPENAPI)));

publicApiRouter.use(authenticate);
/* 120 calls a minute per key — an integration polling, not a crawler. */
publicApiRouter.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.DISABLE_RATE_LIMIT === 'true',
    keyGenerator: (req) => `key:${(req as Request).apiClient?.id || 'none'}`,
    message: { error: 'Too many requests for this key. Wait a minute.' },
  })
);
/* Writes repeated with the same Idempotency-Key answer once (services/attendance/idempotency.ts). */
publicApiRouter.use(idempotent);

const range = (q: any) => {
  const to = ISO_DATE.test(String(q.to || '')) ? String(q.to) : today();
  const from = ISO_DATE.test(String(q.from || '')) ? String(q.from) : to;
  if (from > to) return { error: '"from" is after "to".' };
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 > 92) return { error: 'At most 92 days per call.' };
  return { from, to };
};

publicApiRouter.get('/ping', (req, res) => {
  res.json({ ok: true, orgId: req.apiClient!.orgId, key: req.apiClient!.tokenPrefix, scopes: req.apiClient!.scopes });
});

/* ---- Paging for lists that sync by change time: cursor = updatedAt|id, base64url. ---- */
const cursorOf = (row: { updatedAt: Date; id: string }) => Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString('base64url');
const readCursor = (q: any) => {
  const raw = String(q.cursor || '').trim();
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const d = new Date(at);
  return Number.isNaN(d.getTime()) || !id ? { error: 'That cursor is not one of ours.' } : { at: d, id };
};
const isErr = (x: unknown): x is { error: string } => Boolean(x) && typeof (x as any).error === 'string';
const sinceOf = (q: any): { since: Date } | { error: string } | null => {
  const raw = String(q.updated_since || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? { error: '"updated_since" is an ISO date-time, e.g. 2026-10-17T00:00:00Z.' } : { since: d };
};
const limitOf = (q: any, dflt: number, max: number) => Math.min(max, Math.max(1, Number(q.limit) || dflt));
/** The `where` for "changed since, after this cursor", in (updatedAt, id) order. */
const changedSince = (since: Date | null, cursor: { at: Date; id: string } | null) =>
  cursor ? { OR: [{ updatedAt: { gt: cursor.at } }, { updatedAt: cursor.at, id: { gt: cursor.id } }] } : since ? { updatedAt: { gt: since } } : {};

/** What an integration reads of a person. Never the reason typed for leaving (SPEC 3.5; pinned by a test). */
export const EMPLOYEE_FIELDS = { id: true, code: true, name: true, department: true, designation: true, status: true, dateOfJoining: true, dateOfLeaving: true, devicePin: true, workEmail: true, updatedAt: true } as const;
export const publicEmployee = ({ devicePin, ...e }: any) => ({ ...e, readerId: devicePin || e.code || null });

publicApiRouter.get('/employees', scope('employees:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const sinceQ = sinceOf(req.query);
  if (isErr(sinceQ)) return fail(res, 400, sinceQ.error);
  const since = sinceQ ? sinceQ.since : null;
  const cursorQ = readCursor(req.query);
  if (isErr(cursorQ)) return fail(res, 400, cursorQ.error);
  const cursor = cursorQ as { at: Date; id: string } | null;
  const paged = Boolean(since || cursor);
  const limit = limitOf(req.query, 200, 500);
  const rows = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, ...changedSince(since, cursor) },
    select: EMPLOYEE_FIELDS,
    orderBy: paged ? [{ updatedAt: 'asc' }, { id: 'asc' }] : { name: 'asc' },
    ...(paged ? { take: limit + 1 } : {}),
  });
  const page = paged ? rows.slice(0, limit) : rows;
  res.json({ employees: page.map(publicEmployee), next_cursor: paged && rows.length > limit ? cursorOf(page[page.length - 1]) : null });
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const employeeWrite = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  designation: z.string().trim().max(120).nullable().optional(),
  dateOfJoining: z.string().regex(ISO, 'Dates are YYYY-MM-DD.').nullable().optional(),
  dateOfLeaving: z.string().regex(ISO, 'Dates are YYYY-MM-DD.').nullable().optional(),
  status: z.enum(['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED']).optional(),
  workEmail: z.string().trim().email().max(160).nullable().optional().or(z.literal('')),
  readerId: z.string().trim().max(40).nullable().optional(),
});

/** Apply a write to one employee (create or update), with the reader side effects CLOR's own screens have. */
async function writeEmployee(req: Request, existing: any | null, b: z.infer<typeof employeeWrite>) {
  const { accountId, orgId, id: clientId } = req.apiClient!;
  const by = `api:${clientId}`;
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.department !== undefined) data.department = b.department || null;
  if (b.designation !== undefined) data.designation = b.designation || null;
  if (b.dateOfJoining !== undefined) data.dateOfJoining = b.dateOfJoining || null;
  if (b.dateOfLeaving !== undefined) data.dateOfLeaving = b.dateOfLeaving || null;
  if (b.status !== undefined) data.status = b.status;
  if (b.workEmail !== undefined) data.workEmail = b.workEmail || null;
  if (b.readerId !== undefined) data.devicePin = b.readerId || null;
  const joined = (data.dateOfJoining ?? existing?.dateOfJoining) as string | null;
  const left = (data.dateOfLeaving ?? existing?.dateOfLeaving) as string | null;
  if (joined && left && left < joined) throw Object.assign(new Error('Somebody cannot leave before they joined.'), { status: 400 });
  if (!existing) {
    if (!b.name) throw Object.assign(new Error('A new employee needs a name.'), { status: 400 });
    const row = await peoplePrisma.employee.create({ data: { accountId, orgId, code: b.code, ...data, status: (data.status as string) || 'ACTIVE', createdByUserId: by } as any });
    await pushEmployeeToReaders(orgId, row, by);
    emitWebhook(orgId, 'employee.created', employeeEvent(row));
    return { row, created: true };
  }
  const row = await peoplePrisma.employee.update({ where: { id: existing.id }, data: data as any });
  /* A-33: suspended or gone, their employee-app sign-ins end — whoever changed it. */
  await employeeStatusChanged(row, existing.status, row.status, { type: 'SYSTEM', label: 'API key' });
  if (row.status === 'LEFT' && existing.status !== 'LEFT') await revokeFromReaders(orgId, existing, by);
  else if (row.status !== 'LEFT' && readerFieldsChanged(existing, row)) await pushEmployeeToReaders(orgId, row, by, existing);
  emitWebhook(orgId, row.status === 'LEFT' && existing.status !== 'LEFT' ? 'employee.left' : 'employee.updated', employeeEvent(row));
  return { row, created: false };
}
const sendErr = (res: Response, e: any) => (e?.status ? res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }) : (() => { throw e; })());
const shaped = async (orgId: string, id: string) => publicEmployee(await peoplePrisma.employee.findUnique({ where: { id }, select: EMPLOYEE_FIELDS }));

publicApiRouter.post('/employees', scope('employees:write'), async (req, res) => {
  const parsed = employeeWrite.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Check the employee.');
  const { accountId, orgId } = req.apiClient!;
  const existing = await peoplePrisma.employee.findFirst({ where: { accountId, orgId, code: parsed.data.code } });
  try {
    const { row, created } = await writeEmployee(req, existing, parsed.data);
    res.status(created ? 201 : 200).json({ employee: await shaped(orgId, row.id), created });
  } catch (e) {
    return sendErr(res, e);
  }
});

publicApiRouter.patch('/employees/:code', scope('employees:write'), async (req, res) => {
  const parsed = employeeWrite.omit({ code: true }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || 'Check the employee.');
  const { accountId, orgId } = req.apiClient!;
  const code = String(req.params.code);
  const existing = await peoplePrisma.employee.findFirst({ where: { accountId, orgId, code } });
  if (!existing) return fail(res, 404, `No employee with code ${code}.`);
  try {
    const { row } = await writeEmployee(req, existing, { ...parsed.data, code });
    res.json({ employee: await shaped(orgId, row.id) });
  } catch (e) {
    return sendErr(res, e);
  }
});

publicApiRouter.get('/attendance/days', scope('attendance:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const sinceQ = sinceOf(req.query);
  if (isErr(sinceQ)) return fail(res, 400, sinceQ.error);
  const since = sinceQ ? sinceQ.since : null;
  const cursorQ = readCursor(req.query);
  if (isErr(cursorQ)) return fail(res, 400, cursorQ.error);
  const cursor = cursorQ as { at: Date; id: string } | null;
  const paged = Boolean(since || cursor);
  const r = paged ? { from: null, to: null } : range(req.query);
  if ('error' in r) return fail(res, 400, r.error!);
  const limit = limitOf(req.query, 500, 1000);
  const [all, people] = await Promise.all([
    peoplePrisma.attendanceRecord.findMany({
      where: { accountId, orgId, ...(paged ? changedSince(since, cursor) : { date: { gte: r.from!, lte: r.to! } }) },
      orderBy: paged ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ date: 'asc' }],
      ...(paged ? { take: limit + 1 } : {}),
    }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, code: true } }),
  ]);
  const rows = paged ? all.slice(0, limit) : all;
  const code = new Map(people.map((p) => [p.id, p.code]));
  res.json({
    from: r.from,
    to: r.to,
    next_cursor: paged && all.length > limit ? cursorOf(rows[rows.length - 1]) : null,
    days: rows.map((d) => ({
      updatedAt: d.updatedAt,
      employeeId: d.employeeId,
      employeeCode: code.get(d.employeeId) || null,
      date: d.date,
      status: d.status,
      checkIn: d.checkIn ? istTime(d.checkIn) : null,
      checkOut: d.checkOut ? istTime(d.checkOut) : null,
      workedMinutes: d.workedMinutes,
      lateMinutes: d.lateMinutes,
      earlyOutMinutes: d.earlyOutMinutes,
      overtimeMinutes: d.overtimeMinutes,
      overtimeApproved: d.overtimeApproved,
      validated: d.validated,
      source: d.source,
    })),
  });
});

publicApiRouter.get('/attendance/punches', scope('attendance:read'), async (req, res) => {
  const r = range(req.query);
  if ('error' in r) return fail(res, 400, r.error!);
  const { accountId, orgId } = req.apiClient!;
  const rows = await peoplePrisma.devicePunch.findMany({
    where: { accountId, orgId, localTime: { gte: `${r.from} 00:00:00`, lte: `${r.to} 23:59:59` } },
    orderBy: { at: 'asc' },
    take: 20_000,
  });
  res.json({
    from: r.from,
    to: r.to,
    punches: rows.map((p) => ({ readerId: p.pin, employeeId: p.employeeId, time: p.localTime, direction: p.kind, verifyMode: p.verifyMode, reader: p.serialNumber, countedOn: p.shiftDate })),
  });
});

publicApiRouter.get('/attendance/summary', scope('attendance:read'), async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const { accountId, orgId } = req.apiClient!;
  res.json({ month, days: daysOfMonth(month).length, rows: await monthRows(accountId, orgId, month) });
});

const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
const VERIFY: Record<string, number> = { password: 0, pin: 0, fingerprint: 1, finger: 1, card: 4, rfid: 4, face: 15, palm: 25 };
const STATE: Record<string, string> = { in: '0', entry: '0', check_in: '0', '0': '0', out: '1', exit: '1', check_out: '1', '1': '1' };

/**
 * Punches from anything that can POST JSON — other brands' readers through
 * their middleware, a turnstile, a mobile app. Same path as a reader's: same
 * matching, same days, duplicates dropped (ClorTime vendor_ingest.js contract).
 */
publicApiRouter.post('/attendance/punches', scope('punches:write'), async (req, res) => {
  const client = req.apiClient!;
  const body = req.body || {};
  const punches = Array.isArray(body.punches) ? body.punches : body.employee_code ? [body] : null;
  if (!punches?.length) return fail(res, 400, 'Send "punches": [{ "employee_code", "timestamp" }, …].');
  if (punches.length > 500) return fail(res, 413, 'At most 500 punches per call.');
  const errors: string[] = [];
  const lines: string[] = [];
  punches.forEach((p: any, i: number) => {
    const code = String(p?.employee_code ?? p?.user_id ?? '').trim().slice(0, 40);
    let ts = String(p?.timestamp ?? p?.punch_time ?? '').trim();
    if (TIME.test(ts) && ts.length === 16) ts += ':00';
    if (!code || !TIME.test(ts)) {
      errors.push(`Punch ${i + 1}: employee_code and timestamp ("YYYY-MM-DD HH:mm:ss", IST) are required.`);
      return;
    }
    const dir = p?.direction == null ? '255' : STATE[String(p.direction).toLowerCase()] ?? '255';
    const verify = typeof p?.verify_mode === 'number' ? p.verify_mode : VERIFY[String(p?.verify_mode || '').toLowerCase()] ?? 0;
    lines.push(`${code}\t${ts}\t${dir}\t${verify}`);
  });
  /*
   * Punches from this key are recorded under its own "reader", so
   * Transactions shows where they came from.
   *
   * A-29: that reader was found by a global serial, API-<the key's first
   * characters>, and adopted as it was (`update: {}`) — a reader of that
   * serial claimed by another company took this key's punches, and ingest
   * wrote them under that company. The reader must belong to the key's own
   * company; it is named after the key's id (shown nowhere) and created,
   * never adopted, and claiming any API-… serial by hand is refused.
   */
  const ownsIt = (d: { orgId: string; accountId: string } | null) => Boolean(d && d.orgId === client.orgId && d.accountId === client.accountId);
  let device = client.deviceId ? await peoplePrisma.attendanceDevice.findUnique({ where: { id: client.deviceId } }) : null;
  if (!ownsIt(device)) device = null;
  if (!device) {
    const key = await peoplePrisma.apiClient.findUnique({ where: { id: client.id } });
    const serialNumber = `API-${client.id}`;
    const existing = await peoplePrisma.attendanceDevice.findUnique({ where: { serialNumber } });
    device = ownsIt(existing)
      ? existing
      : await peoplePrisma.attendanceDevice.create({
          data: { accountId: client.accountId, orgId: client.orgId, serialNumber, name: `API: ${key?.name || 'key'}`, vendor: 'API', createdByUserId: key?.createdByUserId || 'api' },
        });
    await peoplePrisma.apiClient.update({ where: { id: client.id }, data: { deviceId: device!.id } });
  }
  if (!ownsIt(device)) return fail(res, 500, 'This key has no reader of its own. Nothing was recorded.');
  const added = lines.length ? await ingestPunches(device!, lines.join('\n')) : 0;
  await peoplePrisma.attendanceDevice.update({ where: { id: device!.id }, data: { lastSeenAt: new Date() } });
  res.json({ received: punches.length, accepted: lines.length, added, duplicates: lines.length - added, rejected: errors.length, errors });
});

/* ---- Months closed for payroll ---- */
publicApiRouter.get('/attendance/months', scope('attendance:read'), async (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : Number(today().slice(0, 4));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const shut = await closedMonths(req.apiClient!.orgId, months);
  res.json({ year, months: months.map((m) => ({ month: m, closed: shut.has(m) })) });
});

/* ---- Shifts per person per day ---- */
publicApiRouter.get('/attendance/shifts', scope('attendance:read'), async (req, res) => {
  const r = range(req.query);
  if ('error' in r) return fail(res, 400, r.error!);
  if ((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000 + 1 > 31) return fail(res, 400, 'At most 31 days of shifts per call.');
  const { accountId, orgId } = req.apiClient!;
  const code = String(req.query.employee_code || '').trim();
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' }, ...(code ? { code } : {}) },
    select: { id: true, code: true, areaId: true, branchId: true },
    orderBy: { name: 'asc' },
  });
  if (code && !people.length) return fail(res, 404, `No employee with code ${code}.`);
  const [schedule, holidays] = await Promise.all([loadSchedule(orgId, people.map((p) => p.id)), loadHolidays(orgId, r.from, r.to)]);
  const shifts: any[] = [];
  for (let d = r.from; d <= r.to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    for (const p of people) {
      const sh = resolveShift(schedule, p.id, d);
      const hol = holidays.forArea(p.areaId, p.branchId).has(d) ? holidays.rows.find((h: any) => h.date === d && (!h.areaId || h.areaId === p.areaId))?.name || 'Holiday' : null;
      shifts.push({ employeeId: p.id, employeeCode: p.code, date: d, shift: sh.name, shiftCode: sh.code, start: sh.rule.startTime, end: sh.rule.endTime, weeklyOff: isWeeklyOff(sh.rule, d), holiday: hol });
    }
  }
  res.json({ from: r.from, to: r.to, shifts });
});

/* ---- Readers ---- */
publicApiRouter.get('/readers', scope('readers:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const devices = await peoplePrisma.attendanceDevice.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  const t = today();
  const counts = devices.length ? await peoplePrisma.devicePunch.groupBy({ by: ['deviceId'], where: { orgId, deviceId: { in: devices.map((d) => d.id) }, localTime: { startsWith: t } }, _count: { _all: true } }) : [];
  res.json({
    readers: devices.map((d) => ({
      id: d.id,
      name: d.name,
      serialNumber: d.serialNumber,
      driver: driverOf(d.vendor).label,
      vendor: d.vendor,
      isActive: d.isActive,
      online: Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS),
      lastSeenAt: d.lastSeenAt,
      areaId: d.areaId,
      model: d.model,
      punchesToday: (counts as any[]).find((c) => c.deviceId === d.id)?._count._all || 0,
    })),
  });
});

/* ---- Leave ---- */
const employeeByCode = async (accountId: string, orgId: string, code: string) =>
  code ? peoplePrisma.employee.findFirst({ where: { accountId, orgId, code } }) : null;

publicApiRouter.get('/leave/types', scope('leave:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const types = await peoplePrisma.leaveType.findMany({ where: { accountId, orgId, isActive: true }, orderBy: { name: 'asc' } });
  res.json({ types: types.map((t) => ({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, annualDays: t.annualDays, accrual: t.accrual, prorateForJoiners: t.prorateForJoiners, carryForwardMax: t.carryForwardMax })) });
});

publicApiRouter.get('/leave/balances', scope('leave:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  /* A leave period, named by the year it starts in: the current one by default. */
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : await leaveYearOf(req.apiClient!.orgId);
  const code = String(req.query.employee_code || '').trim();
  const people = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(code ? { code } : {}) }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
  if (code && !people.length) return fail(res, 404, `No employee with code ${code}.`);
  const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year);
  res.json({
    year,
    rows: people.map((p) => ({
      employeeId: p.id,
      employeeCode: p.code,
      name: p.name,
      balances: types.filter((t) => t.isActive).map((t) => ({ leaveType: t.name, leaveTypeCode: t.code, isPaid: t.isPaid, ...balances.get(p.id)!.get(t.id) })),
    })),
  });
});

publicApiRouter.get('/leave/requests', scope('leave:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const status = String(req.query.status || '').trim().toUpperCase();
  const code = String(req.query.employee_code || '').trim();
  const emp = await employeeByCode(accountId, orgId, code);
  if (code && !emp) return fail(res, 404, `No employee with code ${code}.`);
  const from = ISO_DATE.test(String(req.query.from || '')) ? String(req.query.from) : null;
  const to = ISO_DATE.test(String(req.query.to || '')) ? String(req.query.to) : null;
  const rows = await peoplePrisma.leaveRequest.findMany({
    where: { accountId, orgId, ...(status ? { status } : {}), ...(emp ? { employeeId: emp.id } : {}), ...(from ? { toDate: { gte: from } } : {}), ...(to ? { fromDate: { lte: to } } : {}) },
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
  });
  res.json({ requests: await withTypes(orgId, rows) });
});

publicApiRouter.post('/leave/requests', scope('leave:write'), async (req, res) => {
  const { accountId, orgId, id: clientId } = req.apiClient!;
  const b = req.body || {};
  const emp = await employeeByCode(accountId, orgId, String(b.employee_code || '').trim());
  if (!emp) return fail(res, 404, `No employee with code ${String(b.employee_code || '')}.`);
  const want = String(b.leave_type || '').trim();
  const type = want ? await peoplePrisma.leaveType.findFirst({ where: { accountId, orgId, isActive: true, OR: [{ code: want }, { name: want }] } }) : null;
  if (!type) return fail(res, 400, 'Say which leave type, by its code or name (GET /leave/types).');
  req.body = { employeeId: emp.id, leaveTypeId: type.id, fromDate: String(b.from || ''), toDate: String(b.to || ''), reason: String(b.reason || '') };
  return createLeave(req, res, emp, { accountId, orgId, userId: `api:${clientId}` });
});

const decideLeave = (approve: boolean) => async (req: Request, res: Response) => {
  const { accountId, orgId, id: clientId } = req.apiClient!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r) return fail(res, 404, 'No such leave request.');
  if (r.status !== 'PENDING') return fail(res, 409, `This request was already ${r.status.toLowerCase()}.`);
  /* Under the company's leave approval rule each step is a named person's or role's to take, in CLOR or the employee app; a key takes none of them. */
  if (r.ruleId) return fail(res, 409, 'This request follows the leave approval rule; it is decided step by step in CLOR.');
  /* A-13: a key that raised a request does not also approve it; a person, or another system's key, does. */
  if (approve && r.requestedByUserId === `api:${clientId}`) return fail(res, 403, 'This key raised this request; somebody else has to approve it.');
  const note = String(req.body?.note || '').trim().slice(0, 500) || null;
  try {
    const request = approve ? await approveLeave(accountId, orgId, r, `api:${clientId}`, note) : await rejectLeave(orgId, r, `api:${clientId}`, note);
    res.json({ request });
  } catch (e) {
    return sendErr(res, e);
  }
};
publicApiRouter.post('/leave/requests/:id/approve', scope('leave:approve'), decideLeave(true));
publicApiRouter.post('/leave/requests/:id/reject', scope('leave:approve'), decideLeave(false));

publicApiRouter.use((_req, res) => fail(res, 404, 'No such endpoint. See /v1/docs.'));

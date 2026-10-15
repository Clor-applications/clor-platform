import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../services/features.js';
import { istTime } from '../services/attendance/compute.js';
import { ISO_DATE, daysOfMonth, monthRows, today } from './attendance.js';
import { ingestPunches } from './iclock.js';

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

export const SCOPES = ['attendance:read', 'employees:read', 'punches:write'] as const;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

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
  const row = await peoplePrisma.apiClient.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || !row.isActive || row.revokedAt) return fail(res, 401, 'This API key is not valid.');
  const ip = String(req.ip || '').replace(/^::ffff:/, '');
  const allowed = (row.allowedIps || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(ip)) return fail(res, 403, `This key may not be used from ${ip}.`);
  if (!(await isFeatureEnabled(row.accountId, row.orgId, 'attendance'))) return fail(res, 403, 'Attendance is not switched on for this organisation.');
  req.apiClient = { id: row.id, accountId: row.accountId, orgId: row.orgId, scopes: row.scopes.split(','), deviceId: row.deviceId, tokenPrefix: row.tokenPrefix };
  peoplePrisma.apiClient.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip || null } }).catch(() => undefined);
  next();
}
const scope = (s: (typeof SCOPES)[number]) => (req: Request, res: Response, next: NextFunction) =>
  req.apiClient!.scopes.includes(s) ? next() : fail(res, 403, `This key does not have the ${s} scope.`);

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

publicApiRouter.get('/employees', scope('employees:read'), async (req, res) => {
  const { accountId, orgId } = req.apiClient!;
  const rows = await peoplePrisma.employee.findMany({
    where: { accountId, orgId },
    select: { id: true, code: true, name: true, department: true, designation: true, status: true, dateOfJoining: true, dateOfLeaving: true, devicePin: true, workEmail: true },
    orderBy: { name: 'asc' },
  });
  res.json({ employees: rows.map(({ devicePin, ...e }) => ({ ...e, readerId: devicePin || e.code || null })) });
});

publicApiRouter.get('/attendance/days', scope('attendance:read'), async (req, res) => {
  const r = range(req.query);
  if ('error' in r) return fail(res, 400, r.error!);
  const { accountId, orgId } = req.apiClient!;
  const [rows, people] = await Promise.all([
    peoplePrisma.attendanceRecord.findMany({ where: { accountId, orgId, date: { gte: r.from, lte: r.to } }, orderBy: [{ date: 'asc' }] }),
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, code: true } }),
  ]);
  const code = new Map(people.map((p) => [p.id, p.code]));
  res.json({
    from: r.from,
    to: r.to,
    days: rows.map((d) => ({
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
  /* Punches from this key are recorded under its own "reader", so Transactions shows where they came from. */
  let device = client.deviceId ? await peoplePrisma.attendanceDevice.findUnique({ where: { id: client.deviceId } }) : null;
  if (!device) {
    const key = await peoplePrisma.apiClient.findUnique({ where: { id: client.id } });
    device = await peoplePrisma.attendanceDevice.upsert({
      where: { serialNumber: `API-${client.tokenPrefix.replace(/[^A-Za-z0-9]/g, '')}` },
      create: { accountId: client.accountId, orgId: client.orgId, serialNumber: `API-${client.tokenPrefix.replace(/[^A-Za-z0-9]/g, '')}`, name: `API: ${key?.name || 'key'}`, vendor: 'API', createdByUserId: key?.createdByUserId || 'api' },
      update: {},
    });
    await peoplePrisma.apiClient.update({ where: { id: client.id }, data: { deviceId: device.id } });
  }
  const added = lines.length ? await ingestPunches(device, lines.join('\n')) : 0;
  await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  res.json({ received: punches.length, accepted: lines.length, added, duplicates: lines.length - added, rejected: errors.length, errors });
});

publicApiRouter.use((_req, res) => fail(res, 404, 'No such endpoint. See the API page under Attendance → Integrations.'));

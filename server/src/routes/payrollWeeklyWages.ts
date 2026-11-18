import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { isFeatureEnabled } from '../services/features.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { requirePayrollStepUp } from '../services/stepUp.js';
import {
  WeeklyWageError,
  approveSheet,
  bankFile,
  deleteSheet,
  editLine,
  getSheet,
  listRates,
  listSheets,
  makeSheet,
  markPaid,
  monthSummary,
  monthSummaryCsv,
  nextStart,
  refreshSheet,
  reopenSheet,
  saveRate,
  wageSlip,
} from '../services/payroll/weeklyWages.js';

/**
 * Weekly wages (round 66): daily rates, weekly or fortnightly wage sheets, the
 * bank file and the month's summary for the returns. Sheets are payroll runs
 * in all but table — the same permissions: Payroll Runs to make and approve,
 * Payroll Payments to pay and export the bank file.
 */
export const payrollWeeklyWagesRouter = Router();
payrollWeeklyWagesRouter.use(requireAuth, requireTenantContext);

const RUNS = PAYROLL_RESOURCE.runs;
const PAYMENTS = PAYROLL_RESOURCE.payments;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const handle = (res: any, e: unknown) => {
  if (e instanceof WeeklyWageError) return res.status(e.status).json({ error: e.message, code: e.code });
  if (e instanceof z.ZodError) return res.status(400).json({ error: e.issues[0]?.message || 'Check the details.' });
  throw e;
};

/** Attendance's figures for the days, or null when the company does not use Attendance. */
const attendanceFor = (accountId: string, orgId: string) => async (days: string[]) => {
  if (!(await isFeatureEnabled(accountId, orgId, 'attendance'))) return null;
  const { periodRows } = await import('../services/attendance/days.js');
  return periodRows(accountId, orgId, days);
};

const rateSchema = z.object({
  employeeId: z.string().trim().min(1, 'Choose a person.'),
  payGroupId: z.string().trim().min(1, 'Choose a weekly or fortnightly pay group.'),
  dailyRate: z.coerce.number().positive('A daily rate is more than nothing.').max(100000),
  hoursPerDay: z.coerce.number().min(1).max(24).optional(),
  overtimeMultiplier: z.coerce.number().min(1).max(5).optional(),
  canteenPerDay: z.coerce.number().min(0).max(10000).optional(),
  advanceBalance: z.coerce.number().min(0).max(10000000).optional(),
  advancePerSheet: z.coerce.number().min(0).max(10000000).optional(),
  isActive: z.boolean().optional(),
});

payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/rates',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const payGroupId = typeof req.query.payGroupId === 'string' ? req.query.payGroupId : undefined;
    res.json({ rates: await listRates(req.tenant!.orgId, payGroupId) });
  }
);

payrollWeeklyWagesRouter.put(
  '/orgs/:orgId/payroll/weekly-wages/rates',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const input = rateSchema.parse(req.body || {});
      res.json({ rate: await saveRate({ accountId, orgId, userId: req.auth!.userId, input }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/sheets',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const payGroupId = typeof req.query.payGroupId === 'string' ? req.query.payGroupId : undefined;
    const wageMonth = typeof req.query.month === 'string' && MONTH.test(req.query.month) ? req.query.month : undefined;
    res.json({ sheets: await listSheets(req.tenant!.orgId, { payGroupId, wageMonth }) });
  }
);

/** Where the next sheet of a group starts: straight after the last one. */
payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/next-start',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const payGroupId = String(req.query.payGroupId || '');
    res.json({ startDate: payGroupId ? await nextStart(req.tenant!.orgId, payGroupId) : null });
  }
);

payrollWeeklyWagesRouter.post(
  '/orgs/:orgId/payroll/weekly-wages/sheets',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const body = z
        .object({
          payGroupId: z.string().trim().min(1, 'Choose a pay group.'),
          startDate: z.string().regex(ISO_DAY, 'Choose the first day of the sheet.'),
          paysWeeklyOff: z.boolean().optional(),
        })
        .parse(req.body || {});
      const sheet = await makeSheet({ accountId, orgId, userId: req.auth!.userId, ...body, attendanceRows: attendanceFor(accountId, orgId) });
      res.status(201).json({ sheet });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      res.json({ sheet: await getSheet(req.tenant!.orgId, String(req.params.id)) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.delete(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.DELETE, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      await deleteSheet(req.tenant!.orgId, String(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.patch(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/lines/:lineId',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      const body = z
        .object({
          daysWorked: z.coerce.number().min(0, 'Days cannot be less than nothing.').max(31).optional(),
          overtimeHours: z.coerce.number().min(0, 'Overtime cannot be less than nothing.').max(400).optional(),
          notes: z.string().trim().max(300).optional().nullable(),
        })
        .parse(req.body || {});
      res.json({ sheet: await editLine({ orgId: req.tenant!.orgId, sheetId: String(req.params.id), lineId: String(req.params.lineId), ...body }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.post(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/refresh',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      res.json({ sheet: await refreshSheet({ orgId, sheetId: String(req.params.id), attendanceRows: attendanceFor(accountId, orgId) }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.post(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/approve',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RUNS),
  requirePayrollStepUp,
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      res.json({ sheet: await approveSheet({ orgId: req.tenant!.orgId, sheetId: String(req.params.id), userId: req.auth!.userId }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.post(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/reopen',
  requirePermission(PAYROLL_MODULE, PermissionAction.APPROVE, RUNS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      res.json({ sheet: await reopenSheet({ orgId: req.tenant!.orgId, sheetId: String(req.params.id) }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.post(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/paid',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, PAYMENTS),
  requirePayrollStepUp,
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      const body = z
        .object({
          paidOn: z.string().regex(ISO_DAY, 'Choose the day the wages were paid.'),
          reference: z.string().trim().max(80).optional().nullable(),
        })
        .parse(req.body || {});
      res.json({ sheet: await markPaid({ orgId: req.tenant!.orgId, sheetId: String(req.params.id), userId: req.auth!.userId, ...body }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

/** Account numbers in full: its own permission, as the monthly bank advice. */
payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/bank-file',
  requirePermission(PAYROLL_MODULE, PermissionAction.EXPORT, PAYMENTS),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      const file = await bankFile(req.tenant!.orgId, String(req.params.id));
      if (String(req.query.format || '').toLowerCase() === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${file.reference}.csv"`);
        return res.send(file.csv);
      }
      /* The screen gets counts and who is paid in cash, never whole account numbers. */
      res.json({ reference: file.reference, bankCount: file.rows.length, bankTotal: file.rows.reduce((t, r) => t + r.amount, 0), cash: file.cash });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/sheets/:id/slips/:employeeId',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.slips),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    try {
      res.json(await wageSlip(req.tenant!.orgId, String(req.params.id), String(req.params.employeeId)));
    } catch (e) {
      return handle(res, e);
    }
  }
);

/** The wage month across every weekly sheet ending in it: what PF, ESI and PT returns are filed from. */
payrollWeeklyWagesRouter.get(
  '/orgs/:orgId/payroll/weekly-wages/months/:month',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, PAYROLL_RESOURCE.reports),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const month = String(req.params.month);
    if (!MONTH.test(month)) return res.status(400).json({ error: 'Choose a month.' });
    const summary = await monthSummary(req.tenant!.orgId, month);
    const format = String(req.query.format || '').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="weekly-wages-${month}.csv"`);
      return res.send(monthSummaryCsv(summary));
    }
    if (format === 'ecr') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ecr-weekly-wages-${month}.txt"`);
      return res.send(summary.ecr);
    }
    const { ecr: _ecr, ...rest } = summary;
    res.json(rest);
  }
);

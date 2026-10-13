import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { accountingFor } from '../services/payroll/accounting/client.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import {
  PayrollPaymentError,
  adviceCsv,
  bankAdvice,
  cancelPayment,
  createPayment,
  maskAccount,
  postPayment,
  previewPayment,
  previewPaymentPosting,
  settleLines,
  snapshotPerson,
} from '../services/payroll/payment.js';

/**
 * Paying a payroll, and recording what the bank did with it.
 *
 * Whole bank account numbers leave this router in exactly one place: the advice
 * file, behind its own EXPORT permission. Everywhere else they are masked. A
 * salary list is worth stealing; a salary list with account numbers on it is
 * worth more, and there is no reason for a screen to carry them.
 */
export const payrollPaymentsRouter = Router();
payrollPaymentsRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.payments;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const handle = (res: any, e: unknown) => {
  if (e instanceof PayrollPaymentError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

const shape = (p: any, extra: Record<string, unknown> = {}) => ({
  id: p.id,
  number: p.number,
  runId: p.runId,
  paymentDate: p.paymentDate,
  method: p.method,
  ledgerAccountId: p.ledgerAccountId || null,
  reference: p.reference || '',
  totalAmount: Number(p.totalAmount ?? 0),
  paidAmount: Number(p.paidAmount ?? 0),
  paidCount: p.paidCount ?? 0,
  failedCount: p.failedCount ?? 0,
  status: p.status,
  postingStatus: p.postingStatus,
  journalEntryId: p.journalEntryId || null,
  postedAt: p.postedAt || null,
  createdAt: p.createdAt,
  ...extra,
});

/** Who a batch on this run would pay, before one exists. */
payrollPaymentsRouter.get(
  '/orgs/:orgId/payroll/runs/:id/payment-preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      res.json({ preview: await previewPayment(accountId, orgId, String(req.params.id)) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollPaymentsRouter.get(
  '/orgs/:orgId/payroll/payments',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const runId = String(req.query.runId || '').trim();
    const status = String(req.query.status || '').trim();

    const rows = await payrollPrisma.payrollPayment.findMany({
      where: { accountId, orgId, ...(runId ? { runId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const runIds = [...new Set(rows.map((r) => r.runId))];
    const runs = runIds.length
      ? await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { in: runIds } }, select: { id: true, number: true } })
      : [];
    const byRun = new Map(runs.map((r) => [r.id, r.number]));

    res.json({ payments: rows.map((r) => shape(r, { runNumber: byRun.get(r.runId) || '' })) });
  }
);

payrollPaymentsRouter.get(
  '/orgs/:orgId/payroll/payments/:id',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const payment = await payrollPrisma.payrollPayment.findFirst({
      where: { accountId, orgId, id: String(req.params.id) },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    if (!payment) return res.status(404).json({ error: 'No such payment.' });

    const ids = [...new Set(payment.lines.map((l) => l.employeeId))];
    const [people, slips, run, ledger] = await Promise.all([
      ids.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
      payrollPrisma.salarySlip.findMany({
        where: { orgId, id: { in: payment.lines.map((l) => l.slipId) } },
        select: { id: true, number: true, employeeSnapshotJson: true },
      }),
      payrollPrisma.payrollRun.findFirst({ where: { orgId, id: payment.runId }, select: { id: true, number: true, status: true } }),
      payment.ledgerAccountId
        ? accountingFor(accountId).getLedger(orgId, payment.ledgerAccountId)
        : Promise.resolve(null),
    ]);
    const byPerson = new Map(people.map((p) => [p.id, p]));
    const bySlip = new Map(slips.map((s) => [s.id, s.number]));
    /* A person who has left and been removed from the directory is still owed
       the money on their last payslip, and the payslip recorded who they were. */
    const bySnapshot = new Map(slips.map((s) => [s.id, snapshotPerson(s.employeeSnapshotJson)]));

    res.json({
      payment: shape(payment, {
        runNumber: run?.number || '',
        runStatus: run?.status || '',
        ledgerAccountName: ledger?.name || '',
        lines: payment.lines.map((l) => ({
          id: l.id,
          slipId: l.slipId,
          slipNumber: bySlip.get(l.slipId) || '',
          employeeId: l.employeeId,
          employeeName: byPerson.get(l.employeeId)?.name || bySnapshot.get(l.slipId)?.name || 'Unknown employee',
          employeeCode: byPerson.get(l.employeeId)?.code || bySnapshot.get(l.slipId)?.code || '',
          amount: Number(l.amount ?? 0),
          status: l.status,
          reference: l.reference || '',
          failureReason: l.failureReason || '',
          paidAt: l.paidAt || null,
          /* Masked. The whole number goes out in the advice file and nowhere
             else. */
          bankAccountMasked: maskAccount(l.bankAccountNumber),
          bankIfsc: l.bankIfsc || '',
        })),
      }),
    });
  }
);

payrollPaymentsRouter.post(
  '/orgs/:orgId/payroll/payments',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;

    const schema = z.object({
      runId: z.string().trim().min(1, 'Say which payroll this pays.'),
      paymentDate: z.string().trim().regex(ISO_DATE, 'The payment date must be a date.'),
      method: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE']).default('BANK_TRANSFER'),
      ledgerAccountId: z.string().trim().optional().nullable(),
      reference: z.string().trim().max(120).optional().nullable(),
      slipIds: z.array(z.string().trim()).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment.' });

    try {
      const payment = await createPayment({
        accountId,
        orgId,
        branchId: branchId || null,
        userId: req.auth!.userId,
        ...parsed.data,
        ledgerAccountId: parsed.data.ledgerAccountId || null,
        reference: parsed.data.reference || null,
      });
      res.status(201).json({ payment: shape(payment, { lineCount: payment.lines.length }) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

/**
 * The file for the bank, with whole account numbers.
 *
 * Its own permission, deliberately. Everything else on this router masks them,
 * and the one route that does not should be grantable on its own.
 */
payrollPaymentsRouter.get(
  '/orgs/:orgId/payroll/payments/:id/advice',
  requirePermission(PAYROLL_MODULE, PermissionAction.EXPORT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const advice = await bankAdvice(accountId, orgId, String(req.params.id));
      if (String(req.query.format || '').toLowerCase() === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${advice.payment.number}.csv"`);
        return res.send(adviceCsv(advice.rows));
      }
      res.json(advice);
    } catch (e) {
      return handle(res, e);
    }
  }
);

/** What the bank did — all of it at once, or one line at a time. */
payrollPaymentsRouter.post(
  '/orgs/:orgId/payroll/payments/:id/settle',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const schema = z.object({
      results: z
        .array(
          z.object({
            lineId: z.string().trim().min(1),
            status: z.enum(['PAID', 'FAILED', 'PENDING']),
            reference: z.string().trim().max(120).optional().nullable(),
            failureReason: z.string().trim().max(240).optional().nullable(),
          })
        )
        .min(1, 'Say what happened to at least one line.'),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid result.' });

    try {
      const payment = await settleLines({ accountId, orgId, paymentId: String(req.params.id), results: parsed.data.results });
      res.json({ payment: shape(payment) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollPaymentsRouter.get(
  '/orgs/:orgId/payroll/payments/:id/posting-preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      res.json({ preview: await previewPaymentPosting(accountId, orgId, String(req.params.id)) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollPaymentsRouter.post(
  '/orgs/:orgId/payroll/payments/:id/post',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, PAYROLL_RESOURCE.posting),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;
    try {
      const { payment, replayed } = await postPayment({
        accountId,
        orgId,
        branchId: branchId || '',
        userId: req.auth!.userId,
        paymentId: String(req.params.id),
      });
      res.json({ payment: shape(payment), replayed });
    } catch (e) {
      return handle(res, e);
    }
  }
);

/* EDIT, not DELETE. Cancelling removes nothing — the batch stays, saying it
   was called off — and `Payroll Payments` grants no DELETE for that reason. */
payrollPaymentsRouter.post(
  '/orgs/:orgId/payroll/payments/:id/cancel',
  requirePermission(PAYROLL_MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      res.json({ payment: shape(await cancelPayment(accountId, orgId, String(req.params.id))) });
    } catch (e) {
      return handle(res, e);
    }
  }
);

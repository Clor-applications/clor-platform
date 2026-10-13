import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { accountingFor } from '../services/payroll/accounting/client.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE, payrollRouteOk } from '../services/payroll/guards.js';
import { PayrollPostingError, previewPosting, postPayrollRun } from '../services/payroll/posting.js';

/**
 * Payroll into the books, and the look at it beforehand.
 *
 * The preview is not a nicety. Payroll is usually the largest entry a company
 * writes each month, and finance seeing it only after it has been posted is how
 * a misconfigured component becomes a correcting journal. So the entry is shown
 * first, in full, with whatever would stop it.
 */
export const payrollPostingRouter = Router();
payrollPostingRouter.use(requireAuth, requireTenantContext);

const RESOURCE = PAYROLL_RESOURCE.posting;

const handle = (res: any, e: unknown) => {
  if (e instanceof PayrollPostingError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

payrollPostingRouter.get(
  '/orgs/:orgId/payroll/runs/:id/posting-preview',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;
    try {
      const preview = await previewPosting(accountId, orgId, String(req.params.id));
      res.json({ preview });
    } catch (e) {
      return handle(res, e);
    }
  }
);

payrollPostingRouter.post(
  '/orgs/:orgId/payroll/runs/:id/post',
  requirePermission(PAYROLL_MODULE, PermissionAction.CREATE, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId, branchId } = req.tenant!;

    const schema = z.object({ postingDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'That posting date is not a date.' });

    try {
      const { posting, replayed } = await postPayrollRun({
        accountId,
        orgId,
        branchId,
        userId: req.auth!.userId,
        runId: String(req.params.id),
        postingDate: parsed.data.postingDate,
      });
      res.status(replayed ? 200 : 201).json({
        replayed,
        posting: {
          id: posting.id,
          runId: posting.runId,
          postingDate: posting.postingDate,
          journalEntryId: posting.journalEntryId,
          totalDebit: Number(posting.totalDebit),
          totalCredit: Number(posting.totalCredit),
          status: posting.status,
          postedAt: posting.postedAt,
        },
      });
    } catch (e) {
      return handle(res, e);
    }
  }
);

/** What was posted, and the journal it became. */
payrollPostingRouter.get(
  '/orgs/:orgId/payroll/runs/:id/posting',
  requirePermission(PAYROLL_MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!(await payrollRouteOk(req, res))) return;
    const { accountId, orgId } = req.tenant!;

    const posting = await payrollPrisma.payrollPosting.findFirst({
      where: { accountId, orgId, runId: String(req.params.id) },
      include: { lines: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!posting) return res.json({ posting: null });

    /* The journal as accounting holds it, so the receipt can be checked
       against the books rather than believed. */
    const entry = posting.journalEntryId
      ? await accountingFor(accountId).getJournalEntry(orgId, posting.journalEntryId)
      : null;

    res.json({
      posting: {
        id: posting.id,
        postingDate: posting.postingDate,
        totalDebit: Number(posting.totalDebit),
        totalCredit: Number(posting.totalCredit),
        status: posting.status,
        postedAt: posting.postedAt,
        journalEntryId: posting.journalEntryId,
        lines: posting.lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          ledgerName: l.ledgerName,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description || '',
          costCenterId: l.costCenterId || null,
        })),
      },
      journalEntry: entry,
    });
  }
);

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureLedgerSetup, postEntry, reverseEntry, trialBalance, fiscalYearFor } from '../services/ledger.js';

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth, requireTenantContext);

const MODULE = 'ACCOUNTING';
const SUB = 'Ledger';

const manualEntrySchema = z.object({
  date: z.string().min(1),
  journalCode: z.string().min(1).default('JV'),
  narration: z.string().max(500).optional().nullable(),
  lines: z
    .array(
      z.object({
        ledgerAccountId: z.string().optional(),
        controlKind: z.string().optional(),
        debit: z.number().optional(),
        credit: z.number().optional(),
        partyType: z.enum(['CUSTOMER', 'VENDOR']).optional().nullable(),
        partyId: z.string().optional().nullable(),
        description: z.string().max(300).optional().nullable(),
      })
    )
    .min(2),
});

const requireOrgMatch = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

// Idempotent: creates the default chart of accounts + journals for the org.
ledgerRouter.post('/orgs/:orgId/ledger/setup', requirePermission(MODULE, PermissionAction.CREATE, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  await ensureLedgerSetup(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId: req.tenant!.orgId },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, accountType: true, controlKind: true },
  });
  res.json({ accounts });
});

// Create one ledger account. Exists so client-side chart entries (a bank
// account added under "Bank Accounts", a new cash box) become real server
// ledgers — with controlKind CASH/BANK they immediately appear as payment
// modes in receipt/payment entry.
const accountCreateSchema = z.object({
  code: z.string().max(40).optional(),
  name: z.string().min(1).max(160),
  accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  controlKind: z.enum(['CASH', 'BANK']).optional().nullable(),
  sourceKey: z.string().max(120).optional().nullable(),
});

ledgerRouter.post('/orgs/:orgId/ledger/accounts', requirePermission(MODULE, PermissionAction.CREATE, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const body = accountCreateSchema.parse(req.body);
  await ensureLedgerSetup(accountId, orgId, req.auth!.userId);

  // Same client chart row re-synced (e.g. rename) updates instead of duplicating.
  const sourceKey = String(body.sourceKey || '').trim() || null;
  if (sourceKey) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { orgId, sourceSystem: 'client-chart', sourceKey },
      select: { id: true },
    });
    if (existing) {
      const updated = await prisma.ledgerAccount.update({
        where: { id: existing.id },
        data: { name: body.name, controlKind: body.controlKind ?? undefined, isActive: true },
        select: { id: true, code: true, name: true, accountType: true, controlKind: true },
      });
      return res.json({ account: updated });
    }
  }

  // Allocate the next free code in the account-type's range when none given.
  let code = String(body.code || '').trim();
  if (!code) {
    const prefix = body.controlKind === 'BANK' ? '12' : body.controlKind === 'CASH' ? '11' : '19';
    const peers = await prisma.ledgerAccount.findMany({
      where: { orgId, code: { startsWith: prefix } },
      select: { code: true },
    });
    const max = peers.reduce((m, p) => Math.max(m, Number(p.code) || 0), Number(`${prefix}00`));
    code = String(max + 1);
  }

  const account = await prisma.ledgerAccount.create({
    data: {
      accountId,
      orgId,
      branchId: null,
      code,
      name: body.name,
      accountType: body.accountType,
      controlKind: body.controlKind ?? null,
      sourceSystem: sourceKey ? 'client-chart' : null,
      sourceKey,
      createdByUserId: req.auth!.userId,
    },
    select: { id: true, code: true, name: true, accountType: true, controlKind: true },
  });

  res.status(201).json({ account });
});

ledgerRouter.get('/orgs/:orgId/ledger/accounts', requirePermission(MODULE, PermissionAction.VIEW, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId: req.tenant!.orgId, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, accountType: true, controlKind: true, branchId: true },
  });
  res.json({ accounts });
});

ledgerRouter.get('/orgs/:orgId/ledger/trial-balance', requirePermission(MODULE, PermissionAction.VIEW, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const allBranches = String(req.query.allBranches || '') === 'true';
  const result = await trialBalance({
    accountId: req.tenant!.accountId,
    orgId: req.tenant!.orgId,
    branchId: allBranches ? undefined : req.tenant!.branchId,
    fromDate: req.query.from ? String(req.query.from) : undefined,
    toDate: req.query.to ? String(req.query.to) : undefined,
  });
  res.json(result);
});

/**
 * One account's ledger: every posted line, oldest first, with a running
 * balance — the drill-down a trial balance row opens into. REVERSED entries
 * are included alongside POSTED because their contras are, and hiding one
 * side of a reversal would make the running balance lie.
 */
ledgerRouter.get('/orgs/:orgId/ledger/accounts/:ledgerAccountId/lines', requirePermission(MODULE, PermissionAction.VIEW, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;

  const account = await prisma.ledgerAccount.findFirst({
    where: { id: String(req.params.ledgerAccountId), orgId: req.tenant!.orgId },
    select: { id: true, code: true, name: true, accountType: true },
  });
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  const allBranches = String(req.query.allBranches || '') === 'true';

  const lines = await prisma.journalLine.findMany({
    where: {
      ledgerAccountId: account.id,
      entry: {
        accountId: req.tenant!.accountId,
        orgId: req.tenant!.orgId,
        ...(allBranches ? {} : { branchId: req.tenant!.branchId }),
        status: { in: ['POSTED', 'REVERSED'] },
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
    },
    orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    take: 1000,
    include: {
      entry: {
        select: { id: true, entryNo: true, date: true, narration: true, sourceDocType: true, sourceDocId: true, status: true },
      },
    },
  });

  let running = 0;
  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    running += debit - credit;
    return {
      id: l.id,
      date: l.entry.date,
      entryNo: l.entry.entryNo,
      narration: l.description || l.entry.narration || '',
      sourceDocType: l.entry.sourceDocType,
      sourceDocId: l.entry.sourceDocId,
      status: l.entry.status,
      debit,
      credit,
      running,
    };
  });

  res.json({ account, rows, truncated: lines.length === 1000 });
});

ledgerRouter.get('/orgs/:orgId/ledger/entries', requirePermission(MODULE, PermissionAction.VIEW, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const take = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const entries = await prisma.journalEntry.findMany({
    where: {
      accountId: req.tenant!.accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      ...(req.query.docType ? { sourceDocType: String(req.query.docType) } : {}),
      ...(req.query.docId ? { sourceDocId: String(req.query.docId) } : {}),
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take,
    include: {
      lines: {
        select: {
          id: true,
          // The browser keeps this against its own chart row, so a journal it
          // hydrated can later be edited against the same server account.
          ledgerAccountId: true,
          debit: true,
          credit: true,
          description: true,
          ledgerAccount: { select: { code: true, name: true, controlKind: true } },
        },
      },
    },
  });

  res.json({
    entries: entries.map((e) => ({
      ...e,
      lines: e.lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
    })),
  });
});

ledgerRouter.post('/orgs/:orgId/ledger/entries', requirePermission(MODULE, PermissionAction.CREATE, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const body = manualEntrySchema.parse(req.body);
  const entry = await postEntry({
    accountId: req.tenant!.accountId,
    orgId: req.tenant!.orgId,
    branchId: req.tenant!.branchId,
    userId: req.auth!.userId,
    date: body.date,
    journalCode: body.journalCode,
    narration: body.narration ?? null,
    sourceDocType: 'MANUAL',
    lines: body.lines as any,
  });
  res.status(201).json({ entry });
});

ledgerRouter.post('/orgs/:orgId/ledger/entries/:entryId/reverse', requirePermission(MODULE, PermissionAction.EDIT, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const reversal = await reverseEntry({
    accountId: req.tenant!.accountId,
    orgId: req.tenant!.orgId,
    branchId: req.tenant!.branchId,
    userId: req.auth!.userId,
    entryId: String(req.params.entryId),
    date: req.body?.date ? String(req.body.date) : undefined,
    narration: req.body?.narration ? String(req.body.narration) : undefined,
  });
  res.status(201).json({ entry: reversal });
});

// ---- period lock -----------------------------------------------------------

const lockSchema = z.object({ lockedThrough: z.string().min(1).nullable() });

ledgerRouter.get('/orgs/:orgId/ledger/fiscal-years', requirePermission(MODULE, PermissionAction.VIEW, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const years = await prisma.fiscalYear.findMany({
    where: { orgId: req.tenant!.orgId },
    orderBy: { name: 'desc' },
  });
  res.json({ fiscalYears: years });
});

ledgerRouter.post('/orgs/:orgId/ledger/fiscal-years/:name/lock', requirePermission(MODULE, PermissionAction.APPROVE, SUB), async (req, res) => {
  if (!requireOrgMatch(req, res)) return;
  const body = lockSchema.parse(req.body);
  const name = String(req.params.name);

  const fy =
    (await prisma.fiscalYear.findFirst({ where: { orgId: req.tenant!.orgId, name } })) ||
    (await (async () => {
      const spec = fiscalYearFor(`${name.slice(0, 4)}-04-01`);
      return prisma.fiscalYear.create({
        data: {
          accountId: req.tenant!.accountId,
          orgId: req.tenant!.orgId,
          name: spec.name,
          startDate: spec.startDate,
          endDate: spec.endDate,
          createdByUserId: req.auth!.userId,
        },
      });
    })());

  const updated = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: { lockedThrough: body.lockedThrough },
  });
  res.json({ fiscalYear: updated });
});

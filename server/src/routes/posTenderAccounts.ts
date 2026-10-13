import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureLedgerSetup } from '../services/ledger.js';
import {
  IneligibleAccount,
  POS_TENDERS,
  TENDER_CONTROL_KIND,
  assertAccountUsableForTender,
  isPosTender,
  receiptAccountsFor,
  type PosTender,
} from '../services/receiptAccounts.js';

/**
 * Where this branch's counter takings post.
 *
 * A till knows it took "Cash"; a receipt needs a ledger account. Until these
 * rows exist there is no honest way for a point of sale to record the money it
 * has taken, which is why a POS sale currently debits receivables and leaves
 * them there.
 *
 * Nothing here posts, allocates or settles anything. It records a choice, and
 * refuses choices that could not be honoured.
 */
export const posTenderAccountsRouter = Router();
posTenderAccountsRouter.use(requireAuth, requireTenantContext);

/* Payment accounts are a finance setting, so they answer to the same
   permission as the company's other financial configuration. */
const MODULE = 'SETTINGS';
const RESOURCE = 'Company Profile';

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const putSchema = z.object({
  tender: z.enum(POS_TENDERS),
  ledgerAccountId: z.string().min(1),
});

type Effective = {
  status: 'DIRECT' | 'UNCONFIGURED';
  ledgerAccountId: string | null;
  ledgerName: string | null;
  ledgerCode: string | null;
  /** What this tender needs, so a picker can offer only those. */
  controlKind: 'CASH' | 'BANK';
};

/**
 * What each tender resolves to for one branch.
 *
 * There are two answers, not three. A mapping exists and is usable, or the
 * tender is unconfigured — nothing is inherited from anywhere. A row whose
 * account has since been deactivated, moved to another branch or deleted
 * reports UNCONFIGURED rather than a broken account, because a checkout asking
 * "can I take cash?" needs a usable answer, not a stale one.
 */
async function effectiveFor(orgId: string, branchId: string): Promise<Record<PosTender, Effective>> {
  const rows = await prisma.posTenderAccount.findMany({
    where: { orgId, branchId },
    select: { tender: true, ledgerAccount: { select: { id: true, code: true, name: true, controlKind: true, branchId: true, isActive: true } } },
  });
  const byTender = new Map(rows.filter((r) => isPosTender(r.tender)).map((r) => [r.tender as PosTender, r.ledgerAccount]));

  const out = {} as Record<PosTender, Effective>;
  for (const tender of POS_TENDERS) {
    const acc = byTender.get(tender);
    const usable =
      acc &&
      acc.isActive &&
      acc.controlKind === TENDER_CONTROL_KIND[tender] &&
      (acc.branchId === null || acc.branchId === branchId);

    out[tender] = usable
      ? {
          status: 'DIRECT',
          ledgerAccountId: acc!.id,
          ledgerName: acc!.name,
          ledgerCode: acc!.code,
          controlKind: TENDER_CONTROL_KIND[tender],
        }
      : { status: 'UNCONFIGURED', ledgerAccountId: null, ledgerName: null, ledgerCode: null, controlKind: TENDER_CONTROL_KIND[tender] };
  }
  return out;
}

/**
 * This branch's configuration, and the accounts it may choose from.
 *
 * The eligible list rides along so a settings screen never has to work out
 * eligibility for itself — the server decides, and the picker shows what the
 * server would accept.
 */
posTenderAccountsRouter.get(
  '/orgs/:orgId/pos/tender-accounts',
  requirePermission(MODULE, PermissionAction.VIEW, RESOURCE),
  async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId, branchId } = req.tenant!;
    await ensureLedgerSetup(accountId, orgId, req.auth!.userId);

    const [tenders, eligible] = await Promise.all([
      effectiveFor(orgId, branchId),
      receiptAccountsFor(prisma, { orgId, branchId }),
    ]);

    res.json({
      branchId,
      tenders,
      eligibleAccounts: eligible.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        controlKind: a.controlKind,
        /** Shared across the organisation, rather than owned by this branch. */
        shared: a.branchId === null,
      })),
    });
  }
);

/** Point one tender at one account. Refuses anything the money could not follow. */
posTenderAccountsRouter.put(
  '/orgs/:orgId/pos/tender-accounts',
  requirePermission(MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!orgOk(req, res)) return;
    const { accountId, orgId, branchId } = req.tenant!;
    const body = putSchema.parse(req.body);

    try {
      /* The server decides, never the caller. A screen that filters its
         dropdown is a convenience; this is the rule. */
      await assertAccountUsableForTender(prisma, {
        orgId,
        branchId,
        tender: body.tender,
        ledgerAccountId: body.ledgerAccountId,
      });
    } catch (e: any) {
      if (e instanceof IneligibleAccount) return res.status(e.status).json({ error: e.message });
      throw e;
    }

    await prisma.posTenderAccount.upsert({
      where: { orgId_branchId_tender: { orgId, branchId, tender: body.tender } },
      create: {
        accountId,
        orgId,
        branchId,
        tender: body.tender,
        ledgerAccountId: body.ledgerAccountId,
        createdByUserId: req.auth!.userId,
      },
      update: { ledgerAccountId: body.ledgerAccountId },
    });

    res.json({ branchId, tenders: await effectiveFor(orgId, branchId) });
  }
);

/**
 * Stop taking this tender.
 *
 * The row goes; the tender reports UNCONFIGURED. Removal is the absence of a
 * row rather than a sentinel account id, so there is no value anyone has to
 * remember means "none".
 */
posTenderAccountsRouter.delete(
  '/orgs/:orgId/pos/tender-accounts/:tender',
  requirePermission(MODULE, PermissionAction.EDIT, RESOURCE),
  async (req, res) => {
    if (!orgOk(req, res)) return;
    const { orgId, branchId } = req.tenant!;
    const tender = String(req.params.tender).toUpperCase();
    if (!isPosTender(tender)) return res.status(400).json({ error: 'Unknown tender' });

    await prisma.posTenderAccount.deleteMany({ where: { orgId, branchId, tender } });
    res.json({ branchId, tenders: await effectiveFor(orgId, branchId) });
  }
);

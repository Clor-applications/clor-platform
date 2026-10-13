import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { ownDocsWhere } from '../services/access.js';
import { PermissionAction } from '../constants/enums.js';
import { billPostingLines,
  creditNotePostingLines,
  debitNotePostingLines,
  ensureLedgerSetup,
  postEntry,
  reverseEntry, expensePostingLines } from '../services/ledger.js';
import { allocateNumber, ensureDefaultSeries } from '../services/numbering.js';
import { isFeatureEnabled } from '../services/features.js';
import { FxError, baseCurrencyFor, isBase, rateFor, toBase } from '../services/fx.js';

/**
 * Bills, credit notes and debit notes.
 *
 * One module rather than three: the documents differ only in which accounts
 * they touch and which party they name, and triplicating the number
 * allocation, currency translation and posting-failure handling is how those
 * three copies drift apart.
 *
 * Every one of them posts to the general ledger on create and reverses on
 * delete, exactly as invoices do — a document type that quietly skips the
 * ledger is how a set of books stops agreeing with the document list.
 */
export const purchaseDocsRouter = Router();
purchaseDocsRouter.use(requireAuth, requireTenantContext);

type DocKind = 'BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'EXPENSE';

const CONFIG: Record<
  DocKind,
  {
    path: string;
    model: 'bill' | 'creditNote' | 'debitNote';
    module: string;
    resource: string;
    feature: string | null;
    journalCode: string;
    partyLabel: 'CUSTOMER' | 'VENDOR';
    lines: (doc: any) => ReturnType<typeof billPostingLines>;
    /** Columns beyond the shared document shape (expense category etc). */
    extraData?: (body: any) => Record<string, unknown>;
  }
> = {
  BILL: {
    path: 'bills',
    model: 'bill',
    module: 'PURCHASE',
    resource: 'Bills',
    feature: null,
    journalCode: 'PUR',
    partyLabel: 'VENDOR',
    lines: billPostingLines,
  },
  CREDIT_NOTE: {
    path: 'credit-notes',
    model: 'creditNote',
    module: 'SALES',
    resource: 'Credit Notes',
    feature: 'creditNotes',
    journalCode: 'SAL',
    partyLabel: 'CUSTOMER',
    lines: creditNotePostingLines,
  },
  DEBIT_NOTE: {
    path: 'debit-notes',
    model: 'debitNote',
    module: 'PURCHASE',
    resource: 'Debit Notes',
    feature: 'debitNotes',
    journalCode: 'PUR',
    partyLabel: 'VENDOR',
    lines: debitNotePostingLines,
  },
  EXPENSE: {
    path: 'expenses',
    model: 'expense' as any,
    module: 'EXPENSES',
    resource: 'Expenses',
    feature: 'expenses',
    journalCode: 'PUR',
    partyLabel: 'VENDOR',
    lines: expensePostingLines,
    extraData: (body) => ({ category: body.category ?? null, description: body.description ?? null }),
  },
};

const itemSchema = z.object({
  /**
   * Item ids arrive as numbers from the browser book, where records are keyed
   * by an incrementing integer, and as strings from anything server-issued.
   * Demanding a string rejected the browser's own payload: raising a credit
   * note against an invoice failed outright with "Expected string, received
   * number", which is a sentence about a schema shown to somebody trying to
   * take goods back.
   */
  itemId: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional()
    .nullable(),
  description: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  rate: z.number().optional().nullable(),
  gstRate: z.number().optional().nullable(),
  hsnSac: z.string().optional().nullable(),
  taxableAmount: z.number().optional().nullable(),
  gstAmount: z.number().optional().nullable(),
  lineTotal: z.number().optional().nullable(),
  // Batch-tracked receipts: zod strips unknown keys, so without these the
  // write-through silently dropped batch detail entered on the bill.
  batchNo: z.string().optional().nullable(),
  mfgDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  serials: z.array(z.string()).optional(),
});

const docSchema = z.object({
  number: z.string().min(1).optional(),
  date: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  refNo: z.string().optional().nullable(),
  refDate: z.string().optional().nullable(),
  againstDocId: z.string().optional().nullable(),
  partyId: z.string().optional().nullable(),
  partyName: z.string().min(1),
  partyGstin: z.string().optional().nullable(),
  placeOfSupplyState: z.string().optional().nullable(),
  taxType: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  subtotal: z.number().optional(),
  cgstTotal: z.number().optional(),
  sgstTotal: z.number().optional(),
  igstTotal: z.number().optional(),
  gstTotal: z.number().optional(),
  total: z.number().optional(),
  status: z.string().optional(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  items: z.array(itemSchema).default([]),
});

const settlementSchema = z.object({
  settlementMode: z.string().optional(),
  billIds: z.array(z.string()).optional(),
  invoiceIds: z.array(z.string()).optional(),
  allocations: z
    .array(
      z.object({
        docId: z.string().min(1),
        amount: z.number().positive(),
        date: z.string().optional(),
      })
    )
    .default([]),
});

const num = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const KNOWN_BODY_KEYS = Object.keys(docSchema.shape);

/**
 * Fields an entry form collects that the document has no column for.
 * Without this the request schema silently dropped them and a browser that
 * had never seen the document rebuilt it incomplete — the same class of loss
 * that lost batch numbers on bills.
 */
const extrasOf = (body: any) => {
  const known = new Set(KNOWN_BODY_KEYS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (known.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

const spreadExtras = (row: any) => {
  try {
    const parsed = JSON.parse(String(row?.extrasJson || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalize = (row: any) => ({
  ...row,
  subtotal: num(row.subtotal),
  cgstTotal: num(row.cgstTotal),
  sgstTotal: num(row.sgstTotal),
  igstTotal: num(row.igstTotal),
  gstTotal: num(row.gstTotal),
  total: num(row.total),
  settledAmount: num(row.settledAmount),
  exchangeRate: num(row.exchangeRate),
  baseTotal: num(row.baseTotal),
  items: (() => {
    try {
      const parsed = JSON.parse(String(row.itemsJson || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })(),
  itemsJson: undefined,
  ...spreadExtras(row),
  extrasJson: undefined,
});

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

/** Registers list, create and delete for one document type. */
function register(kind: DocKind) {
  const cfg = CONFIG[kind];
  const table = () => (prisma as any)[cfg.model];

  const featureOn = async (req: any, res: any) => {
    if (!cfg.feature) return true;
    const { accountId, orgId } = req.tenant!;
    if (await isFeatureEnabled(accountId, orgId, cfg.feature)) return true;
    res.status(400).json({ error: `${cfg.resource} are switched off for this company` });
    return false;
  };

  purchaseDocsRouter.get(
    `/orgs/:orgId/${cfg.path}`,
    requirePermission(cfg.module, PermissionAction.VIEW, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId, branchId } = req.tenant!;

      const rows = await table().findMany({
        where: { accountId, orgId, branchId, ...ownDocsWhere(req) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(500, Number(req.query.limit || 200)),
      });

      res.json({ [cfg.path.replace(/-/g, '_')]: rows.map(normalize), documents: rows.map(normalize) });
    }
  );

  purchaseDocsRouter.post(
    `/orgs/:orgId/${cfg.path}`,
    requirePermission(cfg.module, PermissionAction.CREATE, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      if (!(await featureOn(req, res))) return;
      const { accountId, orgId, branchId } = req.tenant!;
      const userId = req.auth!.userId;
      const body = docSchema.parse(req.body);

      await ensureLedgerSetup(accountId, orgId, userId);

      // The ledger is single-currency: resolve the rate before writing, so a
      // document whose rate is unknown never reaches the books at a wrong
      // number.
      const baseCurrency = await baseCurrencyFor(accountId, orgId);
      const multiCurrencyOn = await isFeatureEnabled(accountId, orgId, 'multiCurrency');
      const docCurrency = multiCurrencyOn ? String(body.currency || baseCurrency).toUpperCase() : baseCurrency;
      let fxRate = 1;
      try {
        fxRate = isBase(docCurrency, baseCurrency) ? 1 : Number(body.exchangeRate || 0);
        if (!isBase(docCurrency, baseCurrency) && !(fxRate > 0)) throw new FxError(`Enter the conversion rate from ${docCurrency} to ${baseCurrency}`);
      } catch (e: any) {
        if (e instanceof FxError) return res.status(400).json({ error: e.message });
        throw e;
      }

      await ensureDefaultSeries({ accountId, orgId, branchId, docType: kind, userId });

      const created = await prisma.$transaction(async (tx) => {
        const number =
          String(body.number || '').trim() ||
          (await allocateNumber(tx as any, { accountId, orgId, branchId, docType: kind, userId, date: body.date }))
            .number;

        return (tx as any)[cfg.model].create({
          data: {
            accountId,
            orgId,
            branchId,
            number,
            date: body.date,
            dueDate: body.dueDate ?? null,
            refNo: body.refNo ?? null,
            refDate: body.refDate ?? null,
            againstDocId: body.againstDocId ?? null,
            partyId: body.partyId ?? null,
            partyName: body.partyName,
            partyGstin: body.partyGstin ?? null,
            placeOfSupplyState: body.placeOfSupplyState ?? null,
            taxType: body.taxType ?? null,
            subtotal: new Prisma.Decimal(num(body.subtotal).toFixed(2)),
            cgstTotal: new Prisma.Decimal(num(body.cgstTotal).toFixed(2)),
            sgstTotal: new Prisma.Decimal(num(body.sgstTotal).toFixed(2)),
            igstTotal: new Prisma.Decimal(num(body.igstTotal).toFixed(2)),
            gstTotal: new Prisma.Decimal(num(body.gstTotal).toFixed(2)),
            total: new Prisma.Decimal(num(body.total).toFixed(2)),
            status: body.status || 'Unpaid',
            itemsJson: JSON.stringify(body.items || []),
            extrasJson: extrasOf(req.body),
            currency: docCurrency,
            exchangeRate: new Prisma.Decimal(String(fxRate)),
            baseTotal: new Prisma.Decimal(toBase(num(body.total), fxRate).toFixed(2)),
            createdByUserId: userId,
            ...(cfg.extraData ? cfg.extraData(body) : {}),
          },
        });
      });

      // Posting failure removes the document: the books and the list must not
      // disagree.
      try {
        await postEntry({
          accountId,
          orgId,
          branchId,
          userId,
          date: body.date,
          journalCode: cfg.journalCode,
          narration: `${cfg.resource} ${created.number} - ${body.partyName}${
            fxRate === 1 ? '' : ` (${docCurrency} at ${fxRate})`
          }`,
          sourceDocType: kind,
          sourceDocId: created.id,
          lines: cfg.lines({
            partyId: body.partyId ?? null,
            partyName: body.partyName,
            subtotal: toBase(num(body.subtotal), fxRate),
            cgstTotal: toBase(num(body.cgstTotal), fxRate),
            sgstTotal: toBase(num(body.sgstTotal), fxRate),
            igstTotal: toBase(num(body.igstTotal), fxRate),
            total: toBase(num(body.total), fxRate),
            /* Read from the raw body on purpose: kept out of docSchema so it
               still round-trips through extrasJson with the rest of the TDS
               snapshot, while the posting reads it here. Only the bill and
               expense builders act on it; the others ignore it. */
            tdsAmount: toBase(num((req.body as any)?.tdsAmount), fxRate),
          }),
        });
      } catch (e: any) {
        await table().delete({ where: { id: created.id } });
        return res.status(Number(e?.status || 400)).json({ error: `Not saved: ${String(e?.message || e)}` });
      }

      res.status(201).json({ document: normalize(created) });
    }
  );

  /**
   * Update an existing purchase-side document and replace its accounting
   * effect. These documents are posted when they are created, so changing the
   * row without replacing the journal would leave the register and ledger at
   * different values. The original entries remain in the audit trail and are
   * reversed before the corrected document is posted.
   */
  purchaseDocsRouter.patch(
    `/orgs/:orgId/${cfg.path}/:docId`,
    requirePermission(cfg.module, PermissionAction.EDIT, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      if (!(await featureOn(req, res))) return;
      const { accountId, orgId, branchId } = req.tenant!;
      const userId = req.auth!.userId;
      const docId = String(req.params.docId);
      const existing = await table().findFirst({ where: { id: docId, accountId, orgId, branchId } });
      if (!existing) return res.status(404).json({ error: `${cfg.resource} not found` });

      const body = docSchema.parse(req.body);
      const settledAmount = num(existing.settledAmount);
      if (num(body.total) + 0.0001 < settledAmount) {
        return res.status(409).json({
          error: `This document has ${settledAmount.toFixed(2)} settled against it. Reverse the payment before reducing its total.`,
        });
      }

      const requestedNumber = String(body.number || existing.number).trim();
      if (requestedNumber !== String(existing.number)) {
        const duplicate = await table().findFirst({
          where: { accountId, orgId, number: requestedNumber, id: { not: existing.id } },
          select: { id: true },
        });
        if (duplicate) {
          return res.status(409).json({ error: `Number "${requestedNumber}" is already used by another document.` });
        }
      }

      await ensureLedgerSetup(accountId, orgId, userId);
      const baseCurrency = await baseCurrencyFor(accountId, orgId);
      const multiCurrencyOn = await isFeatureEnabled(accountId, orgId, 'multiCurrency');
      const docCurrency = multiCurrencyOn ? String(body.currency || existing.currency || baseCurrency).toUpperCase() : baseCurrency;
      let fxRate = 1;
      try {
        fxRate = isBase(docCurrency, baseCurrency) ? 1 : Number(body.exchangeRate || 0);
        if (!isBase(docCurrency, baseCurrency) && !(fxRate > 0)) throw new FxError(`Enter the conversion rate from ${docCurrency} to ${baseCurrency}`);
      } catch (e: any) {
        if (e instanceof FxError) return res.status(400).json({ error: e.message });
        throw e;
      }

      const entries = await prisma.journalEntry.findMany({
        where: { accountId, orgId, sourceDocType: kind, sourceDocId: existing.id, status: 'POSTED' },
        select: { id: true },
      });
      for (const entry of entries) {
        await reverseEntry({
          accountId,
          orgId,
          branchId,
          userId,
          entryId: entry.id,
          narration: `${cfg.resource} ${existing.number} amended`,
        });
      }

      const rawExtras = extrasOf(req.body);
      const nextExtras = {
        ...spreadExtras(existing),
        ...(rawExtras ? JSON.parse(rawExtras) : {}),
      };

      let updated: any;
      try {
        updated = await table().update({
          where: { id: existing.id },
          data: {
            number: requestedNumber,
            date: body.date,
            dueDate: body.dueDate ?? null,
            refNo: body.refNo ?? null,
            refDate: body.refDate ?? null,
            againstDocId: body.againstDocId ?? null,
            partyId: body.partyId ?? null,
            partyName: body.partyName,
            partyGstin: body.partyGstin ?? null,
            placeOfSupplyState: body.placeOfSupplyState ?? null,
            taxType: body.taxType ?? null,
            subtotal: new Prisma.Decimal(num(body.subtotal).toFixed(2)),
            cgstTotal: new Prisma.Decimal(num(body.cgstTotal).toFixed(2)),
            sgstTotal: new Prisma.Decimal(num(body.sgstTotal).toFixed(2)),
            igstTotal: new Prisma.Decimal(num(body.igstTotal).toFixed(2)),
            gstTotal: new Prisma.Decimal(num(body.gstTotal).toFixed(2)),
            total: new Prisma.Decimal(num(body.total).toFixed(2)),
            status: existing.status,
            itemsJson: JSON.stringify(body.items || []),
            extrasJson: Object.keys(nextExtras).length ? JSON.stringify(nextExtras) : null,
            currency: docCurrency,
            exchangeRate: new Prisma.Decimal(String(fxRate)),
            baseTotal: new Prisma.Decimal(toBase(num(body.total), fxRate).toFixed(2)),
            ...(cfg.extraData ? cfg.extraData(body) : {}),
          },
        });
      } catch (e: any) {
        const msg = String(e?.message || '');
        if (msg.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: `Number "${body.number}" is already used by another document.` });
        }
        throw e;
      }

      try {
        await postEntry({
          accountId,
          orgId,
          branchId,
          userId,
          date: body.date,
          journalCode: cfg.journalCode,
          narration: `${cfg.resource} ${updated.number} - ${body.partyName}`,
          sourceDocType: kind,
          sourceDocId: updated.id,
          lines: cfg.lines({
            partyId: body.partyId ?? null,
            partyName: body.partyName,
            subtotal: toBase(num(body.subtotal), fxRate),
            cgstTotal: toBase(num(body.cgstTotal), fxRate),
            sgstTotal: toBase(num(body.sgstTotal), fxRate),
            igstTotal: toBase(num(body.igstTotal), fxRate),
            total: toBase(num(body.total), fxRate),
            tdsAmount: toBase(num((req.body as any)?.tdsAmount), fxRate),
          }),
        });
      } catch (e: any) {
        return res.status(Number(e?.status || 400)).json({ error: `Updated document could not be reposted: ${String(e?.message || e)}` });
      }

      res.json({ document: normalize(updated) });
    }
  );

  /**
   * Settlement detail — which bills a note raised on account has been knocked
   * off against, and how much against each.
   *
   * This changes no amount and no account, so it posts nothing: the note's
   * own entry already moved the money on the party's control account. What is
   * recorded here is which documents that value answers, which is sub-ledger
   * detail rather than a fact about the books.
   */
  purchaseDocsRouter.patch(
    `/orgs/:orgId/${cfg.path}/:docId/settlement`,
    requirePermission(cfg.module, PermissionAction.EDIT, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId } = req.tenant!;

      const doc = await table().findFirst({ where: { id: String(req.params.docId), accountId, orgId, ...ownDocsWhere(req) } });
      if (!doc) return res.status(404).json({ error: `${cfg.resource} not found` });

      const parsed = settlementSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Allocations must each name a document and an amount above zero.' });
      }

      const allocated = parsed.data.allocations.reduce((t, a) => t + a.amount, 0);
      if (allocated > num(doc.total) + 0.0001) {
        return res.status(400).json({ error: 'Allocated more than this note is worth.' });
      }

      const extras = { ...spreadExtras(doc), ...parsed.data };
      const updated = await table().update({
        where: { id: doc.id },
        data: { extrasJson: JSON.stringify(extras) },
      });

      res.json({ document: normalize(updated) });
    }
  );

  /** Removal reverses the posting by contra entry; posted history is never edited. */
  purchaseDocsRouter.delete(
    `/orgs/:orgId/${cfg.path}/:docId`,
    requirePermission(cfg.module, PermissionAction.DELETE, cfg.resource),
    async (req, res) => {
      if (!orgOk(req, res)) return;
      const { accountId, orgId, branchId } = req.tenant!;

      const doc = await table().findFirst({ where: { id: String(req.params.docId), accountId, orgId, ...ownDocsWhere(req) } });
      if (!doc) return res.status(404).json({ error: `${cfg.resource} not found` });

      const entries = await prisma.journalEntry.findMany({
        where: { accountId, orgId, sourceDocType: kind, sourceDocId: doc.id, status: 'POSTED' },
        select: { id: true },
      });
      for (const e of entries) {
        await reverseEntry({
          accountId,
          orgId,
          branchId,
          userId: req.auth!.userId,
          entryId: e.id,
          narration: `${cfg.resource} ${doc.number} removed`,
        });
      }

      await table().delete({ where: { id: doc.id } });
      res.json({ ok: true, reversedEntries: entries.length });
    }
  );
}

(['BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'EXPENSE'] as DocKind[]).forEach(register);

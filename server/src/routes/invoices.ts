import { Router, type Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ensureLedgerSetup, invoicePostingLines, postEntry, reverseEntry } from '../services/ledger.js';
import { PosCheckoutError, assertPosSaleCancellable } from '../services/posCheckout.js';
import { recalcDocumentSettlement } from '../services/settlement.js';
import { MutationBlocked, assertInvoiceMutationAllowed } from '../services/invoiceMutation.js';
import { allowsEntity, filterFieldsByLevel, levelFor, ownDocsWhere, resolveAccess, resolveUserPermissions } from '../services/access.js';
import { evaluateApproval, isPending } from '../services/approvals.js';
import { fieldsFor } from '../constants/permissionCatalog.js';
import { dueDateFor } from './parties.js';
import { allocateNumber, ensureDefaultSeries } from '../services/numbering.js';
import { isFeatureEnabled } from '../services/features.js';
import { FxError, baseCurrencyFor, isBase, rateFor, toBase } from '../services/fx.js';
import { SettledDocument, assertInvoiceCancellable } from '../services/settledDocGuard.js';
import { refuseUnknownLineItems } from '../services/lineItems.js';
import { InsufficientStock, withStockCheck } from '../services/stockLedger.js';

/** An invoice's stored lines, or none if the text is not a list. */
const safeParseLines = (json: string | null | undefined): unknown[] => {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth, requireTenantContext);

const INVOICE_MODULE = 'SALES';
const INVOICE_SUBMODULE = 'Invoices';

const invoiceItemSchema = z.object({
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
  amount: z.number().optional().nullable(),
  taxableAmount: z.number().optional().nullable(),
  gstAmount: z.number().optional().nullable(),
  cgstAmount: z.number().optional().nullable(),
  sgstAmount: z.number().optional().nullable(),
  igstAmount: z.number().optional().nullable(),
  lineTotal: z.number().optional().nullable(),
  taxType: z.string().optional().nullable(),
  // Batch-tracked lines carry their batch identity; without these the
  // write-through dropped them and hydration lost batch detail.
  batchId: z.union([z.string(), z.number()]).optional().nullable(),
  batchNo: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  serials: z.array(z.string()).optional(),
  // Line discounts (same silent-strip class as batch fields).
  discountPct: z.union([z.string(), z.number()]).optional().nullable(),
  discountAmount: z.union([z.string(), z.number()]).optional().nullable(),
  discountManual: z.boolean().optional(),
});

const invoiceUpsertSchema = z.object({
  branchId: z.string().min(1).optional(),
  seriesId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  // Omit to have the server allocate from the series.
  number: z.string().min(1).optional(),
  date: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  refNo: z.string().optional().nullable(),
  refDate: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(1),
  /// Omit for the base currency.
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  customerGstin: z.string().optional().nullable(),
  placeOfSupplyState: z.string().optional().nullable(),
  taxType: z.string().optional().nullable(),
  reverseCharge: z.boolean().optional(),
  subtotal: z.number().optional(),
  cgstTotal: z.number().optional(),
  sgstTotal: z.number().optional(),
  igstTotal: z.number().optional(),
  gstTotal: z.number().optional(),
  total: z.number().optional(),
  paidAmount: z.number().optional(),
  status: z.string().optional(),
  sourceEstimateId: z.string().optional().nullable(),
  // Everything the entry forms collect that has no column of its own. Kept
  // together so the server stops silently discarding them.
  salesmanId: z.union([z.string(), z.number()]).optional().nullable(),
  costCenterId: z.union([z.string(), z.number()]).optional().nullable(),
  invoiceDiscountType: z.string().optional().nullable(),
  invoiceDiscountValue: z.union([z.string(), z.number()]).optional().nullable(),
  invoiceDiscountApplied: z.number().optional().nullable(),
  otherCharges: z.array(z.record(z.any())).optional(),
  otherChargesTotal: z.number().optional().nullable(),
  shipToAddressId: z.union([z.string(), z.number()]).optional().nullable(),
  sourceChallanId: z.union([z.string(), z.number()]).optional().nullable(),
  sourceSalesOrderId: z.union([z.string(), z.number()]).optional().nullable(),
  posSale: z.boolean().optional(),
  tender: z.string().optional().nullable(),
  customerMobile: z.string().optional().nullable(),
  items: z.array(invoiceItemSchema).default([]),
});

/** The extras, as stored: absent keys stay absent rather than becoming nulls. */
const EXTRA_KEYS = [
  'salesmanId',
  'costCenterId',
  'invoiceDiscountType',
  'invoiceDiscountValue',
  'invoiceDiscountApplied',
  'otherCharges',
  'otherChargesTotal',
  'shipToAddressId',
  'sourceChallanId',
  'sourceSalesOrderId',
  'posSale',
  'tender',
  'customerMobile',
] as const;

const extrasFrom = (body: any) => {
  const out: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) {
    if (body?.[k] !== undefined && body?.[k] !== null && body?.[k] !== '') out[k] = body[k];
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

/**
 * Extras survive a partial edit.
 *
 * `extrasFrom` builds the blob from scratch out of whatever the body carries,
 * which is right on create and wrong on a patch — a request naming only a note
 * would drop the salesman, the cost centre and the ship-to address that were
 * stored beside it. Only the keys the caller actually sent are replaced.
 */
const mergedExtras = (currentJson: string | null, body: any, sent: Set<string>) => {
  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(currentJson || '{}');
    if (parsed && typeof parsed === 'object') current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  for (const k of EXTRA_KEYS) {
    if (!sent.has(k)) continue;
    const v = body?.[k];
    if (v === undefined || v === null || v === '') delete current[k];
    else current[k] = v;
  }
  return Object.keys(current).length ? JSON.stringify(current) : null;
};

const statusSchema = z.object({
  status: z.string().min(1),
  paidAmount: z.number().optional(),
});

/*
 * Money arrives as a Prisma Decimal now that these rows are read through the
 * client rather than as raw SQL. Decimal converts through Number cleanly; the
 * signature is widened rather than the values cast, so the next Decimal that
 * turns up here is handled rather than silently coerced at the call site.
 */
const toNumber = (v: number | string | { toString(): string } | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const normalizeInvoiceResponse = (row: any) => {
  let items: any[] = [];
  try {
    const parsed = JSON.parse(String(row?.itemsJson || '[]'));
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }

  return {
    id: row.id,
    accountId: row.accountId,
    orgId: row.orgId,
    branchId: row.branchId,
    warehouseId: row.warehouseId || '',
    number: row.number,
    date: row.date,
    dueDate: row.dueDate || '',
    refNo: row.refNo || '',
    refDate: row.refDate || '',
    customerId: row.customerId || '',
    customerName: row.customerName || '',
    customerGstin: row.customerGstin || '',
    placeOfSupplyState: row.placeOfSupplyState || '',
    taxType: row.taxType || '',
    reverseCharge: !!row.reverseCharge,
    subtotal: toNumber(row.subtotal),
    cgstTotal: toNumber(row.cgstTotal),
    sgstTotal: toNumber(row.sgstTotal),
    igstTotal: toNumber(row.igstTotal),
    gstTotal: toNumber(row.gstTotal),
    total: toNumber(row.total),
    paidAmount: toNumber(row.paidAmount),
    status: row.status || 'Draft',
    sourceEstimateId: row.sourceEstimateId || null,
    ...(() => {
      try {
        const parsed = JSON.parse(String(row?.extrasJson || 'null'));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    })(),
    items,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

// Financial fields whose changes are recorded field-by-field in AuditLog.
const AUDITED_FIELDS = [
  'number', 'date', 'dueDate', 'customerId', 'customerName', 'customerGstin',
  'placeOfSupplyState', 'taxType', 'reverseCharge', 'subtotal', 'cgstTotal',
  'sgstTotal', 'igstTotal', 'gstTotal', 'total', 'paidAmount', 'status',
  'warehouseId', 'itemsJson',
] as const;

/**
 * An invoice that was raised, recorded.
 *
 * The trail carried edits, status changes and deletions and not the creation
 * itself — so a document appearing out of nowhere, which is the first thing an
 * auditor asks about, had no entry at all. There is nothing to diff on a
 * create, so this records what the document was raised as.
 */
async function auditInvoiceCreated(req: Request, row: any) {
  try {
    await platformPrisma.auditLog.create({
      data: {
        accountId: req.tenant!.accountId,
        orgId: req.tenant!.orgId,
        branchId: req.tenant!.branchId,
        entity: 'INVOICE',
        entityId: String(row?.id || ''),
        action: 'CREATE',
        message: `Invoice ${row?.number || ''} raised for ${row?.customerName || 'a customer'} (total ${toNumber(row?.total)})`,
        metadata: JSON.stringify({
          number: row?.number,
          date: row?.date,
          customerName: row?.customerName,
          total: toNumber(row?.total),
          status: row?.status,
        }),
        createdByUserId: req.auth!.userId,
      },
    });
  } catch {
    // Same rule as every other write here: the trail never fails the request.
    // An invoice that saved and went unlogged is bad; an invoice refused
    // because the log was busy is worse.
  }
}

/** Write a per-field diff of an invoice mutation. Never fails the request. */
async function auditInvoiceChange(
  req: Request,
  action: 'UPDATE' | 'STATUS' | 'DELETE',
  before: any,
  after: any | null,
) {
  try {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (after) {
      for (const f of AUDITED_FIELDS) {
        const a = before?.[f];
        const b = after?.[f];
        // Decimal columns come back as objects/strings; compare numerically
        // when both sides are numeric, as strings otherwise.
        const bothNumeric =
          a !== null && a !== undefined && a !== '' && !isNaN(Number(a)) &&
          b !== null && b !== undefined && b !== '' && !isNaN(Number(b));
        const same = bothNumeric ? toNumber(a) === toNumber(b) : String(a ?? '') === String(b ?? '');
        if (!same) changes[f] = { from: a ?? null, to: b ?? null };
      }
      if (!Object.keys(changes).length) return;
    }
    await platformPrisma.auditLog.create({
      data: {
        accountId: req.tenant!.accountId,
        orgId: req.tenant!.orgId,
        branchId: req.tenant!.branchId,
        entity: 'INVOICE',
        entityId: String(before?.id || ''),
        action,
        message:
          action === 'DELETE'
            ? `Invoice ${before?.number || ''} deleted (total ${toNumber(before?.total)})`
            : `Invoice ${before?.number || ''} ${action === 'STATUS' ? 'status changed' : 'edited'}`,
        metadata: JSON.stringify(after ? { changes } : { number: before?.number, total: toNumber(before?.total) }),
        createdByUserId: req.auth!.userId,
      },
    });
  } catch {
    // Audit is best-effort; the financial write itself already succeeded.
  }
}

invoicesRouter.get('/orgs/:orgId/invoices', requirePermission(INVOICE_MODULE, PermissionAction.VIEW, INVOICE_SUBMODULE), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const branchId = req.tenant!.branchId;
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  // Typed + bounded: ?limit (default 500, max 1000) and ?offset page through
  // large books instead of returning every row ever written (S-3/C-9).
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = await prisma.invoice.findMany({
    where: { accountId, orgId, branchId, ...ownDocsWhere(req) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });

  res.json({ invoices: rows.map((r: any) => normalizeInvoiceResponse(r)) });
});

invoicesRouter.post('/orgs/:orgId/invoices', requirePermission(INVOICE_MODULE, PermissionAction.CREATE, INVOICE_SUBMODULE), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = req.auth!.userId;
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const parsed = invoiceUpsertSchema.parse(req.body);
  const branchId = String(parsed.branchId || req.tenant!.branchId || '').trim();
  if (!branchId) return res.status(400).json({ error: 'Missing branchId' });
  if (await refuseUnknownLineItems(res, accountId, orgId, parsed.items)) return;

  // Document restrictions: a user limited to certain customers may not raise an
  // invoice for anyone else.
  const userPerms = await resolveUserPermissions(accountId, orgId, userId);
  if (!allowsEntity(userPerms, 'CUSTOMER', parsed.customerId)) {
    return res.status(403).json({ error: 'You are not permitted to raise documents for this customer' });
  }

  // Field-level permissions: silently drop fields above the caller's level
  // rather than failing the whole request, as ERPNext does.
  const access = await resolveAccess(accountId, orgId, userId, branchId);
  const grantedLevel = levelFor(access, INVOICE_MODULE, INVOICE_SUBMODULE, PermissionAction.CREATE);
  const { value: body, stripped } = filterFieldsByLevel(
    parsed,
    fieldsFor(INVOICE_MODULE, INVOICE_SUBMODULE),
    grantedLevel
  );

  // Requirement 12: the due date comes from the customer's payment terms, on
  // the server, so it cannot be quietly extended in the browser.
  // Gated on the paymentTerms feature: an org that switches it off keeps the
  // due date the operator typed instead of having it recomputed underneath
  // them.
  let resolvedDueDate = String(body.dueDate || '').trim() || null;
  if (body.customerId && (await isFeatureEnabled(accountId, orgId, 'paymentTerms'))) {
    const party = await prisma.party.findFirst({
      where: { id: String(body.customerId), accountId, orgId },
      select: { paymentTermDays: true },
    });
    if (party && party.paymentTermDays > 0) {
      resolvedDueDate = dueDateFor(String(body.date).trim(), party.paymentTermDays) || resolvedDueDate;
    }
  }

  // Requirement 2: the number comes from the configured series, allocated on
  // the server. Two browsers cannot mint the same one.
  let invoiceNumber = String(body.number || '').trim();
  if (!invoiceNumber) {
    await ensureDefaultSeries({ accountId, orgId, branchId, docType: 'INVOICE', userId });
    const allocated = await prisma.$transaction((tx) =>
      allocateNumber(tx, {
        accountId,
        orgId,
        branchId,
        docType: 'INVOICE',
        userId,
        date: String(body.date).trim(),
        seriesId: body.seriesId || null,
      })
    );
    invoiceNumber = allocated.number;
  }

  const id = randomUUID();
  try {
    /*
     * Prisma's own create rather than raw SQL.
     *
     * The placeholders below were SQLite's `?`, which Postgres does not accept,
     * and the duplicate-number check read SQLite's error text. Prisma writes
     * the right placeholder for whichever datasource is configured and reports
     * a duplicate as P2002 either way, so this is the change that lets the
     * provider move at all.
     */
    /* Under the stock check: the items are held, and a sale that would take
       a warehouse below nothing is refused before it is kept. */
    await prisma.$transaction((tx) =>
      withStockCheck(tx, { orgId, lines: body.items, warehouseId: body.warehouseId }, () =>
        tx.invoice.create({
      data: {
        id,
        accountId,
        orgId,
        branchId,
        warehouseId: String(body.warehouseId || '').trim() || null,
        number: invoiceNumber,
        date: String(body.date).trim(),
        dueDate: resolvedDueDate,
        refNo: String(body.refNo || '').trim() || null,
        refDate: String(body.refDate || '').trim() || null,
        customerId: String(body.customerId || '').trim() || null,
        customerName: String(body.customerName || '').trim(),
        customerGstin: String(body.customerGstin || '').trim() || null,
        placeOfSupplyState: String(body.placeOfSupplyState || '').trim() || null,
        taxType: String(body.taxType || '').trim() || null,
        reverseCharge: Boolean(body.reverseCharge),
        subtotal: body.subtotal ?? 0,
        cgstTotal: body.cgstTotal ?? 0,
        sgstTotal: body.sgstTotal ?? 0,
        igstTotal: body.igstTotal ?? 0,
        gstTotal: body.gstTotal ?? 0,
        total: body.total ?? 0,
        paidAmount: body.paidAmount ?? 0,
        status: String(body.status || 'Draft').trim() || 'Draft',
        sourceEstimateId: String(body.sourceEstimateId || '').trim() || null,
        itemsJson: JSON.stringify(body.items || []),
        extrasJson: extrasFrom(body),
        createdByUserId: userId,
      },
        })
      )
    );
  } catch (e: any) {
    if (e instanceof InsufficientStock) return res.status(e.status).json({ error: e.message, code: e.code, shortages: e.shortages });
    // P2002 is Prisma's duplicate, whatever the database calls it. The string
    // this used to match was SQLite's own wording.
    if (String(e?.code) === 'P2002') {
      return res.status(409).json({ error: 'That invoice number is already used. Numbers are unique across every branch.' });
    }
    throw e;
  }

  const row = await prisma.invoice.findUnique({ where: { id } });
  if (!row) return res.status(500).json({ error: 'Failed to create invoice' });

  // Approval thresholds are evaluated before anything reaches the ledger: an
  // invoice awaiting sign-off must not appear in the books.
  const approval = await evaluateApproval({
    accountId,
    orgId,
    branchId,
    userId,
    docType: 'INVOICE',
    docId: id,
    amount: Number(body.total ?? 0),
  });

  if (approval.required) {
    await prisma.invoice.update({ where: { id }, data: { status: 'Pending Approval' } });
    const held = await prisma.invoice.findUnique({ where: { id } });
    await auditInvoiceCreated(req, held);
    return res.status(201).json({
      invoice: normalizeInvoiceResponse(held),
      approval: { required: true, rule: approval.ruleName },
      strippedFields: stripped,
    });
  }

  // Post the invoice to the general ledger. A failure here is not silent: the
  // invoice row is removed so the books and the document list cannot diverge.
  try {
    await ensureLedgerSetup(accountId, orgId, userId);

    // Requirement 8: the document may be in any currency, but the ledger is
    // kept in one. Translate every amount at the rate in force on the document
    // date before posting — mixing currencies in one ledger would give a trial
    // balance that foots to zero and means nothing.
    const baseCurrency = await baseCurrencyFor(accountId, orgId);
    const multiCurrencyOn = await isFeatureEnabled(accountId, orgId, 'multiCurrency');
    const docCurrency = multiCurrencyOn ? String(body.currency || baseCurrency).toUpperCase() : baseCurrency;
    const fxRate = isBase(docCurrency, baseCurrency) ? 1 : Number(body.exchangeRate || 0);
    if (!isBase(docCurrency, baseCurrency) && !(fxRate > 0)) throw new FxError(`Enter the conversion rate from ${docCurrency} to ${baseCurrency}`);

    await prisma.invoice.update({
      where: { id },
      data: { currency: docCurrency, exchangeRate: fxRate, baseTotal: toBase(Number(body.total ?? 0), fxRate) },
    });

    await postEntry({
      accountId,
      orgId,
      branchId,
      userId,
      date: String(body.date).trim(),
      journalCode: 'SAL',
      narration:
        `Invoice ${invoiceNumber} - ${String(body.customerName || '').trim()}` +
        (fxRate === 1 ? '' : ` (${docCurrency} at ${fxRate})`),
      sourceDocType: 'INVOICE',
      sourceDocId: id,
      lines: invoicePostingLines({
        customerId: body.customerId ?? null,
        customerName: body.customerName,
        subtotal: toBase(Number(body.subtotal ?? 0), fxRate),
        cgstTotal: toBase(Number(body.cgstTotal ?? 0), fxRate),
        sgstTotal: toBase(Number(body.sgstTotal ?? 0), fxRate),
        igstTotal: toBase(Number(body.igstTotal ?? 0), fxRate),
        total: toBase(Number(body.total ?? 0), fxRate),
      }),
    });
  } catch (e: any) {
    await prisma.invoice.delete({ where: { id } });
    const status = Number(e?.status || 400);
    return res.status(status).json({ error: `Invoice not saved: ${String(e?.message || e)}` });
  }

  await auditInvoiceCreated(req, row);
  res.status(201).json({ invoice: normalizeInvoiceResponse(row), strippedFields: stripped });
});


/**
 * Settlement belongs to the allocations, not to whatever the caller sent.
 *
 * A browser holding a stale `paidAmount` used to be able to write it back over
 * a value the receipts had already decided. So once an invoice has been
 * settled by anything, its own allocations get the last word.
 *
 * Only once it has been settled, though: an invoice carrying an opening
 * balance from an import has no allocations behind it, and recomputing that to
 * zero would erase a real figure this phase is not meant to touch.
 */
async function reassertSettlement(accountId: string, orgId: string, invoiceId: string) {
  const allocated = await prisma.paymentAllocation.count({
    where: { accountId, orgId, docType: 'INVOICE', docId: invoiceId },
  });
  if (!allocated) return;
  await recalcDocumentSettlement(prisma, { accountId, orgId, docType: 'INVOICE', docId: invoiceId });
}

invoicesRouter.patch('/orgs/:orgId/invoices/:invoiceId', requirePermission(INVOICE_MODULE, PermissionAction.EDIT, INVOICE_SUBMODULE), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const invoiceId = String(req.params.invoiceId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId, orgId, branchId: req.tenant!.branchId, ...ownDocsWhere(req) },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  /*
   * What the caller actually sent, before Zod fills in its defaults.
   *
   * This used to write every column from the parsed body with `?? 0` behind
   * it, so a request carrying nothing but a note set subtotal, every tax total
   * and the invoice total to zero — while the ledger, which this route never
   * touched, kept the original figures. An omitted field now keeps what is
   * stored, which is what makes this a PATCH rather than a replace.
   */
  const sent = new Set(Object.keys((req.body ?? {}) as Record<string, unknown>));
  const parsedPatch = invoiceUpsertSchema.partial().parse(req.body);
  if (parsedPatch.items !== undefined && (await refuseUnknownLineItems(res, accountId, orgId, parsedPatch.items))) return;
  const editAccess = await resolveAccess(accountId, orgId, req.auth!.userId, req.tenant!.branchId);
  const { value: body, stripped } = filterFieldsByLevel(
    parsedPatch,
    fieldsFor(INVOICE_MODULE, INVOICE_SUBMODULE),
    levelFor(editAccess, INVOICE_MODULE, INVOICE_SUBMODULE, PermissionAction.EDIT)
  );

  if (await isPending(accountId, orgId, 'INVOICE', existing.id)) {
    return res.status(409).json({ error: 'This invoice is awaiting approval and cannot be edited' });
  }

  /* An invoice that has reached the books is no longer financially editable.
     Nothing is written if this throws. */
  try {
    await assertInvoiceMutationAllowed({ existing: existing as any, body: body as any, sent });
  } catch (e: any) {
    if (e instanceof MutationBlocked) return res.status(e.status).json({ error: e.message, field: e.field });
    throw e;
  }

  /** Supplied by the caller, and allowed through by the field-level filter. */
  const given = (key: string) => sent.has(key) && (body as any)[key] !== undefined;
  const keepText = (key: string, current: string | null) =>
    given(key) ? String((body as any)[key] || '').trim() || null : current;
  const keepNumber = (key: string, current: unknown) => (given(key) ? (body as any)[key] : toNumber(current as any));

  const nextWarehouseId = keepText('warehouseId', existing.warehouseId);
  const nextItems = given('items') ? (body as any).items || [] : safeParseLines(existing.itemsJson);
  try {
    await prisma.$transaction((tx) =>
      withStockCheck(tx, { orgId, lines: nextItems, warehouseId: nextWarehouseId }, () =>
        tx.invoice.update({
      where: { id: existing.id },
      data: {
        warehouseId: nextWarehouseId,
        number: given('number') ? String((body as any).number).trim() : existing.number,
        date: given('date') ? String((body as any).date).trim() : existing.date,
        dueDate: keepText('dueDate', existing.dueDate),
        refNo: keepText('refNo', existing.refNo),
        refDate: keepText('refDate', existing.refDate),
        customerId: keepText('customerId', existing.customerId),
        customerName: given('customerName') ? String((body as any).customerName || '').trim() : existing.customerName,
        customerGstin: keepText('customerGstin', existing.customerGstin),
        placeOfSupplyState: keepText('placeOfSupplyState', existing.placeOfSupplyState),
        taxType: keepText('taxType', existing.taxType),
        reverseCharge: given('reverseCharge') ? Boolean((body as any).reverseCharge) : existing.reverseCharge,
        subtotal: keepNumber('subtotal', existing.subtotal),
        cgstTotal: keepNumber('cgstTotal', existing.cgstTotal),
        sgstTotal: keepNumber('sgstTotal', existing.sgstTotal),
        igstTotal: keepNumber('igstTotal', existing.igstTotal),
        gstTotal: keepNumber('gstTotal', existing.gstTotal),
        total: keepNumber('total', existing.total),
        paidAmount: keepNumber('paidAmount', existing.paidAmount),
        /* Lifecycle transitions belong to the status route; anything that
           differs was already refused above, so this only ever re-writes what
           is already there. */
        status: existing.status || 'Draft',
        sourceEstimateId: keepText('sourceEstimateId', existing.sourceEstimateId),
        itemsJson: given('items') ? JSON.stringify((body as any).items || []) : existing.itemsJson,
        /* Extras are merged, not replaced: a note-only edit must not drop the
           salesman and the shipping address stored beside it. */
        extrasJson: mergedExtras(existing.extrasJson, body, sent),
      },
        })
      )
    );
  } catch (e: any) {
    if (e instanceof InsufficientStock) return res.status(e.status).json({ error: e.message, code: e.code, shortages: e.shortages });
    const msg = String(e?.message || '');
    if (msg.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'That invoice number is already used. Numbers are unique across every branch.' });
    }
    throw e;
  }

  const row = await prisma.invoice.findUnique({ where: { id: existing.id } });
  if (!row) return res.status(500).json({ error: 'Failed to update invoice' });

  await auditInvoiceChange(req, 'UPDATE', existing, row);

  await reassertSettlement(accountId, orgId, existing.id);
  const settled = await prisma.invoice.findUnique({ where: { id: existing.id } });
  res.json({ invoice: normalizeInvoiceResponse(settled ?? row), strippedFields: stripped });
});

invoicesRouter.patch('/orgs/:orgId/invoices/:invoiceId/status', requirePermission(INVOICE_MODULE, PermissionAction.EDIT, INVOICE_SUBMODULE), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const invoiceId = String(req.params.invoiceId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId, orgId, branchId: req.tenant!.branchId, ...ownDocsWhere(req) },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const body = statusSchema.parse(req.body);
  const nextStatus = String(body.status || existing.status).trim();
  const wasCancelled = String(existing.status || '').toLowerCase() === 'cancelled';
  const nowCancelled = nextStatus.toLowerCase() === 'cancelled';

  /*
   * Cancelling an invoice has to take its ledger entry with it.
   *
   * Deleting an invoice already reversed the posted entry; cancelling did not,
   * so the safer of the two actions was the one that left the books wrong. A
   * cancelled invoice kept its sales revenue and its output GST sitting in the
   * trial balance, overstating both the P&L and the tax liability, with nothing
   * on any screen to explain the difference.
   *
   * Reversed with a contra entry rather than by editing the original: a posted
   * row is immutable, and the audit trail should hold both halves.
   *
   * Guarded on the transition, not on the destination. Setting the status to
   * Cancelled twice must not post a second reversal.
   */
  let reversedEntries = 0;
  if (nowCancelled && !wasCancelled) {
    /* A counter sale that has been paid needs a refund, not a cancellation:
       this route reverses the sale and would leave the receipt standing. */
    try {
      await assertPosSaleCancellable(prisma, {
        accountId,
        orgId,
        invoiceId: existing.id,
        invoiceNumber: existing.number,
      });
    } catch (e: any) {
      if (e instanceof PosCheckoutError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    /* Nor may any other invoice something already leans on: a receipt
       allocated to it, or a credit note raised against it. Cancelling would
       take the sale out of the ledger and leave those standing. */
    try {
      await assertInvoiceCancellable({ accountId, orgId, invoice: existing });
    } catch (e: any) {
      if (e instanceof SettledDocument) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    const posted = await prisma.journalEntry.findMany({
      where: {
        accountId,
        orgId,
        sourceDocType: 'INVOICE',
        sourceDocId: existing.id,
        status: 'POSTED',
      },
      select: { id: true },
    });
    for (const p of posted) {
      await reverseEntry({
        accountId,
        orgId,
        branchId: req.tenant!.branchId,
        userId: req.auth!.userId,
        entryId: p.id,
        narration: `Invoice ${existing.number || ''} cancelled`.trim(),
      });
      reversedEntries += 1;
    }
  }

  /* Finalising a draft, or reinstating a cancelled invoice, takes the stock
     it names — checked like any other sale. */
  try {
    await prisma.$transaction((tx) =>
      withStockCheck(tx, { orgId, lines: safeParseLines(existing.itemsJson), warehouseId: existing.warehouseId }, () =>
        tx.invoice.update({
          where: { id: existing.id },
          data: { status: nextStatus, paidAmount: body.paidAmount ?? toNumber(existing.paidAmount) },
        })
      )
    );
  } catch (e: any) {
    if (e instanceof InsufficientStock) return res.status(e.status).json({ error: e.message, code: e.code, shortages: e.shortages });
    throw e;
  }
  const row = await prisma.invoice.findUnique({ where: { id: existing.id } });
  if (!row) return res.status(500).json({ error: 'Failed to update invoice status' });

  await auditInvoiceChange(req, 'STATUS', existing, row);

  await reassertSettlement(accountId, orgId, existing.id);
  const settled = await prisma.invoice.findUnique({ where: { id: existing.id } });
  res.json({ invoice: normalizeInvoiceResponse(settled ?? row), reversedEntries });
});

invoicesRouter.delete('/orgs/:orgId/invoices/:invoiceId', requirePermission(INVOICE_MODULE, PermissionAction.DELETE, INVOICE_SUBMODULE), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const invoiceId = String(req.params.invoiceId);
  if (orgId !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });

  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId, orgId, branchId: req.tenant!.branchId, ...ownDocsWhere(req) },
    select: { id: true, number: true, total: true, status: true },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  /*
   * An issued invoice is cancelled, never deleted.
   *
   * Rule 46(b) requires a consecutive serial number unique to the financial
   * year, and an invoice already reported in GSTR-1 has to be amended or
   * credit-noted — deleting it leaves a hole in the series that has to be
   * explained at assessment. A cancelled invoice keeps its number and stays on
   * the list, which is the whole point of it.
   *
   * A draft is different: it was never issued, holds no number the return has
   * seen, and deleting one destroys nothing.
   *
   * This is a business rule rather than a permission, deliberately. Holding
   * SALES::Invoices::DELETE should not make an issued document destroyable —
   * it governs drafts, and the law governs the rest.
   */
  const status = String(existing.status || '').trim();
  if (status.toLowerCase() !== 'draft') {
    return res.status(409).json({
      error:
        status.toLowerCase() === 'cancelled'
          ? 'A cancelled invoice is kept for the record and cannot be deleted.'
          : `Invoice ${existing.number || ''} has been issued and cannot be deleted. Cancel it instead — the number stays with the record.`.trim(),
      code: 'INVOICE_ISSUED',
      status,
    });
  }

  // Reverse any posted entry with a contra entry. Posted rows stay immutable,
  // so the audit trail keeps both the original and its reversal.
  const posted = await prisma.journalEntry.findMany({
    where: {
      accountId,
      orgId,
      sourceDocType: 'INVOICE',
      sourceDocId: existing.id,
      status: 'POSTED',
    },
    select: { id: true },
  });
  for (const p of posted) {
    await reverseEntry({
      accountId,
      orgId,
      branchId: req.tenant!.branchId,
      userId: req.auth!.userId,
      entryId: p.id,
      narration: 'Invoice deleted',
    });
  }

  await prisma.invoice.delete({ where: { id: existing.id } });
  await auditInvoiceChange(req, 'DELETE', existing, null);
  res.json({ ok: true, reversedEntries: posted.length });
});

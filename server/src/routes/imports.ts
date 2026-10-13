import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { parseCsv, toCsv } from '../services/csv.js';
import { IMPORT_SPECS, UNSUPPORTED_DOC_TYPES, specFor } from '../services/importSpecs.js';
import {
  billPostingLines,
  invoicePostingLines,
  creditNotePostingLines,
  debitNotePostingLines,
  ensureLedgerSetup,
  postEntry,
} from '../services/ledger.js';
import { isFeatureEnabled } from '../services/features.js';

/**
 * Document import — requirements 15 and 16.
 *
 * Three steps, deliberately: stage the file, validate it and show what is
 * wrong, then commit. An importer that writes while it parses leaves half a
 * ledger behind when row 400 turns out to be malformed, and the operator has
 * no way to tell which half.
 *
 * Committing is idempotent per row via a source key, so re-running a file that
 * failed part-way through finishes it rather than duplicating what already
 * landed.
 */
export const importsRouter = Router();
importsRouter.use(requireAuth, requireTenantContext);

const VIEW = requirePermission('ACCOUNTING', PermissionAction.VIEW, 'Ledger');
const CREATE = requirePermission('ACCOUNTING', PermissionAction.CREATE, 'Ledger');

const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

const featureOn = async (req: any, res: any) => {
  const { accountId, orgId } = req.tenant!;
  if (await isFeatureEnabled(accountId, orgId, 'imports')) return true;
  res.status(400).json({ error: 'Data import is switched off for this company' });
  return false;
};

const money = (v: string) => {
  const cleaned = String(v ?? '').replace(/[, ]/g, '');
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());

/**
 * Splits a combined GST amount into the accounts it belongs in.
 *
 * Intra-state supply is half CGST and half SGST; inter-state is all IGST.
 * Posting the whole amount to one of them would misstate the returns even
 * though the ledger would still balance, so the file says which it is.
 */
const splitGst = (gstTotal: number, taxType: string) => {
  const t = String(taxType || '').trim().toUpperCase();
  if (t === 'IGST' || t === 'INTER' || t === 'INTERSTATE') {
    return { cgst: 0, sgst: 0, igst: Math.round(gstTotal * 100) / 100 };
  }
  const half = Math.round((gstTotal / 2) * 100) / 100;
  // The remainder keeps the two halves summing to the whole on odd paise.
  return { cgst: half, sgst: Math.round((gstTotal - half) * 100) / 100, igst: 0 };
};

/** Which column names the party, per document type. */
const PARTY_COLUMN: Record<string, string> = {
  INVOICE: 'customer_name',
  BILL: 'vendor_name',
  CREDIT_NOTE: 'customer_name',
  DEBIT_NOTE: 'vendor_name',
};

const PARTY_LABEL: Record<string, string> = {
  INVOICE: 'Customer',
  BILL: 'Vendor',
  CREDIT_NOTE: 'Customer',
  DEBIT_NOTE: 'Vendor',
};

/** The Prisma model each document type is written into. */
const DOC_MODEL: Record<string, 'bill' | 'creditNote' | 'debitNote'> = {
  BILL: 'bill',
  CREDIT_NOTE: 'creditNote',
  DEBIT_NOTE: 'debitNote',
};

/** The posting lines each type contributes, and which journal it belongs in. */
const DOC_POSTING: Record<string, { journalCode: string; lines: typeof billPostingLines }> = {
  BILL: { journalCode: 'PUR', lines: billPostingLines },
  CREDIT_NOTE: { journalCode: 'SAL', lines: creditNotePostingLines },
  DEBIT_NOTE: { journalCode: 'PUR', lines: debitNotePostingLines },
};

// ---------------------------------------------------------------------------
// Templates (requirement 16)
// ---------------------------------------------------------------------------

/** What can be imported, and the columns each needs. */
importsRouter.get('/orgs/:orgId/imports/specs', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  res.json({
    specs: Object.values(IMPORT_SPECS),
    unsupported: Object.entries(UNSUPPORTED_DOC_TYPES).map(([docType, reason]) => ({ docType, reason })),
  });
});

/** A downloadable CSV template with one worked sample row. */
importsRouter.get('/orgs/:orgId/imports/template/:docType', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const spec = specFor(String(req.params.docType));
  if (!spec) {
    const reason = UNSUPPORTED_DOC_TYPES[String(req.params.docType).toUpperCase()];
    return res.status(400).json({ error: reason || 'Unknown document type' });
  }

  const headers = spec.columns.map((c) => c.key);
  const sample: Record<string, string> = {};
  for (const c of spec.columns) sample[c.key] = c.sample;

  // A journal template with one line would demonstrate an entry that cannot
  // balance, so the sample shows both sides.
  const rows =
    spec.docType === 'JOURNAL'
      ? [sample, { ...sample, account_code: '4000', debit: '', credit: '5000.00' }]
      : [sample];

  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${spec.docType.toLowerCase()}-template.csv"`);
  res.send(csv);
});

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

const stageSchema = z.object({
  docType: z.string().min(1),
  csv: z.string().min(1).max(5_000_000),
  fileName: z.string().max(200).optional().nullable(),
  sourceSystem: z.string().max(40).optional(),
});

importsRouter.post('/orgs/:orgId/imports', CREATE, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;
  const body = stageSchema.parse(req.body);

  const docType = body.docType.toUpperCase();
  const spec = specFor(docType);
  if (!spec) {
    const reason = UNSUPPORTED_DOC_TYPES[docType];
    return res.status(400).json({ error: reason || `Unknown document type ${docType}` });
  }

  const { headers, rows } = parseCsv(body.csv);
  if (!rows.length) return res.status(400).json({ error: 'The file has a header row but no data rows' });

  // Say which columns are missing up front rather than reporting the same
  // error against every row.
  const missing = spec.columns.filter((c) => c.required && !headers.includes(c.key)).map((c) => c.key);
  if (missing.length) {
    return res.status(400).json({ error: `Missing required column(s): ${missing.join(', ')}` });
  }

  const batch = await prisma.importBatch.create({
    data: {
      accountId,
      orgId,
      branchId,
      docType,
      sourceSystem: body.sourceSystem || 'CSV',
      fileName: body.fileName ?? null,
      totalRows: rows.length,
      createdByUserId: userId,
      rows: {
        create: rows.map((raw, idx) => ({
          accountId,
          orgId,
          rowNumber: idx + 2, // +2: the header is line 1, so this matches the file.
          raw: JSON.stringify(raw),
          sourceKey: String(raw[spec.groupBy] || '').trim() || null,
        })),
      },
    },
    include: { rows: true },
  });

  res.status(201).json({ batch: { ...batch, rows: undefined }, rowCount: batch.rows.length });
});

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

type Grouped = { key: string; rows: Array<{ id: string; rowNumber: number; data: Record<string, string> }> };

const groupRows = (rows: any[], groupBy: string): Grouped[] => {
  const map = new Map<string, Grouped>();
  for (const r of rows) {
    const data = JSON.parse(r.raw) as Record<string, string>;
    const key = String(data[groupBy] || '').trim();
    if (!map.has(key)) map.set(key, { key, rows: [] });
    map.get(key)!.rows.push({ id: r.id, rowNumber: r.rowNumber, data });
  }
  return [...map.values()];
};

/** Per-row problems, plus the group-level ones a single row cannot show. */
function validateGroups(docType: string, groups: Grouped[], accountCodes: Set<string>) {
  const errors = new Map<string, string>();

  const fail = (rowId: string, message: string) => {
    if (!errors.has(rowId)) errors.set(rowId, message);
  };

  for (const g of groups) {
    if (!g.key) {
      for (const r of g.rows) fail(r.id, 'Missing the column that groups lines into a document');
      continue;
    }

    for (const r of g.rows) {
      if (!isDate(r.data.date)) fail(r.id, `Date "${r.data.date || ''}" is not in YYYY-MM-DD form`);
    }

    if (docType === 'JOURNAL') {
      let debit = 0;
      let credit = 0;
      for (const r of g.rows) {
        const d = money(r.data.debit);
        const c = money(r.data.credit);
        if (Number.isNaN(d) || Number.isNaN(c)) {
          fail(r.id, 'Debit and credit must be numbers');
          continue;
        }
        if (d > 0 && c > 0) fail(r.id, 'A line may carry either a debit or a credit, not both');
        if (d === 0 && c === 0) fail(r.id, 'A line must carry a non-zero debit or credit');
        if (!accountCodes.has(String(r.data.account_code || '').trim())) {
          fail(r.id, `No ledger account with code "${r.data.account_code || ''}"`);
        }
        debit += d;
        credit += c;
      }

      // Balance is a property of the entry, so it is reported on every line of
      // it — the operator has to look at the whole entry to fix it anyway.
      if (Math.round((debit - credit) * 100) !== 0) {
        for (const r of g.rows) {
          fail(r.id, `Entry ${g.key} does not balance: debits ${debit.toFixed(2)} vs credits ${credit.toFixed(2)}`);
        }
      }
    }

    // Invoices, bills and both notes share a line shape; only the column
    // naming the party differs.
    const partyColumn = PARTY_COLUMN[docType];
    if (partyColumn) {
      for (const r of g.rows) {
        if (!String(r.data[partyColumn] || '').trim()) fail(r.id, `${PARTY_LABEL[docType]} is required`);
        if (!String(r.data.description || '').trim()) fail(r.id, 'Description is required');
        const qty = money(r.data.quantity);
        const rate = money(r.data.rate);
        if (Number.isNaN(qty) || qty <= 0) fail(r.id, 'Quantity must be a number greater than zero');
        if (Number.isNaN(rate) || rate < 0) fail(r.id, 'Rate must be a number');
      }
    }
  }

  return errors;
}

importsRouter.post('/orgs/:orgId/imports/:batchId/validate', CREATE, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId } = req.tenant!;

  const batch = await prisma.importBatch.findFirst({
    where: { id: String(req.params.batchId), accountId, orgId },
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!batch) return res.status(404).json({ error: 'Import not found' });
  if (batch.status === 'COMMITTED') return res.status(409).json({ error: 'This import has already been committed' });

  const spec = specFor(batch.docType)!;

  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId, isActive: true },
    select: { code: true },
  });
  const accountCodes = new Set(accounts.map((a) => a.code));

  const pending = batch.rows.filter((r) => r.status !== 'COMMITTED');
  const errors = validateGroups(batch.docType, groupRows(pending, spec.groupBy), accountCodes);

  await prisma.$transaction(
    pending.map((r) =>
      prisma.importRow.update({
        where: { id: r.id },
        data: errors.has(r.id)
          ? { status: 'ERROR', error: errors.get(r.id) }
          : { status: 'VALID', error: null },
      })
    )
  );

  const errorRows = errors.size;
  const validRows = pending.length - errorRows;

  const saved = await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: 'VALIDATED', validRows, errorRows },
  });

  res.json({
    batch: saved,
    issues: pending
      .filter((r) => errors.has(r.id))
      .map((r) => ({ rowNumber: r.rowNumber, error: errors.get(r.id) })),
  });
});

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Writes the valid rows.
 *
 * Rows carrying errors are skipped rather than blocking the file: an operator
 * fixing 3 bad rows out of 500 should not have to re-import the 497 good ones.
 * Committed rows are marked, so a second run of the same batch is a no-op for
 * anything already written.
 */
importsRouter.post('/orgs/:orgId/imports/:batchId/commit', CREATE, async (req, res) => {
  if (!orgOk(req, res)) return;
  if (!(await featureOn(req, res))) return;
  const { accountId, orgId, branchId } = req.tenant!;
  const userId = req.auth!.userId;

  const batch = await prisma.importBatch.findFirst({
    where: { id: String(req.params.batchId), accountId, orgId },
    include: { rows: { orderBy: { rowNumber: 'asc' } } },
  });
  if (!batch) return res.status(404).json({ error: 'Import not found' });
  if (batch.status === 'STAGED') {
    return res.status(400).json({ error: 'Validate this import before committing it' });
  }

  const spec = specFor(batch.docType)!;
  await ensureLedgerSetup(accountId, orgId, userId);

  const ready = batch.rows.filter((r) => r.status === 'VALID');
  const groups = groupRows(ready, spec.groupBy);

  const accounts = await prisma.ledgerAccount.findMany({ where: { orgId }, select: { id: true, code: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));

  let committed = 0;
  const failures: Array<{ group: string; error: string }> = [];

  for (const g of groups) {
    try {
      if (batch.docType === 'JOURNAL') {
        const first = g.rows[0].data;
        const entry = await postEntry({
          accountId,
          orgId,
          branchId,
          userId,
          date: String(first.date).trim(),
          journalCode: 'JV',
          narration: String(first.narration || `Imported ${g.key}`).trim(),
          sourceDocType: 'IMPORT_JOURNAL',
          sourceDocId: `${batch.id}:${g.key}`,
          lines: g.rows.map((r) => ({
            ledgerAccountId: byCode.get(String(r.data.account_code).trim())!,
            debit: money(r.data.debit) || undefined,
            credit: money(r.data.credit) || undefined,
            description: String(r.data.narration || '').trim() || undefined,
          })),
        });

        await prisma.$transaction(
          g.rows.map((r) =>
            prisma.importRow.update({
              where: { id: r.id },
              data: { status: 'COMMITTED', targetId: String((entry as any)?.id || ''), error: null },
            })
          )
        );
        committed += g.rows.length;
      }

      if (batch.docType === 'INVOICE') {
        const first = g.rows[0].data;
        const items = g.rows.map((r) => {
          const qty = money(r.data.quantity);
          const rate = money(r.data.rate);
          const gstRate = money(r.data.gst_rate) || 0;
          // A line discount is a percentage off the line before tax, which is
          // how the creation form applies it — importing without it made every
          // discounted historical line arrive at list price.
          const discountPct = Math.max(0, Math.min(100, money(r.data.discount_pct) || 0));
          const gross = qty * rate;
          const taxable = gross - (gross * discountPct) / 100;
          return {
            description: String(r.data.description || '').trim(),
            itemCode: String(r.data.item_code || '').trim() || undefined,
            unit: String(r.data.unit || '').trim() || undefined,
            hsnSac: String(r.data.hsn_sac || '').trim() || undefined,
            quantity: qty,
            rate,
            discountPct: discountPct || undefined,
            gstRate,
            taxableAmount: taxable,
            gstAmount: (taxable * gstRate) / 100,
            lineTotal: taxable + (taxable * gstRate) / 100,
          };
        });

        const subtotal = items.reduce((s2, i) => s2 + i.taxableAmount, 0);
        const gstTotal = items.reduce((s2, i) => s2 + i.gstAmount, 0);
        const total = subtotal + gstTotal;
        const tax = splitGst(gstTotal, first.tax_type);

        // Historical numbers are kept exactly as supplied: renumbering an
        // imported year makes it impossible to tie back to the old system.
        const created = await prisma.invoice.create({
          data: {
            accountId,
            orgId,
            branchId,
            number: g.key,
            date: String(first.date).trim(),
            dueDate: String(first.due_date || '').trim() || null,
            customerName: String(first.customer_name).trim(),
            customerGstin: String(first.customer_gstin || '').trim() || null,
            placeOfSupplyState: String(first.place_of_supply || '').trim() || null,
            refNo: String(first.ref_no || '').trim() || null,
            refDate: String(first.ref_date || '').trim() || null,
            subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
            cgstTotal: new Prisma.Decimal(tax.cgst.toFixed(2)),
            sgstTotal: new Prisma.Decimal(tax.sgst.toFixed(2)),
            igstTotal: new Prisma.Decimal(tax.igst.toFixed(2)),
            gstTotal: new Prisma.Decimal(gstTotal.toFixed(2)),
            total: new Prisma.Decimal(total.toFixed(2)),
            baseTotal: new Prisma.Decimal(total.toFixed(2)),
            status: 'Unpaid',
            itemsJson: JSON.stringify(items),
            sourceSystem: batch.sourceSystem,
            sourceKey: g.key,
            createdByUserId: userId,
          },
        });

        // An imported invoice posts to the ledger exactly as a keyed-in one
        // does. Without this the books were quietly short by everything that
        // had been imported, while the invoice list looked complete.
        await postEntry({
          accountId,
          orgId,
          branchId,
          userId,
          date: String(first.date).trim(),
          journalCode: 'SAL',
          narration: `Imported invoice ${g.key}`,
          sourceDocType: 'INVOICE',
          sourceDocId: created.id,
          lines: invoicePostingLines({
            customerName: String(first.customer_name).trim(),
            subtotal,
            cgstTotal: tax.cgst,
            sgstTotal: tax.sgst,
            igstTotal: tax.igst,
            total,
          }),
        });

        await prisma.$transaction(
          g.rows.map((r) =>
            prisma.importRow.update({
              where: { id: r.id },
              data: { status: 'COMMITTED', targetId: created.id, error: null },
            })
          )
        );
        committed += g.rows.length;
      }

      const model = DOC_MODEL[batch.docType];
      if (model) {
        const first = g.rows[0].data;
        const partyColumn = PARTY_COLUMN[batch.docType];
        const items = g.rows.map((r) => {
          const qty = money(r.data.quantity);
          const rate = money(r.data.rate);
          const gstRate = money(r.data.gst_rate) || 0;
          const taxable = qty * rate;
          return {
            description: String(r.data.description || '').trim(),
            quantity: qty,
            rate,
            gstRate,
            taxableAmount: taxable,
            gstAmount: (taxable * gstRate) / 100,
            lineTotal: taxable + (taxable * gstRate) / 100,
          };
        });

        const subtotal = items.reduce((s2, i) => s2 + i.taxableAmount, 0);
        const gstTotal = items.reduce((s2, i) => s2 + i.gstAmount, 0);
        const total = subtotal + gstTotal;
        const tax = splitGst(gstTotal, first.tax_type);

        const created = await (prisma as any)[model].create({
          data: {
            accountId,
            orgId,
            branchId,
            number: g.key,
            date: String(first.date).trim(),
            againstDocId: String(first.against_invoice || first.against_bill || '').trim() || null,
            partyName: String(first[partyColumn] || '').trim(),
            partyGstin: String(first.vendor_gstin || first.customer_gstin || '').trim() || null,
            subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
            cgstTotal: new Prisma.Decimal(tax.cgst.toFixed(2)),
            sgstTotal: new Prisma.Decimal(tax.sgst.toFixed(2)),
            igstTotal: new Prisma.Decimal(tax.igst.toFixed(2)),
            gstTotal: new Prisma.Decimal(gstTotal.toFixed(2)),
            total: new Prisma.Decimal(total.toFixed(2)),
            baseTotal: new Prisma.Decimal(total.toFixed(2)),
            status: 'Unpaid',
            itemsJson: JSON.stringify(items),
            sourceSystem: batch.sourceSystem,
            sourceKey: g.key,
            createdByUserId: userId,
          },
        });

        // Imported documents post to the ledger exactly as ones keyed in by
        // hand do. A type that skipped posting would leave the books quietly
        // short by whatever was imported.
        const posting = DOC_POSTING[batch.docType];
        await postEntry({
          accountId,
          orgId,
          branchId,
          userId,
          date: String(first.date).trim(),
          journalCode: posting.journalCode,
          narration: `Imported ${batch.docType} ${g.key}`,
          sourceDocType: batch.docType,
          sourceDocId: created.id,
          lines: posting.lines({
            partyName: String(first[partyColumn] || '').trim(),
            subtotal,
            cgstTotal: tax.cgst,
            sgstTotal: tax.sgst,
            igstTotal: tax.igst,
            total,
          }),
        });

        await prisma.$transaction(
          g.rows.map((r) =>
            prisma.importRow.update({
              where: { id: r.id },
              data: { status: 'COMMITTED', targetId: created.id, error: null },
            })
          )
        );
        committed += g.rows.length;
      }
    } catch (e: any) {
      const message = String(e?.message || e);
      failures.push({ group: g.key, error: message });
      await prisma.$transaction(
        g.rows.map((r) => prisma.importRow.update({ where: { id: r.id }, data: { status: 'ERROR', error: message } }))
      );
    }
  }

  const saved = await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: failures.length && !committed ? 'FAILED' : 'COMMITTED',
      committedRows: batch.committedRows + committed,
      errorRows: batch.errorRows + failures.length,
      committedAt: new Date(),
    },
  });

  res.json({ batch: saved, committed, failures });
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

importsRouter.get('/orgs/:orgId/imports', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId, branchId } = req.tenant!;

  const rows = await prisma.importBatch.findMany({
    where: { accountId, orgId, branchId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Number(req.query.limit || 25)),
  });
  res.json({ imports: rows });
});

importsRouter.get('/orgs/:orgId/imports/:batchId', VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;

  const batch = await prisma.importBatch.findFirst({
    where: { id: String(req.params.batchId), accountId, orgId },
    include: { rows: { orderBy: { rowNumber: 'asc' }, take: 1000 } },
  });
  if (!batch) return res.status(404).json({ error: 'Import not found' });

  res.json({
    batch: { ...batch, rows: undefined },
    rows: batch.rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      error: r.error,
      targetId: r.targetId,
      raw: JSON.parse(r.raw),
    })),
  });
});

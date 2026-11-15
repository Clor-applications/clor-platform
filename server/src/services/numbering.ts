import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { fiscalYearFor } from './ledger.js';

/**
 * Document numbering.
 *
 * Numbers are allocated on the server, inside the transaction that writes the
 * document. Minting them in the browser can only detect a clash afterwards,
 * when the unique index rejects the insert — by which point the operator has
 * already typed the whole voucher.
 */

export type SeriesInput = {
  accountId: string;
  orgId: string;
  branchId?: string | null;
  docType: string;
  userId: string;
};

const DEFAULT_PREFIX: Record<string, string> = {
  INVOICE: 'INV-',
  BILL: 'BILL-',
  EXPENSE: 'EXP-',
  RECEIPT: 'RCP-',
  PAYMENT: 'PAY-',
  JOURNAL: 'JE-',
  ESTIMATE: 'EST-',
  PURCHASE_ORDER: 'PO-',
  SALES_ORDER: 'SO-',
  CREDIT_NOTE: 'CN-',
  DEBIT_NOTE: 'DN-',
  TRANSFER: 'TRF-',
  DELIVERY_CHALLAN: 'DC-',
};

/** The period a number belongs to, for series that reset. */
export function periodKeyFor(resetPolicy: string, dateIso: string) {
  const date = String(dateIso || '').slice(0, 10);
  if (resetPolicy === 'MONTH') return date.slice(0, 7);
  if (resetPolicy === 'FISCAL_YEAR') return fiscalYearFor(date).name;
  return 'ALL';
}

/** Creates the default series for a document type the first time it is used. */
export async function ensureDefaultSeries(input: SeriesInput) {
  const existing = await prisma.numberSeries.findFirst({
    where: {
      accountId: input.accountId,
      orgId: input.orgId,
      docType: input.docType,
      isActive: true,
      OR: [{ branchId: null }, { branchId: input.branchId ?? null }],
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (existing) return existing;

  return prisma.numberSeries.create({
    data: {
      accountId: input.accountId,
      orgId: input.orgId,
      branchId: null,
      docType: input.docType,
      name: 'Default',
      prefix: DEFAULT_PREFIX[input.docType] || `${input.docType.slice(0, 3)}-`,
      padding: 5,
      nextNumber: 1,
      resetPolicy: 'FISCAL_YEAR',
      isDefault: true,
      createdByUserId: input.userId,
    },
  });
}

/**
 * A series that restarts each period must carry the period in the number, or
 * this year's INV-00001 collides with last year's on the uniqueness index — and
 * an invoice number that repeats across years is wrong for GST anyway.
 *
 * Fiscal year 2026-27 renders as 2627; a monthly series as 202608.
 */
export function periodSegment(resetPolicy: string, periodKey: string) {
  if (resetPolicy === 'NEVER') return '';
  if (resetPolicy === 'MONTH') return `${periodKey.replace('-', '')}-`;
  const [start, end] = periodKey.split('-');
  if (!start || !end) return `${periodKey}-`;
  return `${start.slice(-2)}${end}-`;
}

export function formatNumber(
  series: { prefix: string; suffix: string; padding: number; resetPolicy: string },
  value: number,
  periodKey: string
) {
  const period = periodSegment(series.resetPolicy, periodKey);
  return `${series.prefix}${period}${String(value).padStart(series.padding, '0')}${series.suffix}`;
}

const documentNumberStore: Record<string, [string, string]> = {
  INVOICE: ['invoice', 'number'], POS: ['invoice', 'number'], BILL: ['bill', 'number'], EXPENSE: ['expense', 'number'],
  RECEIPT: ['payment', 'number'], PAYMENT: ['payment', 'number'], JOURNAL: ['journalEntry', 'entryNo'],
  ESTIMATE: ['estimate', 'number'], PURCHASE_ORDER: ['purchaseOrderDoc', 'number'],
  SALES_ORDER: ['salesOrderDoc', 'number'], CREDIT_NOTE: ['creditNote', 'number'],
  DEBIT_NOTE: ['debitNote', 'number'], TRANSFER: ['interBranchTransfer', 'transferNo'],
  DELIVERY_CHALLAN: ['deliveryChallan', 'number'],
};

async function numberAlreadyUsed(client: Prisma.TransactionClient | typeof prisma, orgId: string, docType: string, number: string) {
  const store = documentNumberStore[docType];
  if (!store) return false;
  const [model, field] = store;
  return Boolean(await (client as any)[model].findFirst({ where: { orgId, [field]: number }, select: { id: true } }));
}

export async function firstAvailableNumber(client: Prisma.TransactionClient | typeof prisma, orgId: string, docType: string, series: { prefix: string; suffix: string; padding: number; resetPolicy: string }, start: number, period: string) {
  for (let value = start; value < start + 10000; value += 1) {
    const number = formatNumber(series, value, period);
    if (!(await numberAlreadyUsed(client, orgId, docType, number))) return { number, value };
  }
  throw new Error(`No unused number is available for ${docType}`);
}

/**
 * Allocates the next number for a series, atomically.
 *
 * Pass the surrounding transaction so the allocation and the document commit or
 * roll back together: a failed insert must not burn a number.
 */
export async function allocateNumber(
  tx: Prisma.TransactionClient,
  opts: SeriesInput & { date: string; seriesId?: string | null }
) {
  const series = opts.seriesId
    ? await tx.numberSeries.findFirst({
        where: { id: opts.seriesId, accountId: opts.accountId, orgId: opts.orgId, docType: opts.docType, isActive: true },
      })
    : await tx.numberSeries.findFirst({
        where: {
          accountId: opts.accountId,
          orgId: opts.orgId,
          docType: opts.docType,
          isActive: true,
          OR: [{ branchId: null }, { branchId: opts.branchId ?? null }],
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

  if (!series) throw new Error(`No number series configured for ${opts.docType}`);

  const period = periodKeyFor(series.resetPolicy, opts.date);

  /*
   * Read and bump in one statement. Reading nextNumber and writing it back
   * separately let two saves at the same moment read the same value; the
   * second then failed on the unique number. The UPDATE takes the row lock,
   * so a concurrent save waits, re-reads the bumped row and gets the next one.
   * A series that resets starts again the first time it is used in a new period.
   */
  const [row] = await tx.$queryRaw<Array<{ value: number }>>`
    UPDATE "NumberSeries"
       SET "nextNumber" = CASE WHEN "resetPolicy" <> 'NEVER' AND "periodKey" IS DISTINCT FROM ${period} THEN 2 ELSE "nextNumber" + 1 END,
           "periodKey" = ${period},
           "updatedAt" = now()
     WHERE id = ${series.id}
     RETURNING "nextNumber" - 1 AS value`;
  const value = Number(row.value);

  /*
   * The counter's number may already be on a document: typed by hand, or
   * issued by another series with the same format. Skip forward to the first
   * free one and move the counter past it. The UPDATE above still holds the
   * row lock, so no other save can take a number from this series meanwhile.
   */
  const candidate = await firstAvailableNumber(tx, opts.orgId, opts.docType, series, value, period);
  if (candidate.value !== value) {
    await tx.numberSeries.update({ where: { id: series.id }, data: { nextNumber: candidate.value + 1 } });
  }

  return { number: candidate.number, seriesId: series.id, value: candidate.value };
}

/** What the next number would be, for showing on a blank form. */
export async function peekNumber(opts: SeriesInput & { date: string }) {
  const series = await ensureDefaultSeries(opts);
  const period = periodKeyFor(series.resetPolicy, opts.date);
  const startsNewPeriod = series.resetPolicy !== 'NEVER' && series.periodKey !== period;
  const candidate = await firstAvailableNumber(prisma, opts.orgId, opts.docType, series, startsNewPeriod ? 1 : series.nextNumber, period);
  return { number: candidate.number, seriesId: series.id, allowManual: series.allowManual };
}

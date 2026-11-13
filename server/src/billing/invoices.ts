import QRCode from 'qrcode';
import { unitWord } from '../services/pricing/deals.js';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { deriveStateCodeFromInput, gstinStateCode, isValidGstinChecksum, isValidGstinFormat } from '../utils/gstin.js';
import { gstOn } from '../services/pricing/engine.js';
import { taxSetting } from '../services/pricing/settings.js';
import { APP_CATALOG } from '../constants/appCatalog.js';
import { recordInvoicePayment } from './events.js';
import { manualProblems, type ManualDetails } from './gateway.js';
import { PaymentsError } from './providers.js';
import { INVOICING_KEY, financialYear, formatNumber, invoicing, readInvoicing } from './invoicing.js';

/**
 * CLOR's invoices to its customers (roadmap item 8): a draft made in the
 * operator console, issued with the next number of the year's series, then
 * paid or cancelled. An issued invoice shows how to pay it: a UPI QR that
 * already carries the amount and the invoice number, and CLOR's bank account,
 * both from Payments, Manual. "Mark paid" records the UTR through the same
 * code as Record a payment, so the customer's subscription moves on as well.
 *
 * Every amount is paise. Once issued nothing on the invoice is recomputed:
 * the seller, buyer, lines, tax and payment details are copied in.
 */

export type Line = { description: string; appCode?: string | null; quantity: number; unitAmount: number; amount: number };
export type Buyer = { name: string; gstin: string | null; stateCode: string | null; state: string | null; address: string | null; email: string | null };
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;

const str = (v: unknown, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const APP_NAME: Record<string, string> = Object.fromEntries(APP_CATALOG.map((a) => [a.code, a.name]));
const appName = (code: string) => (code === 'accounting' ? 'Books' : APP_NAME[code] || code);

/** Lines as typed, checked: a description, a whole quantity, a price in paise. The amount is always worked out here. */
export function cleanLines(input: unknown): { lines: Line[]; problems: string[] } {
  const list = Array.isArray(input) ? input : [];
  const problems: string[] = [];
  const lines: Line[] = [];
  list.slice(0, 30).forEach((l: any, i) => {
    const description = str(l?.description, 200);
    const quantity = Number(l?.quantity);
    const unitAmount = Number(l?.unitAmount);
    if (!description) problems.push(`Line ${i + 1}: say what it is for.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) problems.push(`Line ${i + 1}: the quantity is a whole number from 1.`);
    if (!Number.isInteger(unitAmount) || unitAmount < 0 || unitAmount > 1_00_00_000_00) problems.push(`Line ${i + 1}: enter the price in rupees.`);
    if (description && Number.isInteger(quantity) && Number.isInteger(unitAmount)) lines.push({ description, appCode: str(l?.appCode, 20), quantity, unitAmount, amount: quantity * unitAmount });
  });
  if (!lines.length && !problems.length) problems.push('Add at least one line.');
  return { lines, problems };
}

export function cleanBuyer(input: any, fallbackName: string): { buyer: Buyer; problems: string[] } {
  const problems: string[] = [];
  const gstin = str(input?.gstin, 15)?.toUpperCase() ?? null;
  if (gstin && !(isValidGstinFormat(gstin) && isValidGstinChecksum(gstin))) problems.push('The customer’s GSTIN is not right: check the 15 characters.');
  const state = str(input?.state, 60);
  let stateCode = state ? deriveStateCodeFromInput(state) || null : null;
  if (state && !stateCode) problems.push('Choose the customer’s state from the list.');
  if (gstin && isValidGstinFormat(gstin)) stateCode = gstinStateCode(gstin);
  const email = str(input?.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('The customer’s email is not right.');
  return { buyer: { name: str(input?.name, 160) || fallbackName, gstin, stateCode, state, address: str(input?.address, 400), email }, problems };
}

/** What the customer is billed: lines, GST by CLOR's standing and the buyer's state, and the total. */
export async function totalsFor(lines: Line[], buyerStateCode: string | null) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = gstOn(subtotal, await taxSetting(), buyerStateCode);
  return { subtotal, tax, taxTotal: tax.amount, total: subtotal + tax.amount };
}

/** The customer as CLOR knows them: the account's name, its first company's head office and the owner's email. */
export async function buyerFor(accountId: string): Promise<Buyer> {
  return outsideTenant('billing: who an invoice is to', async () => {
    const account = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
    if (!account) throw new PaymentsError('No such customer account.', 404);
    /* The first company's legal name is who is billed; the account's own name is often the owner's. */
    const org = await platformPrisma.org.findFirst({ where: { accountId, archivedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    const branch = org ? await platformPrisma.branch.findFirst({ where: { orgId: org.id, isActive: true }, orderBy: { createdAt: 'asc' }, select: { addressLine1: true, addressLine2: true, city: true, state: true, gstin: true } }) : null;
    const owner = await platformPrisma.accountMembership.findFirst({ where: { accountId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    const user = owner ? await platformPrisma.user.findUnique({ where: { id: owner.userId }, select: { email: true } }) : null;
    const gstin = branch?.gstin && isValidGstinFormat(branch.gstin) ? branch.gstin.toUpperCase() : null;
    const state = branch?.state || null;
    return {
      name: org?.name || account.name,
      gstin,
      stateCode: gstin ? gstinStateCode(gstin) : state ? deriveStateCodeFromInput(state) || null : null,
      state,
      address: [branch?.addressLine1, branch?.addressLine2, branch?.city].filter(Boolean).join(', ') || null,
      email: user?.email || null,
    };
  });
}

/** Lines to start a draft from: the apps the account's subscription carries, at the price set on it. */
/**
 * A deal CLOR staff set (routes/opsDeals.ts) is one line for a period: the
 * offer's price while it lasts, the list price for a period that starts after
 * it ends. Null when the subscription has no price.
 */
export function dealLine(
  sub: { periodAmount: number | null; listAmount: number | null; planName: string | null; planUnit: string | null; quantity: number | null; billingInterval: string | null; offerCode: string | null; offerEndsAt: Date | null },
  periodStarts: Date = new Date(),
): Line | null {
  if (sub.periodAmount == null || !sub.planName) return null;
  const offerOn = Boolean(sub.offerCode) && (!sub.offerEndsAt || sub.offerEndsAt > periodStarts);
  const amount = offerOn ? sub.periodAmount : (sub.listAmount ?? sub.periodAmount);
  const per = sub.billingInterval === 'year' ? 'yearly' : 'monthly';
  const units = sub.quantity && sub.planUnit ? `, ${unitWord(sub.planUnit, sub.quantity)}` : '';
  return { description: `CLOR ${sub.planName}${units}, ${per}${offerOn ? ` (${sub.offerCode})` : ''}`.slice(0, 200), appCode: null, quantity: 1, unitAmount: amount, amount };
}

export async function suggestedLines(accountId: string): Promise<Line[]> {
  const sub = await outsideTenant('billing: lines for an invoice', () => platformPrisma.subscription.findUnique({ where: { accountId }, include: { items: true } }));
  const deal = sub ? dealLine(sub) : null;
  if (deal) return [deal];
  /* Apps with a price set come first; an app without one is not billed by default. With no prices at all, every app is listed for a price to be typed. */
  const priced = (sub?.items || []).filter((it) => it.unitAmount != null && it.unitAmount > 0);
  return (priced.length ? priced : sub?.items || []).map((it) => {
    const quantity = it.seats && it.seats > 0 ? it.seats : 1;
    const unitAmount = it.unitAmount ?? 0;
    return { description: `CLOR ${appName(it.appCode)}${it.seats ? `, ${it.seats} ${it.seats === 1 ? 'user' : 'users'}` : ''}`, appCode: it.appCode, quantity, unitAmount, amount: quantity * unitAmount };
  });
}

export type DraftInput = { accountId?: string; lines?: unknown; buyer?: unknown; periodStart?: string | null; periodEnd?: string | null; note?: string | null; months?: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function cleanPeriod(input: DraftInput, problems: string[]) {
  const periodStart = input.periodStart && DATE.test(input.periodStart) ? input.periodStart : null;
  const periodEnd = input.periodEnd && DATE.test(input.periodEnd) ? input.periodEnd : null;
  if (periodStart && periodEnd && periodEnd < periodStart) problems.push('The period ends before it starts.');
  const months = input.months == null ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 36) problems.push('Choose how many months it pays for.');
  return { periodStart, periodEnd, months };
}

export async function createDraft(input: DraftInput, userId: string | null, origin: { source?: 'MANUAL' | 'RENEWAL'; renewalFor?: string | null } = {}) {
  const accountId = String(input.accountId || '');
  const known = await buyerFor(accountId);
  const { lines, problems } = cleanLines(input.lines);
  const { buyer, problems: bp } = input.buyer ? cleanBuyer(input.buyer, known.name) : { buyer: known, problems: [] };
  const period = cleanPeriod(input, problems);
  problems.push(...bp);
  if (problems.length) throw new PaymentsError('Check the invoice.', 400, problems);
  const t = await totalsFor(lines, buyer.stateCode);
  return outsideTenant('billing: new invoice draft', () =>
    platformPrisma.billingInvoice.create({
      data: {
        accountId,
        status: 'DRAFT',
        lines: lines as any,
        buyer: buyer as any,
        subtotal: t.subtotal,
        tax: t.tax as any,
        taxTotal: t.taxTotal,
        total: t.total,
        note: str(input.note, 600),
        ...period,
        createdByUserId: userId,
        source: origin.source ?? 'MANUAL',
        renewalFor: origin.renewalFor ?? null,
      },
    }),
  );
}

export async function updateDraft(id: string, input: DraftInput) {
  const inv = await getInvoice(id);
  if (inv.status !== 'DRAFT') throw new PaymentsError('Only a draft can be changed. An issued invoice is cancelled and raised again.', 409);
  const { lines, problems } = cleanLines(input.lines ?? inv.lines);
  const { buyer, problems: bp } = cleanBuyer(input.buyer ?? inv.buyer, (inv.buyer as any)?.name || '');
  const period = cleanPeriod({ periodStart: input.periodStart !== undefined ? input.periodStart : inv.periodStart, periodEnd: input.periodEnd !== undefined ? input.periodEnd : inv.periodEnd, months: input.months ?? inv.months }, problems);
  problems.push(...bp);
  if (problems.length) throw new PaymentsError('Check the invoice.', 400, problems);
  const t = await totalsFor(lines, buyer.stateCode);
  const r = await outsideTenant('billing: change an invoice draft', () =>
    platformPrisma.billingInvoice.updateMany({
      where: { id, status: 'DRAFT' },
      data: { lines: lines as any, buyer: buyer as any, subtotal: t.subtotal, tax: t.tax as any, taxTotal: t.taxTotal, total: t.total, note: input.note !== undefined ? str(input.note, 600) : inv.note, ...period },
    }),
  );
  if (!r.count) throw new PaymentsError('This invoice was issued a moment ago. Open it again.', 409);
  return getInvoice(id);
}

export async function deleteDraft(id: string) {
  const r = await outsideTenant('billing: discard an invoice draft', () => platformPrisma.billingInvoice.deleteMany({ where: { id, status: 'DRAFT' } }));
  if (!r.count) throw new PaymentsError('Only a draft can be discarded. Cancel an issued invoice instead.', 409);
}

/** How the customer pays: CLOR's manual payment details, with a QR carrying this invoice's amount and number. */
export async function payToFor(total: number, number: string) {
  const row = await outsideTenant('billing: how customers pay', () => platformPrisma.paymentProvider.findUnique({ where: { code: 'manual' } }));
  if (!row?.enabled) return null;
  const d = (row.config && typeof row.config === 'object' ? row.config : {}) as ManualDetails;
  if (manualProblems(d).length) return null;
  const rupees = (total / 100).toFixed(2);
  const upiLink = d.upiId ? `upi://pay?pa=${encodeURIComponent(d.upiId)}&pn=${encodeURIComponent(d.payeeName || 'CLOR')}&am=${rupees}&cu=INR&tn=${encodeURIComponent(number)}` : null;
  const qr = upiLink ? await QRCode.toDataURL(upiLink, { margin: 1, width: 240 }) : d.qrImage || null;
  return { upiId: d.upiId || null, payeeName: d.payeeName || null, upiLink, qr, bank: d.bank || null, instructions: d.instructions || null };
}

/** Issue a draft: the next number of this financial year's series, today's date, and everything on it frozen. */
export async function issueInvoice(id: string, userId: string | null) {
  const inv = await getInvoice(id);
  if (inv.status !== 'DRAFT') throw new PaymentsError('This invoice is already issued.', 409);
  if (inv.total <= 0) throw new PaymentsError('An invoice for ₹0 cannot be issued. Put a price on the lines.', 400);
  const buyer = inv.buyer as Buyer;
  const t = await totalsFor(inv.lines as Line[], buyer.stateCode);
  const gst = await taxSetting();
  const settings = await invoicing();
  const seller = { legalName: gst.legalName || 'Clor Applications Private Limited', gstin: gst.registered ? gst.gstin : null, stateCode: gst.sellerStateCode || null, sac: gst.sac || null, address: settings.address, footer: settings.footer };
  const now = new Date();
  const fy = financialYear(now);
  return outsideTenant('billing: issue an invoice', () =>
    platformPrisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({ where: { key: INVOICING_KEY }, create: { key: INVOICING_KEY, value: {} }, update: {} });
      await tx.$queryRaw`SELECT key FROM "PlatformSetting" WHERE key = ${INVOICING_KEY} FOR UPDATE`;
      const row = await tx.platformSetting.findUnique({ where: { key: INVOICING_KEY } });
      const cur = readInvoicing(row?.value);
      const n = (cur.counters[fy] || 0) + 1;
      const number = formatNumber(cur.prefix, fy, n);
      const payTo = await payToFor(t.total, number);
      const done = await tx.billingInvoice.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'ISSUED',
          number,
          issueDate: now,
          dueDate: new Date(now.getTime() + cur.dueDays * 86400000),
          subtotal: t.subtotal,
          tax: t.tax as any,
          taxTotal: t.taxTotal,
          total: t.total,
          seller: seller as any,
          payTo: (payTo as any) ?? undefined,
          issuedByUserId: userId,
        },
      });
      if (!done.count) throw new PaymentsError('This invoice was issued a moment ago.', 409);
      await tx.platformSetting.update({ where: { key: INVOICING_KEY }, data: { value: { ...cur, counters: { ...cur.counters, [fy]: n } } as any } });
      return tx.billingInvoice.findUniqueOrThrow({ where: { id } });
    }),
  );
}

/** Mark paid: the UTR of a UPI or bank payment. Recorded as a payment, and the subscription moves on by the invoice's months. */
export async function markInvoicePaid(id: string, input: { reference: string; paidOn: Date; amount?: number | null }, userId: string) {
  const inv = await getInvoice(id);
  if (inv.status === 'PAID') throw new PaymentsError('This invoice is already paid.', 409);
  if (inv.status !== 'ISSUED') throw new PaymentsError('Only an issued invoice can be marked paid.', 409);
  const amount = input.amount ?? inv.total;
  /* The claim on the invoice comes first, in one transaction with the payment and the subscription (events.ts). */
  const r = await outsideTenant('billing: mark an invoice paid', () =>
    recordInvoicePayment({ invoiceId: id, number: inv.number, accountId: inv.accountId, amount, reference: input.reference, paidOn: input.paidOn, months: inv.months, periodStart: inv.periodStart, userId }),
  );
  return { invoice: await getInvoice(id), paidUntil: r.paidUntil, detail: r.detail };
}

/** Cancel an issued, unpaid invoice. Its number stays used, marked cancelled, so the series has no gap. */
export async function voidInvoice(id: string, reason: string, userId: string) {
  const inv = await getInvoice(id);
  if (inv.status === 'DRAFT') throw new PaymentsError('A draft is discarded, not cancelled.', 409);
  if (inv.status === 'PAID') throw new PaymentsError('A paid invoice cannot be cancelled. Refund the customer and raise a credit note in Books.', 409);
  if (inv.status === 'VOID') throw new PaymentsError('This invoice is already cancelled.', 409);
  await outsideTenant('billing: cancel an invoice', () =>
    platformPrisma.billingInvoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason.slice(0, 300), voidedByUserId: userId } }),
  );
  return getInvoice(id);
}

export async function getInvoice(id: string) {
  const inv = await outsideTenant('billing: an invoice', () => platformPrisma.billingInvoice.findUnique({ where: { id } }));
  if (!inv) throw new PaymentsError('No such invoice.', 404);
  return inv;
}

export const isOverdue = (inv: { status: string; dueDate: Date | null }, now = new Date()) => inv.status === 'ISSUED' && Boolean(inv.dueDate && inv.dueDate < now);

const PAGE = 50;
export async function listInvoices(q: { status?: string; accountId?: string; before?: string }) {
  return outsideTenant('billing: invoices', async () => {
    const where: any = {};
    if (q.status === 'OVERDUE') Object.assign(where, { status: 'ISSUED', dueDate: { lt: new Date() } });
    else if (q.status && (INVOICE_STATUSES as readonly string[]).includes(q.status)) where.status = q.status;
    if (q.accountId) where.accountId = q.accountId;
    if (q.before && !Number.isNaN(Date.parse(q.before))) where.createdAt = { lt: new Date(q.before) };
    const rows = await platformPrisma.billingInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: PAGE + 1 });
    const names = await platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, name: true, code: true } });
    const nameOf = new Map(names.map((a) => [a.id, a]));
    const counts = await platformPrisma.billingInvoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true } });
    const overdue = await platformPrisma.billingInvoice.aggregate({ where: { status: 'ISSUED', dueDate: { lt: new Date() } }, _count: { _all: true }, _sum: { total: true } });
    return {
      invoices: rows.slice(0, PAGE).map((r) => ({ ...summary(r), account: nameOf.get(r.accountId) || null })),
      hasMore: rows.length > PAGE,
      totals: {
        ...Object.fromEntries(counts.map((c) => [c.status, { count: c._count._all, amount: c._sum.total || 0 }])),
        OVERDUE: { count: overdue._count._all, amount: overdue._sum.total || 0 },
      },
    };
  });
}

export const summary = (r: any) => ({
  id: r.id,
  number: r.number,
  accountId: r.accountId,
  status: r.status,
  overdue: isOverdue(r),
  issueDate: r.issueDate,
  dueDate: r.dueDate,
  total: r.total,
  paidAt: r.paidAt,
  booksStatus: r.booksStatus,
  buyerName: (r.buyer as any)?.name || null,
  createdAt: r.createdAt,
});

/* ------------------------------------------------- the customer's own view */

/** A customer sees its own issued, paid and cancelled invoices; never a draft. */
export async function invoicesForAccount(accountId: string) {
  const rows = await outsideTenant('billing: an account’s own invoices', () =>
    platformPrisma.billingInvoice.findMany({ where: { accountId, status: { in: ['ISSUED', 'PAID', 'VOID'] } }, orderBy: { issueDate: 'desc' }, take: 100 }),
  );
  return rows.map(summary);
}

export async function invoiceForAccount(accountId: string, id: string) {
  const inv = await outsideTenant('billing: an account’s own invoice', () => platformPrisma.billingInvoice.findFirst({ where: { id, accountId, status: { in: ['ISSUED', 'PAID', 'VOID'] } } }));
  if (!inv) throw new PaymentsError('No such invoice.', 404);
  return customerView(inv);
}

/** What the customer may read: no staff ids, no Books connector detail. A paid or cancelled invoice drops the way to pay. */
export function customerView(inv: any) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    overdue: isOverdue(inv),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    lines: inv.lines,
    subtotal: inv.subtotal,
    tax: inv.tax,
    taxTotal: inv.taxTotal,
    total: inv.total,
    buyer: inv.buyer,
    seller: inv.seller,
    note: inv.note,
    payTo: inv.status === 'ISSUED' ? inv.payTo : null,
    paidAt: inv.paidAt,
    paidAmount: inv.paidAmount,
    paymentReference: inv.paymentReference,
    voidedAt: inv.voidedAt,
  };
}

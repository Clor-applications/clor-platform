import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { taxSetting } from '../services/pricing/settings.js';
import { PaymentsError } from './providers.js';
import { buyerFor, createDraft, suggestedLines, totalsFor, type Line } from './invoices.js';
import { financialYear, invoicing } from './invoicing.js';

/**
 * Round 67 picks for selling to companies and CAs (billing only: records and
 * documents, never money moved):
 *
 *  - purchase orders: the customer keeps its PO numbers with the invoice
 *    periods each covers; issuing an invoice copies the matching one in;
 *  - TDS: a customer that deducted tax at source pays less than the total;
 *    staff record the TDS with the payment and the certificate is chased in
 *    the console until it arrives;
 *  - proformas: a quote with GST for the plan, valid 15 days, that staff turn
 *    into a tax invoice;
 *  - vendor documents: CLOR's own papers a customer's procurement asks for.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/* ----------------------------------------------------------- purchase orders */

export type PoInput = { number?: unknown; poDate?: unknown; fromDate?: unknown; toDate?: unknown };

export function cleanPo(input: PoInput): { po: { number: string; poDate: string | null; fromDate: string; toDate: string } | null; problems: string[] } {
  const problems: string[] = [];
  const number = str(input.number, 60);
  const poDate = typeof input.poDate === 'string' && DATE.test(input.poDate) ? input.poDate : null;
  const fromDate = typeof input.fromDate === 'string' && DATE.test(input.fromDate) ? input.fromDate : null;
  const toDate = typeof input.toDate === 'string' && DATE.test(input.toDate) ? input.toDate : null;
  if (!number) problems.push('Enter the purchase order number.');
  if (!fromDate || !toDate) problems.push('Enter the dates the purchase order covers.');
  if (fromDate && toDate && toDate < fromDate) problems.push('The purchase order ends before it starts.');
  return { po: problems.length ? null : { number: number!, poDate, fromDate: fromDate!, toDate: toDate! }, problems };
}

export async function listPurchaseOrders(accountId: string) {
  return outsideTenant('billing: an account’s purchase orders', () =>
    platformPrisma.billingPurchaseOrder.findMany({ where: { accountId }, orderBy: { fromDate: 'desc' }, take: 50, select: { id: true, number: true, poDate: true, fromDate: true, toDate: true, createdAt: true } }),
  );
}

export async function addPurchaseOrder(accountId: string, input: PoInput, userId: string | null) {
  const { po, problems } = cleanPo(input);
  if (!po) throw new PaymentsError('Check the purchase order.', 400, problems);
  return outsideTenant('billing: add a purchase order', () =>
    platformPrisma.billingPurchaseOrder.create({ data: { accountId, ...po, createdByUserId: userId }, select: { id: true, number: true, poDate: true, fromDate: true, toDate: true, createdAt: true } }),
  );
}

export async function removePurchaseOrder(accountId: string, id: string) {
  const r = await outsideTenant('billing: remove a purchase order', () => platformPrisma.billingPurchaseOrder.deleteMany({ where: { id, accountId } }));
  if (!r.count) throw new PaymentsError('No such purchase order.', 404);
}

/** The purchase order covering a day (the invoice's period start, or today): the newest one when they overlap. */
export async function purchaseOrderOn(accountId: string, day: string) {
  return outsideTenant('billing: the purchase order for an invoice', () =>
    platformPrisma.billingPurchaseOrder.findFirst({ where: { accountId, fromDate: { lte: day }, toDate: { gte: day } }, orderBy: { createdAt: 'desc' }, select: { number: true, poDate: true } }),
  );
}

/* ------------------------------------------------------------------- TDS */

/** Staff say the customer's TDS certificate (Form 16A) has come in: the console stops asking for it. */
export async function certificateReceived(id: string, on: Date) {
  const inv = await outsideTenant('billing: an invoice', () => platformPrisma.billingInvoice.findUnique({ where: { id }, select: { id: true, tdsDeducted: true, tdsCertificateAt: true } }));
  if (!inv) throw new PaymentsError('No such invoice.', 404);
  if (!inv.tdsDeducted) throw new PaymentsError('No TDS was recorded on this invoice.', 409);
  if (inv.tdsCertificateAt) throw new PaymentsError('The certificate is already marked received.', 409);
  return outsideTenant('billing: TDS certificate received', () => platformPrisma.billingInvoice.update({ where: { id }, data: { tdsCertificateAt: on } }));
}

/** Paid invoices whose TDS certificate has not come in, oldest first: what the console chases. */
export async function certificatesDue() {
  return outsideTenant('billing: TDS certificates still to come', async () => {
    const rows = await platformPrisma.billingInvoice.findMany({ where: { tdsDeducted: { gt: 0 }, tdsCertificateAt: null }, orderBy: { paidAt: 'asc' }, take: 50, select: { id: true, number: true, accountId: true, tdsDeducted: true, paidAt: true, buyer: true } });
    const names = await platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((a) => [a.id, a.name]));
    /* The buyer printed on the invoice is the company; the account name can be its owner's. */
    return rows.map(({ buyer, ...r }) => ({ ...r, accountName: ((buyer as { name?: string } | null)?.name || nameOf.get(r.accountId)) ?? null }));
  });
}

/* ------------------------------------------------------------- proformas */

export const PROFORMA_DAYS = 15;
const PROFORMA_KEY = 'billing.proforma';

/** The next number of this financial year's proforma series, PF/26-27/0001, taken under a lock so two never share one. */
async function nextProformaNumber(tx: any, fy: string) {
  await tx.platformSetting.upsert({ where: { key: PROFORMA_KEY }, create: { key: PROFORMA_KEY, value: {} }, update: {} });
  await tx.$queryRaw`SELECT key FROM "PlatformSetting" WHERE key = ${PROFORMA_KEY} FOR UPDATE`;
  const row = await tx.platformSetting.findUnique({ where: { key: PROFORMA_KEY } });
  const counters = ((row?.value as any)?.counters || {}) as Record<string, number>;
  const n = (counters[fy] || 0) + 1;
  await tx.platformSetting.update({ where: { key: PROFORMA_KEY }, data: { value: { counters: { ...counters, [fy]: n } } } });
  return `PF/${fy}/${String(n).padStart(4, '0')}`;
}

const proformaView = (p: any) => ({
  id: p.id,
  number: p.number,
  createdAt: p.createdAt,
  validUntil: p.validUntil,
  expired: p.validUntil < new Date() && !p.invoiceId,
  lines: p.lines,
  subtotal: p.subtotal,
  tax: p.tax,
  taxTotal: p.taxTotal,
  total: p.total,
  buyer: p.buyer,
  seller: p.seller,
  invoiced: Boolean(p.invoiceId),
});

/** "Get a proforma": the plan's lines at today's price, with GST, valid 15 days. */
export async function makeProforma(accountId: string, userId: string | null) {
  const lines: Line[] = (await suggestedLines(accountId)).filter((l) => l.amount > 0);
  if (!lines.length) throw new PaymentsError('Your plan has no price set yet, so a proforma cannot be made. Ask CLOR support for a quote.', 409);
  const buyer = await buyerFor(accountId);
  const t = await totalsFor(lines, buyer.stateCode);
  const gst = await taxSetting();
  const settings = await invoicing();
  const seller = { legalName: gst.legalName || 'CLOR Applications Private Limited', gstin: gst.registered ? gst.gstin : null, stateCode: gst.sellerStateCode || null, sac: gst.sac || null, address: settings.address };
  const now = new Date();
  const fy = financialYear(now);
  const row = await outsideTenant('billing: make a proforma', () =>
    platformPrisma.$transaction(async (tx) =>
      tx.billingProforma.create({
        data: {
          number: await nextProformaNumber(tx, fy),
          accountId,
          lines: lines as any,
          subtotal: t.subtotal,
          tax: t.tax as any,
          taxTotal: t.taxTotal,
          total: t.total,
          buyer: buyer as any,
          seller: seller as any,
          validUntil: new Date(now.getTime() + PROFORMA_DAYS * 86400000),
          createdByUserId: userId,
        },
      }),
    ),
  );
  return proformaView(row);
}

export async function proformasForAccount(accountId: string) {
  const rows = await outsideTenant('billing: an account’s proformas', () => platformPrisma.billingProforma.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 20 }));
  return rows.map(proformaView);
}

export async function proformaForAccount(accountId: string, id: string) {
  const row = await outsideTenant('billing: an account’s proforma', () => platformPrisma.billingProforma.findFirst({ where: { id, accountId } }));
  if (!row) throw new PaymentsError('No such proforma.', 404);
  return proformaView(row);
}

/** The console's list: the newest proformas across customers, with whether each became an invoice. */
export async function recentProformas() {
  return outsideTenant('billing: recent proformas', async () => {
    const rows = await platformPrisma.billingProforma.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const names = await platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((a) => [a.id, a.name]));
    return rows.map((r) => ({ ...proformaView(r), accountId: r.accountId, accountName: nameOf.get(r.accountId) || null, invoiceId: r.invoiceId }));
  });
}

/** Staff turn a proforma into a tax invoice draft with the same lines; the draft is issued the usual way. */
export async function proformaToInvoice(id: string, userId: string) {
  const p = await outsideTenant('billing: a proforma', () => platformPrisma.billingProforma.findUnique({ where: { id } }));
  if (!p) throw new PaymentsError('No such proforma.', 404);
  if (p.invoiceId) throw new PaymentsError('This proforma is already an invoice.', 409);
  const draft = await createDraft({ accountId: p.accountId, lines: p.lines, note: `Against proforma ${p.number}.` }, userId);
  const claimed = await outsideTenant('billing: proforma to invoice', () => platformPrisma.billingProforma.updateMany({ where: { id, invoiceId: null }, data: { invoiceId: draft.id } }));
  if (!claimed.count) {
    await outsideTenant('billing: undo a doubled draft', () => platformPrisma.billingInvoice.delete({ where: { id: draft.id } }));
    throw new PaymentsError('This proforma became an invoice a moment ago.', 409);
  }
  return draft;
}

/* ------------------------------------------------------- vendor documents */

export const VENDOR_KINDS: Record<string, string> = {
  GST: 'GST registration certificate',
  PAN: 'PAN card',
  INCORPORATION: 'Certificate of incorporation',
  MSME: 'Udyam (MSME) certificate',
  CHEQUE: 'Cancelled cheque',
  OTHER: 'Other document',
};
export const VENDOR_MAX_BYTES = 2 * 1024 * 1024;
const VENDOR_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const vendorView = (d: any) => ({ id: d.id, kind: d.kind, kindName: VENDOR_KINDS[d.kind] || d.kind, title: d.title, fileName: d.fileName, contentType: d.contentType, size: d.size, validUntil: d.validUntil, updatedAt: d.updatedAt });

export async function listVendorDocuments() {
  const rows = await outsideTenant('billing: CLOR’s vendor documents', () =>
    platformPrisma.vendorDocument.findMany({ orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }], select: { id: true, kind: true, title: true, fileName: true, contentType: true, size: true, validUntil: true, updatedAt: true } }),
  );
  return rows.map(vendorView);
}

/** A file from the console: a PDF or picture as a data URL, at most 2 MB. Its magic bytes must match what it says it is. */
export function readUpload(input: { dataUrl?: unknown; fileName?: unknown }) {
  const m = typeof input.dataUrl === 'string' ? /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl) : null;
  if (!m) throw new PaymentsError('Choose a PDF, PNG or JPEG file.', 400);
  const contentType = m[1];
  if (!VENDOR_TYPES.includes(contentType)) throw new PaymentsError('Choose a PDF, PNG or JPEG file.', 400);
  const content = Buffer.from(m[2], 'base64');
  if (!content.length) throw new PaymentsError('The file is empty.', 400);
  if (content.length > VENDOR_MAX_BYTES) throw new PaymentsError('The file is larger than 2 MB.', 400);
  const head = content.subarray(0, 4).toString('latin1');
  const looks = contentType === 'application/pdf' ? head === '%PDF' : contentType === 'image/png' ? head === '\x89PNG' : content[0] === 0xff && content[1] === 0xd8;
  if (!looks) throw new PaymentsError('The file is not what its name says. Choose the PDF or picture again.', 400);
  const fileName = (str(input.fileName, 120) || 'document').replace(/[^\w .()-]/g, '_');
  return { contentType, content, fileName };
}

export async function saveVendorDocument(input: { kind?: unknown; title?: unknown; validUntil?: unknown; dataUrl?: unknown; fileName?: unknown }, userId: string) {
  const kind = typeof input.kind === 'string' && VENDOR_KINDS[input.kind] ? input.kind : null;
  if (!kind) throw new PaymentsError('Choose what the document is.', 400);
  const file = readUpload(input);
  const validUntil = typeof input.validUntil === 'string' && DATE.test(input.validUntil) ? input.validUntil : null;
  const title = str(input.title, 120) || VENDOR_KINDS[kind];
  const row = await outsideTenant('billing: save a vendor document', () =>
    platformPrisma.vendorDocument.create({ data: { kind, title, fileName: file.fileName, contentType: file.contentType, size: file.content.length, content: file.content, validUntil, updatedByUserId: userId } }),
  );
  return vendorView(row);
}

export async function removeVendorDocument(id: string) {
  const r = await outsideTenant('billing: remove a vendor document', () => platformPrisma.vendorDocument.deleteMany({ where: { id } }));
  if (!r.count) throw new PaymentsError('No such document.', 404);
}

export async function vendorDocumentFile(id: string) {
  const row = await outsideTenant('billing: a vendor document', () => platformPrisma.vendorDocument.findUnique({ where: { id } }));
  if (!row) throw new PaymentsError('No such document.', 404);
  return row;
}

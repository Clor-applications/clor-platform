import { Router, type Request, type Response } from 'express';
import { anyAppLive, appLive, closing } from '../services/principalAllowed.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { hashToken } from './publicApi.js';
import { notifyPermission } from '../services/notifications.js';
import { enterTenant, outsideTenant, runInTenant } from '../utils/tenantScope.js';

/**
 * UPI Direct: the company's customers pay straight into the company's own
 * UPI ID. No gateway and no fee — UPI person-to-merchant payments carry no
 * MDR at the bank — at the price of a person confirming the money arrived.
 *
 *   staff:  POST /orgs/:orgId/pay-requests            a link for an invoice
 *           GET  /orgs/:orgId/pay-requests?docId=      its requests
 *           POST /orgs/:orgId/pay-requests/:id/confirm  linked to the receipt recorded for it
 *           POST /orgs/:orgId/pay-requests/:id/cancel
 *   public: GET  /pay/:token                           the pay page (QR + "open UPI app")
 *           POST /pay/:token/claim                     "I have paid", with the UTR
 *
 * The token in the link is the only credential and is kept as a hash. The
 * reference (CLR-XXXXXX) rides in the UPI note so it shows on the bank
 * statement next to the payer's UTR.
 */
export const payRequestsRouter = Router();
export const payPageRouter = Router();

const RECEIPTS = 'Receipts';
const can = (action: string) => requirePermission('SALES', action as any, RECEIPTS);
const base = '/orgs/:orgId/pay-requests';
const VPA = /^[a-zA-Z0-9._-]{1,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
/** A UPI UTR / RRN: 12 digits. Some apps show a longer transaction id; those are accepted up to 35 characters. */
const UTR = /^[A-Za-z0-9]{12,35}$/;
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const newPayToken = () => `clorpay_${randomBytes(24).toString('base64url')}`;
export const newReference = () => `CLR-${Array.from(randomBytes(6), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
const publicBase = () => (process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || 'https://api.clor.in').replace(/\/$/, '');
export const payUrl = (token: string) => `${publicBase()}/pay/${token}`;
const rupees = (paise: number) => (paise / 100).toFixed(2);

/** The UPI intent: pa payee, pn name, am amount, cu INR, tn note with the reference, tr the reference. */
export function upiIntent(r: { payeeVpa: string; payeeName: string; amountPaise: number; reference: string; docNumber: string | null }) {
  const note = r.docNumber ? `${r.reference} Invoice ${r.docNumber}` : r.reference;
  const params = new URLSearchParams({ pa: r.payeeVpa, pn: r.payeeName.slice(0, 50), am: rupees(r.amountPaise), cu: 'INR', tn: note.slice(0, 80), tr: r.reference });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

const shape = (r: any) => ({
  id: r.id,
  purpose: r.purpose,
  docId: r.docId,
  docNumber: r.docNumber,
  partyName: r.partyName,
  amount: Number(rupees(r.amountPaise)),
  payeeVpa: r.payeeVpa,
  payeeName: r.payeeName,
  reference: r.reference,
  tokenPrefix: r.tokenPrefix,
  status: r.status,
  payerUtr: r.payerUtr,
  payerName: r.payerName,
  claimedAt: r.claimedAt,
  paidAt: r.paidAt,
  paymentId: r.paymentId,
  expiresAt: r.expiresAt,
  createdAt: r.createdAt,
});

payRequestsRouter.use(requireAuth, requireTenantContext);
const orgOk = (req: Request, res: Response) => {
  if (String(req.params.orgId) !== String(req.tenant?.orgId)) {
    res.status(403).json({ error: 'Organisation mismatch' });
    return false;
  }
  return true;
};

const createSchema = z.object({
  purpose: z.literal('INVOICE').default('INVOICE'),
  docId: z.string().min(1),
  /** Defaults to what is still owed on the invoice. */
  amount: z.number().positive().max(10_000_000).optional(),
  payeeVpa: z.string().trim().regex(VPA, 'That is not a UPI ID (name@bank).'),
  payeeName: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(180).default(30),
});

payRequestsRouter.post(base, can(PermissionAction.CREATE), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  const p = createSchema.safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the details.' });
  const b = p.data;
  const invoice = await prisma.invoice.findFirst({ where: { id: b.docId, orgId }, select: { id: true, number: true, customerName: true, total: true, paidAmount: true, status: true } });
  if (!invoice) return res.status(404).json({ error: 'No such invoice.' });
  if (String(invoice.status) === 'Draft') return res.status(400).json({ error: 'Finalise the invoice first: a draft’s total can still change.' });
  const due = Math.round((Number(invoice.total) - Number(invoice.paidAmount || 0)) * 100);
  const amountPaise = b.amount ? Math.round(b.amount * 100) : due;
  if (amountPaise <= 0) return res.status(400).json({ error: 'Nothing is owed on this invoice.' });
  if (amountPaise > due + 1) return res.status(400).json({ error: `That is more than the ${rupees(due)} still owed.` });
  /* One open link per invoice: a new one replaces the old so a customer never pays twice from two links. */
  await prisma.paymentRequest.updateMany({ where: { orgId, docId: invoice.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  const token = newPayToken();
  const row = await prisma.paymentRequest.create({
    data: {
      accountId,
      orgId,
      purpose: 'INVOICE',
      docId: invoice.id,
      docNumber: invoice.number,
      partyName: invoice.customerName,
      amountPaise,
      payeeVpa: b.payeeVpa,
      payeeName: b.payeeName,
      reference: newReference(),
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 14),
      expiresAt: new Date(Date.now() + b.expiresInDays * 86_400_000),
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json({ request: shape(row), url: payUrl(token), upi: upiIntent(row) });
});

payRequestsRouter.get(base, can(PermissionAction.VIEW), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const where: any = { orgId };
  if (req.query.docId) where.docId = String(req.query.docId);
  if (req.query.status) where.status = String(req.query.status).toUpperCase();
  const rows = await prisma.paymentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ requests: rows.map(shape) });
});

/**
 * The money is in the bank: link the receipt that was recorded for it. The
 * receipt itself goes through the ordinary receipts route (ledger, numbering,
 * allocation, permissions); this only checks it really is that money.
 */
payRequestsRouter.post(`${base}/:id/confirm`, can(PermissionAction.CREATE), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const r = await prisma.paymentRequest.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!r) return res.status(404).json({ error: 'No such payment request.' });
  if (r.status === 'PAID') return res.json({ request: shape(r), replayed: true });
  if (r.status === 'CANCELLED') return res.status(409).json({ error: 'This request was cancelled.' });
  const paymentId = String(req.body?.paymentId || '');
  const payment = paymentId ? await prisma.payment.findFirst({ where: { id: paymentId, orgId }, include: { allocations: true } as any }) : null;
  if (!payment) return res.status(400).json({ error: 'Record the receipt first, then confirm it here.' });
  const p: any = payment;
  if (p.direction !== 'RECEIPT' || p.status !== 'POSTED') return res.status(400).json({ error: 'That is not a posted receipt.' });
  if (Math.round(Number(p.amount) * 100) !== r.amountPaise) return res.status(400).json({ error: `The receipt is for ${Number(p.amount).toFixed(2)}; the request was ${rupees(r.amountPaise)}.` });
  if (r.docId && Array.isArray(p.allocations) && !p.allocations.some((a: any) => a.docId === r.docId)) return res.status(400).json({ error: 'The receipt is not allocated to this invoice.' });
  if (await prisma.paymentRequest.findFirst({ where: { orgId, paymentId: p.id, NOT: { id: r.id } }, select: { id: true } })) return res.status(409).json({ error: 'That receipt already confirms another request.' });
  const done = await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: 'PAID', paidAt: new Date(), paymentId: p.id, confirmedByUserId: req.auth!.userId } });
  res.json({ request: shape(done) });
});

payRequestsRouter.post(`${base}/:id/cancel`, can(PermissionAction.EDIT), async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const r = await prisma.paymentRequest.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!r) return res.status(404).json({ error: 'No such payment request.' });
  if (r.status === 'PAID') return res.status(409).json({ error: 'It is paid; reverse the receipt instead.' });
  const done = await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
  res.json({ request: shape(done) });
});

/* ------------------------------------------------------------------ public */

async function requestOf(token: string) {
  if (!/^clorpay_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  /* A-35: the token is how the company is found, so it is looked up across companies. */
  const r = await outsideTenant('pay link: which company this link belongs to', () => prisma.paymentRequest.findUnique({ where: { tokenHash: hashToken(token) } }));
  if (!r) return null;
  /* A-11: payment links are Accounting's; none is served for a company without it, or closing. */
  if (await appLive(r.accountId, r.orgId, 'accounting')) return null;
  if (r.status === 'PENDING' && r.expiresAt && r.expiresAt < new Date()) return runInTenant(r.orgId, () => prisma.paymentRequest.update({ where: { id: r.id }, data: { status: 'EXPIRED' } }));
  return r;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.5 -apple-system,"Segoe UI",Inter,Roboto,sans-serif;background:#fafaf9;color:#1c1917}.card{max-width:420px;margin:24px auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:20px 18px}
h1{font-size:20px;margin:0 0 4px}.muted{color:#78716c;font-size:14px}.amt{font-size:32px;font-weight:700;margin:12px 0 4px}.qr{display:block;margin:16px auto;width:220px;height:220px}
.btn{display:block;text-align:center;background:#c2410c;color:#fff;text-decoration:none;border:0;border-radius:8px;padding:12px;font-size:16px;font-weight:600;width:100%;cursor:pointer}.btn2{background:#fff;color:#1c1917;border:1px solid #d6d3d1}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d6d3d1;border-radius:8px;font-size:16px;margin:6px 0 10px}code{background:#f5f5f4;padding:1px 5px;border-radius:4px}.ok{color:#15803d;font-weight:600}.foot{text-align:center;font-size:12px;color:#a8a29e;margin:12px 0 24px}
@media (prefers-color-scheme:dark){body{background:#0c0a09;color:#fafaf9}.card{background:#1c1917;border-color:#292524}input,.btn2{background:#0c0a09;color:#fafaf9;border-color:#44403c}code{background:#292524}}</style></head>
<body><div class="card">${body}</div><div class="foot">Paid directly to the business's UPI ID · no fee · via CLOR</div></body></html>`;
}

payPageRouter.get('/:token', ...ingestLimiter, async (req, res) => {
  const r = await requestOf(String(req.params.token));
  if (r) enterTenant(r.orgId); /* A-30: the rest of this request runs as the link's company. */
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!r) return res.status(404).type('html').send(page('Link not found', '<h1>This payment link is not valid</h1><p class="muted">Ask the business for a new one.</p>'));
  const org = await platformPrisma.org.findUnique({ where: { id: r.orgId }, select: { name: true } });
  const head = `<div class="muted">${esc(org?.name || r.payeeName)}</div><h1>${r.docNumber ? `Invoice ${esc(r.docNumber)}` : 'Payment'}</h1>${r.partyName ? `<div class="muted">For ${esc(r.partyName)}</div>` : ''}<div class="amt">₹${esc(Number(rupees(r.amountPaise)).toLocaleString('en-IN', { minimumFractionDigits: 2 }))}</div>`;
  if (r.status === 'PAID') return res.type('html').send(page('Paid', `${head}<p class="ok">Paid — thank you.</p>`));
  if (r.status === 'CLAIMED') return res.type('html').send(page('Payment received', `${head}<p class="ok">Thank you. We have your UTR <code>${esc(r.payerUtr)}</code>; the business will confirm it shortly.</p>`));
  if (r.status !== 'PENDING') return res.type('html').send(page('Link closed', `${head}<p class="muted">This link is ${r.status === 'EXPIRED' ? 'past its date' : 'no longer in use'}. Ask the business for a new one.</p>`));
  const intent = upiIntent(r);
  const qr = await QRCode.toDataURL(intent, { margin: 1, width: 440 });
  const claimed = req.query.err ? `<p style="color:#b91c1c">${esc(String(req.query.err)).slice(0, 200)}</p>` : '';
  res.type('html').send(
    page(
      `Pay ${org?.name || r.payeeName}`,
      `${head}<div class="muted">To <code>${esc(r.payeeVpa)}</code> · reference <code>${esc(r.reference)}</code></div>
<img class="qr" src="${qr}" alt="UPI QR code for this payment">
<a class="btn" href="${esc(intent)}">Pay with a UPI app</a>
<p class="muted" style="margin-top:14px">On a computer, scan the code with any UPI app (GPay, PhonePe, Paytm, BHIM, your bank's app). The amount and reference fill in by themselves.</p>
<hr style="border:0;border-top:1px solid #e7e5e4;margin:18px 0">
<form method="post" action="/pay/${esc(req.params.token)}/claim">
<label for="utr"><strong>Paid?</strong> Enter the UTR / reference number your app shows (12 digits).</label>
<input id="utr" name="utr" inputmode="numeric" autocomplete="off" required pattern="[A-Za-z0-9]{12,35}" placeholder="e.g. 428917365012">
<label for="nm">Your name (optional)</label><input id="nm" name="payerName" maxlength="100">
${claimed}<button class="btn btn2" type="submit">I have paid</button></form>`,
    ),
  );
});

payPageRouter.post('/:token/claim', ...ingestLimiter, async (req, res) => {
  const token = String(req.params.token);
  const r = await requestOf(token);
  if (r) enterTenant(r.orgId); /* A-30: the rest of this request runs as the link's company. */
  const back = (err: string) => res.redirect(303, `/pay/${encodeURIComponent(token)}?err=${encodeURIComponent(err)}`);
  if (!r) return res.status(404).type('html').send(page('Link not found', '<h1>This payment link is not valid</h1>'));
  if (r.status !== 'PENDING') return res.redirect(303, `/pay/${encodeURIComponent(token)}`);
  const utr = String(req.body?.utr || '').replace(/\s+/g, '').trim();
  if (!UTR.test(utr)) return back('That does not look like a UTR: 12 digits, as your UPI app shows under the payment.');
  if (await prisma.paymentRequest.findFirst({ where: { orgId: r.orgId, payerUtr: utr, NOT: { id: r.id } }, select: { id: true } })) return back('That UTR was already given for another payment.');
  const payerName = String(req.body?.payerName || '').trim().slice(0, 100) || null;
  const done = await prisma.paymentRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'CLAIMED', payerUtr: utr, payerName, claimedAt: new Date() } });
  if (done.count) {
    await notifyPermission(r.accountId, r.orgId, 'SALES::Receipts::CREATE', {
      kind: 'payment.claimed',
      title: `${payerName || r.partyName || 'A customer'} says they paid ₹${rupees(r.amountPaise)}${r.docNumber ? ` for invoice ${r.docNumber}` : ''}`,
      body: `UPI · UTR ${utr} · reference ${r.reference}. Check the bank, then record the receipt and confirm.`,
      link: { app: 'accounting', screen: 'invoices', params: { id: r.docId || '' } },
    });
  }
  res.redirect(303, `/pay/${encodeURIComponent(token)}`);
});

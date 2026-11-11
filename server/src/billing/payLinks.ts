import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { applyGatewayEvent } from './events.js';
import { PayLinkError, type NormalizedEvent, type PaymentGateway } from './gateway.js';
import { activeGateway, gatewayNamed, PaymentsError } from './providers.js';
import { buyerFor } from './invoices.js';

/**
 * Paying one of CLOR's invoices online: card, UPI or netbanking on the active
 * gateway's own page (Razorpay or Cashfree payment links). The customer
 * presses Pay online on the invoice in Workspace, Billing; CLOR makes a link
 * for exactly the invoice's total, or reuses the one it made before while the
 * amount and gateway are the same and it has not run out, and sends them to
 * it. CLOR never sees the card.
 *
 * The invoice is marked paid by the provider's signed webhook (events.ts
 * payInvoice), or, when the customer comes back to Workspace, by asking the
 * provider whether the link was paid. Both use the same event id, so the
 * payment is applied once.
 */

/** A link lasts this long; an older one is made again. Razorpay allows up to six months. */
const LINK_DAYS = 14;

/** Whether customers can pay online now: the active gateway makes payment links. */
export async function onlinePayment(): Promise<{ available: boolean; gateway: string | null }> {
  const g = await activeGateway();
  return g.external && typeof g.createPaymentLink === 'function' ? { available: true, gateway: g.name } : { available: false, gateway: null };
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
/**
 * Where the provider sends the customer back: the Workspace page they came
 * from, if it is CLOR's own (clor.in, the app address, or this machine in
 * development); otherwise the app's address.
 */
export function returnUrlFor(asked: unknown): string {
  const app = (process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '');
  const u = typeof asked === 'string' ? asked.trim().slice(0, 500) : '';
  if (!u) return `${app}/`;
  try {
    const url = new URL(u);
    const ours = url.protocol === 'https:' && (url.hostname === 'clor.in' || url.hostname.endsWith('.clor.in'));
    const sameApp = url.origin === new URL(app).origin;
    const dev = process.env.NODE_ENV !== 'production' && LOCAL.test(u);
    if (ours || sameApp || dev) return url.toString();
  } catch {
    /* not a URL */
  }
  return `${app}/`;
}

async function ownInvoice(accountId: string, id: string) {
  const inv = await outsideTenant('billing: an invoice to pay', () => platformPrisma.billingInvoice.findFirst({ where: { id, accountId } }));
  if (!inv || inv.status === 'DRAFT') throw new PaymentsError('No such invoice.', 404);
  return inv;
}

async function payerFor(accountId: string, userId: string | null) {
  const buyer = await buyerFor(accountId);
  const me = userId ? await platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } }) : null;
  return { name: buyer.name, email: me?.email || buyer.email, phone: me?.phone || null };
}

/** The page to pay this invoice on. */
export async function payLinkFor(accountId: string, invoiceId: string, opts: { returnTo?: unknown; userId?: string | null } = {}) {
  const inv = await ownInvoice(accountId, invoiceId);
  if (inv.status === 'PAID') throw new PaymentsError('This invoice is already paid.', 409);
  if (inv.status !== 'ISSUED') throw new PaymentsError('This invoice is cancelled. Nothing is due on it.', 409);
  const g = await activeGateway();
  if (!g.external || !g.createPaymentLink) throw new PaymentsError('Online payment is not open yet. Pay by UPI or bank transfer, as the invoice shows.', 409);
  const fresh = inv.payLinkAt && Date.now() - inv.payLinkAt.getTime() < (LINK_DAYS - 1) * 86_400_000;
  if (inv.payLinkUrl && inv.payLinkGateway === g.name && inv.payLinkAmount === inv.total && fresh) return { url: inv.payLinkUrl, gateway: g.name, reused: true };
  const customer = await payerFor(accountId, opts.userId ?? null);
  let link;
  try {
    link = await g.createPaymentLink({
      invoiceId: inv.id,
      accountId,
      number: inv.number!,
      amount: inv.total,
      description: `CLOR invoice ${inv.number}`,
      customer,
      returnUrl: returnUrlFor(opts.returnTo),
      expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
    });
  } catch (e) {
    if (e instanceof PayLinkError) throw new PaymentsError(e.message, 502);
    throw e;
  }
  await outsideTenant('billing: keep the payment link', () =>
    platformPrisma.billingInvoice.updateMany({ where: { id: inv.id, status: 'ISSUED' }, data: { payLinkGateway: g.name, payLinkId: link.id, payLinkUrl: link.url, payLinkAmount: inv.total, payLinkAt: new Date() } }),
  );
  return { url: link.url, gateway: g.name, reused: false };
}

/** The event a paid link makes, with the id its webhook uses (razorpay.ts, cashfree.ts), so the two are kept once. */
export function linkPaidEvent(gateway: string, inv: { id: string; accountId: string; payLinkId: string | null }, s: { amountPaid: number | null; paymentId: string | null }): NormalizedEvent {
  const linkId = inv.payLinkId!;
  const razorpay = gateway === 'razorpay';
  return {
    gateway,
    eventId: razorpay ? `payment_link.paid:${linkId}` : `PAYMENT_LINK_EVENT:${linkId}:PAID`,
    type: razorpay ? 'payment_link.paid' : 'PAYMENT_LINK_EVENT',
    accountId: inv.accountId,
    amount: s.amountPaid,
    reference: s.paymentId,
    invoice: { invoiceId: inv.id, linkId, amountPaid: s.amountPaid },
    raw: { checkedOnReturn: true, linkId },
  };
}

/**
 * The customer is back from the payment page: ask the provider whether the
 * link was paid, and if it was, apply it now rather than wait for the webhook.
 */
export async function checkPayLink(accountId: string, invoiceId: string): Promise<{ status: string; paid: boolean }> {
  const inv = await ownInvoice(accountId, invoiceId);
  if (inv.status === 'PAID') return { status: inv.status, paid: true };
  if (inv.status !== 'ISSUED' || !inv.payLinkId || !inv.payLinkGateway) return { status: inv.status, paid: false };
  const g: PaymentGateway = await gatewayNamed(inv.payLinkGateway);
  if (!g.paymentLinkStatus) return { status: inv.status, paid: false };
  let s;
  try {
    s = await g.paymentLinkStatus(inv.payLinkId);
  } catch (e) {
    if (e instanceof PayLinkError) throw new PaymentsError(e.message, 502);
    throw e;
  }
  if (!s.paid) return { status: inv.status, paid: false };
  await applyGatewayEvent(linkPaidEvent(g.name, inv, s));
  const after = await outsideTenant('billing: the invoice after paying', () => platformPrisma.billingInvoice.findUnique({ where: { id: inv.id }, select: { status: true } }));
  return { status: after?.status || inv.status, paid: after?.status === 'PAID' };
}

/**
 * The payment-gateway seam.
 *
 * The rest of the system talks to this PORT, never to a provider. Each
 * provider is one adapter: ManualGateway here (UPI and bank transfer, marked
 * paid by CLOR staff), CashfreeGateway (billing/cashfree.ts) and
 * RazorpayGateway (billing/razorpay.ts). Which one is active, and its keys,
 * are set in the operator console, Payments (billing/providers.ts), never in
 * code or env; env is only a silent fallback for a developer's machine.
 *
 * ManualGateway runs the whole business model with no provider at all: free
 * plans, manually granted subscriptions, and offline/invoice billing. A tenant
 * can be created, trialed, entitled and lapsed without a single external call.
 */
export type GatewayCustomer = { customerId: string };
export type GatewaySubscription = {
  subscriptionId: string;
  status: string; // trialing | active | past_due | cancelled
  currentPeriodEnd?: Date | null;
};
export type NormalizedEvent = {
  gateway: string;
  eventId: string;
  type: string;
  accountId?: string | null;
  /** Fields the service applies to the local subscription, provider-neutral. */
  subscription?: Partial<GatewaySubscription> & { gatewaySubscriptionId?: string };
  /** Amount in paise, when the event carries one. */
  amount?: number | null;
  /** The provider's payment id, or a UTR. */
  reference?: string | null;
  /** A payment link for one of CLOR's invoices was paid (billing/payLinks.ts). */
  invoice?: { invoiceId: string | null; linkId: string; amountPaid: number | null };
  /** When the provider says the event happened, if it says. Puts a late event behind a newer one (billing/events.ts). */
  occurredAt?: Date;
  raw: unknown;
};

/** What a payment link is made from: one CLOR invoice, its amount in paise, and who pays. */
export type PayLinkInput = {
  invoiceId: string;
  accountId: string;
  number: string;
  amount: number;
  description: string;
  customer: { name: string; email: string | null; phone: string | null };
  returnUrl: string;
  expiresAt: Date;
};
export type PayLink = { id: string; url: string };
/** A payment link as the provider sees it now. */
export type PayLinkStatus = { paid: boolean; amountPaid: number | null; paymentId: string | null };
/** A provider refused to make a link, in a sentence the customer can act on. */
export class PayLinkError extends Error {}
/** A webhook checked: the event, or the plain reason it was refused. */
export type WebhookCheck = { ok: true; event: NormalizedEvent } | { ok: false; reason: string };
/** "Test connection", in a sentence CLOR staff can act on. */
export type ConnectionResult = { ok: boolean; message: string };

export interface PaymentGateway {
  readonly name: string;
  /** Whether this gateway actually talks to a provider (false for manual). */
  readonly external: boolean;
  createCustomer(input: { accountId: string; email?: string; name?: string }): Promise<GatewayCustomer>;
  createSubscription(input: {
    accountId: string;
    customerId: string;
    items: { appCode: string; tier?: string | null; seats?: number | null }[];
    trialDays?: number | null;
    interval?: string | null;
  }): Promise<GatewaySubscription>;
  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  /** Verify + normalize a webhook. Returns null when invalid. */
  verifyWebhook(rawBody: string | Buffer, headers: Record<string, unknown>): NormalizedEvent | null;
  /** The same, saying why a webhook was refused (for the Payments log). */
  checkWebhook?(rawBody: string | Buffer, headers: Record<string, unknown>): WebhookCheck;
  /** Ask the provider whether the saved keys work. Never charges anything. */
  testConnection?(): Promise<ConnectionResult>;
  /** A hosted page where the customer pays one invoice by card, UPI or netbanking. */
  createPaymentLink?(input: PayLinkInput): Promise<PayLink>;
  /** Ask the provider whether a payment link has been paid. */
  paymentLinkStatus?(linkId: string): Promise<PayLinkStatus>;
  /** Stop a link being paid, before CLOR makes another for the same invoice. */
  cancelPaymentLink?(linkId: string): Promise<void>;
}

/** What customers paying by hand are shown: CLOR's UPI ID, a QR, and the bank account. */
export type ManualDetails = {
  upiId?: string | null;
  payeeName?: string | null;
  /** An uploaded QR image (data: URL). Without one, a QR is drawn from the UPI ID. */
  qrImage?: string | null;
  bank?: { accountName?: string | null; accountNumber?: string | null; ifsc?: string | null; bankName?: string | null; branch?: string | null } | null;
  instructions?: string | null;
};

const last4 = (s: string) => s.slice(-4);

/** Whether the manual details are enough for a customer to pay: a UPI ID, or a whole bank account. */
export function manualProblems(d: ManualDetails): string[] {
  const out: string[] = [];
  const b = d.bank || {};
  const anyBank = Boolean(b.accountName || b.accountNumber || b.ifsc || b.bankName);
  if (!d.upiId && !anyBank) out.push('Add CLOR’s UPI ID, or the bank account customers pay into.');
  if (anyBank) {
    if (!b.accountName) out.push('Add the name on the bank account.');
    if (!b.accountNumber) out.push('Add the bank account number.');
    if (!b.ifsc) out.push('Add the IFSC code of the branch.');
  }
  return out;
}

/** The no-provider gateway: UPI and bank transfer, marked paid in the operator console. No webhooks. */
export class ManualGateway implements PaymentGateway {
  readonly name = 'manual';
  readonly external = false;
  constructor(readonly details: ManualDetails = {}) {}
  async createCustomer(input: { accountId: string }): Promise<GatewayCustomer> {
    return { customerId: `manual_${input.accountId}` };
  }
  async createSubscription(input: { accountId: string; trialDays?: number | null }): Promise<GatewaySubscription> {
    const end = input.trialDays && input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86400000) : null;
    return {
      subscriptionId: `manual_sub_${input.accountId}`,
      status: input.trialDays && input.trialDays > 0 ? 'trialing' : 'active',
      currentPeriodEnd: end,
    };
  }
  async cancelSubscription(): Promise<void> {
    /* nothing external to cancel */
  }
  verifyWebhook(): NormalizedEvent | null {
    // Manual billing has no inbound webhooks.
    return null;
  }
  checkWebhook(): WebhookCheck {
    return { ok: false, reason: 'Manual payments have no webhooks. Record a payment by hand in Payments.' };
  }
  async testConnection(): Promise<ConnectionResult> {
    const problems = manualProblems(this.details);
    if (problems.length) return { ok: false, message: problems.join(' ') };
    const ways = [this.details.upiId ? `UPI ID ${this.details.upiId}` : '', this.details.bank?.accountNumber ? `the bank account ending ${last4(this.details.bank.accountNumber)}` : ''].filter(Boolean);
    return { ok: true, message: `Manual payments are ready. Customers are shown ${ways.join(' and ')}.` };
  }
}

let _override: PaymentGateway | null = null;
let _active: PaymentGateway | null = null;

/**
 * The active gateway, as last read from the database by billing/providers.ts
 * (activeGateway() there refreshes it). Manual until a provider is made
 * active in the operator console.
 */
export function getGateway(): PaymentGateway {
  return _override ?? _active ?? new ManualGateway();
}

/** billing/providers.ts sets what it read; nothing else should. */
export function setActiveGateway(g: PaymentGateway | null) {
  _active = g;
}

/** Test hook: wins over the database. */
export function __setGateway(g: PaymentGateway | null) {
  _override = g;
}
export const __gatewayOverride = () => _override;

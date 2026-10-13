/**
 * The payment-gateway seam.
 *
 * No gateway is chosen yet (Razorpay vs Stripe vs manual/offline is a later
 * decision), so the rest of the system talks to this PORT, never to a provider.
 * Choosing a gateway later means writing one adapter that implements this
 * interface and switching getGateway() — nothing else changes.
 *
 * Until then ManualGateway runs the whole business model with no provider at
 * all: free plans, manually-granted subscriptions, and offline/invoice billing
 * all work. A tenant can be created, trialed, entitled and lapsed without a
 * single external call.
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
  raw: unknown;
};

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
}

/** The no-provider gateway. Everything succeeds locally; there are no webhooks. */
export class ManualGateway implements PaymentGateway {
  readonly name = 'manual';
  readonly external = false;
  async createCustomer(input: { accountId: string }): Promise<GatewayCustomer> {
    return { customerId: `manual_${input.accountId}` };
  }
  async createSubscription(input: {
    accountId: string;
    trialDays?: number | null;
  }): Promise<GatewaySubscription> {
    const end =
      input.trialDays && input.trialDays > 0
        ? new Date(Date.now() + input.trialDays * 86400000)
        : null;
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
}

let _gateway: PaymentGateway | null = null;

/**
 * The active gateway. Manual until PAYMENT_GATEWAY names a real one AND its
 * adapter is added here. Kept behind a factory so the choice is one line.
 */
export function getGateway(): PaymentGateway {
  if (_gateway) return _gateway;
  const name = String(process.env.PAYMENT_GATEWAY || 'manual').trim().toLowerCase();
  switch (name) {
    // case 'razorpay': _gateway = new RazorpayGateway(); break;
    // case 'stripe':   _gateway = new StripeGateway();   break;
    default:
      _gateway = new ManualGateway();
  }
  return _gateway;
}

/** Test hook. */
export function __setGateway(g: PaymentGateway | null) {
  _gateway = g;
}

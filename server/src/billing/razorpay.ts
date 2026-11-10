import type { ConnectionResult, GatewayCustomer, GatewaySubscription, NormalizedEvent, PaymentGateway, WebhookCheck } from './gateway.js';
import { call, defaultFetch, header, hmac, parseJson, rawText, sameText, type Fetcher } from './webhookKit.js';

/**
 * Razorpay, built to its documented API (v1):
 *   - every call uses HTTP Basic auth with the Key ID and Key secret, at
 *     https://api.razorpay.com/v1; Test and Live differ only by the keys
 *     (rzp_test_… and rzp_live_…);
 *   - a webhook is signed as hex HMAC-SHA256 of the raw body with the webhook
 *     secret set on the webhook in the Razorpay dashboard, in
 *     X-Razorpay-Signature; X-Razorpay-Event-Id names the event.
 *
 * Test connection lists at most one payment: it reads, creates nothing and
 * charges nothing.
 */
export type RazorpayKeys = { mode: 'TEST' | 'LIVE'; keyId: string; keySecret: string; webhookSecret?: string | null };

export const RAZORPAY_BASE = 'https://api.razorpay.com/v1';

const SUBSCRIPTION_STATUS: Record<string, string> = { authenticated: 'trialing', active: 'active', charged: 'active', pending: 'past_due', halted: 'past_due', paused: 'paused', cancelled: 'cancelled', completed: 'cancelled', expired: 'cancelled' };

export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';
  readonly external = true;
  constructor(
    private readonly keys: RazorpayKeys,
    private readonly fetcher: Fetcher = defaultFetch,
  ) {}

  private headers() {
    return { Authorization: `Basic ${Buffer.from(`${this.keys.keyId}:${this.keys.keySecret}`).toString('base64')}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  async testConnection(): Promise<ConnectionResult> {
    const which = this.keys.mode === 'LIVE' ? 'live' : 'test';
    if (!this.keys.keyId || !this.keys.keySecret) return { ok: false, message: `Save Razorpay’s ${which} Key ID and Key secret first.` };
    const want = this.keys.mode === 'LIVE' ? 'rzp_live_' : 'rzp_test_';
    if (!this.keys.keyId.startsWith(want))
      return { ok: false, message: `This Key ID does not start with ${want}, so it is not a ${which} key. Razorpay is in ${which === 'live' ? 'Live' : 'Test'} mode here.` };
    const r = await call(this.fetcher, `${RAZORPAY_BASE}/payments?count=1`, { method: 'GET', headers: this.headers() });
    if (r.status === 0) return { ok: false, message: 'CLOR could not reach Razorpay. Try again in a few minutes.' };
    if (r.status === 200) return { ok: true, message: `Razorpay accepted the ${which} keys.${this.keys.webhookSecret ? '' : ' Add the webhook secret too, or Razorpay’s events cannot be checked.'}` };
    if (r.status === 401) return { ok: false, message: 'Razorpay says the Key ID or the Key secret is wrong. Generate a new pair under Account & Settings, API keys in the Razorpay dashboard.' };
    return { ok: false, message: `Razorpay answered with an error (${r.status}${r.body?.error?.description ? `: ${r.body.error.description}` : ''}). Try again, or check the keys.` };
  }

  checkWebhook(rawBody: string | Buffer, headers: Record<string, unknown>): WebhookCheck {
    const raw = rawText(rawBody);
    const sig = header(headers, 'x-razorpay-signature');
    if (!sig) return { ok: false, reason: 'The event had no Razorpay signature, so it was not used.' };
    if (!this.keys.webhookSecret) return { ok: false, reason: 'No Razorpay webhook secret is saved, so the event could not be checked. Add it in Payments.' };
    if (!sameText(sig, hmac(this.keys.webhookSecret, raw, 'hex')))
      return { ok: false, reason: 'The signature did not match the saved webhook secret, so the event was not used. Check that it is the same secret as on the webhook in Razorpay.' };
    const body = parseJson(raw);
    if (!body || typeof body.event !== 'string') return { ok: false, reason: 'The event was signed but could not be read.' };
    return { ok: true, event: normalizeRazorpay(body, header(headers, 'x-razorpay-event-id')) };
  }

  verifyWebhook(rawBody: string | Buffer, headers: Record<string, unknown>): NormalizedEvent | null {
    const r = this.checkWebhook(rawBody, headers);
    return r.ok ? r.event : null;
  }

  async createCustomer(input: { accountId: string }): Promise<GatewayCustomer> {
    /* Checkout is not built yet: no customer is made at Razorpay. CLOR's account id travels in each payment's notes. */
    return { customerId: input.accountId };
  }

  async createSubscription(input: { accountId: string; trialDays?: number | null }): Promise<GatewaySubscription> {
    /* Checkout is not built yet: a subscription starts locally, as with manual billing, and nothing is charged. */
    const trial = input.trialDays && input.trialDays > 0;
    return { subscriptionId: `local_${input.accountId}`, status: trial ? 'trialing' : 'active', currentPeriodEnd: trial ? new Date(Date.now() + input.trialDays! * 86400000) : null };
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (!subscriptionId || subscriptionId.startsWith('local_')) return;
    const r = await call(this.fetcher, `${RAZORPAY_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ cancel_at_cycle_end: atPeriodEnd ? 1 : 0 }),
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`Razorpay did not cancel subscription ${subscriptionId} (${r.status}).`);
  }
}

/** A Razorpay webhook body, provider-neutral. */
export function normalizeRazorpay(body: any, eventIdHeader?: string): NormalizedEvent {
  const payment = body.payload?.payment?.entity || {};
  const sub = body.payload?.subscription?.entity || {};
  const accountId = payment.notes?.accountId || sub.notes?.accountId || null;
  const reference = payment.id || sub.id || null;
  const ev: NormalizedEvent = {
    gateway: 'razorpay',
    eventId: eventIdHeader || `${body.event}:${reference ?? body.created_at ?? ''}`,
    type: body.event,
    accountId,
    amount: Number.isInteger(payment.amount) ? payment.amount : null,
    reference,
    raw: body,
  };
  if (/^subscription\./.test(body.event) && SUBSCRIPTION_STATUS[sub.status]) {
    ev.subscription = { status: SUBSCRIPTION_STATUS[sub.status], gatewaySubscriptionId: sub.id || undefined, currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : undefined };
  } else if (body.event === 'payment.captured' && accountId) {
    ev.subscription = { status: 'active' };
  }
  return ev;
}

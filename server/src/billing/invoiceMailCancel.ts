import { cancelUnsent } from '../services/mailer.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * The invoice is paid or cancelled: an email asking for its money that has not
 * gone yet is called off. Such a message exists when the mail server refused
 * it and the outbox was going to try again by itself (services/emailRetry.ts);
 * without this, a reminder to pay could arrive hours after the payment.
 *
 * Kept apart from invoiceEmail.ts so the code that marks an invoice paid
 * (events.ts, invoices.ts) can call it without importing the sender.
 * Never throws: the payment or the cancelling stands either way.
 */

/** Every wording that asks for an invoice's money. */
export const ASKING_TEMPLATES = ['billing.invoice_issued', 'billing.invoice_reminder', 'billing.invoice_overdue', 'billing.renewal_invoice'];

export async function cancelUnsentInvoiceMail(invoiceId: string, why: 'PAID' | 'VOID'): Promise<number> {
  const reason = why === 'PAID' ? 'Not sent: the invoice was paid before this email went.' : 'Not sent: the invoice was cancelled before this email went.';
  return outsideTenant('billing: call off unsent invoice mail', () => cancelUnsent({ relatedType: 'BillingInvoice', relatedId: invoiceId, templateKeys: ASKING_TEMPLATES }, reason)).catch((e) => {
    console.error('[billing.invoiceMailCancel] unsent mail not called off:', e instanceof Error ? e.message : e);
    return 0;
  });
}

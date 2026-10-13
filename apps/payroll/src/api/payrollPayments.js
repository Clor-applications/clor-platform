import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Paying a payroll, and recording what the bank did with it.
 *
 * Bank account numbers arrive masked everywhere except the advice file, which
 * is a download rather than something this module ever holds.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll`;
const opts = { skipWarehouseHeader: true };

/** Who a batch on this run would pay, before one exists. */
export async function previewRunPayment(runId) {
  const { preview } = await apiFetch(`${base()}/runs/${encodeURIComponent(runId)}/payment-preview`, opts);
  return preview;
}

export async function listPayrollPayments({ runId = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (runId) query.set('runId', runId);
  if (status) query.set('status', status);
  const suffix = query.toString() ? `?${query}` : '';
  const { payments } = await apiFetch(`${base()}/payments${suffix}`, opts);
  return Array.isArray(payments) ? payments : [];
}

export async function getPayrollPayment(id) {
  const { payment } = await apiFetch(`${base()}/payments/${encodeURIComponent(id)}`, opts);
  return payment;
}

export async function createPayrollPayment(payload) {
  const { payment } = await apiFetch(`${base()}/payments`, { ...opts, method: 'POST', body: payload });
  return payment;
}

/** What the bank did — all of it at once, or one line at a time. */
export async function settlePaymentLines(id, results) {
  const { payment } = await apiFetch(`${base()}/payments/${encodeURIComponent(id)}/settle`, {
    ...opts,
    method: 'POST',
    body: { results },
  });
  return payment;
}

export async function previewPaymentPosting(id) {
  const { preview } = await apiFetch(`${base()}/payments/${encodeURIComponent(id)}/posting-preview`, opts);
  return preview;
}

export async function postPayrollPayment(id) {
  return apiFetch(`${base()}/payments/${encodeURIComponent(id)}/post`, { ...opts, method: 'POST' });
}

export async function cancelPayrollPayment(id) {
  const { payment } = await apiFetch(`${base()}/payments/${encodeURIComponent(id)}/cancel`, { ...opts, method: 'POST' });
  return payment;
}

/**
 * The advice rows, with whole account numbers.
 *
 * Fetched rather than linked because the request carries the auth header; the
 * file is built in the browser from what comes back, so the numbers are never
 * in a URL somebody could paste.
 */
export async function getBankAdvice(id) {
  return apiFetch(`${base()}/payments/${encodeURIComponent(id)}/advice`, opts);
}

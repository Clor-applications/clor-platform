import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Who is paid, and for when.
 *
 * Pay groups and payroll periods are the two things a run is identified by, so
 * they are fetched together by the screens that set payroll up. Every rule
 * about them — overlap, locking, what may still be edited — is the server's;
 * the screens report what they are told.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll`;

/* Organisation-wide, not per store: sending the warehouse header makes the
   server refuse the call for anybody who has no warehouse. */
const opts = { skipWarehouseHeader: true };

// ---- pay groups ------------------------------------------------------------

export async function listPayGroups({ activeOnly = false } = {}) {
  const { payGroups } = await apiFetch(`${base()}/pay-groups${activeOnly ? '?active=true' : ''}`, opts);
  return Array.isArray(payGroups) ? payGroups : [];
}

export async function createPayGroup(payload) {
  const { payGroup } = await apiFetch(`${base()}/pay-groups`, { ...opts, method: 'POST', body: payload });
  return payGroup;
}

export async function updatePayGroup(id, payload) {
  const { payGroup } = await apiFetch(`${base()}/pay-groups/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  return payGroup;
}

export const deletePayGroup = (id) =>
  apiFetch(`${base()}/pay-groups/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

// ---- periods ---------------------------------------------------------------

export async function listPayrollPeriods({ openOnly = false } = {}) {
  const { periods } = await apiFetch(`${base()}/periods${openOnly ? '?open=true' : ''}`, opts);
  return Array.isArray(periods) ? periods : [];
}

export async function createPayrollPeriod(payload) {
  const { period } = await apiFetch(`${base()}/periods`, { ...opts, method: 'POST', body: payload });
  return period;
}

export async function updatePayrollPeriod(id, payload) {
  const { period } = await apiFetch(`${base()}/periods/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  return period;
}

/** Closing a month is a decision, not an edit, so it has its own call. */
export async function setPayrollPeriodLock(id, locked) {
  const { period } = await apiFetch(`${base()}/periods/${encodeURIComponent(id)}/lock`, {
    ...opts,
    method: 'POST',
    body: { locked },
  });
  return period;
}

export const deletePayrollPeriod = (id) =>
  apiFetch(`${base()}/periods/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

/**
 * Recurring schedules, which live on the server.
 *
 * They used to be held in localStorage and raised only when somebody signed in
 * — so clearing the browser lost them, and a business that took a fortnight off
 * billed nobody.
 */
export const listSchedules = () => apiFetch(`${base()}/recurring`, opts);

export const createSchedule = (schedule) =>
  apiFetch(`${base()}/recurring`, { method: 'POST', body: schedule, ...opts });

export const updateSchedule = (id, patch) =>
  apiFetch(`${base()}/recurring/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, ...opts });

export const deleteSchedule = (id) =>
  apiFetch(`${base()}/recurring/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts });

export const listScheduleRuns = (id) =>
  apiFetch(`${base()}/recurring/${encodeURIComponent(id)}/runs`, opts);

/**
 * Raise whatever is due now.
 *
 * The server runs this on its own; this is the "Run now" button. Safe to press
 * twice — the period claim is unique, so a second call raises nothing rather
 * than billing a customer again.
 */
export const runSchedulesNow = () => apiFetch(`${base()}/recurring/run`, { method: 'POST', ...opts });

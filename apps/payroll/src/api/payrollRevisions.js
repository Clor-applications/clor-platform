import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Salary revisions, and what they actually cost.
 *
 * The impact is computed by the server running the payroll engine twice. What
 * was on the screen at approval is stored, so an approved revision shows the
 * figure that was approved rather than one recomputed under today's rates.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/revisions`;
const opts = { skipWarehouseHeader: true };

export async function listSalaryRevisions({ employeeId = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (status) query.set('status', status);
  const suffix = query.toString() ? `?${query}` : '';
  const { revisions } = await apiFetch(`${base()}${suffix}`, opts);
  return Array.isArray(revisions) ? revisions : [];
}

export async function getSalaryRevision(id) {
  const { revision } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, opts);
  return revision;
}

/** What terms nobody has written down yet would cost. */
export const previewRevisionImpact = (terms) => apiFetch(`${base()}/impact-preview`, { ...opts, method: 'POST', body: terms });

export async function createSalaryRevision(payload) {
  const { revision } = await apiFetch(base(), { ...opts, method: 'POST', body: payload });
  return revision;
}

export async function updateSalaryRevision(id, payload) {
  const { revision } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'PUT', body: payload });
  return revision;
}

const act = (id, path) => apiFetch(`${base()}/${encodeURIComponent(id)}/${path}`, { ...opts, method: 'POST' });

export const submitRevisionForReview = (id) => act(id, 'submit-review');
export const approveSalaryRevision = (id) => act(id, 'approve');
export const rejectSalaryRevision = (id) => act(id, 'reject');
/** The only step that changes anybody's pay. */
export const applySalaryRevision = (id) => act(id, 'apply');

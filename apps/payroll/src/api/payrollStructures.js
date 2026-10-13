import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * Salary structures: the shape of a salary, before anybody is on it.
 *
 * The preview is the one worth noticing. It sends an unsaved structure and gets
 * back what it would pay, calculated by the same engine a payroll run uses — so
 * the figure somebody sees while assembling a structure is the figure that will
 * actually be paid, not a second implementation that happens to agree today.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/structures`;
const opts = { skipWarehouseHeader: true };

export async function listSalaryStructures({ status = '', payGroupId = '' } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (payGroupId) q.set('payGroupId', payGroupId);
  const { structures } = await apiFetch(`${base()}${q.toString() ? `?${q}` : ''}`, opts);
  return Array.isArray(structures) ? structures : [];
}

export async function getSalaryStructure(id) {
  const { structure } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, opts);
  return structure;
}

export async function createSalaryStructure(payload) {
  const { structure } = await apiFetch(base(), { ...opts, method: 'POST', body: payload });
  return structure;
}

export async function updateSalaryStructure(id, payload) {
  const { structure } = await apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'PUT', body: payload });
  return structure;
}

export const deleteSalaryStructure = (id) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

/** What an unsaved structure would pay. Nothing is stored. */
export async function previewSalaryStructure(payload) {
  const { preview } = await apiFetch(`${base()}/preview`, { ...opts, method: 'POST', body: payload });
  return preview;
}

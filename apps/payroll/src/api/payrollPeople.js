import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * The people payroll pays, and what each of them is paid.
 *
 * Two resources, one screen. A roster answers "who is paid what", and that
 * question spans both — so the screen fetches them together rather than making
 * somebody visit two places to learn one thing.
 *
 * Bank account numbers and PANs arrive masked unless the caller holds the field
 * level for them, and `sensitiveVisible` says which it was. The masking is the
 * server's: a value masked in the browser has already crossed the network.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll`;
const opts = { skipWarehouseHeader: true };

// ---- people ----------------------------------------------------------------

export async function listEmployees({ q = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (status) query.set('status', status);
  const data = await apiFetch(`${base()}/employees${query.toString() ? `?${query}` : ''}`, opts);
  return { employees: Array.isArray(data.employees) ? data.employees : [], sensitiveVisible: !!data.sensitiveVisible };
}

export async function getEmployee(id) {
  const data = await apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, opts);
  return { employee: data.employee, sensitiveVisible: !!data.sensitiveVisible };
}

export async function createEmployee(payload) {
  const { employee } = await apiFetch(`${base()}/employees`, { ...opts, method: 'POST', body: payload });
  return employee;
}

export async function updateEmployee(id, payload) {
  const { employee } = await apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  return employee;
}

export const deleteEmployee = (id) =>
  apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

// ---- what they are paid ----------------------------------------------------

export async function listAssignments({ employeeId = '', status = '' } = {}) {
  const query = new URLSearchParams();
  if (employeeId) query.set('employeeId', employeeId);
  if (status) query.set('status', status);
  const { assignments } = await apiFetch(`${base()}/assignments${query.toString() ? `?${query}` : ''}`, opts);
  return Array.isArray(assignments) ? assignments : [];
}

export async function createAssignment(payload) {
  const { assignment } = await apiFetch(`${base()}/assignments`, { ...opts, method: 'POST', body: payload });
  return assignment;
}

export async function updateAssignment(id, payload) {
  const { assignment } = await apiFetch(`${base()}/assignments/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  return assignment;
}

export const deleteAssignment = (id) =>
  apiFetch(`${base()}/assignments/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

/** The salary in force for one person on one day — the question a run asks. */
export async function effectiveAssignment(employeeId, on) {
  const { assignment } = await apiFetch(
    `${base()}/assignments/effective?employeeId=${encodeURIComponent(employeeId)}&on=${encodeURIComponent(on)}`,
    opts
  );
  return assignment;
}

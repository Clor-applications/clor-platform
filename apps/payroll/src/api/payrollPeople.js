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

export async function createEmployee(payload) {
  const { employee } = await apiFetch(`${base()}/employees`, { ...opts, method: 'POST', body: payload });
  return employee;
}

export async function updateEmployee(id, payload) {
  const { employee, bankChangePending } = await apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, {
    ...opts,
    method: 'PUT',
    body: payload,
  });
  /* A change to bank details on file waits for approval instead of applying. */
  return { ...employee, bankChangePending: Boolean(bankChangePending) };
}

/** Bank detail changes: waiting by default, `status: 'ALL'` for the history. */
export const listBankChanges = ({ status = 'PENDING', employeeId = '' } = {}) => {
  const q = new URLSearchParams({ status, ...(employeeId ? { employeeId } : {}) });
  return apiFetch(`${base()}/bank-changes?${q}`, opts).then((r) => r?.changes || []);
};
export const approveBankChange = (id) => apiFetch(`${base()}/bank-changes/${encodeURIComponent(id)}/approve`, { ...opts, method: 'POST' });
export const rejectBankChange = (id, note) => apiFetch(`${base()}/bank-changes/${encodeURIComponent(id)}/reject`, { ...opts, method: 'POST', body: { note } });

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

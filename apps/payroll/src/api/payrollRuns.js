import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * A payroll run, stage by stage.
 *
 * Each stage is its own call rather than one "run payroll" button, because each
 * is a decision somebody makes: who is included, what days they worked, what
 * the validation says, and only then the arithmetic. The screen follows the
 * same shape.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}/payroll/runs`;
const opts = { skipWarehouseHeader: true };

export async function listPayrollRuns({ status = '' } = {}) {
  const { runs } = await apiFetch(`${base()}${status ? `?status=${encodeURIComponent(status)}` : ''}`, opts);
  return Array.isArray(runs) ? runs : [];
}

/** The run, who is in it, their days, and the payslips if it has been calculated. */
export async function getPayrollRun(id) {
  return apiFetch(`${base()}/${encodeURIComponent(id)}`, opts);
}

export async function createPayrollRun(payload) {
  return apiFetch(base(), { ...opts, method: 'POST', body: payload });
}

export const setRunEmployeeIncluded = (id, employeeId, include) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/employees`, { ...opts, method: 'POST', body: { employeeId, include } });

export const saveRunInputs = (id, inputs) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/inputs`, { ...opts, method: 'PUT', body: { inputs } });

/** What would stop this payroll producing a payslip somebody could defend. */
export const validatePayrollRun = (id) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/validate`, { ...opts, method: 'POST' });

export const calculatePayrollRun = (id) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/calculate`, { ...opts, method: 'POST' });

const stage = (path) => (id, body) =>
  apiFetch(`${base()}/${encodeURIComponent(id)}/${path}`, { ...opts, method: 'POST', body });

/**
 * What this payroll would write to the books, before it writes it.
 *
 * Payroll is usually the largest entry a company makes each month, and finance
 * seeing it only afterwards is how a misconfigured component becomes a
 * correcting journal. Read-only: asking costs nothing and changes nothing.
 */
export async function previewPayrollPosting(id) {
  const { preview } = await apiFetch(`${base()}/${encodeURIComponent(id)}/posting-preview`, opts);
  return preview;
}

/** The journal a run produced, and the entry as accounting holds it. */
export const getPayrollPosting = (id) => apiFetch(`${base()}/${encodeURIComponent(id)}/posting`, opts);

export const submitRunForReview = stage('submit-review');
export const approvePayrollRun = stage('approve');
export const rejectPayrollRun = stage('reject');
export const lockPayrollRun = stage('lock');
/* Idempotent: pressing it twice replays rather than posting twice. */
export const postPayrollRun = stage('post');
export const cancelPayrollRun = stage('cancel');

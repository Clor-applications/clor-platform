import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Joining & Leaving (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md; server: routes/peopleLifecycle.ts). */
const org = () => `/orgs/${encodeURIComponent(orgId())}`;
const base = () => `${org()}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });
export const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export const lifecycleOverview = () => apiFetch(`${base()}/lifecycle/overview`, opts);
export const pageJoiners = (q) => apiFetch(`${base()}/lifecycle/joiners${qs(q)}`, opts);
export const pageLeavers = (q) => apiFetch(`${base()}/lifecycle/leavers${qs(q)}`, opts);
export const pageChanges = (q) => apiFetch(`${base()}/lifecycle/changes${qs(q)}`, opts);
export const pageTasks = (q) => apiFetch(`${base()}/lifecycle/tasks${qs(q)}`, opts);
export const leavingPreview = (id) => apiFetch(`${base()}/lifecycle/leaving-preview/${encodeURIComponent(id)}`, opts);
export const updateTask = (id, body) => send(`/checklist-tasks/${encodeURIComponent(id)}`, 'PATCH', body);
export const startPlan = (employeeId, kind) => send(`/employees/${encodeURIComponent(employeeId)}/checklist/${kind}`, 'POST', {});
export const getSteps = () => apiFetch(`${base()}/checklist-templates`, opts);
export const saveSteps = (kind, items) => send(`/checklist-templates/${kind}`, 'PUT', { items });
export const resetSteps = (kind) => send(`/checklist-templates/${kind}`, 'DELETE');
export const employeeTypes = () => apiFetch(`${base()}/structure/employee-types`, opts).then((r) => r?.items || []).catch(() => []);
/* People a task can go to: the company's users, when the caller may list them. */
export const orgUsers = () => apiFetch(`${org()}/users`, opts).then((r) => r?.users || []).catch(() => []);

export const OWNER_WORD = { HR: 'HR', MANAGER: 'Manager', PAYROLL: 'Payroll', IT: 'IT / admin', EMPLOYEE: 'Employee' };
export const KIND_WORD = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter' };
export const READER_PILL = { WAITING: 'ui-pill-warn', FAILED: 'ui-pill-neg', CONFIRMED: 'ui-pill-pos', MANUAL: 'ui-pill-pos', NONE: 'ui-pill-neutral', PENDING: 'ui-pill-neutral' };

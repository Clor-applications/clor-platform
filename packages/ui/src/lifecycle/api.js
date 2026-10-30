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
/*
 * People a task or a no-dues line can go to: the company's people with a sign-in, by name. HR reads them from
 * People (the users screen is the administrator's and refuses HR); an administrator without People edit falls
 * back to the users list.
 */
export const orgUsers = () => apiFetch(`${base()}/assignees`, opts)
  .then((r) => r?.users || [])
  .catch(() => apiFetch(`${org()}/users`, opts).then((r) => r?.users || []).catch(() => []));
/** The owner's name stays in the list even when the list cannot be read, so a picker never shows an id. */
export const withOwner = (users, id, name) => (id && !users.some((u) => u.id === id) ? [...users, { id, fullName: name || 'Someone no longer listed' }] : users);

export const OWNER_WORD = { HR: 'HR', MANAGER: 'Manager', PAYROLL: 'Payroll', IT: 'IT / admin', EMPLOYEE: 'Employee' };
export const KIND_WORD = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter' };
export const READER_PILL = { WAITING: 'ui-pill-warn', FAILED: 'ui-pill-neg', CONFIRMED: 'ui-pill-pos', MANUAL: 'ui-pill-pos', NONE: 'ui-pill-neutral', PENDING: 'ui-pill-neutral' };

/* Leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.9; server: routes/peopleEngagement.ts). */
export const leavingExtras = (employeeId) => apiFetch(`${base()}/leaving/${encodeURIComponent(employeeId)}`, opts);
export const updateClearanceLine = (id, body) => send(`/clearance-lines/${encodeURIComponent(id)}`, 'PATCH', body);
export const addClearanceLine = (employeeId, body) => send(`/leaving/${encodeURIComponent(employeeId)}/clearance-lines`, 'POST', body);
export const removeClearanceLine = (id) => send(`/clearance-lines/${encodeURIComponent(id)}`, 'DELETE');
export const enterExitInterview = (employeeId, body) => send(`/leaving/${encodeURIComponent(employeeId)}/exit-interview`, 'POST', body);
export const decideExitInterview = (employeeId, body) => send(`/leaving/${encodeURIComponent(employeeId)}/exit-interview/outcome`, 'POST', body);
export const finalPayBoard = () => apiFetch(`${base()}/final-pay`, opts);

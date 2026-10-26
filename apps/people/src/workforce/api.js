import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Workforce (People design v1, Module 01): the directory, record and their operations. */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body, extra = {}) => apiFetch(`${base()}${path}`, { ...opts, method, body, ...extra });
export const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const listEmployees = (params) => apiFetch(`${base()}/employees${qs(params)}`, opts);
export const employeeCounts = () => apiFetch(`${base()}/employees/counts`, opts);
export const employeeIds = (params) => apiFetch(`${base()}/employees${qs({ ...params, idsOnly: '1' })}`, opts);
export const linkCandidates = () => apiFetch(`${base()}/employees/link-candidates`, opts).then((r) => r?.users || []);
export const linkUser = (id, userId) => send(`/employees/${encodeURIComponent(id)}/user`, 'PUT', { userId });
export const exportColumns = () => apiFetch(`${base()}/employees/export/columns`, opts).then((r) => r?.columns || []);
export const exportEmployees = (params) => apiFetch(`${base()}/employees/export${qs(params)}`, { ...opts, asText: true });
export const nextEmployeeCode = () => apiFetch(`${base()}/employees/next-code`, opts).then((r) => r?.code || '');
export const getEmployee = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}`, opts);
export const createEmployee = (body) => send('/employees', 'POST', body);
export const updateEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}`, 'PUT', body);
export const structure = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
export const dataHealth = () => apiFetch(`${base()}/data-health`, opts);
export const openChecklistTasks = () => apiFetch(`${base()}/checklist-tasks`, opts).then((r) => r?.tasks || []);
export const bulkUpdate = (body) => send('/employees/bulk', 'POST', body);

export const listViews = () => apiFetch(`${base()}/saved-views?screen=employees`, opts).then((r) => r?.views || []);
export const saveView = (body) => send('/saved-views', 'POST', body).then((r) => r?.view);
export const deleteView = (id) => send(`/saved-views/${encodeURIComponent(id)}`, 'DELETE');

export const listDrafts = () => apiFetch(`${base()}/employee-drafts`, opts).then((r) => r?.drafts || []);
export const getDraft = (id) => apiFetch(`${base()}/employee-drafts/${encodeURIComponent(id)}`, opts).then((r) => r?.draft);
export const saveDraft = (id, body) => send(`/employee-drafts${id ? `/${encodeURIComponent(id)}` : ''}`, 'PUT', body).then((r) => r?.draft);
export const deleteDraft = (id) => send(`/employee-drafts/${encodeURIComponent(id)}`, 'DELETE');

/** Save text as a file the browser downloads. */
export function downloadText(text, fileName, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const employeeActivity = (id, before) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/activity${qs({ before })}`, opts);
export const addComment = (id, body) => send(`/employees/${encodeURIComponent(id)}/notes`, 'POST', { body });
export const deleteEmployee = (id) => send(`/employees/${encodeURIComponent(id)}`, 'DELETE');
export const rehireEmployee = (id, body) => send(`/employees/${encodeURIComponent(id)}/rehire`, 'POST', body);
export const decideProbation = (id, body) => send(`/employees/${encodeURIComponent(id)}/probation/decide`, 'POST', body);
export const withdrawScheduled = (id, changeId) => send(`/employees/${encodeURIComponent(id)}/scheduled/${encodeURIComponent(changeId)}`, 'DELETE');
export const changeImpact = (id, fields) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/change-impact${qs(fields)}`, opts);
export const openTasksFor = (id) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}/checklist`, opts);
export const listTags = () => apiFetch(`${base()}/tags`, opts).then((r) => r?.tags || []);
export const listContractors = () => apiFetch(`${base()}/contractors`, opts).then((r) => r?.contractors || []).catch(() => []);
export const workforcePending = () => apiFetch(`${base()}/workforce/pending`, opts);
export const employeeAsOf = (id, date) => apiFetch(`${base()}/employees/${encodeURIComponent(id)}${qs({ asOf: date })}`, opts);

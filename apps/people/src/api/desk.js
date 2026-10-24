import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(orgId())}/people/desk`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

/* Help desk (DESK-01..06): queues, the thread, categories and times, templates. */
export const listDesk = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return apiFetch(`${base()}${q.toString() ? `?${q}` : ''}`, opts);
};
export const getDeskRequest = (id) => apiFetch(`${base()}/${encodeURIComponent(id)}`, opts).then((r) => r?.request);
export const raiseDeskRequest = (body) => send('', 'POST', body);
export const deskMessage = (id, body) => send(`/${encodeURIComponent(id)}/messages`, 'POST', body);
export const deskAssign = (id, body) => send(`/${encodeURIComponent(id)}/assign`, 'POST', body);
export const deskResolve = (id, resolution) => send(`/${encodeURIComponent(id)}/resolve`, 'POST', { resolution });
export const deskReopen = (id) => send(`/${encodeURIComponent(id)}/reopen`, 'POST', {});
export const deskMoveToCase = (id, caseId) => send(`/${encodeURIComponent(id)}/move-to-case`, 'POST', caseId ? { caseId } : {});
export const deskCategories = () => apiFetch(`${base()}/categories`, opts).then((r) => r?.categories || []);
export const saveDeskCategory = (key, body) => send(`/categories/${encodeURIComponent(key)}`, 'PUT', body);
export const deskTemplates = () => apiFetch(`${base()}/templates`, opts).then((r) => r?.templates || []);
export const saveDeskTemplate = (body) => (body.id ? send(`/templates/${encodeURIComponent(body.id)}`, 'PUT', body) : send('/templates', 'POST', body));
/* People who can be assigned: the company's users, when the caller may list them. */
export const orgUsers = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/users`, opts).then((r) => r?.users || []).catch(() => []);

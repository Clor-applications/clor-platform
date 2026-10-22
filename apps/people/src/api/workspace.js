import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
const base = (kind) => `/orgs/${encodeURIComponent(orgId())}/people/workspace/${encodeURIComponent(kind)}`;
const opts = { skipWarehouseHeader: true };
export const listRecords = (kind) => apiFetch(base(kind), opts).then((r) => r.records);
export const saveRecord = (kind, body) => apiFetch(`${base(kind)}${body.id ? `/${encodeURIComponent(body.id)}` : ''}`, { ...opts, method: body.id ? 'PUT' : 'POST', body: { title: body.title, status: body.status, employeeId: body.employeeId || null, dueDate: body.dueDate || null, details: body.details, ...(body.version ? { version: body.version } : {}) } });
export const deleteRecord = (kind, id) => apiFetch(`${base(kind)}/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' });

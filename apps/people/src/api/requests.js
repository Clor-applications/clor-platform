import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Request types HR makes (gap 25) and shift swaps (gap 24), People's side (server: routes/peopleRequests.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body, headers) => apiFetch(`${base()}${path}`, { ...opts, method, body, headers });

/** { forms: [{ id, name, description, fields, audience, departmentIds, slaDays, approver, active, requests, open }], templates: [{ key, name, description, on }] } */
export const listForms = () => apiFetch(`${base()}/request-forms`, opts);
export const createForm = (body) => send('/request-forms', 'POST', body).then((r) => r.form);
export const updateForm = (id, body) => send(`/request-forms/${encodeURIComponent(id)}`, 'PUT', body).then((r) => r.form);
export const switchOnTemplate = (key) => send(`/request-forms/templates/${encodeURIComponent(key)}`, 'POST', {}).then((r) => r.form);
const query = (q) => {
  const s = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v != null && v !== '')).toString();
  return s ? `?${s}` : '';
};
export const formsReport = (q) => apiFetch(`${base()}/request-forms/report${query(q)}`, opts);
export const formsReportCsvPath = (q) => `${base()}/request-forms/report${query({ ...q, format: 'csv' })}`;
/** A file on a request someone decides: { name, mime, dataUrl }. */
export const requestFile = (id) => apiFetch(`${base()}/request-forms/files/${encodeURIComponent(id)}`, opts).then((r) => r.file);

/** My own: { forms, requests }. */
export const myForms = () => apiFetch(`${base()}/my/request-forms`, opts);
export const askForm = (id, body, key) => send(`/my/request-forms/${encodeURIComponent(id)}`, 'POST', body, key ? { 'Idempotency-Key': key } : undefined).then((r) => r.request);
export const replyMine = (id, note) => send(`/my/form-requests/${encodeURIComponent(id)}/reply`, 'POST', { note });
export const withdrawMine = (id) => send(`/my/form-requests/${encodeURIComponent(id)}/withdraw`, 'POST', {});
export const myFile = (id) => apiFetch(`${base()}/my/form-files/${encodeURIComponent(id)}`, opts).then((r) => r.file);

/** { swaps, rules: { maxDays, minRestHours }, canCancel } */
export const listSwaps = (status) => apiFetch(`${base()}/shift-swaps${query({ status })}`, opts);
export const cancelSwap = (id, note) => send(`/shift-swaps/${encodeURIComponent(id)}/cancel`, 'POST', note ? { note } : {});

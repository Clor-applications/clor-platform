import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Approvals (docs/people/02-PRD.md APR-01..07): what waits for me, what I asked for, rules and stand-ins. */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

export const listRequests = () => apiFetch(`${base()}/requests`, opts);
/** One inbox: { items: [{ key, kind: APPROVAL|LEAVE|ATTENDANCE|HELPDESK, id, what, subKind, employeeName, fromDate, toDate, days, since, dueAt, overdue, managerApproved, bulk }], counts, rights }. */
export const getInbox = () => apiFetch(`${base()}/inbox`, opts);
export const getRequest = (id) => apiFetch(`${base()}/requests/${encodeURIComponent(id)}`, opts).then((r) => r?.request);
export const submitRequest = (body, idempotencyKey) => apiFetch(`${base()}/requests`, { ...opts, method: 'POST', body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined });
export const decideRequest = (id, action, comment) => send(`/requests/${encodeURIComponent(id)}/${action}`, 'POST', comment ? { comment } : {});
/** Several at once, each through the same checks as one: { done, failed, results: [{ id, error }] }. */
export const bulkDecideRequests = (ids, approve, note) => send('/approvals/bulk-decide', 'POST', { ids, action: approve ? 'approve' : 'reject', ...(note ? { comment: note } : {}) });
export const replyRequest =(id, note) => send(`/requests/${encodeURIComponent(id)}/reply`, 'POST', { note });
export const withdrawRequest = (id) => send(`/requests/${encodeURIComponent(id)}/withdraw`, 'POST', {});

export const listRules = () => apiFetch(`${base()}/approval-rules`, opts);
export const saveRule = (body) => send('/approval-rules', 'POST', body);
export const retireRule = (requestType) => send(`/approval-rules/${encodeURIComponent(requestType)}`, 'DELETE');
export const activeRule = (requestType) => apiFetch(`${base()}/approval-rules/active/${encodeURIComponent(requestType)}`, opts).then((r) => r?.rule || null);

export const listStandIns = () => apiFetch(`${base()}/stand-ins`, opts).then((r) => r?.standIns || []);
/** My own stand-ins with the day and my People record: { today, selfEmployeeId, standIns: [{ id, standInEmployeeId, standInName, fromDate, toDate, live }] }. */
export const listStandInsFull = () => apiFetch(`${base()}/stand-ins`, opts);
/** Anyone here with a CLOR sign-in, by name: who can be chosen to decide in my place. */
export const standInCandidates = () => apiFetch(`${base()}/stand-ins/candidates`, opts).then((r) => r?.people || []).catch(() => []);
export const addStandIn = (body) => send('/stand-ins', 'POST', body);
export const removeStandIn = (id) => send(`/stand-ins/${encodeURIComponent(id)}`, 'DELETE');

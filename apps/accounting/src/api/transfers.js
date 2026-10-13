import { apiFetch } from '@platform/http';

export function listTransfers(orgId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/transfers`);
}

export function createTransfer(orgId, payload) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/transfers`, { method: 'POST', body: payload });
}

export function sendTransfer(orgId, transferId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/transfers/${encodeURIComponent(transferId)}/send`, { method: 'POST' });
}

export function receiveTransfer(orgId, transferId) {
  return apiFetch(`/orgs/${encodeURIComponent(orgId)}/transfers/${encodeURIComponent(transferId)}/receive`, { method: 'POST' });
}

import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

export const getEmailSettings = () => apiFetch(`${base()}/email/settings`, opts);

export const saveEmailSettings = (settings) =>
  apiFetch(`${base()}/email/settings`, { method: 'PUT', body: settings, ...opts });

export const testEmailConnection = (settings) =>
  apiFetch(`${base()}/email/test-connection`, { method: 'POST', body: settings, ...opts });

export const sendTestEmail = () => apiFetch(`${base()}/email/send-test`, { method: 'POST', ...opts });

export const getNotifications = () => apiFetch(`${base()}/notifications`, opts);

export const saveNotifications = (events) =>
  apiFetch(`${base()}/notifications`, { method: 'PUT', body: { events }, ...opts });

export const getOutbox = (status) =>
  apiFetch(`${base()}/email/outbox${status ? `?status=${encodeURIComponent(status)}` : ''}`, opts);

export const retryOutbox = () => apiFetch(`${base()}/email/outbox/retry`, { method: 'POST', ...opts });

export const resendVerification = () =>
  apiFetch('/auth/resend-verification', { method: 'POST', skipBranchHeader: true, skipWarehouseHeader: true });

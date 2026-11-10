import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org.');
  return id;
};
const opts = { skipWarehouseHeader: true };

/** The signed-in person's inbox for the company on screen: { unread, notifications }. */
export const getInbox = (limit = 30) => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications/inbox?limit=${limit}`, opts);
export const markRead = (ids) => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications/inbox/read`, { ...opts, method: 'POST', body: { ids } });
export const markAllRead = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications/inbox/read`, { ...opts, method: 'POST', body: { all: true } });
export const getMutes = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications/inbox/mutes`, opts).then((r) => r?.mutes || []);
export const setMute = (kind, muted) => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications/inbox/mutes`, { ...opts, method: 'POST', body: { kind, muted } }).then((r) => r?.mutes || []);

/**
 * The company's email switches (server: routes/email.ts, SETTINGS::Company Profile):
 * { events: [{ key, label, description, enabled }] }. Mail that has to arrive
 * (sign-in, password, invitations) is not listed and cannot be switched off.
 */
export const getEmailSwitches = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications`, opts);
export const saveEmailSwitches = (events) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/notifications`, { ...opts, method: 'PUT', body: { events } });

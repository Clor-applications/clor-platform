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

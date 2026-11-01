import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

export const getFeatures = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/features`, { skipWarehouseHeader: true });

export const getFeatureCatalog = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/features/catalog`, { skipWarehouseHeader: true });

export const setFeatures = (features) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/features`, {
    method: 'PUT',
    body: { features },
    skipWarehouseHeader: true,
  });

/**
 * The plan, what it entitles, the module packs and what the account has spent
 * of its limits. Read by the module picker and by anything that has to say
 * "on the Growth plan" rather than hiding a module outright.
 */
export const getEntitlement = () =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/entitlement`, { skipWarehouseHeader: true });

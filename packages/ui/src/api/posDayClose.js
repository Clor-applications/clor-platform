import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

const base = () => `/orgs/${encodeURIComponent(orgId())}`;
const opts = { skipWarehouseHeader: true };

/**
 * The POS day close — the Z report.
 *
 * The over/short figure is what the owner reviews, so the count cannot live
 * only on the till that produced it.
 */
export const listPosDayCloses = () => apiFetch(`${base()}/pos-day-closes`, opts);

export const createPosDayClose = (record) =>
  apiFetch(`${base()}/pos-day-closes`, { method: 'POST', body: record, ...opts });

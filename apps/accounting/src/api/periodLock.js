import { apiFetch } from '@platform/http';
import { requireOrgId as orgId } from '@platform/context';

const path = () => `/orgs/${encodeURIComponent(orgId())}/ledger/period-lock-policy`;
const opts = { skipWarehouseHeader: true };

export const getPeriodLockPolicy = () => apiFetch(path(), opts);
export const savePeriodLockPolicy = (policy) => apiFetch(path(), { ...opts, method: 'PUT', body: policy });

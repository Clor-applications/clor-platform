import { apiFetch } from '@platform/http';

export const getProfile = () =>
  apiFetch('/auth/me', { skipBranchHeader: true, skipWarehouseHeader: true });

/**
 * Every field is optional and only what is passed gets written, so saving the
 * phone number cannot blank the name. `fullName` is composed on the server
 * from first and last rather than sent, because two writers for one displayed
 * string is how they end up disagreeing.
 */
export const updateProfile = (patch) =>
  apiFetch('/auth/me', {
    method: 'PATCH',
    body: typeof patch === 'string' ? { fullName: patch } : patch,
    skipBranchHeader: true,
    skipWarehouseHeader: true,
  });

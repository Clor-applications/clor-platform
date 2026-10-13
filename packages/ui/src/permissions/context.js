import { createContext } from 'react';

/**
 * Shared permission state. Kept in its own module so the provider file exports
 * only components (a Fast Refresh requirement) and the hook can import it
 * without pulling the provider in.
 */
export const PermissionContext = createContext({
  loading: true,
  error: '',
  permissions: new Set(),
  roles: [],
  restrictions: { branchIds: [], warehouseIds: [] },
  can: () => false,
  canAny: () => false,
  canModule: () => false,
  reload: () => {},
});

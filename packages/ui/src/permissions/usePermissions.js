import { useContext } from 'react';
import { PermissionContext } from './context';

/** Effective permissions for the signed-in user in the active org and branch. */
export const usePermissions = () => useContext(PermissionContext);

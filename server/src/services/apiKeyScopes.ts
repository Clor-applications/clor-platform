import { permKey } from '../constants/permissionCatalog.js';
import { PermissionAction } from '../constants/enums.js';
import { cannotGrantError, grantAuthority, unheldGrants } from './roleGuards.js';

const A = PermissionAction;

/**
 * #10: what each public-API scope (routes/publicApi.ts) does, as the
 * permissions a person would need to do the same in CLOR. An API key speaks
 * for the whole company, so whoever makes or rotates one must hold these
 * company-wide — "nobody hands out more than they hold", as for roles.
 */
export const SCOPE_PERMISSIONS: Record<string, string[]> = {
  'attendance:read': [permKey('ATTENDANCE', 'Attendance Records', A.VIEW)],
  'employees:read': [permKey('PEOPLE', 'Employees', A.VIEW)],
  'employees:write': [permKey('PEOPLE', 'Employees', A.CREATE), permKey('PEOPLE', 'Employees', A.EDIT)],
  'punches:write': [permKey('ATTENDANCE', 'Attendance Records', A.CREATE)],
  'leave:read': [permKey('ATTENDANCE', 'Leave Requests', A.VIEW)],
  'leave:write': [permKey('ATTENDANCE', 'Leave Requests', A.CREATE)],
  'leave:approve': [permKey('ATTENDANCE', 'Leave Requests', A.APPROVE)],
  'readers:read': [permKey('ATTENDANCE', 'Attendance Devices', A.VIEW)],
};

/** The permissions a set of scopes amounts to. An unknown scope maps to itself, so it can never be held. */
export const permissionsOfScopes = (scopes: Iterable<string>) => [...new Set([...scopes].flatMap((s) => SCOPE_PERMISSIONS[s] ?? [`SCOPE::${s}::UNKNOWN`]))];

/**
 * Why this caller may not make (or rotate) a key with these scopes, or null.
 * `gate` is the permission the route itself asks for, which must also be held
 * company-wide.
 */
export async function scopeRefusal(
  req: { tenant?: { accountId: string; orgId: string }; auth?: { userId: string } },
  scopes: Iterable<string>,
  gate: string
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const { authority, refusal } = await grantAuthority(req, null, gate);
  if (refusal) return refusal;
  const missing = unheldGrants(authority, permissionsOfScopes(scopes));
  if (!missing.length) return null;
  const body = cannotGrantError(missing);
  return { status: 403, body: { ...body, error: 'You cannot give a key access you do not have yourself. Choose fewer permissions, or ask someone who has them.' } };
}

import type { Request, Response, NextFunction } from 'express';
import { type PermissionAction as PermissionActionType } from '../constants/enums.js';
import { resolveAccess } from '../services/access.js';
import { isAppEntitled } from '../services/subscriptions.js';

// DB-stored RBAC:
// - UserRoleAssignment can be org-wide (branchId null) or branch-scoped
// - RolePermission stores Permission rows (module/subModule/action)

declare module 'express-serve-static-core' {
  interface Request {
    permissions?: Set<string>;
    permissionLevels?: Map<string, number>;
    /** Whether the caller holds an ADMIN-type role in this org and branch. */
    isAdmin?: boolean;
    /** Reads of documents are limited to rows the caller created. */
    ownDocumentsOnly?: boolean;
  }
}

function permString(module: string, subModule: string | null, action: PermissionActionType): string {
  return `${module}::${subModule || ''}::${action}`;
}

export type Refusal = { status: number; body: Record<string, unknown> };

const ACCOUNTING_MODULES = new Set(['SALES', 'PURCHASE', 'INVENTORY', 'ACCOUNTING', 'CASHBANK', 'EXPENSES', 'MASTERS']);

/**
 * The app(s) a permission module belongs to — any one of them paid for opens
 * it (A-14). People and Attendance share the employee master and leave, so
 * either opens PEOPLE and ATTENDANCE here; each app's own route guard is
 * stricter where it needs to be. SETTINGS and REPORTS are the company's.
 */
const MODULE_APPS: Record<string, string[]> = {
  PAYROLL: ['payroll'],
  PEOPLE: ['people', 'attendance'],
  ATTENDANCE: ['attendance', 'people'],
};
const appsForModule = (m: string): string[] | null => (ACCOUNTING_MODULES.has(m) ? ['accounting'] : MODULE_APPS[m] || null);

/**
 * Decides one permission for this request, and records the caller's effective
 * access on it either way.
 *
 * `requirePermission` is this as route middleware. A handler that only learns
 * which permission applies once it has read the request — a payment's
 * direction decides between Receipts and Payments — calls it directly.
 * Returns null when allowed, or the refusal to send.
 */
export async function authorize(
  req: Request,
  module: string,
  action: PermissionActionType,
  subModule?: string
): Promise<Refusal | null> {
  const m = String(module || '').trim();
  const sm = String(subModule || '').trim();
  /*
   * The account comes from the tenant context, not from the token.
   *
   * `req.tenant.accountId` is the account that owns the organisation being
   * worked in, established by the membership that authorised the request.
   * `req.auth.accountId` is where the person signed up, which for anyone
   * invited into somebody else's company is a different account entirely —
   * so roles were being looked for in the visitor's own account and never
   * found, and a correctly invited user with a correctly assigned role was
   * told "No roles assigned".
   *
   * For a person working in their own company the two are equal, which is
   * why this was invisible until invitations crossed an account.
   */
  const accountId = String(req.tenant?.accountId || '').trim();
  const userId = String(req.auth?.userId || '').trim();
  const orgId = String(req.tenant?.orgId || '').trim();
  const branchId = String(req.tenant?.branchId || '').trim();

  if (!accountId || !userId) return { status: 401, body: { error: 'Missing auth context' } };
  if (!orgId || !branchId) return { status: 400, body: { error: 'Missing tenant context' } };

  /*
   * A role says what a user may do inside an app; it must never grant the app
   * itself. Accounting historically relied only on RBAC while People,
   * Attendance and Payroll had explicit subscription guards. That allowed an
   * account whose subscription removed Accounting to keep calling its APIs
   * directly. Put the commercial ceiling in the common authorization path so
   * shell visibility and direct API access reach the same answer.
   */
  const apps = appsForModule(m);
  if (apps) {
    let owned = false;
    for (const app of apps) {
      if (await isAppEntitled(accountId, app)) {
        owned = true;
        break;
      }
    }
    if (!owned) {
      return {
        status: 402,
        body: { error: `The ${apps[0]} app is not on this account's subscription.`, app: apps[0], code: 'APP_NOT_SUBSCRIBED' },
      };
    }
  }

  // Effective access resolves direct role assignments AND role profiles.
  const access = await resolveAccess(accountId, orgId, userId, branchId);

  /*
   * No roles is no access — for the company's creator too.
   *
   * This used to create an Owner role and assign it whenever the creator
   * arrived with none. Company setup has created that role since long before
   * this was written, so it only ever fired for somebody whose roles had been
   * taken away — and once administrators could hand over and step down, that
   * meant a creator another administrator had removed became Owner again on
   * their next click. A company left with no administrator at all is repaired
   * by scripts/backfillOwnerPermissions.ts, which every deploy runs, not here.
   */
  if (access.roleIds.length === 0) return { status: 403, body: { error: 'No roles assigned' } };

  const allowed = access.permissions;
  req.permissions = allowed;
  req.permissionLevels = access.levels;
  req.isAdmin = access.isAdmin;
  req.ownDocumentsOnly = access.ownDocumentsOnly;

  const want = permString(m, sm || null, action);
  if (!allowed.has(want)) {
    /*
     * A denial is a denial.
     *
     * This used to repair itself: a creator who hit a permission their Owner
     * role did not carry had it created, granted and assigned, and the
     * request went through. Authorisation was writing to the permission
     * tables while deciding whether to authorise — so a refused request could
     * change security configuration, and effective access depended on which
     * endpoints somebody happened to visit first.
     *
     * New orgs are seeded with the whole catalogue at setup, and
     * `scripts/backfillOwnerPermissions.ts` tops up the ones created before
     * that. Neither happens here, while a request is being decided.
     */
    return { status: 403, body: { error: 'Permission denied', permission: { module: m, subModule: sm || null, action } } };
  }

  return null;
}

/**
 * Allowed when any one of these permissions is held — for a route several
 * screens share, like the payment modes a receipt, a bill payment and an
 * expense all offer (A-22). Refused with the first refusal that is not a plain
 * "permission denied" (an app not bought, no roles), else with the whole list.
 */
export async function authorizeAny(req: Request, options: Array<[string, PermissionActionType, string?]>): Promise<Refusal | null> {
  let other: Refusal | null = null;
  for (const [m, a, sm] of options) {
    const refusal = await authorize(req, m, a, sm);
    if (!refusal) return null;
    if (refusal.status !== 403 || !refusal.body.permission) other ??= refusal;
  }
  return (
    other || {
      status: 403,
      body: { error: 'Permission denied', anyOf: options.map(([module, action, subModule]) => ({ module, subModule: subModule || null, action })) },
    }
  );
}

export function requireAnyPermission(...options: Array<[string, PermissionActionType, string?]>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const refusal = await authorizeAny(req, options);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    next();
  };
}

export function requirePermission(module: string, action: PermissionActionType, subModule?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const refusal = await authorize(req, module, action, subModule);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    next();
  };
}

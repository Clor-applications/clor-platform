/**
 * The platform context: who is calling, and on behalf of which company.
 *
 * Every app needs this and no app should own it. Before the split, each API
 * client read `localStorage.getItem('activeOrgId')` for itself — fifteen files
 * in Payroll alone, each one reaching into a store that Accounting happened to
 * write. That is a shared secret, not a contract, and it is the reason a
 * company that bought only Payroll still needed Accounting to log in.
 *
 * Here the shell sets this once, and an app asks for it. The shape is
 * deliberately tiny: an app may read the tenant, and may not change it.
 * Switching company is a platform act, and an app that could do it silently
 * would be able to move a user's data between companies without the shell ever
 * knowing.
 */

let context = {
  /** The signed-in user, or null. Set by the shell. */
  user: null,
  /** The company being looked at — the `orgId` every API path is scoped by. */
  orgId: '',
  /** Optional narrowings some endpoints accept. */
  branchId: '',
  warehouseId: '',
};

const listeners = new Set();

/** Shell only. Apps read; they do not set. */
export function setPlatformContext(next) {
  context = { ...context, ...next };
  listeners.forEach((fn) => {
    try {
      fn(context);
    } catch {
      /* One bad listener must not stop the others. */
    }
  });
}

export const platformContext = () => context;

/*
 * The accessors an app actually uses. They fall back to localStorage so that a
 * screen opened outside the shell — a test, a storybook, the old app during
 * migration — still works rather than failing in a way that looks like a bug in
 * the screen.
 */
const stored = (key) => {
  try {
    return String(localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
};

export const orgId = () => context.orgId || stored('activeOrgId');
export const branchId = () => context.branchId || stored('activeBranchId') || stored('branchId');
export const warehouseId = () => context.warehouseId || stored('activeWarehouseId');
export const currentUser = () => context.user;

/** Ask the platform to tell you when the company changes. */
export function onPlatformContextChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

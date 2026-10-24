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
  /** The apps this company has switched on (e.g. a shared screen shows reader fields only with Attendance). */
  apps: [],
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

/*
 * Branch and warehouse: chosen per company, per tab (A-23).
 *
 * They lived in two browser-wide keys, `activeBranchId` and
 * `activeWarehouseId`, while the company was per tab. A second tab switching
 * company rewrote them, and this tab went on sending the other company's
 * warehouse in the header and in the body (POS, challans, orders, items,
 * imports) and numbering documents from the other company's branch series.
 *
 * Now each choice is kept under the company it belongs to, for this tab
 * (sessionStorage), with the same company's last choice in this browser
 * (localStorage) as the starting point for a new tab. Another tab — on this
 * company or another — cannot move this one. The server still checks every
 * branch and warehouse it is sent (A-24); this is about sending the right one.
 */
const selectionKey = (org, what) => `clor.sel.${org}.${what}`;
const readSelection = (what) => {
  const org = context.orgId;
  if (!org) return '';
  try {
    return String(sessionStorage.getItem(selectionKey(org, what)) || localStorage.getItem(selectionKey(org, what)) || '').trim();
  } catch {
    return '';
  }
};
const writeSelection = (what, id) => {
  const org = context.orgId;
  if (!org) return;
  const value = String(id || '').trim();
  try {
    if (value) {
      sessionStorage.setItem(selectionKey(org, what), value);
      localStorage.setItem(selectionKey(org, what), value);
    } else {
      sessionStorage.removeItem(selectionKey(org, what));
      localStorage.removeItem(selectionKey(org, what));
    }
  } catch {
    /* storage unavailable: the choice lasts as long as the screen's own state */
  }
  listeners.forEach((fn) => {
    try {
      fn(context);
    } catch {
      /* One bad listener must not stop the others. */
    }
  });
};

/** The branch this tab chose in this company, or '' when it has not chosen one. */
export const selectedBranchId = () => readSelection('branch');
/** The warehouse this tab chose in this company, or ''. */
export const selectedWarehouseId = () => readSelection('warehouse');
/** Choose this tab's branch in the current company ('' clears it). */
export const selectBranch = (id) => writeSelection('branch', id);
/** Choose this tab's warehouse in the current company ('' clears it). */
export const selectWarehouse = (id) => writeSelection('warehouse', id);

/** A browser-storage key for something remembered per company (A-28): `clor.<orgId>.<name>`. */
export const companyStorageKey = (name) => `clor.${context.orgId || stored('activeOrgId') || '-'}.${name}`;

/** The branch requests are sent for: this tab's choice, else the company's default for this person. */
export const branchId = () => selectedBranchId() || context.branchId;
export const warehouseId = () => context.warehouseId || selectedWarehouseId();
export const currentUser = () => context.user;
export const hasApp = (id) => (context.apps || []).includes(id);

/** Ask the platform to tell you when the company changes. */
export function onPlatformContextChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ask the platform to open another app — Workspace from Accounting's
 * settings, for one. An app cannot switch apps itself (it does not own the
 * shell), so it asks; the shell decides how (in place, or on that app's own
 * address).
 */
/**
 * Ask the shell to open a screen of the app already open (a breadcrumb, a
 * Back fallback). It goes the way a rail click goes, so the address and the
 * browser's back button behave the same.
 */
export const OPEN_SCREEN_EVENT = 'clor:open-screen';
export function requestOpenScreen(screen) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_SCREEN_EVENT, { detail: { screen } }));
  } catch {
    /* No window (a test): nothing to open. */
  }
}

export const OPEN_APP_EVENT = 'clor:open-app';
export function requestOpenApp(appId, screen = '', params = {}) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_APP_EVENT, { detail: { appId, screen, params } }));
  } catch {
    /* No window (a test): nothing to open. */
  }
}

/**
 * Ask the platform to switch company (A-27). Only the shell switches: it
 * owns the address, this tab's choice and which app is mounted. An app that
 * offers its own company menu asks here instead of keeping a second store.
 */
export const SWITCH_COMPANY_EVENT = 'clor:switch-company';
export function requestSwitchCompany(orgId) {
  try {
    window.dispatchEvent(new CustomEvent(SWITCH_COMPANY_EVENT, { detail: { orgId } }));
  } catch {
    /* No window (a test): nothing to switch. */
  }
}

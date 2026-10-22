/**
 * The apps Clor sells. The commercial twin of the shell's registry: the shell
 * decides what to render, this decides what may be bought and billed.
 *
 * Pricing is deliberately NOT here. What a plan costs and how it is metered
 * (free / per-seat / per-app / flat) is a decision that is not yet made, and it
 * belongs on the subscription item when it is, not hard-coded into the catalog.
 * This file answers only "which apps exist and can be subscribed to".
 */
export type AppDef = {
  code: string;
  name: string;
  blurb: string;
  /** False = planned/not sold as a cloud subscription yet. */
  available: boolean;
  /** Default tier when none is chosen (e.g. an accounting PLAN_CATALOG key). */
  defaultTier?: string;
  /**
   * The org feature flag that switches this app on for a company, if any.
   * Accounting has none: every company keeps books.
   */
  featureKey?: string;
};

export const APP_CATALOG: AppDef[] = [
  { code: 'accounting', name: 'Accounting', blurb: 'Invoicing, bills, inventory and the books.', available: true, defaultTier: 'FULL' },
  { code: 'payroll', name: 'Payroll', blurb: 'Pay runs, statutory, payslips.', available: true, featureKey: 'payroll' },
  // Native cloud attendance; ClorTime remains the separate on-premise biometric product.
  { code: 'attendance', name: 'Attendance', blurb: 'Shifts, clock in/out, late, overtime and payable days.', available: true, featureKey: 'attendance' },
  { code: 'people', name: 'People', blurb: 'The staff directory every app refers to.', available: true, featureKey: 'people' },
  { code: 'projects', name: 'Projects', blurb: 'Projects, time, and what each cost.', available: false },
];

export const APP_CODES = APP_CATALOG.map((a) => a.code);
export const appByCode = (code: string) => APP_CATALOG.find((a) => a.code === code) || null;
export const isSellableApp = (code: string) => Boolean(appByCode(code)?.available);
export const SELLABLE_APP_CODES = APP_CATALOG.filter((a) => a.available).map((a) => a.code);
/** The app a feature flag switches on, if that flag is an app switch. */
export const appForFeature = (featureKey: string) => APP_CATALOG.find((a) => a.featureKey === featureKey) || null;

/**
 * Which of an app's modules each tier carries (the subscription item's
 * `tier`). An app not listed, no tier, or a tier not listed carries all of
 * them: nothing is taken away until a tier is assigned. The tier names and
 * what each costs are the founder's to set; this is the switchboard, not the
 * price list.
 */
export const APP_TIER_MODULES: Record<string, Record<string, string[] | '*'>> = {
  people: {
    CORE: [],
    FULL: '*',
  },
};

export function tierAllows(appCode: string, tier: string | null | undefined, featureKey: string) {
  const app = appByCode(appCode);
  if (app?.featureKey === featureKey) return true;
  const allowed = tier ? APP_TIER_MODULES[appCode]?.[tier] : undefined;
  return allowed === undefined || allowed === '*' || allowed.includes(featureKey);
}

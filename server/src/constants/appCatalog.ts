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
  // Attendance is sold on-premise today (ClorTime), not as a cloud subscription.
  { code: 'attendance', name: 'Attendance', blurb: 'Biometric attendance on your own server.', available: false },
  { code: 'people', name: 'People', blurb: 'The staff directory every app refers to.', available: false },
  { code: 'projects', name: 'Projects', blurb: 'Projects, time, and what each cost.', available: false },
];

export const APP_CODES = APP_CATALOG.map((a) => a.code);
export const appByCode = (code: string) => APP_CATALOG.find((a) => a.code === code) || null;
export const isSellableApp = (code: string) => Boolean(appByCode(code)?.available);
export const SELLABLE_APP_CODES = APP_CATALOG.filter((a) => a.available).map((a) => a.code);
/** The app a feature flag switches on, if that flag is an app switch. */
export const appForFeature = (featureKey: string) => APP_CATALOG.find((a) => a.featureKey === featureKey) || null;

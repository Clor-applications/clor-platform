/** `MODULE::Resource::ACTION` — the wire format the server and /permissions/me use. */
export const permissionKey = (module, resource, action) => `${module}::${resource}::${action}`;

/** All wire keys a catalogue module's resources declare. */
export const moduleKeys = (mod) => mod.resources.flatMap((r) => r.actions.map((a) => permissionKey(mod.key, r.key, a)));

/** Every key in the catalogue, for filtering out grants the catalogue has retired. */
export const catalogKeys = (modules) => new Set((modules || []).flatMap(moduleKeys));

/** "Sales › Invoices: View", from the catalogue's own labels. */
export const permissionLabel = (modules, wireKey) => {
  const [m, r, a] = String(wireKey).split('::');
  const mod = (modules || []).find((x) => x.key === m);
  const res = mod?.resources.find((x) => x.key === r);
  const action = a ? a.charAt(0) + a.slice(1).toLowerCase() : '';
  return `${mod?.label || m} › ${res?.label || r}: ${action}`;
};

/**
 * Which app a catalogue module belongs to (ADR-010).
 *
 * One role editor serves every app, so a person managing Payroll's roles
 * should be able to look at Payroll's permissions alone, and a company should
 * not be shown sections for apps it does not use. SETTINGS is the company's
 * own: users, roles, the company profile — present whatever is bought.
 */
export const MODULE_APP = {
  SALES: 'accounting',
  PURCHASE: 'accounting',
  INVENTORY: 'accounting',
  ACCOUNTING: 'accounting',
  CASHBANK: 'accounting',
  EXPENSES: 'accounting',
  MASTERS: 'accounting',
  REPORTS: 'accounting',
  PEOPLE: 'people',
  ATTENDANCE: 'attendance',
  PAYROLL: 'payroll',
  SETTINGS: 'company',
};

/** The sections, in the order they are offered. */
export const PERMISSION_APPS = [
  { id: 'company', label: 'Company' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'people', label: 'People' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'payroll', label: 'Payroll' },
];

/** The app a module belongs to; a module the map does not know stays with the company, so nothing new is ever hidden. */
export const appOfModule = (moduleKey) => MODULE_APP[moduleKey] || 'company';


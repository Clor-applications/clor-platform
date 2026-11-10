/** `MODULE::Resource::ACTION` — the wire format the server and /permissions/me use. */
export const permissionKey = (module, resource, action) => `${module}::${resource}::${action}`;

/** All wire keys a catalogue module's resources declare. */
export const moduleKeys = (mod) => mod.resources.flatMap((r) => r.actions.map((a) => permissionKey(mod.key, r.key, a)));

/** Every key in the catalogue, for filtering out grants the catalogue has retired. */
export const catalogKeys = (modules) => new Set((modules || []).flatMap(moduleKeys));

/** "Sales › Invoices: View", from the catalogue's own labels (leave rights read "Time & Leave › …"). */
export const permissionLabel = (modules, wireKey) => {
  const [m, r, a] = String(wireKey).split('::');
  const shown = displayModules(modules);
  const mod = shown.find((x) => x.key === m && x.resources.some((y) => y.key === r)) || shown.find((x) => x.key === m);
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
  { id: 'accounting', label: 'Books' },
  { id: 'people', label: 'People' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'payroll', label: 'Payroll' },
];

/** The app a module belongs to; a module the map does not know stays with the company, so nothing new is ever hidden. */
export const appOfModule = (moduleKey) => MODULE_APP[moduleKey] || 'company';


/**
 * Leave, holidays and the employee app are one engine that People and
 * Attendance both open (docs/people/design-v1/TIME-LEAVE-DECISIONS.md, M1),
 * but their rights live in the ATTENDANCE module. A People-only company would
 * otherwise never see them, so they are shown as their own section.
 */
export const TIME_LEAVE_RESOURCES = ['Leave Requests', 'Leave Types', 'Holidays', 'My Attendance', 'Employee Portal', 'Attendance Requests'];

/** The apps a section answers to: Time & Leave to People or Attendance, the rest to their own. */
const opensIn = (app) => (app === 'time' ? ['people', 'attendance'] : [app]);

/**
 * The sections the editor draws. ATTENDANCE splits into Time & Leave and
 * Attendance; both halves keep `key: 'ATTENDANCE'`, because the key is part
 * of every wire key, and carry a `displayKey` that tells them apart on screen.
 */
export function displayModules(modules) {
  return (modules || []).flatMap((m) => {
    if (m.key !== 'ATTENDANCE') return [{ ...m, displayKey: m.displayKey || m.key, app: m.app || appOfModule(m.key) }];
    const shared = m.resources.filter((r) => TIME_LEAVE_RESOURCES.includes(r.key));
    const rest = m.resources.filter((r) => !TIME_LEAVE_RESOURCES.includes(r.key));
    return [
      shared.length ? { ...m, displayKey: 'ATTENDANCE:time', label: 'Time & Leave', app: 'time', resources: shared } : null,
      rest.length ? { ...m, displayKey: 'ATTENDANCE', label: 'Attendance', app: 'attendance', resources: rest } : null,
    ].filter(Boolean);
  });
}

/**
 * The sections for the apps this company is offered (ids), on one tab
 * ('all' or an app id). Filtering hides rows, never grants.
 */
export function visibleModules(modules, offeredIds, forApp = 'all') {
  const offered = new Set(offeredIds);
  return displayModules(modules).filter((m) => {
    if (m.app === 'company') return forApp === 'all' || forApp === 'company';
    const apps = opensIn(m.app).filter((a) => offered.has(a));
    return apps.length > 0 && (forApp === 'all' || apps.includes(forApp));
  });
}

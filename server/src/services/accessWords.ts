import { appsForModule } from '../middleware/rbac.js';

/**
 * What a set of permissions lets a person do, in words (Workspace › Members,
 * one person's access). The page showed role names and a count of permissions;
 * an owner deciding whether somebody has too much, or what to hand over, needs
 * "changes Invoices and Payments, approves Leave", not "41 permissions".
 *
 * Read from the same permission keys every request is checked against
 * (MODULE::Area::ACTION, resolveAccess), so the words cannot promise more or
 * less than the server allows. Pure: no database.
 */
export type AccessWords = { app: string; label: string; lines: string[] };

const APP_LABEL: Record<string, string> = { accounting: 'Books', people: 'People', attendance: 'Attendance', payroll: 'Payroll', company: 'Company settings' };
const APP_ORDER = ['accounting', 'people', 'attendance', 'payroll', 'company'];
const MODULE_NAME: Record<string, string> = {
  SALES: 'Sales', PURCHASE: 'Purchases', INVENTORY: 'Inventory', ACCOUNTING: 'Accounting', CASHBANK: 'Cash and bank', EXPENSES: 'Expenses',
  MASTERS: 'Masters', SETTINGS: 'Settings', REPORTS: 'Reports', PEOPLE: 'People', ATTENDANCE: 'Attendance', PAYROLL: 'Payroll',
};
const SHOWN = 6;

/** "A, B and C", or the first six "and 4 more". */
function list(names: string[]): string {
  const all = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const head = all.slice(0, SHOWN);
  const rest = all.length - head.length;
  if (rest > 0) return `${head.join(', ')} and ${rest} more`;
  return head.length > 1 ? `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}` : head[0] || '';
}

export function accessInWords(permissions: Iterable<string>, isAdmin = false): AccessWords[] {
  if (isAdmin) return [{ app: 'all', label: 'Everything', lines: ['Every app this company has, with its settings, users and roles.'] }];
  /* app -> area -> the actions held on it */
  const byApp = new Map<string, Map<string, Set<string>>>();
  for (const key of permissions) {
    const [mod, sub, action] = String(key).split('::');
    if (!mod || !action) continue;
    /* A module two apps open (Attendance's, and the part of People Attendance needs) is said once, under the first. */
    const app = (mod === 'ATTENDANCE' ? ['attendance'] : appsForModule(mod, sub))?.[0] || 'company';
    const area = sub || MODULE_NAME[mod] || mod;
    const areas = byApp.get(app) || new Map<string, Set<string>>();
    areas.set(area, (areas.get(area) || new Set()).add(action));
    byApp.set(app, areas);
  }
  const out: AccessWords[] = [];
  for (const app of [...byApp.keys()].sort((a, b) => APP_ORDER.indexOf(a) - APP_ORDER.indexOf(b))) {
    const areas = [...byApp.get(app)!.entries()];
    const having = (...actions: string[]) => areas.filter(([, held]) => actions.some((a) => held.has(a))).map(([name]) => name);
    const changes = having('CREATE', 'EDIT');
    const changed = new Set(changes);
    const viewsOnly = areas.filter(([name, held]) => !changed.has(name) && held.has('VIEW')).map(([name]) => name);
    const lines = [
      changes.length ? `Adds and changes ${list(changes)}` : '',
      viewsOnly.length ? `Only looks at ${list(viewsOnly)}` : '',
      having('APPROVE').length ? `Approves ${list(having('APPROVE'))}` : '',
      having('DELETE').length ? `Deletes ${list(having('DELETE'))}` : '',
      having('EXPORT').length ? `Exports ${list(having('EXPORT'))}` : '',
    ].filter(Boolean);
    if (lines.length) out.push({ app, label: APP_LABEL[app] || app, lines });
  }
  return out;
}

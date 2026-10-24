import {
  BadgePercent,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  Coins,
  FileStack,
  FileText,
  Landmark,
  Layers,
  NotebookPen,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  Shield,
  ShoppingCart,
  Tags,
  HardDriveDownload,
  Repeat,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Every setting this product has, written down once.
 *
 * Settings was a rail group of thirty-four entries under nine headings: open
 * it and the sidebar became something you scrolled rather than read, and every
 * other module was pushed off the screen while you looked for one switch.
 *
 * The fix is not a shorter list — nothing here is redundant — it is a place of
 * its own. This registry is what that place is built from: the hub's cards and
 * their counts, the local navigation inside a category, the breadcrumb over a
 * page, and the search that finds a setting by what somebody would call it.
 * Five lists that would have drifted apart, kept as one.
 *
 * `key` is the screen key the application already routes on. Nothing here
 * invents a route: every entry points at a screen that exists today, so a link
 * from anywhere else in the product still lands where it always did.
 */

export const SETTINGS_CATEGORIES = [
  {
    id: 'organisation',
    title: 'Organisation',
    icon: Building2,
    description: 'Company information, locations and financial periods.',
  },
  {
    /* CLOR platform: the plan, its billing and the POS tender accounts. */
    id: 'finance',
    title: 'Finance & Accounting',
    icon: Landmark,
    description: 'Accounting rules, payments and the money controls.',
  },
  {
    id: 'tax',
    title: 'Tax & Compliance',
    icon: BadgePercent,
    description: 'GST registration, rates and what the returns read.',
  },
  {
    id: 'usersRoles',
    title: 'User & Roles',
    icon: Users,
    description: 'People who can sign in and the roles assigned to them.',
  },
  {
    id: 'security',
    title: 'Security',
    icon: Shield,
    description: 'Permissions, approvals, login controls and audit history.',
  },
  {
    id: 'platform',
    title: 'Platform & Communication',
    icon: Settings,
    description: 'Email, documents, templates and the data you bring in.',
  },
];

/**
 * The settings themselves.
 *
 * `group` is the small heading a category's local navigation shows when it
 * holds enough entries to need one. `keywords` are the words somebody would
 * actually type — "tds" for the tax page, "password" for login — because a
 * search that only matches the title finds nothing the title does not say.
 */
export const SETTINGS_ITEMS = [
  // Organisation
  { key: 'settingsCompany', title: 'Company Profile', category: 'organisation', icon: Building2, perm: 'SETTINGS::Company Profile::VIEW', description: 'Name, GSTIN, address and the state your supplies are made from.', keywords: ['gstin', 'address', 'pan', 'logo', 'state', 'legal name'] },
  { key: 'settingsWarehouses', title: 'Warehouses', category: 'organisation', icon: Package, perm: 'MASTERS::Company/Branch setup::VIEW', description: 'Where stock is held, and which branch each store belongs to.', keywords: ['godown', 'store', 'stock location'] },
  { key: 'yearEndClose', title: 'Financial Year', category: 'organisation', icon: Settings, perm: 'ACCOUNTING::Ledger::VIEW', description: 'The year the books run on, and closing a period against further entries.', keywords: ['fy', 'year end', 'close', 'lock', 'period'] },
  { key: 'settingsCurrencies', title: 'Currency', category: 'organisation', icon: Coins, perm: 'ACCOUNTING::Ledger::VIEW', feature: 'multiCurrency', description: 'The currencies you bill in and the rates they convert at.', keywords: ['forex', 'exchange rate', 'multi currency'] },

  // Document and module controls live with the other platform settings.
  { key: 'settingsModules', title: 'Modules', category: 'platform', icon: Boxes, perm: 'SETTINGS::Company Profile::VIEW', group: 'System', description: 'Which parts of the product this company uses.', keywords: ['features', 'turn on', 'enable', 'switch off'] },
  { key: 'settingsInvoiceFields', title: 'Invoice Settings', category: 'platform', icon: FileText, perm: 'SETTINGS::Company Profile::VIEW', group: 'Documents', description: 'Which fields an invoice asks for, and what prints on it.', keywords: ['invoice fields', 'numbering', 'declaration', 'e-invoice'] },
  { key: 'settingsCustomFields', title: 'Custom Fields', category: 'platform', icon: Plus, perm: 'SETTINGS::Company Profile::VIEW', group: 'Documents', description: 'Your own fields on a document, and where they appear.', keywords: ['extra fields', 'reference', 'udf'] },
  { key: 'discountRules', title: 'Discount Rules', category: 'platform', icon: Tags, perm: 'SALES::Invoices::VIEW', feature: 'discountRules', group: 'Documents', description: 'Standing discounts and who they apply to.', keywords: ['discount', 'scheme', 'offer'] },
  { key: 'recurringInvoices', standalone: true, title: 'Recurring Invoices', category: 'platform', icon: RefreshCw, perm: 'SALES::Invoices::VIEW', feature: 'recurringInvoices', group: 'Automation', description: 'Schedules that raise their own invoices — rent, AMC, retainers.', keywords: ['schedule', 'repeat', 'subscription', 'amc'] },

  // Finance & accounting
  { key: 'settingsPosAccounts', title: 'POS Payment Accounts', category: 'finance', icon: Receipt, perm: 'SETTINGS::Company Profile::VIEW', group: 'Point of sale', description: 'Where the counter posts cash, UPI and card takings.', keywords: ['pos', 'tender', 'cash', 'upi', 'card', 'till', 'counter'] },

  // Tax & compliance
  { key: 'settingsTax', title: 'GST', category: 'tax', icon: BadgePercent, perm: 'SETTINGS::Tax Settings::VIEW', description: 'Registration type, filing frequency and what the returns read.', keywords: ['gstin', 'composition', 'gstr', 'filing', 'reverse charge'] },
  { key: 'settingsTds', title: 'TDS', category: 'tax', icon: BadgePercent, perm: 'SETTINGS::Tax Settings::VIEW', description: 'Deductor profile, natures and rules, ledger mapping and party defaults.', keywords: ['tds', 'tan', 'deduction', 'challan', '194', 'deductor', 'nature'] },
  { key: 'gstRates', standalone: true, title: 'Tax Rates', category: 'tax', icon: BadgePercent, perm: 'MASTERS::GST Rates::VIEW', description: 'The rates items can carry, and which is the default.', keywords: ['gst rate', 'hsn', 'cess', 'slab'] },

  // User & Roles
  /*
   * Users, roles, permissions, sign-in, SSO, the audit trail, branches, the
   * plan and billing are the company's, not Accounting's: they live in Company
   * admin, one workspace for every app (ADR-010). One entry here leads there,
   * and the old keys still route (App.jsx) so links and bookmarks land.
   */
  { key: 'accountingRoles', title: 'Roles & Access', category: 'usersRoles', icon: Users, perm: 'SETTINGS::Roles::VIEW', description: 'What each role may do in Accounting — opens Workspace on Accounting\u2019s permissions.', keywords: ['roles', 'permissions', 'rights', 'access', 'rbac'] },
  { key: 'companyAdmin', title: 'Users, roles & security', category: 'usersRoles', icon: Users, perm: 'SETTINGS::Users::VIEW', description: 'In Workspace: people, roles, permissions, sign-in, branches, audit and billing — shared by every app.', keywords: ['users', 'roles', 'permissions', 'password', '2fa', 'sso', 'audit', 'branches', 'billing', 'plan', 'company admin', 'workspace'] },

  // Security
  { key: 'settingsGovernance', title: 'Approval Workflows', category: 'security', icon: Shield, perm: 'SETTINGS::Roles::VIEW', description: 'What needs a second pair of eyes before it is posted.', keywords: ['approval', 'limit', 'maker checker', 'workflow'] },

  // Platform & communication
  { key: 'settingsEmail', title: 'Email', category: 'platform', icon: NotebookPen, perm: 'SETTINGS::Company Profile::VIEW', feature: 'notifications', group: 'Communication', description: 'The address documents are sent from, and what they say.', keywords: ['smtp', 'send', 'mail', 'from address'] },
  { key: 'paymentReminders', standalone: true, title: 'Payment Reminders', category: 'platform', icon: Bell, perm: 'SALES::Receipts::VIEW', feature: 'paymentReminders', group: 'Communication', description: 'When a customer is chased for an overdue invoice.', keywords: ['reminder', 'dunning', 'chase', 'overdue'] },
  { key: 'invoiceTemplates', standalone: true, title: 'Invoice Templates', category: 'platform', icon: FileText, perm: 'SETTINGS::Document Templates::VIEW', group: 'Documents', description: 'What a printed document looks like.', keywords: ['template', 'print', 'layout', 'letterhead'] },
  { key: 'docNumbering', title: 'Numbering', category: 'platform', icon: Settings, perm: 'SETTINGS::Document Numbering::VIEW', group: 'Documents', description: 'The prefix and next number for every kind of document.', keywords: ['prefix', 'series', 'sequence', 'next number'] },
  /*
   * Backup was written, wired to a screen, and never put here — so there was no
   * route to it from anywhere in the product. A company's own data, and the
   * only way out of it, reachable by nobody.
   */
  { key: 'dataImport', standalone: true, title: 'Data & Import', category: 'platform', icon: Upload, perm: 'ACCOUNTING::Ledger::VIEW', feature: 'imports', group: 'System', description: 'Bring journals, invoices and bills in from a file.', keywords: ['import', 'csv', 'migrate', 'template', 'upload'] },
  /*
   * Payroll's settings are Payroll's.
   *
   * These five entries pointed at screens that live in the Payroll
   * application now — salary components, pay groups, periods, ledger mapping
   * and the statutory rates. A settings hub that offers a screen this app
   * does not render is a hub that opens onto nothing, which is what the
   * registry test found the moment the two applications were separated.
   */
];

/**
 * Every settings screen key, for deciding whether a screen belongs in here.
 *
 * `standalone` items are the exception: they are listed and searched here
 * because this is where people look for them, but they are whole screens, not
 * settings panels. Recurring Invoices is a document list with its own title,
 * toolbar, summary tiles and table; Templates and Import are errands with
 * their own way back. Framing one of those in the settings chrome gave it two
 * titles, two ways back, and a table squeezed into the column left over beside
 * the settings nav. They open at full width instead.
 */
export const SETTINGS_KEYS = new Set(SETTINGS_ITEMS.map((i) => i.key));

/* These screens remain valid direct routes, but no longer belong in the
   Settings catalogue. Their masters live in the application areas that own
   them, avoiding duplicate navigation and duplicate settings groups. */
const HIDDEN_FROM_SETTINGS = new Set([
  'gstRates',
  ...SETTINGS_ITEMS.filter((item) => item.category === 'platform').map((item) => item.key),
]);

const FRAMED_KEYS = new Set(SETTINGS_ITEMS.filter((i) => !i.standalone).map((i) => i.key));

export const isSettingsKey = (key) => FRAMED_KEYS.has(String(key || ''));

/**
 * Whether a screen key is somewhere in Settings — framed or standalone.
 *
 * `isSettingsKey` answers a narrower question: does this one get the settings
 * chrome. Anything that needs to know "is the user off on a settings errand",
 * such as whether to keep a half-written document open behind them, wants
 * both halves.
 */
export const isSettingsRoute = (key) => {
  const want = String(key || '');
  return isSettingsKey(want) || SETTINGS_KEYS.has(want);
};

/**
 * Resolve the destination of a Back control owned by a Settings screen.
 *
 * Settings can be opened as an errand from a document list, in which case the
 * list is the useful return destination. Reports and other settings screens
 * are not document origins; returning to either made Back appear to jump to a
 * different module. Those routes return to the Settings menu instead.
 */
export const settingsBackTarget = (previous, fallback = 'settings') => {
  const target = String(previous || '').trim();
  if (!target || target === 'reports' || isSettingsRoute(target)) return fallback;
  return target;
};

export const settingFor = (key) => SETTINGS_ITEMS.find((i) => i.key === String(key || '')) || null;

export const categoryFor = (id) => SETTINGS_CATEGORIES.find((c) => c.id === String(id || '')) || null;

/**
 * What this person may actually open.
 *
 * The same two tests the rail already applies — the permission and the feature
 * flag — so a category cannot advertise four settings and open onto one, and
 * nothing appears here that the sidebar would have hidden.
 */
export const visibleSettings = ({ can, isEnabled }) =>
  SETTINGS_ITEMS.filter(
    (item) => !HIDDEN_FROM_SETTINGS.has(item.key) && (!item.perm || !can || can(item.perm)) && (!item.feature || !isEnabled || isEnabled(item.feature))
  );

/** Categories that still hold something, with their settings and a count. */
export const visibleCategories = ({ can, isEnabled }) => {
  const items = visibleSettings({ can, isEnabled });
  return SETTINGS_CATEGORIES.map((category) => ({
    ...category,
    items: items.filter((i) => i.category === category.id),
  })).filter((c) => c.items.length > 0);
};

/**
 * A category's local navigation, in groups.
 *
 * A category with three entries does not need headings over them; one with
 * eight does, or it is the long rail again in a narrower column.
 */
export const groupedForCategory = (categoryId, { can, isEnabled }) => {
  const items = visibleSettings({ can, isEnabled }).filter((i) => i.category === categoryId);
  /*
   * Grouped by the group's name, wherever its members sit in the registry.
   *
   * This used to merge only ADJACENT items, so a group whose members were
   * separated by one entry from another group came out twice — Finance showed
   * "Your account" above Account Overview and again above Billing, with Point
   * of sale between them, and React reported the duplicate key on every
   * visit. A group is its name; an entry belongs to it from wherever it is
   * declared, in the order its first member appears.
   */
  const groups = [];
  const byName = new Map();
  for (const item of items) {
    const name = item.group || '';
    let group = byName.get(name);
    if (!group) {
      group = { name, items: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  // One heading over the whole list says nothing the page title has not said.
  if (groups.length === 1) return [{ name: '', items: groups[0].items }];
  return groups;
};

/**
 * Search, over what somebody would type rather than what the title says.
 *
 * "password" finds Login & Security, "tds" finds Payments, "gstin" finds both
 * the company profile and the GST page — because each entry carries the words
 * people use for it alongside its own name.
 */
export const searchSettings = (query, { can, isEnabled } = {}) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const item of visibleSettings({ can, isEnabled })) {
    const title = item.title.toLowerCase();
    const words = [title, item.description.toLowerCase(), ...(item.keywords || [])].join(' ');
    if (!words.includes(q)) continue;

    // Title first, then a word that starts with it, then anything containing it.
    const rank = title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : 3;
    scored.push({ rank, item });
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title))
    .map((s) => s.item);
};

/** `Settings / User & Roles / Roles`, as clickable parts. */
export const breadcrumbFor = (key) => {
  const item = settingFor(key);
  const crumbs = [{ label: 'Settings', target: 'settings' }];
  if (!item) return crumbs;
  const category = categoryFor(item.category);
  if (category) crumbs.push({ label: category.title, target: `category:${category.id}` });
  crumbs.push({ label: item.title, target: null });
  return crumbs;
};

/**
 * The handful worth a shortcut at the top of the hub.
 *
 * Fixed rather than guessed: nothing in the product records which settings a
 * person opens, and a "frequently used" row that is really a hardcoded four
 * should at least be the four a new company actually needs first.
 */
export const FREQUENT_SETTINGS = ['settingsCompany', 'settingsTax', 'settingsUsers', 'settingsInvoiceFields'];

export default SETTINGS_ITEMS;

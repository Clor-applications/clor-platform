/**
 * The feature catalog: every optional capability, and whether it is on.
 *
 * Standing rule for this product — anything we add must be switchable per
 * organisation from Settings. A single shop should not have to look at branch
 * and warehouse fields it will never use; a distributor should.
 *
 * Adding a feature means adding one row here. The API serves this list, the
 * Settings screen renders from it, and both the server and the client gate on
 * the same keys, so there is no second list to keep in step.
 */

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
  /** Value for an organisation that has never touched the setting. */
  defaultEnabled: boolean;
  category: 'Operations' | 'Accounting' | 'Inventory' | 'Governance' | 'Communication' | 'Data' | 'Payroll';
  /** Turning the parent off forces these off too. */
  dependsOn?: string;
  /** Not switchable — listed so the screen can show why. */
  locked?: boolean;
  lockedReason?: string;
};

export const FEATURE_CATALOG: FeatureDef[] = [
  // ---- Operations -------------------------------------------------------
  {
    key: 'branches',
    label: 'Branches',
    description:
      'Run more than one location under this company. When off, branch fields are hidden and everything posts to the head office.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'warehouses',
    label: 'Warehouses',
    description:
      'Track stock by warehouse within a branch. When off, the warehouse field disappears from invoicing and inventory.',
    defaultEnabled: true,
    category: 'Operations',
    dependsOn: 'inventory',
  },
  {
    key: 'estimates',
    label: 'Estimates and quotes',
    description: 'Raise a quotation before the invoice.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'creditNotes',
    label: 'Credit notes and sales returns',
    description: 'Issue credit against a sales invoice.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'purchaseOrders',
    label: 'Purchase orders',
    description: 'Raise a PO before the vendor bill.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'debitNotes',
    label: 'Debit notes and purchase returns',
    description: 'Issue debit against a vendor bill.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'pos',
    label: 'Point of sale',
    description: 'Counter-sale screen: tap items, take payment, invoice books itself.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'deliveryChallans',
    label: 'Delivery challans',
    description: 'Goods out without an invoice — job work, approval, own use.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'priceLists',
    label: 'Price lists',
    description: 'Rate cards per customer segment — Retail, Wholesale, key accounts.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    /*
     * Some books identify a customer by a code and some only ever by name.
     * Off, the field is not asked for and nothing is allotted — a code nobody
     * uses is still a column somebody has to explain.
     */
    key: 'partyCodes',
    label: 'Customer and vendor codes',
    description: 'Allot a code to each customer and vendor, in a format you set.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'salesmen',
    label: 'Salesman tracking',
    description: 'Map invoices to salesmen and compute commission.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'salesOrders',
    label: 'Sales orders',
    description: 'Confirmed orders between quote and invoice, with delivered/billed tracking.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'batchExpiry',
    /*
     * NOT dependent on batchSerial — yet.
     *
     * Expiry is a property of a batch, so the dependency is right in
     * principle, and it was added here once. It is backed out because one
     * live organisation is in exactly the state it would forbid:
     * `cmthj0b3v000avnsd50hkmtt5` has batchExpiry on and batchSerial off.
     *
     * `dependsOn` is enforced on the client only — the server never reads it —
     * so declaring it would not have rewritten that row. It would have done
     * something quieter and worse: the screen would show Expiry as No while
     * the stored value stayed Yes, and the next save would write Yes back.
     *
     * Restore this line together with a migration that decides what that
     * organisation's batch history means.
     */
    label: 'Batch stock & expiry',
    description: 'Batch/expiry tracking on items, FEFO picking, and the Batch Stock & Expiry view.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'reorderAlerts',
    label: 'Reorder alerts',
    description: 'Low-stock alerts against per-item reorder levels.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'paymentReminders',
    label: 'Payment reminders',
    description: 'Due → +7 → +15 collection schedule with WhatsApp/email deep links.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'discountRules',
    label: 'Discount rules',
    description: 'Quantity breaks, customer specials, category and promotional discounts, auto-applied.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Record expenses separately from vendor bills.',
    defaultEnabled: true,
    category: 'Operations',
  },

  // ---- Accounting -------------------------------------------------------
  {
    key: 'ledger',
    label: 'General ledger',
    description: 'Double-entry posting behind every document. Reports read from it.',
    defaultEnabled: true,
    category: 'Accounting',
    locked: true,
    lockedReason: 'The books cannot be switched off',
  },
  {
    key: 'bankReconciliation',
    label: 'Bank and cash reconciliation',
    description:
      'Adds a reconcile screen and a bank-date column. Receipt and payment entry is unaffected: the voucher stays the single record either way.',
    defaultEnabled: false,
    category: 'Accounting',
  },
  {
    key: 'standaloneReceiptsPayments',
    label: 'Separate Receipt and Payment screens',
    description:
      'On: money in and money out are entered on their own screens. Off: they are entered inside the bank and cash book instead, which suits a business that works from its bank statement. The record written is the same either way, so nothing is entered twice.',
    defaultEnabled: true,
    category: 'Accounting',
  },
  {
    key: 'paymentTerms',
    label: 'Payment terms and automatic due dates',
    description:
      "Give each customer and vendor a credit period, and set a document's due date from it. When off, the due date stays a plain field the operator fills in.",
    defaultEnabled: true,
    category: 'Accounting',
  },
  {
    key: 'periodLock',
    label: 'Period lock',
    description: 'Close a period so nothing can post into it after the fact.',
    defaultEnabled: true,
    category: 'Accounting',
  },
  {
    key: 'multiCurrency',
    label: 'Multi-currency',
    description: 'Invoice in a currency other than INR, with exchange rates and revaluation.',
    defaultEnabled: false,
    category: 'Accounting',
  },

  // ---- Inventory --------------------------------------------------------
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Track stock quantities. Turn off for a services-only business.',
    defaultEnabled: true,
    category: 'Inventory',
  },
  {
    key: 'stockTransfers',
    label: 'Stock and inter-branch transfers',
    description: 'Move stock between warehouses and branches.',
    defaultEnabled: true,
    category: 'Inventory',
    dependsOn: 'inventory',
  },
  {
    key: 'batchSerial',
    label: 'Batch and serial numbers',
    description: 'Track batches with expiry, or individual serial numbers, on stock items.',
    defaultEnabled: false,
    category: 'Inventory',
    dependsOn: 'inventory',
  },

  // ---- Governance -------------------------------------------------------
  {
    key: 'roleProfiles',
    label: 'Role profiles',
    description: 'Bundle several roles and assign them as one.',
    defaultEnabled: true,
    category: 'Governance',
  },
  {
    key: 'fieldPermissions',
    label: 'Field-level permissions',
    description: 'Restrict individual fields, such as discount or amount paid, by role.',
    defaultEnabled: false,
    category: 'Governance',
  },
  {
    key: 'approvals',
    label: 'Approval thresholds',
    description: 'Hold documents above an amount until someone with the approving role signs off.',
    defaultEnabled: false,
    category: 'Governance',
  },
  {
    key: 'userPermissions',
    label: 'Document restrictions',
    description: 'Limit a user to certain customers, vendors or cost centres.',
    defaultEnabled: false,
    category: 'Governance',
  },

  // ---- Communication ----------------------------------------------------
  {
    key: 'emailVerification',
    label: 'Email verification',
    description:
      'Send a confirmation link when someone signs up, and show a reminder until the address is confirmed.',
    defaultEnabled: true,
    category: 'Communication',
  },
  {
    key: 'notifications',
    label: 'Email notifications',
    description:
      'Approval requests, decisions and reminders by email. Sign-in and password mail is always sent regardless.',
    defaultEnabled: true,
    category: 'Communication',
  },
  {
    key: 'customSmtp',
    label: 'Own mail server',
    description: 'Send from your own SMTP server and address instead of the platform default.',
    defaultEnabled: false,
    category: 'Communication',
    dependsOn: 'notifications',
  },

  // ---- Data -------------------------------------------------------------
  {
    key: 'companyGroups',
    label: 'Company groups',
    description:
      'Keep several companies in one workspace with parent\u2013child structure: a Companies page to view the group, switch the active company, and add subsidiaries.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    key: 'einvoice',
    label: 'e-Invoice and e-Way Bill JSON',
    description:
      'Download NIC-schema JSON per invoice for the e-invoice and e-way bill portals\u2019 bulk tools. Direct IRP submission needs GSP credentials and is not included yet.',
    defaultEnabled: false,
    category: 'Operations',
  },
  {
    key: 'recurringInvoices',
    label: 'Recurring invoices',
    description:
      'Mark an invoice as repeating monthly. On sign-in, invoices that have come due are raised as drafts for review — nothing posts until you approve each one.',
    defaultEnabled: true,
    category: 'Operations',
  },
  {
    /*
     * Cost centres already have a screen and a field on every expense and
     * journal line; what they never had was a switch, so a company that does
     * not use them was asked for one anyway. On by default, because the books
     * of anyone already tagging costs must not change under them.
     */
    key: 'costCenters',
    label: 'Cost centres',
    description:
      'Tag expenses and journal lines to a department, project or site, and read the ledger back by any of them. A single-location business can leave this off and stop being asked.',
    defaultEnabled: true,
    category: 'Accounting',
  },
  {
    key: 'insights',
    label: 'Dashboard insights',
    description:
      'A card of observations computed directly from your books — receivable concentration, collection-rate movement, spend spikes. Nothing predictive, nothing invented.',
    defaultEnabled: true,
    category: 'Data',
  },
  {
    key: 'gridTools',
    label: 'Power grid tools',
    description:
      'Saved views, column show/hide, bulk actions and a row preview drawer on the big list pages. When off, lists stay plain tables.',
    defaultEnabled: true,
    category: 'Data',
  },
  {
    key: 'imports',
    label: 'Data import',
    description:
      'Import journal entries and sales invoices from a CSV file, with a downloadable template. Files are staged and validated first, so you see every problem before anything is written.',
    defaultEnabled: false,
    category: 'Data',
  },

  // ---- Payroll ----------------------------------------------------------
  /*
   * Payroll is off until somebody turns it on, and its parts are switchable
   * separately because a company can run salaries without running PF, and can
   * run PF without lending anybody money. Everything below depends on
   * `payroll`, so one switch takes the whole module away.
   */
  {
    key: 'payroll',
    label: 'Payroll',
    description:
      'Pay salaries from Clor: salary structures, a monthly pay run you can check before you approve it, payslips, and the journal it posts to your books.',
    defaultEnabled: false,
    category: 'Payroll',
  },
  {
    key: 'payrollCompensation',
    label: 'Salary structures and revisions',
    description:
      'Reusable salary templates, dated assignments, and raises that show their cost before anyone approves them. Without this, payroll pays a flat amount per person.',
    defaultEnabled: true,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollAdjustments',
    label: 'Payroll adjustments',
    description: 'One-off amounts for a single period — a bonus, an arrear, a recovery, a correction.',
    defaultEnabled: true,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollLoans',
    label: 'Loans and salary advances',
    description: 'Money lent to staff, recovered over a set number of instalments straight from pay.',
    defaultEnabled: false,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollPf',
    label: 'Provident Fund',
    description: 'Employee and employer PF, EPS and EDLI, computed from versioned rates so old payslips never change.',
    defaultEnabled: false,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollEsi',
    label: 'Employee State Insurance',
    description: 'ESI on eligible wages, with the threshold and rates kept as dated rules rather than one editable number.',
    defaultEnabled: false,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollProfessionalTax',
    label: 'Professional Tax',
    description: 'State slabs for professional tax. Each state keeps its own, so a business in two states deducts each correctly.',
    defaultEnabled: false,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollTds',
    label: 'Salary TDS',
    description: 'Projected annual tax spread over the remaining months, under the regime each employee has chosen.',
    defaultEnabled: false,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollPayments',
    label: 'Salary payments',
    description: 'Bank advice, a payment file to upload, and marking who was actually paid — including the ones that failed.',
    defaultEnabled: true,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollAccounting',
    label: 'Post payroll to the ledger',
    description:
      'Show finance the exact journal before it is written, then post it. No export and re-import to get salaries into the books.',
    defaultEnabled: true,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
  {
    key: 'payrollReports',
    label: 'Payroll reports',
    description: 'Salary register, component summaries, cost by branch and cost centre, and the statutory summaries.',
    defaultEnabled: true,
    category: 'Payroll',
    dependsOn: 'payroll',
  },
];

export const FEATURE_BY_KEY = new Map(FEATURE_CATALOG.map((f) => [f.key, f]));

export const isKnownFeature = (key: string) => FEATURE_BY_KEY.has(key);

/**
 * Applies stored overrides on top of the defaults, then resolves dependencies:
 * a feature whose parent is off is off regardless of its own setting.
 */
export function resolveFeatures(overrides: Record<string, boolean>) {
  const resolved: Record<string, boolean> = {};

  for (const f of FEATURE_CATALOG) {
    if (f.locked) {
      resolved[f.key] = true;
      continue;
    }
    resolved[f.key] = Object.prototype.hasOwnProperty.call(overrides, f.key)
      ? Boolean(overrides[f.key])
      : f.defaultEnabled;
  }

  // One pass is enough: the catalog is only one level deep. Guard anyway so a
  // future grandchild does not silently stay on.
  for (let i = 0; i < 3; i += 1) {
    let changed = false;
    for (const f of FEATURE_CATALOG) {
      if (!f.dependsOn) continue;
      if (resolved[f.key] && resolved[f.dependsOn] === false) {
        resolved[f.key] = false;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return resolved;
}

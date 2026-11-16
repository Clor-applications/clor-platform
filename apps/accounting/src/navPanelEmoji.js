/* Books' second sidebar (the screens panel beside the rail) wears the same Fluent Emoji (flat)
 * family as the rail (owner, 16 Nov 2026). One picture per screen, keyed by the screen's key so
 * the same screen shows the same picture wherever it is listed (a menu group, Settings, Master
 * data, the command palette). A key missing here falls back to the item's own icon.
 * New names need `node scripts/build-emoji-icons.mjs`. */
import { emoji } from '@ui/components/ui/emoji';

export const PANEL_EMOJI = {
  /* Sales */
  sales: emoji('chart-increasing'),
  customers: emoji('busts-in-silhouette'),
  invoices: emoji('page-facing-up'),
  pos: emoji('credit-card'),
  receipts: emoji('receipt'),
  estimates: emoji('memo'),
  salesOrders: emoji('clipboard'),
  deliveryChallans: emoji('delivery-truck'),
  creditNotes: emoji('right-arrow-curving-left'),
  recurringInvoices: emoji('repeat-button'),
  salesmen: emoji('man-office-worker'),
  /* Purchases */
  purchaseOverview: emoji('bar-chart'),
  vendors: emoji('factory'),
  bills: emoji('page-with-curl'),
  expenses: emoji('purse'),
  payments: emoji('money-with-wings'),
  purchaseOrders: emoji('shopping-cart'),
  debitNotes: emoji('left-arrow-curving-right'),
  /* Cash & bank */
  bankCashAccounts: emoji('bank'),
  cashBank: emoji('left-right-arrow'),
  bankReco: emoji('balance-scale'),
  /* Inventory */
  inventory: emoji('package'),
  warehouseTransfers: emoji('articulated-lorry'),
  branchTransfers: emoji('pickup-truck'),
  batchSerial: emoji('bookmark-tabs'),
  stockAdjustments: emoji('hammer-and-wrench'),
  batchStock: emoji('hourglass-not-done'),
  reorderAlerts: emoji('warning'),
  /* Approvals */
  approvalsOverview: emoji('clipboard'),
  approvals: emoji('check-mark-button'),
  approvalsRequests: emoji('outbox-tray'),
  approvalsAll: emoji('inbox-tray'),
  settingsGovernance: emoji('shuffle-tracks-button'),
  approvalSettings: emoji('control-knobs'),
  approvalsHistory: emoji('scroll'),
  /* Taxes */
  gstCompliance: emoji('classical-building'),
  tds: emoji('scissors'),
  msmeCompliance: emoji('factory'),
  /* Master data */
  companies: emoji('office-building'),
  items: emoji('label'),
  itemCategories: emoji('card-index-dividers'),
  uoms: emoji('straight-ruler'),
  priceLists: emoji('bookmark'),
  bankCash: emoji('books'),
  gstRates: emoji('input-numbers'),
  tdsRates: emoji('abacus'),
  tcsRates: emoji('coin'),
  invoiceTemplates: emoji('artist-palette'),
  docNumbering: emoji('keycap-hashtag'),
  codeNumbering: emoji('keycap-hashtag'),
  settingsTerms: emoji('scroll'),
  /* Settings */
  settingsCompany: emoji('office-building'),
  settingsWarehouses: emoji('convenience-store'),
  yearEndClose: emoji('calendar'),
  periodLock: emoji('locked'),
  settingsCurrencies: emoji('currency-exchange'),
  settingsModules: emoji('puzzle-piece'),
  settingsInvoiceFields: emoji('pencil'),
  settingsCustomFields: emoji('toolbox'),
  discountRules: emoji('admission-tickets'),
  settingsPosAccounts: emoji('credit-card'),
  settingsTax: emoji('classical-building'),
  settingsTds: emoji('scissors'),
  accountingRoles: emoji('key'),
  companyAdmin: emoji('shield'),
  settingsEmail: emoji('e-mail'),
  paymentReminders: emoji('bell'),
  dataImport: emoji('inbox-tray'),
};

/** The panel picture for a screen, or the item's own icon when the screen has none here. */
export const panelIcon = (item) => PANEL_EMOJI[item?.key] || item?.icon;

import InventoryModule from './features/inventory/InventoryModule';
import StockAdjustments from './features/inventory/StockAdjustments';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { pushMaster, removeMaster, saveMaster } from '@ui/utils/masterSync';
import { useServerDocSync } from '@ui/hooks/useServerDocSync';
import useTdsSync from './features/tds/useTdsSync';
import { reconcileExpenseTdsTransactions } from './features/tds/expenseReconciliation';
import useStockSync from './features/inventory/useStockSync';
import { useCompanyFromServer } from '@ui/hooks/useCompanyFromServer';
import { buildGstr1Json, buildGstr3bJson, downloadJson } from '@ui/utils/gstrExport';
import { exportGstr1Excel } from '@ui/utils/gstr1Excel';
import { exportListXlsx } from '@ui/utils/listXlsx';
import Toaster from '@ui/components/ui/Toaster';
import ResizableTables from '@ui/components/ResizableTables';
import StockTransferModule, { StockTransferEditor } from './features/inventory/StockTransferModule';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, BadgePercent, BarChart3, BookOpen, Boxes, Building2, Check, ChevronDown, ClipboardList, Download, FileStack, FileText, FolderTree, Landmark, ListChecks, LogOut, MoreVertical, NotebookPen, Package, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Receipt, RefreshCw, Search, Settings, ShoppingCart, SlidersHorizontal, Tags, Trash2, Truck, Upload, UserRound, Users } from 'lucide-react';
/* Duotone icons for the module rail — the two-tone fill is what reads as a
   "coloured icon" rather than a tinted outline. Leaf items stay lucide, tinted
   with their module colour, so the two sets never mix at the same level. */
import { Bank as PhBank, ChartBar as PhReports, Database as PhMaster, GearSix as PhSettings, Notebook as PhJournal, Package as PhInventory, Receipt as PhSales, ShieldCheck as PhApprovals, ShoppingCartSimple as PhPurchases, SquaresFour as PhDashboard, Wallet as PhExpenses } from '@phosphor-icons/react';
import Modal from '@ui/components/ui/Modal';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { VendorForm } from './components/pickers/VendorPicker';
import { CustomerForm } from './components/pickers/CustomerPicker';
import { buildLedgerStatement, getDefaultDocSettings, initEmptyDB, normalizeDB } from './data/db';
import InvoiceTemplateDesigner from './features/settings/InvoiceTemplateDesigner';
import NumberingDesigner from './features/settings/NumberingDesigner';
import { exportLedgerToExcel, exportLedgerToPdf, printLedger } from '@ui/utils/ledgerExport';
import { formatMoney, round2 } from '@ui/utils/money';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { exportRows, useListSearch } from '@ui/components/ListToolbar';
import { ACCENT_OPTIONS, TEMPLATE_OPTIONS, VOUCHER_DEFS, getDocSettings } from '@ui/utils/docSettings';
import { computeGstForLine, getCompanyGstProfile, GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';

import {
  PaymentsTransactionsList,
  ReceiptsTransactionsList,
} from './features/payments/TransactionsList';
import RecordReceiptForm from './features/payments/RecordReceiptForm';
import RecordDisbursementForm from './features/payments/RecordDisbursementForm';
import { cashBankIndex } from './features/cashBank/transactions';
import { invoiceChangeBlockReason } from './features/sales/invoiceChangeGuard';

/* Static, not lazy: the sales module imports it statically, so it is in the
   main chunk either way and `lazy` only earned a build warning. */
import InvoicePreview from './features/sales/InvoicePreview';

/*
 * Screens reached from inside another screen rather than from the rail.
 *
 * Every report lives behind the Reports hub, and so do the master-data,
 * financials and import screens. The address bar was already being written
 * for them — opening Trial Balance put `#/trialBalance` in it — and then
 * refused on the way back in, because the rail had never heard of the key.
 * The product was handing out links to its own reports that opened something
 * else, and a reload on any of them lost the screen.
 *
 * Listed rather than read off the render switch: a key here is a promise that
 * the screen stands up from a cold load with nothing selected. The
 * single-ledger view is absent for that reason — it needs a ledger, and a
 * link that restores the screen but not the document lies about where it
 * goes.
 */
const HUB_SCREENS = new Set([
  'accounts',
  /*
   * Features, and the seven surfaces that now render it.
   *
   * The seven were settings screens and were known through the settings map;
   * they left it when capability management left Settings, so they are named
   * here to stay openable from a link somebody saved.
   */
  'features',
  'settingsFeatures',
  'settingsSales',
  'settingsPurchases',
  'settingsInventory',
  'settingsAccounting',
  'settingsPaymentsReceipts',
  'settingsDocuments',
  'balanceSheet',
  'cashBankImport',
  'cashFlow',
  'companyProfile',
  'costCenters',
  'dataImport',
  'discountRules',
  'docTemplates',
  'financials',
  'fixedAssets',
  'gstCompliance',
  'gstr1',
  'gstr2bReco',
  'gstr3b',
  'inventoryOverview',
  'ledgerTrialBalance',
  /* The same screen under the name the reports hub now offers it by: the
     ledger's own trial balance, and the general ledger it walks. A key the
     switch renders but nothing registers is a screen no saved link opens. */
  'generalLedger',
  'mdm',
  'msmeCompliance',
  'paymentsExpense',
  'profitLoss',
  'salesBySalesman',
  'salesReports',
  'settingsNumbering',
  'settingsProfile',
  'stockAdjustment',
  'tallyExport',
  'tds',
  'tdsTcs',
  'trialBalance',
  'yearEndClose',
]);

const HUB_SCREEN_FEATURES = {
  costCenters: ['costCenters'],
  dataImport: ['imports'],
  discountRules: ['discountRules'],
  inventoryOverview: ['inventory'],
  paymentsExpense: ['expenses'],
  salesBySalesman: ['salesmen'],
  stockAdjustment: ['inventory'],
};
import {
  CreditNoteForm,
  CreditNotesList,
  EstimateForm,
  EstimatesList,
  InvoiceForm,
  InvoicesList,
} from './features/sales';

import {
  BillForm,
  BillsList,
  DebitNoteForm,
  DebitNotesList,
  PurchaseOrderForm,
  PurchaseOrdersList,
} from './features/purchase';
const CashBankModule = lazy(() => import('./features/cashBank/CashBankModule'));
import { AccountGroupForm } from './features/accounts/AccountGroupTypeForms';
import EInvoiceSettings from './features/admin/EInvoiceSettings';
import { SettingsWarehouses } from './features/admin/SettingsWarehouses';
import { createWarehouse, listWarehouses } from './api/admin';
import { listBranches } from './api/admin';
import { getMyAuthContext } from './api/auth';
import { PageHeader, SkeletonStats, TableTotals, EmptyState } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { MoreButton } from '@ui/components/list/ListPageParts';
import Drawer from '@ui/components/ui/Drawer';
import { PermissionProvider } from '@ui/permissions/PermissionContext';
import { WriteGuard } from '@ui/permissions/WriteGuard';
import { usePermissions } from '@ui/permissions/usePermissions';
import SettingsHub from './features/settings/SettingsHub';
import MovedToCompanyAdmin from '@ui/company/OpenInCompanyAdmin';
import SettingsWorkspace from './features/settings/SettingsWorkspace';
import MasterDataWorkspace, { MASTER_DATA_KEYS } from './features/masters/MasterDataWorkspace';
import { TcsRatesMaster } from './features/masters/TaxRateMaster';
import { isSettingsKey, isSettingsRoute, settingFor, settingsBackTarget, visibleSettings } from './features/settings/settingsRegistry';
import FeaturesPage from './features/features/FeaturesPage';
import FeaturesPanel from './features/features/FeaturesPanel';
import { featuresPresentationFor } from './features/features/featuresPresentation';
import PosPaymentAccounts from './features/admin/PosPaymentAccounts';
import ModulePicker from './features/settings/ModulePicker';
import { TDS_NATURES } from './features/tds/ruleMaster';
import { tdsGroupSide } from '@ui/utils/tdsLedgers';
import { formatDateIn, localDateIso, todayIso } from '@ui/utils/dates';
import { payableOutstanding } from '@ui/utils/onAccount';
import { allocatedPaymentDate, daysAfter, estimateMsmeInterestWithRates, MSME_BANK_RATE, msmeDueDate } from '@ui/utils/msmeCompliance';


import TermsSettings from './features/settings/TermsSettings';
import InvoiceFieldSettings from './features/settings/InvoiceFieldSettings';
import ItemForm from './features/masters/ItemForm';
import EmailSettings from './features/settings/EmailSettings';
import ProfileSettings from './features/settings/ProfileSettings';
import CompanyProfileDetails from './features/settings/CompanyProfileDetails';
import CompanyProfileForm from './features/settings/CompanyProfileForm';
import NumberingSettings from './features/settings/NumberingSettings';
import CurrencySettings from './features/settings/CurrencySettings';
const BatchSerialManager = lazy(() => import('./features/inventory/BatchSerialManager'));
const PriceLists = lazy(() => import('./features/pricing/PriceLists'));
const Salesmen = lazy(() => import('./features/sales/Salesmen'));
const DeliveryChallans = lazy(() => import('./features/sales/DeliveryChallans'));
const PosScreen = lazy(() => import('./features/sales/PosScreen'));
const DiscountRules = lazy(() => import('./features/sales/DiscountRules'));
const SalesOrders = lazy(() => import('./features/sales/SalesOrders'));

const BatchStock = lazy(() => import('./features/inventory/BatchStock'));
const Gstr2bReco = lazy(() => import('./features/reports/Gstr2bReco'));
const PaymentReminders = lazy(() => import('./features/sales/PaymentReminders'));
const TallyExport = lazy(() => import('./features/reports/TallyExport'));
const ReorderAlerts = lazy(() => import('./features/inventory/ReorderAlerts'));
const TdsTcsReport = lazy(() => import('./features/reports/TdsTcsReport'));
const SalesBySalesman = lazy(() => import('./features/reports/SalesBySalesman'));
const FixedAssets = lazy(() => import('./features/accounting/FixedAssets'));
const YearEndClose = lazy(() => import('./features/accounting/YearEndClose'));
const CostCenters = lazy(() => import('./features/accounting/CostCenters'));
const SharedInvoice = lazy(() => import('./features/sales/SharedInvoice'));
const BankReconciliation = lazy(() => import('./features/cashBank/BankReconciliation'));
const BankCashAccounts = lazy(() => import('./features/cashBank/BankCashAccounts'));
const CashBankTransactions = lazy(() => import('./features/cashBank/CashBankTransactions'));
const TdsModule = lazy(() => import('./features/tds/TdsModule'));
const TdsChallanForm = lazy(() => import('./features/tds/ChallanForm'));
const TdsSettings = lazy(() => import('./features/tds/TdsSettings'));
const ContraForm = lazy(() => import('./features/cashBank/ContraForm'));
const RecurringInvoices = lazy(() => import('./features/sales/RecurringInvoices'));
const ImportCenter = lazy(() => import('./features/data/ImportCenter'));
import DashboardOverview from './features/dashboard/DashboardOverview';

/* Lazily loaded chart primitives for module overviews — same chunk the main
   dashboard pulls, so navigating between them costs one fetch total. */
const LazyPeriodBars = lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.PeriodBars })));
const LazyCompositionPie = lazy(() => import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.CompositionPie })));
const ModuleChartFallback = ({ height = 220 }) => (
  <div className="ui-skel w-full" style={{ height, borderRadius: 'var(--radius)' }} aria-hidden="true" />
);
import PurchaseOverview from './features/purchase/PurchaseOverview';
import CustomersList from './features/crm/CustomersList';
import JournalEntriesList from './features/accounting/JournalEntriesList';
import VendorsList from './features/crm/VendorsList';
import CompanyGroups from './features/companies/CompanyGroups';
import CommandPalette from '@ui/components/ui/CommandPalette';
import { buildRecordIndex, searchRecords } from '@ui/utils/searchIndex';
import { setSearchSeed } from '@ui/utils/searchSeed';
import { useGlobalShortcuts } from '@ui/components/ui/useGlobalShortcuts';
import { useFitToViewport } from '@ui/components/ui/useFitToViewport';
import { useListKeys } from '@ui/components/ui/useListKeys';
import { useScreenUrl } from '@ui/components/ui/useScreenUrl';
import ShortcutSheet, { useShortcutSheet } from '@ui/components/ui/ShortcutSheet';
import { useCommandPalette } from '@ui/components/ui/useCommandPalette';
import SalesOverview from './features/sales/SalesOverview';
import GovernanceSettings from './features/admin/GovernanceSettings';
import ApprovalsInbox from './features/approvals/ApprovalsInbox';
import LedgerTrialBalance from './features/reports/LedgerTrialBalance';
import { FeatureProvider } from '@ui/permissions/FeatureProvider';
import { useFeatures } from '@ui/permissions/useFeatures';
import { useTheme } from '@ui/components/ui/useTheme';
import { useDensity } from '@ui/components/ui/useDensity';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { onPlatformContextChange, orgId as platformOrgId, requestSwitchCompany, selectBranch, selectWarehouse, selectedBranchId, selectedWarehouseId, companyStorageKey } from '@platform/context';
import { logout as platformLogout } from '@platform/auth';
import { registerLedgerForm } from './components/pickers/ledgerFormRegistry';
import { useDismissable } from '@ui/components/ui/useDismissable';
import ReportsWorkspace from './features/reports/ReportsWorkspace';
import { ExpensesList, ExpenseForm, JournalEntryForm } from './features/expenses/ExpenseScreens';
import { normalizeId, ChartAccountForm } from './appShared';
export { expenseTdsBase } from './features/expenses/ExpenseScreens';
export { ExpensesList, ExpenseForm, JournalEntryForm, ChartAccountForm };
/**
 * Settings keys that used to open Accounting's own copies of the company's
 * administration — users, roles, sign-in, branches, the account. They live in
 * Company admin now (ADR-010); a bookmark, a notification or a habit that
 * still opens one is taken to the same page there. [title, Company admin screen]
 */
const COMPANY_ADMIN_REDIRECTS = {
  settingsBranches: ['Branches', 'branches'],
  settingsUsers: ['Users', 'users'],
  settingsRoles: ['Roles', 'roles'],
  settingsPermissions: ['Permissions', 'permissions'],
  settingsSecurity: ['Login & security', 'security'],
  settingsAudit: ['Audit trail', 'audit'],
  settingsAccount: ['Account & plan', 'account'],
  settingsBilling: ['Billing', 'billing'],
  settingsDataBackup: ['Data export', 'export'],
  settingsSso: ['Single sign-on', 'sso'],
};


/**
 * The org id the SERVER knows this company by.
 *
 * The session's `activeOrgId` is also sent by apiFetch as `x-org-id`, so the
 * route parameter must come from that same source. A locally cached company
 * can briefly belong to the previously selected organisation while the new
 * company is hydrating; preferring its backend id makes the URL and header
 * disagree and the server correctly rejects the request as an org mismatch.
 * The company profile remains a cold-start fallback only.
 */
const resolveServerOrgId = (company) => {
  try {
    const active = String(platformOrgId() || '').trim();
    if (active) return active;
  } catch {
    // Continue to the persisted company fallback below.
  }
  return String(company?.profile?.backendCompanyId || '').trim();
};



/** Sentinel value for the "create one" entry inside the ledger picker. */
const NEW_LEDGER_OPTION = '__new_ledger__';


const ItemsList = ({ db, setDb, currentCompany, warehouses = [], branches = [], onNavigate = null }) => {
  /*
   * The item master takes the screen, the way a document does. `null`, or the
   * item being written — true for a new one.
   */
  const [itemForm, setItemForm] = useState(null);
  const items = db.items.filter((i) => i.companyId === currentCompany.id);
  const itemSearch = useListSearch(items, ['code', 'name', 'hsnSac', 'category', 'barcode']);
  const itemSearchFilters = useColumnFilters();
  const shownItems = itemSearchFilters.applyFilters(itemSearch.filtered, {
    code: (r) => r.code,
    name: (r) => r.name,
    type: (r) => r.type,
    hsn: (r) => r.hsnSac,
    gst: (r) => r.gstRate,
    price: (r) => r.salePrice,
  });
  const inventoryByItemId = useMemo(() => {
    return computeInventorySummaryByItemId({ db, companyId: currentCompany.id });
  }, [db, currentCompany.id]);

  const getItemReferences = (itemId) => {
    const idStr = String(itemId);
    const sources = [
      { key: 'invoices', label: 'Invoice' },
      { key: 'estimates', label: 'Quotation' },
      { key: 'creditNotes', label: 'Credit Note' },
      { key: 'purchaseOrders', label: 'Purchase Order' },
      { key: 'bills', label: 'Bill' },
      { key: 'debitNotes', label: 'Debit Note' },
    ];

    const refs = [];
    for (const src of sources) {
      const docs = Array.isArray(db[src.key]) ? db[src.key] : [];
      for (const doc of docs) {
        if (doc?.companyId !== currentCompany.id) continue;
        const lines = Array.isArray(doc?.items) ? doc.items : [];
        const used = lines.some((l) => String(l?.itemId || '') === idStr);
        if (!used) continue;
        const num = String(doc?.number || '').trim();
        refs.push(`${src.label}${num ? ` ${num}` : ''}`);
      }
    }
    return refs;
  };

  const onEdit = (item) => setItemForm(item);

  const onDelete = async (item) => {
    const refs = getItemReferences(item.id);
    if (refs.length) {
      const preview = refs.slice(0, 5).join(', ');
      notify.error(`Cannot delete this item because it is used in: ${preview}${refs.length > 5 ? '...' : ''}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete item "${String(item.name || '').trim() || String(item.code || '').trim() || 'this item'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    setDb({
      ...db,
      items: db.items.filter((i) => !(i.companyId === currentCompany.id && i.id === item.id)),
    });
  };

  const [itemFilter, setItemFilter] = useState('ALL');
  const ITEM_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'GOODS', label: 'Goods', tone: 'paid' },
    { value: 'SERVICE', label: 'Services', tone: 'sent' },
    { value: 'NOHSN', label: 'No HSN/SAC', tone: 'overdue' },
    { value: 'NOPRICE', label: 'No sale price', tone: 'outstanding' },
  ];
  const itemMatches = (it, tab) => {
    const isService = String(it.type || '').toLowerCase() === 'service';
    if (tab === 'GOODS') return !isService;
    if (tab === 'SERVICE') return isService;
    if (tab === 'NOHSN') return !String(it.hsnSac || '').trim();
    if (tab === 'NOPRICE') return !Number(it.salePrice || 0);
    return true;
  };
  const visibleItems = itemFilter === 'ALL' ? shownItems : shownItems.filter((it) => itemMatches(it, itemFilter));

  const itemStatusCounts = useMemo(() => {
    const counts = { ALL: shownItems.length };
    for (const t of ITEM_TABS) {
      if (t.value === 'ALL') continue;
      counts[t.value] = shownItems.filter((it) => itemMatches(it, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownItems]);

  const itemExportColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'hsnSac', label: 'HSN/SAC' },
    { key: 'gstRate', label: 'GST %', value: (r) => Number(r.gstRate || 0) },
    { key: 'salePrice', label: 'Sale Price', value: (r) => Number(r.salePrice || 0) },
    { key: 'purchasePrice', label: 'Purchase Price', value: (r) => Number(r.purchasePrice || 0) },
  ];

  const openNewItem = () => setItemForm(true);

  if (itemForm) {
    return (
      <ItemForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        branches={branches}
        onNavigate={onNavigate}
        initialData={itemForm === true ? null : itemForm}
        onClose={() => setItemForm(null)}
      />
    );
  }

  return (
    <DocumentListShell
      entity="items"
      title="Items"
      compact
      tight
      className="item-list-page"
      headerPortalId="master-items-header-slot"
      company={currentCompany}
      search={{
        value: itemSearch.query,
        onChange: itemSearch.setQuery,
        placeholder: 'Search items…',
        label: 'Search items',
      }}
      moreItems={[exportMenuItem('Export items')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Items',
          fileName: `Items_${currentCompany?.name || 'company'}`,
          label: 'item(s)',
          columns: itemExportColumns,
          rows: visibleItems,
        });
      }}
      primary={
        <button type="button" onClick={openNewItem} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Item
        </button>
      }
      tabs={ITEM_TABS}
      tabsLabel="Item filter"
      statusInHeader
      statusValue={itemFilter}
      statusCounts={itemStatusCounts}
      onStatusChange={setItemFilter}
    >
      <div className="ui-table-scroll item-table-scroll">
        <table className={`ui-table ui-table-wide ui-table-sticky ${visibleItems.length ? '' : 'cash-bank-empty-table'}`}>
          <thead>
            <tr>
              <ColumnHeader label="Code" col="code" state={itemSearchFilters} />
              <ColumnHeader label="Name" col="name" state={itemSearchFilters} />
              <ColumnHeader label="Type" col="type" state={itemSearchFilters} />
              <ColumnHeader label="HSN/SAC" col="hsn" state={itemSearchFilters} />
              <ColumnHeader label="GST %" col="gst" state={itemSearchFilters} className="ui-num" align="right" />
              <ColumnHeader label="Sale price" col="price" state={itemSearchFilters} className="ui-num" align="right" />
              <th scope="col">Stock</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={Package}
                    kind="new"
      title={items.length ? 'No items match' : 'No items yet'}
                    description={items.length ? 'No items match the selected filter.' : 'Create an item to get started.'}
                    routes={
                      items.length
                        ? undefined
                        : [
                            {
                              label: 'Add one now',
                              description: 'Name, HSN or SAC, tax rate, price.',
                              onSelect: () => openNewItem(),
                            },
                          ]
                    }
                  />
                </td>
              </tr>
            ) : null}
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td className="ui-col-id">{item.code}</td>
                <td className="ui-col-entity">{item.name}</td>
                <td className="ui-col-meta">{item.type}</td>
                <td className="ui-col-id">{item.hsnSac || '-'}</td>
                <td className="ui-col-amount ui-mono">{Number.isFinite(Number(item.gstRate)) ? Number(item.gstRate) : 0}</td>
                <td className="ui-col-amount">{formatMoney(item.salePrice || 0, currentCompany)}</td>
                <td className="ui-col-meta">
                  {isStockItem(item) ? (
                    <>
                      {(inventoryByItemId.get(String(item.id))?.closingQty ?? 0)} {item.unit}
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="px-4 py-2.5 ui-col-meta">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1"
      title="Edit"
                    >
                      <Pencil size={16} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm flex items-center gap-1 text-[rgb(var(--neg))]"
      title="Delete"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableTotals count={visibleItems.length} totalCount={items.length} noun="items" />
    </DocumentListShell>
  );
};

const NEW_CATEGORY_OPTION = '__new_item_category__';


export { ItemForm };

const StockAdjustment = () => {
  return (
    <div className="ui-surface rounded-xl shadow-sm p-6 border">
      <h3 className="ui-t-sec mb-4">Stock Adjustment</h3>
      <p className="ui-muted">Adjust inventory stock levels</p>
    </div>
  );
};

const InventoryOverview = ({ db, currentCompany }) => {
  const items = db.items.filter((i) => i.companyId === currentCompany.id);

  const byItemId = useMemo(() => computeInventorySummaryByItemId({ db, companyId: currentCompany.id }), [db, currentCompany.id]);
  const totalValue = items.reduce((sum, i) => {
    if (!isStockItem(i)) return sum;
    const qty = Number(byItemId.get(String(i.id))?.closingQty ?? 0);
    return sum + qty * Number(i.purchasePrice ?? 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="ui-surface rounded-xl shadow-sm p-6 border">
          <h4 className="text-sm ui-muted mb-2">Total Items</h4>
          <p className="ui-money-lg">{items.length}</p>
        </div>
        <div className="ui-surface rounded-xl shadow-sm p-6 border">
          <h4 className="text-sm ui-muted mb-2">Inventory Value</h4>
          <p className="ui-money-lg">{formatMoney(totalValue, currentCompany)}</p>
        </div>
      </div>
    </div>
  );
};

const ChartOfAccounts = ({ db, setDb, openModal, currentCompany, onOpenLedger = null }) => {
  const companyAccountGroups = (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter(
    (group) => group.companyId === currentCompany.id
  );
  const accounts = db.chartOfAccounts.filter(
    (account) =>
      account.companyId === currentCompany.id &&
      (!account.hiddenFromChart || Boolean(tdsGroupSide(companyAccountGroups, account.groupId)))
  );
  const [coaView, setCoaView] = useState('ledgers');
  /*
   * The ledger master opens as a screen, not a dialog.
   *
   * A ledger has five tabs behind it — bank, statutory, TDS, addresses, the
   * people who answer about it — and a dialog gave all of that a scrolling box
   * with the list greyed out behind it. `null`, or the ledger being written.
   */
  const [ledgerForm, setLedgerForm] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupLedgerSearch, setGroupLedgerSearch] = useState('');
  const menuRef = useRef(null);
  const coaImportInputRef = useRef(null);

  const MENU_WIDTH = 192; // w-48
  const MENU_HEIGHT_ESTIMATE = 120;

  const downloadChartTemplate = () => {
    downloadCsvTemplate({
      fileName: 'Chart_of_Accounts_Import_Template',
      columns: [
        { key: 'Record Type', label: 'Record Type' },
        { key: 'Name', label: 'Name' },
        { key: 'Parent', label: 'Parent' },
        { key: 'Code', label: 'Code' },
        { key: 'Opening Balance', label: 'Opening Balance' },
      ],
      sample: [
        {
          'Record Type': 'GROUP',
          Name: 'Digital Banks',
          Parent: 'Bank Accounts',
          Code: '',
          'Opening Balance': '',
        },
        {
          'Record Type': 'LEDGER',
          Name: 'HDFC Current Account',
          Parent: 'Digital Banks',
          Code: 'BANK-001',
          'Opening Balance': '0',
        },
      ],
    });
    notify.success('Chart of Accounts import template downloaded. Use GROUP or LEDGER in Record Type.');
  };

  const exportChart = (format) => {
    const groups = accountGroups.map((group) => ({
      recordType: 'GROUP',
      name: group.name,
      parent:
        accountGroups.find((parent) => String(parent.id) === String(group.parentGroupId))?.name ||
        typeById.get(String(group.typeId))?.name ||
        '',
      code: '',
      openingBalance: '',
    }));
    const ledgers = accounts.map((account) => ({
      recordType: 'LEDGER',
      name: account.name,
      parent: groupById.get(String(account.groupId))?.name || '',
      code: account.code || '',
      openingBalance: Number(account.openingBalance || 0),
    }));
    runListExport({
      format,
      title: 'Chart of Accounts',
      fileName: `Chart_of_Accounts_${currentCompany?.name || 'company'}`,
      label: 'account row(s)',
      columns: [
        { key: 'recordType', label: 'Record Type' },
        { key: 'name', label: 'Name' },
        { key: 'parent', label: 'Parent' },
        { key: 'code', label: 'Code' },
        { key: 'openingBalance', label: 'Opening Balance' },
      ],
      rows: [...groups, ...ledgers],
    });
  };

  const importChart = async (file) => {
    try {
      const { rows } = parseCsv(await readFileText(file));
      if (!rows.length) return notify.error('That file has no data rows.');

      const nextGroups = [...(Array.isArray(db.accountGroups) ? db.accountGroups : [])];
      const nextAccounts = [...(Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [])];
      const companyTypes = (Array.isArray(db.accountTypes) ? db.accountTypes : []).filter(
        (type) => type.companyId === currentCompany.id && !type.isLegacy
      );
      let nextGroupId = nextGroups.reduce((max, row) => Math.max(max, Number(row?.id || 0)), 0) + 1;
      let nextAccountId = nextAccounts.reduce((max, row) => Math.max(max, Number(row?.id || 0)), 0) + 1;
      const problems = [];
      let createdGroups = 0;
      let createdLedgers = 0;
      const lower = (value) => String(value || '').trim().toLowerCase();
      const findGroup = (name) => nextGroups.find(
        (group) => group.companyId === currentCompany.id && !group.isLegacy && lower(group.name) === lower(name)
      );
      const findType = (name) => companyTypes.find((type) => lower(type.name) === lower(name));

      for (const [index, row] of rows.entries()) {
        if (lower(row['Record Type']) !== 'group') continue;
        const name = String(row.Name || '').trim();
        const parentName = String(row.Parent || '').trim();
        if (!name || !parentName) {
          problems.push(`Row ${index + 2}: group Name and Parent are required.`);
          continue;
        }
        if (findGroup(name)) continue;
        const parentGroup = findGroup(parentName);
        const parentType = findType(parentName);
        if (!parentGroup && !parentType) {
          problems.push(`Row ${index + 2}: parent “${parentName}” was not found.`);
          continue;
        }
        nextGroups.push({
          id: nextGroupId++,
          companyId: currentCompany.id,
          typeId: Number(parentGroup?.typeId ?? parentType.id),
          name,
          parentGroupId: parentGroup?.id ?? null,
          groupCategory: String(parentGroup?.groupCategory || 'General').trim() || 'General',
          isUserDefined: true,
          createdAt: new Date().toISOString(),
        });
        createdGroups += 1;
      }

      for (const [index, row] of rows.entries()) {
        if (lower(row['Record Type']) !== 'ledger') continue;
        const name = String(row.Name || '').trim();
        const parentName = String(row.Parent || '').trim();
        const parent = findGroup(parentName);
        if (!name || !parent) {
          problems.push(`Row ${index + 2}: ledger Name and a valid Parent group are required.`);
          continue;
        }
        const duplicate = nextAccounts.some(
          (account) => account.companyId === currentCompany.id && !account.hiddenFromChart && lower(account.name) === lower(name)
        );
        if (duplicate) continue;
        const type = companyTypes.find((item) => String(item.id) === String(parent.typeId));
        const openingBalance = String(type?.main || '').trim() === 'P&L' ? 0 : (Number(row['Opening Balance'] || 0) || 0);
        nextAccounts.push({
          id: nextAccountId++,
          companyId: currentCompany.id,
          code: String(row.Code || '').trim(),
          name,
          groupId: parent.id,
          ledgerCategory: String(parent.groupCategory || 'General').trim() || 'General',
          type: String(type?.accountClass || 'Asset'),
          subType: String(type?.name || ''),
          main: String(type?.main || 'Balance Sheet'),
          openingBalance,
          balance: openingBalance,
          isUserDefined: true,
          hiddenFromChart: false,
          createdAt: new Date().toISOString(),
        });
        createdLedgers += 1;
      }

      if (!createdGroups && !createdLedgers) {
        return notify.error(problems[0] || 'No new groups or ledgers were found in the file.');
      }
      setDb({ ...db, accountGroups: nextGroups, chartOfAccounts: nextAccounts });
      notify.success(`Imported ${createdGroups} group(s) and ${createdLedgers} ledger(s).${problems.length ? ` ${problems.length} row(s) skipped.` : ''}`);
    } catch (error) {
      notify.error(error?.message || 'Unable to import the Chart of Accounts file.');
    }
  };

  const LedgerCreateChooser = ({ onClose }) => {
    /*
     * Every door out of the chooser opens a screen.
     *
     * A customer and a vendor are masters with five tabs behind them, the same
     * as a ledger. In a dialog the form's own bar sat under the dialog's title
     * — two headings saying "New Customer" — and the tabs scrolled inside a box
     * with the list greyed out behind it.
     */
    const openCustomerCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'newCustomer' });
    };

    const openVendorCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'newVendor' });
    };

    const openOtherLedgerCreate = () => {
      openModal(null);
      setLedgerForm({ mode: 'new' });
    };

    return (
      <div className="space-y-6">
        <div className="text-sm ui-muted">Choose what you want to create:</div>

        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={openVendorCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">1. Vendor</div>
            <div className="text-xs ui-muted">Opens vendor creation form</div>
          </button>

          <button
            type="button"
            onClick={openCustomerCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">2. Customer</div>
            <div className="text-xs ui-muted">Opens customer creation form</div>
          </button>

          <button
            type="button"
            onClick={openOtherLedgerCreate}
            className="w-full text-left px-4 py-3 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            <div className="font-semibold">3. Others</div>
            <div className="text-xs ui-muted">Create any ledger other than Vendor/Customer ledgers</div>
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border ui-hover-sunken">
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const accountTypes = (Array.isArray(db.accountTypes) ? db.accountTypes : [])
    .filter((t) => t.companyId === currentCompany.id)
    .filter((t) => !t.isLegacy)
    .slice()
    .sort((a, b) => {
      const am = String(a.main || '');
      const bm = String(b.main || '');
      if (am !== bm) return am.localeCompare(bm);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const accountGroups = (Array.isArray(db.accountGroups) ? db.accountGroups : [])
    .filter((g) => g.companyId === currentCompany.id)
    .filter((g) => !g.isLegacy)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of accountTypes) m.set(String(t.id), t);
    return m;
  }, [accountTypes]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of accountGroups) m.set(String(g.id), g);
    return m;
  }, [accountGroups]);

  const typeRowToParent = (t) => {
    const main = String(t?.main || '').trim();
    const cls = String(t?.accountClass || '').trim();
    if (main === 'P&L') {
      if (cls === 'Expense') return 'Expenses';
      return 'Income';
    }
    if (cls === 'Liability' || cls === 'Equity') return 'Liabilities';
    return 'Assets';
  };

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-coa-menu-button]');
      if (btn && String(btn.getAttribute('data-coa-menu-button')) === String(openMenu.buttonKey)) return;
      setOpenMenu(null);
    };

    const onScrollOrResize = () => setOpenMenu(null);

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [openMenu?.id]);

  const openRowMenu = (kind, id, anchorEl) => {
    const buttonKey = `${String(kind)}:${String(id)}`;

    setOpenMenu({ kind, id, buttonKey, left: 0, top: 0 });
    const rect = anchorEl?.getBoundingClientRect?.();
    if (!rect) return;

    const leftPref = rect.right - MENU_WIDTH;
    const left = Math.max(8, Math.min(leftPref, window.innerWidth - MENU_WIDTH - 8));

    const topPref = rect.bottom + 8;
    const top = Math.max(8, Math.min(topPref, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8));

    setOpenMenu({ kind, id, buttonKey, left, top });
  };

  const ledgerRows = useMemo(() => {
    return accounts
      .map((a) => {
        const group = a?.groupId ? groupById.get(String(a.groupId)) : null;
        const typeRow = group ? typeById.get(String(group.typeId)) : null;
        return {
          ...a,
          _groupName: group?.name || '',
          _parent: typeRow
            ? typeRowToParent(typeRow)
            : String(a.main || '').trim() === 'P&L'
              ? (String(a.type || '').trim() === 'Expense' ? 'Expenses' : 'Income')
              : String(a.type || '').trim() === 'Liability' || String(a.type || '').trim() === 'Equity'
                ? 'Liabilities'
                : 'Assets',
        };
      })
      .sort((x, y) => {
        const pa = String(x._parent || '');
        const pb = String(y._parent || '');
        if (pa !== pb) return pa.localeCompare(pb);
        const ga = String(x._groupName || '');
        const gb = String(y._groupName || '');
        if (ga !== gb) return ga.localeCompare(gb);
        return String(x.name || '').localeCompare(String(y.name || ''));
      });
  }, [accounts, groupById, typeById]);

  const visibleLedgerRows = useMemo(() => {
    const q = String(ledgerSearch || '').trim().toLowerCase();
    if (!q) return ledgerRows;
    return ledgerRows.filter((a) => {
      const hay = `${String(a?.name || '')} ${String(a?.code || '')} ${String(a?._groupName || '')} ${String(a?._parent || '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [ledgerRows, ledgerSearch]);

  const groupRows = useMemo(() => {
    return accountGroups
      .map((g) => {
        const typeRow = g?.typeId ? typeById.get(String(g.typeId)) : null;
        return {
          ...g,
          _parent: groupById.get(String(g.parentGroupId))?.name || (typeRow ? typeRowToParent(typeRow) : '-'),
        };
      })
      .sort((a, b) => {
        const pa = String(a._parent || '');
        const pb = String(b._parent || '');
        if (pa !== pb) return pa.localeCompare(pb);
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [accountGroups, groupById, typeById]);

  const visibleGroupRows = useMemo(() => {
    const q = String(groupSearch || '').trim().toLowerCase();
    if (!q) return groupRows;
    return groupRows.filter((g) => {
      const hay = `${String(g?.name || '')} ${String(g?._parent || '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [groupRows, groupSearch]);

  const selectedGroup = groupRows.find((group) => String(group.id) === String(selectedGroupId)) || null;
  const selectedGroupLedgerRows = useMemo(() => {
    if (!selectedGroupId) return [];
    const included = new Set([String(selectedGroupId)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of accountGroups) {
        if (included.has(String(group.parentGroupId || '')) && !included.has(String(group.id))) {
          included.add(String(group.id));
          changed = true;
        }
      }
    }
    const query = String(groupLedgerSearch || '').trim().toLowerCase();
    return ledgerRows.filter((ledger) => {
      if (!included.has(String(ledger.groupId || ''))) return false;
      if (!query) return true;
      return `${ledger.name || ''} ${ledger.code || ''} ${ledger._groupName || ''}`.toLowerCase().includes(query);
    });
  }, [selectedGroupId, groupLedgerSearch, accountGroups, ledgerRows]);

  const openNewLedger = () => {
    openModal(<LedgerCreateChooser onClose={() => openModal(null)} />, { title: 'Create', maxWidthClass: 'max-w-lg' });
  };

  const openNewGroup = () => setLedgerForm({ mode: 'newGroup' });

  const openEditLedger = (ledger) => setLedgerForm({ mode: 'edit', ledger });

  const openEditGroup = (group) => {
    if (group?.isSystem) {
      notify.error('Default ledger groups cannot be edited.');
      return;
    }
    setLedgerForm({ mode: 'editGroup', group });
  };

  const canDeleteLedger = (ledgerId) => {
    const id = String(ledgerId || '').trim();
    if (!id) return { ok: false, reason: 'Invalid ledger.' };

    const ledger = accounts.find((account) => String(account?.id) === id);
    if (ledger?.isSystem) return { ok: false, reason: 'Default ledgers cannot be deleted.' };

    const usedInJournal = (Array.isArray(db.journalEntries) ? db.journalEntries : [])
      .filter((j) => j.companyId === currentCompany.id)
      .some((j) => (Array.isArray(j.lines) ? j.lines : []).some((l) => String(l?.accountId || '').trim() === id));
    if (usedInJournal) return { ok: false, reason: 'Ledger is used in Journal Entries.' };

    const linkedCustomer = (Array.isArray(db.customers) ? db.customers : [])
      .filter((c) => c.companyId === currentCompany.id)
      .some((c) => String(c?.accountId || '').trim() === id);
    if (linkedCustomer) return { ok: false, reason: 'Ledger is linked to a Customer.' };

    const linkedVendor = (Array.isArray(db.vendors) ? db.vendors : [])
      .filter((v) => v.companyId === currentCompany.id)
      .some((v) => String(v?.accountId || '').trim() === id);
    if (linkedVendor) return { ok: false, reason: 'Ledger is linked to a Vendor.' };

    return { ok: true, reason: '' };
  };

  const deleteLedger = async (ledger) => {
    const check = canDeleteLedger(ledger?.id);
    if (!check.ok) {
      notify.error(check.reason === 'Default ledgers cannot be deleted.' ? check.reason : `Cannot delete this ledger. ${check.reason}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete ledger "${String(ledger?.name || '').trim() || 'this ledger'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    setDb({
      ...db,
      chartOfAccounts: (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).filter(
        (a) => !(a.companyId === currentCompany.id && String(a.id) === String(ledger.id))
      ),
    });
  };

  /*
   * A ledger that has been posted to cannot be deleted — the entries would
   * point at nothing. Retiring it is the answer the spec gives: it keeps its
   * history and its balance on the reports, and stops being offered for new
   * entries. Nothing is lost and nothing else has to be corrected.
   */
  const setLedgerActive = (ledger, active) => {
    setDb({
      ...db,
      chartOfAccounts: (Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : []).map((a) =>
        a.companyId === currentCompany.id && String(a.id) === String(ledger.id) ? { ...a, active } : a
      ),
    });
    notify.success(active ? `"${ledger.name}" is active again.` : `"${ledger.name}" will not be offered for new entries.`);
  };

  const canDeleteGroup = (groupId) => {
    const id = String(groupId || '').trim();
    if (!id) return { ok: false, reason: 'Invalid group.' };

    const usedByChildGroup = accountGroups.some(
      (g) => String(g?.parentGroupId || '').trim() === id
    );
    if (usedByChildGroup) return { ok: false, reason: 'Group contains one or more child groups.' };

    const usedByLedger = accounts.some((a) => String(a?.groupId || '').trim() === id);
    if (usedByLedger) return { ok: false, reason: 'Group is used by one or more ledgers.' };

    return { ok: true, reason: '' };
  };

  const deleteGroup = async (group) => {
    if (group?.isSystem) {
      notify.error('Default ledger groups cannot be deleted.');
      return;
    }
    const check = canDeleteGroup(group?.id);
    if (!check.ok) {
      notify.error(`Cannot delete this group. ${check.reason}`);
      return;
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete group "${String(group?.name || '').trim() || 'this group'}"?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    const deletedDefaults = new Set(
      Array.isArray(currentCompany?.docSettings?.deletedDefaultAccountGroups)
        ? currentCompany.docSettings.deletedDefaultAccountGroups.map((name) => String(name || '').trim().toLowerCase())
        : []
    );
    if (group?.isSystem) deletedDefaults.add(String(group?.name || '').trim().toLowerCase());
    const companies = (Array.isArray(db.companies) ? db.companies : []).map((company) =>
      company.id === currentCompany.id
        ? {
            ...company,
            docSettings: {
              ...(company.docSettings || {}),
              deletedDefaultAccountGroups: [...deletedDefaults],
            },
          }
        : company
    );

    setDb({
      ...db,
      companies,
      accountGroups: (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter(
        (g) => !(g.companyId === currentCompany.id && String(g.id) === String(group.id))
      ),
    });
  };

  /*
   * The form takes the screen, the way the customer and vendor masters do. Back
   * and Cancel in its own bar return here; there is no dialog to dismiss.
   */
  if (ledgerForm?.mode === 'editGroup') {
    return (
      <AccountGroupForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={ledgerForm.group}
        onClose={() => setLedgerForm(null)}
      />
    );
  }

  if (ledgerForm?.mode === 'newGroup') {
    return (
      <AccountGroupForm
        fullPage
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        onClose={() => setLedgerForm(null)}
      />
    );
  }

  if (ledgerForm?.mode === 'newCustomer' || ledgerForm?.mode === 'newVendor') {
    const PartyForm = ledgerForm.mode === 'newCustomer' ? CustomerForm : VendorForm;
    return (
      <div className="space-y-6">
        <PartyForm db={db} setDb={setDb} currentCompany={currentCompany} onClose={() => setLedgerForm(null)} />
      </div>
    );
  }

  if (ledgerForm) {
    return (
      <div className="space-y-6">
        <ChartAccountForm
          fullPage
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          openModal={openModal}
          initialData={ledgerForm.mode === 'edit' ? ledgerForm.ledger : null}
          excludeGroupCategories={ledgerForm.mode === 'edit' ? [] : ['Customer', 'Vendor']}
          onClose={() => setLedgerForm(null)}
        />
      </div>
    );
  }

  if (selectedGroup) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => {
                setOpenMenu(null);
                setSelectedGroupId('');
                setGroupLedgerSearch('');
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <div className="min-w-0">
              <h1 className="ui-t-page">{selectedGroup.name}</h1>
              <p className="ui-muted ui-t-body mt-1">
                {selectedGroupLedgerRows.length} ledger{selectedGroupLedgerRows.length === 1 ? '' : 's'} under this group
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative">
              <Search size={16} className="ui-muted pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                className="ui-input w-64 ps-9"
                value={groupLedgerSearch}
                onChange={(event) => setGroupLedgerSearch(event.target.value)}
                placeholder="Search ledgers…"
                aria-label="Search ledgers in group"
              />
            </div>
            <button type="button" className="ui-btn ui-btn-primary" onClick={openNewLedger}>
              <Plus size={16} aria-hidden="true" /> New Ledger
            </button>
          </div>
        </div>

        <div className="ui-card overflow-hidden">
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Code</th>
                  <th scope="col">Group</th>
                  <th scope="col" className="text-right">Opening Balance</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {selectedGroupLedgerRows.length ? selectedGroupLedgerRows.map((ledger) => (
                  <tr key={ledger.id}>
                    <td className="ui-col-entity">
                      <button
                        type="button"
                        className="font-semibold text-left text-[rgb(var(--brand))] hover:underline"
                        onClick={() => onOpenLedger?.(String(ledger.id))}
                      >
                        {ledger.name}
                      </button>
                      {ledger.active === false ? <span className="ui-chip ml-2">Inactive</span> : null}
                    </td>
                    <td className="ui-col-meta ui-mono">{ledger.code || '—'}</td>
                    <td className="ui-col-meta ui-fg">{ledger._groupName || selectedGroup.name}</td>
                    <td className="ui-col-amount text-right">{formatMoney(Number(ledger.openingBalance || 0), currentCompany)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="ui-icon-btn"
                        aria-label={`Edit ${ledger.name}`}
                        onClick={() => openEditLedger(ledger)}
                      >
                        <MoreVertical size={18} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5">
                      <EmptyState
                        icon={BookOpen}
                        kind="new"
                        title={groupLedgerSearch ? 'No ledgers match' : 'No ledgers in this group'}
                        description={groupLedgerSearch ? 'Try another ledger name or code.' : 'Create a ledger and assign it to this group.'}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DocumentListShell
      entity="chartOfAccounts"
      title="Chart of Accounts"
      className="coa-list-page"
      company={currentCompany}
      search={
        coaView === 'ledgers'
          ? { value: ledgerSearch, onChange: setLedgerSearch, placeholder: 'Search ledgers…', label: 'Search ledgers' }
          : { value: groupSearch, onChange: setGroupSearch, placeholder: 'Search groups…', label: 'Search groups' }
      }
      moreItems={[
        { key: 'coa-import', label: 'Import Chart of Accounts', Icon: Upload },
        { key: 'coa-template', label: 'Download import template', Icon: FileText },
        exportMenuItem('Export Chart of Accounts'),
      ]}
      onMoreSelect={(k) => {
        if (k === 'coa-import') {
          coaImportInputRef.current?.click();
          return;
        }
        if (k === 'coa-template') {
          downloadChartTemplate();
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        exportChart(format);
      }}
      primary={
        coaView === 'ledgers' ? (
          <button type="button" onClick={openNewLedger} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Ledger
          </button>
        ) : (
          <button type="button" onClick={openNewGroup} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Group
          </button>
        )
      }
      tabs={[
        { value: 'ledgers', label: 'Ledgers', tone: 'all' },
        { value: 'groups', label: 'Groups', tone: 'sent' },
      ]}
      tabsLabel="Chart of Accounts view"
      statusInHeader
      statusValue={coaView}
      statusCounts={{ ledgers: ledgerRows.length, groups: groupRows.length }}
      onStatusChange={(value) => {
        setOpenMenu(null);
        setCoaView(value);
      }}
      above={
        <input
          ref={coaImportInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            if (file) importChart(file);
          }}
        />
      }
      tip={{
        storageKey: 'clor.tip.chartOfAccounts',
        Icon: BookOpen,
        text: 'A ledger belongs to a group, and the group decides which statement it lands on — the chart is what makes the reports add up.',
      }}
    >
      <div className="coa-list-body">
        {coaView === 'ledgers' ? (
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Ledger</th>
                  <th scope="col">Group</th>
                  <th scope="col">Parent</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {visibleLedgerRows.length === 0 ? (
                  <tr>
                    <td colSpan="4">
                      <EmptyState
                        icon={BookOpen}
                        kind="new"
      title={ledgerRows.length ? 'No ledgers match' : 'No ledgers yet'}
                        description={
                          ledgerRows.length
                            ? 'Nothing in this chart matches that search.'
                            : 'A ledger is what a posting lands in. Setting up the company creates the usual ones; add the rest as you need them.'
                        }
                        routes={
                          ledgerRows.length
                            ? undefined
                            : [
                                {
                                  label: 'Add a ledger',
                                  description: 'Name it and put it in the group it reports under.',
                                  onSelect: () => openNewLedger(),
                                },
                              ]
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  visibleLedgerRows.map((a) => {
                    const buttonKey = `ledger:${String(a.id)}`;
                    return (
                      <tr key={a.id}>
                        <td className="ui-col-entity">
                          <button
                            type="button"
                            onClick={() => onOpenLedger?.(String(a.id))}
                            className="font-semibold text-left text-[rgb(var(--brand-ink))] hover:underline"
                          >
                            {a.name}
                          </button>
                          {a.active === false ? <span className="ui-chip ml-2">Inactive</span> : null}
                        </td>
                        <td className="ui-col-meta ui-fg">{a._groupName || '-'}</td>
                        <td className="ui-col-meta ui-fg">{a._parent || '-'}</td>
                        <td
                          className="text-right"
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (openMenu?.buttonKey === buttonKey) {
                                setOpenMenu(null);
                              } else {
                                openRowMenu('ledger', a.id, e.currentTarget);
                              }
                            }}
                            className="coa-action-btn ui-hover-sunken inline-flex"
                            aria-label="Ledger actions"
                            data-coa-menu-button={buttonKey}
                          >
                            <MoreVertical size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky coa-table">
              <colgroup>
                <col style={{ width: '48%' }} />
                <col style={{ width: '44%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Parent</th>
                  <th scope="col" className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {visibleGroupRows.length === 0 ? (
                  <tr>
                    <td colSpan="3">
                      <EmptyState
                        icon={FolderTree}
                        kind="new"
      title={groupRows.length ? 'No groups match' : 'No groups yet'}
                        description={
                          groupRows.length
                            ? 'Nothing in this chart matches that search.'
                            : 'A group decides which statement its ledgers land on — Sundry Debtors on the balance sheet, Indirect Expenses on the P&L.'
                        }
                        routes={
                          groupRows.length
                            ? undefined
                            : [
                                {
                                  label: 'Add a group',
                                  description: 'Name it and say which parent it rolls up to.',
                                  onSelect: () => openNewGroup(),
                                },
                              ]
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  visibleGroupRows.map((g) => {
                    const buttonKey = `group:${String(g.id)}`;
                    return (
                      <tr key={g.id}>
                        <td className="ui-col-entity">
                          <button
                            type="button"
                            className="font-semibold text-left text-[rgb(var(--brand))] hover:underline"
                            onClick={() => {
                              setOpenMenu(null);
                              setSelectedGroupId(String(g.id));
                              setGroupLedgerSearch('');
                            }}
                          >
                            {g.name}
                          </button>
                        </td>
                        <td className="ui-col-meta ui-fg">{g._parent || '-'}</td>
                        <td
                          className="text-right"
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {g.isSystem ? (
                            <span className="ui-chip">Default</span>
                          ) : (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openMenu?.buttonKey === buttonKey) {
                                  setOpenMenu(null);
                                } else {
                                  openRowMenu('group', g.id, e.currentTarget);
                                }
                              }}
                              className="coa-action-btn ui-hover-sunken inline-flex"
                              aria-label="Group actions"
                              data-coa-menu-button={buttonKey}
                            >
                              <MoreVertical size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openMenu?.id ? (
        <div
          ref={menuRef}
          className="fixed w-48 ui-surface border ui-border-c rounded-xl shadow-lg overflow-hidden"
          style={{ left: openMenu.left, top: openMenu.top, zIndex: 'var(--z-popover)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          data-coa-menu
        >
          {(() => {
            if (openMenu.kind === 'ledger') {
              const ledger = ledgerRows.find((x) => String(x.id) === String(openMenu.id));
              if (!ledger) return null;
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      openEditLedger(ledger);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                  >
                    <span className="ui-muted">Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      setLedgerActive(ledger, ledger.active === false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                  >
                    <span>{ledger.active === false ? 'Reactivate' : 'Make inactive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      deleteLedger(ledger);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                  >
                    <span>Delete</span>
                  </button>
                </>
              );
            }

            const group = groupRows.find((x) => String(x.id) === String(openMenu.id));
            if (!group) return null;

            if (group.isSystem) return null;

            const editDisabled = false;
            const canDel = canDeleteGroup(group?.id);
            const deleteDisabled = !canDel.ok;

            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openEditGroup(group);
                  }}
                  disabled={editDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ editDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    deleteGroup(group);
                  }}
                  disabled={deleteDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ deleteDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken text-[rgb(var(--neg))]'
                  }`}
      title={deleteDisabled ? canDel.reason : ''}
                >
                  <span>Delete</span>
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </DocumentListShell>
  );
};


registerLedgerForm(ChartAccountForm);


const TrialBalance = ({ db, currentCompany, onOpenLedger }) => {
  const accounts = db.chartOfAccounts.filter((a) => a.companyId === currentCompany.id);
  const groups = db.accountGroups.filter((g) => g.companyId === currentCompany.id);
  const isDebitNature = (type) => ['Asset', 'Expense'].includes(String(type || '').trim());

  const rows = useMemo(() => {
    const groupById = new Map(groups.map((g) => [String(g.id), g]));
    return accounts.map((account) => {
      const bal = Number(account?.balance ?? 0);
      const debitNature = isDebitNature(account?.type);

      const debit = debitNature ? Math.max(0, bal) : Math.max(0, -bal);
      const credit = debitNature ? Math.max(0, -bal) : Math.max(0, bal);

      const groupName = account?.groupId ? String(groupById.get(String(account.groupId))?.name || '') : '';

      return {
        ...account,
        _group: groupName,
        _debit: round2(debit),
        _credit: round2(credit),
      };
    });
  }, [accounts, groups]);

  const totalDebit = rows.reduce((sum, r) => sum + Number(r._debit ?? 0), 0);
  const totalCredit = rows.reduce((sum, r) => sum + Number(r._credit ?? 0), 0);

  return (
    <div className="space-y-6">
      <h3 className="ui-t-sec">Trial Balance</h3>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Account</th>
              <th className="ui-th">Group</th>
              <th className="ui-th ui-num">Debit</th>
              <th className="ui-th ui-num">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((account) => (
              <tr key={account.id} className="ui-hover-sunken">
                <td className="px-4 py-2.5 ui-col-meta">
                  <button
                    type="button"
                    onClick={() => onOpenLedger && onOpenLedger(account.id)}
                    className="font-medium text-left hover:underline"
                  >
                    {account.name}
                  </button>
                </td>
                <td className="ui-col-meta px-4 py-2.5 ui-muted">{account._group || '-'}</td>
                <td className="ui-col-amount px-4 py-2.5 text-right">
                  {account._debit > 0 ? formatMoney(account._debit, currentCompany) : '-'}
                </td>
                <td className="ui-col-amount px-4 py-2.5 text-right">
                  {account._credit > 0 ? formatMoney(account._credit, currentCompany) : '-'}
                </td>
              </tr>
            ))}
            <tr className="ui-sunken font-bold border-t-2">
              <td className="px-4 py-2.5 ui-col-meta">TOTAL</td>
              <td className="ui-col-amount px-4 py-2.5" />
              <td className="ui-money px-4 py-2.5 text-right">{formatMoney(totalDebit, currentCompany)}</td>
              <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(totalCredit, currentCompany)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={`p-4 rounded-lg ${Math.abs(totalDebit - totalCredit) < 0.01 ? 'bg-[rgb(var(--pos-soft))]' : 'bg-[rgb(var(--neg-soft))]'}`}>
        <p className={`font-medium ${Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-[rgb(var(--pos))]' : 'text-[rgb(var(--neg))]'}`}>
          {Math.abs(totalDebit - totalCredit) < 0.01 ? '✓ Trial Balance is balanced' : '✗ Trial Balance is not balanced'}
        </p>
      </div>
    </div>
  );
};

// warehouses/activeWarehouseId are needed by the invoice, bill and note editors
// this view opens from a ledger row. They were referenced below without ever
// being props, so opening any of those editors from a ledger threw
// "warehouses is not defined" and the modal never appeared.
const LedgerView = ({
  db,
  setDb,
  currentCompany,
  ledgerId,
  onBack,
  openModal,
  warehouses = [],
  /* Carried through to the document forms opened from a row: both ask which
     branch the document belongs to, and a form handed none offers a branch
     list with nothing on it. */
  branches = [],
  activeWarehouseId = '',
}) => {
  const LEDGER_COLUMN_DEFS = [
    { key: 'date', label: 'Date', align: 'left' },
    { key: 'particulars', label: 'Particulars', align: 'left' },
    { key: 'voucherType', label: 'Vch Type', align: 'left' },
    { key: 'voucherNo', label: 'Vch No', align: 'left' },
    { key: 'narration', label: 'Narration', align: 'left' },
    { key: 'partyName', label: 'Party', align: 'left' },
    { key: 'partyGstin', label: 'GSTIN', align: 'left' },
    { key: 'partyPan', label: 'PAN', align: 'left' },
    { key: 'partyBillingAddress', label: 'Billing Address', align: 'left' },
    { key: 'partyShippingAddress', label: 'Shipping Address', align: 'left' },
    { key: 'placeOfSupply', label: 'Place of Supply', align: 'left' },
    { key: 'itemsSummary', label: 'Items', align: 'left' },
    { key: 'reference', label: 'Ref No', align: 'left' },
    { key: 'cashBank', label: 'Cash/Bank', align: 'left' },
    { key: 'taxable', label: 'Taxable', align: 'right' },
    { key: 'cgst', label: 'CGST', align: 'right' },
    { key: 'sgst', label: 'SGST', align: 'right' },
    { key: 'igst', label: 'IGST', align: 'right' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'debit', label: 'Debit', align: 'right' },
    { key: 'credit', label: 'Credit', align: 'right' },
    { key: 'runningBalance', label: 'Balance', align: 'right' },
  ];

  const DEFAULT_LEDGER_COLUMNS = ['date', 'particulars', 'voucherType', 'voucherNo', 'debit', 'credit', 'runningBalance'];

  const companyLedgerView =
    currentCompany?.docSettings?.ledgerView && typeof currentCompany.docSettings.ledgerView === 'object'
      ? currentCompany.docSettings.ledgerView
      : {};
  const columnsByLedgerId =
    companyLedgerView?.columnsByLedgerId && typeof companyLedgerView.columnsByLedgerId === 'object'
      ? companyLedgerView.columnsByLedgerId
      : {};

  const selectedColumnKeys = useMemo(() => {
    const raw = columnsByLedgerId?.[String(ledgerId)] || null;
    const keys = Array.isArray(raw) ? raw.map((k) => String(k || '').trim()).filter(Boolean) : [];
    return keys.length ? keys : DEFAULT_LEDGER_COLUMNS;
  }, [columnsByLedgerId, ledgerId]);

  const columnDefsByKey = useMemo(() => new Map(LEDGER_COLUMN_DEFS.map((c) => [c.key, c])), []);
  const visibleColumns = useMemo(() => {
    return selectedColumnKeys.map((k) => columnDefsByKey.get(k)).filter(Boolean);
  }, [selectedColumnKeys, columnDefsByKey]);

  const renderCell = (row, key) => {
    const r = row || {};
    const k = String(key || '').trim();

    const money = (n) => (Number(n ?? 0) ? formatMoney(Number(n ?? 0), currentCompany) : '-');

    /* The stored ISO date, read as this country writes it. Building a Date
       first parsed it as UTC midnight and rendered the day before west of
       Greenwich; the string never needed a Date at all. */
    if (k === 'date') return r?.date ? formatDateIn(r.date) : '-';
    if (k === 'particulars') {
      const showNarrationInline = !selectedColumnKeys.includes('narration');
      const showItemsInline = !selectedColumnKeys.includes('itemsSummary');
      return (
        <div>
          <div className="text-sm ui-fg">{r?.particulars || '-'}</div>
          {showNarrationInline && r?.narration ? <div className="text-xs ui-muted">{r.narration}</div> : null}
          {showItemsInline && r?.itemsSummary ? <div className="text-xs ui-muted">{r.itemsSummary}</div> : null}
        </div>
      );
    }
    if (k === 'voucherType') return r?.voucherType || '-';
    if (k === 'voucherNo') return r?.voucherNo || '-';
    if (k === 'narration') return r?.narration || '-';
    if (k === 'partyName') return r?.partyName || '-';
    if (k === 'partyGstin') return r?.partyGstin || '-';
    if (k === 'partyPan') return r?.partyPan || '-';
    if (k === 'partyBillingAddress') return r?.partyBillingAddress || '-';
    if (k === 'partyShippingAddress') return r?.partyShippingAddress || '-';
    if (k === 'placeOfSupply') return r?.placeOfSupply || '-';
    if (k === 'itemsSummary') return r?.itemsSummary || '-';
    if (k === 'reference') return r?.reference || '-';
    if (k === 'cashBank') return r?.cashBank || '-';

    if (['taxable', 'cgst', 'sgst', 'igst', 'total'].includes(k)) return money(r?.[k]);
    if (k === 'debit') return money(r?.debit);
    if (k === 'credit') return money(r?.credit);
    if (k === 'runningBalance') return formatMoney(Number(r?.runningBalance ?? 0), currentCompany);

    return r?.[k] !== undefined && r?.[k] !== null && String(r?.[k]).trim() ? String(r?.[k]) : '-';
  };
  // Row action will be shown via modal when a row is clicked

  const openRowActions = (row) => {
    if (!openModal) {
      const choice = window.prompt('Action: type view or edit', 'view');
      const c = String(choice || '').trim().toLowerCase();
      if (c === 'view') return handleView(row);
      if (c === 'edit') return handleEdit(row);
      return;
    }

    openModal(
      <div className="space-y-4">
        <div className="text-sm ui-muted">Choose action for this entry.</div>
        <div className="flex flex-col">
          <button type="button" onClick={() => { openModal(null); handleView(row); }} className="text-left px-3 py-2 ui-hover-sunken">View</button>
          <button type="button" onClick={() => { openModal(null); handleEdit(row); }} className="text-left px-3 py-2 ui-hover-sunken">Edit</button>
          {/* No Delete here. A ledger is a report: documents are deleted from
              their own lists, which refuse paid ones and update the server.
              This one removed any voucher from the browser's copy only. */}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => openModal(null)} className="ui-btn ui-btn-secondary">Close</button>
        </div>
      </div>
    );
  };

  const handleView = (row) => {
    if (!openModal) return notify.error('No modal handler available');
    openModal(
      <div className="space-y-4">
        <h4 className="ui-t-sec">Entry details</h4>
        <div className="text-sm ui-fg">
          <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(row, null, 2)}</pre>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => openModal(null)} className="ui-btn ui-btn-secondary">
            Close
          </button>
        </div>
      </div>
    );
  };

  const handleEdit = (row) => {
    const meta = row?.meta || {};
    const key = String(meta.voucherKey || '').trim();
    const id = meta.voucherId ?? meta.voucherId;
    /*
     * A line with no document behind it is shown, not edited. This used to
     * open a raw-JSON editor that wrote a one-line — unbalanced — journal
     * entry into the browser's copy of the books and nowhere else.
     */
    if (!key || !id) {
      handleView(row);
      return;
    }
    // If a dedicated form component exists, use it.
    if (key === 'invoice') {
      const inv = (Array.isArray(db.invoices) ? db.invoices : []).find((x) => String(x?.id) === String(id));
      // The same rule the invoice list applies before it opens an edit.
      const blocked = invoiceChangeBlockReason(db, currentCompany, inv, 'edit');
      if (blocked) {
        notify.error(blocked);
        return;
      }
      openModal(
        <InvoiceForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={inv}
          warehouses={warehouses}
          branches={branches}
          defaultWarehouseId={activeWarehouseId}
          onClose={() => openModal(null)}
        />
      );
      return;
    }
    if (key === 'bill') {
      const b = (Array.isArray(db.bills) ? db.bills : []).find((x) => String(x?.id) === String(id));
      openModal(
        <BillForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={b}
          warehouses={warehouses}
          branches={branches}
          defaultWarehouseId={activeWarehouseId}
          onClose={() => openModal(null)}
        />
      );
      return;
    }
    if (key === 'creditNote') {
      const cn = (Array.isArray(db.creditNotes) ? db.creditNotes : []).find((x) => String(x?.id) === String(id));
      openModal(
        <CreditNoteForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={cn}
          warehouses={warehouses}
          defaultWarehouseId={activeWarehouseId}
          onClose={() => openModal(null)}
        />
      );
      return;
    }
    if (key === 'debitNote') {
      const dn = (Array.isArray(db.debitNotes) ? db.debitNotes : []).find((x) => String(x?.id) === String(id));
      openModal(
        <DebitNoteForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={dn}
          warehouses={warehouses}
          branches={branches}
          defaultWarehouseId={activeWarehouseId}
          onClose={() => openModal(null)}
        />
      );
      return;
    }
    if (key === 'estimate') {
      const est = (Array.isArray(db.estimates) ? db.estimates : []).find((x) => String(x?.id) === String(id));
      openModal(<EstimateForm db={db} setDb={setDb} currentCompany={currentCompany} initialData={est} onClose={() => openModal(null)} />);
      return;
    }
    if (key === 'purchaseOrder') {
      const po = (Array.isArray(db.purchaseOrders) ? db.purchaseOrders : []).find((x) => String(x?.id) === String(id));
      openModal(<PurchaseOrderForm db={db} setDb={setDb} currentCompany={currentCompany} initialData={po} onClose={() => openModal(null)} />);
      return;
    }
    if (key === 'expense') {
      const ex = (Array.isArray(db.expenses) ? db.expenses : []).find((x) => String(x?.id) === String(id));
      openModal(<ExpenseForm db={db} setDb={setDb} currentCompany={currentCompany} openModal={openModal} onClose={() => openModal(null)} initialData={ex} />);
      return;
    }
    if (key === 'journalEntry') {
      const je = (Array.isArray(db.journalEntries) ? db.journalEntries : []).find((x) => String(x?.id) === String(id));
      openModal(<JournalEntryForm db={db} setDb={setDb} currentCompany={currentCompany} initialData={je} onClose={() => openModal(null)} />);
      return;
    }

    // Anything without its own form is shown read-only. The raw-JSON editor
    // that stood here changed amounts in the browser's copy and never
    // reached the server or the other side of the entry.
    handleView(row);
  };

  const statement = useMemo(() => {
    return buildLedgerStatement(db, currentCompany.id, ledgerId);
  }, [db, currentCompany.id, ledgerId]);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  // persist expanded groups per ledger in localStorage
  useEffect(() => {
    try {
      const key = `ledger_expanded_${String(ledgerId || '')}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExpandedGroups(new Set(arr));
      }
    } catch {
      // ignore
    }
  }, [ledgerId]);

  useEffect(() => {
    try {
      const key = `ledger_expanded_${String(ledgerId || '')}`;
      localStorage.setItem(key, JSON.stringify(Array.from(expandedGroups)));
    } catch {
      // ignore
    }
  }, [expandedGroups, ledgerId]);

  const account = statement?.account || null;
  const rows = Array.isArray(statement?.rows) ? statement.rows : [];
  const opening = Number(statement?.openingBalance ?? 0);

  // Apply period filter (from/to) to the rows while keeping running balances computed earlier
  const filteredRows = useMemo(() => {
    if (!filterFrom && !filterTo) return rows;
    const f = filterFrom ? new Date(filterFrom) : null;
    const t = filterTo ? new Date(filterTo) : null;
    if ((f && Number.isNaN(f.getTime())) || (t && Number.isNaN(t.getTime()))) return rows;
    return rows.filter((r) => {
      if (!r?.date) return false;
      const d = new Date(r.date);
      if (Number.isNaN(d.getTime())) return false;
      if (f && d.getTime() < f.getTime()) return false;
      if (t && d.getTime() > t.getTime()) return false;
      return true;
    });
  }, [rows, filterFrom, filterTo]);

  // Opening balance to show for the filtered view should be the running balance just before the first filtered row
  const openingForFiltered = useMemo(() => {
    if (!filterFrom && !filterTo) return opening;
    if (!filteredRows.length) {
      // If no rows in period, opening should be running balance before the period start
      if (!filterFrom) return opening;
      const f = new Date(filterFrom);
      if (Number.isNaN(f.getTime())) return opening;
      // find last row strictly before from
      const idx = rows.findIndex((r) => {
        const d = r?.date ? new Date(r.date) : null;
        return d && !Number.isNaN(d.getTime()) && d.getTime() >= f.getTime();
      });
      if (idx <= 0) return opening;
      return Number(rows[idx - 1]?.runningBalance ?? opening);
    }
    const first = filteredRows[0];
    const idx = rows.findIndex((r) => r._idx === first._idx || (r.date === first.date && r.particulars === first.particulars && r.debit === first.debit && r.credit === first.credit));
    if (idx <= 0) return opening;
    return Number(rows[idx - 1]?.runningBalance ?? opening);
  }, [filterFrom, filterTo, filteredRows, rows, opening]);

  // Must sit above the `!account` early return below: a hook skipped on the
  // "ledger not found" render changes the hook order, and React then throws
  // "rendered fewer hooks than expected" as soon as a ledger does resolve.
  const periodLabel = useMemo(() => {
    if (!filterFrom && !filterTo) return 'Period';
    /* `formatDateIn` is total — it hands back whatever it cannot parse — so the
       try/catch that guarded `new Date()` has nothing left to catch. */
    const fmt = (s) => (s ? formatDateIn(s) : '');
    if (filterFrom && filterTo) return `${fmt(filterFrom)} → ${fmt(filterTo)}`;
    if (filterFrom) return `From ${fmt(filterFrom)}`;
    return `To ${fmt(filterTo)}`;
  }, [filterFrom, filterTo]);

  if (!account) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="ui-t-sec">Ledger</h3>
          <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
            Back
          </button>
        </div>
        <div className="ui-surface border rounded-xl p-6 text-sm ui-muted">Ledger not found.</div>
      </div>
    );
  }

  // Use filtered rows (date filter applied) for display, totals and exports/print
  const displayRows = filteredRows;
  const totalDebit = displayRows.reduce((s, r) => s + Number(r?.debit ?? 0), 0);
  const totalCredit = displayRows.reduce((s, r) => s + Number(r?.credit ?? 0), 0);

  const closingForFiltered = displayRows.length ? Number(displayRows[displayRows.length - 1]?.runningBalance ?? 0) : openingForFiltered;
  const companyProfile = currentCompany?.profile?.companySettings || {};
  const companyAddressForLedger = [
    currentCompany?.address || companyProfile.regAddress1,
    companyProfile.regAddress2,
    currentCompany?.city || companyProfile.regCity,
    currentCompany?.state || companyProfile.regStateName,
    currentCompany?.pincode || companyProfile.regPincode,
    currentCompany?.country || companyProfile.regCountry,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
  const ledgerPeriodFrom = filterFrom || displayRows[0]?.date || '';
  const ledgerPeriodTo = filterTo || displayRows.at(-1)?.date || '';

  const doExport = (format) => {
    const payload = {
      companyName: companyProfile.legalName || currentCompany?.name || '',
      companyAddress: companyAddressForLedger,
      ledgerName: account?.name || '',
      periodFrom: ledgerPeriodFrom,
      periodTo: ledgerPeriodTo,
      openingBalance: openingForFiltered,
      closingBalance: closingForFiltered,
      rows: displayRows,
      columns: visibleColumns.map((c) => ({ key: c.key, label: c.label })),
    };

    if (format === 'pdf') {
      exportLedgerToPdf({ ...payload, fileName: `${account?.name || 'ledger'}.pdf` });
    } else if (format === 'excel') {
      exportLedgerToExcel({ ...payload, fileName: `${account?.name || 'ledger'}.xlsx` });
    }
  };

  const openExportChooser = () => {
    if (!openModal) {
      const choice = window.prompt('Export format: type PDF or Excel', 'PDF');
      const c = String(choice || '').trim().toLowerCase();
      if (c === 'pdf') doExport('pdf');
      else if (c === 'excel' || c === 'xlsx') doExport('excel');
      return;
    }

    openModal(
      <div className="space-y-4">
        <div className="text-sm ui-muted">Choose export format for this ledger.</div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              openModal(null);
              doExport('pdf');
            }}
            className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => {
              openModal(null);
              doExport('excel');
            }}
            className="ui-btn ui-btn-secondary"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => openModal(null)}
            className="ml-auto ui-btn ui-btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>,
      { title: 'Export Ledger', maxWidthClass: 'max-w-md' }
    );
  };

  const openPeriodModal = () => {
    if (!openModal) {
      const from = window.prompt('From date (YYYY-MM-DD)', filterFrom || '');
      const to = window.prompt('To date (YYYY-MM-DD)', filterTo || '');
      if (from !== null) setFilterFrom(String(from || ''));
      if (to !== null) setFilterTo(String(to || ''));
      return;
    }

    const PeriodModal = () => {
      const [draftFrom, setDraftFrom] = useState(filterFrom || '');
      const [draftTo, setDraftTo] = useState(filterTo || '');

      return (
        <div className="space-y-6">
          <div className="text-sm ui-muted">Select period for ledger entries.</div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="ui-label" htmlFor="app-from">From</label>
              <input id="app-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className="ui-input w-full" />
            </div>
            <div className="flex-1">
              <label className="ui-label" htmlFor="app-to">To</label>
              <input id="app-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className="ui-input w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => openModal(null)} className="ui-btn ui-btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterFrom(draftFrom);
                setFilterTo(draftTo);
                openModal(null);
              }}
              className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftFrom('');
                setDraftTo('');
                setFilterFrom('');
                setFilterTo('');
                openModal(null);
              }}
              className="ml-auto ui-btn ui-btn-secondary"
            >
              Clear
            </button>
          </div>
        </div>
      );
    };

    openModal(<PeriodModal />, { title: 'Period', maxWidthClass: 'max-w-md' });
  };

  return (
    <div className="ledger-statement-page space-y-3 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b ui-border-c pb-2">
        <div>
          <div className="text-sm font-semibold">{companyProfile.legalName || currentCompany?.name || 'Company'}</div>
          {companyAddressForLedger ? <div className="mt-0.5 text-xs ui-muted">{companyAddressForLedger}</div> : null}
          <h3 className="ui-t-sec mt-2">Ledger Statement of {account.name}</h3>
          <div className="mt-0.5 text-xs ui-muted">Period: {ledgerPeriodFrom ? formatDateIn(ledgerPeriodFrom) : 'Beginning'} to {ledgerPeriodTo ? formatDateIn(ledgerPeriodTo) : formatDateIn(localDateIso())}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary ui-btn-sm">
            Back
          </button>
          <button
            type="button"
            onClick={openPeriodModal}
            className="ui-btn ui-btn-secondary ui-btn-sm"
            title="Select period"
          >
            {periodLabel}
          </button>

          <button
            type="button"
            onClick={openExportChooser}
            className="ui-btn ui-btn-secondary ui-btn-sm"
          >
            <Download size={14} /> Export
          </button>

          <button
            type="button"
            onClick={() =>
              printLedger({
                companyName: companyProfile.legalName || currentCompany?.name || '',
                companyAddress: companyAddressForLedger,
                ledgerName: account?.name || '',
                periodFrom: ledgerPeriodFrom,
                periodTo: ledgerPeriodTo,
                openingBalance: openingForFiltered,
                closingBalance: closingForFiltered,
                rows: displayRows,
                columns: visibleColumns.map((c) => ({ key: c.key, label: c.label })),
              })
            }
            className="ui-btn ui-btn-secondary ui-btn-sm"
          >
            Print
          </button>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-3 text-xs font-medium ui-muted uppercase ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.label}
                </th>
              ))}
              {/* actions moved to row click modal */}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="ui-sunken">
              {visibleColumns.map((c) => {
                let content = '-';
                if (c.key === 'particulars') content = 'Opening Balance';
                if (c.key === 'runningBalance') content = formatMoney(openingForFiltered, currentCompany);
                return (
                  <td
                    key={c.key}
                    className={`px-4 py-3 text-sm ${c.align === 'right' ? 'text-right' : 'text-left'} ui-muted`}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
            {(() => {
              // Group ledger rows by voucher number (Vch No) primarily, with voucher type as context.
              // Fallback to meta.voucherKey:voucherId when voucherNo is missing.
              const groupsMap = new Map();
              displayRows.forEach((r, i) => {
                const meta = r?.meta || {};
                const vno = r?.voucherNo ? String(r.voucherNo).trim() : (meta.voucherNo ? String(meta.voucherNo).trim() : '');
                const vtype = r?.voucherType ? String(r.voucherType).trim() : (meta.voucherType ? String(meta.voucherType).trim() : '');
                let key;
                if (vno) key = `${vtype || 'v'}:${vno}`;
                else key = `${String(meta.voucherKey || 'row')}:${String(meta.voucherId ?? meta.reference ?? i)}`;
                if (!groupsMap.has(key)) groupsMap.set(key, []);
                groupsMap.get(key).push(r);
              });

              const groups = Array.from(groupsMap.entries()).map(([key, rows]) => {
                // Choose a representative row for the summary: pick the row with largest absolute amount (debit-credit)
                const representative = rows.reduce((best, x) => {
                  if (!best) return x;
                  const valX = Math.abs(Number(x.debit || 0) - Number(x.credit || 0));
                  const valBest = Math.abs(Number(best.debit || 0) - Number(best.credit || 0));
                  return valX > valBest ? x : best;
                }, rows[0]);
                const last = rows[rows.length - 1];
                const debit = rows.reduce((s, x) => s + Number(x.debit || 0), 0);
                const credit = rows.reduce((s, x) => s + Number(x.credit || 0), 0);
                return {
                  key,
                  rows,
                  date: representative?.date || rows[0]?.date,
                  particulars: representative?.particulars || rows[0]?.particulars,
                  voucherType: representative?.voucherType || rows[0]?.voucherType,
                  voucherNo: representative?.voucherNo || rows[0]?.voucherNo,
                  debit,
                  credit,
                  runningBalance: last.runningBalance,
                  meta: representative?.meta || rows[0]?.meta || {},
                };
              });

              return groups.map((g) => {
                const isExpanded = expandedGroups.has(g.key);
                return (
                  <React.Fragment key={g.key}>
                    <tr
                      className="ui-hover-sunken cursor-pointer"
                      onClick={() => {
                        const next = new Set(expandedGroups);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        setExpandedGroups(next);
                      }}
                      onDoubleClick={() => openRowActions(g.rows[0])}
                    >
                      {visibleColumns.map((c) => {
                        let content = '-';
                        if (c.key === 'date') content = g.date || '-';
                        else if (c.key === 'particulars') {
                          const party = g.meta?.partyName ? `${g.meta.partyName} • ${g.particulars || ''}` : g.particulars || '';
                          content = (
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-1 rounded-lg border ui-surface ui-muted" aria-hidden>
                                {isExpanded ? '▾' : '▸'}
                              </span>
                              <div className="truncate">{party}</div>
                            </div>
                          );
                        } else if (c.key === 'voucherType') content = `${g.voucherType || ''}`;
                        else if (c.key === 'debit') content = formatMoney(g.debit || 0, currentCompany);
                        else if (c.key === 'credit') content = formatMoney(g.credit || 0, currentCompany);
                        else if (c.key === 'runningBalance') content = formatMoney(Number(g.runningBalance ?? 0), currentCompany);
                        else content = renderCell(g.rows[0], c.key);

                        return (
                          <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : 'text-left'} text-sm ui-fg`}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (() => {
                      // Aggregate expanded rows by particulars so each account (Sales/CGST/SGST etc.) shows once
                      const aggMap = new Map();
                      g.rows.forEach((r) => {
                        const key = String(r.particulars || (r.meta && (r.meta.accountName || r.meta.account)) || 'line').trim();
                        if (!aggMap.has(key)) aggMap.set(key, []);
                        aggMap.get(key).push(r);
                      });

                      const aggs = Array.from(aggMap.entries()).map(([particulars, rows]) => {
                        const rep = rows[0];
                        const debit = rows.reduce((s, x) => s + Number(x.debit || 0), 0);
                        const credit = rows.reduce((s, x) => s + Number(x.credit || 0), 0);
                        const runningBalance = rows[rows.length - 1]?.runningBalance ?? rep.runningBalance ?? null;
                        return { particulars, rows, rep, debit, credit, runningBalance };
                      });

                      return aggs.map((a, ai) => (
                        <tr key={`${g.key}:agg:${ai}`} className="ui-sunken" data-entering="true">
                          {visibleColumns.map((c) => {
                            if (c.key === 'particulars') {
                              return (
                                <td key={c.key} className={`px-4 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'} text-sm ui-muted pl-6`}>
                                  <div>{a.particulars}</div>
                                </td>
                              );
                            }

                            if (c.key === 'debit') {
                              return (
                                <td key={c.key} className={`ui-money px-4 py-2 text-sm ui-muted text-right`}>{formatMoney(a.debit || 0, currentCompany)}</td>
                              );
                            }

                            if (c.key === 'credit') {
                              return (
                                <td key={c.key} className={`ui-money px-4 py-2 text-sm ui-muted text-right`}>{formatMoney(a.credit || 0, currentCompany)}</td>
                              );
                            }

                            if (c.key === 'runningBalance') {
                              return (
                                <td key={c.key} className={`ui-money px-4 py-2 text-sm ui-muted text-right`}>{a.runningBalance != null ? formatMoney(Number(a.runningBalance), currentCompany) : '-'}</td>
                              );
                            }

                            // For other columns, prefer representative row but strip item/narration details
                            const repRow = { ...(a.rep || {}), itemsSummary: undefined, narration: undefined };
                            return (
                              <td key={c.key} className={`px-4 py-2 ${c.align === 'right' ? 'text-right' : 'text-left'} text-sm ui-muted pl-6`}>
                                {renderCell(repRow, c.key)}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </React.Fragment>
                );
              });
            })()}
            <tr className="ui-sunken font-medium border-t-2">
              {visibleColumns.map((c, idx) => {
                if (c.key === 'debit') {
                  return (
                    <td key={c.key} className="ui-col-amount px-4 py-3 text-right">
                      {formatMoney(totalDebit, currentCompany)}
                    </td>
                  );
                }
                if (c.key === 'credit') {
                  return (
                    <td key={c.key} className="ui-col-amount px-4 py-3 text-right">
                      {formatMoney(totalCredit, currentCompany)}
                    </td>
                  );
                }
                if (c.key === 'runningBalance') {
                  return (
                    <td key={c.key} className="ui-col-amount px-4 py-3 text-right">
                      {formatMoney(Number(account?.balance ?? 0), currentCompany)}
                    </td>
                  );
                }
                if (idx === 0) {
                  return (
                    <td key={c.key} className="ui-col-meta px-4 py-3">
                      TOTAL
                    </td>
                  );
                }
                return <td key={c.key} className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`} />;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AccountingOverview = () => {
  return (
    <div className="ui-surface rounded-xl shadow-sm p-6 border">
      <h3 className="ui-t-sec mb-4">Accounting Module</h3>
      <p className="ui-muted">Select a sub-module from the sidebar</p>
    </div>
  );
};

const ProfitLoss = ({ db, currentCompany, onOpenLedger }) => {
  const accounts = db.chartOfAccounts.filter((a) => a.companyId === currentCompany.id);
  const groups = (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter((g) => g.companyId === currentCompany.id);
  const types = (Array.isArray(db.accountTypes) ? db.accountTypes : []).filter((t) => t.companyId === currentCompany.id);

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of types) m.set(String(t.id), t);
    return m;
  }, [db.accountTypes, currentCompany.id]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.id), g);
    return m;
  }, [db.accountGroups, currentCompany.id]);

  const withDerived = useMemo(() => {
    return accounts
      .map((a) => {
        const group = a?.groupId ? groupById.get(String(a.groupId)) : null;
        const typeRow = group?.typeId ? typeById.get(String(group.typeId)) : null;
        const derivedMain = String(typeRow?.main || a?.main || '').trim() || (['Income', 'Expense'].includes(String(a?.type || '').trim()) ? 'P&L' : 'Balance Sheet');
        const derivedClass = String(typeRow?.accountClass || a?.type || '').trim();
        return {
          ...a,
          _derivedMain: derivedMain,
          _derivedClass: derivedClass,
          _groupName: String(group?.name || '').trim(),
        };
      })
      .filter((a) => String(a._derivedMain || '').trim() === 'P&L');
  }, [accounts, groupById, typeById]);

  const incomeAccounts = useMemo(() => {
    return withDerived
      .filter((a) => String(a._derivedClass || '').trim() === 'Income')
      .slice()
      .sort((x, y) => {
        const gx = String(x._groupName || '');
        const gy = String(y._groupName || '');
        if (gx !== gy) return gx.localeCompare(gy);
        return String(x.name || '').localeCompare(String(y.name || ''));
      });
  }, [withDerived]);

  const expenseAccounts = useMemo(() => {
    return withDerived
      .filter((a) => String(a._derivedClass || '').trim() === 'Expense')
      .slice()
      .sort((x, y) => {
        const gx = String(x._groupName || '');
        const gy = String(y._groupName || '');
        if (gx !== gy) return gx.localeCompare(gy);
        return String(x.name || '').localeCompare(String(y.name || ''));
      });
  }, [withDerived]);

  const income = incomeAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const expenses = expenseAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const netProfit = income - expenses;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Profit & Loss Statement</h3>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-lg ui-hover-sunken">
          <Download size={16} /> Export PDF
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <div className="text-center mb-6">
          <h4 className="ui-t-sec">{currentCompany.name}</h4>
          <p className="text-sm ui-muted">Profit & Loss Statement</p>
          <p className="text-sm ui-muted">As of {formatDateIn(localDateIso())}</p>
        </div>

        <div className="space-y-4">
          <div>
            <h5 className="font-bold ui-fg mb-2">REVENUE</h5>
            {incomeAccounts.map((account) => (
                <div key={account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => onOpenLedger && onOpenLedger(account.id)} className="ui-muted text-left hover:underline">
                    {account.name}
                  </button>
                  <span className="ui-money">{formatMoney(account.balance || 0, currentCompany)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t mt-2 pt-2">
              <span>Total Income</span>
              <span className="ui-money">{formatMoney(income, currentCompany)}</span>
            </div>
          </div>

          <div>
            <h5 className="font-bold ui-fg mb-2">EXPENSES</h5>
            {expenseAccounts.map((account) => (
                <div key={account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => onOpenLedger && onOpenLedger(account.id)} className="ui-muted text-left hover:underline">
                    {account.name}
                  </button>
                  <span className="ui-money">{formatMoney(account.balance || 0, currentCompany)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t mt-2 pt-2">
              <span>Total Expenses</span>
              <span className="ui-money">{formatMoney(expenses, currentCompany)}</span>
            </div>
          </div>

          <div
            className={`ui-total-row border-t-2 pt-4 ${netProfit >= 0 ? 'text-[rgb(var(--pos))]' : 'text-[rgb(var(--neg))]'}`}
          >
            <span>NET PROFIT</span>
            <span className="ui-money">{formatMoney(netProfit, currentCompany)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const BalanceSheet = ({ db, currentCompany, onOpenLedger }) => {
  const accounts = db.chartOfAccounts.filter((a) => a.companyId === currentCompany.id);
  const groups = (Array.isArray(db.accountGroups) ? db.accountGroups : []).filter((g) => g.companyId === currentCompany.id);
  const types = (Array.isArray(db.accountTypes) ? db.accountTypes : []).filter((t) => t.companyId === currentCompany.id);

  const typeById = useMemo(() => {
    const m = new Map();
    for (const t of types) m.set(String(t.id), t);
    return m;
  }, [db.accountTypes, currentCompany.id]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(String(g.id), g);
    return m;
  }, [db.accountGroups, currentCompany.id]);

  const withDerived = useMemo(() => {
    return accounts.map((a) => {
      const group = a?.groupId ? groupById.get(String(a.groupId)) : null;
      const typeRow = group?.typeId ? typeById.get(String(group.typeId)) : null;
      const derivedMain = String(typeRow?.main || a?.main || '').trim() || (['Income', 'Expense'].includes(String(a?.type || '').trim()) ? 'P&L' : 'Balance Sheet');
      const derivedClass = String(typeRow?.accountClass || a?.type || '').trim();
      return {
        ...a,
        _derivedMain: derivedMain,
        _derivedClass: derivedClass,
      };
    });
  }, [accounts, groupById, typeById]);

  const balanceSheetAccounts = withDerived.filter((a) => String(a._derivedMain || '').trim() === 'Balance Sheet');
  const pnlAccounts = withDerived.filter((a) => String(a._derivedMain || '').trim() === 'P&L');

  const assets = balanceSheetAccounts.filter((a) => a._derivedClass === 'Asset').reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const liabilities = balanceSheetAccounts.filter((a) => a._derivedClass === 'Liability').reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const equity = balanceSheetAccounts.filter((a) => a._derivedClass === 'Equity').reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const income = pnlAccounts.filter((a) => a._derivedClass === 'Income').reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const expenses = pnlAccounts.filter((a) => a._derivedClass === 'Expense').reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const netProfit = income - expenses;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Balance Sheet</h3>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-lg ui-hover-sunken">
          <Download size={16} /> Export PDF
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <div className="text-center mb-6">
          <h4 className="ui-t-sec">{currentCompany.name}</h4>
          <p className="text-sm ui-muted">Balance Sheet</p>
          <p className="text-sm ui-muted">As of {formatDateIn(localDateIso())}</p>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div>
            <h5 className="font-bold ui-fg mb-3">ASSETS</h5>
            {balanceSheetAccounts
              .filter((a) => a._derivedClass === 'Asset')
              .map((account) => (
                <div key={account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => onOpenLedger && onOpenLedger(account.id)} className="ui-muted text-left hover:underline">
                    {account.name}
                  </button>
                  <span className="ui-money">{formatMoney(account.balance || 0, currentCompany)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t mt-2 pt-2">
              <span>Total Assets</span>
              <span className="ui-money">{formatMoney(assets, currentCompany)}</span>
            </div>
          </div>

          <div>
            <div className="mb-6">
              <h5 className="font-bold ui-fg mb-3">LIABILITIES</h5>
              {balanceSheetAccounts
                .filter((a) => a._derivedClass === 'Liability')
                .map((account) => (
                  <div key={account.id} className="flex justify-between py-1 pl-4">
                    <button type="button" onClick={() => onOpenLedger && onOpenLedger(account.id)} className="ui-muted text-left hover:underline">
                      {account.name}
                    </button>
                    <span className="ui-money">{formatMoney(account.balance || 0, currentCompany)}</span>
                  </div>
                ))}
              <div className="flex justify-between font-semibold border-t mt-2 pt-2">
                <span>Total Liabilities</span>
                <span className="ui-money">{formatMoney(liabilities, currentCompany)}</span>
              </div>
            </div>

            <div>
              <h5 className="font-bold ui-fg mb-3">EQUITY</h5>
              {balanceSheetAccounts
                .filter((a) => a._derivedClass === 'Equity')
                .map((account) => (
                  <div key={account.id} className="flex justify-between py-1 pl-4">
                    <button type="button" onClick={() => onOpenLedger && onOpenLedger(account.id)} className="ui-muted text-left hover:underline">
                      {account.name}
                    </button>
                    <span className="ui-money">{formatMoney(account.balance || 0, currentCompany)}</span>
                  </div>
                ))}
              <div className="flex justify-between py-1 pl-4">
                <span className="ui-muted">Current Year Profit / (Loss)</span>
                <span className={netProfit >= 0 ? 'text-[rgb(var(--pos))]' : 'text-[rgb(var(--neg))]'}>
                  {formatMoney(netProfit, currentCompany)}
                </span>
              </div>
              <div className="flex justify-between font-semibold border-t mt-2 pt-2">
                <span>Total Equity</span>
                <span className="ui-money">{formatMoney(equity + netProfit, currentCompany)}</span>
              </div>
            </div>

            <div className="ui-total-row border-t-2 mt-4 pt-2">
              <span>Total Liabilities & Equity</span>
              <span className="ui-money">{formatMoney(liabilities + equity + netProfit, currentCompany)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CashFlowStatement = ({ db, currentCompany }) => {
  const payments = (Array.isArray(db.payments) ? db.payments : []).filter((p) => p.companyId === currentCompany.id);

  const totals = useMemo(() => {
    const byKey = new Map();
    const add = (key, amount) => {
      const cur = Number(byKey.get(key) ?? 0);
      byKey.set(key, round2(cur + (Number.isFinite(amount) ? amount : 0)));
    };

    let inflow = 0;
    let outflow = 0;

    for (const p of payments) {
      const dir = String(p?.direction || '').trim().toUpperCase();
      const vt = String(p?.voucherType || '').trim().toLowerCase();
      const amt = Number(p?.amount ?? 0);
      if (!Number.isFinite(amt) || amt === 0) continue;

      if (dir === 'IN') {
        inflow += amt;
        add(vt === 'receipt' ? 'Receipts' : 'Customer Collections', amt);
      } else if (dir === 'OUT') {
        outflow += amt;
        if (vt === 'payment') add('Payments to Vendors', amt);
        else if (vt === 'expense') add('Payments for Expenses', amt);
        else if (vt === 'bill') add('Payments for Bills', amt);
        else add('Other Payments', amt);
      }
    }

    return {
      inflow: round2(inflow),
      outflow: round2(outflow),
      net: round2(inflow - outflow),
      lines: [...byKey.entries()].map(([label, amount]) => ({ label, amount })),
    };
  }, [payments]);

  const positiveLines = totals.lines.filter((l) => Number(l.amount ?? 0) > 0).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Cash Flow Statement</h3>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-lg ui-hover-sunken">
          <Download size={16} /> Export PDF
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <div className="text-center mb-6">
          <h4 className="ui-t-sec">{currentCompany.name}</h4>
          <p className="text-sm ui-muted">Cash Flow Statement</p>
          <p className="text-sm ui-muted">As of {formatDateIn(localDateIso())}</p>
          <p className="text-xs ui-muted mt-2">
            Based on recorded Receipts/Payments transactions.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <h5 className="font-bold ui-fg mb-2">CASH INFLOWS</h5>
            {positiveLines
              .filter((l) => l.label === 'Receipts' || l.label === 'Customer Collections')
              .map((l) => (
                <div key={l.label} className="flex justify-between py-1 pl-4">
                  <span className="ui-muted">{l.label}</span>
                  <span className="ui-money">{formatMoney(l.amount, currentCompany)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t mt-2 pt-2">
              <span>Total Inflows</span>
              <span className="ui-money">{formatMoney(totals.inflow, currentCompany)}</span>
            </div>
          </div>

          <div>
            <h5 className="font-bold ui-fg mb-2">CASH OUTFLOWS</h5>
            {positiveLines
              .filter((l) => !['Receipts', 'Customer Collections'].includes(l.label))
              .map((l) => (
                <div key={l.label} className="flex justify-between py-1 pl-4">
                  <span className="ui-muted">{l.label}</span>
                  <span className="ui-money">{formatMoney(l.amount, currentCompany)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t mt-2 pt-2">
              <span>Total Outflows</span>
              <span className="ui-money">{formatMoney(totals.outflow, currentCompany)}</span>
            </div>
          </div>

          <div className={`ui-total-row border-t-2 pt-4 ${totals.net >= 0 ? 'text-[rgb(var(--pos))]' : 'text-[rgb(var(--neg))]'}`}>
            <span>NET CASH FLOW</span>
            <span className="ui-money">{formatMoney(totals.net, currentCompany)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const SalesReports = ({ db, currentCompany }) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);

  return (
    <div className="space-y-6">
      <h3 className="ui-t-sec">Sales Reports</h3>

      <div className="grid grid-cols-2 gap-6">
        <div className="ui-surface rounded-xl shadow-sm p-6 border">
          <h4 className="font-bold mb-4">Sales by Status</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Draft</span>
              <span className="font-medium">{invoices.filter((i) => i.status === 'Draft').length}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid</span>
              <span className="font-medium">{invoices.filter((i) => i.status === 'Paid').length}</span>
            </div>
            <div className="flex justify-between">
              <span>Unpaid</span>
              <span className="font-medium">{invoices.filter((i) => i.status === 'Unpaid').length}</span>
            </div>
          </div>
        </div>

        <div className="ui-surface rounded-xl shadow-sm p-6 border">
          <h4 className="font-bold mb-4">Total Sales</h4>
          <p className="ui-money-lg ui-amount-pos">{formatMoney(invoices.reduce((sum, i) => sum + i.total, 0), currentCompany)}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * The reports hub, in the product's card language.
 *
 * Was a bare master-detail of text rows — the thinnest screen in the app
 * sitting on the richest data. Now every report is a tile: icon, name, and
 * one line saying what question it answers, grouped by category. Tiles are
 * clickable cards, so they take the hover lift.
 */
const ReportsOverview = ({ db, currentCompany, onNavigate, onExit, isEnabled, branches = [], warehouses = [], defaultBranchId = '', defaultWarehouseId = '' }) => (
  <ReportsWorkspace
    db={db}
    currentCompany={currentCompany}
    onNavigate={onNavigate}
    onExit={onExit}
    isEnabled={isEnabled}
    branches={branches}
    warehouses={warehouses}
    defaultBranchId={defaultBranchId}
    defaultWarehouseId={defaultWarehouseId}
  />
);

const TemplatePreview = ({ companyName, voucherLabel, templateId, accentBarClass }) => {
  const title = `${voucherLabel} Preview`;
  const header = (
    <div className="border rounded-lg overflow-hidden">
      <div className={`h-2 ${accentBarClass}`} />
      <div className="p-4 flex items-start justify-between">
        <div>
          <div className="ui-t-sec ui-fg">{companyName}</div>
          <div className="text-xs ui-muted">Document Template Preview</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{voucherLabel}</div>
          <div className="text-xs ui-muted">No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
          <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
        </div>
      </div>
    </div>
  );

  const rows = (
    <div className="border rounded-lg overflow-hidden">
      <table className="ui-table w-full">
        <thead className="ui-sunken border-b">
          <tr>
            <th className="ui-th">Item</th>
            <th className="ui-th ui-num">Qty</th>
            <th className="ui-th ui-num">Rate</th>
            <th className="ui-th ui-num">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr>
            <td className="px-3 py-2">Sample Item A</td>
            <td className="ui-col-meta px-3 py-2 text-right">1</td>
            <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
            <td className="ui-col-meta px-3 py-2 text-right font-medium">₹1,000</td>
          </tr>
          <tr>
            <td className="ui-col-meta px-3 py-2">Sample Item B</td>
            <td className="ui-col-meta px-3 py-2 text-right">2</td>
            <td className="ui-col-meta px-3 py-2 text-right">₹500</td>
            <td className="ui-col-meta px-3 py-2 text-right font-medium">₹1,000</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const totals = (
    <div className="border rounded-lg p-4 text-sm">
      <div className="flex justify-between">
        <span className="ui-muted">Subtotal</span>
        <span className="font-medium">₹2,000</span>
      </div>
      <div className="flex justify-between">
        <span className="ui-muted">GST</span>
        <span className="font-medium">₹360</span>
      </div>
      <div className="flex justify-between border-t mt-2 pt-2 font-bold">
        <span>Total</span>
        <span>₹2,360</span>
      </div>
    </div>
  );

  if (templateId === 'modern') {
    return (
      <div className="space-y-3">
        <div className="flex items-stretch gap-3">
          <div className={`w-2 rounded-lg ${accentBarClass}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs ui-muted">{title}</div>
            <div className="ui-title text-xl ui-fg">{voucherLabel}</div>
            <div className="text-sm ui-muted">{companyName}</div>
          </div>
          <div className="text-right text-sm ui-muted">
            <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
            <div>Date: {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'minimal') {
    return (
      <div className="space-y-3">
        <div className="border rounded-lg p-4">
          <div className="flex justify-between">
            <div>
              <div className="text-xs ui-muted">{companyName}</div>
              <div className="ui-t-sec">{voucherLabel}</div>
            </div>
            <div className="text-right text-xs ui-muted">
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'compact') {
    return (
      <div className="space-y-2">
        <div className="border rounded-lg overflow-hidden">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-3 flex items-start justify-between">
            <div>
              <div className="text-sm font-medium ui-fg">{companyName}</div>
              <div className="text-xs ui-muted">{title}</div>
            </div>
            <div className="text-right text-xs ui-muted">
              <div className="font-medium ui-fg">{voucherLabel}</div>
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'bold') {
    return (
      <div className="space-y-3">
        <div className={`rounded-lg p-4 text-white ${accentBarClass}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="ui-t-sec">{companyName}</div>
              <div className="text-xs opacity-90">{title}</div>
            </div>
            <div className="text-right text-xs opacity-95">
              <div className="text-sm font-medium">{voucherLabel}</div>
              <div>No: {voucherLabel.toUpperCase().slice(0, 3)}-0001</div>
              <div>Date: {new Date().toISOString().slice(0, 10)}</div>
            </div>
          </div>
        </div>
        {rows}
        {totals}
      </div>
    );
  }

  if (templateId === 'a5') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className="p-3 border-b border-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">(Sample address line 1, city, state - pincode)</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">ORIGINAL FOR RECIPIENT</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3">
            <div className="p-3 border-r border-gray-900">
              <div className="font-semibold">M/S</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">Address line…</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-3 border-r border-gray-900">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Challan No</div>
                <div>—</div>
                <div className="font-semibold">E-Way Bill No.</div>
                <div>—</div>
                <div className="font-semibold">Transport</div>
                <div>—</div>
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
                <div className="font-semibold">Challan Date</div>
                <div>—</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Name of Product / Service</th>
                  <th className="p-1 border-r border-gray-900">HSN/SAC</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Rate</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST %</th>
                  <th className="p-1 border-r border-gray-900">GST Amt</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹180</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t border-gray-900">
            <div className="p-3 col-span-2 border-r border-gray-900">
              <div className="font-semibold">Terms and Conditions</div>
              <div className="text-[10px] ui-fg">This is a sample A5 template preview.</div>
              <div className="mt-8 font-semibold">Customer Signature</div>
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable Amount</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-2 pt-2">
                <span>Total Amount</span>
                <span>₹2,360</span>
              </div>
              <div className="mt-6 text-[10px] ui-fg">This is a computer generated invoice.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Compact') {
    return (
      <div className="max-w-[620px] mx-auto text-[10px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className="p-2 border-b border-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-base font-extrabold">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Compact</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2">
            <div className="p-2 border-r border-gray-900">
              <div className="font-semibold">M/S Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-2">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Item</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 border-t border-gray-900">
            <div className="p-2 border-r border-gray-900">
              <div className="font-semibold">Terms</div>
              <div className="text-[10px] ui-fg">Computer generated invoice.</div>
            </div>
            <div className="p-2">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-1 pt-1">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Clean') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border border-gray-900">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-3 border-b border-gray-900">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-medium">{companyName}</div>
                <div className="text-[10px] ui-fg">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Clean</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3">
            <div className="p-3 border-r border-gray-900">
              <div className="font-semibold">M/S</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
            </div>
            <div className="p-3 border-r border-gray-900">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Invoice Date</div>
                <div>{new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Place of Supply</div>
                <div>Kerala (32)</div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-900">
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-900">
                  <th className="p-1 border-r border-gray-900">Sr</th>
                  <th className="p-1 border-r border-gray-900">Name</th>
                  <th className="p-1 border-r border-gray-900">HSN</th>
                  <th className="p-1 border-r border-gray-900">Qty</th>
                  <th className="p-1 border-r border-gray-900">Taxable</th>
                  <th className="p-1 border-r border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t border-gray-900">
            <div className="p-3 col-span-2 border-r border-gray-900">
              <div className="font-semibold">Customer Signature</div>
              <div className="mt-10" />
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t border-gray-900 mt-2 pt-2">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a5Boxed') {
    return (
      <div className="max-w-[620px] mx-auto text-[11px] leading-4 ui-fg">
        <div className="border-2 border-gray-900">
          <div className="p-3 border-b-2 border-gray-900">
            <div className="flex items-center justify-between">
              <div className="text-base font-medium">{companyName}</div>
              <div className="text-center">
                <div className="text-lg font-extrabold">TAX INVOICE</div>
                <div className="text-[10px] font-semibold">A5 Boxed</div>
              </div>
              <div className="text-right text-[10px]">
                <div className="font-semibold">GSTIN: 27ABCDE1234F1Z5</div>
                <div>Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-gray-900">
            <div className="p-3 border-r-2 border-gray-900">
              <div className="font-semibold">Bill To</div>
              <div className="font-semibold">Customer Name</div>
              <div className="text-[10px] ui-fg">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-[10px] ui-fg">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-x-2">
                <div className="font-semibold">Invoice No.</div>
                <div>GST-0001</div>
                <div className="font-semibold">Challan No.</div>
                <div>—</div>
              </div>
            </div>
          </div>

          <div>
            <table className="ui-table w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-900">
                  <th className="p-1 border-r-2 border-gray-900">Sr</th>
                  <th className="p-1 border-r-2 border-gray-900">Product / Service</th>
                  <th className="p-1 border-r-2 border-gray-900">HSN</th>
                  <th className="p-1 border-r-2 border-gray-900">Qty</th>
                  <th className="p-1 border-r-2 border-gray-900">Taxable</th>
                  <th className="p-1 border-r-2 border-gray-900">GST%</th>
                  <th className="p-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900">Sample Item A</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">8302</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">1</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-right">₹1,000</td>
                  <td className="ui-col-meta p-1 border-r-2 border-gray-900 text-center">18</td>
                  <td className="ui-col-meta p-1 text-right">₹1,180</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-3 border-t-2 border-gray-900">
            <div className="p-3 col-span-2 border-r-2 border-gray-900">
              <div className="font-semibold">Terms</div>
              <div className="text-[10px] ui-fg">Subject to jurisdiction.</div>
              <div className="mt-8 font-semibold">Customer Signature</div>
            </div>
            <div className="p-3">
              <div className="flex justify-between font-semibold">
                <span>Taxable</span>
                <span>₹2,000</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Tax</span>
                <span>₹360</span>
              </div>
              <div className="flex justify-between font-extrabold border-t-2 border-gray-900 mt-2 pt-2">
                <span>Total</span>
                <span>₹2,360</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4Modern') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="border rounded-lg overflow-hidden">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs ui-muted">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs ui-muted">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold ui-fg">A4 Modern</div>
                <div className="mt-2 text-xs ui-muted">Invoice No: GST-0001</div>
                <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Bill To</div>
                <div className="mt-1 font-semibold">Customer Name</div>
                <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
                <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Summary</div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="ui-muted">Taxable</span>
                  <span className="font-semibold">₹2,000</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="ui-muted">GST</span>
                  <span className="font-semibold">₹360</span>
                </div>
                <div className="flex justify-between text-sm border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">₹2,360</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden mt-6">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Sr</th>
                    <th className="ui-th">Product / Service</th>
                    <th className="ui-th">HSN/SAC</th>
                    <th className="ui-th ui-num">Qty</th>
                    <th className="ui-th ui-num">Rate</th>
                    <th className="ui-th ui-num">Taxable</th>
                    <th className="ui-th ui-num">GST%</th>
                    <th className="ui-th ui-num">GST Amt</th>
                    <th className="ui-th ui-num">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-3 py-2">1</td>
                    <td className="ui-col-meta px-3 py-2">Sample Item A</td>
                    <td className="ui-col-meta px-3 py-2">8302</td>
                    <td className="ui-col-meta px-3 py-2 text-right">1</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">18</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹180</td>
                    <td className="ui-col-meta px-3 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Terms</div>
                <div className="text-xs ui-muted mt-2">This is a computer generated invoice. Signature not required.</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4BoxedGst') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="border-2 border-gray-900 ui-surface">
          <div className={`h-2 ${accentBarClass}`} />
          <div className="p-6 border-b-2 border-gray-900">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs ui-muted">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs ui-muted">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold ui-fg">A4 Boxed GST Split</div>
                <div className="mt-2 text-xs ui-muted">Invoice No: GST-0001</div>
                <div className="text-xs ui-muted">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-gray-900">
            <div className="p-4 border-r-2 border-gray-900">
              <div className="text-xs font-semibold uppercase">Bill To</div>
              <div className="font-semibold mt-1">Customer Name</div>
              <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
              <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold uppercase">Totals</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="ui-muted">Taxable</div>
                <div className="text-right font-semibold">₹2,000</div>
                <div className="ui-muted">CGST</div>
                <div className="text-right font-semibold">₹180</div>
                <div className="ui-muted">SGST</div>
                <div className="text-right font-semibold">₹180</div>
                <div className="ui-muted">Total</div>
                <div className="text-right font-bold">₹2,360</div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="border-2 border-gray-900 overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b-2 border-gray-900">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">Sr</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">Item</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold border-r-2 border-gray-900">HSN</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Qty</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Rate</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">Taxable</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">GST%</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">CGST</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold border-r-2 border-gray-900">SGST</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">1</td>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">Sample Item A</td>
                    <td className="ui-col-meta px-2 py-2 border-r-2 border-gray-900">8302</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">1</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹1,000</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹1,000</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">18</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹90</td>
                    <td className="ui-col-meta px-2 py-2 text-right border-r-2 border-gray-900">₹90</td>
                    <td className="ui-col-meta px-2 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="border-2 border-gray-900 p-4">
                <div className="text-xs font-semibold uppercase">Terms</div>
                <div className="text-xs ui-muted mt-2">Subject to jurisdiction.</div>
              </div>
              <div className="border-2 border-gray-900 p-4">
                <div className="text-xs font-semibold uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === 'a4Letterhead') {
    return (
      <div className="max-w-[980px] mx-auto text-sm ui-fg">
        <div className="ui-surface border rounded-lg overflow-hidden">
          <div className={`p-6 ${accentBarClass} text-white`}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="text-2xl font-extrabold">{companyName}</div>
                <div className="text-xs opacity-95">(Sample address line 1, city, state - pincode)</div>
                <div className="text-xs opacity-95">GSTIN: 27ABCDE1234F1Z5</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tracking-wide">TAX INVOICE</div>
                <div className="text-xs font-semibold opacity-95">A4 Letterhead</div>
                <div className="mt-2 text-xs opacity-95">Invoice No: GST-0001</div>
                <div className="text-xs opacity-95">Date: {new Date().toISOString().slice(0, 10)}</div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Bill To</div>
                <div className="mt-1 font-semibold">Customer Name</div>
                <div className="text-xs ui-muted">GSTIN: 29ABCDE1234F1Z5</div>
                <div className="text-xs ui-muted">Place of Supply: Kerala (32)</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Summary</div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="ui-muted">Taxable</span>
                  <span className="font-semibold">₹2,000</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="ui-muted">GST</span>
                  <span className="font-semibold">₹360</span>
                </div>
                <div className="flex justify-between text-sm border-t mt-2 pt-2">
                  <span className="font-bold">Total</span>
                  <span className="font-bold">₹2,360</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Sr</th>
                    <th className="ui-th">Product / Service</th>
                    <th className="ui-th ui-num">Qty</th>
                    <th className="ui-th ui-num">Taxable</th>
                    <th className="ui-th ui-num">GST%</th>
                    <th className="ui-th ui-num">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="ui-col-meta px-3 py-2">1</td>
                    <td className="ui-col-meta px-3 py-2">Sample Item A</td>
                    <td className="ui-col-meta px-3 py-2 text-right">1</td>
                    <td className="ui-col-meta px-3 py-2 text-right">₹1,000</td>
                    <td className="ui-col-meta px-3 py-2 text-right">18</td>
                    <td className="ui-col-meta px-3 py-2 text-right font-semibold">₹1,180</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">Notes</div>
                <div className="text-xs ui-muted mt-2">This is a computer generated invoice. Signature not required.</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="text-xs font-semibold ui-fg uppercase">For {companyName}</div>
                <div className="mt-10 text-xs ui-muted">(Authorized Signatory)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {rows}
      {totals}
    </div>
  );
};

const MdmOverview = () => {
  return (
    <div className="ui-surface rounded-xl shadow-sm p-6 border">
      <h3 className="ui-t-sec mb-2">Master Data (MDM)</h3>
      <p className="ui-muted">Select a master from the sidebar</p>
    </div>
  );
};

const UomsList = ({ db, setDb, currentCompany }) => {
  const uoms = (db.uoms || [])
    .filter((u) => u.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const [newUom, setNewUom] = useState('');
  const uomSearch = useListSearch(uoms, ['name']);
  const visibleUoms = uomSearch.filtered;

  const addUom = async () => {
    const name = String(newUom || '').trim();
    if (!name) {
      notify.error('Please enter a UoM name.');
      return;
    }

    const exists = uoms.some((u) => String(u.name || '').trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      notify.error('This UoM already exists.');
      return;
    }

    const nextId = Math.max(0, ...(db.uoms || []).map((u) => Number(u.id) || 0)) + 1;
    // Every item carries a unit, so a unit list held in one browser meant a
    // second person could not enter the item at all.
    const serverPatch = await saveMaster('uoms', name);
    const next = { id: nextId, companyId: currentCompany.id, name, ...serverPatch };

    setDb({
      ...db,
      uoms: [...(db.uoms || []), next],
    });
    setNewUom('');
  };

  const deleteUom = async (id) => {
    const row = (db.uoms || []).find((u) => u.id === id);
    if (row) await removeMaster(row);
    setDb({
      ...db,
      uoms: (db.uoms || []).filter((u) => u.id !== id),
    });
  };

  return (
    <DocumentListShell
      entity="items"
      title="Units of Measure"
      compact
      tight
      className="master-item-list-page"
      headerPortalId="master-uoms-header-slot"
      company={currentCompany}
      search={{ value: uomSearch.query, onChange: uomSearch.setQuery, placeholder: 'Search units…', label: 'Search units' }}
      headerExtras={
        <input
          type="text"
          value={newUom}
          onChange={(e) => setNewUom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addUom(); }}
          className="ui-input ui-ctl-compact w-48"
          aria-label="Unit name"
          placeholder="New unit, e.g. Pcs"
        />
      }
      primary={<button type="button" onClick={addUom} className="ui-btn ui-btn-primary"><Plus size={15} /> Add unit</button>}
    >
        <div className="ui-table-scroll master-item-table-scroll">
          <table className={`ui-table ui-table-wide ui-table-sticky w-full ${visibleUoms.length ? '' : 'cash-bank-empty-table'}`}>
            <thead>
              <tr>
                <th>Unit</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {visibleUoms.length === 0 ? (
                <tr>
                  <td colSpan="2" className="px-6 py-10 text-center ui-muted">
                    {uoms.length ? 'No units match' : 'No units yet'}
                  </td>
                </tr>
              ) : (
                visibleUoms.map((u) => (
                  <tr key={u.id} className="ui-hover-sunken">
                    <td className="px-4 py-2.5 ui-col-entity">{u.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => deleteUom(u.id)} aria-label={`Delete unit ${u.name}`} title="Delete" className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </DocumentListShell>
  );
};

/**
 * Item categories — the master behind the Category field on an item.
 *
 * Categories used to be typed free-hand on each item, so the same shelf could
 * be spelled three ways and a category-level discount would miss two of them.
 * They live here now; the item form picks from this list (and can add to it).
 * Categories already typed on items are imported once, so nothing is lost.
 */
const ItemCategoriesList = ({ db, setDb, currentCompany }) => {
  const categories = (db.itemCategories || [])
    .filter((c) => c.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const items = (db.items || []).filter((i) => i.companyId === currentCompany.id);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, description }

  const catSearch = useListSearch(categories, ['name', 'description']);
  const catFilters = useColumnFilters();

  const countFor = (name) => {
    const key = String(name || '').trim().toLowerCase();
    return items.filter((i) => String(i.category || '').trim().toLowerCase() === key).length;
  };

  const rows = catFilters.apply(catSearch.filtered, {
    name: (c) => c.name,
    description: (c) => c.description || '',
    items: (c) => countFor(c.name),
  });

  // One-time import of whatever was already typed on items.
  const orphans = [
    ...new Set(
      items
        .map((i) => String(i.category || '').trim())
        .filter(Boolean)
        .filter((name) => !categories.some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase()))
    ),
  ];

  const importOrphans = () => {
    if (!orphans.length) return;
    let nextId = Math.max(0, ...(db.itemCategories || []).map((c) => Number(c.id) || 0));
    const added = orphans.map((name) => ({ id: ++nextId, companyId: currentCompany.id, name, description: '' }));
    // Written one at a time: a name that clashes on the server is refused on
    // its own rather than taking the whole import down with it.
    Promise.all(added.map((c) => saveMaster('itemCategories', c.name, { description: '' }))).then((patches) =>
      setDb((prev) => ({
        ...prev,
        itemCategories: (prev.itemCategories || []).map((c) => {
          const at = added.findIndex((a) => a.id === c.id);
          return at === -1 ? c : { ...c, ...patches[at] };
        }),
      }))
    );
    setDb({ ...db, itemCategories: [...(db.itemCategories || []), ...added] });
    notify.success(`${added.length} categor${added.length === 1 ? 'y' : 'ies'} imported from items.`);
  };

  const addCategory = async () => {
    const name = String(newName || '').trim();
    if (!name) {
      notify.error('Category name is required.');
      return;
    }
    if (categories.some((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase())) {
      notify.error('That category already exists.');
      return;
    }
    const nextId = Math.max(0, ...(db.itemCategories || []).map((c) => Number(c.id) || 0)) + 1;
    const description = String(newDescription || '').trim();
    const serverPatch = await saveMaster('itemCategories', name, { description });
    setDb({
      ...db,
      itemCategories: [
        ...(db.itemCategories || []),
        { id: nextId, companyId: currentCompany.id, name, description, ...serverPatch },
      ],
    });
    setNewName('');
    setNewDescription('');
    setCreating(false);
    notify.success(`Category "${name}" created.`);
  };

  const saveEdit = () => {
    const name = String(editing?.name || '').trim();
    if (!name) {
      notify.error('Category name is required.');
      return;
    }
    const clash = categories.some(
      (c) => Number(c.id) !== Number(editing.id) && String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (clash) {
      notify.error('Another category already has that name.');
      return;
    }
    const before = categories.find((c) => Number(c.id) === Number(editing.id));
    const oldName = String(before?.name || '').trim();
    if (before) pushMaster({ ...before, name, description: String(editing.description || '').trim() });

    setDb({
      ...db,
      itemCategories: (db.itemCategories || []).map((c) =>
        Number(c.id) === Number(editing.id) ? { ...c, name, description: String(editing.description || '').trim() } : c
      ),
      // Items carry the category by name, so a rename has to follow through.
      items: (db.items || []).map((i) =>
        i.companyId === currentCompany.id && String(i.category || '').trim().toLowerCase() === oldName.toLowerCase()
          ? { ...i, category: name }
          : i
      ),
    });
    setEditing(null);
    notify.success('Category updated.');
  };

  const deleteCategory = async (cat) => {
    const used = countFor(cat.name);
    const ok = await confirmDialog({
      title: 'Delete category',
      message: used
        ? `${used} item(s) use "${cat.name}". They keep the name on the item, but it will no longer be offered here.`
        : `Delete category "${cat.name}"?`,
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    await removeMaster(cat);
    setDb({ ...db, itemCategories: (db.itemCategories || []).filter((c) => Number(c.id) !== Number(cat.id)) });
  };

  return (
    <DocumentListShell
      entity="category"
      title="Item Categories"
      compact
      tight
      className="master-item-list-page"
      headerPortalId="master-itemCategories-header-slot"
      company={currentCompany}
      search={{
        value: catSearch.query,
        onChange: catSearch.setQuery,
        placeholder: 'Search categories…',
        label: 'Search categories',
      }}
      moreItems={[exportMenuItem('Export categories')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Item categories',
          fileName: `ItemCategories_${currentCompany?.name || 'company'}`,
          label: 'categor(y/ies)',
          columns: [
            { key: 'name', label: 'Category' },
            { key: 'description', label: 'Description' },
            { key: 'items', label: 'Items', value: (c) => countFor(c.name) },
          ],
          rows,
        });
      }}
      primary={
        <button type="button" onClick={() => setCreating((value) => !value)} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> Add category
        </button>
      }
      above={
        <>
          {orphans.length ? (
            <div className="rounded-xl border p-4 bg-[rgb(var(--warn-soft))] flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-[rgb(var(--warn-ink))]">
                {orphans.length} categor{orphans.length === 1 ? 'y is' : 'ies are'} typed on items but not in this master:{' '}
                {orphans.slice(0, 5).join(', ')}
                {orphans.length > 5 ? '…' : ''}
              </div>
              <button type="button" onClick={importOrphans} className="ui-btn ui-btn-primary ui-btn-sm text-xs">
                Import them
              </button>
            </div>
          ) : null}
        </>
      }
    >
      {/* Adding one is two fields and a button, so it lives at the top of the
          list it adds to rather than behind a form somewhere else. */}
      {creating ? <div className="grid grid-cols-1 md:grid-cols-6 gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
        <div className="md:col-span-2">
          <label className="ui-label" htmlFor="cat-name">Category name</label>
          <input
            id="cat-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="ui-input w-full"
            placeholder="e.g. Beverages, Spare Parts"
          />
        </div>
        <div className="md:col-span-3">
          <label className="ui-label" htmlFor="cat-description">Description</label>
          <input
            id="cat-description"
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="ui-input w-full"
            placeholder="Optional"
          />
        </div>
        <div className="flex items-end">
          <button type="button" onClick={addCategory} className="ui-btn ui-btn-secondary w-full">
            Add
          </button>
        </div>
      </div> : null}

        <div className="ui-table-scroll master-item-table-scroll">
          <table className={`ui-table ui-table-wide ui-table-sticky ${rows.length ? '' : 'cash-bank-empty-table'}`}>
            <thead>
              <tr>
                <ColumnHeader label="Category" col="name" state={catFilters} />
                <ColumnHeader label="Description" col="description" state={catFilters} />
                <ColumnHeader label="Items" col="items" state={catFilters} className="ui-num" align="right" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="4">
                    <EmptyState
                      icon={Tags}
                      kind="new"
      title="No categories yet"
                      description="Name the groups you sort your catalogue into — items pick from this list, and discount rules match on it."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const isEditing = Number(editing?.id) === Number(c.id);
                  return (
                    <tr key={c.id} className="ui-hover-sunken">
                      <td className="px-4 py-2.5 ui-col-entity">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            className="ui-input w-full px-2 ui-ctl-compact"
                          />
                        ) : (
                          <span>{c.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 ui-col-meta">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.description}
                            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                            className="ui-input w-full px-2 ui-ctl-compact"
                          />
                        ) : (
                          <span className="ui-muted">{c.description || '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right ui-num">{countFor(c.name)}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={saveEdit} className="ui-btn ui-btn-primary ui-btn-sm text-xs mr-2">
                              Save
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditing({ id: c.id, name: c.name, description: c.description || '' })}
                              className="ui-icon-btn mr-1"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCategory(c)}
                              className="ui-icon-btn text-[rgb(var(--neg))]"
                              aria-label={`Delete ${c.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      <TableTotals count={rows.length} totalCount={rows.length} noun="categories" />
    </DocumentListShell>
  );
};

const GstRatesList = ({ db, setDb, currentCompany }) => {
  const gstRates = (db.gstRates || [])
    .filter((r) => r.companyId === currentCompany.id)
    .slice()
    .sort((a, b) => Number(a.rate) - Number(b.rate));

  const [newRate, setNewRate] = useState('');
  const [newRateName, setNewRateName] = useState('');

  const addRate = async () => {
    const rate = Number(newRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      notify.error('Please enter a valid GST rate (0 to 100).');
      return;
    }

    const exists = gstRates.some((r) => Number(r.rate) === rate);
    if (exists) {
      notify.error('This GST rate already exists.');
      return;
    }

    const name = String(newRateName || '').trim() || `GST ${rate}%`;

    const nextId = Math.max(0, ...(db.gstRates || []).map((r) => Number(r.id) || 0)) + 1;
    const next = {
      id: nextId,
      companyId: currentCompany.id,
      rate,
      name,
    };

    // The named rate becomes a ledger of its own, so tax collected under it
    // is visible in the chart of accounts, not just inside document totals.
    const coa = Array.isArray(db.chartOfAccounts) ? db.chartOfAccounts : [];
    const ledgerExists = coa.some(
      (a) => a.companyId === currentCompany.id && String(a.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    const nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0) + 1;
    const dutiesGroup = (db.accountGroups || []).find(
      (g) => g.companyId === currentCompany.id && /duties|taxes/i.test(String(g.name || ''))
    );
    const rateLedger = ledgerExists
      ? null
      : {
          id: nextCoaId,
          companyId: currentCompany.id,
          code: `GST-${String(rate).replace('.', '_')}`,
          name,
          ledgerCategory: 'Tax',
          groupId: dutiesGroup?.id ?? null,
          type: 'Liability',
          subType: 'Duties & Taxes',
          main: 'Balance Sheet',
          balance: 0,
          gstRate: rate,
          createdAt: new Date().toISOString(),
        };

    // The rate is a reference list like any other: an invoice raised on
    // another machine has to be able to charge a rate this company added.
    const patch = await saveMaster('gstRates', name, { rate });

    setDb({
      ...db,
      gstRates: [...(db.gstRates || []), { ...next, ...patch }],
      ...(rateLedger ? { chartOfAccounts: [...coa, rateLedger] } : {}),
    });
    setNewRate('');
    setNewRateName('');
    notify.success(rateLedger ? `${name} added — ledger created under Duties & Taxes.` : `${name} added.`);
  };

  const deleteRate = async (id) => {
    await removeMaster((db.gstRates || []).find((r) => r.id === id));
    setDb({
      ...db,
      gstRates: (db.gstRates || []).filter((r) => r.id !== id),
    });
  };

  return (
    <DocumentListShell
      entity="gst"
      title="GST Rates"
      company={currentCompany}
      cards={[{ label: 'GST rates', value: gstRates.length, count: true, tone: 'draft', Icon: BadgePercent }]}
      denseCards
    >
        <div className="grid grid-cols-1 gap-2 border-b px-3 py-2 ui-border-c sm:grid-cols-[8rem_minmax(12rem,1fr)_auto]">
          <div>
            <input
              type="number"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="ui-input ui-ctl-compact w-full"
              min="0"
              max="100"
              step="0.01"
              aria-label="GST rate percent"
              placeholder="Rate %, e.g. 18"
            />
          </div>
          <div>
            <input
              type="text"
              value={newRateName}
              onChange={(e) => setNewRateName(e.target.value)}
              className="ui-input ui-ctl-compact w-full"
              aria-label="GST rate name"
              placeholder={Number(newRate) > 0 ? `Name, e.g. GST ${Number(newRate)}%` : 'Rate name, e.g. GST 18%'}
            />
          </div>
          <div>
            <button
              type="button"
              onClick={addRate}
              className="ui-btn ui-btn-primary ui-btn-sm w-full sm:w-auto"
            >
              <Plus size={15} /> Add rate
            </button>
          </div>
        </div>

        <div className="ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
          <table className="ui-table ui-table-wide ui-table-sticky w-full">
            <thead>
              <tr>
                <th>Rate</th>
                <th>Name</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {gstRates.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-6 py-10 text-center ui-muted">
                    No GST rates found
                  </td>
                </tr>
              ) : (
                gstRates.map((r) => (
                  <tr key={r.id} className="ui-hover-sunken">
                    <td className="px-4 py-2.5 ui-col-entity">{Number(r.rate)}%</td>
                    <td className="px-4 py-2.5 ui-col-meta">{r.name || `GST ${Number(r.rate)}%`}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => deleteRate(r.id)} aria-label={`Delete ${Number(r.rate)}% rate`} title="Delete" className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </DocumentListShell>
  );
};

const DocNumberingSettings = (props) => <NumberingDesigner key={props.currentCompany?.id || 'numbering'} {...props} />;

const DocTemplateSettings = ({ db, setDb, currentCompany }) => {
  const [docSettings, setDocSettings] = useState(() => getDocSettings(db, currentCompany));
  const [templatePreview, setTemplatePreview] = useState(null);

  useEffect(() => {
    setDocSettings(getDocSettings(db, currentCompany));
  }, [db, currentCompany]);

  const updateTemplateSetting = (voucherKey, patch) => {
    setDocSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [voucherKey]: {
          ...prev.templates[voucherKey],
          ...patch,
        },
      },
    }));
  };

  const handleSave = () => {
    setDb({
      ...db,
      companies: db.companies.map((c) =>
        c.id === currentCompany.id
          ? {
              ...c,
              docSettings,
            }
          : c
      ),
    });
    notify.success('Template settings saved.');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Templates</h3>
        <button onClick={handleSave} className="px-4 py-2 ui-btn ui-btn-primary rounded-lg">
          Save
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border space-y-4">
        <div>
          <h4 className="font-bold">Document Templates</h4>
          <p className="text-sm ui-muted">Choose a template and accent color for each voucher print layout.</p>
        </div>

        <div className="space-y-3">
          {VOUCHER_DEFS.map((v) => {
            const cfg = docSettings?.templates?.[v.key];
            const accent = ACCENT_OPTIONS.find((a) => a.id === cfg?.accentId) || ACCENT_OPTIONS[0];
            const templateName = TEMPLATE_OPTIONS.find((t) => t.id === cfg?.templateId)?.name || 'Classic';
            return (
              <div key={v.key} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{v.label}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm ui-muted">{templateName}</div>
                    <button
                      type="button"
                      onClick={() =>
                        setTemplatePreview({
                          voucherLabel: v.label,
                          templateId: cfg?.templateId || 'classic',
                          accentBarClass: accent.barClass,
                        })
                      }
                      className="px-3 py-1.5 border rounded-lg text-sm ui-hover-sunken"
                    >
                      Preview
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-template">Template</label>
                    <select id="app-template"
                      value={cfg?.templateId || 'classic'}
                      onChange={(e) => updateTemplateSetting(v.key, { templateId: e.target.value })}
                      className="ui-select w-full px-2 py-2"
                    >
                      {TEMPLATE_OPTIONS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="ui-label" htmlFor="app-accent-color">Accent Color</label>
                    <select id="app-accent-color"
                      value={cfg?.accentId || 'blue'}
                      onChange={(e) => updateTemplateSetting(v.key, { accentId: e.target.value })}
                      className="ui-select w-full px-2 py-2"
                    >
                      {ACCENT_OPTIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <div className="w-full border rounded-lg overflow-hidden">
                      <div className={`h-2 ${accent.barClass}`} />
                      <div className="p-2 text-xs ui-muted">Preview header bar</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {templatePreview && (
        <Modal onClose={() => setTemplatePreview(null)} title={`${templatePreview.voucherLabel} Template`} maxWidthClass="max-w-3xl">
          <TemplatePreview
            companyName={currentCompany?.name || ''}
            voucherLabel={templatePreview.voucherLabel}
            templateId={templatePreview.templateId}
            accentBarClass={templatePreview.accentBarClass}
          />
        </Modal>
      )}
    </div>
  );
};

const InvoiceTemplateSettings = (props) => <InvoiceTemplateDesigner key={props.currentCompany?.id || 'invoice-template'} {...props} />;

const CompanyProfile = ({ db, setDb, currentCompany }) => {
  const companyGstEnabled = Boolean(currentCompany?.profile?.taxCompliances?.gstEnabled ?? currentCompany?.gstEnabled ?? currentCompany?.gstin);
  const stateOptions = [
    'Andaman & Nicobar Islands',
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chandigarh',
    'Chhattisgarh',
    'Dadra & Nagar Haveli',
    'Daman & Diu',
    'Delhi',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jammu & Kashmir',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Ladakh',
    'Lakshadweep',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Puducherry',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
  ];

  const codeForStateName = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    for (const [code, stateName] of Object.entries(GST_STATE_BY_CODE || {})) {
      if (String(stateName || '').trim().toLowerCase() === trimmed.toLowerCase()) return code;
    }
    return '';
  };

  const seedCompanyForm = () => {
    const profile = getCompanyGstProfile(currentCompany);
    return {
      name: currentCompany?.name || '',
      currency: 'INR',
      gstRegistration: companyGstEnabled && String(profile.gstRegistration || '').toLowerCase() === 'unregistered' ? 'Registered' : (profile.gstRegistration || 'Registered'),
      gstin: profile.gstin || '',
      state: profile.state || '',
    };
  };

  // Keyed to the company and reset during render on a switch — the effect
  // that re-seeded it also wiped in-progress edits whenever anything in db
  // changed, which was a bug, not a feature.
  const [companyForm, setCompanyForm] = useState(() => ({ key: currentCompany?.id, value: seedCompanyForm() }));
  if (companyForm.key !== currentCompany?.id) {
    setCompanyForm({ key: currentCompany?.id, value: seedCompanyForm() });
  }
  const formData = companyForm.value;
  const setFormData = (updater) =>
    setCompanyForm((p) => ({ ...p, value: typeof updater === 'function' ? updater(p.value) : updater }));

  const handleSave = () => {
    const gstinNormalized = String(formData.gstin || '').trim().toUpperCase();
    if (companyGstEnabled && !gstinNormalized) return notify.error('GSTIN is mandatory while GST is enabled.');
    const stateFromGstin = getGstStateFromGstin(gstinNormalized);
    const nextState = stateFromGstin || String(formData.state || '').trim();

    setDb({
      ...db,
      companies: db.companies.map((c) =>
        c.id === currentCompany.id
          ? {
              ...c,
              name: formData.name,
              currency: 'INR',
              gstRegistration: formData.gstRegistration,
              gstin: gstinNormalized,
              state: nextState,
              country: c.country || 'India',
            }
          : c
      ),
    });

    notify.success('Company profile saved.');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">Company Profile</h3>
        <button onClick={handleSave} className="px-4 py-2 ui-btn ui-btn-primary rounded-lg">
          Save
        </button>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="ui-label" htmlFor="app-company-name">Company Name</label>
            <input id="app-company-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="ui-input w-full"
            />
          </div>

          <div>
            <label className="ui-label" htmlFor="app-currency">Currency</label>
            <input id="app-currency"
              type="text"
              value={formData.currency}
              readOnly
              className="ui-input w-full ui-sunken"
            />
          </div>

          <div>
            <label className="ui-label" htmlFor="app-gst-registration">GST Registration</label>
            <select id="app-gst-registration"
              value={formData.gstRegistration}
              onChange={(e) => setFormData((p) => ({ ...p, gstRegistration: e.target.value }))}
              className="ui-select w-full"
            >
              <option value="Registered">Registered</option>
              {!companyGstEnabled ? <option value="Unregistered">Unregistered</option> : null}
              <option value="Composition">Composition</option>
              <option value="SEZ">SEZ</option>
            </select>
          </div>

          <div>
            <label className="ui-label" htmlFor="app-gstin">GSTIN</label>
            <input id="app-gstin"
              type="text"
              value={formData.gstin}
              onChange={(e) => {
                const nextGstin = e.target.value;
                const stateFromGstin = getGstStateFromGstin(nextGstin);
                setFormData((p) => ({
                  ...p,
                  gstin: nextGstin,
                  state: stateFromGstin ? stateFromGstin : p.state,
                }));
              }}
              className="ui-input w-full"
              placeholder="e.g. 29ABCDE1234F1Z5"
            />
          </div>

          <div>
            <label className="ui-label">State</label>
            <PopupSelect
              label={null}
      title="Select State"
              value={formData.state}
              onChange={(next) => setFormData((p) => ({ ...p, state: next }))}
              options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
              placeholder="Select State"
            />
          </div>

          <div className="flex items-end">
            <div className="w-full text-sm ui-muted ui-sunken border rounded-lg px-3 py-2">
              Effective GST: {String(formData.state || '').trim() ? `${formData.state}` : 'Set state'}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

const TaxCompliancesView = ({ db, setDb, currentCompany }) => {
  const [saving, setSaving] = useState(false);

  const savedProfile = (currentCompany?.profile && typeof currentCompany.profile === 'object') ? currentCompany.profile : {};
  const savedTax = (savedProfile?.taxCompliances && typeof savedProfile.taxCompliances === 'object') ? savedProfile.taxCompliances : {};

  const stateOptions = Array.from(
    new Set(Object.values(GST_STATE_BY_CODE || {}).map((s) => String(s || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const codeForStateName = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    for (const [code, stateName] of Object.entries(GST_STATE_BY_CODE || {})) {
      if (String(stateName || '').trim().toLowerCase() === trimmed.toLowerCase()) return code;
    }
    return '';
  };

  const [gstEnabled, setGstEnabled] = useState(() => (savedTax?.gstEnabled ?? currentCompany?.gstEnabled ?? true) !== false);
  const [tdsEnabled, setTdsEnabled] = useState(() => Boolean(savedTax?.tds?.enabled ?? false));
  const [tcsEnabled, setTcsEnabled] = useState(() => Boolean(savedTax?.tcs?.enabled ?? false));

  const [gst, setGst] = useState(() => {
    const profile = getCompanyGstProfile(currentCompany);
    return {
      gstRegistration: profile.gstRegistration || 'Registered',
      gstin: profile.gstin || '',
      state: profile.state || '',
    };
  });

  const [tds, setTds] = useState(() => {
    const t = (savedTax?.tds && typeof savedTax.tds === 'object') ? savedTax.tds : {};
    return {
      registrationType: t.registrationType || 'Applicable',
      tan: t.tan || '',
      state: t.state || '',
      deductorName: t.deductorName || '',
      deductorType: t.deductorType || '',
      defaultNatureCode: t.defaultNatureCode || '',
    };
  });

  const [tcs, setTcs] = useState(() => {
    const t = (savedTax?.tcs && typeof savedTax.tcs === 'object') ? savedTax.tcs : {};
    return {
      registrationType: t.registrationType || 'Applicable',
      tan: t.tan || '',
      state: t.state || '',
    };
  });

  useEffect(() => {
    const profile = getCompanyGstProfile(currentCompany);
    const nextSavedProfile = (currentCompany?.profile && typeof currentCompany.profile === 'object') ? currentCompany.profile : {};
    const nextSavedTax = (nextSavedProfile?.taxCompliances && typeof nextSavedProfile.taxCompliances === 'object') ? nextSavedProfile.taxCompliances : {};
    setGst({
      gstRegistration: profile.gstRegistration || 'Registered',
      gstin: profile.gstin || '',
      state: profile.state || '',
    });
    setGstEnabled((nextSavedTax?.gstEnabled ?? currentCompany?.gstEnabled ?? true) !== false);
    setTdsEnabled(Boolean(nextSavedTax?.tds?.enabled ?? false));
    setTcsEnabled(Boolean(nextSavedTax?.tcs?.enabled ?? false));
    setTds({
      registrationType: nextSavedTax?.tds?.registrationType || 'Applicable',
      tan: nextSavedTax?.tds?.tan || '',
      state: nextSavedTax?.tds?.state || '',
    });
    setTcs({
      registrationType: nextSavedTax?.tcs?.registrationType || 'Applicable',
      tan: nextSavedTax?.tcs?.tan || '',
      state: nextSavedTax?.tcs?.state || '',
    });
  }, [currentCompany, db]);

  const saveAll = async () => {
    const gstReg = String(gst.gstRegistration || 'Registered').trim() || 'Registered';
    const gstinNormalized = String(gst.gstin || '').trim().toUpperCase();
    const stateFromGstin = getGstStateFromGstin(gstinNormalized);
    const nextGstState = stateFromGstin || String(gst.state || '').trim();

    const normalizedTdsTan = String(tds.tan || '').trim().toUpperCase();
    const normalizedTcsTan = String(tcs.tan || '').trim().toUpperCase();
    const nextTdsState = String(tds.state || '').trim();
    const nextTcsState = String(tcs.state || '').trim();

    if (gstEnabled) {
      if (!nextGstState) return notify.error('GST State is required when GST is enabled.');
      if (gstReg !== 'Unregistered' && !gstinNormalized) return notify.error('GSTIN is required for the selected GST Registration type.');
    }
    if (tdsEnabled) {
      if (!normalizedTdsTan) return notify.error('TDS TAN Number is required when TDS is enabled.');
      if (!nextTdsState) return notify.error('TDS State is required when TDS is enabled.');
    }
    if (tcsEnabled) {
      if (!normalizedTcsTan) return notify.error('TCS TAN Number is required when TCS is enabled.');
      if (!nextTcsState) return notify.error('TCS State is required when TCS is enabled.');
    }

    const nextTax = {
      ...(savedTax || {}),
      gstEnabled: Boolean(gstEnabled),
      tds: {
        enabled: Boolean(tdsEnabled),
        registrationType: String(tds.registrationType || 'Applicable').trim() || 'Applicable',
        tan: normalizedTdsTan,
        state: nextTdsState,
        /* The deductor, as the challan and the return need it named. */
        deductorName: String(tds.deductorName || '').trim(),
        deductorType: String(tds.deductorType || '').trim(),
        defaultNatureCode: String(tds.defaultNatureCode || '').trim().toUpperCase(),
      },
      tcs: {
        enabled: Boolean(tcsEnabled),
        registrationType: String(tcs.registrationType || 'Applicable').trim() || 'Applicable',
        tan: normalizedTcsTan,
        state: nextTcsState,
      },
    };

    setSaving(true);
    try {
      setDb({
        ...db,
        companies: (db.companies || []).map((c) =>
          c.id === currentCompany.id
            ? {
                ...c,
                gstEnabled: Boolean(gstEnabled),
                gstRegistration: gstReg,
                gstin: gstEnabled ? gstinNormalized : c.gstin,
                state: gstEnabled ? nextGstState : c.state,
                country: c.country || 'India',
                profile: {
                  ...(c?.profile && typeof c.profile === 'object' ? c.profile : {}),
                  taxCompliances: nextTax,
                },
              }
            : c
        ),
      });

      // NOTE: tax & compliance settings are stored locally only. The old
      // PUT /api/profile/company call was removed with the unused Sequelize
      // backend that served it; the live API has no such route, so the request
      // never reached a handler and its failure was never checked. A real
      // endpoint lands with the server-side company profile work.
      notify.success('Tax & compliances saved.');
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="ui-t-sec">Tax & Compliances</div>
          <div className="text-sm ui-muted">GST, TDS and TCS settings</div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveAll}
          className={`px-4 py-2 rounded-lg ${saving ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">GST</div>
            <div className="text-xs ui-muted">Enable GST and keep registration details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={gstEnabled}
              onChange={(e) => setGstEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!gstEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            GST is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-gst-registration-type">GST Registration Type</label>
              <select id="app-gst-registration-type"
                value={gst.gstRegistration}
                onChange={(e) => setGst((p) => ({ ...p, gstRegistration: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Registered">Registered</option>
                <option value="Unregistered">Unregistered</option>
                <option value="Composition">Composition</option>
                <option value="SEZ">SEZ</option>
              </select>
            </div>

            <div>
              <label className="ui-label" htmlFor="app-gst-number-gstin">GST Number (GSTIN)</label>
              <input id="app-gst-number-gstin"
                value={gst.gstin}
                onChange={(e) => {
                  const nextGstin = e.target.value;
                  const stateFromGstin = getGstStateFromGstin(nextGstin);
                  setGst((p) => ({
                    ...p,
                    gstin: nextGstin,
                    state: stateFromGstin ? stateFromGstin : p.state,
                  }));
                }}
                className="ui-input w-full"
                placeholder="e.g. 29ABCDE1234F1Z5"
              />
              <div className="text-xs ui-muted mt-1">State auto-fills from GSTIN (first 2 digits).</div>
            </div>

            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={gst.state}
                onChange={(next) => setGst((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>

            <div className="flex items-end">
              <div className="w-full text-sm ui-muted ui-sunken border rounded-lg px-3 py-2">
                Effective GST: {String(gst.state || '').trim() ? `${gst.state}` : 'Set state'}
              </div>
            </div>
          </div>
        )}
      </div>

      <EInvoiceSettings />

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">TDS</div>
            <div className="text-xs ui-muted">Enable TDS and keep TAN details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={tdsEnabled}
              onChange={(e) => setTdsEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!tdsEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            TDS is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-registration-type">Registration Type</label>
              <select id="app-registration-type"
                value={tds.registrationType}
                onChange={(e) => setTds((p) => ({ ...p, registrationType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Applicable">Applicable</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="app-tds-number-tan">TDS Number (TAN)</label>
              <input id="app-tds-number-tan"
                value={tds.tan}
                onChange={(e) => {
                  const next = e.target.value;
                  const maybeState = getGstStateFromGstin(next);
                  setTds((p) => ({ ...p, tan: next, state: maybeState ? maybeState : p.state }));
                }}
                className="ui-input w-full"
                placeholder="Enter TAN"
              />
            </div>
            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={tds.state}
                onChange={(next) => setTds((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>

            <div>
              <label className="ui-label" htmlFor="tds-deductor-name">Deductor name</label>
              <input
                id="tds-deductor-name"
                value={tds.deductorName}
                onChange={(e) => setTds((p) => ({ ...p, deductorName: e.target.value }))}
                className="ui-input w-full"
                placeholder={currentCompany?.name || 'As registered against the TAN'}
              />
              <div className="ui-caption mt-1">Printed on challans and carried into the quarterly return.</div>
            </div>

            <div>
              <label className="ui-label" htmlFor="tds-deductor-type">Deductor type</label>
              <select
                id="tds-deductor-type"
                value={tds.deductorType}
                onChange={(e) => setTds((p) => ({ ...p, deductorType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="">Select</option>
                <option value="COMPANY">Company</option>
                <option value="FIRM">Firm / LLP</option>
                <option value="INDIVIDUAL_HUF">Individual or HUF</option>
                <option value="GOVERNMENT">Government</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/*
              A default nature, for the ordinary case.
              Most companies deduct under one section far more often than the
              rest; naming it here means a bill against a vendor nobody has
              configured still knows what it is. A nature on the vendor, or on
              the document, still wins over it.
            */}
            <div className="sm:col-span-2">
              <label className="ui-label" htmlFor="tds-default-nature">Default TDS nature</label>
              <select
                id="tds-default-nature"
                value={tds.defaultNatureCode}
                onChange={(e) => setTds((p) => ({ ...p, defaultNatureCode: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="">— none —</option>
                {TDS_NATURES.filter((n) => n.active !== false).map((n) => (
                  <option key={n.code} value={n.code}>{n.name}</option>
                ))}
              </select>
              <div className="ui-caption mt-1">
                Used only where neither the document nor the party names one. The section, rate and threshold come from
                the rule in force on each document’s own date.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border rounded-xl p-5 shadow-sm ui-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold ui-fg">TCS</div>
            <div className="text-xs ui-muted">Enable TCS and keep TAN details</div>
          </div>
          <label className="flex items-center gap-2 text-sm ui-fg select-none">
            <input
              type="checkbox"
              checked={tcsEnabled}
              onChange={(e) => setTcsEnabled(e.target.checked)}
              className="ui-checkbox"
            />
            <span>Enabled</span>
          </label>
        </div>

        {!tcsEnabled ? (
          <div className="mt-4 text-sm ui-muted ui-sunken border rounded-lg px-3 py-3">
            TCS is disabled.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="ui-label" htmlFor="app-registration-type-2">Registration Type</label>
              <select id="app-registration-type-2"
                value={tcs.registrationType}
                onChange={(e) => setTcs((p) => ({ ...p, registrationType: e.target.value }))}
                className="ui-select w-full ui-surface"
              >
                <option value="Applicable">Applicable</option>
                <option value="Not Applicable">Not Applicable</option>
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="app-tcs-number-tan">TCS Number (TAN)</label>
              <input id="app-tcs-number-tan"
                value={tcs.tan}
                onChange={(e) => {
                  const next = e.target.value;
                  const maybeState = getGstStateFromGstin(next);
                  setTcs((p) => ({ ...p, tan: next, state: maybeState ? maybeState : p.state }));
                }}
                className="ui-input w-full"
                placeholder="Enter TAN"
              />
            </div>
            <div>
              <label className="ui-label">State</label>
              <PopupSelect
                label={null}
      title="Select State"
                value={tcs.state}
                onChange={(next) => setTcs((p) => ({ ...p, state: next }))}
                options={stateOptions.map((s) => ({ value: s, label: s, code: codeForStateName(s) }))}
                placeholder="Select State"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const GstRegistrationsSettings = ({ db, setDb, currentCompany }) => {
  const profile = currentCompany?.profile && typeof currentCompany.profile === 'object' ? currentCompany.profile : {};
  const tax = profile?.taxCompliances && typeof profile.taxCompliances === 'object' ? profile.taxCompliances : {};
  const primarySeed = {
    id: 'primary',
    primary: true,
    status: 'Active',
    registrationType: String(currentCompany?.gstRegistration || '').toLowerCase() === 'unregistered' ? 'Regular' : (currentCompany?.gstRegistration || 'Regular'),
    gstin: currentCompany?.gstin || '',
    state: currentCompany?.state || '',
    assesseeOtherTerritory: false,
    periodicity: 'Monthly',
    username: '',
    filingMode: 'Not Applicable',
    eInvoiceApplicable: false,
  };
  const savedRows = Array.isArray(tax.gstRegistrations) && tax.gstRegistrations.length ? tax.gstRegistrations : [primarySeed];
  const [rows, setRows] = useState(savedRows);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [menuId, setMenuId] = useState('');

  // Another company brings its own registrations. Reset while rendering, not
  // in an effect, so the previous company's rows never paint.
  const [rowsCompanyId, setRowsCompanyId] = useState(currentCompany?.id);
  if (rowsCompanyId !== currentCompany?.id) {
    setRowsCompanyId(currentCompany?.id);
    setRows(savedRows);
  }

  const stateOptions = useMemo(() => Array.from(new Set(Object.values(GST_STATE_BY_CODE || {}))).filter(Boolean).sort().map((state) => ({ value: state, label: state })), []);
  const visibleRows = rows.filter((row) => [row.gstin, row.state, row.registrationType, row.periodicity, row.status].some((value) => String(value || '').toLowerCase().includes(query.trim().toLowerCase())));

  const openRecord = (row, edit = false) => {
    setSelectedId(String(row.id));
    setDraft({ ...row });
    setEditing(edit);
    setMenuId('');
  };
  const closeDrawer = () => { setSelectedId(''); setDraft(null); setEditing(false); };
  const addRegistration = () => {
    const row = { ...primarySeed, id: `gst-${Date.now()}`, primary: false, gstin: '', state: '', registrationType: 'Regular' };
    setSelectedId(row.id); setDraft(row); setEditing(true);
  };
  const persist = (nextRows) => {
    const primary = nextRows.find((row) => row.primary) || nextRows[0];
    setRows(nextRows);
    setDb({
      ...db,
      companies: (db.companies || []).map((company) => company.id === currentCompany.id ? {
        ...company,
        gstEnabled: true,
        gstRegistration: primary?.registrationType || company.gstRegistration,
        gstin: primary?.gstin || company.gstin,
        state: primary?.state || company.state,
        profile: { ...(company.profile || {}), taxCompliances: { ...((company.profile || {}).taxCompliances || {}), gstEnabled: true, gstRegistrations: nextRows } },
      } : company),
    });
  };
  const saveDraft = () => {
    const gstin = String(draft?.gstin || '').trim().toUpperCase();
    const state = getGstStateFromGstin(gstin) || String(draft?.state || '').trim();
    if (!gstin) return notify.error('GSTIN is mandatory to enable GST.');
    if (!/^\d{2}[A-Z0-9]{13}$/.test(gstin) || !getGstStateFromGstin(gstin)) return notify.error('Enter a valid 15-character GSTIN.');
    if (!state) return notify.error('State is required.');
    const saved = { ...draft, gstin, state };
    const exists = rows.some((row) => String(row.id) === String(saved.id));
    persist(exists ? rows.map((row) => String(row.id) === String(saved.id) ? saved : row) : [...rows, saved]);
    notify.success('GST registration saved.');
    setEditing(false); setDraft(saved);
  };
  const removeRegistration = async (row) => {
    setMenuId('');
    if (row.primary) return notify.error('The primary GST registration cannot be deleted.');
    if (!await confirmDialog({ title: 'Delete GST registration?', message: `Delete ${row.gstin || 'this registration'}?`, confirmLabel: 'Delete' })) return;
    persist(rows.filter((item) => String(item.id) !== String(row.id)));
    if (String(selectedId) === String(row.id)) closeDrawer();
  };

  return (
    <div className="settings-branches gst-registration-settings space-y-3">
      <div className="branch-list-toolbar flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2">
        <div><div className="ui-t-sec">GST Registrations</div><div className="ui-caption">{visibleRows.length} {visibleRows.length === 1 ? 'registration' : 'registrations'}</div></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full max-w-xs"><Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 ui-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="ui-input w-full bg-[rgb(var(--surface))] ps-8" placeholder="Search GST registrations" /></div>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => exportRows({ fileName: 'GST Registrations', label: 'registration(s)', columns: [{ key: 'gstin', label: 'GSTIN' }, { key: 'state', label: 'State' }, { key: 'registrationType', label: 'Registration Type' }, { key: 'periodicity', label: 'Periodicity' }, { key: 'status', label: 'Status' }], rows: visibleRows })}><Download size={14} /> Export</button>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={addRegistration}><Plus size={14} /> Add Other GST</button>
        </div>
      </div>

      <div className="branch-table-wrap ui-surface border rounded-lg overflow-hidden">
        <table className="branch-table ui-table w-full table-fixed ui-settled">
          <colgroup><col style={{ width: '24%' }} /><col style={{ width: '19%' }} /><col style={{ width: '20%' }} /><col style={{ width: '17%' }} /><col style={{ width: '14%' }} /><col style={{ width: '6%' }} /></colgroup>
          <thead><tr><th className="ui-th">GSTIN</th><th className="ui-th">State</th><th className="ui-th">Registration Type</th><th className="ui-th">Periodicity</th><th className="ui-th ui-col-h-center">Status</th><th className="ui-th ui-num">Actions</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.id}>
            <td className="ui-td ui-mono"><button type="button" className="hover:underline" onClick={() => openRecord(row)}>{row.gstin || 'Add details'}</button></td>
            <td className="ui-td">{row.state || ''}</td><td className="ui-td">{row.registrationType || ''}</td><td className="ui-td">{row.periodicity || ''}</td>
            <td className="ui-td"><span className={row.status === 'Inactive' ? 'ui-pill ui-pill-neutral' : 'ui-pill ui-pill-pos'}>{row.status || 'Active'}</span></td>
            <td className="ui-td text-right relative"><button type="button" className="ui-icon-btn" aria-label={`Actions for ${row.gstin || row.state || 'GST registration'}`} onClick={() => setMenuId((current) => current === row.id ? '' : row.id)}><MoreVertical size={15} /></button>{menuId === row.id ? <div className="absolute end-9 top-1 z-30 w-44 rounded border bg-[rgb(var(--surface))] p-1 shadow-lg"><button type="button" className="report-menu-item flex items-center gap-2" onClick={() => openRecord(row, true)}><Pencil size={14} /> Edit</button><button type="button" className="report-menu-item flex items-center gap-2 text-[rgb(var(--neg))]" onClick={() => removeRegistration(row)}><Trash2 size={14} /> Delete</button></div> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {selectedId ? <button type="button" className="settings-drawer-backdrop" aria-label="Close GST details" onClick={closeDrawer} /> : null}
      {selectedId && draft ? <aside className="settings-side-drawer branch-detail-card space-y-3">
        <div className="settings-drawer-heading flex items-center justify-between"><div><div className="ui-t-sec">{editing ? (draft.primary ? 'GST Details' : 'Other GST Details') : 'GST Details'}</div><div className="ui-caption">Registration and filing information</div></div><div className="flex gap-2">{!editing ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button> : null}<button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={closeDrawer}>Close</button></div></div>
        {editing ? <div className="branch-editor-form space-y-3">
          <section className="branch-editor-section grid grid-cols-2 gap-3"><div className="branch-editor-section-title col-span-2">GST Registration Details</div>
            <div><label className="ui-label">Registration Status</label><select className="ui-select w-full" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Inactive</option></select></div>
            <div><label className="ui-label">Registration Type</label><select className="ui-select w-full" value={draft.registrationType} onChange={(event) => setDraft({ ...draft, registrationType: event.target.value })}><option>Regular</option><option>Composition</option><option>SEZ</option></select></div>
            <div><label className="ui-label">GSTIN/UIN</label><input className="ui-input ui-mono w-full" value={draft.gstin} maxLength={15} onChange={(event) => { const gstin = event.target.value.toUpperCase(); setDraft({ ...draft, gstin, state: getGstStateFromGstin(gstin) || draft.state }); }} /></div>
            <div><PopupSelect label="State" value={draft.state} onChange={(state) => setDraft({ ...draft, state })} options={stateOptions} placeholder="Select state" /></div>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={Boolean(draft.assesseeOtherTerritory)} onChange={(event) => setDraft({ ...draft, assesseeOtherTerritory: event.target.checked })} /> Assessee of Other Territory</label>
          </section>
          <section className="branch-editor-section grid grid-cols-2 gap-3"><div className="branch-editor-section-title col-span-2">Filing Details</div>
            <div><label className="ui-label">Periodicity of GSTR-1</label><select className="ui-select w-full" value={draft.periodicity} onChange={(event) => setDraft({ ...draft, periodicity: event.target.value })}><option>Monthly</option><option>Quarterly</option></select></div>
            <div><label className="ui-label">GST Username</label><input className="ui-input w-full" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></div>
            <div><label className="ui-label">Mode of Filing</label><select className="ui-select w-full" value={draft.filingMode} onChange={(event) => setDraft({ ...draft, filingMode: event.target.value })}><option>Not Applicable</option><option>Online</option><option>Offline</option></select></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="ui-checkbox" checked={Boolean(draft.eInvoiceApplicable)} onChange={(event) => setDraft({ ...draft, eInvoiceApplicable: event.target.checked })} /> e-Invoicing applicable</label>
          </section>
          <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={closeDrawer}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={saveDraft}>Save</button></div>
        </div> : <div className="grid grid-cols-2 gap-3">{[['Registration Status', draft.status], ['State', draft.state], ['Registration Type', draft.registrationType], ['GSTIN/UIN', draft.gstin], ['GSTR-1 Periodicity', draft.periodicity], ['GST Username', draft.username], ['Mode of Filing', draft.filingMode], ['e-Invoicing', draft.eInvoiceApplicable ? 'Yes' : 'No']].map(([label, value]) => <div key={label}><div className="ui-detail-label">{label}</div><div className="ui-detail-value">{value || ''}</div></div>)}</div>}
      </aside> : null}
    </div>
  );
};

export const SettingsView = ({ db, setDb, currentCompany, initialTab = 'company', showSidebar = true }) => {
  const [activeTab, setActiveTab] = useState(() => (String(initialTab || 'company') === 'tax' ? 'tax' : 'company'));
  /*
   * Company Profile sat permanently open as a form, while its two neighbours
   * under Organisation — Branches and Warehouses — show the record and put you
   * into a form only when you ask. Three screens describing the same kind of
   * thing behaved two different ways, and the one that mattered most was the
   * odd one out: a form that is always open is a screen you can change by
   * leaning on the keyboard.
   */
  const [editingCompany, setEditingCompany] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = String(initialTab || 'company');
    setActiveTab(next === 'tax' ? 'tax' : 'company');
  }, [initialTab]);

  const COMPANY_ENTITY_TYPES = ['Proprietorship', 'Partnership', 'Pvt Ltd', 'Ltd', 'LLP'];
  const INDUSTRY_OPTIONS = ['Retail', 'Manufacturing', 'Services'];
  const COUNTRY_OPTIONS = ['India'];
  const TZ_OPTIONS = ['Asia/Kolkata'];
  const CURRENCY_OPTIONS = ['INR'];

  const saved = (currentCompany && typeof currentCompany === 'object' ? currentCompany.profile : null) || {};
  const companySettings = (saved.companySettings && typeof saved.companySettings === 'object') ? saved.companySettings : {};

  const [form, setForm] = useState(() => ({
    companyName: companySettings.companyName || currentCompany?.name || '',
    legalName: companySettings.legalName || (currentCompany?.name || ''),
    tradeName: companySettings.tradeName || '',
    entityType: companySettings.entityType || 'Proprietorship',
    industries: Array.isArray(companySettings.industries) ? companySettings.industries : [],
    incorporationDate: companySettings.incorporationDate || '',
    financialYearStart: companySettings.financialYearStart || '',
    booksBeginDate: companySettings.booksBeginDate || '',
    baseCurrency: companySettings.baseCurrency || 'INR',
    country: companySettings.country || 'India',
    timeZone: companySettings.timeZone || 'Asia/Kolkata',

    officialEmail: companySettings.officialEmail || '',
    phone: companySettings.phone || '',
    website: companySettings.website || '',

    regAddress1: companySettings.regAddress1 || '',
    regAddress2: companySettings.regAddress2 || '',
    regCity: companySettings.regCity || '',
    regStateCode: companySettings.regStateCode || '',
    regPincode: companySettings.regPincode || '',
    regCountry: companySettings.regCountry || 'India',
    cin: companySettings.cin || '',
    pan: companySettings.pan || '',
    gstin: companySettings.gstin || currentCompany?.gstin || '',
    numberFormat: companySettings.numberFormat || '12,34,567.89',
    dateFormat: companySettings.dateFormat || 'DD-MM-YYYY',
    logo: companySettings.logo || currentCompany?.logo || '',
  }));

  useEffect(() => {
    const nextSaved = (currentCompany && typeof currentCompany === 'object' ? currentCompany.profile : null) || {};
    const nextCompanySettings = (nextSaved.companySettings && typeof nextSaved.companySettings === 'object') ? nextSaved.companySettings : {};
    setForm({
      companyName: nextCompanySettings.companyName || currentCompany?.name || '',
      legalName: nextCompanySettings.legalName || (currentCompany?.name || ''),
      tradeName: nextCompanySettings.tradeName || '',
      entityType: nextCompanySettings.entityType || 'Proprietorship',
      industries: Array.isArray(nextCompanySettings.industries) ? nextCompanySettings.industries : [],
      incorporationDate: nextCompanySettings.incorporationDate || '',
      financialYearStart: nextCompanySettings.financialYearStart || '',
      booksBeginDate: nextCompanySettings.booksBeginDate || '',
      baseCurrency: nextCompanySettings.baseCurrency || 'INR',
      country: nextCompanySettings.country || 'India',
      timeZone: nextCompanySettings.timeZone || 'Asia/Kolkata',
      officialEmail: nextCompanySettings.officialEmail || '',
      phone: nextCompanySettings.phone || '',
      website: nextCompanySettings.website || '',
      regAddress1: nextCompanySettings.regAddress1 || '',
      regAddress2: nextCompanySettings.regAddress2 || '',
      regCity: nextCompanySettings.regCity || '',
      regStateCode: nextCompanySettings.regStateCode || '',
      regPincode: nextCompanySettings.regPincode || '',
      regCountry: nextCompanySettings.regCountry || 'India',
      cin: nextCompanySettings.cin || '',
      pan: nextCompanySettings.pan || '',
      gstin: nextCompanySettings.gstin || currentCompany?.gstin || '',
      numberFormat: nextCompanySettings.numberFormat || '12,34,567.89',
      dateFormat: nextCompanySettings.dateFormat || 'DD-MM-YYYY',
      logo: nextCompanySettings.logo || currentCompany?.logo || '',
    });
  }, [currentCompany?.id]);

  const updateForm = async (patch) => setForm((p) => ({ ...p, ...patch }));

  const saveCompanySettings = async () => {
    const companyName = String(form.companyName || '').trim();
    const legalName = String(form.legalName || '').trim();
    const regAddress1 = String(form.regAddress1 || '').trim();
    const regCity = String(form.regCity || '').trim();
    const regStateCode = String(form.regStateCode || '').trim();
    const regPincode = String(form.regPincode || '').trim();
    const regCountry = String(form.regCountry || '').trim();

    if (!companyName) return notify.error('Company Name is required.');
    if (!legalName) return notify.error('Legal Name is required.');
    // Name the exact gap: "Registered Address is required" while the user is
    // looking at a filled address line reads as a broken form.
    const missing = [
      [!regAddress1, 'Address Line 1'],
      [!regCity, 'City'],
      [!regStateCode, 'State / UT'],
      [!regPincode, 'Pincode'],
      [!regCountry, 'Country'],
    ]
      .filter(([bad]) => bad)
      .map(([, label]) => label);
    if (missing.length) {
      return notify.error(`Registered address: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still empty.`);
    }

    const stateName = (GST_STATE_BY_CODE && regStateCode && GST_STATE_BY_CODE[regStateCode]) ? GST_STATE_BY_CODE[regStateCode] : '';

    const payload = {
      companyName,
      legalName,
      tradeName: String(form.tradeName || '').trim(),
      entityType: String(form.entityType || '').trim(),
      industries: Array.isArray(form.industries) ? form.industries : [],
      incorporationDate: form.incorporationDate || '',
      financialYearStart: form.financialYearStart || '',
      booksBeginDate: form.booksBeginDate || '',
      baseCurrency: String(form.baseCurrency || 'INR').trim(),
      country: String(form.country || 'India').trim(),
      timeZone: String(form.timeZone || 'Asia/Kolkata').trim(),
      officialEmail: String(form.officialEmail || '').trim(),
      phone: String(form.phone || '').trim(),
      website: String(form.website || '').trim(),
      regAddress1,
      regAddress2: String(form.regAddress2 || '').trim(),
      regCity,
      regStateCode,
      regStateName: stateName,
      regPincode,
      regCountry,
      cin: String(form.cin || '').trim(),
      pan: String(form.pan || '').trim().toUpperCase(),
      gstin: String(form.gstin || '').trim().toUpperCase(),
      numberFormat: String(form.numberFormat || '12,34,567.89').trim(),
      dateFormat: String(form.dateFormat || 'DD-MM-YYYY').trim(),
      logo: String(form.logo || ''),
    };

    setSaving(true);
    try {
      // Save to local DB
      setDb((prev) => {
        const companies = Array.isArray(prev?.companies) ? prev.companies : [];
        const nextCompanies = companies.map((c) => {
          if (Number(c?.id) !== Number(currentCompany?.id)) return c;
          const prevProfile = c?.profile && typeof c.profile === 'object' ? c.profile : {};
          return {
            ...c,
            name: companyName,
            // Mirror the fields every GST document reads. The profile blob is
            // the source of record for this page, but invoice/bill/note
            // creation checks company.state and company.gstin at the root —
            // saving here without mirroring left documents blocked on
            // "Company state not set" forever.
            state: stateName || c.state || '',
            // Same reason, and the rest of the address is not optional either.
            // The invoice and expense-voucher print blocks read these four keys
            // and nothing else, and the e-invoice payload falls back to the
            // literal '-' for Addr1 and 0 for Pin when they are blank — so a
            // company that filled this page in and saved it successfully was
            // still printing a GST invoice with no supplier address on it and
            // submitting a placeholder pincode to the IRP.
            address: [regAddress1, payload.regAddress2].filter(Boolean).join(', '),
            city: regCity,
            pincode: regPincode,
            country: regCountry,
            gstin: payload.gstin,
            logo: payload.logo,
            profile: {
              ...prevProfile,
              companySettings: payload,
            },
          };
        });
        return { ...prev, companies: nextCompanies };
      });

      // Local-only for now — see the note on the tax & compliances save above.
      notify.success('Company settings saved.');
    } catch {
      notify.error('Failed to save company settings.');
    } finally {
      setSaving(false);
    }
  };

  const UsersRoles = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [branches, setBranches] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [activeWarehouseId, setActiveWarehouseId] = useState(() => String(selectedWarehouseId() || ''));
    const [permCatalog, setPermCatalog] = useState([]);

    const [selectedUserId, setSelectedUserId] = useState(null);
    const [selectedRoleId, setSelectedRoleId] = useState(null);
    const [selectedBranchId, setSelectedBranchId] = useState(null);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState(null);

    const [permSearch, setPermSearch] = useState('');
    const [activeSection, setActiveSection] = useState('users'); // users | roles | branches | warehouses

    const [newUser, setNewUser] = useState(() => ({
      email: '',
      name: '',
      mobile: '',
      password: '',
      roleId: '',
    }));

    const [userEdit, setUserEdit] = useState(() => ({
      name: '',
      mobile: '',
      roleId: '',
      branchIds: [],
      warehouseIds: [],
    }));

    const [newRole, setNewRole] = useState(() => ({
      label: '',
      description: '',
      permissions: [],
    }));

    const [roleEdit, setRoleEdit] = useState(() => ({
      label: '',
      description: '',
      permissions: [],
    }));

    const [newBranch, setNewBranch] = useState(() => ({
      name: '',
      code: '',
      address: '',
    }));

    const [branchEdit, setBranchEdit] = useState(() => ({
      name: '',
      code: '',
      address: '',
      isActive: true,
    }));

    const [newWarehouse, setNewWarehouse] = useState(() => ({
      name: '',
      code: '',
      location: '',
      address: '',
      branchId: '',
    }));

    const [warehouseEdit, setWarehouseEdit] = useState(() => ({
      name: '',
      code: '',
      location: '',
      address: '',
      branchId: '',
      isActive: true,
    }));

    const backendCompanyId = resolveServerOrgId(currentCompany) || '';
    const token = localStorage.getItem('token');
    const orgId = String(platformOrgId() || '').trim();

    const authHeaders = useMemo(() => {
      return {
        Authorization: `Bearer ${token}`,
        'X-Company-Id': String(backendCompanyId),
        ...(orgId ? { 'x-org-id': orgId } : {}),
      };
    }, [token, backendCompanyId, orgId]);

    const loadAll = async () => {
      setLoading(true);
      setError('');
      try {
        const [uRes, rRes, bRes, wRes, pRes] = await Promise.all([
          fetch('/api/users/company', { headers: authHeaders }),
          fetch('/api/roles/company', { headers: authHeaders }),
          fetch('/api/branches/company', { headers: authHeaders }),
          fetch('/api/warehouses/company', { headers: authHeaders }),
          fetch('/api/roles/permissions', { headers: authHeaders }),
        ]);

        const readJson = async (res) => {
          const text = await res.text();
          return text ? JSON.parse(text) : null;
        };

        const [uData, rData, bData, wData, pData] = await Promise.all([
          readJson(uRes),
          readJson(rRes),
          readJson(bRes),
          readJson(wRes),
          readJson(pRes),
        ]);

        if (!uRes.ok) throw new Error((uData && uData.error) || `Users HTTP ${uRes.status}`);
        if (!rRes.ok) throw new Error((rData && rData.error) || `Roles HTTP ${rRes.status}`);
        if (!bRes.ok) throw new Error((bData && bData.error) || `Branches HTTP ${bRes.status}`);
        if (!wRes.ok) throw new Error((wData && wData.error) || `Warehouses HTTP ${wRes.status}`);
        if (!pRes.ok) throw new Error((pData && pData.error) || `Permissions HTTP ${pRes.status}`);

        setUsers(Array.isArray(uData?.users) ? uData.users : []);
        setRoles(Array.isArray(rData?.roles) ? rData.roles : []);
        setBranches(Array.isArray(bData?.branches) ? bData.branches : []);
        setWarehouses(Array.isArray(wData?.warehouses) ? wData.warehouses : []);
        setPermCatalog(Array.isArray(pData?.permissions) ? pData.permissions : []);
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (!currentCompany?.id) return;
      loadAll();
    }, [currentCompany?.id]);

    const selectedUser = useMemo(() => {
      if (!selectedUserId) return null;
      return users.find((u) => String(u.userId) === String(selectedUserId)) || null;
    }, [users, selectedUserId]);

    const selectedRole = useMemo(() => {
      if (!selectedRoleId) return null;
      return roles.find((r) => String(r.id) === String(selectedRoleId)) || null;
    }, [roles, selectedRoleId]);

    useEffect(() => {
      if (!selectedUser) {
        setUserEdit({ name: '', mobile: '', roleId: '', branchIds: [], warehouseIds: [] });
        return;
      }

      setUserEdit({
        name: selectedUser?.name || '',
        mobile: selectedUser?.mobile || '',
        roleId: selectedUser?.roleId != null ? String(selectedUser.roleId) : '',
        branchIds: Array.isArray(selectedUser?.branchIds) ? selectedUser.branchIds : [],
        warehouseIds: Array.isArray(selectedUser?.warehouseIds) ? selectedUser.warehouseIds : [],
      });
    }, [selectedUserId]);

    useEffect(() => {
      if (!selectedRole) {
        setRoleEdit({ label: '', description: '', permissions: [] });
        return;
      }
      setRoleEdit({
        label: selectedRole?.label || '',
        description: selectedRole?.description || '',
        permissions: Array.isArray(selectedRole?.permissions) ? selectedRole.permissions : [],
      });
    }, [selectedRoleId]);

    const selectedBranch = useMemo(() => {
      if (!selectedBranchId) return null;
      return branches.find((b) => String(b.id) === String(selectedBranchId)) || null;
    }, [branches, selectedBranchId]);

    const selectedWarehouse = useMemo(() => {
      if (!selectedWarehouseId) return null;
      return warehouses.find((w) => String(w.id) === String(selectedWarehouseId)) || null;
    }, [warehouses, selectedWarehouseId]);

    const activeWarehouse = useMemo(() => {
      if (!activeWarehouseId) return null;
      return warehouses.find((w) => String(w.id) === String(activeWarehouseId)) || null;
    }, [warehouses, activeWarehouseId]);

    useEffect(() => {
      if (!selectedBranch) {
        setBranchEdit({ name: '', code: '', address: '', isActive: true });
        return;
      }
      setBranchEdit({
        name: selectedBranch?.name || '',
        code: selectedBranch?.code || '',
        address: selectedBranch?.address || '',
        isActive: selectedBranch?.isActive !== false,
      });
    }, [selectedBranchId]);

    useEffect(() => {
      if (!selectedWarehouse) {
        setWarehouseEdit({ name: '', code: '', location: '', address: '', branchId: '', isActive: true });
        return;
      }
      setWarehouseEdit({
        name: selectedWarehouse?.name || '',
        code: selectedWarehouse?.code || '',
        location: selectedWarehouse?.location || '',
        address: selectedWarehouse?.address || '',
        branchId: selectedWarehouse?.branchId ? String(selectedWarehouse.branchId) : '',
        isActive: selectedWarehouse?.isActive !== false,
      });
    }, [selectedWarehouseId]);

    const filteredPerms = useMemo(() => {
      const q = String(permSearch || '').trim().toLowerCase();
      const list = Array.isArray(permCatalog) ? permCatalog : [];
      if (!q) return list;
      return list.filter((p) => {
        const k = String(p?.key || '').toLowerCase();
        const l = String(p?.label || '').toLowerCase();
        return k.includes(q) || l.includes(q);
      });
    }, [permCatalog, permSearch]);

    const createUser = async () => {
      setError('');
      const email = String(newUser.email || '').trim();
      const password = String(newUser.password || '');
      if (!email) return notify.error('Email is required.');
      if (password && password.length < 8) return notify.error('Password must be at least 8 characters.');

      try {
        const res = await fetch('/api/users/company-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            email,
            name: String(newUser.name || '').trim(),
            mobile: String(newUser.mobile || '').trim(),
            password: password ? password : undefined,
            roleId: newUser.roleId ? Number(newUser.roleId) : undefined,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewUser({ email: '', name: '', mobile: '', password: '', roleId: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserBasics = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ name: userEdit.name, mobile: userEdit.mobile }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserRole = async () => {
      if (!selectedUser) return;
      if (!userEdit.roleId) return notify.error('Select a role.');
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/role`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ roleId: Number(userEdit.roleId) }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserBranches = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/branches`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ branchIds: userEdit.branchIds }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveUserWarehouses = async () => {
      if (!selectedUser) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/warehouses`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ warehouseIds: userEdit.warehouseIds }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const removeUser = async () => {
      if (!selectedUser) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Remove ${selectedUser.email || 'this user'} from this company?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(selectedUser.userId))}/company`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedUserId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const createRole = async () => {
      setError('');
      const label = String(newRole.label || '').trim();
      if (!label) return notify.error('Role name is required.');

      try {
        const res = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ label, description: newRole.description || '', permissions: newRole.permissions }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewRole({ label: '', description: '', permissions: [] });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveRole = async () => {
      if (!selectedRole) return;
      if (selectedRole.isSystem) return;
      setError('');
      const label = String(roleEdit.label || '').trim();
      if (!label) return notify.error('Role name is required.');
      try {
        const res = await fetch(`/api/roles/${encodeURIComponent(String(selectedRole.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ label, description: roleEdit.description || '', permissions: roleEdit.permissions }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteRole = async () => {
      if (!selectedRole) return;
      if (selectedRole.isSystem) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete role "${selectedRole.label}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/roles/${encodeURIComponent(String(selectedRole.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedRoleId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    /* ---- Branch CRUD ---- */
    const createBranch = async () => {
      setError('');
      const name = String(newBranch.name || '').trim();
      if (!name) return notify.error('Branch name is required.');
      try {
        const res = await fetch('/api/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: newBranch.code || '',
            address: newBranch.address || '',
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewBranch({ name: '', code: '', address: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveBranch = async () => {
      if (!selectedBranch) return;
      setError('');
      const name = String(branchEdit.name || '').trim();
      if (!name) return notify.error('Branch name is required.');
      try {
        const res = await fetch(`/api/branches/${encodeURIComponent(String(selectedBranch.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: branchEdit.code || '',
            address: branchEdit.address || '',
            isActive: branchEdit.isActive,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteBranch = async () => {
      if (!selectedBranch) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete branch "${selectedBranch.name}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/branches/${encodeURIComponent(String(selectedBranch.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedBranchId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    /* ---- Warehouse CRUD ---- */
    const createWarehouse = async () => {
      setError('');
      const name = String(newWarehouse.name || '').trim();
      if (!name) return notify.error('Warehouse name is required.');
      try {
        const res = await fetch('/api/warehouses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: newWarehouse.code || '',
            location: newWarehouse.location || '',
            address: newWarehouse.address || '',
            branchId: newWarehouse.branchId ? Number(newWarehouse.branchId) : null,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setNewWarehouse({ name: '', code: '', location: '', address: '', branchId: '' });
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const saveWarehouse = async () => {
      if (!selectedWarehouse) return;
      setError('');
      const name = String(warehouseEdit.name || '').trim();
      if (!name) return notify.error('Warehouse name is required.');
      try {
        const res = await fetch(`/api/warehouses/${encodeURIComponent(String(selectedWarehouse.id))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            name,
            code: warehouseEdit.code || '',
            location: warehouseEdit.location || '',
            address: warehouseEdit.address || '',
            branchId: warehouseEdit.branchId ? Number(warehouseEdit.branchId) : null,
            isActive: warehouseEdit.isActive,
          }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const deleteWarehouse = async () => {
      if (!selectedWarehouse) return;
      const ok = await confirmDialog({ title: 'Please confirm', message: `Delete warehouse "${selectedWarehouse.name}"?`, confirmLabel: 'Yes, continue' });
      if (!ok) return;
      setError('');
      try {
        const res = await fetch(`/api/warehouses/${encodeURIComponent(String(selectedWarehouse.id))}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error((data && (data.error || data.details)) || `HTTP ${res.status}`);
        setSelectedWarehouseId(null);
        await loadAll();
      } catch (e) {
        setError(String(e?.message || e));
      }
    };

    const setActiveWarehouse = (warehouseId) => {
      const id = warehouseId ? String(warehouseId) : '';
      if (!id) {
        selectWarehouse('');
        setActiveWarehouseId('');
        return;
      }
      selectWarehouse(id);
      setActiveWarehouseId(id);
    };

    const roleOptions = roles.map((r) => ({ value: String(r.id), label: r.label }));
    const branchOptions = branches.map((b) => ({ value: String(b.id), label: b.name + (b.code ? ` (${b.code})` : '') }));

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="ui-t-sec">Users, Roles, Branches & Warehouses</div>
            <div className="text-sm ui-muted">Manage users, roles, branches and warehouses</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              {['users', 'roles', 'branches', 'warehouses'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSection(s)}
                  className={`px-3 py-2 text-sm capitalize ${activeSection === s ? 'ui-btn ui-btn-primary' : 'ui-surface ui-fg ui-hover-sunken'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={loadAll}
              className="ui-btn ui-btn-secondary"
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? <div className="ui-surface border rounded-xl p-4 text-sm text-[rgb(var(--neg))]">{error}</div> : null}

        {error ? <div className="ui-surface border rounded-xl p-4 text-sm text-[rgb(var(--neg))]">{error}</div> : null}

        {activeSection === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Users column */}
          <div className="ui-surface border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b ui-sunken">
              <div className="font-bold">Users</div>
              <div className="text-xs ui-muted">Company users and their assignments</div>
            </div>

            <div className="p-5 space-y-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Add / Attach User</div>
                <div className="text-xs ui-muted">If the email already exists, it will be attached to this company.</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-email">Email</label>
                    <input id="app-email"
                      value={newUser.email}
                      onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-name">Name</label>
                    <input id="app-name"
                      value={newUser.name}
                      onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-mobile">Mobile</label>
                    <input id="app-mobile"
                      value={newUser.mobile}
                      onChange={(e) => setNewUser((p) => ({ ...p, mobile: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-password-new-user">Password (new user)</label>
                    <input id="app-password-new-user"
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Min 8 chars"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="ui-label" htmlFor="app-role">Role</label>
                    <select id="app-role"
                      value={newUser.roleId}
                      onChange={(e) => setNewUser((p) => ({ ...p, roleId: e.target.value }))}
                      className="ui-select w-full ui-surface"
                    >
                      <option value="">Select role</option>
                      {roleOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={createUser}
                    className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
                  >
                    Add User
                  </button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">User List</div>
                <div className="max-h-64 overflow-auto">
                  <table className="ui-table w-full">
                    <thead className="ui-sunken border-b">
                      <tr>
                        <th className="ui-th">Name</th>
                        <th className="ui-th">Email</th>
                        <th className="ui-th">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {loading ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">Loading...</td></tr>
                      ) : users.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">No users found.</td></tr>
                      ) : (
                        users.map((u) => {
                          const active = String(u.userId) === String(selectedUserId);
                          return (
                            <tr
                              key={String(u.userId)}
                              className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`}
                              onClick={() => setSelectedUserId(String(u.userId))}
                            >
                              <td className="ui-col-entity px-4 py-3 ui-fg">{u.name || '-'}</td>
                              <td className="ui-col-entity px-4 py-3 ui-fg">{u.email || '-'}</td>
                              <td className="ui-col-meta px-4 py-3 ui-fg">{u.roleLabel || u.roleKey || '-'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Edit Selected User</div>
                {!selectedUser ? (
                  <div className="text-sm ui-muted mt-2">Select a user from the list to edit.</div>
                ) : (
                  <div className="space-y-3 mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="ui-label" htmlFor="app-email-2">Email</label>
                        <input id="app-email-2" value={selectedUser.email || ''} disabled className="ui-input w-full ui-sunken" />
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-role-2">Role</label>
                        <select id="app-role-2"
                          value={userEdit.roleId}
                          onChange={(e) => setUserEdit((p) => ({ ...p, roleId: e.target.value }))}
                          className="ui-select w-full ui-surface"
                        >
                          <option value="">Select role</option>
                          {roleOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <div className="mt-2 flex justify-end">
                          <button type="button" onClick={saveUserRole} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                            Save Role
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-name-2">Name</label>
                        <input id="app-name-2"
                          value={userEdit.name}
                          onChange={(e) => setUserEdit((p) => ({ ...p, name: e.target.value }))}
                          className="ui-input w-full"
                        />
                      </div>
                      <div>
                        <label className="ui-label" htmlFor="app-mobile-2">Mobile</label>
                        <input id="app-mobile-2"
                          value={userEdit.mobile}
                          onChange={(e) => setUserEdit((p) => ({ ...p, mobile: e.target.value }))}
                          className="ui-input w-full"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={saveUserBasics} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
                        Save User
                      </button>
                      <button type="button" onClick={removeUser} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                        Remove
                      </button>
                    </div>

                    <div className="border rounded-lg p-3">
                      <div className="text-sm font-semibold">Branches</div>
                      {branches.length === 0 ? (
                        <div className="text-sm ui-muted mt-2">No branches found.</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {branches.map((b) => {
                            const checked = userEdit.branchIds.includes(b.id);
                            return (
                              <label key={b.id} className="flex items-center gap-2 text-sm ui-fg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(userEdit.branchIds);
                                    if (e.target.checked) next.add(b.id);
                                    else next.delete(b.id);
                                    setUserEdit((p) => ({ ...p, branchIds: Array.from(next) }));
                                  }}
                                  className="ui-checkbox"
                                />
                                <span>{b.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={saveUserBranches} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                          Save Branches
                        </button>
                      </div>
                    </div>

                    <div className="border rounded-lg p-3">
                      <div className="text-sm font-semibold">Warehouses</div>
                      {warehouses.length === 0 ? (
                        <div className="text-sm ui-muted mt-2">No warehouses found.</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {warehouses.map((w) => {
                            const checked = userEdit.warehouseIds.includes(w.id);
                            return (
                              <label key={w.id} className="flex items-center gap-2 text-sm ui-fg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(userEdit.warehouseIds);
                                    if (e.target.checked) next.add(w.id);
                                    else next.delete(w.id);
                                    setUserEdit((p) => ({ ...p, warehouseIds: Array.from(next) }));
                                  }}
                                  className="ui-checkbox"
                                />
                                <span>{w.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={saveUserWarehouses} className="px-3 py-2 rounded-lg ui-surface border ui-hover-sunken">
                          Save Warehouses
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Roles column */}
          <div className="ui-surface border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b ui-sunken">
              <div className="font-bold">Roles</div>
              <div className="text-xs ui-muted">Create roles and assign permissions (matrix)</div>
            </div>

            <div className="p-5 space-y-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Create Role</div>
                <div className="grid grid-cols-1 gap-3 mt-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name">Role Name</label>
                    <input id="app-role-name"
                      value={newRole.label}
                      onChange={(e) => setNewRole((p) => ({ ...p, label: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="e.g. Sales Executive"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-permissions">Permissions</label>
                    <input id="app-permissions"
                      value={permSearch}
                      onChange={(e) => setPermSearch(e.target.value)}
                      className="ui-input w-full"
                      placeholder="Search permissions"
                    />
                    <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-2 ui-surface">
                      {filteredPerms.length === 0 ? (
                        <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                      ) : (
                        <div className="space-y-1">
                          {filteredPerms.map((p) => {
                            const key = String(p?.key || '').trim();
                            if (!key) return null;
                            const checked = newRole.permissions.includes(key);
                            return (
                              <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(newRole.permissions);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    setNewRole((prev) => ({ ...prev, permissions: Array.from(next) }));
                                  }}
                                  className="ui-checkbox mt-0.5"
                                />
                                <div>
                                  <div>{p.label || key}</div>
                                  <div className="text-xs ui-muted">{key}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={createRole}
                    className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}
                  >
                    Create Role
                  </button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Role List</div>
                <div className="max-h-56 overflow-auto">
                  <table className="ui-table w-full">
                    <thead className="ui-sunken border-b">
                      <tr>
                        <th className="ui-th">Role</th>
                        <th className="ui-th">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roles.length === 0 ? (
                        <tr><td colSpan={2} className="px-4 py-6 text-sm ui-muted">No roles found.</td></tr>
                      ) : (
                        roles.map((r) => {
                          const active = String(r.id) === String(selectedRoleId);
                          return (
                            <tr
                              key={String(r.id)}
                              className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`}
                              onClick={() => setSelectedRoleId(String(r.id))}
                            >
                              <td className="ui-col-meta px-4 py-3 ui-fg">{r.label}</td>
                              <td className="ui-col-meta px-4 py-3 ui-fg">{r.isSystem ? 'System' : 'Custom'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm font-semibold">Edit Selected Role</div>
                {!selectedRole ? (
                  <div className="text-sm ui-muted mt-2">Select a role from the list to edit.</div>
                ) : selectedRole.isSystem ? (
                  <div className="text-sm ui-muted mt-2">System roles cannot be edited here.</div>
                ) : (
                  <div className="space-y-3 mt-3">
                    <div>
                      <label className="ui-label" htmlFor="app-role-name-2">Role Name</label>
                      <input id="app-role-name-2"
                        value={roleEdit.label}
                        onChange={(e) => setRoleEdit((p) => ({ ...p, label: e.target.value }))}
                        className="ui-input w-full"
                      />
                    </div>

                    <div>
                      <label className="ui-label">Permissions</label>
                      <div className="mt-2 max-h-56 overflow-auto border rounded-lg p-2 ui-surface">
                        {filteredPerms.length === 0 ? (
                          <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                        ) : (
                          <div className="space-y-1">
                            {filteredPerms.map((p) => {
                              const key = String(p?.key || '').trim();
                              if (!key) return null;
                              const checked = roleEdit.permissions.includes(key);
                              return (
                                <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = new Set(roleEdit.permissions);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      setRoleEdit((prev) => ({ ...prev, permissions: Array.from(next) }));
                                    }}
                                    className="ui-checkbox mt-0.5"
                                  />
                                  <div>
                                    <div>{p.label || key}</div>
                                    <div className="text-xs ui-muted">{key}</div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={saveRole} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
                        Save Role
                      </button>
                      <button type="button" onClick={deleteRole} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {activeSection === 'roles' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Roles</div>
            <div className="text-xs ui-muted">Create and manage roles with permissions</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Role</div>
              <div className="grid grid-cols-1 gap-3 mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name-3">Role Name</label>
                    <input id="app-role-name-3"
                      value={newRole.label}
                      onChange={(e) => setNewRole((p) => ({ ...p, label: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="e.g. Sales Executive"
                    />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-description">Description</label>
                    <input id="app-description"
                      value={newRole.description}
                      onChange={(e) => setNewRole((p) => ({ ...p, description: e.target.value }))}
                      className="ui-input w-full"
                      placeholder="Optional description"
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-permissions-2">Permissions</label>
                  <input id="app-permissions-2"
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                    className="ui-input w-full"
                    placeholder="Search permissions"
                  />
                  <div className="mt-2 max-h-40 overflow-auto border rounded-lg p-2 ui-surface">
                    {filteredPerms.length === 0 ? (
                      <div className="text-sm ui-muted px-2 py-2">No permissions match.</div>
                    ) : (
                      <div className="space-y-1">
                        {filteredPerms.map((p) => {
                          const key = String(p?.key || '').trim();
                          if (!key) return null;
                          const checked = newRole.permissions.includes(key);
                          return (
                            <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                              <input type="checkbox" checked={checked} onChange={() => {
                                const next = new Set(newRole.permissions);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                setNewRole((prev) => ({ ...prev, permissions: Array.from(next) }));
                              }} className="ui-checkbox mt-0.5" />
                              <div>
                                <div>{p.label || key}</div>
                                <div className="text-xs ui-muted">{key}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createRole} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Role
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Role List</div>
              <div className="max-h-56 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Role</th>
                      <th className="ui-th">Description</th>
                      <th className="ui-th">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {roles.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-sm ui-muted">No roles found.</td></tr>
                    ) : (
                      roles.map((r) => {
                        const active = String(r.id) === String(selectedRoleId);
                        return (
                          <tr key={String(r.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedRoleId(String(r.id))}>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{r.label}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{r.description || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{r.isSystem ? 'System' : 'Custom'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedRole && !selectedRole.isSystem && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Role: {selectedRole.label}</div>
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="ui-label" htmlFor="app-role-name-4">Role Name</label>
                    <input id="app-role-name-4" value={roleEdit.label} onChange={(e) => setRoleEdit((p) => ({ ...p, label: e.target.value }))} className="ui-input w-full" />
                  </div>
                  <div>
                    <label className="ui-label" htmlFor="app-description-2">Description</label>
                    <input id="app-description-2" value={roleEdit.description} onChange={(e) => setRoleEdit((p) => ({ ...p, description: e.target.value }))} className="ui-input w-full" />
                  </div>
                </div>
                <div>
                  <label className="ui-label">Permissions</label>
                  <div className="mt-2 max-h-48 overflow-auto border rounded-lg p-2 ui-surface">
                    {filteredPerms.map((p) => {
                      const key = String(p?.key || '').trim();
                      if (!key) return null;
                      const checked = roleEdit.permissions.includes(key);
                      return (
                        <label key={key} className="flex items-start gap-2 text-sm ui-fg px-2 py-1 ui-hover-sunken rounded-lg">
                          <input type="checkbox" checked={checked} onChange={() => {
                            const next = new Set(roleEdit.permissions);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            setRoleEdit((prev) => ({ ...prev, permissions: Array.from(next) }));
                          }} className="ui-checkbox mt-0.5" />
                          <div>
                            <div>{p.label || key}</div>
                            <div className="text-xs ui-muted">{key}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={saveRole} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Role</button>
                  <button type="button" onClick={deleteRole} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {activeSection === 'branches' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Branches</div>
            <div className="text-xs ui-muted">Create and manage company branches</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Branch</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-branch-name">Branch Name *</label>
                  <input id="app-branch-name" value={newBranch.name} onChange={(e) => setNewBranch((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" placeholder="Main Branch" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code">Code</label>
                  <input id="app-code" value={newBranch.code} onChange={(e) => setNewBranch((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" placeholder="MAIN" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address">Address</label>
                  <input id="app-address" value={newBranch.address} onChange={(e) => setNewBranch((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" placeholder="123 Street..." />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createBranch} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Branch
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Branch List</div>
              <div className="max-h-64 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Name</th>
                      <th className="ui-th">Code</th>
                      <th className="ui-th">Address</th>
                      <th className="ui-th ui-col-h-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {branches.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-sm ui-muted">No branches found.</td></tr>
                    ) : (
                      branches.map((b) => {
                        const active = String(b.id) === String(selectedBranchId);
                        return (
                          <tr key={String(b.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedBranchId(String(b.id))}>
                            <td className="ui-col-entity px-4 py-3 ui-fg">{b.name}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{b.code || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{b.address || '-'}</td>
                            <td className="ui-col-meta px-4 py-3">{b.isActive !== false ? <span className="text-[rgb(var(--pos))]">Active</span> : <span className="text-[rgb(var(--neg))]">Inactive</span>}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedBranch && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Branch: {selectedBranch.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-branch-name-2">Branch Name *</label>
                  <input id="app-branch-name-2" value={branchEdit.name} onChange={(e) => setBranchEdit((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-2">Code</label>
                  <input id="app-code-2" value={branchEdit.code} onChange={(e) => setBranchEdit((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-2">Address</label>
                  <input id="app-address-2" value={branchEdit.address} onChange={(e) => setBranchEdit((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-status">Status</label>
                  <select id="app-status" value={branchEdit.isActive ? 'active' : 'inactive'} onChange={(e) => setBranchEdit((p) => ({ ...p, isActive: e.target.value === 'active' }))} className="ui-select w-full ui-surface">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={saveBranch} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Branch</button>
                <button type="button" onClick={deleteBranch} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {activeSection === 'warehouses' && (
        <div className="ui-surface border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b ui-sunken">
            <div className="font-bold">Warehouses</div>
            <div className="text-xs ui-muted">Create and manage warehouses (can be linked to branches)</div>
          </div>
          <div className="p-5 space-y-4">
            <div className="border rounded-xl p-4 ui-surface">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Active Warehouse (request header)</div>
                  <div className="text-xs ui-muted">
                    {activeWarehouse ? `${activeWarehouse.name} (ID ${activeWarehouse.id})` : 'Not set; requests will omit x-warehouse-id.'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedWarehouse) {
                        notify.error('Select a warehouse from the list first.');
                        return;
                      }
                      setActiveWarehouse(selectedWarehouse.id);
                    }}
                    className="px-3 py-2 rounded-lg ui-btn ui-btn-primary"
                  >
                    Use selected
                  </button>
                  {activeWarehouseId ? (
                    <button
                      type="button"
                      onClick={() => setActiveWarehouse('')}
                      className="px-3 py-2 rounded-lg border ui-surface ui-hover-sunken"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Create Warehouse</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-warehouse-name">Warehouse Name *</label>
                  <input id="app-warehouse-name" value={newWarehouse.name} onChange={(e) => setNewWarehouse((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" placeholder="Main Warehouse" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-3">Code</label>
                  <input id="app-code-3" value={newWarehouse.code} onChange={(e) => setNewWarehouse((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" placeholder="WH-001" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-location">Location</label>
                  <input id="app-location" value={newWarehouse.location} onChange={(e) => setNewWarehouse((p) => ({ ...p, location: e.target.value }))} className="ui-input w-full" placeholder="City, Zone..." />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-3">Address</label>
                  <input id="app-address-3" value={newWarehouse.address} onChange={(e) => setNewWarehouse((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" placeholder="123 Street..." />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-branch-optional">Branch (optional)</label>
                  <select id="app-branch-optional" value={newWarehouse.branchId} onChange={(e) => setNewWarehouse((p) => ({ ...p, branchId: e.target.value }))} className="ui-select w-full ui-surface">
                    <option value="">No branch</option>
                    {branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={loading} onClick={createWarehouse} className={`px-4 py-2 rounded-lg ${loading ? 'ui-sunken ui-subtle' : 'ui-btn ui-btn-primary '}`}>
                  Create Warehouse
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b ui-sunken text-sm font-semibold">Warehouse List</div>
              <div className="max-h-64 overflow-auto">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th">Name</th>
                      <th className="ui-th">Code</th>
                      <th className="ui-th">Location</th>
                      <th className="ui-th">Branch</th>
                      <th className="ui-th ui-col-h-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {warehouses.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-sm ui-muted">No warehouses found.</td></tr>
                    ) : (
                      warehouses.map((w) => {
                        const active = String(w.id) === String(selectedWarehouseId);
                        return (
                          <tr key={String(w.id)} className={`cursor-pointer ${active ? 'ui-row-active' : 'ui-hover-sunken'}`} onClick={() => setSelectedWarehouseId(String(w.id))}>
                            <td className="ui-col-entity px-4 py-3 ui-fg">{w.name}</td>
                            <td className="ui-col-meta px-4 py-3 ui-fg">{w.code || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{w.location || '-'}</td>
                            <td className="ui-col-meta px-4 py-3 ui-muted">{w.branchName || '-'}</td>
                            <td className="ui-col-meta px-4 py-3">{w.isActive !== false ? <span className="text-[rgb(var(--pos))]">Active</span> : <span className="text-[rgb(var(--neg))]">Inactive</span>}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {selectedWarehouse && (
            <div className="border rounded-xl p-4">
              <div className="text-sm font-semibold">Edit Warehouse: {selectedWarehouse.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="ui-label" htmlFor="app-warehouse-name-2">Warehouse Name *</label>
                  <input id="app-warehouse-name-2" value={warehouseEdit.name} onChange={(e) => setWarehouseEdit((p) => ({ ...p, name: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-code-4">Code</label>
                  <input id="app-code-4" value={warehouseEdit.code} onChange={(e) => setWarehouseEdit((p) => ({ ...p, code: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-location-2">Location</label>
                  <input id="app-location-2" value={warehouseEdit.location} onChange={(e) => setWarehouseEdit((p) => ({ ...p, location: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-address-4">Address</label>
                  <input id="app-address-4" value={warehouseEdit.address} onChange={(e) => setWarehouseEdit((p) => ({ ...p, address: e.target.value }))} className="ui-input w-full" />
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-branch">Branch</label>
                  <select id="app-branch" value={warehouseEdit.branchId} onChange={(e) => setWarehouseEdit((p) => ({ ...p, branchId: e.target.value }))} className="ui-select w-full ui-surface">
                    <option value="">No branch</option>
                    {branchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="ui-label" htmlFor="app-status-2">Status</label>
                  <select id="app-status-2" value={warehouseEdit.isActive ? 'active' : 'inactive'} onChange={(e) => setWarehouseEdit((p) => ({ ...p, isActive: e.target.value === 'active' }))} className="ui-select w-full ui-surface">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={saveWarehouse} className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">Save Warehouse</button>
                <button type="button" onClick={deleteWarehouse} className="px-4 py-2 rounded-lg border ui-surface ui-hover-sunken">Delete</button>
              </div>
            </div>
            )}
          </div>
        </div>
        )}
      </div>
    );
  };

  return (
    /*
     * The wrapper is chrome for the sidebar. Without one it is a card holding
     * cards, which is the framing noise DESIGN.md rules out.
     */
    <div className={showSidebar ? 'ui-surface border rounded-xl overflow-hidden' : ''}>
      <div className="flex">
        {showSidebar ? (
          <div className="w-64 border-r ui-surface p-4">
            <div className="space-y-1">
              {[{ key: 'company', title: 'Company' }, { key: 'tax', title: 'Tax & Compliances' }].map((s) => {
                const isActive = s.key === activeTab;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setActiveTab(s.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${ isActive ? 'ui-row-active ui-border-c ui-fg' : 'ui-surface border-transparent ui-fg ui-hover-sunken'
                    }`}
                  >
                    <div className="text-sm font-medium">{s.title}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className={showSidebar ? 'flex-1 p-6' : 'min-w-0 flex-1'}>
          {activeTab === 'company' ? (
            <div className="company-profile-view relative">
              <div className="company-profile-actions flex flex-wrap items-center justify-end gap-2">
                {editingCompany ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setEditingCompany(false)} className="ui-btn ui-btn-ghost">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        await saveCompanySettings();
                        // Saving returns to the record, the same as a branch.
                        setEditingCompany(false);
                      }}
                      className="ui-btn ui-btn-primary"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setEditingCompany(true)} className="ui-btn ui-btn-secondary">
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                )}
              </div>

              {editingCompany ? (
                <CompanyProfileForm
                  form={form}
                  updateForm={updateForm}
                  countryOptions={COUNTRY_OPTIONS}
                  currencyOptions={CURRENCY_OPTIONS}
                  states={Object.entries(GST_STATE_BY_CODE || {}).sort(([a], [b]) => a.localeCompare(b))}
                />
              ) : (
                <CompanyProfileDetails form={form} company={currentCompany} />
              )}
            </div>
          ) : (
            <GstRegistrationsSettings db={db} setDb={setDb} currentCompany={currentCompany} />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Month picker + download for the portal-schema JSON. Lives beside the report
 * heading; the JSON is what the GST offline tool / portal imports.
 */
const GstrExportControl = ({ label, onExport }) => {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-mm
  return (
    <div className="flex items-center gap-2">
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="ui-input w-auto text-sm"
        aria-label="Return period"
      />
      <button
        type="button"
        onClick={() => {
          const period = `${month.slice(5, 7)}${month.slice(0, 4)}`; // MMYYYY
          onExport(period);
        }}
        className="ui-btn ui-btn-primary"
      >
        <Download size={16} aria-hidden="true" /> {label}
      </button>
    </div>
  );
};

export const LegacyGstr1Report = ({ db, currentCompany }) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const creditNotes = db.creditNotes.filter((c) => c.companyId === currentCompany.id);

  const normalizeLine = (line, isIntra) => {
    const gstRate = Number(line.gstRate ?? 0);
    const taxableAmount = Number.isFinite(Number(line.taxableAmount))
      ? Number(line.taxableAmount)
      : Number.isFinite(Number(line.amount))
        ? Number(line.amount)
        : Number(line.quantity ?? 0) * Number(line.rate ?? 0);

    const hasSplit =
      Number.isFinite(Number(line.cgstAmount)) ||
      Number.isFinite(Number(line.sgstAmount)) ||
      Number.isFinite(Number(line.igstAmount)) ||
      Number.isFinite(Number(line.gstAmount));

    if (hasSplit) {
      return {
        gstRate,
        taxableAmount: round2(taxableAmount),
        cgstAmount: round2(Number(line.cgstAmount ?? 0)),
        sgstAmount: round2(Number(line.sgstAmount ?? 0)),
        igstAmount: round2(Number(line.igstAmount ?? 0)),
        gstAmount: round2(Number(line.gstAmount ?? 0)),
      };
    }

    const computed = computeGstForLine({
      quantity: Number(line.quantity ?? 1),
      rate: Number(line.rate ?? 0),
      gstRate,
      isIntra,
    });

    return {
      gstRate,
      taxableAmount: computed.taxableAmount,
      cgstAmount: computed.cgstAmount,
      sgstAmount: computed.sgstAmount,
      igstAmount: computed.igstAmount,
      gstAmount: computed.gstAmount,
    };
  };

  const addDocToSummary = (doc, sign, groups, totals) => {
    const isIntra = doc.taxType ? doc.taxType === 'CGST_SGST' : true;
    const lines = Array.isArray(doc.items) ? doc.items : [];

    lines.forEach((line) => {
      const nl = normalizeLine(line, isIntra);
      const gstRate = Number.isFinite(nl.gstRate) ? nl.gstRate : 0;
      const key = `${isIntra ? 'CGST_SGST' : 'IGST'}|${gstRate}`;

      const entry = groups.get(key) || {
        taxType: isIntra ? 'CGST/SGST' : 'IGST',
        gstRate,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        gstAmount: 0,
      };

      entry.taxableAmount = round2(entry.taxableAmount + sign * nl.taxableAmount);
      entry.cgstAmount = round2(entry.cgstAmount + sign * nl.cgstAmount);
      entry.sgstAmount = round2(entry.sgstAmount + sign * nl.sgstAmount);
      entry.igstAmount = round2(entry.igstAmount + sign * nl.igstAmount);
      entry.gstAmount = round2(entry.gstAmount + sign * nl.gstAmount);
      groups.set(key, entry);
    });

    totals.taxableAmount = round2(totals.taxableAmount + sign * Number(doc.subtotal ?? 0));
    totals.cgstAmount = round2(totals.cgstAmount + sign * Number(doc.cgstTotal ?? 0));
    totals.sgstAmount = round2(totals.sgstAmount + sign * Number(doc.sgstTotal ?? 0));
    totals.igstAmount = round2(totals.igstAmount + sign * Number(doc.igstTotal ?? 0));
    totals.gstAmount = round2(totals.gstAmount + sign * Number(doc.gstTotal ?? 0));
    totals.totalAmount = round2(totals.totalAmount + sign * Number(doc.total ?? 0));
  };

  const rateGroups = new Map();
  const totals = { taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, gstAmount: 0, totalAmount: 0 };

  invoices.forEach((inv) => addDocToSummary(inv, +1, rateGroups, totals));
  creditNotes.forEach((cn) => addDocToSummary(cn, -1, rateGroups, totals));

  const rateRows = Array.from(rateGroups.values()).sort((a, b) => {
    if (a.taxType !== b.taxType) return a.taxType.localeCompare(b.taxType);
    return a.gstRate - b.gstRate;
  });

  const docRows = [
    ...invoices.map((inv) => ({
      type: 'Invoice',
      number: inv.number,
      date: inv.date,
      partyName: inv.customerName,
      partyGstin: inv.customerGstin || '',
      placeOfSupply: inv.placeOfSupplyState || '',
      taxable: Number(inv.subtotal ?? 0),
      cgst: Number(inv.cgstTotal ?? 0),
      sgst: Number(inv.sgstTotal ?? 0),
      igst: Number(inv.igstTotal ?? 0),
      total: Number(inv.total ?? 0),
    })),
    ...creditNotes.map((cn) => ({
      type: 'Credit Note',
      number: cn.number,
      date: cn.date,
      partyName: cn.customerName,
      partyGstin: cn.customerGstin || '',
      placeOfSupply: cn.placeOfSupplyState || '',
      taxable: -Number(cn.subtotal ?? 0),
      cgst: -Number(cn.cgstTotal ?? 0),
      sgst: -Number(cn.sgstTotal ?? 0),
      igst: -Number(cn.igstTotal ?? 0),
      total: -Number(cn.total ?? 0),
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="ui-t-sec">GST - GSTR-1 (Summary)</h3>
        <GstrExportControl
          label="Portal JSON"
          onExport={(period) => {
            if (!String(currentCompany?.gstin || '').trim()) {
              notify.error('Set the company GSTIN in Company Profile before exporting a return.');
              return;
            }
            const json = buildGstr1Json({ invoices, creditNotes, items: db.items || [], company: currentCompany, period });
            downloadJson(`GSTR1_${currentCompany.gstin}_${period}.json`, json);
            notify.success(`GSTR-1 JSON for ${period} downloaded.`);
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Taxable Value (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.taxableAmount, currentCompany)}</div>
        </div>
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">GST (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.gstAmount, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            CGST {formatMoney(totals.cgstAmount, currentCompany)} · SGST {formatMoney(totals.sgstAmount, currentCompany)} · IGST {formatMoney(totals.igstAmount, currentCompany)}
          </div>
        </div>
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Total (Net)</div>
          <div className="ui-money-lg">{formatMoney(totals.totalAmount, currentCompany)}</div>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border ui-border-c">
        <div className="px-6 py-4 border-b ui-sunken">
          <h4 className="font-bold">Rate-wise Summary</h4>
        </div>
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Tax Type</th>
              <th className="ui-th ui-num">GST %</th>
              <th className="ui-th ui-num">Taxable</th>
              <th className="ui-th ui-num">CGST</th>
              <th className="ui-th ui-num">SGST</th>
              <th className="ui-th ui-num">IGST</th>
              <th className="ui-th ui-num">GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border))]">
            {rateRows.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center ui-muted">
                  No GST transactions yet.
                </td>
              </tr>
            ) : (
              rateRows.map((r) => (
                <tr key={`${r.taxType}-${r.gstRate}`} className="ui-hover-sunken">
                  <td className="px-4 py-2.5 ui-col-meta">{r.taxType}</td>
                  <td className="ui-col-meta px-4 py-2.5 text-right">{Number(r.gstRate || 0).toFixed(2)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.taxableAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.cgstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.sgstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.igstAmount || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.gstAmount || 0), currentCompany)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border ui-border-c">
        <div className="px-6 py-4 border-b ui-sunken">
          <h4 className="font-bold">Document Summary (Invoices & Credit Notes)</h4>
        </div>
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Type</th>
              <th className="ui-th">Number</th>
              <th className="ui-th ui-col-h-center">Date</th>
              <th className="ui-th">Party</th>
              <th className="ui-th">GSTIN</th>
              <th className="ui-th">POS</th>
              <th className="ui-th ui-num">Taxable</th>
              <th className="ui-th ui-num">CGST</th>
              <th className="ui-th ui-num">SGST</th>
              <th className="ui-th ui-num">IGST</th>
              <th className="ui-th ui-num">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border))]">
            {docRows.length === 0 ? (
              <tr>
                <td colSpan="11" className="px-6 py-10 text-center ui-muted">
                  No invoices or credit notes found.
                </td>
              </tr>
            ) : (
              docRows.map((r, idx) => (
                <tr key={`${r.type}-${r.number}-${idx}`} className="ui-hover-sunken">
                  <td className="px-4 py-2.5 ui-col-meta">{r.type}</td>
                  <td className="px-4 py-2.5 ui-col-entity">{r.number}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.date}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.partyName}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.partyGstin}</td>
                  <td className="px-4 py-2.5 ui-col-meta">{r.placeOfSupply}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.taxable || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.cgst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.sgst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.igst || 0), currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(Number(r.total || 0), currentCompany)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const gstDocValues = (doc, sign = 1) => ({
  count: 1,
  taxable: sign * Number(doc?.subtotal ?? doc?.taxableTotal ?? 0),
  igst: sign * Number(doc?.igstTotal ?? 0),
  cgst: sign * Number(doc?.cgstTotal ?? 0),
  sgst: sign * Number(doc?.sgstTotal ?? 0),
  cess: sign * Number(doc?.cessTotal ?? 0),
  tax: sign * Number(doc?.gstTotal ?? 0),
  total: sign * Number(doc?.total ?? 0),
});

const addGstValues = (rows) => rows.reduce((sum, row) => ({
  count: sum.count + Number(row.values?.count || 0),
  taxable: sum.taxable + Number(row.values?.taxable || 0),
  igst: sum.igst + Number(row.values?.igst || 0),
  cgst: sum.cgst + Number(row.values?.cgst || 0),
  sgst: sum.sgst + Number(row.values?.sgst || 0),
  cess: sum.cess + Number(row.values?.cess || 0),
  tax: sum.tax + Number(row.values?.tax || 0),
  total: sum.total + Number(row.values?.total || 0),
}), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, tax: 0, total: 0 });

const Gstr1Report = ({ db, currentCompany, search = '', onSearchChange, onDetailChange }) => {
  const [selectedSectionKey, setSelectedSectionKey] = useState('');
  useEffect(() => {
    onDetailChange?.(Boolean(selectedSectionKey));
  }, [onDetailChange, selectedSectionKey]);
  const companyId = currentCompany.id;
  const eligible = (row) => row?.companyId === companyId && !/draft|cancel/i.test(String(row?.status || ''));
  const invoices = (db.invoices || []).filter(eligible);
  const creditNotes = (db.creditNotes || []).filter(eligible);
  const receipts = (db.payments || []).filter((row) => row?.companyId === companyId && /receipt/i.test(String(row?.voucherType || row?.direction || row?.type || '')));
  const journals = (db.journalEntries || []).filter((row) => row?.companyId === companyId && !/draft|reversed|cancel/i.test(String(row?.status || '')));
  const gstinOf = (row) => String(row?.customerGstin || row?.partyGstin || row?.gstin || '').trim();
  const isExport = (row) => /export/i.test(String(row?.supplyType || row?.taxTreatment || row?.placeOfSupplyType || ''));
  const isNil = (row) => Number(row?.gstTotal || 0) === 0;
  const isInterstate = (row) => String(row?.taxType || '').toUpperCase() === 'IGST';
  const invoiceRow = (doc) => ({ doc, values: gstDocValues(doc, 1) });
  const noteRow = (doc) => ({ doc, values: gstDocValues(doc, -1) });

  const b2b = invoices.filter((row) => gstinOf(row) && !isExport(row) && !isNil(row)).map(invoiceRow);
  const exports = invoices.filter(isExport).map(invoiceRow);
  const nil = invoices.filter(isNil).map(invoiceRow);
  const b2cl = invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && isInterstate(row) && Number(row.total || 0) > 250000).map(invoiceRow);
  const b2cs = invoices.filter((row) => !gstinOf(row) && !isNil(row) && !isExport(row) && !b2cl.some((candidate) => candidate.doc === row)).map(invoiceRow);
  const cdnr = creditNotes.filter((row) => gstinOf(row)).map(noteRow);
  const cdnur = creditNotes.filter((row) => !gstinOf(row)).map(noteRow);
  const advanceRows = receipts.filter((row) => Number(row.advanceAmount || 0) > 0).map((doc) => ({ doc, values: { count: 1, taxable: Number(doc.advanceAmount || 0), igst: 0, cgst: 0, sgst: 0, cess: 0, tax: Number(doc.gstTotal || 0), total: Number(doc.advanceAmount || 0) } }));
  const adjustmentRows = journals.filter((entry) => (entry.lines || []).some((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(String(line.ledgerName || line.accountName || line.description || '')))).map((doc) => {
    const outputLines = (doc.lines || []).filter((line) => /output\s*(igst|cgst|sgst|gst)|gst\s*output/i.test(String(line.ledgerName || line.accountName || line.description || '')));
    const tax = outputLines.reduce((sum, line) => sum + Number(line.credit || 0) - Number(line.debit || 0), 0);
    return { doc, values: { count: 1, taxable: Number(doc.taxableAmount || 0), igst: 0, cgst: 0, sgst: 0, cess: 0, tax, total: Number(doc.amount || tax) } };
  });
  const hsnDocs = [...invoices.map(invoiceRow), ...creditNotes.map(noteRow)];

  const sections = [
    ['b2b', '4A, 4B, 6B, 6C', 'B2B, SEZ and Deemed Export Invoices', b2b],
    ['b2cl', '5', 'B2C (Large) Invoices', b2cl],
    ['exports', '6A', 'Exports Invoices', exports],
    ['b2cs', '7', 'B2C (Others)', b2cs],
    ['nil', '8A, 8B, 8C, 8D', 'Nil Rated, Exempt and Non-GST Supplies', nil],
    ['cdnr', '9B', 'Credit / Debit Notes (Registered)', cdnr],
    ['cdnur', '9B', 'Credit / Debit Notes (Unregistered)', cdnur],
    ['advance', '11A(1), 11A(2)', 'Tax Liability on Advances Received', advanceRows],
    ['adjustments', '11B(1), 11B(2)', 'Adjustment of Advances / Journal Corrections', adjustmentRows],
    ['hsn', '12', 'HSN-wise Summary of Outward Supplies', hsnDocs],
    ['documents', '13', 'Documents Issued', [...invoices.map(invoiceRow), ...creditNotes.map(noteRow)]],
    ['eco', '14', 'Supplies made through E-Commerce Operators', invoices.filter((row) => row.ecommerceOperator || row.ecoGstin).map(invoiceRow)],
    ['section95', '15', 'Supplies under Section 9(5)', invoices.filter((row) => row.section9_5).map(invoiceRow)],
  ].map(([key, code, label, rows]) => ({ key, code, label, rows, values: addGstValues(rows) }));
  const selectedSection = sections.find((section) => section.key === selectedSectionKey) || null;
  const searchText = String(search || '').trim().toLowerCase();
  const displaySections = searchText ? sections.filter((section) => {
    if (`${section.code} ${section.label}`.toLowerCase().includes(searchText)) return true;
    return section.rows.some(({ doc }) => [doc.number, doc.receiptNo, doc.entryNo, doc.customerName, doc.partyName, doc.vendorName, gstinOf(doc)].some((value) => String(value || '').toLowerCase().includes(searchText)));
  }) : sections;

  const detailModel = (() => {
    if (!selectedSection) return { columns: [], rows: [] };
    if (selectedSection.key === 'hsn') {
      const itemById = new Map((db.items || []).map((item) => [String(item.id), item]));
      const grouped = new Map();
      for (const { doc, values } of selectedSection.rows) {
        const sign = values.total < 0 ? -1 : 1;
        for (const line of (doc.items || [])) {
          const item = itemById.get(String(line.itemId || '')) || {};
          const hsn = String(line.hsnSac || line.hsn || item.hsnSac || item.hsn || 'Unclassified');
          const rate = Number(line.gstRate ?? item.gstRate ?? 0);
          const key = `${hsn}|${rate}|${line.unit || item.unit || 'NOS'}`;
          const rawQuantity = Number(line.quantity || line.qty || 0);
          const quantity = sign * rawQuantity;
          const taxable = sign * Number(line.taxableAmount ?? line.amount ?? rawQuantity * Number(line.rate || 0));
          const current = grouped.get(key) || { hsn, description: line.description || line.name || item.name || '—', uqc: line.unit || item.unit || 'NOS', quantity: 0, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
          current.quantity += quantity;
          current.taxable += taxable;
          current.igst += sign * Number(line.igstAmount || 0);
          current.cgst += sign * Number(line.cgstAmount || 0);
          current.sgst += sign * Number(line.sgstAmount || 0);
          current.cess += sign * Number(line.cessAmount || 0);
          grouped.set(key, current);
        }
      }
      return { columns: [['hsn','HSN/SAC'],['description','Description'],['uqc','UQC'],['quantity','Total Qty','number'],['rate','GST Rate','number'],['taxable','Taxable Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money'],['cess','Cess','money']], rows: [...grouped.values()] };
    }
    if (selectedSection.key === 'documents') {
      const grouped = new Map();
      for (const { doc } of selectedSection.rows) {
        const type = creditNotes.includes(doc) ? 'Credit Notes' : 'Invoices';
        const current = grouped.get(type) || { type, from: doc.number || '', to: doc.number || '', total: 0, cancelled: 0, net: 0 };
        current.from = current.from || doc.number || '';
        current.to = doc.number || current.to;
        current.total += 1;
        if (/cancel/i.test(String(doc.status || ''))) current.cancelled += 1;
        current.net = current.total - current.cancelled;
        grouped.set(type, current);
      }
      return { columns: [['type','Document Type'],['from','Serial No. From'],['to','Serial No. To'],['total','Total Issued','number'],['cancelled','Cancelled','number'],['net','Net Issued','number']], rows: [...grouped.values()] };
    }
    if (['advance', 'adjustments'].includes(selectedSection.key)) return {
      columns: [['date','Date'],['number','Voucher No.'],['party','Party'],['place','Place of Supply'],['rate','GST Rate','number'],['taxable','Advance / Adjustment','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money']],
      rows: selectedSection.rows.map(({ doc, values }) => ({ date: doc.date || '—', number: doc.number || doc.receiptNo || doc.entryNo || '—', party: doc.customerName || doc.partyName || '—', place: doc.placeOfSupplyState || '—', rate: Number(doc.gstRate || 0), ...values })),
    };
    return {
      columns: [['date','Date'],['number','Voucher No.'],['type','Type'],['party','Party'],['gstin','GSTIN'],['place','Place of Supply'],['taxable','Taxable Value','money'],['igst','IGST','money'],['cgst','CGST','money'],['sgst','SGST/UTGST','money'],['cess','Cess','money'],['total','Invoice Amount','money']],
      rows: selectedSection.rows.map(({ doc, values }) => ({ date: doc.date || '—', number: doc.number || doc.receiptNo || doc.entryNo || '—', type: doc.sourceDocType || (creditNotes.includes(doc) ? 'Credit Note' : 'Invoice'), party: doc.customerName || doc.partyName || doc.vendorName || '—', gstin: gstinOf(doc) || '—', place: doc.placeOfSupplyState || '—', ...values })),
    };
  })();

  if (selectedSection) return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 border-b pb-3 ui-border-c">
      <div><h3 className="ui-t-sec whitespace-nowrap">{selectedSection.code} — {selectedSection.label}</h3><p className="ui-helper">GSTR-1 · {selectedSection.values.count} voucher{selectedSection.values.count === 1 ? '' : 's'}</p></div>
    </div>
    <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr>{detailModel.columns.map(([key, label, kind]) => <th key={key} className={`whitespace-nowrap ${kind ? 'text-right' : ''}`}>{label}</th>)}</tr></thead><tbody>{detailModel.rows.length ? detailModel.rows.map((row, index) => <tr key={`${row.number || row.hsn || row.type || 'row'}-${index}`}>{detailModel.columns.map(([key,,kind]) => <td key={key} className={`whitespace-nowrap ${kind ? 'ui-num' : ''} ${kind === 'money' ? 'ui-money' : ''}`}>{kind === 'money' ? formatMoney(row[key], currentCompany) : row[key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={Math.max(1, detailModel.columns.length)} className="py-12 text-center ui-muted">No entries in this section for the selected period.</td></tr>}</tbody></table></div>
  </div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="ui-t-sec">GSTR-1 Return View</h3><p className="ui-helper">Statutory sections calculated from posted vouchers for the selected period.</p></div><div className="relative"><Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" /><input aria-label="Search GST report" className="ui-input w-64 ps-9" placeholder="Search section or voucher…" value={search} onChange={(event) => onSearchChange?.(event.target.value)} /></div></div>
    <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 15rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr><th className="whitespace-nowrap">Particulars</th><th className="whitespace-nowrap text-right">Vch Count</th><th className="whitespace-nowrap text-right">Taxable Amount</th><th className="whitespace-nowrap text-right">IGST</th><th className="whitespace-nowrap text-right">CGST</th><th className="whitespace-nowrap text-right">SGST/UTGST</th><th className="whitespace-nowrap text-right">Cess</th><th className="whitespace-nowrap text-right">Invoice Amount</th></tr></thead><tbody>{displaySections.map((section) => <tr key={section.key} className="cursor-pointer" onClick={() => setSelectedSectionKey(section.key)}><td className="whitespace-nowrap"><span className="ui-link font-semibold">{section.code} — {section.label}</span></td><td className="ui-num">{section.values.count}</td>{['taxable','igst','cgst','sgst','cess','total'].map((key) => <td key={key} className="ui-money ui-num whitespace-nowrap">{formatMoney(section.values[key], currentCompany)}</td>)}</tr>)}</tbody></table></div>
  </div>;
};

const Gstr3bReport = ({ db, currentCompany }) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const creditNotes = db.creditNotes.filter((c) => c.companyId === currentCompany.id);
  const bills = db.bills.filter((b) => b.companyId === currentCompany.id);
  const expenses = db.expenses.filter((e) => e.companyId === currentCompany.id);

  const sumDocs = (docs, sign) => {
    return docs.reduce(
      (acc, d) => {
        acc.taxable += sign * Number(d.subtotal ?? d.taxableTotal ?? 0);
        acc.cgst += sign * Number(d.cgstTotal ?? 0);
        acc.sgst += sign * Number(d.sgstTotal ?? 0);
        acc.igst += sign * Number(d.igstTotal ?? 0);
        acc.gst += sign * Number(d.gstTotal ?? 0);
        return acc;
      },
      { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0 }
    );
  };

  const outward = sumDocs(invoices, +1);
  const outwardCredit = sumDocs(creditNotes, -1);
  const outwardNet = {
    taxable: round2(outward.taxable + outwardCredit.taxable),
    cgst: round2(outward.cgst + outwardCredit.cgst),
    sgst: round2(outward.sgst + outwardCredit.sgst),
    igst: round2(outward.igst + outwardCredit.igst),
    gst: round2(outward.gst + outwardCredit.gst),
  };

  const inwardBills = sumDocs(bills, +1);
  const inwardExpenses = sumDocs(expenses, +1);
  const inwardItc = {
    taxable: round2(inwardBills.taxable + inwardExpenses.taxable),
    cgst: round2(inwardBills.cgst + inwardExpenses.cgst),
    sgst: round2(inwardBills.sgst + inwardExpenses.sgst),
    igst: round2(inwardBills.igst + inwardExpenses.igst),
    gst: round2(inwardBills.gst + inwardExpenses.gst),
  };

  const netPayable = {
    cgst: round2(outwardNet.cgst - inwardItc.cgst),
    sgst: round2(outwardNet.sgst - inwardItc.sgst),
    igst: round2(outwardNet.igst - inwardItc.igst),
    gst: round2(outwardNet.gst - inwardItc.gst),
  };

  return (
    <div className="space-y-6">
      <h3 className="ui-t-sec">GST - GSTR-3B (Summary)</h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Outward Supplies (Net)</div>
          <div className="ui-money-lg">{formatMoney(outwardNet.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            Taxable {formatMoney(outwardNet.taxable, currentCompany)} · CGST {formatMoney(outwardNet.cgst, currentCompany)} · SGST {formatMoney(outwardNet.sgst, currentCompany)} · IGST {formatMoney(outwardNet.igst, currentCompany)}
          </div>
        </div>

        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">ITC (Bills + Expenses)</div>
          <div className="ui-money-lg">{formatMoney(inwardItc.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            Taxable {formatMoney(inwardItc.taxable, currentCompany)} · CGST {formatMoney(inwardItc.cgst, currentCompany)} · SGST {formatMoney(inwardItc.sgst, currentCompany)} · IGST {formatMoney(inwardItc.igst, currentCompany)}
          </div>
        </div>

        <div className="ui-surface rounded-xl shadow-sm p-5 border">
          <div className="text-sm ui-muted">Net Tax Payable (Proxy)</div>
          <div className="ui-money-lg">{formatMoney(netPayable.gst, currentCompany)}</div>
          <div className="text-xs ui-muted mt-1">
            CGST {formatMoney(netPayable.cgst, currentCompany)} · SGST {formatMoney(netPayable.sgst, currentCompany)} · IGST {formatMoney(netPayable.igst, currentCompany)}
          </div>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm p-6 border">
        <h4 className="font-bold mb-3">What this report uses</h4>
        <div className="text-sm ui-muted space-y-1">
          <div>Outward: Invoices minus Credit Notes (based on saved GST totals).</div>
          <div>ITC: Bills and Expenses (based on saved GST totals).</div>
        </div>
      </div>
    </div>
  );
};

const GST_REPORT_OPTIONS = [
  ['gstr1', 'GSTR-1 (Outward Supplies)'],
  ['gstr3b', 'GSTR-3B'],
  ['itc', 'Input Tax Credit (ITC)'],
  ['reconciliation', 'GST Reconciliation'],
  ['einvoice', 'E-Invoice Register'],
  ['eway', 'E-Way Bill Register'],
];

const GstComplianceWorkspace = ({ db, currentCompany, branches = [], initialReport = 'gstr1', onBack }) => {
  const today = new Date();
  const fyStart = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  const [report, setReport] = useState(initialReport);
  const financialYear = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
  const [period, setPeriod] = useState('all');
  const gstinOptions = useMemo(() => {
    const found = [];
    const add = (gstin, label) => {
      const value = String(gstin || '').trim().toUpperCase();
      if (value && !found.some((item) => item.value === value)) found.push({ value, label: label ? `${value} · ${label}` : value });
    };
    add(currentCompany.gstin, currentCompany.name || 'Company');
    for (const branch of branches) add(branch.gstin || branch.gstIn || branch.registrationGstin, branch.name || branch.branchName);
    return found;
  }, [branches, currentCompany.gstin, currentCompany.name]);
  const [selectedGstin, setSelectedGstin] = useState(() => String(currentCompany.gstin || '').trim().toUpperCase());
  const [search, setSearch] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [gstr1DetailOpen, setGstr1DetailOpen] = useState(false);
  const [gstr1ReportKey, setGstr1ReportKey] = useState(0);

  const inScope = useCallback((row) => {
    if (!row || row.companyId !== currentCompany.id) return false;
    if (selectedGstin) {
      const documentGstin = String(row.sellerGstin || row.companyGstin || row.registrationGstin || '').trim().toUpperCase();
      if (documentGstin && documentGstin !== selectedGstin) return false;
      const matchingBranchIds = branches.filter((branch) => String(branch.gstin || branch.gstIn || branch.registrationGstin || '').trim().toUpperCase() === selectedGstin).map((branch) => String(branch.id));
      if (matchingBranchIds.length && row.branchId && !matchingBranchIds.includes(String(row.branchId))) return false;
    }
    const date = String(row.date || row.invoiceDate || row.billDate || '');
    if (!date) return true;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const fy = month >= 4 ? year : year - 1;
    if (fy !== Number(financialYear.slice(0, 4))) return false;
    return period === 'all' || String(month).padStart(2, '0') === period;
  }, [branches, currentCompany.id, financialYear, period, selectedGstin]);

  const scopedDb = useMemo(() => {
    const next = { ...db };
    for (const key of ['invoices', 'creditNotes', 'bills', 'debitNotes', 'expenses', 'payments', 'journalEntries']) {
      next[key] = (Array.isArray(db[key]) ? db[key] : []).filter(inScope);
    }
    return next;
  }, [db, inScope]);

  const outwardDocs = useMemo(() => [
    ...(scopedDb.invoices || []).map((row) => ({ ...row, complianceType: 'Invoice', sign: 1 })),
    ...(scopedDb.creditNotes || []).map((row) => ({ ...row, complianceType: 'Credit Note', sign: -1 })),
  ], [scopedDb]);
  const inwardDocs = useMemo(() => [
    ...(scopedDb.bills || []).map((row) => ({ ...row, complianceType: 'Purchase Bill', sign: 1 })),
    ...(scopedDb.expenses || []).map((row) => ({ ...row, complianceType: 'Expense', sign: 1 })),
    ...(scopedDb.debitNotes || []).map((row) => ({ ...row, complianceType: 'Debit Note', sign: -1 })),
  ], [scopedDb]);

  const rows = report === 'itc' || report === 'reconciliation' ? inwardDocs : outwardDocs;
  const visibleRows = rows.filter((row) => !search || [row.number, row.invoiceNumber, row.billNumber, row.customerName, row.vendorName, row.reference].some((v) => String(v || '').toLowerCase().includes(search.toLowerCase())));
  const selectedLabel = GST_REPORT_OPTIONS.find(([key]) => key === report)?.[1] || 'GST Report';
  const reportColumns = report === 'itc' ? [
    { key: 'party', label: 'Party name', value: (row) => row.vendorName || row.partyName || row.customerName || '—' },
    { key: 'gstin', label: 'GSTN', value: (row) => row.vendorGstin || row.partyGstin || row.gstin || '—' },
    { key: 'number', label: 'Invoice number', value: (row) => row.refNo || row.invoiceNumber || row.billNumber || row.number || '—' },
    { key: 'date', label: 'Inv date', value: (row) => row.refDate || row.invoiceDate || row.billDate || row.date || '—' },
    { key: 'total', label: 'Inv Value', money: true, value: (row) => Number(row.total || 0) * row.sign },
    { key: 'taxable', label: 'Taxable value', money: true, value: (row) => Number(row.subtotal || row.taxableTotal || 0) * row.sign },
    { key: 'cgst', label: 'CGST', money: true, value: (row) => Number(row.cgstTotal || 0) * row.sign },
    { key: 'sgst', label: 'SGST', money: true, value: (row) => Number(row.sgstTotal || 0) * row.sign },
    { key: 'igst', label: 'IGST', money: true, value: (row) => Number(row.igstTotal || 0) * row.sign },
  ] : [
    { key: 'type', label: 'Type', value: (row) => row.complianceType },
    { key: 'number', label: 'Document No.', value: (row) => row.number || row.invoiceNumber || row.billNumber || '—' },
    { key: 'date', label: 'Date', value: (row) => row.date || '—' },
    { key: 'party', label: 'Party', value: (row) => row.customerName || row.vendorName || '—' },
    { key: 'gstin', label: 'GSTIN', value: (row) => row.customerGstin || row.vendorGstin || row.gstin || '—' },
    { key: 'taxable', label: 'Taxable Value', money: true, value: (row) => Number(row.subtotal || row.taxableTotal || 0) * row.sign },
    { key: 'gst', label: 'GST', money: true, value: (row) => Number(row.gstTotal || 0) * row.sign },
    { key: 'total', label: 'Total Amount', money: true, value: (row) => Number(row.total || 0) * row.sign },
  ];

  const exportCurrent = async () => {
    if (report === 'gstr1') {
      if (!selectedGstin) {
        notify.error('Select a GSTIN before exporting the GSTR-1 workbook.');
        return;
      }
      if (period === 'all') {
        notify.error('Select a filing month before exporting the GSTR-1 workbook.');
        return;
      }
      const month = Number(period);
      const filingYear = month >= 4 ? fyStart : fyStart + 1;
      const portalPeriod = `${period}${filingYear}`;
      const monthName = new Date(filingYear, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      await exportGstr1Excel({ db: scopedDb, company: { ...currentCompany, gstin: selectedGstin }, gstin: selectedGstin, periodLabel: monthName, portalPeriod });
      return;
    }
    await exportListXlsx({
      fileName: selectedLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      sheetName: selectedLabel,
      subtitle: period === 'all' ? financialYear : period,
      columns: reportColumns.map((column) => ({ key: column.key, label: column.label, type: column.money ? 'number' : 'text', align: column.money ? 'right' : 'left', value: column.value })),
      rows: visibleRows,
    });
  };

  const exportPortalJson = () => {
    if (!selectedGstin) {
      notify.error('Select a GSTIN before exporting GST Portal JSON.');
      return;
    }
    if (period === 'all') {
      notify.error('Select a filing month before exporting GST Portal JSON.');
      return;
    }
    if (report !== 'gstr1' && report !== 'gstr3b') {
      notify.error('GST Portal JSON is available for GSTR-1 and GSTR-3B.');
      return;
    }

    const month = Number(period);
    const filingYear = month >= 4 ? fyStart : fyStart + 1;
    const portalPeriod = `${period}${filingYear}`;
    const exportCompany = { ...currentCompany, gstin: selectedGstin };
    const json = report === 'gstr1'
      ? buildGstr1Json({
          invoices: scopedDb.invoices || [],
          creditNotes: scopedDb.creditNotes || [],
          items: db.items || [],
          company: exportCompany,
          period: portalPeriod,
        })
      : buildGstr3bJson({
          invoices: scopedDb.invoices || [],
          creditNotes: scopedDb.creditNotes || [],
          bills: scopedDb.bills || [],
          expenses: scopedDb.expenses || [],
          debitNotes: scopedDb.debitNotes || [],
          company: exportCompany,
          period: portalPeriod,
        });
    const returnName = report === 'gstr1' ? 'GSTR1' : 'GSTR3B';
    downloadJson(`${returnName}_${selectedGstin}_${portalPeriod}.json`, json);
    notify.success(`${returnName} GST Portal JSON downloaded.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[rgb(var(--heading-bg))] px-3 py-2 ui-border-c">
        <div className="flex min-w-0 items-center gap-2"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { if (report === 'gstr1' && gstr1DetailOpen) setGstr1ReportKey((value) => value + 1); else onBack?.(); }}><ArrowLeft size={15} /> Back</button><h1 className="ui-t-page">GST</h1></div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select id="gst-report-select" aria-label="Select report" className="ui-select ui-ctl-compact w-64 font-semibold" value={report} onChange={(e) => { setGstr1DetailOpen(false); setReport(e.target.value); }}>{GST_REPORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{`Select report · ${label}`}</option>)}</select>
          <select id="gst-period" aria-label="Period" className="ui-select ui-ctl-compact w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">Period · All periods</option>
            {['April','May','June','July','August','September','October','November','December','January','February','March'].map((name, index) => {
              const month = ((index + 3) % 12) + 1;
              return <option key={name} value={String(month).padStart(2, '0')}>{`Period · ${name}`}</option>;
            })}
          </select>
          <select id="gst-gstin-select" aria-label="GSTIN" className="ui-select ui-ctl-compact ui-mono w-56" value={selectedGstin} onChange={(e) => setSelectedGstin(e.target.value)}>{gstinOptions.length ? gstinOptions.map((item) => <option key={item.value} value={item.value}>{`GSTIN · ${item.label}`}</option>) : <option value="">GSTIN · Not configured</option>}</select>
          <div className="relative">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export <ChevronDown size={14} /></button>
            {exportOpen ? <div role="menu" className="absolute end-0 top-[calc(100%+0.35rem)] z-40 w-56 overflow-hidden rounded-lg border bg-white p-1 shadow-lg ui-border-c">
              <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-start text-sm font-medium hover:bg-slate-100" onClick={() => { setExportOpen(false); exportCurrent(); }}>
                <span className="block">Export Excel</span><span className="block text-xs font-normal ui-muted">{report === 'gstr1' ? 'Complete multi-sheet filing workbook' : 'Current report data'}</span>
              </button>
              <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-start text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45" disabled={report !== 'gstr1' && report !== 'gstr3b'} title={report !== 'gstr1' && report !== 'gstr3b' ? 'Available for GSTR-1 and GSTR-3B' : 'GST Portal compatible JSON'} onClick={() => { setExportOpen(false); exportPortalJson(); }}>
                <span className="block">GST Portal JSON</span><span className="block text-xs font-normal ui-muted">GSTR-1 / GSTR-3B upload file</span>
              </button>
            </div> : null}
          </div>
        </div>
      </div>

      <section className="ui-card overflow-hidden">
        {report !== 'gstr1' ? <div className="flex flex-wrap items-center justify-between gap-2 border-b ui-border-c px-3 py-2">
          <div><h2 className="ui-t-sec">{selectedLabel}</h2><p className="text-xs ui-muted">Selected GST report for the current compliance period</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" /><input aria-label="Search GST report" className="ui-input w-64 ps-9" placeholder="Search number, party, reference…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
        </div> : null}
        <div className="p-2">
          {report === 'gstr1' ? <Gstr1Report key={gstr1ReportKey} db={scopedDb} currentCompany={currentCompany} search={search} onSearchChange={setSearch} onDetailChange={setGstr1DetailOpen} /> : report === 'gstr3b' ? <Gstr3bReport db={scopedDb} currentCompany={currentCompany} /> : report === 'reconciliation' ? <Gstr2bReco db={scopedDb} currentCompany={currentCompany} /> : (
            <div className="ui-table-shell overflow-auto" data-fill-viewport style={{ '--table-scroll-h': 'calc(100dvh - 13rem)' }}><table className="ui-table w-max min-w-full table-auto"><thead><tr>{reportColumns.map((column) => <th key={column.key} className={`ui-th whitespace-nowrap ${column.money ? 'ui-num' : ''}`}>{column.label}</th>)}</tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={`${row.id || row.number}-${index}`} className="ui-hover-sunken cursor-pointer">{reportColumns.map((column) => { const value = column.value(row); return <td key={column.key} className={`ui-td whitespace-nowrap ${column.money ? 'ui-num ui-money' : column.key === 'gstin' ? 'ui-mono' : ''}`}>{column.money ? formatMoney(value, currentCompany) : value}</td>; })}</tr>) : <tr><td colSpan={reportColumns.length} className="px-4 py-12 text-center ui-muted">No entries match this report and period.</td></tr>}</tbody></table></div>
          )}
        </div>
      </section>
    </div>
  );
};

const MsmeComplianceWorkspace = ({ db, setDb, currentCompany }) => {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showRateHistory, setShowRateHistory] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [rateForm, setRateForm] = useState({ effectiveFrom: todayIso(), bankRate: '' });
  const companyId = currentCompany.id;
  const today = todayIso();

  const rateHistory = useMemo(() => (db.msmeBankRates || [])
    .filter((row) => Number(row.companyId) === Number(companyId))
    .slice()
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))), [db.msmeBankRates, companyId]);

  const currentBankRate = rateHistory.reduce(
    (rate, row) => String(row.effectiveFrom || '') <= today ? Number(row.bankRate) : rate,
    MSME_BANK_RATE
  );

  const addBankRate = () => {
    const effectiveFrom = String(rateForm.effectiveFrom || '').slice(0, 10);
    const bankRate = Number(rateForm.bankRate);
    if (!effectiveFrom) {
      notify.error('Applicable date is required.');
      return;
    }
    if (!Number.isFinite(bankRate) || bankRate < 0 || bankRate > 100) {
      notify.error('Enter a valid RBI Bank Rate.');
      return;
    }
    if (rateHistory.some((row) => String(row.effectiveFrom).slice(0, 10) === effectiveFrom)) {
      notify.error('A Bank Rate already exists for this applicable date. Earlier rate records are not overwritten.');
      return;
    }
    const entry = {
      id: `msme-rate-${companyId}-${effectiveFrom}`,
      companyId,
      effectiveFrom,
      bankRate,
      createdAt: new Date().toISOString(),
    };
    setDb((previous) => ({ ...previous, msmeBankRates: [...(previous.msmeBankRates || []), entry] }));
    setRateForm({ effectiveFrom: todayIso(), bankRate: '' });
    notify.success(`Bank Rate ${bankRate.toFixed(2)}% added from ${formatDateIn(effectiveFrom)}.`);
    setShowAddRate(false);
    setShowRateHistory(true);
  };

  const registeredVendors = useMemo(
    () => (db.vendors || []).filter((vendor) =>
      Number(vendor.companyId) === Number(companyId)
      && (vendor.msmeRegistered || String(vendor.msmeNumber || '').trim())
    ),
    [db.vendors, companyId]
  );

  const vendorById = useMemo(
    () => new Map(registeredVendors.map((vendor) => [String(vendor.id), vendor])),
    [registeredVendors]
  );

  const rows = useMemo(() => (db.bills || [])
    .filter((bill) => Number(bill.companyId) === Number(companyId))
    .filter((bill) => vendorById.has(String(bill.vendorId)))
    .filter((bill) => !/draft|cancel/i.test(String(bill.status || '')))
    .map((bill) => {
      const vendor = vendorById.get(String(bill.vendorId));
      const due = msmeDueDate(bill);
      const outstanding = payableOutstanding(bill, db.debitNotes || []).outstanding;
      const paymentDate = outstanding <= 0.005 ? allocatedPaymentDate(db.payments, bill) : '';
      const calculationDate = paymentDate || today;
      const overdueDays = daysAfter(due.date, calculationDate);
      const vendorObligation = Math.max(0, Number(bill.total || 0) - Number(bill.tdsAmount || 0));
      const interestBase = outstanding > 0.005 ? outstanding : Math.min(vendorObligation, Number(bill.paidAmount || vendorObligation));
      const interest = estimateMsmeInterestWithRates({
        principal: interestBase,
        dueDate: due.date,
        endDate: calculationDate,
        rates: rateHistory,
      });
      const status = outstanding > 0.005 ? (overdueDays > 0 ? 'OVERDUE' : 'DUE') : (overdueDays > 0 ? 'PAID_LATE' : 'PAID');
      return { bill, vendor, due, outstanding, paymentDate, overdueDays, interest, status };
    })
    .sort((a, b) => {
      if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
      if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;
      return String(a.due.date).localeCompare(String(b.due.date));
    }), [db.bills, db.debitNotes, db.payments, companyId, vendorById, today, rateHistory]);

  const selectedVendorId = statusFilter.startsWith('VENDOR:') ? statusFilter.slice('VENDOR:'.length) : '';
  const selectedVendor = selectedVendorId ? vendorById.get(selectedVendorId) || null : null;
  const scopedRows = useMemo(
    () => selectedVendorId ? rows.filter((row) => String(row.vendor?.id) === selectedVendorId) : rows,
    [rows, selectedVendorId]
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopedRows.filter((row) => {
      if (!selectedVendorId && statusFilter === 'OPEN' && row.outstanding <= 0.005) return false;
      if (!selectedVendorId && statusFilter === 'OVERDUE' && row.status !== 'OVERDUE') return false;
      if (query && ![
        row.vendor?.displayName,
        row.vendor?.name,
        row.vendor?.msmeNumber,
        row.bill?.number,
        row.bill?.refNo,
      ].some((value) => String(value || '').toLowerCase().includes(query))) return false;
      return true;
    });
  }, [scopedRows, search, statusFilter, selectedVendorId]);

  const totals = useMemo(() => scopedRows.reduce((sum, row) => ({
    outstanding: sum.outstanding + row.outstanding,
    overdue: sum.overdue + (row.status === 'OVERDUE' ? row.outstanding : 0),
    interest: sum.interest + row.interest,
  }), { outstanding: 0, overdue: 0, interest: 0 }), [scopedRows]);

  const statusLabel = (status) => ({
    OVERDUE: 'Overdue', DUE: 'Within time', PAID_LATE: 'Paid late', PAID: 'Paid on time',
  }[status] || status);

  const exportRows = visibleRows.map((row) => ({ ...row, vendorName: row.vendor?.displayName || row.vendor?.name || '', udyam: row.vendor?.msmeNumber || '', invoiceNumber: row.bill?.refNo || row.bill?.number || '', billDate: row.bill?.date || '', dueDate: row.due?.date || '', statusLabel: statusLabel(row.status) }));
  const exportMsme = (key) => {
    const format = exportFormatFromKey(key);
    if (!format) return;
    runListExport({
      format,
      title: selectedVendor ? `MSME invoices - ${selectedVendor.displayName || selectedVendor.name}` : 'MSME Compliance',
      fileName: selectedVendor ? `MSME_${selectedVendor.displayName || selectedVendor.name}` : 'MSME_Compliance',
      label: 'invoice(s)',
      rows: exportRows,
      columns: [
        { key: 'vendorName', label: 'Vendor' }, { key: 'udyam', label: 'Udyam Number' },
        { key: 'invoiceNumber', label: 'Vendor Invoice' }, { key: 'billDate', label: 'Bill Date' },
        { key: 'dueDate', label: 'Statutory Due' }, { key: 'outstanding', label: 'Outstanding' },
        { key: 'overdueDays', label: 'Overdue Days' }, { key: 'interest', label: 'Estimated Interest' },
        { key: 'statusLabel', label: 'Status' },
      ],
    });
  };

  return (
    <div className="msme-compliance-page flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        entity="vendors"
        title={selectedVendor ? `MSME · ${selectedVendor.displayName || selectedVendor.name}` : 'MSME Compliance'}
        description={`Payment monitoring under MSMED Act sections 15–16 · current Bank Rate ${currentBankRate.toFixed(2)}% · statutory rate ${(currentBankRate * 3).toFixed(2)}% p.a.`}
        actions={<>
          <select className="ui-select ui-ctl-compact w-56" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="MSME invoice and vendor filter">
            <option value="ALL">All invoices</option>
            <option value="OPEN">Open invoices</option>
            <option value="OVERDUE">Overdue only</option>
            <optgroup label="MSME registered vendors">
              {registeredVendors.map((vendor) => <option key={vendor.id} value={`VENDOR:${vendor.id}`}>{vendor.displayName || vendor.name}</option>)}
            </optgroup>
          </select>
          <div className="relative">
            <Search size={15} className="ui-muted absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className="ui-input ui-ctl-compact w-64 ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor or invoice…" aria-label="Search MSME invoices" />
          </div>
          <MoreButton items={[exportMenuItem('Export MSME invoices')]} onSelect={exportMsme} />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowRateHistory(true)}>Bank rates</button>
        </>}
      />

      {selectedVendor ? (
        <section className="ui-card grid grid-cols-2 gap-3 px-3 py-2 lg:grid-cols-5" aria-label="Selected MSME vendor details">
          <div><div className="ui-t-label">Vendor</div><div className="ui-t-body font-semibold">{selectedVendor.displayName || selectedVendor.name}</div></div>
          <div><div className="ui-t-label">Udyam number</div><div className="ui-t-body ui-mono">{selectedVendor.msmeNumber || 'Missing'}</div></div>
          <div><div className="ui-t-label">PAN</div><div className="ui-t-body ui-mono">{selectedVendor.pan || '—'}</div></div>
          <div><div className="ui-t-label">GSTIN</div><div className="ui-t-body ui-mono">{selectedVendor.gstin || '—'}</div></div>
          <div><div className="ui-t-label">Invoices</div><div className="ui-t-body font-semibold">{scopedRows.length}</div></div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="MSME compliance summary">
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor invoices' : 'Invoices received'}</div><div className="ui-money-lg">{scopedRows.length}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor outstanding' : 'Outstanding'}</div><div className="ui-money-lg">{formatMoney(totals.outstanding, currentCompany)}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor overdue' : 'Overdue principal'}</div><div className="ui-money-lg ui-amount-neg">{formatMoney(totals.overdue, currentCompany)}</div></div>
        <div className="ui-card px-3 py-2"><div className="ui-t-label">{selectedVendor ? 'Vendor interest' : 'Estimated interest'}</div><div className="ui-money-lg ui-amount-neg">{formatMoney(totals.interest, currentCompany)}</div></div>
      </div>

      <div className="ui-card min-h-0 flex-1 overflow-hidden">
        <div className="ui-table-scroll h-full max-h-none overflow-x-hidden overflow-y-auto">
          <table className="ui-table ui-table-sticky w-full table-fixed">
            <colgroup><col style={{ width: '19%' }} /><col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '13%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /></colgroup>
            <thead><tr><th>{selectedVendor ? 'MSME / Udyam' : 'Vendor'}</th><th>Vendor invoice</th><th>Bill date</th><th>Statutory due</th><th className="ui-num">Outstanding</th><th className="ui-num">Overdue days</th><th className="ui-num">Est. interest</th><th>Status</th></tr></thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row) => (
                <tr key={row.bill.id}>
                  <td className="ui-col-entity truncate" title={row.vendor.displayName || row.vendor.name}><div>{selectedVendor ? (row.vendor.msmeNumber || 'Udyam number missing') : (row.vendor.displayName || row.vendor.name)}</div><div className="ui-caption truncate">{selectedVendor ? (row.vendor.gstin || 'GSTIN missing') : (row.vendor.msmeNumber || 'Udyam number missing')}</div></td>
                  <td className="ui-col-doc truncate"><div>{row.bill.refNo || row.bill.number || '—'}</div>{row.bill.refNo ? <div className="ui-caption truncate">Book no. {row.bill.number}</div> : null}</td>
                  <td>{formatDateIn(row.bill.date)}</td>
                  <td title={row.due.basis}><div>{row.due.date ? formatDateIn(row.due.date) : '—'}</div><div className="ui-caption truncate">{row.due.basis}</div></td>
                  <td className="ui-col-amount">{formatMoney(row.outstanding, currentCompany)}</td>
                  <td className={`ui-col-amount ${row.overdueDays ? 'ui-amount-neg' : ''}`}>{row.overdueDays || '—'}</td>
                  <td className={`ui-col-amount ${row.interest ? 'ui-amount-neg' : ''}`}>{formatMoney(row.interest, currentCompany)}</td>
                  <td><span className={`ui-pill ${row.status === 'OVERDUE' || row.status === 'PAID_LATE' ? 'ui-pill-neg' : row.status === 'PAID' ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{statusLabel(row.status)}</span></td>
                </tr>
              )) : (
                <tr><td colSpan="8"><EmptyState icon={Building2} title={registeredVendors.length ? 'No invoices match' : 'No MSME vendor invoices'} description={registeredVendors.length ? 'No purchase invoices match the selected status and search.' : 'Mark a vendor as MSME registered and record its purchase bill to monitor payment compliance.'} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="ui-caption px-1">Interest is an estimate using the recorded bill date as acceptance date. Each saved Bank Rate applies only from its applicable date; earlier periods retain their earlier rate.</p>

      <Drawer
        open={showRateHistory}
        onClose={() => setShowRateHistory(false)}
        title="MSME Bank Rate History"
        description="Effective-dated RBI Bank Rates used for delayed-payment interest"
        widthClass="w-[38rem] max-w-[calc(100vw-1rem)]"
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => { setShowRateHistory(false); setShowAddRate(true); }}><Plus size={15} /> Add</button>}
      >
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead><tr><th>Applicable from</th><th className="ui-num">Bank Rate</th><th className="ui-num">Statutory rate (3×)</th></tr></thead>
            <tbody>{rateHistory.length ? rateHistory.slice().reverse().map((row) => (
              <tr key={row.id || row.effectiveFrom}><td>{formatDateIn(row.effectiveFrom)}</td><td className="ui-col-amount">{Number(row.bankRate).toFixed(2)}%</td><td className="ui-col-amount">{(Number(row.bankRate) * 3).toFixed(2)}%</td></tr>
            )) : <tr><td colSpan="3" className="px-4 py-10 text-center ui-muted">No saved rate history. Add the first applicable rate.</td></tr>}</tbody>
          </table>
        </div>
      </Drawer>

      <Drawer
        open={showAddRate}
        onClose={() => setShowAddRate(false)}
        title="Add MSME Bank Rate"
        description="The rate will apply from the selected date without changing earlier periods"
        widthClass="w-[32rem] max-w-[calc(100vw-1rem)]"
        actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShowAddRate(false)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={addBankRate}>Save</button></>}
      >
        <div className="space-y-4">
          <div><label className="ui-label" htmlFor="msme-rate-date">Applicable from</label><input id="msme-rate-date" type="date" className="ui-input w-full" value={rateForm.effectiveFrom} onChange={(event) => setRateForm((previous) => ({ ...previous, effectiveFrom: event.target.value }))} required /></div>
          <div><label className="ui-label" htmlFor="msme-bank-rate">RBI Bank Rate (%)</label><input id="msme-bank-rate" type="number" min="0" max="100" step="0.01" className="ui-input w-full" value={rateForm.bankRate} onChange={(event) => setRateForm((previous) => ({ ...previous, bankRate: event.target.value }))} placeholder="e.g. 5.50" required /></div>
          <div className="ui-card p-3"><div className="ui-t-label">Statutory interest rate</div><div className="ui-money-lg">{Number.isFinite(Number(rateForm.bankRate)) && rateForm.bankRate !== '' ? `${(Number(rateForm.bankRate) * 3).toFixed(2)}% p.a.` : '—'}</div><div className="ui-caption">Three times the entered RBI Bank Rate</div></div>
        </div>
      </Drawer>
    </div>
  );
};

const AppShell = () => {
  const { can, loading: permsLoading, error: permsError } = usePermissions();
  const { isEnabled, loading: featuresLoading } = useFeatures();
  const branchesFeatureEnabled = isEnabled('branches');
  const warehousesFeatureEnabled = isEnabled('warehouses');
  /* Kept for the effect of mounting the hook — it is what applies the stored
     theme to the document. The switch itself is in the platform bar. */
  useTheme();
  const { density, set: setDensity } = useDensity();
  /*
   * The shell decides this, and it has already decided it — Accounting is not
   * rendered until somebody is signed in. What is left of the flag is the
   * switch that tells the effects below they may talk to the server.
   */
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useDismissable(accountMenuOpen, () => setAccountMenuOpen(false));
  /**
   * Where to draw the account menu.
   *
   * It has to leave the rail entirely. <main> runs a fade animation, and an
   * animation creates a stacking context — so a menu painted inside the
   * sidebar, at any z-index, still ends up underneath the page content. It was
   * being sliced down the middle by the content panel.
   *
   * Rendered to <body> at fixed coordinates measured off the trigger, opening
   * upward because downward from the foot of the rail is off the screen.
   */


  /**
   * How tall the rail can be.
   *
   * The account block is pinned to the foot of the rail, so the rail has to
   * reach the foot of the window — otherwise it ends wherever the icon list
   * ends and the avatar floats in the middle of the screen with nothing under
   * it.
   *
   * The height cannot be written as CSS arithmetic because the rail's top edge
   * moves: the unconfirmed-email banner sits above it and goes away once the
   * address is confirmed. So it is measured, and re-measured when the window
   * resizes or the banner comes and goes.
   */
  /*
   * The rail's height is CSS, not measurement.
   *
   * It used to read its own getBoundingClientRect().top every 800ms and set
   * its height from that. The rail is position: sticky, so its top moves as
   * the page scrolls — which changed the height, which moved the top, four
   * times a second, forever. The rail crept up the screen on its own with
   * nobody touching anything.
   *
   * The sticky offset is a constant (4.5rem) and so is the gap under it, so
   * the height is a constant too: one calc, no polling, no feedback loop.
   */
  /**
   * The books are on the server. This is the working copy in front of you.
   *
   * They used to be in localStorage as well, under `accountingDB:<org>`, and
   * that copy was authoritative for reads: the app loaded it on start, wrote
   * every change back to it, and hydrated from the server on top. Two records
   * of the same ledger, and the browser's won whatever the database said.
   *
   * It is a worse problem than a stale screen. A book edited in one browser
   * and reloaded in another showed different numbers, neither marked as
   * doubtful; the trial balance a person printed depended on which machine
   * they printed it from.
   *
   * So the copy is in memory only. Every screen still reads and writes `db` as
   * it always did, the writes still go to the API, and a reload re-reads the
   * books from PostgreSQL through useServerDocSync. Nothing to diverge,
   * because there is only one record.
   *
   * What this gives up is working offline, which was never really offered:
   * every write already required the server, and a failed one said so.
   */

  /* Books written by an earlier version are cleared out once, so a browser
     that has one does not carry it around unread for ever. */
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('accountingDB:')) localStorage.removeItem(key);
      }
    } catch {
      /* A browser that refuses storage has nothing stale to clear. */
    }
  }, []);

  /* The org this working copy belongs to. A change means a different company's
     books, so the copy is emptied and hydrated again rather than merged. */
  const [dbStorageKey, setDbStorageKey] = useState(() => String(platformOrgId() || ''));
  const [db, _setDb] = useState(() => normalizeDB(initEmptyDB()));

  const setDb = useCallback(
    (nextOrUpdater) => {
      _setDb((prev) => {
        const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
        /* An updater that changed nothing hands back the same object; keep it.
           Normalising it anyway made a new db on every call, so an effect that
           writes "only if something changed" (the expense TDS reconciliation)
           re-ran on its own write, forever. */
        if (next === prev) return prev;
        return normalizeDB(next);
      });
    },
    [_setDb]
  );

  useEffect(() => {
    setDb((prev) => normalizeDB(prev));
  }, []);

  /*
   * A different company is a different set of books, not a merge.
   *
   * The shell remounts this app when the company changes, so this is a
   * backstop rather than the usual path — but a working copy that survived a
   * switch would show one company's invoices under another's name.
   */
  useEffect(() => {
    const nextKey = String(platformOrgId() || '');
    if (nextKey === dbStorageKey) return;
    setDbStorageKey(nextKey);
    _setDb(normalizeDB(initEmptyDB()));
  }, [isAuthenticated, dbStorageKey]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const orgId = String(platformOrgId() || '').trim();
    if (!orgId) return;

    setDb((prev) => {
      const companies = Array.isArray(prev?.companies) ? prev.companies : [];
      const first = companies?.[0] || null;
      const companyId = Number(first?.id || 0);

      const existingMigrations = first?.docSettings?.migrations || {};
      if (existingMigrations.dummySeedV1Applied) return prev;

      // If tenant DB has no local company row yet (normal login path), create one.
      if (!companyId) {
        const nowIso = new Date().toISOString();
        const baseDoc = getDefaultDocSettings();
        const nextCompany = {
          id: 1,
          name: 'Company',
          address: '',
          city: '',
          state: '',
          country: 'India',
          taxId: '',
          gstRegistration: 'Unregistered',
          gstin: '',
          currency: 'INR',
          fiscalYearStart: '01-01',
          docSettings: {
            ...baseDoc,
            migrations: {
              ...(baseDoc.migrations || {}),
              disableDemoSeed: true,
            },
          },
          createdAt: nowIso,
        };

        // The company row is all a fresh tenant needs. It used to arrive with
        // seventy-five invented customers, vendors and items and a year of
        // invented transactions, which made the product impossible to evaluate
        // against real books — every list, total and chart was fiction.
        return { ...prev, companies: [nextCompany] };
      }

      return prev;
    });
  }, [isAuthenticated, dbStorageKey, setDb]);



  // A 401 from any API call means the session is over; drop back to sign-in
  // instead of rendering a shell with no permissions.
  useEffect(() => {
    const onExpired = () => setIsAuthenticated(false);
    window.addEventListener('auth:session-expired', onExpired);
    return () => window.removeEventListener('auth:session-expired', onExpired);
  }, []);

  const logout = async () => {
    // Tell the server first: without this the refresh token stays valid and
    // "sign out" only clears this browser.
    try {
      /*
       * Through the platform client, not a bare '/api/...': in production the
       * web app and the API are on different hosts, and a relative URL posts
       * to the web host, where nothing ends the session. The client also sends
       * credentials, so the HttpOnly refresh cookie reaches the server and is
       * cleared there.
       */
      await platformLogout();
    } catch {
      // A failed call must not trap the user in a signed-in shell.
    }
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
    // The shell owns sign-in; without this it keeps the signed-in frame.
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  };

  // The Companies page can switch which company the whole product operates
  // on; first-in-list remains the fallback so existing single-company data
  // behaves exactly as before.
  const currentCompany =
    (db.companies || []).find((c) => c.id === db.activeCompanyId) ||
    (db.companies || [])[0] ||
    { id: 1, name: 'Accounting', currency: 'INR' };

  // Fresh browser, existing books: pull server documents into the local db.
  useServerDocSync({ enabled: isAuthenticated, currentCompanyId: currentCompany?.id, setDb });
  /* The TDS compliance stores follow the same rule as every master: local
     is the working copy, the server is where every device meets. */
  useTdsSync(db, setDb, isAuthenticated ? currentCompany : null);
  useEffect(() => {
    if (!isAuthenticated || !currentCompany?.id) return;
    setDb((previous) => reconcileExpenseTdsTransactions(previous, currentCompany));
  }, [
    isAuthenticated,
    currentCompany,
    db.expenses,
    db.vendors,
    db.chartOfAccounts,
    db.tdsTransactions,
    setDb,
  ]);
  // Stock adjustments and transfers, shared through the server like every other document.
  useStockSync(db, setDb, isAuthenticated ? currentCompany : null);


  /*
   * Recurring invoices are raised by the server, not here.
   *
   * This used to materialise the due drafts on sign-in, which meant a business
   * that took a fortnight off billed nobody, and two open tabs could raise the
   * same month twice. The schedules now live in a table and an hourly job on
   * the API raises them, keyed so one period can only ever be billed once.
   *
   * The hook is kept and no longer called from here: it still owns the local
   * templates a browser recorded before the migration, and the Recurring screen
   * offers Run now for anyone who does not want to wait for the hour.
   */

  useEffect(() => {
    if (!isAuthenticated) return;
    const existing = String(selectedBranchId() || '').trim();
    if (existing) return;
    const fallback = currentCompany?.profile?.backendBranchId;
    if (fallback) {
      selectBranch(String(fallback));
      return;
    }

    // Some login flows don't provide backendBranchId but the backend still requires x-branch-id.
    // As a fallback, reuse the first selected dashboard branch (if any) so we can load branches/warehouses.
    try {
      const raw = String(localStorage.getItem(companyStorageKey('dashboardBranchIds')) || '').trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const first = Array.isArray(parsed) ? normalizeId(parsed[0]) : '';
      if (!first) return;
      selectBranch(String(first));
    } catch {
      // ignore
    }
  }, [isAuthenticated, currentCompany?.profile?.backendBranchId]);

  const [activeWarehouseId, setActiveWarehouseId] = useState(() => String(selectedWarehouseId() || ''));
  const [activeBranchId, setActiveBranchId] = useState(() => String(selectedBranchId() || ''));
  const financialYearCollections = useMemo(() => [
    'invoices', 'creditNotes', 'bills', 'debitNotes', 'expenses', 'receipts', 'payments',
    'journalEntries', 'bankTransactions', 'estimates', 'purchaseOrders', 'salesOrders',
    'deliveryChallans', 'stockTransfers', 'stockAdjustments', 'tdsTransactions', 'tdsChallans',
  ], []);
  const fiscalYearStartMonth = useMemo(() => {
    const configured = String(currentCompany?.financialYearStart || currentCompany?.fiscalYearStart || '').trim();
    const month = Number(configured.slice(5, 7));
    return Number.isFinite(month) && month >= 1 && month <= 12 ? month : 4;
  }, [currentCompany?.financialYearStart, currentCompany?.fiscalYearStart]);
  const financialYearForDate = useCallback((value) => {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';
    const start = month >= fiscalYearStartMonth ? year : year - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }, [fiscalYearStartMonth]);
  const financialYearOptions = useMemo(() => {
    const years = new Set();
    financialYearCollections.forEach((collection) => {
      (Array.isArray(db?.[collection]) ? db[collection] : []).forEach((row) => {
        if (Number(row?.companyId) !== Number(currentCompany?.id)) return;
        const year = financialYearForDate(row?.date || row?.transactionDate || row?.voucherDate || row?.invoiceDate || row?.challanDate || row?.orderDate);
        if (year) years.add(year);
      });
    });
    return [...years].sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)));
  }, [db, currentCompany?.id, financialYearCollections, financialYearForDate]);
  const [activeFinancialYear, setActiveFinancialYear] = useState(() => String(localStorage.getItem('activeFinancialYear') || ''));
  const displayedFinancialYear = financialYearOptions.includes(activeFinancialYear) ? activeFinancialYear : financialYearOptions[0] || '';
  useEffect(() => {
    if (!displayedFinancialYear || displayedFinancialYear === activeFinancialYear) return;
    setActiveFinancialYear(displayedFinancialYear);
    localStorage.setItem('activeFinancialYear', displayedFinancialYear);
  }, [displayedFinancialYear, activeFinancialYear]);
  const [warehouses, setWarehouses] = useState([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [warehousesError, setWarehousesError] = useState('');

  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  // What the Companies screen should do on arrival: 'create' opens its form,
  // so "Add company" is one click rather than two screens.
  const [companiesIntent, setCompaniesIntent] = useState(null);

  const [authCtx, setAuthCtx] = useState({ loading: false, error: '', data: null });

  const activeOrgId = String(platformOrgId() || '').trim();
  const [warehousesReloadKey, setWarehousesReloadKey] = useState(0);
  const reloadWarehouses = useCallback(() => setWarehousesReloadKey((x) => x + 1), []);

  // Load allowed branches for the logged-in user (active org). Intentionally skips x-branch-id.
  useEffect(() => {
    if (!isAuthenticated) return;
    const orgId = String(platformOrgId() || '').trim();
    if (!orgId) return;

    let cancelled = false;
    const load = async () => {
      setAuthCtx({ loading: true, error: '', data: null });
      try {
        const data = await getMyAuthContext();
        if (cancelled) return;
        setAuthCtx({ loading: false, error: '', data });
      } catch (e) {
        if (cancelled) return;
        setAuthCtx({ loading: false, error: String(e?.message || e), data: null });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activeOrgId]);

  /*
   * Identity for the chrome. `/auth/me` is already fetched once per session
   * for permissions, so the name and picture come from there rather than a
   * second request — and they update the moment the profile page saves,
   * because that response is written back into the same context.
   *
   * localStorage is the fallback for the first paint, before /auth/me lands.
   *
   * Declared here rather than beside the header that renders it: the `screen`
   * memo hands these to the dashboard, and a const read above its declaration
   * is not a warning, it is a blank page.
   */
  const meUser = authCtx?.data?.user || {};
  const userEmail = String(meUser.email || localStorage.getItem('userEmail') || '').trim() || 'User';
  const userDisplayName =
    [meUser.firstName, meUser.lastName].filter(Boolean).join(' ').trim() || String(meUser.fullName || '').trim();
  const userAvatarUrl = meUser.avatarUrl || '';
  const userInitials = (() => {
    const src = userDisplayName || userEmail;
    const parts = String(src).trim().split(/[\s._@-]+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  })();

  const isOrgAdmin = Boolean(authCtx?.data?.isOrgAdmin);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  /* Closed by a click anywhere else and by Escape — the second of which it did
     not have, so the company switcher was the one header menu the keyboard
     could not put away. */
  const orgMenuRef = useDismissable(orgMenuOpen, () => setOrgMenuOpen(false));


  const availableOrgs = useMemo(() => {
    const list = authCtx?.data?.orgs;
    return Array.isArray(list) ? list : [];
  }, [authCtx?.data]);

  /*
   * The company this account holds, from the server.
   *
   * Signing in on a machine that has never seen these books used to land on a
   * placeholder called "Company" with no GSTIN and no state, offering to set
   * up the company that signup had already created. This fills the record in
   * from `/auth/me`; anything typed locally wins.
   */
  useCompanyFromServer({
    enabled: isAuthenticated,
    orgs: availableOrgs,
    activeOrgId,
    setDb,
  });

  const activeOrgName = useMemo(() => {
    const match = availableOrgs.find((o) => String(o.orgId) === String(activeOrgId));
    return match?.org?.name || currentCompany?.name || 'Accounting';
  }, [availableOrgs, activeOrgId, currentCompany?.name]);

  /**
   * Switching company is the shell's act (A-27). This menu wrote its own
   * `activeOrgId` and reloaded — a second store the shell had stopped reading,
   * so once the shell's picker had been used it did nothing at all. It asks
   * the shell now, which changes the address and remounts this app for the
   * other company; each company keeps its own branch and warehouse.
   */
  const switchOrg = useCallback((nextOrgId) => {
    const target = String(nextOrgId || '').trim();
    setOrgMenuOpen(false);
    if (!target || target === String(platformOrgId() || '')) return;
    requestSwitchCompany(target);
  }, []);
  const allowedBranchIds = useMemo(() => {
    const ids = authCtx?.data?.allowedBranchIds;
    return Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  }, [authCtx?.data]);

  // Branch/warehouse authority comes from the server (/auth/me) only. Never from
  // a locally-stored identity, which the user controls.
  const hasBranchRestriction = useMemo(
    () => branchesFeatureEnabled && !isOrgAdmin,
    [branchesFeatureEnabled, isOrgAdmin],
  );

  const allowedBranchIdSet = useMemo(() => new Set(allowedBranchIds.map((x) => String(x))), [allowedBranchIds]);

  const branchesForUser = useMemo(() => {
    if (!branchesFeatureEnabled) return Array.isArray(branches) ? branches : [];
    if (!hasBranchRestriction) return branches;
    return (Array.isArray(branches) ? branches : []).filter((b) => allowedBranchIdSet.has(String(b?.id)));
  }, [branches, hasBranchRestriction, allowedBranchIdSet, branchesFeatureEnabled]);

  const warehousesForUser = useMemo(() => {
    if (!warehousesFeatureEnabled) return Array.isArray(warehouses) ? warehouses : [];
    if (!hasBranchRestriction) return warehouses;
    return (Array.isArray(warehouses) ? warehouses : []).filter((w) => allowedBranchIdSet.has(String(w?.branchId)));
  }, [warehouses, hasBranchRestriction, allowedBranchIdSet, warehousesFeatureEnabled]);

  const allowedWarehouseIdSet = useMemo(() => {
    return new Set((Array.isArray(warehousesForUser) ? warehousesForUser : []).map((w) => String(w?.id)));
  }, [warehousesForUser]);

  // Establish the branch before branch-scoped permissions and masters load.
  // This also covers restored owner/admin sessions: /auth/me returns every
  // allowed branch, but those sessions previously skipped this effect and
  // remained without x-branch-id until the user signed out and back in.
  useEffect(() => {
    if (!isAuthenticated) return;
    // authCtx starts as { loading: false, data: null }, so "not loading" is not
    // the same as "answered". Acting before /auth/me returns would clear the
    // active branch on every page load, because allowedBranchIds is still empty.
    if (authCtx.loading || !authCtx.data) return;

    const existing = String(selectedBranchId() || '').trim();
    if (existing && allowedBranchIdSet.has(existing)) {
      if (String(activeBranchId || '') !== existing) setActiveBranchId(existing);
      return;
    }

    const firstAllowed = allowedBranchIds.length ? String(allowedBranchIds[0]) : '';
    if (!firstAllowed) {
      selectBranch('');
      setActiveBranchId('');
      return;
    }
    selectBranch(firstAllowed);
    setActiveBranchId(firstAllowed);
    if (typeof reloadWarehouses === 'function') reloadWarehouses();
  }, [isAuthenticated, authCtx.loading, authCtx.data, allowedBranchIds, allowedBranchIdSet, activeBranchId, reloadWarehouses]);

  // Filter local DB vouchers/transfers by allowed warehouses/branches for non-admin users.
  const dbForAccess = useMemo(() => {
    const activeWh = String(activeWarehouseId || '').trim();
    const activeBr = String(activeBranchId || '').trim();
    const scoped = Boolean(activeWh) || Boolean(activeBr);
    if (!hasBranchRestriction && !scoped) return db;

    // Where the user says they are standing, from the header. Picking a
    // warehouse means every list is that warehouse's work; "All warehouses" is
    // the company-wide view. A document filed before warehouses existed has no
    // warehouse of its own, so it only shows in the company-wide view.
    const warehouseBranch = new Map(
      (Array.isArray(warehouses) ? warehouses : []).map((w) => [String(w?.id), String(w?.branchId || '')])
    );
    const inActiveScope = (row) => {
      if (!scoped) return true;
      const whId = String(row?.warehouseId || '').trim();
      const brId = String(row?.branchId || '').trim() || warehouseBranch.get(whId) || '';
      // Older records were filed before the app asked where they belonged.
      // Hiding them everywhere would lose them, so they stay visible.
      if (!whId && !brId) return true;
      if (activeWh) return whId ? whId === activeWh : brId === (warehouseBranch.get(activeWh) || '');
      return brId === activeBr;
    };
    const transferInActiveScope = (t) => {
      if (!scoped) return true;
      if (activeWh) {
        return (
          String(t?.sourceWarehouseId || '').trim() === activeWh ||
          String(t?.targetWarehouseId || '').trim() === activeWh
        );
      }
      return (
        String(t?.sourceBranchId || '').trim() === activeBr || String(t?.targetBranchId || '').trim() === activeBr
      );
    };

    const filterByWarehouse = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return list.filter((r) => {
        if (Number(r?.companyId) !== Number(currentCompany?.id)) return true;
        if (!inActiveScope(r)) return false;
        if (!hasBranchRestriction) return true;
        const whId = String(r?.warehouseId || '').trim();
        if (!whId) return false;
        return allowedWarehouseIdSet.has(whId);
      });
    };

    // A transfer belongs to both ends of it: the branch that sends it and the
    // branch that has to approve it. Filtering on the sender alone would hide
    // an inbound consignment from the only people who can receive it.
    const filterTransfers = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return list.filter((t) => {
        if (Number(t?.companyId) !== Number(currentCompany?.id)) return true;
        if (!transferInActiveScope(t)) return false;
        if (!hasBranchRestriction) return true;
        const sourceBranchId = String(t?.sourceBranchId || '').trim();
        const targetBranchId = String(t?.targetBranchId || '').trim();
        if (!sourceBranchId && !targetBranchId) return false;
        return (
          (sourceBranchId && allowedBranchIdSet.has(sourceBranchId)) ||
          (targetBranchId && allowedBranchIdSet.has(targetBranchId))
        );
      });
    };

    return {
      ...db,
      invoices: filterByWarehouse(db?.invoices),
      creditNotes: filterByWarehouse(db?.creditNotes),
      bills: filterByWarehouse(db?.bills),
      debitNotes: filterByWarehouse(db?.debitNotes),
      estimates: filterByWarehouse(db?.estimates),
      purchaseOrders: filterByWarehouse(db?.purchaseOrders),
      salesOrders: filterByWarehouse(db?.salesOrders),
      deliveryChallans: filterByWarehouse(db?.deliveryChallans),
      expenses: filterByWarehouse(db?.expenses),
      stockTransfers: filterTransfers(db?.stockTransfers),
    };
  }, [
    db,
    hasBranchRestriction,
    allowedWarehouseIdSet,
    allowedBranchIdSet,
    currentCompany?.id,
    activeWarehouseId,
    activeBranchId,
    warehouses,
  ]);

  // The header FY is a real book scope. Only transaction collections are
  // narrowed; customers, ledgers, items and settings remain fully available
  // so an older year can still resolve every name and account it refers to.
  const dbForUser = useMemo(() => {
    const scoped = { ...dbForAccess, branches: branchesForUser, warehouses: warehousesForUser };
    if (!displayedFinancialYear) return scoped;
    financialYearCollections.forEach((collection) => {
      const rows = dbForAccess?.[collection];
      if (!Array.isArray(rows)) return;
      scoped[collection] = rows.filter((row) => {
        if (Number(row?.companyId) !== Number(currentCompany?.id)) return true;
        const year = financialYearForDate(row?.date || row?.transactionDate || row?.voucherDate || row?.invoiceDate || row?.challanDate || row?.orderDate);
        return year === displayedFinancialYear;
      });
    });
    return scoped;
  }, [dbForAccess, branchesForUser, warehousesForUser, currentCompany?.id, displayedFinancialYear, financialYearCollections, financialYearForDate]);

  /* Another app's shell may send someone straight to settings (?open=settings or a settings key); taken once, then forgotten from the address. */
  const [active, setActive] = useState(() => {
    try {
      const open = String(new URLSearchParams(window.location.search).get('open') || '').trim();
      if (open && (open === 'settings' || isSettingsKey(open) || ['invoices', 'bills', 'receipts', 'approvals', 'expenses'].includes(open))) {
        window.history.replaceState(null, '', window.location.pathname);
        return open;
      }
    } catch {
      /* no address to read */
    }
    return 'dashboard';
  });
  const dedicatedSettingsMode = active === 'settings' || isSettingsKey(active);
  const dedicatedReportsMode = active === 'reports';
  const dedicatedMasterDataMode = MASTER_DATA_KEYS.has(active);
  const dedicatedWorkspaceMode = dedicatedSettingsMode || dedicatedReportsMode || dedicatedMasterDataMode;
  const workspaceReturnRef = useRef('dashboard');
  useEffect(() => {
    if (!dedicatedWorkspaceMode) workspaceReturnRef.current = active || 'dashboard';
  }, [active, dedicatedWorkspaceMode]);
  const exitWorkspace = useCallback(() => {
    setActive(workspaceReturnRef.current || 'dashboard');
  }, []);

  /*
   * The screen before this one, for the sub-screens that are reached from a
   * list's More menu and have to get back to it. A ref rather than state:
   * nothing renders from it, and writing it during a screen change should not
   * cause a second render.
   */
  /*
   * Where a jump came from, for screens that are also destinations in their
   * own right. Customers and Company Profile live in the rail, so they cannot
   * carry a permanent Back — but arriving at one from the setup checklist on
   * Home leaves no way back at all. Recorded as a pair, so the offer expires
   * on its own: the moment `active` is no longer the screen that was jumped
   * to, the bar stops rendering and nothing has to be cleared.
   */
  const [returnTo, setReturnTo] = useState(null);
  const lastScreenRef = useRef('invoices');
  /* Which kind the import screen should open on, set by the menu that opens it. */
  const [importKind, setImportKind] = useState('');
  const prevScreenRef = useRef(active);
  useEffect(() => {
    if (prevScreenRef.current !== active) {
      lastScreenRef.current = prevScreenRef.current;
      prevScreenRef.current = active;
    }
  }, [active]);

  /**
   * A new screen starts at the top of itself.
   *
   * The window keeps its scroll offset across a view change, so opening a
   * screen from halfway down a long list dropped you into the middle of the
   * next one — past its heading, its filters and its primary action, with no
   * indication anything was above. It reads as a half-loaded page.
   *
   * Not smooth: this is not the user scrolling, it is a different screen, and
   * animating it would imply the two are one continuous surface.
   */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [active]);

  const [ledgerNav, setLedgerNav] = useState({ ledgerId: null, returnTo: 'trialBalance' });
  /* The Bank & Cash Accounts screen's ledger form — a full page like the
     other masters, not a dialog. null | { mode: 'new' } | { mode: 'edit', ledger }. */
  const [bankAcctForm, setBankAcctForm] = useState(null);
  /* Leaving the screen closes its form. Without this, opening an account to
     edit it and then going anywhere else left the form open underneath: come
     back to Bank & Cash Accounts later and you are dropped into a half-
     finished edit of whatever you last clicked, with no list in sight. */
  useEffect(() => {
    if (active !== 'bankCashAccounts') setBankAcctForm(null);
  }, [active]);
  const openLedger = useCallback(
    (ledgerId) => {
      setLedgerNav({ ledgerId, returnTo: active });
      setActive('ledger');
    },
    [active]
  );
    const reportSections = useMemo(
      () => [
        {
          key: 'financials',
          title: 'Financials',
          items: [
            /*
             * One trial balance, and it is the ledger's.
             *
             * There were two. `ledgerTrialBalance` asks the server, which is
             * where the books are; `trialBalance` added up balances held in
             * this browser's working copy. They agreed only while every entry
             * in the ledger had come from a document this browser knew about —
             * so the day payroll posted a salary journal from its own database,
             * the local one showed Salaries & Wages as empty and still called
             * itself balanced. A report that is confidently wrong is worse than
             * one that is missing.
             *
             * The local screen is still reachable at `trialBalance` for now,
             * and is not offered here.
             */
            { key: 'ledgerTrialBalance', label: 'Trial Balance' },
            { key: 'generalLedger', label: 'General Ledger' },
            { key: 'profitLoss', label: 'P&L' },
            { key: 'balanceSheet', label: 'Balance Sheet' },
            { key: 'cashFlow', label: 'Cash Flow' },
          ],
        },
        {
          key: 'sales',
          title: 'Sales',
          items: [
            { key: 'salesReports', label: 'Sales Reports' },
            { key: 'salesBySalesman', label: 'Sales by Salesman' },
          ],
        },
        {
          key: 'accountant',
          title: 'Accountant',
          items: [
            { key: 'tallyExport', label: 'Tally Export' },
            { key: 'tds', label: 'TDS' },
            { key: 'tdsTcs', label: 'TDS / TCS (194Q & 206C)' },
            { key: 'fixedAssets', label: 'Fixed Assets' },
            { key: 'yearEndClose', label: 'Year-End Close' },
            { key: 'costCenters', label: 'Cost Centers' },
          ],
        },
      ],
      []
    );

    const reportPageKeys = useMemo(() => {
      const keys = new Set();
      for (const sec of reportSections) {
        for (const it of sec.items || []) {
          keys.add(String(it.key));
        }
      }
      return keys;
    }, [reportSections]);

  const [modal, setModal] = useState({ content: null, title: 'Form', maxWidthClass: 'max-w-4xl', headerActions: null, showCloseIcon: true });
  const [invoiceEditor, setInvoiceEditor] = useState({ open: false, initial: null });
  const [estimateEditor, setEstimateEditor] = useState({ open: false, initial: null });
  const [receiptEditor, setReceiptEditor] = useState({ open: false });
  const [paymentEditor, setPaymentEditor] = useState({ open: false, initial: null });
  const [billEditor, setBillEditor] = useState({ open: false, initial: null });

  /*
   * Settings is a detour, not a destination.
   *
   * Every open editor was torn down the moment the screen key changed, which
   * included the deliberate hop a document form makes to the screen that
   * configures it: ⋮ → Custom fields, the numbering panel's All numbering.
   * Back then returned to the list, having thrown the document away, and the
   * menu entry that sent you there was the thing that lost it.
   *
   * While a settings screen is on show, whatever document was open stays open,
   * so Back lands on the document again. Leaving for any other module still
   * closes it — that is a change of subject, not a detour.
   */
  const onSettingsDetour = isSettingsRoute(active);
  const [poEditor, setPoEditor] = useState({ open: false, initial: null });
  const [debitNoteEditor, setDebitNoteEditor] = useState({ open: false, initialOriginalBillId: null });
  const [creditNoteEditor, setCreditNoteEditor] = useState({ open: false, initialOriginalInvoiceId: null });
  const [journalEditor, setJournalEditor] = useState({ open: false, initial: null });
  const [stockTransferEditor, setStockTransferEditor] = useState({ open: false, initial: null });

  useEffect(() => {
    if (onSettingsDetour) return;
    if (active !== 'invoices') {
      setInvoiceEditor({ open: false, initial: null });
    }
  }, [active, onSettingsDetour]);

  useEffect(() => {
    if (onSettingsDetour) return;
    if (active !== 'estimates') {
      setEstimateEditor({ open: false, initial: null });
    }
  }, [active, onSettingsDetour]);

  useEffect(() => {
    if (onSettingsDetour) return;
    if (active !== 'bills') setBillEditor({ open: false, initial: null });
    if (active !== 'debitNotes') setDebitNoteEditor({ open: false, initialOriginalBillId: null });
    if (active !== 'creditNotes') setCreditNoteEditor({ open: false, initialOriginalInvoiceId: null });
    if (active !== 'receipts') setReceiptEditor({ open: false });
    if (active !== 'payments' && active !== 'paymentsExpense') setPaymentEditor({ open: false });
    if (active !== 'journalEntries') setJournalEditor({ open: false, initial: null });
    if (active !== 'warehouseTransfers' && active !== 'branchTransfers') setStockTransferEditor({ open: false, initial: null });
  }, [active, onSettingsDetour]);

  // What each settings area would tell you if you opened it. Shown beside its
  // name in the rail, so "is email set up?" and "how many branches?" answer
  // themselves. Cheap to read, and it keeps a 15-item list from being opaque.
  const branchCountLabel = branches.length ? String(branches.length) : '';
  const warehouseCountLabel = warehouses.length ? String(warehouses.length) : '';
  const featureCountLabel = useMemo(() => {
    const flags = currentCompany?.profile?.features;
    if (!flags || typeof flags !== 'object') return '';
    const values = Object.values(flags);
    if (!values.length) return '';
    return `${values.filter(Boolean).length}/${values.length}`;
  }, [currentCompany?.profile?.features]);
  const gstStateLabel =
    (currentCompany?.profile?.taxCompliances?.gstEnabled ?? currentCompany?.gstEnabled ?? currentCompany?.gstin) ? 'GST on' : 'GST off';
  const emailStateLabel = currentCompany?.profile?.emailSettings?.fromAddress ? '' : 'Not set';

  const navModel = useMemo(
    () => [
      { type: 'item', key: 'dashboard', label: 'Home', icon: PhDashboard, ph: true, tone: 'dashboard' },
      {
        type: 'group',
        key: 'salesMenu',
        label: 'Sales',
        tone: 'sales',
        icon: PhSales,
        ph: true,
        items: [
          { key: 'sales', label: 'Overview', icon: BarChart3, perm: 'SALES::Invoices::VIEW' },
          { key: 'customers', label: 'Customers', icon: Users, perm: 'MASTERS::Customers::VIEW' },
          { key: 'invoices', label: 'Invoices', icon: FileText, perm: 'SALES::Invoices::VIEW' },
          { key: 'pos', label: 'POS', icon: Receipt, perm: 'SALES::Invoices::CREATE', feature: 'pos' },
          { key: 'receipts', label: 'Receipts', icon: Receipt, perm: 'SALES::Receipts::VIEW', feature: 'standaloneReceiptsPayments' },
          { key: 'estimates', label: 'Quotations', icon: ClipboardList, perm: 'SALES::Estimates::VIEW', feature: 'estimates' },
          { key: 'salesOrders', label: 'Sales Orders', icon: ClipboardList, perm: 'SALES::Invoices::VIEW', feature: 'salesOrders' },
          { key: 'deliveryChallans', label: 'Delivery Challans', icon: Truck, perm: 'SALES::Invoices::VIEW', feature: 'deliveryChallans' },
          { key: 'creditNotes', label: 'Sales Returns', icon: Receipt, perm: 'SALES::Credit Notes::VIEW', feature: 'creditNotes' },
          { key: 'recurringInvoices', label: 'Recurring', icon: RefreshCw, perm: 'SALES::Invoices::VIEW', feature: 'recurringInvoices' },
          { key: 'salesmen', label: 'Salesmen', icon: Users, perm: 'SALES::Invoices::VIEW', feature: 'salesmen' },
        ],
      },
      {
        type: 'group',
        key: 'purchasesMenu',
        label: 'Purchases',
        tone: 'purchases',
        icon: PhPurchases,
        ph: true,
        items: [
          { key: 'purchaseOverview', label: 'Overview', icon: BarChart3, perm: 'PURCHASE::Bills::VIEW' },
          { key: 'vendors', label: 'Vendors', icon: Truck, perm: 'MASTERS::Vendors::VIEW' },
          { key: 'bills', label: 'Bills', icon: FileStack, perm: 'PURCHASE::Bills::VIEW' },
          { key: 'expenses', label: 'Expenses', icon: PhExpenses, perm: 'EXPENSES::Expenses::VIEW', feature: 'expenses' },
          { key: 'payments', label: 'Payments', icon: NotebookPen, perm: 'PURCHASE::Payments::VIEW', feature: 'standaloneReceiptsPayments' },
          { key: 'purchaseOrders', label: 'Purchase Orders', icon: ShoppingCart, perm: 'PURCHASE::Purchase Orders::VIEW', feature: 'purchaseOrders' },
          { key: 'debitNotes', label: 'Purchase Returns', icon: NotebookPen, perm: 'PURCHASE::Debit Notes::VIEW', feature: 'debitNotes' },
        ],
      },
      {
        /*
         * Three screens, and only three: where the money is, what happened to
         * it, and what the bank says. They were two unrelated rail entries —
         * "Cash & Bank", which was actually the transaction list, and "Bank
         * Reconciliation" — with no screen at all for the accounts themselves.
         */
        type: 'group',
        key: 'cashBankMenu',
        label: 'Cash & Bank',
        tone: 'cashbank',
        icon: PhBank,
        ph: true,
        items: [
          { key: 'bankCashAccounts', label: 'Bank & Cash Accounts', icon: Landmark, perm: 'CASHBANK::Cash & Bank::VIEW' },
          { key: 'cashBank', label: 'Transactions', icon: ArrowLeftRight, perm: 'CASHBANK::Cash & Bank::VIEW' },
          /*
           * Not feature-gated. The module IS these three screens — where the
           * money is, what happened to it, and what the bank says — and a
           * flag that hides the third leaves a two-legged module and a person
           * asking where reconciliation went. The permission still applies.
           */
          { key: 'bankReco', label: 'Reconciliation', icon: ListChecks, perm: 'CASHBANK::Cash & Bank::VIEW' },
        ],
      },
      {
        type: 'group',
        key: 'inventoryMenu',
        label: 'Inventory',
        tone: 'inventory',
        icon: PhInventory,
        ph: true,
        items: [
          { key: 'inventory', label: 'Inventory', icon: Package, perm: 'INVENTORY::Stock Adjustment::VIEW', feature: 'inventory' },
          { key: 'warehouseTransfers', label: 'Warehouse Transfers', icon: Truck, perm: 'INVENTORY::Stock Transfer::VIEW', features: ['stockTransfers', 'warehouses'] },
          { key: 'branchTransfers', label: 'Branch Transfers', icon: Truck, perm: 'INVENTORY::Inter-branch transfer::VIEW', features: ['stockTransfers', 'branches'] },
          { key: 'batchSerial', label: 'Batches & Serials', icon: Boxes, perm: 'INVENTORY::Stock Adjustment::VIEW', feature: 'batchSerial' },
          { key: 'stockAdjustments', label: 'Stock Adjustments', icon: ClipboardList, perm: 'INVENTORY::Stock Adjustment::VIEW' },
          { key: 'batchStock', label: 'Batch Stock & Expiry', icon: Boxes, perm: 'INVENTORY::Stock Adjustment::VIEW', feature: 'batchExpiry' },
          { key: 'reorderAlerts', label: 'Reorder Alerts', icon: Package, perm: 'INVENTORY::Stock Adjustment::VIEW', feature: 'reorderAlerts' },
        ],
      },
      /*
       * Payroll sits between the money that goes out and the books it lands
       * in, which is where somebody looks for it. Setup is not here — salary
       * components, pay groups, periods and the statutory rates live under
       * Settings → Payroll, so the month-end path is Overview, Pay Runs, done.
       */
      { type: 'item', key: 'journalEntries', label: 'Journal Entries', icon: PhJournal, ph: true, tone: 'journal', perm: 'ACCOUNTING::Journal Entries::VIEW' },
      { type: 'item', key: 'approvals', label: 'Approvals', icon: PhApprovals, ph: true, tone: 'approvals', feature: 'approvals' },
      {
        type: 'group',
        key: 'complianceMenu',
        label: 'Compliance',
        tone: 'reports',
        icon: PhApprovals,
        ph: true,
        items: [
          { key: 'gstCompliance', label: 'GST', icon: BadgePercent, permAny: ['REPORTS::GSTR-1::VIEW', 'REPORTS::GSTR-3B::VIEW'] },
          { key: 'tds', label: 'TDS', icon: FileText },
          { key: 'msmeCompliance', label: 'MSME', icon: Building2, perm: 'MASTERS::Vendors::VIEW' },
        ],
      },
      { type: 'item', key: 'reports', label: 'Reports', icon: PhReports, ph: true, tone: 'reports', permAny: ['REPORTS::Trial Balance::VIEW','REPORTS::Profit & Loss::VIEW','REPORTS::Balance Sheet::VIEW','REPORTS::Cash Flow::VIEW','REPORTS::Sales Reports::VIEW','REPORTS::GSTR-1::VIEW','REPORTS::GSTR-3B::VIEW'] },
      {
        type: 'item',
        key: 'mdm',
        label: 'Master Data',
        tone: 'masterdata',
        icon: PhMaster,
        ph: true,
        items: [
          /*
           * "Companies", not "Company Profile". Two nav entries carried that
           * same label and opened different screens — this list of every
           * company in the group, and the single active company's own record
           * under Organisation — so asking for company profile got you
           * whichever one you happened to click.
           */
          { key: 'companies', label: 'Companies', icon: Building2, perm: 'SETTINGS::Company Profile::VIEW', feature: 'companyGroups' },
          { type: 'subgroup', label: 'Items' },
          { key: 'items', label: 'Item List', icon: Tags, perm: 'MASTERS::Items::VIEW' },
          { key: 'itemCategories', label: 'Item Categories', icon: Tags, perm: 'MASTERS::Items::VIEW' },
          { key: 'uoms', label: 'Units', icon: Boxes, perm: 'MASTERS::Items::VIEW' },
          { key: 'priceLists', label: 'Price Lists', icon: Tags, perm: 'MASTERS::Items::VIEW', feature: 'priceLists' },
          { key: 'bankCash', label: 'Chart of Accounts', icon: Building2, perm: 'ACCOUNTING::Chart of Accounts::VIEW' },
          { key: 'gstRates', label: 'GST Rates', icon: BadgePercent, perm: 'MASTERS::GST Rates::VIEW' },
          { key: 'invoiceTemplates', label: 'Invoice Templates', icon: FileText, perm: 'SETTINGS::Document Templates::VIEW' },
          { key: 'docNumbering', label: 'Numbering', icon: Settings, perm: 'SETTINGS::Document Numbering::VIEW' },
          { key: 'settingsTerms', label: 'Terms & Conditions', icon: FileText, perm: 'SETTINGS::Document Templates::VIEW' },
        ],
      },
            /*
       * One entry, not a group of thirty-four.
       *
       * Expanded, Settings pushed every other module off the screen and became
       * something you scrolled rather than read. It opens its own workspace
       * now — a hub of six categories, each with its settings beside the page
       * they configure — so the rail stays a list of what the product does.
       */
      {
        /*
         * Not a child of Settings.
         *
         * Features answers "do we use this?"; Settings answers "how should it
         * behave?". Nesting the first inside the second made the question
         * findable only by someone who already knew the answer.
         */
        type: 'item',
        key: 'features',
        label: 'Features',
        icon: SlidersHorizontal,
        tone: 'settings',
        perm: 'SETTINGS::Company Profile::VIEW',
      },
      { type: 'item', key: 'settings', label: 'Settings', icon: PhSettings, tone: 'settings', ph: true, perm: 'SETTINGS::Company Profile::VIEW' },
    ],
    /*
     * `isEnabled` belongs here.
     *
     * Without it the rail was built once — while the feature flags were still
     * loading, when everything reads as enabled — and never rebuilt. A company
     * without payroll could be shown the whole payroll menu until something
     * else happened to invalidate this memo, and switching an application on
     * did nothing visible until the page was reloaded.
     */
    [branchCountLabel, warehouseCountLabel, featureCountLabel, gstStateLabel, emailStateLabel, isEnabled]
  );

  /*
   * What a screen is called, taken from the rail rather than a second list —
   * a back button that names a screen differently from the menu it came from
   * is a back button nobody trusts.
   */
  /*
   * A plain function: this is a lookup over a dozen entries, run when a button
   * needs its label, and nothing about it is worth a memo.
   */
  const screenLabel = (key) => {
    const want = String(key || '');
    for (const node of navModel || []) {
      if (node?.key === want && node.label) return node.label;
      for (const item of node?.items || []) {
        if (String(item?.key) === want) return item.label;
      }
    }
    return 'Home';
  };


  // Hide anything the user cannot open. The server re-checks on every request;
  // this only stops the UI offering doors that are locked.
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  /*
   * Alt+I / S / P / R / C / D and Ctrl+/ — the review sheet's global set.
   *
   * Each one lands the operator on the screen that owns the document and
   * opens its editor, rather than opening a floating form over whatever they
   * were looking at: the list behind a new invoice is part of how you check
   * you are not raising it twice.
   */
  /* The rows scroll, the page does not — see useFitToViewport. */
  useFitToViewport(active);

  /* Arrows walk the rows of a list; Enter opens one — see useListKeys. */
  useListKeys(active);

  /*
   * The screen, in the address bar.
   *
   * A key counts as a screen if the rail names it or the settings hub does. An
   * unknown one is ignored rather than rendered: the switch's default is the
   * sales overview, so a typo in a link would have shown somebody a page they
   * did not ask for and no error.
   */
  const isKnownScreen = useCallback(
    (key) => {
      const want = String(key || '');
      /* An old link to the company's administration is kept: it opens the same page in Company admin (ADR-010). */
      if (COMPANY_ADMIN_REDIRECTS[want]) return true;
      const featureList = HUB_SCREEN_FEATURES[want] || [];
      if (HUB_SCREENS.has(want)) return featureList.every((feature) => isEnabled(feature));
      // Master Data owns its own navigation rail. Its child routes are not all
      // repeated in the application's main rail, so validating only against
      // navModel made valid pages such as TDS briefly open and then get reset
      // to Dashboard by the unknown-screen guard below.
      if (MASTER_DATA_KEYS.has(want)) {
        if (want === 'tdsRates') return can('MASTERS::GST Rates::VIEW') && isEnabled('tds');
        if (want === 'tcsRates') return can('MASTERS::GST Rates::VIEW') && isEnabled('tcs');
        if (want === 'gstRates') return can('MASTERS::GST Rates::VIEW') && isEnabled('gst');
        return true;
      }
      if (visibleSettings({ can, isEnabled }).some((item) => String(item.key) === want)) return true;
      for (const node of navModel || []) {
        const candidates = node.items ? [node, ...(node.items || [])] : [node];
        const item = candidates.find((candidate) => String(candidate?.key) === want);
        if (!item) continue;
        return (
          (!item.perm || can(item.perm)) &&
          (!item.permAny || item.permAny.some((permission) => can(permission))) &&
          isEnabled(item.feature) &&
          (!item.features || item.features.every((feature) => isEnabled(feature)))
        );
      }
      return false;
    },
    [navModel, can, isEnabled]
  );

  useScreenUrl({ active, setActive, isKnown: isKnownScreen, ready: !permsLoading && !featuresLoading && !permsError });

  /*
   * Land in the app you actually use.
   *
   * Accounting was the whole product, so everybody arrived at its dashboard.
   * A company that bought Clor for Payroll and nothing else then landed in a
   * ledger they do not keep, and had to go looking for the thing they pay for.
   *
   * Only when there is exactly one app, and only when the URL has not already
   * asked for a screen — a link someone was sent, or a page they reloaded,
   * outranks this. It runs once the feature flags have loaded, because before
   * that every app reads as subscribed.
   */
  /*
   * Where somebody lands is the shell's decision now.
   *
   * This used to send a company with only Payroll into Payroll — from inside
   * Accounting, which is the contortion the platform layer exists to remove.
   * A company without Accounting never loads this file at all.
   */

  /* What the keyboard does, on `?`. */
  const shortcutSheet = useShortcutSheet();

  useGlobalShortcuts({
    newInvoice: () => {
      setActive('invoices');
      setInvoiceEditor({ open: true, initial: null });
    },
    newSalesOrder: () => setActive('salesOrders'),
    newPayment: () => {
      setActive('payments');
      setPaymentEditor({ open: true });
    },
    newReceipt: () => {
      setActive('receipts');
      setReceiptEditor({ open: true, initial: null });
    },
    newCreditNote: () => {
      setActive('creditNotes');
      setCreditNoteEditor({ open: true, initialOriginalInvoiceId: null });
    },
    dashboard: () => setActive('dashboard'),
    openCommand: () => setPaletteOpen(true),

    /*
     * Tally's voucher keys, on the screens that own those vouchers here.
     *
     * F4 is a contra in Tally — money moved between the company's own cash and
     * bank — which is the transfer on the Cash & Bank screen, not a document of
     * its own.
     */
    contra: () => setActive('cashBank'),
    newJournal: () => {
      setActive('journalEntries');
      setJournalEditor({ open: true, initial: null });
    },
    newBill: () => {
      setActive('bills');
      setBillEditor({ open: true, initial: null });
    },
  });

  // --- shell trio: collapsed rail, quick create, notifications ---
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('navCollapsed') === '1');
  const toggleNavCollapsed = () =>
    setNavCollapsed((v) => {
      try { localStorage.setItem('navCollapsed', v ? '0' : '1'); } catch { /* best effort */ }
      return !v;
    });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /*
   * Features is two things, and they are not the same thing.
   *
   * Asked for from the rail it is a DESTINATION: `#/features`, the full page,
   * exactly like Sales or Reports. Asked for from ⌘K it is a TOOL — the panel
   * over whatever screen you are on, because <main> is keyed on `active` and
   * navigating out of a half-typed invoice to switch one flag on remounted
   * the invoice and lost it. Reaching for the tool leaves the route alone;
   * closing it is the same as never having opened it.
   *
   * The rail used to open the panel too, which conflated the two: clicking
   * Features in the rail — an unambiguous "take me there" — washed out the
   * screen you were already looking at instead of going anywhere. So the
   * panel's open state is now its own state, never derived from the route.
   * The trigger element is kept so focus can go back to it.
   */
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const featuresTriggerRef = useRef(null);
  const openFeatures = useCallback((trigger = null) => {
    featuresTriggerRef.current = trigger;
    setMobileNavOpen(false);
    setFeaturesOpen(true);
  }, []);
  /*
   * Every destination in the rail puts the tool away on the way out.
   *
   * The effect below covers a change of route, but not the two cases that
   * matter most here: choosing the screen that is already showing, and
   * choosing Features itself while the panel is over something else. In both
   * `active` never changes, so without this the panel would survive the click
   * and the user would have to click twice.
   */
  const goTo = useCallback((key) => {
    setFeaturesOpen(false);
    /* Same reasoning for the phone drawer, which closes on `active` and so
       has the same blind spot: tapping the screen you are already on should
       reveal it, not leave the drawer over it. */
    setMobileNavOpen(false);
    setActive(key);
  }, []);
  useEffect(() => {
    setFeaturesOpen(false);
  }, [active]);
  /*
   * The contextual trigger — ⌘K, and any in-page "Features" link — answered
   * from where the user is standing.
   *
   * The rail never comes through here: clicking Features in the rail is an
   * unambiguous "take me there" and goes to the full page from anywhere,
   * like every other rail entry. This is for reaching Features WITHOUT
   * leaving: from Home and from the Features page itself there is nothing
   * underneath to keep, so it navigates; from everywhere else — a half-typed
   * invoice, a report scrolled to the right row, a settings screen mid-edit —
   * it opens the panel over the screen and leaves the route alone. A second
   * call while the panel is already up puts the panel away.
   */
  const handleFeaturesNavigation = useCallback(
    (trigger = null) => {
      if (featuresOpen) {
        setFeaturesOpen(false);
        return;
      }
      if (featuresPresentationFor(active) === 'page') {
        goTo('features');
        return;
      }
      openFeatures(trigger);
    },
    [featuresOpen, active, goTo, openFeatures]
  );
  /* There is no quick-actions menu any more — the header strip says where you
     are, and Command-K reaches the same list from anywhere. Its state and its
     ref outlived it by several releases, wired into the dismissal effect
     below and attached to no element at all. */

  // The drawer closes itself on navigation — tapping a destination should
  // reveal the page, not leave a panel covering it.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [active]);
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);


  /* Reminders from the books (invoices overdue, payables due this week) now come from the server into the bell every app shares (server/src/services/booksDigest.ts). */


  const QUICK_CREATE = [
    { label: 'Invoice', run: () => { setActive('invoices'); setInvoiceEditor({ open: true, initial: null }); } },
    { label: 'Bill', run: () => { setActive('bills'); setBillEditor({ open: true, initial: null }); } },
    { label: 'Journal entry', run: () => { setActive('journalEntries'); setJournalEditor({ open: true, initial: null }); } },
    { label: 'Expense', run: () => setActive('expenses') },
    { label: 'Customer', run: () => setActive('customers') },
    { label: 'Vendor', run: () => setActive('vendors') },
  ];

  /*
   * A category opens on its first setting rather than an empty page: the
   * person has already chosen once, and a category page with nothing selected
   * is a second menu in front of the one they chose from.
   */
  const openSettingsCategory = useCallback(
    (id) => {
      const first = visibleSettings({ can, isEnabled }).find((i) => i.category === id);
      setActive(first ? first.key : 'settings');
    },
    [can, isEnabled]
  );

  const visibleNav = useMemo(() => {
    if (permsLoading) return navModel;
    // Hidden when the user lacks the permission OR the org has the feature off.
    const allow = (entry) =>
      (!entry.perm || can(entry.perm)) &&
      (!entry.permAny || entry.permAny.some((k) => can(k))) &&
      isEnabled(entry.feature) &&
      (!entry.features || entry.features.every((feature) => isEnabled(feature)));
    return navModel
      .map((entry) => {
        if (entry.type !== 'group') return allow(entry) ? entry : null;
        const kept = entry.items.filter((i) => i.type === 'subgroup' || allow(i));
        // A heading whose every item was hidden by a permission or a feature
        // flag is a section that says nothing. Keep a heading only when a real
        // item follows it before the next heading — otherwise Settings grows
        // empty headings as modules are switched off.
        const items = kept.filter((item, idx) => {
          if (item.type !== 'subgroup') return true;
          for (let i = idx + 1; i < kept.length; i += 1) {
            if (kept[i].type === 'subgroup') break;
            return true;
          }
          return false;
        });
        return items.some((i) => i.type !== 'subgroup') ? { ...entry, items } : null;
      })
      .filter(Boolean);
  }, [navModel, can, permsLoading, isEnabled]);

  useEffect(() => {
    if (featuresLoading || permsLoading) return;
    // A failed permission load (on a cold start it runs before the company is
    // known) leaves no permissions, which would make every screen "unknown"
    // and throw a deep link back to Dashboard. Wait for a real answer.
    if (permsError) return;
    if (active === 'ledger' || active === 'partyDetail') return;
    if (!isKnownScreen(active)) setActive('dashboard');
  }, [active, featuresLoading, permsLoading, permsError, isKnownScreen]);

  /**
   * Palette entries come from the already permission- and feature-filtered nav,
   * so the palette can never offer a destination the sidebar hides. One source,
   * two surfaces.
   */
  const paletteItems = useMemo(() => {
    const out = [];
    for (const entry of visibleNav) {
      if (entry.type === 'group') {
        for (const item of entry.items) {
          if (item.type === 'subgroup') continue;
          out.push({ key: item.key, label: item.label, group: entry.label, icon: item.icon });
        }
      } else {
        out.push({ key: entry.key, label: entry.label, group: 'Go to', icon: entry.icon });
      }
    }
    return out;
  }, [visibleNav]);

  /**
   * The same nav, read as a set of screens the user can actually reach. The
   * record index is built against this, so the palette cannot surface a
   * document whose screen the sidebar is hiding.
   */
  const reachableScreens = useMemo(() => {
    const keys = new Set();
    for (const entry of visibleNav) {
      if (entry.type === 'group') entry.items.forEach((i) => { if (i.type !== 'subgroup') keys.add(i.key); });
      else keys.add(entry.key);
    }
    return keys;
  }, [visibleNav]);

  const recordIndex = useMemo(
    () =>
      buildRecordIndex({
        db: dbForUser,
        companyId: currentCompany?.id,
        canOpen: (screen) => reachableScreens.has(screen),
      }),
    [dbForUser, currentCompany?.id, reachableScreens]
  );

  const activeGroupKey = useMemo(() => {
    for (const entry of navModel) {
      if (entry.type !== 'group') continue;
      if (entry.items.some((i) => i.key === active)) return entry.key;
    }
    return null;
  }, [active, navModel]);

  /**
   * Which groups are open.
   *
   * The rail spent a day as a strip of unlabelled icons beside a column of the
   * current module. It read well and tested badly: nine glyphs, four of them
   * documents-with-lines, and no way to tell Purchases from Expenses without
   * hovering each one. Labels are what make a rail learnable — the reflow it
   * costs is the lesser problem.
   */
  const [openGroups, setOpenGroups] = useState(() => (activeGroupKey ? { [activeGroupKey]: true } : {}));

  useEffect(() => {
    if (!activeGroupKey) return;
    // Also closes whatever else was open: arriving somewhere is the same kind
    // of event as opening its group by hand.
    setOpenGroups((prev) => (prev[activeGroupKey] ? prev : { [activeGroupKey]: true }));
  }, [activeGroupKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const orgId = resolveServerOrgId(currentCompany);
    if (!orgId) return;

    let cancelled = false;
    const load = async () => {
      setWarehousesLoading(true);
      setWarehousesError('');
      try {
        const data = await listWarehouses(String(orgId));
        if (cancelled) return;
        const list = Array.isArray(data?.warehouses) ? data.warehouses : [];
        setWarehouses(list);
        if (activeWarehouseId && !list.some((w) => String(w.id) === String(activeWarehouseId))) {
          selectWarehouse('');
          setActiveWarehouseId('');
        }
      } catch (e) {
        if (cancelled) return;
        // Keep the last successful reference data visible. A transient API
        // failure must not make every warehouse picker appear unconfigured.
        setWarehousesError(String(e?.message || e));
      } finally {
        // Guarded rather than returned from: a return inside finally discards
        // whatever the try/catch was propagating.
        if (!cancelled) setWarehousesLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentCompany?.id, currentCompany?.profile?.backendCompanyId, activeOrgId, dbStorageKey, warehousesReloadKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const orgId = resolveServerOrgId(currentCompany);
    if (!orgId) return;

    let cancelled = false;
    const load = async () => {
      setBranchesLoading(true);
      setBranchesError('');
      try {
        const data = await listBranches(String(orgId));
        if (cancelled) return;
        const list = Array.isArray(data?.branches) ? data.branches : [];
        setBranches(list);
      } catch (e) {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(String(e?.message || e));
      } finally {
        // Guarded rather than returned from: a return inside finally discards
        // whatever the try/catch was propagating.
        if (!cancelled) setBranchesLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentCompany?.id, currentCompany?.profile?.backendCompanyId, activeOrgId, dbStorageKey]);

  // Ensure we always have an active branch id (some flows don't populate backendBranchId)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (branchesLoading) return;
    if (!Array.isArray(branches) || branches.length === 0) return;

    const existing = String(selectedBranchId() || '').trim();
    if (existing) return;

    const first = branches[0];
    const fallback = first?.id != null ? String(first.id) : '';
    if (!fallback) return;

    selectBranch(fallback);
    if (typeof reloadWarehouses === 'function') reloadWarehouses();
  }, [isAuthenticated, branchesLoading, branches, reloadWarehouses]);

  /* A disabled warehouse feature still has one accounting location. Keep it
     selected as the immutable default so every document can display and post
     to it without asking the user to make a warehouse decision. */
  useEffect(() => {
    if (!isAuthenticated || warehousesFeatureEnabled || warehousesLoading) return;
    if (String(activeWarehouseId || '').trim()) return;
    const first = (Array.isArray(warehousesForUser) ? warehousesForUser : [])[0];
    if (!first?.id) return;
    const id = String(first.id);
    selectWarehouse(id);
    setActiveWarehouseId(id);
  }, [activeWarehouseId, isAuthenticated, warehousesFeatureEnabled, warehousesForUser, warehousesLoading]);

  // The header's branch and warehouse pickers were removed; these stay until
  // that is decided (restore the pickers or delete these).
  // eslint-disable-next-line no-unused-vars
  const setActiveWarehouse = useCallback(
    (warehouseId) => {
      const nextId = warehouseId ? String(warehouseId) : '';
      if (nextId && !warehousesForUser.some((w) => String(w.id) === nextId)) {
        setWarehousesError('You do not have access to this warehouse.');
        return;
      }
      if (nextId) {
        selectWarehouse(nextId);
      } else {
        selectWarehouse('');
      }
      setActiveWarehouseId(nextId);
    },
    [warehousesForUser]
  );

  // Warehouses belonging to the branch currently in the header. A branch with
  // one warehouse needs no picker; the transfer forms still read the active id.
  // eslint-disable-next-line no-unused-vars
  const warehousesForActiveBranch = useMemo(() => {
    const list = Array.isArray(warehousesForUser) ? warehousesForUser : [];
    const bid = String(activeBranchId || '').trim();
    if (!bid) return list;
    const scoped = list.filter((w) => String(w?.branchId || '') === bid);
    return scoped.length ? scoped : list;
  }, [warehousesForUser, activeBranchId]);

  /**
   * Switching branch is the top-level shift: it re-scopes every screen, so the
   * warehouse selection is dropped (the old one belongs to the old branch) and
   * the warehouse list is refetched for the new branch.
   */
  // eslint-disable-next-line no-unused-vars
  const setActiveBranch = useCallback(
    (branchId) => {
      const nextId = branchId ? String(branchId) : '';
      if (!nextId) return;
      if (!branchesForUser.some((b) => String(b.id) === nextId)) return;

      selectBranch(nextId);
      selectWarehouse('');
      setActiveBranchId(nextId);
      setActiveWarehouseId('');
      if (typeof reloadWarehouses === 'function') reloadWarehouses();
    },
    [branchesForUser, reloadWarehouses]
  );

  // Companies whose head-warehouse backfill has been tried this session.
  const headWarehouseTried = useRef(new Set());

  useEffect(() => {
    if (!isAuthenticated) return;
    if (warehousesLoading) return;
    if (!currentCompany?.id) return;

    const companyId = currentCompany.id;
    const migrations = currentCompany?.docSettings?.migrations || {};
    if (migrations.headWarehouseBackfillV1Applied) return;

    const hasMissingWarehouse = (list) => {
      const rows = Array.isArray(list) ? list : [];
      return rows.some((r) => r?.companyId === companyId && !String(r?.warehouseId || '').trim());
    };

    const needsBackfill =
      hasMissingWarehouse(db?.invoices) ||
      hasMissingWarehouse(db?.creditNotes) ||
      hasMissingWarehouse(db?.bills) ||
      hasMissingWarehouse(db?.debitNotes) ||
      hasMissingWarehouse(db?.estimates) ||
      hasMissingWarehouse(db?.purchaseOrders);

    // If there are no legacy demo vouchers missing a warehouse, don't do anything.
    if (!needsBackfill) return;

    // Once per company per session. A failed create is swallowed below and
    // changes nothing, so without this the next render tried again, and the
    // next: a server error became an endless stream of POSTs.
    if (headWarehouseTried.current.has(companyId)) return;
    headWarehouseTried.current.add(companyId);

    let cancelled = false;
    const run = async () => {
      try {
        const nameToMatch = 'head warehouse';
        let head = (Array.isArray(warehouses) ? warehouses : []).find((w) => String(w?.name || '').trim().toLowerCase() === nameToMatch) || null;

        if (!head) {
          const orgId = resolveServerOrgId(currentCompany);
          const branchId = String(selectedBranchId() || currentCompany?.profile?.backendBranchId || '').trim();

          if (orgId && branchId) {
            const payload = {
              branchId,
              name: 'Head Warehouse',
              addressLine1: null,
              addressLine2: null,
              city: null,
              state: null,
              country: 'India',
              gstRegistrationType: 'UNREGISTERED',
              gstin: null,
              contactPerson: null,
              phone: null,
              email: null,
            };

            const created = await createWarehouse(String(orgId), payload);
            head = created?.warehouse || null;
            if (typeof reloadWarehouses === 'function') reloadWarehouses();
          }
        }

        if (cancelled) return;
        if (!head?.id) return;

        const headId = String(head.id);

        setDb((prev) => {
          const applyToList = (rows) => {
            const list = Array.isArray(rows) ? rows : [];
            return list.map((r) => {
              if (r?.companyId !== companyId) return r;
              if (String(r?.warehouseId || '').trim()) return r;
              return { ...r, warehouseId: headId };
            });
          };

          const companies = Array.isArray(prev?.companies) ? prev.companies : [];
          const nextCompanies = companies.map((c) => {
            if (c?.id !== companyId) return c;
            const prevDoc = c?.docSettings || {};
            const prevMig = prevDoc?.migrations || {};
            return {
              ...c,
              docSettings: {
                ...prevDoc,
                migrations: {
                  ...prevMig,
                  headWarehouseBackfillV1Applied: true,
                },
              },
            };
          });

          const next = {
            ...prev,
            companies: nextCompanies,
            invoices: applyToList(prev?.invoices),
            creditNotes: applyToList(prev?.creditNotes),
            bills: applyToList(prev?.bills),
            debitNotes: applyToList(prev?.debitNotes),
            estimates: applyToList(prev?.estimates),
            purchaseOrders: applyToList(prev?.purchaseOrders),
          };

          return next;
        });

        if (!String(activeWarehouseId || '').trim()) {
          selectWarehouse(headId);
          setActiveWarehouseId(headId);
        }
      } catch {
        // Best-effort only: if creation fails, don't block the app.
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    warehousesLoading,
    warehouses,
    currentCompany?.id,
    currentCompany?.profile?.backendCompanyId,
    currentCompany?.profile?.backendBranchId,
    db,
    activeWarehouseId,
    reloadWarehouses,
    setDb,
  ]);

  const activeLabel = useMemo(() => {
    const reportKeyToLabel = {
      reports: 'Reports',
      trialBalance: 'Trial Balance',
      profitLoss: 'P&L',
      balanceSheet: 'Balance Sheet',
      cashFlow: 'Cash Flow',
      gstr1: 'GSTR-1',
      gstr3b: 'GSTR-3B',
      gstCompliance: 'GST',
      msmeCompliance: 'MSME',
      salesReports: 'Sales Reports',
      // Reached from the account menu rather than the rail, so the loop over
      // navModel below never finds them.
      settingsProfile: 'My profile',
      settings: 'Settings',
    };

    if (active === 'ledger') {
      const a = (db.chartOfAccounts || []).find((x) => String(x.id) === String(ledgerNav.ledgerId) && x.companyId === currentCompany.id) || null;
      return a ? `Ledger: ${a.name}` : 'Ledger';
    }

    for (const entry of navModel) {
      if (entry.type === 'item' && entry.key === active) return entry.label;
      if (entry.type === 'group') {
        const item = entry.items.find((i) => i.key === active);
        if (item) return item.label;
      }
    }
    if (reportKeyToLabel[active]) return reportKeyToLabel[active];

    // Last resort: a screen that is in neither the rail nor the map should
    // still read as words. It used to render the route key, so the pill said
    // "settingsProfile" in front of the user.
    return String(active || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  }, [active, navModel]);

  const openModal = (content, opts = {}) => {
    if (!content) {
      setModal({ content: null, title: 'Form', maxWidthClass: 'max-w-4xl', headerActions: null, showCloseIcon: true });
      return;
    }
    setModal({
      content,
      title: opts.title || 'Form',
      maxWidthClass: opts.maxWidthClass || 'max-w-4xl',
      headerActions: opts.headerActions || null,
      showCloseIcon: opts.showCloseIcon !== false,
    });
  };

  const shareHandledRef = useRef(false);

  useEffect(() => {
    if (shareHandledRef.current) return;

    let invoiceId = '';
    try {
      const params = new URLSearchParams(window.location.search);
      invoiceId = String(params.get('invoiceId') || '').trim();
    } catch {
      invoiceId = '';
    }

    if (!invoiceId) return;

    const inv = (db.invoices || []).find((i) => String(i.id) === invoiceId && i.companyId === currentCompany.id) || null;
    if (!inv) return;

    shareHandledRef.current = true;
    setActive('invoices');
    openModal(<InvoicePreview db={db} currentCompany={currentCompany} invoice={inv} />, {
      title: `Invoice ${inv?.number || ''}`.trim(),
      maxWidthClass: 'max-w-5xl',
    });
  }, [db, currentCompany.id]);

  /* The VIEW permission behind the open screen: the write guard turns it into "may you change anything here". */
  const activePerm = useMemo(() => permForActive(navModel, active) || settingFor(active)?.perm || null, [navModel, active]);
  const page = useMemo(() => {
    /* Company administration moved to its own workspace (ADR-010): an old key leads there, to the same page. */
    const moved = COMPANY_ADMIN_REDIRECTS[active];
    if (moved) return <MovedToCompanyAdmin title={moved[0]} screen={moved[1]} />;
    switch (active) {
      case 'settings':
        return (
          <SettingsHub
            can={can}
            isEnabled={isEnabled}
            onOpenCategory={openSettingsCategory}
            onOpenSetting={(key) => setActive(key)}
            onExit={exitWorkspace}
          />
        );
      case 'dashboard':
        return (
          <DashboardOverview
            db={dbForUser}
            currentCompany={currentCompany}
            branches={branchesForUser}
            // "New invoice" has to actually start one. This was wired
            // identically to onOpenInvoices, so the dashboard's primary action
            // — and the one in its empty state, which exists to get a first
            // document raised — only dropped you on the list to press New
            // Invoice again.
            onNewInvoice={() => {
              setActive('invoices');
              setInvoiceEditor({ open: true, initial: null });
            }}
            onOpenInvoices={() => setActive('invoices')}
            onOpenReceipts={() => setActive('receipts')}
            onNavigate={(dest) => {
              setReturnTo({ from: 'dashboard', to: dest });
              setActive(dest);
            }}
            onOpenCashBank={() => {
              setReturnTo({ from: 'dashboard', to: 'cashBank' });
              setActive('cashBank');
            }}
            onOpenCustomers={() => setActive('customers')}
            onOpenPurchases={() => setActive('purchaseOverview')}
            // The warehouse selector in the header governed nothing on this
            // page, which is the kind of control that teaches people the
            // filters do not work.
            activeWarehouseId={activeWarehouseId}
            // The search field on the dashboard is the command palette the
            // shell already owns, not a second search that would have to be
            // built and kept in step with it.
            // Identity comes from /auth/me, the same place the header takes it
            // from, so the picture and the name cannot disagree between the
            // corner and the middle of the page.
            userName={userDisplayName}
            userAvatarUrl={userAvatarUrl}
            userInitials={userInitials}
            onNewBill={() => {
              setActive('bills');
              setBillEditor({ open: true, initial: null });
            }}
            onRecordReceipt={() => {
              setActive('receipts');
              setReceiptEditor({ open: true, initial: null });
            }}
            onOpenReports={() => setActive('reports')}
          />
        );
      case 'sales':
        return (
          <SalesOverview
            db={dbForUser}
            currentCompany={currentCompany}
            branches={branchesForUser}
            warehouses={warehousesForUser}
            branchesLoading={branchesLoading}
            branchesError={branchesError}
            onNavigate={setActive}
            /* The quick actions land on the screen that owns the document and
               open its editor, rather than floating a form over the overview:
               the list behind a new invoice is part of how you check you are
               not raising it twice. */
            onNewInvoice={() => {
              setActive('invoices');
              setInvoiceEditor({ open: true, initial: null });
            }}
            onNewCreditNote={() => {
              setActive('creditNotes');
              setCreditNoteEditor({ open: true, initialOriginalInvoiceId: null });
            }}
            onRecordReceipt={() => {
              setActive('receipts');
              setReceiptEditor({ open: true, initial: null });
            }}
          />
        );
      case 'invoices':
        if (invoiceEditor.open) {
          const isEdit = Boolean(invoiceEditor.initial && invoiceEditor.initial?.id !== undefined && invoiceEditor.initial?.id !== null);
          return (
            /*
             * No header of its own any more. The name of the document and
             * every way out of it — Back, Save Draft, Create Invoice, ⋮ — are
             * one pinned bar inside the form, so the primary action is still
             * on screen at the twentieth line.
             */
            <div className="invoice-page-shell">
              <div className="ui-surface border rounded-lg p-2">
                <InvoiceForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  branches={branchesForUser}
                  screenTitle={isEdit ? 'Edit Invoice' : 'New Invoice'}
                  screenSubtitle={isEdit ? invoiceEditor.initial?.number || '' : ''}
                  onBack={() => setInvoiceEditor({ open: false, initial: null })}
                  initialData={invoiceEditor.initial}
                  warehouses={warehousesForUser}
                  defaultWarehouseId={activeWarehouseId}
                  onClose={() => setInvoiceEditor({ open: false, initial: null })}
                  onDuplicateInvoice={(inv) => {
                    // A copy, not the original: no id, no number, today's
                    // date. Sharing the number would collide the moment it
                    // saved, and a GST series must not repeat.
                    const copy = { ...(inv || {}) };
                    [
                      'id',
                      'number',
                      'status',
                      'paidAmount',
                      'backendInvoiceId',
                      'irn',
                      'irnSignedQr',
                      'irnAckNo',
                      'irnAckDate',
                      'irnStatus',
                      'ewbNo',
                      'ewbDate',
                      'ewbValidTill',
                      'cancelledAt',
                    ].forEach((k) => delete copy[k]);
                    copy.date = new Date().toISOString().slice(0, 10);
                    copy.customFields = { ...(inv?.customFields || {}) };
                    setInvoiceEditor({ open: true, initial: copy });
                  }}
                  onOpenInvoiceSettings={(screen) => {
                    /*
                     * Navigate, but do not tear the document down.
                     *
                     * This used to close the editor before leaving, so saving a
                     * template dropped you on the invoice *list* and the invoice
                     * you were raising was gone. Configuring the document is a
                     * detour, not an exit: the editor stays open behind the
                     * settings route and is still there when Back returns.
                     */
                    setActive(screen);
                  }}
                />
              </div>
            </div>
          );
        }
        return (
          <InvoicesList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            branches={branchesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewInvoice={() => setInvoiceEditor({ open: true, initial: null })}
            onEditInvoice={(inv) => setInvoiceEditor({ open: true, initial: inv })}
            onOpenRecurring={() => setActive('recurringInvoices')}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
            onRaiseCreditNote={(inv) => {
              setActive('creditNotes');
              setCreditNoteEditor({ open: true, initialOriginalInvoiceId: inv?.id ?? null });
            }}
            /*
             * Recording money against an invoice goes to the Receipts screen
             * rather than opening a dialog over the list.
             *
             * A receipt is a document with a number that posts to the ledger,
             * not a detail of the invoice it happens to settle. As a dialog it
             * had no address, the browser's Back button dismissed the whole
             * list behind it, and there was nowhere to return to afterwards.
             */
            onRecordReceipt={(inv) => {
              setReturnTo({ from: 'invoices', to: 'receipts' });
              setReceiptEditor({
                open: true,
                initial: {
                  customerId: inv?.customerId,
                  customerName: inv?.customerName || inv?.partyName || '',
                  amount: Math.max(0, Number(inv?.total ?? 0) - Number(inv?.paidAmount ?? 0)),
                  // Ticked and allocated, or the money lands on account and the
                  // invoice it was paid against stays open.
                  allocateInvoiceId: inv?.id,
                  reference: inv?.number || '',
                  narration: inv?.number ? `Receipt against sales invoice ${inv.number}` : '',
                },
              });
              setActive('receipts');
            }}
          />
        );
      case 'estimates':
        if (estimateEditor.open) {
          const isEdit = Boolean(estimateEditor.initial && estimateEditor.initial?.id !== undefined && estimateEditor.initial?.id !== null);
          return (
            /*
             * The same shell an invoice gets: no header of its own, because the
             * name of the document and every way out of it live in one pinned
             * bar inside the form.
             */
            <div className="space-y-4">
              <div className="ui-surface border rounded-xl p-4">
                <EstimateForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialData={estimateEditor.initial}
                  screenTitle={isEdit ? 'Edit Quotation' : 'New Quotation'}
                  screenSubtitle={isEdit ? estimateEditor.initial?.number || '' : ''}
                  onBack={() => setEstimateEditor({ open: false, initial: null })}
                  onClose={() => setEstimateEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <EstimatesList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
            warehouses={warehousesForUser}
            branches={branchesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewEstimate={() => setEstimateEditor({ open: true, initial: null })}
            onEditEstimate={(est) => setEstimateEditor({ open: true, initial: est })}
            onConvertToInvoice={(est) => {
              const initialInvoice = {
                status: 'Draft',
                date: est?.date || undefined,
                dueDate: est?.dueDate || undefined,
                customerId: est?.customerId || '',
                refNo: est?.number || '',
                refDate: est?.date || '',
                sourceEstimateId: est?.id ?? null,
                items: Array.isArray(est?.items)
                  ? est.items.map((l) => ({
                      itemId: l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '',
                      description: l?.description ?? '',
                      quantity: Number(l?.quantity ?? 1),
                      rate: Number(l?.rate ?? 0),
                      gstRate: Number(l?.gstRate ?? 0),
                      hsnSac: l?.hsnSac || '',
                      amount: Number(l?.amount ?? 0),
                    }))
                  : undefined,
              };

              setActive('invoices');
              setInvoiceEditor({ open: true, initial: initialInvoice });
            }}
          />
        );
      case 'journalEntries':
        if (journalEditor.open) {
          const isEdit = Boolean(journalEditor.initial && journalEditor.initial?.id !== undefined && journalEditor.initial?.id !== null);
          return (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="ui-t-sec">{isEdit ? 'Edit Journal Entry' : 'New Journal Entry'}</h3>
                  <div className="text-sm ui-muted">{isEdit ? journalEditor.initial?.number || '' : ''}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setJournalEditor({ open: false, initial: null })}
                  className="ui-btn ui-btn-secondary"
                >
                  Back
                </button>
              </div>
              <div className="ui-surface border rounded-xl p-4">
                <JournalEntryForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  openModal={openModal}
                  initialData={journalEditor.initial}
                  onClose={() => setJournalEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <JournalEntriesList
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onNewJournal={() => setJournalEditor({ open: true, initial: null })}
            onEditJournal={(jv) => setJournalEditor({ open: true, initial: jv })}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
          />
        );
      case 'creditNotes':
        if (creditNoteEditor.open) {
          return (
            /* Same shell as an invoice: no header of its own, because the
               document's name and every way out of it are one pinned bar
               inside the form. */
            <div className="space-y-4">
              <div className="ui-surface border rounded-xl p-4">
                <CreditNoteForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialOriginalInvoiceId={creditNoteEditor.initialOriginalInvoiceId}
                  warehouses={warehousesForUser}
                  branches={branchesForUser}
                  defaultWarehouseId={activeWarehouseId}
                  screenTitle="Create Credit Note"
                  onBack={() => setCreditNoteEditor({ open: false, initialOriginalInvoiceId: null })}
                  onClose={() => setCreditNoteEditor({ open: false, initialOriginalInvoiceId: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <CreditNotesList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            branches={branchesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewCreditNote={() => setCreditNoteEditor({ open: true, initialOriginalInvoiceId: null })}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
          />
        );
      case 'receipts':
        if (receiptEditor.open) {
          return (
            <div className="space-y-6">
              {/* Title, Back and the primary action in one bar inside the card,
                  as the invoice screen has them — not a heading floating above
                  a card with the buttons somewhere else. */}
              <div className="ui-surface border rounded-xl p-4">
                <RecordReceiptForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialData={receiptEditor.initial || null}
                  screenTitle={receiptEditor.initial?.id ? 'Edit Receipt' : 'New Receipt'}
                  onBack={() => setReceiptEditor({ open: false })}
                  onClose={() => setReceiptEditor({ open: false })}
                />
              </div>
            </div>
          );
        }

        return (
          <ReceiptsTransactionsList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            onRecordReceipt={() => setReceiptEditor({ open: true })}
          />
        );
      case 'payments':
      case 'paymentsExpense':
        if (paymentEditor.open) {
          return (
            <div className="space-y-6">
              {/* Title, Back and the primary action in one bar inside the card,
                  as every other document screen has them. */}
              <div className="ui-surface border rounded-xl p-4">
                <RecordDisbursementForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialData={paymentEditor.initial || null}
                  /* What is being made, not what the button does — the button
                     already says Record Payment right beside it. */
                  screenTitle={paymentEditor.initial?.id ? 'Edit Payment' : 'New Payment'}
                  onBack={() => setPaymentEditor({ open: false, initial: null })}
                  onClose={() => setPaymentEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }

        return (
          <PaymentsTransactionsList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            onRecordPayment={() => setPaymentEditor({ open: true, initial: null })}
          />
        );
      case 'bankCash':
        return <ChartOfAccounts db={dbForUser} setDb={setDb} openModal={openModal} currentCompany={currentCompany} onOpenLedger={openLedger} />;
      /*
       * The old screen lived at this key and is still reachable at
       * `cashBankImport` — it is where a statement is imported and its rows
       * are categorised, which §5 keeps and the new list deliberately does
       * not do. The key itself now opens the cash book.
       */
      case 'cashBank': {
        const openStatementVoucher = (row) => {
          const txn = (Array.isArray(db.bankTransactions) ? db.bankTransactions : []).find(
            (item) => String(item?.id) === String(row?.sourceId) && Number(item?.companyId) === Number(currentCompany?.id)
          );
          if (!txn) return;

          const close = () => openModal(null);
          const selectedCashBankAccount = (Array.isArray(dbForUser.chartOfAccounts) ? dbForUser.chartOfAccounts : []).find(
            (account) => String(account?.id) === String(txn.cashBankAccountId)
          );
          const linkVoucher = (field) => (voucher) => {
            if (!voucher?.id) return;
            setDb((prev) => ({
              ...prev,
              bankTransactions: (Array.isArray(prev.bankTransactions) ? prev.bankTransactions : []).map((item) =>
                String(item?.id) === String(txn.id) && Number(item?.companyId) === Number(currentCompany.id)
                  ? { ...item, [field]: voucher.id, allocationStatus: 'Allocated', updatedAt: new Date().toISOString() }
                  : item
              ),
            }));
          };
          const initial = {
            date: txn.date,
            amount: txn.amount,
            ledgerAccountId: String(selectedCashBankAccount?.serverLedgerAccountId || selectedCashBankAccount?.backendLedgerId || txn.cashBankAccountId || ''),
            cashBankAccountId: txn.cashBankAccountId,
            sourceBankTransactionId: txn.id,
            reference: txn.reference || '',
            notes: txn.narration || txn.description || '',
          };

          if (row.type === 'Contra') {
            const mappedId = txn.ledgerId ? String(txn.ledgerId) : '';
            const bankId = String(txn.cashBankAccountId || '');
            const incoming = String(txn.direction || '').toUpperCase() === 'IN';
            openModal(
              <Suspense fallback={null}>
                <ContraForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialData={{
                    ...initial,
                    fromId: incoming ? mappedId : bankId,
                    toId: incoming ? bankId : mappedId,
                    narration: initial.notes,
                  }}
                  onSaved={linkVoucher('linkedJournalEntryId')}
                  onClose={close}
                />
              </Suspense>,
              { title: 'Contra Record Form', maxWidthClass: 'max-w-2xl' }
            );
            return;
          }

          if (row.type === 'Receipt') {
            openModal(
              <RecordReceiptForm
                db={dbForUser}
                setDb={setDb}
                currentCompany={currentCompany}
                initialData={initial}
                onSaved={linkVoucher('linkedPaymentId')}
                onClose={close}
              />,
              { title: 'Record Receipt', maxWidthClass: 'max-w-4xl' }
            );
            return;
          }

          openModal(
            <RecordDisbursementForm
              db={dbForUser}
              setDb={setDb}
              currentCompany={currentCompany}
              initialData={initial}
              onSaved={linkVoucher('linkedPaymentId')}
              onClose={close}
            />,
            { title: 'Record Payment', maxWidthClass: 'max-w-4xl' }
          );
        };
        return (
          <CashBankTransactions
            db={dbForUser}
            currentCompany={currentCompany}
            onNewPayment={() => {
              setActive('payments');
              setPaymentEditor({ open: true, initial: null });
            }}
            onNewReceipt={() => {
              setActive('receipts');
              setReceiptEditor({ open: true, initial: null });
            }}
            onNewContra={() =>
              openModal(
                <Suspense fallback={null}>
                  <ContraForm
                    db={dbForUser}
                    setDb={setDb}
                    currentCompany={currentCompany}
                    onClose={() => openModal(null)}
                  />
                </Suspense>,
                { title: 'Contra — move between accounts', maxWidthClass: 'max-w-2xl' }
              )
            }
            onImportStatement={() => setActive('cashBankImport')}
            onOpenReconciliation={() => setActive('bankReco')}
            onOpenAccounts={() => setActive('bankCashAccounts')}
            onAllocateStatement={openStatementVoucher}
            onUncategorise={(row) => {
              setDb((prev) => ({
                ...prev,
                bankTransactions: (prev.bankTransactions || []).map((item) =>
                  String(item?.id) === String(row?.sourceId)
                    ? {
                        ...item,
                        ledgerId: undefined,
                        linkedPaymentId: null,
                        linkedJournalEntryId: null,
                        contraJournalEntryId: null,
                        allocationJournalId: null,
                        allocationStatus: 'Uncategorised',
                        reconciled: false,
                        bankDate: null,
                      }
                    : item
                ),
                payments: (prev.payments || []).map((item) =>
                  String(item?.sourceBankTransactionId) === String(row?.sourceId)
                    ? { ...item, sourceBankTransactionId: null }
                    : item
                ),
                journalEntries: (prev.journalEntries || []).filter((item) => {
                  const generated = /^AUTO-(BANK|CONTRA)-/.test(String(item?.number || ''));
                  return !(generated && String(item?.sourceBankTransactionId) === String(row?.sourceId));
                }),
                bankAllocations: (prev.bankAllocations || []).filter(
                  (item) => String(item?.bankTransactionId || item?.transactionId) !== String(row?.sourceId)
                ),
              }));
            }}
            onEditSource={(row) => {
              if (row?.kind === 'payment') {
                const source = (Array.isArray(db.payments) ? db.payments : []).find((item) => String(item?.id) === String(row.sourceId));
                if (row.type === 'Receipt') {
                  setActive('receipts');
                  setReceiptEditor({ open: true, initial: source || null });
                } else {
                  setActive('payments');
                  setPaymentEditor({ open: true, initial: source || null });
                }
              } else if (row?.kind === 'contra') {
                setActive('journalEntries');
              } else if (row?.kind === 'statement') {
                const txn = (Array.isArray(db.bankTransactions) ? db.bankTransactions : []).find(
                  (item) => String(item?.id) === String(row.sourceId)
                );
                if (!txn) return;
                const accounts = cashBankIndex(dbForUser, currentCompany.id).accounts;
                openModal(
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const nextAccountId = String(new FormData(event.currentTarget).get('cashBankAccountId') || '');
                      if (!nextAccountId) return;
                      const nextAccount = accounts.find((account) => String(account.id) === nextAccountId);
                      setDb((prev) => ({
                        ...prev,
                        bankTransactions: (prev.bankTransactions || []).map((item) =>
                          String(item?.id) === String(txn.id)
                            ? { ...item, cashBankAccountId: Number(nextAccountId), updatedAt: new Date().toISOString() }
                            : item
                        ),
                        payments: (prev.payments || []).map((item) =>
                          String(item?.sourceBankTransactionId) === String(txn.id)
                            ? {
                                ...item,
                                cashBankAccountId: Number(nextAccountId),
                                ledgerAccountId: String(nextAccount?.serverLedgerAccountId || nextAccount?.backendLedgerId || nextAccountId),
                              }
                            : item
                        ),
                      }));
                      openModal(null);
                    }}
                  >
                    <div>
                      <label className="ui-label" htmlFor="edit-bank-transaction-account">Cash / bank account</label>
                      <select id="edit-bank-transaction-account" name="cashBankAccountId" className="ui-select w-full" defaultValue={String(txn.cashBankAccountId || '')} required>
                        <option value="">Select account</option>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                      </select>
                      <p className="ui-caption mt-1">Only ledgers under Cash or Bank groups are available.</p>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-3">
                      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openModal(null)}>Cancel</button>
                      <button type="submit" className="ui-btn ui-btn-primary">Save</button>
                    </div>
                  </form>,
                  { title: 'Edit transaction account', maxWidthClass: 'max-w-lg' }
                );
              }
            }}
            onDeleteSource={async (row) => {
              const ok = await confirmDialog({ title: 'Delete transaction?', message: 'Delete this transaction and its link from Cash & Bank?', confirmLabel: 'Delete' });
              if (!ok) return;
              setDb((prev) => {
                if (row?.kind === 'payment') return { ...prev, payments: (prev.payments || []).filter((item) => String(item?.id) !== String(row.sourceId)) };
                if (row?.kind === 'contra') return { ...prev, journalEntries: (prev.journalEntries || []).filter((item) => String(item?.id) !== String(row.sourceId)) };
                if (row?.kind === 'statement') return { ...prev, bankTransactions: (prev.bankTransactions || []).filter((item) => String(item?.id) !== String(row.sourceId)) };
                return prev;
              });
            }}
            onOpenSource={(row) => {
              openModal(
                <div className="space-y-4">
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      ['Date', row?.date || '—'],
                      ['Account', row?.accountName || '—'],
                      ['Ledger name', row?.ledgerName || '—'],
                      ['Type', row?.type || '—'],
                      ['Amount', formatMoney(Number(row?.amount || 0), currentCompany)],
                      ['Status', row?.status || '—'],
                      ['Voucher / reference', row?.number || '—'],
                      ['Bank date', row?.bankDate || '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border p-3">
                        <dt className="ui-caption">{label}</dt>
                        <dd className={label === 'Amount' ? 'ui-money mt-1' : 'mt-1 font-medium'}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex justify-end border-t pt-3">
                    <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openModal(null)}>Close</button>
                  </div>
                </div>,
                { title: 'Transaction entry', maxWidthClass: 'max-w-2xl' }
              );
            }}
          />
        );
      }
      case 'cashBankImport': {
        const companyId = currentCompany.id;

        const groups = (Array.isArray(db.accountGroups) ? db.accountGroups : [])
          .filter((g) => g.companyId === companyId)
          .filter((g) => !g.isLegacy);

        const groupById = new Map(groups.map((g) => [String(g.id), g]));

        const isUnderNamedRoot = (groupId, rootLowerName) => {
          let cur = groupById.get(String(groupId || '')) || null;
          const seen = new Set();
          while (cur && !seen.has(String(cur.id))) {
            seen.add(String(cur.id));
            const nm = String(cur.name || '').trim().toLowerCase();
            if (nm === rootLowerName) return true;
            const pid = cur.parentGroupId;
            if (pid === null || pid === undefined || pid === '') return false;
            cur = groupById.get(String(pid)) || null;
          }
          return false;
        };

        const includeGroupIds = groups
          .filter((g) => ['bank', 'banks', 'bank account', 'bank accounts', 'cash', 'cash-in-hand', 'cash in hand', 'cash & bank', 'cash and bank', 'cash / bank', 'cash/bank'].some((root) => isUnderNamedRoot(g.id, root)))
          .map((g) => g.id);

        const openLedgerCreate = (initialName = '', onCreated) => {
          openModal(
            <ChartAccountForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              openModal={openModal}
              includeGroupIds={includeGroupIds}
              initialName={String(initialName || '').trim()}
              onCreated={onCreated}
              onClose={() => openModal(null)}
            />,
            { title: 'New Cash/Bank Account', maxWidthClass: 'max-w-5xl' }
          );
        };

        const openTxnLedgerCreate = (initialName = '', onCreated) => {
          openModal(
            <ChartAccountForm
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              openModal={openModal}
              initialName={String(initialName || '').trim()}
              onCreated={onCreated}
              onClose={() => openModal(null)}
            />,
            { title: 'New Ledger', maxWidthClass: 'max-w-5xl' }
          );
        };

        return (
          <CashBankModule
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            openModal={openModal}
            openLedgerCreate={openLedgerCreate}
            openTxnLedgerCreate={openTxnLedgerCreate}
          />
        );
      }
      case 'inventory':
        return <InventoryModule db={dbForUser} setDb={setDb} openModal={openModal} currentCompany={currentCompany} warehouses={warehousesForUser} onOpenItems={() => setActive('items')} />;
      case 'warehouseTransfers':
      case 'branchTransfers':
        if (stockTransferEditor.open) {
          const mode = active === 'branchTransfers' ? 'branch' : 'warehouse';
          return (
            <div className="space-y-6">
              <div className="ui-surface border rounded-xl p-4">
                <StockTransferEditor
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  branches={branchesForUser}
                  warehouses={warehousesForUser}
                  allBranches={branches}
                  allWarehouses={warehouses}
                  activeWarehouseId={activeWarehouseId}
                  initial={stockTransferEditor.initial}
                  mode={mode}
                  onBack={() => setStockTransferEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }

        return (
          <StockTransferModule
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            openModal={openModal}
            branches={branchesForUser}
            warehouses={warehousesForUser}
            mode={active === 'branchTransfers' ? 'branch' : 'warehouse'}
            activeWarehouseId={activeWarehouseId}
            activeBranchId={activeBranchId}
            onNew={() => setStockTransferEditor({ open: true, initial: null })}
            onEdit={(initial) => setStockTransferEditor({ open: true, initial })}
          />
        );
      case 'financials':
        return <TrialBalance db={dbForUser} currentCompany={currentCompany} />;
      case 'salesReports':
        return <SalesReports db={dbForUser} currentCompany={currentCompany} />;
      case 'companies':
        return (
          <CompanyGroups
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            initialAction={companiesIntent}
            onActionConsumed={() => setCompaniesIntent(null)}
            onSwitched={() => setActive('dashboard')}
          />
        );
      case 'purchaseOverview':
        return (
          <PurchaseOverview
            db={dbForUser}
            currentCompany={currentCompany}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
            onNewBill={() => setBillEditor({ open: true, initial: null })}
          />
        );
      case 'purchaseOrders':
        if (poEditor.open) {
          // Entered on its own page, the way a bill is — same shape of work,
          // same shape of screen.
          return (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="ui-t-sec">{poEditor.initial ? 'Edit Purchase Order' : 'New Purchase Order'}</h3>
                <button
                  type="button"
                  onClick={() => setPoEditor({ open: false, initial: null })}
                  className="ui-btn ui-btn-secondary"
                >
                  Back
                </button>
              </div>
              <div className="ui-surface rounded-xl shadow-sm p-6 border">
                <PurchaseOrderForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  warehouses={warehousesForUser}
                  defaultWarehouseId={activeWarehouseId}
                  branches={branchesForUser}
                  initialData={poEditor.initial}
                  onClose={() => setPoEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <PurchaseOrdersList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewPo={() => setPoEditor({ open: true, initial: null })}
            onEditPo={(po) => setPoEditor({ open: true, initial: po })}
            onConvertToBill={(po) => {
              // Carry the order across: vendor, warehouse and lines prefill the
              // bill, and the bill remembers which order it answers. The order
              // closes when that bill is actually saved — marking it here would
              // close orders for bills the user then abandoned.
              setBillEditor({
                open: true,
                initial: {
                  vendorId: po.vendorId,
                  warehouseId: po.warehouseId,
                  refNo: po.number,
                  refDate: po.date,
                  sourcePurchaseOrderId: po.id,
                  /**
                   * Put the tax rate back on each line.
                   *
                   * A purchase order stores itemId, description, quantity,
                   * rate and amount — and no gstRate, because the PO form
                   * never asks for tax. Handing those lines to the bill
                   * unchanged produced a bill with CGST and SGST of zero on
                   * goods that carry 18%, so the input credit simply vanished:
                   * ₹6,480 on a ₹36,000 order, silently, unless somebody
                   * noticed and re-picked the item by hand.
                   *
                   * The item master knows the rate, which is where the bill
                   * form gets it when a line is entered directly.
                   */
                  items: (po.items || []).map((line) => {
                    const master = (db.items || []).find((i) => String(i.id) === String(line.itemId));
                    return {
                      ...line,
                      gstRate: Number(line.gstRate ?? master?.gstRate ?? 0),
                      hsnSac: line.hsnSac || master?.hsnSac || '',
                    };
                  }),
                },
              });
              setActive('bills');
            }}
          />
        );
      case 'bills':
        if (typeof BillsList === 'undefined' || typeof BillForm === 'undefined') {
          return (
            <div className="space-y-3">
              <div className="ui-t-sec">Bills</div>
              <div className="ui-surface border rounded-xl p-4 text-sm ui-fg">
                Bills module failed to load (missing component). Please refresh the page.
              </div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
              >
                Refresh
              </button>
            </div>
          );
        }
        if (billEditor.open) {
          return (
            <div className="space-y-6">
              {/* Name, Back and both ways of saving in one bar inside the card,
                  as every other document screen has them. */}
              <div className="ui-surface border rounded-xl p-4">
                <BillForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialData={billEditor.initial}
                  warehouses={warehousesForUser}
                  branches={branchesForUser}
                  defaultWarehouseId={activeWarehouseId}
                  /* Same detour as the invoice's: the editor stays open behind
                     the settings screen, so Back returns to the bill. */
                  onOpenBillSettings={(screen) => setActive(screen)}
                  screenTitle={billEditor.initial?.id ? 'Edit Bill' : 'New Bill'}
                  onBack={() => setBillEditor({ open: false, initial: null })}
                  onClose={() => setBillEditor({ open: false, initial: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <BillsList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            branches={branchesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewBill={() => setBillEditor({ open: true, initial: null })}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
            onDuplicateBill={(initial) => setBillEditor({ open: true, initial })}
            onEditBill={(bill) => setBillEditor({ open: true, initial: bill })}
            onRaiseDebitNote={(bill) => {
              setActive('debitNotes');
              setDebitNoteEditor({ open: true, initialOriginalBillId: bill?.id ?? null });
            }}
          />
        );
      case 'debitNotes':
        if (debitNoteEditor.open) {
          return (
            <div className="space-y-6">
              {/* Name, Back and the primary action in one bar inside the card. */}
              <div className="ui-surface border rounded-xl p-4">
                <DebitNoteForm
                  db={dbForUser}
                  setDb={setDb}
                  currentCompany={currentCompany}
                  initialOriginalBillId={debitNoteEditor.initialOriginalBillId}
                  warehouses={warehousesForUser}
                  branches={branchesForUser}
                  defaultWarehouseId={activeWarehouseId}
                  onOpenReturnSettings={(screen) => setActive(screen)}
                  screenTitle="New Purchase Return"
                  onBack={() => setDebitNoteEditor({ open: false, initialOriginalBillId: null })}
                  onClose={() => setDebitNoteEditor({ open: false, initialOriginalBillId: null })}
                />
              </div>
            </div>
          );
        }
        return (
          <DebitNotesList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            defaultWarehouseId={activeWarehouseId}
            onNewDebitNote={() => setDebitNoteEditor({ open: true, initialOriginalBillId: null })}
            onNavigate={(screen, kind = '') => {
              if (screen === 'dataImport') setImportKind(kind);
              setActive(screen);
            }}
          />
        );
      case 'expenses':
        return <ExpensesList db={dbForUser} setDb={setDb} openModal={openModal} currentCompany={currentCompany} />;
      case 'items':
        return (
          <ItemsList
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            /* Every branch and every warehouse, not this branch's: opening
               stock is recorded where the goods are, which is not always where
               the person entering them is standing. */
            branches={branchesForUser}
            warehouses={warehousesForUser}
            onNavigate={setActive}
          />
        );
      case 'customers':
        return (
          <CustomersList
            db={dbForUser}
            setDb={setDb}
            openModal={openModal}
            currentCompany={currentCompany}
            onEditTransaction={(row) => {
              if (row.type === 'Sales') {
                setActive('invoices');
                setInvoiceEditor({ open: true, initial: row.raw });
                return;
              }
              if (row.type === 'Receipt') {
                setActive('receipts');
                setReceiptEditor({ open: true, initial: row.raw });
                return;
              }
              if (row.type === 'Debit Note') setActive('debitNotes');
              else setActive('creditNotes');
            }}
            onNewTransaction={(customer) => {
              setActive('invoices');
              setInvoiceEditor({ open: true, initial: { customerId: String(customer?.id || '') } });
            }}
          />
        );
      case 'inventoryOverview':
        return <InventoryOverview db={db} currentCompany={currentCompany} />;
      case 'stockAdjustment':
        return <StockAdjustment db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'uoms':
        return <UomsList db={db} setDb={setDb} currentCompany={currentCompany} />;
      case 'itemCategories':
        return <ItemCategoriesList db={db} setDb={setDb} currentCompany={currentCompany} />;
      case 'vendors':
        return <VendorsList db={dbForUser} setDb={setDb} openModal={openModal} currentCompany={currentCompany} />;
      case 'mdm':
        return <MdmOverview />;
      case 'accounts':
        return <ChartOfAccounts db={dbForUser} setDb={setDb} openModal={openModal} currentCompany={currentCompany} onOpenLedger={openLedger} />;
      case 'trialBalance':
        return <TrialBalance db={dbForUser} currentCompany={currentCompany} onOpenLedger={openLedger} />;
      case 'profitLoss':
        return <ProfitLoss db={dbForUser} currentCompany={currentCompany} onOpenLedger={openLedger} />;
      case 'balanceSheet':
        return <BalanceSheet db={dbForUser} currentCompany={currentCompany} onOpenLedger={openLedger} />;
      case 'ledger':
        return (
          <LedgerView
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            ledgerId={ledgerNav.ledgerId}
            openModal={openModal}
            warehouses={warehouses}
            branches={branchesForUser}
            activeWarehouseId={activeWarehouseId}
            onBack={() => setActive(ledgerNav.returnTo || 'trialBalance')}
          />
        );
      case 'cashFlow':
        return <CashFlowStatement db={dbForUser} currentCompany={currentCompany} />;
      case 'reports':
        return (
          <ReportsOverview
            db={dbForUser}
            currentCompany={currentCompany}
            onNavigate={(key) => setActive(key)}
            onExit={exitWorkspace}
            isEnabled={isEnabled}
            branches={branchesForUser}
            warehouses={warehousesForUser}
            defaultBranchId={activeBranchId}
            defaultWarehouseId={activeWarehouseId}
          />
        );
      case 'gstCompliance':
      case 'gstr1':
        return <GstComplianceWorkspace db={dbForUser} currentCompany={currentCompany} branches={branchesForUser} initialReport="gstr1" onBack={() => setActive(lastScreenRef.current || 'dashboard')} />;
      case 'gstr3b':
        return <GstComplianceWorkspace db={dbForUser} currentCompany={currentCompany} branches={branchesForUser} initialReport="gstr3b" onBack={() => setActive(lastScreenRef.current || 'dashboard')} />;
      case 'msmeCompliance':
        return <MsmeComplianceWorkspace db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'gstRates':
        return <GstRatesList db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'tdsRates':
        return <TdsSettings db={dbForUser} setDb={setDb} currentCompany={currentCompany} sectionsOnly />;
      case 'tcsRates':
        return <TcsRatesMaster db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'invoiceTemplates':
        // Reached from a document's More menu and from Master Data, so it has
        // to hand control back to whichever of those sent it — and saving is
        // the end of the errand, not the middle of it.
        return (
          <InvoiceTemplateSettings
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onBack={() => setActive(settingsBackTarget(lastScreenRef.current))}
          />
        );
      case 'docNumbering':
        return <DocNumberingSettings db={dbForUser} setDb={setDb} currentCompany={currentCompany} branches={branchesForUser} />;
      case 'docTemplates':
        return <DocTemplateSettings db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'companyProfile':
        return <CompanyProfile db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'settingsCompany':
        return (
          <SettingsView
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            initialTab="company"
            showSidebar={false}
            onOpenCompanyList={() => { setCompaniesIntent(null); setActive('companies'); }}
            onAddCompany={() => { setCompaniesIntent('create'); setActive('companies'); }}
          />
        );
      case 'settingsTax':
        return <SettingsView db={dbForUser} setDb={setDb} currentCompany={currentCompany} initialTab="tax" showSidebar={false} />;
      case 'settingsTds':
        return (
          <TdsSettings
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onOpenChart={() => setActive('bankCash')}
            onOpenVendors={() => setActive('vendors')}
            onOpenCustomers={() => setActive('customers')}
          />
        );
      case 'settingsWarehouses': {
        const orgId = resolveServerOrgId(currentCompany);
        const branchId = selectedBranchId();
        return <SettingsWarehouses orgId={orgId} branchId={branchId} company={currentCompany} onWarehousesChanged={reloadWarehouses} />;
      }
      case 'accountingRoles':
        return <MovedToCompanyAdmin title="Roles & Access" screen="permissions" forApp="accounting" />;
      case 'companyAdmin':
        return <MovedToCompanyAdmin title="Users, roles & security" screen="home" />;
      case 'settingsTerms':
        return <TermsSettings db={db} setDb={setDb} currentCompany={currentCompany} />;
      case 'settingsInvoiceFields':
        // Reached from a list's More menu, so it needs the same way back the
        // import screen needed: the Back button only existed in `embedded`
        // mode, which is the drawer, not this route.
        return (
          <InvoiceFieldSettings
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            pane="fields"
            onBack={() => setActive(settingsBackTarget(lastScreenRef.current))}
          />
        );
      case 'settingsCustomFields':
        // The same component, the other half of it. Custom fields used to share
        // this route with the built-in switches, so both More-menu entries
        // landed on one page and neither name meant anything.
        return (
          <InvoiceFieldSettings
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            pane="custom"
            onBack={() => setActive(settingsBackTarget(lastScreenRef.current))}
          />
        );
      case 'settingsModules':
        return (
          <div className="space-y-6">
            <PageHeader
      entity="settings"
      title="Modules"
            />
            <ModulePicker submitLabel="Save modules" />
          </div>
        );
      case 'features':
        return <FeaturesPage onNavigate={setActive} currentCompany={currentCompany} />;
      /*
       * The old capability surfaces, pointed at the new one.
       *
       * Settings → Preferences and the six Business panes all switched the
       * same forty flags; there is one place to do that now. They redirect
       * rather than 404 because they have been linked and bookmarked, and
       * they render the same page rather than a copy of it.
       */
      case 'settingsFeatures':
      case 'settingsSales':
      case 'settingsPurchases':
      case 'settingsInventory':
      case 'settingsAccounting':
      case 'settingsPaymentsReceipts':
      case 'settingsDocuments':
        return <FeaturesPage onNavigate={setActive} currentCompany={currentCompany} />;
      case 'settingsEmail':
        return <EmailSettings />;
      case 'settingsGovernance':
        return <GovernanceSettings />;
      case 'settingsProfile':
        return <ProfileSettings />;
      case 'settingsNumbering':
        return <NumberingSettings />;
      case 'settingsCurrencies':
        return <CurrencySettings />;
      case 'dataImport':
        // Back to wherever the More menu was opened from, defaulting to the
        // invoices list because that is where import is offered. The kind is
        // taken from the menu that opened it, so somebody importing journals
        // does not land on invoices and have to say so again.
        return (
          <ImportCenter
            initialDocType={importKind}
            onBack={() => setActive(lastScreenRef.current || 'invoices')}
          />
        );
      case 'batchSerial':
        return <BatchSerialManager />;
      case 'stockAdjustments':
        return (
          <StockAdjustments
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            warehouses={warehousesForUser}
            branches={branchesForUser}
            activeWarehouseId={activeWarehouseId}
          />
        );
      case 'batchStock':
        return <BatchStock db={dbForUser} currentCompany={currentCompany} />;
      case 'reorderAlerts':
        return <ReorderAlerts db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'gstr2bReco':
        return <GstComplianceWorkspace db={dbForUser} currentCompany={currentCompany} branches={branchesForUser} initialReport="reconciliation" onBack={() => setActive(lastScreenRef.current || 'dashboard')} />;
      case 'paymentReminders':
        return <PaymentReminders db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'salesBySalesman':
        return <SalesBySalesman db={dbForUser} currentCompany={currentCompany} />;
      case 'tallyExport':
        return <TallyExport db={dbForUser} currentCompany={currentCompany} />;
      case 'tds':
        return (
          <TdsModule
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onBack={() => setActive(lastScreenRef.current || 'dashboard')}
            onOpenSettings={(screen) => setActive(screen)}
            onNewChallan={() =>
              openModal(
                <Suspense fallback={null}>
                  <TdsChallanForm
                    db={dbForUser}
                    setDb={setDb}
                    currentCompany={currentCompany}
                    onClose={() => openModal(null)}
                  />
                </Suspense>,
                { title: 'Record TDS challan', maxWidthClass: 'max-w-4xl' }
              )
            }
          />
        );
      case 'tdsTcs':
        return <TdsTcsReport db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'fixedAssets':
        return <FixedAssets db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'yearEndClose':
        return <YearEndClose db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'costCenters':
        return <CostCenters db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'priceLists':
        return <PriceLists db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'discountRules':
        return <DiscountRules db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'salesOrders':
        return (
          <SalesOrders
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onConvertToInvoice={(order) => {
              // Bill what is still unbilled, at the terms the order agreed —
              // an invoice raised from an order should need no re-typing, and
              // billing a line twice is the mistake this prevents.
              const billed = new Map();
              for (const inv of dbForUser.invoices || []) {
                if (Number(inv?.sourceSalesOrderId) !== Number(order.id)) continue;
                if (String(inv?.status || '').toLowerCase() === 'cancelled') continue;
                for (const l of inv.items || []) {
                  const k = String(l.itemId);
                  billed.set(k, (billed.get(k) || 0) + (Number(l.quantity) || 0));
                }
              }
              const lines = (order.items || [])
                .map((l) => {
                  const ordered = Number(l.quantity) || 0;
                  const already = billed.get(String(l.itemId)) || 0;
                  const remaining = Math.max(0, Math.round((ordered - already) * 1000) / 1000);
                  return { ...l, remaining };
                })
                .filter((l) => l.remaining > 0)
                .map((l) => ({
                  ...l,
                  itemId: String(l.itemId),
                  quantity: l.remaining,
                  rate: Number(l.rate) || 0,
                  gstRate: Number(l.gstRate) || 0,
                  hsnSac: l.hsnSac || '',
                  amount: Math.round((l.remaining * (Number(l.rate) || 0)) * 100) / 100,
                }));

              if (!lines.length) {
                notify.info(`${order.number} is fully billed — nothing left to invoice.`);
                return;
              }

              setInvoiceEditor({
                open: true,
                initial: {
                  customerId: order.customerId,
                  refNo: order.number,
                  refDate: order.date || '',
                  salesmanId: order.salesmanId || '',
                  notes: order.notes || '',
                  warehouseId: order.warehouseId || activeWarehouseId || '',
                  sourceSalesOrderId: order.id,
                  items: lines,
                },
              });
              setActive('invoices');
            }}
          />
        );
      case 'recurringInvoices':
        return <RecurringInvoices db={dbForUser} setDb={setDb} currentCompany={currentCompany} onNavigate={setActive} branches={branchesForUser} warehouses={warehousesForUser} />;
      case 'salesmen':
        return <Salesmen db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'pos':
        return <PosScreen db={dbForUser} setDb={setDb} currentCompany={currentCompany} />;
      case 'deliveryChallans':
        return (
          <DeliveryChallans
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onConvert={(challan) => {
              // Status flips to Invoiced only when the invoice actually saves
              // (sourceChallanId is picked up by the invoice submit).
              setInvoiceEditor({
                open: true,
                initial: {
                  customerId: challan.customerId,
                  refNo: challan.number,
                  refDate: challan.date || '',
                  notes: challan.notes || '',
                  warehouseId: challan.warehouseId || activeWarehouseId || '',
                  sourceChallanId: challan.id,
                  items: (challan.items || []).map((l) => {
                    const master = (dbForUser.items || []).find((i) => String(i.id) === String(l.itemId));
                    const qty = Number(l.quantity) || 1;
                    const rate = Number(l.rate) || 0;
                    return {
                      ...l,
                      itemId: String(l.itemId),
                      description: l.description || master?.name || '',
                      quantity: qty,
                      rate,
                      gstRate: Number(l.gstRate ?? master?.gstRate ?? 0),
                      hsnSac: l.hsnSac || master?.hsnSac || '',
                      amount: Math.round(qty * rate * 100) / 100,
                    };
                  }),
                },
              });
              setActive('invoices');
            }}
          />
        );
      case 'approvals':
        return <ApprovalsInbox currentCompany={currentCompany} />;
      case 'settingsPosAccounts':
        return (
          <PosPaymentAccounts
            /* Keyed on the branch so switching counters remounts with that
               branch's accounts rather than showing the previous one's. */
            key={activeBranchId}
            currentCompany={currentCompany}
            branchLabel={branches.find((b) => String(b.id) === String(activeBranchId))?.branchName || ''}
          />
        );
      case 'bankCashAccounts': {
        /*
         * Add Account opens the ledger form itself, scoped to the bank and
         * cash groups — not a walk to the Chart of Accounts. There is one
         * ledger creation flow in this product, and this is a door to it, so
         * an account made here is a ledger like any other and the balance it
         * shows is the ledger's own.
         */
        const cashBankGroups = (Array.isArray(dbForUser.accountGroups) ? dbForUser.accountGroups : [])
          .filter((g) => g.companyId === currentCompany.id)
          .filter((g) => {
            const name = String(g?.name || '').trim().toLowerCase();
            return ['bank', 'banks', 'bank account', 'bank accounts', 'cash', 'cash-in-hand', 'cash in hand', 'cash & bank', 'cash and bank', 'cash / bank', 'cash/bank'].includes(name);
          })
          .map((g) => g.id);
        /* Creating or editing an account takes the whole screen, the way the
           other masters do — a dialog was too small for four tabs of fields. */
        if (bankAcctForm) {
          return (
            <div className="space-y-6">
              <ChartAccountForm
                fullPage
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                openModal={openModal}
                includeGroupIds={bankAcctForm.mode === 'edit' ? null : cashBankGroups}
                initialData={bankAcctForm.mode === 'edit' ? bankAcctForm.ledger : null}
                onClose={() => setBankAcctForm(null)}
              />
            </div>
          );
        }
        return (
          <BankCashAccounts
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onAddAccount={() => setBankAcctForm({ mode: 'new' })}
            onEditAccount={(ledgerId) => {
              const row = (dbForUser.chartOfAccounts || []).find(
                (a) => a.companyId === currentCompany.id && String(a.id) === String(ledgerId)
              );
              if (!row) return;
              setBankAcctForm({ mode: 'edit', ledger: row });
            }}
            /* `openLedger` is the one that also goes there. Setting the nav
               state alone left the account name on this screen unclickable:
               the ledger to show was recorded and the screen never changed. */
            onOpenAccount={(ledgerId) => openLedger(String(ledgerId))}
          />
        );
      }
      case 'bankReco':
        return (
          <BankReconciliation
            db={dbForUser}
            setDb={setDb}
            currentCompany={currentCompany}
            onImportStatement={() => setActive('cashBankImport')}
          />
        );
      case 'ledgerTrialBalance':
      case 'generalLedger':
        return <LedgerTrialBalance currentCompany={currentCompany} />;
      default:
        return <SalesOverview db={dbForUser} currentCompany={currentCompany} branches={branchesForUser} warehouses={warehousesForUser} onNavigate={setActive} />;
    }
    /* Every piece of state this switch reads has to be listed, or the screen
       it decides is cached against a value that has already changed. That is
       not a lint nicety: `bankAcctForm` was missing, so Add Account on Bank &
       Cash Accounts set the state, React re-rendered, and this memo handed
       back the same list element it had built before — the button did nothing
       at all, and so did Edit. Add an editor here, add it to this list. */
  }, [active, bankAcctForm, billEditor, branchesError, branchesForUser, branchesLoading, companiesIntent, creditNoteEditor, currentCompany, dbForUser, debitNoteEditor, estimateEditor, exitWorkspace, importKind, invoiceEditor, journalEditor, openLedger, paymentEditor, receiptEditor, ledgerNav, stockTransferEditor, warehousesForUser, activeWarehouseId, activeBranchId, poEditor]);


  if (hasBranchRestriction && !authCtx.loading && authCtx.data && allowedBranchIds.length === 0) {
    return (
      <div className="ui-min-h-viewport ui-sunken flex items-center justify-center p-6">
        <div className="max-w-lg w-full ui-surface border rounded-xl p-6">
          <div className="ui-t-sec">No branches assigned</div>
          <div className="text-sm ui-muted mt-2">
            Your user does not have access to any branch. Ask an admin to assign branches to your user.
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => logout()}
              className="ui-btn ui-btn-danger"
            >
              Logout
            </button>
          </div>
          {authCtx.error ? <div className="mt-3 text-xs text-[rgb(var(--neg))]">{authCtx.error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    /*
     * The shell is exactly one viewport tall and does not scroll. The header
     * and the navigation rail are therefore fixed by construction, and the
     * content column is the only thing that moves.
     *
     * Sticky was not enough: a sticky rail still travels with the page until
     * it reaches its offset, so it visibly slid up on every scroll. Owning the
     * viewport removes the travel rather than compensating for it.
     */
    <div
      className="ui-app-shell flex flex-col overflow-hidden"
      style={{ backgroundColor: 'rgb(var(--app-bg))' }}
    >
      {/* Ambient brand light for the whole shell: fixed so it stays put while
          content scrolls, quiet so tables stay tables. The background colour
          itself is untouched — this paints over --app-bg, never replaces it. */}
      <div className="ui-ambient ui-ambient-quiet ui-ambient-fixed" aria-hidden="true" />
      <Toaster />
      <ResizableTables />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 ui-btn ui-btn-primary"
      >
        Skip to main content
      </a>

      <header
        /* Not inert behind the Features panel. The panel's scrim is measured
           from <main> and stops at the content edge, so the header is lit and
           unwashed — blocking it there produced a bar you could see, read and
           click with nothing happening. */
        className="shrink-0 z-40 backdrop-blur"
        style={{
          backgroundColor: 'rgb(var(--header-bg) / 0.96)',
          borderBottom: '1px solid rgb(var(--border))',
        }}
      >
        <div className="w-full px-2.5 lg:px-3 h-10 flex items-center justify-between gap-1.5">
          {/* No gap here: the only two children are the rail-width company block
              and the search, and a gap between them would push the search off
              the content's left edge by exactly that much. Each child spaces
              its own contents. */}
          <div className="flex items-center min-w-0">
            {/*
              The company sits over the rail, and nothing else does.

              This block is exactly the rail's width and pulled out to the
              header's true left edge, so the column below it and the name
              above it share one boundary — and whatever follows starts where
              the page content starts rather than floating over the navigation.
            */}
            <div
              className={`flex items-center gap-1.5 min-w-0 shrink-0 md:-ms-3 md:ps-3 lg:-ms-4 lg:ps-4 ${
                /* Collapsed, the rail is 60px — narrower than the company name
                   — so there is no column left to match. Pinning the block to
                   60 would crush the name; pinning it to 240 would strand the
                   search 180px into open page. Natural width keeps the two
                   together, which is what the collapsed rail is asking for. */
                dedicatedWorkspaceMode || navCollapsed ? '' : 'md:w-56 lg:w-60'
              }`}
            >
            {/* Phone-only: the rail lives in a drawer, opened here. */}
            {!dedicatedWorkspaceMode ? <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="ui-icon-btn md:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
            </button> : null}
            <img src={currentCompany?.logo || '/clor-logo.png'} alt={currentCompany?.logo ? `${activeOrgName} logo` : 'CLOR'} className="h-5 w-5 shrink-0 object-contain" />
            <div className="relative" ref={orgMenuRef}>
                <button
                  type="button"
                  onClick={() => setOrgMenuOpen((v) => !v)}
                  className="ui-btn ui-btn-ghost !h-8 !min-h-8 !px-1.5 max-w-[16rem]"
                  aria-haspopup="menu"
                  aria-expanded={orgMenuOpen}
                >
                  <span className="ui-title text-sm truncate">{activeOrgName}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>

                {orgMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 mt-2 w-72 rounded-lg overflow-hidden z-50 ui-card ui-in-pop"
                    style={{ boxShadow: 'var(--shadow-pop)', '--pop-origin': 'top left' }}
                  >
                    <div className="px-3 py-2 ui-subtle text-xs uppercase tracking-wide">Switch company</div>
                    {availableOrgs.map((o) => {
                      const isActive = String(o.orgId) === String(activeOrgId);
                      return (
                        <button
                          key={o.orgId}
                          type="button"
                          role="menuitem"
                          onClick={() => switchOrg(o.orgId)}
                          className="w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-[rgb(var(--surface-sunken))] flex items-center justify-between gap-2"
                          style={isActive ? { color: 'rgb(var(--brand-ink))', fontWeight: 600 } : undefined}
                        >
                          <span className="truncate">{o.org?.name || o.orgId}</span>
                          {isActive ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                    <div className="border-t ui-border-c p-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOrgMenuOpen(false);
                          setCompaniesIntent('create');
                          setActive('companies');
                        }}
                        className="ui-btn ui-btn-ghost w-full !justify-start"
                      >
                        <Plus size={14} aria-hidden="true" /> Add company
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            <button
              type="button"
              onClick={toggleNavCollapsed}
              className="ui-icon-btn hidden md:inline-flex !h-7 !w-7 shrink-0"
              aria-pressed={navCollapsed}
              aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {navCollapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
            </button>
            </div>

            {financialYearOptions.length ? <label className="hidden md:flex items-center gap-1.5 ms-2 me-2 text-xs ui-muted whitespace-nowrap">
              <span>FY</span>
              <select
                value={displayedFinancialYear}
                onChange={(event) => {
                  const value = event.target.value;
                  setActiveFinancialYear(value);
                  localStorage.setItem('activeFinancialYear', value);
                  window.dispatchEvent(new CustomEvent('clor:financial-year-changed', { detail: { financialYear: value } }));
                }}
                className="ui-select !h-8 !min-h-8 !py-1 !px-2 w-[6.5rem] text-xs"
                aria-label="Financial year"
              >
                {financialYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label> : null}

            {/*
              Search, at the content's left edge.

              It used to sit in the dashboard's hero card, which meant it was
              on exactly one screen — and the one screen you are least likely
              to be on when you want to find an invoice. Command-K already
              reaches it from anywhere; this is the visible affordance for the
              people who do not know that yet, so it belongs where it is always
              in view. The keycap says how to skip the click.

              It begins where the page begins, not over the rail: the block
              beside it is the rail's width, so this lines up with the content
              under it and reads as part of the page rather than the navigation.
            */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ui-input hidden md:flex items-center gap-1.5 w-48 lg:w-64 shrink-0 text-start ps-2.5 pe-1.5 !h-8 !min-h-8"
              style={{ color: 'rgb(var(--fg-subtle))' }}
              aria-label="Search invoices, customers, items"
            >
              <Search size={16} aria-hidden="true" className="shrink-0" />
              <span className="truncate">Search invoices, customers, items…</span>
              <kbd className="ui-kbd ms-auto shrink-0" aria-hidden="true">⌘K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-1.5">


            <span className="ui-pill ui-pill-neutral hidden lg:inline-flex">{activeLabel}</span>
            {/* The theme belongs to the platform bar above: one control, and
                one answer for every app a company has open. */}

            {/*
              Identity, top right, where people reach for it.

              The rail already carries an account menu at the bottom, and it
              stays — it is where somebody looking at navigation finds their
              own name. This one is the shortcut: a face in the corner, one
              click to the profile, and nothing else in it. Two doors to the
              same room is not duplication when the room is the one people ask
              for by two different names.
            */}
            <div className="relative shrink-0" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((v) => !v)}
                className="block h-8 w-8 shrink-0 rounded-full overflow-hidden"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Your profile"
      title={userEmail}
              >
                {userAvatarUrl ? (
                  <img
                    src={userAvatarUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full object-cover"
                    style={{ border: '1px solid rgb(var(--border))' }}
                  />
                ) : (
                  <span
                    className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium"
                    style={{ backgroundColor: 'rgb(var(--accent-soft))', color: 'rgb(var(--brand-ink))' }}
                    aria-hidden="true"
                  >
                    {userInitials}
                  </span>
                )}
              </button>

              {accountMenuOpen ? (
                <div
                  role="menu"
                  className="ui-card ui-in-pop absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden py-1"
                  style={{ boxShadow: 'var(--shadow-pop)', '--pop-origin': 'top right' }}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
                    {userAvatarUrl ? (
                      <img
                        src={userAvatarUrl}
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span
                        className="h-9 w-9 rounded-full inline-flex items-center justify-center text-xs font-medium shrink-0"
                        style={{ backgroundColor: 'rgb(var(--accent-soft))', color: 'rgb(var(--brand-ink))' }}
                        aria-hidden="true"
                      >
                        {userInitials}
                      </span>
                    )}
                    <span className="min-w-0">
                      {userDisplayName ? (
                        <span className="block text-sm font-medium truncate">{userDisplayName}</span>
                      ) : null}
                      <span className="ui-caption block truncate">{userEmail}</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setActive('settingsProfile');
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[rgb(var(--surface-sunken))]"
                  >
                    <UserRound size={16} aria-hidden="true" /> My account
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setActive('settings');
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[rgb(var(--surface-sunken))]"
                  >
                    <Settings size={16} aria-hidden="true" /> Settings
                  </button>

                  {/* Row density had no other home once the rail menu went. */}
                  <div className="px-3 py-2" style={{ borderTop: '1px solid rgb(var(--border))' }}>
                    <span className="ui-t-label block mb-1.5" style={{ color: 'rgb(var(--fg-subtle))' }}>
                      Row density
                    </span>
                    <div
                      className="flex items-center rounded-lg p-0.5"
                      style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}
                      role="group"
                      aria-label="Row density"
                    >
                      {[
                        { key: 'comfortable', label: 'Comfortable' },
                        { key: 'compact', label: 'Compact' },
                      ].map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => setDensity(d.key)}
                          aria-pressed={density === d.key}
                          className="flex-1 min-w-0 h-7 rounded-lg text-xs font-medium transition-colors"
                          style={
                            density === d.key
                              ? { backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--fg))', boxShadow: 'var(--shadow-card)' }
                              : { color: 'rgb(var(--fg-muted))' }
                          }
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[rgb(var(--surface-sunken))]"
                    style={{ borderTop: '1px solid rgb(var(--border))' }}
                  >
                    <LogOut size={16} aria-hidden="true" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/*
        The verify-email strip used to sit here, above every screen, for as
        long as the address stayed unconfirmed. A permanent banner is not a
        prompt — it becomes part of the furniture within a day and then costs
        every screen a row of height forever.

        `resendVerification` is still wired; the prompt belongs in the account
        menu, where it can be acted on once rather than ignored daily.
      */}

      <div className="w-full flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {mobileNavOpen ? (
          <div
            className="fixed inset-0 md:hidden"
            style={{ backgroundColor: 'rgb(0 0 0 / 0.45)', zIndex: 'var(--z-drawer)' }}
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        {!dedicatedWorkspaceMode ? <aside
          /*
           * Operable while the Features panel is open, deliberately.
           *
           * It used to be inert, on the theory that the rail should not
           * navigate out from under an open panel. In practice the panel is a
           * tool, not a modal: it covers the content area and the rail stays
           * fully lit beside it, so a rail that ignores clicks reads as a
           * broken app rather than as a protected one. Clicking any
           * destination now puts the panel away and goes there, in one click.
           */
          className={`shrink-0 transition-[width] duration-200 ${navCollapsed ? 'ui-rail-narrow' : 'md:w-56 lg:w-60'} ${
            mobileNavOpen
              ? 'ui-rail-drawer max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-72 max-md:overflow-y-auto max-md:p-2 max-md:ui-in-left'
              : 'max-md:hidden'
          } md:block`}
        >
          <nav
            aria-label="Main"
            /* Height, not max-height: the account block is pinned to the foot
               of the rail, and a content-sized rail leaves it floating in the
               middle of the screen with nothing under it. */
            className="ui-rail p-2 md:h-full flex flex-col min-h-0"
          >
            <div className="ui-nav-scroll space-y-1.5 min-h-0 flex-1 overflow-y-auto">
              {visibleNav.map((entry) => {
                if (entry.type === 'item') {
                  const Icon = entry.icon;
                  const reportKeys = new Set([
                    'reports',
                    'trialBalance',
                    'profitLoss',
                    'balanceSheet',
                    'cashFlow',
                    'gstr1',
                    'gstr3b',
                    'salesReports',
                  ]);
                  const isReportsEntry = entry.key === 'reports';
                  const isRoute = active === entry.key || (isReportsEntry && reportKeys.has(active));
                  /* Every rail entry is a destination, Features included: the
                     rail is "take me there", so it goes to the full page from
                     anywhere. The panel is the contextual tool, reached from
                     ⌘K while working in a module — never from the rail. The
                     rail lights the route you are on; a panel open over it is
                     not a route. */
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => goTo(entry.key)}
                      className={`ui-nav-item ${navCollapsed ? 'md:justify-center' : ''}`}
                      data-level="module"
                      data-tone={entry.tone}
                      data-active={isRoute}
                      aria-current={isRoute ? 'page' : undefined}
      title={navCollapsed ? entry.label : undefined}
                    >
                      <Icon
                        size={16}
                        aria-hidden="true"
                        {...(entry.ph ? { weight: 'fill' } : {})}
                        
                      />
                      <span className={navCollapsed ? 'md:hidden' : ''}>{entry.label}</span>
                    </button>
                  );
                }

                const GroupIcon = entry.icon;
                const isOpen = !!openGroups[entry.key];
                const isGroupActive = activeGroupKey === entry.key;

                return (
                  <div key={entry.key}>
                    <button
                      type="button"
                      onClick={() => {
                        /* Reaching for a group is the first half of going
                           somewhere, so the Features panel — a tool over the
                           screen, not a place — is put away here too, rather
                           than sitting over the page while the group unfolds
                           beside it. */
                        setFeaturesOpen(false);
                        // Collapsed rail: a group tap re-opens the rail with
                        // that group expanded — a flyout would need its own
                        // focus management for four entries.
                        if (navCollapsed && window.innerWidth >= 768) {
                          toggleNavCollapsed();
                          setOpenGroups({ [entry.key]: true });
                          return;
                        }
                        // One group open at a time. With eleven modules and
                        // Settings alone running to forty entries, two groups
                        // open pushes the rest below the fold and the rail
                        // becomes something you scroll rather than read.
                        setOpenGroups((prev) => (prev[entry.key] ? {} : { [entry.key]: true }));
                      }}
                      className={`ui-nav-item ${navCollapsed ? 'md:justify-center' : 'justify-between'}`}
                      data-level="module"
                      data-tone={entry.tone}
                      data-active={isGroupActive || undefined}
                      aria-expanded={isOpen}
      title={navCollapsed ? entry.label : undefined}
                    >
                      <span className={`flex items-center gap-2.5 ${navCollapsed ? 'md:gap-0' : ''}`}>
                        <GroupIcon
                          size={16}
                          aria-hidden="true"
                          {...(entry.ph ? { weight: 'fill' } : {})}
                          
                        />
                        <span className={navCollapsed ? 'md:hidden' : ''}>{entry.label}</span>
                      </span>
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={`transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'} ${navCollapsed ? 'md:hidden' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className={`mt-0.5 space-y-0.5 pl-5 ${navCollapsed ? 'md:hidden' : ''}`}>
                        {entry.items.map((item) => {
                          // A heading inside a group. Settings is fifteen items
                          // and heading for twenty-five once Payroll, CRM and
                          // Attendance arrive; without headings it is a list
                          // you read every time instead of a shape you learn.
                          if (item.type === 'subgroup') {
                            return (
                              <div
                                key={`sub-${item.label}`}
                                className="ui-t-label px-2.5 pt-3 pb-1 first:pt-1"
                              >
                                {item.label}
                              </div>
                            );
                          }

                          const Icon = item.icon;
                          const isActive = active === item.key;
                          // What the screen would tell you if you opened it.
                          const state = typeof item.state === 'function' ? item.state() : item.state;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => goTo(item.key)}
                              className="ui-nav-item"
                              data-tone={entry.tone}
                              data-active={isActive}
                              aria-current={isActive ? 'page' : undefined}
                            >
                              <Icon
                                size={16}
                                aria-hidden="true"
                                
                              />
                              <span className="min-w-0 truncate">{item.label}</span>
                              {state ? (
                                <span className="ml-auto shrink-0 text-xs ui-subtle tabular-nums">{state}</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/*
              The rail used to carry an account menu here, pinned to the bottom.
              It moved to the avatar in the top right — one identity control,
              where the sketch put it. Two doors to the same room turned out to
              be two things to keep in step for no gain.
            */}
          </nav>
        </aside> : null}

        {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          items={paletteItems}
          searchRecords={(q) => searchRecords(recordIndex, q)}
          onSelect={(item) => {
            // A record hands its number to the list it opens, so the screen
            // arrives filtered to the thing that was picked rather than showing
            // eighty-eight rows and leaving the user to find it again.
            if (item.key === 'features') {
              handleFeaturesNavigation();
              return;
            }
            if (item.screen) {
              setSearchSeed(item.screen, item.seed);
              setActive(item.screen);
              return;
            }
            setActive(item.key);
          }}
        />
        ) : null}

        <main
          id="main-content"
          key={active}
          inert={featuresOpen || undefined}
          className={`min-w-0 flex-1 ui-content overflow-y-auto overflow-x-hidden min-h-0 ${
            active === 'invoices' && invoiceEditor.open ? 'px-1 py-0' : 'p-0'
          }`}
          /*
           * Two fixes, because the two families of scrollbar break this
           * differently.
           *
           * Overlay scrollbars — macOS, and most touch devices — take no
           * layout width at all and are painted *over* the content, so the
           * primary action in the top right ended up half under the bar. Only
           * padding clears that, and it has to survive the bar widening on
           * hover, which is why it is 16px rather than 4.
           *
           * Classic scrollbars — Windows, most Linux — do take width, and
           * without a reserved gutter the whole page jolts sideways the moment
           * content grows past one viewport. scrollbar-gutter holds the track
           * open whether or not the bar is showing.
           */
          style={{ scrollbarGutter: 'stable' }}
        >
          {/*
            A failed warehouse load used to be silent: the dropdown was simply
            empty, which reads as "no warehouses configured" when the truth may
            be an expired session or a server that is down. Branch errors were
            already surfaced; this is the warehouse counterpart.
          */}
          {/* One bar rather than an onBack prop threaded into four components
              that do not otherwise need one. */}
          {returnTo && returnTo.to === active ? (
            <div className="mb-3">
              {/* Named after where it actually goes. It always said "Back to
                  Home" whatever screen sent you here, so the one control that
                  exists to undo a jump did not say what it would undo. */}
              <button
                type="button"
                onClick={() => {
                  setActive(returnTo.from);
                  setReturnTo(null);
                }}
                className="ui-btn ui-btn-ghost ui-btn-sm"
              >
                <ArrowLeft size={16} aria-hidden="true" /> Back to {screenLabel(returnTo.from)}
              </button>
            </div>
          ) : null}

          {warehousesError ? (
            <div className="mb-4 rounded-lg border border-[rgb(var(--neg)/0.35)] bg-[rgb(var(--neg-soft))] px-4 py-3 text-sm text-[rgb(var(--neg))]">
              Could not load warehouses: {warehousesError}
            </div>
          ) : null}
          {dedicatedMasterDataMode ? (
            <MasterDataWorkspace
              activeKey={active}
              can={can}
              isEnabled={isEnabled}
              onNavigate={setActive}
              onExit={exitWorkspace}
            >
              <Suspense fallback={<SkeletonStats count={4} />}><WriteGuard permission={activePerm}>{page}</WriteGuard></Suspense>
            </MasterDataWorkspace>
          ) : reportPageKeys.has(String(active)) && !['reports', 'tds'].includes(String(active)) ? (
            <div className="space-y-4">
              <div>
                <button
                  type="button"
                  onClick={() => setActive('reports')}
                  className="ui-btn ui-btn-secondary"
                >
                  Back
                </button>
              </div>
              <Suspense fallback={<SkeletonStats count={4} />}><WriteGuard permission={activePerm}>{page}</WriteGuard></Suspense>
            </div>
          ) : isSettingsKey(active) ? (
            /*
              A settings screen keeps its own key — every link, the palette and
              anything that deep-links into one still lands where it did — and
              is wrapped in the workspace so it arrives with a breadcrumb and
              the rest of its category beside it.
            */
            <SettingsWorkspace
              activeKey={active}
              can={can}
              isEnabled={isEnabled}
              onExit={exitWorkspace}
              onNavigate={(target) => {
                if (target === 'settings') {
                  setActive('settings');
                  return;
                }
                if (String(target).startsWith('category:')) {
                  openSettingsCategory(String(target).slice('category:'.length));
                  return;
                }
                setActive(target);
              }}
            >
              <Suspense fallback={<SkeletonStats count={4} />}><WriteGuard permission={activePerm}>{page}</WriteGuard></Suspense>
            </SettingsWorkspace>
          ) : (
            <Suspense fallback={<SkeletonStats count={4} />}><WriteGuard permission={activePerm}>{page}</WriteGuard></Suspense>
          )}
        </main>
      </div>

      <FeaturesPanel
        open={featuresOpen}
        onClose={() => setFeaturesOpen(false)}
        onNavigate={(key) => {
          setFeaturesOpen(false);
          setActive(key);
        }}
        currentCompany={currentCompany}
        returnFocusRef={featuresTriggerRef}
      />

      {modal.content && (
        <Modal
          onClose={() => openModal(null)}
          title={modal.title}
          maxWidthClass={modal.maxWidthClass}
          headerActions={modal.headerActions}
          showCloseIcon={modal.showCloseIcon}
        >
          {modal.content}
        </Modal>
      )}

      <ShortcutSheet open={shortcutSheet.open} onClose={() => shortcutSheet.setOpen(false)} />
    </div>
  );
};

/**
 * The permission set is fetched once per session and shared by the whole shell.
 * `enabled` keeps the request from firing before there is a token and an org to
 * ask about, and the session key remounts the provider when either changes.
 */
/** The token in `?share=…`, if this is somebody following a shared link. */
const shareTokenFromUrl = () => {
  try {
    return String(new URLSearchParams(window.location.search).get('share') || '').trim();
  } catch {
    return '';
  }
};

/** The `perm` of the navigation entry (any depth) whose key is open, for the screen-wide write guard. */
const permForActive = (model, key) => {
  const walk = (items) => {
    for (const item of items || []) {
      if (item?.key === key && item.perm) return item.perm;
      const found = walk(item?.items || item?.children);
      if (found) return found;
    }
    return null;
  };
  return walk(Array.isArray(model) ? model : model?.items);
};

const App = () => {
  /*
   * A shared invoice is answered before anything else in the application.
   *
   * The person following the link is the customer being chased for payment.
   * They have no account here, so the providers below — which fetch
   * permissions and features for a session — must not run at all, and a stale
   * session in that browser must not turn their read-only copy into a signed-in
   * view of somebody's books.
   */
  const shareToken = useMemo(() => shareTokenFromUrl(), []);
  if (shareToken) {
    return (
      <Suspense fallback={null}>
        <SharedInvoice token={shareToken} />
      </Suspense>
    );
  }

  return <AuthedApp />;
};

const readActiveBranchKey = () => {
  try {
    return String(selectedBranchId() || '').trim();
  } catch {
    return '';
  }
};

/**
 * Accounting, as the platform mounts it.
 *
 * The shell has already established who is signed in and which company they
 * are looking at, so this no longer watches localStorage for a token: it reads
 * the company from the platform context and remounts its providers when that
 * changes. A company switch has to re-fetch permissions and features, because
 * both are answers about a company and not about a person.
 */
const AccountingRoot = () => {
  const [orgKey, setOrgKey] = useState(() => String(platformOrgId() || ''));
  const [branchKey, setBranchKey] = useState(readActiveBranchKey);

  useEffect(() => onPlatformContextChange((ctx) => setOrgKey(String(ctx.orgId || ''))), []);

  /*
   * The branch is narrowed inside Accounting (setActiveBranch writes it to
   * localStorage), not by the shell, so it is polled cheaply. A branch change
   * reloads permissions without remounting the tree; a company change still
   * remounts both providers.
   */
  useEffect(() => {
    const id = setInterval(() => {
      const next = readActiveBranchKey();
      setBranchKey((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const sessionKey = `${orgKey}:${branchKey}`;

  return (
    <PermissionProvider key={orgKey} reloadKey={sessionKey} enabled>
      <FeatureProvider key={`f:${orgKey}`} enabled>
        <AppShell />
      </FeatureProvider>
    </PermissionProvider>
  );
};

export default AccountingRoot;

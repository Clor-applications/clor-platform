import React, { useEffect, useMemo, useRef, useState } from 'react';
import { returnableLines } from '@ui/utils/returns';
import KnockOffForm from '@ui/components/KnockOffForm';
import { isOnAccount, noteBalance } from '@ui/utils/onAccount';
import WarehouseField from '@ui/components/WarehouseField';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import UpiPayLink from './UpiPayLink';
import { Ban, Bell, Building2, ChevronDown, ClipboardList, Copy, CreditCard, Download, Eye, FileText, Lock, Mail, MessageCircle, MoreVertical, Package, Plus, Printer, Receipt, RefreshCw, Search, Settings2, SlidersHorizontal, Table2, Tag, Trash2, Upload, Users, X } from 'lucide-react';

import CustomerPicker from '../../components/pickers/CustomerPicker';
import { dueDateFor, termsLabel } from '@ui/utils/paymentTerms';
import { plusDaysIso, todayIso } from '@ui/utils/dates';
import ItemPicker from '../../components/pickers/ItemPicker';
import { createInvoiceApi, deleteInvoiceApi, updateInvoiceApi, updateInvoiceStatusApi } from '@ui/api/invoices';
import { useServerOnHand } from '@ui/hooks/useServerOnHand';
import { useFeatures } from '@ui/permissions/useFeatures';
import useEnabledCurrencies from '../../hooks/useEnabledCurrencies';
import { createDocApi, hasApiSession as hasDocsApiSession, saveSettlementApi } from '@ui/api/purchaseDocs';
import { buildEInvoicePayload, buildEwayBillPayload } from '@ui/utils/einvoice';
import { registerEInvoiceApi, getEInvoiceSettingsApi, generateEwaybillApi } from '../../api/einvoice';
import { resolveSaleRate } from '@ui/utils/pricing';
import { DEDUCTEE_TYPES, TDS_SECTIONS, tdsVariesByDeductee } from '@ui/utils/tds';
import { resolveTds } from '../tds/engine';
import { natureForSection, resolveRule, ruleRate } from '../tds/ruleMaster';
import { fyRange } from '@ui/utils/tdsTcs';
import { getLastSelection, setLastSelection } from '@ui/utils/lastSelection';
import { branchLabel } from '@ui/utils/branchLabel';
import EwbTransportForm from '@ui/components/EwbTransportForm';
import EInvoiceWorkflow from './EInvoiceWorkflow';
import { resolveDiscountForLine } from '@ui/utils/discounts';
import { isTracked, fefoPick, batchesForItem } from '@ui/utils/batches';
import { downloadJson } from '@ui/utils/gstrExport';
import { useGridView } from '@ui/components/grid/useGridView';
import GridControls, { BulkBar } from '@ui/components/grid/GridControls';
import Popover from '@ui/components/ui/Popover';
import DocNumberingPopover from '@ui/components/DocNumberingPopover';
import DocNumberField from '@ui/components/DocNumberField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import DocumentPrintView from '@ui/components/DocumentPrintView';
import Modal from '@ui/components/ui/Modal';
import Drawer from '@ui/components/ui/Drawer';
import InvoiceFieldSettings from '../settings/InvoiceFieldSettings';

import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { getInvoicePrintSettings } from '@ui/utils/invoicePrintSettings';
import { printElement } from '@ui/utils/printElement';
import { getInvoicePrefs, isInvoicePrefOn, getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { getCustomerDisplayName, partyEmail, partyMobile } from '@ui/utils/contacts';
import { createInvoiceShareLink } from '../../api/share';
import { balanceOf, buildReminderMessage, mailtoLink, reminderStage, waLink } from '@ui/utils/reminders';
import { getNextNumericId } from '@ui/utils/ids';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import { consumeSearchSeed } from '@ui/utils/searchSeed';
import RecordReceiptForm from '../payments/RecordReceiptForm';
import InvoicePreview from './InvoicePreview';
import {
  canDetermineSupplyType,
  computeGstForLine,
  computeGstForLines,
  getCompanyGstProfile,
  getPartyGstProfile,
  isIntraStateSupply,
} from '@ui/utils/gst';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { InvoiceIdentifier, DateCell, DueDateCell, Money, Balance } from '@ui/components/table/cells';
import { MoneyValue } from '@ui/components/docs';
import { PageHeader, StatusPill, EmptyState, TableTotals, FieldError, FieldErrorSummary } from '@ui/components/ui/Primitives';
import { ListSearch, StatCards } from '@ui/components/list/ListPageParts';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import DocHeaderStrip from '@ui/components/ui/DocHeaderStrip';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { exportRows, useListSearch } from '@ui/components/ListToolbar';
import { usePeriodFilter, LIST_PERIODS, describeView } from '@ui/components/ListControls';
import { exportListPdf } from '@ui/utils/listPdf';
import { exportListXlsx } from '@ui/utils/listXlsx';
import { DocFormActions, AmountInWordsBand, DocFormFootnote } from '@ui/components/DocumentForm';
import { blockIfClosed } from '@ui/utils/bookClose';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { usePostingLock } from './usePostingLock';
import { orgId as platformOrgId, selectedBranchId } from '@platform/context';
import { invoiceChangeBlockReason } from './invoiceChangeGuard';


/** Columns the invoices grid can show or hide. Identity and actions stay. */
/**
 * Column order follows the document, not the record: the number, when it was
 * raised, who it went to, then what it is worth broken into the three figures
 * that matter — the taxable value, the tax on it, and what the customer owes.
 *
 * Amount and GST Amount are separate columns because they answer different
 * questions. The taxable value is what the sale was worth; the GST is what is
 * being collected on somebody else's behalf and paid over. A single Total
 * column hides both.
 */
const GRID_COLUMNS = [
  { key: 'number', label: 'Invoice No.', always: true },
  { key: 'date', label: 'Date' },
  { key: 'customer', label: 'Customer' },
  // Taxable and GST are off by default. The reference shows Amount, Status and
  // Balance — the three figures a collections conversation uses — and the tax
  // split belongs to the document, not to a list somebody scans.
  { key: 'amount', label: 'Taxable', off: true },
  { key: 'gst', label: 'GST', off: true },
  { key: 'total', label: 'Total Amount', always: true },
  { key: 'status', label: 'Status' },
  { key: 'due', label: 'Due' },
  // Off by default too: the header already says which warehouse is active.
  { key: 'warehouse', label: 'Warehouse', off: true },
];

const InvoicePreviewActions = ({ onPrint, onPdf, onExcel, onTemplates, onFields, onUpi }) => (
  <div className="flex items-center gap-2">
    {onUpi ? (
      <button type="button" className="ui-btn ui-btn-secondary" onClick={onUpi} title="A link your customer pays straight into your UPI ID: no gateway, no fee">
        <CreditCard size={16} /> UPI pay link
      </button>
    ) : null}
    <button type="button" className="ui-btn ui-btn-secondary" onClick={onPrint}>
      <Printer size={16} /> Print
    </button>
    <details className="relative">
      <summary className="ui-btn ui-btn-secondary cursor-pointer list-none">
        <Download size={16} /> Export <ChevronDown size={14} />
      </summary>
      <div className="ui-surface absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-lg border shadow-lg">
        <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={onPdf}>PDF</button>
        <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={onExcel}>Excel</button>
      </div>
    </details>
    <details className="relative">
      <summary className="ui-btn ui-btn-secondary cursor-pointer list-none" aria-label="Invoice settings">
        <Settings2 size={16} /> Settings <ChevronDown size={14} />
      </summary>
      <div className="ui-surface absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border shadow-lg">
        <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={onTemplates}>Print layout &amp; content</button>
        <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={onFields}>Invoice entry fields</button>
      </div>
    </details>
  </div>
);

export const InvoicesList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  onNewInvoice,
  onEditInvoice,
  onRaiseCreditNote,
  onRecordReceipt,
  /**
   * One callback rather than a prop per destination: the More menu will grow,
   * and a new entry should not need a new prop threaded through the parent.
   */
  onNavigate = null,
  warehouses = [],
  /* Handed on to an invoice form opened from this list, so it can ask which
     branch the invoice belongs to. */
  branches = [],
  defaultWarehouseId = '',
}) => {
  const invoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  const warehouseById = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  // Arriving from the palette: the chosen document's number filters the list
  // on the way in, so the screen opens on the thing that was picked.
  const [searchText, setSearchText] = useState(() => consumeSearchSeed('invoices'));
  const colFilters = useColumnFilters();
  const [statusFilter, setStatusFilter] = useState('');
  /**
   * Paging, because the reference pages and because a book with a year of
   * invoices in it renders every row otherwise — a thousand rows of DOM for
   * the ten somebody is looking at.
   */
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const moreBtnRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * A period is chosen far more often than it is typed. "This month" and "last
   * 30 days" are the two questions actually being asked of a sales ledger, and
   * making somebody pick two calendar dates to ask them is the reason people
   * export to a spreadsheet instead.
   */
  const [period, setPeriod] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // --- power grid tools (feature-gated) ---
  const { isEnabled } = useFeatures();
  const gridEnabled = isEnabled('gridTools');
  const grid = useGridView({
    storageKey: `grid:${currentCompany?.id || 'x'}:invoices:v2`,
    columns: GRID_COLUMNS,
  });
  const col = (key) => !gridEnabled || grid.isVisible(key);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const MENU_WIDTH = 224; // w-56
  const MENU_HEIGHT_ESTIMATE = 320;

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-invoice-menu-button]');
      if (btn && String(btn.getAttribute('data-invoice-menu-button')) === String(openMenu.id)) return;
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

  /*
   * A row menu belongs to the row it was opened on, so changing the filters
   * closes it — the row underneath it may no longer be in the list.
   *
   * Adjusted during render rather than in an effect. As an effect it ran after
   * the filtered list had already painted, which left the menu hanging over
   * whatever row had moved into that position for one frame.
   */
  const filterSignature = `${searchText}\u0000${statusFilter}\u0000${dateFrom}\u0000${dateTo}`;
  const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature);
  if (filterSignature !== lastFilterSignature) {
    setLastFilterSignature(filterSignature);
    setOpenMenu(null);
  }

  const getDerivedStatus = (invoice) => {
    const total = Number(invoice?.total ?? 0);
    const paid = Number(invoice?.paidAmount ?? 0);

    const raw = String(invoice?.status || '').trim();
    if (raw === 'Draft') return 'Draft';
    if (raw === 'Paid') return 'Paid';
    if (raw === 'Cancelled') return 'Cancelled';
    if (total > 0 && paid >= total - 0.0001) return 'Paid';

    const due = invoice?.dueDate ? new Date(invoice.dueDate) : null;
    const today = new Date();
    if (due && !Number.isNaN(due.getTime())) {
      const dueYmd = due.toISOString().slice(0, 10);
      const todayYmd = today.toISOString().slice(0, 10);
      if (dueYmd < todayYmd && total > 0 && paid < total - 0.0001) return 'Over due';
    }

    if (paid > 0) return 'Partial';
    return 'Unpaid';
  };

  // What is currently hiding rows, in the user's words. Shown on the empty
  // state so "nothing here" never has to be read as "nothing exists".
  // Pinned once per mount, so "24 days overdue" is the same number in every
  // row of one render pass.

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (String(searchText || '').trim()) {
      chips.push({ label: 'Search', value: String(searchText).trim(), onRemove: () => setSearchText('') });
    }
    if (String(statusFilter || '').trim()) {
      chips.push({ label: 'Status', value: String(statusFilter).trim(), onRemove: () => setStatusFilter('') });
    }
    if (String(dateFrom || '').trim()) {
      chips.push({ label: 'From', value: String(dateFrom).trim(), onRemove: () => setDateFrom('') });
    }
    if (String(dateTo || '').trim()) {
      chips.push({ label: 'To', value: String(dateTo).trim(), onRemove: () => setDateTo('') });
    }
    for (const [key, f] of Object.entries(colFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => colFilters.clearColumn(key) });
    }
    return chips;
  }, [searchText, statusFilter, dateFrom, dateTo, colFilters]);

  /**
   * Export what is on screen — this tab, this search, this period.
   *
   * Lives beside the other page-level actions in the More menu now rather than
   * under its own icon beside the status tabs, which was the only page action
   * that had wandered off on its own.
   */
  const runExport = (kind) => {
    const common = {
      fileName: `Invoices_${currentCompany?.name || 'company'}`,
      columns: exportColumns,
      rows: filteredInvoices,
    };
    const subtitle = describeView({ period, dateFrom, dateTo, status: statusFilter, search: searchText });
    if (kind === 'pdf') {
      exportListPdf({
        ...common,
        title: `Invoices — ${currentCompany?.name || 'Company'}`,
        subtitle,
        footNote: `${filteredInvoices.length} invoice(s) · exported from CLOR`,
      });
    } else if (kind === 'xlsx') {
      exportListXlsx({ ...common, subtitle, sheetName: 'Invoices' });
    } else {
      exportRows({ ...common, label: 'invoice(s)' });
    }
  };

  const clearAllInvoiceFilters = () => {
    setSearchText('');
    setStatusFilter('');
    setPeriod('all');
    setDateFrom('');
    setDateTo('');
    colFilters.clearAll();
  };

  /**
   * Every filter the page offers EXCEPT the status tab.
   *
   * Split out because the tab counts have to be computed against this set, not
   * against the fully filtered one: counting after the status filter would make
   * every tab except the selected one read zero the moment you picked one.
   */
  const invoicesExStatus = useMemo(() => {
    const q = String(searchText || '').trim().toLowerCase();
    const from = String(dateFrom || '').trim();
    const to = String(dateTo || '').trim();

    const matchesSearch = (inv) => {
      if (!q) return true;
      const hay = [inv?.number, inv?.customerName, inv?.refNo]
        .map((x) => String(x || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      return hay.includes(q);
    };

    const inDateRange = (inv) => {
      const d = String(inv?.date || '').trim();
      if (!d) return !from && !to;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };

    const base = (Array.isArray(invoices) ? invoices : [])
      .filter((inv) => matchesSearch(inv))
      .filter((inv) => inDateRange(inv))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      });

    return colFilters.applyFilters(base, {
      number: (r) => r.number,
      customer: (r) => r.customerName,
      warehouse: (r) => {
        const wh = warehouseById.get(String(r?.warehouseId || '').trim());
        return wh?.name || r?.warehouseId || '';
      },
      date: (r) => r.date,
      due: (r) => r.dueDate,
      total: (r) => r.total,
      status: (r) => getDerivedStatus(r),
    });
  }, [dateFrom, dateTo, invoices, searchText, colFilters.applyFilters, warehouseById]);

  /** The rows the table draws: the above, narrowed by the selected status tab. */
  const filteredInvoices = useMemo(() => {
    const wantStatus = String(statusFilter || '').trim();
    if (!wantStatus) return invoicesExStatus;
    return invoicesExStatus.filter((inv) => getDerivedStatus(inv) === wantStatus);
  }, [invoicesExStatus, statusFilter]);

  // Summed over the filtered set, not over the rows the browser happens to have
  // drawn — the day this list gets a page window, the figure must not quietly
  // become the total of one page.
  /**
   * The five figures across the top.
   *
   * Computed from the rows actually on screen — `filteredInvoices` — so search
   * for one customer and the figures describe that customer, not the whole
   * year. Reading the unfiltered set here meant the cards and the table below
   * them described different sets of data with nothing saying so.
   *
   * Drafts are excluded from the money figures on the same rule the dashboard
   * uses: a draft is an intention, not a receivable.
   */
  const headline = useMemo(() => {
    const live = filteredInvoices.filter((i) => String(i.status || '').toLowerCase() !== 'draft');
    const sum = (rows, f) => rows.reduce((t, r) => t + Number(f(r) || 0), 0);
    const balOf = (i) => Math.max(0, Number(i.total || 0) - Number(i.paidAmount || 0));
    const overdue = live.filter((i) => getDerivedStatus(i) === 'Over due');
    return {
      count: filteredInvoices.length,
      billed: sum(live, (i) => i.total),
      paid: sum(live, (i) => i.paidAmount),
      outstanding: sum(live, balOf),
      overdue: sum(overdue, balOf),
    };
  }, [filteredInvoices]);

  /*
   * Each status carries its own colour, from the money semantics the palette
   * already defines: settled is green, late is red, part-paid is the amber
   * this product uses for attention. Sent is the one state that is not a fact
   * about the money — the document is out and the clock is running — so it
   * takes the blue this book already uses for a thing in flight.
   *
   * Cancelled is deliberately NOT orange. Orange is the brand here and means
   * "this is the active thing"; a voided document is the opposite of active,
   * and two oranges in one strip would make the chosen tab ambiguous. It is
   * grey, which is what a document that no longer counts should look like.
   */
  const STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Unpaid', label: 'Sent', tone: 'sent' },
    { value: 'Partial', label: 'Partially paid', tone: 'partial' },
    { value: 'Paid', label: 'Paid', tone: 'paid' },
    { value: 'Over due', label: 'Overdue', tone: 'overdue' },
    { value: 'Cancelled', label: 'Cancelled', tone: 'cancelled' },
  ];

  /**
   * The rows this page shows.
   *
   * Clamped rather than trusted: filtering down to three rows while sitting on
   * page five would otherwise show an empty table with pagination underneath
   * insisting there are results.
   */
  const pageCount = Math.max(1, Math.ceil(filteredInvoices.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pagedInvoices = filteredInvoices.slice((safePage - 1) * perPage, safePage * perPage);



  /**
   * A preset writes the two dates rather than filtering separately. One code
   * path decides what is in view, so the chips, the totals, the table and both
   * exports can never disagree about the period.
   */
  /*
   * The badge counter and the period helper went with the Filters button.
   * The date range they drove is still honoured by `filteredInvoices` — a
   * saved layout can carry one — and the Date column filter is how it is set
   * now, so nothing that could narrow the list has been taken away.
   */

  /**
   * The columns an export carries: the document's own figures, not the
   * screen's optional ones. The list can hide Warehouse; a sheet of invoices
   * without the customer or the tax on it is not useful to anybody.
   */
  const exportColumns = [
    { key: 'number', label: 'Invoice No.' },
    { key: 'date', label: 'Date' },
    { key: 'customerName', label: 'Customer' },
    { key: 'subtotal', label: 'Amount', align: 'right', value: (r) => Number(r.subtotal || 0) },
    { key: 'gstTotal', label: 'GST Amount', align: 'right', value: (r) => Number(r.gstTotal || 0) },
    { key: 'total', label: 'Total Amount', align: 'right', value: (r) => Number(r.total || 0) },
    { key: 'paidAmount', label: 'Paid', align: 'right', value: (r) => Number(r.paidAmount || 0) },
    { key: 'status', label: 'Status', value: (r) => getDerivedStatus(r) },
  ];

  // Kept for the bulk bar, which exports the selection rather than the view.
  const openNewInvoice = () => {
    if (typeof onNewInvoice === 'function') {
      onNewInvoice();
      return;
    }
    openModal(
      <InvoiceForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: 'New Invoice', maxWidthClass: 'max-w-7xl' }
    );
  };

  /*
   * Item 16 — a settled document is not quietly reshaped.
   *
   * An invoice that money or a credit note has answered cannot be edited,
   * cancelled or deleted while those answers stand: rewriting it would
   * orphan a receipt's allocation or double a credit note's relief, which
   * is exactly the corruption this guard exists to prevent. The remediation
   * is directed, not automated — reverse the receipt (the Receipts list can
   * now do that in one click) or cancel the credit note, THEN change the
   * invoice. Deliberately no auto-unlink: an automatic cascade through
   * payment allocations is how books get corrupted quietly.
   */
  const invoiceChangeBlocked = (invoice, verb) => invoiceChangeBlockReason(db, currentCompany, invoice, verb);

  const openEditInvoice = (invoice) => {
    {
      const blocked = invoiceChangeBlocked(invoice, 'edit');
      if (blocked) {
        notify.error(blocked);
        return;
      }
    }
    if (typeof onEditInvoice === 'function') {
      onEditInvoice(invoice);
      return;
    }
    openModal(
      <InvoiceForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={invoice}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: `Edit Invoice ${invoice?.number || ''}`.trim(), maxWidthClass: 'max-w-7xl' }
    );
  };

  /**
   * Recording money against an invoice goes to the Receipts screen.
   *
   * It used to open the same form in a dialog over this list. A receipt is a
   * document with a number that posts to the ledger, not a detail of the
   * invoice it happens to settle: as a dialog it had no address of its own, the
   * browser's Back button dismissed the list behind it, and there was nowhere
   * to return to once the money was recorded.
   *
   * The invoice is carried across, ticked and allocated — without that the
   * money lands on account and the invoice it paid stays open.
   *
   * The dialog remains the fallback where this screen is rendered without a
   * host that can navigate, so no entry point is lost.
   */
  const openRecordReceipt = (invoice) => {
    const initialData = {
      customerId: invoice?.customerId,
      amount: Math.max(0, Number(invoice?.total ?? 0) - Number(invoice?.paidAmount ?? 0)),
      allocateInvoiceId: invoice?.id,
      reference: invoice?.number || '',
    };

    if (typeof onRecordReceipt === 'function') {
      onRecordReceipt(invoice);
      return;
    }

    openModal(
      <RecordReceiptForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={initialData}
        onClose={() => openModal(null)}
      />,
      { title: `Record Receipt ${invoice?.number || ''}`.trim(), maxWidthClass: 'max-w-4xl' }
    );
  };

  const markReminderSent = (invoice, channel) => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = { date: today, channel, stage: reminderStage(invoice, today) };
    setDb((prev) => ({
      ...prev,
      invoices: (prev.invoices || []).map((row) =>
        row.id === invoice.id ? { ...row, remindersSent: [...(row.remindersSent || []), entry] } : row
      ),
    }));
  };

  const reminderMessageFor = async (invoice) => {
    const customer = (db.customers || []).find((row) => String(row.id) === String(invoice.customerId)) || null;
    let shareUrl = '';
    const backendId = String(invoice.backendInvoiceId || '').trim();
    if (backendId) {
      try {
        const result = await createInvoiceShareLink(backendId);
        if (result?.token) shareUrl = `${window.location.origin}/?share=${encodeURIComponent(result.token)}`;
      } catch {
        shareUrl = '';
      }
    }
    return {
      customer,
      message: buildReminderMessage({ invoice, customer, company: currentCompany, shareUrl }),
    };
  };

  const openPaymentReminder = (invoice) => {
    const sendWhatsApp = async () => {
      const { customer, message } = await reminderMessageFor(invoice);
      window.open(waLink(partyMobile(customer), message), '_blank', 'noopener');
      markReminderSent(invoice, 'whatsapp');
      notify.success(`WhatsApp reminder opened for ${invoice.number}.`);
    };
    const sendEmail = async () => {
      const { customer, message } = await reminderMessageFor(invoice);
      window.open(mailtoLink(partyEmail(customer), `Payment reminder — Invoice ${invoice.number}`, message), '_self');
      markReminderSent(invoice, 'email');
      notify.success(`Email reminder opened for ${invoice.number}.`);
    };
    const copyReminder = async () => {
      const { message } = await reminderMessageFor(invoice);
      try {
        await navigator.clipboard.writeText(message);
        markReminderSent(invoice, 'copy');
        notify.success('Payment reminder copied.');
      } catch {
        notify.error('Clipboard is unavailable. Use WhatsApp or Email.');
      }
    };

    openModal(
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><div className="ui-label">Invoice</div><div className="mt-1 font-semibold">{invoice.number}</div></div>
          <div><div className="ui-label">Customer</div><div className="mt-1 font-semibold">{invoice.customerName || '—'}</div></div>
          <div><div className="ui-label">Outstanding</div><div className="ui-money mt-1">{formatMoney(balanceOf(invoice), currentCompany)}</div></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <button type="button" className="ui-btn ui-btn-primary" onClick={sendWhatsApp}><MessageCircle size={16} /> WhatsApp</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={sendEmail}><Mail size={16} /> Email</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={copyReminder}><Copy size={16} /> Copy message</button>
          <button type="button" className="ui-btn ui-btn-ghost ms-auto" onClick={() => openModal(null)}>Close</button>
        </div>
      </div>,
      { title: `Payment Reminder — ${invoice.number}`, maxWidthClass: 'max-w-2xl' }
    );
  };

  const printOpenInvoice = (invoice) => {
    const page = getInvoicePrintSettings(getDocSettings(db, currentCompany));
    printElement({
      element: document.querySelector('.ui-dialog [data-invoice-preview]'),
      title: String(invoice?.number || 'invoice'),
      page,
    });
  };

  const exportInvoiceExcel = (invoice) => {
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    const rows = items.length ? items.map((line, index) => ({ ...line, lineNo: index + 1 })) : [{ lineNo: 1 }];
    exportListXlsx({
      fileName: String(invoice?.number || 'invoice'),
      sheetName: 'Invoice',
      metaLines: [
        `Invoice ${invoice?.number || ''}`,
        currentCompany?.name || '',
        `Customer: ${invoice?.customerName || ''}`,
        `Date: ${invoice?.date || ''}`,
        `Total: ${Number(invoice?.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      ],
      reportStyle: 'statement',
      columns: [
        { key: 'lineNo', label: '#', type: 'number' },
        { key: 'description', label: 'Item / Description', value: (r) => r.name || r.description || '' },
        { key: 'hsnSac', label: 'HSN / SAC' },
        { key: 'quantity', label: 'Qty', type: 'number' },
        { key: 'rate', label: 'Rate', type: 'number' },
        { key: 'taxableAmount', label: 'Taxable Value', type: 'number', value: (r) => Number(r.taxableAmount ?? r.amount ?? 0) },
        { key: 'gstRate', label: 'GST %', type: 'number' },
        { key: 'gstAmount', label: 'GST Amount', type: 'number' },
        { key: 'lineTotal', label: 'Total', type: 'number', value: (r) => Number(r.lineTotal ?? 0) },
      ],
      rows,
    });
  };

  const goFromPreviewToSettings = (screen) => {
    openModal(null);
    if (typeof onNavigate === 'function') onNavigate(screen);
  };

  const openViewInvoice = (invoice) => {
    openModal(
      <InvoicePreview db={db} currentCompany={currentCompany} invoice={invoice} />,
      {
        title: `Invoice ${invoice?.number || ''}`.trim(),
        maxWidthClass: 'max-w-5xl',
        headerActions: (
          <InvoicePreviewActions
            onPrint={() => printOpenInvoice(invoice)}
            onPdf={() => openPrintAndDownload(invoice)}
            onExcel={() => exportInvoiceExcel(invoice)}
            onTemplates={() => goFromPreviewToSettings('invoiceTemplates')}
            onFields={() => goFromPreviewToSettings('settingsInvoiceFields')}
            onUpi={String(invoice?.status || '') === 'Draft' || !invoice?.backendInvoiceId ? null : () => openModal(<UpiPayLink invoice={invoice} currentCompany={currentCompany} />, { title: `UPI pay link · Invoice ${invoice?.number || ''}`.trim(), maxWidthClass: 'max-w-2xl' })}
          />
        ),
      }
    );
  };

  const InvoicePrintDownloadView = ({ invoice }) => {
    const no = String(invoice?.number || '').trim();
    const page = getInvoicePrintSettings(getDocSettings(db, currentCompany));
    return (
      <PrintDownloadFrame title={no ? `Invoice ${no}` : 'Invoice'} fileBase={no || 'invoice'} page={page}>
        <InvoicePreview db={db} currentCompany={currentCompany} invoice={invoice} />
      </PrintDownloadFrame>
    );
  };

  const openPrintAndDownload = (invoice) => {
    openModal(<InvoicePrintDownloadView invoice={invoice} />, {
      title: `Invoice ${invoice?.number || ''}`.trim(),
      maxWidthClass: 'max-w-5xl',
    });
  };

  const duplicateInvoice = (invoice) => {
    const copyInvoice = {
      ...invoice,
      id: undefined,
      number: '',
      date: undefined,
      dueDate: undefined,
      status: 'Draft',
      paidAmount: 0,
      createdAt: undefined,
      updatedAt: undefined,
      sourceEstimateId: null,
    };

    if (Array.isArray(copyInvoice.items)) {
      copyInvoice.items = copyInvoice.items.map((l) => ({
        itemId: l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '',
        description: l?.description ?? '',
        quantity: Number(l?.quantity ?? 1),
        rate: Number(l?.rate ?? 0),
        gstRate: Number(l?.gstRate ?? 0),
        hsnSac: l?.hsnSac || '',
        amount: Number(l?.amount ?? 0),
      }));
    }

    openEditInvoice(copyInvoice);
  };

  const raiseCreditNote = (invoice) => {
    if (typeof onRaiseCreditNote === 'function') {
      onRaiseCreditNote(invoice);
      return;
    }

    openModal(
      <CreditNoteForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialOriginalInvoiceId={invoice?.id}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: 'New Credit Note', maxWidthClass: 'max-w-5xl' }
    );
  };

  /*
   * Cancelling used to write to the local store and stop there.
   *
   * The route to do it properly already existed and was never called, so the
   * cancellation lived in one browser: sign in on another machine, or clear
   * site data, and the invoice was live again with nothing recording that
   * anyone had cancelled it. The server also reverses the invoice's journal
   * entry now, so the books stop carrying revenue and output GST for a document
   * that no longer exists.
   *
   * The local store is written only after the server agrees — the same order
   * delete already used. Cancelling optimistically would put the list and the
   * ledger back out of step, which is the bug being fixed.
   */
  const cancelInvoice = async (invoice) => {
    {
      const blocked = invoiceChangeBlocked(invoice, 'cancel');
      if (blocked) {
        notify.error(blocked);
        return;
      }
    }
    const ok = await confirmDialog({
      title: 'Please confirm',
      message: `Cancel invoice ${invoice?.number || ''}? Its number stays with the record and its ledger entry is reversed.`.trim(),
      confirmLabel: 'Yes, continue',
    });
    if (!ok) return;

    const hasApiSession = Boolean(
      String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim()
    );
    const backendInvoiceId = String(invoice?.backendInvoiceId || '').trim();
    if (hasApiSession && backendInvoiceId) {
      try {
        await updateInvoiceStatusApi(backendInvoiceId, { status: 'Cancelled' });
      } catch (e) {
        notify.error(String(e?.message || 'Unable to cancel the invoice.'));
        return;
      }
    }

    setDb((prev) => ({
      ...prev,
      invoices: (prev.invoices || []).map((inv) =>
        inv.id === invoice.id
          ? {
              ...inv,
              status: 'Cancelled',
              updatedAt: new Date().toISOString(),
            }
          : inv
      ),
    }));
    notify.success(`Invoice ${invoice?.number || ''} cancelled.`.trim());
  };

  const deleteInvoiceCore = async (invoice) => {
    const run = async () => {
      const hasApiSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
      const backendInvoiceId = String(invoice?.backendInvoiceId || '').trim();
      if (hasApiSession && backendInvoiceId) {
        try {
          await deleteInvoiceApi(backendInvoiceId);
        } catch (e) {
          notify.error(String(e?.message || 'Unable to delete invoice from backend.'));
          return;
        }
      }

      setDb((prev) => ({
        ...prev,
        invoices: (prev.invoices || []).filter((inv) => inv.id !== invoice.id),
        payments: (Array.isArray(prev.payments) ? prev.payments : []).filter(
          (p) => {
            if (p?.voucherType === 'invoice' && Number(p?.voucherId) === Number(invoice.id)) return false;
            if (p?.voucherType === 'receipt' && Array.isArray(p?.allocations)) {
              const hit = p.allocations.some((a) => a?.voucherType === 'invoice' && Number(a?.voucherId) === Number(invoice.id));
              if (hit) return false;
            }
            return true;
          }
        ),
      }));
    };
    await run();
  };

  const deleteInvoice = async (invoice) => {
    {
      const blocked = invoiceChangeBlocked(invoice, 'delete');
      if (blocked) {
        notify.error(blocked);
        return;
      }
    }

    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete invoice ${invoice?.number || ''}? This cannot be undone.`.trim(), confirmLabel: 'Yes, continue' });
    if (!ok) return;
    deleteInvoiceCore(invoice);
  };

  const bulkDelete = async () => {
    const rows = filteredInvoices.filter((i) => selectedIds.has(i.id));
    if (!rows.length) return;

    /*
     * Only drafts can be deleted, so a selection is split before anything is
     * confirmed. Deleting the drafts and letting the rest fail one by one would
     * have told the user the count they asked for and then quietly done less;
     * the number in the confirmation is the number that will actually go.
     */
    const drafts = rows.filter((i) => String(i?.status || '') === 'Draft');
    const issued = rows.length - drafts.length;
    if (!drafts.length) {
      notify.error(
        `Nothing to delete — ${issued === 1 ? 'that invoice has' : 'those invoices have'} been issued. Cancel ${issued === 1 ? 'it' : 'them'} instead.`
      );
      return;
    }

    const ok = await confirmDialog({
      title: 'Please confirm',
      message:
        `Delete ${drafts.length} draft invoice${drafts.length === 1 ? '' : 's'}? This cannot be undone.` +
        (issued ? ` ${issued} issued invoice${issued === 1 ? '' : 's'} in the selection will be left alone — issued invoices are cancelled, not deleted.` : ''),
      confirmLabel: 'Yes, continue',
    });
    if (!ok) return;
    for (const inv of drafts) {
      // Sequential on purpose: each delete hits the API and then rewrites
      // db state; racing them loses updates to the last writer.
      await deleteInvoiceCore(inv);
    }
    setSelectedIds(new Set());
  };

  /**
   * The selection, exported through the same columns as the view.
   *
   * This used to build its own CSV by hand with a different, shorter column
   * set — so a selection and a full export of the same invoices disagreed
   * about what an invoice contains.
   */
  const bulkExportCsv = () => {
    const rows = filteredInvoices.filter((i) => selectedIds.has(i.id));
    exportRows({
      fileName: `Invoices_${currentCompany?.name || 'company'}_selection`,
      label: 'invoice(s)',
      columns: exportColumns,
      rows,
    });
  };

  const openInvoiceMenu = (invoiceId, anchorEl) => {
    if (!anchorEl) {
      setOpenMenu({ id: invoiceId, left: 0, top: 0 });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const padding = 12;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    let left = rect.right - MENU_WIDTH;
    left = Math.max(padding, Math.min(left, vw - MENU_WIDTH - padding));

    let top = rect.bottom + 8;
    if (top + MENU_HEIGHT_ESTIMATE > vh - padding) {
      top = rect.top - MENU_HEIGHT_ESTIMATE - 8;
    }
    top = Math.max(padding, Math.min(top, vh - padding - 40));

    setOpenMenu({ id: invoiceId, left, top });
  };

  return (
    <div className="sales-list-page space-y-3">
      <PageHeader
        entity="invoice"
        title="Sales Invoices"
              actions={
          <>
            {/*
              Search sits in the header rather than in a band of its own.
              A filter panel spanning the page reads as a second toolbar and
              costs eighty pixels above the rows somebody came to read.
            */}
            <select
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
              className="ui-select ui-ctl-compact w-40"
              aria-label="Invoice status"
            >
              {STATUS_TABS.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{item.label}</option>
              ))}
            </select>
            <ListSearch
              value={searchText}
              onChange={(v) => {
                setSearchText(v);
                setPage(1);
              }}
              placeholder="Search invoices…"
              label="Search invoices"
            />

            {/*
              Layout takes the place the Filters button had.

              Filters was a period select and a date range sitting behind a
              popover, while every column already carries its own filter and
              the status tabs carry the one people actually use. Two ways to
              narrow the same list is one too many, and the one behind a button
              was the one nobody found. The Date column filter still does the
              range.
            */}
            {gridEnabled ? <GridControls grid={grid} /> : null}

            {/*
              Page-level actions, kept apart from the row menu.

              These configure or feed the whole list; the ⋮ on a row acts on one
              invoice. Mixing the two is how somebody changes a template while
              meaning to print a document.
            */}
            <div className="relative">
              <button
                type="button"
                ref={moreBtnRef}
                onClick={() => setMoreOpen((v) => !v)}
                className="ui-btn ui-btn-secondary"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
              >
                <MoreVertical size={16} aria-hidden="true" /> More
              </button>
              {moreOpen ? (
                <Popover anchorRef={moreBtnRef} onClose={() => setMoreOpen(false)} minWidth={228}>
                  <div className="py-1" role="menu">
                    {/* This menu is only for moving invoice data in or out. */}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        if (typeof onNavigate === 'function') onNavigate('dataImport');
                      }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                    >
                      <Download size={16} aria-hidden="true" /> Import invoices
                    </button>

                    {/* Three formats behind one entry, not three entries.
                        Listed flat they pushed the settings below the fold and
                        made a four-item menu read as six. */}
                    <button
                      type="button"
                      role="menuitem"
                      aria-expanded={exportOpen}
                      onClick={() => setExportOpen((v) => !v)}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                    >
                      <Download size={16} aria-hidden="true" /> Export invoices
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className="ms-auto transition-transform"
                        style={exportOpen ? { transform: 'rotate(180deg)' } : undefined}
                      />
                    </button>
                    {exportOpen
                      ? [
                          { k: 'pdf', label: 'PDF', Icon: FileText },
                          { k: 'xlsx', label: 'Excel', Icon: Table2 },
                          { k: 'csv', label: 'CSV', Icon: Download },
                        ].map((o) => (
                          <button
                            key={o.k}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMoreOpen(false);
                              setExportOpen(false);
                              runExport(o.k);
                            }}
                            className="w-full text-left flex items-center gap-2 px-3 py-2 ps-9 text-sm hover:bg-[rgb(var(--surface-sunken))]"
                          >
                            <o.Icon size={16} aria-hidden="true" /> {o.label}
                          </button>
                        ))
                      : null}
                  </div>
                </Popover>
              ) : null}
            </div>

            {/*
              One button, one thing.

              It was a split button whose caret offered "from an estimate" and
              "from a delivery challan" — neither of which created anything.
              Both navigated to another list to pick a document to convert, so
              the caret on the create button led away from creating. Those
              conversions still start where the documents are, which is where
              somebody looking at an estimate already is.
            */}
            <PermissionButton
              permission="SALES::Invoices::CREATE"
              onClick={openNewInvoice}
              className="ui-btn ui-btn-primary"
            >
              <Plus size={16} aria-hidden="true" /> New Invoice
            </PermissionButton>
          </>
        }
      />

      {/*
        Five figures across the top, each answering a different question about
        the same book: how many, how much, how much of it has arrived, how much
        has not, and how much of that is late.

        Drafts are out of every money figure — a draft is an intention, not a
        receivable — but they stay in the count, because they exist.
      */}
      <StatCards
        company={currentCompany}
        dense
        cards={[
          { label: 'Invoices', value: headline.count, count: true, tone: 'draft', Icon: FileText },
          { label: 'Invoiced', value: headline.billed, tone: 'sent', Icon: Receipt },
          { label: 'Paid', value: headline.paid, tone: 'paid', Icon: CreditCard },
          { label: 'Outstanding', value: headline.outstanding, tone: 'outstanding', Icon: ClipboardList },
          { label: 'Overdue', value: headline.overdue, tone: 'overdue', Icon: Ban },
        ]}
      />

      {/* One card, not two: the filters belong to the table they filter, and a
          separate floating box above it reads as an unrelated control panel. */}
      <div className="ui-card overflow-hidden">

        {gridEnabled ? (
          <BulkBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
            <button type="button" onClick={bulkExportCsv} className="ui-btn ui-btn-secondary ui-btn-sm">
              Export CSV
            </button>
            <button type="button" onClick={bulkDelete} className="ui-btn ui-btn-danger ui-btn-sm">
              Delete
            </button>
          </BulkBar>
        ) : null}

        <div
          className="overflow-x-auto ui-table-scroll"
          style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}
        >
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              {gridEnabled ? (
                <th scope="col" className="w-8">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    aria-label="Select all invoices in view"
                    checked={pagedInvoices.length > 0 && pagedInvoices.every((i) => selectedIds.has(i.id))}
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? new Set(pagedInvoices.map((i) => i.id)) : new Set())
                    }
                  />
                </th>
              ) : null}
              <ColumnHeader label="Invoice #" col="number" state={colFilters} />
              {col('customer') ? <ColumnHeader label="Customer" col="customer" state={colFilters} /> : null}
              {col('date') ? <ColumnHeader label="Date" col="date" state={colFilters} align="center" /> : null}
              {col('due') ? <ColumnHeader label="Due" col="due" state={colFilters} align="center" /> : null}
              <ColumnHeader label="Amount" col="total" state={colFilters} className="ui-num" align="right" />
              {col('status') ? <ColumnHeader label="Status" col="status" state={colFilters} align="center" /> : null}
              {/* Balance, not paid: what is still owed is the figure somebody
                  chases. Paid is derivable from it and total, and only one of
                  the three earns a column. */}
              <ColumnHeader label="Balance" col="balance" state={colFilters} className="ui-num" align="right" />
              {col('amount') ? <ColumnHeader label="Taxable" col="amount" state={colFilters} className="ui-num" align="right" /> : null}
              {col('gst') ? <ColumnHeader label="GST" col="gst" state={colFilters} className="ui-num" align="right" /> : null}
              {col('warehouse') ? <ColumnHeader label="Warehouse" col="warehouse" state={colFilters} /> : null}
              <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {filteredInvoices.length === 0 ? null : (
              pagedInvoices.map((inv) => {
                const whId = String(inv?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                const derived = getDerivedStatus(inv);

                return (
                  <tr
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={(e) => {
                      const el = e.target;
                      if (el?.closest?.('[data-invoice-menu-button]')) return;
                      if (el?.closest?.('[data-invoice-menu]')) return;
                      openViewInvoice(inv);
                    }}
                  >
                    {gridEnabled ? (
                      <td className="w-8" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          aria-label={`Select invoice ${inv.number}`}
                          checked={selectedIds.has(inv.id)}
                          onChange={() => toggleSelected(inv.id)}
                        />
                      </td>
                    ) : null}
                    <td className="ui-col-id">
                      <InvoiceIdentifier
                        value={inv.number}
                        label="invoice"
                        onOpen={() => openViewInvoice(inv)}
                      />
                    </td>
                    {col('customer') ? <td className="ui-col-entity">{inv.customerName || '-'}</td> : null}
                    {col('date') ? (
                      <td className="ui-col-date"><DateCell value={inv.date} /></td>
                    ) : null}
                    {col('due') ? (
                      <td className="ui-col-date">
                        <DueDateCell
                          value={inv.dueDate}
                          balance={Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0))}
                        />
                      </td>
                    ) : null}
                    <td className="ui-col-amount">
                      <Money value={inv.total} company={currentCompany} />
                    </td>
                    {col('status') ? (
                    <td className="whitespace-nowrap"><StatusPill status={derived} /></td>
                    ) : null}
                    {/* The only date that earns colour: past due, still owed. */}
                    <td className="ui-col-amount">
                      <Balance
                        value={Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0))}
      company={currentCompany}
                        dueIso={inv.dueDate}
                      />
                    </td>
                    {col('amount') ? (
                      <td className="ui-col-amount"><MoneyValue value={inv.subtotal} company={currentCompany} /></td>
                    ) : null}
                    {col('gst') ? (
                      <td className="ui-col-amount"><MoneyValue value={inv.gstTotal} company={currentCompany} /></td>
                    ) : null}
                    {col('warehouse') ? <td className="ui-col-meta">{whLabel}</td> : null}
                    <td
                      className="ui-action-col relative"
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openMenu?.id === inv.id) {
                            setOpenMenu(null);
                          } else {
                            openInvoiceMenu(inv.id, e.currentTarget);
                          }
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md ui-hover-sunken"
                        aria-label="Invoice actions"
                        data-invoice-menu-button={inv.id}
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

        {/* Outside the table, inside the scroller: its width resolves to what
            is visible rather than to a table that runs off the right edge, so
            the card centres on the view. */}
        {filteredInvoices.length === 0 ? (
          <div className="ui-empty-pane p-2">
            {invoices.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      kind="new"
      title="No invoices yet"
                      description="An invoice is what turns a sale into money owed to you, and into the GST you have collected."
                      routes={[
                        {
                          label: 'Raise one now',
                          description: 'Pick a customer, add lines, save. Two minutes.',
                          onSelect: () => onNewInvoice?.(),
                        },
                        {
                          label: 'Import your history',
                          description: 'Bring across invoices from your existing books.',
                          onSelect: () => onNewInvoice?.(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={FileText}
                      kind="filtered"
                      totalCount={invoices.length}
                      filters={activeFilterChips}
                      onClearFilters={clearAllInvoiceFilters}
                    />
                  )}
          </div>
        ) : null}
        </div>


        {/* Paging. Hidden entirely when everything already fits — controls that
            can only do nothing are noise. */}
        {filteredInvoices.length > perPage || perPage !== 10 ? (
          <div
            className="flex items-center justify-between gap-3 flex-wrap px-4 py-3"
            style={{ borderTop: '1px solid rgb(var(--border))' }}
          >
            <span className="ui-subtle text-xs">
              Showing {filteredInvoices.length === 0 ? 0 : (safePage - 1) * perPage + 1} to{' '}
              {Math.min(safePage * perPage, filteredInvoices.length)} of {filteredInvoices.length} invoices
            </span>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" className="ui-btn ui-btn-sm" disabled={safePage === 1} onClick={() => setPage(1)} aria-label="First page">«</button>
              <button type="button" className="ui-btn ui-btn-sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">‹</button>
              {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
                // A window around the current page, so page 40 of 60 does not
                // render sixty buttons.
                const first = Math.max(1, Math.min(safePage - 2, pageCount - 4));
                return first + i;
              })
                .filter((n) => n >= 1 && n <= pageCount)
                .map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    aria-current={n === safePage ? 'page' : undefined}
                    className="ui-btn ui-btn-sm ui-mono"
                    style={
                      n === safePage
                        ? { borderColor: 'rgb(var(--brand))', color: 'rgb(var(--brand-ink))', backgroundColor: 'rgb(var(--accent-soft))' }
                        : undefined
                    }
                  >
                    {n}
                  </button>
                ))}
              <button type="button" className="ui-btn ui-btn-sm" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next page">›</button>
              <button type="button" className="ui-btn ui-btn-sm" disabled={safePage === pageCount} onClick={() => setPage(pageCount)} aria-label="Last page">»</button>

              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="ui-select ui-btn-sm w-24 px-2 text-xs ui-ctl-compact"
                aria-label="Rows per page"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {openMenu?.id ? (
        <div
          ref={menuRef}
          className="fixed w-56 ui-card overflow-hidden ui-in-pop"
          style={{ left: openMenu.left, top: openMenu.top, boxShadow: 'var(--shadow-pop)', '--pop-origin': 'top right', zIndex: 'var(--z-popover)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          data-invoice-menu
        >
          {(() => {
            const inv = invoices.find((i) => i.id === openMenu.id);
            if (!inv) return null;

            const derived = getDerivedStatus(inv);
            const recordDisabled = derived === 'Paid' || derived === 'Draft' || derived === 'Cancelled';
            const raiseCreditDisabled = derived === 'Draft' || derived === 'Cancelled';
            const canRemind = isEnabled('paymentReminders') && balanceOf(inv) > 0.004 && !['Paid', 'Draft', 'Cancelled'].includes(derived);

            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openEditInvoice(inv);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <span className="ui-muted">Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openPrintAndDownload(inv);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Printer size={16} className="ui-muted" />
                  <span>Print & Download</span>
                </button>

                {/*
                  No Change Status here.

                  An invoice's status is what has happened to it — whether it
                  was finalised, what has been received against it, what has
                  been returned. Letting somebody set the word directly meant
                  the label could be made to disagree with the payments and the
                  credit notes underneath it, and the label is what people
                  read. Record the event instead; the status follows.
                */}

                {isEnabled('recurringInvoices')
                  ? (() => {
                      const existing = (db.recurringTemplates || []).find(
                        (t) => t.companyId === currentCompany.id && t.sourceInvoiceId === inv.id && t.active !== false
                      );
                      return (
                        <button
                          type="button"
                          className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                          onClick={() => {
                            setOpenMenu(null);
                            if (existing) {
                              setDb((prev) => ({
                                ...prev,
                                recurringTemplates: (prev.recurringTemplates || []).map((t) =>
                                  t.id === existing.id ? { ...t, active: false } : t
                                ),
                              }));
                              notify.success(`${inv.number} will no longer repeat.`);
                              return;
                            }
                            const base = String(inv.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
                            const [y, m, d] = base.split('-').map(Number);
                            const nxt = new Date(Date.UTC(y, m, 1));
                            const last = new Date(Date.UTC(nxt.getUTCFullYear(), nxt.getUTCMonth() + 1, 0)).getUTCDate();
                            nxt.setUTCDate(Math.min(d, last));
                            setDb((prev) => ({
                              ...prev,
                              recurringTemplates: [
                                ...(prev.recurringTemplates || []),
                                {
                                  id: Date.now(),
                                  companyId: currentCompany.id,
                                  sourceInvoiceId: inv.id,
                                  sourceInvoiceNumber: inv.number,
                                  customerId: inv.customerId,
                                  customerName: inv.customerName,
                                  items: inv.items || [],
                                  subtotal: inv.subtotal,
                                  cgstTotal: inv.cgstTotal,
                                  sgstTotal: inv.sgstTotal,
                                  igstTotal: inv.igstTotal,
                                  gstTotal: inv.gstTotal,
                                  total: inv.total,
                                  frequency: 'monthly',
                                  nextRunDate: nxt.toISOString().slice(0, 10),
                                  active: true,
                                  createdAt: new Date().toISOString(),
                                },
                              ],
                            }));
                            notify.success(`${inv.number} will repeat monthly as a draft.`);
                          }}
                        >
                          <RefreshCw size={16} className="ui-muted" />
                          <span>{existing ? 'Stop repeating' : 'Repeat monthly'}</span>
                        </button>
                      );
                    })()
                  : null}

                {isEnabled('einvoice') ? (
                  <>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                      onClick={() => {
                        setOpenMenu(null);
                        const customer = (db.customers || []).find((c) => c.id === inv.customerId) || {};
                        openModal(
                          <EInvoiceWorkflow
                            invoice={inv}
      company={currentCompany}
                            customer={customer}
                            onClose={() => openModal(null)}
                            onRegistered={(d) =>
                              setDb((prev) => ({
                                ...prev,
                                invoices: (prev.invoices || []).map((x) =>
                                  x.id === inv.id
                                    ? { ...x, irn: d.irn, irnStatus: d.status, irnAckNo: d.ackNo, irnAckDate: d.ackDate, irnSignedQr: d.signedQr }
                                    : x
                                ),
                              }))
                            }
                            onCancelled={(d) =>
                              setDb((prev) => ({
                                ...prev,
                                invoices: (prev.invoices || []).map((x) =>
                                  x.id === inv.id ? { ...x, irnStatus: 'CANCELLED', irnCancelReason: d.cancelReason } : x
                                ),
                              }))
                            }
                          />,
                          { title: `e-Invoice — ${inv.number}`, maxWidthClass: 'max-w-3xl' }
                        );
                      }}
                    >
                      <FileText size={16} className="ui-muted" />
                      <span>
                        {inv.irnStatus === 'CANCELLED'
                          ? 'e-Invoice (IRN cancelled)'
                          : inv.irn
                            ? `e-Invoice · IRN ${String(inv.irn).slice(0, 10)}…`
                            : 'e-Invoice (get IRN)'}
                      </span>
                    </button>
                    {inv.irn && !inv.ewbNo ? (
                      <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                        onClick={() => {
                          setOpenMenu(null);
                          openModal(
                            <EwbTransportForm
                              onCancel={() => openModal(null)}
                              onSubmit={async (t) => {
                                try {
                                  const result = await generateEwaybillApi(inv.backendInvoiceId, {
                                    distance: Number(t.distanceKm) || 0,
                                    transporterId: t.transporterId || null,
                                    transporterName: t.transporterName || null,
                                    transMode: t.mode || '1',
                                    vehicleNo: t.vehicleNo || null,
                                    transDocNo: t.transDocNo || null,
                                    transDocDate: t.transDocDate
                                      ? t.transDocDate.split('-').reverse().join('/')
                                      : null,
                                  });
                                  setDb((prev) => ({
                                    ...prev,
                                    invoices: (prev.invoices || []).map((x) =>
                                      x.id === inv.id
                                        ? { ...x, ewbNo: result.ewbNo, ewbDate: result.ewbDate, ewbValidTill: result.ewbValidTill, ewbTransport: t }
                                        : x
                                    ),
                                  }));
                                  openModal(null);
                                  notify.success(`e-Way Bill generated — EWB No: ${result.ewbNo}, valid until: ${result.ewbValidTill || '—'}`);
                                } catch (err) {
                                  notify.error(String(err?.message || 'e-Way Bill generation failed.'));
                                }
                              }}
                            />,
                            { title: `e-Way Bill — ${inv.number}`, maxWidthClass: 'max-w-2xl' }
                          );
                        }}
                      >
                        <FileText size={16} className="ui-muted" />
                        <span>Generate e-Way Bill (from IRN)</span>
                      </button>
                    ) : null}
                    {inv.ewbNo ? (
                      <div className="px-4 py-2 text-left text-xs ui-muted">
                        EWB No: {inv.ewbNo}
                        {inv.ewbValidTill ? ` · valid until ${inv.ewbValidTill}` : ''}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                      onClick={() => {
                        setOpenMenu(null);
                        if (!String(currentCompany?.gstin || '').trim()) {
                          notify.error('Set the company GSTIN in Company Profile before generating e-invoice JSON.');
                          return;
                        }
                        const customer = (db.customers || []).find((c) => c.id === inv.customerId) || {};
                        downloadJson(
                          `EINV_${inv.number}.json`,
                          buildEInvoicePayload({ invoice: inv, company: currentCompany, customer })
                        );
                        notify.success(`e-Invoice JSON for ${inv.number} downloaded — upload via the NIC bulk tool.`);
                      }}
                    >
                      <FileText size={16} className="ui-muted" />
                      <span>e-Invoice JSON</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                      onClick={() => {
                        setOpenMenu(null);
                        if (!String(currentCompany?.gstin || '').trim()) {
                          notify.error('Set the company GSTIN in Company Profile before generating e-way bill JSON.');
                          return;
                        }
                        const customer = (db.customers || []).find((c) => c.id === inv.customerId) || {};
                        openModal(
                          <EwbTransportForm
                            submitLabel="Download EWB JSON"
                            onCancel={() => openModal(null)}
                            onSubmit={(t) => {
                              downloadJson(
                                `EWB_${inv.number}.json`,
                                buildEwayBillPayload({ invoice: inv, company: currentCompany, customer, transport: t })
                              );
                              openModal(null);
                              notify.success(`e-Way Bill JSON for ${inv.number} downloaded — upload via the e-way bill bulk tool.`);
                            }}
                          />,
                          { title: `e-Way Bill JSON — ${inv.number}`, maxWidthClass: 'max-w-2xl' }
                        );
                      }}
                    >
                      <FileText size={16} className="ui-muted" />
                      <span>e-Way Bill JSON</span>
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openRecordReceipt(inv);
                  }}
                  disabled={recordDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ recordDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <CreditCard size={16} className={recordDisabled ? 'ui-subtle' : 'ui-muted'} />
                  <span>Record Receipt</span>
                </button>

                {canRemind ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      openPaymentReminder(inv);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                  >
                    <Bell size={16} className="ui-muted" />
                    <span>Payment Reminder</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    if (!raiseCreditDisabled) raiseCreditNote(inv);
                  }}
                  disabled={raiseCreditDisabled}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ raiseCreditDisabled ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <Plus size={16} className={raiseCreditDisabled ? 'ui-subtle' : 'ui-muted'} />
                  <span>Raise Credit Note</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    duplicateInvoice(inv);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Copy size={16} className="ui-muted" />
                  <span>Duplicate</span>
                </button>

                <div className="border-t ui-border-c" />

                {String(inv?.status || '') === 'Cancelled' ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      cancelInvoice(inv);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                  >
                    <Ban size={16} className="text-[rgb(var(--neg))]" />
                    <span>Cancel</span>
                  </button>
                )}

                {/*
                  Delete is offered on a draft and nowhere else. An issued
                  invoice holds a number a GST return has seen, so the server
                  refuses to delete one; showing the option anyway would just
                  walk the user into a confirmation and then an error. Cancel is
                  the action for an issued document, and it is directly above.
                */}
                {String(inv?.status || '') === 'Draft' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      deleteInvoice(inv);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                  >
                    <Trash2 size={16} className="text-[rgb(var(--neg))]" />
                    <span>Delete</span>
                  </button>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
};

export const EstimatesList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  onNavigate,
  onNewEstimate,
  onEditEstimate,
  onConvertToInvoice,
  warehouses = [],
  /* Handed on to a document form opened from this list, so it can ask which
     branch the document belongs to. */
  branches = [],
  defaultWarehouseId = '',
}) => {
  const [openMenu, setOpenMenu] = useState(null);
  const [previewEstimate, setPreviewEstimate] = useState(null);
  const menuRef = useRef(null);

  const warehouseById = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const estFilters = useColumnFilters();
  const estPeriod = usePeriodFilter();
  const estSearch = useListSearch(
    db.estimates.filter((e) => e.companyId === currentCompany.id),
    ['number', 'customerName', 'refNo', 'date'],
    'estimates'
  );

  // What is hiding rows right now, in the user's words. Without this an empty
  // list says "none yet" to someone who has simply filtered them all away.
  const estFilterChips = useMemo(() => {
    const chips = [];
    if (String(estSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(estSearch.query).trim(), onRemove: () => estSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(estFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => estFilters.clearColumn(key) });
    }
    return chips;
  }, [estSearch, estFilters]);
  /*
   * What a quotation is, right now.
   *
   * The stored status stops at what somebody last typed, so a quote whose
   * expiry has passed still read as Sent — and a list of quotes exists to show
   * which are live and which have lapsed. Converted wins over everything: once
   * it is an invoice, nothing about the quote is open any more.
   */
  const [estStatus, setEstStatus] = useState('');
  const estStatusOf = (e) => {
    const converted = e?.convertedInvoiceId !== undefined && e?.convertedInvoiceId !== null && e?.convertedInvoiceId !== '';
    if (converted || String(e?.status || '') === 'Converted') return 'Converted';
    const stored = String(e?.status || 'Draft');
    if (stored === 'Cancelled' || stored === 'Expired') return stored;
    const expiry = String(e?.dueDate || e?.expiryDate || '').slice(0, 10);
    if (expiry && expiry < todayIso() && stored !== 'Draft') return 'Expired';
    return stored;
  };

  const EST_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Sent', label: 'Sent', tone: 'sent' },
    { value: 'Accepted', label: 'Accepted', tone: 'outstanding' },
    { value: 'Converted', label: 'Converted', tone: 'paid' },
    { value: 'Expired', label: 'Expired', tone: 'cancelled' },
  ];

  const estimatesAll = estFilters.applyFilters(
    estSearch.filtered
      .filter((r) => estPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      customer: (r) => r.customerName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || r?.warehouseId || '',
      date: (r) => r.date,
      due: (r) => r.dueDate || r.expiryDate,
      total: (r) => r.total,
    }
  );

  const estimates = estStatus ? estimatesAll.filter((e) => estStatusOf(e) === estStatus) : estimatesAll;

  /*
   * Four figures, each answering a different question about the same book: how
   * many quotes there are, what they add up to, how much of that is still live,
   * and how much has already turned into invoices. A quote that expired is out
   * of the open figure — it is not money anybody is waiting on.
   */
  const estHeadline = useMemo(() => {
    let value = 0;
    let open = 0;
    let converted = 0;
    let expired = 0;
    for (const e of estimatesAll) {
      const amt = Number(e.total || 0);
      const st = estStatusOf(e);
      value += amt;
      if (st === 'Converted') converted += amt;
      else if (st === 'Expired' || st === 'Cancelled') expired += amt;
      else open += amt;
    }
    return { count: estimatesAll.length, value, open, converted, expired };
  }, [estimatesAll]);

  const MENU_WIDTH = 224; // w-56
  const MENU_HEIGHT_ESTIMATE = 240;

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-estimate-menu-button]');
      if (btn && String(btn.getAttribute('data-estimate-menu-button')) === String(openMenu.id)) return;
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

  const openNewEstimate = () => {
    if (typeof onNewEstimate === 'function') {
      onNewEstimate();
      return;
    }
    openModal(
      <EstimateForm db={db} setDb={setDb} currentCompany={currentCompany} onClose={() => openModal(null)} />,
      { title: 'New Quotation', maxWidthClass: 'max-w-5xl' }
    );
  };

  const openEditEstimate = (estimate) => {
    if (typeof onEditEstimate === 'function') {
      onEditEstimate(estimate);
      return;
    }
    openModal(
      <EstimateForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={estimate}
        onClose={() => openModal(null)}
      />,
      { title: 'Edit Quotation', maxWidthClass: 'max-w-5xl' }
    );
  };

  const duplicateEstimate = (estimate) => {
    const copyEstimate = {
      ...estimate,
      id: undefined,
      number: '',
      date: undefined,
      dueDate: undefined,
      status: 'Draft',
      createdAt: undefined,
      updatedAt: undefined,
      convertedInvoiceId: null,
      convertedAt: undefined,
    };

    if (Array.isArray(copyEstimate.items)) {
      copyEstimate.items = copyEstimate.items.map((l) => ({
        itemId: l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '',
        description: l?.description ?? '',
        quantity: Number(l?.quantity ?? 1),
        rate: Number(l?.rate ?? 0),
        gstRate: Number(l?.gstRate ?? 0),
        hsnSac: l?.hsnSac || '',
        amount: Number(l?.amount ?? 0),
      }));
    }

    openEditEstimate(copyEstimate);
  };

  const convertToInvoice = (estimate) => {
    if (typeof onConvertToInvoice === 'function') {
      onConvertToInvoice(estimate);
      return;
    }

    const initialInvoice = {
      status: 'Draft',
      date: estimate?.date || undefined,
      dueDate: estimate?.dueDate || undefined,
      customerId: estimate?.customerId || '',
      refNo: estimate?.number || '',
      refDate: estimate?.date || '',
      sourceEstimateId: estimate?.id ?? null,
      items: Array.isArray(estimate?.items)
        ? estimate.items.map((l) => ({
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

    openModal(
      <InvoiceForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={initialInvoice}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: `New Invoice from ${estimate?.number || 'Quotation'}`.trim(), maxWidthClass: 'max-w-7xl' }
    );
  };

  const deleteEstimate = async (estimate) => {
    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete estimate ${estimate?.number || ''}? This cannot be undone.`.trim(), confirmLabel: 'Yes, continue' });
    if (!ok) return;
    setDb((prev) => ({
      ...prev,
      estimates: (prev.estimates || []).filter((e) => e.id !== estimate.id),
    }));
  };

  const openEstimateMenu = (estimateId, anchorEl) => {
    if (!anchorEl) {
      setOpenMenu({ id: estimateId, left: 0, top: 0 });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const padding = 12;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    let left = rect.right - MENU_WIDTH;
    left = Math.max(padding, Math.min(left, vw - MENU_WIDTH - padding));

    let top = rect.bottom + 8;
    if (top + MENU_HEIGHT_ESTIMATE > vh - padding) {
      top = rect.top - MENU_HEIGHT_ESTIMATE - 8;
    }
    top = Math.max(padding, Math.min(top, vh - padding - 40));

    setOpenMenu({ id: estimateId, left, top });
  };

  const estExportColumns = [
    { key: 'number', label: 'Quotation #' },
    { key: 'customerName', label: 'Customer' },
    { key: 'date', label: 'Date' },
    { key: 'dueDate', label: 'Valid till' },
    { key: 'subtotal', label: 'Taxable', value: (r) => Number(r.subtotal || 0) },
    { key: 'gstTotal', label: 'GST', value: (r) => Number(r.gstTotal || 0) },
    { key: 'total', label: 'Total', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => estStatusOf(r) },
  ];

  return (
    <DocumentListShell
      entity="quotation"
      className="sales-list-page"
      title="Quotations"
      company={currentCompany}
      search={{
        before: <select value={estStatus} onChange={(event) => setEstStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Quotation status">{EST_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: estSearch.query,
        onChange: estSearch.setQuery,
        placeholder: 'Search quotations…',
        label: 'Search quotations',
      }}
      moreItems={[
        exportMenuItem('Export quotations'),
        { sep: true },
        { key: 'settingsCustomFields', label: 'Custom fields', Icon: Plus, group: 'Configure — every quotation' },
        { key: 'invoiceTemplates', label: 'Document template', Icon: Settings2 },
      ]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) {
          runListExport({
            format,
            title: 'Quotations',
            fileName: `Quotations_${currentCompany?.name || 'company'}`,
            label: 'quotation(s)',
            columns: estExportColumns,
            rows: estimates,
          });
          return;
        }
        if (typeof onNavigate === 'function') onNavigate(k);
      }}
      primary={
        <PermissionButton
          permission="SALES::Estimates::CREATE"
          onClick={openNewEstimate}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} aria-hidden="true" /> New Quotation
        </PermissionButton>
      }
      cards={[
        { label: 'Quotations', value: estHeadline.count, count: true, tone: 'draft', Icon: ClipboardList },
        { label: 'Quoted', value: estHeadline.value, tone: 'sent', Icon: FileText },
        { label: 'Open value', value: estHeadline.open, tone: 'outstanding', Icon: Tag },
        { label: 'Converted value', value: estHeadline.converted, tone: 'paid', Icon: Receipt },
        { label: 'Expired value', value: estHeadline.expired, tone: 'cancelled', Icon: Ban },
      ]}
      denseCards
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>

            <tr>
              <ColumnHeader label="Quotation #" col="number" state={estFilters} />
              <ColumnHeader label="Customer" col="customer" state={estFilters} />
              <ColumnHeader label="Date" col="date" state={estFilters} align="center" />
              {/* A quotation's "due" is the day the price stops standing, which
                  is what the customer is being asked to beat. */}
              <ColumnHeader label="Valid till" col="due" state={estFilters} align="center" />
              <ColumnHeader label="Amount" col="total" state={estFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={estFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={estFilters} />
              <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {estimates.length === 0 ? null : (
              estimates.map((est) => {
                const whId = String(est?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                return (
                <tr
                  key={est.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    const el = e.target;
                    if (el?.closest?.('[data-estimate-menu-button]')) return;
                    if (el?.closest?.('[data-estimate-menu]')) return;
                    openEditEstimate(est);
                  }}
                >
                  <td className="ui-col-id"><InvoiceIdentifier value={est.number} label="quotation" /></td>
                  <td className="ui-col-entity">{est.customerName || '-'}</td>
                  <td className="ui-col-date"><DateCell value={est.date} /></td>
                  {/* A quotation's "due" is its expiry: still open, so it is a
                      live commitment and reads as one. */}
                  <td className="ui-col-date">
                    <DueDateCell value={est.dueDate} balance={est.total || 0} />
                  </td>
                  <td className="ui-col-amount"><Money value={est.total} company={currentCompany} /></td>
                  {/*
                    An estimate that has already become an invoice looked
                    exactly like one still waiting on the customer. The only
                    place that fact appeared was a greyed-out menu item you had
                    to open the row menu to find, so a list of quotes could not
                    be read at a glance — which is the whole job of a list.
                  */}
                  <td className="whitespace-nowrap">
                    <StatusPill status={estStatusOf(est)} />
                  </td>
                  <td className="ui-col-meta">{whLabel}</td>
                  <td
                    className="ui-action-col relative"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openMenu?.id === est.id) {
                          setOpenMenu(null);
                        } else {
                          openEstimateMenu(est.id, e.currentTarget);
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md ui-hover-sunken"
                      aria-label="Quotation actions"
                      data-estimate-menu-button={est.id}
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

        {/* Centred on the view rather than on a table wider than it. */}
        {estimates.length === 0 ? (
          <div className="ui-empty-pane p-2">
            {estFilterChips.length === 0 && !estStatus ? (
                    <EmptyState
                      icon={ClipboardList}
                      kind="new"
      title="No quotations yet"
                      description="A quotation is a price you are standing behind until it expires — and an invoice waiting for a yes."
                      routes={[
                        {
                          label: 'Quote one now',
                          description: 'Pick a customer, add lines, set how long the price holds.',
                          onSelect: () => openNewEstimate(),
                        },
                        {
                          label: 'Start from an invoice',
                          description: 'Quote what you have already billed this customer before.',
                          onSelect: () => openNewEstimate(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      kind="filtered"
                      totalCount={(db.estimates || []).filter((e) => e.companyId === currentCompany.id).length}
                      filters={estFilterChips}
                      onClearFilters={() => {
                        estSearch.setQuery('');
                        estFilters.clearAll();
                      }}
                    />
                  )}
          </div>
        ) : null}
      </div>
      <TableTotals
        count={estimates.length}
        totalCount={(db.estimates || []).filter((e) => e.companyId === currentCompany.id).length}
        noun="quotations"
        figures={[{ label: 'Value', value: formatMoney(estimates.reduce((t, e) => t + Number(e.total || 0), 0), currentCompany) }]}
      />

      {previewEstimate ? (
        <Modal
          title={`Quotation ${previewEstimate.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewEstimate(null)}
        >
          <PrintDownloadFrame
      title={`Quotation ${previewEstimate.number || ''}`.trim()}
            fileBase={previewEstimate.number || 'quotation'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="QUOTATION"
              doc={previewEstimate}
              party={(db.customers || []).find((c) => String(c.id) === String(previewEstimate.customerId)) || null}
              partyLabel="Quotation For"
              metaRows={[{ label: 'Valid until', value: previewEstimate.dueDate }]}
              sideRows={[{ label: 'GSTIN', value: previewEstimate.customerGstin }]}
              footNote="This is a quotation, not a tax invoice. Prices hold until the date shown and are subject to the terms agreed."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}

      {openMenu?.id ? (
        <div
          ref={menuRef}
          className="fixed w-56 ui-card overflow-hidden ui-in-pop"
          style={{ left: openMenu.left, top: openMenu.top, boxShadow: 'var(--shadow-pop)', '--pop-origin': 'top right', zIndex: 'var(--z-popover)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          data-estimate-menu
        >
          {(() => {
            const est = estimates.find((e) => e.id === openMenu.id);
            if (!est) return null;

            const isConverted =
              String(est?.status || '').trim().toLowerCase() === 'converted' ||
              (est?.convertedInvoiceId !== undefined && est?.convertedInvoiceId !== null && est?.convertedInvoiceId !== '');

            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openEditEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <span className="ui-muted">Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    setPreviewEstimate(est);
                  }}
                  aria-label={`Print quotation ${est.number}`}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Printer size={16} className="ui-muted" />
                  <span>Print</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    duplicateEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Copy size={16} className="ui-muted" />
                  <span>Duplicate</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    if (!isConverted) convertToInvoice(est);
                  }}
                  disabled={isConverted}
                  // A disabled control that will not say why is a dead end.
                  // This one is correct to disable — converting twice would
                  // invoice the same quote again — but it was silent about it.
      title={isConverted ? 'Already converted to an invoice. Duplicate it if you need to quote this again.' : undefined}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ isConverted ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <FileText size={16} className={isConverted ? 'ui-subtle' : 'ui-muted'} />
                  <span>{isConverted ? 'Converted to invoice' : 'Convert to Invoice'}</span>
                </button>

                <div className="border-t ui-border-c" />

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    deleteEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                >
                  <Trash2 size={16} className="text-[rgb(var(--neg))]" />
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

export const CreditNotesList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  onNewCreditNote,
  warehouses = [],
  /* Handed on to a credit note opened from this list, so it can ask which
     branch the note belongs to. */
  branches = [],
  defaultWarehouseId = '',
  onNavigate = null,
}) => {
  const { isEnabled: featureIsEnabled } = useFeatures();
  const importsOn = featureIsEnabled('imports');
  const warehouseById = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const [previewCreditNote, setPreviewCreditNote] = useState(null);

  /** Settle an on-account credit note against the customer's open invoices. */
  const openKnockOff = (note) => {
    if (typeof openModal !== 'function') return;
    openModal(
      <KnockOffForm
        note={note}
        documents={db.invoices || []}
        notes={db.creditNotes || []}
        currentCompany={currentCompany}
        partyKey="customerId"
        docLabel="invoice"
        onCancel={() => openModal(null)}
        onConfirm={async (allocations) => {
          const today = new Date().toISOString().slice(0, 10);
          const stamped = allocations.map((a) => ({ ...a, date: today }));
          const next = [...(note.allocations || []), ...stamped];

          if (note.backendDocId && hasDocsApiSession()) {
            try {
              await saveSettlementApi('creditNote', note.backendDocId, {
                settlementMode: 'ON_ACCOUNT',
                invoiceIds: (note.invoiceIds || []).map(String),
                allocations: next,
              });
            } catch (err) {
              notify.error(String(err?.message || 'Settlement not saved to the server.'));
              return;
            }
          }

          setDb((prev) => ({
            ...prev,
            creditNotes: (prev.creditNotes || []).map((x) =>
              String(x.id) === String(note.id) ? { ...x, allocations: next } : x
            ),
          }));
          openModal(null);
          const total = allocations.reduce((t, a) => t + Number(a.amount || 0), 0);
          notify.success(`${formatMoney(total, currentCompany)} knocked off against ${allocations.length} invoice(s).`);
        }}
      />,
      { title: `Knock off ${note?.number || ''}`.trim(), maxWidthClass: 'max-w-3xl' }
    );
  };

  const cnFilters = useColumnFilters();
  const cnPeriod = usePeriodFilter();
  const cnSearch = useListSearch(
    db.creditNotes.filter((c) => c.companyId === currentCompany.id),
    ['number', 'customerName', 'originalInvoiceNumber', 'date'],
    'creditNotes'
  );

  // What is hiding rows right now, in the user's words. Without this an empty
  // list says "none yet" to someone who has simply filtered them all away.
  const cnFilterChips = useMemo(() => {
    const chips = [];
    if (String(cnSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(cnSearch.query).trim(), onRemove: () => cnSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(cnFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => cnFilters.clearColumn(key) });
    }
    return chips;
  }, [cnSearch, cnFilters]);
  const creditNotesAll = cnFilters.applyFilters(
    cnSearch.filtered
      .filter((r) => cnPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      original: (r) => r.originalInvoiceNumber,
      customer: (r) => r.customerName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || r?.warehouseId || '',
      date: (r) => r.date,
      total: (r) => r.total,
    }
  );

  /*
   * A credit note is money owed back. The list is read for two things: how much
   * has been credited, and how much of it is sitting on account — issued
   * against no particular invoice and not yet knocked off anything, which is a
   * customer balance nobody has finished dealing with.
   */
  const [cnStatus, setCnStatus] = useState('');
  const cnStatusOf = (cn) => {
    const st = String(cn?.status || 'Open');
    if (st === 'Draft' || st === 'Cancelled') return st;
    if (isOnAccount(cn)) return noteBalance(cn).unsettled > 0.0001 ? 'On account' : 'Settled';
    return st;
  };
  const CN_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Open', label: 'Issued', tone: 'sent' },
    { value: 'On account', label: 'On account', tone: 'outstanding' },
    { value: 'Settled', label: 'Settled', tone: 'paid' },
  ];
  const creditNotes = cnStatus ? creditNotesAll.filter((c) => cnStatusOf(c) === cnStatus) : creditNotesAll;

  const cnHeadline = useMemo(() => {
    let value = 0;
    let onAccount = 0;
    let drafted = 0;
    let againstInvoice = 0;
    for (const c of creditNotesAll) {
      const amt = Number(c.total || 0);
      value += amt;
      if (cnStatusOf(c) === 'Draft') drafted += amt;
      else if (isOnAccount(c)) onAccount += noteBalance(c).unsettled;
      else againstInvoice += amt;
    }
    return { count: creditNotesAll.length, value, onAccount, drafted, againstInvoice };
  }, [creditNotesAll]);

  const cnExportColumns = [
    { key: 'number', label: 'Credit #' },
    { key: 'originalInvoiceNumber', label: 'Original invoice' },
    { key: 'customerName', label: 'Customer' },
    { key: 'date', label: 'Date' },
    { key: 'total', label: 'Total', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => cnStatusOf(r) },
  ];

  const openNewCreditNote = () => {
    if (typeof onNewCreditNote === 'function') {
      onNewCreditNote();
      return;
    }
    openModal(
      <CreditNoteForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: 'New Credit Note', maxWidthClass: 'max-w-5xl' }
    );
  };

  return (
    <DocumentListShell
      entity="salesReturn"
      className="sales-list-page"
      title="Sales Returns"
      company={currentCompany}
      search={{
        before: <select value={cnStatus} onChange={(event) => setCnStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Credit note status">{CN_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: cnSearch.query,
        onChange: cnSearch.setQuery,
        placeholder: 'Search credit notes…',
        label: 'Search credit notes',
      }}
      moreItems={[
        exportMenuItem('Export credit notes'),
        ...(onNavigate && importsOn ? [{ key: 'dataImport', label: 'Import credit notes', Icon: Upload }] : []),
      ]}
      onMoreSelect={(k) => {
        if (k === 'dataImport') {
          onNavigate?.('dataImport', 'CREDIT_NOTE');
          return;
        }
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Credit notes',
          fileName: `CreditNotes_${currentCompany?.name || 'company'}`,
          label: 'credit note(s)',
          columns: cnExportColumns,
          rows: creditNotes,
        });
      }}
      primary={
        <PermissionButton
          permission="SALES::Credit Notes::CREATE"
          onClick={openNewCreditNote}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} aria-hidden="true" /> New Credit Note
        </PermissionButton>
      }
      cards={[
        { label: 'Credit notes', value: cnHeadline.count, count: true, tone: 'draft', Icon: Receipt },
        { label: 'Credited', value: cnHeadline.value, tone: 'refund', Icon: FileText },
        { label: 'Against invoices', value: cnHeadline.againstInvoice, tone: 'paid', Icon: CreditCard },
        { label: 'On account, unused', value: cnHeadline.onAccount, tone: 'outstanding', Icon: ClipboardList },
        { label: 'Still in draft', value: cnHeadline.drafted, tone: 'cancelled', Icon: Ban },
      ]}
      denseCards
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              <ColumnHeader label="Credit #" col="number" state={cnFilters} />
              <ColumnHeader label="Original invoice" col="original" state={cnFilters} />
              <ColumnHeader label="Customer" col="customer" state={cnFilters} />
              <ColumnHeader label="Date" col="date" state={cnFilters} align="center" />
              <ColumnHeader label="Amount" col="total" state={cnFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={cnFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={cnFilters} />
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {creditNotes.length === 0 ? (
              <tr>
                <td colSpan="8">
                  {cnFilterChips.length === 0 && !cnStatus ? (
                    <EmptyState
                      icon={Receipt}
                      kind="new"
      title="No sales returns yet"
                      description="A credit note is what you owe a customer back — goods returned, an overcharge, a discount agreed after the invoice."
                      routes={[
                        {
                          label: 'Credit an invoice',
                          description: 'Pick the invoice, choose the lines coming back.',
                          onSelect: () => openNewCreditNote(),
                        },
                        {
                          label: 'Credit on account',
                          description: 'Owe the customer a sum now, knock it off later.',
                          onSelect: () => openNewCreditNote(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={Receipt}
                      kind="filtered"
                      totalCount={(db.creditNotes || []).filter((c) => c.companyId === currentCompany.id).length}
                      filters={cnFilterChips}
                      onClearFilters={() => {
                        cnSearch.setQuery('');
                        cnFilters.clearAll();
                      }}
                    />
                  )}
                </td>
              </tr>
            ) : (
              creditNotes.map((cn) => {
                const whId = String(cn?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                return (
                  <tr key={cn.id}>
                    <td className="ui-col-id"><InvoiceIdentifier value={cn.number} label="credit note" /></td>
                    <td className="ui-col-meta">
                      {cn.originalInvoiceNumber || (
                        <span className="ui-muted">
                          {(cn.invoiceIds || []).length ? `${(cn.invoiceIds || []).length} invoices · on account` : '-'}
                        </span>
                      )}
                    </td>
                    <td className="ui-col-entity">{cn.customerName || '-'}</td>
                    <td className="ui-col-date"><DateCell value={cn.date} /></td>
                    {/* A credit note is money going back out, so it takes the
                        refund colour rather than reading as revenue. */}
                    <td className="ui-col-amount">
                      <MoneyValue value={cn.total} company={currentCompany} kind="refund" />
                    </td>
                    {/*
                      Whether this credit has actually reached the books. A
                      draft does not post, and without this column there was
                      nothing on screen to say so.
                    */}
                    <td className="whitespace-nowrap">
                      <StatusPill status={cnStatusOf(cn)} />
                    </td>
                    <td className="ui-col-meta">{whLabel}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setPreviewCreditNote(cn)}
                        aria-label={`Print credit note ${cn.number}`}
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs mr-2"
                      >
                        <Printer size={14} aria-hidden="true" /> Print
                      </button>
                      {isOnAccount(cn) ? (
                        noteBalance(cn).unsettled > 0.0001 ? (
                          <button
                            type="button"
                            onClick={() => openKnockOff(cn)}
                            className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
      title="Knock this off against the customer's open invoices"
                          >
                            Knock off {formatMoney(noteBalance(cn).unsettled, currentCompany)}
                          </button>
                        ) : (
                          <span className="ui-caption">Settled</span>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <TableTotals
        count={creditNotes.length}
        totalCount={(db.creditNotes || []).filter((c) => c.companyId === currentCompany.id).length}
        noun="credit notes"
        figures={[
          { label: 'Value', value: formatMoney(creditNotes.reduce((t, c) => t + Number(c.total || 0), 0), currentCompany) },
        ]}
      />

      {previewCreditNote ? (
        <Modal
          title={`Credit Note ${previewCreditNote.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewCreditNote(null)}
        >
          <PrintDownloadFrame
      title={`Credit Note ${previewCreditNote.number || ''}`.trim()}
            fileBase={previewCreditNote.number || 'credit-note'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="CREDIT NOTE"
              doc={previewCreditNote}
              party={(db.customers || []).find((c) => String(c.id) === String(previewCreditNote.customerId)) || null}
              partyLabel="Customer"
              metaRows={[
                { label: 'Against invoice', value: previewCreditNote.originalInvoiceNumber },
                { label: 'Invoice date', value: previewCreditNote.originalInvoiceDate },
              ]}
              sideRows={[
                { label: 'GSTIN', value: previewCreditNote.customerGstin },
                { label: 'Reason', value: previewCreditNote.reasonLabel },
              ]}
              footNote="Credit note under section 34 of the CGST Act. The tax charged on the original invoice is reduced by the amount shown above."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
};

/**
 * Invoice numbering, over the invoice.
 *
 * Changing a series is a different act from raising a document, and the full
 * numbering screen governs nine document types across every branch. Somebody
 * halfway through an invoice wants one of them: this one. So the series in
 * force here is editable here, and the rest of the screen stays one click away.
 *
 * Writes the same shape the numbering screen writes — branch-scoped when a
 * branch is in play, company-wide otherwise — so the two can never disagree
 * about what the next invoice is called.
 */
export const InvoiceForm = ({ db, setDb, currentCompany, initialData = null, onClose, warehouses = [], defaultWarehouseId = '', branches = [], onOpenInvoiceSettings = null, onDuplicateInvoice = null, screenTitle = '', screenSubtitle = '', onBack = null }) => {
  const isEdit = Boolean(initialData && (initialData.id !== undefined && initialData.id !== null));

  /**
   * Which fields this company's invoice carries — see utils/invoicePrefs.
   *
   * A preference that is off removes the field rather than disabling it. The
   * one exception, applied at the two money fields below, is a value this
   * invoice already carries: hiding a discount that still moves the total
   * would be worse than showing a field the company switched off.
   */
  const invoicePrefs = useMemo(() => getInvoicePrefs(currentCompany), [currentCompany]);
  const prefOn = (key) => isInvoicePrefOn(invoicePrefs, key);
  const customFields = useMemo(() => getVisibleCustomFields(currentCompany), [currentCompany]);

  const [previewOpen, setPreviewOpen] = useState(false);
  /* Which half of the settings drawer a menu entry asked for. */
  const [prefsPane, setPrefsPane] = useState('fields');

  /**
   * Save & New keeps the form open with a fresh invoice instead of closing it.
   *
   * A ref rather than state: the submit handler that reads it runs in the same
   * tick as the click that set it, and a state update would not have landed
   * yet. Reset after every save so an ordinary Save the next time does not
   * inherit it.
   */
  const saveAndNewRef = useRef(false);
  const markSaveAndNew = () => {
    saveAndNewRef.current = true;
  };

  /*
   * Named rather than inline: a ref read inside a prop passed to a component
   * looks like a render-phase read to the hooks lint, because it cannot tell
   * an event handler from any other callback prop.
   */
  const submitAsDraftNow = () => {
    setSubmitAsDraft(true);
    formRef.current?.requestSubmit();
  };

  /**
   * The saved invoice this form is editing, at component scope.
   *
   * The submit handler has its own local `existingInvoice`; the menu needs the
   * same record outside that function to know whether Duplicate and Cancel
   * apply at all.
   */
  const existingInvoiceRecord = isEdit
    ? (db.invoices || []).find((i) => i.id === Number(initialData.id)) || null
    : null;

  /**
   * Three of the four entries in this menu configure every invoice, not this
   * one, so they leave the form rather than opening something inside it. The
   * parent decides how — the form has no business knowing about navigation.
   */
  /**
   * Cancelling is not deleting.
   *
   * A GST invoice number cannot be reused, so cancelling keeps the number and
   * the row and marks it cancelled; deleting would leave a hole in the series
   * that an officer will ask about. Anything already settled against it has to
   * come off first — a cancelled invoice with a receipt attached leaves money
   * allocated to a document that no longer exists.
   */
  const cancelInvoice = async () => {
    const blocked = invoiceChangeBlockReason(db, currentCompany, existingInvoiceRecord, 'cancel');
    if (blocked) {
      notify.error(blocked);
      return;
    }
    const ok = await confirmDialog({
      title: `Cancel invoice ${existingInvoiceRecord?.number || ''}?`.trim(),
      message:
        'The invoice keeps its number and stays in the list, marked cancelled, and its ledger entries are reversed. ' +
        'That is deliberate: a GST number cannot be reused, so the series must not gain a hole.',
      confirmLabel: 'Cancel invoice',
    });
    if (!ok) return;
    /* The server reverses the sale and its GST. This used to change only the
       browser's copy, so the invoice read Cancelled here while the books on
       the server still carried the sale. */
    const backendInvoiceId = String(existingInvoiceRecord?.backendInvoiceId || '').trim();
    const hasSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
    if (hasSession && backendInvoiceId) {
      try {
        await updateInvoiceStatusApi(backendInvoiceId, { status: 'Cancelled' });
      } catch (e) {
        notify.error(String(e?.message || 'Unable to cancel the invoice.'));
        return;
      }
    }
    setDb((prev) => ({
      ...prev,
      invoices: (prev.invoices || []).map((inv) =>
        inv.id === existingInvoiceRecord.id ? { ...inv, status: 'Cancelled', cancelledAt: todayIso() } : inv
      ),
    }));
    notify.success(`Invoice ${existingInvoiceRecord?.number || ''} cancelled. The number stays used.`.trim());
    onClose?.();
  };

  const [prefsOpen, setPrefsOpen] = useState(false);

  /**
   * Preferences opens inside the form rather than navigating to Settings.
   *
   * Navigating meant closing the form, which threw away whatever had been
   * typed — and there was no way back. Somebody switching a field on is in the
   * middle of raising an invoice; that invoice has to survive the detour.
   */
  /*
   * Two menu entries, two panels — not one panel scrolled to a heading.
   *
   * "Custom Field" used to open the whole invoice settings drawer and scroll
   * it down to the custom-field section, so the thing somebody asked for
   * arrived surrounded by forty switches they did not. Each entry now opens
   * what it is named after.
   */
  const openPreferences = (pane = 'fields') => {
    setPreviewOpen(false);
    setPrefsPane(pane === 'custom' ? 'custom' : 'fields');
    setPrefsOpen(true);
  };

  /**
   * Settings screens are screens of their own, so this one does leave — but
   * only after saying so, and never silently on a form with typing in it.
   */
  const goToSettings = async (screen) => {
    if (typeof onOpenInvoiceSettings !== 'function') {
      notify.error('Open Settings to change this.');
      return;
    }
    const typing =
      String(formData.customerId || '') ||
      (formData.items || []).some((l) => l.itemId || Number(l.quantity) > 1 || Number(l.rate) > 0);
    if (typing && !isEdit) {
      const ok = await confirmDialog({
        title: 'Leave this invoice?',
        message: 'That setting lives on a separate screen. Anything typed here is not saved yet and will be lost.',
        confirmLabel: 'Leave and open settings',
      });
      if (!ok) return;
    }
    onOpenInvoiceSettings(screen);
  };

  /**
   * Whether anything has actually been typed into this document.
   *
   * Deliberately narrow: a form that opens with today's date and a generated
   * number is not "dirty", and warning about that would train people to click
   * through the warning that matters.
   */
  const hasUnsavedInput = () =>
    Boolean(
      String(formData.customerId || '').trim() ||
        String(formData.refNo || '').trim() ||
        String(formData.notesText || '').trim() ||
        (formData.items || []).some((l) => l.itemId || Number(l.quantity) > 1 || Number(l.rate) > 0)
    );

  /** Back, but not over the top of work. */
  const requestBack = async () => {
    if (typeof onBack !== 'function') return;
    if (hasUnsavedInput()) {
      const ok = await confirmDialog({
        title: isEdit ? 'Leave without saving?' : 'Discard this invoice?',
        message: 'Nothing here has been saved yet. Leaving now loses it.',
        confirmLabel: isEdit ? 'Leave without saving' : 'Discard it',
      });
      if (!ok) return;
    }
    onBack();
  };


  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  /** One company-defined field. `where` matches the placement it was given. */
  const renderCustomFields = (where) => (
    <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where={where} />
  );

  /**
   * Whether this invoice is still a draft — a new one, or one saved as a draft
   * and reopened. Only a draft can be saved as a draft or finalised; anything
   * already on the customer's account is simply updated.
   */
  const isDraftInvoice = !isEdit || String(initialData?.status || '').trim() === 'Draft';
  const formRef = useRef(null);
  const [submitAsDraft, setSubmitAsDraft] = useState(false);
  const { isEnabled } = useFeatures();
  const multiCurrencyEnabled = isEnabled('multiCurrency');
  const { options: enabledCurrencyOptions, baseCurrency: invoiceBaseCurrency } = useEnabledCurrencies(currentCompany);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };

  // The document's own warehouse, then the one used last, then whatever the
  // header has selected. Editing an existing invoice never picks up a
  // remembered value — that would move stock nobody asked to move.
  const initWarehouseId = String(
    initialData?.warehouseId || getLastSelection('warehouse', currentCompany?.id) || defaultWarehouseId || ''
  ).trim();
  const initBranchId = resolveBranchIdFromWarehouseId(initWarehouseId) || '';
  const invoiceDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initBranchId || null });
  const invoiceNumberingInit = invoiceDocSettingsInit?.numbering?.invoice;
  const isInvoiceAutoInit = String(invoiceNumberingInit?.mode || '').toLowerCase() === 'auto';

  const [formData, setFormData] = useState(() => {
    const defaultDate = todayIso();
    const defaultDueDate = plusDaysIso(30);

    const normalizedItems = Array.isArray(initialData?.items)
      ? initialData.items.map((it) => {
          const quantity = Number(it.quantity ?? 1);
          const rate = Number(it.rate ?? 0);
          const gstRate = Number(it.gstRate ?? 0);
          const amount = Number(it.amount ?? quantity * rate);
          return {
            itemId: it.itemId !== undefined && it.itemId !== null && it.itemId !== '' ? String(it.itemId) : '',
            description: it.description ?? '',
            quantity: Number.isFinite(quantity) ? quantity : 1,
            rate: Number.isFinite(rate) ? rate : 0,
            gstRate: Number.isFinite(gstRate) ? gstRate : 0,
            hsnSac: it.hsnSac || '',
            discountPct: Number(it.discountPct) || 0,
            amount: Number.isFinite(amount) ? amount : 0,
          };
        })
      : null;

    const rawStatus = String(initialData?.status || '').trim();
    const isDraft = rawStatus === 'Draft';

    const initialNumber = initialData?.number
      ? String(initialData.number)
      : isInvoiceAutoInit
        ? String(nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'invoice', branchId: initBranchId || null, takenNumbers: (db.invoices || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || '')
        : '';

    return {
      number: initialNumber,
      date: initialData?.date || defaultDate,
      dueDate: initialData?.dueDate || defaultDueDate,
      status: isDraft ? 'Draft' : 'Unpaid',
      refNo: initialData?.refNo || '',
      refDate: initialData?.refDate || '',
      customerId: initialData?.customerId || '',
      warehouseId: String(initialData?.warehouseId || defaultWarehouseId || '').trim(),
      items:
        normalizedItems && normalizedItems.length
          ? normalizedItems
          : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
      sourceEstimateId: initialData?.sourceEstimateId ?? null,
      sourceChallanId: initialData?.sourceChallanId ?? null,
      sourceSalesOrderId: initialData?.sourceSalesOrderId ?? null,
      invoiceDiscountEnabled: Number(initialData?.invoiceDiscountValue) > 0,
      invoiceDiscountType: initialData?.invoiceDiscountType || 'pct',
      invoiceDiscountValue: Number(initialData?.invoiceDiscountValue) || '',
      otherCharges: Array.isArray(initialData?.otherCharges) ? initialData.otherCharges : [],
      salesmanId: initialData?.salesmanId ?? '',
      costCenterId: initialData?.costCenterId ?? '',
      reverseCharge: !!initialData?.reverseCharge,
      shipToCode: initialData?.shipToCode || '',
      shipToAddress: initialData?.shipToAddress || null,
      shipToAddressId: initialData?.shipToAddressId || '',
      // Values for the fields this company invented. Keyed, not positional, so
      // reordering or renaming a field in settings never rewrites what an
      // existing invoice already says.
      customFields:
        initialData?.customFields && typeof initialData.customFields === 'object' ? { ...initialData.customFields } : {},
      // Fields the preferences can switch on. Each is inert until its
      // preference is on: nothing here changes a total, so an invoice that
      // carries a value for a field the company later switches off simply
      // stops printing it rather than changing what is owed.
      lutNumber: initialData?.lutNumber || '',
      iecNumber: initialData?.iecNumber || '',
      shippingBillNo: initialData?.shippingBillNo || '',
      shippingBillDate: initialData?.shippingBillDate || '',
      portCode: initialData?.portCode || '',
      invoiceCurrency: initialData?.invoiceCurrency || '',
      exchangeRate: initialData?.exchangeRate || '',
      transporterName: initialData?.transporterName || '',
      vehicleNo: initialData?.vehicleNo || '',
      lrNumber: initialData?.lrNumber || '',
      lrDate: initialData?.lrDate || '',
      packageDetails: initialData?.packageDetails || '',
      servicePeriodFrom: initialData?.servicePeriodFrom || '',
      servicePeriodTo: initialData?.servicePeriodTo || '',
      projectName: initialData?.projectName || '',
      workOrderNo: initialData?.workOrderNo || '',
      raBillNo: initialData?.raBillNo || '',
      timesheetRef: initialData?.timesheetRef || '',
      paymentTermDays: initialData?.paymentTermDays ?? '',
      notesText: initialData?.notesText || '',
      // TDS the customer will withhold. Stated on the document so both sides
      // agree the figure before the payment arrives short.
      tdsSection: initialData?.tdsSection || '',
      tdsDeducteeType: initialData?.tdsDeducteeType || 'COMPANY',
      tdsRate: initialData?.tdsRate ?? '',
    };
  });

  /*
   * Branch is asked for rather than inferred.
   *
   * It was previously read back out of whichever warehouse you picked, which
   * works right up to the moment a company runs one warehouse for two branches
   * — and it left the field that decides the number series invisible. Seeded
   * from the document being edited, then from the header selection.
   */
  /*
   * Seeded from the document being edited, then from what was chosen last
   * time, then from the header selection. A shop that raises forty invoices
   * out of one warehouse should be asked once, not forty times.
   */
  const [branchId, setBranchId] = useState(
    () => initBranchId || getLastSelection('branch', currentCompany?.id) || activeBranchId || ''
  );

  /*
   * A remembered branch that no longer exists shows as nothing, not as an id.
   *
   * The seed can come from three places — the document, what was chosen last
   * time, the header — and any of them can name a branch this user has since
   * lost access to, or that was deleted. The field then rendered the raw cuid,
   * because a picker with no matching option falls back to its own value. An
   * empty field reading "All branches" is the honest answer.
   */
  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';

  const numberingBtnRef = useRef(null);
  const [numberingOpen, setNumberingOpen] = useState(false);
  /* Open while a TDS section is being chosen; folded away once one is. */
  const [tdsPickerOpen, setTdsPickerOpen] = useState(false);
  /* §2: the compact TDS control is offered only where the company tracks
     TDS at all — with it off, nothing is asked and nothing is calculated. */
  const tdsEnabledHere = Boolean(currentCompany?.profile?.taxCompliances?.tds?.enabled);

  /*
   * Which line, if any, is waiting on a batch.
   *
   * Batch and expiry used to live in a permanent sub-row under every tracked
   * line, which put a second row of chrome under half the grid and still had
   * to be hunted for. It is a question with one answer per line, so it is
   * asked once, when the item is chosen, and then gets out of the way.
   */
  const [batchPrompt, setBatchPrompt] = useState(null);

  const branchOptions = useMemo(() => {
    const list = Array.isArray(branches) ? branches : [];
    return list.slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
  }, [branches]);

  const branchIdForNumbering = String(branchIdInList || '').trim() || resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const invoiceDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const invoiceNumbering = invoiceDocSettings?.numbering?.invoice;
  const isInvoiceAuto = String(invoiceNumbering?.mode || '').toLowerCase() === 'auto';
  const lockInvoiceNumberOnCreate = !isEdit && isInvoiceAuto && !invoiceNumbering?.allowManualOverride;
  const generatedInvoiceNumber = !isEdit ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'invoice', branchId: branchIdForNumbering, takenNumbers: (db.invoices || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) : '';

  /*
   * Only the warehouses of the chosen branch. Stock leaving a shelf that
   * belongs to another branch is the mis-post this ordering exists to stop.
   * With no branch chosen the list is everything, as before.
   */
  const warehouseOptions = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    const scope = String(branchIdInList || '').trim();
    const inScope = scope ? list.filter((w) => String(w?.branchId || '').trim() === scope) : list;
    return inScope.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses, branchIdInList]);

  const onBranchChange = (nextBranchId) => {
    const next = String(nextBranchId || '').trim();
    setBranchId(next);
    setLastSelection('branch', currentCompany?.id, next);
    // A warehouse left over from the previous branch would silently move the
    // wrong stock, so it is dropped rather than carried across.
    setFormData((p) => {
      const held = String(p.warehouseId || '').trim();
      if (!held || !next) return p;
      const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === held);
      if (w && String(w.branchId || '').trim() === next) return p;
      return { ...p, warehouseId: '' };
    });
  };

  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);

  // The customer on this invoice, and what they already owe. Read here so the
  // summary bar can show it while the invoice is still being written.
  const customer = useMemo(
    () => customers.find((c) => String(c.id) === String(formData?.customerId)) || null,
    [customers, formData?.customerId]
  );
  const fieldErrors = useFieldErrors('invoice');

  const customerOutstanding = useMemo(() => {
    if (!customer) return 0;
    return (db.invoices || [])
      .filter((inv) => inv.companyId === currentCompany.id)
      .filter((inv) => String(inv.customerId) === String(customer.id))
      .filter((inv) => String(inv.status || '').toLowerCase() !== 'cancelled')
      .reduce((t, inv) => t + Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0)), 0);
  }, [customer, db.invoices, currentCompany.id]);

  const items = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const selectedCustomer = formData.customerId
    ? customers.find((c) => String(c.id) === String(formData.customerId))
    : null;
  const shipToOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    const options = [];
    const add = (value, label, address, id = '') => {
      if (!address || ![address.line1, address.line2, address.city, address.district, address.state, address.pincode].some((part) => String(part || '').trim())) return;
      options.push({ value, label, address, id: String(id || value) });
    };
    add('SHIPPING', 'Shipping address', selectedCustomer.shippingAddress, selectedCustomer.shippingAddress?.id || 'SHIPPING');
    (Array.isArray(selectedCustomer.shipToAddresses) ? selectedCustomer.shipToAddresses : []).forEach((address, index) => {
      const id = address.id || address.code || `SHIP-${index + 1}`;
      add(String(id), address.label || address.code || `Ship-to ${index + 2}`, address, id);
    });
    return options;
  }, [selectedCustomer]);
  const addressSummary = (address) =>
    [address?.line1, address?.line2, address?.city, address?.district, address?.state, address?.pincode, address?.country]
      .filter((part) => String(part || '').trim())
      .join(', ');
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });

  // Index of a row that was just added, so focus can land in it. Entry is
  // keyboard-driven: adding a line and then reaching for the mouse defeats it.
  const [focusRowIndex, setFocusRowIndex] = useState(-1);

  const addItem = () => {
    // The focus index is set outside the updater. Setting state from inside
    // one runs during React's render phase, where the second invocation under
    // StrictMode makes it a side effect React is entitled to drop.
    setFocusRowIndex(formData.items.length);
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    }));
  };

  /**
   * What is actually on the shelf, per item, for the warehouse this invoice
   * ships from.
   *
   * The save already refuses to oversell, but only once everything is typed
   * and the button is pressed. Showing the number the moment an item is
   * chosen turns that late refusal into something you can see coming — and a
   * line that already exceeds stock says so where the line is, not in a toast
   * after the fact.
   */
  const availableByItemId = useMemo(() => {
    const whId = String(formData.warehouseId || '').trim();
    try {
      const summary = computeInventorySummaryByItemId({ db, companyId: currentCompany.id, warehouseId: whId });
      const map = new Map();
      for (const [itemId, row] of summary.entries()) map.set(String(itemId), Number(row?.closingQty ?? 0));
      return map;
    } catch {
      return new Map();
    }
    // db is the whole book; the lines that matter are its stock documents.
  }, [db, currentCompany.id, formData.warehouseId]);

  /*
   * The server's count, where it has one: it sees the sale made at the next
   * counter a minute ago, which this browser's documents do not. An item the
   * server does not know (saved on this device only) keeps the local count.
   */
  const serverOnHand = useServerOnHand(
    useMemo(() => (formData.items || []).map((l) => l?.itemId), [formData.items]),
    formData.warehouseId
  );
  const availableFor = (itemId) => {
    const key = String(itemId);
    const master = items.find((i) => String(i.id) === key);
    if (serverOnHand && master?.backendItemId) return serverOnHand.get(key) ?? 0;
    return availableByItemId.get(key) ?? 0;
  };

  /*
   * Which cells the operator has typed into by hand, per line.
   *
   * Choosing an item fills the description, rate, tax and HSN from the master
   * — right the first time, wrong the second, because re-picking the item on
   * a line whose rate was negotiated wipes the negotiated rate. Kept in a ref
   * rather than on the line so it can never be written into the saved
   * document, and reset for a line whenever its item changes, since that is a
   * new line in everything but position.
   */
  const touchedCellsRef = useRef({});

  const markTouched = (index, field) => {
    const map = touchedCellsRef.current;
    map[index] = map[index] || new Set();
    map[index].add(field);
  };

  const isTouched = (index, field) => Boolean(touchedCellsRef.current[index]?.has(field));

  /** Keep the record lined up with the rows after an insert or a delete. */
  const shiftTouched = (from, delta) => {
    const next = {};
    for (const [k, v] of Object.entries(touchedCellsRef.current)) {
      const i = Number(k);
      if (i < from) next[i] = v;
      else if (delta < 0 && i === from) continue;
      else next[i + delta] = v;
    }
    touchedCellsRef.current = next;
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    if (field === 'itemId') delete touchedCellsRef.current[index];
    else markTouched(index, field);
    const newItems = [...formData.items];

    if (field === 'itemId') {
      // Every other field clears its error the moment it is answered; the line
      // grid did not, so "Every line needs an item" sat there after the line
      // had one, and the count beside Save still said a field needed attention.
      fieldErrors.clearField('items');
      const item = pickedItem || items.find((i) => String(i.id) === String(value));
      if (item) {
        // Price list first, then this customer's last paid rate, then master.
        const resolved = resolveSaleRate({
          db,
          companyId: currentCompany.id,
          customer: selectedCustomer,
          itemId: item.id,
          item,
          // The document's own date, so a list that had expired by the time
          // this invoice was raised does not price it.
          onDate: formData.date,
        });
        // Everything the master knows, except whatever this operator has
        // already overruled on this line.
        newItems[index] = {
          ...newItems[index],
          itemId: value,
          ...(isTouched(index, 'description') ? {} : { description: item.name }),
          ...(isTouched(index, 'rate') ? {} : { rate: resolved.rate, rateSource: resolved.source }),
          ...(isTouched(index, 'gstRate') ? {} : { gstRate: Number(item.gstRate ?? 0) }),
          ...(isTouched(index, 'hsnSac') ? {} : { hsnSac: item.hsnSac || '' }),
          ...(isTouched(index, 'unit') || !item.unit ? {} : { unit: item.unit }),
        };
        if (resolved.source !== 'item master') {
          notify.info(`Rate ${resolved.rate} from ${resolved.source}`);
        }
        // Batch-tracked items open the batch prompt, pre-set to the FEFO
        // batch (earliest expiry) so dismissing it still leaves a valid line.
        // Untracked items never see it — asking for a batch on a service is
        // the noise this gating exists to remove.
        if (isTracked(item)) {
          const pick = fefoPick(db, currentCompany.id, item.id, Number(newItems[index].quantity) || 1);
          newItems[index].batchId = pick ? pick.id : '';
          newItems[index].batchNo = pick ? pick.batchNo : '';
          newItems[index].expiryDate = pick ? pick.expiryDate || '' : '';
          setBatchPrompt({ index, itemId: item.id });
        } else {
          newItems[index].batchId = '';
          newItems[index].batchNo = '';
          newItems[index].expiryDate = '';
        }
      }
    } else {
      newItems[index][field] = value;
    }

    // Discount rules: on item pick or quantity change, the best matching rule
    // fills the discount columns. A manual Disc% edit is the operator's call —
    // rules never overwrite that field once touched by hand.
    if (field === 'itemId' || field === 'quantity') {
      const line = newItems[index];
      const item = items.find((i) => String(i.id) === String(line.itemId));
      if (item && !line.discountManual) {
        const ruleHit = resolveDiscountForLine({
          db,
          companyId: currentCompany.id,
          customer: selectedCustomer,
          item,
          qty: Number(line.quantity ?? 1),
          rate: Number(line.rate ?? 0),
          date: formData.date,
        });
        const prevPct = Number(line.discountPct) || 0;
        const prevFixed = Number(line.discountAmount) || 0;
        line.discountPct = ruleHit?.pct || 0;
        line.discountAmount = ruleHit?.fixedPerUnit ? ruleHit.fixedPerUnit * (Number(line.quantity) || 1) : 0;
        line.discountRule = ruleHit?.ruleName || '';
        if (ruleHit && (line.discountPct !== prevPct || line.discountAmount !== prevFixed)) {
          notify.info(
            `${ruleHit.pct ? `${ruleHit.pct}% off` : `₹${ruleHit.fixedPerUnit}/unit off`} — ${ruleHit.ruleName}`
          );
        }
      }
    }
    if (field === 'discountPct') {
      newItems[index].discountManual = true;
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId' || field === 'discountPct') {
      const computed = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        isIntra,
        discountPct: Number(newItems[index].discountPct ?? 0),
        discountAmount: Number(newItems[index].discountAmount ?? 0),
      });
      newItems[index].amount = computed.taxableAmount;
      newItems[index].taxableAmount = computed.taxableAmount;
      newItems[index].gstAmount = computed.gstAmount;
      newItems[index].cgstAmount = computed.cgstAmount;
      newItems[index].sgstAmount = computed.sgstAmount;
      newItems[index].igstAmount = computed.igstAmount;
      newItems[index].lineTotal = computed.lineTotal;
      newItems[index].taxType = computed.taxType;
    }

    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index) => {
    shiftTouched(index, -1);
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  /**
   * Copy a line and put the copy directly under it.
   *
   * Batch and any recorded expiry are dropped: the copy is a new line that has
   * not been told which batch it draws from, and inheriting one would quietly
   * commit stock the operator never chose.
   */
  const duplicateItem = (index) => {
    const source = formData.items[index];
    if (!source) return;
    const copy = { ...source, batchId: '', batchNo: '', expiryDate: '' };
    shiftTouched(index + 1, 1);
    setFocusRowIndex(index + 1);
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items.slice(0, index + 1), copy, ...prev.items.slice(index + 1)],
    }));
  };

  const computed = computeGstForLines({
    lines: formData.items,
    isIntra,
    invoiceDiscount:
      formData.invoiceDiscountEnabled && Number(formData.invoiceDiscountValue) > 0
        ? { type: formData.invoiceDiscountType || 'pct', value: Number(formData.invoiceDiscountValue) }
        : null,
    otherCharges: formData.otherCharges,
  });

  /*
   * The taxable value, and what the customer will withhold from it.
   *
   * The base is the amount GST is charged on — after any invoice-level
   * discount, including other charges, and before the tax itself. CBDT
   * Circular 23/2017: where GST is shown separately, tax is deducted on the
   * amount excluding it.
   *
   * The invoice total does not move. TDS is the customer's withholding, not a
   * discount: reducing the total here would understate output GST and lose
   * part of the receivable.
   */
  const tdsBase = Math.max(
    0,
    Number(computed.subtotal || 0) - Number(computed.invoiceDiscount || 0) + Number(computed.otherChargesTotal || 0)
  );
  const tdsRateValue = Number(formData.tdsRate || 0);

  /*
   * What this customer has already been billed under this section this year,
   * so the threshold means something.
   *
   * TDS is not due from the first rupee: 194J(b) starts at 50,000 for the year,
   * 194C at 30,000 for one bill or 1,00,000 across the year. The app deducted
   * regardless, which overstated the deduction on every small document. And
   * once a limit IS passed the whole aggregate becomes liable, earlier
   * documents included — so the figure has to know what came before it.
   */
  const tdsPriorValue = useMemo(() => {
    const code = String(formData.tdsSection || '').trim();
    const customerId = formData.customerId;
    if (!code || customerId === '' || customerId == null) return 0;
    const fy = fyRange(formData.date);
    return (db?.invoices || [])
      .filter(
        (i) =>
          i.companyId === currentCompany.id &&
          String(i.customerId) === String(customerId) &&
          String(i.tdsSection || '') === code &&
          String(i.status || '').toLowerCase() !== 'cancelled' &&
          String(i.id) !== String(initialData?.id ?? '') &&
          String(i.date || '') >= fy.from &&
          String(i.date || '') <= fy.to
      )
      .reduce((sum, i) => sum + (Number(i.taxableValue) || Number(i.subtotal) || 0), 0);
  }, [db?.invoices, currentCompany.id, formData.customerId, formData.tdsSection, formData.date, initialData?.id]);

  /*
   * Expected, not receivable.
   *
   * §17: an invoice may show what the customer is expected to withhold, but
   * the receivable stays the full invoice amount and nothing is debited to TDS
   * Receivable here. The asset is recognised when a receipt records that the
   * customer actually deducted — which is the one thing this screen must not
   * pre-empt, because an expectation that never arrives would sit in the books
   * as tax somebody else paid on our behalf.
   */
  const tdsExpected = resolveTds({
    company: currentCompany,
    party: customer,
    transactionDate: formData.date,
    taxableBase: tdsBase,
    explicitNatureCode: natureForSection(formData.tdsSection)?.code || '',
    explicitRate: String(formData.tdsRate ?? '').trim() === '' ? null : formData.tdsRate,
    side: 'RECEIVABLE',
    priorBase: tdsPriorValue,
    ledgers: [],
  });

  const tdsState = formData.tdsSection
    ? { crossed: tdsExpected.thresholdCrossed, base: tdsExpected.baseAmount, reason: tdsExpected.thresholdReason }
    : null;
  const tdsAmount = tdsExpected.tdsAmount;
  const netReceivable = Math.max(0, Number(computed.total || 0) - tdsAmount);

  /**
   * The invoice as it stands right now, shaped like a saved one.
   *
   * The preview uses the same renderer that prints and emails, so it has to be
   * fed the same shape. Building it from `computed` rather than from the raw
   * form is the point — a preview that totals differently from the saved
   * document is worse than no preview.
   */
  /**
   * A cancelled invoice is a record, not a document you still work on. Its
   * number is spent and its ledger entries are reversed; editing it would put
   * a live figure back behind a status that says there isn't one.
   */
  const isCancelled = String(existingInvoiceRecord?.status || '') === 'Cancelled';

  /*
   * An invoice that has reached the books is no longer financially editable.
   *
   * The server has refused this since `d024b6d` — an invoice posted at 118,000
   * and edited to 40,000 left the document and the ledger disagreeing, and the
   * edit route was the only place in the product that could do it. The refusal
   * was right and invisible: every control stayed live, so the way to learn
   * about the rule was to retype an invoice and lose the lot to a toast.
   *
   * Asked of the ledger rather than guessed from the status, because a Draft
   * invoice posts today: Draft does not mean "not in the books", the entries
   * do. The answer fails open — no permission or no network leaves the form as
   * it was, with the server still the authority.
   */
  const { locked: postedLocked } = usePostingLock('INVOICE', existingInvoiceRecord?.backendInvoiceId || '');
  /* A cancelled invoice is closed to editing for its own reason, and the two
     want the same controls shut. */
  const financialLocked = postedLocked || isCancelled;

  const previewInvoice = useMemo(
    () => ({
      ...formData,
      number: formData.number || generatedInvoiceNumber || '',
      customerName: getCustomerDisplayName(customer),
      customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      invoiceDiscountApplied: computed.invoiceDiscount,
      otherCharges: computed.otherCharges,
      otherChargesTotal: computed.otherChargesTotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
    }),
    [formData, generatedInvoiceNumber, customer, customerGstin, customerState, isIntra, computed]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isCancelled) {
      notify.error('This invoice is cancelled. Its number is spent — raise a new invoice instead.');
      return;
    }

    if (postedLocked) {
      notify.error(
        'This invoice is in the books, so its amounts can no longer be changed. ' +
          'Cancel it and raise a new one, or issue a credit note against it.'
      );
      return;
    }

    const wantsDraft = !isEdit && submitAsDraft;
    if (wantsDraft) {
      setSubmitAsDraft(false);
    }

    let invoiceNumber = String(formData.number || '').trim();
    if (isInvoiceAuto) {
      if (lockInvoiceNumberOnCreate) {
        invoiceNumber = String(generatedInvoiceNumber || '').trim();
      } else if (!invoiceNumber) {
        invoiceNumber = String(generatedInvoiceNumber || '').trim();
      }
    }

    // Everything that is about a field, gathered in one pass. Reporting these
    // one at a time meant a form with three blanks took three submits to find
    // out about the third.
    const invoiceNumberClash = db.invoices.some(
      (inv) => inv.companyId === currentCompany.id && String(inv.number || '').trim() === invoiceNumber && (!isEdit || inv.id !== Number(initialData?.id))
    );

    fieldErrors.reset();
    fieldErrors.require('number', invoiceNumber, 'Invoice number is required');
    fieldErrors.check(
      'number',
      !invoiceNumber || !invoiceNumberClash,
      'That number is already used. Change it, or adjust numbering in Company Profile.'
    );
    fieldErrors.require('date', formData.date, 'Invoice date is required');
    fieldErrors.require('warehouseId', formData.warehouseId, 'Warehouse is required');
    fieldErrors.require('customerId', formData.customerId, 'Customer is required');
    fieldErrors.check('exchangeRate', !multiCurrencyEnabled || !formData.invoiceCurrency || formData.invoiceCurrency === invoiceBaseCurrency || Number(formData.exchangeRate) > 0, `Enter the conversion rate to ${invoiceBaseCurrency}`);
    fieldErrors.check(
      'items',
      !(formData.items || []).some((l) => !String(l.itemId || '').trim()),
      'Every line needs an item — GST is charged per item.'
    );
    if (fieldErrors.failed()) return;
    if (selectedCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating an invoice.');
      return;
    }

    // Closed books: nothing back-dates into a period already reported.
    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This invoice');
      if (closed) {
        notify.error(closed);
        return;
      }
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST invoices.');
      return;
    }

    const customerIsRegistered = String(selectedCustomer?.gstRegistration || '').trim().toLowerCase() === 'registered';
    if (customerIsRegistered && !canDetermineSupplyType({ companyState, partyState: customerState })) {
      notify.error('Cannot determine Place of Supply for this registered customer. Please set customer state/address before creating GST invoices.');
      return;
    }


    // Batch-tracked lines must name a batch with enough remaining stock.
    if (!wantsDraft) {
      for (const l of formData.items || []) {
        const master = items.find((i) => String(i.id) === String(l.itemId));
        if (!isTracked(master)) continue;
        if (!l.batchId) {
          notify.error(`"${master.name}" is batch-tracked — pick a batch on its line.`);
          return;
        }
        const batch = batchesForItem(db, currentCompany.id, l.itemId, {
          includeEmpty: true,
          excludeInvoiceId: isEdit ? initialData?.id : undefined,
        }).find((b) => String(b.id) === String(l.batchId));
        const q = Number(l.quantity) || 0;
        if (!batch) {
          notify.error(`Batch on "${master.name}" no longer exists — pick again.`);
          return;
        }
        if (q > batch.remaining + 0.0001) {
          notify.error(`Batch ${batch.batchNo} has only ${batch.remaining} left — line needs ${q}.`);
          return;
        }
      }
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    // Credit management: warn before pushing a customer past their limit or
    // stacking onto already-overdue invoices. Warn-and-confirm, not a hard
    // block — the operator may have collected payment out of band.
    if (!isEdit && customer) {
      const openInvoices = db.invoices.filter((i) => {
        if (i.companyId !== currentCompany.id) return false;
        if (parseInt(i.customerId) !== customer.id) return false;
        const st = String(i.status || '').toLowerCase();
        return st !== 'draft' && st !== 'cancelled' && st !== 'paid';
      });
      const outstanding = openInvoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.paidAmount || 0)), 0);
      const creditLimit = Number(customer.creditLimit || 0);
      const todayStr = todayIso();
      const overdue = openInvoices.filter((i) => i.dueDate && i.dueDate < todayStr);

      const warnings = [];
      if (creditLimit > 0 && outstanding + computed.total > creditLimit) {
        warnings.push(
          `Credit limit ${formatMoney(creditLimit, currentCompany)} would be crossed — outstanding ${formatMoney(outstanding, currentCompany)} + this invoice ${formatMoney(computed.total, currentCompany)}.`
        );
      }
      if (overdue.length > 0) {
        warnings.push(`${overdue.length} invoice(s) already past due (oldest: ${overdue.map((i) => i.dueDate).sort()[0]}).`);
      }
      if (warnings.length) {
        const ok = await confirmDialog({
          title: 'Credit check',
          message: warnings.join('\n') + '\n\nCreate the invoice anyway?',
          confirmLabel: 'Create anyway',
        });
        if (!ok) return;
      }
    }

    const existingInvoice = isEdit ? db.invoices.find((i) => i.id === Number(initialData.id)) : null;
    if (isEdit && !existingInvoice) {
      notify.error('Invoice not found. It may have been removed.');
      return;
    }

    const invoicePayloadBase = {
      companyId: currentCompany.id,
      ...formData,
      currency: multiCurrencyEnabled
        ? String(formData.invoiceCurrency || currentCompany?.currency || currentCompany?.baseCurrency || 'INR').toUpperCase()
        : String(currentCompany?.currency || currentCompany?.baseCurrency || 'INR').toUpperCase(),
      invoiceCurrency: multiCurrencyEnabled ? formData.invoiceCurrency : '',
      exchangeRate: multiCurrencyEnabled && formData.invoiceCurrency && formData.invoiceCurrency !== invoiceBaseCurrency
        ? Number(formData.exchangeRate || 0)
        : 1,
      number: invoiceNumber,
      warehouseId: String(formData.warehouseId || '').trim(),
      customerName: getCustomerDisplayName(customer),
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      invoiceDiscountApplied: computed.invoiceDiscount,
      otherCharges: computed.otherCharges,
      otherChargesTotal: computed.otherChargesTotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      // Stated on the document, never netted off the total: the receivable is
      // the total, and the deduction is tax the customer pays on our behalf.
      tdsSection: formData.tdsSection || '',
      tdsDeducteeType: formData.tdsSection ? formData.tdsDeducteeType || 'COMPANY' : '',
      tdsRate: formData.tdsSection ? tdsRateValue : 0,
      /* Expected — the customer's withholding, not an asset of ours until a
         receipt says they took it. */
      tdsAmount,
      tdsExpectedAmount: tdsAmount,
      tdsNatureCode: tdsExpected.natureCode || '',
      tdsRuleVersionId: tdsExpected.ruleVersionId || '',
    };

    const existingPaidAmount = isEdit ? Number(existingInvoice?.paidAmount ?? 0) : 0;
    // Editing a draft and pressing Update used to finalise it, because the
    // only thing consulted was which button was pressed on a form that no
    // longer offered the draft one.
    const isDraft = wantsDraft;
    const nextStatus =
      isDraft
        ? 'Draft'
        : computed.total > 0 && existingPaidAmount >= computed.total - 0.0001
          ? 'Paid'
          : existingPaidAmount > 0
            ? 'Partial'
            : 'Unpaid';

    // Block negative stock for Goods (Services do not affect inventory)
    if (!isDraft) {
      const whId = String(formData.warehouseId || '').trim();
      const inventoryByItemId = computeInventorySummaryByItemId({ db, companyId: currentCompany.id, warehouseId: whId });

      const itemsById = new Map(items.map((it) => [String(it.id), it]));
      const sumQtyByItemId = (lines) => {
        const map = new Map();
        (Array.isArray(lines) ? lines : []).forEach((l) => {
          const itemId = l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '';
          if (!itemId) return;
          const master = itemsById.get(itemId);
          if (!master || !isStockItem(master)) return;
          const qty = Number(l?.quantity ?? 0);
          const q = Number.isFinite(qty) ? Math.max(0, qty) : 0;
          if (q <= 0) return;
          map.set(itemId, (map.get(itemId) || 0) + q);
        });
        return map;
      };

      const requiredOut = sumQtyByItemId(computed.lines);
      const canGiveBack =
        Boolean(isEdit) &&
        Boolean(existingInvoice) &&
        String(existingInvoice?.status || '').trim() !== 'Draft' &&
        String(existingInvoice?.warehouseId || '').trim() === whId;
      const giveBackOut = canGiveBack ? sumQtyByItemId(existingInvoice?.items) : new Map();

      for (const [itemId, needQty] of requiredOut.entries()) {
        const closingQty = Number(inventoryByItemId.get(String(itemId))?.closingQty ?? 0);
        const giveBack = Number(giveBackOut.get(String(itemId)) || 0);
        const available = (Number.isFinite(closingQty) ? closingQty : 0) + (Number.isFinite(giveBack) ? giveBack : 0);

        if (needQty > available + 0.0001) {
          const master = itemsById.get(String(itemId));
          const label = master?.name || master?.code || `Item ${itemId}`;
          notify.error(`Negative stock not allowed. "${label}" available ${available}, required ${needQty}.`);
          return;
        }
      }
    }

    if (isEdit) {
      const updatedInvoice = {
        ...existingInvoice,
        ...invoicePayloadBase,
        id: existingInvoice.id,
        paidAmount: existingInvoice.paidAmount ?? 0,
        status: nextStatus,
        createdAt: existingInvoice.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const hasApiSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
      if (hasApiSession) {
        const backendInvoiceId = String(existingInvoice?.backendInvoiceId || '').trim();
        const payload = {
          branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
          warehouseId: String(updatedInvoice.warehouseId || '').trim(),
          number: String(updatedInvoice.number || '').trim(),
          date: String(updatedInvoice.date || '').trim(),
          dueDate: String(updatedInvoice.dueDate || '').trim(),
          refNo: String(updatedInvoice.refNo || '').trim(),
          refDate: String(updatedInvoice.refDate || '').trim(),
          customerId: String(updatedInvoice.customerId || '').trim(),
          customerName: String(updatedInvoice.customerName || '').trim(),
          customerGstin: String(updatedInvoice.customerGstin || '').trim(),
          placeOfSupplyState: String(updatedInvoice.placeOfSupplyState || '').trim(),
          taxType: String(updatedInvoice.taxType || '').trim(),
          subtotal: Number(updatedInvoice.subtotal ?? 0),
          cgstTotal: Number(updatedInvoice.cgstTotal ?? 0),
          sgstTotal: Number(updatedInvoice.sgstTotal ?? 0),
          igstTotal: Number(updatedInvoice.igstTotal ?? 0),
          gstTotal: Number(updatedInvoice.gstTotal ?? 0),
          total: Number(updatedInvoice.total ?? 0),
          paidAmount: Number(updatedInvoice.paidAmount ?? 0),
          status: String(updatedInvoice.status || 'Draft').trim(),
          sourceEstimateId: updatedInvoice.sourceEstimateId ? String(updatedInvoice.sourceEstimateId) : '',
          shipToAddressId: updatedInvoice.shipToAddressId || undefined,
          items: Array.isArray(updatedInvoice.items) ? updatedInvoice.items : [],
        };

        try {
          const saved = backendInvoiceId
            ? await updateInvoiceApi(backendInvoiceId, payload)
            : await createInvoiceApi(payload);
          updatedInvoice.backendInvoiceId = String(saved?.id || backendInvoiceId || '').trim() || undefined;
        } catch (err) {
          notify.error(String(err?.message || 'Unable to save invoice to backend.'));
          return;
        }
      }

      setDb({
        ...db,
        invoices: db.invoices.map((inv) => (inv.id === existingInvoice.id ? updatedInvoice : inv)),
      });
      onClose?.();
      notify.success('Invoice updated successfully!');
      return;
    }

    const newInvoiceId = getNextNumericId(db.invoices);
    const newInvoice = {
      ...invoicePayloadBase,
      id: newInvoiceId,
      paidAmount: 0,
      status: nextStatus,
      createdAt: new Date().toISOString(),
    };

    const hasApiSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
    if (hasApiSession) {
      const payload = {
        branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
        warehouseId: String(newInvoice.warehouseId || '').trim(),
        number: String(newInvoice.number || '').trim(),
        date: String(newInvoice.date || '').trim(),
        dueDate: String(newInvoice.dueDate || '').trim(),
        refNo: String(newInvoice.refNo || '').trim(),
        refDate: String(newInvoice.refDate || '').trim(),
        customerId: String(newInvoice.customerId || '').trim(),
        customerName: String(newInvoice.customerName || '').trim(),
        customerGstin: String(newInvoice.customerGstin || '').trim(),
        placeOfSupplyState: String(newInvoice.placeOfSupplyState || '').trim(),
        taxType: String(newInvoice.taxType || '').trim(),
        subtotal: Number(newInvoice.subtotal ?? 0),
        cgstTotal: Number(newInvoice.cgstTotal ?? 0),
        sgstTotal: Number(newInvoice.sgstTotal ?? 0),
        igstTotal: Number(newInvoice.igstTotal ?? 0),
        gstTotal: Number(newInvoice.gstTotal ?? 0),
        total: Number(newInvoice.total ?? 0),
        paidAmount: Number(newInvoice.paidAmount ?? 0),
        status: String(newInvoice.status || 'Draft').trim(),
        sourceEstimateId: newInvoice.sourceEstimateId ? String(newInvoice.sourceEstimateId) : '',
        reverseCharge: !!newInvoice.reverseCharge,
        // Fields the form collects that used to stop at the browser: without
        // them a device that had never seen this invoice rebuilt it without
        // its salesman, cost centre, discounts, charges or source document.
        salesmanId: newInvoice.salesmanId ?? undefined,
        costCenterId: newInvoice.costCenterId ?? undefined,
        invoiceDiscountType: newInvoice.invoiceDiscountType ?? undefined,
        invoiceDiscountValue: newInvoice.invoiceDiscountValue ?? undefined,
        invoiceDiscountApplied: Number.isFinite(Number(newInvoice.invoiceDiscountApplied))
          ? Number(newInvoice.invoiceDiscountApplied)
          : undefined,
        otherCharges: Array.isArray(newInvoice.otherCharges) && newInvoice.otherCharges.length ? newInvoice.otherCharges : undefined,
        otherChargesTotal: Number.isFinite(Number(newInvoice.otherChargesTotal)) ? Number(newInvoice.otherChargesTotal) : undefined,
        tdsSection: newInvoice.tdsSection || undefined,
        tdsRate: Number(newInvoice.tdsRate) > 0 ? Number(newInvoice.tdsRate) : undefined,
        tdsAmount: Number(newInvoice.tdsAmount) > 0 ? Number(newInvoice.tdsAmount) : undefined,
        shipToAddressId: newInvoice.shipToAddressId ?? undefined,
        sourceChallanId: newInvoice.sourceChallanId ?? undefined,
        sourceSalesOrderId: newInvoice.sourceSalesOrderId ?? undefined,
        items: Array.isArray(newInvoice.items) ? newInvoice.items : [],
      };

      try {
        const saved = await createInvoiceApi(payload);
        newInvoice.backendInvoiceId = String(saved?.id || '').trim() || undefined;
      } catch (err) {
        notify.error(String(err?.message || 'Unable to save invoice to backend.'));
        return;
      }
    }

    const sourceEstimateId = formData.sourceEstimateId;
    const updatedEstimates = sourceEstimateId
      ? db.estimates.map((e) =>
          e.id === sourceEstimateId
            ? {
                ...e,
                status: 'Converted',
                convertedInvoiceId: newInvoice.id,
                convertedAt: new Date().toISOString(),
              }
            : e
        )
      : db.estimates;

    const sourceChallanId = formData.sourceChallanId;
    setDb({
      ...db,
      invoices: [...db.invoices, newInvoice],
      estimates: updatedEstimates,
      deliveryChallans: sourceChallanId
        ? (db.deliveryChallans || []).map((c) =>
            Number(c.id) === Number(sourceChallanId) ? { ...c, status: 'Invoiced', invoiceNumber: newInvoice.number } : c
          )
        : db.deliveryChallans,
      companies: bumpCompanyNextNumber({
        db,
        companyId: currentCompany.id,
        voucherKey: 'invoice',
        usedNumber: invoiceNumber,
        branchId: branchIdForNumbering,
      }),
    });

    const keepGoing = saveAndNewRef.current;
    saveAndNewRef.current = false;

    if (keepGoing) {
      // Same customer, same warehouse, everything else blank — the next
      // invoice in a run is usually for a different line of goods, not a
      // different buyer, and retyping the customer every time is the thing
      // that makes bulk entry slow.
      setFormData((p) => ({
        ...p,
        number: '',
        items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
        invoiceDiscountEnabled: false,
        invoiceDiscountValue: '',
        otherCharges: [],
        refNo: '',
        refDate: '',
        customFields: {},
        sourceEstimateId: null,
        sourceChallanId: null,
        sourceSalesOrderId: null,
      }));
      setPreviewOpen(false);
    } else {
      onClose?.();
    }

    if (sourceEstimateId) notify.success('Invoice created and estimate converted successfully!');
    else if (keepGoing) notify.success(`Invoice ${invoiceNumber} saved. Next one is ready.`);
    else notify.success('Invoice created successfully!');

    // Auto-register on the IRP when the org opted in (fire-and-forget: the
    // invoice is already saved; a gateway failure only means "no IRN yet").
    if (newInvoice.backendInvoiceId && isEnabled('einvoice')) {
      (async () => {
        try {
          // Reading the gateway settings needs the settings permission; a
          // sales user without it simply skips auto-registration — silently,
          // because the invoice itself saved fine.
          let settings = null;
          try {
            settings = await getEInvoiceSettingsApi();
          } catch {
            return;
          }
          if (!settings?.autoRegister || !settings?.baseUrl) return;
          const customer = (db.customers || []).find((c) => c.id === newInvoice.customerId) || {};
          const result = await registerEInvoiceApi(
            newInvoice.backendInvoiceId,
            buildEInvoicePayload({ invoice: newInvoice, company: currentCompany, customer })
          );
          setDb((prev) => ({
            ...prev,
            invoices: (prev.invoices || []).map((x) =>
              x.id === newInvoice.id
                ? { ...x, irn: result.irn, irnAckNo: result.ackNo, irnAckDate: result.ackDate, irnSignedQr: result.signedQr }
                : x
            ),
          }));
          notify.success(`IRN for ${newInvoice.number}: ${result.irn}`);
        } catch (err) {
          notify.error(`IRP auto-registration failed: ${String(err?.message || err)}`);
        }
      })();
    }
  };

  // Hands stay on the keyboard. These are the bindings a Tally operator
  // already has in muscle memory, so entry does not slow down on arrival.
  /*
   * The shared document keyboard contract, in place of a handler this form
   * had grown for itself: Ctrl+S saves the draft, Ctrl+Enter commits, Enter
   * advances (and opens the next line inside the grid), Tab off the last cell
   * of the last line opens one, Ctrl+= adds, Ctrl+D duplicates, Ctrl+Delete
   * removes.
   */
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    // Ctrl+S should never be the keystroke that finalises a GST number, so on
    // a draftable document it saves the draft.
    onSave: () => {
      if (isDraftInvoice && !isEdit) {
        submitAsDraftNow();
        return;
      }
      setSubmitAsDraft(false);
      formRef.current?.requestSubmit();
    },
    onCommit: () => {
      setSubmitAsDraft(false);
      formRef.current?.requestSubmit();
    },
    lineCount: formData.items.length,
    addLine: addItem,
    duplicateLine: duplicateItem,
    removeLine: removeItem,
    autoFocus: '#invoice-branch-field button',
    isDirty: hasUnsavedInput,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} noValidate className="ui-creation-form invoice-editor space-y-3">
      <DocFormActions
        title={screenTitle}
        subtitle={screenSubtitle}
        onBack={onBack ? requestBack : null}
        sticky={Boolean(screenTitle)}
        primaryLabel={isDraftInvoice ? (isEdit ? 'Finalize Invoice' : 'Create Invoice') : 'Update Invoice'}
        onPrimary={() => setSubmitAsDraft(false)}
        secondaryLabel={isDraftInvoice ? 'Save Draft' : ''}
        onSecondary={submitAsDraftNow}
        /*
         * react-hooks/refs cannot tell a callback prop from a render-time
         * read, so a menu entry whose handler touches a ref reads to it as a
         * ref access during render. Every onSelect below runs on click.
         */
        // eslint-disable-next-line react-hooks/refs
        menu={[
          { key: 'preview', group: 'This invoice', label: 'Preview Invoice', icon: Eye, onSelect: () => setPreviewOpen(true) },
          !isEdit
            ? {
                key: 'saveNew',
                group: 'This invoice',
                label: 'Save & New',
                icon: Plus,
                submit: true,
                onSelect: markSaveAndNew,
              }
            : null,
          isEdit && typeof onDuplicateInvoice === 'function'
            ? {
                key: 'duplicate',
                group: 'This invoice',
                label: 'Duplicate',
                icon: Copy,
                onSelect: () => onDuplicateInvoice(existingInvoiceRecord || initialData),
              }
            : null,
          {
            key: 'prefs',
            group: 'Configure — every invoice',
            label: 'Preferences',
            icon: SlidersHorizontal,
            onSelect: () => openPreferences('fields'),
          },
          {
            key: 'custom',
            group: 'Configure — every invoice',
            label: 'Custom Field',
            icon: Plus,
            onSelect: () => openPreferences('custom'),
          },
          {
            key: 'template',
            group: 'Configure — every invoice',
            label: 'Invoice Template',
            icon: Settings2,
            onSelect: () => goToSettings('invoiceTemplates'),
          },
          isEdit && String(existingInvoiceRecord?.status || '') !== 'Cancelled'
            ? { key: 'cancel', group: 'danger', label: 'Cancel invoice', icon: Ban, danger: true, onSelect: cancelInvoice }
            : null,
        ].filter(Boolean)}
      />

      {postedLocked && !isCancelled ? (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
          role="status"
        >
          <Lock size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
          <span>
            This invoice is in the books. Its lines, amounts, customer, date and tax details can no longer be
            changed — cancel it and raise a new one, or issue a credit note against it. Notes, terms, the
            reference and the due date are still yours to edit.
          </span>
        </div>
      ) : null}

      {isCancelled ? (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
          role="status"
        >
          <Ban size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
          <span>
            This invoice was cancelled{existingInvoiceRecord?.cancelledAt ? ` on ${existingInvoiceRecord.cancelledAt}` : ''}. It
            keeps its number so the series has no hole, and it cannot be edited. Raise a new invoice instead.
          </span>
        </div>
      ) : null}

      {/*
        Settings arrive beside the invoice, not on top of it.

        This used to render InvoiceFieldSettings inline, so choosing
        "Preferences" or "Custom Field" from the menu put a settings screen in
        the middle of a half-typed invoice — two screens stacked on one page,
        neither with the width it needed, and no clear way to tell which one
        you were editing. The invoice stays where it was, behind the scrim.
      */}
      <Drawer
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        title={prefsPane === 'custom' ? 'Invoice custom fields' : 'Invoice settings'}
        description={
          prefsPane === 'custom'
            ? 'Fields of your own, on every invoice. Other documents keep their own.'
            : 'Applies to every invoice, not just this one. Nothing typed here is lost.'
        }
      >
        <InvoiceFieldSettings
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          embedded
          pane={prefsPane}
          docType="invoice"
          docLabel="Invoice"
          onBack={() => setPrefsOpen(false)}
        />
      </Drawer>

      {/*
        The preview is a document, so it gets a document's own space.

        It used to render as a card spliced into the form above the branch and
        warehouse fields: the half-typed invoice was pushed down the page, the
        editor and the preview were on screen at once, and an A4 sheet had to
        fit the editor's column. A drawer leaves the form where it was, visible
        behind the scrim, and gives the sheet a width it can actually be read
        at. Wider than the settings drawer for the same reason.
      */}
      <Drawer
        open={previewOpen && !prefsOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Preview — ${previewInvoice?.number || 'this invoice'}`}
        description="What the customer receives"
        widthClass="w-[min(64rem,72vw)]"
      >
        <div className="overflow-x-auto">
          <InvoicePreview db={db} currentCompany={currentCompany} invoice={previewInvoice} />
        </div>
      </Drawer>

      {/*
        The head of the document, in two columns.

        Left is who and where: the branch, the warehouse its stock leaves, and
        the customer under them. Right is the paperwork: the number, the two
        dates that govern it, and the reference it answers to. They were one
        four-across band before, which put the number between the warehouse and
        the customer and read as neither.
      */}
      <div className="ui-doc-section invoice-head grid grid-cols-1 lg:grid-cols-12 gap-x-4 gap-y-3">
        <div className="lg:col-span-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* The same searchable dropdown as every other selection on this
                form — a chain with forty branches should be typed at, not
                scrolled. */}
            <div id="invoice-branch-field">
              <PopupSelect
                label="Branch"
      title="branches"
                value={String(branchIdInList || '')}
                onChange={onBranchChange}
                icon={Building2}
                options={[
                  { value: '', label: 'All branches' },
                  ...branchOptions.map((b) => ({ value: String(b.id), label: branchLabel(b) })),
                ]}
                placeholder="All branches"
                showValueSubtext={false}
                disabled={financialLocked}
              />
            </div>

          <div
            ref={(el) => fieldErrors.register('warehouseId', el)}
            data-invalid-within={fieldErrors.error('warehouseId') ? 'true' : undefined}
          >
            <WarehouseField
              value={formData.warehouseId}
              onChange={(warehouseId) => {
                fieldErrors.clearField('warehouseId');
                setLastSelection('warehouse', currentCompany?.id, warehouseId);
                setFormData((p) => ({ ...p, warehouseId }));
              }}
              options={warehouseOptions}
              activeWarehouseId={defaultWarehouseId}
              isEdit={Boolean(initialData)}
              icon={Package}
              showSourceHint={false}
              className="ui-select"
              disabled={financialLocked}
            />
            <FieldError error={fieldErrors.error('warehouseId')} id={fieldErrors.errorId('warehouseId')} />
          </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              ref={(el) => fieldErrors.register('customerId', el)}
              data-invalid-within={fieldErrors.error('customerId') ? 'true' : undefined}
            >
              <CustomerPicker
                db={db}
                setDb={setDb}
                icon={Users}
                label="Bill To"
                currentCompany={currentCompany}
                /* The customer becomes the party on the posted receivable line —
                   the subledger's owner. It cannot move once that is in the books. */
                disabled={financialLocked}
                disabledHint="This invoice is in the books, so its customer can no longer be changed."
                value={formData.customerId}
                onChange={(customerId) =>
                  setFormData((prev) => {
                  // Requirement 12: the due date follows the customer's agreed
                  // terms instead of a blanket +30 days. The server recomputes
                  // this on save from the same terms, so showing anything else
                  // here would just be a number that changes after saving.
                  const picked = customers.find((c) => String(c.id) === String(customerId));
                  fieldErrors.clearField('customerId');
                    return {
                      ...prev,
                      customerId,
                      shipToCode: '',
                      shipToAddress: null,
                      shipToAddressId: '',
                      dueDate: picked ? dueDateFor(prev.date, picked) || prev.dueDate : prev.dueDate,
                    };
                  })
                }
              />
              <FieldError error={fieldErrors.error('customerId')} id={fieldErrors.errorId('customerId')} />
              {selectedCustomer ? (
                <>
                  <p className="invoice-address mt-1 ui-muted">{addressSummary(selectedCustomer.billingAddress) || 'Billing address not configured'}</p>
                  <p className="invoice-address mt-0.5 ui-muted">Terms: {termsLabel(selectedCustomer)}</p>
                </>
              ) : null}
            </div>

            <div>
              <label className="ui-label" htmlFor="index-ship-to">Ship To</label>
              <select id="index-ship-to"
                value={formData.shipToCode || ''}
                disabled={!selectedCustomer}
                onChange={(e) => {
                  const code = e.target.value;
                  const selected = shipToOptions.find((option) => option.value === code) || null;
                  setFormData((previous) => ({
                    ...previous,
                    shipToCode: code,
                    shipToAddress: selected?.address || null,
                    shipToAddressId: selected?.id || '',
                  }));
                }}
                className="ui-select w-full"
              >
                <option value="">Same as billing address</option>
                {shipToOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedCustomer ? (
                <p className="invoice-address mt-1 ui-muted">
                  {formData.shipToAddress
                    ? addressSummary(formData.shipToAddress)
                    : addressSummary(selectedCustomer.billingAddress) || 'Billing address not configured'}
                </p>
              ) : (
                <p className="invoice-address mt-1 ui-muted">Select a customer first</p>
              )}
            </div>
          </div>

        </div>

        {/* The paperwork column, ruled off from the left. Number and both dates
            sit on one row: they are read together — issued on, due by — and
            splitting them put a full-width number above a pair of narrow
            dates, which reads as two unrelated groups. */}
        <div
          className="lg:col-span-6 space-y-3 lg:ps-4"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr] gap-3">
          <div className="min-w-0">
            <label htmlFor="invoice-number" className="ui-label">
              Invoice No.
            </label>
            {/* The gear sits on the field it governs. Changing a series is a
                different act from raising an invoice, so it opens over the
                form rather than navigating away from a half-typed document. */}
            <div className="relative">
              <input
                id="invoice-number"
                type="text"
                value={formData.number ?? ''}
                onChange={(e) => setFormData((p) => ({ ...p, number: e.target.value }))}
                /* Two reasons to be closed: the series owns the number while a
                   new invoice is being raised, and a posted invoice's number is
                   its statutory serial. */
                disabled={lockInvoiceNumberOnCreate || financialLocked}
                required
                aria-invalid={fieldErrors.error('number') ? true : undefined}
                className="ui-input ui-mono w-full pe-9"
              />
              <button
                type="button"
                ref={numberingBtnRef}
                onClick={() => setNumberingOpen((v) => !v)}
                className="absolute end-1 top-1/2 -translate-y-1/2 ui-icon-btn !h-7 !w-7"
                aria-label="Invoice numbering settings"
                aria-haspopup="dialog"
                aria-expanded={numberingOpen}
      title="Numbering"
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
              </button>
            </div>
            <FieldError error={fieldErrors.error('number')} id={fieldErrors.errorId('number')} />
            {numberingOpen ? (
              <DocNumberingPopover
                anchorRef={numberingBtnRef}
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                voucherKey="invoice"
      title="Invoice numbering"
                sampleLabel="Next invoice will be"
                manualLabel="Typed on each invoice"
                branchId={branchIdForNumbering}
                settings={invoiceNumbering}
                onClose={() => setNumberingOpen(false)}
                onOpenFullSettings={() => {
                  setNumberingOpen(false);
                  goToSettings('docNumbering');
                }}
              />
            ) : null}
          </div>

            <div className="min-w-0">
              <label htmlFor="invoice-date" className="ui-label">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="invoice-date"
                disabled={financialLocked}
                type="date"
                value={formData.date}
                required
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    date: e.target.value,
                    // Terms are counted from the document date, so moving the
                    // date moves the due date with it.
                    dueDate: selectedCustomer ? dueDateFor(e.target.value, selectedCustomer) || p.dueDate : p.dueDate,
                  }))
                }
                className="ui-input"
              />
              <FieldError error={fieldErrors.error('date')} id={fieldErrors.errorId('date')} />
            </div>

            <div className="min-w-0">
              <label htmlFor="invoice-due" className="ui-label">
                Due Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="invoice-due"
                type="date"
                value={formData.dueDate}
                required
                onChange={(e) => setFormData((p) => ({ ...p, dueDate: e.target.value }))}
                className="ui-input"
              />
            </div>
          </div>

          {prefOn('customerRef') ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="invoice-ref-no" className="ui-label">Ref No.</label>
                <input
                  id="invoice-ref-no"
                  type="text"
                  value={formData.refNo}
                  onChange={(e) => setFormData({ ...formData, refNo: e.target.value })}
                  className="ui-input"
                  placeholder="Quotation / Sales Order"
                />
              </div>
              <div>
                <label htmlFor="invoice-ref-date" className="ui-label">Ref Date</label>
                <input
                  id="invoice-ref-date"
                  type="date"
                  value={formData.refDate}
                  onChange={(e) => setFormData({ ...formData, refDate: e.target.value })}
                  className="ui-input"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        Custom fields, under the whole head rather than tucked into whichever
        column had room. Two per row at half the width each, so a company that
        configures six gets three tidy rows instead of a ragged column.
      */}
      {hasCustomFieldsAt(customFields, 'header', 'reference') ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4"
          style={{ borderTop: '1px solid rgb(var(--border))' }}
        >
          {renderCustomFields('header')}
          {renderCustomFields('reference')}
        </div>
      ) : null}

      {/*
        Everything a company can switch on: export paperwork, reverse charge,
        cost centre, salesman. Under the head rather than inside it, so Tab
        runs branch → warehouse → customer → number → dates → refs → custom
        fields → the first line without detouring through fields most books
        never turn on.
      */}
      {[
        prefOn('iec'),
        prefOn('lut'),
        prefOn('reverseCharge'),
        prefOn('costCenter') && (db.costCenters || []).some((c) => c.companyId === currentCompany.id),
        prefOn('salesman') && (db.salesmen || []).some((x) => x.companyId === currentCompany.id),
      ].some(Boolean) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prefOn('iec') ? (
          <div>
            <label className="ui-label">
              IEC <span className="ui-subtle font-normal">(if applicable)</span>
            </label>
            <input
              type="text"
              value={formData.iecNumber}
              onChange={(e) => setFormData((p) => ({ ...p, iecNumber: e.target.value }))}
              className="ui-input"
              placeholder="Enter IEC"
            />
          </div>
        ) : null}
        {prefOn('lut') ? (
          <div>
            <label className="ui-label">
              LUT <span className="ui-subtle font-normal">(if applicable)</span>
            </label>
            <input
              type="text"
              value={formData.lutNumber}
              onChange={(e) => setFormData((p) => ({ ...p, lutNumber: e.target.value }))}
              className="ui-input"
              placeholder="Select LUT"
            />
            <p className="mt-1 text-xs ui-muted">Zero-rated export without payment of IGST.</p>
          </div>
        ) : null}
        {prefOn('reverseCharge') ? (
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={!!formData.reverseCharge}
                onChange={(e) => setFormData({ ...formData, reverseCharge: e.target.checked })}
                className="ui-checkbox"
              />
              Reverse charge (RCM)
            </label>
          </div>
        ) : null}
        {prefOn('costCenter') && (db.costCenters || []).some((c) => c.companyId === currentCompany.id) ? (
          <div>
            <label className="ui-label" htmlFor="index-cost-center">Cost Center</label>
            <select id="index-cost-center"
              value={formData.costCenterId || ''}
              onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value ? Number(e.target.value) : '' })}
              className="ui-select"
            >
              <option value="">— none —</option>
              {(db.costCenters || [])
                .filter((c) => c.companyId === currentCompany.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
        ) : null}
        {prefOn('salesman') && (db.salesmen || []).some((s) => s.companyId === currentCompany.id) ? (
          <div>
            <label className="ui-label" htmlFor="index-salesman">Salesman</label>
            <select id="index-salesman"
              value={formData.salesmanId || ''}
              onChange={(e) => setFormData({ ...formData, salesmanId: e.target.value ? Number(e.target.value) : '' })}
              className="ui-select"
            >
              <option value="">— none —</option>
              {(db.salesmen || [])
                .filter((s) => s.companyId === currentCompany.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </div>
        ) : null}
        </div>
      ) : null}


      {[
        prefOn('lut'),
        prefOn('iec'),
        prefOn('shippingBill'),
        multiCurrencyEnabled && prefOn('foreignCurrency'),
        prefOn('transporter'),
        prefOn('lrNumber'),
        prefOn('packages'),
        prefOn('servicePeriod'),
        prefOn('project'),
        prefOn('workOrder'),
        prefOn('timesheetRef'),
      ].some(Boolean) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {prefOn('shippingBill') ? (
            <div>
              <label className="ui-label">Shipping bill</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.shippingBillNo}
                  onChange={(e) => setFormData((p) => ({ ...p, shippingBillNo: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Number"
                />
                <input
                  type="date"
                  value={formData.shippingBillDate}
                  onChange={(e) => setFormData((p) => ({ ...p, shippingBillDate: e.target.value }))}
                  className="ui-input w-40"
                  aria-label="Shipping bill date"
                />
              </div>
              <input
                type="text"
                value={formData.portCode}
                onChange={(e) => setFormData((p) => ({ ...p, portCode: e.target.value }))}
                className="ui-input mt-2"
                placeholder="Port code — INMAA1"
                aria-label="Port code"
              />
            </div>
          ) : null}

          {multiCurrencyEnabled && prefOn('foreignCurrency') ? (
            <div>
              <label className="ui-label">Currency &amp; exchange rate</label>
              <div className="flex gap-2">
                <select
                  value={formData.invoiceCurrency}
                  onChange={(e) => setFormData((p) => ({ ...p, invoiceCurrency: e.target.value.toUpperCase() }))}
                  className="ui-select min-w-40"
                  aria-label="Invoice currency"
                >
                  {enabledCurrencyOptions.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}
                </select>
                {formData.invoiceCurrency && formData.invoiceCurrency !== invoiceBaseCurrency ? <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={formData.exchangeRate}
                  onChange={(e) => setFormData((p) => ({ ...p, exchangeRate: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder={`Rate to ${invoiceBaseCurrency}`}
                  aria-label="Exchange rate"
                  required
                /> : null}
              </div>
              <p className="mt-1 text-xs ui-muted">Recorded on the document. Totals are still kept in INR.</p>
            </div>
          ) : null}

          {/* Switched off by default now — but an invoice that already carries
              a transporter still shows it, because hiding a value that is on
              the document is worse than showing a field nobody asked for. */}
          {prefOn('transporter') || formData.transporterName || formData.vehicleNo ? (
            <div>
              <label className="ui-label">Transporter &amp; vehicle</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.transporterName}
                  onChange={(e) => setFormData((p) => ({ ...p, transporterName: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Transporter"
                />
                <input
                  type="text"
                  value={formData.vehicleNo}
                  onChange={(e) => setFormData((p) => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
                  className="ui-input w-36"
                  placeholder="KA-01-AB-1234"
                  aria-label="Vehicle number"
                />
              </div>
            </div>
          ) : null}

          {prefOn('lrNumber') ? (
            <div>
              <label className="ui-label">LR / GR no.</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.lrNumber}
                  onChange={(e) => setFormData((p) => ({ ...p, lrNumber: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Consignment note"
                />
                <input
                  type="date"
                  value={formData.lrDate}
                  onChange={(e) => setFormData((p) => ({ ...p, lrDate: e.target.value }))}
                  className="ui-input w-40"
                  aria-label="LR date"
                />
              </div>
            </div>
          ) : null}

          {prefOn('packages') ? (
            <div>
              <label className="ui-label" htmlFor="index-packages-amp-weight">Packages &amp; weight</label>
              <input id="index-packages-amp-weight"
                type="text"
                value={formData.packageDetails}
                onChange={(e) => setFormData((p) => ({ ...p, packageDetails: e.target.value }))}
                className="ui-input"
                placeholder="12 packages · 840 kg gross"
              />
            </div>
          ) : null}

          {prefOn('servicePeriod') ? (
            <div>
              <label className="ui-label">Service period</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={formData.servicePeriodFrom}
                  onChange={(e) => setFormData((p) => ({ ...p, servicePeriodFrom: e.target.value }))}
                  className="ui-input flex-1"
                  aria-label="Service period from"
                />
                <input
                  type="date"
                  value={formData.servicePeriodTo}
                  onChange={(e) => setFormData((p) => ({ ...p, servicePeriodTo: e.target.value }))}
                  className="ui-input flex-1"
                  aria-label="Service period to"
                />
              </div>
              <p className="mt-1 text-xs ui-muted">What this fee covers.</p>
            </div>
          ) : null}

          {prefOn('project') ? (
            <div>
              <label className="ui-label" htmlFor="index-project-site">Project / site</label>
              <input id="index-project-site"
                type="text"
                value={formData.projectName}
                onChange={(e) => setFormData((p) => ({ ...p, projectName: e.target.value }))}
                className="ui-input"
                placeholder="Peenya shed"
              />
            </div>
          ) : null}

          {prefOn('workOrder') ? (
            <div>
              <label className="ui-label">Work order &amp; RA bill</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.workOrderNo}
                  onChange={(e) => setFormData((p) => ({ ...p, workOrderNo: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="WO-1182"
                />
                <input
                  type="text"
                  value={formData.raBillNo}
                  onChange={(e) => setFormData((p) => ({ ...p, raBillNo: e.target.value }))}
                  className="ui-input w-32"
                  placeholder="RA-03"
                  aria-label="RA bill number"
                />
              </div>
            </div>
          ) : null}

          {prefOn('timesheetRef') ? (
            <div>
              <label className="ui-label" htmlFor="index-timesheet-reference">Timesheet reference</label>
              <input id="index-timesheet-reference"
                type="text"
                value={formData.timesheetRef}
                onChange={(e) => setFormData((p) => ({ ...p, timesheetRef: e.target.value }))}
                className="ui-input"
                placeholder="TS-2608"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="invoice-lines">
        <div className="ui-sec-head invoice-lines-head">
          <h3>Line Items</h3>
          <div className="invoice-discount-control">
            <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-medium">
              <input
                type="checkbox"
                checked={Boolean(formData.invoiceDiscountEnabled)}
                disabled={financialLocked}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    invoiceDiscountEnabled: event.target.checked,
                    invoiceDiscountValue: event.target.checked ? previous.invoiceDiscountValue : '',
                  }))
                }
              />
              Invoice discount
            </label>
            {formData.invoiceDiscountEnabled ? (
              <>
                <select
                  value={formData.invoiceDiscountType}
                  onChange={(event) => setFormData((previous) => ({ ...previous, invoiceDiscountType: event.target.value }))}
                  disabled={financialLocked}
                  className="ui-select ui-ctl-compact w-[5.25rem]"
                  aria-label="Invoice discount type"
                >
                  <option value="pct">Percent</option>
                  <option value="amt">Amount</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.invoiceDiscountValue}
                  onChange={(event) => setFormData((previous) => ({ ...previous, invoiceDiscountValue: event.target.value }))}
                  disabled={financialLocked}
                  className="ui-input ui-ctl-compact w-24 text-right"
                  placeholder={formData.invoiceDiscountType === 'pct' ? '0%' : '₹0'}
                  aria-label="Invoice discount value"
                />
              </>
            ) : null}
          </div>
        </div>

        {/* The lines are the invoice's economics. Once it is in the books the
            server refuses to change them, and the way that used to be found out
            was to retype the whole table, press Save, and be told by a toast
            that none of it could be kept. `contents` so the fieldset lays
            nothing out of its own. */}
        <fieldset className="contents" disabled={financialLocked}>
        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                {/*
                  Widths, because there were none.

                  Every column took whatever the browser gave it, and the
                  Every cell's control is `w-full`, so these percentages are
                  the whole story. They used to be half of it: the numeric
                  inputs were fixed pixel widths, which left a strip of dead
                  space in each cell that no column width could reclaim, and
                  made the item column look padded while the description ran
                  out of room.
                */}
                <th className="ui-th text-left w-[28%]">Item</th>
                <th className="ui-th text-left w-[20%]">Description</th>
                <th className="ui-th ui-num w-[7%]">
                  Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th text-left w-[6%]">Unit</th>
                <th className="ui-th ui-num w-[11%]">
                  Rate (₹) <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th ui-num w-[7%]">Disc %</th>
                <th className="ui-th ui-num w-[8%]">Tax %</th>
                <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                <th className="px-2 py-1.5 w-9"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => {
                const lineMaster = items.find((i) => String(i.id) === String(item.itemId));
                return (
                <React.Fragment key={idx}>
                <tr className="border-t" data-line-row={idx}>
                  <td className="ui-col-meta px-2 py-1.5">
                    <ItemPicker
                      db={db}
                      setDb={setDb}
                      currentCompany={currentCompany}
                      value={item.itemId}
                      onChange={(itemId, picked) => updateItem(idx, 'itemId', itemId, picked)}
                      label={null}
                      autoFocus={idx === focusRowIndex}
                    />
                    {/*
                      Stock, the moment the item is chosen. Only for goods —
                      a service has no shelf — and only once a line has an
                      item on it.
                    */}
                    {item.itemId && lineMaster && isStockItem(lineMaster) ? (() => {
                      const available = Number(availableFor(item.itemId));
                      const wanted = Number(item.quantity ?? 0);
                      const short = Number.isFinite(wanted) && wanted > available;
                      const unit = String(lineMaster.unit || '').trim();
                      return (
                        <p
                          className="ui-caption mt-1"
                          style={short ? { color: 'rgb(var(--neg))' } : undefined}
                        >
                          {short
                            ? `Only ${available}${unit ? ` ${unit}` : ''} in stock`
                            : `In stock: ${available}${unit ? ` ${unit}` : ''}`}
                        </p>
                      );
                    })() : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      /* A cell in a row is named by its column, which a screen
                         reader does not read as it moves between fields. The
                         line number says which of eight identical boxes it is. */
                      aria-label={`Description for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="1"
                      aria-label={`Quantity for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* The unit belongs to the item, so it is shown rather than
                        asked for. Typing it per line is how two lines of the
                        same item end up billed in different units. */}
                    <span className="text-sm ui-muted">{String(lineMaster?.unit || '').trim() || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      step="0.01"
                      aria-label={`Rate for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={item.discountPct || ''}
                      onChange={(e) => updateItem(idx, 'discountPct', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="0"
                      aria-label={`Discount percent for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {prefOn('lineTaxEditable') ? (
                      <select
                        value={String(item.gstRate ?? 0)}
                        onChange={(e) => updateItem(idx, 'gstRate', e.target.value)}
                        className="ui-select w-full min-w-0 px-2 py-1"
                        aria-label={`GST rate for line ${idx + 1}`}
                      >
                        {[0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28].map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    ) : (
                      // A value, not a disabled control: the rate comes from the
                      // item master, and a greyed-out box invites a fight with a
                      // field that will not move.
                      <span className="ui-num block text-sm">{Number(item.gstRate ?? 0)}%</span>
                    )}
                  </td>
                  <td className="ui-col-amount px-2 py-1.5">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]"
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-soft">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle hidden text-xs lg:inline">or press Tab in the last field of the last row</span>
          <FieldError error={fieldErrors.error('items')} id={fieldErrors.errorId('items')} />
        </div>
        </fieldset>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {/* Discount and charges move the invoice's economics too, so they
                close with the lines. Payment terms and notes below do not, and
                stay editable — the server allows them on a posted invoice. */}
            <fieldset className="contents" disabled={financialLocked}>
            {prefOn('otherCharges') || (formData.otherCharges || []).length > 0 ? (
            <div>
              <label className="ui-label">Other charges (transport, reimbursement…)</label>
              {(formData.otherCharges || []).map((c, ci) => (
                <div key={ci} className="mb-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, label: e.target.value } : x)),
                      }))
                    }
                    className="ui-input flex-1 min-w-0 px-2 text-sm"
                    placeholder="Transport"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={c.amount}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, amount: e.target.value } : x)),
                      }))
                    }
                    className="ui-input w-24 px-2 text-sm"
                    placeholder="Amount"
                  />
                  <select
                    value={c.gstRate}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, gstRate: e.target.value } : x)),
                      }))
                    }
                    className="ui-select w-24 px-2 text-sm"
                  >
                    {[0, 5, 12, 18, 28].map((r) => (
                      <option key={r} value={r}>GST {r}%</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, otherCharges: p.otherCharges.filter((_, i) => i !== ci) }))}
                    className="ui-icon-btn ui-btn-sm !w-8"
                    aria-label="Remove charge"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setFormData((p) => ({ ...p, otherCharges: [...(p.otherCharges || []), { label: '', amount: '', gstRate: 0 }] }))}
                className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
              >
                + Add charge
              </button>
            </div>
            ) : null}
            </fieldset>

            {hasCustomFieldsAt(customFields, 'notes') ? (
              <div className="grid gap-3 sm:grid-cols-2">{renderCustomFields('notes')}</div>
            ) : null}

          </div>
          <div className="flex justify-end">
            {/* The totals sit in the same well the head does, so the figure a
                document is worth is an object rather than a column of text
                trailing off the right edge. */}
            <div className="ui-doc-section invoice-totals w-full max-w-80 space-y-1.5">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
            </div>
            {computed.invoiceDiscount > 0 ? (
              <div className="flex justify-between">
                <span>Discount:</span>
                <span className="text-[rgb(var(--neg-ink))]">− {formatMoney(computed.invoiceDiscount, currentCompany)}</span>
              </div>
            ) : null}
            {computed.invoiceDiscount > 0 || computed.otherChargesTotal > 0 ? (
              <div className="flex justify-between">
                <span>Taxable Amount:</span>
                <span className="ui-money">{formatMoney(computed.subtotal - computed.invoiceDiscount + computed.otherChargesTotal, currentCompany)}</span>
              </div>
            ) : null}
            {computed.otherChargesTotal > 0 ? (
              <div className="flex justify-between">
                <span>Other charges:</span>
                <span className="ui-money">{formatMoney(computed.otherChargesTotal, currentCompany)}</span>
              </div>
            ) : null}
            {isIntra ? (
              <>
                <div className="flex justify-between">
                  <span>CGST:</span>
                  <span className="ui-money">{formatMoney(computed.cgstTotal, currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span>SGST:</span>
                  <span className="ui-money">{formatMoney(computed.sgstTotal, currentCompany)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span>IGST:</span>
                <span className="ui-money">{formatMoney(computed.igstTotal, currentCompany)}</span>
              </div>
            )}
            <div className="ui-total-row border-t pt-2">
              <span>Total:</span>
              <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
            </div>
            {/* Below the total, not inside it: the invoice is for the total,
                and this is what will actually arrive. */}
            {/*
              TDS sits with the total it is taken from, not across the page.

              The section and the rate are how it is chosen, so they live in
              the chooser; once chosen, the line beside the total is the figure
              and the word TDS, because that is what a reader of the totals
              wants. The full section is on the document and in the return.
            */}
            {/*
              Chosen once, then out of the way.
              Section, rate and payee are how a deduction is chosen; none of
              them is what a reader of the totals wants afterwards. Once a
              section is set the chooser folds away and the totals say "TDS"
              and a figure — the section is on the document and in the return,
              which is where it is read.
            */}
            {tdsEnabledHere && !tdsPickerOpen && !formData.tdsSection ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setTdsPickerOpen(true)}
                  className="ui-btn ui-btn-ghost ui-btn-sm !px-0"
                >
                  + TDS deduction <span className="ui-subtle">(if the customer deducts)</span>
                </button>
              </div>
            ) : null}

            {/* Open only while a section is being chosen. Closed, the line
                above offers to open it and the totals carry the figure — both
                at once was the chooser and its own opener on screen together. */}
            <div className="pt-1" hidden={!tdsEnabledHere || !tdsPickerOpen}>
              <label className="ui-label" htmlFor="invoice-tds-section">
                TDS deduction <span className="ui-subtle font-normal">(if the customer deducts)</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="invoice-tds-section"
                  className="ui-select flex-1 min-w-0"
                  value={formData.tdsSection || ''}
                  onChange={(e) => {
                    const code = e.target.value;
                    setFormData((p) => ({
                      ...p,
                      tdsSection: code,
                      tdsRate: code
                        ? p.tdsSection === code && p.tdsRate !== ''
                          ? p.tdsRate
                          : ruleRate(resolveRule(natureForSection(code)?.code, p.date), p.tdsDeducteeType)
                        : '',
                    }));
                    /* Chosen is chosen: the section and rate fold away and the
                       totals carry the figure. "None" leaves it open, because
                       clearing it is not a decision to hide anything. */
                    setTdsPickerOpen(!code);
                  }}
                >
                  <option value="">None</option>
                  {TDS_SECTIONS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} — {t.label} · {t.rate}%
                    </option>
                  ))}
                </select>
                {formData.tdsSection ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      aria-label="TDS rate percent"
                      className="ui-input ui-mono w-16 px-2 py-1.5 text-sm"
                      value={formData.tdsRate === '' ? '' : formData.tdsRate}
                      onChange={(e) => setFormData((p) => ({ ...p, tdsRate: e.target.value }))}
                    />
                    <span className="ui-muted text-sm">%</span>
                  </div>
                ) : null}
              </div>

              {/*
                The payee's own status changes the rate under 194C — 1% for an
                individual or a HUF, 2% for everyone else — so it is asked
                where it changes something and nowhere else.
              */}
              {tdsVariesByDeductee(formData.tdsSection) ? (
                <div className="mt-2">
                  <label className="ui-label" htmlFor="invoice-tds-deductee">
                    Payee is
                  </label>
                  <select
                    id="invoice-tds-deductee"
                    className="ui-select w-full"
                    value={formData.tdsDeducteeType || 'COMPANY'}
                    onChange={(e) => {
                      const type = e.target.value;
                      setFormData((p) => ({
                        ...p,
                        tdsDeducteeType: type,
                        tdsRate: ruleRate(resolveRule(natureForSection(p.tdsSection)?.code, p.date), type),
                      }));
                    }}
                  >
                    {DEDUCTEE_TYPES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/*
                Whether the threshold has been reached, and why. Without this
                the figure simply appears or does not, and a user whose bill is
                under the limit cannot tell a working feature from a broken one.
              */}
              {tdsState ? (
                <p className="ui-caption mt-1.5">
                  {tdsState.crossed
                    ? `${tdsState.reason}. Deducted on ${formatMoney(tdsState.base, currentCompany)}${
                        tdsPriorValue > 0 ? ` — this bill plus ${formatMoney(tdsPriorValue, currentCompany)} billed earlier this year` : ''
                      }.`
                    : `No deduction yet. ${tdsState.reason}.`}
                </p>
              ) : null}
            </div>

            {tdsAmount > 0 ? (
              <>
                <div className="flex justify-between pt-1">
                  {/* Just "TDS" and the figure. The section is chosen above and
                      printed on the document; repeating it here made the
                      totals column read like a tax return. */}
                  <span>
                    Expected TDS
                    {!tdsPickerOpen ? (
                      <button
                        type="button"
                        onClick={() => setTdsPickerOpen(true)}
                        className="ms-2 text-xs underline ui-muted hover:ui-fg"
                      >
                        Change
                      </button>
                    ) : null}
                  </span>
                  <span className="text-[rgb(var(--neg-ink))]">− {formatMoney(tdsAmount, currentCompany)}</span>
                </div>
                {/* The receivable is the whole invoice — §17. What this line
                    says is what the bank is expected to receive once the
                    customer withholds, which is a different figure and not an
                    accounting entry. */}
                <div className="ui-total-row">
                  <span>Expected on receipt:</span>
                  <span className="ui-money">{formatMoney(netReceivable, currentCompany)}</span>
                </div>
              </>
            ) : null}
            </div>
          </div>
        </div>
      </div>

      {prefOn('amountInWords') ? (
        <AmountInWordsBand words={amountInWordsInr(computed.total)} />
      ) : null}

      <DocFormFootnote
        declaration={
          prefOn('declaration')
            ? String(invoiceDocSettings?.templates?.invoice?.declarationText || '').trim() ||
              'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.'
            : ''
        }
      />

      {/* The figure and the one action, kept on screen while the lines are
          typed. What the customer already owes sits here too, because the
          moment to see it is before more credit is extended, not after. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
        </span>
        {customerOutstanding > 0 ? (
          <span className="ui-caption">
            {getCustomerDisplayName(customer) || 'This customer'} owes{' '}
            <span className="ui-money fig">{formatMoney(customerOutstanding, currentCompany)}</span> already
          </span>
        ) : null}
        <FieldErrorSummary errors={fieldErrors.errors} />
      </div>
      {/*
        Batch and expiry, asked once.

        Only for items whose master says they are tracked, only at the moment
        one is chosen, and never as a field on the form afterwards — the
        invoice itself is where the batch is read back.
      */}
      {batchPrompt ? (
        <Modal
          onClose={() => setBatchPrompt(null)}
          title={`Batch — ${items.find((i) => String(i.id) === String(batchPrompt.itemId))?.name || 'item'}`}
          maxWidthClass="max-w-lg"
        >
          {(() => {
            const line = formData.items[batchPrompt.index] || {};
            const options = batchesForItem(db, currentCompany.id, batchPrompt.itemId);
            const need = Number(line.quantity) || 0;
            if (!options.length) {
              return (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: 'rgb(var(--warn-ink))' }}>
                    Nothing of this item is in stock under a batch. Receive it on a bill first, or the invoice will not
                    save.
                  </p>
                  <div className="flex justify-end">
                    <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setBatchPrompt(null)}>
                      Close
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                <p className="text-sm ui-muted">
                  Earliest expiry first. The first batch that can cover {need || 1} is already selected.
                </p>
                <div className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                  {options.map((b) => {
                    const on = String(line.batchId || '') === String(b.id);
                    const short = b.remaining < need;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          updateItem(batchPrompt.index, 'batchId', String(b.id));
                          updateItem(batchPrompt.index, 'batchNo', b.batchNo);
                          updateItem(batchPrompt.index, 'expiryDate', b.expiryDate || '');
                          setBatchPrompt(null);
                        }}
                        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3"
                        style={on ? { backgroundColor: 'rgb(var(--accent-soft))' } : undefined}
                      >
                        <span className="min-w-0">
                          <span className="ui-mono text-sm block truncate">{b.batchNo}</span>
                          <span className="ui-caption">
                            {b.expiryDate ? `Expires ${b.expiryDate}` : 'No expiry recorded'}
                          </span>
                        </span>
                        <span
                          className="ui-mono text-sm shrink-0"
                          style={short ? { color: 'rgb(var(--warn))' } : undefined}
                        >
                          {b.remaining} left
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setBatchPrompt(null)}>
                    Keep the selected batch
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      ) : null}

    </form>
  );
};

export const EstimateForm = ({ db, setDb, currentCompany, initialData = null, onClose, screenTitle = '', screenSubtitle = '', onBack = null }) => {
  const formRef = useRef(null);
  const isEdit = Boolean(initialData && (initialData.id !== undefined && initialData.id !== null));
  const activeBranchId = String(selectedBranchId() || '').trim();
  const estimateDocSettings = getDocSettings(db, currentCompany, { branchId: activeBranchId || null });
  const estimateNumbering = estimateDocSettings?.numbering?.estimate;
  const isEstimateAuto = String(estimateNumbering?.mode || '').toLowerCase() === 'auto';
  const lockEstimateNumberOnCreate = !isEdit && isEstimateAuto && !estimateNumbering?.allowManualOverride;
  const generatedEstimateNumber = !isEdit
    ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'estimate', branchId: activeBranchId || null, takenNumbers: (db.estimates || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) })
    : '';

  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'estimate'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const [formData, setFormData] = useState(() => {
    const defaultDate = todayIso();
    const defaultDueDate = plusDaysIso(30);

    const normalizedItems = Array.isArray(initialData?.items)
      ? initialData.items.map((it) => {
          const quantity = Number(it.quantity ?? 1);
          const rate = Number(it.rate ?? 0);
          const gstRate = Number(it.gstRate ?? 0);
          const amount = Number(it.amount ?? quantity * rate);
          return {
            itemId: it.itemId !== undefined && it.itemId !== null && it.itemId !== '' ? String(it.itemId) : '',
            description: it.description ?? '',
            quantity: Number.isFinite(quantity) ? quantity : 1,
            rate: Number.isFinite(rate) ? rate : 0,
            gstRate: Number.isFinite(gstRate) ? gstRate : 0,
            hsnSac: it.hsnSac || '',
            amount: Number.isFinite(amount) ? amount : 0,
          };
        })
      : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }];

    const nextNumber = isEdit
      ? String(initialData?.number || '')
      : String(generatedEstimateNumber || `EST-${Date.now()}`);

    return {
      number: nextNumber,
      date: initialData?.date || defaultDate,
      dueDate: initialData?.dueDate || defaultDueDate,
      customerId: initialData?.customerId !== undefined && initialData?.customerId !== null ? String(initialData.customerId) : '',
      salesmanId: initialData?.salesmanId ?? '',
      items: normalizedItems,
    };
  });

  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const selectedCustomer = formData.customerId
    ? customers.find((c) => c.id === parseInt(formData.customerId))
    : null;
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    });
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    const newItems = [...formData.items];

    if (field === 'itemId') {
      const item = pickedItem || itemsMaster.find((i) => String(i.id) === String(value));
      if (item) {
        newItems[index] = {
          ...newItems[index],
          itemId: value,
          description: item.name,
          rate: item.salePrice,
          gstRate: Number(item.gstRate ?? 0),
          hsnSac: item.hsnSac || '',
        };
      }
    } else {
      newItems[index][field] = value;
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId' || field === 'discountPct') {
      const computed = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        isIntra,
        discountPct: Number(newItems[index].discountPct ?? 0),
      });
      newItems[index].amount = computed.taxableAmount;
      newItems[index].taxableAmount = computed.taxableAmount;
      newItems[index].gstAmount = computed.gstAmount;
      newItems[index].cgstAmount = computed.cgstAmount;
      newItems[index].sgstAmount = computed.sgstAmount;
      newItems[index].igstAmount = computed.igstAmount;
      newItems[index].lineTotal = computed.lineTotal;
      newItems[index].taxType = computed.taxType;
    }

    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const computed = computeGstForLines({ lines: formData.items, isIntra });

  const handleSubmit = async (e) => {
    e.preventDefault();

    let estimateNumber = String(formData.number || '').trim();
    if (isEstimateAuto && lockEstimateNumberOnCreate) estimateNumber = String(generatedEstimateNumber || '').trim();
    if (!isEdit && isEstimateAuto && !estimateNumber) estimateNumber = String(generatedEstimateNumber || '').trim();
    if (!estimateNumber) {
      notify.error('Quotation number is required');
      return;
    }

    const estimateNumberClash = db.estimates.some(
      (est) =>
        est.companyId === currentCompany.id &&
        String(est.number || '').trim() === estimateNumber &&
        (!isEdit || est.id !== initialData?.id)
    );
    if (estimateNumberClash) {
      notify.error('Quotation number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    if (!formData.customerId) {
      notify.error('Customer is required');
      return;
    }

    /*
     * The master can forbid it. A credit note is how money goes back out
     * without an invoice being raised, so a customer can be marked as one that
     * notes may not be written against — and the switch that says so has to be
     * read somewhere or it is decoration.
     */
    const noteCustomer = (db.customers || []).find((c) => c.id === parseInt(formData.customerId));
    if (noteCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a quotation.');
      return;
    }
    if (noteCustomer && noteCustomer.allowCreditNotes === false) {
      notify.error(
        `Credit notes are switched off for ${noteCustomer.displayName || noteCustomer.name}. Turn them on under the customer's Credit Details.`
      );
      return;
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST estimates.');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line. Items are mandatory for GST.');
      return;
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    const nextEstimateCore = {
      number: estimateNumber,
      date: formData.date,
      dueDate: formData.dueDate,
      customerId: formData.customerId,
      salesmanId: formData.salesmanId || '',
      customerName: getCustomerDisplayName(customer),
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      customFields: { ...(formData.customFields || {}) },
    };

    if (isEdit) {
      const updatedAt = new Date().toISOString();
      setDb({
        ...db,
        estimates: db.estimates.map((est) =>
          est.id === initialData.id
            ? {
                ...est,
                ...nextEstimateCore,
                status: est.status || initialData?.status || 'Draft',
                updatedAt,
              }
            : est
        ),
      });
      onClose?.();
      notify.success('Quotation updated successfully!');
      return;
    }

    // Survives the browser: estimates are quote-stage (no ledger posting),
    // but they still belong on the server, not in this profile's storage.
    let backendDocId = null;
    let serverNumber = '';
    if (hasDocsApiSession()) {
      try {
        const saved = await createDocApi('estimate', {
          number: estimateNumber || undefined,
          date: nextEstimateCore.date,
          validUntil: nextEstimateCore.validUntil || null,
          partyName: nextEstimateCore.customerName || 'Customer',
          subtotal: Number(nextEstimateCore.subtotal || 0),
          gstTotal: Number(nextEstimateCore.gstTotal || 0),
          total: Number(nextEstimateCore.total || 0),
          status: 'Draft',
          items: nextEstimateCore.items || [],
                  salesmanId: formData.salesmanId || undefined,
});
        backendDocId = saved?.id || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Quotation not saved to the server.'));
        return;
      }
    }

    const newEstimate = {
      id: getNextNumericId(db.estimates),
      companyId: currentCompany.id,
      ...nextEstimateCore,
      ...(serverNumber ? { number: serverNumber } : {}),
      backendDocId,
      status: 'Draft',
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      estimates: [...db.estimates, newEstimate],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'estimate', usedNumber: estimateNumber, branchId: activeBranchId || null }),
    });
    onClose?.();
    notify.success('Quotation created successfully!');
  };

  // The shared document contract, so an estimate behaves like the invoice it
  // will become.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.items.length,
    addLine: addItem,
    removeLine: removeItem,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} className="ui-creation-form space-y-3">
      <DocFormActions
        title={screenTitle}
        subtitle={screenSubtitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel={isEdit ? 'Update Quotation' : 'Create Quotation'}
      />

      {/*
        The head of the document, in two columns — the invoice's own shape.

        A quotation becomes an invoice, and the two were laid out differently
        enough that the same fields sat in different places on each: the number
        on the left here and on the right there. Left is who it is for, right is
        the paperwork that identifies it, ruled off between them.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          <CustomerPicker
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            value={formData.customerId}
            onChange={(customerId) => setFormData((prev) => ({ ...prev, customerId }))}
          />
          {selectedCustomer ? (
            <p className="ui-caption -mt-2">
              {[
                customerState ? `Place of supply: ${customerState}` : '',
                customerGstin ? `GSTIN ${customerGstin}` : 'Unregistered',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}

          {(db.salesmen || []).some((sm) => sm.companyId === currentCompany.id) ? (
            <div>
              <label className="ui-label" htmlFor="estimate-salesman">Salesman</label>
              <select
                id="estimate-salesman"
                value={formData.salesmanId || ''}
                onChange={(e) => setFormData({ ...formData, salesmanId: e.target.value ? Number(e.target.value) : '' })}
                className="ui-select"
              >
                <option value="">— none —</option>
                {(db.salesmen || [])
                  .filter((sm) => sm.companyId === currentCompany.id)
                  .map((sm) => (
                    <option key={sm.id} value={sm.id}>{sm.name}</option>
                  ))}
              </select>
            </div>
          ) : null}
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr] gap-3">
            <DocNumberField
              className="min-w-0"
              id="estimate-number"
              label={<>Quotation No. <span className="text-[rgb(var(--neg-ink))]">*</span></>}
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: e.target.value })}
              disabled={lockEstimateNumberOnCreate}
              required
              voucherKey="estimate"
      title="Quotation numbering"
              sampleLabel="Next quotation will be"
              manualLabel="Typed on each quotation"
              settings={estimateNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />

            <div className="min-w-0">
              <label className="ui-label" htmlFor="estimate-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="estimate-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>

            <div className="min-w-0">
              {/* What it is called on the document it becomes: a quotation is
                  not due, it expires. */}
              <label className="ui-label" htmlFor="estimate-valid-until">
                Valid Until <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="estimate-valid-until"
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>
          </div>

          {/* The company's own reference fields belong with the paperwork, not
              in a strip below the totals where the enquiry number this quote
              answers was read after the price. */}
          {hasCustomFieldsAt(customFields, 'header', 'reference') ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
              <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <div className="ui-sec-head">
          <h3>Line Items</h3>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                <th className="ui-th text-left w-[28%]">Item</th>
                <th className="ui-th text-left w-[20%]">Description</th>
                <th className="ui-th ui-num w-[7%]">
                  Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th text-left w-[6%]">Unit</th>
                <th className="ui-th ui-num w-[11%]">
                  Rate (₹) <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th ui-num w-[7%]">Disc %</th>
                <th className="ui-th ui-num w-[8%]">Tax %</th>
                <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => {
                const lineMaster = itemsMaster.find((i) => String(i.id) === String(item.itemId));
                return (
                  <tr key={idx} className="border-t" data-line-row={idx}>
                    <td className="ui-col-meta px-3 py-2">
                      <ItemPicker
                        db={db}
                        setDb={setDb}
                        currentCompany={currentCompany}
                        value={item.itemId}
                        onChange={(itemId, picked) => updateItem(idx, 'itemId', itemId, picked)}
                        label={null}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(idx, 'description', e.target.value)}
                        className="ui-input w-full min-w-0 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="ui-input w-full min-w-0 px-2 py-1"
                        min="1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* The unit belongs to the item, so it is shown rather
                          than asked for. */}
                      <span className="text-sm ui-muted">{String(lineMaster?.unit || '').trim() || '—'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={item.rate}
                        onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                        className="ui-input w-full min-w-0 px-2 py-1"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* A quote is where a discount is argued over, so the
                          line carries one — and it carries it the way the
                          invoice does, or the figure changes on conversion. */}
                      <input
                        type="number"
                        value={item.discountPct || ''}
                        onChange={(e) => updateItem(idx, 'discountPct', e.target.value)}
                        className="ui-input w-full min-w-0 px-2 py-1"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="0"
                        aria-label={`Discount percent for line ${idx + 1}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="ui-num block text-sm">{Number(item.gstRate ?? 0)}%</span>
                    </td>
                    <td className="ui-col-amount px-3 py-2">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => removeItem(idx)} className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]" aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-soft">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
            </div>
            {isIntra ? (
              <>
                <div className="flex justify-between">
                  <span>CGST:</span>
                  <span className="ui-money">{formatMoney(computed.cgstTotal, currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span>SGST:</span>
                  <span className="ui-money">{formatMoney(computed.sgstTotal, currentCompany)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span>IGST:</span>
                <span className="ui-money">{formatMoney(computed.igstTotal, currentCompany)}</span>
              </div>
            )}
            <div className="ui-total-row border-t pt-2">
              <span>Total:</span>
              <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
            </div>
          </div>
        </div>
      </div>

      {hasCustomFieldsAt(customFields, 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="notes" />
        </div>
      ) : null}

      <AmountInWordsBand words={amountInWordsInr(computed.total)} />

      <DocFormFootnote />

      {/* The figure and the line count, kept on screen while the lines are
          typed — the same running total the invoice carries. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
        </span>
      </div>
    </form>
  );
};

/**
 * Why the note was raised.
 *
 * Not decoration: GSTR-1 reports credit notes in the CDNR table and the return
 * carries the reason, so a note without one is a note somebody has to classify
 * again at filing time. The codes are the ones the portal accepts.
 */
export const CREDIT_NOTE_REASONS = [
  { code: '01', label: 'Sales Return' },
  { code: '02', label: 'Post-sale discount' },
  { code: '03', label: 'Deficiency in service' },
  { code: '04', label: 'Correction in invoice' },
  { code: '05', label: 'Change in place of supply' },
  { code: '06', label: 'Finalisation of provisional assessment' },
  { code: '07', label: 'Others' },
];

export const CreditNoteForm = ({ db, setDb, currentCompany, initialOriginalInvoiceId, onClose, warehouses = [], branches = [], defaultWarehouseId = '', screenTitle = '', onBack = null }) => {
  const formRef = useRef(null);
  const companyInvoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };

  const initWarehouseId = String(defaultWarehouseId || '').trim();
  const initBranchId = resolveBranchIdFromWarehouseId(initWarehouseId) || '';
  const creditDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initBranchId || null });
  const creditNumberingInit = creditDocSettingsInit?.numbering?.creditNote;
  const isCreditAutoInit = String(creditNumberingInit?.mode || '').toLowerCase() === 'auto';

  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'creditNote'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const [formData, setFormData] = useState({
    number: isCreditAutoInit ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'creditNote', branchId: initBranchId || null, takenNumbers: (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || '' : '',
    date: new Date().toISOString().split('T')[0],
    originalInvoiceId: '',
    customerId: '',
    warehouseId: String(defaultWarehouseId || '').trim(),
    // The portal wants a reason on every credit note; Sales Return is the one
    // that fits most of them, so it is the default rather than a blank.
    reasonCode: '01',
    refNo: '',
    refDate: '',
    items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
  });

  /*
   * Branch, asked for rather than inferred, and clamped to one that exists —
   * the same treatment the invoice got, for the same reason: the seed can name
   * a branch this user has since lost access to, and a picker with no matching
   * option prints its own value, which is a cuid.
   */
  const [branchId, setBranchId] = useState(() => initBranchId || activeBranchId || '');
  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';
  const branchOptions = useMemo(
    () => (Array.isArray(branches) ? branches : []).slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b))),
    [branches]
  );

  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);

  /** The invoice this note reverses, and the date the portal will ask for. */
  const originalInvoice = useMemo(
    () => companyInvoices.find((i) => String(i.id) === String(formData.originalInvoiceId)) || null,
    // companyInvoices is rebuilt each render from the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData.originalInvoiceId, db.invoices]
  );

  const branchIdForNumbering = resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const creditDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const creditNumbering = creditDocSettings?.numbering?.creditNote;
  const isCreditAuto = String(creditNumbering?.mode || '').toLowerCase() === 'auto';
  const lockCreditNumber = isCreditAuto && !creditNumbering?.allowManualOverride;
  const generatedCreditNumber = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'creditNote', branchId: branchIdForNumbering, takenNumbers: (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  const warehouseOptions = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return list.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses]);

  /**
   * Goods come back in a heap that no single invoice accounts for. Rather than
   * make a clerk guess which one, the note is raised on account: the value
   * waits on the customer's ledger until it is knocked off.
   */
  const [onAccountMode, setOnAccountMode] = useState(false);
  const invoicesForCustomer = useMemo(() => {
    const customerId = String(formData.customerId || '').trim();
    if (!customerId) return [];
    return companyInvoices
      .filter((i) => String(i.customerId ?? '') === customerId)
      .filter((i) => String(i.status || '').toLowerCase() !== 'cancelled')
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyInvoices.length, formData.customerId]);

  const toggleOnAccount = (next) => {
    setOnAccountMode(next);
    setFormData((prev) => ({
      ...prev,
      originalInvoiceId: next ? '' : prev.originalInvoiceId,
      invoiceIds: next ? prev.invoiceIds || [] : [],
    }));
  };

  const [originalInvoiceQuery, setOriginalInvoiceQuery] = useState('');

  const selectedCustomer = formData.customerId ? customers.find((c) => c.id === parseInt(formData.customerId)) : null;
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });
  const computed = computeGstForLines({ lines: formData.items, isIntra });

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    });
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    const newItems = [...formData.items];

    if (field === 'itemId') {
      const item = pickedItem || itemsMaster.find((i) => String(i.id) === String(value));
      if (item) {
        newItems[index] = {
          ...newItems[index],
          itemId: value,
          description: item.name,
          rate: item.salePrice,
          gstRate: Number(item.gstRate ?? 0),
          hsnSac: item.hsnSac || '',
        };
      }
    } else {
      newItems[index][field] = value;
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId' || field === 'discountPct') {
      /* A credit note reverses an invoice line, and an invoice line can carry
         a discount — without it the note returns more than was charged. */
      const computedLine = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        discountPct: Number(newItems[index].discountPct ?? 0),
        isIntra,
      });
      newItems[index].amount = computedLine.taxableAmount;
      newItems[index].taxableAmount = computedLine.taxableAmount;
      newItems[index].gstAmount = computedLine.gstAmount;
      newItems[index].cgstAmount = computedLine.cgstAmount;
      newItems[index].sgstAmount = computedLine.sgstAmount;
      newItems[index].igstAmount = computedLine.igstAmount;
      newItems[index].lineTotal = computedLine.lineTotal;
      newItems[index].taxType = computedLine.taxType;
    }

    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const onSelectOriginalInvoice = (invoiceIdValue) => {
    const invoiceId = parseInt(invoiceIdValue);
    const inv = companyInvoices.find((i) => i.id === invoiceId);

    if (!inv) {
      setFormData({
        ...formData,
        originalInvoiceId: '',
        customerId: '',
        warehouseId: String(defaultWarehouseId || '').trim(),
        items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
      });
      return;
    }

    // Only what has not come back already. A line returned in full is gone
    // from the list; a line half returned offers the other half.
    const state = returnableLines(inv, db.creditNotes || [], 'originalInvoiceId');

    if (state.fullyReturned) {
      notify.error(`${inv.number} has already been fully returned — there is nothing left to credit.`);
      return;
    }

    const copiedItems = state.open.map((line) => {
      const qty = Number(line.remainingQty) || 0;
      const rate = parseFloat(line.rate || 0) || 0;
      const gstRate = parseFloat(line.gstRate || 0);
      return {
        itemId: line.itemId || '',
        description: line.description || '',
        quantity: qty,
        maxQuantity: qty,
        rate,
        gstRate: Number.isFinite(gstRate) ? gstRate : 0,
        hsnSac: line.hsnSac || '',
        amount: qty * rate,
      };
    });

    if (state.partlyReturned) {
      notify.info(`${inv.number} was partly returned already — only the quantities still open are shown.`);
    }

    setFormData({
      ...formData,
      originalInvoiceId: invoiceIdValue,
      customerId: String(inv.customerId || ''),
      warehouseId: String(inv?.warehouseId || formData.warehouseId || defaultWarehouseId || '').trim(),
      items: copiedItems.length
        ? copiedItems
        : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    });

    setOriginalInvoiceQuery(String(inv.number || ''));
  };

  useEffect(() => {
    if (!initialOriginalInvoiceId) return;
    const nextId = String(initialOriginalInvoiceId);
    if (!nextId || nextId === String(formData.originalInvoiceId || '')) return;
    onSelectOriginalInvoice(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOriginalInvoiceId, companyInvoices.length]);

  const onOriginalInvoiceQueryChange = (nextQuery) => {
    const cleaned = String(nextQuery || '').trim();
    setOriginalInvoiceQuery(cleaned);

    const matched = companyInvoices.find(
      (inv) => String(inv.number || '').trim().toLowerCase() === cleaned.toLowerCase()
    );

    if (matched) {
      onSelectOriginalInvoice(String(matched.id));
      return;
    }

    if (String(formData.originalInvoiceId || '').trim()) {
      setFormData((prev) => ({ ...prev, originalInvoiceId: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This credit note');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    let creditNumber = String(formData.number || '').trim();
    if (isCreditAuto) {
      if (lockCreditNumber) creditNumber = String(generatedCreditNumber || '').trim();
      else if (!creditNumber) creditNumber = String(generatedCreditNumber || '').trim();
    }
    if (!creditNumber) {
      notify.error('Credit note number is required');
      return;
    }

    const creditNumberClash = db.creditNotes.some((cn) => cn.companyId === currentCompany.id && String(cn.number || '').trim() === creditNumber);
    if (creditNumberClash) {
      notify.error('Credit note number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    const originalInvoice = companyInvoices.find((i) => i.id === parseInt(formData.originalInvoiceId));
    if (!onAccountMode && !originalInvoice) {
      notify.error('Please select the original invoice');
      return;
    }
    if (onAccountMode && !(formData.invoiceIds || []).length) {
      notify.error('Tick the invoices this return covers.');
      return;
    }

    if (!String(formData.warehouseId || '').trim()) {
      notify.error('Warehouse is required');
      return;
    }

    if (!formData.customerId) {
      notify.error('Customer is required');
      return;
    }
    if (selectedCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a credit note.');
      return;
    }

    // The prefill can be typed over, so the rule is enforced here too: nothing
    // may come back that was not sold, or that has come back already.
    // On account there is no single invoice to check against; the knock-offs
    // are what keep that note honest instead.
    const returnState = onAccountMode
      ? { fullyReturned: false, lines: [] }
      : returnableLines(originalInvoice, db.creditNotes || [], 'originalInvoiceId');
    if (returnState.fullyReturned) {
      notify.error(`${originalInvoice.number} has already been fully returned.`);
      return;
    }
    const remainingByItem = new Map(returnState.lines.map((l) => [String(l.itemId), l.remainingQty]));
    for (const line of onAccountMode ? [] : formData.items || []) {
      const key = String(line.itemId || '');
      if (!key) continue;
      const want = Number(line.quantity) || 0;
      if (want <= 0) continue;
      const canReturn = remainingByItem.get(key);
      if (canReturn === undefined) {
        notify.error(`${line.description || `Item ${key}`} is not on ${originalInvoice.number}.`);
        return;
      }
      if (want > canReturn + 0.0001) {
        notify.error(
          canReturn <= 0
            ? `${line.description || `Item ${key}`} has already been returned in full.`
            : `Only ${canReturn} of ${line.description || `item ${key}`} is still open to return.`
        );
        return;
      }
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST credit notes.');
      return;
    }

    const customerIsRegistered = String(selectedCustomer?.gstRegistration || '').trim().toLowerCase() === 'registered';
    if (customerIsRegistered && !canDetermineSupplyType({ companyState, partyState: customerState })) {
      notify.error('Cannot determine Place of Supply for this registered customer. Please set customer state/address before creating GST credit notes.');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line. Items are mandatory for GST.');
      return;
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    // Server first: a credit note reverses booked revenue, so it must reach
    // the books. The local copy mirrors it for the UI.
    let backendDocId = null;
    let serverNumber = '';
    if (hasDocsApiSession()) {
      try {
        const saved = await createDocApi('creditNote', {
          number: creditNumber || undefined,
          warehouseId: String(formData.warehouseId || originalInvoice?.warehouseId || '').trim() || undefined,
          date: formData.date,
          againstDocId: originalInvoice?.backendInvoiceId ? String(originalInvoice.backendInvoiceId) : null,
          partyId: customer?.backendPartyId ? String(customer.backendPartyId) : null,
          partyName: getCustomerDisplayName(customer) || originalInvoice.customerName || '',
          partyGstin: customerGstin || null,
          placeOfSupplyState: customerState || null,
          taxType: isIntra ? 'CGST_SGST' : 'IGST',
          subtotal: computed.subtotal,
          cgstTotal: computed.cgstTotal,
          sgstTotal: computed.sgstTotal,
          igstTotal: computed.igstTotal,
          gstTotal: computed.gstTotal,
          total: computed.total,
          status: 'Open',
          items: computed.lines,
        });
        backendDocId = saved?.id || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Credit note not saved to the server.'));
        return;
      }
    }

    const newCreditNote = {
      id: getNextNumericId(db.creditNotes),
      companyId: currentCompany.id,
      backendDocId,
      number: serverNumber || creditNumber,
      date: formData.date,
      originalInvoiceId: onAccountMode ? null : originalInvoice.id,
      originalInvoiceNumber: onAccountMode ? '' : originalInvoice.number,
      // GSTR-1 reports a credit note against the original invoice's number and
      // date, and carries the reason it was raised. All three are captured on
      // the document so none has to be reconstructed at filing time.
      originalInvoiceDate: onAccountMode ? '' : String(originalInvoice.date || ''),
      reasonCode: String(formData.reasonCode || '').trim(),
      reasonLabel: CREDIT_NOTE_REASONS.find((r) => r.code === String(formData.reasonCode || '').trim())?.label || '',
      branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
      // On account: the value waits on the customer's ledger until knocked off.
      settlementMode: onAccountMode ? 'ON_ACCOUNT' : 'DOCUMENT',
      invoiceIds: onAccountMode ? (formData.invoiceIds || []).map(String) : [],
      allocations: [],
      customerId: formData.customerId,
      warehouseId: String(formData.warehouseId || '').trim(),
      customerName: getCustomerDisplayName(customer) || originalInvoice?.customerName || '',
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      customFields: { ...(formData.customFields || {}) },
      items: computed.lines,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      /**
       * Issued, not Draft.
       *
       * This was hardcoded to Draft, and the ledger — correctly — does not
       * post drafts. There is no action anywhere to take a credit note out of
       * draft and no status column to reveal it was in one, so every sales
       * return raised through this form was inert: the goods came back on the
       * stock report, the customer's account was never credited, the output
       * GST was never reversed, and the screen said "Credit note created
       * successfully!".
       *
       * An invoice raised from the equivalent button posts immediately. A
       * credit note is the same kind of act in the other direction, and the
       * form has one button whose meaning is "issue this".
       */
      status: 'Open',
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      creditNotes: [...db.creditNotes, newCreditNote],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'creditNote', usedNumber: creditNumber, branchId: branchIdForNumbering }),
    });
    onClose?.();
    notify.success('Credit note created successfully!');
  };

  // The shared document contract, so a credit note answers to the same keys
  // as the invoice it reverses.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.items.length,
    addLine: addItem,
    removeLine: removeItem,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} className="ui-creation-form space-y-3">
      <DocFormActions
        title={screenTitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel="Create Credit Note"
      />

      {/*
        The head of the document, in the invoice's two columns — a credit note
        reverses one, so it is read beside one. Left is who and where the goods
        came back to; right is the paperwork: the note's own number and date,
        why it was raised, and the invoice it answers to.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          <div>
            <label htmlFor="cn-branch" className="ui-label">Branch</label>
            <select
              id="cn-branch"
              className="ui-select w-full"
              value={branchIdInList || ''}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={String(b.id)} value={String(b.id)}>{branchLabel(b)}</option>
              ))}
            </select>
          </div>

          <WarehouseField
            value={formData.warehouseId}
            onChange={(warehouseId) => setFormData((p) => ({ ...p, warehouseId }))}
            options={warehouseOptions}
            activeWarehouseId={defaultWarehouseId}
            isEdit={false}
            className="ui-select"
          />

        <div>
          <CustomerPicker
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            value={formData.customerId}
            onChange={(customerId) => setFormData((prev) => ({ ...prev, customerId }))}
            disabled={Boolean(String(formData.originalInvoiceId || '').trim()) && Boolean(String(formData.customerId || '').trim())}
            disabledHint="Customer comes from the original invoice"
          />
        </div>
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DocNumberField
              className="min-w-0"
              id="cn-number"
              label={<>Credit Note No. <span className="text-[rgb(var(--neg-ink))]">*</span></>}
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: e.target.value })}
              disabled={lockCreditNumber}
              required
              voucherKey="creditNote"
      title="Sales return numbering"
              sampleLabel="Next note will be"
              manualLabel="Typed on each note"
              branchId={branchIdForNumbering}
              settings={creditNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />
            <div className="min-w-0">
              <label className="ui-label" htmlFor="cn-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="cn-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="cn-reason" className="ui-label">
              Reason <span className="text-[rgb(var(--neg-ink))]">*</span>
            </label>
            <select
              id="cn-reason"
              className="ui-select w-full"
              value={formData.reasonCode}
              onChange={(e) => setFormData({ ...formData, reasonCode: e.target.value })}
              required
            >
              {CREDIT_NOTE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="ui-label">
              {onAccountMode ? 'Invoices this return covers' : 'Original Invoice #'}
            </label>
            <button
              type="button"
              onClick={() => toggleOnAccount(!onAccountMode)}
              className="text-xs underline ui-muted hover:ui-fg"
            >
              {onAccountMode ? 'Against a single invoice instead' : 'Goods from several invoices?'}
            </button>
          </div>

          {onAccountMode ? (
            <div className="space-y-2">
              <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                {invoicesForCustomer.length === 0 ? (
                  <div className="text-xs ui-muted px-1">Pick the customer first — their invoices will be listed here.</div>
                ) : (
                  invoicesForCustomer.map((inv) => (
                    <label key={inv.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={(formData.invoiceIds || []).some((id) => String(id) === String(inv.id))}
                        onChange={(e) =>
                          setFormData((prev) => {
                            const set = new Set((prev.invoiceIds || []).map(String));
                            if (e.target.checked) set.add(String(inv.id));
                            else set.delete(String(inv.id));
                            return { ...prev, invoiceIds: [...set] };
                          })
                        }
                      />
                      <span className="truncate">
                        {inv.number} · {inv.date} · {formatMoney(Number(inv.total || 0), currentCompany)}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="text-xs ui-muted">
                The value goes to the customer&apos;s ledger as unsettled, and you knock it off against their invoices
                later — from the Sales Returns list.
              </div>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={originalInvoiceQuery}
                onChange={(e) => onOriginalInvoiceQueryChange(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text');
                  if (typeof pasted === 'string') onOriginalInvoiceQueryChange(pasted);
                }}
                onBlur={() => {
                  // Normalize any pasted value and try one more exact match on blur.
                  onOriginalInvoiceQueryChange(originalInvoiceQuery);
                }}
                list="creditnote-original-invoice-options"
                className="ui-input"
                placeholder="Search / paste invoice number"
                required
              />
              <datalist id="creditnote-original-invoice-options">
                {companyInvoices.map((inv) => (
                  <option key={inv.id} value={String(inv.number || '')} />
                ))}
              </datalist>
              <p className="mt-1 text-xs ui-muted">
                Enter the invoice number to fetch its details. Items, customer and tax are loaded from it.
              </p>
              {/*
                The date of the invoice being reversed, and a way back to it.
                GSTR-1 reports a credit note against the original invoice's
                number *and* date, so a note raised without the date in view is
                one somebody has to go and look up at filing time.
              */}
              {originalInvoice ? (
                <p className="mt-1 text-xs ui-muted flex items-center gap-2 flex-wrap">
                  <span>
                    Original invoice dated <span className="ui-mono">{originalInvoice.date || '—'}</span> ·{' '}
                    {formatMoney(Number(originalInvoice.total || 0), currentCompany)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOriginalPreviewOpen(true)}
                    style={{ color: 'rgb(var(--link))' }}
                    className="font-medium"
                  >
                    View invoice
                  </button>
                </p>
              ) : null}
            </>
          )}
        </div>
        </div>
      </div>

      <div>
        <div className="ui-sec-head">
          <h3>Line Items</h3>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                <th className="ui-th text-left w-[28%]">Item</th>
                <th className="ui-th text-left w-[20%]">Description</th>
                <th className="ui-th ui-num w-[7%]">
                  Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th text-left w-[6%]">Unit</th>
                <th className="ui-th ui-num w-[11%]">
                  Rate (₹) <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th ui-num w-[7%]">Disc %</th>
                <th className="ui-th ui-num w-[8%]">Tax %</th>
                <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => {
                const lineMaster = itemsMaster.find((i) => String(i.id) === String(item.itemId));
                return (
                <tr key={idx} className="border-t" data-line-row={idx}>
                  <td className="ui-col-meta px-3 py-2">
                    <ItemPicker
                      db={db}
                      setDb={setDb}
                      currentCompany={currentCompany}
                      value={item.itemId}
                      onChange={(itemId, picked) => updateItem(idx, 'itemId', itemId, picked)}
                      label={null}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-sm ui-muted">{String(lineMaster?.unit || '').trim() || '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.discountPct || ''}
                      onChange={(e) => updateItem(idx, 'discountPct', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="0"
                      aria-label={`Discount percent for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="ui-num block text-sm">{Number(item.gstRate ?? 0)}%</span>
                  </td>
                  <td className="ui-col-amount px-3 py-2">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => removeItem(idx)} className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]" aria-label={`Remove line ${idx + 1}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-soft">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
            </div>
            {isIntra ? (
              <>
                <div className="flex justify-between">
                  <span>CGST:</span>
                  <span className="ui-money">{formatMoney(computed.cgstTotal, currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span>SGST:</span>
                  <span className="ui-money">{formatMoney(computed.sgstTotal, currentCompany)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span>IGST:</span>
                <span className="ui-money">{formatMoney(computed.igstTotal, currentCompany)}</span>
              </div>
            )}
            <div className="ui-total-row border-t pt-2">
              <span>Total:</span>
              <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
            </div>
          </div>
        </div>
      </div>

      {hasCustomFieldsAt(customFields, 'header', 'reference', 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="notes" />
        </div>
      ) : null}

      <AmountInWordsBand words={amountInWordsInr(computed.total)} />

      <DocFormFootnote />

      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
        </span>
      </div>

      {/* The invoice being reversed, read-only, over the note. Checking what
          was billed should not mean leaving a half-typed credit note. */}
      {originalPreviewOpen && originalInvoice ? (
        <Modal
          onClose={() => setOriginalPreviewOpen(false)}
          title={`Invoice ${originalInvoice.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
        >
          <div className="overflow-x-auto">
            <InvoicePreview db={db} currentCompany={currentCompany} invoice={originalInvoice} />
          </div>
        </Modal>
      ) : null}
    </form>
  );
};

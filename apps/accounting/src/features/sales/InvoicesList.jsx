import { useEffect, useMemo, useRef, useState } from 'react';
import { consumeSearchSeed } from '@ui/utils/searchSeed';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useFeatures } from '@ui/permissions/useFeatures';
import { useGridView } from '@ui/components/grid/useGridView';
import { describeView } from '@ui/components/ListControls';
import { exportListPdf } from '@ui/utils/listPdf';
import { exportListXlsx } from '@ui/utils/listXlsx';
import { exportRows } from '@ui/components/ListToolbar';
import { InvoiceForm } from './InvoiceForm';
import { invoiceChangeBlockReason } from './invoiceChangeGuard';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import RecordReceiptForm from '../payments/RecordReceiptForm';
import { balanceOf, buildReminderMessage, mailtoLink, reminderStage, waLink } from '@ui/utils/reminders';
import { reminderLink } from '../../api/share';
import { partyEmail, partyMobile } from '@ui/utils/contacts';
import { formatMoney } from '@ui/utils/money';
import { Ban, Bell, ChevronDown, ClipboardList, Copy, CreditCard, Download, FileText, Mail, MessageCircle, MoreVertical, Plus, Printer, Receipt, RefreshCw, Settings2, Table2, Trash2 } from 'lucide-react';
import { getInvoicePrintSettings } from '@ui/utils/invoicePrintSettings';
import { getDocSettings } from '@ui/utils/docSettings';
import { printElement } from '@ui/utils/printElement';
import InvoicePreview from './InvoicePreview';
import UpiPayLink from './UpiPayLink';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import { orgId as platformOrgId } from '@platform/context';
import { deleteInvoiceApi, updateInvoiceStatusApi } from '@ui/api/invoices';
import { EmptyState, PageHeader, StatusPill } from '@ui/components/ui/Primitives';
import { ListSearch, StatCards } from '@ui/components/list/ListPageParts';
import GridControls, { BulkBar } from '@ui/components/grid/GridControls';
import Popover from '@ui/components/ui/Popover';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { Balance, DateCell, DueDateCell, InvoiceIdentifier, Money } from '@ui/components/table/cells';
import { MoneyValue } from '@ui/components/docs';
import EInvoiceWorkflow from './EInvoiceWorkflow';
import EwbTransportForm from '@ui/components/EwbTransportForm';
import { eInvoiceIssues, generateEwaybillApi, getEInvoicePayloadApi } from '../../api/einvoice';
import { downloadJson } from '@ui/utils/gstrExport';
import { buildEwayBillPayload } from '@ui/utils/einvoice';
import { CreditNoteForm } from './salesShared';

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
    const { url: shareUrl, note } = await reminderLink(String(invoice.backendInvoiceId || '').trim());
    if (note) notify.info(note);
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
          <div><div className="ui-label">Invoice</div><div className="mt-1 font-medium">{invoice.number}</div></div>
          <div><div className="ui-label">Customer</div><div className="mt-1 font-medium">{invoice.customerName || '—'}</div></div>
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
                        openModal(
                          <EInvoiceWorkflow
                            invoice={inv}
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
                      onClick={async () => {
                        setOpenMenu(null);
                        if (!inv.backendInvoiceId) {
                          notify.error('This invoice has not reached the server yet — e-invoice JSON is built from the saved invoice.');
                          return;
                        }
                        try {
                          const built = await getEInvoicePayloadApi(inv.backendInvoiceId);
                          downloadJson(`EINV_${inv.number}.json`, built.payload);
                          notify.success(`e-Invoice JSON for ${inv.number} downloaded — upload via the NIC bulk tool.`);
                        } catch (err) {
                          notify.error(`e-Invoice JSON for ${inv.number} not made: ${eInvoiceIssues(err).join(' ')}`);
                        }
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

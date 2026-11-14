import React, { useMemo, useRef, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { AlertTriangle, Boxes, Download, Package, PackageCheck, PackageX, Printer, Settings2, Share2 } from 'lucide-react';

import { round2 } from '@ui/utils/money';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import Popover from '@ui/components/ui/Popover';
import Drawer from '@ui/components/ui/Drawer';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { buildItemStockLedger, computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { DocDate } from '@ui/components/docs';
import { csvSafeValue } from '@ui/utils/csv';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { escapeHtml } from '@ui/utils/html';
import { latestPurchaseRate } from '@ui/utils/pricing';

const safeArray = (v) => (Array.isArray(v) ? v : []);


/**
 * One way to put a table on paper.
 *
 * Export PDF and Print are the same document; the only difference is which
 * word the person clicked. Keeping one builder means the printed page and the
 * PDF can never drift apart.
 */
const printableDocument = ({ title, subtitle, head, rows }) => `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 16px; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px 0; }
        .sub { color: #555; font-size: 12px; margin: 0 0 12px 0; }
        table { border-collapse: collapse; width: 100%; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px; }
        th { background: #f5f5f5; text-align: left; }
        td.num, th.num { text-align: right; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">${escapeHtml(subtitle)}</div>
      <table>
        <thead><tr>${head.map((h) => `<th class="${h.num ? 'num' : ''}">${escapeHtml(h.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr>${r
                  .map((cell, i) => `<td class="${head[i]?.num ? 'num' : ''}">${escapeHtml(cell)}</td>`)
                  .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </body>
  </html>`;

const openPrintWindow = (html) => {
  const w = window.open('', '_blank');
  if (!w) {
    notify.error('Popup blocked. Allow popups for this site to print or export a PDF.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
};

const downloadCsv = (filename, rows) => {
  const escape = (v) => {
    // csvSafeValue first: a quoted field is still a formula once the
    // spreadsheet strips the quotes.
    const s = csvSafeValue(v);
    return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/**
 * The period, as a period rather than two dates.
 *
 * Two empty date boxes asked everybody to know the first of the month and
 * type it. These are the four answers people actually want, with the two
 * boxes kept for the fifth.
 */
const PERIOD_OPTIONS = [
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

const iso = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * "This year" means the financial year the business keeps, not January.
 *
 * The company carries its own start as MM-DD, so a book running April to March
 * gets April to March; only a company that has never said otherwise falls back
 * to the calendar.
 */
const periodRange = (id, company) => {
  const today = new Date();
  if (id === 'last30') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: iso(from), to: iso(today) };
  }
  if (id === 'thisMonth') {
    return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  }
  if (id === 'thisYear') {
    const raw = String(company?.fiscalYearStart || '').trim();
    const [mm, dd] = raw.includes('-') ? raw.split('-').map((x) => Number(x)) : [1, 1];
    const month = Number.isFinite(mm) && mm >= 1 && mm <= 12 ? mm - 1 : 0;
    const day = Number.isFinite(dd) && dd >= 1 && dd <= 31 ? dd : 1;
    let start = new Date(today.getFullYear(), month, day);
    if (start > today) start = new Date(today.getFullYear() - 1, month, day);
    return { from: iso(start), to: iso(today) };
  }
  return { from: '', to: '' };
};

const ItemLedgerView = ({ db, currentCompany, itemId, fromDate, toDate, warehouseIds, warehouseName = '' }) => {
  const companyId = currentCompany.id;

  const ledger = useMemo(
    () => buildItemStockLedger({ db, companyId, itemId, fromDate, toDate, warehouseIds }),
    [db, companyId, itemId, fromDate, toDate, warehouseIds]
  );

  if (!ledger.item) {
    return <div className="ui-muted">Item not found</div>;
  }

  const unit = String(ledger.item.unit || '').trim();
  const title = `Stock ledger — ${ledger.item.name}`;
  const subtitle = `Period: ${fromDate || 'Start'} to ${toDate || 'End'}${
    warehouseName ? ` · ${warehouseName}` : ''
  } · Opening ${ledger.openingQty}${unit ? ` ${unit}` : ''}`;

  const HEAD = [
    { label: 'Date' },
    { label: 'Voucher' },
    { label: 'Number' },
    { label: 'In', num: true },
    { label: 'Out', num: true },
    { label: 'Balance', num: true },
  ];

  const bodyRows = ledger.rows.map((r) => [
    r.date || '',
    String(r.voucherType || ''),
    r.voucherNumber || '',
    r.qtyIn || '',
    r.qtyOut || '',
    r.balanceQty,
  ]);

  const paper = () => printableDocument({ title, subtitle, head: HEAD, rows: bodyRows });

  const onPrint = () => openPrintWindow(paper());
  const onExportPdf = () => openPrintWindow(paper());
  const onExportExcel = () =>
    downloadCsv(
      `stock_ledger_${String(ledger.item.code || ledger.item.name || 'item').replace(/[^A-Za-z0-9_-]+/g, '_')}.csv`,
      [HEAD.map((h) => h.label), ...bodyRows]
    );

  /**
   * Share hands over the movements as text.
   *
   * The device sheet where there is one; otherwise the clipboard, which is
   * what every desktop browser can actually do. Silently doing nothing is the
   * one option not on the table.
   */
  const onShare = async () => {
    const text = [
      title,
      subtitle,
      '',
      ...bodyRows.map((r) => r.join('\t')),
    ].join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      notify.success('Stock ledger copied to the clipboard.');
    } catch (err) {
      if (String(err?.name) === 'AbortError') return;
      notify.error('Could not share this ledger.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid grid-cols-2 gap-4 text-sm min-w-0">
          <div>
            <div className="ui-muted">Item</div>
            <div className="font-medium">{ledger.item.name}</div>
          </div>
          <div>
            <div className="ui-muted">Opening Qty</div>
            <div className="font-medium">
              {ledger.openingQty} {unit}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onShare} className="ui-btn ui-btn-secondary ui-btn-sm">
            <Share2 size={14} aria-hidden="true" /> Share
          </button>
          <button type="button" onClick={onPrint} className="ui-btn ui-btn-secondary ui-btn-sm">
            <Printer size={14} aria-hidden="true" /> Print
          </button>
          <button type="button" onClick={onExportPdf} className="ui-btn ui-btn-secondary ui-btn-sm">
            <Download size={14} aria-hidden="true" /> PDF
          </button>
          <button type="button" onClick={onExportExcel} className="ui-btn ui-btn-secondary ui-btn-sm">
            <Download size={14} aria-hidden="true" /> Excel
          </button>
        </div>
      </div>

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th ui-col-h-center">Date</th>
              <th className="ui-th">Voucher</th>
              <th className="ui-th">Number</th>
              <th className="ui-th ui-num">In</th>
              <th className="ui-th ui-num">Out</th>
              <th className="ui-th ui-num">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ledger.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center ui-muted">
                  No movements
                </td>
              </tr>
            ) : (
              ledger.rows.map((r, idx) => (
                <tr key={idx} className="ui-hover-sunken">
                  <td className="ui-col-date px-4 py-3"><DocDate value={r.date} /></td>
                  <td className="ui-col-id px-4 py-3">
                    <div>{String(r.voucherType || '')}</div>
                    {r.voucherNote ? <div className="text-xs ui-muted">{String(r.voucherNote)}</div> : null}
                  </td>
                  <td className="ui-col-meta px-4 py-3">{r.voucherNumber || '-'}</td>
                  <td className="ui-col-meta px-4 py-3 text-right">{r.qtyIn ? r.qtyIn : '-'}</td>
                  <td className="ui-col-meta px-4 py-3 text-right">{r.qtyOut ? r.qtyOut : '-'}</td>
                  <td className="ui-col-meta px-4 py-3 text-right font-medium">{r.balanceQty}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const InventoryModule = ({ db, setDb, openModal, currentCompany, warehouses = [], onOpenItems = null }) => {
  const companyId = currentCompany.id;
  const savedConfig = currentCompany.inventoryConfig || {};
  const showTransferColumns = Boolean(savedConfig.showTransferColumns);
  const valuationMethod = savedConfig.valuationMethod === 'latestPurchase' ? 'latestPurchase' : 'itemPurchase';
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [configurationDraft, setConfigurationDraft] = useState(null);
  const valuationRate = (it) => {
    const rate = valuationMethod === 'latestPurchase'
      ? latestPurchaseRate({ db, companyId, itemId: it.id, item: it }).rate
      : it.purchasePrice;
    const value = Number(rate);
    return Number.isFinite(value) ? value : 0;
  };
  const movementQty = (row, direction) => {
    const total = Number(row?.[direction === 'in' ? 'inQty' : 'outQty'] ?? 0);
    const transfer = Number(row?.[direction === 'in' ? 'transferInQty' : 'transferOutQty'] ?? 0);
    return showTransferColumns ? round2(total - transfer) : total;
  };
  const saveConfiguration = () => {
    if (typeof setDb !== 'function') return;
    setDb((previous) => ({
      ...previous,
      companies: safeArray(previous.companies).map((company) => String(company.id) === String(companyId)
        ? { ...company, inventoryConfig: configurationDraft }
        : company),
    }));
    setConfigurationOpen(false);
    notify.success('Inventory configuration saved.');
  };

  const [viewMode, setViewMode] = useState('qty');
  const [period, setPeriod] = useState('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customPeriodOpen, setCustomPeriodOpen] = useState(false);
  const [branchIds, setBranchIds] = useState([]);
  const [warehouseIds, setWarehouseIds] = useState([]);
  const [locationPicker, setLocationPicker] = useState('');
  const branchPickerRef = useRef(null);
  const warehousePickerRef = useRef(null);
  const colFilters = useColumnFilters();

  const { fromDate, toDate } = useMemo(() => {
    if (period === 'custom') return { fromDate: customFrom, toDate: customTo };
    const r = periodRange(period, currentCompany);
    return { fromDate: r.from, toDate: r.to };
  }, [period, customFrom, customTo, currentCompany]);

  const warehouseOptions = useMemo(() => {
    const list = safeArray(warehouses).filter((w) => !w.companyId || String(w.companyId) === String(companyId));
    return list.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses, companyId]);

  const branchOptions = useMemo(() => safeArray(db.branches)
    .filter((b) => !b.companyId || String(b.companyId) === String(companyId))
    .sort((a, b) => String(a.name || a.branchName || '').localeCompare(String(b.name || b.branchName || ''))), [db.branches, companyId]);
  const selectedBranchIds = branchIds.filter((id) => branchOptions.some((b) => String(b.id) === id));
  const availableWarehouses = warehouseOptions.filter((w) => !selectedBranchIds.length || selectedBranchIds.includes(String(w.branchId)));
  const selectedWarehouseIds = warehouseIds.filter((id) => availableWarehouses.some((w) => String(w.id) === id));
  const allWarehousesSelected = selectedWarehouseIds.length === 0;
  const filteredWarehouseIds = allWarehousesSelected
    ? availableWarehouses.map((w) => String(w.id))
    : selectedWarehouseIds;
  const warehouseFilterKey = filteredWarehouseIds?.join('|') || '';
  const warehouseFilterIds = useMemo(() => filteredWarehouseIds, [warehouseFilterKey, filteredWarehouseIds === null]);
  const toggleSelection = (value, selected, setter) => setter(selected.includes(value) ? selected.filter((id) => id !== value) : [...selected, value]);

  const allStockItems = useMemo(() => {
    return safeArray(db.items)
      .filter((i) => i.companyId === companyId)
      .filter((i) => isStockItem(i))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.items, companyId]);

  const itemSearch = useListSearch(allStockItems, ['name', 'code', 'hsnSac', 'barcode', 'category'], 'inventory');

  const summaryByItemId = useMemo(() => {
    return computeInventorySummaryByItemId({ db, companyId, fromDate, toDate, warehouseIds: warehouseFilterIds });
  }, [db, companyId, fromDate, toDate, warehouseFilterIds]);

  /**
   * The same column filters the invoice list uses.
   *
   * Each extractor hands back the value in that column for the period on
   * screen, so a filter on Closing filters on the closing figure being shown
   * and not on some other reading of the row. Numbers are given as numbers —
   * the filter compares them numerically, which is why 100 sorts after 9.
   */
  const cellValue = (it, key) => {
    const row = summaryByItemId.get(String(it.id));
    const safeRate = valuationRate(it);
    const qty = {
      opening: Number(row?.openingQty ?? 0),
      in: movementQty(row, 'in'),
      out: movementQty(row, 'out'),
      transferIn: Number(row?.transferInQty ?? 0),
      transferOut: Number(row?.transferOutQty ?? 0),
      dn: Number(row?.debitNoteQty ?? 0),
      cn: Number(row?.creditNoteQty ?? 0),
      closing: Number(row?.closingQty ?? 0),
    };
    if (key === 'item') return String(it.name || '');
    const n = qty[key] ?? 0;
    return viewMode === 'value' ? round2(n * safeRate) : n;
  };

  const items = useMemo(
    () =>
      colFilters.apply(itemSearch.filtered, {
        item: (it) => cellValue(it, 'item'),
        opening: (it) => cellValue(it, 'opening'),
        in: (it) => cellValue(it, 'in'),
        out: (it) => cellValue(it, 'out'),
        transferIn: (it) => cellValue(it, 'transferIn'),
        transferOut: (it) => cellValue(it, 'transferOut'),
        dn: (it) => cellValue(it, 'dn'),
        cn: (it) => cellValue(it, 'cn'),
        closing: (it) => cellValue(it, 'closing'),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemSearch.filtered, colFilters, summaryByItemId, viewMode, showTransferColumns, valuationMethod]
  );

  const openLedger = (item) => {
    openModal(
      <ItemLedgerView
        db={db}
        currentCompany={currentCompany}
        itemId={item.id}
        fromDate={fromDate}
        toDate={toDate}
        warehouseIds={warehouseFilterIds}
        warehouseName={selectedWarehouseIds.length === 1 ? availableWarehouses.find((w) => String(w.id) === selectedWarehouseIds[0])?.name : ''}
      />,
      { title: 'Stock Ledger', maxWidthClass: 'max-w-5xl' }
    );
  };

  /*
   * The rows behind every export, built once.
   *
   * There were two exports here — a hand-rolled CSV and a printed HTML page —
   * and each built its own rows, so "Export as Excel" wrote a CSV and there was
   * no way to ask for anything else. Same rows, same columns, three formats.
   */
  const exportRowsForView = () =>
    items
      .map((it) => {
        const r = summaryByItemId.get(String(it.id));
        const safeRate = valuationRate(it);
        const at = (qty) => (viewMode === 'value' ? round2(Number(qty ?? 0) * safeRate) : Number(qty ?? 0));
        return {
          name: it.name || '',
          code: it.code || '',
          unit: String(it.unit || '').trim(),
          opening: at(r?.openingQty),
          in: at(movementQty(r, 'in')),
          out: at(movementQty(r, 'out')),
          transferIn: at(r?.transferInQty),
          transferOut: at(r?.transferOutQty),
          dn: at(r?.debitNoteQty),
          cn: at(r?.creditNoteQty),
          closing: at(r?.closingQty),
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const exportColumnsForView = () => {
    const suffix = viewMode === 'value' ? 'Value' : 'Qty';
    return [
      { key: 'name', label: 'Item' },
      { key: 'code', label: 'Code' },
      { key: 'unit', label: 'Unit' },
      { key: 'opening', label: `Opening ${suffix}` },
      { key: 'in', label: `Purchases ${suffix}` },
      { key: 'out', label: `Sales ${suffix}` },
      ...(showTransferColumns ? [
        { key: 'transferIn', label: `Transfer In ${suffix}` },
        { key: 'transferOut', label: `Transfer Out ${suffix}` },
      ] : []),
      { key: 'dn', label: `DN ${suffix}` },
      { key: 'cn', label: `CN ${suffix}` },
      { key: 'closing', label: `Closing ${suffix}` },
    ];
  };

  const runInventoryExport = (format) =>
    runListExport({
      format,
      title: `Inventory (${viewMode === 'value' ? 'Value' : 'Qty'})`,
      subtitle: `Period: ${fromDate || 'Start'} to ${toDate || 'End'}`,
      fileName: `inventory_${viewMode}_${fromDate || 'all'}_${toDate || 'all'}`,
      label: 'item(s)',
      columns: exportColumnsForView(),
      rows: exportRowsForView(),
    });

  const [invFilter, setInvFilter] = useState('ALL');
  const INV_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'IN', label: 'In stock', tone: 'paid' },
    { value: 'OUT', label: 'Out of stock', tone: 'outstanding' },
    { value: 'NEG', label: 'Negative', tone: 'overdue' },
  ];
  const closingOf = (it) => Number(summaryByItemId.get(String(it.id))?.closingQty ?? 0);
  const invMatches = (it, tab) => {
    const closing = closingOf(it);
    if (tab === 'IN') return closing > 0;
    if (tab === 'OUT') return closing === 0;
    if (tab === 'NEG') return closing < 0;
    return true;
  };
  const shownItems = invFilter === 'ALL' ? items : items.filter((it) => invMatches(it, invFilter));

  const invCounts = useMemo(() => {
    const counts = { ALL: items.length };
    for (const t of INV_TABS) {
      if (t.value === 'ALL') continue;
      counts[t.value] = items.filter((it) => invMatches(it, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, summaryByItemId]);

  const stockKpis = (() => {
    let stockValue = 0;
    let outOfStock = 0;
    let negative = 0;
    for (const it of items) {
      const row = summaryByItemId.get(String(it.id));
      const closing = Number(row?.closingQty ?? 0);
      stockValue += closing * valuationRate(it);
      if (closing === 0) outOfStock += 1;
      if (closing < 0) negative += 1;
    }
    return { stockValue: round2(stockValue), outOfStock, negative };
  })();
  const wholeMoney = (value) => `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;

  return (
    <DocumentListShell
      entity="inventory"
      title="Inventory"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: itemSearch.query,
        onChange: itemSearch.setQuery,
        placeholder: 'Search items…',
        label: 'Search items',
      }}
      headerExtras={
        <>
          <div className="flex items-center gap-1.5">
            <label className="ui-label !mb-0 whitespace-nowrap" htmlFor="inv-view">View</label>
            <select id="inv-view" value={viewMode} onChange={(e) => setViewMode(e.target.value)} className="ui-select ui-ctl-compact px-2 text-xs">
              <option value="qty">Qty</option>
              <option value="value">Value</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="ui-label !mb-0 whitespace-nowrap">Branch</span>
            <button ref={branchPickerRef} type="button" className="ui-btn ui-btn-secondary ui-ctl-compact max-w-40 truncate" aria-label="Branch" aria-expanded={locationPicker === 'branch'} onClick={() => setLocationPicker(locationPicker === 'branch' ? '' : 'branch')}>
              {selectedBranchIds.length === 1
                ? (branchOptions.find((b) => String(b.id) === selectedBranchIds[0])?.name || branchOptions.find((b) => String(b.id) === selectedBranchIds[0])?.branchName)
                : selectedBranchIds.length ? `${selectedBranchIds.length} branches` : 'All branches'}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="ui-label !mb-0 whitespace-nowrap">Warehouse</span>
            <button ref={warehousePickerRef} type="button" className="ui-btn ui-btn-secondary ui-ctl-compact max-w-44 truncate" aria-label="Warehouse" aria-expanded={locationPicker === 'warehouse'} onClick={() => setLocationPicker(locationPicker === 'warehouse' ? '' : 'warehouse')}>
              {selectedWarehouseIds.length === 1
                ? availableWarehouses.find((w) => String(w.id) === selectedWarehouseIds[0])?.name
                : selectedWarehouseIds.length ? `${selectedWarehouseIds.length} warehouses` : 'All warehouses'}
            </button>
          </div>
          {locationPicker ? (
            <Popover anchorRef={locationPicker === 'branch' ? branchPickerRef : warehousePickerRef} onClose={() => setLocationPicker('')} minWidth={230} labelledBy="inventory-location-picker-title">
              <div className="p-2">
                <div id="inventory-location-picker-title" className="px-2 py-1 font-semibold">Select {locationPicker === 'branch' ? 'branches' : 'warehouses'}</div>
                <button type="button" className="ui-hover-sunken w-full px-2 py-1.5 text-left text-sm" onClick={() => locationPicker === 'branch' ? setBranchIds([]) : setWarehouseIds([])}>
                  {locationPicker === 'branch' ? 'All branches' : 'All warehouses'}
                </button>
                {(locationPicker === 'branch' ? branchOptions : availableWarehouses).map((location) => {
                  const id = String(location.id);
                  const selected = locationPicker === 'branch' ? selectedBranchIds : selectedWarehouseIds;
                  return <label key={id} className="ui-hover-sunken flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
                    <input type="checkbox" checked={selected.includes(id)} onChange={() => locationPicker === 'branch' ? toggleSelection(id, selectedBranchIds, setBranchIds) : toggleSelection(id, selectedWarehouseIds, setWarehouseIds)} />
                    <span>{location.name || location.branchName}</span>
                  </label>;
                })}
              </div>
            </Popover>
          ) : null}
        </>
      }
      moreItems={[{ key: 'configuration', label: 'Configuration', Icon: Settings2 }, exportMenuItem('Export stock')]}
      onMoreSelect={(k) => {
        if (k === 'configuration') {
          setConfigurationDraft({ showTransferColumns, valuationMethod });
          setConfigurationOpen(true);
          return;
        }
        const format = exportFormatFromKey(k);
        if (format) runInventoryExport(format);
      }}
      cards={[
        { label: 'Items', value: items.length, count: true, tone: 'draft', Icon: Package },
        { label: 'Stock value', value: wholeMoney(stockKpis.stockValue), tone: 'sent', Icon: Boxes },
        { label: 'In stock', value: invCounts.IN ?? 0, count: true, tone: 'paid', Icon: PackageCheck },
        { label: 'Out of stock', value: stockKpis.outOfStock, count: true, tone: 'outstanding', Icon: PackageX },
        { label: 'Negative', value: stockKpis.negative, count: true, tone: 'overdue', Icon: AlertTriangle },
      ]}
      tabs={INV_TABS}
      tabsLabel="Stock filter"
      statusValue={invFilter}
      statusCounts={invCounts}
      onStatusChange={setInvFilter}
      tabsExtras={
        <>
          <div className="relative flex items-center gap-1.5">
            <label className="ui-label !mb-0 whitespace-nowrap" htmlFor="inv-period">Period</label>
            <select
              id="inv-period"
              value={period}
              onChange={(e) => {
                const next = e.target.value;
                setPeriod(next);
                setCustomPeriodOpen(next === 'custom');
              }}
              className="ui-select ui-ctl-compact px-2 text-xs"
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {customPeriodOpen ? (
            <div className="absolute start-0 top-[calc(100%+0.4rem)] z-30 grid w-80 grid-cols-2 gap-2 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-3 shadow-xl">
              <label className="ui-label">From<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="ui-input mt-1 w-full text-xs" /></label>
              <label className="ui-label">To<input type="date" min={customFrom || undefined} value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="ui-input mt-1 w-full text-xs" /></label>
              <div className="col-span-2 flex justify-end"><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setCustomPeriodOpen(false)}>Apply</button></div>
            </div>
          ) : null}
        </>
      }
      tip={{
        storageKey: 'clor.tip.inventory',
        Icon: Boxes,
        text: 'Stock movements are calculated from posted transactions.',
      }}
    >

      <div className="overflow-x-auto ui-table-scroll inventory-table-scroll" data-fill-viewport>
        <table className="ui-table ui-table-wide ui-table-sticky inventory-stock-table inventory-auto-table">
          {/*
            Plain headings with the same filter control the invoice list uses.
            Each column used to carry its own total stacked above the label,
            which read as a second header row and repeated what the strip above
            the heading now says once.
          */}
          <thead>
            <tr>
              <ColumnHeader label="Item Code" col="code" state={colFilters} />
              <ColumnHeader label="Item Name" col="name" state={colFilters} />
              <ColumnHeader label="UOM" col="unit" state={colFilters} />
              <ColumnHeader label="Opening" col="opening" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Purchases" col="in" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Sales" col="out" state={colFilters} className="ui-num" align="right" />
              {showTransferColumns ? <ColumnHeader label="Transfer In" col="transferIn" state={colFilters} className="ui-num" align="right" /> : null}
              {showTransferColumns ? <ColumnHeader label="Transfer Out" col="transferOut" state={colFilters} className="ui-num" align="right" /> : null}
              <ColumnHeader label="Debit Note" col="dn" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Credit Note" col="cn" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Closing" col="closing" state={colFilters} className="ui-num" align="right" />
            </tr>
          </thead>
          <tbody className="ui-rows">
            {shownItems.length === 0 ? (
              <tr>
                <td colSpan={showTransferColumns ? 11 : 9}>
                  <EmptyState
                    icon={Boxes}
                    kind="new"
      title={items.length ? 'Nothing matches' : 'No stock items yet'}
                    description={
                      items.length
                        ? 'No item in this filter for the chosen warehouse and period.'
                        : 'An item marked as stock appears here with what it opened at, what moved, and what is left.'
                    }
                    routes={
                      !items.length && onOpenItems
                        ? [
                            {
                              label: 'Add an item',
                              description: 'Items live in Master Data — mark one as stock and it appears here.',
                              onSelect: onOpenItems,
                            },
                          ]
                        : undefined
                    }
                  />
                </td>
              </tr>
            ) : null}

            {shownItems.map((it) => {
              const row = summaryByItemId.get(String(it.id));
              const unit = String(it.unit || '').trim();
              const safeRate = valuationRate(it);

              const opening = Number(row?.openingQty ?? 0);
              const stockIn = movementQty(row, 'in');
              const stockOut = movementQty(row, 'out');
              const dn = Number(row?.debitNoteQty ?? 0);
              const cn = Number(row?.creditNoteQty ?? 0);
              const closing = Number(row?.closingQty ?? 0);

              const fmt = (v) => {
                if (viewMode === 'value') return wholeMoney(Number(v || 0) * safeRate);
                return `${Number(v || 0)}`;
              };

              return (
                <tr
                  key={it.id}
                  className="cursor-pointer"
                  onClick={() => openLedger(it)}
      title="Click to view ledger"
                >
                  <td className="ui-col-code">{it.code || '—'}</td>
                  <td className="ui-col-entity">{it.name}</td>
                  <td className="ui-col-uom">{unit || '—'}</td>
                  <td className="ui-col-amount ui-mono">{fmt(opening)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(stockIn)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(stockOut)}</td>
                  {showTransferColumns ? <td className="ui-col-amount ui-mono">{fmt(row?.transferInQty)}</td> : null}
                  {showTransferColumns ? <td className="ui-col-amount ui-mono">{fmt(row?.transferOutQty)}</td> : null}
                  <td className="ui-col-amount ui-mono">{fmt(dn)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(cn)}</td>
                  <td className="ui-col-amount ui-mono font-medium">{fmt(closing)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-2 py-1 text-xs ui-muted">{showTransferColumns ? 'Transfer in/out shown separately; other adjustments remain in Purchases/Sales.' : 'Purchases/Sales include transfer in/out and other stock adjustments.'}</p>
      <TableTotals
        count={shownItems.length}
        totalCount={allStockItems.length}
        noun="items"
        figures={[{ label: 'Stock value', value: wholeMoney(stockKpis.stockValue) }]}
      />
      <Drawer open={configurationOpen} onClose={() => setConfigurationOpen(false)} title="Inventory configuration" actions={<button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={saveConfiguration}>Save</button>}>
        <div className="space-y-6">
          <label className="flex items-start justify-between gap-4">
            <span><strong className="block text-sm">Show Transfer In / Out separately</strong><span className="block text-xs ui-muted mt-1">Separate transfers from Purchases and Sales columns.</span></span>
            <input type="checkbox" className="mt-1" checked={Boolean(configurationDraft?.showTransferColumns)} onChange={(e) => setConfigurationDraft((draft) => ({ ...draft, showTransferColumns: e.target.checked }))} />
          </label>
          <label className="block text-sm font-medium" htmlFor="inventory-valuation-method">Stock valuation method</label>
          <select id="inventory-valuation-method" className="ui-select w-full" value={configurationDraft?.valuationMethod || 'itemPurchase'} onChange={(e) => setConfigurationDraft((draft) => ({ ...draft, valuationMethod: e.target.value }))}>
            <option value="itemPurchase">Item purchase price</option>
            <option value="latestPurchase">Latest purchase cost</option>
          </select>
          <p className="text-xs ui-muted">Used for Value view and stock value totals. Quantity is unchanged.</p>
        </div>
      </Drawer>
    </DocumentListShell>
  );
};

export default InventoryModule;

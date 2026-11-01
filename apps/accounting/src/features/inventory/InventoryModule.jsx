import React, { useMemo, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { AlertTriangle, Boxes, Download, Package, PackageCheck, PackageX, Printer, Share2 } from 'lucide-react';

import { formatMoney, round2 } from '@ui/utils/money';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { buildItemStockLedger, computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { DocDate } from '@ui/components/docs';
import { csvSafeValue } from '@ui/utils/csv';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { escapeHtml } from '@ui/utils/html';

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

const ItemLedgerView = ({ db, currentCompany, itemId, fromDate, toDate, warehouseId, warehouseName = '' }) => {
  const companyId = currentCompany.id;

  const ledger = useMemo(
    () => buildItemStockLedger({ db, companyId, itemId, fromDate, toDate, warehouseId }),
    [db, companyId, itemId, fromDate, toDate, warehouseId]
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

const InventoryModule = ({ db, openModal, currentCompany, warehouses = [], onOpenItems = null }) => {
  const companyId = currentCompany.id;

  const [viewMode, setViewMode] = useState('qty');
  const [period, setPeriod] = useState('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [warehouseId, setWarehouseId] = useState(''); // '' => All warehouses
  const colFilters = useColumnFilters();

  const { fromDate, toDate } = useMemo(() => {
    if (period === 'custom') return { fromDate: customFrom, toDate: customTo };
    const r = periodRange(period, currentCompany);
    return { fromDate: r.from, toDate: r.to };
  }, [period, customFrom, customTo, currentCompany]);

  const warehouseOptions = useMemo(() => {
    const list = safeArray(warehouses);
    return list.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses]);

  const allStockItems = useMemo(() => {
    return safeArray(db.items)
      .filter((i) => i.companyId === companyId)
      .filter((i) => isStockItem(i))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.items, companyId]);

  const itemSearch = useListSearch(allStockItems, ['name', 'code', 'hsnSac', 'barcode', 'category'], 'inventory');

  const summaryByItemId = useMemo(() => {
    return computeInventorySummaryByItemId({ db, companyId, fromDate, toDate, warehouseId });
  }, [db, companyId, fromDate, toDate, warehouseId]);

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
    const rate = Number(it.purchasePrice ?? 0);
    const safeRate = Number.isFinite(rate) ? rate : 0;
    const qty = {
      opening: Number(row?.openingQty ?? 0),
      purchases: Number(row?.purchasesQty ?? 0),
      sales: Number(row?.salesQty ?? 0),
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
        purchases: (it) => cellValue(it, 'purchases'),
        sales: (it) => cellValue(it, 'sales'),
        dn: (it) => cellValue(it, 'dn'),
        cn: (it) => cellValue(it, 'cn'),
        closing: (it) => cellValue(it, 'closing'),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemSearch.filtered, colFilters, summaryByItemId, viewMode]
  );

  const openLedger = (item) => {
    const wh = warehouseOptions.find((w) => String(w.id) === String(warehouseId));
    openModal(
      <ItemLedgerView
        db={db}
        currentCompany={currentCompany}
        itemId={item.id}
        fromDate={fromDate}
        toDate={toDate}
        warehouseId={warehouseId}
        warehouseName={wh?.name || ''}
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
        const rate = Number(it.purchasePrice ?? 0);
        const safeRate = Number.isFinite(rate) ? rate : 0;
        const at = (qty) => (viewMode === 'value' ? round2(Number(qty ?? 0) * safeRate) : Number(qty ?? 0));
        return {
          name: it.name || '',
          code: it.code || '',
          unit: String(it.unit || '').trim(),
          opening: at(r?.openingQty),
          purchases: at(r?.purchasesQty),
          sales: at(r?.salesQty),
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
      { key: 'purchases', label: `Purchases ${suffix}` },
      { key: 'sales', label: `Sales ${suffix}` },
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

  const stockKpis = useMemo(() => {
    let stockValue = 0;
    let outOfStock = 0;
    let negative = 0;
    for (const it of items) {
      const row = summaryByItemId.get(String(it.id));
      const closing = Number(row?.closingQty ?? 0);
      const rate = Number(it.purchasePrice ?? 0);
      stockValue += closing * (Number.isFinite(rate) ? rate : 0);
      if (closing === 0) outOfStock += 1;
      if (closing < 0) negative += 1;
    }
    return { stockValue: round2(stockValue), outOfStock, negative };
  }, [items, summaryByItemId]);

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
      moreItems={[exportMenuItem('Export stock')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runInventoryExport(format);
      }}
      cards={[
        { label: 'Items', value: items.length, count: true, tone: 'draft', Icon: Package },
        { label: 'Stock value', value: stockKpis.stockValue, tone: 'sent', Icon: Boxes },
        { label: 'In stock', value: invCounts.IN ?? 0, count: true, tone: 'paid', Icon: PackageCheck },
        { label: 'Out of stock', value: stockKpis.outOfStock, count: true, tone: 'outstanding', Icon: PackageX },
        { label: 'Negative', value: stockKpis.negative, count: true, tone: 'overdue', Icon: AlertTriangle },
      ]}
      tabs={INV_TABS}
      tabsLabel="Stock filter"
      statusValue={invFilter}
      statusCounts={invCounts}
      onStatusChange={setInvFilter}
      /* View, warehouse and period ride the far end of the status row.
         They changed what every column below means, so they belong to the
         table — but as a band of their own between the pills and the first
         row they were a second toolbar over the list, while the status row
         beside them stood two thirds empty. */
      tabsExtras={
        <>
          <div className="flex items-center gap-1.5">
            <label className="ui-label !mb-0 whitespace-nowrap" htmlFor="inv-view">View</label>
            <select
              id="inv-view"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              className="ui-select ui-ctl-compact px-2 text-xs"
            >
              <option value="qty">Qty</option>
              <option value="value">Value</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="ui-label !mb-0 whitespace-nowrap" htmlFor="inv-warehouse">Warehouse</label>
            <select
              id="inv-warehouse"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="ui-select ui-ctl-compact px-2 text-xs"
            >
              <option value="">All Warehouses</option>
              {warehouseOptions.map((w) => (
                <option key={String(w.id)} value={String(w.id)}>
                  {w.name || `Warehouse ${w.id}`}
                </option>
              ))}
            </select>
          </div>

          {/*
            Label and control on one line, like the two beside it.
            This group wrapped inside itself, so at most widths the word "Period"
            sat on its own line and pushed its select a row lower than View and
            Warehouse — three controls that do the same job, sitting at two
            different heights. The custom dates are their own group now, free to
            wrap onto the next line without taking the label with them.
          */}
          <div className="flex items-center gap-1.5">
            <label className="ui-label !mb-0 whitespace-nowrap" htmlFor="inv-period">Period</label>
            <select
              id="inv-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="ui-select ui-ctl-compact px-2 text-xs"
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {period === 'custom' ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="ui-input !w-[9.5rem] px-2 text-sm"
                aria-label="From date"
              />
              <span className="ui-subtle">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="ui-input !w-[9.5rem] px-2 text-sm"
                aria-label="To date"
              />
            </div>
          ) : null}

          {/* One click back to the defaults — offered only while a filter
              is actually narrowing something. */}
          {viewMode !== 'qty' || warehouseId || period !== 'last30' ? (
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => {
                setViewMode('qty');
                setWarehouseId('');
                setPeriod('last30');
                setCustomFrom('');
                setCustomTo('');
              }}
            >
              Reset
            </button>
          ) : null}
        </>
      }
      tip={{
        storageKey: 'clor.tip.inventory',
        Icon: Boxes,
        text: 'Nothing here is stored — every column is worked out from the bills, invoices and adjustments in the period.',
      }}
    >

      <div className="overflow-x-auto ui-table-scroll inventory-table-scroll" data-fill-viewport>
        <table className="ui-table ui-table-wide ui-table-sticky">
          {/*
            Plain headings with the same filter control the invoice list uses.
            Each column used to carry its own total stacked above the label,
            which read as a second header row and repeated what the strip above
            the heading now says once.
          */}
          <thead>
            <tr>
              <ColumnHeader label="Item" col="item" state={colFilters} />
              <ColumnHeader label="Opening" col="opening" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Purchases" col="purchases" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Sales" col="sales" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="DN (Return)" col="dn" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="CN (Return)" col="cn" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Closing" col="closing" state={colFilters} className="ui-num" align="right" />
            </tr>
          </thead>
          <tbody className="ui-rows">
            {shownItems.length === 0 ? (
              <tr>
                <td colSpan={7}>
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
              const rate = Number(it.purchasePrice ?? 0);
              const safeRate = Number.isFinite(rate) ? rate : 0;

              const opening = Number(row?.openingQty ?? 0);
              const purchases = Number(row?.purchasesQty ?? 0);
              const sales = Number(row?.salesQty ?? 0);
              const dn = Number(row?.debitNoteQty ?? 0);
              const cn = Number(row?.creditNoteQty ?? 0);
              const closing = Number(row?.closingQty ?? 0);

              const fmt = (v) => {
                if (viewMode === 'value') return formatMoney(round2(Number(v || 0) * safeRate), currentCompany);
                return `${Number(v || 0)}${unit ? ` ${unit}` : ''}`;
              };

              return (
                <tr
                  key={it.id}
                  className="cursor-pointer"
                  onClick={() => openLedger(it)}
      title="Click to view ledger"
                >
                  <td className="ui-col-entity">
                    <div>{it.name}</div>
                    <div className="text-xs ui-muted">{it.code || ''}</div>
                  </td>
                  <td className="ui-col-amount ui-mono">{fmt(opening)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(purchases)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(sales)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(dn)}</td>
                  <td className="ui-col-amount ui-mono">{fmt(cn)}</td>
                  <td className="ui-col-amount ui-mono font-medium">{fmt(closing)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TableTotals
        count={shownItems.length}
        totalCount={allStockItems.length}
        noun="items"
        figures={[{ label: 'Stock value', value: formatMoney(stockKpis.stockValue, currentCompany) }]}
      />
    </DocumentListShell>
  );
};

export default InventoryModule;

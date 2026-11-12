import React, { useEffect, useMemo, useState } from 'react';
import { formatMoney, round2 } from '@ui/utils/money';
import { formatDateIn, localDateIso } from '@ui/utils/dates';
import { notify } from '@ui/components/ui/notify';
import { invoiceChangeBlockReason } from '../sales/invoiceChangeGuard';
import { CreditNoteForm, EstimateForm, InvoiceForm } from '../sales';
import { BillForm, DebitNoteForm, PurchaseOrderForm } from '../purchase';
import { ExpenseForm, JournalEntryForm } from '../expenses/ExpenseScreens';
import { buildLedgerStatement } from '../../data/db';
import { exportLedgerToExcel, exportLedgerToPdf, printLedger } from '@ui/utils/ledgerExport';
import { Download } from 'lucide-react';
import { getBalanceSheet, getProfitLoss } from '@ui/api/ledger';
import { hasApiSession } from '@ui/api/purchaseDocs';

// warehouses/activeWarehouseId are needed by the invoice, bill and note editors
// this view opens from a ledger row. They were referenced below without ever
// being props, so opening any of those editors from a ledger threw
// "warehouses is not defined" and the modal never appeared.
export const LedgerView = ({
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
          <div className="text-sm font-medium">{companyProfile.legalName || currentCompany?.name || 'Company'}</div>
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

/**
 * A statement from the server's posted journal lines, when signed in.
 *
 * P&L and the balance sheet were added up from the balances this browser's
 * copy of the books held, so a payroll journal or an entry made on another
 * machine was in the trial balance and missing here. The server builds both
 * from the trial balance itself (services/ledger.ts), so the three agree.
 * Company-wide, as these screens always were: they match the trial balance
 * with "All branches" ticked. Signed out there is no server ledger, and the
 * local figures are the books.
 */
const useLedgerStatement = (load, companyId) => {
  const online = hasApiSession();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!online) return undefined;
    let live = true;
    setData(null);
    load()
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) notify.error(`The statement could not be loaded: ${String(e?.message || e)}`);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, companyId]);
  return { online, data };
};

/**
 * Server rows in the shape the screen draws. A row opens this browser's ledger
 * for the same account — the chart row it was created from, else the one of
 * the same name — and opens nothing when the browser has no such account.
 */
const toScreenRows = (rows, accounts) => {
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const byName = new Map(accounts.map((a) => [String(a.name || '').trim().toLowerCase(), a]));
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const local = (r.sourceKey && byId.get(String(r.sourceKey))) || byName.get(String(r.name || '').trim().toLowerCase());
    return { id: local ? local.id : r.accountId, key: r.accountId, name: r.name, balance: Number(r.balance || 0), openable: Boolean(local) };
  });
};

const openIf = (onOpenLedger, account) => {
  if (onOpenLedger && account.openable !== false) onOpenLedger(account.id);
};

export const ProfitLoss = ({ db, currentCompany, onOpenLedger }) => {
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

  const server = useLedgerStatement(() => getProfitLoss({ to: localDateIso(), allBranches: true }), currentCompany.id);
  const serverIncome = useMemo(() => toScreenRows(server.data?.income, accounts), [server.data, accounts]);
  const serverExpenses = useMemo(() => toScreenRows(server.data?.expenses, accounts), [server.data, accounts]);

  const incomeRows = server.online ? serverIncome : incomeAccounts;
  const expenseRows = server.online ? serverExpenses : expenseAccounts;
  const income = server.online ? Number(server.data?.totals?.income || 0) : incomeAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const expenses = server.online ? Number(server.data?.totals?.expenses || 0) : expenseAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const netProfit = server.online ? Number(server.data?.totals?.netProfit || 0) : income - expenses;

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
            {incomeRows.map((account) => (
                <div key={account.key || account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => openIf(onOpenLedger, account)} className="ui-muted text-left hover:underline">
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
            {expenseRows.map((account) => (
                <div key={account.key || account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => openIf(onOpenLedger, account)} className="ui-muted text-left hover:underline">
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

export const BalanceSheet = ({ db, currentCompany, onOpenLedger }) => {
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

  const server = useLedgerStatement(() => getBalanceSheet({ asOf: localDateIso(), allBranches: true }), currentCompany.id);
  const serverRows = useMemo(
    () => ({
      Asset: toScreenRows(server.data?.assets, accounts),
      Liability: toScreenRows(server.data?.liabilities, accounts),
      Equity: toScreenRows(server.data?.equity, accounts),
    }),
    [server.data, accounts]
  );
  const rowsOf = (cls) => (server.online ? serverRows[cls] : balanceSheetAccounts.filter((a) => a._derivedClass === cls));

  const localSum = (rows, cls) => rows.filter((a) => a._derivedClass === cls).reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const totals = server.data?.totals || {};
  const assets = server.online ? Number(totals.assets || 0) : localSum(balanceSheetAccounts, 'Asset');
  const liabilities = server.online ? Number(totals.liabilities || 0) : localSum(balanceSheetAccounts, 'Liability');
  const equity = server.online ? Number(totals.equity || 0) : localSum(balanceSheetAccounts, 'Equity');
  const netProfit = server.online
    ? Number(totals.currentYearProfit || 0)
    : localSum(pnlAccounts, 'Income') - localSum(pnlAccounts, 'Expense');

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
            {rowsOf('Asset')
              .map((account) => (
                <div key={account.key || account.id} className="flex justify-between py-1 pl-4">
                  <button type="button" onClick={() => openIf(onOpenLedger, account)} className="ui-muted text-left hover:underline">
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
              {rowsOf('Liability')
                .map((account) => (
                  <div key={account.key || account.id} className="flex justify-between py-1 pl-4">
                    <button type="button" onClick={() => openIf(onOpenLedger, account)} className="ui-muted text-left hover:underline">
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
              {rowsOf('Equity')
                .map((account) => (
                  <div key={account.key || account.id} className="flex justify-between py-1 pl-4">
                    <button type="button" onClick={() => openIf(onOpenLedger, account)} className="ui-muted text-left hover:underline">
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

export const CashFlowStatement = ({ db, currentCompany }) => {
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

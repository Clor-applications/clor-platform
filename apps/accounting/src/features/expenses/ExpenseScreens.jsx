import { useListSearch } from '@ui/components/ListToolbar';
import { lazy, useMemo, useRef, useState } from 'react';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { formatMoney, round2 } from '@ui/utils/money';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { selectedBranchId, selectedWarehouseId } from '@platform/context';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import RecordDisbursementForm from '../payments/RecordDisbursementForm';
import { DebitNoteForm } from '../purchase';
import { createDocApi, deleteDocApi, hasApiSession as hasDocsApiSession, updateDocApi } from '@ui/api/purchaseDocs';
import { tdsEventFrom, tdsReversalEventFrom } from '../tds/engine';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { AlertTriangle, Check, ClipboardList, FileText, MoreVertical, Plus, Receipt, Trash2, Upload } from 'lucide-react';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { EmptyState, FieldError, StatusPill } from '@ui/components/ui/Primitives';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { dueDateFor } from '@ui/utils/paymentTerms';
import { blockIfClosed } from '@ui/utils/bookClose';
import { tdsGroupSide, tdsLedgerRate, tdsPayableLedgers } from '@ui/utils/tdsLedgers';
import { natureByCode, natureForSection, resolveRule, ruleReference } from '../tds/ruleMaster';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import VendorPicker from '../../components/pickers/VendorPicker';
import DocNumberField from '@ui/components/DocNumberField';
import LedgerField from '../../components/pickers/LedgerField';
import { postJournalToLedger, reverseJournalOnLedger } from '@ui/utils/journalSync';
import DocHeaderStrip from '@ui/components/ui/DocHeaderStrip';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { normalizeId, ChartAccountForm } from '../../appShared';

const ExpenseVoucher = lazy(() => import('./ExpenseVoucher'));

export const ExpensesList = ({ db, setDb, openModal, currentCompany }) => {
  const expenses = db.expenses.filter((e) => e.companyId === currentCompany.id);
  // This screen had no search at all — the only way to find a voucher was to
  // scroll, or to know its date and narrow the period around it.
  const expenseSearch = useListSearch(expenses, ['number', 'vendorName', 'description', 'refNo', 'date']);
  const [isCreating, setIsCreating] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [expenseActionMenu, setExpenseActionMenu] = useState(null);
  const [expenseStatus, setExpenseStatus] = useState('All');
  const [fromDate] = useState('');
  const [toDate] = useState('');
  const importInputRef = useRef(null);
  const expenseColFilters = useColumnFilters();

  const getDerivedStatus = (expense) => {
    const total = Math.max(0, Number(expense?.total ?? 0) - Number(expense?.tdsAmount ?? 0));
    const paid = Number(expense?.paidAmount ?? 0);

    const raw = String(expense?.status || '').trim();
    if (raw === 'Draft') return 'Draft';
    if (raw === 'Paid') return 'Paid';
    if (total > 0 && paid >= total - 0.0001) return 'Paid';

    const due = expense?.dueDate ? new Date(expense.dueDate) : null;
    const today = new Date();
    if (due && !Number.isNaN(due.getTime())) {
      const dueYmd = due.toISOString().slice(0, 10);
      const todayYmd = today.toISOString().slice(0, 10);
      if (dueYmd < todayYmd && total > 0 && paid < total - 0.0001) return 'Over due';
    }

    if (paid > 0) return 'Partial';
    return 'Unpaid';
  };

  const expensesBeforeStatus = expenseColFilters.applyFilters(
    expenseSearch.filtered
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      date: (r) => r.date,
      vendor: (r) => r.vendorName,
      amount: (r) => r.total,
      gst: (r) => r.gstTotal,
      tds: (r) => r.tdsAmount,
      payable: (r) => Math.max(0, Number(r.total || 0) - Number(r.tdsAmount || 0)),
      status: (r) => getDerivedStatus(r),
    }
  );

  const expenseStatusCounts = expensesBeforeStatus.reduce(
    (counts, expense) => {
      const status = getDerivedStatus(expense);
      counts.All += 1;
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    },
    { All: 0, Draft: 0, Unpaid: 0, Partial: 0, Paid: 0, 'Over due': 0 }
  );
  const filteredExpenses = expenseStatus === 'All'
    ? expensesBeforeStatus
    : expensesBeforeStatus.filter((expense) => getDerivedStatus(expense) === expenseStatus);


  const ledgerNamesOf = (e) =>
    (Array.isArray(e?.lines) ? e.lines : []).map((l) => l.ledgerName).filter(Boolean).join('; ');

  const exportExpenses = (format = 'csv') => {
    if (!filteredExpenses.length) {
      notify.error('Nothing to export in the current view.');
      return;
    }
    runListExport({
      format,
      title: 'Expenses',
      label: 'expense(s)',
      fileName: `Expenses_${currentCompany?.name || 'company'}${fromDate || toDate ? `_${fromDate || 'start'}_to_${toDate || 'today'}` : ''}`,
      columns: [
        { key: 'number', label: 'Voucher No' },
        { key: 'date', label: 'Date' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'refNo', label: 'Vendor Inv No' },
        { key: 'refDate', label: 'Vendor Inv Date' },
        { key: 'description', label: 'Narration' },
        { key: 'ledgers', label: 'Expense Ledgers', value: (r) => ledgerNamesOf(r) },
        { key: 'taxable', label: 'Taxable', value: (r) => round2(Number(r.subtotal ?? r.taxableTotal ?? 0)) },
        { key: 'gstTotal', label: 'GST', value: (r) => round2(Number(r.gstTotal ?? 0)) },
        { key: 'total', label: 'Total', value: (r) => round2(Number(r.total ?? 0)) },
        { key: 'paidAmount', label: 'Paid', value: (r) => round2(Number(r.paidAmount ?? 0)) },
        { key: 'status', label: 'Status', value: (r) => getDerivedStatus(r) },
      ],
      rows: filteredExpenses,
    });
  };

  const downloadImportTemplate = () => {
    downloadCsvTemplate({
      fileName: 'Expense_Import_Template',
      columns: [
        { key: 'Date', label: 'Date' },
        { key: 'Vendor', label: 'Vendor' },
        { key: 'Vendor Inv No', label: 'Vendor Inv No' },
        { key: 'Vendor Inv Date', label: 'Vendor Inv Date' },
        { key: 'Narration', label: 'Narration' },
        { key: 'Expense Ledger', label: 'Expense Ledger' },
        { key: 'Description', label: 'Description' },
        { key: 'Amount', label: 'Amount' },
        { key: 'GST %', label: 'GST %' },
      ],
      sample: {
        Date: new Date().toISOString().slice(0, 10),
        Vendor: 'ABC Trading Co.',
        'Vendor Inv No': 'INV-2024-058',
        'Vendor Inv Date': new Date().toISOString().slice(0, 10),
        Narration: 'Office rent for the month',
        'Expense Ledger': 'Office Rent',
        Description: 'Monthly rent',
        Amount: '25000',
        'GST %': '18',
      },
    });
    notify.success('Template downloaded. One row per expense line; rows sharing a Vendor Inv No become one voucher.');
  };

  const importExpenses = async (file) => {
    try {
      const { rows } = parseCsv(await readFileText(file));
      if (!rows.length) {
        notify.error('That file has no data rows.');
        return;
      }

      const ledgers = (db.chartOfAccounts || []).filter((a) => a.companyId === currentCompany.id);
      const findLedger = (name) =>
        ledgers.find((l) => String(l.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
      const vendorsList = (db.vendors || []).filter((v) => v.companyId === currentCompany.id);
      const findVendor = (name) =>
        vendorsList.find((v) => getVendorDisplayName(v).trim().toLowerCase() === String(name || '').trim().toLowerCase());

      // Lines that share a vendor invoice number (or, failing that, a
      // date+vendor) belong to one voucher — the same grouping the entry form
      // produces.
      const groups = new Map();
      const problems = [];
      rows.forEach((r, i) => {
        const ledgerName = r['Expense Ledger'] || '';
        const ledger = findLedger(ledgerName);
        const amount = Number(r.Amount || 0);
        if (!ledger) {
          problems.push(`Row ${i + 2}: no ledger named "${ledgerName}"`);
          return;
        }
        if (!(amount > 0)) {
          problems.push(`Row ${i + 2}: amount must be greater than zero`);
          return;
        }
        const key = String(r['Vendor Inv No'] || '').trim() || `${r.Date}|${r.Vendor}`;
        if (!groups.has(key)) groups.set(key, { head: r, lines: [] });
        groups.get(key).lines.push({ ledger, description: r.Description || '', amount, gstRate: Number(r['GST %'] || 0) });
      });

      if (!groups.size) {
        notify.error(problems[0] || 'Nothing importable in that file.');
        return;
      }

      const { state: companyState } = getCompanyGstProfile(currentCompany);
      let nextId = (db.expenses || []).reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0);
      const activeBranchId = normalizeId(selectedBranchId() || '');
      let seq = 0;
      const created = [];

      // Reserve a free number per voucher up front, so an import can never
      // hand out a number the book already uses.
      const usedNumbers = (db.expenses || [])
        .filter((e) => e.companyId === currentCompany.id)
        .map((e) => String(e.number || '').trim());
      const importedNumbers = [];
      for (let i = 0; i < groups.size; i += 1) {
        const n = nextFreeVoucherNumber({
          db,
          company: currentCompany,
          voucherKey: 'expense',
          branchId: activeBranchId || null,
          takenNumbers: [...usedNumbers, ...importedNumbers],
        });
        importedNumbers.push(n);
      }

      for (const { head, lines } of groups.values()) {
        const vendor = findVendor(head.Vendor);
        const { state: vendorState, gstin: vendorGstin, gstRegistration } = getPartyGstProfile(vendor);
        const isIntra = isIntraStateSupply({ companyState, partyState: vendorState });
        const charges = String(gstRegistration || '').trim().toLowerCase() === 'registered';

        const built = lines.map((l) => {
          const rate = charges ? l.gstRate : 0;
          const gstAmount = round2((l.amount * rate) / 100);
          return {
            ledgerId: l.ledger.id,
            ledgerName: l.ledger.name,
            description: l.description,
            amount: round2(l.amount),
            gstRate: rate,
            gstAmount,
            cgstAmount: isIntra ? round2(gstAmount / 2) : 0,
            sgstAmount: isIntra ? round2(gstAmount / 2) : 0,
            igstAmount: isIntra ? 0 : gstAmount,
            lineTotal: round2(l.amount + gstAmount),
          };
        });
        const subtotal = round2(built.reduce((t, l) => t + l.amount, 0));
        const gstTotal = round2(built.reduce((t, l) => t + l.gstAmount, 0));
        seq += 1;
        created.push({
          id: ++nextId,
          companyId: currentCompany.id,
          number: importedNumbers[seq - 1] || `EXP-IMP-${nextId}`,
          date: String(head.Date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          dueDate: String(head.Date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          refNo: head['Vendor Inv No'] || '',
          refDate: String(head['Vendor Inv Date'] || '').slice(0, 10),
          description: head.Narration || '',
          vendorId: vendor?.id ?? '',
          vendorName: getVendorDisplayName(vendor),
          vendorGstin,
          placeOfSupplyState: vendorState,
          taxType: isIntra ? 'CGST_SGST' : 'IGST',
          lines: built,
          subtotal,
          taxableTotal: subtotal,
          cgstTotal: round2(built.reduce((t, l) => t + l.cgstAmount, 0)),
          sgstTotal: round2(built.reduce((t, l) => t + l.sgstAmount, 0)),
          igstTotal: round2(built.reduce((t, l) => t + l.igstAmount, 0)),
          gstTotal,
          total: round2(subtotal + gstTotal),
          amount: subtotal,
          paidAmount: 0,
          status: 'Unpaid',
          branchId: activeBranchId || '',
          warehouseId: String(selectedWarehouseId() || '').trim(),
          importedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      }

      setDb((prev) => {
        let companies = prev.companies;
        for (const row of created) {
          companies = bumpCompanyNextNumber({
            db: { ...prev, companies },
            companyId: currentCompany.id,
            voucherKey: 'expense',
            usedNumber: row.number,
            branchId: activeBranchId || null,
          });
        }
        return { ...prev, expenses: [...(prev.expenses || []), ...created], companies };
      });
      notify.success(
        `${created.length} expense voucher(s) imported${problems.length ? `. ${problems.length} row(s) skipped: ${problems[0]}` : '.'}`
      );
    } catch (err) {
      notify.error(String(err?.message || 'Import failed.'));
    }
  };

  const openVoucher = (expense) => {
    openModal(
      <ExpenseVoucher expense={expense} currentCompany={currentCompany} db={db} />,
      { title: `Expense ${expense?.number || ''}`.trim(), maxWidthClass: 'max-w-4xl' }
    );
  };

  /* The same payment record as everywhere else, opened with this expense's
     vendor and balance already in it — so a payment that also carries a bank
     charge or a TDS deduction is one record, not this one plus a journal. */
  const openRecordPayment = (expense) => {
    openModal(
      <RecordDisbursementForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={{
          vendorId: expense?.vendorId ? String(expense.vendorId) : '',
          amount: String(Math.max(0, Number(expense?.total ?? 0) - Number(expense?.tdsAmount ?? 0) - Number(expense?.paidAmount ?? 0)) || ''),
          date: new Date().toISOString().slice(0, 10),
        }}
        onClose={() => openModal(null)}
      />
    );
  };

  const raiseExpenseCreditNote = (expense) => {
    openModal(
      <DebitNoteForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={{
          date: new Date().toISOString().slice(0, 10),
          vendorId: expense?.vendorId ? String(expense.vendorId) : '',
          items: (expense?.lines || []).map((line) => ({
            description: line.ledgerName || line.description || 'Expense credit',
            quantity: 1,
            rate: Number(line.amount || 0),
            gstRate: Number(line.gstRate || 0),
          })),
        }}
        screenTitle="Raise Credit Note"
        onClose={() => openModal(null)}
      />,
      { title: 'Raise Credit Note', maxWidthClass: 'max-w-5xl' }
    );
  };

  const deleteExpense = async (expense) => {
    // A paid expense is undone by reversing its payment first; the server
    // refuses too, but an expense kept only in this browser had no check.
    const settled = Number(expense?.paidAmount || expense?.settledAmount || 0);
    if (settled > 0.005 || /^(paid|partial|partially paid|partly paid)$/i.test(String(expense?.status || '').trim())) {
      notify.error(`${expense?.number || 'This expense'} has been paid in whole or part. Reverse the payment first, then delete it.`);
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete expense?',
      message: `Delete expense ${expense?.number || ''}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (expense?.backendDocId && hasDocsApiSession()) {
      try {
        await deleteDocApi('expense', expense.backendDocId);
      } catch (err) {
        notify.error(String(err?.message || 'Expense could not be deleted.'));
        return;
      }
    }
    setDb((prev) => {
      const events = Array.isArray(prev.tdsTransactions) ? prev.tdsTransactions : [];
      const mine = events.filter(
        (event) =>
          Number(event?.companyId) === Number(currentCompany.id) &&
          String(event?.sourceType) === 'expense' &&
          String(event?.sourceId) === String(expense.id) &&
          String(event?.status).toLowerCase() === 'posted' &&
          !event?.reversalOfId
      );
      let nextEventId = events.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);
      const stamp = new Date().toISOString();
      const reversals = mine.map((event) => ({
        ...tdsReversalEventFrom(event, { reason: `Expense ${expense?.number || expense.id} deleted` }),
        id: ++nextEventId,
      }));
      const nextEvents = mine.length
        ? [
            ...events.map((event) =>
              mine.some((row) => row.id === event.id)
                ? { ...event, status: 'Reversed', modifiedBy: reversals[0]?.createdBy || 'User', modifiedAt: stamp }
                : event
            ),
            ...reversals,
          ]
        : events;
      return {
        ...prev,
        tdsTransactions: nextEvents,
        expenses: (prev.expenses || []).filter((row) => String(row.id) !== String(expense.id)),
      };
    });
    notify.success('Expense deleted.');
  };

  const EXPENSE_STATUS_TABS = [
    { value: 'All', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Unpaid', label: 'Unpaid', tone: 'sent' },
    { value: 'Partial', label: 'Partly paid', tone: 'partial' },
    { value: 'Paid', label: 'Paid', tone: 'paid' },
    { value: 'Over due', label: 'Overdue', tone: 'overdue' },
  ];

  if (isCreating) {
    return (
      <div className="space-y-3">
        <div className="ui-surface rounded-xl shadow-sm border p-3">
          <ExpenseForm
            key={editingExpense?.id ? `expense-${editingExpense.id}` : 'expense-new'}
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            openModal={openModal}
            screenTitle={editingExpense ? `Edit Expense ${editingExpense.number || ''}`.trim() : 'New Expense'}
            initialData={editingExpense}
            onBack={() => { setEditingExpense(null); setIsCreating(false); }}
            onClose={() => { setEditingExpense(null); setIsCreating(false); }}
          />
        </div>
      </div>
    );
  }


  const expenseFlow = (() => {
    const active = expenses.filter((e) => String(e?.status || '') !== 'Draft');
    const total = active.reduce((sum, e) => sum + Number(e?.total || 0), 0);
    const paid = active.reduce((sum, e) => sum + Math.min(Number(e?.paidAmount || 0), Number(e?.total || 0)), 0);

    /*
     * What is late, as its own figure.
     *
     * Outstanding says what is owed and overdue says what is a problem, and the
     * two were one number — so a book with nothing late read the same as a book
     * three months behind.
     */
    const overdue = active.reduce((sum, e) => {
      if (getDerivedStatus(e) !== 'Over due') return sum;
      const owed = Math.max(0, Number(e?.total || 0) - Number(e?.paidAmount || 0));
      return sum + owed;
    }, 0);

    return { total, paid, unpaid: Math.max(0, total - paid), overdue, count: active.length };
  })();


  return (
    <DocumentListShell
      entity="expense"
      title="Expenses"
      company={currentCompany}
      search={{
        before: (
          <select
            value={expenseStatus}
            onChange={(event) => setExpenseStatus(event.target.value)}
            className="ui-select ui-ctl-compact w-36"
            aria-label="Expense status"
          >
            {EXPENSE_STATUS_TABS.map((item) => (
              <option key={item.value} value={item.value}>{item.label} ({expenseStatusCounts[item.value] || 0})</option>
            ))}
          </select>
        ),
        value: expenseSearch.query,
        onChange: expenseSearch.setQuery,
        placeholder: 'Search expenses…',
        label: 'Search expenses',
      }}
      moreItems={[
        exportMenuItem('Export expenses'),
        { key: 'template', label: 'Download import template', Icon: FileText },
        { key: 'import', label: 'Import expenses', Icon: Upload },
      ]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) exportExpenses(format);
        else if (k === 'template') downloadImportTemplate();
        else if (k === 'import') importInputRef.current?.click();
      }}
      primary={
        <PermissionButton
          permission="EXPENSES::Expenses::CREATE"
          onClick={() => { setEditingExpense(null); setIsCreating(true); }}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} aria-hidden="true" /> New Expense
        </PermissionButton>
      }
      cards={[
        { label: 'Expenses', value: expenseFlow.count, count: true, tone: 'draft', Icon: ClipboardList },
        { label: 'Spend', value: expenseFlow.total, tone: 'sent', Icon: Receipt },
        { label: 'Paid', value: expenseFlow.paid, tone: 'paid', Icon: Check },
        { label: 'Outstanding', value: expenseFlow.unpaid, tone: 'outstanding', Icon: FileText },
        /* The average voucher stood here and answered nothing anybody asks of a
           list of expenses; what is late is the figure somebody opens this
           screen for. */
        { label: 'Overdue', value: expenseFlow.overdue, tone: 'overdue', Icon: AlertTriangle },
      ]}
      denseCards
      above={
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            e.target.value = '';
            if (f) importExpenses(f);
          }}
        />
      }
    >
      <div className="ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky table-fixed">
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '44px' }} />
          </colgroup>
          <thead>
            <tr>
              <ColumnHeader label="Voucher No." col="number" state={expenseColFilters} className="text-sm font-semibold" />
              <ColumnHeader label="Date" col="date" state={expenseColFilters} type="date" className="text-sm font-semibold" align="center" />
              <ColumnHeader label="Vendor" col="vendor" state={expenseColFilters} className="text-sm font-semibold" />
              <ColumnHeader label="Amount" col="amount" state={expenseColFilters} type="number" className="ui-num text-sm font-semibold" align="right" />
              <ColumnHeader label="GST" col="gst" state={expenseColFilters} type="number" className="ui-num text-sm font-semibold" align="right" />
              <ColumnHeader label="TDS" col="tds" state={expenseColFilters} type="number" className="ui-num text-sm font-semibold" align="right" />
              <ColumnHeader label="Payable Amount" col="payable" state={expenseColFilters} type="number" className="ui-num text-sm font-semibold" align="right" />
              <ColumnHeader label="Status" col="status" align="center" state={expenseColFilters} type="choice" className="text-sm font-semibold" />
              <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan="9" className="p-0">
                  {/*
                    Was the bare words "No expenses found", where Bills gets an
                    icon, a sentence explaining what the record is for, and a
                    button to make one. Same component now, and it tells the
                    two cases apart: nothing recorded yet, against filters
                    hiding what is there.
                  */}
                  <EmptyState
                    icon={Receipt}
                    kind={expenses.length ? 'filtered' : 'new'}
                    totalCount={expenses.length}
      title={expenses.length ? 'No expenses match these filters' : 'No expenses yet'}
                    description={
                      expenses.length
                        ? 'Widen the period or clear the status filter to see the rest.'
                        : 'An expense voucher is money the business spent, and the input GST you can claim against it.'
                    }
                    action={
                      expenses.length ? null : (
                        <PermissionButton
                          permission="EXPENSES::Expenses::CREATE"
                          onClick={() => { setEditingExpense(null); setIsCreating(true); }}
                          className="ui-btn ui-btn-primary"
                        >
                          <Plus size={16} /> New Expense
                        </PermissionButton>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              filteredExpenses.map((expense) => {
                const derived = getDerivedStatus(expense);
                const expensePayable = Math.max(0, Number(expense.total || 0) - Number(expense.tdsAmount || 0));
                return (
                  <tr
                    key={expense.id}
                    className="ui-hover-sunken cursor-pointer"
                    onClick={(e) => {
                      if (e.target?.closest?.('button')) return;
                      openVoucher(expense);
                    }}
                  >
                  <td className="px-3 py-2 ui-col-entity">{expense.number || '-'}</td>
                  <td className="px-3 py-2 ui-col-meta">{expense.date}</td>
                  <td className="px-3 py-2 ui-col-entity">{expense.vendorName || '-'}</td>
                  <td className="px-3 py-2 ui-col-amount">{formatMoney(expense.total, currentCompany)}</td>
                  <td className="px-3 py-2 ui-col-amount">{formatMoney(expense.gstTotal || 0, currentCompany)}</td>
                  <td className="px-3 py-2 ui-col-amount">{formatMoney(expense.tdsAmount || 0, currentCompany)}</td>
                  <td className="px-3 py-2 ui-col-amount">{formatMoney(expensePayable, currentCompany)}</td>
                  <td className="px-3 py-2 ui-col-meta whitespace-nowrap">
                    <StatusPill status={derived} />
                  </td>
                  <td className="ui-action-col text-center" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md ui-hover-sunken"
                      aria-label="Expense actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setExpenseActionMenu((current) => current?.id === expense.id ? null : { id: expense.id, rect });
                      }}
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
      {expenseActionMenu ? (() => {
        const expense = expenses.find((row) => String(row.id) === String(expenseActionMenu.id));
        if (!expense) return null;
        const derived = getDerivedStatus(expense);
        const width = 192;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, expenseActionMenu.rect.right - width));
        const top = Math.max(8, Math.min(window.innerHeight - 190, expenseActionMenu.rect.bottom + 4));
        return (
          <div
            className="fixed z-50 w-48 ui-surface border ui-border-c rounded-lg shadow-lg overflow-hidden"
            style={{ left, top }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={() => { setExpenseActionMenu(null); setEditingExpense(expense); setIsCreating(true); }}>Edit</button>
            <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken disabled:opacity-50" disabled={derived === 'Paid' || derived === 'Draft'} onClick={() => { setExpenseActionMenu(null); openRecordPayment(expense); }}>Record Payment</button>
            <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken" onClick={() => { setExpenseActionMenu(null); raiseExpenseCreditNote(expense); }}>Raise Credit Note</button>
            <button type="button" className="w-full px-3 py-2 text-left text-sm ui-hover-sunken text-[rgb(var(--neg))]" onClick={() => { setExpenseActionMenu(null); deleteExpense(expense); }}>Delete</button>
          </div>
        );
      })() : null}
    </DocumentListShell>
  );
};

const emptyExpenseLine = () => ({ ledgerId: '', description: '', amount: '', gstRate: 0 });

/** Only expense ledgers explicitly marked TDS-applicable form the deduction base. */
export const expenseTdsBase = (lines = [], ledgers = []) => {
  const applicable = new Set(
    (Array.isArray(ledgers) ? ledgers : [])
      .filter((ledger) => ledger?.tdsApplicable === true)
      .map((ledger) => String(ledger.id))
  );
  return round2(
    (Array.isArray(lines) ? lines : []).reduce(
      (sum, line) => sum + (applicable.has(String(line?.ledgerId || '')) ? Number(line?.amount || 0) : 0),
      0
    )
  );
};

export const ExpenseForm = ({ db, setDb, currentCompany, openModal, onClose, initialData = null, screenTitle = '', onBack = null }) => {
  const expenseErrors = useFieldErrors('expense');
  const activeBranchId = normalizeId(selectedBranchId() || '');
  const expenseDocSettings = getDocSettings(db, currentCompany, { branchId: activeBranchId || null });
  const expenseNumbering = expenseDocSettings?.numbering?.expense;
  const isExpenseAuto = String(expenseNumbering?.mode || '').toLowerCase() === 'auto';
  const lockExpenseNumber = isExpenseAuto && !expenseNumbering?.allowManualOverride;
  const takenExpenseNumbers = (db.expenses || [])
    .filter((e) => e.companyId === currentCompany.id)
    .map((e) => String(e.number || '').trim());
  const generatedExpenseNumber = nextFreeVoucherNumber({
    db,
    company: currentCompany,
    voucherKey: 'expense',
    branchId: activeBranchId || null,
    takenNumbers: takenExpenseNumbers,
  });

  const formRef = useRef(null);
  const [submitAsDraft, setSubmitAsDraft] = useState(false);
  const [tdsPickerOpen, setTdsPickerOpen] = useState(() => Boolean(initialData?.tdsLedgerId || Number(initialData?.tdsAmount) > 0));

  const initialExpenseVendorId = (() => {
    if (initialData?.vendorId !== undefined && initialData?.vendorId !== null && initialData?.vendorId !== '') {
      return initialData.vendorId;
    }
    const partyId = String(initialData?.partyId || '').trim();
    const vendorName = String(initialData?.vendorName || '').trim().toLowerCase();
    const match = (db.vendors || []).find((row) =>
      row.companyId === currentCompany.id && (
        (partyId && String(row.backendPartyId || '') === partyId) ||
        (vendorName && getVendorDisplayName(row).trim().toLowerCase() === vendorName)
      )
    );
    return match?.id ?? '';
  })();

  const initialExpenseLines = (() => {
    if (Array.isArray(initialData?.lines) && initialData.lines.length) return initialData.lines;
    if (!Array.isArray(initialData?.items) || !initialData.items.length) return [emptyExpenseLine()];
    const accounts = (db.chartOfAccounts || []).filter((row) => row.companyId === currentCompany.id);
    return initialData.items.map((item) => {
      const fullDescription = String(item?.description || '');
      const [ledgerLabel, ...detailParts] = fullDescription.split(' — ');
      const ledger = accounts.find((row) => String(row.name || '').trim().toLowerCase() === ledgerLabel.trim().toLowerCase());
      return {
        ledgerId: ledger?.id ?? '',
        description: detailParts.join(' — '),
        amount: item?.taxableAmount ?? item?.rate ?? '',
        gstRate: Number(item?.gstRate || 0),
      };
    });
  })();

  /*
   * Named, not inline: a ref read inside a prop passed to a component reads to
   * the hooks lint as a render-phase access, because it cannot tell an event
   * handler from any other callback.
   */
  const submitExpenseAsDraft = () => {
    setSubmitAsDraft(true);
    formRef.current?.requestSubmit();
  };

  const [formData, setFormData] = useState(() => ({
    number: initialData?.number || generatedExpenseNumber || '',
    date: initialData?.date || new Date().toISOString().split('T')[0],
    costCenterId: initialData?.costCenterId ?? '',
    // Same day unless the vendor grants credit — the vendor's terms decide,
    // not a blanket +30 days.
    dueDate: initialData?.dueDate || initialData?.date || new Date().toISOString().split('T')[0],
    dueDateTouched: Boolean(initialData?.dueDate),
    description: initialData?.description || '',
    vendorId: initialExpenseVendorId,
    refNo: initialData?.refNo || '',
    refDate: initialData?.refDate || '',
    tdsRate: initialData?.tdsRate ?? '',
    tdsLedgerId: initialData?.tdsLedgerId ?? '',
    lines: initialExpenseLines,
  }));

  const vendors = db.vendors.filter((v) => v.companyId === currentCompany.id);

  // Every ledger sitting under a group whose category is Expense — that is
  // "all ledgers created under Direct or Indirect expenses", including any
  // sub-groups the user made themselves.
  const expenseLedgers = useMemo(() => {
    const groups = (db.accountGroups || []).filter((g) => g.companyId === currentCompany.id);
    const groupById = new Map(groups.map((g) => [String(g.id), g]));
    const isExpenseGroup = (gid) => {
      let cur = groupById.get(String(gid || ''));
      const seen = new Set();
      while (cur && !seen.has(String(cur.id))) {
        seen.add(String(cur.id));
        if (String(cur.groupCategory || '').trim() === 'Expense') return true;
        cur = cur.parentGroupId ? groupById.get(String(cur.parentGroupId)) : null;
      }
      return false;
    };
    return (db.chartOfAccounts || [])
      .filter((a) => a.companyId === currentCompany.id && isExpenseGroup(a.groupId))
      .map((a) => ({ ...a, groupName: String(groupById.get(String(a.groupId))?.name || '') }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.chartOfAccounts, db.accountGroups, currentCompany.id]);

  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const gstEnabled = Boolean(currentCompany?.profile?.taxCompliances?.gstEnabled ?? currentCompany?.gstEnabled ?? currentCompany?.gstin);
  const vendor = formData.vendorId ? vendors.find((v) => v.id === parseInt(formData.vendorId)) : null;

  // The due date follows the entry date plus whatever credit the vendor has on
  // file, and keeps following them until the operator types their own date.
  const derivedDueDate = vendor ? dueDateFor(formData.date, vendor, 0) : String(formData.date || '');
  if (!formData.dueDateTouched && derivedDueDate && derivedDueDate !== formData.dueDate) {
    setFormData((p) => (p.dueDateTouched ? p : { ...p, dueDate: derivedDueDate }));
  }
  const { state: vendorState, gstin: vendorGstin, gstRegistration } = getPartyGstProfile(vendor);
  const isIntra = isIntraStateSupply({ companyState, partyState: vendorState });

  // GST rides on the vendor's registration: an unregistered or composition
  // vendor cannot charge it, so those lines are taxable value only.
  const vendorChargesGst = gstEnabled && String(gstRegistration || '').trim().toLowerCase() === 'registered';

  const computed = useMemo(() => {
    const rows = (formData.lines || []).map((l) => {
      const amount = Number(l.amount) || 0;
      const rate = vendorChargesGst ? Number(l.gstRate) || 0 : 0;
      const gstAmount = round2((amount * rate) / 100);
      return {
        ledgerId: l.ledgerId,
        description: String(l.description || '').trim(),
        amount: round2(amount),
        gstRate: rate,
        gstAmount,
        cgstAmount: isIntra ? round2(gstAmount / 2) : 0,
        sgstAmount: isIntra ? round2(gstAmount / 2) : 0,
        igstAmount: isIntra ? 0 : gstAmount,
        lineTotal: round2(amount + gstAmount),
      };
    });
    const subtotal = round2(rows.reduce((s, r) => s + r.amount, 0));
    const gstTotal = round2(rows.reduce((s, r) => s + r.gstAmount, 0));
    return {
      rows,
      subtotal,
      gstTotal,
      cgstTotal: round2(rows.reduce((s, r) => s + r.cgstAmount, 0)),
      sgstTotal: round2(rows.reduce((s, r) => s + r.sgstAmount, 0)),
      igstTotal: round2(rows.reduce((s, r) => s + r.igstAmount, 0)),
      total: round2(subtotal + gstTotal),
    };
  }, [formData.lines, vendorChargesGst, isIntra]);
  const tdsRate = Math.max(0, Math.min(100, Number(formData.tdsRate) || 0));
  const tdsBaseAmount = expenseTdsBase(computed.rows, expenseLedgers);
  const tdsApplicableLineCount = computed.rows.filter((line) =>
    expenseLedgers.some((ledger) => String(ledger.id) === String(line.ledgerId) && ledger.tdsApplicable === true)
  ).length;
  const tdsAmount = round2((tdsBaseAmount * tdsRate) / 100);
  const netPayable = round2(Math.max(0, computed.total - tdsAmount));

  const updateLine = (idx, patch) =>
    setFormData((p) => ({ ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));

  const onPickLedger = (idx, ledgerId) => {
    const led = expenseLedgers.find((l) => String(l.id) === String(ledgerId));
    updateLine(idx, {
      ledgerId,
      // The ledger's own rate is the default; the operator can still override.
      gstRate: led && led.gstRate !== null && led.gstRate !== undefined ? Number(led.gstRate) : 0,
      description: formData.lines[idx]?.description || '',
    });
  };

  // Creating the ledger without leaving the voucher: the picker is limited to
  // expense groups, and the new ledger drops straight into the current line.
  const addLine = () => setFormData((p) => ({ ...p, lines: [...p.lines, emptyExpenseLine()] }));
  const removeLine = (idx) =>
    setFormData((p) => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((_, i) => i !== idx) : p.lines }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    const wantsDraft = submitAsDraft;
    if (wantsDraft) setSubmitAsDraft(false);

    let expenseNumber = String(formData.number || '').trim();
    if (isExpenseAuto && !initialData?.id) {
      if (lockExpenseNumber) expenseNumber = String(generatedExpenseNumber || '').trim();
      else if (!expenseNumber) expenseNumber = String(generatedExpenseNumber || '').trim();
    }
    const expenseNumberClash = db.expenses.some(
      (ex) => ex.companyId === currentCompany.id && String(ex.id) !== String(initialData?.id ?? '') && String(ex.number || '').trim() === expenseNumber
    );
    const usableLines = computed.rows.filter((r) => String(r.ledgerId || '').trim() && r.amount > 0);

    // One pass, every failure, each at its own field.
    expenseErrors.reset();
    expenseErrors.require('number', expenseNumber, 'Voucher number is required');
    expenseErrors.check(
      'number',
      !expenseNumber || !expenseNumberClash,
      'That number is already used. Change it, or adjust numbering in Company Profile.'
    );
    expenseErrors.require('date', formData.date, 'Voucher date is required');
    expenseErrors.require('dueDate', formData.dueDate, 'Due date is required');
    expenseErrors.require('vendorId', formData.vendorId, 'Select a vendor');
    expenseErrors.check('lines', usableLines.length > 0, 'Add at least one line with a ledger and an amount.');
    expenseErrors.check(
      'lines',
      !(formData.lines || []).some((l) => Number(l.amount) > 0 && !String(l.ledgerId || '').trim()),
      'Every line with an amount needs an expense ledger.'
    );
    if (expenseErrors.failed()) return;

    if (gstEnabled && !companyState) {
      notify.error('Please set Company State in Tax & Compliances before creating GST expenses.');
      return;
    }

    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This expense');
      if (closed) {
        notify.error(closed);
        return;
      }
    }

    const ledgerName = (id) => expenseLedgers.find((l) => String(l.id) === String(id))?.name || '';

    // Server first: an unpaid expense is a liability; it must reach the books
    // or not exist. Drafts stay local until they become real.
    let backendDocId = initialData?.backendDocId || null;
    let serverNumber = '';
    if (!wantsDraft && hasDocsApiSession()) {
      try {
        const payload = {
          number: expenseNumber || undefined,
          date: formData.date,
          dueDate: formData.dueDate || null,
          refNo: formData.refNo || null,
          refDate: formData.refDate || null,
          partyId: vendor?.backendPartyId ? String(vendor.backendPartyId) : null,
          partyName: getVendorDisplayName(vendor) || 'Expense',
          partyGstin: vendorGstin || null,
          placeOfSupplyState: vendorState || null,
          description: formData.description || null,
          subtotal: computed.subtotal,
          cgstTotal: computed.cgstTotal,
          sgstTotal: computed.sgstTotal,
          igstTotal: computed.igstTotal,
          gstTotal: computed.gstTotal,
          total: computed.total,
          tdsAmount,
          tdsBaseAmount,
          tdsLedgerId: formData.tdsLedgerId || null,
          tdsLedgerName: expenseTdsLedgers.find((ledger) => String(ledger.id) === String(formData.tdsLedgerId))?.name || null,
          status: 'Unpaid',
          items: usableLines.map((r) => ({
            description: `${ledgerName(r.ledgerId)}${r.description ? ` — ${r.description}` : ''}`,
            quantity: 1,
            rate: r.amount,
            gstRate: r.gstRate,
            taxableAmount: r.amount,
            gstAmount: r.gstAmount,
            lineTotal: r.lineTotal,
          })),
        };
        const saved = initialData?.backendDocId
          ? await updateDocApi('expense', initialData.backendDocId, payload)
          : await createDocApi('expense', payload);
        backendDocId = saved?.id || backendDocId;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Expense not saved to the server.'));
        return;
      }
    }

    const newExpense = {
      id: initialData?.id ?? ((db.expenses || []).reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0) + 1),
      companyId: currentCompany.id,
      backendDocId,
      number: serverNumber || expenseNumber,
      date: formData.date,
      dueDate: formData.dueDate,
      refNo: formData.refNo,
      refDate: formData.refDate,
      description: formData.description,
      costCenterId: formData.costCenterId,
      vendorId: formData.vendorId,
      vendorName: getVendorDisplayName(vendor),
      vendorGstin: vendorGstin,
      placeOfSupplyState: vendorState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      lines: usableLines.map((r) => ({ ...r, ledgerName: ledgerName(r.ledgerId) })),
      taxableTotal: computed.subtotal,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      tdsRate,
      tdsAmount,
      tdsBaseAmount,
      tdsLedgerId: formData.tdsLedgerId || undefined,
      tdsLedgerName: tdsPayableLedgers(db, currentCompany.id).find((ledger) => String(ledger.id) === String(formData.tdsLedgerId))?.name || undefined,
      netPayable,
      amount: computed.subtotal,
      paidAmount: Number(initialData?.paidAmount || 0),
      status: wantsDraft ? 'Draft' : (initialData?.status && initialData.status !== 'Draft' ? initialData.status : 'Unpaid'),
      // Where this was entered from, so the header's scope can find it later.
      branchId: activeBranchId || '',
      warehouseId: String(selectedWarehouseId() || '').trim(),
      createdAt: initialData?.createdAt || new Date().toISOString(),
    };

    const nextExpenses = initialData?.id
      ? db.expenses.map((expense) => String(expense.id) === String(initialData.id) ? newExpense : expense)
      : [...db.expenses, newExpense];
    const tdsEvents = Array.isArray(db.tdsTransactions) ? db.tdsTransactions : [];
    const existingTdsEvent = initialData?.id
      ? tdsEvents.find(
          (event) =>
            Number(event?.companyId) === Number(currentCompany.id) &&
            String(event?.sourceType) === 'expense' &&
            String(event?.sourceId) === String(initialData.id) &&
            String(event?.status).toLowerCase() === 'posted' &&
            !event?.reversalOfId
        )
      : null;
    const remainingTdsEvents = existingTdsEvent
      ? tdsEvents.filter((event) => event !== existingTdsEvent)
      : tdsEvents;
    const selectedTdsLedger = expenseTdsLedgers.find(
      (ledger) => String(ledger.id) === String(formData.tdsLedgerId || '')
    );
    const natureCode = String(selectedTdsLedger?.tdsNatureCode || '').trim()
      || natureForSection(selectedTdsLedger?.tdsSection)?.code
      || '';
    const rule = natureCode ? resolveRule(natureCode, formData.date) : null;
    const nextTdsEvent = !wantsDraft && tdsAmount > 0.005 && selectedTdsLedger && natureCode
      ? {
          id: existingTdsEvent?.id
            ?? (tdsEvents.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0) + 1),
          ...tdsEventFrom(
            {
              natureCode,
              ruleVersionId: rule?.id || '',
              statutoryReference: ruleReference(rule),
              sectionCode: rule?.sectionCode || selectedTdsLedger?.tdsSection || '',
              baseAmount: tdsBaseAmount,
              rate: tdsRate,
              tdsAmount,
              ledgerId: String(selectedTdsLedger.id),
              side: 'PAYABLE',
            },
            {
              company: currentCompany,
              party: vendor,
              source: { type: 'expense', id: newExpense.id, number: newExpense.number },
              branchId: activeBranchId || '',
              date: formData.date,
            }
          ),
          ...(existingTdsEvent
            ? {
                createdAt: existingTdsEvent.createdAt,
                createdBy: existingTdsEvent.createdBy,
                modifiedAt: new Date().toISOString(),
              }
            : {}),
        }
      : null;
    setDb({
      ...db,
      expenses: nextExpenses,
      tdsTransactions: nextTdsEvent ? [...remainingTdsEvents, nextTdsEvent] : remainingTdsEvents,
      companies: initialData?.id
        ? db.companies
        : bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'expense', usedNumber: expenseNumber, branchId: activeBranchId || null }),
    });
    onClose?.();
    notify.success(initialData?.id ? 'Expense updated!' : 'Expense created!');
  };

  const costCenters = (db.costCenters || []).filter((c) => c.companyId === currentCompany.id);
  const expenseTdsLedgers = tdsPayableLedgers(db, currentCompany.id);

  // The shared document contract: same keys on an expense voucher as on a
  // bill.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.lines.length,
    addLine,
    removeLine,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} noValidate className="ui-creation-form space-y-3">
      <DocFormActions
        title={screenTitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel={initialData ? 'Update Expense' : 'Submit Expense'}
        secondaryLabel="Save Draft"
        onSecondary={submitExpenseAsDraft}
      />

      {screenTitle ? null : (
        <div>
          <div className="ui-t-sec">Expense</div>
          <div className="text-xs ui-muted">Book a spend against one or more expense ledgers.</div>
        </div>
      )}

      {/*
        The head of the voucher in the bill's two columns, ruled off between
        them: who was paid and what they billed on the left, the paperwork
        that identifies this voucher on the right. Laid out as one grid rather
        than a right-floated pair over a four-column row — that shape left an
        empty column beside Due Date and a band of nothing beside the voucher
        number, and the fields on the two halves lined up with nothing.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-7 space-y-4">
          {/* Vendor drives GST on every line below, so it leads. */}
          <div>
            <VendorPicker
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              value={formData.vendorId}
              onChange={(vendorId) => {
                expenseErrors.clearField('vendorId');
                setFormData((prev) => ({ ...prev, vendorId }));
              }}
              label="Vendor *"
            />
            <FieldError error={expenseErrors.error('vendorId')} id={expenseErrors.errorId('vendorId')} />
            {formData.vendorId ? (
              <div className="text-xs ui-muted mt-1">
                {vendorChargesGst
                  ? `Registered vendor — GST applies at each ledger's rate (${isIntra ? 'CGST + SGST' : 'IGST'}).`
                  : `${String(gstRegistration || 'Unregistered')} vendor — no GST on this expense.`}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="ui-label" htmlFor="expense-ref-no">Vendor Inv No.</label>
              <input
                id="expense-ref-no"
                type="text"
                value={formData.refNo}
                onChange={(e) => setFormData({ ...formData, refNo: e.target.value })}
                className="ui-input w-full"
                placeholder="Vendor's invoice number"
              />
            </div>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="expense-ref-date">Vendor Inv Date</label>
              <input
                id="expense-ref-date"
                type="date"
                value={formData.refDate}
                onChange={(e) => setFormData({ ...formData, refDate: e.target.value })}
                className="ui-input w-full"
              />
            </div>
          </div>
        </div>

        <div
          className="lg:col-span-5 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-3 gap-2">
            <DocNumberField
              id="expense-number"
              label="Voucher No."
              value={formData.number}
              onChange={(e) => {
                expenseErrors.clearField('number');
                setFormData({ ...formData, number: e.target.value });
              }}
              disabled={lockExpenseNumber}
              required
              voucherKey="expense"
      title="Expense numbering"
              sampleLabel="Next voucher will be"
              manualLabel="Typed on each voucher"
              branchId={activeBranchId || null}
              settings={expenseNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            >
              <FieldError error={expenseErrors.error('number')} id={expenseErrors.errorId('number')} />
            </DocNumberField>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="expense-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="expense-date"
                type="date"
                value={formData.date}
                onChange={(e) => {
                  expenseErrors.clearField('date');
                  setFormData({ ...formData, date: e.target.value });
                }}
                className="ui-input w-full"
                required
                {...expenseErrors.props('date')}
              />
              <FieldError error={expenseErrors.error('date')} id={expenseErrors.errorId('date')} />
            </div>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="expense-due-date">
                Due Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="expense-due-date"
                type="date"
                value={formData.dueDate}
                onChange={(e) => {
                  expenseErrors.clearField('dueDate');
                  setFormData({ ...formData, dueDate: e.target.value, dueDateTouched: true });
                }}
                className="ui-input w-full"
                required
                {...expenseErrors.props('dueDate')}
              />
              <FieldError error={expenseErrors.error('dueDate')} id={expenseErrors.errorId('dueDate')} />
            </div>
          </div>

          {costCenters.length ? (
          <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="ui-label" htmlFor="expense-cost-center">Cost Center</label>
                <select
                  id="expense-cost-center"
                  value={formData.costCenterId || ''}
                  onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value ? Number(e.target.value) : '' })}
                  className="ui-select w-full"
                >
                  <option value="">— none —</option>
                  {costCenters.filter((c) => c.active !== false || String(c.id) === String(formData.costCenterId)).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
          </div>
          ) : null}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="ui-label">Expense Ledgers (Direct / Indirect Expenses)</label>
          <FieldError error={expenseErrors.error('lines')} id={expenseErrors.errorId('lines')} />
        </div>

        {expenseLedgers.length === 0 ? (
          <div className="ui-card p-4 text-sm ui-muted mb-2">
            No expense ledgers yet — pick <span className="font-medium">+ Create new ledger…</span> in the Expense Ledger
            column, or create them under Master Data → Chart of Accounts in a Direct or Indirect Expenses group.
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border">
          <table className="ui-table ui-grid-dense w-full table-fixed">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '4%' }} />
            </colgroup>
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th w-10">#</th>
                <th className="ui-th">Expense Ledger</th>
                <th className="ui-th">Description</th>
                <th className="ui-th">Amount</th>
                <th className="ui-th">GST %</th>
                <th className="ui-th ui-num">GST Amount</th>
                <th className="ui-th ui-num">Total</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {formData.lines.map((line, idx) => {
                const row = computed.rows[idx] || { gstAmount: 0, lineTotal: 0 };
                return (
                  <tr key={idx} data-line-row={idx}>
                    <td className="px-3 py-2 ui-muted">{idx + 1}</td>
                    <td className="px-2 py-2">
                      <LedgerField
                        db={db}
                        setDb={setDb}
                        currentCompany={currentCompany}
                        options={expenseLedgers}
                        value={line.ledgerId || ''}
                        onChange={(ledgerId) => onPickLedger(idx, ledgerId)}
                        placeholder="Type an expense ledger"
                        ariaLabel={`Expense ledger, line ${idx + 1}`}
                        openModal={openModal}
                        creationGroupCategory="Expense"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.description || ''}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        className="ui-input w-full px-2 py-1"
                        placeholder="Optional detail"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* A box the width of a figure, not of the column, and
                          with the spin buttons off: they take 20px out of the
                          right of the field, which is exactly where a
                          right-set number ends up sitting. */}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amount}
                        onChange={(e) => updateLine(idx, { amount: e.target.value })}
                        className="ui-input ui-input-plain ui-mono w-full px-2 py-1"
                        aria-label={`Amount, line ${idx + 1}`}
                      />
                    </td>
                    <td className="px-1.5 py-2">
                      {/* An unregistered vendor cannot charge GST, so the rate is
                          not a choice at all — showing NA beats a dead dropdown. */}
                      {vendorChargesGst ? (
                        <select
                          value={String(line.gstRate ?? 0)}
                          onChange={(e) => updateLine(idx, { gstRate: Number(e.target.value) })}
                          className="ui-select w-full px-1 py-1"
                        >
                          {[0, 0.25, 3, 5, 12, 18, 28].map((r) => (
                            <option key={r} value={String(r)}>{r}%</option>
                          ))}
                        </select>
                      ) : (
                        <span className="ui-muted text-sm" title="GST applies only to registered vendors">NA</span>
                      )}
                    </td>
                    <td className="ui-col-amount px-2 py-2 text-right">
                      {vendorChargesGst ? formatMoney(row.gstAmount, currentCompany) : <span className="ui-muted">NA</span>}
                    </td>
                    <td className="ui-col-amount px-2 py-2 text-right">{formatMoney(row.lineTotal, currentCompany)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => removeLine(idx)} className="text-[rgb(var(--neg))]" aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addLine} className="ui-btn ui-btn-soft ui-btn-sm mt-3">
          <Plus size={16} aria-hidden="true" /> Add Row
        </button>
      </div>

      {/* Narration reads as a summary of the lines, so it comes after them —
          and it sits beside the totals rather than above them, because a full
          width field over a right-hand stack leaves a quarter of the page
          empty under it. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-7">
          <label className="ui-label" htmlFor="expense-narration">Narration</label>
          <input
            id="expense-narration"
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="ui-input w-full"
            placeholder="What this spend was for"
          />
        </div>

        <div className="space-y-2 lg:col-span-5">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
          </div>
          {vendorChargesGst ? (
            isIntra ? (
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
            )
          ) : (
            <div className="flex justify-between ui-muted">
              <span>GST:</span>
              <span>NA</span>
            </div>
          )}
          <div className="ui-total-row border-t pt-2">
            <span>Total Expense:</span>
            <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
          </div>
          {!tdsPickerOpen && !formData.tdsLedgerId ? (
            <div className="ms-auto mt-2 w-full border-t ui-border-c pt-2">
              <button
                type="button"
                onClick={() => setTdsPickerOpen(true)}
                className="ui-btn ui-btn-ghost ui-btn-sm w-full justify-start !px-0 text-sm"
              >
                + TDS deduction <span className="ui-subtle">(if you deduct on this bill)</span>
              </button>
            </div>
          ) : null}

          <div className="ms-auto mt-2 w-full border-t ui-border-c pt-2" hidden={!tdsPickerOpen && !(tdsAmount > 0)}>
            <div className="grid min-w-0 grid-cols-[minmax(8rem,1fr)_4.5rem_minmax(6.5rem,7.5rem)] items-end gap-2">
              <div className="min-w-0">
                <label className="ui-label" htmlFor="expense-tds-ledger">TDS</label>
              <select
                id="expense-tds-ledger"
                value={formData.tdsLedgerId}
                onChange={(e) => {
                  const ledgerId = e.target.value;
                  const ledger = expenseTdsLedgers.find((row) => String(row.id) === String(ledgerId));
                  setFormData((prev) => ({
                    ...prev,
                    tdsLedgerId: ledgerId,
                    tdsRate: ledger ? String(tdsLedgerRate(ledger, vendor?.tdsDeducteeType || 'COMPANY')) : '',
                  }));
                  if (!ledgerId) setTdsPickerOpen(false);
                }}
                className="ui-select w-full"
                aria-label="TDS payable ledger"
              >
                <option value="">No deduction</option>
                {expenseTdsLedgers.map((ledger) => (
                  <option key={ledger.id} value={ledger.id}>
                    {ledger.name}
                  </option>
                ))}
              </select>
              </div>
              <div>
              <label className="ui-label" htmlFor="expense-tds-rate">%</label>
              <input
                id="expense-tds-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.tdsRate}
                onChange={(e) => setFormData((prev) => ({ ...prev, tdsRate: e.target.value }))}
                className="ui-input ui-mono w-full"
                aria-label="TDS percentage"
                disabled={!formData.tdsLedgerId}
              />
              </div>
              <div>
                <span className="ui-label block">Amount</span>
                <output className="ui-input ui-sunken ui-money flex items-center justify-end" aria-label="TDS amount">
                  {formatMoney(tdsAmount, currentCompany)}
                </output>
              </div>
            </div>
            {formData.tdsLedgerId ? (
              <p className="ui-caption mt-1.5">
                TDS base: {formatMoney(tdsBaseAmount, currentCompany)} from {tdsApplicableLineCount} applicable expense {tdsApplicableLineCount === 1 ? 'line' : 'lines'}.
              </p>
            ) : null}
          </div>
          {tdsAmount > 0 ? <div className="ui-total-row border-t pt-2">
            <span>Net Payable:</span>
            <span className="ui-money">{formatMoney(netPayable, currentCompany)}</span>
          </div> : null}
        </div>
      </div>

    </form>
  );
};

export const JournalEntryForm = ({ db, setDb, currentCompany, openModal, onClose, initialData = null }) => {
  const formRef = useRef(null);
  const accounts = db.chartOfAccounts.filter((a) => a.companyId === currentCompany.id);

  const accountOptions = useMemo(() => {
    const editedLines = Array.isArray(initialData?.lines) ? initialData.lines : [];
    const alreadyUsed = new Set(editedLines.map((l) => String(l?.accountId || '').trim()));
    return accounts
      /* A retired ledger is not offered for a new entry — but an entry that
         already names one must still open and show it, or editing the old
         voucher silently drops the line. */
      .filter((a) => a.active !== false || alreadyUsed.has(String(a.id)))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map((a) => ({ value: String(a.id), label: String(a.name || '').trim() }));
  }, [accounts, initialData]);

  const activeBranchId = normalizeId(selectedBranchId() || '');
  const jvDocSettings = getDocSettings(db, currentCompany, { branchId: activeBranchId || null });
  const jvNumbering = jvDocSettings?.numbering?.journalEntry;
  const isJvAuto = String(jvNumbering?.mode || '').toLowerCase() === 'auto';
  const lockJvNumber = isJvAuto && !jvNumbering?.allowManualOverride;
  const generatedJvNumber = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'journalEntry', branchId: activeBranchId || null, takenNumbers: (db.journalEntries || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  const isEdit = Boolean(initialData && initialData.id);

  const [formData, setFormData] = useState(() => ({
    number: isEdit ? String(initialData?.number || '').trim() : generatedJvNumber || `JV-${Date.now()}`,
    date: isEdit ? (initialData?.date || new Date().toISOString().split('T')[0]) : new Date().toISOString().split('T')[0],
    narration: isEdit ? (initialData?.narration || '') : '',
    lines:
      isEdit && Array.isArray(initialData?.lines) && initialData.lines.length
        ? initialData.lines.map((l) => ({
            accountId: String(l?.accountId || '').trim(),
            debit: Number(l?.debit || 0),
            credit: Number(l?.credit || 0),
          }))
        : [
            { accountId: '', debit: 0, credit: 0 },
            { accountId: '', debit: 0, credit: 0 },
          ],
  }));

  const addLine = () => {
    setFormData((p) => ({ ...p, lines: [...p.lines, { accountId: '', debit: 0, credit: 0 }] }));
  };

  const removeLine = (index) => {
    setFormData((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== index) }));
  };

  const updateLine = (index, field, value) => {
    setFormData((p) => {
      const nextLines = [...p.lines];
      const next = { ...nextLines[index], [field]: value };

      if (field === 'debit') {
        const debit = Number(value || 0);
        next.debit = Number.isFinite(debit) ? debit : 0;
        if (next.debit > 0) next.credit = 0;
      }
      if (field === 'credit') {
        const credit = Number(value || 0);
        next.credit = Number.isFinite(credit) ? credit : 0;
        if (next.credit > 0) next.debit = 0;
      }

      nextLines[index] = next;
      return { ...p, lines: nextLines };
    });
  };

  const openCreateLedgerForLine = (lineIndex, initialName) => {
    if (typeof openModal !== 'function') {
      notify.error('Unable to open ledger creation.');
      return;
    }

    openModal(
      <ChartAccountForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        openModal={openModal}
        initialName={String(initialName || '').trim()}
        onCreated={(ledger) => {
          if (!ledger?.id && ledger?.id !== 0) return;
          updateLine(lineIndex, 'accountId', String(ledger.id));
        }}
        onClose={() => openModal(null)}
      />,
      { title: 'New Ledger', maxWidthClass: 'max-w-5xl' }
    );
  };

  const totalDebit = round2((formData.lines || []).reduce((sum, l) => sum + Number(l.debit || 0), 0));
  const totalCredit = round2((formData.lines || []).reduce((sum, l) => sum + Number(l.credit || 0), 0));
  const difference = round2(totalDebit - totalCredit);
  const isBalanced = Math.abs(difference) < 0.005 && totalDebit > 0;

  /*
   * A journal that moves TDS is a TDS event.
   *
   * Adjustments happen: a deduction made at the wrong rate, a short deposit
   * squared off, an opening balance brought in. They are written as journals,
   * and until now they moved the ledger without ever reaching the register —
   * so the TDS Payable balance and the return disagreed, and the difference
   * was invisible until somebody totalled both by hand.
   *
   * The line tells us which nature and which side; only the party cannot be
   * inferred, because a journal has none. So that is the one thing asked for,
   * and only when a TDS ledger is actually on the entry.
   */
  const tdsGroups = useMemo(
    () => (db.accountGroups || []).filter((g) => Number(g?.companyId) === Number(currentCompany.id)),
    [db.accountGroups, currentCompany.id]
  );

  const tdsLine = useMemo(() => {
    for (const line of formData.lines || []) {
      const account = accounts.find((a) => String(a.id) === String(line.accountId || ''));
      if (!account) continue;
      const side = String(account.tdsSide || '').toUpperCase() || tdsGroupSide(tdsGroups, account.groupId);
      if (!side) continue;
      const amount = round2(Number(line.debit || 0) || Number(line.credit || 0));
      if (amount <= 0) continue;
      return {
        account,
        side,
        amount,
        /* Credit raises a payable; debit raises a receivable — and a debit to
           a payable ledger is the adjustment reducing one, which the register
           records as a negative event rather than a new deduction. */
        signed: side === 'PAYABLE'
          ? round2(Number(line.credit || 0) - Number(line.debit || 0))
          : round2(Number(line.debit || 0) - Number(line.credit || 0)),
        natureCode:
          String(account.tdsNatureCode || '').trim() || natureForSection(account.tdsSection)?.code || '',
      };
    }
    return null;
  }, [formData.lines, accounts, tdsGroups]);

  const tdsParties = useMemo(() => {
    if (!tdsLine) return [];
    const list = tdsLine.side === 'RECEIVABLE' ? db.customers : db.vendors;
    return (Array.isArray(list) ? list : [])
      .filter((p) => Number(p?.companyId) === Number(currentCompany.id))
      .slice()
      .sort((a, b) => String(a?.displayName || a?.name || '').localeCompare(String(b?.displayName || b?.name || '')));
  }, [tdsLine, db.customers, db.vendors, currentCompany.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Year-end lock: nothing back-dates into closed books.
    {
      const lock = (db.fyLocks || []).find((l) => l.companyId === currentCompany.id);
      if (lock && String(formData.date || '').slice(0, 10) <= lock.upTo) {
        notify.error(`Books are locked up to ${lock.upTo} (Year-End Close). Pick a later date or unlock the year.`);
        return;
      }
    }

    let jvNumber = String(formData.number || '').trim();
    if (isJvAuto) {
      if (lockJvNumber) jvNumber = String(generatedJvNumber || '').trim();
      else if (!jvNumber) jvNumber = String(generatedJvNumber || '').trim();
    }
    if (!jvNumber) {
      notify.error('Journal number is required');
      return;
    }

    const numberClash = db.journalEntries.some(
      (j) =>
        j.companyId === currentCompany.id &&
        String(j.number || '').trim() === jvNumber &&
        (!isEdit || String(j.id) !== String(initialData.id))
    );
    if (numberClash) {
      notify.error('Journal number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    const cleanLines = (formData.lines || [])
      .map((l) => ({
        accountId: String(l.accountId || '').trim(),
        debit: round2(Number(l.debit || 0)),
        credit: round2(Number(l.credit || 0)),
      }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

    if (cleanLines.length < 2) {
      notify.error('Please add at least two lines with amounts.');
      return;
    }
    if (cleanLines.some((l) => !l.accountId)) {
      notify.error('Account is required for each line.');
      return;
    }

    const debitSum = round2(cleanLines.reduce((sum, l) => sum + l.debit, 0));
    const creditSum = round2(cleanLines.reduce((sum, l) => sum + l.credit, 0));
    if (debitSum <= 0 || creditSum <= 0) {
      notify.error('Both total debit and total credit must be greater than 0.');
      return;
    }
    if (Math.abs(debitSum - creditSum) > 0.01) {
      notify.error('Journal entry must be balanced (Total Debit = Total Credit).');
      return;
    }

    const resolveLines = cleanLines.map((l) => {
      const acc = accounts.find((a) => String(a.id) === String(l.accountId));
      return {
        ...l,
        accountName: acc?.name || '',
        accountCode: acc?.code || '',
      };
    });

    if (isEdit) {
      /*
       * Editing an entry that already reached the ledger means reversing the
       * old posting and making a new one — a posting is never rewritten in
       * place. If the reversal is refused, nothing here changes either, so the
       * two books do not drift apart.
       */
      let editPatch = {};
      if (String(initialData?.backendEntryId || '').trim()) {
        const { reversed } = await reverseJournalOnLedger(initialData);
        if (!reversed) return;
        editPatch = await postJournalToLedger({
          chartRows: accounts,
          entry: { date: formData.date, narration: formData.narration, lines: resolveLines },
        });
      }

      const updated = {
        ...initialData,
        ...editPatch,
        number: jvNumber,
        date: formData.date,
        narration: formData.narration,
        lines: resolveLines,
        totalDebit: debitSum,
        totalCredit: creditSum,
        updatedAt: new Date().toISOString(),
      };

      const tdsEventRows = Array.isArray(db.tdsTransactions) ? db.tdsTransactions : [];
      const existingTdsEvent = tdsEventRows.find(
        (event) =>
          Number(event?.companyId) === Number(currentCompany.id) &&
          String(event?.sourceType) === 'journal' &&
          String(event?.sourceId) === String(initialData.id) &&
          String(event?.status).toLowerCase() === 'posted' &&
          !event?.reversalOfId
      );
      const remainingTdsEvents = existingTdsEvent
        ? tdsEventRows.filter((event) => event !== existingTdsEvent)
        : tdsEventRows;
      const tdsParty = tdsLine
        ? (tdsLine.side === 'RECEIVABLE' ? db.customers : db.vendors)?.find(
            (party) => String(party.id) === String(formData.tdsPartyId || '')
          )
        : null;
      const tdsRule = tdsLine?.natureCode ? resolveRule(tdsLine.natureCode, formData.date) : null;
      const nextTdsEvent = tdsLine && tdsParty && tdsLine.natureCode && Math.abs(tdsLine.signed) > 0.005
        ? {
            id: existingTdsEvent?.id
              ?? (tdsEventRows.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0) + 1),
            ...tdsEventFrom(
              {
                natureCode: tdsLine.natureCode,
                ruleVersionId: tdsRule?.id || '',
                statutoryReference: ruleReference(tdsRule),
                sectionCode: tdsRule?.sectionCode || '',
                baseAmount: 0,
                rate: 0,
                tdsAmount: round2(tdsLine.signed),
                ledgerId: String(tdsLine.account.id),
                side: tdsLine.side,
              },
              {
                company: currentCompany,
                party: tdsParty,
                source: { type: 'journal', id: initialData.id, number: jvNumber },
                branchId: activeBranchId || '',
                date: formData.date,
              }
            ),
            ...(existingTdsEvent
              ? {
                  createdAt: existingTdsEvent.createdAt,
                  createdBy: existingTdsEvent.createdBy,
                  modifiedAt: new Date().toISOString(),
                }
              : {}),
          }
        : null;

      setDb({
        ...db,
        tdsTransactions: nextTdsEvent ? [...remainingTdsEvents, nextTdsEvent] : remainingTdsEvents,
        journalEntries: (Array.isArray(db.journalEntries) ? db.journalEntries : []).map((j) =>
          j.companyId === currentCompany.id && String(j.id) === String(initialData.id) ? updated : j
        ),
      });

      onClose?.();
      return;
    }

    const nextId = (Array.isArray(db.journalEntries) ? db.journalEntries : []).reduce((m, j) => Math.max(m, Number(j?.id || 0)), 0) + 1;

    /*
     * Posted to the general ledger on the server, not only recorded here.
     *
     * A journal is a ledger posting. Kept in the browser alone it meant the
     * trial balance, the P&L and the balance sheet said different things on
     * different machines, and the server's own books were missing entries
     * somebody had deliberately made.
     */
    const ledgerPatch = await postJournalToLedger({
      chartRows: accounts,
      entry: { date: formData.date, narration: formData.narration, lines: resolveLines },
    });

    const newJv = {
      id: nextId,
      companyId: currentCompany.id,
      number: jvNumber,
      date: formData.date,
      narration: formData.narration,
      lines: resolveLines,
      totalDebit: debitSum,
      totalCredit: creditSum,
      createdAt: new Date().toISOString(),
      ...ledgerPatch,
    };

    /*
     * The adjustment, in the register as well as the ledger.
     *
     * Only where a party was named and the ledger carries a nature: without
     * either, the return has nothing to say about it, and a row that cannot be
     * filed is worse in the register than absent from it. A reversal is stored
     * as a negative amount against the same nature rather than as a deletion,
     * so the audit trail keeps both halves.
     */
    const tdsEventRows = Array.isArray(db.tdsTransactions) ? db.tdsTransactions : [];
    const tdsParty = tdsLine
      ? (tdsLine.side === 'RECEIVABLE' ? db.customers : db.vendors)?.find(
          (p) => String(p.id) === String(formData.tdsPartyId || '')
        )
      : null;
    const tdsRule = tdsLine?.natureCode ? resolveRule(tdsLine.natureCode, formData.date) : null;
    const tdsEvent =
      tdsLine && tdsParty && tdsLine.natureCode && Math.abs(tdsLine.signed) > 0.005
        ? {
            id: tdsEventRows.reduce((m, t) => Math.max(m, Number(t?.id) || 0), 0) + 1,
            ...tdsEventFrom(
              {
                natureCode: tdsLine.natureCode,
                ruleVersionId: tdsRule?.id || '',
                statutoryReference: ruleReference(tdsRule),
                sectionCode: tdsRule?.sectionCode || '',
                baseAmount: 0,
                rate: 0,
                tdsAmount: round2(tdsLine.signed),
                ledgerId: String(tdsLine.account.id),
                side: tdsLine.side,
              },
              {
                company: currentCompany,
                party: tdsParty,
                source: { type: 'journal', id: nextId, number: jvNumber },
                branchId: activeBranchId || '',
                date: formData.date,
              }
            ),
          }
        : null;

    setDb({
      ...db,
      tdsTransactions: tdsEvent ? [...tdsEventRows, tdsEvent] : db.tdsTransactions,
      journalEntries: [...(Array.isArray(db.journalEntries) ? db.journalEntries : []), newJv],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'journalEntry', usedNumber: jvNumber, branchId: activeBranchId || null }),
    });

    onClose?.();
  };

  // The shared document contract, so a journal answers to the same keys as
  // every other document: Ctrl+S saves, Enter moves on, Ctrl+= adds a line,
  // Ctrl+D duplicates it, Ctrl+Delete removes it.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.lines.length,
    addLine,
    removeLine,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} className="space-y-6">
      <DocFormActions
        primaryLabel={isEdit ? 'Update Entry' : 'Create Entry'}
        disabled={!isBalanced}
      />

      <DocHeaderStrip
        numberLabel="Journal No."
        number={formData.number}
        onNumberChange={(v) => setFormData((p) => ({ ...p, number: v }))}
        numberLocked={lockJvNumber}
        numberHint={lockJvNumber ? 'Numbered automatically from the series' : ''}
        numbering={{
          voucherKey: 'journalEntry',
          title: 'Journal numbering',
          sampleLabel: 'Next entry will be',
          manualLabel: 'Typed on each entry',
          branchId: activeBranchId || null,
          settings: jvNumbering,
          db,
          setDb,
          currentCompany,
        }}
        date={formData.date}
        onDateChange={(v) => setFormData((p) => ({ ...p, date: v }))}
      />
      {tdsLine ? (
        <div className="ui-sunken rounded-lg border p-3">
          <div className="ui-t-label">TDS adjustment</div>
          <p className="ui-caption mt-0.5">
            This entry moves {tdsLine.account.name}. Naming who it belongs to puts it in the TDS register and the
            quarter’s return; leaving it blank posts the journal and nothing else.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="ui-label" htmlFor="jv-tds-party">
                {tdsLine.side === 'RECEIVABLE' ? 'Customer' : 'Vendor'}
              </label>
              <select
                id="jv-tds-party"
                className="ui-select w-full"
                value={formData.tdsPartyId || ''}
                onChange={(e) => setFormData((p) => ({ ...p, tdsPartyId: e.target.value }))}
              >
                <option value="">— not reported —</option>
                {tdsParties.map((party) => (
                  <option key={party.id} value={String(party.id)}>
                    {party.displayName || party.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="self-end">
              <p className="ui-caption">
                {tdsLine.natureCode
                  ? `${natureByCode(tdsLine.natureCode)?.name || tdsLine.natureCode} · ${formatMoney(Math.abs(tdsLine.signed), currentCompany)}${tdsLine.signed < 0 ? ' (reversal)' : ''}`
                  : 'This ledger has no TDS nature mapped, so the entry cannot be reported.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}


      <div>
        <label className="ui-label" htmlFor="app-narration">Narration</label>
        <input id="app-narration"
          type="text"
          value={formData.narration}
          onChange={(e) => setFormData((p) => ({ ...p, narration: e.target.value }))}
          className="ui-input w-full"
          placeholder="Optional"
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="ui-label">Lines</label>
          <button type="button" onClick={addLine} className="ui-fg ui-hover-fg text-sm flex items-center gap-1">
            <Plus size={16} /> Add Line
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table w-full">
            <thead className="ui-sunken">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium">Account</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Debit</th>
                <th className="px-3 py-2 text-right text-xs font-medium">Credit</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {formData.lines.map((line, idx) => (
                <tr key={idx} className="border-t" data-line-row={idx}>
                  <td className="ui-col-meta px-3 py-2">
                    <PopupSelect
                      label={null}
                      ariaLabel={`Ledger, line ${idx + 1}`}
                      value={line.accountId}
                      onChange={(val) => updateLine(idx, 'accountId', String(val || '').trim())}
                      options={accountOptions}
                      placeholder="Select ledger"
      title="Select Ledger"
                      showValueSubtext={false}
                      maxWidthClass="max-w-2xl"
                      allowCustom
                      customActionText="Create new Ledger"
                      onCustomAction={(typed) => openCreateLedgerForLine(idx, typed)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={line.debit}
                      onChange={(e) => updateLine(idx, 'debit', e.target.value)}
                      className="ui-input w-32 px-2 py-1 text-right"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      value={line.credit}
                      onChange={(e) => updateLine(idx, 'credit', e.target.value)}
                      className="ui-input w-32 px-2 py-1 text-right"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]"
                      disabled={formData.lines.length <= 2}
      title={formData.lines.length <= 2 ? 'Minimum 2 lines' : 'Remove line'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <div className="ui-card p-3 w-80" aria-live="polite">
            <div className="flex justify-between text-sm">
              <span className="ui-muted">Total Dr</span>
              <span className="ui-amount">{formatMoney(totalDebit, currentCompany)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="ui-muted">Total Cr</span>
              <span className="ui-amount">{formatMoney(totalCredit, currentCompany)}</span>
            </div>
            <div
              className="flex justify-between text-sm mt-2 pt-2"
              style={{ borderTop: '1px solid rgb(var(--border))' }}
            >
              <span className="ui-muted">Difference</span>
              <span className={`ui-amount ${isBalanced ? 'ui-amount-pos' : 'ui-amount-neg'}`}>
                {formatMoney(Math.abs(difference), currentCompany)}
                {difference > 0 ? ' Dr' : difference < 0 ? ' Cr' : ''}
              </span>
            </div>
            <div className="mt-2">
              {isBalanced ? (
                <span className="ui-pill ui-pill-pos">Dr = Cr</span>
              ) : (
                <span className="ui-pill ui-pill-neg">
                  {totalDebit === 0 && totalCredit === 0 ? 'Nothing entered yet' : 'Does not balance'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The reason the button at the top is disabled, kept where the figures
          that caused it are — not beside a button on another part of the
          screen. */}
      {!isBalanced ? (
        <p className="ui-subtle text-xs text-right">Debits and credits must match before this can be saved</p>
      ) : null}

      <DocFormFootnote />
    </form>
  );
};

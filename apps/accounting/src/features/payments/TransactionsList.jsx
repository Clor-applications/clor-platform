import React, { useMemo, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import RecordDisbursementForm from './RecordDisbursementForm';
import RecordReceiptForm from './RecordReceiptForm';
import { confirmDialog } from '@ui/components/ui/notify';
import { reversePayment } from '@ui/api/payments';
import { hasApiSession } from '@ui/api/purchaseDocs';
import { applyPaymentReversal } from './paymentService';
import { formatMoney, round2 } from '@ui/utils/money';
import { TableTotals } from '@ui/components/ui/Primitives';
import { ListToolbar, useListSearch } from '@ui/components/ListToolbar';
import { usePeriodFilter } from '@ui/components/ListControls';
import { StatCards, ListSearch, FiltersButton, MoreButton, ExportButton, Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { PageHeader } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { CreditCard, FileText, Landmark, Receipt, Undo2 } from 'lucide-react';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { Download } from 'lucide-react';
import { DocumentNumber, SalesDate, MoneyValue } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

const safeArray = (v) => (Array.isArray(v) ? v : []);

const getVoucherLabel = (voucherType) => {
  if (voucherType === 'invoice') return 'Invoice';
  if (voucherType === 'bill') return 'Bill';
  if (voucherType === 'expense') return 'Expense';
  if (voucherType === 'receipt') return 'Receipt';
  if (voucherType === 'payment') return 'Payment';
  return String(voucherType || 'Document');
};

const resolveVoucher = ({ db, companyId, voucherType, voucherId }) => {
  const id = Number(voucherId);
  if (!Number.isFinite(id)) return null;

  if (voucherType === 'invoice') return safeArray(db.invoices).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  if (voucherType === 'bill') return safeArray(db.bills).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  if (voucherType === 'expense') return safeArray(db.expenses).find((d) => d.companyId === companyId && Number(d.id) === id) || null;
  return null;
};

const TransactionView = ({ title, payload }) => {
  const shareText = useMemo(() => {
    const lines = [
      title,
      payload?.documentNumber ? `Document: ${payload.documentNumber}` : null,
      payload?.partyName ? `Party: ${payload.partyName}` : null,
      payload?.date ? `Date: ${payload.date}` : null,
      payload?.mode ? `Mode: ${payload.mode}` : null,
      payload?.reference ? `Reference: ${payload.reference}` : null,
      payload?.amount !== undefined && payload?.amount !== null ? `Amount: ${String(payload.amount)}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }, [payload, title]);

  const doPrint = () => {
    try {
      const prevTitle = document.title;
      if (payload?.documentNumber) document.title = String(payload.documentNumber);

      document.body.classList.add('print-mode');
      const cleanup = () => {
        document.body.classList.remove('print-mode');
        document.title = prevTitle;
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      window.setTimeout(cleanup, 1200);
    } catch {
      // ignore
    }
  };

  const doShare = async () => {
    try {
      if (navigator?.share) {
        await navigator.share({ title, text: shareText });
        return;
      }
    } catch {
      // fallthrough to copy
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        notify.success('Copied to clipboard');
        return;
      }
    } catch {
      // ignore
    }

    notify.error(shareText);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm ui-muted">{title}</div>
          <div className="font-medium">{payload?.documentNumber || '-'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={doPrint}
            className="px-3 py-2 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
          >
            Print
          </button>
          <button
            type="button"
            onClick={doShare}
            className="px-3 py-2 rounded-lg ui-btn ui-btn-primary"
          >
            Share
          </button>
        </div>
      </div>

      <div className="printable ui-surface border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="ui-muted">Party</div>
            <div>{payload?.partyName || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Date</div>
            <div>{payload?.date || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Mode</div>
            <div>{payload?.mode || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Reference</div>
            <div>{payload?.reference || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Type</div>
            <div>{payload?.typeLabel || '-'}</div>
          </div>
          <div>
            <div className="ui-muted">Amount</div>
            <div className="ui-money">{formatMoney(payload?.amount || 0, payload?.currentCompany)}</div>
          </div>
        </div>

        {payload?.notes ? (
          <div className="text-sm">
            <div className="ui-muted">Notes</div>
            <div className="whitespace-pre-wrap">{payload.notes}</div>
          </div>
        ) : null}

        {Array.isArray(payload?.allocations) && payload.allocations.length ? (
          <div className="text-sm">
            <div className="ui-muted mb-2">Allocations</div>
            <div className="border rounded-lg overflow-hidden">
              <table className="ui-table w-full">
                <thead className="ui-sunken border-b">
                  <tr>
                    <th className="ui-th">Document #</th>
                    <th className="ui-th ui-num">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payload.allocations.map((a, idx) => (
                    <tr key={idx}>
                      <td className="ui-col-id px-3 py-2">
                        {a?.voucherType ? `${getVoucherLabel(a.voucherType)}: ` : ''}
                        {a?.documentNumber || a?.voucherId || '-'}
                      </td>
                      <td className="ui-col-amount px-3 py-2 text-right">
                        {formatMoney(Number(a?.amount ?? 0), payload?.currentCompany)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Number(payload?.advanceAmount ?? 0) > 0 ? (
              <div className="mt-3 flex items-center justify-between">
                <div className="ui-muted">Advance</div>
                <div className="ui-money">{formatMoney(Number(payload.advanceAmount ?? 0), payload?.currentCompany)}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const TransactionsTable = ({ title, rows, currentCompany, rightActions, onView, onReverse = null }) => {
  const period = usePeriodFilter();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const search = useListSearch(rows, ['documentNumber', 'partyName', 'mode', 'reference', 'typeLabel', 'date']);
  const colFilters = useColumnFilters();
  const shownAll = colFilters.applyFilters(search.filtered.filter((r) => period.inRange(r?.date)), {
    date: (r) => r.date,
    typeLabel: (r) => r.typeLabel,
    documentNumber: (r) => r.documentNumber,
    partyName: (r) => r.partyName,
    mode: (r) => r.mode,
    reference: (r) => r.reference,
    amount: (r) => r.amount,
  });

  const exportTransactions = (format) => {
    if (!shown.length) {
      notify.error('Nothing to export.');
      return;
    }
    runListExport({
      format,
      title,
      label: title.toLowerCase(),
      fileName: `${title}_${currentCompany?.name || 'company'}`,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'typeLabel', label: 'Type' },
        { key: 'documentNumber', label: 'Document #' },
        { key: 'partyName', label: 'Party' },
        { key: 'mode', label: 'Mode' },
        { key: 'reference', label: 'Reference' },
        { key: 'amount', label: 'Amount', value: (r) => round2(Number(r.amount || 0)) },
      ],
      rows: shown,
    });
  };

  /*
   * A receipt or payment either settles documents or it does not. The second
   * group is what somebody comes here to find: money taken or sent that is
   * still sitting on account against nothing in particular.
   */
  const [txStatus, setTxStatus] = useState('');
  const TX_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Allocated', label: 'Against documents', tone: 'paid' },
    { value: 'OnAccount', label: 'On account', tone: 'outstanding' },
  ];
  const txMatches = (r, tab) => {
    if (tab === 'Allocated') return (r.allocations || []).length > 0;
    if (tab === 'OnAccount') return Number(r.advanceAmount || 0) > 0 || (r.allocations || []).length === 0;
    return true;
  };
  const shown = txStatus ? shownAll.filter((r) => txMatches(r, txStatus)) : shownAll;

  const txStatusCounts = useMemo(() => {
    const counts = { '': shownAll.length };
    for (const t of TX_STATUS_TABS) {
      if (!t.value) continue;
      counts[t.value] = shownAll.filter((r) => txMatches(r, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownAll]);

  const { pageCount, safePage, pageRows } = usePaged(shown, perPage, page);

  /**
   * Five figures, and every one of them countable from the rows themselves.
   *
   * The reference proposed "Employee payments" and "Refunds"; neither is
   * modelled — a payment has a party and a mode, not an employee flag — and a
   * card that can only ever read zero teaches people the row above it is
   * guesswork too. These are the splits the data actually supports.
   */
  /*
   * Over `shown`, the rows actually on screen — not `rows`, the whole book.
   *
   * Reading the unfiltered set meant searching for one party left five figures
   * describing every receipt ever taken, sitting directly above a table showing
   * three. Two different sets of data on one screen with nothing saying so.
   */
  const headline = useMemo(() => {
    const sum = (rs) => rs.reduce((t, r) => t + Number(r.amount || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const byMode = new Map();
    for (const r of shown) byMode.set(r.mode || '—', (byMode.get(r.mode || '—') || 0) + Number(r.amount || 0));
    const top = [...byMode.entries()].sort((a2, b2) => b2[1] - a2[1])[0];
    return {
      count: shown.length,
      total: sum(shown),
      thisMonth: sum(shown.filter((r) => String(r.date || '').slice(0, 7) === month)),
      allocated: sum(shown.filter((r) => (r.allocations || []).length > 0)),
      unallocated: sum(shown.filter((r) => Number(r.advanceAmount || 0) > 0)),
      topMode: top ? { name: top[0], value: top[1] } : null,
    };
  }, [shown]);

  return (
    <DocumentListShell
      entity="transfer"
      title={title}
      tight
      denseCards
      company={currentCompany}
      search={{
        value: search.query,
        onChange: (v) => {
          search.setQuery(v);
          setPage(1);
        },
        placeholder: `Search ${title.toLowerCase()}…`,
        label: `Search ${title.toLowerCase()}`,
      }}
      headerExtras={rightActions ? <>{rightActions}</> : null}
      moreItems={[exportMenuItem(`Export ${title.toLowerCase()}`)]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) exportTransactions(format);
      }}
      cards={[
        { label: `Total ${title.toLowerCase()}`, value: headline.count, count: true, tone: 'draft', Icon: FileText },
        { label: 'Value', value: headline.total, tone: 'sent', Icon: Receipt },
        { label: 'This month', value: headline.thisMonth, tone: 'paid', Icon: CreditCard },
        { label: 'Against documents', value: headline.allocated, tone: 'partial', Icon: Landmark },
        headline.topMode
          ? { label: `Most used — ${headline.topMode.name}`, value: headline.topMode.value, tone: 'outstanding', Icon: Undo2 }
          : { label: 'On account', value: headline.unallocated, tone: 'outstanding', Icon: Undo2 },
      ]}
      tabs={TX_STATUS_TABS}
      tabsLabel={`${title} filter`}
      statusValue={txStatus}
      statusCounts={txStatusCounts}
      onStatusChange={(v) => {
        setTxStatus(v);
        setPage(1);
      }}
    >
        {/* Eight columns in a card that stops at the page's edge, so the
            table needs somewhere to scroll. Without this wrapper the card's
            own `overflow: hidden` clipped it: at 1093px — a 1366 laptop at
            125% — the table came to 960px inside an 803px card, and the last
            157px, which is the Amount column, was not merely off-screen but
            unreachable, with no scrollbar to say it existed. Every other wide
            list in the product is wrapped this way; this one was missed. */}
        <div className="overflow-x-auto ui-table-scroll transactions-table-scroll">
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              <ColumnHeader label="Date" col="date" state={colFilters} align="center" />
              {onReverse ? <th scope="col" className="w-10"></th> : null}
              <ColumnHeader label="Type" col="typeLabel" state={colFilters} />
              <ColumnHeader label="Document #" col="documentNumber" state={colFilters} />
              <ColumnHeader label="Party" col="partyName" state={colFilters} />
              <ColumnHeader label="Mode" col="mode" state={colFilters} />
              <ColumnHeader label="Reference" col="reference" state={colFilters} />
              <ColumnHeader label="Amount" col="amount" state={colFilters} className="ui-num" align="right" />
            </tr>
          </thead>
          <tbody className="ui-rows">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center ui-muted">
                  No transactions found
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  className={onView ? 'ui-hover-sunken cursor-pointer' : 'ui-hover-sunken'}
                  onClick={() => {
                    if (typeof onView === 'function') onView(r);
                  }}
                >
                  <td className="ui-col-date"><SalesDate value={r.date} /></td>
                  {onReverse ? (
                    <td className="w-10" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'Reversed' ? (
                        <span className="ui-caption">Reversed</span>
                      ) : (
                        <button
                          type="button"
                          className="ui-icon-btn !h-7 !w-7"
                          aria-label={`Reverse ${r.documentNumber || r.typeLabel}`}
      title="Reverse — the voucher stays on record, the settlement is given back"
                          onClick={() => onReverse(r)}
                        >
                          <Undo2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  ) : null}
                  <td className="ui-col-meta">{r.typeLabel}</td>
                  <td className="ui-col-id"><DocumentNumber value={r.documentNumber} label="receipt" /></td>
                  <td className="ui-col-entity">{r.partyName || '-'}</td>
                  <td className="ui-col-meta">{r.mode || '-'}</td>
                  <td className="ui-col-meta">{r.reference || '-'}</td>
                  {/* Money that has arrived. */}
                  <td className="ui-col-amount"><MoneyValue value={r.amount} company={currentCompany} kind="paid" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        <TableTotals
          count={shown.length}
          totalCount={(rows || []).length}
          noun="transactions"
          figures={[{ label: 'Value', value: formatMoney(shown.reduce((t, r) => t + Number(r.amount || 0), 0), currentCompany) }]}
        />

        <Pagination
          total={shown.length}
          page={safePage}
          perPage={perPage}
          pageCount={pageCount}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n);
            setPage(1);
          }}
          noun={title.toLowerCase()}
        />
    </DocumentListShell>
  );
};


/** Reverse a voucher: server first where it is known, then the local book
 *  through the payment service — voucher kept, settlement given back, TDS
 *  answered by its lineage pair. */
const makeReverse = ({ setDb, currentCompany, noun }) => async (row) => {
  const ok = await confirmDialog({
    title: `Reverse ${row.documentNumber || `this ${noun}`}?`,
    message: `The ${noun} stays on record as reversed; every document it settled becomes outstanding again.`,
    confirmLabel: 'Yes, reverse it',
  });
  if (!ok) return;
  if (row.backendPaymentId && hasApiSession()) {
    try {
      await reversePayment(String(row.backendPaymentId));
    } catch (err) {
      notify.error(String(err?.message || `The server refused to reverse the ${noun}.`));
      return;
    }
  }
  const by = (() => {
    try {
      return String(localStorage.getItem('userEmail') || '').trim() || 'User';
    } catch {
      return 'User';
    }
  })();
  setDb((prev) => applyPaymentReversal(prev, currentCompany.id, row.id, { by }));
  notify.success(`${row.documentNumber || noun} reversed.`);
};

export const ReceiptsTransactionsList = ({ db, setDb, currentCompany, openModal, onRecordReceipt }) => {
  const rows = useMemo(() => {
    const companyId = currentCompany.id;
    const payments = safeArray(db.payments).filter((p) => p.companyId === companyId);

    return payments
      .filter((p) => String(p.direction || '').toUpperCase() === 'IN')
      .map((p) => {
        const isReceipt = String(p.voucherType || '') === 'receipt';
        const voucher = isReceipt ? null : resolveVoucher({ db, companyId, voucherType: p.voucherType, voucherId: p.voucherId });
        const partyName = isReceipt ? p.customerName || '' : voucher?.customerName || voucher?.partyName || '';

        return {
          id: p.id,
          status: p.status,
          backendPaymentId: p.backendPaymentId,
          date: p.date,
          amount: Number(p.amount ?? 0),
          mode: p.mode,
          reference: p.reference,
          notes: p.notes,
          typeLabel: getVoucherLabel(p.voucherType),
          documentNumber: isReceipt ? p.receiptNo || '' : voucher?.number || '',
          partyName,
          allocations: isReceipt ? safeArray(p.allocations) : null,
          advanceAmount: isReceipt ? Number(p.advanceAmount ?? 0) : 0,
        };
      })
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db, currentCompany.id]);

  return (
    <TransactionsTable
      title="Receipts"
      rows={rows}
      currentCompany={currentCompany}
      onReverse={setDb ? makeReverse({ setDb, currentCompany, noun: 'receipt' }) : null}
      onView={(row) => {
        if (typeof openModal !== 'function') return;
        const title = row?.documentNumber ? `Receipt ${row.documentNumber}` : 'Receipt';
        openModal(<TransactionView title={title} payload={{ ...row, currentCompany }} />, {
          title,
          maxWidthClass: 'max-w-3xl',
        });
      }}
      rightActions={
        <button
          type="button"
          onClick={() => {
            if (typeof onRecordReceipt === 'function') {
              onRecordReceipt();
              return;
            }

            if (typeof openModal !== 'function' || typeof setDb !== 'function') return;
            /* The full receipt, not a document picker.
               Money can arrive with no invoice behind it — interest, a
               refund, a director's contribution — and asking which invoice
               this is before showing the form refused all of them. The
               invoices are still there to tick once a customer is chosen. */
            openModal(
              <RecordReceiptForm
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                onClose={() => openModal(null)}
              />,
              { title: 'Record Receipt', maxWidthClass: 'max-w-4xl' }
            );
          }}
          className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
        >
          Record Receipt
        </button>
      }
    />
  );
};

export const PaymentsTransactionsList = ({ db, setDb, currentCompany, openModal, onRecordPayment }) => {
  const rows = useMemo(() => {
    const companyId = currentCompany.id;
    const payments = safeArray(db.payments).filter((p) => p.companyId === companyId);

    return payments
      .filter((p) => String(p.direction || '').toUpperCase() === 'OUT' && p.voucherType !== 'invoice')
      .map((p) => {
        const isGroupedPayment = String(p.voucherType || '') === 'payment';
        const voucher = isGroupedPayment ? null : resolveVoucher({ db, companyId, voucherType: p.voucherType, voucherId: p.voucherId });
        const partyName = isGroupedPayment ? p.vendorName || '' : voucher?.vendorName || voucher?.partyName || '';
        return {
          id: p.id,
          status: p.status,
          backendPaymentId: p.backendPaymentId,
          date: p.date,
          amount: Number(p.amount ?? 0),
          mode: p.mode,
          reference: p.reference,
          notes: p.notes,
          typeLabel: getVoucherLabel(p.voucherType),
          documentNumber: isGroupedPayment ? p.paymentNo || '' : voucher?.number || '',
          partyName,
          allocations: isGroupedPayment ? safeArray(p.allocations) : null,
          advanceAmount: isGroupedPayment ? Number(p.advanceAmount ?? 0) : 0,
        };
      })
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db, currentCompany.id]);

  return (
    <TransactionsTable
      title="Payments"
      rows={rows}
      currentCompany={currentCompany}
      onReverse={setDb ? makeReverse({ setDb, currentCompany, noun: 'payment' }) : null}
      onView={(row) => {
        if (typeof openModal !== 'function') return;
        const title = row?.documentNumber ? `Payment ${row.documentNumber}` : 'Payment';
        openModal(<TransactionView title={title} payload={{ ...row, currentCompany }} />, {
          title,
          maxWidthClass: 'max-w-3xl',
        });
      }}
      rightActions={
        <button
          type="button"
          onClick={() => {
            if (typeof onRecordPayment === 'function') {
              onRecordPayment();
              return;
            }

            if (typeof openModal !== 'function' || typeof setDb !== 'function') return;
            /* Likewise: a GST challan, a bank charge and a salary advance
               are payments with no bill to pick, and this button used to
               insist on one before it would show the form. */
            openModal(
              <RecordDisbursementForm
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                onClose={() => openModal(null)}
              />,
              { title: 'Record Payment', maxWidthClass: 'max-w-5xl' }
            );
          }}
          className="px-4 py-2 rounded-lg ui-btn ui-btn-primary"
        >
          Record Payment
        </button>
      }
    />
  );
};

import { useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, Eye, MoreVertical, Pencil, Plus, Trash2, Undo2, Upload } from 'lucide-react';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { LIST_PERIODS, usePeriodFilter } from '@ui/components/ListControls';
import Popover from '@ui/components/ui/Popover';
import { EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import { useDismissable } from '@ui/components/ui/useDismissable';
import { formatMoney } from '@ui/utils/money';
import { cashBankIndex, cashBankTransactions } from './transactions';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * What happened to the money.
 *
 * One consolidated view of every movement through a cash or bank account,
 * whatever entered it — a payment, a receipt, a transfer between the company's
 * own accounts, or a line imported from the bank. The screen before it showed
 * imported rows split into "uncategorised" and "categorised", which is a
 * question about the import rather than about the account's own history.
 *
 * Account first, then period, on one line, and no search: §4. A cash book is
 * read down a column of dates for one account, not hunted through.
 */

const TYPE_STYLE = {
  Payment: { className: 'text-[rgb(var(--neg-ink))]', sign: '−' },
  Receipt: { className: 'text-[rgb(var(--pos-ink))]', sign: '' },
  Contra: { className: 'text-[rgb(var(--ov-blue))]', sign: '' },
};

export default function CashBankTransactions({
  db,
  currentCompany,
  onNewPayment = null,
  onNewReceipt = null,
  onNewContra = null,
  onImportStatement = null,
  /* Opens the screen that owns a row's source document — a cash-book row is
     a view of a payment, a journal or an imported line, never a record of its
     own, so acting on it means going to the thing itself. */
  onOpenSource = null,
  onEditSource = null,
  onDeleteSource = null,
  onUncategorise = null,
  onAllocateStatement = null,
  onOpenReconciliation = null,
  onOpenAccounts = null,
}) {
  const companyId = currentCompany?.id;
  const { accounts } = useMemo(() => cashBankIndex(db, companyId), [db, companyId]);
  const period = usePeriodFilter();

  const [accountId, setAccountId] = useState('');
  const newBtnRef = useRef(null);
  const [newOpen, setNewOpen] = useState(false);
  const [openActionId, setOpenActionId] = useState(null);
  /* One row's actions are open at a time, so one ref, attached to that row. It
     used to close only when its own button was pressed again. */
  const actionsRef = useDismissable(Boolean(openActionId), () => setOpenActionId(null));

  /* An account that has since been deleted reads as "All accounts" rather than
     as a dangling id — the same rule the branch field on a document follows. */
  const accountInList = accounts.some((a) => String(a.id) === String(accountId)) ? accountId : '';

  const rows = useMemo(
    () =>
      cashBankTransactions(db, companyId, {
        accountId: accountInList,
        from: period.dateFrom,
        to: period.dateTo,
      }),
    [db, companyId, accountInList, period.dateFrom, period.dateTo]
  );

  const newItems = [
    onNewPayment ? { key: 'payment', label: 'Payment', icon: ArrowUpRight, onSelect: onNewPayment } : null,
    onNewReceipt ? { key: 'receipt', label: 'Receipt', icon: ArrowDownLeft, onSelect: onNewReceipt } : null,
    onNewContra ? { key: 'contra', label: 'Contra — move between accounts', icon: ArrowLeftRight, onSelect: onNewContra } : null,
  ].filter(Boolean);

  return (
    <DocumentListShell
      entity="transfer"
      title="Transactions"
      tight
      className="cash-bank-transactions-page"
      company={currentCompany}
      moreItems={[
        onImportStatement ? { key: 'import', label: 'Import statement', Icon: Upload } : null,
        exportMenuItem('Export statement'),
        onOpenReconciliation ? { key: 'reco', label: 'Reconciliation' } : null,
        onOpenAccounts ? { key: 'accounts', label: 'Bank & cash accounts' } : null,
      ].filter(Boolean)}
      onMoreSelect={(key) => {
        if (key === 'import') onImportStatement?.();
        const format = exportFormatFromKey(key);
        if (format) {
          runListExport({
            format,
            title: 'Cash & bank transactions',
            fileName: 'Cash_Bank_Transactions',
            label: 'transaction(s)',
            rows,
            columns: [
              { key: 'date', label: 'Date' },
              { key: 'accountName', label: 'Account' },
              { key: 'ledgerName', label: 'Ledger Name' },
              { key: 'type', label: 'Type' },
              { key: 'amount', label: 'Amount' },
              { key: 'status', label: 'Status' },
            ],
          });
        }
        if (key === 'reco') onOpenReconciliation?.();
        if (key === 'accounts') onOpenAccounts?.();
      }}
      headerExtras={
        <>
          <select
            className="ui-select ui-ctl-compact w-52"
            aria-label="Account"
            value={String(accountInList || '')}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}
          </select>
          <select
            className="ui-select ui-ctl-compact w-36"
            aria-label="Period"
            value={period.period}
            onChange={(event) => period.setPeriod(event.target.value)}
          >
            {LIST_PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          {period.period === 'custom' ? (
            <>
              <input id="cb-from" aria-label="From date" type="date" className="ui-input ui-ctl-compact w-36" value={period.dateFrom} onChange={(event) => period.setDateFrom(event.target.value)} />
              <input id="cb-to" aria-label="To date" type="date" className="ui-input ui-ctl-compact w-36" value={period.dateTo} onChange={(event) => period.setDateTo(event.target.value)} />
            </>
          ) : null}
          {newItems.length ? (
            <>
            <button
              type="button"
              ref={newBtnRef}
              onClick={() => setNewOpen((v) => !v)}
              className="ui-btn ui-btn-primary"
              aria-haspopup="menu"
              aria-expanded={newOpen}
            >
              <Plus size={16} aria-hidden="true" /> New Transaction
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {newOpen ? (
              <Popover anchorRef={newBtnRef} onClose={() => setNewOpen(false)} minWidth={240}>
                <div className="py-1" role="menu">
                  {newItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button key={item.key} type="button" role="menuitem" onClick={() => { setNewOpen(false); item.onSelect?.(); }} className="ui-hover-sunken flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
                        <Icon size={16} aria-hidden="true" /> {item.label}
                      </button>
                    );
                  })}
                </div>
              </Popover>
            ) : null}
            </>
          ) : null}
        </>
      }
    >
      <div
        className={`ui-table-scroll cash-bank-transactions-scroll ${rows.length ? '' : 'cash-bank-transactions-empty'}`}
        {...(rows.length ? { 'data-fill-viewport': '' } : {})}
      >
        <table className="ui-table ui-table-sticky cash-bank-transactions-table">
          <colgroup>
            <col className="cash-txn-col-date" />
            <col className="cash-txn-col-account" />
            <col className="cash-txn-col-ledger" />
            <col className="cash-txn-col-type" />
            <col className="cash-txn-col-amount" />
            <col className="cash-txn-col-status" />
            <col className="cash-txn-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Account</th>
              <th scope="col">Ledger name</th>
              <th scope="col">Type</th>
              <th scope="col" className="text-end">Amount</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-end">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
      title="Nothing moved in this window"
                    message="Payments, receipts, transfers between your own accounts and imported bank lines all appear here."
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const style = TYPE_STYLE[r.type] || TYPE_STYLE.Receipt;
                return (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.accountName}</td>
                    <td className="truncate">{r.ledgerName}</td>
                    <td>
                      {/* Payment red, Receipt green, Contra blue — the type is
                          read from the colour before the word is read. */}
                      <span className={style.className}>{r.type}</span>
                    </td>
                    <td className={`ui-money ${style.className}`}>
                      {style.sign}
                      {formatMoney(r.amount, currentCompany)}
                    </td>
                    <td>
                      {r.kind === 'statement' && r.status === 'Uncategorised' && onAllocateStatement ? (
                        <button
                          type="button"
                          onClick={() => onAllocateStatement(r)}
                          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]"
                          title={`Record this as ${r.type}`}
                        >
                          <StatusPill status={r.status} />
                        </button>
                      ) : (
                        <StatusPill status={r.status} />
                      )}
                    </td>
                    <td className="text-end">
                      <div
                        className="relative inline-block text-left"
                        ref={openActionId === r.id ? actionsRef : undefined}
                      >
                        <button type="button" onClick={() => setOpenActionId((id) => id === r.id ? null : r.id)} className="ui-btn ui-btn-ghost ui-btn-sm" title="Actions" aria-label="Actions">
                          <MoreVertical size={18} aria-hidden="true" />
                        </button>
                        {openActionId === r.id ? (
                          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border ui-surface shadow-lg">
                            <button type="button" className="ui-hover-sunken flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => { setOpenActionId(null); onOpenSource?.(r); }}><Eye size={15} /> View</button>
                            <button type="button" className="ui-hover-sunken flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => { setOpenActionId(null); onEditSource?.(r); }}><Pencil size={15} /> Edit</button>
                            {r.kind === 'statement' && r.status === 'Categorised' && onUncategorise ? (
                              <button type="button" className="ui-hover-sunken flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => { setOpenActionId(null); onUncategorise(r); }}><Undo2 size={15} /> Mark as uncategorised</button>
                            ) : null}
                            <button type="button" className="ui-hover-sunken flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[rgb(var(--neg))]" onClick={() => { setOpenActionId(null); onDeleteSource?.(r); }}><Trash2 size={15} /> Delete</button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DocumentListShell>
  );
}

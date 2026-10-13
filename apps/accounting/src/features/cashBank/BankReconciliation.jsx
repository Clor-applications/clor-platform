import { useMemo, useState } from 'react';
import { CalendarCheck, Upload, Wand2 } from 'lucide-react';

import { PageHeader, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { LIST_PERIODS, usePeriodFilter } from '@ui/components/ListControls';
import { notify } from '@ui/components/ui/notify';
import { reconcilePayment } from '@ui/api/payments';
import { formatDateIn } from '@ui/utils/dates';
import { formatMoney, round2 } from '@ui/utils/money';
import { buildLedgerStatement } from '../../data/db';
import { cashBankIndex, cashBankTransactions } from './transactions';

/**
 * Reconciliation, as the specification defines it — and only that.
 *
 * One purpose: record the actual BANK DATE against each of the book's own
 * movements and mark them reconciled once a person confirms. The screen it
 * replaces did something else entirely — it matched a pasted statement
 * against the book line by line — and grew a progress panel and an allocate
 * side panel that the specification explicitly removes. Import and
 * allocation live on their own screens now; this one answers a narrower
 * question: for each movement in the book, when did the bank see it, and has
 * somebody confirmed that?
 *
 * The two dates are different facts and stay separate. Transaction Date is
 * when the book says it happened and is NEVER overwritten. Bank Date starts
 * equal to it — most movements clear same-day — and is edited where the
 * statement disagrees. Until Submit, nothing changes: Auto Reconcile and the
 * bulk bar only stage drafts, because "reconciled" is a person's confirmation
 * and not a side effect of touching a row.
 */

const TYPE_STYLE = {
  Payment: 'text-[rgb(var(--neg-ink))]',
  Receipt: 'text-[rgb(var(--pos-ink))]',
  Contra: 'text-[rgb(var(--ov-blue))]',
};

export default function BankReconciliation({ db, setDb, currentCompany, onImportStatement = null }) {
  const companyId = currentCompany?.id;
  const { accounts } = useMemo(() => cashBankIndex(db, companyId), [db, companyId]);
  const period = usePeriodFilter();

  const [accountId, setAccountId] = useState('');
  const accountInList = accounts.some((a) => String(a.id) === String(accountId)) ? accountId : '';
  const account = accounts.find((a) => String(a.id) === String(accountInList)) || null;

  const [tab, setTab] = useState('all');
  /* Drafts: bankDate edits per row key, and which rows are selected. Nothing
     here reaches the book until Submit. */
  const [draftDates, setDraftDates] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () =>
      cashBankTransactions(db, companyId, {
        accountId: accountInList,
        from: period.dateFrom,
        to: period.dateTo,
      }).filter((row) => !(row.kind === 'statement' && row.status === 'Uncategorised')),
    [db, companyId, accountInList, period.dateFrom, period.dateTo]
  );

  const unreconciled = rows.filter((r) => !r.reconciled);
  const reconciled = rows.filter((r) => r.reconciled);
  const shown = tab === 'unreconciled' ? unreconciled : tab === 'reconciled' ? reconciled : rows;

  /*
   * The three balances, all derived.
   *
   * Book balance is the ledger's own figure at the period end — the same
   * statement the Ledgers screen builds, never a number kept here. The bank
   * statement balance is the book LESS what the bank has not yet confirmed:
   * exactly the unreconciled movements. Which makes the Difference the net of
   * the unreconciled rows — the figure this screen exists to drive to zero.
   */
  const summary = useMemo(() => {
    if (!account) return null;
    const statement = buildLedgerStatement(db, companyId, account.id);
    const upTo = period.dateTo || '9999-12-31';
    const inWindow = (statement?.rows || []).filter((r) => String(r.date || '').slice(0, 10) <= upTo);
    const book = inWindow.length
      ? Number(inWindow[inWindow.length - 1]?.runningBalance || 0)
      : Number(statement?.openingBalance || 0);

    /* Signed impact on an asset ledger: money in raises it, money out lowers
       it. Every row carries its own flow — a contra's is taken from this
       account's side of the transfer. */
    const net = round2(unreconciled.reduce((t, r) => t + (r.flow === 'IN' ? r.amount : -r.amount), 0));

    return {
      book: round2(book),
      bank: round2(book - net),
      difference: round2(net),
      unreconciledCount: unreconciled.length,
      total: rows.length,
    };
  }, [db, companyId, account, period.dateTo, rows, unreconciled]);

  const bankDateOf = (r) => draftDates[r.id] ?? r.date;

  /* The latest audit entry per row — later submits overwrite earlier ones in
     the map, and the full trail stays in db.bankDateAudit. */
  const auditByRow = useMemo(() => {
    const m = new Map();
    for (const a of db?.bankDateAudit || []) {
      if (Number(a?.companyId) !== Number(companyId)) continue;
      m.set(`${a.kind}:${a.sourceId}`, a);
    }
    return m;
  }, [db?.bankDateAudit, companyId]);

  const toggle = (id, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(String(id));
      else next.delete(String(id));
      return next;
    });

  const allShownSelected = shown.length > 0 && shown.every((r) => r.reconciled || selected.has(String(r.id)));

  /* §9: sets Bank Date = Transaction Date for the unreconciled rows in hand —
     the selected ones, or all of them when nothing is selected. It stages;
     it never finalizes. */
  const autoReconcileSameDate = () => {
    const targets = unreconciled.filter((r) => (selected.size ? selected.has(String(r.id)) : true));
    if (!targets.length) return;
    setDraftDates((prev) => {
      const next = { ...prev };
      for (const r of targets) next[r.id] = r.date;
      return next;
    });
    setSelected(new Set(targets.map((r) => String(r.id))));
    notify.success(`${targets.length} row(s) staged with Bank Date = Transaction Date. Review, then Submit.`);
  };

  /* Submit is the one write. Everything before it was a draft. */
  const submit = async () => {
    const targets = unreconciled.filter((r) => selected.has(String(r.id)));
    if (!targets.length || saving) return;

    /* The confirmation boundary validates what it confirms: every row needs
       a real bank date — "the bank saw it on no date" is not a fact a
       reconciliation can record. */
    const dateless = targets.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(String(bankDateOf(r) || '')));
    if (dateless) {
      notify.error(`${dateless.number || dateless.ledgerName}: give it a bank date before submitting.`);
      return;
    }
    setSaving(true);

    /* Best-effort server sync for movements the server knows. A refusal on
       one must not take the rest down; the local book is marked regardless,
       and the row names the statement date it was confirmed against. */
    for (const r of targets) {
      if (r.kind !== 'payment') continue;
      const payment = (db.payments || []).find((p) => String(p.id) === String(r.sourceId));
      const serverId = String(payment?.backendPaymentId || '').trim();
      if (!serverId) continue;
      try {
        await reconcilePayment(serverId, { reconciled: true, bankDate: bankDateOf(r) });
      } catch {
        /* Offline or refused — the local mark still stands; sync owns catch-up. */
      }
    }

    const byKind = { payment: new Map(), contra: new Map(), statement: new Map() };
    for (const r of targets) byKind[r.kind]?.set(String(r.sourceId), bankDateOf(r));

    /*
     * The audit trail of the one thing this screen is allowed to change.
     *
     * A bank date is a claim about the bank's records, and a claim somebody
     * altered must say from what, to what, by whom and when — or the next
     * auditor is reading a number with no history. The transaction date is
     * recorded alongside precisely because it never changes: the pair proves
     * the accounting date survived the reconciliation.
     */
    const stamp = new Date().toISOString();
    const who = String(localStorage.getItem('userEmail') || '').trim() || 'User';
    const auditRows = targets.map((r) => ({
      companyId,
      kind: r.kind,
      sourceId: r.sourceId,
      voucherNo: r.number || '',
      accountId: r.accountId,
      transactionDate: r.date,
      previousBankDate: r.bankDate || r.date,
      bankDate: bankDateOf(r),
      action: 'RECONCILED',
      by: who,
      at: stamp,
    }));

    setDb((prev) => {
      let nextAuditId = (prev.bankDateAudit || []).reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0);
      return {
        ...prev,
        payments: (prev.payments || []).map((p) =>
          byKind.payment.has(String(p.id)) ? { ...p, reconciled: true, bankDate: byKind.payment.get(String(p.id)) } : p
        ),
        journalEntries: (prev.journalEntries || []).map((j) =>
          byKind.contra.has(String(j.id)) ? { ...j, reconciled: true, bankDate: byKind.contra.get(String(j.id)) } : j
        ),
        bankTransactions: (prev.bankTransactions || []).map((t) =>
          byKind.statement.has(String(t.id)) ? { ...t, reconciled: true, bankDate: byKind.statement.get(String(t.id)) } : t
        ),
        bankDateAudit: [...(prev.bankDateAudit || []), ...auditRows.map((a) => ({ ...a, id: ++nextAuditId }))],
      };
    });

    setSelected(new Set());
    setDraftDates({});
    setSaving(false);
    notify.success(`${targets.length} transaction(s) reconciled.`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        entity="bank"
        title="Bank Reconciliation"
      />

      {/* Account first, Period second, Import Statement third — one line,
          the specification's order. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 sm:w-72">
          <PopupSelect
            label="Account"
      title="accounts"
            value={String(accountInList || '')}
            onChange={(next) => {
              setAccountId(String(next || ''));
              setSelected(new Set());
              setDraftDates({});
            }}
            options={accounts.map((a) => ({ value: String(a.id), label: String(a.name || '') }))}
            placeholder="Select account"
            showValueSubtext={false}
          />
        </div>
        <div className="min-w-0 sm:w-56">
          <PopupSelect
            label="Period"
      title="periods"
            value={period.period}
            onChange={(next) => period.setPeriod(String(next || 'all'))}
            options={LIST_PERIODS.map((p) => ({ value: p.key, label: p.label }))}
            placeholder="All time"
            showValueSubtext={false}
          />
        </div>
        {onImportStatement ? (
          <button type="button" onClick={onImportStatement} className="ui-btn ui-btn-primary">
            <Upload size={16} aria-hidden="true" /> Import Statement
          </button>
        ) : null}
      </div>

      {!account ? (
        <EmptyState
          title="Pick an account"
          message="Reconciliation is one account at a time — choose the bank or cash account the statement belongs to."
        />
      ) : (
        <>
          {/* Book, bank, difference, and how many rows stand between them. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="ui-card p-4">
              <div className="ui-caption">Book balance{period.dateTo ? ` (as on ${formatDateIn(period.dateTo)})` : ''}</div>
              <div className="ui-money-lg mt-1">{formatMoney(summary.book, currentCompany)}</div>
            </div>
            <div className="ui-card p-4">
              <div className="ui-caption">Bank statement balance</div>
              <div className="ui-money-lg mt-1">{formatMoney(summary.bank, currentCompany)}</div>
            </div>
            <div
              className="ui-card p-4"
              style={Math.abs(summary.difference) > 0.005 ? { borderColor: 'rgb(var(--neg))' } : undefined}
            >
              <div className="ui-caption">Difference</div>
              <div
                className={`ui-money-lg mt-1 ${Math.abs(summary.difference) > 0.005 ? 'text-[rgb(var(--neg-ink))]' : 'text-[rgb(var(--pos-ink))]'}`}
              >
                {formatMoney(summary.difference, currentCompany)}
              </div>
            </div>
            <div className="ui-card p-4">
              <div className="ui-caption">Unreconciled transactions</div>
              <div className="ui-money-lg mt-1">
                {summary.unreconciledCount} of {summary.total}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="ui-segmented" role="tablist" aria-label="Reconciliation view">
              {[
                { value: 'all', label: `All Transactions (${rows.length})` },
                { value: 'unreconciled', label: `Unreconciled (${unreconciled.length})` },
                { value: 'reconciled', label: `Reconciled (${reconciled.length})` },
              ].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  data-active={tab === t.value || undefined}
                  onClick={() => setTab(t.value)}
                  className="ui-segment"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={autoReconcileSameDate}
              disabled={!unreconciled.length}
              className="ui-btn ui-btn-secondary"
      title="Stage Bank Date = Transaction Date for the rows in hand. Nothing is final until Submit."
            >
              <Wand2 size={16} aria-hidden="true" /> Auto Reconcile (Same Date)
            </button>
          </div>

          <div className="ui-card overflow-hidden">
            <div className="ui-table-scroll">
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col" className="w-10">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        aria-label="Select every unreconciled row shown"
                        checked={allShownSelected && shown.some((r) => !r.reconciled)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? new Set(shown.filter((r) => !r.reconciled).map((r) => String(r.id)))
                              : new Set()
                          )
                        }
                      />
                    </th>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Voucher No.</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="text-end">Amount (₹)</th>
                    <th scope="col">Transaction Date</th>
                    <th scope="col">Bank Date</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
      title="Nothing here"
                          message="Payments, receipts, contras and imported lines for this account appear here with their bank dates."
                        />
                      </td>
                    </tr>
                  ) : (
                    shown.map((r) => {
                      const done = r.reconciled;
                      return (
                        <tr key={r.id}>
                          <td>
                            {done ? null : (
                              <input
                                type="checkbox"
                                className="ui-checkbox"
                                aria-label={`Select ${r.number || r.ledgerName}`}
                                checked={selected.has(String(r.id))}
                                onChange={(e) => toggle(r.id, e.target.checked)}
                              />
                            )}
                          </td>
                          <td>{formatDateIn(r.date)}</td>
                          <td className="truncate">{r.ledgerName}</td>
                          <td className="ui-mono">{r.number || '—'}</td>
                          <td>
                            <span className={TYPE_STYLE[r.type] || ''}>{r.type}</span>
                          </td>
                          <td className={`ui-money ${TYPE_STYLE[r.type] || ''}`}>
                            {r.type === 'Payment' ? '−' : ''}
                            {formatMoney(r.amount, currentCompany)}
                          </td>
                          {/* The book's date. Never overwritten — §8. */}
                          <td>{formatDateIn(r.date)}</td>
                          <td>
                            {done ? (
                              (() => {
                                const audit = auditByRow.get(`${r.kind}:${r.sourceId}`);
                                const moved = String(r.bankDate || r.date) !== String(r.date);
                                return (
                                  <span
      title={
                                      audit
                                        ? `Reconciled by ${audit.by} on ${formatDateIn(audit.at)} — bank date ${formatDateIn(audit.bankDate)}, transaction date ${formatDateIn(audit.transactionDate)}`
                                        : undefined
                                    }
                                  >
                                    {formatDateIn(r.bankDate || r.date)}
                                    {moved ? <span className="ui-caption ms-1">(txn {formatDateIn(r.date)})</span> : null}
                                  </span>
                                );
                              })()
                            ) : (
                              <input
                                type="date"
                                className="ui-input w-36 text-sm ui-ctl-compact"
                                aria-label={`Bank date for ${r.number || r.ledgerName}`}
                                value={bankDateOf(r)}
                                onChange={(e) => setDraftDates((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              />
                            )}
                          </td>
                          <td>
                            <StatusPill status={done ? 'Reconciled' : 'Unreconciled'} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* The staging bar: visible only while a decision is pending, and
              Submit is the only thing on the page that writes. */}
          {selected.size > 0 ? (
            <div className="ui-card sticky bottom-4 flex flex-wrap items-center gap-3 p-3 shadow-lg">
              <span className="text-sm font-medium">{selected.size} transaction(s) selected</span>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() =>
                  setDraftDates((prev) => {
                    const next = { ...prev };
                    for (const r of unreconciled) if (selected.has(String(r.id))) next[r.id] = r.date;
                    return next;
                  })
                }
              >
                <CalendarCheck size={16} aria-hidden="true" /> Bulk Reconcile — Bank Date = Transaction Date
              </button>
              <div className="ms-auto flex items-center gap-2">
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary"
                  onClick={() => {
                    setSelected(new Set());
                    setDraftDates({});
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="ui-btn ui-btn-primary" disabled={saving} onClick={submit}>
                  {saving ? 'Submitting…' : `Submit ${selected.size} as reconciled`}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

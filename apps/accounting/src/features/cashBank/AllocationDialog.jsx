import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Plus, Trash2 } from 'lucide-react';

import Modal from '@ui/components/ui/Modal';
import { notify } from '@ui/components/ui/notify';
import { formatMoney, round2 } from '@ui/utils/money';
import { postJournalToLedger } from '@ui/utils/journalSync';
import { formatDateIn } from '@ui/utils/dates';
import RecordReceiptForm from '../payments/RecordReceiptForm';
import { applyVendorPayments, buildVendorPayment, outstandingDocsForVendor } from '../payments/paymentService';
import { allocationJournalLines, allocationSummary, partyForLedger, validateAllocation } from './allocations';

/**
 * One bank line, split across the book.
 *
 * The parent — what the bank said — sits at the top and cannot be touched
 * from here. Underneath, the child rows say what the money was. The three
 * figures the specification insists on are always in view: Bank Amount,
 * Allocated, Difference — and posting demands the difference at zero.
 *
 * A row comes in kinds, and the ledger picked decides which:
 *
 * ORDINARY ledgers (bank charges, interest, GST…) stay plain rows — a
 * ledger, an amount, a narration — and post together as one journal through
 * the same engine a hand-typed entry uses.
 *
 * VENDOR ledgers open their bills INLINE. One bank debit routinely settles
 * five vendors, and five vendors must not mean five payment forms: the row
 * unfolds the vendor's outstanding queue, bills are ticked and part-paid in
 * place, and at post each vendor row becomes one payment voucher through the
 * payment service — the same engine the disbursement form drives, so the
 * knock-off, the advance for any excess, the series number and the server
 * posting are all the real ones. Outstanding balances move only inside that
 * engine; this dialog never edits them.
 *
 * CUSTOMER ledgers on a credit hand over to the receipt form, whose advance
 * and invoice-allocation logic already answer the receivable side.
 *
 * Rows the engine settled carry their voucher and are excluded from the
 * closing journal, whose bank leg covers only the plain rows.
 */
const AllocationDialog = ({ db, setDb, currentCompany, txn, onClose }) => {
  const companyId = currentCompany?.id;
  const out = String(txn?.direction || '').toUpperCase() === 'OUT';

  const ledgers = useMemo(
    () =>
      (db?.chartOfAccounts || [])
        .filter((a) => a.companyId === companyId)
        .filter((a) => String(a.id) !== String(txn?.cashBankAccountId))
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [db?.chartOfAccounts, companyId, txn?.cashBankAccountId]
  );

  const existing = useMemo(
    () =>
      (db?.bankAllocations || [])
        .filter((a) => Number(a.companyId) === Number(companyId))
        .filter((a) => String(a.bankTransactionId) === String(txn?.id)),
    [db?.bankAllocations, companyId, txn?.id]
  );

  const emptyRow = () => ({
    ledgerId: '',
    amount: '',
    narration: '',
    /* Bill picks for a vendor row: `${voucherType}:${id}` → amount string. */
    bills: {},
    open: false,
    paymentId: null,
    paymentNumber: '',
    partyKind: '',
    partyId: null,
  });

  const [rows, setRows] = useState(() =>
    existing.length
      ? existing.map((a) => ({
          ...emptyRow(),
          ledgerId: String(a.ledgerId || ''),
          amount: String(a.amount ?? ''),
          narration: String(a.narration || ''),
          paymentId: a.paymentId ?? null,
          paymentNumber: String(a.paymentNumber || ''),
          partyKind: String(a.partyKind || ''),
          partyId: a.partyId ?? null,
        }))
      : [emptyRow()]
  );

  /* A customer row inside the receipt form, or null. */
  const [engineRow, setEngineRow] = useState(null);
  const [saving, setSaving] = useState(false);

  const numericRows = rows.map((r) => ({ ...r, amount: Number(r.amount || 0) }));
  const summary = allocationSummary(txn, numericRows);
  const check = validateAllocation(txn, numericRows);

  const setRow = (i, patch) => setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (i) => setRows((prev) => (prev.length > 1 ? prev.filter((_, n) => n !== i) : prev));

  const rowParty = (r) => {
    const hit = partyForLedger(db, companyId, r.ledgerId);
    if (!hit) return null;
    if (hit.kind === 'vendor' && !out) return null;
    if (hit.kind === 'customer' && out) return null;
    return hit;
  };

  const billsSum = (r) => round2(Object.values(r.bills || {}).reduce((t, v) => t + Math.abs(Number(v || 0)), 0));

  /** Ticking / typing against one bill updates the pick and the row amount. */
  const setBill = (i, key, value, { keepAmount = false } = {}) =>
    setRows((prev) =>
      prev.map((r, n) => {
        if (n !== i) return r;
        const bills = { ...(r.bills || {}) };
        if (value === null) delete bills[key];
        else bills[key] = value;
        const sum = round2(Object.values(bills).reduce((t, v) => t + Math.abs(Number(v || 0)), 0));
        /* The row's amount follows the bills unless the user has typed past
           them — an excess over the bills is an advance, and stays. */
        const amount = keepAmount && Number(r.amount || 0) > sum ? r.amount : String(sum || '');
        return { ...r, bills, amount };
      })
    );

  /* What, beyond the shared sum check, would stop a POST. */
  const rowProblems = [];
  for (const r of numericRows) {
    const hit = rowParty(r);
    if (hit?.kind !== 'vendor' || r.paymentId) continue;
    const sum = billsSum(r);
    if (sum > r.amount + 0.005) rowProblems.push(`${hit.party?.name || 'A vendor'}: bills exceed the row's amount.`);
    const queue = outstandingDocsForVendor(db, companyId, hit.party.id);
    for (const [key, v] of Object.entries(r.bills || {})) {
      const doc = queue.find((d) => d.key === key);
      if (doc && Math.abs(Number(v || 0)) > doc.balance + 0.005) {
        rowProblems.push(`${doc.number || 'A bill'}: allocated more than its balance.`);
      }
    }
  }
  const canPost = check.canPost && rowProblems.length === 0 && !saving;

  /*
   * The one sanctioned shortcut past a nonzero difference: a company may
   * CONFIGURE an adjustment ledger (rounding, small bank charges), and then
   * the residual can be resolved onto it — as a visible row that posts
   * through the same journal as any other, never as a silent write-off. No
   * configuration, no shortcut: the difference is closed by hand or not at
   * all.
   */
  const adjustmentLedger = useMemo(() => {
    const id = String(currentCompany?.profile?.cashBank?.adjustmentLedgerId || '').trim();
    if (!id) return null;
    return ledgers.find((l) => String(l.id) === id) || null;
  }, [currentCompany, ledgers]);

  const resolveDifference = () => {
    if (!adjustmentLedger || summary.difference <= 0.004) return;
    setRows((prev) => [
      ...prev.filter((r) => String(r.ledgerId || '').trim() || Number(r.amount || 0) > 0),
      {
        ...emptyRow(),
        ledgerId: String(adjustmentLedger.id),
        amount: String(summary.difference),
        narration: 'Difference adjustment',
      },
    ]);
  };

  /** What the receipt engine settled comes back as the row's own facts. */
  const engineSaved = (i, hit) => (payment) => {
    const settled = round2(Number(payment?.netCash ?? payment?.netCashAmount ?? payment?.amount ?? 0));
    setRow(i, {
      amount: String(settled || ''),
      paymentId: payment?.id ?? null,
      paymentNumber: String(payment?.number || payment?.paymentNo || ''),
      partyKind: hit.kind,
      partyId: hit.party?.id ?? null,
    });
    setEngineRow(null);
  };

  /** Replace this txn's child rows; post the accounting only when told to. */
  const save = async ({ post }) => {
    if (saving) return;
    const live = rows
      .map((r) => ({
        ledgerId: String(r.ledgerId || '').trim(),
        amount: round2(Math.abs(Number(r.amount || 0))),
        narration: String(r.narration || '').trim(),
        bills: r.bills || {},
        party: rowParty(r),
        paymentId: r.paymentId ?? null,
        paymentNumber: String(r.paymentNumber || ''),
        partyKind: String(r.partyKind || ''),
        partyId: r.partyId ?? null,
      }))
      .filter((r) => r.amount > 0.005);

    if (post && !canPost) {
      if (rowProblems.length) notify.error(rowProblems[0]);
      return;
    }
    if (!post && !check.canSave) {
      notify.error(check.problems[0] || 'Nothing to save.');
      return;
    }

    /*
     * Vendor rows become payment vouchers — sequentially, so five payments
     * raised out of one debit take five consecutive numbers. A refusal stops
     * the whole batch before anything is written: half a settlement is a
     * book nobody can explain.
     */
    let records = [];
    if (post) {
      const bankRow = (db.chartOfAccounts || []).find(
        (a) => a.companyId === companyId && String(a.id) === String(txn?.cashBankAccountId)
      );
      const serverBankLedgerId = String(bankRow?.serverLedgerAccountId || '').trim();
      const baseId = (db.payments || []).reduce((m, p) => Math.max(m, Number(p?.id || 0)), 0);
      const taken = [];
      setSaving(true);
      try {
        for (const r of live) {
          if (r.party?.kind !== 'vendor' || r.paymentId) continue;
          const record = await buildVendorPayment({
            db,
            currentCompany,
            vendorId: r.party.party.id,
            date: txn.date,
            amount: r.amount,
            lines: Object.entries(r.bills)
              .map(([key, v]) => {
                const [voucherType, voucherId] = key.split(':');
                return { voucherType, voucherId, amount: Number(v || 0) };
              })
              .filter((l) => l.amount > 0.005),
            ledgerAccountId: serverBankLedgerId,
            cashBankAccountId: txn?.cashBankAccountId,
            sourceBankTransactionId: txn?.id,
            notes: r.narration || String(txn?.narration || txn?.description || '').trim(),
            nextLocalId: baseId + records.length + 1,
            takenNumbers: taken,
          });
          taken.push(record.number);
          records.push(record);
          r.paymentId = record.id;
          r.paymentNumber = record.number;
          r.partyKind = 'vendor';
          r.partyId = r.party.party.id;
        }
      } catch (e) {
        setSaving(false);
        notify.error(String(e?.message || e));
        return;
      }
      setSaving(false);
    }

    const direct = live.filter((r) => !r.paymentId);
    const directTotal = round2(direct.reduce((t, r) => t + r.amount, 0));

    let journalPatch = {};
    let journalId = null;
    if (post && direct.length) {
      const accounts = (db.chartOfAccounts || []).filter((a) => a.companyId === companyId);
      const lines = allocationJournalLines(txn, live).map((l) => {
        const acc = accounts.find((a) => String(a.id) === String(l.accountId));
        return { ...l, accountName: acc?.name || '', accountCode: acc?.code || '' };
      });
      journalPatch = await postJournalToLedger({
        chartRows: accounts,
        entry: {
          date: txn.date,
          narration: `Bank allocation — ${String(txn.narration || txn.description || '').trim() || txn.date}`,
          lines,
        },
      });
      journalId = ((db.journalEntries || []).reduce((m, j) => Math.max(m, Number(j?.id || 0)), 0) || 0) + 1;
    }

    setDb((prev) => {
      /* First the payment engine's own writes, then this dialog's records. */
      const base = post && records.length ? applyVendorPayments(prev, companyId, records) : prev;

      const others = (base.bankAllocations || []).filter(
        (a) => !(Number(a.companyId) === Number(companyId) && String(a.bankTransactionId) === String(txn.id))
      );
      let nextId = (base.bankAllocations || []).reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;
      const children = live.map((r) => ({
        id: nextId++,
        companyId,
        bankTransactionId: txn.id,
        ledgerId: r.ledgerId,
        amount: r.amount,
        narration: r.narration,
        paymentId: r.paymentId,
        paymentNumber: r.paymentNumber || undefined,
        partyKind: r.partyKind || undefined,
        partyId: r.partyId ?? undefined,
        journalEntryId: post && !r.paymentId ? journalId : null,
        createdAt: new Date().toISOString(),
      }));

      const journalEntry =
        post && direct.length
          ? {
              id: journalId,
              companyId,
              number: `BA-${txn.id}`,
              date: txn.date,
              narration: `Bank allocation — ${String(txn.narration || txn.description || '').trim() || txn.date}`,
              lines: allocationJournalLines(txn, live).map((l) => {
                const acc = (base.chartOfAccounts || []).find((a) => String(a.id) === String(l.accountId));
                return { ...l, accountName: acc?.name || '', accountCode: acc?.code || '' };
              }),
              totalDebit: directTotal,
              totalCredit: directTotal,
              sourceBankTransactionId: txn.id,
              createdAt: new Date().toISOString(),
              ...journalPatch,
            }
          : null;

      return {
        ...base,
        bankAllocations: [...others, ...children],
        journalEntries: journalEntry ? [...(base.journalEntries || []), journalEntry] : base.journalEntries,
        /* The parent's bank-side facts never move; what changes is only the
           note that its accounting now exists. */
        bankTransactions: (base.bankTransactions || []).map((t) =>
          t.companyId === companyId && String(t.id) === String(txn.id)
            ? { ...t, allocationJournalId: journalEntry ? journalId : t.allocationJournalId ?? null }
            : t
        ),
      };
    });

    notify.success(post ? 'Allocated and posted.' : 'Allocation saved — not posted yet.');
    onClose?.();
  };

  /* The receipt engine, opened inside this dialog for one customer row. */
  if (engineRow) {
    const { index, hit } = engineRow;
    const r = rows[index];
    return (
      <Modal
        onClose={() => setEngineRow(null)}
        title="Allocate Invoices — record receipt"
        maxWidthClass="max-w-5xl"
      >
        <RecordReceiptForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          hideMode={true}
          initialData={{
            date: txn?.date,
            amount: String(Number(r?.amount || 0) > 0.005 ? r.amount : summary.difference || ''),
            mode: 'Bank',
            notes: String(txn?.narration || txn?.description || '').trim(),
            cashBankAccountId: txn?.cashBankAccountId,
            sourceBankTransactionId: txn?.id,
            customerId: String(hit.party.id),
          }}
          onSaved={engineSaved(index, hit)}
          onClose={() => setEngineRow(null)}
        />
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Allocate bank transaction" maxWidthClass="max-w-4xl">
      <div className="space-y-4">
        {/* The immutable parent, stated, not editable. */}
        <div className="ui-sunken rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{txn?.date}</span>
            <span className="ui-muted truncate">{String(txn?.narration || txn?.description || '').trim() || '—'}</span>
            {txn?.reference ? <span className="ui-mono ui-muted">{txn.reference}</span> : null}
            <span className={`ui-money ms-auto ${out ? 'text-[rgb(var(--neg-ink))]' : 'text-[rgb(var(--pos-ink))]'}`}>
              {out ? '−' : ''}{formatMoney(summary.bankAmount, currentCompany)}
            </span>
          </div>
        </div>

        {/* The three figures, always on screen. */}
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="ui-caption">Bank amount</dt>
            <dd className="ui-money">{formatMoney(summary.bankAmount, currentCompany)}</dd>
          </div>
          <div>
            <dt className="ui-caption">Allocated</dt>
            <dd className="ui-money">{formatMoney(summary.allocated, currentCompany)}</dd>
          </div>
          <div>
            <dt className="ui-caption">Difference</dt>
            <dd className={`ui-money ${Math.abs(summary.difference) > 0.005 ? 'text-[rgb(var(--neg-ink))]' : 'text-[rgb(var(--pos-ink))]'}`}>
              {formatMoney(summary.difference, currentCompany)}
            </dd>
          </div>
        </dl>

        <div className="space-y-2">
          {rows.map((r, i) => {
            /* A row already settled by a voucher states it and stays put. */
            if (r.paymentId) {
              const acc = ledgers.find((l) => String(l.id) === String(r.ledgerId));
              return (
                <div key={i} className="ui-sunken flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                  <FileText size={16} aria-hidden="true" className="ui-muted shrink-0" />
                  <span className="truncate">{acc?.name || 'Party ledger'}</span>
                  <span className="ui-caption">
                    settled via {r.paymentNumber || (r.partyKind === 'customer' ? 'receipt' : 'payment')}
                  </span>
                  <span className="ui-money ms-auto">{formatMoney(Number(r.amount || 0), currentCompany)}</span>
                </div>
              );
            }

            const hit = rowParty(r);
            const isVendor = hit?.kind === 'vendor';
            const queue = isVendor ? outstandingDocsForVendor(db, companyId, hit.party.id) : [];
            const sum = billsSum(r);
            const advance = round2(Math.max(0, Number(r.amount || 0) - sum));

            return (
              <div key={i} className={isVendor && r.open ? 'rounded-lg border p-2' : undefined}>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="ui-label" htmlFor={`alloc-ledger-${i}`}>Ledger</label>
                    <select
                      id={`alloc-ledger-${i}`}
                      className="ui-select w-full"
                      value={r.ledgerId}
                      onChange={(e) => setRow(i, { ledgerId: e.target.value, bills: {}, open: false })}
                    >
                      <option value="">Select ledger</option>
                      {ledgers.map((l) => (
                        <option key={l.id} value={String(l.id)}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  {isVendor ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary whitespace-nowrap"
                      aria-expanded={Boolean(r.open)}
                      onClick={() => setRow(i, { open: !r.open })}
                    >
                      {r.open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      Allocate Bills{Object.keys(r.bills || {}).length ? ` (${Object.keys(r.bills).length})` : ''}
                    </button>
                  ) : hit?.kind === 'customer' ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary whitespace-nowrap"
                      onClick={() => setEngineRow({ index: i, hit })}
                    >
                      Allocate Invoices
                    </button>
                  ) : null}

                  <div className="w-32">
                    <label className="ui-label" htmlFor={`alloc-amount-${i}`}>Amount</label>
                    <input
                      id={`alloc-amount-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="ui-input ui-money ui-val-center w-full"
                      value={r.amount}
                      onChange={(e) => setRow(i, { amount: e.target.value })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="ui-label" htmlFor={`alloc-narr-${i}`}>Narration</label>
                    <input
                      id={`alloc-narr-${i}`}
                      type="text"
                      className="ui-input w-full"
                      value={r.narration}
                      onChange={(e) => setRow(i, { narration: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                    className="ui-icon-btn"
                    aria-label={`Remove allocation row ${i + 1}`}
                  >
                    <Trash2 size={16} aria-hidden="true" className="text-[rgb(var(--neg))]" />
                  </button>
                </div>

                {/* The vendor's queue, unfolded in place: tick a bill, part-pay
                    it, and the row's amount follows. No payment form. */}
                {isVendor && r.open ? (
                  <div className="mt-2 space-y-1">
                    {queue.length === 0 ? (
                      <p className="ui-caption px-1">
                        No outstanding bills — the whole amount will be recorded as an advance to {hit.party?.name || 'this vendor'}.
                      </p>
                    ) : (
                      <div className="max-h-44 overflow-y-auto rounded-lg border">
                        <table className="ui-table">
                          <thead>
                            <tr>
                              <th scope="col" className="w-8"></th>
                              <th scope="col">Bill</th>
                              <th scope="col">Date</th>
                              <th scope="col" className="text-end">Outstanding</th>
                              <th scope="col" className="text-end">Pay</th>
                            </tr>
                          </thead>
                          <tbody>
                            {queue.map((d) => {
                              const picked = Object.prototype.hasOwnProperty.call(r.bills || {}, d.key);
                              return (
                                <tr key={d.key}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      className="ui-checkbox"
                                      aria-label={`Settle ${d.number || d.key}`}
                                      checked={picked}
                                      onChange={(e) => setBill(i, d.key, e.target.checked ? String(d.balance) : null)}
                                    />
                                  </td>
                                  <td className="ui-mono">{d.number || '—'}</td>
                                  <td>{formatDateIn(d.date)}</td>
                                  <td className="ui-money">{formatMoney(d.balance, currentCompany)}</td>
                                  <td className="text-end">
                                    <input
                                      type="number"
                                      min="0"
                                      max={d.balance}
                                      step="0.01"
                                      className="ui-input ui-money w-28 text-sm ui-ctl-compact"
                                      aria-label={`Amount against ${d.number || d.key}`}
                                      value={picked ? r.bills[d.key] : ''}
                                      disabled={!picked}
                                      onChange={(e) => setBill(i, d.key, e.target.value)}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {advance > 0.005 ? (
                      <p className="ui-caption px-1">
                        {formatMoney(advance, currentCompany)} beyond the ticked bills will be recorded as an advance.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRow} className="ui-btn ui-btn-secondary ui-btn-sm">
              <Plus size={14} aria-hidden="true" /> Add Allocation
            </button>
            {adjustmentLedger && summary.difference > 0.004 ? (
              <button type="button" onClick={resolveDifference} className="ui-btn ui-btn-secondary ui-btn-sm">
                Resolve {formatMoney(summary.difference, currentCompany)} via {adjustmentLedger.name}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <p className="ui-caption">
            {rowProblems[0] ||
              (canPost
                ? 'Fully allocated — vendor rows post as payment vouchers, plain rows as one journal.'
                : 'Post needs the difference at zero; Save keeps a partial split without posting.')}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!check.canSave || saving} onClick={() => save({ post: false })}>
              Save
            </button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={!canPost} onClick={() => save({ post: true })}>
              {saving ? 'Posting…' : 'Allocate & post'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AllocationDialog;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { CheckCircle2, ClipboardList, Download, FileSpreadsheet, Link2, MoreVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react';

import Modal from '@ui/components/ui/Modal';
import { postJournalToLedger } from '@ui/utils/journalSync';
import { useDismissable } from '@ui/components/ui/useDismissable';
import AllocationDialog from './AllocationDialog';
import { allocationSummary, allocationsForTxn } from './allocations';
import RecordReceiptForm from '../payments/RecordReceiptForm';
import RecordDisbursementForm from '../payments/RecordDisbursementForm';
import { applyVendorPayments, buildCustomerReceipt, buildVendorPayment } from '../payments/paymentService';
import { formatMoney, round2 } from '@ui/utils/money';
import { useListSearch } from '@ui/components/ListToolbar';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { EmptyState, TableTotals, StatusPill } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { ArrowDownLeft, ArrowUpRight, Landmark, ListTodo } from 'lucide-react';
import { DocumentNumber, DocDate, MoneyValue } from '@ui/components/docs';
import { csvSafeValue } from '@ui/utils/csv';
import { patchBankEntry, removeBankEntry, saveBankEntry } from '@ui/utils/bankBookSync';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import {
  inferDirection,
  parseCsv,
  normalizeDate,
  normalizeHeader,
  parseAmount,
  toIsoDate,
} from '@ui/utils/statementImport';
import { PermissionButton } from '@ui/permissions/ActionGuard';

const safeArray = (v) => (Array.isArray(v) ? v : []);







const CashBankModule = ({ db, setDb, currentCompany, openModal, openLedgerCreate, openTxnLedgerCreate }) => {
  const companyId = Number(currentCompany?.id || 0);

  const nextNumericId = (list, field = 'id') => {
    return safeArray(list).reduce((m, x) => Math.max(m, Number(x?.[field] || 0)), 0) + 1;
  };

  const getInvoiceBalance = (inv) => {
    const total = Number(inv?.total ?? 0);
    const paid = Number(inv?.paidAmount ?? 0);
    const bal = total - paid;
    return Number.isFinite(bal) ? Math.max(0, round2(bal)) : 0;
  };

  const canCollectAgainstInvoice = (inv) => {
    const rawStatus = String(inv?.status || '').trim();
    if (rawStatus === 'Draft') return false;
    if (rawStatus === 'Cancelled') return false;
    return getInvoiceBalance(inv) > 0.0001;
  };

  const getDocBalance = (doc) => {
    const total = Number(doc?.total ?? 0);
    const paid = Number(doc?.paidAmount ?? 0);
    const bal = total - paid;
    return Number.isFinite(bal) ? Math.max(0, round2(bal)) : 0;
  };

  const canPayDoc = (doc) => {
    const rawStatus = String(doc?.status || '').trim();
    if (rawStatus === 'Draft') return false;
    if (rawStatus === 'Cancelled') return false;
    return getDocBalance(doc) > 0.0001;
  };

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of safeArray(db.accountGroups).filter((x) => x.companyId === companyId)) {
      m.set(String(g.id), g);
    }
    return m;
  }, [db.accountGroups, companyId]);

  const isUnderNamedRoot = (groupId, rootName) => {
    const rootLowerName = String(rootName || '').trim().toLowerCase();
    if (!rootLowerName) return false;
    if (groupId === null || groupId === undefined || String(groupId) === '') return false;

    let cur = groupById.get(String(groupId || '')) || null;
    const seen = new Set();
    while (cur && !seen.has(String(cur.id))) {
      seen.add(String(cur.id));
      const nm = String(cur.name || '').trim().toLowerCase();
      if (nm === rootLowerName) return true;
      const pid = cur.parentGroupId;
      if (pid === null || pid === undefined || pid === '') return false;
      cur = groupById.get(String(pid)) || null;
    }
    return false;
  };

  const cashBankAccounts = useMemo(() => {
    return safeArray(db.chartOfAccounts)
      .filter((a) => a.companyId === companyId)
      .filter((a) => {
        const gid = a?.groupId;
        return ['bank', 'banks', 'bank account', 'bank accounts', 'cash', 'cash-in-hand', 'cash in hand', 'cash & bank', 'cash and bank', 'cash / bank', 'cash/bank']
          .some((root) => isUnderNamedRoot(gid, root));
      })
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [db.chartOfAccounts, companyId, groupById]);

  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    const first = cashBankAccounts[0];
    return first?.id ? String(first.id) : '';
  });

  useEffect(() => {
    if (!cashBankAccounts.length) return;
    const exists = cashBankAccounts.some((a) => String(a.id) === String(selectedAccountId));
    if (selectedAccountId && exists) return;
    const first = cashBankAccounts[0];
    if (first?.id) setSelectedAccountId(String(first.id));
  }, [cashBankAccounts, selectedAccountId]);

  const selectedAccount = useMemo(() => {
    return cashBankAccounts.find((a) => String(a.id) === String(selectedAccountId)) || null;
  }, [cashBankAccounts, selectedAccountId]);

  const allTxns = useMemo(() => {
    const imported = safeArray(db.bankTransactions)
      .filter((t) => t.companyId === companyId)
      .filter((t) => (selectedAccountId ? String(t.cashBankAccountId) === String(selectedAccountId) : true));

    // Receipts/payments entered through Payment/Receipt entry land in this
    // account's book too — the ledger they posted to is matched via the chart
    // row's serverLedgerAccountId (set when the ledger synced to the server).
    const acct = cashBankAccounts.find((a) => String(a.id) === String(selectedAccountId));
    const serverLedgerId = String(acct?.serverLedgerAccountId || '').trim();
    const recorded = !serverLedgerId
      ? []
      : safeArray(db.payments)
          .filter((p) => p.companyId === companyId)
          .filter((p) => String(p.ledgerAccountId || '') === serverLedgerId)
          .map((p) => ({
            id: `pay-${p.id}`,
            companyId,
            cashBankAccountId: selectedAccountId,
            date: p.date,
            description:
              `${p.voucherType === 'receipt' ? 'Receipt' : 'Payment'}${p.number ? ` ${p.number}` : ''} — ${p.customerName || p.vendorName || p.partyName || ''}`.trim(),
            amount: Number(p.amount ?? 0),
            direction: p.voucherType === 'receipt' ? 'IN' : 'OUT',
            ledgerId: null,
            readOnly: true,
            status: 'Recorded',
          }));

    return [...imported, ...recorded]
      .slice()
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return String(b.id).localeCompare(String(a.id));
      });
  }, [db.bankTransactions, db.payments, companyId, selectedAccountId, cashBankAccounts]);

  const [view, setView] = useState('uncategorised'); // 'uncategorised' | 'categorised' | 'all'

  /*
   * A statement line is allocated once something answers it.
   *
   * That used to mean one ledger, because a bank line could only ever be one
   * posting. A payment now splits across several accounts — tax, late fee,
   * interest — and there is no single ledger to write back, so the voucher it
   * produced is what marks it done.
   */
  const isCategorised = (t) => Boolean(t?.ledgerId || t?.linkedPaymentId);

  const ledgerById = useMemo(() => {
    const m = new Map();
    for (const a of safeArray(db.chartOfAccounts).filter((x) => x.companyId === companyId)) {
      m.set(String(a.id), a);
    }
    return m;
  }, [db.chartOfAccounts, companyId]);

  const txnSearch = useListSearch(allTxns, ['description', 'narration', 'date', 'status']);
  const txnFilters = useColumnFilters();
  const statusOf = (t) => {
    if (t?.readOnly) return 'Recorded';
    /* A split line's status comes from its children — derived, never typed. */
    const split = allocationsForTxn(db, companyId, t?.id);
    if (split.length) return allocationSummary(t, split).status;
    return isCategorised(t) ? 'Categorised' : 'Uncategorised';
  };
  const txns = useMemo(() => {
    const base = txnSearch.filtered;
    const byView =
      view === 'all' ? base : view === 'categorised' ? base.filter((t) => isCategorised(t)) : base.filter((t) => !isCategorised(t));
    return txnFilters.apply(byView, {
      date: (t) => t.date || '',
      description: (t) => t.description || '',
      ledger: (t) => (t.ledgerId ? ledgerById.get(String(t.ledgerId))?.name || '' : ''),
      narration: (t) => t.narration || '',
      payment: (t) => (t.direction === 'OUT' ? Number(t.amount || 0) : ''),
      receipt: (t) => (t.direction === 'OUT' ? '' : Number(t.amount || 0)),
      status: statusOf,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnSearch.filtered, view, txnFilters.filters, txnFilters.sort, ledgerById]);

  // Money in and money out for whatever the filters currently show, so the
  // question "what moved through this account this period" is answered here
  // rather than in a spreadsheet.
  const txnTotals = useMemo(() => {
    let inAmt = 0;
    let outAmt = 0;
    for (const t of txns) {
      const amt = Number(t.amount || 0);
      if (t.direction === 'OUT') outAmt += amt;
      else inAmt += amt;
    }
    return [
      { label: 'In', value: formatMoney(inAmt, currentCompany), tone: inAmt > 0 ? 'pos' : undefined },
      { label: 'Out', value: formatMoney(outAmt, currentCompany), tone: outAmt > 0 ? 'neg' : undefined },
      { label: 'Net', value: formatMoney(inAmt - outAmt, currentCompany) },
    ];
  }, [txns, currentCompany]);


  const uncategorisedCount = useMemo(() => allTxns.filter((t) => !isCategorised(t)).length, [allTxns]);

  // Money through the selected account, for the overview tiles.
  const flow = useMemo(() => {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const t of allTxns) {
      const amt = Number(t.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      if (t.direction === 'OUT') moneyOut += amt;
      else moneyIn += amt;
    }
    return { moneyIn, moneyOut, net: moneyIn - moneyOut };
  }, [allTxns]);
  const categorisedCount = useMemo(() => allTxns.filter((t) => isCategorised(t)).length, [allTxns]);

  const ledgerOptions = useMemo(() => {
    return safeArray(db.chartOfAccounts)
      .filter((a) => a.companyId === companyId)
      .slice()
      .sort((a, b) => {
        const ac = String(a.code || '').trim();
        const bc = String(b.code || '').trim();
        if (ac && bc && ac !== bc) return ac.localeCompare(bc);
        return String(a.name || '').localeCompare(String(b.name || ''));
      })
      .map((a) => ({
        value: String(a.id),
        label: String(a.name || '').trim(),
        code: String(a.code || '').trim(),
        meta: [a.ledgerCategory, a.type, a.subType].filter(Boolean).join(' • '),
      }));
  }, [db.chartOfAccounts, companyId]);

  const customers = useMemo(() => {
    return safeArray(db.customers).filter((c) => c.companyId === companyId && c.isActive !== false);
  }, [db.customers, companyId]);

  const vendors = useMemo(() => {
    return safeArray(db.vendors).filter((v) => v.companyId === companyId);
  }, [db.vendors, companyId]);

  const customerByLedgerId = useMemo(() => {
    const m = new Map();
    for (const c of customers) {
      if (c?.accountId !== undefined && c?.accountId !== null && String(c.accountId) !== '') {
        m.set(String(c.accountId), c);
      }
    }
    return m;
  }, [customers]);

  const vendorByLedgerId = useMemo(() => {
    const m = new Map();
    for (const v of vendors) {
      if (v?.accountId !== undefined && v?.accountId !== null && String(v.accountId) !== '') {
        m.set(String(v.accountId), v);
      }
    }
    return m;
  }, [vendors]);

  const resolvePartyByLedgerId = (ledgerId) => {
    const idStr = String(ledgerId || '').trim();
    if (!idStr) return null;
    const cust = customerByLedgerId.get(idStr) || null;
    if (cust) return { kind: 'customer', partyId: Number(cust.id) };
    const vend = vendorByLedgerId.get(idStr) || null;
    if (vend) return { kind: 'vendor', partyId: Number(vend.id) };
    return null;
  };

  const linkBankTxnToPayment = ({ bankTxnId, ledgerId, paymentId }) => {
    if (!bankTxnId) return;
    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      const next = list.map((t) => {
        if (t.companyId !== companyId) return t;
        if (String(t.id) !== String(bankTxnId)) return t;
        return {
          ...t,
          ledgerId: ledgerId !== undefined && ledgerId !== null && String(ledgerId) !== '' ? Number(ledgerId) : t.ledgerId,
          linkedPaymentId: paymentId !== undefined && paymentId !== null && String(paymentId) !== '' ? Number(paymentId) : t.linkedPaymentId,
          updatedAt: new Date().toISOString(),
        };
      });
      return { ...prev, bankTransactions: next };
    });
  };

  const openKnockoff = ({ bankTxn, ledgerId }) => {
    if (!bankTxn) return;
    const party = resolvePartyByLedgerId(ledgerId);
    const dir = String(bankTxn.direction || '').toUpperCase();

    if (party?.kind === 'customer' && dir === 'IN') {
      openModal(
        <RecordReceiptForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          hideMode={true}
          initialData={{
            date: bankTxn.date,
            amount: String(bankTxn.amount ?? ''),
            customerId: String(party.partyId),
            mode: 'Bank',
            reference: '',
            notes: String(bankTxn.narration || bankTxn.description || '').trim(),
            cashBankAccountId: bankTxn.cashBankAccountId,
            sourceBankTransactionId: bankTxn.id,
          }}
          onSaved={(receipt) => linkBankTxnToPayment({ bankTxnId: bankTxn.id, ledgerId, paymentId: receipt?.id })}
          onClose={() => openModal(null)}
        />,
        { title: 'Knock-off Invoices / Record Receipt', maxWidthClass: 'max-w-4xl' }
      );
      return;
    }

    if (party?.kind === 'vendor' && dir === 'OUT') {
      openModal(
        <RecordDisbursementForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          hideMode={true}
          initialData={{
            date: bankTxn.date,
            amount: String(bankTxn.amount ?? ''),
            vendorId: String(party.partyId),
            mode: 'Bank',
            reference: '',
            notes: String(bankTxn.narration || bankTxn.description || '').trim(),
            cashBankAccountId: bankTxn.cashBankAccountId,
            sourceBankTransactionId: bankTxn.id,
          }}
          onSaved={(payment) => linkBankTxnToPayment({ bankTxnId: bankTxn.id, ledgerId, paymentId: payment?.id })}
          onClose={() => openModal(null)}
        />,
        { title: 'Knock-off Bills / Record Payment', maxWidthClass: 'max-w-5xl' }
      );
      return;
    }

    // Fallback: not a party ledger or direction mismatch.
    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      const next = list.map((t) => {
        if (t.companyId !== companyId) return t;
        if (String(t.id) !== String(bankTxn.id)) return t;
        return { ...t, ledgerId: Number(ledgerId), updatedAt: new Date().toISOString() };
      });
      return { ...prev, bankTransactions: next };
    });
  };

  const uploadInputRef = useRef(null);
  /* The paste door: rows copied straight off net-banking. */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  /* Rows waiting on a human verdict: null, or { rows, unknownAccounts, ... }. */
  const [importReview, setImportReview] = useState(null);
  /* The bank line being split across the book, or null. */
  const [allocatingTxn, setAllocatingTxn] = useState(null);

  const [pendingAddTxnInitial, setPendingAddTxnInitial] = useState(null);

  const openAddTxn = (initial = null) => {
    if (!cashBankAccounts.length) {
      notify.error('Please create a cash/bank account first.');
      return;
    }

    const effectiveAccount =
      cashBankAccounts.find((a) => String(a.id) === String(initial?.cashBankAccountId || '')) ||
      selectedAccount ||
      cashBankAccounts[0] ||
      null;

    if (!effectiveAccount) {
      notify.error('Please select a cash/bank account first.');
      return;
    }

    const TxnForm = ({ onClose }) => {
      const isEdit = initial?.editTxnId !== null && initial?.editTxnId !== undefined && String(initial?.editTxnId) !== '';
      const isCategoriseExisting = initial?.bankTxnId !== null && initial?.bankTxnId !== undefined && String(initial?.bankTxnId) !== '';
      const [form, setForm] = useState(() => ({
        cashBankAccountId: String(initial?.cashBankAccountId || effectiveAccount?.id || '').trim(),
        date: String(initial?.date || new Date().toISOString().slice(0, 10)),
        direction: initial?.direction === 'OUT' ? 'OUT' : 'IN',
        ledgerId: String(initial?.ledgerId || '').trim(),
        amount: String(initial?.amount || ''),
        narration: String(initial?.narration || '').trim(),
      }));

      const [knockoffAllocations, setKnockoffAllocations] = useState(() => ({}));

      const selectedLedger = useMemo(() => {
        if (!form.ledgerId) return null;
        return ledgerOptions.find((o) => String(o.value) === String(form.ledgerId)) || null;
      }, [form.ledgerId, ledgerOptions]);

      const knockoffParty = useMemo(() => resolvePartyByLedgerId(form.ledgerId), [form.ledgerId]);

      const knockoffMode = useMemo(() => {
        const dir = String(form.direction || '').toUpperCase();
        if (knockoffParty?.kind === 'customer' && dir === 'IN') return 'customer';
        if (knockoffParty?.kind === 'vendor' && dir === 'OUT') return 'vendor';
        return null;
      }, [form.direction, knockoffParty]);

      const outstandingInvoices = useMemo(() => {
        if (knockoffMode !== 'customer') return [];
        const cid = Number(knockoffParty?.partyId);
        if (!Number.isFinite(cid) || !cid) return [];
        return safeArray(db.invoices)
          .filter((i) => i.companyId === companyId)
          .filter((i) => Number(i.customerId) === cid)
          .filter((i) => canCollectAgainstInvoice(i))
          .slice()
          .sort((a, b) => {
            const da = String(a.date || '');
            const dbb = String(b.date || '');
            if (da !== dbb) return da < dbb ? 1 : -1;
            return Number(b.id) - Number(a.id);
          });
      }, [db.invoices, companyId, knockoffMode, knockoffParty]);

      const outstandingDocs = useMemo(() => {
        if (knockoffMode !== 'vendor') return [];
        const vid = Number(knockoffParty?.partyId);
        if (!Number.isFinite(vid) || !vid) return [];

        const billRows = safeArray(db.bills)
          .filter((b) => b.companyId === companyId)
          .filter((b) => Number(b.vendorId) === vid)
          .filter((b) => canPayDoc(b))
          .map((b) => ({
            key: `bill:${b.id}`,
            voucherType: 'bill',
            id: Number(b.id),
            number: b.number,
            date: b.date,
            balance: getDocBalance(b),
          }));

        const expenseRows = safeArray(db.expenses)
          .filter((e) => e.companyId === companyId)
          .filter((e) => Number(e.vendorId) === vid)
          .filter((e) => canPayDoc(e))
          .map((e) => ({
            key: `expense:${e.id}`,
            voucherType: 'expense',
            id: Number(e.id),
            number: e.number,
            date: e.date,
            balance: getDocBalance(e),
          }));

        return [...billRows, ...expenseRows].sort((a, b) => {
          const da = String(a.date || '');
          const dbb = String(b.date || '');
          if (da !== dbb) return da < dbb ? 1 : -1;
          return Number(b.id) - Number(a.id);
        });
      }, [db.bills, db.expenses, companyId, knockoffMode, knockoffParty]);

      const knockoffComputed = useMemo(() => {
        const raw = Number(form.amount ?? 0);
        const totalAmount = Number.isFinite(raw) ? Math.max(0, raw) : 0;

        let allocated = 0;
        const lines = [];

        if (knockoffMode === 'customer') {
          for (const inv of outstandingInvoices) {
            const key = String(inv.id);
            const row = knockoffAllocations[key];
            if (!row?.selected) continue;
            const want = Number(row?.amount ?? 0);
            const amt = Number.isFinite(want) ? Math.max(0, want) : 0;
            if (amt <= 0) continue;
            const balance = getInvoiceBalance(inv);
            const capped = Math.min(balance, amt);
            if (capped <= 0) continue;
            allocated = round2(allocated + capped);
            lines.push({
              voucherType: 'invoice',
              voucherId: Number(inv.id),
              documentNumber: inv.number,
              amount: round2(capped),
            });
          }
        }

        if (knockoffMode === 'vendor') {
          for (const d of outstandingDocs) {
            const row = knockoffAllocations[d.key];
            if (!row?.selected) continue;
            const want = Number(row?.amount ?? 0);
            const amt = Number.isFinite(want) ? Math.max(0, want) : 0;
            if (amt <= 0) continue;
            const capped = Math.min(d.balance, amt);
            if (capped <= 0) continue;
            allocated = round2(allocated + capped);
            lines.push({
              voucherType: d.voucherType,
              voucherId: Number(d.id),
              documentNumber: d.number,
              amount: round2(capped),
            });
          }
        }

        const advance = round2(Math.max(0, totalAmount - allocated));
        return {
          totalAmount: round2(totalAmount),
          allocated: round2(allocated),
          advance,
          lines,
        };
      }, [form.amount, knockoffAllocations, knockoffMode, outstandingDocs, outstandingInvoices]);

      const toggleKnockoffRow = (key, selected, suggestedAmount) => {
        setKnockoffAllocations((prev) => {
          const next = { ...prev };
          const existing = next[key] || { selected: false, amount: 0 };
          const nextSelected = Boolean(selected);
          let nextAmount = existing.amount;
          if (nextSelected && (!Number(nextAmount) || Number(nextAmount) <= 0)) {
            nextAmount = round2(Number(suggestedAmount ?? 0) || 0);
          }
          next[key] = { ...existing, selected: nextSelected, amount: nextAmount };
          return next;
        });
      };

      const setKnockoffAmount = (key, amount) => {
        setKnockoffAllocations((prev) => {
          const next = { ...prev };
          const existing = next[key] || { selected: true, amount: 0 };
          next[key] = { ...existing, selected: true, amount };
          return next;
        });
      };

      const selectedCashBankAccount = useMemo(() => {
        if (!form.cashBankAccountId) return null;
        return cashBankAccounts.find((a) => String(a.id) === String(form.cashBankAccountId)) || null;
      }, [form.cashBankAccountId, cashBankAccounts]);

      const canCreateLedger = typeof openTxnLedgerCreate === 'function';
      const canCreateCashBank = typeof openLedgerCreate === 'function';

      const openLedgerPicker = () => {
        const snapshot = {
          cashBankAccountId: form.cashBankAccountId,
          date: form.date,
          direction: form.direction,
          ledgerId: form.ledgerId,
          amount: form.amount,
          narration: form.narration,
        };

        const LedgerPicker = () => {
          const [query, setQuery] = useState(() => {
            const seed = String(initial?.ledgerSearch || '').trim();
            if (seed) return seed;
            if (selectedLedger?.label) return String(selectedLedger.label);
            return '';
          });

          const normalized = String(query || '').trim().toLowerCase();
          const filtered = useMemo(() => {
            if (!normalized) return ledgerOptions;
            return ledgerOptions.filter((o) => {
              const hay = `${o.code || ''} ${o.label || ''} ${o.meta || ''}`.toLowerCase();
              return hay.includes(normalized);
            });
          }, [normalized, ledgerOptions]);

          const showCreate = canCreateLedger && Boolean(String(query || '').trim()) && filtered.length === 0;
          const canAttemptCreate = canCreateLedger && Boolean(String(query || '').trim());

          return (
            <div className="space-y-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="ui-input w-full"
                placeholder="Search ledger"
                autoFocus
              />

              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[55vh] overflow-y-auto divide-y">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-10 text-center ui-muted">No results</div>
                  ) : (
                    filtered.map((o) => {
                      const isSelected = String(o.value) === String(snapshot.ledgerId);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => {
                            openModal(null);
                            setPendingAddTxnInitial({
                              ...snapshot,
                              ledgerId: String(o.value),
                              ledgerSearch: String(o.label || '').trim(),
                            });
                          }}
                          className={`w-full px-4 py-3 text-left ui-hover-sunken ${isSelected ? 'ui-sunken' : ''}`}
                        >
                          <div className="ui-fg">{o.label}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {canCreateLedger ? (
                <button
                  type="button"
                  disabled={!showCreate}
                  onClick={() => {
                    const typed = String(query || '').trim();
                    if (!typed) return;
                    if (!showCreate) return;
                    openTxnLedgerCreate(typed, (created) => {
                      const nextId = created?.id !== null && created?.id !== undefined ? String(created.id) : '';
                      const nextName = String(created?.name || '').trim();
                      setPendingAddTxnInitial({
                        ...snapshot,
                        ledgerId: nextId,
                        ledgerSearch: nextName || typed,
                      });
                    });
                  }}
                  className={`w-full px-4 py-2 rounded-lg ${ showCreate ? 'ui-btn ui-btn-primary ' : 'ui-sunken ui-muted cursor-not-allowed'
                  }`}
      title={
                    !canAttemptCreate
                      ? 'Type a ledger name to create'
                      : showCreate
                        ? ''
                        : 'Ledger already exists. Choose from the list.'
                  }
                >
                  Create new ledger
                </button>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setPendingAddTxnInitial(snapshot);
                    openModal(null);
                  }}
                  className="px-4 py-2 border rounded-lg ui-hover-sunken"
                >
                  Back
                </button>
              </div>
            </div>
          );
        };

        openModal(<LedgerPicker />, { title: 'Select Ledger', maxWidthClass: 'max-w-2xl' });
      };

      const save = async (e) => {
        e.preventDefault();

        const cashBankAccountId = String(form.cashBankAccountId || '').trim();
        if (!cashBankAccountId) {
          notify.error('Cash/Bank account is required');
          return;
        }

        const ledgerId = String(form.ledgerId || '').trim();
        if (!ledgerId) {
          notify.error('Ledger is required');
          return;
        }

        const amt = parseAmount(form.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          notify.error('Amount must be greater than 0');
          return;
        }

        const direction = form.direction === 'OUT' ? 'OUT' : 'IN';

        if (isEdit) {
          const editing = safeArray(db.bankTransactions).find(
            (t) => t.companyId === companyId && Number(t.id) === Number(initial?.editTxnId)
          );
          if (editing) {
            await patchBankEntry({
              chartRows: safeArray(db.chartOfAccounts).filter((c) => c.companyId === companyId),
              row: editing,
              patch: {
                cashBankAccountId: Number(cashBankAccountId),
                ledgerId: Number(ledgerId),
                direction,
                date: form.date,
                amount: round2(amt),
                narration: String(form.narration || '').trim(),
              },
            });
          }
          setDb((prev) => {
            const list = safeArray(prev.bankTransactions);
            const editId = Number(initial?.editTxnId);
            const next = list.map((t) => {
              if (t.companyId !== companyId) return t;
              if (Number(t.id) !== editId) return t;
              /*
               * An imported row is the bank's word, not ours. Its date,
               * amount, direction, narration and reference stay exactly as
               * they arrived; what an edit may change is the ALLOCATION —
               * which ledger it belongs to. A row typed by hand stays fully
               * editable, because there the operator is the source.
               */
              if (t.imported) {
                return {
                  ...t,
                  ledgerId: Number(ledgerId),
                  updatedAt: new Date().toISOString(),
                };
              }
              return {
                ...t,
                cashBankAccountId: Number(cashBankAccountId),
                date: form.date,
                direction,
                ledgerId: Number(ledgerId),
                amount: round2(amt),
                narration: String(form.narration || '').trim(),
                description: String(form.narration || '').trim(),
                updatedAt: new Date().toISOString(),
              };
            });
            return { ...prev, bankTransactions: next };
          });

          if (String(form.cashBankAccountId || '').trim() && String(form.cashBankAccountId) !== String(selectedAccountId)) {
            setSelectedAccountId(String(form.cashBankAccountId));
          }
          onClose?.();
          return;
        }

        const party = resolvePartyByLedgerId(ledgerId);
        const shouldKnockoff =
          (party?.kind === 'customer' && direction === 'IN') || (party?.kind === 'vendor' && direction === 'OUT');

        const nowIso = new Date().toISOString();
        const txnId = isCategoriseExisting ? Number(initial?.bankTxnId) : nextNumericId(db.bankTransactions);

        let linkedPaymentId = null;

        /*
         * The knock-off goes through the payment service — the same engine
         * the disbursement and receipt forms drive. This form used to build
         * its own voucher records and move paidAmount by hand, which was a
         * second settlement path with hand-minted numbers and no server
         * posting; that path is gone. One engine, whoever calls it.
         */
        let builtRecord = null;
        if (shouldKnockoff) {
          const amountNum = round2(amt);
          const bankRow = safeArray(db.chartOfAccounts).find(
            (a) => a.companyId === companyId && String(a.id) === String(cashBankAccountId)
          );
          const serverBankLedgerId = String(bankRow?.serverLedgerAccountId || '').trim();
          const nextLocalId = nextNumericId(db.payments);
          const knockLines = knockoffComputed.lines.map((l) => ({
            voucherType: l.voucherType,
            voucherId: l.voucherId,
            amount: l.amount,
          }));
          try {
            builtRecord =
              party?.kind === 'customer'
                ? await buildCustomerReceipt({
                    db,
                    currentCompany,
                    customerId: party.partyId,
                    date: form.date,
                    amount: amountNum,
                    lines: knockLines.filter((l) => l.voucherType === 'invoice'),
                    ledgerAccountId: serverBankLedgerId,
                    cashBankAccountId: Number(cashBankAccountId),
                    sourceBankTransactionId: txnId,
                    notes: String(form.narration || '').trim(),
                    nextLocalId,
                  })
                : await buildVendorPayment({
                    db,
                    currentCompany,
                    vendorId: party.partyId,
                    date: form.date,
                    amount: amountNum,
                    lines: knockLines.filter((l) => l.voucherType === 'bill' || l.voucherType === 'expense'),
                    ledgerAccountId: serverBankLedgerId,
                    cashBankAccountId: Number(cashBankAccountId),
                    sourceBankTransactionId: txnId,
                    notes: String(form.narration || '').trim(),
                    nextLocalId,
                  });
          } catch (e) {
            notify.error(String(e?.message || e));
            return;
          }
          linkedPaymentId = builtRecord.id;
        }

        const bankTxnRecord = {
          id: txnId,
          companyId,
          cashBankAccountId: Number(cashBankAccountId),
          date: form.date,
          direction,
          ledgerId: Number(ledgerId),
          amount: round2(amt),
          narration: String(form.narration || '').trim(),
          description: String(form.narration || '').trim(),
          reference: '',
          linkedPaymentId: linkedPaymentId !== null ? Number(linkedPaymentId) : null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        /*
         * Written through to the server. This was the last collection that
         * lived only in a browser: clearing site data lost the cash book, and
         * the reconciliation screen had nothing to mark against a statement
         * line it had matched.
         */
        const bankServerPatch = await saveBankEntry({
          chartRows: safeArray(db.chartOfAccounts).filter((c) => c.companyId === companyId),
          entry: bankTxnRecord,
        });
        Object.assign(bankTxnRecord, bankServerPatch);

        setDb((prev) => {
          const next = builtRecord ? { ...applyVendorPayments(prev, companyId, [builtRecord]) } : { ...prev };

          const list = safeArray(prev.bankTransactions);
          if (isCategoriseExisting) {
            next.bankTransactions = list.map((t) => {
              if (t.companyId !== companyId) return t;
              if (String(t.id) !== String(txnId)) return t;
              return {
                ...t,
                cashBankAccountId: bankTxnRecord.cashBankAccountId,
                date: bankTxnRecord.date,
                direction: bankTxnRecord.direction,
                ledgerId: bankTxnRecord.ledgerId,
                amount: bankTxnRecord.amount,
                narration: bankTxnRecord.narration,
                description: bankTxnRecord.description,
                linkedPaymentId: bankTxnRecord.linkedPaymentId,
                updatedAt: nowIso,
              };
            });
            return next;
          }

          next.bankTransactions = [...list, bankTxnRecord];
          return next;
        });

        if (String(form.cashBankAccountId || '').trim() && String(form.cashBankAccountId) !== String(selectedAccountId)) {
          setSelectedAccountId(String(form.cashBankAccountId));
        }

        onClose?.();
      };

      return (
        <form onSubmit={save} className="space-y-4">
          <div className="text-sm ui-muted">
            Add a bank/cash transaction for{' '}
            <span className="font-medium">{selectedCashBankAccount?.name || effectiveAccount?.name}</span>.
          </div>

          {!isCategoriseExisting ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="ui-label">Cash / Bank Account</label>
                {canCreateCashBank ? (
                  <button
                    type="button"
                    onClick={() => {
                      const snapshot = {
                        ...form,
                        ledgerSearch: String(initial?.ledgerSearch || '').trim(),
                      };
                      openLedgerCreate('', (created) => {
                        const nextId = created?.id !== null && created?.id !== undefined ? String(created.id) : '';
                        // Re-open after DB updates so the dropdown includes the new account.
                        setPendingAddTxnInitial({
                          ...snapshot,
                          cashBankAccountId: nextId || snapshot.cashBankAccountId,
                        });
                        if (nextId) setSelectedAccountId(nextId);
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg border ui-surface ui-hover-sunken ui-border-c text-sm"
                  >
                    New
                  </button>
                ) : null}
              </div>
              <select
                value={form.cashBankAccountId}
                onChange={(e) => setForm((p) => ({ ...p, cashBankAccountId: e.target.value }))}
                className="ui-select w-full"
                required
              >
                <option value="">Select</option>
                {cashBankAccounts.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {String(a.name || '').trim()}
                  </option>
                ))}
              </select>
              <div className="text-xs ui-muted mt-1">This is where the entry will hit.</div>
            </div>
          ) : (
            <div className="text-sm ui-muted">
              <span className="font-medium">Cash / Bank Account:</span>{' '}
              <span className="font-medium">{selectedCashBankAccount?.name || effectiveAccount?.name || '-'}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-label" htmlFor="cashbankmodule-date">Date</label>
              <input id="cashbankmodule-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                className="ui-input w-full"
                required
              />
            </div>
            {!isCategoriseExisting ? (
              <div>
                <label className="ui-label" htmlFor="cashbankmodule-type">Type</label>
                <select id="cashbankmodule-type"
                  value={form.direction}
                  onChange={(e) => setForm((p) => ({ ...p, direction: e.target.value }))}
                  className="ui-select w-full"
                >
                  <option value="IN">Receipt (Money In)</option>
                  <option value="OUT">Payment (Money Out)</option>
                </select>
              </div>
            ) : (
              <div className="text-sm ui-muted flex items-end">
                <div>
                  <div className="text-sm font-medium mb-1">Type</div>
                  <div className="px-3 py-2 border rounded-lg ui-sunken">
                    {form.direction === 'OUT' ? 'Payment (Money Out)' : 'Receipt (Money In)'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="ui-label">Ledger</label>
            </div>

            <button
              type="button"
              onClick={openLedgerPicker}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-lg text-left ui-surface ui-hover-sunken"
            >
              <span className={selectedLedger ? 'ui-fg' : 'ui-subtle'}>
                {selectedLedger ? `${selectedLedger.label}` : 'Select Ledger'}
              </span>
              <span className="text-xs ui-muted">Change</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-label" htmlFor="cashbankmodule-amount">Amount</label>
              <input id="cashbankmodule-amount"
                type="number"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="ui-input w-full"
                step="0.01"
                required
              />
            </div>
            <div />
          </div>

          {knockoffMode === 'customer' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Knock-off Invoices</div>
              <div className="grid grid-cols-3 gap-3 text-sm ui-sunken border rounded-lg p-3">
                <div>
                  <div className="ui-muted">Allocated</div>
                  <div className="ui-money">{formatMoney(knockoffComputed.allocated, currentCompany)}</div>
                </div>
                <div>
                  <div className="ui-muted">Advance</div>
                  <div className="ui-money">{formatMoney(knockoffComputed.advance, currentCompany)}</div>
                </div>
                <div>
                  <div className="ui-muted">Selected</div>
                  <div className="font-medium">
                    {Object.values(knockoffAllocations).filter((v) => Boolean(v?.selected)).length}
                  </div>
                </div>
              </div>

              <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th w-12">Sel</th>
                      <th className="ui-th">Invoice #</th>
                      <th className="ui-th ui-col-h-center">Date</th>
                      <th className="ui-th ui-num">Outstanding</th>
                      <th className="ui-th ui-num">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {outstandingInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center ui-muted">
                          No outstanding invoices. This receipt will be recorded as advance.
                        </td>
                      </tr>
                    ) : (
                      outstandingInvoices.map((inv) => {
                        const key = String(inv.id);
                        const row = knockoffAllocations[key] || { selected: false, amount: 0 };
                        const balance = getInvoiceBalance(inv);

                        const totalAmount = Math.max(0, Number(form.amount ?? 0) || 0);
                        const alreadyAllocated = Object.entries(knockoffAllocations)
                          .filter(([k, v]) => k !== key && v?.selected)
                          .reduce((sum, [, v]) => sum + (Number(v?.amount ?? 0) || 0), 0);
                        const remaining = Math.max(0, totalAmount - alreadyAllocated);
                        const suggested = Math.min(balance, remaining || balance);

                        return (
                          <tr key={key} className="ui-hover-sunken">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={Boolean(row.selected)}
                                onChange={(e) => toggleKnockoffRow(key, e.target.checked, suggested)}
                              />
                            </td>
                            <td className="ui-col-meta px-4 py-3">{inv.number || `INV-${inv.id}`}</td>
                            <td className="ui-col-date px-4 py-3"><DocDate value={inv.date} /></td>
                            <td className="ui-col-amount px-4 py-3 text-right"><MoneyValue value={balance} company={currentCompany} /></td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                className="ui-input w-28 px-2 py-1 text-right"
                                value={row.amount}
                                min="0"
                                step="0.01"
                                onChange={(e) => setKnockoffAmount(key, e.target.value)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {knockoffMode === 'vendor' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Knock-off Bills / Expenses</div>
              <div className="grid grid-cols-3 gap-3 text-sm ui-sunken border rounded-lg p-3">
                <div>
                  <div className="ui-muted">Allocated</div>
                  <div className="ui-money">{formatMoney(knockoffComputed.allocated, currentCompany)}</div>
                </div>
                <div>
                  <div className="ui-muted">Advance</div>
                  <div className="ui-money">{formatMoney(knockoffComputed.advance, currentCompany)}</div>
                </div>
                <div>
                  <div className="ui-muted">Selected</div>
                  <div className="font-medium">
                    {Object.values(knockoffAllocations).filter((v) => Boolean(v?.selected)).length}
                  </div>
                </div>
              </div>

              <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
                <table className="ui-table w-full">
                  <thead className="ui-sunken border-b">
                    <tr>
                      <th className="ui-th w-12">Sel</th>
                      <th className="ui-th">Doc #</th>
                      <th className="ui-th ui-col-h-center">Date</th>
                      <th className="ui-th ui-num">Outstanding</th>
                      <th className="ui-th ui-num">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {outstandingDocs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center ui-muted">
                          No outstanding bills/expenses. This payment will be recorded as advance.
                        </td>
                      </tr>
                    ) : (
                      outstandingDocs.map((d) => {
                        const key = d.key;
                        const row = knockoffAllocations[key] || { selected: false, amount: 0 };

                        const totalAmount = Math.max(0, Number(form.amount ?? 0) || 0);
                        const alreadyAllocated = Object.entries(knockoffAllocations)
                          .filter(([k, v]) => k !== key && v?.selected)
                          .reduce((sum, [, v]) => sum + (Number(v?.amount ?? 0) || 0), 0);
                        const remaining = Math.max(0, totalAmount - alreadyAllocated);
                        const suggested = Math.min(d.balance, remaining || d.balance);

                        return (
                          <tr key={key} className="ui-hover-sunken">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={Boolean(row.selected)}
                                onChange={(e) => toggleKnockoffRow(key, e.target.checked, suggested)}
                              />
                            </td>
                            <td className="ui-col-meta px-4 py-3">{d.number || `${d.voucherType}-${d.id}`}</td>
                            <td className="ui-col-date px-4 py-3"><DocDate value={d.date} /></td>
                            <td className="ui-col-amount px-4 py-3 text-right"><MoneyValue value={d.balance} company={currentCompany} /></td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                className="ui-input w-28 px-2 py-1 text-right"
                                value={row.amount}
                                min="0"
                                step="0.01"
                                onChange={(e) => setKnockoffAmount(key, e.target.value)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div>
            <label className="ui-label" htmlFor="cashbankmodule-narration">Narration</label>
            <input id="cashbankmodule-narration"
              type="text"
              value={form.narration}
              onChange={(e) => setForm((p) => ({ ...p, narration: e.target.value }))}
              className="ui-input w-full"
              placeholder="Narration"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onClose?.()} className="px-4 py-2 border rounded-lg ui-hover-sunken">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg ui-btn ui-btn-primary">
              {isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      );
    };

    const isEdit = initial?.editTxnId !== null && initial?.editTxnId !== undefined && String(initial?.editTxnId) !== '';
    const isCategoriseExisting = initial?.bankTxnId !== null && initial?.bankTxnId !== undefined && String(initial?.bankTxnId) !== '';
    openModal(
      <TxnForm onClose={() => openModal(null)} />,
      {
        title: isEdit ? 'Edit Transaction' : isCategoriseExisting ? 'Categorise Transaction' : 'Add Transaction',
        maxWidthClass: 'max-w-5xl',
      }
    );
  };

  useEffect(() => {
    if (!pendingAddTxnInitial) return;
    // Run after any state/db updates so lists are fresh.
    openAddTxn(pendingAddTxnInitial);
    setPendingAddTxnInitial(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAddTxnInitial, db.chartOfAccounts, db.accountGroups]);

  const onUploadStatement = async (file) => {
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      notify.error('Unable to read the statement file.');
      return;
    }
    await importStatementText(text, String(file?.name || '').trim());
  };

  /*
   * One pipeline for both doors.
   *
   * A statement arrives as a file or as rows copied straight off net-banking;
   * the columns, the dedupe and the batch stamp are identical, so the paste
   * dialog and the upload button feed the same function rather than two
   * parsers that drift.
   */
  const importStatementText = async (text, sourceName = '') => {
    if (!cashBankAccounts.length) {
      notify.error('No cash/bank accounts found. Please create one first.');
      return;
    }

    try {
    const { headers, rows } = parseCsv(text);
    if (!headers.length || !rows.length) {
      notify.error('No rows found in the uploaded file.');
      return;
    }

    const headerMap = new Map(headers.map((h, idx) => [normalizeHeader(h), idx]));
    const pickIdx = (names) => {
      for (const n of names) {
        const idx = headerMap.get(n);
        if (idx !== undefined) return idx;
      }
      return -1;
    };

      const accountIdx = pickIdx([
        'cash / bank account',
        'cash/bank account',
        'cash bank account',
        'bank/cash account',
        'bank account',
        'cash account',
        'account',
      ]);
      const ledgerIdx = pickIdx(['mapped ledger', 'allocation ledger', 'ledger name', 'ledger']);
      const dateIdx = pickIdx(['date', 'txn date', 'transaction date', 'value date']);
      const typeIdx = pickIdx(['type', 'txn type', 'transaction type', 'dr/cr']);
      const paymentIdx = pickIdx(['payment', 'payments', 'paid', 'debit', 'withdrawal', 'dr']);
      const receiptsIdx = pickIdx(['receipts', 'receipt', 'received', 'credit', 'deposit', 'cr']);
      const amountIdx = pickIdx(['amount', 'amt', 'transaction amount']);
      const narrationIdx = pickIdx(['narration', 'description', 'particulars', 'remarks', 'details']);
      /* The bank's own handle on the movement — what reconciliation matches
         by, and what a dispute is raised with. */
      const refIdx = pickIdx(['ref no / utr', 'ref no', 'utr', 'reference', 'ref', 'cheque no', 'chq no', 'utr no']);

    if (dateIdx < 0 || (amountIdx < 0 && paymentIdx < 0 && receiptsIdx < 0)) {
      notify.error(
        `CSV must contain Date and either Amount or Payment/Receipts columns.\nDetected headers: ${headers
          .map((h) => String(h || '').trim())
          .filter(Boolean)
          .join(', ')}`
      );
      return;
    }

      /*
       * Duplicate detection, at two strengths.
       *
       * STRICT — account, date, direction, amount, plus the bank's reference
       * (or the narration where there is none). A strict match is the same
       * movement: the statement was imported twice.
       *
       * LOOSE — account, date, direction and amount alone. A loose match
       * without a strict one is a POSSIBLE duplicate: two ₹10,000 payments on
       * one day are common enough that only a person can say, so the row is
       * shown with what it collided with rather than decided for them.
       */
      const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const strictKey = ({ cashBankAccountId, date, direction, amount, narration, reference }) => {
        const tail = norm(reference) || norm(narration);
        return `${companyId}|${String(cashBankAccountId)}|${String(date || '').trim()}|${String(direction || '').trim().toUpperCase()}|${round2(Math.abs(Number(amount || 0)))}|${tail}`;
      };
      const looseKey = ({ cashBankAccountId, date, direction, amount }) =>
        `${companyId}|${String(cashBankAccountId)}|${String(date || '').trim()}|${String(direction || '').trim().toUpperCase()}|${round2(Math.abs(Number(amount || 0)))}`;

      const describeRow = (t) =>
        [String(t.date || '').trim(), t.direction === 'IN' ? 'received' : 'paid', `₹${round2(Math.abs(Number(t.amount || 0)))}`, norm(t.reference) || norm(t.narration || t.description) || '—']
          .join(' · ');

      const existingStrict = new Map();
      const existingLoose = new Map();
      for (const t of safeArray(db.bankTransactions).filter((t) => t.companyId === companyId)) {
        const shaped = {
          cashBankAccountId: Number(t.cashBankAccountId),
          date: toIsoDate(t.date) || String(t.date || '').trim(),
          direction: t.direction,
          amount: t.amount,
          narration: t.narration || t.description || '',
          reference: t.reference || '',
        };
        if (!existingStrict.has(strictKey(shaped))) existingStrict.set(strictKey(shaped), t);
        if (!existingLoose.has(looseKey(shaped))) existingLoose.set(looseKey(shaped), t);
      }

      const incomingStrict = new Map();
      const incomingLoose = new Map();

      const accountNameToId = new Map(cashBankAccounts.map((a) => [String(a.name || '').trim().toLowerCase(), Number(a.id)]));
      const ledgerNameToId = new Map(
        safeArray(db.chartOfAccounts)
          .filter((a) => Number(a?.companyId) === Number(companyId))
          .map((a) => [String(a.name || '').trim().toLowerCase(), Number(a.id)])
      );
      const cashBankIds = new Set(cashBankAccounts.map((a) => String(a.id)));
      const fallbackAccountId = Number(selectedAccount?.id || cashBankAccounts[0]?.id || 0);
      const unknownAccounts = new Set();
      let firstImportedAccountId = null;

      const newTxns = [];
    for (const r of rows) {
      const date = normalizeDate(r[dateIdx]);
      const typeText = typeIdx >= 0 ? r[typeIdx] : '';
      const narration = narrationIdx >= 0 ? String(r[narrationIdx] || '').trim() : '';
      const reference = refIdx >= 0 ? String(r[refIdx] || '').trim() : '';
        const accountText = accountIdx >= 0 ? String(r[accountIdx] || '').trim() : '';
        const ledgerText = ledgerIdx >= 0 ? String(r[ledgerIdx] || '').trim() : '';

        const hasPayRecColumns = paymentIdx >= 0 || receiptsIdx >= 0;
        const paymentRaw = paymentIdx >= 0 ? parseAmount(r[paymentIdx]) : 0;
        const receiptsRaw = receiptsIdx >= 0 ? parseAmount(r[receiptsIdx]) : 0;

        let direction = 'IN';
        let amount = 0;

        if (hasPayRecColumns) {
          // Template-style import: compute net = receipts - payment
          const net = receiptsRaw - paymentRaw;
          if (net > 0.0001) direction = 'IN';
          else if (net < -0.0001) direction = 'OUT';
          amount = round2(Math.abs(net));
        }

        if (!amount || amount <= 0) {
          const rawAmt = amountIdx >= 0 ? r[amountIdx] : '';
          const amtParsed = parseAmount(rawAmt);
          direction = inferDirection(typeText, amtParsed);
          amount = round2(Math.abs(amtParsed));
        }

        if (!amount || amount <= 0) continue;

        const finalDate = date || new Date().toISOString().slice(0, 10);
        let cashBankAccountId = fallbackAccountId;
        if (accountText) {
          const resolved = accountNameToId.get(accountText.toLowerCase()) || 0;
          if (resolved) cashBankAccountId = resolved;
          else unknownAccounts.add(accountText);
        }

        if (!cashBankAccountId) {
          // No account could be inferred.
          continue;
        }

        if (firstImportedAccountId === null) firstImportedAccountId = cashBankAccountId;

        const resolvedLedgerId = ledgerText ? ledgerNameToId.get(ledgerText.toLowerCase()) || null : null;
        const mappedLedgerId = resolvedLedgerId && String(resolvedLedgerId) !== String(cashBankAccountId) ? resolvedLedgerId : null;
        const typeUpper = String(typeText || '').trim().toUpperCase();
        const transactionType =
          (mappedLedgerId && cashBankIds.has(String(mappedLedgerId))) || typeUpper.includes('CONTRA') || typeUpper.includes('TRANSFER')
            ? 'Contra'
            : direction === 'IN' ? 'Receipt' : 'Payment';

        const shaped = { cashBankAccountId, date: finalDate, direction, amount, narration, reference };
        const sk = strictKey(shaped);
        const lk = looseKey(shaped);

        /* New, Possible Duplicate, or Duplicate — with what it collided with,
           so the person reviewing sees the collision, not just the verdict. */
        let classification = 'new';
        let matchInfo = '';
        const strictHit = existingStrict.get(sk) || incomingStrict.get(sk);
        const looseHit = existingLoose.get(lk) || incomingLoose.get(lk);
        if (strictHit) {
          classification = 'duplicate';
          matchInfo = incomingStrict.has(sk)
            ? `same as row ${incomingStrict.get(sk).sourceRow} of this import`
            : `already in the book: ${describeRow(strictHit)}`;
        } else if (looseHit) {
          classification = 'possible';
          matchInfo = incomingLoose.has(lk)
            ? `same amount and day as row ${incomingLoose.get(lk).sourceRow} of this import`
            : `same amount and day as: ${describeRow(looseHit)}`;
        }

        const txn = {
          date: finalDate,
          direction,
          amount,
          narration,
          reference,
          cashBankAccountId,
          ledgerId: mappedLedgerId,
          ledgerName: ledgerText,
          transactionType,
          /* Which line of the pasted or uploaded statement this came from —
             the trail back to the source when a figure is questioned. */
          sourceRow: rows.indexOf(r) + 1,
          classification,
          matchInfo,
        };
        if (!incomingStrict.has(sk)) incomingStrict.set(sk, txn);
        if (!incomingLoose.has(lk)) incomingLoose.set(lk, txn);
        newTxns.push(txn);
    }

      if (newTxns.length === 0) {
        notify.error('No valid transactions found to import.');
        return;
      }

      /*
       * Nothing suspect is imported OR discarded silently.
       *
       * A clean statement goes straight in. One with duplicates or
       * possibles stops at a review: each flagged row beside what it
       * collided with, duplicates unticked, the decision the operator's.
       */
      const flagged = newTxns.filter((t) => t.classification !== 'new');
      if (flagged.length) {
        setImportReview({
          rows: newTxns.map((t, i) => ({ ...t, key: i, take: t.classification !== 'duplicate' })),
          unknownAccounts: Array.from(unknownAccounts),
          firstImportedAccountId,
          sourceName,
        });
        return;
      }

      await commitImport(newTxns, { unknownAccounts, firstImportedAccountId, sourceName });
    } catch (err) {
      // Avoid silent failures when a helper or parse step throws.
      console.error('Upload/import failed', err);
      notify.error(`Import failed: ${err?.message || String(err)}`);
    }
  };

  /** Writes the rows somebody decided to keep. The batch stamp and the
      immutability that follows from `imported: true` live here, once. */
  const commitImport = async (txnsToImport, { unknownAccounts = new Set(), firstImportedAccountId = null, sourceName = '' } = {}) => {
    const newTxns = txnsToImport;
    /*
     * One batch per import, stamped on every row it brought in.
     *
     * The batch is how "undo that upload" and "where did this row come from"
     * are ever answerable. And the rows are marked imported: what the bank
     * said — date, amount, direction, narration, reference — is evidence, not
     * data entry, and the edit path refuses to rewrite it. Allocation lives
     * in its own fields beside it.
     */
    const importBatchId = `imp-${companyId}-${Date.now()}`;

    /*
     * The ledger first, then the browser's copy.
     *
     * An imported row that names a ledger account is a posting: cash moved
     * between two accounts and the trial balance has to know. This built the
     * journal entries inside the setDb updater, which is synchronous, so they
     * were written to this device and never sent — the books balanced here and
     * were missing the entries on the server and on every other machine.
     *
     * Posting is asynchronous, so it happens out here, before the write, which
     * is the same shape AllocationDialog uses for the same reason. Each entry
     * that reaches the server comes back with its id, and that id is attached
     * to the local row inside the updater below; one that cannot be posted —
     * no session, an account with no server twin — is still recorded locally
     * and simply carries no backend id, exactly as postJournalToLedger's own
     * contract describes.
     */
    const accounts = safeArray(db.chartOfAccounts).filter((a) => Number(a.companyId) === Number(companyId));
    const postedByTxnId = new Map();
    for (const txn of newTxns) {
      if (!txn.ledgerId) continue;
      const incoming = String(txn.direction || '').toUpperCase() === 'IN';
      const fromId = incoming ? String(txn.ledgerId) : String(txn.cashBankAccountId);
      const toId = incoming ? String(txn.cashBankAccountId) : String(txn.ledgerId);
      const from = accounts.find((a) => String(a.id) === fromId);
      const to = accounts.find((a) => String(a.id) === toId);
      if (!from || !to) continue;
      const patch = await postJournalToLedger({
        chartRows: accounts,
        entry: {
          date: txn.date,
          narration: txn.narration || `Transfer from ${from.name} to ${to.name}`,
          lines: [
            { accountId: toId, accountName: to.name || '', accountCode: to.code || '', debit: txn.amount, credit: 0 },
            { accountId: fromId, accountName: from.name || '', accountCode: from.code || '', debit: 0, credit: txn.amount },
          ],
        },
      });
      if (patch?.backendEntryId) postedByTxnId.set(String(txn.sourceRow ?? txn.reference ?? txn.date) + txn.amount, patch.backendEntryId);
    }

    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      let nextId = list.reduce((m, x) => Math.max(m, Number(x?.id || 0)), 0) + 1;
      const appended = newTxns.map((t) => ({
        id: nextId++,
        companyId,
        cashBankAccountId: Number(t.cashBankAccountId),
        date: t.date,
        direction: t.direction,
        ledgerId: t.ledgerId || undefined,
        transactionType: t.transactionType || (t.direction === 'IN' ? 'Receipt' : 'Payment'),
        amount: t.amount,
        narration: t.narration,
        description: t.narration,
        reference: t.reference || '',
        linkedPaymentId: null,
        imported: true,
        importBatchId,
        /* Where this batch came from — the file's own name, or the paste. */
        importFileName: String(sourceName || '') || 'pasted rows',
        sourceRow: t.sourceRow,
        createdAt: new Date().toISOString(),
      }));
      let nextJournalId = safeArray(prev.journalEntries).reduce((m, x) => Math.max(m, Number(x?.id || 0)), 0) + 1;
      const mappedJournals = [];
      const finalAppended = appended.map((txn) => {
        if (!txn.ledgerId) return txn;
        const incoming = String(txn.direction || '').toUpperCase() === 'IN';
        const fromId = incoming ? String(txn.ledgerId) : String(txn.cashBankAccountId);
        const toId = incoming ? String(txn.cashBankAccountId) : String(txn.ledgerId);
        const from = safeArray(prev.chartOfAccounts).find((a) => String(a.id) === fromId);
        const to = safeArray(prev.chartOfAccounts).find((a) => String(a.id) === toId);
        if (!from || !to) return txn;
        const journalId = nextJournalId++;
        mappedJournals.push({
          id: journalId,
          companyId,
          number: `${txn.transactionType === 'Contra' ? 'AUTO-CONTRA' : 'AUTO-BANK'}-${txn.id}`,
          date: txn.date,
          narration: txn.narration || `Transfer from ${from.name} to ${to.name}`,
          lines: [
            { accountId: toId, accountName: to.name || '', accountCode: to.code || '', debit: txn.amount, credit: 0 },
            { accountId: fromId, accountName: from.name || '', accountCode: from.code || '', debit: 0, credit: txn.amount },
          ],
          totalDebit: txn.amount,
          totalCredit: txn.amount,
          voucherKind: txn.transactionType === 'Contra' ? 'contra' : 'bank-allocation',
          sourceBankTransactionId: txn.id,
          /* The server's id for the same entry, where it reached the server.
             Absent means this device holds it alone — see the note above. */
          backendEntryId: postedByTxnId.get(String(txn.sourceRow ?? txn.reference ?? txn.date) + txn.amount) || null,
          createdAt: new Date().toISOString(),
        });
        return { ...txn, linkedJournalEntryId: journalId, allocationStatus: 'Allocated' };
      });
      return {
        ...prev,
        bankTransactions: [...list, ...finalAppended],
        journalEntries: [...safeArray(prev.journalEntries), ...mappedJournals],
      };
    });

    setView('all');
    if (firstImportedAccountId) setSelectedAccountId(String(firstImportedAccountId));

    const unknownSet = unknownAccounts instanceof Set ? unknownAccounts : new Set(unknownAccounts);
    const unknownMsg =
      unknownSet.size > 0
        ? `\n\nWarning: unknown account name(s) skipped: ${Array.from(unknownSet).slice(0, 10).join(', ')}${
            unknownSet.size > 10 ? ' …' : ''
          }`
        : '';
    notify.error(`Imported ${newTxns.length} transaction(s).${unknownMsg}`);
  };

  const openUpload = () => {
    if (!cashBankAccounts.length) {
      notify.error('No cash/bank accounts found. Please create one first.');
      return;
    }
    uploadInputRef.current?.click?.();
  };

  const downloadUploadTemplate = () => {
    const header = ['Cash / bank account', 'Date', 'Description', 'Payment', 'Receipts'];
    const today = new Date().toISOString().slice(0, 10);
    const exampleAccount = String(selectedAccount?.name || cashBankAccounts[0]?.name || '');
    const example1 = [exampleAccount, today, 'Sample receipt narration', '', '1000.00'];
    const example2 = [exampleAccount, today, 'Sample payment narration', '750.00', ''];
    // The account name is the user's own text and rides into this template.
    const line = (cells) => cells.map(csvSafeValue).join(',');
    const csv = `${line(header)}\n${line(example1)}\n${line(example2)}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cashbank-upload-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const linkTxnToPayment = ({ txnId, paymentId }) => {
    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      const next = list.map((t) => {
        if (t.companyId !== companyId) return t;
        if (String(t.id) !== String(txnId)) return t;
        return { ...t, linkedPaymentId: Number(paymentId), updatedAt: new Date().toISOString() };
      });
      return { ...prev, bankTransactions: next };
    });
  };

  const openReconcile = (txn) => {
    if (!txn) return;

    const initial = {
      date: toIsoDate(txn.date),
      amount: String(txn.amount ?? ''),
      mode: 'Bank',
      reference: String(txn.reference || '').trim(),
      notes: String(txn.description || '').trim(),
      cashBankAccountId: Number(txn.cashBankAccountId),
      sourceBankTransactionId: Number(txn.id),
    };

    if (txn.direction === 'OUT') {
      openModal(
        <div className="ui-surface rounded-xl border p-4">
          <RecordDisbursementForm
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            initialData={initial}
            onSaved={(rec) => {
              if (rec?.id) linkTxnToPayment({ txnId: txn.id, paymentId: rec.id });
            }}
            onClose={() => openModal(null)}
          />
        </div>,
        { title: 'Reconcile Payment', maxWidthClass: 'max-w-4xl' }
      );
      return;
    }

    openModal(
      <div className="ui-surface rounded-xl border p-4">
        <RecordReceiptForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          initialData={initial}
          onSaved={(rec) => {
            if (rec?.id) linkTxnToPayment({ txnId: txn.id, paymentId: rec.id });
          }}
          onClose={() => openModal(null)}
        />
      </div>,
      { title: 'Reconcile Receipt', maxWidthClass: 'max-w-4xl' }
    );
  };

  const openCreateAccount = () => {
    if (typeof openLedgerCreate === 'function') {
      openLedgerCreate();
      return;
    }
    notify.error('Ledger creation is not available.');
  };

  const accountsEmpty = cashBankAccounts.length === 0;

  const [openActionId, setOpenActionId] = useState(null);
  /* One row's actions at a time, so one ref, attached to that row's cell. The
     menu used to sit over the rows below it until its own button was pressed
     again. */
  const actionsRef = useDismissable(Boolean(openActionId), () => setOpenActionId(null));

  const [selectedTxnIds, setSelectedTxnIds] = useState(() => new Set());

  useEffect(() => {
    // Drop selections that are not visible anymore (account/view/company changes).
    setSelectedTxnIds((prev) => {
      const visible = new Set(txns.map((t) => String(t.id)));
      const next = new Set();
      for (const id of prev) {
        if (visible.has(String(id))) next.add(String(id));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, view, companyId]);

  const allVisibleSelected = useMemo(() => {
    if (!txns.length) return false;
    return txns.every((t) => selectedTxnIds.has(String(t.id)));
  }, [txns, selectedTxnIds]);

  const anySelected = selectedTxnIds.size > 0;

  const toggleSelectTxn = (txnId, checked) => {
    setSelectedTxnIds((prev) => {
      const next = new Set(prev);
      const id = String(txnId);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAllVisible = (checked) => {
    setSelectedTxnIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const t of txns) next.add(String(t.id));
      } else {
        for (const t of txns) next.delete(String(t.id));
      }
      return next;
    });
  };

  const deleteSelectedTxns = async () => {
    if (!selectedTxnIds.size) return;
    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete ${selectedTxnIds.size} selected transaction(s)?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;
    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      const next = list.filter((t) => {
        if (t.companyId !== companyId) return true;
        if (String(t.cashBankAccountId) !== String(selectedAccountId)) return true;
        return !selectedTxnIds.has(String(t.id));
      });
      return { ...prev, bankTransactions: next };
    });
    setSelectedTxnIds(new Set());
    setOpenActionId(null);
  };

  /*
   * Clicking an uncategorised line opens the voucher it is.
   *
   * Money out is a payment and money in is a receipt — the same two forms used
   * everywhere else, including their allocation table, so a GST debit on the
   * statement becomes one payment split across tax, fee and interest instead
   * of a ledger guess and three records. Everything the statement already
   * knows is filled in; the only thing left to say is what the money was for.
   */
  const openCategorise = (txn) => {
    if (!txn) return;
    if (isCategorised(txn) || txn.readOnly) return;
    const dir = String(txn.direction || '').toUpperCase();
    const party = txn.ledgerId ? resolvePartyByLedgerId(txn.ledgerId) : null;
    const shared = {
      date: txn.date,
      amount: String(txn.amount ?? ''),
      mode: 'Bank',
      reference: String(txn.reference || '').trim(),
      notes: String(txn.narration || txn.description || '').trim(),
      cashBankAccountId: txn.cashBankAccountId,
      sourceBankTransactionId: txn.id,
    };
    const onSaved = (voucher) =>
      linkBankTxnToPayment({ bankTxnId: txn.id, ledgerId: txn.ledgerId, paymentId: voucher?.id });

    if (dir === 'IN') {
      openModal(
        <RecordReceiptForm
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          hideMode
          initialData={{ ...shared, customerId: party?.kind === 'customer' ? String(party.partyId) : '' }}
          onSaved={onSaved}
          onClose={() => openModal(null)}
        />,
        { title: 'Record Receipt', maxWidthClass: 'max-w-4xl' }
      );
      return;
    }

    openModal(
      <RecordDisbursementForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        hideMode
        initialData={{ ...shared, vendorId: party?.kind === 'vendor' ? String(party.partyId) : '' }}
        onSaved={onSaved}
        onClose={() => openModal(null)}
      />,
      { title: 'Record Payment', maxWidthClass: 'max-w-5xl' }
    );
  };

  const deleteTxn = async (txn) => {
    if (!txn) return;
    const ok = await confirmDialog({ title: 'Please confirm', message: 'Delete this transaction?', confirmLabel: 'Yes, continue' });
    if (!ok) return;
    await removeBankEntry(txn);
    setDb((prev) => {
      const list = safeArray(prev.bankTransactions);
      return { ...prev, bankTransactions: list.filter((t) => !(t.companyId === companyId && String(t.id) === String(txn.id))) };
    });
    setOpenActionId(null);
  };

  const txnExportColumns = [
    { key: 'date', label: 'Date' },
    { key: 'description', label: 'Description' },
    { key: 'ledger', label: 'Ledger', value: (t) => (t.ledgerId ? ledgerById.get(String(t.ledgerId))?.name || '' : '') },
    { key: 'narration', label: 'Narration' },
    { key: 'payment', label: 'Payment', value: (t) => (t.direction === 'OUT' ? Number(t.amount || 0) : '') },
    { key: 'receipt', label: 'Receipt', value: (t) => (t.direction === 'OUT' ? '' : Number(t.amount || 0)) },
    { key: 'status', label: 'Status', value: (t) => (t.readOnly ? 'Recorded' : isCategorised(t) ? 'Categorised' : 'Uncategorised') },
  ];

  return (
    <DocumentListShell
      entity="bank"
      title="Cash & Bank"
      company={currentCompany}
      search={{
        value: txnSearch.query,
        onChange: txnSearch.setQuery,
        placeholder: 'Search transactions…',
        label: 'Search transactions',
      }}
      headerExtras={
        <>
          {/*
            The account governs every figure and every row below it, so it sits
            with the controls that do, not in a panel of its own halfway down
            the page.
          */}
          <label className="sr-only" htmlFor="cashbank-account">
            Cash/bank account
          </label>
          <select
            id="cashbank-account"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="ui-select w-44 text-sm"
          >
            <option value="">Select account</option>
            {cashBankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {/* Only when there is a selection to act on. It used to sit here
              permanently dead, which teaches people to ignore the row. */}
          {anySelected ? (
            <button
              type="button"
              onClick={deleteSelectedTxns}
              className="ui-btn ui-btn-secondary text-[rgb(var(--neg))]"
            >
              Delete selected
            </button>
          ) : null}
        </>
      }
      moreItems={[
        exportMenuItem('Export transactions'),
        { key: 'template', label: 'Download statement template', Icon: FileSpreadsheet },
        { key: 'upload', label: 'Upload statement', Icon: Upload },
        { key: 'paste', label: 'Paste statement rows', Icon: ClipboardList },
        { sep: true },
        { key: 'newAccount', label: 'New cash or bank account', Icon: Landmark, group: 'Accounts' },
      ]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) {
          runListExport({
            format,
            title: `Cash & bank — ${selectedAccount?.name || 'account'}`,
            fileName: `CashBank_${selectedAccount?.name || 'account'}`,
            label: 'transaction(s)',
            columns: txnExportColumns,
            rows: txns,
          });
          return;
        }
        if (k === 'template') {
          downloadUploadTemplate();
          return;
        }
        if (k === 'upload') {
          if (accountsEmpty) {
            notify.error('Add a cash or bank account first.');
            return;
          }
          openUpload();
          return;
        }
        if (k === 'paste') {
          if (accountsEmpty) {
            notify.error('Add a cash or bank account first.');
            return;
          }
          setPasteOpen(true);
          setPasteText('');
          return;
        }
        if (k === 'newAccount') openCreateAccount();
      }}
      primary={
        /*
          One primary, and it has to be the one you can actually take. The
          header carried five buttons of equal weight and the only one styled
          as primary — Add Transaction — is disabled until an account exists,
          so a new company saw a row of grey buttons and nothing to press.
        */
        accountsEmpty ? (
          <PermissionButton permission="ACCOUNTING::Ledger::CREATE" type="button" onClick={openCreateAccount} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Account
          </PermissionButton>
        ) : (
          <PermissionButton permission="CASHBANK::Cash & Bank::CREATE" type="button" onClick={openAddTxn} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add Transaction
          </PermissionButton>
        )
      }
      cards={[
        { label: 'Transactions', value: allTxns.length, count: true, tone: 'draft', Icon: Landmark },
        { label: 'Money in', value: flow.moneyIn, tone: 'paid', Icon: ArrowDownLeft },
        { label: 'Money out', value: flow.moneyOut, tone: 'overdue', Icon: ArrowUpRight },
        { label: 'Net movement', value: flow.net, tone: 'sent', Icon: Landmark },
        { label: 'To categorise', value: uncategorisedCount, count: true, tone: 'outstanding', Icon: ListTodo },
      ]}
      tabs={[
        { value: 'uncategorised', label: 'Uncategorised', tone: 'outstanding' },
        { value: 'categorised', label: 'Categorised', tone: 'paid' },
        { value: 'all', label: 'All', tone: 'all' },
      ]}
      tabsLabel="Transaction view"
      statusValue={view}
      statusCounts={{ uncategorised: uncategorisedCount, categorised: categorisedCount, all: allTxns.length }}
      onStatusChange={setView}
      above={
        <>
        {allocatingTxn ? (
          <AllocationDialog
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            txn={allocatingTxn}
            onClose={() => setAllocatingTxn(null)}
          />
        ) : null}
        {importReview ? (
          <Modal onClose={() => setImportReview(null)} title="Review before importing" maxWidthClass="max-w-4xl">
            <div className="space-y-3">
              <p className="ui-caption">
                {importReview.rows.filter((r) => r.classification === 'duplicate').length} duplicate(s) and{' '}
                {importReview.rows.filter((r) => r.classification === 'possible').length} possible duplicate(s) found.
                Nothing is imported or discarded without your say — duplicates start unticked, everything else ticked.
              </p>
              <div className="ui-table-scroll max-h-96 overflow-y-auto">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th scope="col" aria-label="Import" />
                      <th scope="col">Date</th>
                      <th scope="col" className="text-end">Amount</th>
                      <th scope="col">Narration</th>
                      <th scope="col">Ref / UTR</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">Collides with</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReview.rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <input
                            type="checkbox"
                            className="ui-checkbox"
                            checked={r.take}
                            aria-label={`Import row ${r.sourceRow}`}
                            onChange={(e) =>
                              setImportReview((prev) => ({
                                ...prev,
                                rows: prev.rows.map((x) => (x.key === r.key ? { ...x, take: e.target.checked } : x)),
                              }))
                            }
                          />
                        </td>
                        <td>{r.date}</td>
                        <td className={`ui-money ${r.direction === 'OUT' ? 'text-[rgb(var(--neg-ink))]' : 'text-[rgb(var(--pos-ink))]'}`}>
                          {r.direction === 'OUT' ? '−' : ''}{formatMoney(r.amount, currentCompany)}
                        </td>
                        <td className="ui-narration truncate">{r.narration || '—'}</td>
                        <td className="ui-mono">{r.reference || '—'}</td>
                        <td>
                          <StatusPill
                            status={
                              r.classification === 'duplicate'
                                ? 'Duplicate'
                                : r.classification === 'possible'
                                  ? 'Possible duplicate'
                                  : 'New'
                            }
                          />
                        </td>
                        <td className="ui-caption truncate">{r.matchInfo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setImportReview(null)}>
                  Cancel import
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  disabled={!importReview.rows.some((r) => r.take)}
                  onClick={async () => {
                    const chosen = importReview.rows.filter((r) => r.take);
                    await commitImport(chosen, {
                      unknownAccounts: new Set(importReview.unknownAccounts),
                      firstImportedAccountId: importReview.firstImportedAccountId,
                      sourceName: importReview.sourceName,
                    });
                    setImportReview(null);
                  }}
                >
                  Import {importReview.rows.filter((r) => r.take).length} row(s)
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
        {pasteOpen ? (
          <Modal onClose={() => setPasteOpen(false)} title="Paste statement rows" maxWidthClass="max-w-2xl">
            <div className="space-y-3">
              <p className="ui-caption">
                Copy the rows from net-banking or a spreadsheet — header first — and paste them here. Columns
                understood: Date, Payments, Receipts (or a single Amount), Narration, Ref No / UTR. Rows import as
                the bank’s side only; nothing posts until each is allocated.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                className="ui-input ui-mono w-full text-xs"
                placeholder={'Date,Payments,Receipts,Narration,Ref No / UTR\n01-09-2026,10000,,GST Paid,UTR900111'}
                data-autofocus="true"
                aria-label="Statement rows"
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setPasteOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    void importStatementText(pasteText);
                    setPasteOpen(false);
                  }}
                >
                  Import rows
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
        <input
          ref={uploadInputRef}
          type="file"
          accept=".csv,text/csv"
          className="ui-input sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            e.target.value = '';
            if (f) onUploadStatement(f);
          }}
        />
        </>
      }
      tip={{
        storageKey: 'clor.tip.cashBank',
        Icon: ListTodo,
        text: 'A statement line becomes a book entry when you give it a ledger — until then it sits under Uncategorised.',
      }}
    >
      <div className="ui-table-scroll">
            <table className="ui-table ui-table-wide ui-table-sticky">
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label="Select every transaction in view"
                      checked={allVisibleSelected}
                      onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                      disabled={txns.length === 0}
                    />
                  </th>
                  <ColumnHeader label="Date" col="date" state={txnFilters} align="center" />
                  <ColumnHeader label="Description" col="description" state={txnFilters} />
                  <ColumnHeader label="Ledger" col="ledger" state={txnFilters} />
                  <ColumnHeader label="Narration" col="narration" state={txnFilters} />
                  <ColumnHeader label="Payment" col="payment" state={txnFilters} className="ui-num" align="right" />
                  <ColumnHeader label="Receipts" col="receipt" state={txnFilters} className="ui-num" align="right" />
                  <ColumnHeader label="Status" col="status" state={txnFilters} align="center" />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!selectedAccount ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={Landmark}
                        kind="new"
      title={accountsEmpty ? 'No cash or bank account yet' : 'Pick an account'}
                        description={
                          accountsEmpty
                            ? 'Every payment and receipt moves through one of these. Name the cash box or the bank account and its book starts here.'
                            : 'Choose the account whose book you want to see, from the header.'
                        }
                        routes={
                          accountsEmpty
                            ? [
                                {
                                  label: 'Add an account',
                                  description: 'Cash in hand, or a bank account with its number.',
                                  onSelect: () => openCreateAccount(),
                                },
                              ]
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : txns.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={ListTodo}
                        kind="new"
      title={view === 'uncategorised' && allTxns.length ? 'Nothing left to categorise' : 'No transactions'}
                        description={
                          view === 'uncategorised' && allTxns.length
                            ? 'Every line in this account has a ledger against it.'
                            : 'Money moving through this account — a bank charge, interest, a transfer — is recorded here.'
                        }
                        routes={
                          allTxns.length
                            ? undefined
                            : [
                                {
                                  label: 'Add one now',
                                  description: 'Date, amount, which way the money went.',
                                  onSelect: () => openAddTxn(),
                                },
                                {
                                  label: 'Upload a statement',
                                  description: 'Bring the bank’s own CSV across and categorise it here.',
                                  onSelect: () => (accountsEmpty ? openCreateAccount() : openUpload()),
                                },
                              ]
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  txns.map((t) => {
                    const isOut = t.direction === 'OUT';
                    const categorised = isCategorised(t);
                    const ledger = t.ledgerId ? ledgerById.get(String(t.ledgerId)) : null;
                    const ledgerName = categorised ? (ledger?.name || '-') : 'Uncategorised';
                    return (
                      <tr key={t.id} className="ui-hover-sunken">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedTxnIds.has(String(t.id))}
                            onChange={(e) => toggleSelectTxn(t.id, e.target.checked)}
                          />
                        </td>
                        <td className="ui-col-date px-4 py-3"><DocDate value={t.date} /></td>
                        <td className="ui-col-meta px-4 py-3">{String(t.description || '').trim() || '-'}</td>
                        <td className="ui-col-meta px-4 py-3">{ledgerName}</td>
                        <td className="ui-col-meta ui-narration px-4 py-3">{String(t.narration || '').trim() || '-'}</td>
                        <td className="ui-col-amount px-4 py-3 text-right text-[rgb(var(--neg))]"><MoneyValue value={isOut ? formatMoney(Number(t.amount ?? 0), currentCompany) : '-'} company={currentCompany} /></td>
                        <td className="ui-col-amount px-4 py-3 text-right text-[rgb(var(--pos))]"><MoneyValue value={isOut ? '-' : formatMoney(Number(t.amount ?? 0), currentCompany)} company={currentCompany} /></td>
                        <td className="px-4 py-3">
                          {t.readOnly ? (
                            <StatusPill status="Recorded" />
                          ) : categorised ? (
                            <StatusPill status="Categorised" />
                          ) : (
                            /* The one status that is also the way to fix it. */
                            <button
                              type="button"
                              onClick={() => openCategorise(t)}
                              title={`Record this as a ${String(t.direction).toUpperCase() === 'IN' ? 'receipt' : 'payment'}`}
                            >
                              <StatusPill status="Uncategorised" />
                            </button>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 text-right relative"
                          ref={String(openActionId || '') === String(t.id) ? actionsRef : undefined}
                        >
                          {t.readOnly ? null : (<>
                          <button
                            type="button"
                            onClick={() => setOpenActionId((p) => (String(p) === String(t.id) ? null : t.id))}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
                            aria-haspopup="menu"
                            aria-expanded={String(openActionId || '') === String(t.id)}
                            aria-label="Actions"
      title="Actions"
                          >
                            <MoreVertical size={18} />
                          </button>

                          {String(openActionId || '') === String(t.id) ? (
                            <div className="absolute right-4 mt-2 w-40 ui-surface border rounded-lg shadow-sm overflow-hidden z-10">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenActionId(null);
                                  setAllocatingTxn(t);
                                }}
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken"
                              >
                                <Link2 size={16} />
                                <span>Allocate / split</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenActionId(null);
                                  openAddTxn({
                                    editTxnId: t.id,
                                    cashBankAccountId: t.cashBankAccountId,
                                    date: t.date,
                                    direction: t.direction,
                                    ledgerId: t.ledgerId ? String(t.ledgerId) : '',
                                    amount: String(t.amount ?? ''),
                                    narration: String(t.narration || '').trim(),
                                    ledgerSearch: String(ledgerById.get(String(t.ledgerId))?.name || '').trim(),
                                  });
                                }}
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken"
                              >
                                <Pencil size={16} />
                                <span>Edit</span>
                              </button>
                              {/* Both existed as complete implementations with
                                  no way to reach them — the menu offered only
                                  Edit and Delete, so matching a bank line to
                                  its invoices could never actually be done. */}
                              {!t.linkedPaymentId && t.ledgerId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionId(null);
                                    openKnockoff({ bankTxn: t, ledgerId: t.ledgerId });
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken"
                                >
                                  <Link2 size={16} />
                                  <span>Knock-off invoices</span>
                                </button>
                              ) : null}
                              {!t.linkedPaymentId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionId(null);
                                    openReconcile(t);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken"
                                >
                                  <CheckCircle2 size={16} />
                                  <span>Reconcile</span>
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => deleteTxn(t)}
                                className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken text-[rgb(var(--neg))]"
                              >
                                <Trash2 size={16} />
                                <span>Delete</span>
                              </button>
                            </div>
                          ) : null}
                          </>)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
      </div>
      <TableTotals
        count={txns.length}
        totalCount={txnSearch.filtered.length}
        noun="transactions"
        figures={txnTotals}
      />
    </DocumentListShell>
  );
};

export default CashBankModule;

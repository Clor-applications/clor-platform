import React, { useMemo, useState, useRef } from 'react';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { DocFormActions, DocFormFootnote, AmountInWordsBand } from '@ui/components/DocumentForm';
import { amountInWordsInr } from '@ui/utils/money';
import { notify } from '@ui/components/ui/notify';
import { blockIfClosed } from '@ui/utils/bookClose';

import AllocationTable from './AllocationTable';
import OutstandingBillsModal from './OutstandingBillsModal';
import { allocationError, allocationJournalLines, emptyAllocationRow, usableRows } from './allocationLines';
import { postJournalToLedger } from '@ui/utils/journalSync';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { FieldError, FieldErrorSummary } from '@ui/components/ui/Primitives';
import { createPayment } from '@ui/api/payments';
import usePaymentModes, { modeLabel } from './usePaymentModes';
import { formatMoney, round2 } from '@ui/utils/money';
import { payableOutstanding, sourceTdsOf } from '@ui/utils/onAccount';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import DocNumberField from '@ui/components/DocNumberField';
import { DocDate } from '@ui/components/docs';
import { priorBaseFor, resolveTds, tdsEventFrom, tdsLedgersFor } from '../tds/engine';
import { natureForSection } from '../tds/ruleMaster';
import { tdsGroupSide } from '@ui/utils/tdsLedgers';

const safeArray = (v) => (Array.isArray(v) ? v : []);

/**
 * What is still owed on a bill, after debit notes.
 *
 * This was total minus paid, which ignores a purchase return entirely. Raise a
 * debit note against a bill and this screen still offered the full original
 * amount — so paying "the outstanding balance" paid the vendor a second time
 * for goods that had already gone back.
 */
const getDocBalance = (doc, notes) => payableOutstanding(doc, notes).outstanding;

const canPayDoc = (doc, notes) => {
  const rawStatus = String(doc?.status || '').trim();
  if (rawStatus === 'Draft') return false;
  return getDocBalance(doc, notes) > 0.0001;
};

const RecordDisbursementForm = ({ db, setDb, currentCompany, onClose, screenTitle = '', onBack = null, initialData = null, onSaved, hideMode = false }) => {
  /* §2: a company with TDS off does not deduct — the compact control is
     offered only where it is relevant. */
  const tdsEnabledHere = Boolean(currentCompany?.profile?.taxCompliances?.tds?.enabled);
  const formRef = useRef(null);
  const fieldErrors = useFieldErrors('payment');
  const companyId = currentCompany.id;

  const initial = useMemo(() => {
    const d = initialData && typeof initialData === 'object' ? initialData : null;
    return {
      date: String(d?.date || '').trim() || new Date().toISOString().slice(0, 10),
      vendorId: d?.vendorId !== undefined && d?.vendorId !== null ? String(d.vendorId) : '',
      amount: d?.amount !== undefined && d?.amount !== null ? String(d.amount) : '',
      mode: String(d?.mode || '').trim() || 'Cash',
      ledgerAccountId: String(d?.ledgerAccountId || '').trim(),
      number: String(d?.number || '').trim(),
      reference: String(d?.reference || '').trim(),
      referenceDate: String(d?.referenceDate || '').slice(0, 10),
      /*
       * What comes off the payment before it leaves the bank.
       *
       * A vendor bill of 10,000 with 1,000 of TDS settles the bill in full and
       * moves 9,000 out of the account. Without these the two had to be entered
       * as different numbers on different screens, or the TDS was simply not
       * recorded against the payment it belonged to.
       */
      tdsAmount: d?.tdsAmount ? String(d.tdsAmount) : '',
      tdsLedgerId: String(d?.tdsLedgerId || ''),
      bankCharges: d?.bankCharges ? String(d.bankCharges) : '',
      otherCharges: d?.otherCharges ? String(d.otherCharges) : '',
      notes: String(d?.notes || '').trim(),
      cashBankAccountId: d?.cashBankAccountId,
      sourceBankTransactionId: d?.sourceBankTransactionId,
    };
  }, [initialData]);

  /*
   * The voucher's own number, from the company's series.
   *
   * Every other document here is numbered and a payment was not, so the only
   * way to cite one afterwards was its date and amount. The series — prefix,
   * next number, width — is the one already configured under Numbering; this
   * screen does not invent a second scheme.
   */
  const takenPaymentNumbers = useMemo(
    () =>
      safeArray(db.payments)
        .filter((x) => x.companyId === currentCompany?.id)
        .map((x) => String(x.number || '').trim())
        .filter(Boolean),
    [db.payments, currentCompany]
  );

  const paymentNumbering = getDocSettings(db, currentCompany, { branchId: null })?.numbering?.payment;

  const [formData, setFormData] = useState(() => ({
    date: initial.date,
    number:
      initial.number ||
      nextFreeVoucherNumber({
        db,
        company: currentCompany,
        voucherKey: 'payment',
        takenNumbers: safeArray(db.payments)
          .filter((x) => x.companyId === currentCompany?.id)
          .map((x) => String(x.number || '').trim())
          .filter(Boolean),
      }),
    vendorId: initial.vendorId,
    amount: initial.amount,
    mode: initial.mode,
    ledgerAccountId: initial.ledgerAccountId,
    reference: initial.reference,
    referenceDate: initial.referenceDate,
    tdsAmount: initial.tdsAmount,
    bankCharges: initial.bankCharges,
    otherCharges: initial.otherCharges,
    notes: initial.notes,
  }));

  const { modes, loading: modesLoading, error: modesError } = usePaymentModes(db, companyId);
  const [saving, setSaving] = useState(false);

  // With exactly one cash/bank ledger there is no choice to make, so treat it
  // as chosen. Derived rather than written into state by an effect: the user's
  // own pick always wins, and no extra render is spent agreeing with itself.
  //
  // hideMode is the cash/bank book, where the account is implied by the book
  // you are standing in. It still has to resolve to a real ledger, otherwise a
  // payment entered from the bank book would never reach the general ledger --
  // which is exactly what happens to every payment once the standalone screens
  // are switched off.
  const impliedByBook = useMemo(() => {
    if (!hideMode) return '';
    const wanted = String(formData.mode || '').toLowerCase() === 'cash' ? 'CASH' : 'BANK';
    return modes.find((m) => m.controlKind === wanted)?.id || modes[0]?.id || '';
  }, [hideMode, formData.mode, modes]);

  const requestedLedgerAccountId = String(formData.ledgerAccountId || '').trim();
  const resolvedRequestedMode = modes.find(
    (mode) => String(mode.id) === requestedLedgerAccountId || String(mode.localId) === requestedLedgerAccountId
  );
  const ledgerAccountId =
    resolvedRequestedMode?.id || (modes.length === 1 ? modes[0].id : '') || impliedByBook;

  const [allocations, setAllocations] = useState(() => ({}));
  /* Where the money goes when it is not a bill: GST, a late fee, a bank
     charge, an employee reimbursement. One row per account. */
  /*
   * Seeded with the payee when the payment was started from a document.
   *
   * "Record payment" on a bill row knows the vendor; with the picker gone,
   * the only place that knowledge can land is the row that now stands for the
   * payee. Without it the form opens against nobody and the bill the operator
   * was trying to settle is not even listed.
   */
  const [ledgerRows, setLedgerRows] = useState(() => {
    const seeded = safeArray(db?.vendors).find((v) => {
      if (Number(v?.companyId) !== companyId) return false;
      if (initial.vendorId !== '' && Number(v.id) === Number(initial.vendorId)) return true;
      const want = String(initialData?.vendorName || '').trim().toLowerCase();
      return Boolean(want) && String(v?.name || '').trim().toLowerCase() === want;
    });
    const accountId = String(seeded?.accountId ?? '').trim();
    if (!accountId) return [emptyAllocationRow()];
    return [{ ...emptyAllocationRow(), ledgerId: accountId }];
  });

  const bills = useMemo(() => {
    return safeArray(db.bills)
      .filter((b) => b.companyId === companyId)
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db.bills, companyId]);

  const expenses = useMemo(() => {
    return safeArray(db.expenses)
      .filter((e) => e.companyId === companyId)
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db.expenses, companyId]);

  const debitNotes = safeArray(db?.debitNotes);

  /*
   * The payee is a ledger you pick, not a field above the ledgers.
   *
   * Every vendor carries the control account it posts to, so choosing
   * "Acme Supplies (Sundry Creditors)" in an allocation row IS choosing the
   * payee. The separate picker asked the same question twice with nothing
   * stopping the two answers disagreeing.
   */
  const vendorByAccountId = useMemo(() => {
    const out = new Map();
    for (const v of safeArray(db?.vendors)) {
      if (Number(v?.companyId) !== companyId) continue;
      const acc = String(v?.accountId ?? '').trim();
      if (acc) out.set(acc, v);
    }
    return out;
  }, [db?.vendors, companyId]);

  const partyRowIndex = useMemo(
    () => ledgerRows.findIndex((r) => vendorByAccountId.has(String(r?.ledgerId ?? '').trim())),
    [ledgerRows, vendorByAccountId]
  );
  const partyVendor =
    partyRowIndex >= 0 ? vendorByAccountId.get(String(ledgerRows[partyRowIndex].ledgerId).trim()) : null;

  const partyVendorId = partyVendor ? Number(partyVendor.id) : NaN;

  const outstandingDocs = useMemo(() => {
    const vid = Number(partyVendorId);
    if (!Number.isFinite(vid) || !vid) return [];

    const billRows = bills
      .filter((b) => Number(b.vendorId) === vid)
      .filter((b) => canPayDoc(b, debitNotes))
      .map((b) => ({
        key: `bill:${b.id}`,
        voucherType: 'bill',
        id: Number(b.id),
        number: b.number,
        date: b.date,
        /* The bill's own figure and when it falls due: the table shows both, so
           the row has to carry both rather than the balance alone. */
        dueDate: b.dueDate || '',
        total: Number(b.total ?? 0),
        balance: getDocBalance(b, debitNotes),
        /* What the bill itself deducted, and on what — so a payment against it
           does not deduct the same obligation twice. */
        taxableValue: Number(b.taxableValue ?? b.subtotal ?? 0),
        tdsAmount: Number(b.tdsAmount ?? 0),
        tdsNatureCode: String(b.tdsNatureCode || ''),
      }));

    const expenseRows = expenses
      .filter((e) => Number(e.vendorId) === vid)
      .filter((e) => canPayDoc(e, debitNotes))
      .map((e) => ({
        key: `expense:${e.id}`,
        voucherType: 'expense',
        id: Number(e.id),
        number: e.number,
        date: e.date,
        dueDate: e.dueDate || '',
        total: Number(e.total ?? e.amount ?? 0),
        balance: getDocBalance(e, debitNotes),
        /* Expenses can deduct TDS when they are booked, exactly as bills do.
           Carry the saved deduction into the allocation dialog; the balance
           is already net, and this explains the difference visibly. */
        tdsAmount: Number(e.tdsAmount ?? 0),
        tdsNatureCode: String(e.tdsNatureCode || e.tdsSection || ''),
      }));

    /*
     * Oldest first, which is the order they are paid in.
     *
     * A list is usually newest first, and this one is not a list — it is a
     * queue. The bill that has been waiting longest is the one somebody
     * settles, and it was at the bottom.
     */
    return [...billRows, ...expenseRows].sort((a, b) => {
      const da = String(a.date || '');
      const dbb = String(b.date || '');
      if (da !== dbb) return da < dbb ? -1 : 1;
      return Number(a.id) - Number(b.id);
    });
  }, [bills, expenses, debitNotes, partyVendorId]);

  /*
   * What the payment is for is what it is worth.
   *
   * There used to be an "Amount paid" box and the allocation had to be made
   * to agree with it — two figures, one typed twice, and a save that refused
   * until they matched. The bills are a breakdown of the payee row rather
   * than an addition to it.
   */
  const paymentAmountFromRows = round2(
    usableRows(ledgerRows).reduce((t, r) => t + (Number(r.amount) || 0), 0)
  );

  const computed = useMemo(() => {
    const payAmountRaw = paymentAmountFromRows;
    const totalAmount = Number.isFinite(payAmountRaw) ? Math.max(0, payAmountRaw) : 0;

    let allocated = 0;
    const lines = [];

    for (const d of outstandingDocs) {
      const row = allocations[d.key];
      if (!row?.selected) continue;
      const want = Number(row?.amount ?? 0);
      const amt = Number.isFinite(want) ? Math.max(0, want) : 0;
      if (amt <= 0) continue;

      const capped = Math.min(d.balance, amt);
      if (capped <= 0) continue;

      allocated = round2(allocated + capped);
      lines.push({
        voucherType: d.voucherType,
        voucherId: d.id,
        documentNumber: d.number,
        amount: round2(capped),
        /* Carried so the deduction can tell which obligations already had TDS
           taken at the bill and which did not. */
        taxableValue: Number(d.taxableValue ?? 0),
        alreadyDeducted: Number(d.tdsAmount ?? 0),
        tdsNatureCode: String(d.tdsNatureCode || ''),
      });
    }

    const advance = round2(Math.max(0, totalAmount - allocated));

    /*
     * Two different figures, and the screen has to show both.
     *
     * `totalAmount` is what the bills are being settled by; `netCash` is what
     * actually leaves the account once TDS and charges are held back. Showing
     * one and calling it the other is how a bank reconciliation ends up short
     * by exactly the tax deducted.
     */
    const pos = (v) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) && n > 0 ? round2(n) : 0;
    };
    const tds = pos(formData.tdsAmount);
    const bankCharges = pos(formData.bankCharges);
    const otherCharges = pos(formData.otherCharges);
    const deductions = round2(tds + bankCharges + otherCharges);
    const netCash = round2(Math.max(0, totalAmount - deductions));

    return {
      totalAmount: round2(totalAmount),
      allocated: round2(allocated),
      advance,
      tds,
      bankCharges,
      otherCharges,
      deductions,
      netCash,
      lines,
    };
  }, [
    allocations,
    paymentAmountFromRows,
    formData.tdsAmount,
    formData.bankCharges,
    formData.otherCharges,
    outstandingDocs,
  ]);

  /*
   * TDS at the payment stage.
   *
   * The rule is "credit or payment, whichever is earlier", so the deduction
   * belongs here only for what was NOT already deducted when the bill was
   * entered. §16 makes that mandatory: a bill that credited TDS Payable and a
   * payment that deducted again would take the tax twice from one obligation
   * and leave the vendor short by it.
   */
  const tdsLedgerMaster = useMemo(() => {
    const groups = (db?.accountGroups || []).filter((g) => Number(g?.companyId) === Number(currentCompany?.id));
    return (db?.chartOfAccounts || [])
      .filter((a) => Number(a?.companyId) === Number(currentCompany?.id))
      .map((a) => ({ ...a, tdsSide: String(a?.tdsSide || '').toUpperCase() || tdsGroupSide(groups, a.groupId) }))
      .filter((a) => a.tdsSide);
  }, [db?.chartOfAccounts, db?.accountGroups, currentCompany?.id]);

  /*
   * What an allocation row may point at: any active ledger except the account
   * the money is leaving from — crediting and debiting the same bank in one
   * payment is a no-op somebody has to unpick later.
   */
  const allocationLedgers = useMemo(() => {
    const cid = Number(currentCompany?.id);
    return (db?.chartOfAccounts || [])
      .filter((a) => Number(a?.companyId) === cid && a?.isActive !== false)
      .filter((a) => String(a.id) !== String(ledgerAccountId))
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [db?.chartOfAccounts, currentCompany?.id, ledgerAccountId]);

  const vendorRecord = useMemo(
    () => partyVendor || (db?.vendors || []).find((v) => Number(v.id) === Number(formData.vendorId)) || null,
    [partyVendor, db?.vendors, formData.vendorId]
  );

  /* What the bills being settled already deducted for themselves. */
  const tdsAtBill = round2(computed.lines.reduce((t, l) => t + Number(l.alreadyDeducted || 0), 0));

  /* And the taxable value of the ones that did not. */
  const tdsUndeductedBase = round2(
    computed.lines
      .filter((l) => Number(l.alreadyDeducted || 0) <= 0)
      .reduce((t, l) => t + Number(l.taxableValue || 0), 0)
  );

  const tdsNatureCode =
    String(vendorRecord?.tdsNatureCode || '').trim() || natureForSection(vendorRecord?.tdsSection)?.code || '';

  const tdsPriorValue = useMemo(
    () =>
      priorBaseFor((db?.bills || []).filter((b) => b.companyId === currentCompany?.id), {
        partyId: partyVendorId,
        natureCode: tdsNatureCode,
        onDate: formData.date,
      }),
    [db?.bills, currentCompany?.id, partyVendorId, tdsNatureCode, formData.date]
  );

  const tds = resolveTds({
    company: currentCompany,
    party: vendorRecord,
    transactionDate: formData.date,
    taxableBase: tdsUndeductedBase,
    side: 'PAYABLE',
    priorBase: tdsPriorValue,
    ledgers: tdsLedgerMaster,
    /* The duplicate check §16 demands, answered from the documents this
       payment is settling rather than from a flag somebody has to remember. */
    existingEventFor: () => (tdsAtBill > 0 ? { sourceType: 'bill', tdsAmount: tdsAtBill } : null),
  });

  const tdsLedgersHere = tds.natureCode
    ? tdsLedgersFor(tdsLedgerMaster, { natureCode: tds.natureCode, side: 'PAYABLE' })
    : [];

  /*
   * The dialog that fills the payee's allocation in — the receipt's, from the
   * other side of the book. A payment has one payee, so one boolean and one
   * set of bills.
   */
  const [billsOpen, setBillsOpen] = useState(false);
  const [billsPrompted, setBillsPrompted] = useState(false);

  /* The bills as the dialog needs them. Assembled here because what is still
     owed on a bill depends on debit notes, which the dialog has no business
     knowing about. */
  const billsForModal = useMemo(
    () =>
      outstandingDocs.map((d) => ({
        id: d.key,
        number: d.number,
        date: d.date,
        total: Number(d.total ?? 0),
        tdsExpected: Number(sourceTdsOf(d) || 0),
        outstanding: d.balance,
      })),
    [outstandingDocs]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    const amount = paymentAmountFromRows;
    const vendorIdNum = Number(partyVendorId);

    // One pass, each failure at its own field. Allocation problems below name a
    // specific document, so they keep their toast.
    fieldErrors.reset();
    fieldErrors.check('amount', Number.isFinite(amount) && amount > 0, 'Enter an amount greater than zero');
    /* A payee is not required. A GST challan, a bank charge and a salary
       advance are all payments with no party on the vendor master, and the
       form used to refuse every one of them. */

    if (!hideMode) {
      fieldErrors.require('ledgerAccountId', ledgerAccountId, 'Choose where the money was paid from');
    }
    /*
     * A number, and only one payment wearing it.
     *
     * Two payments with the same number cannot be told apart in a ledger or on
     * a bank statement, and the series can be typed over — so the clash has to
     * be caught here rather than assumed away.
     */
    const paymentNumber = String(formData.number || '').trim();
    fieldErrors.require('number', paymentNumber, 'A payment number is required');
    fieldErrors.check(
      'number',
      !paymentNumber ||
        !takenPaymentNumbers.some((n) => n.toLowerCase() === paymentNumber.toLowerCase()),
      'That number is already used by another payment.'
    );

    if (fieldErrors.failed()) return;

    if (computed.allocated > amount + 0.0001) {
      notify.error('Total allocated cannot be more than payment amount');
      return;
    }

    /*
     * And the entry has to balance before it is written, not after.
     *
     * Bills already settled on this form count toward the total, so a payment
     * that clears ₹10,000 of bills and ₹500 of bank charge is one record with
     * two kinds of line, not a record plus a mystery.
     */
    const allocProblem = allocationError({
      rows: ledgerRows,
      /* Nought on purpose: the bills are a breakdown of the payee row's own
         figure, not a second allocation beside it. Counting them here counts
         them twice and refuses every payment as over-allocated by exactly the
         amount it just settled. */
      documentTotal: 0,
      amount,
      noun: 'payment',
      hasParty: Number.isFinite(vendorIdNum) && !!vendorIdNum,
    });
    if (allocProblem) {
      notify.error(allocProblem);
      return;
    }

    /*
     * §15: double deduction is a BLOCKING error, not a warning. The engine
     * already answered that these bills deducted at source; a figure typed
     * over that answer would take the same obligation's tax twice.
     */
    if (tds.duplicateOf && computed.tds > 0.005) {
      notify.error(
        `TDS was already deducted on the bills being settled (${'\u20B9'}${Number(
          tds.duplicateOf.tdsAmount || tdsAtBill
        ).toLocaleString('en-IN')}). Remove the TDS deduction here — deducting again would take it twice.`
      );
      return;
    }

    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This payment');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    if (computed.tds > 0.005 && tds.blocked) {
      notify.error(tds.warnings?.find((w) => w.severity === 'BLOCK')?.message || 'The TDS on this payment cannot be posted.');
      return;
    }

    // Validate each allocation against latest balances
    const billsList = safeArray(db.bills).filter((b) => b.companyId === companyId);
    const expensesList = safeArray(db.expenses).filter((x) => x.companyId === companyId);

    for (const line of computed.lines) {
      const list = line.voucherType === 'bill' ? billsList : expensesList;
      const doc = list.find((d) => Number(d.id) === Number(line.voucherId));
      if (!doc) {
        notify.error('One of the selected documents was not found. Please refresh and try again.');
        return;
      }
      if (!canPayDoc(doc, debitNotes)) {
        notify.error(`Cannot record against ${line.voucherType} ${doc.number || ''} (Draft/No balance).`);
        return;
      }
      const balance = getDocBalance(doc, debitNotes);
      if (Number(line.amount) > balance + 0.0001) {
        notify.error(`Allocation exceeds outstanding for ${line.voucherType} ${doc.number || ''}.`);
        return;
      }
    }

    const vendors = safeArray(db.vendors).filter((v) => v.companyId === companyId);
    const vendor = vendors.find((v) => Number(v.id) === vendorIdNum) || null;
    const vendorName = vendor?.name || vendor?.displayName || vendor?.companyName || vendor?.legalName || '';

    const paymentId = safeArray(db.payments).length + 1;

    // Post to the server first: it allocates the number and writes the
    // double-entry. Bills and expenses are still client-only, so nothing is
    // allocated server-side yet — the payment posts against the vendor control
    // account, which keeps cash and the AP total correct.
    let posted = null;
    if (String(ledgerAccountId || "").trim()) {
      setSaving(true);
      try {
        const billById = new Map(safeArray(db.bills).map((b) => [Number(b.id), b]));
        posted = await createPayment({
          direction: 'PAYMENT',
          date: formData.date,
          partyType: 'VENDOR',
          partyId: vendor?.backendPartyId ? String(vendor.backendPartyId) : null,
          partyName: vendorName || null,
          ledgerAccountId: String(ledgerAccountId).trim(),
          instrumentRef: formData.reference || null,
          /* What left the account, which is the gross less what was held back —
             posting the gross here overstates the bank by the TDS every time. */
          amount: round2(computed.netCash),
          notes: formData.notes || null,
          /* Which bills this settles — for the ones the server knows. */
          allocations: computed.lines
            .filter((l) => l.voucherType === 'bill')
            .map((l) => {
              const backendId = String(billById.get(Number(l.voucherId))?.backendDocId || '').trim();
              return backendId ? { docType: 'BILL', docId: backendId, amount: round2(l.amount) } : null;
            })
            .filter(Boolean),
          /*
           * §15's payment-stage entry, through the central service: the
           * vendor is debited with what the bills were SETTLED by, the bank
           * credited with the cash, and each deduction credited to its own
           * account — TDS to TDS Payable, where the challan later finds it.
           */
          deductions: [
            computed.tds > 0 ? { kind: 'TDS', amount: round2(computed.tds) } : null,
            computed.bankCharges > 0 ? { kind: 'BANK_CHARGES', amount: round2(computed.bankCharges) } : null,
            computed.otherCharges > 0 ? { kind: 'OTHER', amount: round2(computed.otherCharges) } : null,
          ].filter(Boolean),
        });
      } catch (err) {
        setSaving(false);
        notify.error(String(err?.message || 'Unable to record the payment.'));
        return;
      }
      setSaving(false);
    }

    const paymentNo = String(posted?.number || '').trim() || `PAY-${paymentId}`;

    const paymentRecord = {
      id: paymentId,
      companyId,
      voucherType: 'payment',
      voucherId: null,
      direction: 'OUT',
      cashBankAccountId:
        initial.cashBankAccountId !== undefined && initial.cashBankAccountId !== null && String(initial.cashBankAccountId) !== ''
          ? Number(initial.cashBankAccountId)
          : undefined,
      sourceBankTransactionId:
        initial.sourceBankTransactionId !== undefined && initial.sourceBankTransactionId !== null && String(initial.sourceBankTransactionId) !== ''
          ? Number(initial.sourceBankTransactionId)
          : undefined,
      paymentNo,
      date: formData.date,
      vendorId: vendorIdNum,
      vendorName,
      amount: round2(amount),
      allocatedAmount: round2(computed.allocated),
      advanceAmount: round2(computed.advance),
      allocations: computed.lines.map((l) => ({
        voucherType: l.voucherType,
        voucherId: l.voucherId,
        documentNumber: l.documentNumber,
        amount: round2(l.amount),
      })),
      mode: formData.mode,
      // Links the local row to the posted server payment and the ledger the
      // money actually left from.
      backendPaymentId: posted?.id ? String(posted.id) : undefined,
      ledgerAccountId: String(ledgerAccountId || "").trim() || undefined,
      number: paymentNumber,
      reference: formData.reference,
      referenceDate: String(formData.referenceDate || '').slice(0, 10) || undefined,
      /*
       * Kept with the payment they came off, not merely subtracted from it. A
       * TDS figure that exists only as the difference between two numbers
       * cannot be reported, and the 26Q return is built from exactly these.
       */
      tdsAmount: computed.tds || undefined,
      /* Which nature and ledger it was taken under — the register reads these,
         and without them a figure on a payment is a number with no tax on it. */
      tdsNatureCode: computed.tds > 0 ? tds.natureCode || undefined : undefined,
      tdsLedgerId: computed.tds > 0 ? String(formData.tdsLedgerId || tds.ledgerId || '') || undefined : undefined,
      tdsRuleVersionId: computed.tds > 0 ? tds.ruleVersionId || undefined : undefined,
      bankCharges: computed.bankCharges || undefined,
      otherCharges: computed.otherCharges || undefined,
      netCash: computed.netCash,
      /* Kept on the record, so the entry can be read back and the bank
         transaction that produced it can be matched to its own lines. */
      ledgerAllocations: usableRows(ledgerRows).map((r) => ({
        ledgerId: String(r.ledgerId),
        amount: round2(r.amount),
        description: String(r.description || '').trim() || undefined,
      })),
      notes: formData.notes,
      createdAt: new Date().toISOString(),
    };

    /*
     * The ledger side of a payment that is not only bills.
     *
     * Dr every allocated account, Cr the bank once — the same engine every
     * other entry goes through. The bill lines are already posted by the
     * party's own settlement, so only the ledger rows are written here.
     */
    let allocationJournal = {};
    const ledgerLines = usableRows(ledgerRows);
    if (ledgerLines.length && String(ledgerAccountId || '').trim()) {
      const accounts = safeArray(db.chartOfAccounts).filter((a) => Number(a.companyId) === Number(companyId));
      const nameOf = (id) => accounts.find((a) => String(a.id) === String(id))?.name || '';
      const lines = allocationJournalLines({
        rows: ledgerLines,
        direction: 'OUT',
        bankLedgerId: String(ledgerAccountId).trim(),
        amount: ledgerLines.reduce((t, r) => t + round2(r.amount), 0),
        nameOf,
      });
      try {
        allocationJournal = await postJournalToLedger({
          chartRows: accounts,
          entry: {
            date: String(formData.date).slice(0, 10),
            narration: `Payment ${paymentNo}`,
            lines,
          },
        });
      } catch {
        /* The payment still stands locally; the entry retries with the rest of
           the book. Losing the record because the ledger was unreachable is
           the worse failure. */
        allocationJournal = {};
      }
    }

    const nowIso = new Date().toISOString();

    const nextBills = safeArray(db.bills).map((b) => {
      if (b.companyId !== companyId) return b;
      const line = paymentRecord.allocations.find((a) => a.voucherType === 'bill' && Number(a.voucherId) === Number(b.id));
      if (!line) return b;

      const total = Number(b.total ?? 0);
      /* Settled when the NET reaches the vendor: the bill's own source TDS
         left the vendor's claim the day it posted. */
      const target = round2(Math.max(0, total - sourceTdsOf(b)));
      const alreadyPaid = Number(b.paidAmount ?? 0);
      const nextPaid = round2(Math.min(target, alreadyPaid + Number(line.amount ?? 0)));

      const rawStatus = String(b.status || '').trim();
      const nextStatus =
        rawStatus === 'Draft'
          ? 'Draft'
          : target > 0 && nextPaid >= target - 0.0001
            ? 'Paid'
            : nextPaid > 0
              ? 'Partial'
              : 'Unpaid';

      return {
        ...b,
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: nowIso,
      };
    });

    const nextExpenses = safeArray(db.expenses).map((ex) => {
      if (ex.companyId !== companyId) return ex;
      const line = paymentRecord.allocations.find((a) => a.voucherType === 'expense' && Number(a.voucherId) === Number(ex.id));
      if (!line) return ex;

      const total = Number(ex.total ?? 0);
      const alreadyPaid = Number(ex.paidAmount ?? 0);
      const nextPaid = round2(Math.min(total, alreadyPaid + Number(line.amount ?? 0)));

      const rawStatus = String(ex.status || '').trim();
      const nextStatus =
        rawStatus === 'Draft'
          ? 'Draft'
          : total > 0 && nextPaid >= total - 0.0001
            ? 'Paid'
            : nextPaid > 0
              ? 'Partial'
              : 'Unpaid';

      return {
        ...ex,
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: nowIso,
      };
    });

    /*
     * The compliance record for a payment-stage deduction.
     *
     * Written only where the payment itself deducted: where the bill already
     * had, its own event is the one the return reads, and a second event here
     * would report the same tax twice.
     */
    const tdsEvents = safeArray(db.tdsTransactions);
    const tdsEvent =
      computed.tds > 0 && tds.natureCode
        ? {
            id: tdsEvents.reduce((m, t) => Math.max(m, Number(t?.id) || 0), 0) + 1,
            ...tdsEventFrom(
              { ...tds, tdsAmount: computed.tds, ledgerId: String(formData.tdsLedgerId || tds.ledgerId || '') },
              {
                company: currentCompany,
                party: vendorRecord,
                source: { type: 'payment', id: paymentRecord.id, number: paymentRecord.number },
                date: formData.date,
              }
            ),
          }
        : null;

    setDb({
      ...db,
      /* The allocation's own entry, merged with whatever else the save
         writes — journalEntries and the chart rows it may have created. */
      ...allocationJournal,
      tdsTransactions: tdsEvent ? [...tdsEvents, tdsEvent] : db.tdsTransactions,
      bills: nextBills,
      expenses: nextExpenses,
      payments: [...safeArray(db.payments), paymentRecord],
      /* The series moves on past the number this payment just took, so the next
         one does not open on a number already in the book. */
      companies: bumpCompanyNextNumber({
        db,
        companyId,
        voucherKey: 'payment',
        usedNumber: paymentRecord.number,
      }),
    });

    onSaved?.(paymentRecord);

    notify.success(computed.advance > 0 ? 'Payment recorded (with advance)!' : 'Payment recorded!');
    onClose?.();
  };

  /*
   * The shared document contract. A payment has no line grid, so this is the
   * part that matters on a settlement screen: Ctrl+S saves, Ctrl+Enter
   * commits, and Enter moves to the next field instead of posting the moment
   * the cursor is in the amount box.
   */
  /* How many bills the operator has ticked, for the running bar. */
  const selectedCount = useMemo(
    () => Object.values(allocations).filter((v) => Boolean(v?.selected)).length,
    [allocations]
  );

  const onFormKeyDown = useDocumentFormKeys({ formRef });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} noValidate className="ui-creation-form space-y-3">
      {/* The bar every document form carries: the name on the left, every way
          out of it on the right, pinned so Record stays reachable from the
          bottom of a long list of open bills. */}
      <DocFormActions
        title={screenTitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel={saving ? 'Recording…' : 'Record Payment'}
        disabled={saving}
        secondaryLabel="Cancel"
        onSecondary={onClose}
      />

      {/*
        The head of the document, in the invoice's two columns: who was paid and
        where the money left from on the left, the paperwork — date and amount —
        on the right, ruled off between them.
      */}
      <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!hideMode ? (
          <div>
            <label className="ui-label">
              Pay from <span className="text-[rgb(var(--neg))]">*</span>
            </label>
            <select
              value={ledgerAccountId}
              onChange={(e) => {
                fieldErrors.clearField('ledgerAccountId');
                setFormData((p) => ({ ...p, ledgerAccountId: e.target.value }));
              }}
              className="ui-select w-full"
              disabled={modesLoading}
              required
              {...fieldErrors.props('ledgerAccountId')}
            >
              <option value="">{modesLoading ? 'Loading accounts…' : 'Select cash or bank account'}</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {modeLabel(m)}
                </option>
              ))}
            </select>
            {modesError ? (
              <p className="mt-1 text-sm text-[rgb(var(--neg))]">{modesError}</p>
            ) : !modesLoading && modes.length === 0 ? (
              <p className="mt-1 text-sm text-[rgb(var(--warn-ink))]">
                No cash or bank accounts yet. Add one under Master Data → Chart of Accounts, under the Bank
                Accounts or Cash-in-Hand group, and it appears here.
              </p>
            ) : null}
          </div>
        ) : null}

          <div className="min-w-0">
            <label className="ui-label" htmlFor="pay-ref">Reference</label>
            <input
              id="pay-ref"
              type="text"
              value={formData.reference}
              onChange={(e) => setFormData((p) => ({ ...p, reference: e.target.value }))}
              className="ui-input w-full"
              placeholder="Txn / UTR / Cheque no"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="ui-label" htmlFor="pay-mode">Payment mode</label>
            <select
              id="pay-mode"
              value={formData.mode}
              onChange={(e) => setFormData((p) => ({ ...p, mode: e.target.value }))}
              className="ui-select w-full"
            >
              {['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card', 'Other'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="ui-label" htmlFor="pay-ref-date">Reference date</label>
            <input
              id="pay-ref-date"
              type="date"
              value={formData.referenceDate}
              onChange={(e) => setFormData((p) => ({ ...p, referenceDate: e.target.value }))}
              className="ui-input w-full"
            />
          </div>
        </div>
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <DocNumberField
                id="pay-number"
                label="Payment No."
                value={formData.number}
                onChange={(e) => {
                  fieldErrors.clearField('number');
                  setFormData((p) => ({ ...p, number: e.target.value }));
                }}
                voucherKey="payment"
      title="Payment numbering"
                sampleLabel="Next payment will be"
                manualLabel="Typed on each payment"
                settings={paymentNumbering}
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
              />
              <FieldError error={fieldErrors.error('number')} id={fieldErrors.errorId('number')} />
              <p className="ui-caption mt-1">Auto from settings; type over if needed.</p>
            </div>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="pay-date">
                Payment Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="pay-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
                className="ui-input w-full"
                required
              />
            </div>
          </div>

        </div>
      </div>

      {/*
        What comes off the payment, beside what it is.
        Held together in one tinted band because they are read as one figure —
        the amount, less what is held back — and split across the form they
        were three unrelated boxes nobody totalled.
      */}
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: 'rgb(var(--brand) / 0.06)', border: '1px solid rgb(var(--brand) / 0.18)' }}
      >
        <h3 className="ui-t-label">Payment amount and deductions</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* The amount leads the band that is named after it; it used to sit
              up in the header, three fields away from what comes off it. */}

          {/*
            The deduction, and where it posts.

            The figure is the engine's — the same one the bill uses — and it is
            offered only for what has not already been deducted. A bill that
            took TDS when it was entered says so here instead, because taking
            it again would pay the department twice out of one vendor.
          */}
          {tdsEnabledHere ? (
          <div className="min-w-0">
            <label className="ui-label" htmlFor="pay-tdsAmount">TDS deduction</label>
            <input
              id="pay-tdsAmount"
              type="number"
              min="0"
              step="0.01"
              value={formData.tdsAmount}
              onChange={(e) => setFormData((p) => ({ ...p, tdsAmount: e.target.value }))}
              className="ui-input ui-money w-full"
              placeholder="0.00"
            />
            {/* The engine's own answer, not a second opinion formed here: it
                is what decides whether a deduction may be made at all. */}
            {tds.duplicateOf ? (
              <p className="ui-caption mt-1">
                Already deducted on the bills being settled:{' '}
                {formatMoney(Number(tds.duplicateOf.tdsAmount || tdsAtBill), currentCompany)}. Deducting again here
                would take it twice.
              </p>
            ) : tds.tdsAmount > 0 ? (
              <p className="ui-caption mt-1">
                {tds.statutoryReference} suggests {formatMoney(tds.tdsAmount, currentCompany)} at {tds.rate}% on{' '}
                {formatMoney(tds.baseAmount, currentCompany)}.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() =>
                    setFormData((p) => ({
                      ...p,
                      tdsAmount: String(tds.tdsAmount),
                      tdsLedgerId: String(tds.ledgerId || p.tdsLedgerId || ''),
                    }))
                  }
                >
                  Use it
                </button>
              </p>
            ) : (
              <p className="ui-caption mt-1">Held back and paid to the department.</p>
            )}

            {Number(formData.tdsAmount || 0) > 0 && tdsLedgersHere.length ? (
              <div className="mt-2">
                <label className="ui-label" htmlFor="pay-tds-ledger">TDS ledger</label>
                <select
                  id="pay-tds-ledger"
                  className="ui-select w-full"
                  value={formData.tdsLedgerId || tds.ledgerId || ''}
                  onChange={(e) => setFormData((p) => ({ ...p, tdsLedgerId: e.target.value }))}
                >
                  <option value="">Select ledger</option>
                  {tdsLedgersHere.map((l) => (
                    <option key={l.id} value={String(l.id)}>{l.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          ) : null}

          {/* Bank charges and "other deductions" were two boxes that reduced
              the cash and posted nowhere a ledger could find them. They are
              allocation rows now, like everything else that is not a bill —
              pick the expense account and the amount, and the entry says what
              the money was. */}
        </div>
      </div>

      <AllocationTable
        rows={ledgerRows}
        onChange={setLedgerRows}
        ledgerOptions={allocationLedgers}
        amount={paymentAmountFromRows}
        documentTotal={0}
        documentLabel="Bills settled"
        heading="Ledger allocation"
        noun="payment"
        money={(v) => formatMoney(v, currentCompany)}
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        rowMeta={(i) => {
          if (i !== partyRowIndex || !partyVendor) return {};
          const rowAmount = round2(Number(ledgerRows[i]?.amount) || 0);
          const onAccount = round2(Math.max(0, rowAmount - computed.allocated));
          return {
            isParty: true,
            available: billsForModal.length,
            status:
              computed.lines.length > 0
                ? onAccount > 0
                  ? `${computed.lines.length} bill${computed.lines.length === 1 ? '' : 's'} · ${formatMoney(onAccount, currentCompany)} on account`
                  : `Against ${computed.lines.length} bill${computed.lines.length === 1 ? '' : 's'}`
                : rowAmount > 0
                  ? 'On account'
                  : '',
            onViewBills: () => setBillsOpen(true),
            onAmountSettled: () => {
              if (billsPrompted) return;
              if (!(Number(ledgerRows[i]?.amount) > 0)) return;
              if (!billsForModal.length) return;
              setBillsPrompted(true);
              setBillsOpen(true);
            },
          };
        }}
      />

      {billsOpen ? (
        <OutstandingBillsModal
          partyName={vendorRecord ? (vendorRecord.displayName || vendorRecord.name || '') : ''}
          noun="bill"
          bills={billsForModal}
          value={allocations}
          available={round2(Number(ledgerRows[partyRowIndex]?.amount) || 0)}
          money={(v) => formatMoney(v, currentCompany)}
          onClose={() => setBillsOpen(false)}
          onApply={(next, total) => {
            setAllocations(next);
            setBillsOpen(false);
            if (partyRowIndex >= 0 && !(Number(ledgerRows[partyRowIndex]?.amount) > 0) && total > 0) {
              setLedgerRows((rows) =>
                rows.map((r, i) => (i === partyRowIndex ? { ...r, amount: String(total) } : r))
              );
            }
          }}
        />
      ) : null}


      {/*
       * What the payment comes to, put back.
       *
       * Commit 09525c9 removed this block and the receipt's twin, and left the
       * tests that assert them in place — so the screens that decide how much
       * money leaves a bank account have been shipping without the figures
       * that catch a mistake, and five tests have been red ever since. The
       * numbers were never lost: `computed` still works all of them out. Only
       * the display went.
       *
       * The two that catch a mistake are the last two: money put against
       * nothing, and a payment that settles less than it moves.
       */}
      <section className="ui-card p-4" aria-label="Payment summary">
        <h3 className="ui-t-sec">Payment summary</h3>
        <dl className="mt-3 space-y-2 text-sm">
          {[
            ['Amount paid', computed.totalAmount],
            ['TDS deduction', computed.tds],
            ['Bank charges', computed.bankCharges],
            ['Other deductions', computed.otherCharges],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="ui-muted">{label}</dt>
              <dd className="ui-money">{formatMoney(value, currentCompany)}</dd>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 border-t pt-2" style={{ borderColor: 'rgb(var(--border))' }}>
            <dt className="ui-muted">Total deductions</dt>
            <dd className="ui-money">{formatMoney(computed.deductions, currentCompany)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="ui-muted">Total allocated</dt>
            <dd className="ui-money">{formatMoney(computed.allocated, currentCompany)}</dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ui-tile-brand">
          <span className="text-sm font-medium">Advance (unallocated)</span>
          <span className="ui-money">{formatMoney(computed.advance, currentCompany)}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl px-3 py-3 ui-tile-brand">
          <span className="text-sm font-medium">Net payment amount</span>
          <span className="ui-money-lg">{formatMoney(computed.netCash, currentCompany)}</span>
        </div>

        <AmountInWordsBand words={amountInWordsInr(computed.netCash)} />
      </section>

      {/* A payment against the wrong bill is a dispute six months later, and
          this is the line that says somebody checked. */}
      <DocFormFootnote declaration="the payment above is against the documents selected, and the details are correct." />

      {/* The running figure, kept on screen while bills are ticked off: what
          actually LEAVES the account, not what the bills came to. Reading the
          gross here disagreed with the summary a few inches above it. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Paid from the account</span>
        <span className="ui-money-lg">{formatMoney(computed.netCash, currentCompany)}</span>
        <span className="ui-caption">{selectedCount} bill(s) allocated</span>
        <FieldErrorSummary errors={fieldErrors.errors} />
      </div>
    </form>
  );
};

export default RecordDisbursementForm;

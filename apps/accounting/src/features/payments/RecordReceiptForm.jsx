import React, { useMemo, useState, useRef } from 'react';
import { Landmark, Percent } from 'lucide-react';

import { cashReceiptWarning } from '@ui/utils/cashLimits';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import { notify } from '@ui/components/ui/notify';
import { blockIfClosed } from '@ui/utils/bookClose';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { FieldError, FieldErrorSummary } from '@ui/components/ui/Primitives';

import CustomerPicker from '../../components/pickers/CustomerPicker';
import AllocationTable from './AllocationTable';
import { allocationError, allocationJournalLines, emptyAllocationRow, usableRows } from './allocationLines';
import { postJournalToLedger } from '@ui/utils/journalSync';
import { createPayment } from '@ui/api/payments';
import usePaymentModes, { modeLabel } from './usePaymentModes';
import OutstandingBillsModal from './OutstandingBillsModal';
import { getNextNumericId } from '@ui/utils/ids';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import DocNumberField from '@ui/components/DocNumberField';
import { formatMoney, round2 } from '@ui/utils/money';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { tdsEventFrom, tdsLedgersFor } from '../tds/engine';
import { natureForSection } from '../tds/ruleMaster';
import { tdsGroupSide } from '@ui/utils/tdsLedgers';
import { documentOutstanding } from '@ui/utils/onAccount';
import { DocDate } from '@ui/components/docs';

const safeArray = (v) => (Array.isArray(v) ? v : []);

/**
 * What the customer still owes on an invoice, after credit notes.
 *
 * Was total minus paid, which ignores a sales return: after crediting an
 * invoice this screen still asked for the full amount, so collecting "the
 * balance" took money the customer no longer owed.
 */
const getInvoiceBalance = (inv, notes) => documentOutstanding(inv, notes).outstanding;

const canCollectAgainstInvoice = (inv, notes) => {
  const rawStatus = String(inv?.status || '').trim();
  if (rawStatus === 'Draft') return false;
  if (rawStatus === 'Cancelled') return false;
  return getInvoiceBalance(inv, notes) > 0.0001;
};

const RecordReceiptForm = ({ db, setDb, currentCompany, onClose, initialData = null, onSaved, hideMode = false, screenTitle = '', onBack = null }) => {
  /* §2: a company with TDS off does not track it — the compact control is
     offered only where it is relevant. */
  const tdsEnabledHere = Boolean(currentCompany?.profile?.taxCompliances?.tds?.enabled);
  const formRef = useRef(null);
  const fieldErrors = useFieldErrors('receipt');
  const companyId = currentCompany.id;

  const initial = useMemo(() => {
    const d = initialData && typeof initialData === 'object' ? initialData : null;

    /*
     * Who the receipt is from, even when the document only knows their name.
     *
     * Recording a receipt from an invoice row prefilled the amount and the
     * reference and left the customer empty, so the one field that decides
     * which invoices can be settled had to be found again by hand. An invoice
     * that came back from the server carries `customerName` and no local id —
     * the id belongs to this browser's copy of the master — so the name is
     * matched when the id is missing.
     */
    const byName = () => {
      const want = String(d?.customerName || '').trim().toLowerCase();
      if (!want) return '';
      const match = (Array.isArray(db?.customers) ? db.customers : []).find(
        (c) =>
          String(c?.companyId) === String(companyId) &&
          [c?.displayName, c?.name].some((n) => String(n || '').trim().toLowerCase() === want)
      );
      return match ? String(match.id) : '';
    };

    const requestedCustomerId =
      d?.customerId !== undefined && d?.customerId !== null && String(d.customerId) !== ''
        ? String(d.customerId)
        : '';
    const requestedCustomerExists = requestedCustomerId && (Array.isArray(db?.customers) ? db.customers : []).some(
      (c) => String(c?.companyId) === String(companyId) && String(c?.id) === requestedCustomerId
    );

    return {
      date: String(d?.date || '').trim() || new Date().toISOString().slice(0, 10),
      // Server invoices can carry the server party id here. Use it only when
      // it is a real local customer id; otherwise resolve the customer name.
      customerId: requestedCustomerExists ? requestedCustomerId : byName(),
      amount: d?.amount !== undefined && d?.amount !== null ? String(d.amount) : '',
      mode: String(d?.mode || '').trim() || 'Cash',
      ledgerAccountId: String(d?.ledgerAccountId || '').trim(),
      reference: String(d?.reference || '').trim(),
      notes: String(d?.notes || '').trim(),
      cashBankAccountId: d?.cashBankAccountId,
      sourceBankTransactionId: d?.sourceBankTransactionId,
    };
  }, [initialData, db?.customers, companyId]);

  const [formData, setFormData] = useState(() => ({
    date: initial.date,
    number: String(initialData?.number || ''),
    customerId: initial.customerId,
    amount: initial.amount,
    mode: initial.mode,
    ledgerAccountId: initial.ledgerAccountId,
    reference: initial.reference,
    narration: String(initialData?.narration || ''),
    notes: initial.notes,
    // Deducted on the way: tax the customer withheld, and what the bank took.
    tdsAmount: initialData?.tdsAmount ? String(initialData.tdsAmount) : '',
    tdsLedgerId: String(initialData?.tdsLedgerId || ''),
    bankCharges: initialData?.bankCharges ? String(initialData.bankCharges) : '',
    otherCharges: initialData?.otherCharges ? String(initialData.otherCharges) : '',
  }));

  const { modes, loading: modesLoading, error: modesError } = usePaymentModes(db, companyId);
  const [saving, setSaving] = useState(false);

  // With exactly one cash/bank ledger there is no choice to make, so treat it
  // as chosen. Derived rather than written into state by an effect: the user's
  // own pick always wins, and no extra render is spent agreeing with itself.
  //
  // hideMode is the cash/bank book, where the account is implied by the book
  // you are standing in. It still has to resolve to a real ledger, otherwise a
  // receipt entered from the bank book would never reach the general ledger --
  // which is exactly what happens to every receipt once the standalone screens
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

  /*
   * The mode is the operator's, but the account picks its opening guess.
   *
   * §269ST is counted on this field, and a form that defaults every receipt to
   * Cash counts a bank transfer against the two-lakh limit for anybody who
   * does not think to change it. So the account chosen above sets it — cash
   * in hand means Cash, anything else means Bank Transfer — until somebody
   * says otherwise, and then their answer stands.
   */
  const [modeTouched, setModeTouched] = useState(Boolean(initialData?.mode));
  const impliedMode = useMemo(() => {
    const picked = modes.find((m) => String(m.id) === String(ledgerAccountId));
    if (!picked) return '';
    return String(picked.controlKind || '').toUpperCase() === 'CASH' ? 'Cash' : 'Bank Transfer';
  }, [modes, ledgerAccountId]);
  const receiptMode = modeTouched ? formData.mode : impliedMode || formData.mode || 'Cash';

  /* Free text on the wire, so the list can grow without a migration. Only
     "Cash" carries meaning — it is what §269ST is counted on. */
  const RECEIPT_MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'Card', 'Other'];

  /*
   * Opened against one invoice, that invoice is already ticked.
   *
   * Recording a receipt from an invoice row used to prefill only the customer
   * and the outstanding amount, so the money arrived unallocated and the
   * invoice it came from stayed open — the one thing the operator was
   * certainly trying to close.
   */
  const [allocations, setAllocations] = useState(() => {
    const id = initialData?.allocateInvoiceId;
    const amt = Number(initialData?.amount ?? 0);
    if (!id || !(amt > 0)) return {};
    return { [String(id)]: { selected: true, amount: round2(amt) } };
  });

  const invoices = useMemo(() => {
    return safeArray(db.invoices)
      .filter((i) => i.companyId === companyId)
      .sort((a, b) => {
        const da = String(a.date || '');
        const dbb = String(b.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b.id) - Number(a.id);
      });
  }, [db.invoices, companyId]);

  const creditNotes = safeArray(db?.creditNotes);

  /* What the money coming in is FOR, when it is not only invoices: other
     income, interest received, a refund, a director's contribution. */
  /*
   * Seeded with the party when the receipt was started from a document.
   *
   * "Record receipt" on an invoice row knows the customer; with the picker
   * gone, the only place that knowledge can land is the row that now stands
   * for the party. Without this the form opens against nobody and the invoice
   * the operator was trying to close is not even listed.
   */
  const [ledgerRows, setLedgerRows] = useState(() => {
    const seededCustomer = safeArray(db?.customers).find((c) => {
      if (Number(c?.companyId) !== companyId) return false;
      if (initial.customerId !== '' && Number(c.id) === Number(initial.customerId)) return true;
      const wantName = String(initialData?.customerName || '').trim().toLowerCase();
      return Boolean(wantName) && String(c?.name || '').trim().toLowerCase() === wantName;
    });
    const companyAccounts = safeArray(db?.chartOfAccounts).filter((a) => String(a?.companyId) === String(companyId));
    const linkedAccountId = String(seededCustomer?.accountId ?? '').trim();
    const linkedAccountExists = companyAccounts.some((a) => String(a?.id) === linkedAccountId);
    const customerName = String(getCustomerDisplayName(seededCustomer) || seededCustomer?.name || '').trim().toLowerCase();
    const matchedAccount = companyAccounts.find((a) => {
      if (String(a?.customerId ?? '') === String(seededCustomer?.id ?? '')) return true;
      if (String(a?.partyId ?? '') === String(seededCustomer?.backendPartyId ?? '') && seededCustomer?.backendPartyId) return true;
      return customerName && String(a?.name || '').trim().toLowerCase() === customerName;
    });
    const accountId = linkedAccountExists ? linkedAccountId : String(matchedAccount?.id ?? '').trim();
    if (!accountId) return [emptyAllocationRow()];
    return [{ ...emptyAllocationRow(), ledgerId: accountId, amount: initial.amount }];
  });

  /*
   * The party is a ledger you pick, not a field above the ledgers.
   *
   * Every customer carries the control account it posts to, so choosing
   * "ABC Traders (Sundry Debtors)" in an allocation row IS choosing the party
   * — and the separate picker above was asking the same question twice, with
   * nothing stopping the two answers disagreeing.
   */
  const customerByAccountId = useMemo(() => {
    const out = new Map();
    for (const c of safeArray(db?.customers)) {
      if (Number(c?.companyId) !== companyId) continue;
      const acc = String(c?.accountId ?? '').trim();
      if (acc) out.set(acc, c);
    }
    return out;
  }, [db?.customers, companyId]);

  /* The first row pointing at a customer's control account. One receipt is
     from one party, so the first is the one. */
  const partyRowIndex = useMemo(
    () => ledgerRows.findIndex((r) => customerByAccountId.has(String(r?.ledgerId ?? '').trim())),
    [ledgerRows, customerByAccountId]
  );
  const partyCustomer =
    partyRowIndex >= 0 ? customerByAccountId.get(String(ledgerRows[partyRowIndex].ledgerId).trim()) : null;
  const partyCustomerId = partyCustomer ? Number(partyCustomer.id) : NaN;


  const outstandingInvoices = useMemo(() => {
    const cid = Number(partyCustomerId);
    if (!Number.isFinite(cid) || !cid) return [];

    return invoices
      .filter((inv) => Number(inv.customerId) === cid)
      .filter((inv) => canCollectAgainstInvoice(inv, creditNotes));
  }, [partyCustomerId, invoices]);



  const allocationLedgers = useMemo(() => {
    const cid = Number(currentCompany?.id);
    return (db?.chartOfAccounts || [])
      .filter((a) => Number(a?.companyId) === cid && a?.isActive !== false)
      .filter((a) => String(a.id) !== String(ledgerAccountId))
      // LedgerField scopes options by company. Preserve that identity here;
      // reducing rows to only id/name made a correctly preselected customer
      // ledger render as an empty field.
      .map((a) => ({ id: a.id, name: a.name, code: a.code, groupName: a.groupName, companyId: a.companyId, isActive: a.isActive }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [db?.chartOfAccounts, currentCompany?.id, ledgerAccountId]);

  /*
   * What the receipt is for is now what it is worth.
   *
   * There used to be an "Amount Received" box at the head of the form and the
   * allocation had to be made to agree with it — two figures, one of them
   * typed twice, and a save that refused until they matched. The amount is the
   * allocation: every ledger line plus whatever the bills settled.
   */
  const ledgerRowsTotal = usableRows(ledgerRows).reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const billsTotal = useMemo(() => {
    let t = 0;
    for (const inv of outstandingInvoices) {
      const row = allocations[String(inv.id)];
      if (!row?.selected) continue;
      const amt = Number(row.amount) || 0;
      if (amt > 0) t += Math.min(getInvoiceBalance(inv, creditNotes), amt);
    }
    return round2(t);
  }, [allocations, outstandingInvoices, creditNotes]);
  /*
   * The receipt is worth what its rows say.
   *
   * The bills are not added on top: they are a breakdown of the party row's
   * own figure, saying which of that customer's invoices the money settled.
   * Whatever the operator does not place on an invoice stays with the party —
   * an advance, on account — which is the oldest behaviour in the product and
   * the reason this screen cannot simply demand the two agree.
   */
  const receiptAmountFromRows = round2(ledgerRowsTotal);

  /* What the party row is holding, and what of it has been placed. */
  const partyRowAmount =
    partyRowIndex >= 0 ? round2(Number(ledgerRows[partyRowIndex]?.amount) || 0) : 0;
  const onAccount = round2(Math.max(0, partyRowAmount - billsTotal));

  const computed = useMemo(() => {
    const receiptAmount = Number(receiptAmountFromRows);
    /*
     * "Amount received" is what the invoice was settled by, not what reached
     * the bank.
     *
     * A customer who owes 10,000 and withholds 1,000 of TDS has settled
     * 10,000 — the invoice is discharged in full even though 9,000 arrived.
     * So allocation is measured against this figure, and the cash is what is
     * left after the deductions.
     */
    const totalAmount = Number.isFinite(receiptAmount) ? Math.max(0, receiptAmount) : 0;
    const pos = (v) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    };
    const tds = pos(formData.tdsAmount);
    const bankCharges = pos(formData.bankCharges);
    const otherCharges = pos(formData.otherCharges);
    const deductions = round2(tds + bankCharges + otherCharges);
    const netCash = round2(totalAmount - deductions);

    let allocated = 0;
    const lines = [];

    for (const inv of outstandingInvoices) {
      const key = String(inv.id);
      const row = allocations[key];
      if (!row?.selected) continue;
      const want = Number(row?.amount ?? 0);
      const amt = Number.isFinite(want) ? Math.max(0, want) : 0;
      if (amt <= 0) continue;
      const balance = getInvoiceBalance(inv, creditNotes);
      const capped = Math.min(balance, amt);
      if (capped <= 0) continue;

      allocated = round2(allocated + capped);
      lines.push({
        invoiceId: Number(inv.id),
        invoiceNumber: inv.number,
        amount: round2(capped),
        /* What the invoice expected this customer to withhold — offered here,
           where it either happened or it did not. */
        tdsExpected: Number(inv.tdsExpectedAmount ?? inv.tdsAmount ?? 0),
      });
    }

    const advance = round2(Math.max(0, totalAmount - allocated));

    return {
      totalAmount: round2(totalAmount),
      allocated: round2(allocated),
      advance,
      lines,
      tds,
      bankCharges,
      otherCharges,
      deductions,
      netCash,
    };
  }, [
    allocations,
    creditNotes,
    receiptAmountFromRows,
    formData.tdsAmount,
    formData.bankCharges,
    formData.otherCharges,
    outstandingInvoices,
  ]);

  /*
   * TDS the customer actually deducted.
   *
   * §18, and the distinction the whole sell-side model turns on: the invoice
   * may have shown an expected figure, but nothing was an asset of ours until
   * the money arrived short. Here it did — so the difference is recognised
   * against the mapped TDS Receivable ledger, and the customer's outstanding
   * comes down by the whole invoice rather than by the cash alone.
   */
  const tdsLedgerMaster = useMemo(() => {
    const groups = (db?.accountGroups || []).filter((g) => Number(g?.companyId) === Number(currentCompany?.id));
    return (db?.chartOfAccounts || [])
      .filter((a) => Number(a?.companyId) === Number(currentCompany?.id))
      .map((a) => ({ ...a, tdsSide: String(a?.tdsSide || '').toUpperCase() || tdsGroupSide(groups, a.groupId) }))
      .filter((a) => a.tdsSide);
  }, [db?.chartOfAccounts, db?.accountGroups, currentCompany?.id]);

  const customerRecord = partyCustomer;

  const tdsNatureCode =
    String(customerRecord?.tdsNatureCode || '').trim() || natureForSection(customerRecord?.tdsSection)?.code || '';

  /* What the invoices being settled expected the customer to withhold — the
     figure to offer, rather than one this screen works out again. */
  const tdsExpectedOnAllocated = round2(
    computed.lines.reduce((t, l) => t + Number(l.tdsExpected || 0), 0)
  );

  const tdsReceivableLedgers = tdsNatureCode
    ? tdsLedgersFor(tdsLedgerMaster, { natureCode: tdsNatureCode, side: 'RECEIVABLE' })
    : [];

  /*
   * The receipt's own number, from the company's series.
   *
   * It used to be whatever the server minted, so the receipt was the one
   * document whose numbering nobody could see or change — the gear every other
   * form carries had nothing to govern. The series is read here and sent with
   * the receipt; the server honours a number it is given and only allocates
   * one when none arrives, so there is still exactly one series in play, and
   * a number the server does return still wins.
   */
  const receiptBranchId = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim();
  const receiptDocSettings = getDocSettings(db, currentCompany, { branchId: receiptBranchId || null });
  const receiptNumbering = receiptDocSettings?.numbering?.receipt;
  const isReceiptAuto = String(receiptNumbering?.mode || '').toLowerCase() === 'auto';
  const lockReceiptNumber = !initialData?.id && isReceiptAuto && !receiptNumbering?.allowManualOverride;
  const generatedReceiptNumber =
    nextFreeVoucherNumber({
      db,
      company: currentCompany,
      voucherKey: 'receipt',
      branchId: receiptBranchId || null,
      takenNumbers: safeArray(db.payments)
        .filter((p) => p.companyId === currentCompany?.id)
        .map((p) => String(p.number || '').trim()),
    }) || '';

  const [numberTouched, setNumberTouched] = useState(false);
  const autoNumbered = !initialData?.id && isReceiptAuto && !numberTouched;
  const receiptNumberValue = autoNumbered ? generatedReceiptNumber : formData.number;

  /*
   * The dialog that fills the party's allocation in.
   *
   * A receipt has one party, so there is one set of bills and one boolean. The
   * ticking and the figures live inside the dialog until Apply, which is what
   * lets Cancel mean cancel.
   */
  const [billsOpen, setBillsOpen] = useState(false);
  /* The dialog offers itself once per party row, not on every blur. */
  const [billsPrompted, setBillsPrompted] = useState(false);

  /* The bills as the dialog needs them. Assembled here because what is still
     owed on an invoice depends on credit notes, which the dialog has no
     business knowing about. */
  const billsForModal = useMemo(
    () =>
      outstandingInvoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        date: inv.date,
        total: Number(inv.total ?? inv.grandTotal ?? 0),
        tdsExpected: Number(inv.tdsExpectedAmount ?? inv.tdsAmount ?? 0),
        outstanding: getInvoiceBalance(inv, creditNotes),
      })),
    [outstandingInvoices, creditNotes]
  );

  /*
   * Section 269ST: two lakh or more in cash from one person in one day, or
   * against one transaction, attracts a penalty under 271DA equal to the whole
   * amount received. Nothing in the product checked it, and the person at the
   * counter has no way to know they are at the line.
   *
   * Counted per party per day, because that is the unit the section uses — two
   * receipts of one lakh from the same customer on the same day breach it just
   * as one of two lakh does.
   */
  const cashTakenTodayFromParty = useMemo(() => {
    if (String(receiptMode).toLowerCase() !== 'cash') return 0;
    const day = String(formData.date || '').slice(0, 10);
    const customerId = partyCustomerId;
    if (!day || customerId === '' || customerId == null) return 0;
    return (db?.payments || [])
      .filter(
        (p) =>
          p.companyId === currentCompany?.id &&
          p.voucherType === 'receipt' &&
          String(p.mode || '').toLowerCase() === 'cash' &&
          String(p.date || '').slice(0, 10) === day &&
          String(p.customerId) === String(customerId) &&
          String(p.id) !== String(initialData?.id ?? '')
      )
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [db?.payments, currentCompany?.id, receiptMode, formData.date, partyCustomerId, initialData?.id]);

  const cashWarning =
    String(receiptMode).toLowerCase() === 'cash'
      ? cashReceiptWarning({ amount: receiptAmountFromRows, alreadyToday: cashTakenTodayFromParty })
      : null;

  const handleSubmit = async (e) => {
    e.preventDefault();

    const amount = receiptAmountFromRows;
    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This receipt');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    const customerIdNum = Number(partyCustomerId);

    // Collected in one pass and shown at the fields. Allocation problems below
    // name a specific invoice, so they stay in the corner — there is no single
    // box to point them at.
    fieldErrors.reset();
    fieldErrors.check('amount', Number.isFinite(amount) && amount > 0, 'Enter an amount greater than zero');
    /* Not every receipt has a customer. A refund from a supplier, interest
       credited by the bank, an employee returning an advance — all money in,
       none of them on the customer master. */
    if (!hideMode) {
      fieldErrors.require('ledgerAccountId', ledgerAccountId, 'Choose where the money was received');
    }
    if (fieldErrors.failed()) return;

    // 269ST is not a warning the user can accept: the penalty is the full
    // amount, and there is no exception available at the counter.
    if (cashWarning?.severity === 'block') {
      fieldErrors.check('amount', false, `${cashWarning.section}: ${cashWarning.message}`);
      return;
    }

    /*
     * The entry has to balance before it is written — and since the receipt is
     * now worth exactly what its rows say, balancing is a matter of every row
     * having a ledger and a figure, not of two independent totals agreeing.
     *
     * `documentTotal` is nought on purpose. The invoices are a breakdown of
     * the party row's own figure rather than a second allocation beside it, so
     * counting them here would count them twice and refuse every receipt as
     * over-allocated by exactly the amount it settled.
     */
    {
      const problem = allocationError({
        rows: ledgerRows,
        documentTotal: 0,
        amount: receiptAmountFromRows,
        noun: 'receipt',
        hasParty: Number.isFinite(customerIdNum) && !!customerIdNum,
      });
      if (problem) {
        notify.error(problem);
        return;
      }
    }

    // Validate allocations are within invoice balances
    for (const line of computed.lines) {
      const inv = safeArray(db.invoices).find((i) => i.companyId === companyId && Number(i.id) === Number(line.invoiceId));
      if (!inv) {
        notify.error('One of the selected invoices was not found. Please refresh and try again.');
        return;
      }
      if (!canCollectAgainstInvoice(inv, creditNotes)) {
        notify.error(`Cannot record against invoice ${inv.number || ''} (Draft/Cancelled/No balance).`);
        return;
      }
      const balance = getInvoiceBalance(inv, creditNotes);
      if (Number(line.amount) > balance + 0.0001) {
        notify.error(`Allocation exceeds outstanding for invoice ${inv.number || ''}.`);
        return;
      }
    }

    if (computed.allocated > amount + 0.0001) {
      notify.error('Total allocated cannot be more than receipt amount');
      return;
    }

    // More deducted than received leaves a negative amount in the bank, which
    // is not a receipt — it is a typo.
    if (computed.deductions > amount + 0.0001) {
      notify.error('Deductions cannot be more than the amount received');
      return;
    }


    const customers = safeArray(db.customers).filter((c) => c.companyId === companyId);
    const customer = customers.find((c) => Number(c.id) === customerIdNum) || null;
    if (customer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before recording a receipt.');
      return;
    }
    const customerName = customer?.name || customer?.displayName || customer?.companyName || customer?.legalName || '';

    const paymentId = getNextNumericId(db.payments);

    // Post to the server first: it allocates the number and writes the
    // double-entry. Only invoices that exist on the server can be allocated
    // against there; anything created before the API migration is still sent,
    // just unallocated, so the cash is never lost from the books.
    let posted = null;
    if (String(ledgerAccountId || "").trim()) {
      const invoiceById = new Map(safeArray(db.invoices).map((i) => [Number(i.id), i]));
      const serverAllocations = computed.lines
        .map((l) => {
          const backendId = String(invoiceById.get(Number(l.invoiceId))?.backendInvoiceId || '').trim();
          return backendId ? { docType: 'INVOICE', docId: backendId, amount: round2(l.amount) } : null;
        })
        .filter(Boolean);

      setSaving(true);
      try {
        posted = await createPayment({
          direction: 'RECEIPT',
          /* The company's own series. The server allocates one only when it is
             given none, so the two can no longer disagree. */
          number: String(receiptNumberValue || '').trim() || undefined,
          date: formData.date,
          partyType: 'CUSTOMER',
          // Only a server party id is meaningful here. The local row carries
          // backendPartyId once it has been written through; customers that
          // predate that are sent by name alone, so the ledger line still reads
          // correctly.
          partyId: customer?.backendPartyId ? String(customer.backendPartyId) : null,
          partyName: customerName || null,
          ledgerAccountId: String(ledgerAccountId).trim(),
          instrumentRef: formData.reference || null,
          // The cash, not the settlement: the bank ledger must only ever see
          // what reached the bank. The deductions below are posted to their own
          // accounts and the customer is credited with the sum of both.
          amount: round2(computed.netCash),
          notes: formData.notes || null,
          allocations: serverAllocations,
          deductions: [
            computed.tds > 0 ? { kind: 'TDS', amount: round2(computed.tds) } : null,
            computed.bankCharges > 0 ? { kind: 'BANK_CHARGES', amount: round2(computed.bankCharges) } : null,
            computed.otherCharges > 0 ? { kind: 'OTHER', amount: round2(computed.otherCharges) } : null,
          ].filter(Boolean),
        });
      } catch (err) {
        setSaving(false);
        notify.error(String(err?.message || 'Unable to record the receipt.'));
        return;
      }
      setSaving(false);
    }

    // Prefer the server's series number over a browser-minted one, which two
    // tabs can duplicate.
    const receiptNo =
      String(posted?.number || '').trim() || String(receiptNumberValue || '').trim() || `RCPT-${paymentId}`;

    const receiptRecord = {
      id: paymentId,
      companyId,
      voucherType: 'receipt',
      voucherId: null,
      direction: 'IN',
      cashBankAccountId:
        initial.cashBankAccountId !== undefined && initial.cashBankAccountId !== null && String(initial.cashBankAccountId) !== ''
          ? Number(initial.cashBankAccountId)
          : undefined,
      sourceBankTransactionId:
        initial.sourceBankTransactionId !== undefined && initial.sourceBankTransactionId !== null && String(initial.sourceBankTransactionId) !== ''
          ? Number(initial.sourceBankTransactionId)
          : undefined,
      receiptNo,
      /* The same value under the name every other document uses, so the cash
         book, the register and the numbering series all read one field. */
      number: receiptNo,
      date: formData.date,
      customerId: customerIdNum,
      customerName,
      ledgerAllocations: usableRows(ledgerRows).map((r) => ({
        ledgerId: String(r.ledgerId),
        amount: round2(r.amount),
        description: String(r.description || '').trim() || undefined,
      })),
      amount: round2(amount),
      allocatedAmount: round2(computed.allocated),
      advanceAmount: round2(computed.advance),
      tdsAmount: round2(computed.tds),
      /* Recognised here, not at the invoice — §18. */
      tdsNatureCode: computed.tds > 0 ? tdsNatureCode || undefined : undefined,
      tdsLedgerId: computed.tds > 0 ? String(formData.tdsLedgerId || '') || undefined : undefined,
      bankCharges: round2(computed.bankCharges),
      otherCharges: round2(computed.otherCharges),
      netCashAmount: round2(computed.netCash),
      allocations: computed.lines.map((l) => ({
        voucherType: 'invoice',
        voucherId: l.invoiceId,
        documentNumber: l.invoiceNumber,
        amount: round2(l.amount),
      })),
      mode: receiptMode,
      // Links the local row to the posted server payment and the ledger the
      // money actually landed in.
      backendPaymentId: posted?.id ? String(posted.id) : undefined,
      ledgerAccountId: String(ledgerAccountId || "").trim() || undefined,
      reference: formData.reference,
      narration: String(formData.narration || '').trim() || undefined,
      notes: formData.notes,
      createdAt: new Date().toISOString(),
    };

    // Apply allocations to invoices
    const nextInvoices = safeArray(db.invoices).map((inv) => {
      if (inv.companyId !== companyId) return inv;

      const line = receiptRecord.allocations.find((a) => Number(a.voucherId) === Number(inv.id));
      if (!line) return inv;

      const total = Number(inv.total ?? 0);
      const alreadyPaid = Number(inv.paidAmount ?? 0);
      const nextPaid = round2(Math.min(total, alreadyPaid + Number(line.amount ?? 0)));

      const rawStatus = String(inv.status || '').trim();
      const nextStatus =
        rawStatus === 'Draft'
          ? 'Draft'
          : total > 0 && nextPaid >= total - 0.0001
            ? 'Paid'
            : nextPaid > 0
              ? 'Partial'
              : 'Unpaid';

      return {
        ...inv,
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
    });

    /*
     * The receivable side of the register.
     *
     * Written here and nowhere earlier: the invoice only ever expected this,
     * and an expectation that never arrives would otherwise sit in the books
     * as tax somebody else had paid on our behalf.
     */
    const tdsEvents = safeArray(db.tdsTransactions);
    const tdsEvent =
      computed.tds > 0 && tdsNatureCode
        ? {
            id: tdsEvents.reduce((m, t) => Math.max(m, Number(t?.id) || 0), 0) + 1,
            ...tdsEventFrom(
              {
                natureCode: tdsNatureCode,
                ruleVersionId: '',
                statutoryReference: '',
                sectionCode: '',
                baseAmount: round2(computed.allocated),
                rate: 0,
                tdsAmount: round2(computed.tds),
                ledgerId: String(formData.tdsLedgerId || ''),
                side: 'RECEIVABLE',
              },
              {
                company: currentCompany,
                party: customerRecord,
                source: { type: 'receipt', id: receiptRecord.id, number: receiptRecord.number },
                date: formData.date,
              }
            ),
          }
        : null;

    /*
     * The ledger side of a receipt that is not only invoices.
     *
     * Dr the bank once, Cr every allocated account — the mirror of the
     * payment, through the same engine. The invoice lines are posted by the
     * customer's own settlement, so only the ledger rows are written here.
     */
    let allocationJournal = {};
    const ledgerLines = usableRows(ledgerRows);
    if (ledgerLines.length && String(ledgerAccountId || '').trim()) {
      const accounts = safeArray(db.chartOfAccounts).filter((a) => Number(a.companyId) === Number(companyId));
      const nameOf = (id) => accounts.find((a) => String(a.id) === String(id))?.name || '';
      try {
        allocationJournal = await postJournalToLedger({
          chartRows: accounts,
          entry: {
            date: String(formData.date).slice(0, 10),
            narration: String(formData.narration || '').trim() || `Receipt ${receiptNo}`,
            lines: allocationJournalLines({
              rows: ledgerLines,
              direction: 'IN',
              bankLedgerId: String(ledgerAccountId).trim(),
              amount: ledgerLines.reduce((t, r) => t + round2(r.amount), 0),
              nameOf,
            }),
          },
        });
      } catch {
        /* The receipt stands locally; the entry retries with the rest of the
           book rather than the money going unrecorded. */
        allocationJournal = {};
      }
    }

    setDb({
      ...db,
      ...allocationJournal,
      tdsTransactions: tdsEvent ? [...tdsEvents, tdsEvent] : db.tdsTransactions,
      invoices: nextInvoices,
      payments: [...safeArray(db.payments), receiptRecord],
      /* The series moves past the number this receipt took, so the next one
         does not open on a number already in the book. */
      companies: bumpCompanyNextNumber({
        db,
        companyId: currentCompany.id,
        voucherKey: 'receipt',
        usedNumber: receiptNo,
        branchId: receiptBranchId || null,
      }),
    });

    onSaved?.(receiptRecord);

    notify.success(computed.advance > 0 ? 'Receipt recorded (with advance)!' : 'Receipt recorded!');
    onClose?.();
  };

  /*
   * The shared document contract. A receipt has no line grid, so this is the
   * part that matters on a settlement screen: Ctrl+S saves, Ctrl+Enter
   * commits, and Enter moves to the next field instead of posting the moment
   * the cursor is in the amount box.
   */
  /* How many invoices the operator has ticked, for the running bar. */
  const selectedInvoiceCount = useMemo(
    () => Object.values(allocations).filter((v) => Boolean(v?.selected)).length,
    [allocations]
  );

  const onFormKeyDown = useDocumentFormKeys({ formRef });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} noValidate className="ui-creation-form space-y-3">
      {/* The bar an invoice carries: the document's name on the left, every
          way out of it on the right, pinned so Record stays reachable from the
          bottom of a long list of outstanding invoices. */}
      <DocFormActions
        title={screenTitle}
        subtitle={screenTitle ? 'Record money received into your business' : ''}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel={saving ? 'Recording…' : 'Record Receipt'}
        disabled={saving}
        secondaryLabel="Cancel"
        onSecondary={onClose}
      />

      {/*
        Shown while the amount is being typed, not only when Record is pressed.
        A 269ST breach is a decision about how to take the money, and the person
        needs it before they have taken it.
      */}
      {cashWarning ? (
        <div
          role="alert"
          className="rounded-xl border p-3 text-sm"
          style={{
            borderColor: 'rgb(var(--neg))',
            backgroundColor: 'rgb(var(--neg-soft, var(--surface-sunken)))',
            color: 'rgb(var(--fg))',
          }}
        >
          <span className="ui-t-label block mb-0.5">Section {cashWarning.section}</span>
          {cashWarning.message}
        </div>
      ) : null}

      {/*
        The head of the document, on one three-column grid.

        It used to be two six-column halves with a rule down the middle —
        "who paid and where it landed" on the left, "the paperwork" on the
        right. That split earned its rule when the left half held a party and
        an amount. With both gone it was dividing three fields from two, and
        the fields either side of it no longer lined up with each other.
      */}
      <section>
        <div className="ui-sec-head">
          <span className="ui-sec-mark" aria-hidden="true"><Landmark size={16} /></span>
          <h3>Receipt Details</h3>
        </div>
        <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
          <div className="lg:col-span-7 space-y-4">
          {!hideMode ? (
            <div className="min-w-0">
            <label className="ui-label">
              Received into <span className="text-[rgb(var(--neg))]">*</span>
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
            <FieldError error={fieldErrors.error('ledgerAccountId')} id={fieldErrors.errorId('ledgerAccountId')} />

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="ui-label" htmlFor="rcpt-reference">Reference / UTR / Cheque No.</label>
              <input
                id="rcpt-reference"
                type="text"
                value={formData.reference}
                onChange={(e) => setFormData((p) => ({ ...p, reference: e.target.value }))}
                className="ui-input w-full"
                placeholder="Txn / UTR / Cheque no"
              />
            </div>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="rcpt-mode">Receipt Mode</label>
              <select
                id="rcpt-mode"
                value={receiptMode}
                onChange={(e) => {
                  setModeTouched(true);
                  setFormData((p) => ({ ...p, mode: e.target.value }));
                }}
                className="ui-select w-full"
              >
                {(RECEIPT_MODES.includes(receiptMode) ? RECEIPT_MODES : [receiptMode, ...RECEIPT_MODES]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          </div>

          <div
            className="lg:col-span-5 lg:ps-6"
            style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            <DocNumberField
              className="min-w-0"
              id="rcpt-number"
              label="Receipt No."
              value={receiptNumberValue}
              onChange={(e) => {
                setNumberTouched(true);
                setFormData((p) => ({ ...p, number: e.target.value }));
              }}
              disabled={lockReceiptNumber}
              voucherKey="receipt"
              title="Receipt numbering"
              sampleLabel="Next receipt will be"
              manualLabel="Typed on each receipt"
              branchId={receiptBranchId || null}
              settings={receiptNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />

            <div className="min-w-0">
              <label className="ui-label" htmlFor="rcpt-date">
                Receipt Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="rcpt-date"
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
      </section>

        <AllocationTable
          rows={ledgerRows}
          onChange={setLedgerRows}
          ledgerOptions={allocationLedgers}
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          amount={receiptAmountFromRows}
          documentTotal={0}
          documentLabel="Invoices settled"
          heading="Ledger allocation"
          noun="receipt"
          money={(v) => formatMoney(v, currentCompany)}
          rowMeta={(i) => {
            if (i !== partyRowIndex || !partyCustomer) return {};
            return {
              isParty: true,
              available: billsForModal.length,
              /* Money against a customer with nothing ticked is not an error:
                 it sits on their account until an invoice claims it. Saying so
                 on the row is the difference between a deliberate advance and
                 a step somebody forgot. */
              status:
                computed.lines.length > 0
                  ? onAccount > 0
                    ? `${computed.lines.length} invoice${computed.lines.length === 1 ? '' : 's'} · ${formatMoney(onAccount, currentCompany)} on account`
                    : `Against ${computed.lines.length} invoice${computed.lines.length === 1 ? '' : 's'}`
                  : partyRowAmount > 0
                    ? 'On account'
                    : '',
              onViewBills: () => setBillsOpen(true),
              /* Entering the amount is the cue to ask what it settles — the
                 operator has said who and how much, and the next question is
                 always which invoices. It asks once: reopening on every blur
                 would trap anybody trying to correct a typo. */
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
            partyName={customerRecord ? getCustomerDisplayName(customerRecord) : ''}
            noun="invoice"
            bills={billsForModal}
            value={allocations}
            available={partyRowAmount}
            money={(v) => formatMoney(v, currentCompany)}
            onClose={() => setBillsOpen(false)}
            onApply={(next, total) => {
              setAllocations(next);
              setBillsOpen(false);
              /*
               * Allocating before naming the figure fills the figure in.
               *
               * The intended order is ledger, amount, then the bills — but
               * somebody who opens the dialog first and ticks two invoices has
               * said what the receipt is worth just as plainly, and making
               * them type the sum of two numbers already on screen is work the
               * form can do. An amount already typed is left alone: the
               * remainder is their advance, not a mistake.
               */
              if (partyRowIndex >= 0 && !(Number(ledgerRows[partyRowIndex]?.amount) > 0) && total > 0) {
                setLedgerRows((rows) =>
                  rows.map((r, i) => (i === partyRowIndex ? { ...r, amount: String(total) } : r))
                );
              }
            }}
          />
        ) : null}

        {/*
          What the customer withheld on the way.

          It never reached the bank and it still settled the invoice, so it is
          stated here and posted as its own ledger line against the TDS
          receivable, with the customer credited for the whole amount.

          This used to be a tinted "Deductions" band holding three boxes. Bank
          and other charges became allocation rows, which left TDS alone in it
          — and with TDS switched off for a company, an empty orange rectangle
          with a heading and nothing under it.
        */}
        <section>
          <div className="ui-sec-head">
            <span className="ui-sec-mark" aria-hidden="true"><Percent size={16} /></span>
            <h3>TDS (optional)</h3>
          </div>
          {/*
            The section is always drawn, and says so when it cannot be used.
            It used to vanish entirely for a company with TDS switched off,
            which is defensible — until somebody looks for it, finds nothing,
            and has no way to tell a missing feature from a setting.
          */}
          <p className="ui-caption -mt-2 mb-3">
            {tdsEnabledHere
              ? 'If TDS is deducted from the receipt, select the TDS ledger and enter the amount.'
              : 'TDS is switched off for this company. Turn it on under Settings → Tax & Compliance to record what a customer withheld.'}
          </p>
          {/*
            Two fields, side by side, both always here.

            The ledger used to appear only once an amount had been typed, which
            made the section look like one field until you filled it in and
            hid the very thing that decides where the tax lands. They are one
            question asked in two parts.
          */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="ui-label" htmlFor="rcpt-tds-ledger">TDS Ledger</label>
              <select
                id="rcpt-tds-ledger"
                className="ui-select w-full"
                value={formData.tdsLedgerId || ''}
                onChange={(e) => setFormData((p) => ({ ...p, tdsLedgerId: e.target.value }))}
                disabled={!tdsEnabledHere}
              >
                <option value="">Select TDS ledger</option>
                {tdsReceivableLedgers.map((l) => (
                  <option key={l.id} value={String(l.id)}>{l.name}</option>
                ))}
              </select>
              {Number(formData.tdsAmount || 0) > 0 && !tdsReceivableLedgers.length ? (
                <p className="ui-caption mt-1">
                  No TDS Receivable ledger is mapped to this customer’s nature yet.
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <label className="ui-label" htmlFor="rcpt-tdsAmount">TDS Amount</label>
              <input
                id="rcpt-tdsAmount"
                type="number"
                min="0"
                step="0.01"
                value={formData.tdsAmount}
                onChange={(e) => setFormData((p) => ({ ...p, tdsAmount: e.target.value }))}
                className="ui-input ui-money w-full"
                placeholder="0.00"
                disabled={!tdsEnabledHere}
              />
              {tdsExpectedOnAllocated > 0 && Number(formData.tdsAmount || 0) <= 0 ? (
                <p className="ui-caption mt-1">
                  The invoices expected {formatMoney(tdsExpectedOnAllocated, currentCompany)}.{' '}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() =>
                      setFormData((p) => ({
                        ...p,
                        tdsAmount: String(tdsExpectedOnAllocated),
                        tdsLedgerId: String(p.tdsLedgerId || tdsReceivableLedgers[0]?.id || ''),
                      }))
                    }
                  >
                    Use it
                  </button>
                </p>
              ) : null}
            </div>
          </div>
          {computed.deductions > 0 ? (
            <p className="mt-2 text-xs ui-muted">
              {formatMoney(computed.deductions, currentCompany)} deducted ·{' '}
              {formatMoney(computed.netCash, currentCompany)} actually received into the account.
            </p>
          ) : null}
        </section>

        <div>
          <label className="ui-label" htmlFor="rcpt-narration">Narration / Description</label>
          <input
            id="rcpt-narration"
            type="text"
            value={formData.narration}
            onChange={(e) => setFormData((p) => ({ ...p, narration: e.target.value }))}
            className="ui-input w-full"
            placeholder="E.g. payment received, UTR, remarks etc."
          />
        </div>

      {/*
       * The receipt in one column, put back — see the note in
       * RecordDisbursementForm: commit 09525c9 removed both summaries and left
       * the tests asserting them. Three figures, because there are three: what
       * the allocation came to, what the customer withheld, and what the bank
       * will therefore show. It once listed eight, of which two named boxes
       * that no longer exist and three were the same number under different
       * words.
       */}
      <section className="ui-card p-4" aria-label="Receipt summary">
        <div className="ui-t-sec">Receipt summary</div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="ui-muted">Total allocation</dt>
            <dd className="ui-money">{formatMoney(computed.totalAmount, currentCompany)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="ui-muted">TDS deducted</dt>
            <dd className="ui-money">{formatMoney(computed.tds, currentCompany)}</dd>
          </div>
          {computed.advance > 0 ? (
            /* Only when there is one: money waiting on a party is worth saying,
               and a line reading nought on every other receipt is not. */
            <div className="flex items-center justify-between gap-3">
              <dt className="ui-muted">On account (unallocated)</dt>
              <dd className="ui-money">{formatMoney(computed.advance, currentCompany)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-3 ui-tile-brand">
          <span className="text-sm font-medium">Net into the account</span>
          <span className="ui-money-lg">{formatMoney(computed.netCash, currentCompany)}</span>
        </div>
      </section>

      <DocFormFootnote declaration="the receipt above is against the documents selected, and the details are correct." />

      {/* The figure that has to match the bank statement, kept on screen while
          invoices are ticked off. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Net into the account</span>
        <span className="ui-money-lg">{formatMoney(computed.netCash, currentCompany)}</span>
        <span className="ui-caption">{selectedInvoiceCount} invoice(s) allocated</span>
        <FieldErrorSummary errors={fieldErrors.errors} />
      </div>
    </form>
  );
};

export default RecordReceiptForm;

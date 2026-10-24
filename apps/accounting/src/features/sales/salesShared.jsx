/** Helpers the Accounting app's screens share, moved out of App.jsx (behaviour unchanged). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { canDetermineSupplyType, computeGstForLine, computeGstForLines, getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { selectedBranchId } from '@platform/context';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { branchLabel } from '@ui/utils/branchLabel';
import { returnableLines } from '@ui/utils/returns';
import { notify } from '@ui/components/ui/notify';
import { blockIfClosed } from '@ui/utils/bookClose';
import { createDocApi, hasApiSession as hasDocsApiSession } from '@ui/api/purchaseDocs';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { getNextNumericId } from '@ui/utils/ids';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { AmountInWordsBand, DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import WarehouseField from '@ui/components/WarehouseField';
import CustomerPicker from '../../components/pickers/CustomerPicker';
import DocNumberField from '@ui/components/DocNumberField';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import ItemPicker from '../../components/pickers/ItemPicker';
import { Plus, Trash2 } from 'lucide-react';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import Modal from '@ui/components/ui/Modal';
import InvoicePreview from './InvoicePreview';

/**
 * Why the note was raised.
 *
 * Not decoration: GSTR-1 reports credit notes in the CDNR table and the return
 * carries the reason, so a note without one is a note somebody has to classify
 * again at filing time. The codes are the ones the portal accepts.
 */
export const CREDIT_NOTE_REASONS = [
  { code: '01', label: 'Sales Return' },
  { code: '02', label: 'Post-sale discount' },
  { code: '03', label: 'Deficiency in service' },
  { code: '04', label: 'Correction in invoice' },
  { code: '05', label: 'Change in place of supply' },
  { code: '06', label: 'Finalisation of provisional assessment' },
  { code: '07', label: 'Others' },
];

export const CreditNoteForm = ({ db, setDb, currentCompany, initialOriginalInvoiceId, onClose, warehouses = [], branches = [], defaultWarehouseId = '', screenTitle = '', onBack = null }) => {
  const formRef = useRef(null);
  const companyInvoices = db.invoices.filter((i) => i.companyId === currentCompany.id);
  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };

  const initWarehouseId = String(defaultWarehouseId || '').trim();
  const initBranchId = resolveBranchIdFromWarehouseId(initWarehouseId) || '';
  const creditDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initBranchId || null });
  const creditNumberingInit = creditDocSettingsInit?.numbering?.creditNote;
  const isCreditAutoInit = String(creditNumberingInit?.mode || '').toLowerCase() === 'auto';

  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'creditNote'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const [formData, setFormData] = useState({
    number: isCreditAutoInit ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'creditNote', branchId: initBranchId || null, takenNumbers: (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || '' : '',
    date: new Date().toISOString().split('T')[0],
    originalInvoiceId: '',
    customerId: '',
    warehouseId: String(defaultWarehouseId || '').trim(),
    // The portal wants a reason on every credit note; Sales Return is the one
    // that fits most of them, so it is the default rather than a blank.
    reasonCode: '01',
    refNo: '',
    refDate: '',
    items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
  });

  /*
   * Branch, asked for rather than inferred, and clamped to one that exists —
   * the same treatment the invoice got, for the same reason: the seed can name
   * a branch this user has since lost access to, and a picker with no matching
   * option prints its own value, which is a cuid.
   */
  const [branchId, setBranchId] = useState(() => initBranchId || activeBranchId || '');
  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';
  const branchOptions = useMemo(
    () => (Array.isArray(branches) ? branches : []).slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b))),
    [branches]
  );

  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);

  /** The invoice this note reverses, and the date the portal will ask for. */
  const originalInvoice = useMemo(
    () => companyInvoices.find((i) => String(i.id) === String(formData.originalInvoiceId)) || null,
    // companyInvoices is rebuilt each render from the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData.originalInvoiceId, db.invoices]
  );

  const branchIdForNumbering = resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const creditDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const creditNumbering = creditDocSettings?.numbering?.creditNote;
  const isCreditAuto = String(creditNumbering?.mode || '').toLowerCase() === 'auto';
  const lockCreditNumber = isCreditAuto && !creditNumbering?.allowManualOverride;
  const generatedCreditNumber = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'creditNote', branchId: branchIdForNumbering, takenNumbers: (db.creditNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  const warehouseOptions = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return list.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses]);

  /**
   * Goods come back in a heap that no single invoice accounts for. Rather than
   * make a clerk guess which one, the note is raised on account: the value
   * waits on the customer's ledger until it is knocked off.
   */
  const [onAccountMode, setOnAccountMode] = useState(false);
  const invoicesForCustomer = useMemo(() => {
    const customerId = String(formData.customerId || '').trim();
    if (!customerId) return [];
    return companyInvoices
      .filter((i) => String(i.customerId ?? '') === customerId)
      .filter((i) => String(i.status || '').toLowerCase() !== 'cancelled')
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyInvoices.length, formData.customerId]);

  const toggleOnAccount = (next) => {
    setOnAccountMode(next);
    setFormData((prev) => ({
      ...prev,
      originalInvoiceId: next ? '' : prev.originalInvoiceId,
      invoiceIds: next ? prev.invoiceIds || [] : [],
    }));
  };

  const [originalInvoiceQuery, setOriginalInvoiceQuery] = useState('');

  const selectedCustomer = formData.customerId ? customers.find((c) => c.id === parseInt(formData.customerId)) : null;
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });
  const computed = computeGstForLines({ lines: formData.items, isIntra });

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    });
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    const newItems = [...formData.items];

    if (field === 'itemId') {
      const item = pickedItem || itemsMaster.find((i) => String(i.id) === String(value));
      if (item) {
        newItems[index] = {
          ...newItems[index],
          itemId: value,
          description: item.name,
          rate: item.salePrice,
          gstRate: Number(item.gstRate ?? 0),
          hsnSac: item.hsnSac || '',
        };
      }
    } else {
      newItems[index][field] = value;
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId' || field === 'discountPct') {
      /* A credit note reverses an invoice line, and an invoice line can carry
         a discount — without it the note returns more than was charged. */
      const computedLine = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        discountPct: Number(newItems[index].discountPct ?? 0),
        isIntra,
      });
      newItems[index].amount = computedLine.taxableAmount;
      newItems[index].taxableAmount = computedLine.taxableAmount;
      newItems[index].gstAmount = computedLine.gstAmount;
      newItems[index].cgstAmount = computedLine.cgstAmount;
      newItems[index].sgstAmount = computedLine.sgstAmount;
      newItems[index].igstAmount = computedLine.igstAmount;
      newItems[index].lineTotal = computedLine.lineTotal;
      newItems[index].taxType = computedLine.taxType;
    }

    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const onSelectOriginalInvoice = (invoiceIdValue) => {
    const invoiceId = parseInt(invoiceIdValue);
    const inv = companyInvoices.find((i) => i.id === invoiceId);

    if (!inv) {
      setFormData({
        ...formData,
        originalInvoiceId: '',
        customerId: '',
        warehouseId: String(defaultWarehouseId || '').trim(),
        items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
      });
      return;
    }

    // Only what has not come back already. A line returned in full is gone
    // from the list; a line half returned offers the other half.
    const state = returnableLines(inv, db.creditNotes || [], 'originalInvoiceId');

    if (state.fullyReturned) {
      notify.error(`${inv.number} has already been fully returned — there is nothing left to credit.`);
      return;
    }

    const copiedItems = state.open.map((line) => {
      const qty = Number(line.remainingQty) || 0;
      const rate = parseFloat(line.rate || 0) || 0;
      const gstRate = parseFloat(line.gstRate || 0);
      return {
        itemId: line.itemId || '',
        description: line.description || '',
        quantity: qty,
        maxQuantity: qty,
        rate,
        gstRate: Number.isFinite(gstRate) ? gstRate : 0,
        hsnSac: line.hsnSac || '',
        amount: qty * rate,
      };
    });

    if (state.partlyReturned) {
      notify.info(`${inv.number} was partly returned already — only the quantities still open are shown.`);
    }

    setFormData({
      ...formData,
      originalInvoiceId: invoiceIdValue,
      customerId: String(inv.customerId || ''),
      warehouseId: String(inv?.warehouseId || formData.warehouseId || defaultWarehouseId || '').trim(),
      items: copiedItems.length
        ? copiedItems
        : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    });

    setOriginalInvoiceQuery(String(inv.number || ''));
  };

  useEffect(() => {
    if (!initialOriginalInvoiceId) return;
    const nextId = String(initialOriginalInvoiceId);
    if (!nextId || nextId === String(formData.originalInvoiceId || '')) return;
    onSelectOriginalInvoice(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOriginalInvoiceId, companyInvoices.length]);

  const onOriginalInvoiceQueryChange = (nextQuery) => {
    const cleaned = String(nextQuery || '').trim();
    setOriginalInvoiceQuery(cleaned);

    const matched = companyInvoices.find(
      (inv) => String(inv.number || '').trim().toLowerCase() === cleaned.toLowerCase()
    );

    if (matched) {
      onSelectOriginalInvoice(String(matched.id));
      return;
    }

    if (String(formData.originalInvoiceId || '').trim()) {
      setFormData((prev) => ({ ...prev, originalInvoiceId: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This credit note');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    let creditNumber = String(formData.number || '').trim();
    if (isCreditAuto) {
      if (lockCreditNumber) creditNumber = String(generatedCreditNumber || '').trim();
      else if (!creditNumber) creditNumber = String(generatedCreditNumber || '').trim();
    }
    if (!creditNumber) {
      notify.error('Credit note number is required');
      return;
    }

    const creditNumberClash = db.creditNotes.some((cn) => cn.companyId === currentCompany.id && String(cn.number || '').trim() === creditNumber);
    if (creditNumberClash) {
      notify.error('Credit note number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    const originalInvoice = companyInvoices.find((i) => i.id === parseInt(formData.originalInvoiceId));
    if (!onAccountMode && !originalInvoice) {
      notify.error('Please select the original invoice');
      return;
    }
    if (onAccountMode && !(formData.invoiceIds || []).length) {
      notify.error('Tick the invoices this return covers.');
      return;
    }

    if (!String(formData.warehouseId || '').trim()) {
      notify.error('Warehouse is required');
      return;
    }

    if (!formData.customerId) {
      notify.error('Customer is required');
      return;
    }
    if (selectedCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a credit note.');
      return;
    }

    // The prefill can be typed over, so the rule is enforced here too: nothing
    // may come back that was not sold, or that has come back already.
    // On account there is no single invoice to check against; the knock-offs
    // are what keep that note honest instead.
    const returnState = onAccountMode
      ? { fullyReturned: false, lines: [] }
      : returnableLines(originalInvoice, db.creditNotes || [], 'originalInvoiceId');
    if (returnState.fullyReturned) {
      notify.error(`${originalInvoice.number} has already been fully returned.`);
      return;
    }
    const remainingByItem = new Map(returnState.lines.map((l) => [String(l.itemId), l.remainingQty]));
    for (const line of onAccountMode ? [] : formData.items || []) {
      const key = String(line.itemId || '');
      if (!key) continue;
      const want = Number(line.quantity) || 0;
      if (want <= 0) continue;
      const canReturn = remainingByItem.get(key);
      if (canReturn === undefined) {
        notify.error(`${line.description || `Item ${key}`} is not on ${originalInvoice.number}.`);
        return;
      }
      if (want > canReturn + 0.0001) {
        notify.error(
          canReturn <= 0
            ? `${line.description || `Item ${key}`} has already been returned in full.`
            : `Only ${canReturn} of ${line.description || `item ${key}`} is still open to return.`
        );
        return;
      }
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST credit notes.');
      return;
    }

    const customerIsRegistered = String(selectedCustomer?.gstRegistration || '').trim().toLowerCase() === 'registered';
    if (customerIsRegistered && !canDetermineSupplyType({ companyState, partyState: customerState })) {
      notify.error('Cannot determine Place of Supply for this registered customer. Please set customer state/address before creating GST credit notes.');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line. Items are mandatory for GST.');
      return;
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    // Server first: a credit note reverses booked revenue, so it must reach
    // the books. The local copy mirrors it for the UI.
    let backendDocId = null;
    let serverNumber = '';
    if (hasDocsApiSession()) {
      try {
        const saved = await createDocApi('creditNote', {
          number: creditNumber || undefined,
          warehouseId: String(formData.warehouseId || originalInvoice?.warehouseId || '').trim() || undefined,
          date: formData.date,
          againstDocId: originalInvoice?.backendInvoiceId ? String(originalInvoice.backendInvoiceId) : null,
          partyId: customer?.backendPartyId ? String(customer.backendPartyId) : null,
          partyName: getCustomerDisplayName(customer) || originalInvoice.customerName || '',
          partyGstin: customerGstin || null,
          placeOfSupplyState: customerState || null,
          taxType: isIntra ? 'CGST_SGST' : 'IGST',
          subtotal: computed.subtotal,
          cgstTotal: computed.cgstTotal,
          sgstTotal: computed.sgstTotal,
          igstTotal: computed.igstTotal,
          gstTotal: computed.gstTotal,
          total: computed.total,
          status: 'Open',
          items: computed.lines,
        });
        backendDocId = saved?.id || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Credit note not saved to the server.'));
        return;
      }
    }

    const newCreditNote = {
      id: getNextNumericId(db.creditNotes),
      companyId: currentCompany.id,
      backendDocId,
      number: serverNumber || creditNumber,
      date: formData.date,
      originalInvoiceId: onAccountMode ? null : originalInvoice.id,
      originalInvoiceNumber: onAccountMode ? '' : originalInvoice.number,
      // GSTR-1 reports a credit note against the original invoice's number and
      // date, and carries the reason it was raised. All three are captured on
      // the document so none has to be reconstructed at filing time.
      originalInvoiceDate: onAccountMode ? '' : String(originalInvoice.date || ''),
      reasonCode: String(formData.reasonCode || '').trim(),
      reasonLabel: CREDIT_NOTE_REASONS.find((r) => r.code === String(formData.reasonCode || '').trim())?.label || '',
      branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
      // On account: the value waits on the customer's ledger until knocked off.
      settlementMode: onAccountMode ? 'ON_ACCOUNT' : 'DOCUMENT',
      invoiceIds: onAccountMode ? (formData.invoiceIds || []).map(String) : [],
      allocations: [],
      customerId: formData.customerId,
      warehouseId: String(formData.warehouseId || '').trim(),
      customerName: getCustomerDisplayName(customer) || originalInvoice?.customerName || '',
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      customFields: { ...(formData.customFields || {}) },
      items: computed.lines,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      /**
       * Issued, not Draft.
       *
       * This was hardcoded to Draft, and the ledger — correctly — does not
       * post drafts. There is no action anywhere to take a credit note out of
       * draft and no status column to reveal it was in one, so every sales
       * return raised through this form was inert: the goods came back on the
       * stock report, the customer's account was never credited, the output
       * GST was never reversed, and the screen said "Credit note created
       * successfully!".
       *
       * An invoice raised from the equivalent button posts immediately. A
       * credit note is the same kind of act in the other direction, and the
       * form has one button whose meaning is "issue this".
       */
      status: 'Open',
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      creditNotes: [...db.creditNotes, newCreditNote],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'creditNote', usedNumber: creditNumber, branchId: branchIdForNumbering }),
    });
    onClose?.();
    notify.success('Credit note created successfully!');
  };

  // The shared document contract, so a credit note answers to the same keys
  // as the invoice it reverses.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.items.length,
    addLine: addItem,
    removeLine: removeItem,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} className="ui-creation-form space-y-3">
      <DocFormActions
        title={screenTitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel="Create Credit Note"
      />

      {/*
        The head of the document, in the invoice's two columns — a credit note
        reverses one, so it is read beside one. Left is who and where the goods
        came back to; right is the paperwork: the note's own number and date,
        why it was raised, and the invoice it answers to.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          <div>
            <label htmlFor="cn-branch" className="ui-label">Branch</label>
            <select
              id="cn-branch"
              className="ui-select w-full"
              value={branchIdInList || ''}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={String(b.id)} value={String(b.id)}>{branchLabel(b)}</option>
              ))}
            </select>
          </div>

          <WarehouseField
            value={formData.warehouseId}
            onChange={(warehouseId) => setFormData((p) => ({ ...p, warehouseId }))}
            options={warehouseOptions}
            activeWarehouseId={defaultWarehouseId}
            isEdit={false}
            className="ui-select"
          />

        <div>
          <CustomerPicker
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            value={formData.customerId}
            onChange={(customerId) => setFormData((prev) => ({ ...prev, customerId }))}
            disabled={Boolean(String(formData.originalInvoiceId || '').trim()) && Boolean(String(formData.customerId || '').trim())}
            disabledHint="Customer comes from the original invoice"
          />
        </div>
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DocNumberField
              className="min-w-0"
              id="cn-number"
              label={<>Credit Note No. <span className="text-[rgb(var(--neg-ink))]">*</span></>}
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: e.target.value })}
              disabled={lockCreditNumber}
              required
              voucherKey="creditNote"
      title="Sales return numbering"
              sampleLabel="Next note will be"
              manualLabel="Typed on each note"
              branchId={branchIdForNumbering}
              settings={creditNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />
            <div className="min-w-0">
              <label className="ui-label" htmlFor="cn-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="cn-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="cn-reason" className="ui-label">
              Reason <span className="text-[rgb(var(--neg-ink))]">*</span>
            </label>
            <select
              id="cn-reason"
              className="ui-select w-full"
              value={formData.reasonCode}
              onChange={(e) => setFormData({ ...formData, reasonCode: e.target.value })}
              required
            >
              {CREDIT_NOTE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="ui-label">
              {onAccountMode ? 'Invoices this return covers' : 'Original Invoice #'}
            </label>
            <button
              type="button"
              onClick={() => toggleOnAccount(!onAccountMode)}
              className="text-xs underline ui-muted hover:ui-fg"
            >
              {onAccountMode ? 'Against a single invoice instead' : 'Goods from several invoices?'}
            </button>
          </div>

          {onAccountMode ? (
            <div className="space-y-2">
              <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                {invoicesForCustomer.length === 0 ? (
                  <div className="text-xs ui-muted px-1">Pick the customer first — their invoices will be listed here.</div>
                ) : (
                  invoicesForCustomer.map((inv) => (
                    <label key={inv.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={(formData.invoiceIds || []).some((id) => String(id) === String(inv.id))}
                        onChange={(e) =>
                          setFormData((prev) => {
                            const set = new Set((prev.invoiceIds || []).map(String));
                            if (e.target.checked) set.add(String(inv.id));
                            else set.delete(String(inv.id));
                            return { ...prev, invoiceIds: [...set] };
                          })
                        }
                      />
                      <span className="truncate">
                        {inv.number} · {inv.date} · {formatMoney(Number(inv.total || 0), currentCompany)}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="text-xs ui-muted">
                The value goes to the customer&apos;s ledger as unsettled, and you knock it off against their invoices
                later — from the Sales Returns list.
              </div>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={originalInvoiceQuery}
                onChange={(e) => onOriginalInvoiceQueryChange(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text');
                  if (typeof pasted === 'string') onOriginalInvoiceQueryChange(pasted);
                }}
                onBlur={() => {
                  // Normalize any pasted value and try one more exact match on blur.
                  onOriginalInvoiceQueryChange(originalInvoiceQuery);
                }}
                list="creditnote-original-invoice-options"
                className="ui-input"
                placeholder="Search / paste invoice number"
                required
              />
              <datalist id="creditnote-original-invoice-options">
                {companyInvoices.map((inv) => (
                  <option key={inv.id} value={String(inv.number || '')} />
                ))}
              </datalist>
              <p className="mt-1 text-xs ui-muted">
                Enter the invoice number to fetch its details. Items, customer and tax are loaded from it.
              </p>
              {/*
                The date of the invoice being reversed, and a way back to it.
                GSTR-1 reports a credit note against the original invoice's
                number *and* date, so a note raised without the date in view is
                one somebody has to go and look up at filing time.
              */}
              {originalInvoice ? (
                <p className="mt-1 text-xs ui-muted flex items-center gap-2 flex-wrap">
                  <span>
                    Original invoice dated <span className="ui-mono">{originalInvoice.date || '—'}</span> ·{' '}
                    {formatMoney(Number(originalInvoice.total || 0), currentCompany)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOriginalPreviewOpen(true)}
                    style={{ color: 'rgb(var(--link))' }}
                    className="font-medium"
                  >
                    View invoice
                  </button>
                </p>
              ) : null}
            </>
          )}
        </div>
        </div>
      </div>

      <div>
        <div className="ui-sec-head">
          <h3>Line Items</h3>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                <th className="ui-th text-left w-[28%]">Item</th>
                <th className="ui-th text-left w-[20%]">Description</th>
                <th className="ui-th ui-num w-[7%]">
                  Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th text-left w-[6%]">Unit</th>
                <th className="ui-th ui-num w-[11%]">
                  Rate (₹) <span className="text-[rgb(var(--neg-ink))]">*</span>
                </th>
                <th className="ui-th ui-num w-[7%]">Disc %</th>
                <th className="ui-th ui-num w-[8%]">Tax %</th>
                <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => {
                const lineMaster = itemsMaster.find((i) => String(i.id) === String(item.itemId));
                return (
                <tr key={idx} className="border-t" data-line-row={idx}>
                  <td className="ui-col-meta px-3 py-2">
                    <ItemPicker
                      db={db}
                      setDb={setDb}
                      currentCompany={currentCompany}
                      value={item.itemId}
                      onChange={(itemId, picked) => updateItem(idx, 'itemId', itemId, picked)}
                      label={null}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-sm ui-muted">{String(lineMaster?.unit || '').trim() || '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.discountPct || ''}
                      onChange={(e) => updateItem(idx, 'discountPct', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="0"
                      aria-label={`Discount percent for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="ui-num block text-sm">{Number(item.gstRate ?? 0)}%</span>
                  </td>
                  <td className="ui-col-amount px-3 py-2">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => removeItem(idx)} className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]" aria-label={`Remove line ${idx + 1}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-soft">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
            </div>
            {isIntra ? (
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
            )}
            <div className="ui-total-row border-t pt-2">
              <span>Total:</span>
              <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
            </div>
          </div>
        </div>
      </div>

      {hasCustomFieldsAt(customFields, 'header', 'reference', 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="notes" />
        </div>
      ) : null}

      <AmountInWordsBand words={amountInWordsInr(computed.total)} />

      <DocFormFootnote />

      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
        </span>
      </div>

      {/* The invoice being reversed, read-only, over the note. Checking what
          was billed should not mean leaving a half-typed credit note. */}
      {originalPreviewOpen && originalInvoice ? (
        <Modal
          onClose={() => setOriginalPreviewOpen(false)}
          title={`Invoice ${originalInvoice.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
        >
          <div className="overflow-x-auto">
            <InvoicePreview db={db} currentCompany={currentCompany} invoice={originalInvoice} />
          </div>
        </Modal>
      ) : null}
    </form>
  );
};

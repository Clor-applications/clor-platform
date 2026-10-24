/** Helpers the Accounting app's screens share, moved out of App.jsx (behaviour unchanged). */
import React, { useEffect, useRef, useState } from 'react';
import { computeGstForLine, computeGstForLines, getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { selectedBranchId } from '@platform/context';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { getLastSelection, setLastSelection } from '@ui/utils/lastSelection';
import { branchLabel } from '@ui/utils/branchLabel';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { returnableLines } from '@ui/utils/returns';
import { blockIfClosed } from '@ui/utils/bookClose';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { createDocApi, hasApiSession } from '@ui/api/purchaseDocs';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { amountInWordsInr, formatMoney, round2 } from '@ui/utils/money';
import { returnQuarter } from '../tds/engine';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { AmountInWordsBand, DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import { Building2, Package, Plus, SlidersHorizontal, Trash2, Truck } from 'lucide-react';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import WarehouseField from '@ui/components/WarehouseField';
import VendorPicker from '../../components/pickers/VendorPicker';
import DocNumberingPopover from '@ui/components/DocNumberingPopover';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import ItemPicker from '../../components/pickers/ItemPicker';

export const DebitNoteForm = ({
  db,
  setDb,
  currentCompany,
  initialOriginalBillId,
  onClose,
  warehouses = [],
  defaultWarehouseId = '',
  branches = [],
  initialData = null,
  onOpenReturnSettings = null,
  screenTitle = '',
  onBack = null,
}) => {
  const formRef = useRef(null);
  const companyBills = db.bills.filter((b) => b.companyId === currentCompany.id);
  const vendors = db.vendors.filter((v) => v.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };

  const initWarehouseId = String(initialData?.warehouseId || defaultWarehouseId || '').trim();
  const initBranchId = resolveBranchIdFromWarehouseId(initWarehouseId) || '';
  const debitDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initBranchId || null });
  const debitNumberingInit = debitDocSettingsInit?.numbering?.debitNote;
  const isDebitAutoInit = String(debitNumberingInit?.mode || '').toLowerCase() === 'auto';
  const generatedDebitNumberInit = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'debitNote', branchId: initBranchId || null, takenNumbers: (db.debitNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  /*
   * The branch this return belongs to — asked, as the bill and the sales
   * return both ask.
   *
   * Goods go back out of a particular godown, under a particular branch, and
   * the note is numbered on that branch's series. Reading the branch out of
   * whichever warehouse happened to be selected gave a company with one
   * warehouse serving two branches no way to say which one the return was for.
   */
  const [branchId, setBranchId] = useState(
    () => initBranchId || getLastSelection('branch', currentCompany?.id) || activeBranchId || ''
  );

  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';

  const branchOptions = React.useMemo(() => {
    const list = Array.isArray(branches) ? branches : [];
    return list.slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
  }, [branches]);

  /* Only the warehouses of the chosen branch — goods returning from another
     branch's shelf is the mis-post this ordering exists to stop. */
  const warehouseOptions = React.useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    const scope = String(branchIdInList || '').trim();
    const inScope = scope ? list.filter((w) => String(w?.branchId || '').trim() === scope) : list;
    return inScope.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses, branchIdInList]);

  const onBranchChange = (nextBranchId) => {
    const next = String(nextBranchId || '').trim();
    setBranchId(next);
    setLastSelection('branch', currentCompany?.id, next);
    setFormData((p) => {
      const held = String(p.warehouseId || '').trim();
      if (!held || !next) return p;
      const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === held);
      if (w && String(w.branchId || '').trim() === next) return p;
      return { ...p, warehouseId: '' };
    });
  };

  const numberingBtnRef = useRef(null);
  const [numberingOpen, setNumberingOpen] = useState(false);

  /* Everything the panel does not cover is a screen of its own — and this note
     is not thrown away silently to reach it. */
  const goToReturnSettings = async (screen = 'docNumbering') => {
    if (typeof onOpenReturnSettings !== 'function') {
      notify.error('Open Settings to change this.');
      return;
    }
    const typing =
      String(formData.vendorId || '') ||
      (formData.items || []).some((l) => l.itemId || Number(l.quantity) > 1 || Number(l.rate) > 0);
    if (typing && !initialData?.id) {
      const ok = await confirmDialog({
        title: 'Leave this return?',
        message: 'That setting lives on a separate screen. Anything typed here is not saved yet and will be lost.',
        confirmLabel: 'Leave and open settings',
      });
      if (!ok) return;
    }
    onOpenReturnSettings(screen);
  };

  const customFields = React.useMemo(() => getVisibleCustomFields(currentCompany, 'debitNote'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const [formData, setFormData] = useState(() => {
    const today = new Date().toISOString().split('T')[0];

    const base = {
      number: isDebitAutoInit ? generatedDebitNumberInit || '' : '',
      date: today,
      originalBillId: '',
      vendorId: '',
      warehouseId: String(defaultWarehouseId || '').trim(),
      customFields: {},
      items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', unit: '', discountPct: 0, amount: 0 }],
    };

    if (!initialData) return base;

    const copiedItems = Array.isArray(initialData.items)
      ? initialData.items.map((line) => {
          const qty = Number(line.quantity ?? 1);
          const rate = Number(line.rate ?? 0);
          const itemId = line.itemId !== undefined && line.itemId !== null ? String(line.itemId) : '';
          const master = itemId ? itemsMaster.find((i) => String(i.id) === String(itemId)) : null;
          const gstRate = Number(master?.gstRate ?? line.gstRate ?? 0);
          const hsnSac = master?.hsnSac || line.hsnSac || '';
          return {
            itemId,
            description: master?.name || line.description || '',
            quantity: Number.isFinite(qty) ? qty : 1,
            rate: Number.isFinite(rate) ? rate : 0,
            gstRate: Number.isFinite(gstRate) ? gstRate : 0,
            hsnSac,
            amount: (Number.isFinite(qty) ? qty : 1) * (Number.isFinite(rate) ? rate : 0),
          };
        })
      : base.items;

    return {
      ...base,
      number: String(initialData?.number || base.number || '').trim(),
      date: initialData?.date || base.date,
      originalBillId:
        initialData?.originalBillId !== undefined && initialData?.originalBillId !== null && initialData?.originalBillId !== ''
          ? String(initialData.originalBillId)
          : '',
      vendorId:
        initialData?.vendorId !== undefined && initialData?.vendorId !== null && initialData?.vendorId !== ''
          ? String(initialData.vendorId)
          : '',
      warehouseId: String(initialData?.warehouseId || base.warehouseId || '').trim(),
      items: copiedItems.length ? copiedItems : base.items,
    };
  });

  /**
   * A return that spans several bills cannot honestly name one of them, so it
   * is raised on account: the value sits against the vendor until someone
   * knocks it off. That is a different document, so switching modes clears the
   * single-bill link rather than leaving a half-set one behind.
   */
  const [onAccountMode, setOnAccountMode] = useState(false);
  const billsForVendor = React.useMemo(() => {
    const vendorId = String(formData.vendorId || '').trim();
    if (!vendorId) return [];
    return companyBills
      .filter((b) => String(b.vendorId ?? '') === vendorId)
      .filter((b) => String(b.status || '').toLowerCase() !== 'cancelled')
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [companyBills, formData.vendorId]);

  const toggleOnAccount = (next) => {
    setOnAccountMode(next);
    setFormData((prev) => ({
      ...prev,
      originalBillId: next ? '' : prev.originalBillId,
      billIds: next ? prev.billIds || [] : [],
    }));
  };

  const branchIdForNumbering =
    String(branchIdInList || '').trim() || resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const debitDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const debitNumbering = debitDocSettings?.numbering?.debitNote;
  const isDebitAuto = String(debitNumbering?.mode || '').toLowerCase() === 'auto';
  const lockDebitNumber = isDebitAuto && !debitNumbering?.allowManualOverride;
  const generatedDebitNumber = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'debitNote', branchId: branchIdForNumbering, takenNumbers: (db.debitNotes || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  /* The number follows the series, as it does on the bill: change the prefix
     from the gear on this field and the return in front of you is renumbered,
     rather than showing the old number until it saves under a new one. */
  const [numberTouched, setNumberTouched] = useState(false);
  const autoNumbered = !initialData?.id && isDebitAuto && !numberTouched;
  const debitNumberValue = autoNumbered ? String(generatedDebitNumber || '') : formData.number;

  const vendor = formData.vendorId ? vendors.find((v) => v.id === parseInt(formData.vendorId)) : null;
  const { state: vendorState, gstin: vendorGstin } = getPartyGstProfile(vendor);
  const isIntra = isIntraStateSupply({ companyState, partyState: vendorState });
  const computed = computeGstForLines({ lines: formData.items, isIntra });

  const onSelectOriginalBill = (billIdValue) => {
    const billId = parseInt(billIdValue);
    const bill = companyBills.find((b) => b.id === billId);

    if (!bill) {
      setFormData((prev) => ({
        ...prev,
        originalBillId: '',
        vendorId: '',
        warehouseId: String(defaultWarehouseId || '').trim(),
        items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
      }));
      return;
    }

    // Only what has not gone back already — the mirror of the credit note rule.
    const state = returnableLines(bill, db.debitNotes || [], 'originalBillId');

    if (state.fullyReturned) {
      notify.error(`${bill.number} has already been fully returned — there is nothing left to debit.`);
      return;
    }

    const copiedItems = state.open.map((line) => {
      const qty = Number(line.remainingQty) || 0;
      const rate = Number(line.rate ?? 0);
      const itemId = line.itemId !== undefined && line.itemId !== null ? String(line.itemId) : '';
      const master = itemId ? itemsMaster.find((i) => String(i.id) === String(itemId)) : null;
      const gstRate = Number(master?.gstRate ?? line.gstRate ?? 0);
      const hsnSac = master?.hsnSac || line.hsnSac || '';
      return {
        itemId,
        description: master?.name || line.description || '',
        quantity: qty,
        maxQuantity: qty,
        rate: Number.isFinite(rate) ? rate : 0,
        gstRate: Number.isFinite(gstRate) ? gstRate : 0,
        hsnSac,
        amount: qty * (Number.isFinite(rate) ? rate : 0),
      };
    });

    if (state.partlyReturned) {
      notify.info(`${bill.number} was partly returned already — only the quantities still open are shown.`);
    }

    setFormData((prev) => ({
      ...prev,
      originalBillId: billIdValue,
      vendorId: bill.vendorId ? String(bill.vendorId) : '',
      warehouseId: String(bill?.warehouseId || prev.warehouseId || defaultWarehouseId || '').trim(),
      items:
        copiedItems.length
          ? copiedItems
          : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    }));
  };

  useEffect(() => {
    if (!initialOriginalBillId) return;
    const nextId = String(initialOriginalBillId);
    if (!nextId || nextId === String(formData.originalBillId || '')) return;
    onSelectOriginalBill(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOriginalBillId, companyBills.length]);

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    }));
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    const nextItems = [...formData.items];

    if (field === 'itemId') {
      const item = pickedItem || itemsMaster.find((i) => String(i.id) === String(value));
      if (item) {
        nextItems[index] = {
          ...nextItems[index],
          itemId: value,
          description: item.name,
          rate: item.purchasePrice,
          gstRate: Number(item.gstRate ?? 0),
          hsnSac: item.hsnSac || '',
        };
      }
    } else {
      nextItems[index] = {
        ...nextItems[index],
        [field]: value,
      };
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId') {
      const computedLine = computeGstForLine({
        quantity: Number(nextItems[index].quantity ?? 1),
        rate: Number(nextItems[index].rate ?? 0),
        gstRate: Number(nextItems[index].gstRate ?? 0),
        isIntra,
      });

      nextItems[index] = {
        ...nextItems[index],
        amount: computedLine.taxableAmount,
        taxableAmount: computedLine.taxableAmount,
        gstAmount: computedLine.gstAmount,
        cgstAmount: computedLine.cgstAmount,
        sgstAmount: computedLine.sgstAmount,
        igstAmount: computedLine.igstAmount,
        lineTotal: computedLine.lineTotal,
        taxType: computedLine.taxType,
      };
    }

    setFormData((prev) => ({ ...prev, items: nextItems }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    /* What the field is showing — the series as it stands now for an
       untouched automatic number. */
    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This purchase return');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    let debitNumber = String(debitNumberValue || '').trim();
    if (isDebitAuto) {
      if (lockDebitNumber) debitNumber = String(generatedDebitNumber || '').trim();
      else if (!debitNumber) debitNumber = String(generatedDebitNumber || '').trim();
    }
    if (!debitNumber) {
      notify.error('Debit note number is required');
      return;
    }

    if (!String(formData.warehouseId || '').trim()) {
      notify.error('Warehouse is required');
      return;
    }

    const debitNumberClash = db.debitNotes.some((dn) => dn.companyId === currentCompany.id && String(dn.number || '').trim() === debitNumber);
    if (debitNumberClash) {
      notify.error('Debit note number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    const originalBill = companyBills.find((b) => b.id === parseInt(formData.originalBillId));
    if (!onAccountMode && !originalBill) {
      notify.error('Please select the original bill');
      return;
    }
    if (onAccountMode && !(formData.billIds || []).length) {
      notify.error('Tick the bills this return covers.');
      return;
    }

    const originalWarehouseId = String(onAccountMode ? '' : originalBill?.warehouseId || '').trim();
    const selectedWarehouseId = String(formData.warehouseId || '').trim();
    if (!onAccountMode && originalWarehouseId && selectedWarehouseId && originalWarehouseId !== selectedWarehouseId) {
      notify.error('Debit note warehouse must match the original bill warehouse.');
      return;
    }

    if (!formData.vendorId) {
      notify.error('Vendor is required');
      return;
    }

    // Enforced at save as well as in the prefill, since lines can be typed over.
    // A note raised on account answers no single bill, so there is nothing to
    // check it against — its own knock-offs are what keep it honest.
    const returnState = onAccountMode
      ? { fullyReturned: false, lines: [] }
      : returnableLines(originalBill, db.debitNotes || [], 'originalBillId');
    if (returnState.fullyReturned) {
      notify.error(`${originalBill.number} has already been fully returned.`);
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
        notify.error(`${line.description || `Item ${key}`} is not on ${originalBill.number}.`);
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
      notify.error('Please set Company State in Company Profile before creating GST debit notes.');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line. Items are mandatory for GST.');
      return;
    }

    // Block negative stock for Goods (Services do not affect inventory)
    {
      const inventoryByItemId = computeInventorySummaryByItemId({
        db,
        companyId: currentCompany.id,
        warehouseId: String(formData.warehouseId || '').trim(),
      });
      const itemsById = new Map(itemsMaster.map((it) => [String(it.id), it]));

      const requiredOut = new Map();
      (Array.isArray(formData.items) ? formData.items : []).forEach((l) => {
        const itemId = l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '';
        if (!itemId) return;
        const master = itemsById.get(itemId);
        if (!master || !isStockItem(master)) return;
        const qty = Number(l?.quantity ?? 0);
        const q = Number.isFinite(qty) ? Math.max(0, qty) : 0;
        if (q <= 0) return;
        requiredOut.set(itemId, (requiredOut.get(itemId) || 0) + q);
      });

      for (const [itemId, needQty] of requiredOut.entries()) {
        const closingQty = Number(inventoryByItemId.get(String(itemId))?.closingQty ?? 0);
        const available = Number.isFinite(closingQty) ? closingQty : 0;
        if (needQty > available + 0.0001) {
          const master = itemsById.get(String(itemId));
          const label = master?.name || master?.code || `Item ${itemId}`;
          notify.error(`Negative stock not allowed. "${label}" available ${available}, required ${needQty}.`);
          return;
        }
      }
    }

    const vendorObj = vendors.find((v) => v.id === parseInt(formData.vendorId));

    // Server first: a debit note reverses a booked liability, so it must
    // reach the books. The local copy mirrors it for the UI.
    let backendDocId = null;
    let serverNumber = '';
    if (hasApiSession()) {
      try {
        const saved = await createDocApi('debitNote', {
          number: debitNumber || undefined,
          warehouseId: String(formData.warehouseId || originalBill?.warehouseId || '').trim() || undefined,
          date: formData.date,
          againstDocId: originalBill?.backendDocId ? String(originalBill.backendDocId) : null,
          partyId: vendorObj?.backendPartyId ? String(vendorObj.backendPartyId) : null,
          partyName: getVendorDisplayName(vendorObj) || originalBill?.vendorName || '',
          partyGstin: vendorGstin || null,
          placeOfSupplyState: vendorState || null,
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
        notify.error(String(err?.message || 'Debit note not saved to the server.'));
        return;
      }
    }

    const newDebitNote = {
      id: db.debitNotes.length + 1,
      companyId: currentCompany.id,
      backendDocId,
      number: serverNumber || debitNumber,
      date: formData.date,
      warehouseId: String(formData.warehouseId || '').trim(),
      originalBillId: onAccountMode ? null : originalBill.id,
      originalBillNumber: onAccountMode ? '' : originalBill.number,
      // On account: the value waits on the vendor's ledger until it is knocked
      // off against their bills.
      settlementMode: onAccountMode ? 'ON_ACCOUNT' : 'DOCUMENT',
      billIds: onAccountMode ? (formData.billIds || []).map(String) : [],
      allocations: [],
      vendorId: formData.vendorId,
      vendorName: getVendorDisplayName(vendorObj) || originalBill?.vendorName || '',
      vendorGstin: vendorGstin,
      placeOfSupplyState: vendorState,
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
       * Open, matching what was just sent to the server.
       *
       * The write-through a few lines up posts this same note with
       * status: 'Open', while the local record was stamped Draft. The two
       * copies of one document therefore disagreed from the moment it was
       * created — and since every report is computed from the local book,
       * which skips drafts, a purchase return reversed nothing: the vendor
       * was still owed the full amount and the input GST was never given
       * back, with no action anywhere to take the note out of draft.
       */
      status: 'Open',
      createdAt: new Date().toISOString(),
    };

    /*
     * §20 — TDS on a purchase return is EVALUATED, never blindly reversed.
     *
     * Only a note against ONE bill that actually deducted adjusts anything:
     * a below-threshold bill wrote no event and there is nothing to give
     * back; an on-account note names no single obligation, so the operator
     * corrects by journal where it matters. The adjustment applies the
     * ORIGINAL EVENT's snapshotted rate to the returned taxable value —
     * preserving the rule the deduction was made under — and is capped at
     * what remains of the original deduction after earlier returns. It is a
     * live negative event linked by correctionOfId: the register, the
     * challan queue and the return all net it against the original.
     */
    const tdsRows = Array.isArray(db.tdsTransactions) ? db.tdsTransactions : [];
    let tdsAdjustment = null;
    if (!onAccountMode && originalBill) {
      const originalEvent = tdsRows.find(
        (ev) =>
          Number(ev?.companyId) === Number(currentCompany.id) &&
          String(ev?.sourceType) === 'bill' &&
          String(ev?.sourceId) === String(originalBill.id) &&
          String(ev?.status).toLowerCase() === 'posted' &&
          !ev?.reversalOfId
      );
      if (originalEvent) {
        const priorGivenBack = tdsRows
          .filter((ev) => Number(ev?.correctionOfId) === Number(originalEvent.id))
          .reduce((t, ev) => t + Math.abs(Number(ev?.tdsAmount || 0)), 0);
        const remaining = round2(Math.max(0, Number(originalEvent.tdsAmount || 0) - priorGivenBack));
        const evaluated = round2((Number(computed.subtotal || 0) * Number(originalEvent.rate || 0)) / 100);
        const giveBack = round2(Math.min(remaining, evaluated));
        if (giveBack > 0.005) {
          tdsAdjustment = {
            ...originalEvent,
            id: tdsRows.reduce((m, ev) => Math.max(m, Number(ev?.id) || 0), 0) + 1,
            sourceType: 'debitNote',
            sourceId: newDebitNote.id,
            sourceNumber: newDebitNote.number,
            transactionDate: String(formData.date || '').slice(0, 10),
            deductionDate: String(formData.date || '').slice(0, 10),
            baseAmount: -round2(Number(computed.subtotal || 0)),
            tdsAmount: -giveBack,
            returnQuarter: returnQuarter(formData.date),
            status: 'Posted',
            correctionOfId: originalEvent.id,
            /* §26: every correction says why, in the record itself. */
            reversalReason: `Purchase return ${newDebitNote.number || newDebitNote.id} against ${originalBill.number || originalBill.id}`,
            createdBy: (() => {
              try {
                return String(localStorage.getItem('userEmail') || '').trim() || 'User';
              } catch {
                return 'User';
              }
            })(),
            reversalOfId: null,
            createdAt: new Date().toISOString(),
            modifiedBy: null,
            modifiedAt: null,
          };
        }
      }
    }

    setDb({
      ...db,
      tdsTransactions: tdsAdjustment ? [...tdsRows, tdsAdjustment] : db.tdsTransactions,
      debitNotes: [...db.debitNotes, newDebitNote],
      companies: bumpCompanyNextNumber({
        db,
        companyId: currentCompany.id,
        voucherKey: 'debitNote',
        usedNumber: debitNumber,
        branchId: branchIdForNumbering,
      }),
    });

    onClose?.();
    notify.success('Debit note created successfully!');
  };

  // The shared document contract, so a debit note answers to the same keys as
  // the bill it corrects.
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
        primaryLabel={initialData?.id ? 'Update Debit Note' : 'Create Debit Note'}
        /* The bill's menu, for the document that reverses one: read this
           return under the first heading, configure every return under the
           second. */
        menu={[
          {
            key: 'numbering',
            group: 'Configure — every return',
            label: 'Return numbering',
            icon: SlidersHorizontal,
            onSelect: () => setNumberingOpen(true),
          },
          {
            key: 'customFields',
            group: 'Configure — every return',
            label: 'Custom fields',
            icon: Plus,
            onSelect: () => goToReturnSettings('settingsCustomFields'),
          },
        ]}
      />

      {/*
        The head of the document, in the bill's two columns: where the goods go
        back from and who they go back to on the left, the paperwork that
        identifies the return on the right, ruled off between them.
      */}
      <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          {/* Where first, then who — the bill's own order, on the document
              that reverses a bill. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div id="return-branch-field">
          <PopupSelect
            label="Branch"
      title="branches"
            value={String(branchIdInList || '')}
            onChange={onBranchChange}
            icon={Building2}
            options={[
              { value: '', label: 'All branches' },
              ...branchOptions.map((b) => ({ value: String(b.id), label: branchLabel(b) })),
            ]}
            placeholder="Select Branch"
            showValueSubtext={false}
          />
        </div>

            <WarehouseField
          value={formData.warehouseId}
          onChange={(warehouseId) => {
            setLastSelection('warehouse', currentCompany?.id, warehouseId);
            setFormData((p) => ({ ...p, warehouseId }));
          }}
          options={warehouseOptions}
          activeWarehouseId={defaultWarehouseId}
          isEdit={Boolean(initialData)}
          icon={Package}
          showSourceHint={false}
          className="ui-select w-full ui-surface"
        />
          </div>

          <div>
          <VendorPicker
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            value={formData.vendorId}
            icon={Truck}
            onChange={(vendorId) => setFormData((prev) => ({ ...prev, vendorId }))}
            disabled={Boolean(String(formData.originalBillId || '').trim()) && Boolean(String(formData.vendorId || '').trim())}
            disabledHint="Vendor comes from the original bill"
          />
        </div>

          <div>
          <div className="flex items-center justify-between mb-1">
            <label className="ui-label">
              {onAccountMode ? 'Bills this return covers' : 'Original Bill # *'}
            </label>
            <button
              type="button"
              onClick={() => toggleOnAccount(!onAccountMode)}
              className="text-xs underline ui-muted hover:ui-fg"
            >
              {onAccountMode ? 'Against a single bill instead' : 'Goods from several bills?'}
            </button>
          </div>

          {onAccountMode ? (
            <div className="space-y-2">
              <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                {billsForVendor.length === 0 ? (
                  <div className="text-xs ui-muted px-1">
                    Pick the vendor first — their bills will be listed here.
                  </div>
                ) : (
                  billsForVendor.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={(formData.billIds || []).some((id) => String(id) === String(b.id))}
                        onChange={(e) =>
                          setFormData((prev) => {
                            const set = new Set((prev.billIds || []).map(String));
                            if (e.target.checked) set.add(String(b.id));
                            else set.delete(String(b.id));
                            return { ...prev, billIds: [...set] };
                          })
                        }
                      />
                      <span className="truncate">
                        {b.number} · {b.date} · {formatMoney(Number(b.total || 0), currentCompany)}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="text-xs ui-muted">
                The value goes to the vendor&apos;s ledger as unsettled, and you knock it off against their bills
                later — from the Purchase Returns list.
              </div>
            </div>
          ) : (
            <select value={formData.originalBillId} onChange={(e) => onSelectOriginalBill(e.target.value)} className="ui-select w-full" required>
              <option value="">Select Bill</option>
              {companyBills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number}
                </option>
              ))}
            </select>
          )}
        </div>
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
          <label className="ui-label" htmlFor="return-number">Debit Note Number</label>
          <div className="relative">
            <input
              id="return-number"
              type="text"
              value={debitNumberValue}
              onChange={(e) => {
                setNumberTouched(true);
                setFormData((p) => ({ ...p, number: e.target.value }));
              }}
              className={`ui-input ui-mono w-full pe-9 ${lockDebitNumber ? 'ui-sunken' : ''}`}
              disabled={lockDebitNumber}
              required
            />
            <button
              type="button"
              ref={numberingBtnRef}
              onClick={() => setNumberingOpen((v) => !v)}
              className="absolute end-1 top-1/2 -translate-y-1/2 ui-icon-btn !h-7 !w-7"
              aria-label="Return numbering settings"
              aria-haspopup="dialog"
              aria-expanded={numberingOpen}
      title="Numbering"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
          {numberingOpen ? (
            <DocNumberingPopover
              anchorRef={numberingBtnRef}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
              voucherKey="debitNote"
      title="Return numbering"
              sampleLabel="Next return will be"
              manualLabel="Typed on each return"
              branchId={branchIdForNumbering}
              settings={debitNumbering}
              onClose={() => setNumberingOpen(false)}
              onOpenFullSettings={() => {
                setNumberingOpen(false);
                goToReturnSettings();
              }}
            />
          ) : null}
        </div>

            <div>
          <label className="ui-label" htmlFor="index-debit-note-date">Debit Note Date</label>
          <input id="index-debit-note-date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
            className="ui-input w-full"
            required
          />
        </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
            <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2">
          <label className="ui-label">Line Items</label>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                <th className="ui-th text-left w-[26%]">Item</th>
                <th className="ui-th text-left w-[22%]">Description</th>
                <th className="ui-th ui-num w-[8%]">Qty</th>
                <th className="ui-th text-left w-[7%]">Unit</th>
                <th className="ui-th ui-num w-[12%]">Rate (₹)</th>
                <th className="ui-th ui-num w-[8%]">Disc %</th>
                <th className="ui-th ui-num w-[8%]">Tax %</th>
                <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => (
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
                    <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1 text-right" min="1" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" value={item.unit || ''} onChange={(e) => updateItem(idx, 'unit', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1" />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1 text-right"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.discountPct ?? 0}
                      onChange={(e) => updateItem(idx, 'discountPct', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1 text-right"
                      min="0"
                      max="100"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.gstRate ?? 0}
                      onChange={(e) => updateItem(idx, 'gstRate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1 text-right"
                      min="0"
                      step="0.01"
                    />
                  </td>
                  <td className="ui-col-amount px-3 py-2 text-right">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={formData.items.length === 1}
                      aria-label={`Remove line ${idx + 1}`}
                      className="ui-btn ui-btn-ghost ui-btn-sm disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-secondary">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
        </div>

        {/* The totals in the bill's place: right-aligned under the lines that
            produced them. */}
        <div className="mt-4 flex justify-end">
          <div className="w-80 space-y-2">
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

      <div>
        <label className="ui-label" htmlFor="return-notes">Notes</label>
        <textarea
          id="return-notes"
          value={formData.notes || ''}
          onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value.slice(0, 500) }))}
          rows={3}
          maxLength={500}
          className="ui-input w-full"
          placeholder="Enter remarks, return reason, or any additional information…"
        />
        <div className="ui-caption mt-1 text-end">{String(formData.notes || '').length}/500</div>
      </div>

      {hasCustomFieldsAt(customFields, 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
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
    </form>
  );
};

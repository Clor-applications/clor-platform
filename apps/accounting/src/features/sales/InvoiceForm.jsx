import React, { useMemo, useRef, useState } from 'react';
import { getInvoicePrefs, getVisibleCustomFields, isInvoicePrefOn } from '@ui/utils/invoicePrefs';
import { invoiceChangeBlockReason } from './invoiceChangeGuard';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { orgId as platformOrgId, selectedBranchId } from '@platform/context';
import { createInvoiceApi, updateInvoiceApi, updateInvoiceStatusApi } from '@ui/api/invoices';
import { plusDaysIso, todayIso } from '@ui/utils/dates';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import { useFeatures } from '@ui/permissions/useFeatures';
import useEnabledCurrencies from '../../hooks/useEnabledCurrencies';
import { getLastSelection, setLastSelection } from '@ui/utils/lastSelection';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { branchLabel } from '@ui/utils/branchLabel';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';
import { canDetermineSupplyType, computeGstForLine, computeGstForLines, getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { useServerOnHand } from '@ui/hooks/useServerOnHand';
import { resolveSaleRate } from '@ui/utils/pricing';
import { batchesForItem, fefoPick, isTracked } from '@ui/utils/batches';
import { resolveDiscountForLine } from '@ui/utils/discounts';
import { fyRange } from '@ui/utils/tdsTcs';
import { resolveTds } from '../tds/engine';
import { natureForSection, resolveRule, ruleRate } from '../tds/ruleMaster';
import { usePostingLock } from './usePostingLock';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { blockIfClosed } from '@ui/utils/bookClose';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import { getNextNumericId } from '@ui/utils/ids';
import { getEInvoiceSettingsApi, registerEInvoiceApi } from '../../api/einvoice';
import { buildEInvoicePayload } from '@ui/utils/einvoice';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { AmountInWordsBand, DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import { Ban, Building2, Copy, Eye, Lock, Package, Plus, Settings2, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import Drawer from '@ui/components/ui/Drawer';
import InvoiceFieldSettings from '../settings/InvoiceFieldSettings';
import InvoicePreview from './InvoicePreview';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import WarehouseField from '@ui/components/WarehouseField';
import { FieldError, FieldErrorSummary } from '@ui/components/ui/Primitives';
import CustomerPicker from '../../components/pickers/CustomerPicker';
import { dueDateFor, termsLabel } from '@ui/utils/paymentTerms';
import DocNumberingPopover from '@ui/components/DocNumberingPopover';
import ItemPicker from '../../components/pickers/ItemPicker';
import { DEDUCTEE_TYPES, TDS_SECTIONS, tdsVariesByDeductee } from '@ui/utils/tds';
import Modal from '@ui/components/ui/Modal';

/**
 * Invoice numbering, over the invoice.
 *
 * Changing a series is a different act from raising a document, and the full
 * numbering screen governs nine document types across every branch. Somebody
 * halfway through an invoice wants one of them: this one. So the series in
 * force here is editable here, and the rest of the screen stays one click away.
 *
 * Writes the same shape the numbering screen writes — branch-scoped when a
 * branch is in play, company-wide otherwise — so the two can never disagree
 * about what the next invoice is called.
 */
export const InvoiceForm = ({ db, setDb, currentCompany, initialData = null, onClose, warehouses = [], defaultWarehouseId = '', branches = [], onOpenInvoiceSettings = null, onDuplicateInvoice = null, screenTitle = '', screenSubtitle = '', onBack = null }) => {
  const isEdit = Boolean(initialData && (initialData.id !== undefined && initialData.id !== null));

  /**
   * Which fields this company's invoice carries — see utils/invoicePrefs.
   *
   * A preference that is off removes the field rather than disabling it. The
   * one exception, applied at the two money fields below, is a value this
   * invoice already carries: hiding a discount that still moves the total
   * would be worse than showing a field the company switched off.
   */
  const invoicePrefs = useMemo(() => getInvoicePrefs(currentCompany), [currentCompany]);
  const prefOn = (key) => isInvoicePrefOn(invoicePrefs, key);
  const customFields = useMemo(() => getVisibleCustomFields(currentCompany), [currentCompany]);

  const [previewOpen, setPreviewOpen] = useState(false);
  /* Which half of the settings drawer a menu entry asked for. */
  const [prefsPane, setPrefsPane] = useState('fields');

  /**
   * Save & New keeps the form open with a fresh invoice instead of closing it.
   *
   * A ref rather than state: the submit handler that reads it runs in the same
   * tick as the click that set it, and a state update would not have landed
   * yet. Reset after every save so an ordinary Save the next time does not
   * inherit it.
   */
  const saveAndNewRef = useRef(false);
  const markSaveAndNew = () => {
    saveAndNewRef.current = true;
  };

  /*
   * Named rather than inline: a ref read inside a prop passed to a component
   * looks like a render-phase read to the hooks lint, because it cannot tell
   * an event handler from any other callback prop.
   */
  const submitAsDraftNow = () => {
    setSubmitAsDraft(true);
    formRef.current?.requestSubmit();
  };

  /**
   * The saved invoice this form is editing, at component scope.
   *
   * The submit handler has its own local `existingInvoice`; the menu needs the
   * same record outside that function to know whether Duplicate and Cancel
   * apply at all.
   */
  const existingInvoiceRecord = isEdit
    ? (db.invoices || []).find((i) => i.id === Number(initialData.id)) || null
    : null;

  /**
   * Three of the four entries in this menu configure every invoice, not this
   * one, so they leave the form rather than opening something inside it. The
   * parent decides how — the form has no business knowing about navigation.
   */
  /**
   * Cancelling is not deleting.
   *
   * A GST invoice number cannot be reused, so cancelling keeps the number and
   * the row and marks it cancelled; deleting would leave a hole in the series
   * that an officer will ask about. Anything already settled against it has to
   * come off first — a cancelled invoice with a receipt attached leaves money
   * allocated to a document that no longer exists.
   */
  const cancelInvoice = async () => {
    const blocked = invoiceChangeBlockReason(db, currentCompany, existingInvoiceRecord, 'cancel');
    if (blocked) {
      notify.error(blocked);
      return;
    }
    const ok = await confirmDialog({
      title: `Cancel invoice ${existingInvoiceRecord?.number || ''}?`.trim(),
      message:
        'The invoice keeps its number and stays in the list, marked cancelled, and its ledger entries are reversed. ' +
        'That is deliberate: a GST number cannot be reused, so the series must not gain a hole.',
      confirmLabel: 'Cancel invoice',
    });
    if (!ok) return;
    /* The server reverses the sale and its GST. This used to change only the
       browser's copy, so the invoice read Cancelled here while the books on
       the server still carried the sale. */
    const backendInvoiceId = String(existingInvoiceRecord?.backendInvoiceId || '').trim();
    const hasSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
    if (hasSession && backendInvoiceId) {
      try {
        await updateInvoiceStatusApi(backendInvoiceId, { status: 'Cancelled' });
      } catch (e) {
        notify.error(String(e?.message || 'Unable to cancel the invoice.'));
        return;
      }
    }
    setDb((prev) => ({
      ...prev,
      invoices: (prev.invoices || []).map((inv) =>
        inv.id === existingInvoiceRecord.id ? { ...inv, status: 'Cancelled', cancelledAt: todayIso() } : inv
      ),
    }));
    notify.success(`Invoice ${existingInvoiceRecord?.number || ''} cancelled. The number stays used.`.trim());
    onClose?.();
  };

  const [prefsOpen, setPrefsOpen] = useState(false);

  /**
   * Preferences opens inside the form rather than navigating to Settings.
   *
   * Navigating meant closing the form, which threw away whatever had been
   * typed — and there was no way back. Somebody switching a field on is in the
   * middle of raising an invoice; that invoice has to survive the detour.
   */
  /*
   * Two menu entries, two panels — not one panel scrolled to a heading.
   *
   * "Custom Field" used to open the whole invoice settings drawer and scroll
   * it down to the custom-field section, so the thing somebody asked for
   * arrived surrounded by forty switches they did not. Each entry now opens
   * what it is named after.
   */
  const openPreferences = (pane = 'fields') => {
    setPreviewOpen(false);
    setPrefsPane(pane === 'custom' ? 'custom' : 'fields');
    setPrefsOpen(true);
  };

  /**
   * Settings screens are screens of their own, so this one does leave — but
   * only after saying so, and never silently on a form with typing in it.
   */
  const goToSettings = async (screen) => {
    if (typeof onOpenInvoiceSettings !== 'function') {
      notify.error('Open Settings to change this.');
      return;
    }
    const typing =
      String(formData.customerId || '') ||
      (formData.items || []).some((l) => l.itemId || Number(l.quantity) > 1 || Number(l.rate) > 0);
    if (typing && !isEdit) {
      const ok = await confirmDialog({
        title: 'Leave this invoice?',
        message: 'That setting lives on a separate screen. Anything typed here is not saved yet and will be lost.',
        confirmLabel: 'Leave and open settings',
      });
      if (!ok) return;
    }
    onOpenInvoiceSettings(screen);
  };

  /**
   * Whether anything has actually been typed into this document.
   *
   * Deliberately narrow: a form that opens with today's date and a generated
   * number is not "dirty", and warning about that would train people to click
   * through the warning that matters.
   */
  const hasUnsavedInput = () =>
    Boolean(
      String(formData.customerId || '').trim() ||
        String(formData.refNo || '').trim() ||
        String(formData.notesText || '').trim() ||
        (formData.items || []).some((l) => l.itemId || Number(l.quantity) > 1 || Number(l.rate) > 0)
    );

  /** Back, but not over the top of work. */
  const requestBack = async () => {
    if (typeof onBack !== 'function') return;
    if (hasUnsavedInput()) {
      const ok = await confirmDialog({
        title: isEdit ? 'Leave without saving?' : 'Discard this invoice?',
        message: 'Nothing here has been saved yet. Leaving now loses it.',
        confirmLabel: isEdit ? 'Leave without saving' : 'Discard it',
      });
      if (!ok) return;
    }
    onBack();
  };


  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  /** One company-defined field. `where` matches the placement it was given. */
  const renderCustomFields = (where) => (
    <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where={where} />
  );

  /**
   * Whether this invoice is still a draft — a new one, or one saved as a draft
   * and reopened. Only a draft can be saved as a draft or finalised; anything
   * already on the customer's account is simply updated.
   */
  const isDraftInvoice = !isEdit || String(initialData?.status || '').trim() === 'Draft';
  const formRef = useRef(null);
  const [submitAsDraft, setSubmitAsDraft] = useState(false);
  const { isEnabled } = useFeatures();
  const multiCurrencyEnabled = isEnabled('multiCurrency');
  const { options: enabledCurrencyOptions, baseCurrency: invoiceBaseCurrency } = useEnabledCurrencies(currentCompany);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };

  // The document's own warehouse, then the one used last, then whatever the
  // header has selected. Editing an existing invoice never picks up a
  // remembered value — that would move stock nobody asked to move.
  const initWarehouseId = String(
    initialData?.warehouseId || getLastSelection('warehouse', currentCompany?.id) || defaultWarehouseId || ''
  ).trim();
  const initBranchId = resolveBranchIdFromWarehouseId(initWarehouseId) || '';
  const invoiceDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initBranchId || null });
  const invoiceNumberingInit = invoiceDocSettingsInit?.numbering?.invoice;
  const isInvoiceAutoInit = String(invoiceNumberingInit?.mode || '').toLowerCase() === 'auto';

  const [formData, setFormData] = useState(() => {
    const defaultDate = todayIso();
    const defaultDueDate = plusDaysIso(30);

    const normalizedItems = Array.isArray(initialData?.items)
      ? initialData.items.map((it) => {
          const quantity = Number(it.quantity ?? 1);
          const rate = Number(it.rate ?? 0);
          const gstRate = Number(it.gstRate ?? 0);
          const amount = Number(it.amount ?? quantity * rate);
          return {
            itemId: it.itemId !== undefined && it.itemId !== null && it.itemId !== '' ? String(it.itemId) : '',
            description: it.description ?? '',
            quantity: Number.isFinite(quantity) ? quantity : 1,
            rate: Number.isFinite(rate) ? rate : 0,
            gstRate: Number.isFinite(gstRate) ? gstRate : 0,
            hsnSac: it.hsnSac || '',
            discountPct: Number(it.discountPct) || 0,
            amount: Number.isFinite(amount) ? amount : 0,
          };
        })
      : null;

    const rawStatus = String(initialData?.status || '').trim();
    const isDraft = rawStatus === 'Draft';

    const initialNumber = initialData?.number
      ? String(initialData.number)
      : isInvoiceAutoInit
        ? String(nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'invoice', branchId: initBranchId || null, takenNumbers: (db.invoices || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || '')
        : '';

    return {
      number: initialNumber,
      date: initialData?.date || defaultDate,
      dueDate: initialData?.dueDate || defaultDueDate,
      status: isDraft ? 'Draft' : 'Unpaid',
      refNo: initialData?.refNo || '',
      refDate: initialData?.refDate || '',
      customerId: initialData?.customerId || '',
      warehouseId: String(initialData?.warehouseId || defaultWarehouseId || '').trim(),
      items:
        normalizedItems && normalizedItems.length
          ? normalizedItems
          : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
      sourceEstimateId: initialData?.sourceEstimateId ?? null,
      sourceChallanId: initialData?.sourceChallanId ?? null,
      sourceSalesOrderId: initialData?.sourceSalesOrderId ?? null,
      invoiceDiscountEnabled: Number(initialData?.invoiceDiscountValue) > 0,
      invoiceDiscountType: initialData?.invoiceDiscountType || 'pct',
      invoiceDiscountValue: Number(initialData?.invoiceDiscountValue) || '',
      otherCharges: Array.isArray(initialData?.otherCharges) ? initialData.otherCharges : [],
      salesmanId: initialData?.salesmanId ?? '',
      costCenterId: initialData?.costCenterId ?? '',
      reverseCharge: !!initialData?.reverseCharge,
      shipToCode: initialData?.shipToCode || '',
      shipToAddress: initialData?.shipToAddress || null,
      shipToAddressId: initialData?.shipToAddressId || '',
      // Values for the fields this company invented. Keyed, not positional, so
      // reordering or renaming a field in settings never rewrites what an
      // existing invoice already says.
      customFields:
        initialData?.customFields && typeof initialData.customFields === 'object' ? { ...initialData.customFields } : {},
      // Fields the preferences can switch on. Each is inert until its
      // preference is on: nothing here changes a total, so an invoice that
      // carries a value for a field the company later switches off simply
      // stops printing it rather than changing what is owed.
      lutNumber: initialData?.lutNumber || '',
      iecNumber: initialData?.iecNumber || '',
      shippingBillNo: initialData?.shippingBillNo || '',
      shippingBillDate: initialData?.shippingBillDate || '',
      portCode: initialData?.portCode || '',
      invoiceCurrency: initialData?.invoiceCurrency || '',
      exchangeRate: initialData?.exchangeRate || '',
      transporterName: initialData?.transporterName || '',
      vehicleNo: initialData?.vehicleNo || '',
      lrNumber: initialData?.lrNumber || '',
      lrDate: initialData?.lrDate || '',
      packageDetails: initialData?.packageDetails || '',
      servicePeriodFrom: initialData?.servicePeriodFrom || '',
      servicePeriodTo: initialData?.servicePeriodTo || '',
      projectName: initialData?.projectName || '',
      workOrderNo: initialData?.workOrderNo || '',
      raBillNo: initialData?.raBillNo || '',
      timesheetRef: initialData?.timesheetRef || '',
      paymentTermDays: initialData?.paymentTermDays ?? '',
      notesText: initialData?.notesText || '',
      // TDS the customer will withhold. Stated on the document so both sides
      // agree the figure before the payment arrives short.
      tdsSection: initialData?.tdsSection || '',
      tdsDeducteeType: initialData?.tdsDeducteeType || 'COMPANY',
      tdsRate: initialData?.tdsRate ?? '',
    };
  });

  /*
   * Branch is asked for rather than inferred.
   *
   * It was previously read back out of whichever warehouse you picked, which
   * works right up to the moment a company runs one warehouse for two branches
   * — and it left the field that decides the number series invisible. Seeded
   * from the document being edited, then from the header selection.
   */
  /*
   * Seeded from the document being edited, then from what was chosen last
   * time, then from the header selection. A shop that raises forty invoices
   * out of one warehouse should be asked once, not forty times.
   */
  const [branchId, setBranchId] = useState(
    () => initBranchId || getLastSelection('branch', currentCompany?.id) || activeBranchId || ''
  );

  /*
   * A remembered branch that no longer exists shows as nothing, not as an id.
   *
   * The seed can come from three places — the document, what was chosen last
   * time, the header — and any of them can name a branch this user has since
   * lost access to, or that was deleted. The field then rendered the raw cuid,
   * because a picker with no matching option falls back to its own value. An
   * empty field reading "All branches" is the honest answer.
   */
  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';

  const numberingBtnRef = useRef(null);
  const [numberingOpen, setNumberingOpen] = useState(false);
  /* Open while a TDS section is being chosen; folded away once one is. */
  const [tdsPickerOpen, setTdsPickerOpen] = useState(false);
  /* §2: the compact TDS control is offered only where the company tracks
     TDS at all — with it off, nothing is asked and nothing is calculated. */
  const tdsEnabledHere = Boolean(currentCompany?.profile?.taxCompliances?.tds?.enabled);

  /*
   * Which line, if any, is waiting on a batch.
   *
   * Batch and expiry used to live in a permanent sub-row under every tracked
   * line, which put a second row of chrome under half the grid and still had
   * to be hunted for. It is a question with one answer per line, so it is
   * asked once, when the item is chosen, and then gets out of the way.
   */
  const [batchPrompt, setBatchPrompt] = useState(null);

  const branchOptions = useMemo(() => {
    const list = Array.isArray(branches) ? branches : [];
    return list.slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
  }, [branches]);

  const branchIdForNumbering = String(branchIdInList || '').trim() || resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const invoiceDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const invoiceNumbering = invoiceDocSettings?.numbering?.invoice;
  const isInvoiceAuto = String(invoiceNumbering?.mode || '').toLowerCase() === 'auto';
  const lockInvoiceNumberOnCreate = !isEdit && isInvoiceAuto && !invoiceNumbering?.allowManualOverride;
  const generatedInvoiceNumber = !isEdit ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'invoice', branchId: branchIdForNumbering, takenNumbers: (db.invoices || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) : '';

  /*
   * Only the warehouses of the chosen branch. Stock leaving a shelf that
   * belongs to another branch is the mis-post this ordering exists to stop.
   * With no branch chosen the list is everything, as before.
   */
  const warehouseOptions = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    const scope = String(branchIdInList || '').trim();
    const inScope = scope ? list.filter((w) => String(w?.branchId || '').trim() === scope) : list;
    return inScope.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [warehouses, branchIdInList]);

  const onBranchChange = (nextBranchId) => {
    const next = String(nextBranchId || '').trim();
    setBranchId(next);
    setLastSelection('branch', currentCompany?.id, next);
    // A warehouse left over from the previous branch would silently move the
    // wrong stock, so it is dropped rather than carried across.
    setFormData((p) => {
      const held = String(p.warehouseId || '').trim();
      if (!held || !next) return p;
      const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === held);
      if (w && String(w.branchId || '').trim() === next) return p;
      return { ...p, warehouseId: '' };
    });
  };

  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);

  // The customer on this invoice, and what they already owe. Read here so the
  // summary bar can show it while the invoice is still being written.
  const customer = useMemo(
    () => customers.find((c) => String(c.id) === String(formData?.customerId)) || null,
    [customers, formData?.customerId]
  );
  const fieldErrors = useFieldErrors('invoice');

  const customerOutstanding = useMemo(() => {
    if (!customer) return 0;
    return (db.invoices || [])
      .filter((inv) => inv.companyId === currentCompany.id)
      .filter((inv) => String(inv.customerId) === String(customer.id))
      .filter((inv) => String(inv.status || '').toLowerCase() !== 'cancelled')
      .reduce((t, inv) => t + Math.max(0, Number(inv.total || 0) - Number(inv.paidAmount || 0)), 0);
  }, [customer, db.invoices, currentCompany.id]);

  const items = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const selectedCustomer = formData.customerId
    ? customers.find((c) => String(c.id) === String(formData.customerId))
    : null;
  const shipToOptions = useMemo(() => {
    if (!selectedCustomer) return [];
    const options = [];
    const add = (value, label, address, id = '') => {
      if (!address || ![address.line1, address.line2, address.city, address.district, address.state, address.pincode].some((part) => String(part || '').trim())) return;
      options.push({ value, label, address, id: String(id || value) });
    };
    add('SHIPPING', 'Shipping address', selectedCustomer.shippingAddress, selectedCustomer.shippingAddress?.id || 'SHIPPING');
    (Array.isArray(selectedCustomer.shipToAddresses) ? selectedCustomer.shipToAddresses : []).forEach((address, index) => {
      const id = address.id || address.code || `SHIP-${index + 1}`;
      add(String(id), address.label || address.code || `Ship-to ${index + 2}`, address, id);
    });
    return options;
  }, [selectedCustomer]);
  const addressSummary = (address) =>
    [address?.line1, address?.line2, address?.city, address?.district, address?.state, address?.pincode, address?.country]
      .filter((part) => String(part || '').trim())
      .join(', ');
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });

  // Index of a row that was just added, so focus can land in it. Entry is
  // keyboard-driven: adding a line and then reaching for the mouse defeats it.
  const [focusRowIndex, setFocusRowIndex] = useState(-1);

  const addItem = () => {
    // The focus index is set outside the updater. Setting state from inside
    // one runs during React's render phase, where the second invocation under
    // StrictMode makes it a side effect React is entitled to drop.
    setFocusRowIndex(formData.items.length);
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
    }));
  };

  /**
   * What is actually on the shelf, per item, for the warehouse this invoice
   * ships from.
   *
   * The save already refuses to oversell, but only once everything is typed
   * and the button is pressed. Showing the number the moment an item is
   * chosen turns that late refusal into something you can see coming — and a
   * line that already exceeds stock says so where the line is, not in a toast
   * after the fact.
   */
  const availableByItemId = useMemo(() => {
    const whId = String(formData.warehouseId || '').trim();
    try {
      const summary = computeInventorySummaryByItemId({ db, companyId: currentCompany.id, warehouseId: whId });
      const map = new Map();
      for (const [itemId, row] of summary.entries()) map.set(String(itemId), Number(row?.closingQty ?? 0));
      return map;
    } catch {
      return new Map();
    }
    // db is the whole book; the lines that matter are its stock documents.
  }, [db, currentCompany.id, formData.warehouseId]);

  /*
   * The server's count, where it has one: it sees the sale made at the next
   * counter a minute ago, which this browser's documents do not. An item the
   * server does not know (saved on this device only) keeps the local count.
   */
  const serverOnHand = useServerOnHand(
    useMemo(() => (formData.items || []).map((l) => l?.itemId), [formData.items]),
    formData.warehouseId
  );
  const availableFor = (itemId) => {
    const key = String(itemId);
    const master = items.find((i) => String(i.id) === key);
    if (serverOnHand && master?.backendItemId) return serverOnHand.get(key) ?? 0;
    return availableByItemId.get(key) ?? 0;
  };

  /*
   * Which cells the operator has typed into by hand, per line.
   *
   * Choosing an item fills the description, rate, tax and HSN from the master
   * — right the first time, wrong the second, because re-picking the item on
   * a line whose rate was negotiated wipes the negotiated rate. Kept in a ref
   * rather than on the line so it can never be written into the saved
   * document, and reset for a line whenever its item changes, since that is a
   * new line in everything but position.
   */
  const touchedCellsRef = useRef({});

  const markTouched = (index, field) => {
    const map = touchedCellsRef.current;
    map[index] = map[index] || new Set();
    map[index].add(field);
  };

  const isTouched = (index, field) => Boolean(touchedCellsRef.current[index]?.has(field));

  /** Keep the record lined up with the rows after an insert or a delete. */
  const shiftTouched = (from, delta) => {
    const next = {};
    for (const [k, v] of Object.entries(touchedCellsRef.current)) {
      const i = Number(k);
      if (i < from) next[i] = v;
      else if (delta < 0 && i === from) continue;
      else next[i + delta] = v;
    }
    touchedCellsRef.current = next;
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    if (field === 'itemId') delete touchedCellsRef.current[index];
    else markTouched(index, field);
    const newItems = [...formData.items];

    if (field === 'itemId') {
      // Every other field clears its error the moment it is answered; the line
      // grid did not, so "Every line needs an item" sat there after the line
      // had one, and the count beside Save still said a field needed attention.
      fieldErrors.clearField('items');
      const item = pickedItem || items.find((i) => String(i.id) === String(value));
      if (item) {
        // Price list first, then this customer's last paid rate, then master.
        const resolved = resolveSaleRate({
          db,
          companyId: currentCompany.id,
          customer: selectedCustomer,
          itemId: item.id,
          item,
          // The document's own date, so a list that had expired by the time
          // this invoice was raised does not price it.
          onDate: formData.date,
        });
        // Everything the master knows, except whatever this operator has
        // already overruled on this line.
        newItems[index] = {
          ...newItems[index],
          itemId: value,
          ...(isTouched(index, 'description') ? {} : { description: item.name }),
          ...(isTouched(index, 'rate') ? {} : { rate: resolved.rate, rateSource: resolved.source }),
          ...(isTouched(index, 'gstRate') ? {} : { gstRate: Number(item.gstRate ?? 0) }),
          ...(isTouched(index, 'hsnSac') ? {} : { hsnSac: item.hsnSac || '' }),
          ...(isTouched(index, 'unit') || !item.unit ? {} : { unit: item.unit }),
        };
        if (resolved.source !== 'item master') {
          notify.info(`Rate ${resolved.rate} from ${resolved.source}`);
        }
        // Batch-tracked items open the batch prompt, pre-set to the FEFO
        // batch (earliest expiry) so dismissing it still leaves a valid line.
        // Untracked items never see it — asking for a batch on a service is
        // the noise this gating exists to remove.
        if (isTracked(item)) {
          const pick = fefoPick(db, currentCompany.id, item.id, Number(newItems[index].quantity) || 1);
          newItems[index].batchId = pick ? pick.id : '';
          newItems[index].batchNo = pick ? pick.batchNo : '';
          newItems[index].expiryDate = pick ? pick.expiryDate || '' : '';
          setBatchPrompt({ index, itemId: item.id });
        } else {
          newItems[index].batchId = '';
          newItems[index].batchNo = '';
          newItems[index].expiryDate = '';
        }
      }
    } else {
      newItems[index][field] = value;
    }

    // Discount rules: on item pick or quantity change, the best matching rule
    // fills the discount columns. A manual Disc% edit is the operator's call —
    // rules never overwrite that field once touched by hand.
    if (field === 'itemId' || field === 'quantity') {
      const line = newItems[index];
      const item = items.find((i) => String(i.id) === String(line.itemId));
      if (item && !line.discountManual) {
        const ruleHit = resolveDiscountForLine({
          db,
          companyId: currentCompany.id,
          customer: selectedCustomer,
          item,
          qty: Number(line.quantity ?? 1),
          rate: Number(line.rate ?? 0),
          date: formData.date,
        });
        const prevPct = Number(line.discountPct) || 0;
        const prevFixed = Number(line.discountAmount) || 0;
        line.discountPct = ruleHit?.pct || 0;
        line.discountAmount = ruleHit?.fixedPerUnit ? ruleHit.fixedPerUnit * (Number(line.quantity) || 1) : 0;
        line.discountRule = ruleHit?.ruleName || '';
        if (ruleHit && (line.discountPct !== prevPct || line.discountAmount !== prevFixed)) {
          notify.info(
            `${ruleHit.pct ? `${ruleHit.pct}% off` : `₹${ruleHit.fixedPerUnit}/unit off`} — ${ruleHit.ruleName}`
          );
        }
      }
    }
    if (field === 'discountPct') {
      newItems[index].discountManual = true;
    }

    if (field === 'quantity' || field === 'rate' || field === 'gstRate' || field === 'itemId' || field === 'discountPct') {
      const computed = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        isIntra,
        discountPct: Number(newItems[index].discountPct ?? 0),
        discountAmount: Number(newItems[index].discountAmount ?? 0),
      });
      newItems[index].amount = computed.taxableAmount;
      newItems[index].taxableAmount = computed.taxableAmount;
      newItems[index].gstAmount = computed.gstAmount;
      newItems[index].cgstAmount = computed.cgstAmount;
      newItems[index].sgstAmount = computed.sgstAmount;
      newItems[index].igstAmount = computed.igstAmount;
      newItems[index].lineTotal = computed.lineTotal;
      newItems[index].taxType = computed.taxType;
    }

    setFormData({ ...formData, items: newItems });
  };

  const removeItem = (index) => {
    shiftTouched(index, -1);
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  /**
   * Copy a line and put the copy directly under it.
   *
   * Batch and any recorded expiry are dropped: the copy is a new line that has
   * not been told which batch it draws from, and inheriting one would quietly
   * commit stock the operator never chose.
   */
  const duplicateItem = (index) => {
    const source = formData.items[index];
    if (!source) return;
    const copy = { ...source, batchId: '', batchNo: '', expiryDate: '' };
    shiftTouched(index + 1, 1);
    setFocusRowIndex(index + 1);
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items.slice(0, index + 1), copy, ...prev.items.slice(index + 1)],
    }));
  };

  const computed = computeGstForLines({
    lines: formData.items,
    isIntra,
    invoiceDiscount:
      formData.invoiceDiscountEnabled && Number(formData.invoiceDiscountValue) > 0
        ? { type: formData.invoiceDiscountType || 'pct', value: Number(formData.invoiceDiscountValue) }
        : null,
    otherCharges: formData.otherCharges,
  });

  /*
   * The taxable value, and what the customer will withhold from it.
   *
   * The base is the amount GST is charged on — after any invoice-level
   * discount, including other charges, and before the tax itself. CBDT
   * Circular 23/2017: where GST is shown separately, tax is deducted on the
   * amount excluding it.
   *
   * The invoice total does not move. TDS is the customer's withholding, not a
   * discount: reducing the total here would understate output GST and lose
   * part of the receivable.
   */
  const tdsBase = Math.max(
    0,
    Number(computed.subtotal || 0) - Number(computed.invoiceDiscount || 0) + Number(computed.otherChargesTotal || 0)
  );
  const tdsRateValue = Number(formData.tdsRate || 0);

  /*
   * What this customer has already been billed under this section this year,
   * so the threshold means something.
   *
   * TDS is not due from the first rupee: 194J(b) starts at 50,000 for the year,
   * 194C at 30,000 for one bill or 1,00,000 across the year. The app deducted
   * regardless, which overstated the deduction on every small document. And
   * once a limit IS passed the whole aggregate becomes liable, earlier
   * documents included — so the figure has to know what came before it.
   */
  const tdsPriorValue = useMemo(() => {
    const code = String(formData.tdsSection || '').trim();
    const customerId = formData.customerId;
    if (!code || customerId === '' || customerId == null) return 0;
    const fy = fyRange(formData.date);
    return (db?.invoices || [])
      .filter(
        (i) =>
          i.companyId === currentCompany.id &&
          String(i.customerId) === String(customerId) &&
          String(i.tdsSection || '') === code &&
          String(i.status || '').toLowerCase() !== 'cancelled' &&
          String(i.id) !== String(initialData?.id ?? '') &&
          String(i.date || '') >= fy.from &&
          String(i.date || '') <= fy.to
      )
      .reduce((sum, i) => sum + (Number(i.taxableValue) || Number(i.subtotal) || 0), 0);
  }, [db?.invoices, currentCompany.id, formData.customerId, formData.tdsSection, formData.date, initialData?.id]);

  /*
   * Expected, not receivable.
   *
   * §17: an invoice may show what the customer is expected to withhold, but
   * the receivable stays the full invoice amount and nothing is debited to TDS
   * Receivable here. The asset is recognised when a receipt records that the
   * customer actually deducted — which is the one thing this screen must not
   * pre-empt, because an expectation that never arrives would sit in the books
   * as tax somebody else paid on our behalf.
   */
  const tdsExpected = resolveTds({
    company: currentCompany,
    party: customer,
    transactionDate: formData.date,
    taxableBase: tdsBase,
    explicitNatureCode: natureForSection(formData.tdsSection)?.code || '',
    explicitRate: String(formData.tdsRate ?? '').trim() === '' ? null : formData.tdsRate,
    side: 'RECEIVABLE',
    priorBase: tdsPriorValue,
    ledgers: [],
  });

  const tdsState = formData.tdsSection
    ? { crossed: tdsExpected.thresholdCrossed, base: tdsExpected.baseAmount, reason: tdsExpected.thresholdReason }
    : null;
  const tdsAmount = tdsExpected.tdsAmount;
  const netReceivable = Math.max(0, Number(computed.total || 0) - tdsAmount);

  /**
   * The invoice as it stands right now, shaped like a saved one.
   *
   * The preview uses the same renderer that prints and emails, so it has to be
   * fed the same shape. Building it from `computed` rather than from the raw
   * form is the point — a preview that totals differently from the saved
   * document is worse than no preview.
   */
  /**
   * A cancelled invoice is a record, not a document you still work on. Its
   * number is spent and its ledger entries are reversed; editing it would put
   * a live figure back behind a status that says there isn't one.
   */
  const isCancelled = String(existingInvoiceRecord?.status || '') === 'Cancelled';

  /*
   * An invoice that has reached the books is no longer financially editable.
   *
   * The server has refused this since `d024b6d` — an invoice posted at 118,000
   * and edited to 40,000 left the document and the ledger disagreeing, and the
   * edit route was the only place in the product that could do it. The refusal
   * was right and invisible: every control stayed live, so the way to learn
   * about the rule was to retype an invoice and lose the lot to a toast.
   *
   * Asked of the ledger rather than guessed from the status, because a Draft
   * invoice posts today: Draft does not mean "not in the books", the entries
   * do. The answer fails open — no permission or no network leaves the form as
   * it was, with the server still the authority.
   */
  const { locked: postedLocked } = usePostingLock('INVOICE', existingInvoiceRecord?.backendInvoiceId || '');
  /* A cancelled invoice is closed to editing for its own reason, and the two
     want the same controls shut. */
  const financialLocked = postedLocked || isCancelled;

  const previewInvoice = useMemo(
    () => ({
      ...formData,
      number: formData.number || generatedInvoiceNumber || '',
      customerName: getCustomerDisplayName(customer),
      customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      invoiceDiscountApplied: computed.invoiceDiscount,
      otherCharges: computed.otherCharges,
      otherChargesTotal: computed.otherChargesTotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
    }),
    [formData, generatedInvoiceNumber, customer, customerGstin, customerState, isIntra, computed]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isCancelled) {
      notify.error('This invoice is cancelled. Its number is spent — raise a new invoice instead.');
      return;
    }

    if (postedLocked) {
      notify.error(
        'This invoice is in the books, so its amounts can no longer be changed. ' +
          'Cancel it and raise a new one, or issue a credit note against it.'
      );
      return;
    }

    const wantsDraft = !isEdit && submitAsDraft;
    if (wantsDraft) {
      setSubmitAsDraft(false);
    }

    let invoiceNumber = String(formData.number || '').trim();
    if (isInvoiceAuto) {
      if (lockInvoiceNumberOnCreate) {
        invoiceNumber = String(generatedInvoiceNumber || '').trim();
      } else if (!invoiceNumber) {
        invoiceNumber = String(generatedInvoiceNumber || '').trim();
      }
    }

    // Everything that is about a field, gathered in one pass. Reporting these
    // one at a time meant a form with three blanks took three submits to find
    // out about the third.
    const invoiceNumberClash = db.invoices.some(
      (inv) => inv.companyId === currentCompany.id && String(inv.number || '').trim() === invoiceNumber && (!isEdit || inv.id !== Number(initialData?.id))
    );

    fieldErrors.reset();
    fieldErrors.require('number', invoiceNumber, 'Invoice number is required');
    fieldErrors.check(
      'number',
      !invoiceNumber || !invoiceNumberClash,
      'That number is already used. Change it, or adjust numbering in Company Profile.'
    );
    fieldErrors.require('date', formData.date, 'Invoice date is required');
    fieldErrors.require('warehouseId', formData.warehouseId, 'Warehouse is required');
    fieldErrors.require('customerId', formData.customerId, 'Customer is required');
    fieldErrors.check('exchangeRate', !multiCurrencyEnabled || !formData.invoiceCurrency || formData.invoiceCurrency === invoiceBaseCurrency || Number(formData.exchangeRate) > 0, `Enter the conversion rate to ${invoiceBaseCurrency}`);
    fieldErrors.check(
      'items',
      !(formData.items || []).some((l) => !String(l.itemId || '').trim()),
      'Every line needs an item — GST is charged per item.'
    );
    if (fieldErrors.failed()) return;
    if (selectedCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating an invoice.');
      return;
    }

    // Closed books: nothing back-dates into a period already reported.
    {
      const closed = blockIfClosed(db, currentCompany.id, formData.date, 'This invoice');
      if (closed) {
        notify.error(closed);
        return;
      }
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST invoices.');
      return;
    }

    const customerIsRegistered = String(selectedCustomer?.gstRegistration || '').trim().toLowerCase() === 'registered';
    if (customerIsRegistered && !canDetermineSupplyType({ companyState, partyState: customerState })) {
      notify.error('Cannot determine Place of Supply for this registered customer. Please set customer state/address before creating GST invoices.');
      return;
    }


    // Batch-tracked lines must name a batch with enough remaining stock.
    if (!wantsDraft) {
      for (const l of formData.items || []) {
        const master = items.find((i) => String(i.id) === String(l.itemId));
        if (!isTracked(master)) continue;
        if (!l.batchId) {
          notify.error(`"${master.name}" is batch-tracked — pick a batch on its line.`);
          return;
        }
        const batch = batchesForItem(db, currentCompany.id, l.itemId, {
          includeEmpty: true,
          excludeInvoiceId: isEdit ? initialData?.id : undefined,
        }).find((b) => String(b.id) === String(l.batchId));
        const q = Number(l.quantity) || 0;
        if (!batch) {
          notify.error(`Batch on "${master.name}" no longer exists — pick again.`);
          return;
        }
        if (q > batch.remaining + 0.0001) {
          notify.error(`Batch ${batch.batchNo} has only ${batch.remaining} left — line needs ${q}.`);
          return;
        }
      }
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    // Credit management: warn before pushing a customer past their limit or
    // stacking onto already-overdue invoices. Warn-and-confirm, not a hard
    // block — the operator may have collected payment out of band.
    if (!isEdit && customer) {
      const openInvoices = db.invoices.filter((i) => {
        if (i.companyId !== currentCompany.id) return false;
        if (parseInt(i.customerId) !== customer.id) return false;
        const st = String(i.status || '').toLowerCase();
        return st !== 'draft' && st !== 'cancelled' && st !== 'paid';
      });
      const outstanding = openInvoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.paidAmount || 0)), 0);
      const creditLimit = Number(customer.creditLimit || 0);
      const todayStr = todayIso();
      const overdue = openInvoices.filter((i) => i.dueDate && i.dueDate < todayStr);

      const warnings = [];
      if (creditLimit > 0 && outstanding + computed.total > creditLimit) {
        warnings.push(
          `Credit limit ${formatMoney(creditLimit, currentCompany)} would be crossed — outstanding ${formatMoney(outstanding, currentCompany)} + this invoice ${formatMoney(computed.total, currentCompany)}.`
        );
      }
      if (overdue.length > 0) {
        warnings.push(`${overdue.length} invoice(s) already past due (oldest: ${overdue.map((i) => i.dueDate).sort()[0]}).`);
      }
      if (warnings.length) {
        const ok = await confirmDialog({
          title: 'Credit check',
          message: warnings.join('\n') + '\n\nCreate the invoice anyway?',
          confirmLabel: 'Create anyway',
        });
        if (!ok) return;
      }
    }

    const existingInvoice = isEdit ? db.invoices.find((i) => i.id === Number(initialData.id)) : null;
    if (isEdit && !existingInvoice) {
      notify.error('Invoice not found. It may have been removed.');
      return;
    }

    const invoicePayloadBase = {
      companyId: currentCompany.id,
      ...formData,
      currency: multiCurrencyEnabled
        ? String(formData.invoiceCurrency || currentCompany?.currency || currentCompany?.baseCurrency || 'INR').toUpperCase()
        : String(currentCompany?.currency || currentCompany?.baseCurrency || 'INR').toUpperCase(),
      invoiceCurrency: multiCurrencyEnabled ? formData.invoiceCurrency : '',
      exchangeRate: multiCurrencyEnabled && formData.invoiceCurrency && formData.invoiceCurrency !== invoiceBaseCurrency
        ? Number(formData.exchangeRate || 0)
        : 1,
      number: invoiceNumber,
      warehouseId: String(formData.warehouseId || '').trim(),
      customerName: getCustomerDisplayName(customer),
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      invoiceDiscountApplied: computed.invoiceDiscount,
      otherCharges: computed.otherCharges,
      otherChargesTotal: computed.otherChargesTotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      // Stated on the document, never netted off the total: the receivable is
      // the total, and the deduction is tax the customer pays on our behalf.
      tdsSection: formData.tdsSection || '',
      tdsDeducteeType: formData.tdsSection ? formData.tdsDeducteeType || 'COMPANY' : '',
      tdsRate: formData.tdsSection ? tdsRateValue : 0,
      /* Expected — the customer's withholding, not an asset of ours until a
         receipt says they took it. */
      tdsAmount,
      tdsExpectedAmount: tdsAmount,
      tdsNatureCode: tdsExpected.natureCode || '',
      tdsRuleVersionId: tdsExpected.ruleVersionId || '',
    };

    const existingPaidAmount = isEdit ? Number(existingInvoice?.paidAmount ?? 0) : 0;
    // Editing a draft and pressing Update used to finalise it, because the
    // only thing consulted was which button was pressed on a form that no
    // longer offered the draft one.
    const isDraft = wantsDraft;
    const nextStatus =
      isDraft
        ? 'Draft'
        : computed.total > 0 && existingPaidAmount >= computed.total - 0.0001
          ? 'Paid'
          : existingPaidAmount > 0
            ? 'Partial'
            : 'Unpaid';

    // Block negative stock for Goods (Services do not affect inventory)
    if (!isDraft) {
      const whId = String(formData.warehouseId || '').trim();
      const inventoryByItemId = computeInventorySummaryByItemId({ db, companyId: currentCompany.id, warehouseId: whId });

      const itemsById = new Map(items.map((it) => [String(it.id), it]));
      const sumQtyByItemId = (lines) => {
        const map = new Map();
        (Array.isArray(lines) ? lines : []).forEach((l) => {
          const itemId = l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '';
          if (!itemId) return;
          const master = itemsById.get(itemId);
          if (!master || !isStockItem(master)) return;
          const qty = Number(l?.quantity ?? 0);
          const q = Number.isFinite(qty) ? Math.max(0, qty) : 0;
          if (q <= 0) return;
          map.set(itemId, (map.get(itemId) || 0) + q);
        });
        return map;
      };

      const requiredOut = sumQtyByItemId(computed.lines);
      const canGiveBack =
        Boolean(isEdit) &&
        Boolean(existingInvoice) &&
        String(existingInvoice?.status || '').trim() !== 'Draft' &&
        String(existingInvoice?.warehouseId || '').trim() === whId;
      const giveBackOut = canGiveBack ? sumQtyByItemId(existingInvoice?.items) : new Map();

      for (const [itemId, needQty] of requiredOut.entries()) {
        const closingQty = Number(inventoryByItemId.get(String(itemId))?.closingQty ?? 0);
        const giveBack = Number(giveBackOut.get(String(itemId)) || 0);
        const available = (Number.isFinite(closingQty) ? closingQty : 0) + (Number.isFinite(giveBack) ? giveBack : 0);

        if (needQty > available + 0.0001) {
          const master = itemsById.get(String(itemId));
          const label = master?.name || master?.code || `Item ${itemId}`;
          notify.error(`Negative stock not allowed. "${label}" available ${available}, required ${needQty}.`);
          return;
        }
      }
    }

    if (isEdit) {
      const updatedInvoice = {
        ...existingInvoice,
        ...invoicePayloadBase,
        id: existingInvoice.id,
        paidAmount: existingInvoice.paidAmount ?? 0,
        status: nextStatus,
        createdAt: existingInvoice.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const hasApiSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
      if (hasApiSession) {
        const backendInvoiceId = String(existingInvoice?.backendInvoiceId || '').trim();
        const payload = {
          branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
          warehouseId: String(updatedInvoice.warehouseId || '').trim(),
          number: String(updatedInvoice.number || '').trim(),
          date: String(updatedInvoice.date || '').trim(),
          dueDate: String(updatedInvoice.dueDate || '').trim(),
          refNo: String(updatedInvoice.refNo || '').trim(),
          refDate: String(updatedInvoice.refDate || '').trim(),
          customerId: String(updatedInvoice.customerId || '').trim(),
          customerName: String(updatedInvoice.customerName || '').trim(),
          customerGstin: String(updatedInvoice.customerGstin || '').trim(),
          placeOfSupplyState: String(updatedInvoice.placeOfSupplyState || '').trim(),
          taxType: String(updatedInvoice.taxType || '').trim(),
          subtotal: Number(updatedInvoice.subtotal ?? 0),
          cgstTotal: Number(updatedInvoice.cgstTotal ?? 0),
          sgstTotal: Number(updatedInvoice.sgstTotal ?? 0),
          igstTotal: Number(updatedInvoice.igstTotal ?? 0),
          gstTotal: Number(updatedInvoice.gstTotal ?? 0),
          total: Number(updatedInvoice.total ?? 0),
          paidAmount: Number(updatedInvoice.paidAmount ?? 0),
          status: String(updatedInvoice.status || 'Draft').trim(),
          sourceEstimateId: updatedInvoice.sourceEstimateId ? String(updatedInvoice.sourceEstimateId) : '',
          shipToAddressId: updatedInvoice.shipToAddressId || undefined,
          items: Array.isArray(updatedInvoice.items) ? updatedInvoice.items : [],
        };

        try {
          const saved = backendInvoiceId
            ? await updateInvoiceApi(backendInvoiceId, payload)
            : await createInvoiceApi(payload);
          updatedInvoice.backendInvoiceId = String(saved?.id || backendInvoiceId || '').trim() || undefined;
        } catch (err) {
          notify.error(String(err?.message || 'Unable to save invoice to backend.'));
          return;
        }
      }

      setDb({
        ...db,
        invoices: db.invoices.map((inv) => (inv.id === existingInvoice.id ? updatedInvoice : inv)),
      });
      onClose?.();
      notify.success('Invoice updated successfully!');
      return;
    }

    const newInvoiceId = getNextNumericId(db.invoices);
    const newInvoice = {
      ...invoicePayloadBase,
      id: newInvoiceId,
      paidAmount: 0,
      status: nextStatus,
      createdAt: new Date().toISOString(),
    };

    const hasApiSession = Boolean(String(localStorage.getItem('token') || '').trim() && String(platformOrgId() || '').trim());
    if (hasApiSession) {
      const payload = {
        branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
        warehouseId: String(newInvoice.warehouseId || '').trim(),
        number: String(newInvoice.number || '').trim(),
        date: String(newInvoice.date || '').trim(),
        dueDate: String(newInvoice.dueDate || '').trim(),
        refNo: String(newInvoice.refNo || '').trim(),
        refDate: String(newInvoice.refDate || '').trim(),
        customerId: String(newInvoice.customerId || '').trim(),
        customerName: String(newInvoice.customerName || '').trim(),
        customerGstin: String(newInvoice.customerGstin || '').trim(),
        placeOfSupplyState: String(newInvoice.placeOfSupplyState || '').trim(),
        taxType: String(newInvoice.taxType || '').trim(),
        subtotal: Number(newInvoice.subtotal ?? 0),
        cgstTotal: Number(newInvoice.cgstTotal ?? 0),
        sgstTotal: Number(newInvoice.sgstTotal ?? 0),
        igstTotal: Number(newInvoice.igstTotal ?? 0),
        gstTotal: Number(newInvoice.gstTotal ?? 0),
        total: Number(newInvoice.total ?? 0),
        paidAmount: Number(newInvoice.paidAmount ?? 0),
        status: String(newInvoice.status || 'Draft').trim(),
        sourceEstimateId: newInvoice.sourceEstimateId ? String(newInvoice.sourceEstimateId) : '',
        reverseCharge: !!newInvoice.reverseCharge,
        // Fields the form collects that used to stop at the browser: without
        // them a device that had never seen this invoice rebuilt it without
        // its salesman, cost centre, discounts, charges or source document.
        salesmanId: newInvoice.salesmanId ?? undefined,
        costCenterId: newInvoice.costCenterId ?? undefined,
        invoiceDiscountType: newInvoice.invoiceDiscountType ?? undefined,
        invoiceDiscountValue: newInvoice.invoiceDiscountValue ?? undefined,
        invoiceDiscountApplied: Number.isFinite(Number(newInvoice.invoiceDiscountApplied))
          ? Number(newInvoice.invoiceDiscountApplied)
          : undefined,
        otherCharges: Array.isArray(newInvoice.otherCharges) && newInvoice.otherCharges.length ? newInvoice.otherCharges : undefined,
        otherChargesTotal: Number.isFinite(Number(newInvoice.otherChargesTotal)) ? Number(newInvoice.otherChargesTotal) : undefined,
        tdsSection: newInvoice.tdsSection || undefined,
        tdsRate: Number(newInvoice.tdsRate) > 0 ? Number(newInvoice.tdsRate) : undefined,
        tdsAmount: Number(newInvoice.tdsAmount) > 0 ? Number(newInvoice.tdsAmount) : undefined,
        shipToAddressId: newInvoice.shipToAddressId ?? undefined,
        sourceChallanId: newInvoice.sourceChallanId ?? undefined,
        sourceSalesOrderId: newInvoice.sourceSalesOrderId ?? undefined,
        items: Array.isArray(newInvoice.items) ? newInvoice.items : [],
      };

      try {
        const saved = await createInvoiceApi(payload);
        newInvoice.backendInvoiceId = String(saved?.id || '').trim() || undefined;
      } catch (err) {
        notify.error(String(err?.message || 'Unable to save invoice to backend.'));
        return;
      }
    }

    const sourceEstimateId = formData.sourceEstimateId;
    const updatedEstimates = sourceEstimateId
      ? db.estimates.map((e) =>
          e.id === sourceEstimateId
            ? {
                ...e,
                status: 'Converted',
                convertedInvoiceId: newInvoice.id,
                convertedAt: new Date().toISOString(),
              }
            : e
        )
      : db.estimates;

    const sourceChallanId = formData.sourceChallanId;
    setDb({
      ...db,
      invoices: [...db.invoices, newInvoice],
      estimates: updatedEstimates,
      deliveryChallans: sourceChallanId
        ? (db.deliveryChallans || []).map((c) =>
            Number(c.id) === Number(sourceChallanId) ? { ...c, status: 'Invoiced', invoiceNumber: newInvoice.number } : c
          )
        : db.deliveryChallans,
      companies: bumpCompanyNextNumber({
        db,
        companyId: currentCompany.id,
        voucherKey: 'invoice',
        usedNumber: invoiceNumber,
        branchId: branchIdForNumbering,
      }),
    });

    const keepGoing = saveAndNewRef.current;
    saveAndNewRef.current = false;

    if (keepGoing) {
      // Same customer, same warehouse, everything else blank — the next
      // invoice in a run is usually for a different line of goods, not a
      // different buyer, and retyping the customer every time is the thing
      // that makes bulk entry slow.
      setFormData((p) => ({
        ...p,
        number: '',
        items: [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }],
        invoiceDiscountEnabled: false,
        invoiceDiscountValue: '',
        otherCharges: [],
        refNo: '',
        refDate: '',
        customFields: {},
        sourceEstimateId: null,
        sourceChallanId: null,
        sourceSalesOrderId: null,
      }));
      setPreviewOpen(false);
    } else {
      onClose?.();
    }

    if (sourceEstimateId) notify.success('Invoice created and estimate converted successfully!');
    else if (keepGoing) notify.success(`Invoice ${invoiceNumber} saved. Next one is ready.`);
    else notify.success('Invoice created successfully!');

    // Auto-register on the IRP when the org opted in (fire-and-forget: the
    // invoice is already saved; a gateway failure only means "no IRN yet").
    if (newInvoice.backendInvoiceId && isEnabled('einvoice')) {
      (async () => {
        try {
          // Reading the gateway settings needs the settings permission; a
          // sales user without it simply skips auto-registration — silently,
          // because the invoice itself saved fine.
          let settings = null;
          try {
            settings = await getEInvoiceSettingsApi();
          } catch {
            return;
          }
          if (!settings?.autoRegister || !settings?.baseUrl) return;
          const customer = (db.customers || []).find((c) => c.id === newInvoice.customerId) || {};
          const result = await registerEInvoiceApi(
            newInvoice.backendInvoiceId,
            buildEInvoicePayload({ invoice: newInvoice, company: currentCompany, customer })
          );
          setDb((prev) => ({
            ...prev,
            invoices: (prev.invoices || []).map((x) =>
              x.id === newInvoice.id
                ? { ...x, irn: result.irn, irnAckNo: result.ackNo, irnAckDate: result.ackDate, irnSignedQr: result.signedQr }
                : x
            ),
          }));
          notify.success(`IRN for ${newInvoice.number}: ${result.irn}`);
        } catch (err) {
          notify.error(`IRP auto-registration failed: ${String(err?.message || err)}`);
        }
      })();
    }
  };

  // Hands stay on the keyboard. These are the bindings a Tally operator
  // already has in muscle memory, so entry does not slow down on arrival.
  /*
   * The shared document keyboard contract, in place of a handler this form
   * had grown for itself: Ctrl+S saves the draft, Ctrl+Enter commits, Enter
   * advances (and opens the next line inside the grid), Tab off the last cell
   * of the last line opens one, Ctrl+= adds, Ctrl+D duplicates, Ctrl+Delete
   * removes.
   */
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    // Ctrl+S should never be the keystroke that finalises a GST number, so on
    // a draftable document it saves the draft.
    onSave: () => {
      if (isDraftInvoice && !isEdit) {
        submitAsDraftNow();
        return;
      }
      setSubmitAsDraft(false);
      formRef.current?.requestSubmit();
    },
    onCommit: () => {
      setSubmitAsDraft(false);
      formRef.current?.requestSubmit();
    },
    lineCount: formData.items.length,
    addLine: addItem,
    duplicateLine: duplicateItem,
    removeLine: removeItem,
    autoFocus: '#invoice-branch-field button',
    isDirty: hasUnsavedInput,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} noValidate className="ui-creation-form invoice-editor space-y-3">
      <DocFormActions
        title={screenTitle}
        subtitle={screenSubtitle}
        onBack={onBack ? requestBack : null}
        sticky={Boolean(screenTitle)}
        primaryLabel={isDraftInvoice ? (isEdit ? 'Finalize Invoice' : 'Create Invoice') : 'Update Invoice'}
        onPrimary={() => setSubmitAsDraft(false)}
        secondaryLabel={isDraftInvoice ? 'Save Draft' : ''}
        onSecondary={submitAsDraftNow}
        /*
         * react-hooks/refs cannot tell a callback prop from a render-time
         * read, so a menu entry whose handler touches a ref reads to it as a
         * ref access during render. Every onSelect below runs on click.
         */
        // eslint-disable-next-line react-hooks/refs
        menu={[
          { key: 'preview', group: 'This invoice', label: 'Preview Invoice', icon: Eye, onSelect: () => setPreviewOpen(true) },
          !isEdit
            ? {
                key: 'saveNew',
                group: 'This invoice',
                label: 'Save & New',
                icon: Plus,
                submit: true,
                onSelect: markSaveAndNew,
              }
            : null,
          isEdit && typeof onDuplicateInvoice === 'function'
            ? {
                key: 'duplicate',
                group: 'This invoice',
                label: 'Duplicate',
                icon: Copy,
                onSelect: () => onDuplicateInvoice(existingInvoiceRecord || initialData),
              }
            : null,
          {
            key: 'prefs',
            group: 'Configure — every invoice',
            label: 'Preferences',
            icon: SlidersHorizontal,
            onSelect: () => openPreferences('fields'),
          },
          {
            key: 'custom',
            group: 'Configure — every invoice',
            label: 'Custom Field',
            icon: Plus,
            onSelect: () => openPreferences('custom'),
          },
          {
            key: 'template',
            group: 'Configure — every invoice',
            label: 'Invoice Template',
            icon: Settings2,
            onSelect: () => goToSettings('invoiceTemplates'),
          },
          isEdit && String(existingInvoiceRecord?.status || '') !== 'Cancelled'
            ? { key: 'cancel', group: 'danger', label: 'Cancel invoice', icon: Ban, danger: true, onSelect: cancelInvoice }
            : null,
        ].filter(Boolean)}
      />

      {postedLocked && !isCancelled ? (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
          role="status"
        >
          <Lock size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
          <span>
            This invoice is in the books. Its lines, amounts, customer, date and tax details can no longer be
            changed — cancel it and raise a new one, or issue a credit note against it. Notes, terms, the
            reference and the due date are still yours to edit.
          </span>
        </div>
      ) : null}

      {isCancelled ? (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
          role="status"
        >
          <Ban size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
          <span>
            This invoice was cancelled{existingInvoiceRecord?.cancelledAt ? ` on ${existingInvoiceRecord.cancelledAt}` : ''}. It
            keeps its number so the series has no hole, and it cannot be edited. Raise a new invoice instead.
          </span>
        </div>
      ) : null}

      {/*
        Settings arrive beside the invoice, not on top of it.

        This used to render InvoiceFieldSettings inline, so choosing
        "Preferences" or "Custom Field" from the menu put a settings screen in
        the middle of a half-typed invoice — two screens stacked on one page,
        neither with the width it needed, and no clear way to tell which one
        you were editing. The invoice stays where it was, behind the scrim.
      */}
      <Drawer
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        title={prefsPane === 'custom' ? 'Invoice custom fields' : 'Invoice settings'}
        description={
          prefsPane === 'custom'
            ? 'Fields of your own, on every invoice. Other documents keep their own.'
            : 'Applies to every invoice, not just this one. Nothing typed here is lost.'
        }
      >
        <InvoiceFieldSettings
          db={db}
          setDb={setDb}
          currentCompany={currentCompany}
          embedded
          pane={prefsPane}
          docType="invoice"
          docLabel="Invoice"
          onBack={() => setPrefsOpen(false)}
        />
      </Drawer>

      {/*
        The preview is a document, so it gets a document's own space.

        It used to render as a card spliced into the form above the branch and
        warehouse fields: the half-typed invoice was pushed down the page, the
        editor and the preview were on screen at once, and an A4 sheet had to
        fit the editor's column. A drawer leaves the form where it was, visible
        behind the scrim, and gives the sheet a width it can actually be read
        at. Wider than the settings drawer for the same reason.
      */}
      <Drawer
        open={previewOpen && !prefsOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Preview — ${previewInvoice?.number || 'this invoice'}`}
        description="What the customer receives"
        widthClass="w-[min(64rem,72vw)]"
      >
        <div className="overflow-x-auto">
          <InvoicePreview db={db} currentCompany={currentCompany} invoice={previewInvoice} />
        </div>
      </Drawer>

      {/*
        The head of the document, in two columns.

        Left is who and where: the branch, the warehouse its stock leaves, and
        the customer under them. Right is the paperwork: the number, the two
        dates that govern it, and the reference it answers to. They were one
        four-across band before, which put the number between the warehouse and
        the customer and read as neither.
      */}
      <div className="ui-doc-section invoice-head grid grid-cols-1 lg:grid-cols-12 gap-x-4 gap-y-3">
        <div className="lg:col-span-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* The same searchable dropdown as every other selection on this
                form — a chain with forty branches should be typed at, not
                scrolled. */}
            <div id="invoice-branch-field">
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
                placeholder="All branches"
                showValueSubtext={false}
                disabled={financialLocked}
              />
            </div>

          <div
            ref={(el) => fieldErrors.register('warehouseId', el)}
            data-invalid-within={fieldErrors.error('warehouseId') ? 'true' : undefined}
          >
            <WarehouseField
              value={formData.warehouseId}
              onChange={(warehouseId) => {
                fieldErrors.clearField('warehouseId');
                setLastSelection('warehouse', currentCompany?.id, warehouseId);
                setFormData((p) => ({ ...p, warehouseId }));
              }}
              options={warehouseOptions}
              activeWarehouseId={defaultWarehouseId}
              isEdit={Boolean(initialData)}
              icon={Package}
              showSourceHint={false}
              className="ui-select"
              disabled={financialLocked}
            />
            <FieldError error={fieldErrors.error('warehouseId')} id={fieldErrors.errorId('warehouseId')} />
          </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              ref={(el) => fieldErrors.register('customerId', el)}
              data-invalid-within={fieldErrors.error('customerId') ? 'true' : undefined}
            >
              <CustomerPicker
                db={db}
                setDb={setDb}
                icon={Users}
                label="Bill To"
                currentCompany={currentCompany}
                /* The customer becomes the party on the posted receivable line —
                   the subledger's owner. It cannot move once that is in the books. */
                disabled={financialLocked}
                disabledHint="This invoice is in the books, so its customer can no longer be changed."
                value={formData.customerId}
                onChange={(customerId) =>
                  setFormData((prev) => {
                  // Requirement 12: the due date follows the customer's agreed
                  // terms instead of a blanket +30 days. The server recomputes
                  // this on save from the same terms, so showing anything else
                  // here would just be a number that changes after saving.
                  const picked = customers.find((c) => String(c.id) === String(customerId));
                  fieldErrors.clearField('customerId');
                    return {
                      ...prev,
                      customerId,
                      shipToCode: '',
                      shipToAddress: null,
                      shipToAddressId: '',
                      dueDate: picked ? dueDateFor(prev.date, picked) || prev.dueDate : prev.dueDate,
                    };
                  })
                }
              />
              <FieldError error={fieldErrors.error('customerId')} id={fieldErrors.errorId('customerId')} />
              {selectedCustomer ? (
                <>
                  <p className="invoice-address mt-1 ui-muted">{addressSummary(selectedCustomer.billingAddress) || 'Billing address not configured'}</p>
                  <p className="invoice-address mt-0.5 ui-muted">Terms: {termsLabel(selectedCustomer)}</p>
                </>
              ) : null}
            </div>

            <div>
              <label className="ui-label" htmlFor="index-ship-to">Ship To</label>
              <select id="index-ship-to"
                value={formData.shipToCode || ''}
                disabled={!selectedCustomer}
                onChange={(e) => {
                  const code = e.target.value;
                  const selected = shipToOptions.find((option) => option.value === code) || null;
                  setFormData((previous) => ({
                    ...previous,
                    shipToCode: code,
                    shipToAddress: selected?.address || null,
                    shipToAddressId: selected?.id || '',
                  }));
                }}
                className="ui-select w-full"
              >
                <option value="">Same as billing address</option>
                {shipToOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {selectedCustomer ? (
                <p className="invoice-address mt-1 ui-muted">
                  {formData.shipToAddress
                    ? addressSummary(formData.shipToAddress)
                    : addressSummary(selectedCustomer.billingAddress) || 'Billing address not configured'}
                </p>
              ) : (
                <p className="invoice-address mt-1 ui-muted">Select a customer first</p>
              )}
            </div>
          </div>

        </div>

        {/* The paperwork column, ruled off from the left. Number and both dates
            sit on one row: they are read together — issued on, due by — and
            splitting them put a full-width number above a pair of narrow
            dates, which reads as two unrelated groups. */}
        <div
          className="lg:col-span-6 space-y-3 lg:ps-4"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr] gap-3">
          <div className="min-w-0">
            <label htmlFor="invoice-number" className="ui-label">
              Invoice No.
            </label>
            {/* The gear sits on the field it governs. Changing a series is a
                different act from raising an invoice, so it opens over the
                form rather than navigating away from a half-typed document. */}
            <div className="relative">
              <input
                id="invoice-number"
                type="text"
                value={formData.number ?? ''}
                onChange={(e) => setFormData((p) => ({ ...p, number: e.target.value }))}
                /* Two reasons to be closed: the series owns the number while a
                   new invoice is being raised, and a posted invoice's number is
                   its statutory serial. */
                disabled={lockInvoiceNumberOnCreate || financialLocked}
                required
                aria-invalid={fieldErrors.error('number') ? true : undefined}
                className="ui-input ui-mono w-full pe-9"
              />
              <button
                type="button"
                ref={numberingBtnRef}
                onClick={() => setNumberingOpen((v) => !v)}
                className="absolute end-1 top-1/2 -translate-y-1/2 ui-icon-btn !h-7 !w-7"
                aria-label="Invoice numbering settings"
                aria-haspopup="dialog"
                aria-expanded={numberingOpen}
      title="Numbering"
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
              </button>
            </div>
            <FieldError error={fieldErrors.error('number')} id={fieldErrors.errorId('number')} />
            {numberingOpen ? (
              <DocNumberingPopover
                anchorRef={numberingBtnRef}
                db={db}
                setDb={setDb}
                currentCompany={currentCompany}
                voucherKey="invoice"
      title="Invoice numbering"
                sampleLabel="Next invoice will be"
                manualLabel="Typed on each invoice"
                branchId={branchIdForNumbering}
                settings={invoiceNumbering}
                onClose={() => setNumberingOpen(false)}
                onOpenFullSettings={() => {
                  setNumberingOpen(false);
                  goToSettings('docNumbering');
                }}
              />
            ) : null}
          </div>

            <div className="min-w-0">
              <label htmlFor="invoice-date" className="ui-label">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="invoice-date"
                disabled={financialLocked}
                type="date"
                value={formData.date}
                required
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    date: e.target.value,
                    // Terms are counted from the document date, so moving the
                    // date moves the due date with it.
                    dueDate: selectedCustomer ? dueDateFor(e.target.value, selectedCustomer) || p.dueDate : p.dueDate,
                  }))
                }
                className="ui-input"
              />
              <FieldError error={fieldErrors.error('date')} id={fieldErrors.errorId('date')} />
            </div>

            <div className="min-w-0">
              <label htmlFor="invoice-due" className="ui-label">
                Due Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="invoice-due"
                type="date"
                value={formData.dueDate}
                required
                onChange={(e) => setFormData((p) => ({ ...p, dueDate: e.target.value }))}
                className="ui-input"
              />
            </div>
          </div>

          {prefOn('customerRef') ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="invoice-ref-no" className="ui-label">Ref No.</label>
                <input
                  id="invoice-ref-no"
                  type="text"
                  value={formData.refNo}
                  onChange={(e) => setFormData({ ...formData, refNo: e.target.value })}
                  className="ui-input"
                  placeholder="Quotation / Sales Order"
                />
              </div>
              <div>
                <label htmlFor="invoice-ref-date" className="ui-label">Ref Date</label>
                <input
                  id="invoice-ref-date"
                  type="date"
                  value={formData.refDate}
                  onChange={(e) => setFormData({ ...formData, refDate: e.target.value })}
                  className="ui-input"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        Custom fields, under the whole head rather than tucked into whichever
        column had room. Two per row at half the width each, so a company that
        configures six gets three tidy rows instead of a ragged column.
      */}
      {hasCustomFieldsAt(customFields, 'header', 'reference') ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4"
          style={{ borderTop: '1px solid rgb(var(--border))' }}
        >
          {renderCustomFields('header')}
          {renderCustomFields('reference')}
        </div>
      ) : null}

      {/*
        Everything a company can switch on: export paperwork, reverse charge,
        cost centre, salesman. Under the head rather than inside it, so Tab
        runs branch → warehouse → customer → number → dates → refs → custom
        fields → the first line without detouring through fields most books
        never turn on.
      */}
      {[
        prefOn('iec'),
        prefOn('lut'),
        prefOn('reverseCharge'),
        prefOn('costCenter') && (db.costCenters || []).some((c) => c.companyId === currentCompany.id),
        prefOn('salesman') && (db.salesmen || []).some((x) => x.companyId === currentCompany.id),
      ].some(Boolean) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prefOn('iec') ? (
          <div>
            <label className="ui-label">
              IEC <span className="ui-subtle font-normal">(if applicable)</span>
            </label>
            <input
              type="text"
              value={formData.iecNumber}
              onChange={(e) => setFormData((p) => ({ ...p, iecNumber: e.target.value }))}
              className="ui-input"
              placeholder="Enter IEC"
            />
          </div>
        ) : null}
        {prefOn('lut') ? (
          <div>
            <label className="ui-label">
              LUT <span className="ui-subtle font-normal">(if applicable)</span>
            </label>
            <input
              type="text"
              value={formData.lutNumber}
              onChange={(e) => setFormData((p) => ({ ...p, lutNumber: e.target.value }))}
              className="ui-input"
              placeholder="Select LUT"
            />
            <p className="mt-1 text-xs ui-muted">Zero-rated export without payment of IGST.</p>
          </div>
        ) : null}
        {prefOn('reverseCharge') ? (
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={!!formData.reverseCharge}
                onChange={(e) => setFormData({ ...formData, reverseCharge: e.target.checked })}
                className="ui-checkbox"
              />
              Reverse charge (RCM)
            </label>
          </div>
        ) : null}
        {prefOn('costCenter') && (db.costCenters || []).some((c) => c.companyId === currentCompany.id) ? (
          <div>
            <label className="ui-label" htmlFor="index-cost-center">Cost Center</label>
            <select id="index-cost-center"
              value={formData.costCenterId || ''}
              onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value ? Number(e.target.value) : '' })}
              className="ui-select"
            >
              <option value="">— none —</option>
              {(db.costCenters || [])
                .filter((c) => c.companyId === currentCompany.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
        ) : null}
        {prefOn('salesman') && (db.salesmen || []).some((s) => s.companyId === currentCompany.id) ? (
          <div>
            <label className="ui-label" htmlFor="index-salesman">Salesman</label>
            <select id="index-salesman"
              value={formData.salesmanId || ''}
              onChange={(e) => setFormData({ ...formData, salesmanId: e.target.value ? Number(e.target.value) : '' })}
              className="ui-select"
            >
              <option value="">— none —</option>
              {(db.salesmen || [])
                .filter((s) => s.companyId === currentCompany.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </div>
        ) : null}
        </div>
      ) : null}


      {[
        prefOn('lut'),
        prefOn('iec'),
        prefOn('shippingBill'),
        multiCurrencyEnabled && prefOn('foreignCurrency'),
        prefOn('transporter'),
        prefOn('lrNumber'),
        prefOn('packages'),
        prefOn('servicePeriod'),
        prefOn('project'),
        prefOn('workOrder'),
        prefOn('timesheetRef'),
      ].some(Boolean) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {prefOn('shippingBill') ? (
            <div>
              <label className="ui-label">Shipping bill</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.shippingBillNo}
                  onChange={(e) => setFormData((p) => ({ ...p, shippingBillNo: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Number"
                />
                <input
                  type="date"
                  value={formData.shippingBillDate}
                  onChange={(e) => setFormData((p) => ({ ...p, shippingBillDate: e.target.value }))}
                  className="ui-input w-40"
                  aria-label="Shipping bill date"
                />
              </div>
              <input
                type="text"
                value={formData.portCode}
                onChange={(e) => setFormData((p) => ({ ...p, portCode: e.target.value }))}
                className="ui-input mt-2"
                placeholder="Port code — INMAA1"
                aria-label="Port code"
              />
            </div>
          ) : null}

          {multiCurrencyEnabled && prefOn('foreignCurrency') ? (
            <div>
              <label className="ui-label">Currency &amp; exchange rate</label>
              <div className="flex gap-2">
                <select
                  value={formData.invoiceCurrency}
                  onChange={(e) => setFormData((p) => ({ ...p, invoiceCurrency: e.target.value.toUpperCase() }))}
                  className="ui-select min-w-40"
                  aria-label="Invoice currency"
                >
                  {enabledCurrencyOptions.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}
                </select>
                {formData.invoiceCurrency && formData.invoiceCurrency !== invoiceBaseCurrency ? <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={formData.exchangeRate}
                  onChange={(e) => setFormData((p) => ({ ...p, exchangeRate: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder={`Rate to ${invoiceBaseCurrency}`}
                  aria-label="Exchange rate"
                  required
                /> : null}
              </div>
              <p className="mt-1 text-xs ui-muted">Recorded on the document. Totals are still kept in INR.</p>
            </div>
          ) : null}

          {/* Switched off by default now — but an invoice that already carries
              a transporter still shows it, because hiding a value that is on
              the document is worse than showing a field nobody asked for. */}
          {prefOn('transporter') || formData.transporterName || formData.vehicleNo ? (
            <div>
              <label className="ui-label">Transporter &amp; vehicle</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.transporterName}
                  onChange={(e) => setFormData((p) => ({ ...p, transporterName: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Transporter"
                />
                <input
                  type="text"
                  value={formData.vehicleNo}
                  onChange={(e) => setFormData((p) => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
                  className="ui-input w-36"
                  placeholder="KA-01-AB-1234"
                  aria-label="Vehicle number"
                />
              </div>
            </div>
          ) : null}

          {prefOn('lrNumber') ? (
            <div>
              <label className="ui-label">LR / GR no.</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.lrNumber}
                  onChange={(e) => setFormData((p) => ({ ...p, lrNumber: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="Consignment note"
                />
                <input
                  type="date"
                  value={formData.lrDate}
                  onChange={(e) => setFormData((p) => ({ ...p, lrDate: e.target.value }))}
                  className="ui-input w-40"
                  aria-label="LR date"
                />
              </div>
            </div>
          ) : null}

          {prefOn('packages') ? (
            <div>
              <label className="ui-label" htmlFor="index-packages-amp-weight">Packages &amp; weight</label>
              <input id="index-packages-amp-weight"
                type="text"
                value={formData.packageDetails}
                onChange={(e) => setFormData((p) => ({ ...p, packageDetails: e.target.value }))}
                className="ui-input"
                placeholder="12 packages · 840 kg gross"
              />
            </div>
          ) : null}

          {prefOn('servicePeriod') ? (
            <div>
              <label className="ui-label">Service period</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={formData.servicePeriodFrom}
                  onChange={(e) => setFormData((p) => ({ ...p, servicePeriodFrom: e.target.value }))}
                  className="ui-input flex-1"
                  aria-label="Service period from"
                />
                <input
                  type="date"
                  value={formData.servicePeriodTo}
                  onChange={(e) => setFormData((p) => ({ ...p, servicePeriodTo: e.target.value }))}
                  className="ui-input flex-1"
                  aria-label="Service period to"
                />
              </div>
              <p className="mt-1 text-xs ui-muted">What this fee covers.</p>
            </div>
          ) : null}

          {prefOn('project') ? (
            <div>
              <label className="ui-label" htmlFor="index-project-site">Project / site</label>
              <input id="index-project-site"
                type="text"
                value={formData.projectName}
                onChange={(e) => setFormData((p) => ({ ...p, projectName: e.target.value }))}
                className="ui-input"
                placeholder="Peenya shed"
              />
            </div>
          ) : null}

          {prefOn('workOrder') ? (
            <div>
              <label className="ui-label">Work order &amp; RA bill</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.workOrderNo}
                  onChange={(e) => setFormData((p) => ({ ...p, workOrderNo: e.target.value }))}
                  className="ui-input flex-1"
                  placeholder="WO-1182"
                />
                <input
                  type="text"
                  value={formData.raBillNo}
                  onChange={(e) => setFormData((p) => ({ ...p, raBillNo: e.target.value }))}
                  className="ui-input w-32"
                  placeholder="RA-03"
                  aria-label="RA bill number"
                />
              </div>
            </div>
          ) : null}

          {prefOn('timesheetRef') ? (
            <div>
              <label className="ui-label" htmlFor="index-timesheet-reference">Timesheet reference</label>
              <input id="index-timesheet-reference"
                type="text"
                value={formData.timesheetRef}
                onChange={(e) => setFormData((p) => ({ ...p, timesheetRef: e.target.value }))}
                className="ui-input"
                placeholder="TS-2608"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="invoice-lines">
        <div className="ui-sec-head invoice-lines-head">
          <h3>Line Items</h3>
          <div className="invoice-discount-control">
            <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-medium">
              <input
                type="checkbox"
                checked={Boolean(formData.invoiceDiscountEnabled)}
                disabled={financialLocked}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    invoiceDiscountEnabled: event.target.checked,
                    invoiceDiscountValue: event.target.checked ? previous.invoiceDiscountValue : '',
                  }))
                }
              />
              Invoice discount
            </label>
            {formData.invoiceDiscountEnabled ? (
              <>
                <select
                  value={formData.invoiceDiscountType}
                  onChange={(event) => setFormData((previous) => ({ ...previous, invoiceDiscountType: event.target.value }))}
                  disabled={financialLocked}
                  className="ui-select ui-ctl-compact w-[5.25rem]"
                  aria-label="Invoice discount type"
                >
                  <option value="pct">Percent</option>
                  <option value="amt">Amount</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.invoiceDiscountValue}
                  onChange={(event) => setFormData((previous) => ({ ...previous, invoiceDiscountValue: event.target.value }))}
                  disabled={financialLocked}
                  className="ui-input ui-ctl-compact w-24 text-right"
                  placeholder={formData.invoiceDiscountType === 'pct' ? '0%' : '₹0'}
                  aria-label="Invoice discount value"
                />
              </>
            ) : null}
          </div>
        </div>

        {/* The lines are the invoice's economics. Once it is in the books the
            server refuses to change them, and the way that used to be found out
            was to retype the whole table, press Save, and be told by a toast
            that none of it could be kept. `contents` so the fieldset lays
            nothing out of its own. */}
        <fieldset className="contents" disabled={financialLocked}>
        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table ui-grid-dense w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                {/*
                  Widths, because there were none.

                  Every column took whatever the browser gave it, and the
                  Every cell's control is `w-full`, so these percentages are
                  the whole story. They used to be half of it: the numeric
                  inputs were fixed pixel widths, which left a strip of dead
                  space in each cell that no column width could reclaim, and
                  made the item column look padded while the description ran
                  out of room.
                */}
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
                <th className="px-2 py-1.5 w-9"></th>
              </tr>
            </thead>
            <tbody>
              {formData.items.map((item, idx) => {
                const lineMaster = items.find((i) => String(i.id) === String(item.itemId));
                return (
                <React.Fragment key={idx}>
                <tr className="border-t" data-line-row={idx}>
                  <td className="ui-col-meta px-2 py-1.5">
                    <ItemPicker
                      db={db}
                      setDb={setDb}
                      currentCompany={currentCompany}
                      value={item.itemId}
                      onChange={(itemId, picked) => updateItem(idx, 'itemId', itemId, picked)}
                      label={null}
                      autoFocus={idx === focusRowIndex}
                    />
                    {/*
                      Stock, the moment the item is chosen. Only for goods —
                      a service has no shelf — and only once a line has an
                      item on it.
                    */}
                    {item.itemId && lineMaster && isStockItem(lineMaster) ? (() => {
                      const available = Number(availableFor(item.itemId));
                      const wanted = Number(item.quantity ?? 0);
                      const short = Number.isFinite(wanted) && wanted > available;
                      const unit = String(lineMaster.unit || '').trim();
                      return (
                        <p
                          className="ui-caption mt-1"
                          style={short ? { color: 'rgb(var(--neg))' } : undefined}
                        >
                          {short
                            ? `Only ${available}${unit ? ` ${unit}` : ''} in stock`
                            : `In stock: ${available}${unit ? ` ${unit}` : ''}`}
                        </p>
                      );
                    })() : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      /* A cell in a row is named by its column, which a screen
                         reader does not read as it moves between fields. The
                         line number says which of eight identical boxes it is. */
                      aria-label={`Description for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="1"
                      aria-label={`Quantity for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* The unit belongs to the item, so it is shown rather than
                        asked for. Typing it per line is how two lines of the
                        same item end up billed in different units. */}
                    <span className="text-sm ui-muted">{String(lineMaster?.unit || '').trim() || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      className="ui-input w-full min-w-0 px-2 py-1"
                      min="0"
                      step="0.01"
                      aria-label={`Rate for line ${idx + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
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
                  <td className="px-2 py-1.5">
                    {prefOn('lineTaxEditable') ? (
                      <select
                        value={String(item.gstRate ?? 0)}
                        onChange={(e) => updateItem(idx, 'gstRate', e.target.value)}
                        className="ui-select w-full min-w-0 px-2 py-1"
                        aria-label={`GST rate for line ${idx + 1}`}
                      >
                        {[0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28].map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    ) : (
                      // A value, not a disabled control: the rate comes from the
                      // item master, and a greyed-out box invites a fight with a
                      // field that will not move.
                      <span className="ui-num block text-sm">{Number(item.gstRate ?? 0)}%</span>
                    )}
                  </td>
                  <td className="ui-col-amount px-2 py-1.5">{formatMoney((computed.lines[idx]?.lineTotal ?? item.lineTotal) || 0, currentCompany)}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]"
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={addItem} className="ui-btn ui-btn-soft">
            <Plus size={16} aria-hidden="true" /> Add Item
          </button>
          <span className="ui-subtle hidden text-xs lg:inline">or press Tab in the last field of the last row</span>
          <FieldError error={fieldErrors.error('items')} id={fieldErrors.errorId('items')} />
        </div>
        </fieldset>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {/* Discount and charges move the invoice's economics too, so they
                close with the lines. Payment terms and notes below do not, and
                stay editable — the server allows them on a posted invoice. */}
            <fieldset className="contents" disabled={financialLocked}>
            {prefOn('otherCharges') || (formData.otherCharges || []).length > 0 ? (
            <div>
              <label className="ui-label">Other charges (transport, reimbursement…)</label>
              {(formData.otherCharges || []).map((c, ci) => (
                <div key={ci} className="mb-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={c.label}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, label: e.target.value } : x)),
                      }))
                    }
                    className="ui-input flex-1 min-w-0 px-2 text-sm"
                    placeholder="Transport"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={c.amount}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, amount: e.target.value } : x)),
                      }))
                    }
                    className="ui-input w-24 px-2 text-sm"
                    placeholder="Amount"
                  />
                  <select
                    value={c.gstRate}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        otherCharges: p.otherCharges.map((x, i) => (i === ci ? { ...x, gstRate: e.target.value } : x)),
                      }))
                    }
                    className="ui-select w-24 px-2 text-sm"
                  >
                    {[0, 5, 12, 18, 28].map((r) => (
                      <option key={r} value={r}>GST {r}%</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, otherCharges: p.otherCharges.filter((_, i) => i !== ci) }))}
                    className="ui-icon-btn ui-btn-sm !w-8"
                    aria-label="Remove charge"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setFormData((p) => ({ ...p, otherCharges: [...(p.otherCharges || []), { label: '', amount: '', gstRate: 0 }] }))}
                className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
              >
                + Add charge
              </button>
            </div>
            ) : null}
            </fieldset>

            {hasCustomFieldsAt(customFields, 'notes') ? (
              <div className="grid gap-3 sm:grid-cols-2">{renderCustomFields('notes')}</div>
            ) : null}

          </div>
          <div className="flex justify-end">
            {/* The totals sit in the same well the head does, so the figure a
                document is worth is an object rather than a column of text
                trailing off the right edge. */}
            <div className="ui-doc-section invoice-totals w-full max-w-80 space-y-1.5">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
            </div>
            {computed.invoiceDiscount > 0 ? (
              <div className="flex justify-between">
                <span>Discount:</span>
                <span className="text-[rgb(var(--neg-ink))]">− {formatMoney(computed.invoiceDiscount, currentCompany)}</span>
              </div>
            ) : null}
            {computed.invoiceDiscount > 0 || computed.otherChargesTotal > 0 ? (
              <div className="flex justify-between">
                <span>Taxable Amount:</span>
                <span className="ui-money">{formatMoney(computed.subtotal - computed.invoiceDiscount + computed.otherChargesTotal, currentCompany)}</span>
              </div>
            ) : null}
            {computed.otherChargesTotal > 0 ? (
              <div className="flex justify-between">
                <span>Other charges:</span>
                <span className="ui-money">{formatMoney(computed.otherChargesTotal, currentCompany)}</span>
              </div>
            ) : null}
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
            {/* Below the total, not inside it: the invoice is for the total,
                and this is what will actually arrive. */}
            {/*
              TDS sits with the total it is taken from, not across the page.

              The section and the rate are how it is chosen, so they live in
              the chooser; once chosen, the line beside the total is the figure
              and the word TDS, because that is what a reader of the totals
              wants. The full section is on the document and in the return.
            */}
            {/*
              Chosen once, then out of the way.
              Section, rate and payee are how a deduction is chosen; none of
              them is what a reader of the totals wants afterwards. Once a
              section is set the chooser folds away and the totals say "TDS"
              and a figure — the section is on the document and in the return,
              which is where it is read.
            */}
            {tdsEnabledHere && !tdsPickerOpen && !formData.tdsSection ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setTdsPickerOpen(true)}
                  className="ui-btn ui-btn-ghost ui-btn-sm !px-0"
                >
                  + TDS deduction <span className="ui-subtle">(if the customer deducts)</span>
                </button>
              </div>
            ) : null}

            {/* Open only while a section is being chosen. Closed, the line
                above offers to open it and the totals carry the figure — both
                at once was the chooser and its own opener on screen together. */}
            <div className="pt-1" hidden={!tdsEnabledHere || !tdsPickerOpen}>
              <label className="ui-label" htmlFor="invoice-tds-section">
                TDS deduction <span className="ui-subtle font-normal">(if the customer deducts)</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="invoice-tds-section"
                  className="ui-select flex-1 min-w-0"
                  value={formData.tdsSection || ''}
                  onChange={(e) => {
                    const code = e.target.value;
                    setFormData((p) => ({
                      ...p,
                      tdsSection: code,
                      tdsRate: code
                        ? p.tdsSection === code && p.tdsRate !== ''
                          ? p.tdsRate
                          : ruleRate(resolveRule(natureForSection(code)?.code, p.date), p.tdsDeducteeType)
                        : '',
                    }));
                    /* Chosen is chosen: the section and rate fold away and the
                       totals carry the figure. "None" leaves it open, because
                       clearing it is not a decision to hide anything. */
                    setTdsPickerOpen(!code);
                  }}
                >
                  <option value="">None</option>
                  {TDS_SECTIONS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} — {t.label} · {t.rate}%
                    </option>
                  ))}
                </select>
                {formData.tdsSection ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      aria-label="TDS rate percent"
                      className="ui-input ui-mono w-16 px-2 py-1.5 text-sm"
                      value={formData.tdsRate === '' ? '' : formData.tdsRate}
                      onChange={(e) => setFormData((p) => ({ ...p, tdsRate: e.target.value }))}
                    />
                    <span className="ui-muted text-sm">%</span>
                  </div>
                ) : null}
              </div>

              {/*
                The payee's own status changes the rate under 194C — 1% for an
                individual or a HUF, 2% for everyone else — so it is asked
                where it changes something and nowhere else.
              */}
              {tdsVariesByDeductee(formData.tdsSection) ? (
                <div className="mt-2">
                  <label className="ui-label" htmlFor="invoice-tds-deductee">
                    Payee is
                  </label>
                  <select
                    id="invoice-tds-deductee"
                    className="ui-select w-full"
                    value={formData.tdsDeducteeType || 'COMPANY'}
                    onChange={(e) => {
                      const type = e.target.value;
                      setFormData((p) => ({
                        ...p,
                        tdsDeducteeType: type,
                        tdsRate: ruleRate(resolveRule(natureForSection(p.tdsSection)?.code, p.date), type),
                      }));
                    }}
                  >
                    {DEDUCTEE_TYPES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/*
                Whether the threshold has been reached, and why. Without this
                the figure simply appears or does not, and a user whose bill is
                under the limit cannot tell a working feature from a broken one.
              */}
              {tdsState ? (
                <p className="ui-caption mt-1.5">
                  {tdsState.crossed
                    ? `${tdsState.reason}. Deducted on ${formatMoney(tdsState.base, currentCompany)}${
                        tdsPriorValue > 0 ? ` — this bill plus ${formatMoney(tdsPriorValue, currentCompany)} billed earlier this year` : ''
                      }.`
                    : `No deduction yet. ${tdsState.reason}.`}
                </p>
              ) : null}
            </div>

            {tdsAmount > 0 ? (
              <>
                <div className="flex justify-between pt-1">
                  {/* Just "TDS" and the figure. The section is chosen above and
                      printed on the document; repeating it here made the
                      totals column read like a tax return. */}
                  <span>
                    Expected TDS
                    {!tdsPickerOpen ? (
                      <button
                        type="button"
                        onClick={() => setTdsPickerOpen(true)}
                        className="ms-2 text-xs underline ui-muted hover:ui-fg"
                      >
                        Change
                      </button>
                    ) : null}
                  </span>
                  <span className="text-[rgb(var(--neg-ink))]">− {formatMoney(tdsAmount, currentCompany)}</span>
                </div>
                {/* The receivable is the whole invoice — §17. What this line
                    says is what the bank is expected to receive once the
                    customer withholds, which is a different figure and not an
                    accounting entry. */}
                <div className="ui-total-row">
                  <span>Expected on receipt:</span>
                  <span className="ui-money">{formatMoney(netReceivable, currentCompany)}</span>
                </div>
              </>
            ) : null}
            </div>
          </div>
        </div>
      </div>

      {prefOn('amountInWords') ? (
        <AmountInWordsBand words={amountInWordsInr(computed.total)} />
      ) : null}

      <DocFormFootnote
        declaration={
          prefOn('declaration')
            ? String(invoiceDocSettings?.templates?.invoice?.declarationText || '').trim() ||
              'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.'
            : ''
        }
      />

      {/* The figure and the one action, kept on screen while the lines are
          typed. What the customer already owes sits here too, because the
          moment to see it is before more credit is extended, not after. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
        </span>
        {customerOutstanding > 0 ? (
          <span className="ui-caption">
            {getCustomerDisplayName(customer) || 'This customer'} owes{' '}
            <span className="ui-money fig">{formatMoney(customerOutstanding, currentCompany)}</span> already
          </span>
        ) : null}
        <FieldErrorSummary errors={fieldErrors.errors} />
      </div>
      {/*
        Batch and expiry, asked once.

        Only for items whose master says they are tracked, only at the moment
        one is chosen, and never as a field on the form afterwards — the
        invoice itself is where the batch is read back.
      */}
      {batchPrompt ? (
        <Modal
          onClose={() => setBatchPrompt(null)}
          title={`Batch — ${items.find((i) => String(i.id) === String(batchPrompt.itemId))?.name || 'item'}`}
          maxWidthClass="max-w-lg"
        >
          {(() => {
            const line = formData.items[batchPrompt.index] || {};
            const options = batchesForItem(db, currentCompany.id, batchPrompt.itemId);
            const need = Number(line.quantity) || 0;
            if (!options.length) {
              return (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: 'rgb(var(--warn-ink))' }}>
                    Nothing of this item is in stock under a batch. Receive it on a bill first, or the invoice will not
                    save.
                  </p>
                  <div className="flex justify-end">
                    <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setBatchPrompt(null)}>
                      Close
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                <p className="text-sm ui-muted">
                  Earliest expiry first. The first batch that can cover {need || 1} is already selected.
                </p>
                <div className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                  {options.map((b) => {
                    const on = String(line.batchId || '') === String(b.id);
                    const short = b.remaining < need;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          updateItem(batchPrompt.index, 'batchId', String(b.id));
                          updateItem(batchPrompt.index, 'batchNo', b.batchNo);
                          updateItem(batchPrompt.index, 'expiryDate', b.expiryDate || '');
                          setBatchPrompt(null);
                        }}
                        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3"
                        style={on ? { backgroundColor: 'rgb(var(--accent-soft))' } : undefined}
                      >
                        <span className="min-w-0">
                          <span className="ui-mono text-sm block truncate">{b.batchNo}</span>
                          <span className="ui-caption">
                            {b.expiryDate ? `Expires ${b.expiryDate}` : 'No expiry recorded'}
                          </span>
                        </span>
                        <span
                          className="ui-mono text-sm shrink-0"
                          style={short ? { color: 'rgb(var(--warn))' } : undefined}
                        >
                          {b.remaining} left
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setBatchPrompt(null)}>
                    Keep the selected batch
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      ) : null}

    </form>
  );
};

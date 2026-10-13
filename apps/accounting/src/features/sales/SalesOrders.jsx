import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FormSection from '@ui/components/ui/FormSection';
import { Ban, Calculator, ClipboardList, Download, FileText, MoreVertical, Package, Pencil, Plus, Printer, Receipt, Settings2, Trash2, Truck } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { usePeriodFilter } from '@ui/components/ListControls';
import { DocFormActions, DocFormFootnote, AmountInWordsBand } from '@ui/components/DocumentForm';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import DocumentPrintView from '@ui/components/DocumentPrintView';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import Modal from '@ui/components/ui/Modal';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import ItemPicker from '../../components/pickers/ItemPicker';
import CustomerPicker from '../../components/pickers/CustomerPicker';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import DocNumberField from '@ui/components/DocNumberField';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import { computeGstForLines } from '@ui/utils/gst';
import { getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { resolveSaleRate } from '@ui/utils/pricing';
import { createDocApi, deleteDocApi, hasApiSession, updateDocApi } from '@ui/api/purchaseDocs';
import { DocumentNumber, SalesDate, DueDate, MoneyValue, SalesBalance } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * Sales orders — the confirmed order between quote and invoice.
 *
 * The document chain is Quote → SO → Delivery Challan → Invoice. Challans and
 * invoices created from an SO carry sourceSalesOrderId; delivered and billed
 * quantities are computed from those documents, never stored, so the pending
 * report cannot drift from reality.
 */
function SalesOrderRowActions({ order, progress, onEdit, onInvoice, onPrint, onDelete }) {
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const open = Boolean(position);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setPosition(null);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setPosition(null); };
    const closeOnViewportChange = () => setPosition(null);
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setPosition(null); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 210;
    const estimatedHeight = 168;
    const opensAbove = window.innerHeight - rect.bottom < estimatedHeight + 12;
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      ...(opensAbove ? { bottom: Math.max(8, window.innerHeight - rect.top + 6) } : { top: rect.bottom + 6 }),
      width,
    });
  };

  const choose = (action) => { setPosition(null); action(); };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ui-icon-btn"
        aria-label={`Actions for sales order ${order.number}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      ><MoreVertical size={16} /></button>
      {position ? createPortal(
        <div ref={menuRef} className="fixed rounded-lg border bg-[rgb(var(--surface))] p-1 text-start shadow-xl ui-border-c" style={{ ...position, zIndex: 'var(--z-popover)' }} role="menu">
            <button type="button" role="menuitem" className="report-menu-item" onClick={() => choose(onEdit)}><Pencil size={14} /> Edit</button>
            {progress.billed < progress.ordered ? <button type="button" role="menuitem" className="report-menu-item" onClick={() => choose(onInvoice)}><Receipt size={14} /> Convert to Invoice</button> : null}
            <button type="button" role="menuitem" className="report-menu-item" onClick={() => choose(onPrint)} aria-label={`Print sales order ${order.number}`}><Printer size={14} /> Print</button>
            <button type="button" role="menuitem" className="report-menu-item text-[rgb(var(--neg-ink))]" onClick={() => choose(onDelete)}><Trash2 size={14} /> Delete</button>
          </div>
      , document.body) : null}
    </>
  );
}

export default function SalesOrders({ db, setDb, currentCompany, onConvertToInvoice }) {
  const companyId = currentCompany.id;
  const orders = useMemo(
    () =>
      (Array.isArray(db.salesOrders) ? db.salesOrders : [])
        .filter((o) => o.companyId === companyId)
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [db.salesOrders, companyId]
  );
  const customers = (db.customers || []).filter((c) => c.companyId === companyId);
  const itemsMaster = (db.items || []).filter((i) => i.companyId === companyId);

  const [open, setOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showPending, setShowPending] = useState(false);
  const [previewOrder, setPreviewOrder] = useState(null);
  const emptyLine = { itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, discountPct: 0, unit: '', hsnSac: '' };
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    expectedDate: '',
    customerId: '',
    salesmanId: '',
    notes: '',
    customFields: {},
    items: [emptyLine],
  });

  /*
   * The fields this company invented. An order is where a customer's PO
   * reference first arrives, so it is the document that needs them most, and
   * until now it was the one document that could not carry them.
   */
  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'salesOrder'), [currentCompany]);
  const setCustomField = (key, value) =>
    setForm((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const formRef = useRef(null);
  const savingRef = useRef(false);

  const emptyForm = () => ({ date: new Date().toISOString().slice(0, 10), expectedDate: '', customerId: '', salesmanId: '', notes: '', customFields: {}, items: [{ ...emptyLine }] });
  const openNewOrder = () => { setEditingOrder(null); setForm(emptyForm()); setOpen(true); };
  const openEditOrder = (order) => {
    setEditingOrder(order);
    setForm({
      date: String(order.date || new Date().toISOString()).slice(0, 10), expectedDate: order.expectedDate || '', customerId: String(order.customerId || ''),
      salesmanId: order.salesmanId || '', notes: order.notes || '', customFields: { ...(order.customFields || {}) },
      items: (order.items || []).length ? order.items.map((line) => ({ ...emptyLine, ...line })) : [{ ...emptyLine }],
    });
    setOpen(true);
  };
  const addLine = () => setForm((p) => ({ ...p, items: [...p.items, emptyLine] }));
  const duplicateLine = (idx) =>
    setForm((p) => {
      const items = [...p.items];
      items.splice(idx + 1, 0, { ...items[idx] });
      return { ...p, items };
    });
  const removeLine = (idx) =>
    setForm((p) => (p.items.length > 1 ? { ...p, items: p.items.filter((_, i) => i !== idx) } : p));

  const branchIdForNumbering = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim();
  const orderDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering || null });
  const orderNumbering = orderDocSettings?.numbering?.salesOrder;
  const nextOrderNumber =
    nextFreeVoucherNumber({
      db,
      company: currentCompany,
      voucherKey: 'salesOrder',
      branchId: branchIdForNumbering || null,
      takenNumbers: (db.salesOrders || [])
        .filter((x) => x.companyId === currentCompany.id)
        .map((x) => String(x.number || '').trim()),
    }) || '';
  // Where this was entered from, so the header's scope can find it later.
  const warehouseIdForEntry = String(localStorage.getItem('activeWarehouseId') || '').trim();
  const selectedCustomer = form.customerId ? customers.find((c) => c.id === parseInt(form.customerId)) : null;
  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const { state: customerState } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });

  /*
   * The keyboard the invoice form has had all along.
   *
   * An order was typed with the browser's defaults: Enter submitted a
   * half-filled document from the customer field, the arrows did nothing, and
   * Tab out of the last rate went to the Create button instead of opening the
   * next line. Nothing here is specific to an order — it is the same hook,
   * which this form simply never called.
   */
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: form.items.length,
    addLine,
    duplicateLine,
    removeLine,
    autoFocus: 'input[type="date"]',
  });

  const updateLine = (idx, field, value, picked = null) => {
    setForm((p) => {
      const items = [...p.items];
      if (field === 'itemId') {
        const item = picked || itemsMaster.find((i) => i.id === parseInt(value));
        if (item) {
          // onDate is the order's own date, so a price list that had expired
          // by then does not price it.
          const resolved = resolveSaleRate({ db, companyId, customer: selectedCustomer, itemId: item.id, item, onDate: form.date });
          items[idx] = {
            ...items[idx],
            itemId: value,
            description: item.name,
            rate: resolved.rate,
            gstRate: Number(item.gstRate ?? 0),
            hsnSac: item.hsnSac || '',
            unit: item.unit || '',
          };
        }
      } else {
        items[idx] = { ...items[idx], [field]: value };
      }
      return { ...p, items };
    });
  };

  const computed = computeGstForLines({ lines: form.items, isIntra });

  /** Delivered / billed per SO line come from linked challans and invoices. */
  const progressOf = (order) => {
    const deliveredBy = new Map();
    for (const dc of db.deliveryChallans || []) {
      if (Number(dc.sourceSalesOrderId) !== Number(order.id)) continue;
      for (const l of dc.items || []) {
        const k = String(l.itemId);
        deliveredBy.set(k, (deliveredBy.get(k) || 0) + (Number(l.quantity) || 0));
      }
    }
    const billedBy = new Map();
    for (const inv of db.invoices || []) {
      if (Number(inv.sourceSalesOrderId) !== Number(order.id)) continue;
      if (String(inv.status || '').toLowerCase() === 'cancelled') continue;
      for (const l of inv.items || []) {
        const k = String(l.itemId);
        billedBy.set(k, (billedBy.get(k) || 0) + (Number(l.quantity) || 0));
      }
    }
    let ordered = 0;
    let delivered = 0;
    let billed = 0;
    for (const l of order.items || []) {
      const q = Number(l.quantity) || 0;
      ordered += q;
      delivered += Math.min(q, deliveredBy.get(String(l.itemId)) || 0);
      billed += Math.min(q, billedBy.get(String(l.itemId)) || 0);
    }
    const status =
      billed >= ordered && ordered > 0 ? 'Billed' : delivered >= ordered && ordered > 0 ? 'Delivered' : delivered > 0 || billed > 0 ? 'Partial' : 'Open';
    return { ordered, delivered, billed, status };
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!form.customerId) {
      notify.error('Customer is required');
      return;
    }
    const lines = form.items.filter((l) => String(l.itemId || '').trim());
    if (!lines.length) {
      notify.error('Pick at least one item');
      return;
    }
    const customer = customers.find((c) => c.id === parseInt(form.customerId));
    if (customer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a sales order.');
      return;
    }
    const orderNumber = String(editingOrder?.number || nextOrderNumber || '').trim();
    if (!orderNumber) {
      notify.error('Sales order number is required');
      return;
    }
    savingRef.current = true;

    let backendDocId = null;
    let serverNumber = '';
    if (hasApiSession()) {
      try {
        const payload = {
          number: orderNumber,
          date: form.date,
          expectedDate: form.expectedDate || null,
          partyId: customer?.backendPartyId ? String(customer.backendPartyId) : null,
          partyName: getCustomerDisplayName(customer),
          subtotal: computed.subtotal,
          gstTotal: computed.gstTotal,
          total: computed.total,
          status: 'Open',
          notes: form.notes || null,
          salesmanId: form.salesmanId || undefined,
          items: computed.lines.filter((l) => String(l.itemId || '').trim()),
        };
        const saved = editingOrder?.backendDocId
          ? await updateDocApi('salesOrder', editingOrder.backendDocId, payload)
          : await createDocApi('salesOrder', payload);
        backendDocId = saved?.id || editingOrder?.backendDocId || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        savingRef.current = false;
        notify.error(String(err?.message || 'Sales order not saved to the server.'));
        return;
      }
    }

    const nextId = editingOrder?.id || (db.salesOrders || []).reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;
    const order = {
      ...(editingOrder || {}),
      id: nextId,
      companyId,
      backendDocId,
      /* The configured series is authoritative. The same number is sent to
         the server, so a backend default can never replace it with another
         fiscal-year pattern. */
      number: orderNumber || serverNumber || `SO-${nextId}`,
      date: form.date,
      expectedDate: form.expectedDate || '',
      customerId: form.customerId,
      customerName: getCustomerDisplayName(customer),
      items: computed.lines.filter((l) => String(l.itemId || '').trim()),
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      status: 'Open',
      salesmanId: form.salesmanId || '',
      notes: form.notes,
      customFields: { ...(form.customFields || {}) },
      branchId: branchIdForNumbering || '',
      warehouseId: warehouseIdForEntry || '',
      createdAt: editingOrder?.createdAt || new Date().toISOString(),
      updatedAt: editingOrder ? new Date().toISOString() : undefined,
    };
    setDb((prev) => ({
      ...prev,
      salesOrders: editingOrder
        ? (prev.salesOrders || []).map((row) => String(row.id) === String(editingOrder.id) ? order : row)
        : [...(prev.salesOrders || []), order],
      companies: editingOrder ? prev.companies : bumpCompanyNextNumber({
        db: prev,
        companyId,
        voucherKey: 'salesOrder',
        usedNumber: order.number,
        branchId: branchIdForNumbering || null,
      }),
    }));
    savingRef.current = false;
    setOpen(false);
    setEditingOrder(null);
    setForm(emptyForm());
    notify.success(`Sales order ${order.number} ${editingOrder ? 'updated' : 'created'}.`);
  };

  const deleteOrder = async (order) => {
    const prog = progressOf(order);
    if (prog.delivered > 0 || prog.billed > 0) {
      notify.error('This order already has a challan or invoice and cannot be deleted.');
      return;
    }
    const ok = await confirmDialog({ title: `Delete ${order.number}?`, message: 'This permanently removes the sales order.', confirmLabel: 'Delete' });
    if (!ok) return;
    if (order.backendDocId && hasApiSession()) {
      try { await deleteDocApi('salesOrder', order.backendDocId); }
      catch (err) { notify.error(String(err?.message || 'Sales order was not deleted.')); return; }
    }
    setDb((prev) => ({ ...prev, salesOrders: (prev.salesOrders || []).filter((row) => String(row.id) !== String(order.id)) }));
    notify.success(`Sales order ${order.number} deleted.`);
  };

  const toInvoice = (order) => {
    if (typeof onConvertToInvoice !== 'function') return;
    onConvertToInvoice(order);
  };

  const pendingRows = orders
    .map((o) => ({ order: o, prog: progressOf(o) }))
    .filter(({ prog }) => prog.billed < prog.ordered);

  const soPeriod = usePeriodFilter();
  const soSearch = useListSearch(showPending ? pendingRows.map((r) => r.order) : orders, [
    'number',
    'customerName',
    'date',
    'status',
    'notes',
  ]);
  const soFilters = useColumnFilters();
  const shownAll = soFilters.applyFilters(soSearch.filtered.filter((r) => soPeriod.inRange(r?.date)), {
    number: (r) => r.number,
    date: (r) => r.date,
    customer: (r) => r.customerName,
    total: (r) => r.total,
    status: (r) => r.status,
  });

  /*
   * An order's status is what has actually happened to it, not what somebody
   * typed: delivered and billed are counted from the challans and invoices
   * raised against it. That is why the tabs filter on the derived value.
   */
  const [soStatus, setSoStatus] = useState('');
  const SO_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Open', label: 'Open', tone: 'sent' },
    { value: 'Partial', label: 'Partly done', tone: 'partial' },
    { value: 'Delivered', label: 'Delivered', tone: 'outstanding' },
    { value: 'Billed', label: 'Billed', tone: 'paid' },
  ];
  const shown = soStatus ? shownAll.filter((o) => progressOf(o).status === soStatus) : shownAll;

  /*
   * Five figures about the same book: how many orders, what they are worth,
   * what is still to go out of the door, what has been billed, and what is
   * sitting delivered but not yet invoiced — which is the one that costs money
   * to forget.
   */
  const soHeadline = useMemo(() => {
    let value = 0;
    let open = 0;
    let billed = 0;
    let toBill = 0;
    for (const o of shownAll) {
      const amt = Number(o.total || 0);
      const prog = progressOf(o);
      value += amt;
      if (prog.status === 'Billed') billed += amt;
      else if (prog.status === 'Delivered') toBill += amt;
      else open += amt;
    }
    return { count: shownAll.length, value, open, billed, toBill };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownAll]);

  const soExportColumns = [
    { key: 'number', label: 'SO #' },
    { key: 'date', label: 'Date' },
    { key: 'expectedDate', label: 'Expected' },
    { key: 'customerName', label: 'Customer' },
    { key: 'subtotal', label: 'Taxable', value: (r) => Number(r.subtotal || 0) },
    { key: 'total', label: 'Total', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => progressOf(r).status },
    { key: 'notes', label: 'Notes' },
  ];

  /*
   * The form is a screen, not a panel above the list.
   *
   * It used to render inside the list — cards, tabs and every row still
   * on screen under a half-typed document — which is not how an invoice or
   * a quotation opens, and left the primary action of the list sitting
   * beside the primary action of the form.
   */
  if (open) {
    return (
      <div className="space-y-3">
      {open ? (
        <form
          ref={formRef}
          onKeyDown={onFormKeyDown}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="ui-creation-form ui-card space-y-3 p-3"
        >
          {/* The same bar an invoice carries: the document's name on the left,
              every way out of it on the right, pinned so Create stays reachable
              from the last line. */}
          <DocFormActions
      title={editingOrder ? `Edit Sales Order ${editingOrder.number}` : 'New Sales Order'}
            onBack={() => { setOpen(false); setEditingOrder(null); }}
            sticky
            primaryLabel={editingOrder ? 'Update Sales Order' : 'Create Sales Order'}
          />
          {/*
            The head of the document, in the invoice's two columns: who it is
            for on the left, the paperwork that identifies it on the right,
            ruled off between them. Four fields strung across the top put the
            customer between two dates and read as one undifferentiated band.
          */}
          <FormSection
            icon={ClipboardList}
      title="Basic Details"
            description="Who the order is for, and the paperwork that identifies it."
          >
          <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
            <div className="lg:col-span-6 space-y-4">
              <div>
                <label className="ui-label">Customer</label>
                <CustomerPicker db={db} setDb={setDb} currentCompany={currentCompany} value={form.customerId} onChange={(id) => setForm((p) => ({ ...p, customerId: id }))} label={null} />
              </div>
              {(db.salesmen || []).some((sm) => sm.companyId === companyId) ? (
                <div>
                  <label className="ui-label" htmlFor="so-salesman">Salesman</label>
                  <select
                    id="so-salesman"
                    value={form.salesmanId || ''}
                    onChange={(e) => setForm((p) => ({ ...p, salesmanId: e.target.value ? Number(e.target.value) : '' }))}
                    className="ui-select w-full"
                  >
                    <option value="">— none —</option>
                    {(db.salesmen || []).filter((sm) => sm.companyId === companyId).map((sm) => (
                      <option key={sm.id} value={sm.id}>{sm.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div
              className="lg:col-span-6 space-y-4 lg:ps-6"
              style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* The number this order will take, and the series it comes
                    from — an order numbered only at save is a number nobody
                    can correct until it is too late to. */}
                <DocNumberField
                  className="min-w-0"
                  id="so-number"
                  label="Order No."
                  value={editingOrder?.number || nextOrderNumber}
                  onChange={() => {}}
                  disabled
                  voucherKey="salesOrder"
      title="Order numbering"
                  sampleLabel="Next order will be"
                  manualLabel="Typed on each order"
                  branchId={branchIdForNumbering || null}
                  settings={orderNumbering}
                  db={db}
                  setDb={setDb}
                  currentCompany={currentCompany}
                />
                <div className="min-w-0">
                  <label className="ui-label" htmlFor="so-date">
                    Date <span className="text-[rgb(var(--neg-ink))]">*</span>
                  </label>
                  <input id="so-date" type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="ui-input w-full" required />
                </div>
                <div className="min-w-0">
                  <label className="ui-label" htmlFor="so-expected">Expected delivery</label>
                  <input id="so-expected" type="date" value={form.expectedDate} onChange={(e) => setForm((p) => ({ ...p, expectedDate: e.target.value }))} className="ui-input w-full" />
                </div>
              </div>
              <div>
                <label className="ui-label" htmlFor="so-notes">Ref No.</label>
                <input id="so-notes" type="text" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="ui-input w-full" placeholder="Customer PO ref…" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="header" />
                <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="reference" />
              </div>
            </div>
          </div>

          </FormSection>

          <FormSection
            icon={Package}
      title="Line Items"
            description="What the customer has ordered."
            action={
              <button type="button" onClick={addLine} className="ui-btn ui-btn-secondary">
                <Plus size={16} aria-hidden="true" /> Add Item
              </button>
            }
          >
            <div className="border rounded-lg overflow-hidden">
              <table className="ui-table ui-grid-dense w-full ui-table-wide">
                <thead className="ui-sunken">
                  <tr>
                    <th className="ui-th text-left w-[28%]">Item</th>
                    <th className="ui-th text-left w-[22%]">Description</th>
                    <th className="ui-th ui-num w-[8%]">
                      Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                    </th>
                    <th className="ui-th text-left w-[7%]">Unit</th>
                    <th className="ui-th ui-num w-[12%]">
                      Rate (₹) <span className="text-[rgb(var(--neg-ink))]">*</span>
                    </th>
                    <th className="ui-th ui-num w-[8%]">Disc %</th>
                    <th className="ui-th ui-num w-[8%]">Tax %</th>
                    <th className="ui-th ui-num w-[13%]">Amount (₹)</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((l, idx) => (
                    <tr key={idx} className="border-t" data-line-row={idx}>
                      <td className="ui-col-meta px-3 py-2">
                        <ItemPicker db={db} setDb={setDb} currentCompany={currentCompany} value={l.itemId} onChange={(id, picked) => updateLine(idx, 'itemId', id, picked)} label={null} />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={l.description}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          className="ui-input w-full min-w-0 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="1" value={l.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1 text-right" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" value={l.unit || ''} onChange={(e) => updateLine(idx, 'unit', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={l.rate} onChange={(e) => updateLine(idx, 'rate', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1 text-right" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" max="100" step="0.01" value={l.discountPct ?? 0} onChange={(e) => updateLine(idx, 'discountPct', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1 text-right" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={l.gstRate ?? 0} onChange={(e) => updateLine(idx, 'gstRate', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1 text-right" />
                      </td>
                      <td className="ui-col-amount px-3 py-2 text-right">{formatMoney(computed.lines[idx]?.lineTotal || 0, currentCompany)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          disabled={form.items.length === 1}
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

          {/* The next row, rather than a button adrift under the table. */}
          <div
            className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-2.5"
            style={{ borderColor: 'rgb(var(--brand) / 0.4)', backgroundColor: 'rgb(var(--brand) / 0.04)' }}
          >
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: 'rgb(var(--brand-ink))' }}
            >
              <Plus size={16} aria-hidden="true" /> Add another item
            </button>
            <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
          </div>
          </FormSection>

          <FormSection icon={Calculator} title="Summary">
          <div className="flex items-start justify-end gap-4">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="ui-money">{formatMoney(computed.subtotal, currentCompany)}</span>
              </div>
              {computed.cgstTotal > 0 ? (
                <div className="flex justify-between">
                  <span>CGST</span>
                  <span className="ui-money">{formatMoney(computed.cgstTotal, currentCompany)}</span>
                </div>
              ) : null}
              {computed.sgstTotal > 0 ? (
                <div className="flex justify-between">
                  <span>SGST</span>
                  <span className="ui-money">{formatMoney(computed.sgstTotal, currentCompany)}</span>
                </div>
              ) : null}
              {computed.igstTotal > 0 ? (
                <div className="flex justify-between">
                  <span>IGST</span>
                  <span className="ui-money">{formatMoney(computed.igstTotal, currentCompany)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="ui-money">{formatMoney(computed.total, currentCompany)}</span>
              </div>
            </div>
          </div>

          </FormSection>

          <AmountInWordsBand words={amountInWordsInr(computed.total)} />

          {hasCustomFieldsAt(customFields, 'notes') ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="notes" />
            </div>
          ) : null}

          <DocFormFootnote />

          {/* The figure and the line count, kept on screen while the lines are
              typed — the same running total the invoice carries. */}
          <div className="ui-entry-summary">
            <span className="ui-t-label">Total</span>
            <span className="ui-money-lg">{formatMoney(computed.total, currentCompany)}</span>
            <span className="ui-caption">
              {form.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
              {computed.gstTotal > 0 ? ` · ${formatMoney(computed.gstTotal, currentCompany)} GST` : ''}
            </span>
          </div>
        </form>
      ) : null}
      </div>
    );
  }

  return (
    <DocumentListShell
      entity="salesOrder"
      className="sales-list-page"
      title="Sales Orders"
      company={currentCompany}
      search={{
        before: <select value={soStatus} onChange={(event) => setSoStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Sales order status">{SO_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: soSearch.query,
        onChange: soSearch.setQuery,
        placeholder: 'Search sales orders…',
        label: 'Search sales orders',
      }}
      headerExtras={
        /* Not a filter tab: pending is "still owing the customer something",
           which cuts across every status tab beside it. */
        <button
          type="button"
          onClick={() => setShowPending((v) => !v)}
          aria-pressed={showPending}
          className={`ui-btn ${showPending ? 'ui-btn-primary' : 'ui-btn-secondary'}`}
        >
          Pending orders ({pendingRows.length})
        </button>
      }
      moreItems={[exportMenuItem('Export sales orders')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Sales orders',
          fileName: `SalesOrders_${currentCompany?.name || 'company'}`,
          label: 'sales order(s)',
          columns: soExportColumns,
          rows: shown,
        });
      }}
      primary={
        <button type="button" onClick={openNewOrder} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Sales Order
        </button>
      }
      cards={[
        { label: 'Orders', value: soHeadline.count, count: true, tone: 'draft', Icon: ClipboardList },
        { label: 'Order value', value: soHeadline.value, tone: 'sent', Icon: FileText },
        { label: 'Still to deliver', value: soHeadline.open, tone: 'outstanding', Icon: Package },
        { label: 'Delivered, to bill', value: soHeadline.toBill, tone: 'partial', Icon: Truck },
        { label: 'Billed', value: soHeadline.billed, tone: 'paid', Icon: Receipt },
      ]}
      denseCards
    >


      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                {/* Eight columns, and the row below renders eight cells. The
                    branch had a seven-column header — SO #, Date, Customer,
                    Amount, a combined Ordered/Delivered/Billed, Status,
                    Actions — which no longer describes what the row shows. */}
                <ColumnHeader label="Sales Order No." col="number" state={soFilters} />
                <ColumnHeader label="Order Date" col="date" state={soFilters} />
                <th scope="col">Expected Date</th>
                <ColumnHeader label="Customer Name" col="customer" state={soFilters} />
                <th scope="col" className="ui-num">Taxable Amount (₹)</th>
                <ColumnHeader label="Total Amount (₹)" col="total" state={soFilters} className="ui-num" align="right" />
                <ColumnHeader label="Status" col="status" state={soFilters} align="center" />
                <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan="8">
                    <EmptyState
                      icon={ClipboardList}
                      kind="new"
      title={showPending ? 'Nothing pending' : 'No sales orders'}
                      description={
                        showPending
                          ? 'Every order here has been delivered and billed.'
                          : 'A sales order is a customer’s yes — held here until the goods go out and the invoice follows.'
                      }
                      routes={
                        showPending
                          ? undefined
                          : [
                              {
                                label: 'Take an order now',
                                description: 'Pick a customer, enter what they ordered, set the expected date.',
                                onSelect: openNewOrder,
                              },
                              {
                                label: 'Start from a quotation',
                                description: 'Convert a quote the customer has accepted.',
                                onSelect: openNewOrder,
                              },
                            ]
                      }
                    />
                  </td>
                </tr>
              ) : (
                shown.map((o) => {
                const prog = progressOf(o);
                return (
                  <tr key={o.id}>
                    <td className="ui-col-id"><DocumentNumber value={o.number} label="sales order" /></td>
                    <td className="ui-col-date"><SalesDate value={o.date} /></td>
                    <td className="ui-col-date">{o.expectedDate ? <DueDate value={o.expectedDate} /> : '—'}</td>
                    <td className="ui-col-entity">{o.customerName}</td>
                    <td className="ui-col-amount"><MoneyValue value={o.subtotal} company={currentCompany} /></td>
                    <td className="ui-col-amount"><MoneyValue value={o.total} company={currentCompany} /></td>
                    <td className="whitespace-nowrap"><StatusPill status={prog.status} /></td>
                    <td className="ui-action-col">
                      <div className="inline-flex">
                        <SalesOrderRowActions
                          order={o}
                          progress={prog}
                          onEdit={() => openEditOrder(o)}
                          onInvoice={() => toInvoice(o)}
                          onPrint={() => setPreviewOrder(o)}
                          onDelete={() => deleteOrder(o)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
              )}
            </tbody>
          </table>
        </div>
        <TableTotals
          count={shown.length}
          totalCount={orders.length}
          noun="sales orders"
          figures={[{ label: 'Value', value: formatMoney(shown.reduce((t, r) => t + Number(r.total || 0), 0), currentCompany) }]}
        />

      {previewOrder ? (
        <Modal
          title={`Sales Order ${previewOrder.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewOrder(null)}
        >
          <PrintDownloadFrame
      title={`Sales Order ${previewOrder.number || ''}`.trim()}
            fileBase={previewOrder.number || 'sales-order'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="SALES ORDER"
              doc={previewOrder}
              party={customers.find((c) => String(c.id) === String(previewOrder.customerId)) || null}
              partyLabel="Customer"
              metaRows={[{ label: 'Expected delivery', value: previewOrder.expectedDate }]}
              sideRows={[
                { label: 'Status', value: progressOf(previewOrder).status },
                { label: 'Ordered', value: String(progressOf(previewOrder).ordered) },
                { label: 'Delivered', value: String(progressOf(previewOrder).delivered) },
                { label: 'Billed', value: String(progressOf(previewOrder).billed) },
              ]}
              footNote="This is a confirmed order, not a tax invoice. Goods will be despatched against a delivery challan."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
}

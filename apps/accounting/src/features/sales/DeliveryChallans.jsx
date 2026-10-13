import React, { useMemo, useRef, useState } from 'react';
import { Download, FileText, Package, Plus, Printer, Receipt, Trash2, Truck, Wrench } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import Modal from '@ui/components/ui/Modal';
import { notify } from '@ui/components/ui/notify';
import { createDeliveryChallan, updateDeliveryChallan } from '@ui/api/masters';
import ItemPicker from '../../components/pickers/ItemPicker';
import CustomerPicker from '../../components/pickers/CustomerPicker';
import EwbTransportForm from '@ui/components/EwbTransportForm';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { formatMoney } from '@ui/utils/money';
import { buildEwayBillPayload } from '@ui/utils/einvoice';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import DocNumberField from '@ui/components/DocNumberField';
import { useListSearch } from '@ui/components/ListToolbar';
import { usePeriodFilter } from '@ui/components/ListControls';
import { DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import DocumentPrintView from '@ui/components/DocumentPrintView';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { DocumentNumber, SalesDate, DueDate, MoneyValue, SalesBalance } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * Delivery challans — goods leaving without (yet) an invoice: job work,
 * supply on approval, branch/own use. Numbered DC-1, DC-2… per company.
 * "Convert to invoice" hands the challan to the invoice editor via
 * onConvert(challan) so billing reuses the standard invoice flow.
 */
export default function DeliveryChallans({ db, setDb, currentCompany, onConvert }) {
  const companyId = currentCompany.id;
  const dcFilters = useColumnFilters();
  const dcPeriod = usePeriodFilter();
  const dcSearch = useListSearch(
    (Array.isArray(db.deliveryChallans) ? db.deliveryChallans : []).filter((c) => c.companyId === companyId),
    ['number', 'customerName', 'purpose', 'date', 'status', 'vehicleNo']
  );
  const challans = useMemo(
    () =>
      dcFilters.applyFilters(
        dcSearch.filtered
          .filter((r) => dcPeriod.inRange(r?.date))
          .slice()
          .sort((a, b) => String(b.date).localeCompare(String(a.date))),
        {
          number: (r) => r.number,
          date: (r) => r.date,
          customer: (r) => r.customerName,
          purpose: (r) => r.purpose,
          value: (r) => r.value,
          status: (r) => r.status,
        }
      ),
    // The two period dates are dependencies, not the hook object: the object is
    // new on every render, and memoising on it would defeat the memo entirely.
    // Without them the list simply would not recompute when the period changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dcSearch.filtered, dcFilters.applyFilters, dcPeriod.dateFrom, dcPeriod.dateTo]
  );

  /*
   * A challan is out, or it has become an invoice. Those are the only two
   * things it can be, and the difference is the one somebody scans this list
   * for: goods that left and were never billed.
   */
  const [dcStatus, setDcStatus] = useState('');
  const DC_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Open', label: 'Out, not billed', tone: 'outstanding' },
    { value: 'Invoiced', label: 'Invoiced', tone: 'paid' },
  ];
  const challansShown = dcStatus ? challans.filter((c) => String(c.status || 'Open') === dcStatus) : challans;

  /*
   * The figures a challan list is read for: how much has gone out of the door,
   * how much of it is still unbilled — money the business has delivered and not
   * yet asked for — and how much has become invoices.
   */
  const dcHeadline = useMemo(() => {
    let value = 0;
    let unbilled = 0;
    let invoiced = 0;
    let jobWork = 0;
    for (const c of challans) {
      const amt = Number(c.value || 0);
      value += amt;
      if (String(c.status || 'Open') === 'Invoiced') invoiced += amt;
      else unbilled += amt;
      if (String(c.purpose || '') === 'Job Work') jobWork += amt;
    }
    return { count: challans.length, value, unbilled, invoiced, jobWork };
  }, [challans]);

  const dcExportColumns = [
    { key: 'number', label: 'DC #' },
    { key: 'date', label: 'Date' },
    { key: 'customerName', label: 'Customer' },
    { key: 'purpose', label: 'Purpose' },
    { key: 'vehicleNo', label: 'Vehicle' },
    { key: 'value', label: 'Value', value: (r) => Number(r.value || 0) },
    { key: 'status', label: 'Status' },
  ];

  const [open, setOpen] = useState(false);
  const [previewChallan, setPreviewChallan] = useState(null);
  const emptyLine = { itemId: '', description: '', quantity: 1, rate: 0, unit: '' };
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    purpose: 'Job Work',
    vehicleNo: '',
    notes: '',
    customFields: {},
    items: [emptyLine],
  });

  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'deliveryChallan'), [currentCompany]);
  const setCustomField = (key, value) =>
    setForm((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const formRef = useRef(null);
  const addLine = () => setForm((p) => ({ ...p, items: [...p.items, emptyLine] }));
  const duplicateLine = (idx) =>
    setForm((p) => {
      const items = [...p.items];
      items.splice(idx + 1, 0, { ...items[idx] });
      return { ...p, items };
    });
  const removeLine = (idx) =>
    setForm((p) => (p.items.length > 1 ? { ...p, items: p.items.filter((_, i) => i !== idx) } : p));

  /*
   * The same keyboard as the invoice. A challan is typed at a loading bay
   * against a lorry that is waiting, which is the worst place to discover that
   * Enter submits the document.
   */
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: form.items.length,
    addLine,
    duplicateLine,
    removeLine,
    autoFocus: 'input[type="date"]',
  });

  const customers = (db.customers || []).filter((c) => c.companyId === companyId);
  const itemsMaster = (db.items || []).filter((i) => i.companyId === companyId);

  /* The series this challan is numbered from, and the number it will take. */
  const challanBranchId = String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim();
  const challanNumbering = getDocSettings(db, currentCompany, { branchId: challanBranchId || null })?.numbering?.deliveryChallan;
  const nextChallanNumber =
    nextFreeVoucherNumber({
      db,
      company: currentCompany,
      voucherKey: 'deliveryChallan',
      branchId: challanBranchId || null,
      takenNumbers: (db.deliveryChallans || [])
        .filter((x) => x.companyId === companyId)
        .map((x) => String(x.number || '').trim()),
    }) || '';

  const updateLine = (idx, field, value, picked = null) => {
    setForm((p) => {
      const items = [...p.items];
      if (field === 'itemId') {
        const item = picked || itemsMaster.find((i) => i.id === parseInt(value));
        if (item) items[idx] = { ...items[idx], itemId: value, description: item.name, rate: Number(item.salePrice || 0), unit: item.unit || '', hsnSac: item.hsnSac || '' };
      } else {
        items[idx] = { ...items[idx], [field]: value };
      }
      return { ...p, items };
    });
  };

  const save = async () => {
    if (!form.customerId) {
      notify.error('Customer is required');
      return;
    }
    if (!form.items.some((l) => String(l.itemId || '').trim())) {
      notify.error('Pick at least one item');
      return;
    }
    const nextId = (db.deliveryChallans || []).reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    const customer = customers.find((c) => c.id === parseInt(form.customerId));
    if (customer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a delivery challan.');
      return;
    }
    const lines = form.items
      .filter((l) => String(l.itemId || '').trim())
      .map((l) => ({ ...l, quantity: Number(l.quantity) || 1, rate: Number(l.rate) || 0 }));
    const challan = {
      id: nextId,
      companyId,
      number:
        nextFreeVoucherNumber({db,
          company: currentCompany,
          voucherKey: 'deliveryChallan',
          branchId: String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim() || null, takenNumbers: (db.deliveryChallans || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || `DC-${nextId}`,
      date: form.date,
      customerId: form.customerId,
      customerName: getCustomerDisplayName(customer),
      purpose: form.purpose,
      vehicleNo: form.vehicleNo.trim(),
      notes: form.notes.trim(),
      customFields: { ...(form.customFields || {}) },
      items: lines,
      value: lines.reduce((s, l) => s + l.quantity * l.rate, 0),
      status: 'Open',
      // Where this was entered from, so the header's scope can find it later.
      branchId: String(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '').trim(),
      warehouseId: String(localStorage.getItem('activeWarehouseId') || '').trim(),
      createdAt: new Date().toISOString(),
    };
    /*
     * Write through to the server, then keep the id it gives back.
     *
     * A challan is a document under Rule 55 — it travels with the goods, an
     * e-way bill is raised against it, and it may have to be produced. Holding
     * it in one browser meant it did not exist anywhere else, and the guard
     * that stops a consignment being billed twice went with it.
     *
     * A refused write is not fatal: the challan stays on this device so the
     * goods can leave, and the message says the server did not take it.
     */
    let serverPatch = {};
    try {
      const created = await createDeliveryChallan({
        date: challan.date,
        partyId: challan.customerId ? String(challan.customerId) : undefined,
        partyName: challan.customerName || 'Customer',
        purpose: String(challan.purpose || 'SUPPLY').toUpperCase().replace(/[^A-Z]+/g, '_'),
        warehouseId: challan.warehouseId || undefined,
        subtotal: challan.value,
        total: challan.value,
        status: 'Open',
        notes: challan.notes || undefined,
        items: challan.items,
        vehicleNo: challan.vehicleNo || undefined,
      });
      const doc = created?.doc || created?.document;
      if (doc?.id) serverPatch = { backendDocId: String(doc.id), number: doc.number || challan.number };
    } catch (e) {
      notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    }

    setDb((prev) => ({ ...prev, deliveryChallans: [...(prev.deliveryChallans || []), { ...challan, ...serverPatch }] }));
    setOpen(false);
    setForm({ date: new Date().toISOString().slice(0, 10), customerId: '', purpose: 'Job Work', vehicleNo: '', notes: '', customFields: {}, items: [emptyLine] });
    notify.success(`Delivery challan ${challan.number} created.`);
  };

  // Status flips to Invoiced when the invoice actually saves — the invoice
  // form owns that via sourceChallanId; converting just opens the editor.
  const convert = (challan) => {
    if (typeof onConvert !== 'function') return;
    onConvert(challan);
  };

  const [ewbFor, setEwbFor] = useState(null); // challan getting an e-way bill

  const downloadJson = (filename, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateChallanEwb = (challan, transport) => {
    if (!String(currentCompany?.gstin || '').trim()) {
      notify.error('Set the company GSTIN before generating e-way bill JSON.');
      return;
    }
    const customer = customers.find((c) => c.id === parseInt(challan.customerId)) || {};
    // A challan is a document with lines and a value but no GST split —
    // present it to the builder in the invoice shape it expects.
    const pseudoDoc = {
      number: challan.number,
      date: challan.date,
      customerName: challan.customerName,
      items: challan.items.map((l) => ({ ...l, taxableAmount: (Number(l.quantity) || 1) * (Number(l.rate) || 0), gstRate: 0 })),
      subtotal: challan.value,
      total: challan.value,
      cgstTotal: 0,
      sgstTotal: 0,
      igstTotal: 0,
    };
    downloadJson(
      `EWB_${challan.number}.json`,
      buildEwayBillPayload({
        invoice: pseudoDoc,
        company: currentCompany,
        customer,
        transport,
        docType: 'CHL',
        // NIC sub-supply: 4 = job work; 8 = others (approval, own use…)
        subSupplyType: challan.purpose === 'Job Work' ? '4' : '8',
      })
    );
    if (challan.backendDocId) {
      // The e-way bill number belongs on the record, not only on this device.
      updateDeliveryChallan(challan.backendDocId, { ewayBillNo: transport?.ewbNo || undefined }).catch(() => {});
    }
    setDb((prev) => ({
      ...prev,
      deliveryChallans: (prev.deliveryChallans || []).map((c) => (c.id === challan.id ? { ...c, ewbTransport: transport } : c)),
    }));
    setEwbFor(null);
    notify.success(`e-Way Bill JSON for ${challan.number} downloaded — upload via the e-way bill bulk tool.`);
  };

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
          className="ui-creation-form ui-card p-3 space-y-3"
        >
          <DocFormActions
      title="New Delivery Challan"
            primaryLabel="Create Challan"
            onPrimary={save}
            secondaryLabel="Cancel"
            onSecondary={() => setOpen(false)}
          />
          {/*
            The head of the document, in the invoice's two columns: who the
            goods are going to on the left, the paperwork that identifies the
            movement on the right, ruled off between them.
          */}
          <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
            <div className="lg:col-span-6 space-y-4">
              <div>
                <label className="ui-label">Customer</label>
                <CustomerPicker db={db} setDb={setDb} currentCompany={currentCompany} value={form.customerId} onChange={(id) => setForm((p) => ({ ...p, customerId: id }))} label={null} />
              </div>
              <div>
                <label className="ui-label" htmlFor="dc-purpose">Purpose</label>
                <select id="dc-purpose" value={form.purpose} onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))} className="ui-select w-full">
                  <option>Job Work</option>
                  <option>Supply on Approval</option>
                  <option>Own Use / Branch</option>
                  <option>Exhibition</option>
                </select>
                <p className="ui-caption mt-1">Rule 55 — why goods move without a sale.</p>
              </div>
            </div>

            <div
              className="lg:col-span-6 space-y-4 lg:ps-6"
              style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* The number it will take, and the series behind it. */}
                <DocNumberField
                  className="min-w-0"
                  id="dc-number"
                  label="Challan No."
                  value={nextChallanNumber}
                  onChange={() => {}}
                  disabled
                  voucherKey="deliveryChallan"
      title="Challan numbering"
                  sampleLabel="Next challan will be"
                  manualLabel="Typed on each challan"
                  branchId={challanBranchId || null}
                  settings={challanNumbering}
                  db={db}
                  setDb={setDb}
                  currentCompany={currentCompany}
                />
                <div className="min-w-0">
                  <label className="ui-label" htmlFor="dc-date">
                    Date <span className="text-[rgb(var(--neg-ink))]">*</span>
                  </label>
                  <input id="dc-date" type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="ui-input w-full" required />
                </div>
                <div className="min-w-0">
                  <label className="ui-label" htmlFor="dc-vehicle">Vehicle No</label>
                  <input id="dc-vehicle" type="text" value={form.vehicleNo} onChange={(e) => setForm((p) => ({ ...p, vehicleNo: e.target.value }))} className="ui-input ui-mono w-full" placeholder="KA01AB1234" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="header" />
                <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="reference" />
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
                    <th className="ui-th text-left w-[30%]">Item</th>
                    <th className="ui-th text-left w-[26%]">Description</th>
                    <th className="ui-th ui-num w-[10%]">
                      Qty <span className="text-[rgb(var(--neg-ink))]">*</span>
                    </th>
                    <th className="ui-th text-left w-[9%]">Unit</th>
                    <th className="ui-th ui-num w-[12%]">Rate (₹)</th>
                    <th className="ui-th ui-num w-[13%]">Value (₹)</th>
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
                        <input type="text" value={l.description || ''} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="ui-input w-full min-w-0 px-2 py-1" />
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
                      <td className="ui-col-amount px-3 py-2 text-right">
                        {formatMoney((Number(l.quantity) || 0) * (Number(l.rate) || 0), currentCompany)}
                      </td>
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
          </div>

          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={addLine} className="ui-btn ui-btn-secondary">
              <Plus size={16} aria-hidden="true" /> Add Item
            </button>
            <span className="ui-subtle text-xs">or press Tab in the last field of the last row</span>
          </div>

          {hasCustomFieldsAt(customFields, 'notes') ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DocumentCustomFields fields={customFields} values={form.customFields} onChange={setCustomField} where="notes" />
            </div>
          ) : null}

          <DocFormFootnote />

          <div className="ui-entry-summary">
            <span className="ui-t-label">Goods value</span>
            <span className="ui-money-lg">
              {formatMoney(form.items.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0), currentCompany)}
            </span>
            <span className="ui-caption">
              {form.items.filter((l) => String(l.itemId || '').trim()).length} line(s) · what the consignment is insured for, not a tax total
            </span>
          </div>
        </form>
      ) : null}
      </div>
    );
  }

  return (
    <DocumentListShell
      entity="deliveryChallan"
      className="sales-list-page"
      title="Delivery Challans"
      company={currentCompany}
      search={{
        before: <select value={dcStatus} onChange={(event) => setDcStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Challan status">{DC_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: dcSearch.query,
        onChange: dcSearch.setQuery,
        placeholder: 'Search challans…',
        label: 'Search challans',
      }}
      moreItems={[exportMenuItem('Export challans')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Challans',
          fileName: `DeliveryChallans_${currentCompany?.name || 'company'}`,
          label: 'challan(s)',
          columns: dcExportColumns,
          rows: challansShown,
        });
      }}
      primary={
        <button type="button" onClick={() => setOpen(true)} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Challan
        </button>
      }
      cards={[
        { label: 'Challans', value: dcHeadline.count, count: true, tone: 'draft', Icon: Truck },
        { label: 'Goods sent out', value: dcHeadline.value, tone: 'sent', Icon: Package },
        { label: 'Out, not billed', value: dcHeadline.unbilled, tone: 'outstanding', Icon: FileText },
        { label: 'Invoiced', value: dcHeadline.invoiced, tone: 'paid', Icon: Receipt },
        { label: 'On job work', value: dcHeadline.jobWork, tone: 'partial', Icon: Wrench },
      ]}
      denseCards


    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <ColumnHeader label="DC #" col="number" state={dcFilters} />
                <ColumnHeader label="Date" col="date" state={dcFilters} align="center" />
                <ColumnHeader label="Customer" col="customer" state={dcFilters} />
                <ColumnHeader label="Purpose" col="purpose" state={dcFilters} />
                <ColumnHeader label="Goods value" col="value" state={dcFilters} className="ui-num" align="right" />
                <ColumnHeader label="Status" col="status" state={dcFilters} align="center" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {challansShown.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <EmptyState
                      icon={Truck}
                      kind="new"
      title="No delivery challans"
                      description="A challan is goods leaving the premises before there is an invoice — job work, approval, your own branch."
                      routes={[
                        {
                          label: 'Send goods out now',
                          description: 'Pick a customer, list what is going, note the vehicle.',
                          onSelect: () => setOpen(true),
                        },
                        {
                          label: 'Against a sales order',
                          description: 'Despatch what a confirmed order still owes.',
                          onSelect: () => setOpen(true),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ) : (
              challansShown.map((c) => (
                <tr key={c.id}>
                  <td className="ui-col-id"><DocumentNumber value={c.number} label="challan" /></td>
                  <td className="ui-col-date"><SalesDate value={c.date} /></td>
                  <td className="ui-col-entity">{c.customerName}</td>
                  <td className="ui-col-meta">{c.purpose}</td>
                  <td className="ui-col-amount"><MoneyValue value={c.value} company={currentCompany} /></td>
                  <td className="whitespace-nowrap"><StatusPill status={c.status} /></td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewChallan(c)}
                        aria-label={`Print challan ${c.number}`}
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
                      >
                        <Printer size={14} aria-hidden="true" /> Print
                      </button>
                      <button type="button" onClick={() => setEwbFor(c)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                        e-Way Bill
                      </button>
                      {c.status === 'Open' ? (
                        <button type="button" onClick={() => convert(c)} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                          Convert to Invoice
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
        </table>
      </div>
      <TableTotals
        count={challansShown.length}
        totalCount={dcSearch.filtered.length}
        noun="challans"
        figures={[{ label: 'Goods value', value: formatMoney(challansShown.reduce((t, r) => t + Number(r.value || 0), 0), currentCompany) }]}
      />

      {previewChallan ? (
        <Modal
          title={`Delivery Challan ${previewChallan.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewChallan(null)}
        >
          <PrintDownloadFrame
      title={`Delivery Challan ${previewChallan.number || ''}`.trim()}
            fileBase={previewChallan.number || 'delivery-challan'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="DELIVERY CHALLAN"
              doc={{ ...previewChallan, subtotal: previewChallan.value, total: previewChallan.value }}
              party={customers.find((c) => String(c.id) === String(previewChallan.customerId)) || null}
              partyLabel="Consignee"
              metaRows={[{ label: 'Purpose', value: previewChallan.purpose }]}
              sideRows={[
                { label: 'Vehicle no.', value: previewChallan.vehicleNo },
                { label: 'E-way bill', value: previewChallan.ewbTransport?.ewbNo },
              ]}
              footNote="Delivery challan under Rule 55 of the CGST Rules. Not a tax invoice — no GST is charged on this document."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}

      {ewbFor ? (
        <Modal onClose={() => setEwbFor(null)} title={`e-Way Bill — ${ewbFor.number}`} maxWidthClass="max-w-2xl">
          <EwbTransportForm
            submitLabel="Download EWB JSON"
            onCancel={() => setEwbFor(null)}
            onSubmit={(t) => generateChallanEwb(ewbFor, t)}
          />
        </Modal>
      ) : null}
    </DocumentListShell>
  );
}

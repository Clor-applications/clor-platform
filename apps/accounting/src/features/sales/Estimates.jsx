import { useEffect, useMemo, useRef, useState } from 'react';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useListSearch } from '@ui/components/ListToolbar';
import { plusDaysIso, todayIso } from '@ui/utils/dates';
import { InvoiceForm } from './InvoiceForm';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Ban, ClipboardList, Copy, FileText, MoreVertical, Plus, Printer, Receipt, Settings2, Tag, Trash2 } from 'lucide-react';
import { PermissionButton } from '@ui/permissions/ActionGuard';
import { DateCell, DueDateCell, InvoiceIdentifier, Money } from '@ui/components/table/cells';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import { amountInWordsInr, formatMoney } from '@ui/utils/money';
import Modal from '@ui/components/ui/Modal';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import DocumentPrintView from '@ui/components/DocumentPrintView';
import { selectedBranchId } from '@platform/context';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { computeGstForLine, computeGstForLines, getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { getCustomerDisplayName } from '@ui/utils/contacts';
import { createDocApi, hasApiSession as hasDocsApiSession } from '@ui/api/purchaseDocs';
import { getNextNumericId } from '@ui/utils/ids';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { AmountInWordsBand, DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import CustomerPicker from '../../components/pickers/CustomerPicker';
import DocNumberField from '@ui/components/DocNumberField';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import ItemPicker from '../../components/pickers/ItemPicker';

export const EstimatesList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  onNavigate,
  onNewEstimate,
  onEditEstimate,
  onConvertToInvoice,
  warehouses = [],
  /* Handed on to a document form opened from this list, so it can ask which
     branch the document belongs to. */
  branches = [],
  defaultWarehouseId = '',
}) => {
  const [openMenu, setOpenMenu] = useState(null);
  const [previewEstimate, setPreviewEstimate] = useState(null);
  const menuRef = useRef(null);

  const warehouseById = useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const estFilters = useColumnFilters();
  const estPeriod = usePeriodFilter();
  const estSearch = useListSearch(
    db.estimates.filter((e) => e.companyId === currentCompany.id),
    ['number', 'customerName', 'refNo', 'date'],
    'estimates'
  );

  // What is hiding rows right now, in the user's words. Without this an empty
  // list says "none yet" to someone who has simply filtered them all away.
  const estFilterChips = useMemo(() => {
    const chips = [];
    if (String(estSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(estSearch.query).trim(), onRemove: () => estSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(estFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => estFilters.clearColumn(key) });
    }
    return chips;
  }, [estSearch, estFilters]);
  /*
   * What a quotation is, right now.
   *
   * The stored status stops at what somebody last typed, so a quote whose
   * expiry has passed still read as Sent — and a list of quotes exists to show
   * which are live and which have lapsed. Converted wins over everything: once
   * it is an invoice, nothing about the quote is open any more.
   */
  const [estStatus, setEstStatus] = useState('');
  const estStatusOf = (e) => {
    const converted = e?.convertedInvoiceId !== undefined && e?.convertedInvoiceId !== null && e?.convertedInvoiceId !== '';
    if (converted || String(e?.status || '') === 'Converted') return 'Converted';
    const stored = String(e?.status || 'Draft');
    if (stored === 'Cancelled' || stored === 'Expired') return stored;
    const expiry = String(e?.dueDate || e?.expiryDate || '').slice(0, 10);
    if (expiry && expiry < todayIso() && stored !== 'Draft') return 'Expired';
    return stored;
  };

  const EST_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Draft', label: 'Draft', tone: 'draft' },
    { value: 'Sent', label: 'Sent', tone: 'sent' },
    { value: 'Accepted', label: 'Accepted', tone: 'outstanding' },
    { value: 'Converted', label: 'Converted', tone: 'paid' },
    { value: 'Expired', label: 'Expired', tone: 'cancelled' },
  ];

  const estimatesAll = estFilters.applyFilters(
    estSearch.filtered
      .filter((r) => estPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      customer: (r) => r.customerName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || r?.warehouseId || '',
      date: (r) => r.date,
      due: (r) => r.dueDate || r.expiryDate,
      total: (r) => r.total,
    }
  );

  const estimates = estStatus ? estimatesAll.filter((e) => estStatusOf(e) === estStatus) : estimatesAll;

  /*
   * Four figures, each answering a different question about the same book: how
   * many quotes there are, what they add up to, how much of that is still live,
   * and how much has already turned into invoices. A quote that expired is out
   * of the open figure — it is not money anybody is waiting on.
   */
  const estHeadline = useMemo(() => {
    let value = 0;
    let open = 0;
    let converted = 0;
    let expired = 0;
    for (const e of estimatesAll) {
      const amt = Number(e.total || 0);
      const st = estStatusOf(e);
      value += amt;
      if (st === 'Converted') converted += amt;
      else if (st === 'Expired' || st === 'Cancelled') expired += amt;
      else open += amt;
    }
    return { count: estimatesAll.length, value, open, converted, expired };
  }, [estimatesAll]);

  const MENU_WIDTH = 224; // w-56
  const MENU_HEIGHT_ESTIMATE = 240;

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-estimate-menu-button]');
      if (btn && String(btn.getAttribute('data-estimate-menu-button')) === String(openMenu.id)) return;
      setOpenMenu(null);
    };

    const onScrollOrResize = () => setOpenMenu(null);

    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [openMenu?.id]);

  const openNewEstimate = () => {
    if (typeof onNewEstimate === 'function') {
      onNewEstimate();
      return;
    }
    openModal(
      <EstimateForm db={db} setDb={setDb} currentCompany={currentCompany} onClose={() => openModal(null)} />,
      { title: 'New Quotation', maxWidthClass: 'max-w-5xl' }
    );
  };

  const openEditEstimate = (estimate) => {
    if (typeof onEditEstimate === 'function') {
      onEditEstimate(estimate);
      return;
    }
    openModal(
      <EstimateForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={estimate}
        onClose={() => openModal(null)}
      />,
      { title: 'Edit Quotation', maxWidthClass: 'max-w-5xl' }
    );
  };

  const duplicateEstimate = (estimate) => {
    const copyEstimate = {
      ...estimate,
      id: undefined,
      number: '',
      date: undefined,
      dueDate: undefined,
      status: 'Draft',
      createdAt: undefined,
      updatedAt: undefined,
      convertedInvoiceId: null,
      convertedAt: undefined,
    };

    if (Array.isArray(copyEstimate.items)) {
      copyEstimate.items = copyEstimate.items.map((l) => ({
        itemId: l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '',
        description: l?.description ?? '',
        quantity: Number(l?.quantity ?? 1),
        rate: Number(l?.rate ?? 0),
        gstRate: Number(l?.gstRate ?? 0),
        hsnSac: l?.hsnSac || '',
        amount: Number(l?.amount ?? 0),
      }));
    }

    openEditEstimate(copyEstimate);
  };

  const convertToInvoice = (estimate) => {
    if (typeof onConvertToInvoice === 'function') {
      onConvertToInvoice(estimate);
      return;
    }

    const initialInvoice = {
      status: 'Draft',
      date: estimate?.date || undefined,
      dueDate: estimate?.dueDate || undefined,
      customerId: estimate?.customerId || '',
      refNo: estimate?.number || '',
      refDate: estimate?.date || '',
      sourceEstimateId: estimate?.id ?? null,
      items: Array.isArray(estimate?.items)
        ? estimate.items.map((l) => ({
            itemId: l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '',
            description: l?.description ?? '',
            quantity: Number(l?.quantity ?? 1),
            rate: Number(l?.rate ?? 0),
            gstRate: Number(l?.gstRate ?? 0),
            hsnSac: l?.hsnSac || '',
            amount: Number(l?.amount ?? 0),
          }))
        : undefined,
    };

    openModal(
      <InvoiceForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={initialInvoice}
        warehouses={warehouses}
        branches={branches}
        defaultWarehouseId={defaultWarehouseId}
        onClose={() => openModal(null)}
      />,
      { title: `New Invoice from ${estimate?.number || 'Quotation'}`.trim(), maxWidthClass: 'max-w-7xl' }
    );
  };

  const deleteEstimate = async (estimate) => {
    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete estimate ${estimate?.number || ''}? This cannot be undone.`.trim(), confirmLabel: 'Yes, continue' });
    if (!ok) return;
    setDb((prev) => ({
      ...prev,
      estimates: (prev.estimates || []).filter((e) => e.id !== estimate.id),
    }));
  };

  const openEstimateMenu = (estimateId, anchorEl) => {
    if (!anchorEl) {
      setOpenMenu({ id: estimateId, left: 0, top: 0 });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const padding = 12;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    let left = rect.right - MENU_WIDTH;
    left = Math.max(padding, Math.min(left, vw - MENU_WIDTH - padding));

    let top = rect.bottom + 8;
    if (top + MENU_HEIGHT_ESTIMATE > vh - padding) {
      top = rect.top - MENU_HEIGHT_ESTIMATE - 8;
    }
    top = Math.max(padding, Math.min(top, vh - padding - 40));

    setOpenMenu({ id: estimateId, left, top });
  };

  const estExportColumns = [
    { key: 'number', label: 'Quotation #' },
    { key: 'customerName', label: 'Customer' },
    { key: 'date', label: 'Date' },
    { key: 'dueDate', label: 'Valid till' },
    { key: 'subtotal', label: 'Taxable', value: (r) => Number(r.subtotal || 0) },
    { key: 'gstTotal', label: 'GST', value: (r) => Number(r.gstTotal || 0) },
    { key: 'total', label: 'Total', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => estStatusOf(r) },
  ];

  return (
    <DocumentListShell
      entity="quotation"
      className="sales-list-page"
      title="Quotations"
      company={currentCompany}
      search={{
        before: <select value={estStatus} onChange={(event) => setEstStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Quotation status">{EST_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: estSearch.query,
        onChange: estSearch.setQuery,
        placeholder: 'Search quotations…',
        label: 'Search quotations',
      }}
      moreItems={[
        exportMenuItem('Export quotations'),
        { sep: true },
        { key: 'settingsCustomFields', label: 'Custom fields', Icon: Plus, group: 'Configure — every quotation' },
        { key: 'invoiceTemplates', label: 'Document template', Icon: Settings2 },
      ]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) {
          runListExport({
            format,
            title: 'Quotations',
            fileName: `Quotations_${currentCompany?.name || 'company'}`,
            label: 'quotation(s)',
            columns: estExportColumns,
            rows: estimates,
          });
          return;
        }
        if (typeof onNavigate === 'function') onNavigate(k);
      }}
      primary={
        <PermissionButton
          permission="SALES::Estimates::CREATE"
          onClick={openNewEstimate}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} aria-hidden="true" /> New Quotation
        </PermissionButton>
      }
      cards={[
        { label: 'Quotations', value: estHeadline.count, count: true, tone: 'draft', Icon: ClipboardList },
        { label: 'Quoted', value: estHeadline.value, tone: 'sent', Icon: FileText },
        { label: 'Open value', value: estHeadline.open, tone: 'outstanding', Icon: Tag },
        { label: 'Converted value', value: estHeadline.converted, tone: 'paid', Icon: Receipt },
        { label: 'Expired value', value: estHeadline.expired, tone: 'cancelled', Icon: Ban },
      ]}
      denseCards
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>

            <tr>
              <ColumnHeader label="Quotation #" col="number" state={estFilters} />
              <ColumnHeader label="Customer" col="customer" state={estFilters} />
              <ColumnHeader label="Date" col="date" state={estFilters} align="center" />
              {/* A quotation's "due" is the day the price stops standing, which
                  is what the customer is being asked to beat. */}
              <ColumnHeader label="Valid till" col="due" state={estFilters} align="center" />
              <ColumnHeader label="Amount" col="total" state={estFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={estFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={estFilters} />
              <th scope="col" className="ui-action-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {estimates.length === 0 ? null : (
              estimates.map((est) => {
                const whId = String(est?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                return (
                <tr
                  key={est.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    const el = e.target;
                    if (el?.closest?.('[data-estimate-menu-button]')) return;
                    if (el?.closest?.('[data-estimate-menu]')) return;
                    openEditEstimate(est);
                  }}
                >
                  <td className="ui-col-id"><InvoiceIdentifier value={est.number} label="quotation" /></td>
                  <td className="ui-col-entity">{est.customerName || '-'}</td>
                  <td className="ui-col-date"><DateCell value={est.date} /></td>
                  {/* A quotation's "due" is its expiry: still open, so it is a
                      live commitment and reads as one. */}
                  <td className="ui-col-date">
                    <DueDateCell value={est.dueDate} balance={est.total || 0} />
                  </td>
                  <td className="ui-col-amount"><Money value={est.total} company={currentCompany} /></td>
                  {/*
                    An estimate that has already become an invoice looked
                    exactly like one still waiting on the customer. The only
                    place that fact appeared was a greyed-out menu item you had
                    to open the row menu to find, so a list of quotes could not
                    be read at a glance — which is the whole job of a list.
                  */}
                  <td className="whitespace-nowrap">
                    <StatusPill status={estStatusOf(est)} />
                  </td>
                  <td className="ui-col-meta">{whLabel}</td>
                  <td
                    className="ui-action-col relative"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openMenu?.id === est.id) {
                          setOpenMenu(null);
                        } else {
                          openEstimateMenu(est.id, e.currentTarget);
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg ui-hover-sunken"
                      aria-label="Quotation actions"
                      data-estimate-menu-button={est.id}
                    >
                      <MoreVertical size={18} />
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Centred on the view rather than on a table wider than it. */}
        {estimates.length === 0 ? (
          <div className="ui-empty-pane p-2">
            {estFilterChips.length === 0 && !estStatus ? (
                    <EmptyState
                      icon={ClipboardList}
                      kind="new"
      title="No quotations yet"
                      description="A quotation is a price you are standing behind until it expires — and an invoice waiting for a yes."
                      routes={[
                        {
                          label: 'Quote one now',
                          description: 'Pick a customer, add lines, set how long the price holds.',
                          onSelect: () => openNewEstimate(),
                        },
                        {
                          label: 'Start from an invoice',
                          description: 'Quote what you have already billed this customer before.',
                          onSelect: () => openNewEstimate(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      kind="filtered"
                      totalCount={(db.estimates || []).filter((e) => e.companyId === currentCompany.id).length}
                      filters={estFilterChips}
                      onClearFilters={() => {
                        estSearch.setQuery('');
                        estFilters.clearAll();
                      }}
                    />
                  )}
          </div>
        ) : null}
      </div>
      <TableTotals
        count={estimates.length}
        totalCount={(db.estimates || []).filter((e) => e.companyId === currentCompany.id).length}
        noun="quotations"
        figures={[{ label: 'Value', value: formatMoney(estimates.reduce((t, e) => t + Number(e.total || 0), 0), currentCompany) }]}
      />

      {previewEstimate ? (
        <Modal
          title={`Quotation ${previewEstimate.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewEstimate(null)}
        >
          <PrintDownloadFrame
      title={`Quotation ${previewEstimate.number || ''}`.trim()}
            fileBase={previewEstimate.number || 'quotation'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="QUOTATION"
              doc={previewEstimate}
              party={(db.customers || []).find((c) => String(c.id) === String(previewEstimate.customerId)) || null}
              partyLabel="Quotation For"
              metaRows={[{ label: 'Valid until', value: previewEstimate.dueDate }]}
              sideRows={[{ label: 'GSTIN', value: previewEstimate.customerGstin }]}
              footNote="This is a quotation, not a tax invoice. Prices hold until the date shown and are subject to the terms agreed."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}

      {openMenu?.id ? (
        <div
          ref={menuRef}
          className="fixed w-56 ui-card overflow-hidden ui-in-pop"
          style={{ left: openMenu.left, top: openMenu.top, boxShadow: 'var(--shadow-pop)', '--pop-origin': 'top right', zIndex: 'var(--z-popover)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          data-estimate-menu
        >
          {(() => {
            const est = estimates.find((e) => e.id === openMenu.id);
            if (!est) return null;

            const isConverted =
              String(est?.status || '').trim().toLowerCase() === 'converted' ||
              (est?.convertedInvoiceId !== undefined && est?.convertedInvoiceId !== null && est?.convertedInvoiceId !== '');

            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    openEditEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <span className="ui-muted">Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    setPreviewEstimate(est);
                  }}
                  aria-label={`Print quotation ${est.number}`}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Printer size={16} className="ui-muted" />
                  <span>Print</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    duplicateEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2"
                >
                  <Copy size={16} className="ui-muted" />
                  <span>Duplicate</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    if (!isConverted) convertToInvoice(est);
                  }}
                  disabled={isConverted}
                  // A disabled control that will not say why is a dead end.
                  // This one is correct to disable — converting twice would
                  // invoice the same quote again — but it was silent about it.
      title={isConverted ? 'Already converted to an invoice. Duplicate it if you need to quote this again.' : undefined}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ isConverted ? 'ui-subtle cursor-not-allowed ui-surface' : 'ui-hover-sunken'
                  }`}
                >
                  <FileText size={16} className={isConverted ? 'ui-subtle' : 'ui-muted'} />
                  <span>{isConverted ? 'Converted to invoice' : 'Convert to Invoice'}</span>
                </button>

                <div className="border-t ui-border-c" />

                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    deleteEstimate(est);
                  }}
                  className="w-full px-4 py-2 text-left text-sm ui-hover-sunken flex items-center gap-2 text-[rgb(var(--neg))]"
                >
                  <Trash2 size={16} className="text-[rgb(var(--neg))]" />
                  <span>Delete</span>
                </button>
              </>
            );
          })()}
        </div>
      ) : null}
    </DocumentListShell>
  );
};

export const EstimateForm = ({ db, setDb, currentCompany, initialData = null, onClose, screenTitle = '', screenSubtitle = '', onBack = null }) => {
  const formRef = useRef(null);
  const isEdit = Boolean(initialData && (initialData.id !== undefined && initialData.id !== null));
  const activeBranchId = String(selectedBranchId() || '').trim();
  const estimateDocSettings = getDocSettings(db, currentCompany, { branchId: activeBranchId || null });
  const estimateNumbering = estimateDocSettings?.numbering?.estimate;
  const isEstimateAuto = String(estimateNumbering?.mode || '').toLowerCase() === 'auto';
  const lockEstimateNumberOnCreate = !isEdit && isEstimateAuto && !estimateNumbering?.allowManualOverride;
  const generatedEstimateNumber = !isEdit
    ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'estimate', branchId: activeBranchId || null, takenNumbers: (db.estimates || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) })
    : '';

  const customFields = useMemo(() => getVisibleCustomFields(currentCompany, 'estimate'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

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
            amount: Number.isFinite(amount) ? amount : 0,
          };
        })
      : [{ itemId: '', description: '', quantity: 1, rate: 0, gstRate: 0, hsnSac: '', amount: 0 }];

    const nextNumber = isEdit
      ? String(initialData?.number || '')
      : String(generatedEstimateNumber || `EST-${Date.now()}`);

    return {
      number: nextNumber,
      date: initialData?.date || defaultDate,
      dueDate: initialData?.dueDate || defaultDueDate,
      customerId: initialData?.customerId !== undefined && initialData?.customerId !== null ? String(initialData.customerId) : '',
      salesmanId: initialData?.salesmanId ?? '',
      items: normalizedItems,
    };
  });

  const customers = db.customers.filter((c) => c.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const { state: companyState } = getCompanyGstProfile(currentCompany);
  const selectedCustomer = formData.customerId
    ? customers.find((c) => c.id === parseInt(formData.customerId))
    : null;
  const { state: customerState, gstin: customerGstin } = getPartyGstProfile(selectedCustomer);
  const isIntra = isIntraStateSupply({ companyState, partyState: customerState });

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
      const computed = computeGstForLine({
        quantity: Number(newItems[index].quantity ?? 1),
        rate: Number(newItems[index].rate ?? 0),
        gstRate: Number(newItems[index].gstRate ?? 0),
        isIntra,
        discountPct: Number(newItems[index].discountPct ?? 0),
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
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const computed = computeGstForLines({ lines: formData.items, isIntra });

  const handleSubmit = async (e) => {
    e.preventDefault();

    let estimateNumber = String(formData.number || '').trim();
    if (isEstimateAuto && lockEstimateNumberOnCreate) estimateNumber = String(generatedEstimateNumber || '').trim();
    if (!isEdit && isEstimateAuto && !estimateNumber) estimateNumber = String(generatedEstimateNumber || '').trim();
    if (!estimateNumber) {
      notify.error('Quotation number is required');
      return;
    }

    const estimateNumberClash = db.estimates.some(
      (est) =>
        est.companyId === currentCompany.id &&
        String(est.number || '').trim() === estimateNumber &&
        (!isEdit || est.id !== initialData?.id)
    );
    if (estimateNumberClash) {
      notify.error('Quotation number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    if (!formData.customerId) {
      notify.error('Customer is required');
      return;
    }

    /*
     * The master can forbid it. A credit note is how money goes back out
     * without an invoice being raised, so a customer can be marked as one that
     * notes may not be written against — and the switch that says so has to be
     * read somewhere or it is decoration.
     */
    const noteCustomer = (db.customers || []).find((c) => c.id === parseInt(formData.customerId));
    if (noteCustomer?.isActive === false) {
      notify.error('This customer is inactive. Activate the customer before creating a quotation.');
      return;
    }
    if (noteCustomer && noteCustomer.allowCreditNotes === false) {
      notify.error(
        `Credit notes are switched off for ${noteCustomer.displayName || noteCustomer.name}. Turn them on under the customer's Credit Details.`
      );
      return;
    }

    if (!companyState) {
      notify.error('Please set Company State in Company Profile before creating GST estimates.');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line. Items are mandatory for GST.');
      return;
    }

    const customer = customers.find((c) => c.id === parseInt(formData.customerId));

    const nextEstimateCore = {
      number: estimateNumber,
      date: formData.date,
      dueDate: formData.dueDate,
      customerId: formData.customerId,
      salesmanId: formData.salesmanId || '',
      customerName: getCustomerDisplayName(customer),
      customerGstin: customerGstin,
      placeOfSupplyState: customerState,
      taxType: isIntra ? 'CGST_SGST' : 'IGST',
      items: computed.lines,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      gstTotal: computed.gstTotal,
      total: computed.total,
      customFields: { ...(formData.customFields || {}) },
    };

    if (isEdit) {
      const updatedAt = new Date().toISOString();
      setDb({
        ...db,
        estimates: db.estimates.map((est) =>
          est.id === initialData.id
            ? {
                ...est,
                ...nextEstimateCore,
                status: est.status || initialData?.status || 'Draft',
                updatedAt,
              }
            : est
        ),
      });
      onClose?.();
      notify.success('Quotation updated successfully!');
      return;
    }

    // Survives the browser: estimates are quote-stage (no ledger posting),
    // but they still belong on the server, not in this profile's storage.
    let backendDocId = null;
    let serverNumber = '';
    if (hasDocsApiSession()) {
      try {
        const saved = await createDocApi('estimate', {
          number: estimateNumber || undefined,
          date: nextEstimateCore.date,
          validUntil: nextEstimateCore.validUntil || null,
          partyName: nextEstimateCore.customerName || 'Customer',
          subtotal: Number(nextEstimateCore.subtotal || 0),
          gstTotal: Number(nextEstimateCore.gstTotal || 0),
          total: Number(nextEstimateCore.total || 0),
          status: 'Draft',
          items: nextEstimateCore.items || [],
                  salesmanId: formData.salesmanId || undefined,
});
        backendDocId = saved?.id || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Quotation not saved to the server.'));
        return;
      }
    }

    const newEstimate = {
      id: getNextNumericId(db.estimates),
      companyId: currentCompany.id,
      ...nextEstimateCore,
      ...(serverNumber ? { number: serverNumber } : {}),
      backendDocId,
      status: 'Draft',
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      estimates: [...db.estimates, newEstimate],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'estimate', usedNumber: estimateNumber, branchId: activeBranchId || null }),
    });
    onClose?.();
    notify.success('Quotation created successfully!');
  };

  // The shared document contract, so an estimate behaves like the invoice it
  // will become.
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
        subtitle={screenSubtitle}
        onBack={onBack}
        sticky={Boolean(screenTitle)}
        primaryLabel={isEdit ? 'Update Quotation' : 'Create Quotation'}
      />

      {/*
        The head of the document, in two columns — the invoice's own shape.

        A quotation becomes an invoice, and the two were laid out differently
        enough that the same fields sat in different places on each: the number
        on the left here and on the right there. Left is who it is for, right is
        the paperwork that identifies it, ruled off between them.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          <CustomerPicker
            db={db}
            setDb={setDb}
            currentCompany={currentCompany}
            value={formData.customerId}
            onChange={(customerId) => setFormData((prev) => ({ ...prev, customerId }))}
          />
          {selectedCustomer ? (
            <p className="ui-caption -mt-2">
              {[
                customerState ? `Place of supply: ${customerState}` : '',
                customerGstin ? `GSTIN ${customerGstin}` : 'Unregistered',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}

          {(db.salesmen || []).some((sm) => sm.companyId === currentCompany.id) ? (
            <div>
              <label className="ui-label" htmlFor="estimate-salesman">Salesman</label>
              <select
                id="estimate-salesman"
                value={formData.salesmanId || ''}
                onChange={(e) => setFormData({ ...formData, salesmanId: e.target.value ? Number(e.target.value) : '' })}
                className="ui-select"
              >
                <option value="">— none —</option>
                {(db.salesmen || [])
                  .filter((sm) => sm.companyId === currentCompany.id)
                  .map((sm) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr] gap-3">
            <DocNumberField
              className="min-w-0"
              id="estimate-number"
              label={<>Quotation No. <span className="text-[rgb(var(--neg-ink))]">*</span></>}
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: e.target.value })}
              disabled={lockEstimateNumberOnCreate}
              required
              voucherKey="estimate"
      title="Quotation numbering"
              sampleLabel="Next quotation will be"
              manualLabel="Typed on each quotation"
              settings={estimateNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />

            <div className="min-w-0">
              <label className="ui-label" htmlFor="estimate-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="estimate-date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>

            <div className="min-w-0">
              {/* What it is called on the document it becomes: a quotation is
                  not due, it expires. */}
              <label className="ui-label" htmlFor="estimate-valid-until">
                Valid Until <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="estimate-valid-until"
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                className="ui-input w-full"
                required
              />
            </div>
          </div>

          {/* The company's own reference fields belong with the paperwork, not
              in a strip below the totals where the enquiry number this quote
              answers was read after the price. */}
          {hasCustomFieldsAt(customFields, 'header', 'reference') ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
              <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
            </div>
          ) : null}
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
                      {/* The unit belongs to the item, so it is shown rather
                          than asked for. */}
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
                      {/* A quote is where a discount is argued over, so the
                          line carries one — and it carries it the way the
                          invoice does, or the figure changes on conversion. */}
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

      {hasCustomFieldsAt(customFields, 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="notes" />
        </div>
      ) : null}

      <AmountInWordsBand words={amountInWordsInr(computed.total)} />

      <DocFormFootnote />

      {/* The figure and the line count, kept on screen while the lines are
          typed — the same running total the invoice carries. */}
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

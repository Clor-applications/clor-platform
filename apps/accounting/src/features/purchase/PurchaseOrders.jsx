import React, { useMemo, useRef, useState } from 'react';
import { selectedBranchId } from '@platform/context';
import { bumpCompanyNextNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import { getVisibleCustomFields } from '@ui/utils/invoicePrefs';
import { getLastSelection, setLastSelection } from '@ui/utils/lastSelection';
import { branchLabel } from '@ui/utils/branchLabel';
import { formatMoney, round2 } from '@ui/utils/money';
import { computeGstForLines, getCompanyGstProfile, getPartyGstProfile, isIntraStateSupply } from '@ui/utils/gst';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createDocApi, hasApiSession } from '@ui/api/purchaseDocs';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { DocFormActions, DocFormFootnote } from '@ui/components/DocumentForm';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { Ban, Building2, ClipboardList, FileText, MoreVertical, Package, Pencil, Plus, Printer, Receipt, ShoppingCart, Trash2, Truck, X } from 'lucide-react';
import WarehouseField from '@ui/components/WarehouseField';
import VendorPicker from '../../components/pickers/VendorPicker';
import DocNumberField from '@ui/components/DocNumberField';
import ItemPicker from '../../components/pickers/ItemPicker';
import DocumentCustomFields, { hasCustomFieldsAt } from '@ui/components/DocumentCustomFields';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useListSearch } from '@ui/components/ListToolbar';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import { DocDate, DocumentNumber, MoneyValue } from '@ui/components/docs';
import { createPortal } from 'react-dom';
import Modal from '@ui/components/ui/Modal';
import PrintDownloadFrame from '@ui/components/PrintDownloadFrame';
import DocumentPrintView from '@ui/components/DocumentPrintView';

export const PurchaseOrdersList = ({
  db,
  setDb,
  openModal,
  currentCompany,
  warehouses = [],
  onConvertToBill,
  onNewPo,
  onEditPo,
}) => {
  /**
   * { id, left, top } — the row menu and where to put it.
   *
   * Position is carried because the menu is rendered in a portal on <body>
   * rather than inside the row. Absolutely positioned inside the cell, it sat
   * within .ui-table-scroll, whose overflow:auto cut it off: on a list with
   * one row the container ended at 370px while "Convert to Bill" ran to 389,
   * so half of it was invisible and unclickable. Same escape the sales lists
   * already make.
   */
  const [poMenu, setPoMenu] = useState(null);
  const [previewPo, setPreviewPo] = useState(null);

  const PO_MENU_WIDTH = 208;
  const PO_MENU_HEIGHT = 150;

  const openPoMenu = (poId, anchorEl) => {
    if (!anchorEl) return setPoMenu({ id: poId, left: 0, top: 0 });
    const rect = anchorEl.getBoundingClientRect();
    const pad = 12;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    let left = rect.right - PO_MENU_WIDTH;
    left = Math.max(pad, Math.min(left, vw - PO_MENU_WIDTH - pad));
    // Flip above the button when there is no room below it.
    let top = rect.bottom + 8;
    if (top + PO_MENU_HEIGHT > vh - pad) top = rect.top - PO_MENU_HEIGHT - 8;
    top = Math.max(pad, Math.min(top, vh - pad - 40));
    setPoMenu({ id: poId, left, top });
  };

  /**
   * An order is Pending from the moment it is raised until a bill answers it,
   * and then it is Closed. The bill is the fact, so the status is read from it
   * rather than trusted from a flag someone forgot to set — a bill raised from
   * the Bills screen against this PO closes it just the same.
   */
  const poStatusOf = React.useCallback(
    (po) => {
      const stored = String(po?.status || '').trim();
      if (stored === 'Cancelled') return 'Cancelled';
      const poNumber = String(po?.number || '').trim().toLowerCase();
      const billed = (db?.bills || []).some((b) => {
        if (String(b?.status || '').toLowerCase() === 'cancelled') return false;
        if (String(b?.sourcePurchaseOrderId ?? '') === String(po?.id ?? '')) return true;
        // Bills raised before the link existed still name the order in their
        // reference, and that is the same fact written another way.
        return Boolean(poNumber) && String(b?.refNo || '').trim().toLowerCase() === poNumber;
      });
      if (billed || stored === 'Billed' || stored === 'Closed') return 'Closed';
      return 'Pending';
    },
    [db?.bills]
  );

  const openEditPo = (po) => {
    if (typeof onEditPo === 'function') {
      onEditPo(po);
      return;
    }
    openModal(
      <PurchaseOrderForm
        db={db}
        setDb={setDb}
        currentCompany={currentCompany}
        initialData={po}
        onClose={() => openModal(null)}
      />
    );
  };

  const cancelPo = async (po) => {
    const ok = await confirmDialog({
      title: `Cancel ${po?.number || 'this order'}?`,
      message: 'The order stays on record as cancelled and can no longer be billed.',
      confirmLabel: 'Yes, cancel it',
    });
    if (!ok) return;
    setDb((prev) => ({
      ...prev,
      purchaseOrders: (prev.purchaseOrders || []).map((x) =>
        String(x.id) === String(po.id) ? { ...x, status: 'Cancelled', cancelledAt: new Date().toISOString() } : x
      ),
    }));
    notify.success(`${po?.number || 'Purchase order'} cancelled.`);
  };

  const deletePo = async (po) => {
    const ok = await confirmDialog({
      title: `Delete ${po?.number || 'this order'}?`,
      message: 'It goes for good. Cancel it instead if you need the paper trail.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDb((prev) => ({
      ...prev,
      purchaseOrders: (prev.purchaseOrders || []).filter((x) => String(x.id) !== String(po.id)),
    }));
    notify.success(`${po?.number || 'Purchase order'} deleted.`);
  };

  const warehouseById = React.useMemo(() => {
    const list = Array.isArray(warehouses) ? warehouses : [];
    return new Map(list.map((w) => [String(w?.id), w]));
  }, [warehouses]);

  const poPeriod = usePeriodFilter();
  const poSearch = useListSearch(
    db.purchaseOrders.filter((po) => po.companyId === currentCompany.id),
    ['number', 'vendorName', 'date', 'status'],
    'purchaseOrders'
  );
  const poFilters = useColumnFilters();

  // What is hiding rows right now, in the user's words.
  const poFilterChips = React.useMemo(() => {
    const chips = [];
    if (String(poSearch.query || '').trim()) {
      chips.push({ label: 'Search', value: String(poSearch.query).trim(), onRemove: () => poSearch.setQuery('') });
    }
    for (const [key, f] of Object.entries(poFilters.filters || {})) {
      const shown = Array.isArray(f?.values) ? f.values.filter(Boolean).join(', ') : String(f?.value || '');
      chips.push({ label: key, value: shown || 'set', onRemove: () => poFilters.clearColumn(key) });
    }
    return chips;
  }, [poSearch, poFilters]);
  const purchaseOrders = poFilters.applyFilters(
    poSearch.filtered
      .filter((r) => poPeriod.inRange(r?.date))
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return Number(b?.id || 0) - Number(a?.id || 0);
      }),
    {
      number: (r) => r.number,
      vendor: (r) => r.vendorName,
      warehouse: (r) => warehouseById.get(String(r?.warehouseId || ''))?.name || '',
      date: (r) => r.date,
      amount: (r) => r.total,
      status: (r) => poStatusOf(r),
    }
  );

  // Over the filtered set, so the figure always describes what is on screen.
  const poTotals = useMemo(() => {
    let ordered = 0;
    for (const po of purchaseOrders) ordered += Number(po.total || 0);
    return [{ label: 'Ordered', value: formatMoney(ordered, currentCompany) }];
  }, [purchaseOrders, currentCompany]);


  const [poStatus, setPoStatus] = useState('');
  const PO_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Pending', label: 'Awaiting the goods', tone: 'outstanding' },
    { value: 'Closed', label: 'Billed', tone: 'paid' },
    { value: 'Cancelled', label: 'Cancelled', tone: 'cancelled' },
  ];
  const poShown = poStatus ? purchaseOrders.filter((po) => poStatusOf(po) === poStatus) : purchaseOrders;

  const poStatusCounts = useMemo(() => {
    const counts = { '': purchaseOrders.length };
    for (const po of purchaseOrders) {
      const st = poStatusOf(po);
      counts[st] = (counts[st] || 0) + 1;
    }
    return counts;
  }, [purchaseOrders, poStatusOf]);

  /*
   * An order is a commitment, not a liability: nothing is owed until the bill
   * arrives. The figure that matters is what has been ordered and not yet
   * billed — goods somebody is still waiting for, money already promised.
   */
  const poHeadline = useMemo(() => {
    let ordered = 0;
    let open = 0;
    let billed = 0;
    let cancelled = 0;
    for (const po of purchaseOrders) {
      const amt = Number(po.total || 0);
      const st = poStatusOf(po);
      if (st === 'Cancelled') {
        cancelled += amt;
        continue;
      }
      ordered += amt;
      if (st === 'Closed') billed += amt;
      else open += amt;
    }
    return { count: purchaseOrders.length, ordered, open, billed, cancelled };
  }, [purchaseOrders, poStatusOf]);

  const poExportColumns = [
    { key: 'number', label: 'PO #' },
    { key: 'vendorName', label: 'Vendor' },
    { key: 'date', label: 'Date' },
    { key: 'total', label: 'Amount', value: (r) => Number(r.total || 0) },
    { key: 'status', label: 'Status', value: (r) => poStatusOf(r) },
  ];

  const createPo = () => {
    // A purchase order is entered the same way a bill is: its own page, not a
    // popup, because the two forms hold the same kind of work.
    if (typeof onNewPo === 'function') {
      onNewPo();
      return;
    }
    openModal(<PurchaseOrderForm db={db} setDb={setDb} currentCompany={currentCompany} onClose={() => openModal(null)} />);
  };

  return (
    <DocumentListShell
      entity="purchaseOrder"
      title="Purchase Orders"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: poSearch.query,
        onChange: poSearch.setQuery,
        placeholder: 'Search purchase orders…',
        label: 'Search purchase orders',
      }}
      moreItems={[exportMenuItem('Export purchase orders')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Purchase orders',
          fileName: `PurchaseOrders_${currentCompany?.name || 'company'}`,
          label: 'purchase order(s)',
          columns: poExportColumns,
          rows: poShown,
        });
      }}
      primary={
        <button type="button" onClick={createPo} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New PO
        </button>
      }
      cards={[
        { label: 'Orders', value: poHeadline.count, count: true, tone: 'draft', Icon: ShoppingCart },
        { label: 'Ordered', value: poHeadline.ordered, tone: 'sent', Icon: FileText },
        { label: 'Awaiting the goods', value: poHeadline.open, tone: 'outstanding', Icon: ClipboardList },
        { label: 'Billed', value: poHeadline.billed, tone: 'paid', Icon: Receipt },
        { label: 'Cancelled', value: poHeadline.cancelled, tone: 'cancelled', Icon: Ban },
      ]}
      tabs={PO_STATUS_TABS}
      tabsLabel="Purchase order status"
      statusValue={poStatus}
      statusCounts={poStatusCounts}
      onStatusChange={setPoStatus}
      tip={{
        storageKey: 'clor.tip.purchaseOrders',
        Icon: ShoppingCart,
        text: 'An order closes itself when a bill names it — nothing here has to be ticked off by hand.',
      }}
    >
        <div className="overflow-x-auto ui-table-scroll purchase-order-table-scroll" data-fill-viewport>
        <table className="ui-table ui-table-wide ui-table-sticky">
          <thead>
            <tr>
              <ColumnHeader label="PO #" col="number" state={poFilters} />
              <ColumnHeader label="Vendor" col="vendor" state={poFilters} />
              <ColumnHeader label="Date" col="date" state={poFilters} align="center" />
              <ColumnHeader label="Amount" col="amount" state={poFilters} className="ui-num" align="right" />
              <ColumnHeader label="Status" col="status" state={poFilters} align="center" />
              <ColumnHeader label="Warehouse" col="warehouse" state={poFilters} />
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {poShown.length === 0 ? (
              <tr>
                <td colSpan="7">
                  {db.purchaseOrders.filter((x) => x.companyId === currentCompany.id).length === 0 ? (
                    <EmptyState
                      icon={ClipboardList}
                      kind="new"
      title="Nothing ordered yet"
                      description="A purchase order records what you asked a vendor for, so the bill that arrives can be checked against it."
                      routes={[
                        {
                          label: 'Raise one now',
                          description: 'Pick a vendor and list what you are asking for.',
                          onSelect: () => createPo(),
                        },
                        {
                          label: 'From a sales order',
                          description: 'Buy in what a customer has already ordered.',
                          onSelect: () => createPo(),
                        },
                      ]}
                    />
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      kind="filtered"
                      totalCount={db.purchaseOrders.filter((x) => x.companyId === currentCompany.id).length}
                      filters={poFilterChips}
                      onClearFilters={() => { poSearch.setQuery(''); poFilters.clearAll(); }}
                    />
                  )}
                </td>
              </tr>
            ) : (
              poShown.map((po) => {
                const whId = String(po?.warehouseId || '').trim();
                const wh = whId ? warehouseById.get(whId) : null;
                const whLabel = wh ? String(wh?.name || `Warehouse ${wh?.id}`) : whId ? `Warehouse ${whId}` : '-';
                const status = poStatusOf(po);
                return (
                  <tr key={po.id} className="ui-hover-sunken">
                    <td className="ui-col-id"><DocumentNumber value={po.number} label="purchase order" /></td>
                    <td className="ui-col-entity">{po.vendorName}</td>
                    <td className="ui-col-date"><DocDate value={po.date} /></td>
                    <td className="ui-col-amount"><MoneyValue value={po.total || 0} company={currentCompany} /></td>
                    <td>
                      <StatusPill status={status} />
                    </td>
                    <td className="ui-col-meta">{whLabel}</td>
                    <td className="relative w-10 text-right">
                      <button
                        type="button"
                        data-po-menu-button={po.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (poMenu?.id === po.id) setPoMenu(null);
                          else openPoMenu(po.id, e.currentTarget);
                        }}
                        className="p-2 rounded-lg ui-hover-sunken"
                        aria-haspopup="menu"
                        aria-label={`Actions for ${po.number}`}
                      >
                        <MoreVertical size={18} />
                      </button>

                      {poMenu?.id === po.id ? createPortal(
                        <div
                          className="fixed w-52 ui-surface border ui-border-c rounded-xl shadow-lg overflow-hidden text-left"
                          style={{ left: poMenu.left, top: poMenu.top, zIndex: 'var(--z-popover)' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPoMenu(null);
                              if (status === 'Pending') openEditPo(po);
                            }}
                            disabled={status !== 'Pending'}
                            className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                              status === 'Pending' ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed'
                            }`}
                          >
                            <Pencil size={16} /> Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setPoMenu(null);
                              setPreviewPo(po);
                            }}
                            aria-label={`Print purchase order ${po.number}`}
                            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 ui-hover-sunken"
                          >
                            <Printer size={16} /> Print
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setPoMenu(null);
                              if (status === 'Pending' && onConvertToBill) onConvertToBill(po);
                            }}
                            disabled={status !== 'Pending' || !onConvertToBill}
                            className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                              status === 'Pending' && onConvertToBill ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed'
                            }`}
                          >
                            <Plus size={16} /> Convert to Bill
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setPoMenu(null);
                              if (status === 'Pending') cancelPo(po);
                            }}
                            disabled={status !== 'Pending'}
                            className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                              status === 'Pending' ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed'
                            }`}
                          >
                            <X size={16} /> Cancel
                          </button>

                          <div className="border-t ui-border-c" />

                          <button
                            type="button"
                            onClick={() => {
                              setPoMenu(null);
                              if (status !== 'Closed') deletePo(po);
                            }}
                            disabled={status === 'Closed'}
                            className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                              status === 'Closed' ? 'ui-subtle cursor-not-allowed' : 'ui-hover-sunken text-[rgb(var(--neg))]'
                            }`}
                          >
                            <Trash2 size={16} /> Delete
                          </button>
                        </div>,
                        document.body
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        <TableTotals
          count={poShown.length}
          totalCount={poSearch.filtered.length}
          noun="purchase orders"
          figures={poTotals}
        />

      {previewPo ? (
        <Modal
          title={`Purchase Order ${previewPo.number || ''}`.trim()}
          maxWidthClass="max-w-5xl"
          onClose={() => setPreviewPo(null)}
        >
          <PrintDownloadFrame
      title={`Purchase Order ${previewPo.number || ''}`.trim()}
            fileBase={previewPo.number || 'purchase-order'}
          >
            <DocumentPrintView
              db={db}
              currentCompany={currentCompany}
              docTitle="PURCHASE ORDER"
              doc={previewPo}
              party={(db.vendors || []).find((v) => String(v.id) === String(previewPo.vendorId)) || null}
              partyLabel="Vendor"
              sideRows={[{ label: 'Status', value: previewPo.status }]}
              footNote="Please quote this order number on your invoice and delivery documents. Goods remain subject to inspection on receipt."
            />
          </PrintDownloadFrame>
        </Modal>
      ) : null}
    </DocumentListShell>
  );
};

export const PurchaseOrderForm = ({
  db,
  setDb,
  currentCompany,
  onClose,
  initialData = null,
  warehouses = [],
  defaultWarehouseId = '',
  branches = [],
}) => {
  const formRef = useRef(null);
  const isEditPo = Boolean(initialData?.id);
  const vendors = db.vendors.filter((v) => v.companyId === currentCompany.id);
  const itemsMaster = db.items.filter((i) => i.companyId === currentCompany.id);

  const activeBranchId = String(selectedBranchId() || '').trim();
  const resolveBranchIdFromWarehouseId = (warehouseId) => {
    const wid = String(warehouseId || '').trim();
    if (!wid) return activeBranchId || '';
    const w = (Array.isArray(warehouses) ? warehouses : []).find((x) => String(x?.id || '').trim() === wid) || null;
    return String(w?.branchId || '').trim() || activeBranchId || '';
  };
  const initPoBranchId =
    String(initialData?.branchId || '').trim() ||
    resolveBranchIdFromWarehouseId(String(initialData?.warehouseId || defaultWarehouseId || '').trim()) ||
    '';
  const poDocSettingsInit = getDocSettings(db, currentCompany, { branchId: initPoBranchId || null });
  const isPoAutoInit = String(poDocSettingsInit?.numbering?.purchaseOrder?.mode || '').toLowerCase() === 'auto';

  const customFields = React.useMemo(() => getVisibleCustomFields(currentCompany, 'purchaseOrder'), [currentCompany]);
  const setCustomField = (key, value) =>
    setFormData((p) => ({ ...p, customFields: { ...(p.customFields || {}), [key]: value } }));

  const [formData, setFormData] = useState(() => {
    if (initialData) {
      return {
        number: String(initialData.number || ''),
        date: String(initialData.date || new Date().toISOString().split('T')[0]),
        vendorId: initialData.vendorId ? String(initialData.vendorId) : '',
        warehouseId: String(initialData.warehouseId || defaultWarehouseId || '').trim(),
        items:
          Array.isArray(initialData.items) && initialData.items.length
            ? initialData.items.map((l) => ({
                itemId: String(l?.itemId || ''),
                description: l?.description || '',
                quantity: Number(l?.quantity ?? 1),
                rate: Number(l?.rate ?? 0),
                amount: Number(l?.amount ?? 0),
              }))
            : [{ itemId: '', description: '', quantity: 1, rate: 0, amount: 0 }],
        notes: initialData.notes || '',
      };
    }
    return {
      number: isPoAutoInit ? nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'purchaseOrder', branchId: initPoBranchId || null, takenNumbers: (db.purchaseOrders || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) }) || '' : '',
      date: new Date().toISOString().split('T')[0],
      vendorId: '',
      warehouseId: String(defaultWarehouseId || '').trim(),
      items: [{ itemId: '', description: '', quantity: 1, rate: 0, amount: 0 }],
      notes: '',
    };
  });

  /*
   * Where the order belongs, asked the way the bill asks it: the branch
   * first, then only that branch's warehouses, with the series following the
   * branch. Same control, same order, same fallbacks.
   */
  const [branchId, setBranchId] = useState(
    () => initPoBranchId || getLastSelection('branch', currentCompany?.id) || activeBranchId || ''
  );
  const branchIdInList =
    !branchId || (Array.isArray(branches) ? branches : []).some((b) => String(b?.id || '') === String(branchId))
      ? branchId
      : '';
  const branchOptions = React.useMemo(() => {
    const list = Array.isArray(branches) ? branches : [];
    return list.slice().sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
  }, [branches]);

  const branchIdForNumbering =
    String(branchIdInList || '').trim() || resolveBranchIdFromWarehouseId(formData.warehouseId) || null;
  const poDocSettings = getDocSettings(db, currentCompany, { branchId: branchIdForNumbering });
  const poNumbering = poDocSettings?.numbering?.purchaseOrder;
  const isPoAuto = String(poNumbering?.mode || '').toLowerCase() === 'auto';
  const lockPoNumber = isPoAuto && !poNumbering?.allowManualOverride;
  const generatedPoNumber = nextFreeVoucherNumber({db, company: currentCompany, voucherKey: 'purchaseOrder', branchId: branchIdForNumbering, takenNumbers: (db.purchaseOrders || []).filter((x) => x.companyId === currentCompany.id).map((x) => String(x.number || '').trim()) });

  /* An untouched automatic number follows its series live, as on the bill. */
  const [numberTouched, setNumberTouched] = useState(false);
  const autoNumbered = !isEditPo && isPoAuto && !numberTouched;
  const poNumberValue = autoNumbered ? String(generatedPoNumber || '') : formData.number;

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

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { itemId: '', description: '', quantity: 1, rate: 0, amount: 0 }],
    }));
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateItem = (index, field, value, pickedItem = null) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const next = { ...nextItems[index], [field]: value };

      if (field === 'itemId') {
        const item = pickedItem || itemsMaster.find((i) => String(i.id) === String(value));
        if (item) {
          next.description = item.name;
          next.rate = Number(item.purchasePrice ?? 0);
          next.unit = item.unit || '';
          next.hsnSac = item.hsnSac || '';
          /*
           * The tax rate the order is placed at.
           *
           * A purchase order never asked for one, so converting it to a bill
           * had to guess the rate from the item master — and a rate agreed with
           * the vendor that differs from the master's was simply lost. Stored
           * on the line, the bill uses what was ordered.
           */
          next.gstRate = Number(item.gstRate ?? 0);
        }
      }

      if (field === 'quantity' || field === 'rate' || field === 'itemId' || field === 'discountPct') {
        const qty = Number(next.quantity ?? 1);
        const rate = Number(next.rate ?? 0);
        const pct = Number(next.discountPct ?? 0);
        const gross = (Number.isFinite(qty) ? qty : 1) * (Number.isFinite(rate) ? rate : 0);
        next.amount = round2(gross - (Number.isFinite(pct) && pct > 0 ? gross * (Math.min(pct, 100) / 100) : 0));
      }

      nextItems[index] = next;
      return { ...prev, items: nextItems };
    });
  };

  const subtotal = round2((formData.items || []).reduce((sum, l) => sum + Number(l.amount || 0), 0));

  /*
   * What the vendor will invoice, shown but not stored.
   *
   * A purchase order posts nothing — no ledger entry, no GST return — so its
   * stored value stays the taxable value it has always been. The buyer still
   * needs to see the figure that will arrive on the bill, so the tax is
   * computed from the lines and shown under the total as a memo.
   */
  const poVendor = vendors.find((v) => String(v.id) === String(formData.vendorId)) || null;
  const poTax = computeGstForLines({
    lines: formData.items || [],
    isIntra: isIntraStateSupply({
      companyState: getCompanyGstProfile(currentCompany).state,
      partyState: getPartyGstProfile(poVendor).state,
    }),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    let poNumber = String(poNumberValue || '').trim();
    if (isPoAuto) {
      if (lockPoNumber) poNumber = String(generatedPoNumber || '').trim();
      else if (!poNumber) poNumber = String(generatedPoNumber || '').trim();
    }
    if (!poNumber) {
      notify.error('PO number is required');
      return;
    }

    const poNumberClash = db.purchaseOrders.some((po) => po.companyId === currentCompany.id && String(po.number || '').trim() === poNumber);
    if (poNumberClash) {
      notify.error('PO number already exists. Please change the number or update numbering settings in Company Profile.');
      return;
    }

    if (!formData.vendorId) {
      notify.error('Vendor is required');
      return;
    }

    const hasMissingItem = (formData.items || []).some((l) => !String(l.itemId || '').trim());
    if (hasMissingItem) {
      notify.error('Please select an Item for every line.');
      return;
    }

    const vendorObj = vendors.find((v) => v.id === parseInt(formData.vendorId));

    // Same server-first rule as estimates: intentions survive the browser.
    let backendDocId = null;
    let serverNumber = '';
    if (hasApiSession()) {
      try {
        const saved = await createDocApi('purchaseOrder', {
          number: poNumber || undefined,
          date: formData.date,
          partyId: vendorObj?.backendPartyId ? String(vendorObj.backendPartyId) : null,
          partyName: getVendorDisplayName(vendorObj) || 'Vendor',
          warehouseId: String(formData.warehouseId || '').trim() || null,
          subtotal,
          total: subtotal,
          status: 'Draft',
          notes: formData.notes || null,
          items: formData.items || [],
        });
        backendDocId = saved?.id || null;
        serverNumber = String(saved?.number || '');
      } catch (err) {
        notify.error(String(err?.message || 'Purchase order not saved to the server.'));
        return;
      }
    }

    if (isEditPo) {
      setDb((prev) => ({
        ...prev,
        purchaseOrders: (prev.purchaseOrders || []).map((x) =>
          String(x.id) === String(initialData.id)
            ? {
                ...x,
                date: formData.date,
                branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
                vendorId: formData.vendorId,
                vendorName: getVendorDisplayName(vendorObj),
                warehouseId: String(formData.warehouseId || '').trim(),
                items: formData.items.map((l) => ({
                  ...l,
                  itemId: String(l.itemId || ''),
                  quantity: Number(l.quantity ?? 1),
                  rate: Number(l.rate ?? 0),
                  amount: Number(l.amount ?? 0),
                })),
                subtotal,
                total: subtotal,
                notes: formData.notes,
                customFields: { ...(formData.customFields || {}) },
                updatedAt: new Date().toISOString(),
              }
            : x
        ),
      }));
      onClose?.();
      notify.success(`${formData.number || 'Purchase order'} updated.`);
      return;
    }

    const newPo = {
      id: db.purchaseOrders.length + 1,
      companyId: currentCompany.id,
      backendDocId,
      number: serverNumber || poNumber,
      date: formData.date,
      branchId: String(branchIdInList || branchIdForNumbering || '').trim(),
      vendorId: formData.vendorId,
      vendorName: getVendorDisplayName(vendorObj),
      items: formData.items.map((l) => ({
        ...l,
        itemId: String(l.itemId || ''),
        quantity: Number(l.quantity ?? 1),
        rate: Number(l.rate ?? 0),
        amount: Number(l.amount ?? 0),
      })),
      warehouseId: String(formData.warehouseId || '').trim(),
      subtotal,
      total: subtotal,
      notes: formData.notes,
      customFields: { ...(formData.customFields || {}) },
      // A raised order is pending until a bill answers it.
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    setDb({
      ...db,
      purchaseOrders: [...db.purchaseOrders, newPo],
      companies: bumpCompanyNextNumber({ db, companyId: currentCompany.id, voucherKey: 'purchaseOrder', usedNumber: poNumber, branchId: branchIdForNumbering }),
    });

    onClose?.();
    notify.success('Purchase order created successfully!');
  };

  // The shared document contract, so a purchase order behaves like the bill it
  // becomes.
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: formData.items.length,
    addLine: addItem,
    removeLine: removeItem,
  });

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={onFormKeyDown} className="ui-creation-form space-y-3">
      <DocFormActions primaryLabel={isEditPo ? 'Update PO' : 'Create PO'} />

      {/*
        The head of the document, in the bill's two columns: where the goods
        will land and who supplies them on the left, the paperwork that
        identifies the order on the right, ruled off between them.
      */}
      <div className="ui-doc-section grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
        <div className="lg:col-span-6 space-y-4">
          {/* Where first, then who — the branch, the warehouse under it, and
              the vendor across the full width underneath. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div id="po-branch-field">
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
              isEdit={isEditPo}
              required={false}
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
              onChange={(vendorId) => setFormData((p) => ({ ...p, vendorId }))}
            />
          </div>
        </div>

        <div
          className="lg:col-span-6 space-y-4 lg:ps-6"
          style={{ borderInlineStart: '1px solid rgb(var(--border))' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DocNumberField
              id="po-number"
              label="PO Number"
              value={poNumberValue}
              onChange={(e) => {
                setNumberTouched(true);
                setFormData((p) => ({ ...p, number: e.target.value }));
              }}
              disabled={lockPoNumber}
              required
              voucherKey="purchaseOrder"
      title="Order numbering"
              sampleLabel="Next order will be"
              manualLabel="Typed on each order"
              branchId={branchIdForNumbering}
              settings={poNumbering}
              db={db}
              setDb={setDb}
              currentCompany={currentCompany}
            />

            <div className="min-w-0">
              <label className="ui-label" htmlFor="po-date">
                Date <span className="text-[rgb(var(--neg-ink))]">*</span>
              </label>
              <input
                id="po-date"
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
                  <td className="ui-col-amount px-3 py-2 text-right">{formatMoney(item.amount || 0, currentCompany)}</td>
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

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2">
            <div className="ui-total-row border-t pt-2">
              <span>Total:</span>
              <span className="ui-money">{formatMoney(subtotal, currentCompany)}</span>
            </div>
            {poTax.gstTotal > 0 ? (
              <div className="ui-caption space-y-1 border-t pt-2">
                <div className="flex justify-between">
                  <span>GST as ordered</span>
                  <span className="ui-money">{formatMoney(poTax.gstTotal, currentCompany)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Expected bill value</span>
                  <span className="ui-money">{formatMoney(poTax.total, currentCompany)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className="ui-label" htmlFor="index-notes">Notes</label>
        <textarea id="index-notes" value={formData.notes} onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))} className="ui-input w-full" rows={3} />
      </div>

      {hasCustomFieldsAt(customFields, 'header', 'reference', 'notes') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="header" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="reference" />
          <DocumentCustomFields fields={customFields} values={formData.customFields} onChange={setCustomField} where="notes" />
        </div>
      ) : null}

      <DocFormFootnote />

      {/* The figure and the line count, kept on screen while the lines are
          typed — the same running total the invoice carries. */}
      <div className="ui-entry-summary">
        <span className="ui-t-label">Total</span>
        <span className="ui-money-lg">{formatMoney(poTax.total ?? subtotal, currentCompany)}</span>
        <span className="ui-caption">
          {formData.items.filter((l) => String(l.itemId || '').trim()).length} line(s)
          {poTax.gstTotal > 0 ? ` · ${formatMoney(poTax.gstTotal, currentCompany)} GST` : ''}
        </span>
      </div>
    </form>
  );
};

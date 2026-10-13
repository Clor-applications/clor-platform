import React, { useEffect, useMemo, useRef, useState } from 'react';
import { postJournalToLedger } from '@ui/utils/journalSync';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { AlertTriangle, Check, ClipboardCheck, Download, MoreVertical, Package, PackageCheck, Pencil, Plus, Trash2, Truck, X } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { PermissionButton } from '@ui/permissions/ActionGuard';

import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { isTracked, needsExpiry, batchesForItem } from '@ui/utils/batches';
import { bumpCompanyNextNumber, generateVoucherNumber, getDocSettings } from '@ui/utils/docSettings';
import ItemPicker from '../../components/pickers/ItemPicker';
import { usePeriodFilter } from '@ui/components/ListControls';
import { useColumnFilters, ColumnHeader } from '@ui/components/ColumnFilters';
import { latestPurchaseRate } from '@ui/utils/pricing';
import { formatMoney } from '@ui/utils/money';
import { DocDate } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { DocFormActions } from '@ui/components/DocumentForm';
import { round2 } from '@ui/utils/money';

const safeArray = (v) => (Array.isArray(v) ? v : []);

const makeId = () => {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const normalizeId = (v) => String(v ?? '').trim();

const getBranchLabel = (b) => {
  if (!b) return '';
  const code = String(b.branchCode || b.code || '').trim();
  const name = String(b.branchName || b.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return name || code || `Branch ${String(b.id)}`;
};

const getWarehouseLabel = (w) => {
  if (!w) return '';
  const name = String(w.name || '').trim();
  return name || `Warehouse ${String(w.id)}`;
};

/**
 * A transfer moves in two steps and each step belongs to one side of it.
 *
 *   Draft            the sender is still writing it
 *   Transferred Out  the sender submitted it — stock has left the source and
 *                    the receiver sees it as Pending Approval
 *   Transfer In      the receiver counted the goods and accepted them, so the
 *                    stock lands (Short Received when the count disagrees)
 *
 * Older transfers were saved with the names on the right, so read them through
 * `canonicalStatus` and write only the names on the left.
 */
export const TRANSFER_STATUS = {
  DRAFT: 'Draft',
  OUT: 'Transferred Out',
  IN: 'Transfer In',
  SHORT: 'Short Received',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const LEGACY_STATUS = {
  // Submitted never moved any stock, so it is really still a draft.
  Submitted: TRANSFER_STATUS.DRAFT,
  'In Transit': TRANSFER_STATUS.OUT,
  Received: TRANSFER_STATUS.IN,
  Approved: TRANSFER_STATUS.IN,
};

export const canonicalStatus = (transferOrStatus) => {
  const raw =
    typeof transferOrStatus === 'string' ? transferOrStatus : String(transferOrStatus?.status || '');
  const s = raw.trim();
  if (!s) return TRANSFER_STATUS.DRAFT;
  return LEGACY_STATUS[s] || s;
};

/** What the transfer is called from where the user is standing. */
export const statusForViewer = (transfer, { atTarget = false } = {}) => {
  const s = canonicalStatus(transfer);
  if (s === TRANSFER_STATUS.OUT && atTarget) return 'Pending Approval';
  return s;
};


/**
 * Movement wording: a transfer is one document seen from two ends. The sending
 * warehouse does a Transfer Out; the receiving one a Transfer In.
 */
export const movementLabel = (mode, direction) =>
  direction === 'in'
    ? `Transfer In (${mode === 'branch' ? 'Branch' : 'Warehouse'} movement)`
    : `Transfer Out (${mode === 'branch' ? 'Branch' : 'Warehouse'} movement)`;

/** Lines whose received quantity differs from what was sent. */
export const mismatchLines = (transfer) =>
  safeArray(transfer?.lines)
    .map((l) => ({
      itemId: normalizeId(l?.itemId),
      sent: toNum(l?.qty || 0),
      received: l?.receivedQty === undefined || l?.receivedQty === null ? toNum(l?.qty || 0) : toNum(l.receivedQty),
    }))
    .filter((l) => Math.abs(l.sent - l.received) > 0.0001);

export const StockTransferEditor = ({
  db,
  setDb,
  currentCompany,
  branches,
  warehouses,
  // A user may only raise documents for the branches/warehouses assigned to
  // them, but a Transfer Out has to be able to name any destination in the
  // company — that is the whole point of sending stock elsewhere. Sources come
  // from `branches`/`warehouses` (already restricted upstream); destinations
  // come from these full lists.
  allBranches,
  allWarehouses,
  // The header's warehouse selector is the live source of truth. Reading it
  // from localStorage once at mount left the form showing whatever was active
  // when it opened, so switching the header afterwards silently disagreed with
  // the "From" line — and the transfer would have moved stock out of the wrong
  // place.
  activeWarehouseId = '',
  initial,
  mode = 'warehouse',
  onBack,
}) => {
  const isEdit = Boolean(initial);

  const voucherKey = mode === 'branch' ? 'branchTransfer' : 'warehouseTransfer';

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    const activeBranchId = normalizeId(localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || '');
    const base = {
      id: makeId(),
      companyId: currentCompany?.id,
      number: '',
      date: today,
      status: 'Draft',
      sourceBranchId: activeBranchId,
      sourceWarehouseId: normalizeId(localStorage.getItem('activeWarehouseId') || ''),
      targetBranchId: mode === 'warehouse' ? activeBranchId : '',
      targetWarehouseId: '',
      reason: '',
      lines: [{ itemId: '', description: '', qty: 1, batchId: '', batchNo: '', expiryDate: '' }],
    };

    if (!initial) return base;

    return {
      ...base,
      ...initial,
      id: normalizeId(initial.id) || base.id,
      companyId: initial.companyId ?? base.companyId,
      number: String(initial.number || '').trim(),
      date: String(initial.date || '').trim() || base.date,
      status: String(initial.status || '').trim() || 'Draft',
      sourceBranchId: normalizeId(initial.sourceBranchId),
      sourceWarehouseId: normalizeId(initial.sourceWarehouseId),
      targetBranchId: normalizeId(initial.targetBranchId),
      targetWarehouseId: normalizeId(initial.targetWarehouseId),
      reason: String(initial.reason || '').trim(),
      lines: safeArray(initial.lines).length
        ? safeArray(initial.lines).map((l) => ({
            itemId: normalizeId(l?.itemId),
            description: String(l?.description || '').trim(),
            qty: toNum(l?.qty || 0) || 0,
          }))
        : base.lines,
    };
  });

  const items = useMemo(() => {
    const companyId = currentCompany?.id;
    return safeArray(db?.items)
      .filter((it) => Number(it?.companyId) === Number(companyId))
      .filter((it) => isStockItem(it))
      .slice()
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [db?.items, currentCompany?.id]);

  const branchById = useMemo(() => new Map(safeArray(branches).map((b) => [normalizeId(b?.id), b])), [branches]);
  const warehouseById = useMemo(() => new Map(safeArray(warehouses).map((w) => [normalizeId(w?.id), w])), [warehouses]);

  const itemById = useMemo(() => {
    const map = new Map();
    for (const it of safeArray(items)) {
      map.set(normalizeId(it?.id), it);
    }
    return map;
  }, [items]);

  const destinationBranchOptions = useMemo(() => {
    const list = safeArray(allBranches).length ? safeArray(allBranches) : safeArray(branches);
    return list
      .slice()
      .sort((a, b) => getBranchLabel(a).localeCompare(getBranchLabel(b)))
      .map((b) => ({ value: normalizeId(b?.id), label: getBranchLabel(b) || `Branch ${normalizeId(b?.id)}` }));
  }, [allBranches, branches]);

  const destinationWarehouseOptionsForBranch = useMemo(() => {
    const list = safeArray(allWarehouses).length ? safeArray(allWarehouses) : safeArray(warehouses);
    const map = new Map();
    for (const w of list) {
      const bid = normalizeId(w?.branchId);
      if (!bid) continue;
      const cur = map.get(bid) || [];
      cur.push({ value: normalizeId(w?.id), label: getWarehouseLabel(w), branchId: bid });
      map.set(bid, cur.sort((a, b) => a.label.localeCompare(b.label)));
    }
    return map;
  }, [allWarehouses, warehouses]);

  const targetBranchWarehouseOptions = useMemo(() => {
    const bid = normalizeId(mode === 'warehouse' ? form.sourceBranchId : form.targetBranchId);
    if (!bid) return [];
    return destinationWarehouseOptionsForBranch.get(bid) || [];
  }, [form.sourceBranchId, form.targetBranchId, mode, destinationWarehouseOptionsForBranch]);

  /**
   * The warehouses the stock can leave from.
   *
   * A branch transfer takes its source warehouse from the header selector,
   * but the header has an "All warehouses" setting, and on that setting there
   * was no source at all: the form still read "From (active branch) Head
   * Office", offered no way to name a warehouse, and then refused to save with
   * "From Warehouse is required". The field it asked for now exists.
   */
  const sourceWarehouseOptions = useMemo(() => {
    const bid = normalizeId(form.sourceBranchId);
    if (!bid) return [];
    return destinationWarehouseOptionsForBranch.get(bid) || [];
  }, [form.sourceBranchId, destinationWarehouseOptionsForBranch]);

  useEffect(() => {
    // Derive branchIds from selected warehouses
    const sw = warehouseById.get(normalizeId(form.sourceWarehouseId)) || null;
    const tw = warehouseById.get(normalizeId(form.targetWarehouseId)) || null;

    const nextSourceBranchId = sw ? normalizeId(sw.branchId) : '';
    const nextTargetBranchId = tw ? normalizeId(tw.branchId) : '';

    setForm((p) => {
      const patch = {};
      if (nextSourceBranchId && normalizeId(p.sourceBranchId) !== nextSourceBranchId) patch.sourceBranchId = nextSourceBranchId;
      if (nextTargetBranchId && normalizeId(p.targetBranchId) !== nextTargetBranchId) patch.targetBranchId = nextTargetBranchId;
      return Object.keys(patch).length ? { ...p, ...patch } : p;
    });
  }, [form.sourceWarehouseId, form.targetWarehouseId, warehouseById]);

  useEffect(() => {
    if (mode !== 'warehouse') return;
    setForm((p) => {
      const sb = normalizeId(p.sourceBranchId);
      const tb = normalizeId(p.targetBranchId);
      if (sb && sb !== tb) {
        return { ...p, targetBranchId: sb, targetWarehouseId: '' };
      }
      if (!sb && tb) {
        return { ...p, targetBranchId: '' };
      }
      return p;
    });
  }, [mode, form.sourceBranchId]);

  const updateLine = (idx, patch, pickedItem = null) => {
    setForm((prev) => {
      const nextLines = safeArray(prev.lines).map((l, i) => {
        if (i !== idx) return l;

        const next = { ...l, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch || {}, 'itemId')) {
          const itemId = normalizeId(patch?.itemId);
          const master = pickedItem || (itemId ? itemById.get(itemId) : null);
          if (master) {
            if (!String(next.description || '').trim()) {
              next.description = String(master?.name || '').trim();
            }
            /**
             * An inter-state movement has to be valued, and the honest figure
             * is what the business last paid for the item — the item master
             * only when it has never been bought. Carried on the line so the
             * document keeps the number it was raised with.
             */
            const priced = latestPurchaseRate({ db, companyId: currentCompany?.id, itemId, item: master });
            next.rate = priced.rate;
            next.rateSource = priced.source;
            next.gstRate = toNum(master?.gstRate ?? 0);
          } else if (!itemId) {
            next.description = '';
            next.rate = '';
            next.rateSource = '';
            next.gstRate = 0;
          }
          // A batch belongs to one item — changing the item invalidates it.
          next.batchId = '';
          next.batchNo = '';
          next.expiryDate = '';
        }

        return next;
      });

      return { ...prev, lines: nextLines };
    });
  };

  const addLine = () => {
    setForm((prev) => ({
      ...prev,
      lines: [...safeArray(prev.lines), { itemId: '', description: '', qty: 1, batchId: '', batchNo: '', expiryDate: '' }],
    }));
  };

  const removeLine = (idx) => {
    setForm((prev) => ({ ...prev, lines: safeArray(prev.lines).filter((_, i) => i !== idx) }));
  };

  const validate = () => {
    const date = String(form.date || '').trim();
    const sourceWarehouseId = normalizeId(form.sourceWarehouseId);
    const targetWarehouseId = normalizeId(form.targetWarehouseId);
    const sourceBranchIdFromForm = normalizeId(form.sourceBranchId);
    const targetBranchIdFromForm = normalizeId(mode === 'warehouse' ? form.sourceBranchId : form.targetBranchId);

    if (!date) return 'Date is required';

    if (mode === 'warehouse' && !sourceBranchIdFromForm) return 'Branch is required';
    if (mode === 'branch' && !sourceBranchIdFromForm) return 'From Branch is required';
    if (mode === 'branch' && !targetBranchIdFromForm) return 'To Branch is required';
    if (mode === 'branch' && sourceBranchIdFromForm && targetBranchIdFromForm && sourceBranchIdFromForm === targetBranchIdFromForm) {
      return 'From Branch and To Branch cannot be the same';
    }

    if (!sourceWarehouseId) return 'From Warehouse is required';
    if (!targetWarehouseId) return 'To Warehouse is required';
    if (sourceWarehouseId === targetWarehouseId) {
      return 'From and To warehouse cannot be the same';
    }

    const sw = warehouseById.get(sourceWarehouseId) || null;
    const tw = warehouseById.get(targetWarehouseId) || null;
    const sourceBranchId = sw ? normalizeId(sw.branchId) : '';
    const targetBranchId = tw ? normalizeId(tw.branchId) : '';
    const isBranchTransfer = sourceBranchId && targetBranchId && sourceBranchId !== targetBranchId;

    if (mode === 'warehouse' && sourceBranchId && targetBranchId && isBranchTransfer) {
      return 'Warehouse transfer must be within the same branch';
    }

    if (mode === 'branch' && sourceBranchId && targetBranchId && !isBranchTransfer) {
      return 'Branch transfer must be between different branches';
    }

    // Ensure selected warehouses belong to selected branches (branch-first)
    if (sourceBranchIdFromForm && sourceBranchId && sourceBranchIdFromForm !== sourceBranchId) {
      return 'From Warehouse does not belong to the selected From Branch';
    }

    if (targetBranchIdFromForm && targetBranchId && targetBranchIdFromForm !== targetBranchId) {
      return 'Receiver Warehouse does not belong to the selected To Branch';
    }

    const lines = safeArray(form.lines)
      .map((l) => ({ itemId: normalizeId(l?.itemId), qty: toNum(l?.qty || 0) }))
      .filter((l) => l.itemId);

    if (lines.length === 0) return 'At least 1 item line is required';

    for (const l of lines) {
      if (l.qty <= 0) return 'Qty must be greater than 0';
      const item = safeArray(items).find((it) => normalizeId(it?.id) === l.itemId) || null;
      if (!item) return 'Invalid item in lines';
      if (!isStockItem(item)) return 'Only stock items can be transferred';

      // A batch-tracked item cannot move without saying which batch moves.
      if (isTracked(item)) {
        const raw = safeArray(form.lines).find((x) => normalizeId(x?.itemId) === l.itemId && toNum(x?.qty) === l.qty);
        const batchId = normalizeId(raw?.batchId);
        if (!batchId) return `Pick the batch of ${item.name} being transferred`;
        const batch = batchesForItem(db, currentCompany?.id, l.itemId, { includeEmpty: true }).find(
          (b) => normalizeId(b.id) === batchId
        );
        if (!batch) return `That batch of ${item.name} no longer exists`;
        if (toNum(batch.remaining) + 0.0001 < l.qty) {
          return `Batch ${batch.batchNo} of ${item.name} has only ${batch.remaining} left`;
        }
        if (needsExpiry(item) && !String(batch.expiryDate || '').trim()) {
          return `Batch ${batch.batchNo} of ${item.name} has no expiry date recorded`;
        }
      }
    }

    return '';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }

    setSaving(true);
    try {
      const cleanLines = safeArray(form.lines)
        .map((l) => ({
          itemId: normalizeId(l?.itemId),
          description: String(l?.description || '').trim(),
          qty: toNum(l?.qty || 0),
          // Batch-tracked lines carry which lot is moving; the rest stay empty.
          batchId: normalizeId(l?.batchId),
          batchNo: String(l?.batchNo || '').trim(),
          expiryDate: String(l?.expiryDate || '').trim(),
        }))
        .filter((l) => l.itemId && l.qty > 0);

      const next = {
        ...form,
        id: normalizeId(form.id) || makeId(),
        companyId: currentCompany?.id,
        number: String(form.number || '').trim(),
        date: String(form.date || '').trim(),
        status: String(form.status || 'Draft').trim() || 'Draft',
        sourceBranchId: normalizeId(form.sourceBranchId),
        sourceWarehouseId: normalizeId(form.sourceWarehouseId),
        targetBranchId: normalizeId(form.targetBranchId),
        targetWarehouseId: normalizeId(form.targetWarehouseId),
        reason: String(form.reason || '').trim(),
        lines: cleanLines,
      };

      let transferNumber = String(next.number || '').trim();
      if (isTransferAuto) {
        if (lockTransferNumberOnCreate) transferNumber = String(generatedTransferNumber || '').trim();
        else if (!transferNumber) transferNumber = String(generatedTransferNumber || '').trim();
      }

      if (!transferNumber) {
        setError('Transfer number is required');
        return;
      }

      const existingSameNo = safeArray(db?.stockTransfers)
        .filter((t) => Number(t?.companyId) === Number(currentCompany?.id))
        .some((t) => normalizeId(t?.id) !== normalizeId(next.id) && String(t?.number || '').trim() === transferNumber);
      if (existingSameNo) {
        setError('Transfer number already exists. Please change the number or update numbering settings.');
        return;
      }

      next.number = transferNumber;

      // Helpful denormalized labels for snapshots
      const sb = branchById.get(next.sourceBranchId) || null;
      const tb = branchById.get(next.targetBranchId) || null;
      const sw = warehouseById.get(next.sourceWarehouseId) || null;
      const tw = warehouseById.get(next.targetWarehouseId) || null;
      next.sourceBranchName = getBranchLabel(sb) || null;
      next.targetBranchName = getBranchLabel(tb) || null;
      next.sourceWarehouseName = getWarehouseLabel(sw) || null;
      next.targetWarehouseName = getWarehouseLabel(tw) || null;

      setDb((prev) => {
        const list = safeArray(prev?.stockTransfers);
        const exists = list.some((t) => normalizeId(t?.id) === normalizeId(next.id));
        const nextList = exists ? list.map((t) => (normalizeId(t?.id) === normalizeId(next.id) ? next : t)) : [...list, next];
        const companies = bumpCompanyNextNumber({
          db: prev,
          companyId: currentCompany?.id,
          voucherKey,
          usedNumber: next.number,
          branchId: normalizeId(next.sourceBranchId) || null,
        });
        return { ...prev, stockTransfers: nextList, companies };
      });

      onBack?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const readOnly = canonicalStatus(form.status) !== TRANSFER_STATUS.DRAFT;

  // One warehouse in the branch is not a choice worth making anybody make.
  // Declared after readOnly on purpose: it reads it.
  useEffect(() => {
    if (readOnly || isEdit) return;
    if (normalizeId(form.sourceWarehouseId)) return;
    if (sourceWarehouseOptions.length !== 1) return;
    const only = normalizeId(sourceWarehouseOptions[0]?.value);
    if (only) setForm((p) => ({ ...p, sourceWarehouseId: only }));
  }, [readOnly, isEdit, form.sourceWarehouseId, sourceWarehouseOptions]);

  const numberingBranchId = normalizeId(form.sourceBranchId) || null;
  const transferDocSettings = getDocSettings(db, currentCompany, { branchId: numberingBranchId });
  const transferNumbering = transferDocSettings?.numbering?.[voucherKey];
  const isTransferAuto = String(transferNumbering?.mode || '').toLowerCase() === 'auto';
  const lockTransferNumberOnCreate = !isEdit && isTransferAuto && !transferNumbering?.allowManualOverride;
  const generatedTransferNumber = !isEdit
    ? generateVoucherNumber({ db, company: currentCompany, voucherKey, branchId: numberingBranchId })
    : '';

  // A new transfer always sources from whatever the header currently points
  // at; the branch comes off that warehouse's own record rather than a
  // separately stored id that can disagree with it.
  const headerWarehouse = warehouseById.get(normalizeId(activeWarehouseId)) || null;
  const headerBranchId = normalizeId(headerWarehouse?.branchId);
  if (!isEdit && !readOnly && normalizeId(activeWarehouseId)) {
    const wantsWarehouse = normalizeId(activeWarehouseId);
    const needsWarehouse = normalizeId(form.sourceWarehouseId) !== wantsWarehouse;
    const needsBranch = headerBranchId && normalizeId(form.sourceBranchId) !== headerBranchId;
    if (needsWarehouse || needsBranch) {
      setForm((p) => {
        const nextSourceWh = wantsWarehouse;
        const nextSourceBranch = headerBranchId || p.sourceBranchId;
        return {
          ...p,
          sourceWarehouseId: nextSourceWh,
          sourceBranchId: nextSourceBranch,
          // A destination in the old branch (or the source itself) no longer
          // makes sense once the source moves.
          targetWarehouseId: normalizeId(p.targetWarehouseId) === nextSourceWh ? '' : p.targetWarehouseId,
          targetBranchId: mode === 'warehouse' ? nextSourceBranch : p.targetBranchId,
        };
      });
    }
  }

  const selectedSourceWarehouse = warehouseById.get(normalizeId(form.sourceWarehouseId)) || null;
  const selectedTargetWarehouse = warehouseById.get(normalizeId(form.targetWarehouseId)) || null;

  const selectedSourceBranch = branchById.get(normalizeId(form.sourceBranchId)) || null;
  const selectedTargetBranch = branchById.get(normalizeId(form.targetBranchId)) || null;

  const sourceState = String(selectedSourceWarehouse?.state || '').trim();
  const targetState = String(selectedTargetWarehouse?.state || '').trim();
  const sameState = Boolean(sourceState && targetState && sourceState.toLowerCase() === targetState.toLowerCase());

  /**
   * Stock crossing a state line is a supply.
   *
   * Within one state a transfer is a movement and carries no tax. Between two
   * states the registrations differ, so it is billed and IGST applies — the
   * form said "no GST is applied in transfer entry" in both cases, which was
   * true of the software and not of the movement.
   */
  const interState = Boolean(sourceState && targetState && !sameState);

  const lineTaxable = (l) => round2(toNum(l?.qty || 0) * toNum(l?.rate || 0));
  const lineIgst = (l) => (interState ? round2((lineTaxable(l) * toNum(l?.gstRate || 0)) / 100) : 0);

  const transferTotals = useMemo(() => {
    const lines = safeArray(form.lines);
    const taxable = round2(lines.reduce((sum, l) => sum + lineTaxable(l), 0));
    const igst = round2(lines.reduce((sum, l) => sum + lineIgst(l), 0));
    return { taxable, igst, total: round2(taxable + igst) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lines, interState]);

  const documentName =
    mode === 'branch'
      ? isEdit
        ? 'Edit Branch Transfer'
        : 'New Branch Transfer'
      : isEdit
        ? 'Edit Warehouse Transfer'
        : 'New Warehouse Transfer';

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* The bar every document form carries. The name was printed twice —
          once by the screen above the card and again inside it — and the two
          ways out sat at opposite ends of a long form. */}
      <DocFormActions
        title={documentName}
        subtitle={String(form.number || '').trim() || 'Draft'}
        onBack={() => onBack?.()}
        sticky
        primaryLabel={saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        disabled={saving || readOnly}
      />

      <div className="flex items-start justify-between gap-3">
        <div />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="ui-label" htmlFor="stocktransfermodule-voucher-no">Voucher No.</label>
            <input id="stocktransfermodule-voucher-no"
              type="text"
              value={form.number}
              onChange={(e) => setForm((p) => ({ ...p, number: e.target.value }))}
              className={`ui-input w-full ${!isEdit && lockTransferNumberOnCreate ? 'ui-sunken' : ''}`}
              placeholder="Auto"
              disabled={readOnly || (!isEdit && lockTransferNumberOnCreate)}
            />
          </div>
          <div className="w-44">
            <label className="ui-label" htmlFor="stocktransfermodule-date">Date</label>
            <input id="stocktransfermodule-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              className="ui-input w-full"
              required
              disabled={readOnly}
            />
          </div>
          <StatusPill status={canonicalStatus(form.status)} />
        </div>
      </div>

      {error ? <div className="text-sm text-[rgb(var(--neg))]">{error}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Source comes from the branch/warehouse chosen in the app header —
            the shift belongs on top of the software, not repeated in every
            form. Only the destination is chosen here. */}
        <div>
          <label className="ui-label">From (active {mode === 'branch' ? 'branch' : 'warehouse'})</label>
          <div className="ui-input ui-sunken w-full">
            {getBranchLabel(selectedSourceBranch) || '—'}
            {mode === 'warehouse' ? ` · ${getWarehouseLabel(selectedSourceWarehouse) || '—'}` : ''}
          </div>
          <div className="mt-1 text-xs ui-muted">Switch it from the header selector above.</div>
        </div>

        {mode === 'branch' ? (
          <div>
            <label className="ui-label" htmlFor="stocktransfermodule-from-warehouse">From Warehouse *</label>
            <select id="stocktransfermodule-from-warehouse"
              value={normalizeId(form.sourceWarehouseId)}
              onChange={(e) => {
                const nextId = String(e.target.value || '').trim();
                setForm((p) => ({
                  ...p,
                  sourceWarehouseId: nextId,
                  targetWarehouseId:
                    normalizeId(p.targetWarehouseId) === normalizeId(nextId) ? '' : p.targetWarehouseId,
                }));
              }}
              className="ui-select w-full ui-surface"
              required
              disabled={readOnly}
            >
              <option value="">{sourceWarehouseOptions.length ? 'Select Warehouse' : 'No warehouse in this branch'}</option>
              {sourceWarehouseOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs ui-muted">Stock leaves from here.</div>
          </div>
        ) : null}

        {mode === 'branch' ? (
          <div>
            <label className="ui-label" htmlFor="stocktransfermodule-to-branch">To Branch *</label>
            <select id="stocktransfermodule-to-branch"
              value={form.targetBranchId}
              onChange={(e) => {
                const nextBranchId = String(e.target.value || '').trim();
                setForm((p) => ({
                  ...p,
                  targetBranchId: nextBranchId,
                  targetWarehouseId: '',
                }));
              }}
              className="ui-select w-full ui-surface"
              required
              disabled={readOnly}
            >
              <option value="">Select Branch</option>
              {destinationBranchOptions.map((o) => (
                <option key={o.value} value={o.value} disabled={normalizeId(o.value) === normalizeId(form.sourceBranchId)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}


        <div>
          <label className="ui-label" htmlFor="stocktransfermodule-receiver-warehouse">Receiver Warehouse *</label>
          <select id="stocktransfermodule-receiver-warehouse"
            value={form.targetWarehouseId}
            onChange={(e) => {
              const nextId = String(e.target.value || '').trim();
              setForm((p) => {
                const sameAsSource = nextId && normalizeId(p.sourceWarehouseId) === normalizeId(nextId);
                return {
                  ...p,
                  targetWarehouseId: nextId,
                  sourceWarehouseId: sameAsSource ? '' : p.sourceWarehouseId,
                };
              });
            }}
            className="ui-select w-full ui-surface"
            required
            disabled={readOnly || !normalizeId(mode === 'warehouse' ? form.sourceBranchId : form.targetBranchId)}
          >
            <option value="">{normalizeId(mode === 'warehouse' ? form.sourceBranchId : form.targetBranchId) ? 'Select Warehouse' : 'Select Branch first'}</option>
            {targetBranchWarehouseOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={normalizeId(o.value) === normalizeId(form.sourceWarehouseId)}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs ui-muted">
            Branch: <span>{getBranchLabel(selectedTargetBranch) || '-'}</span> · State:{' '}
            <span>{targetState || '-'}</span>
          </div>
        </div>

      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="ui-label">Line Items</label>
          <button
            type="button"
            onClick={addLine}
            className="ui-fg ui-hover-fg text-sm flex items-center gap-1"
            disabled={readOnly}
          >
            <Plus size={16} /> Add Item
          </button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="ui-table w-full ui-table-wide">
            <thead className="ui-sunken">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium w-1/2">Item</th>
                <th className="px-3 py-2 text-left text-xs font-medium">Qty</th>
                {interState ? (
                  <>
                    <th className="px-3 py-2 text-right text-xs font-medium">Rate</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">Taxable</th>
                    <th className="px-3 py-2 text-right text-xs font-medium">IGST</th>
                  </>
                ) : null}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {safeArray(form.lines).map((l, idx) => (
                <React.Fragment key={idx}>
                <tr className="border-t">
                  {/* Half the row. Picking the item is the work here; the
                      free-text description was a second name for something
                      that already has one. */}
                  <td className="ui-col-entity px-3 py-2 w-1/2">
                    <ItemPicker
                      db={db}
                      setDb={setDb}
                      currentCompany={currentCompany}
                      value={l.itemId}
                      onChange={(val, picked) => updateLine(idx, { itemId: val }, picked)}
                      label={null}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={l.qty}
                      onChange={(e) => updateLine(idx, { qty: e.target.value })}
                      className="ui-input w-20 px-2 py-1"
                      min="1"
                      step="1"
                      disabled={readOnly}
                    />
                  </td>
                  {interState ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={l.rate ?? ''}
                          onChange={(e) => updateLine(idx, { rate: e.target.value })}
                          className="ui-input w-24 px-2 py-1 text-right"
                          min="0"
                          step="0.01"
                          disabled={readOnly}
      title={l.rateSource ? `Picked from ${l.rateSource}` : undefined}
                        />
                      </td>
                      <td className="ui-money ui-col-meta px-3 py-2 text-right">{formatMoney(lineTaxable(l), currentCompany)}</td>
                      <td className="ui-money ui-col-meta px-3 py-2 text-right">
                        {formatMoney(lineIgst(l), currentCompany)}
                        <div className="text-xs ui-muted">{toNum(l.gstRate || 0)}%</div>
                      </td>
                    </>
                  ) : null}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="text-[rgb(var(--neg))] hover:text-[rgb(var(--neg))]"
                      disabled={readOnly}
                      aria-label="Remove line"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                {(() => {
                  const master = normalizeId(l.itemId) ? itemById.get(normalizeId(l.itemId)) : null;
                  if (!master || !isTracked(master)) return null;
                  const available = batchesForItem(db, currentCompany?.id, normalizeId(l.itemId));
                  return (
                    <tr key={`batch-${idx}`} className="border-t-0">
                      <td colSpan={interState ? 6 : 3} className="px-3 pb-2 pt-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="ui-muted font-medium">Batch:</span>
                          <select
                            value={l.batchId || ''}
                            onChange={(e) => {
                              const picked = available.find((b) => normalizeId(b.id) === normalizeId(e.target.value));
                              updateLine(idx, {
                                batchId: e.target.value,
                                batchNo: picked ? String(picked.batchNo || '') : '',
                                expiryDate: picked ? String(picked.expiryDate || '') : '',
                              });
                            }}
                            className="ui-select px-2 text-xs min-w-52 ui-ctl-compact"
                            disabled={readOnly}
                          >
                            <option value="">Select batch *</option>
                            {available.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.batchNo}
                                {b.expiryDate ? ` · exp ${b.expiryDate}` : ''} · {b.remaining} left
                              </option>
                            ))}
                          </select>
                          {needsExpiry(master) && l.expiryDate ? (
                            <span className="ui-muted">Expiry {l.expiryDate}</span>
                          ) : null}
                          {available.length === 0 ? (
                            <span className="text-[rgb(var(--neg))]">
                              No stock with a batch for this item — receive it on a purchase bill first.
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {interState ? (
          <div className="mt-2 flex justify-end">
            <div className="text-sm space-y-0.5 min-w-56">
              <div className="flex justify-between gap-6">
                <span className="ui-muted">Taxable</span>
                <span className="ui-money ui-num">{formatMoney(transferTotals.taxable, currentCompany)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="ui-muted">IGST</span>
                <span className="ui-money ui-num">{formatMoney(transferTotals.igst, currentCompany)}</span>
              </div>
              <div className="flex justify-between gap-6 font-semibold border-t pt-0.5">
                <span>Total</span>
                <span className="ui-money ui-num">{formatMoney(transferTotals.total, currentCompany)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Reason and the tax note, under the items and kept small — they are
          footnotes to the movement, not the first thing to fill in. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs">
        <label className="flex items-center gap-2 grow min-w-64">
          <span className="ui-muted shrink-0">Reason / Notes</span>
          <input
            type="text"
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            className="ui-input w-full px-2 text-xs ui-ctl-compact"
            placeholder="Optional"
            disabled={readOnly}
          />
        </label>
        <div className="ui-muted shrink-0 pt-1.5">
          {interState
            ? `Inter-state movement — IGST applies, valued at the last purchase price.`
            : 'Within one state — a stock movement, no GST.'}
        </div>
      </div>

    </form>
  );
};

/**
 * Transfer In: the receiving warehouse counts what actually arrived. Anything
 * other than the dispatched quantity is a mismatch the sender has to resolve.
 */
const ReceiveTransferForm = ({ transfer, db, currentCompany, onConfirm, onCancel }) => {
  const itemsById = useMemo(() => {
    const map = new Map();
    for (const it of safeArray(db?.items)) {
      if (Number(it?.companyId) !== Number(currentCompany?.id)) continue;
      map.set(normalizeId(it?.id), it);
    }
    return map;
  }, [db?.items, currentCompany?.id]);

  const [rows, setRows] = useState(() =>
    safeArray(transfer?.lines).map((l) => ({
      itemId: normalizeId(l?.itemId),
      sent: toNum(l?.qty || 0),
      received: String(l?.receivedQty ?? l?.qty ?? 0),
      batchNo: String(l?.batchNo || '').trim(),
      expiryDate: String(l?.expiryDate || '').trim(),
    }))
  );
  const [note, setNote] = useState('');

  const anyMismatch = rows.some((r) => Math.abs(toNum(r.received) - r.sent) > 0.0001);

  return (
    <div className="space-y-6">
      <div className="text-sm ui-muted">
        Confirm what physically arrived. Short or excess quantities are flagged for resolution.
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Item</th>
              <th className="ui-th ui-num">Sent</th>
              <th className="ui-th ui-num">Received</th>
              <th className="ui-th ui-num">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, idx) => {
              const item = itemsById.get(r.itemId);
              const diff = round2(Math.max(0, toNum(r.received)) - r.sent);
              return (
                <tr key={idx} className={Math.abs(diff) > 0.0001 ? 'bg-[rgb(var(--warn-soft))]' : ''}>
                  <td className="ui-col-entity px-4 py-2.5">
                    <div>{item?.name || `Item ${r.itemId}`}</div>
                    {r.batchNo ? (
                      <div className="text-xs ui-muted">
                        Batch {r.batchNo}
                        {r.expiryDate ? ` · exp ${r.expiryDate}` : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">{r.sent}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.received}
                      onChange={(e) =>
                        setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, received: e.target.value } : x)))
                      }
                      className="ui-input w-24 px-2 py-1 text-right"
                    />
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${Math.abs(diff) > 0.0001 ? 'text-[rgb(var(--warn-ink))]' : 'ui-muted'}`}>
                    {diff === 0 ? '—' : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <label className="ui-label" htmlFor="stocktransfermodule-note-optional">Note (optional)</label>
        <input id="stocktransfermodule-note-optional" type="text" value={note} onChange={(e) => setNote(e.target.value)} className="ui-input w-full" placeholder="Damaged in transit, short packed…" />
      </div>

      {anyMismatch ? (
        <div className="ui-pill ui-pill-warn">Quantities differ — the transfer will need a resolution before it closes.</div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-secondary">Cancel</button>
        <button
          type="button"
          onClick={() => onConfirm(rows.map((r) => ({ itemId: r.itemId, receivedQty: Math.max(0, round2(toNum(r.received))) })), note)}
          className="ui-btn ui-btn-primary"
        >
          Confirm Receipt
        </button>
      </div>
    </div>
  );
};

const StockTransferDetails = ({ transfer, branches, warehouses, db, currentCompany, onAction, atSource = true, atTarget = true }) => {
  const branchById = useMemo(() => new Map(safeArray(branches).map((b) => [normalizeId(b?.id), b])), [branches]);
  const warehouseById = useMemo(() => new Map(safeArray(warehouses).map((w) => [normalizeId(w?.id), w])), [warehouses]);

  const status = canonicalStatus(transfer);

  const sb = branchById.get(normalizeId(transfer?.sourceBranchId)) || null;
  const tb = branchById.get(normalizeId(transfer?.targetBranchId)) || null;
  const sw = warehouseById.get(normalizeId(transfer?.sourceWarehouseId)) || null;
  const tw = warehouseById.get(normalizeId(transfer?.targetWarehouseId)) || null;

  const itemsById = useMemo(() => {
    const companyId = currentCompany?.id;
    const map = new Map();
    for (const it of safeArray(db?.items)) {
      if (Number(it?.companyId) !== Number(companyId)) continue;
      map.set(normalizeId(it?.id), it);
    }
    return map;
  }, [db?.items, currentCompany?.id]);

  const lines = safeArray(transfer?.lines).map((l) => {
    const it = itemsById.get(normalizeId(l?.itemId)) || null;
    return {
      itemId: normalizeId(l?.itemId),
      name: it?.name || `Item ${normalizeId(l?.itemId)}`,
      unit: String(it?.unit || '').trim(),
      qty: toNum(l?.qty || 0),
    };
  });

  const gaps = mismatchLines(transfer);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-t-sec">{transfer?.number || 'Stock Transfer'}</div>
          <div className="text-sm ui-muted">{transfer?.date || '-'}</div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="ui-muted">From</div>
          <div className="font-medium">{getBranchLabel(sb) || transfer?.sourceBranchName || '-'}</div>
          <div className="ui-fg">{getWarehouseLabel(sw) || transfer?.sourceWarehouseName || '-'}</div>
        </div>
        <div>
          <div className="ui-muted">To</div>
          <div className="font-medium">{getBranchLabel(tb) || transfer?.targetBranchName || '-'}</div>
          <div className="ui-fg">{getWarehouseLabel(tw) || transfer?.targetWarehouseName || '-'}</div>
        </div>
      </div>

      {transfer?.reason ? (
        <div className="text-sm">
          <div className="ui-muted">Reason / Notes</div>
          <div className="ui-fg whitespace-pre-wrap">{String(transfer.reason)}</div>
        </div>
      ) : null}

      {gaps.length && status === 'Short Received' ? (
        <div className="rounded-xl border p-3 text-sm bg-[rgb(var(--warn-soft))] text-[rgb(var(--warn-ink))]">
          {gaps.length} line(s) received short or in excess. Write the shortfall off as a loss, or return it to the
          source warehouse.
        </div>
      ) : null}

      {transfer?.mismatchResolution ? (
        <div className="text-xs ui-muted">
          Resolved as {transfer.mismatchResolution === 'LOSS' ? 'a stock loss' : 'a return to source'}
          {transfer?.receiptNote ? ` — ${transfer.receiptNote}` : ''}
        </div>
      ) : null}

      <div className="ui-surface rounded-xl shadow-sm overflow-hidden border">
        <table className="ui-table w-full">
          <thead className="ui-sunken border-b">
            <tr>
              <th className="ui-th">Item</th>
              <th className="ui-th ui-num">Sent</th>
              <th className="ui-th ui-num">Received</th>
              <th className="ui-th ui-num">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center ui-muted">
                  No lines
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => {
                const raw = safeArray(transfer?.lines)[idx] || {};
                const settled = raw?.receivedQty !== undefined && raw?.receivedQty !== null;
                const received = settled ? toNum(raw.receivedQty) : null;
                const diff = settled ? round2(received - l.qty) : 0;
                const off = settled && Math.abs(diff) > 0.0001;
                return (
                  <tr key={idx} className={off ? 'bg-[rgb(var(--warn-soft))]' : 'ui-hover-sunken'}>
                    <td className="ui-col-entity px-4 py-3">
                      <div>{l.name}</div>
                      <div className="text-xs ui-muted">
                        {raw?.batchNo
                          ? `Batch ${raw.batchNo}${raw?.expiryDate ? ` · exp ${raw.expiryDate}` : ''}`
                          : l.itemId}
                      </div>
                    </td>
                    <td className="ui-col-meta px-4 py-3 text-right font-medium">
                      {l.qty}{l.unit ? ` ${l.unit}` : ''}
                    </td>
                    <td className="ui-col-meta px-4 py-3 text-right">{settled ? received : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${off ? 'text-[rgb(var(--warn-ink))]' : 'ui-muted'}`}>
                      {!settled || diff === 0 ? '—' : diff > 0 ? `+${diff}` : diff}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <StockTransferDetailsActions
        transfer={transfer}
        onAction={onAction}
        atSource={atSource}
        atTarget={atTarget}
      />
    </div>
  );
};

/**
 * What can be done to a transfer, from where it is being looked at.
 *
 * Shared by the row menu and the document view so the two can never offer
 * different actions for the same transfer. Rendered only when a handler is
 * supplied: the printable document passes none, and so has none.
 */
const StockTransferDetailsActions = ({ transfer, onAction, atSource = true, atTarget = true }) => {
  if (typeof onAction !== 'function') return null;

  const status = canonicalStatus(transfer);
  const canSubmit = status === TRANSFER_STATUS.DRAFT && atSource;
  const canReceive = status === TRANSFER_STATUS.OUT && atTarget;
  const canReject = status === TRANSFER_STATUS.OUT && atTarget;
  const canResolve = status === TRANSFER_STATUS.SHORT && atTarget;
  const canCancel = status === TRANSFER_STATUS.DRAFT && atSource;

  return (
    <div className="flex gap-2 flex-wrap">
          {canSubmit ? (
            <button
              type="button"
              onClick={() => onAction?.('submit')}
              className="px-3 py-2 rounded-lg text-sm ui-btn ui-btn-primary flex items-center gap-2"
            >
              <Check size={16} /> Submit — Transfer Out
            </button>
          ) : null}

          {canReceive ? (
            <PermissionButton
              permission="INVENTORY::Stock Transfer::APPROVE"
              onClick={() => onAction?.('receive')}
              className="px-3 py-2 rounded-lg text-sm ui-btn ui-btn-primary flex items-center gap-2"
            >
              <Check size={16} /> Approve — Transfer In
            </PermissionButton>
          ) : null}

          {canResolve ? (
            <>
              <button
                type="button"
                onClick={() => onAction?.('resolveLoss')}
                className="px-3 py-2 rounded-lg text-sm ui-btn ui-btn-primary"
              >
                Write off shortfall as loss
              </button>
              <button
                type="button"
                onClick={() => onAction?.('resolveReturn')}
                className="px-3 py-2 rounded-lg text-sm border ui-surface ui-hover-sunken ui-border-c"
              >
                Return shortfall to source
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => onAction?.('print')}
            className="px-3 py-2 rounded-lg text-sm border ui-surface ui-hover-sunken ui-border-c"
          >
            Print / Download
          </button>

          {canReject ? (
            <button
              type="button"
              onClick={() => onAction?.('reject')}
              className="px-3 py-2 rounded-lg text-sm border ui-surface ui-hover-sunken ui-border-c flex items-center gap-2"
            >
              <X size={16} /> Reject
            </button>
          ) : null}

          {canCancel ? (
            <button
              type="button"
              onClick={() => onAction?.('cancel')}
              className="px-3 py-2 rounded-lg text-sm border ui-surface ui-hover-sunken ui-border-c"
            >
              Cancel
            </button>
          ) : null}
    </div>
  );
};

/**
 * The transfer as a document: what the row click opens. Print goes through the
 * module's own print window; Download renders the same markup to a PDF.
 */
const TransferDocumentView = ({ transfer, branches, warehouses, db, currentCompany, onPrint, onAction, atSource = true, atTarget = true }) => {
  const docRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const no = String(transfer?.number || '').trim();

  const doDownload = async () => {
    const el = docRef.current;
    if (!el || downloading) return;
    setDownloading(true);
    const prevTitle = document.title;
    const base = (no || 'transfer').replace(/[\\/:*?"<>|]/g, '-').trim() || 'transfer';
    try {
      if (no) document.title = no;
      document.body.classList.add('print-mode');
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      await new Promise((resolve) => {
        doc.html(el, {
          x: 18,
          y: 18,
          width: 559,
          windowWidth: Math.max(el.scrollWidth || 0, 980),
          margin: [18, 18, 18, 18],
          autoPaging: 'text',
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          callback: () => resolve(),
        });
      });
      doc.save(`${base}.pdf`);
    } catch {
      notify.error('Unable to generate PDF. Please try again.');
    } finally {
      document.body.classList.remove('print-mode');
      document.title = prevTitle;
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onPrint} className="ui-btn ui-btn-secondary">
          Print
        </button>
        <button type="button" onClick={doDownload} disabled={downloading} className="ui-btn ui-btn-primary">
          {downloading ? 'Preparing…' : 'Download'}
        </button>
      </div>
      <div ref={docRef}>
        {/*
          No onAction inside the captured element on purpose. The buttons used
          to render here and do nothing at all — the handler was never passed
          down, so Submit swallowed every click — and they would have been
          printed onto the document besides.
        */}
        <StockTransferDetails
          transfer={transfer}
          branches={branches}
          warehouses={warehouses}
          db={db}
          currentCompany={currentCompany}
        />
      </div>

      {/* The live actions, outside the paper. */}
      <StockTransferDetailsActions
        transfer={transfer}
        onAction={onAction}
        atSource={atSource}
        atTarget={atTarget}
      />
    </div>
  );
};

export const StockTransfersList = ({
  db,
  setDb,
  currentCompany,
  openModal,
  branches = [],
  warehouses = [],
  mode = 'warehouse',
  activeWarehouseId: activeWarehouseIdProp,
  activeBranchId: activeBranchIdProp,
  onNew,
  onEdit,
}) => {
  const companyId = currentCompany?.id;

  const transferPeriod = usePeriodFilter();
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  const branchById = useMemo(() => new Map(safeArray(branches).map((b) => [normalizeId(b?.id), b])), [branches]);
  const warehouseById = useMemo(() => new Map(safeArray(warehouses).map((w) => [normalizeId(w?.id), w])), [warehouses]);

  const getBranchIdFromWarehouseId = (warehouseId) => {
    const w = warehouseById.get(normalizeId(warehouseId)) || null;
    return normalizeId(w?.branchId);
  };

  const transfers = useMemo(() => {
    return safeArray(db?.stockTransfers)
      .filter((t) => Number(t?.companyId) === Number(companyId))
      .filter((t) => {
        // What the transfer recorded at the time beats a warehouse lookup: the
        // warehouse list is scoped to the branch in the header, so a user
        // standing in another branch cannot resolve these ids at all.
        const sb = normalizeId(t?.sourceBranchId) || getBranchIdFromWarehouseId(t?.sourceWarehouseId);
        const tb = normalizeId(t?.targetBranchId) || getBranchIdFromWarehouseId(t?.targetWarehouseId);
        if (!sb || !tb) return mode !== 'branch';
        const isBranchTransfer = sb !== tb;
        if (mode === 'branch') return isBranchTransfer;
        return !isBranchTransfer;
      })
      .slice()
      .sort((a, b) => {
        const da = String(a?.date || '');
        const dbb = String(b?.date || '');
        if (da !== dbb) return da < dbb ? 1 : -1;
        return String(a?.number || '').localeCompare(String(b?.number || ''));
      });
  }, [db?.stockTransfers, companyId, mode, warehouseById]);

  // Where the user is standing decides what a transfer is to them: the sender
  // dispatches it, the receiver approves it. With no location picked (the "All
  // warehouses" view) both sides are open, so a supervisor is not locked out.
  const activeWarehouseId = normalizeId(
    activeWarehouseIdProp !== undefined ? activeWarehouseIdProp : localStorage.getItem('activeWarehouseId') || ''
  );
  const activeBranchId = normalizeId(
    activeBranchIdProp !== undefined
      ? activeBranchIdProp
      : localStorage.getItem('activeBranchId') || localStorage.getItem('branchId') || ''
  );

  const isAtSource = (t) =>
    mode === 'branch'
      ? !activeBranchId || normalizeId(t?.sourceBranchId) === activeBranchId
      : !activeWarehouseId || normalizeId(t?.sourceWarehouseId) === activeWarehouseId;
  const isAtTarget = (t) =>
    mode === 'branch'
      ? !activeBranchId || normalizeId(t?.targetBranchId) === activeBranchId
      : !activeWarehouseId || normalizeId(t?.targetWarehouseId) === activeWarehouseId;

  const locationLabel = (t, which) =>
    mode === 'branch'
      ? String((which === 'source' ? t?.sourceBranchName : t?.targetBranchName) || '').trim() || 'that branch'
      : String((which === 'source' ? t?.sourceWarehouseName : t?.targetWarehouseName) || '').trim() || 'that warehouse';

  const transferColFilters = useColumnFilters();

  /*
   * Everything this screen could show, before the status tabs narrow it — the
   * counts on the tabs and the figures above them describe this, otherwise the
   * "In transit 4" tab would read 0 the moment somebody clicked Draft.
   */
  const transfersInScope = useMemo(
    () => transfers.filter((t) => transferPeriod.inRange(t?.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transfers, transferPeriod.dateFrom, transferPeriod.dateTo]
  );

  const filteredTransfers = useMemo(() => {
    const q = String(searchText || '').trim().toLowerCase();
    const wantStatus = String(statusFilter || '').trim();

    const matchesSearch = (t) => {
      if (!q) return true;
      const hay = [t?.number, t?.sourceBranchName, t?.sourceWarehouseName, t?.targetBranchName, t?.targetWarehouseName]
        .map((x) => String(x || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      return hay.includes(q);
    };

    return transferColFilters.applyFilters(
      transfers
        .filter((t) => matchesSearch(t))
        .filter((t) => transferPeriod.inRange(t?.date))
        .filter((t) => {
          if (!wantStatus) return true;
          return canonicalStatus(t) === wantStatus;
        }),
      {
        number: (t) => t.number,
        date: (t) => t.date,
        from: (t) => [t.sourceBranchName, t.sourceWarehouseName].filter(Boolean).join(' / '),
        to: (t) => [t.targetBranchName, t.targetWarehouseName].filter(Boolean).join(' / '),
        status: (t) => statusForViewer(t, { atTarget: isAtTarget(t) }),
      }
    );
    // The two dates rather than the hook object, which is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, statusFilter, transfers, transferColFilters.applyFilters, activeWarehouseId, activeBranchId, transferPeriod.dateFrom, transferPeriod.dateTo]);

  useEffect(() => {
    if (!openMenu?.id) return;

    const onMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      const btn = e.target?.closest?.('[data-transfer-menu-button]');
      if (btn && String(btn.getAttribute('data-transfer-menu-button')) === String(openMenu.id)) return;
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

  const openCreate = () => onNew?.();
  const openEdit = (transfer) => onEdit?.(transfer);

  const pendingIn = useMemo(() => {
    return safeArray(db?.stockTransfers)
      .filter((t) => Number(t?.companyId) === Number(companyId))
      .filter((t) => canonicalStatus(t) === TRANSFER_STATUS.OUT)
      .filter((t) =>
        mode === 'branch'
          ? !activeBranchId || normalizeId(t?.targetBranchId) === activeBranchId
          : !activeWarehouseId || normalizeId(t?.targetWarehouseId) === activeWarehouseId
      );
  }, [db?.stockTransfers, companyId, mode, activeWarehouseId, activeBranchId]);

  const removeTransfer = async (transfer) => {
    const ok = await confirmDialog({ title: 'Please confirm', message: `Delete stock transfer ${transfer?.number || ''}?`, confirmLabel: 'Yes, continue' });
    if (!ok) return;

    setDb((prev) => {
      const list = safeArray(prev?.stockTransfers);
      const next = list.filter((t) => normalizeId(t?.id) !== normalizeId(transfer?.id));
      return { ...prev, stockTransfers: next };
    });
  };

  const updateStatus = (transfer, status) => {
    const nextStatus = String(status || '').trim();
    setDb((prev) => {
      const list = safeArray(prev?.stockTransfers);
      return {
        ...prev,
        stockTransfers: list.map((t) => {
          if (normalizeId(t?.id) !== normalizeId(transfer?.id)) return t;
          return { ...t, status: nextStatus };
        }),
      };
    });
  };

  const patchTransfer = (transfer, patch) => {
    setDb((prev) => ({
      ...prev,
      stockTransfers: safeArray(prev?.stockTransfers).map((t) =>
        normalizeId(t?.id) === normalizeId(transfer?.id) ? { ...t, ...patch } : t
      ),
    }));
  };

  /** Transfer In: record what the receiving warehouse counted. */
  const openReceive = (transfer) => {
    if (typeof openModal !== 'function') return;
    openModal(
      <ReceiveTransferForm
        transfer={transfer}
        db={db}
        currentCompany={currentCompany}
        onCancel={() => openModal(null)}
        onConfirm={(received, note) => {
          const byId = new Map(received.map((r) => [String(r.itemId), r.receivedQty]));
          const lines = safeArray(transfer?.lines).map((l) => {
            const key = normalizeId(l?.itemId);
            return byId.has(key) ? { ...l, receivedQty: byId.get(key) } : { ...l, receivedQty: toNum(l?.qty || 0) };
          });
          const short = lines.some((l) => Math.abs(toNum(l.receivedQty) - toNum(l.qty)) > 0.0001);
          patchTransfer(transfer, {
            lines,
            status: short ? TRANSFER_STATUS.SHORT : TRANSFER_STATUS.IN,
            receivedAt: new Date().toISOString(),
            receiptNote: String(note || '').trim(),
          });
          openModal(null);
          notify[short ? 'info' : 'success'](
            short
              ? 'Receipt recorded with a quantity mismatch — resolve it to close the transfer.'
              : `Transfer ${transfer?.number || ''} approved — the stock is now in this ${mode === 'branch' ? 'branch' : 'warehouse'}.`
          );
        }}
      />,
      { title: `Transfer In — ${transfer?.number || ''}`.trim(), maxWidthClass: 'max-w-3xl' }
    );
  };

  const resolveMismatch = async (transfer, resolution) => {
    const asLoss = resolution === 'LOSS';
    const ok = await confirmDialog({
      title: asLoss ? 'Write off shortfall' : 'Return shortfall to source',
      message: asLoss
        ? 'The missing quantity leaves the source warehouse and never arrives — it is written off as a stock loss.'
        : 'The missing quantity is treated as never dispatched and stays with the source warehouse.',
      confirmLabel: 'Yes, continue',
    });
    if (!ok) return;
    patchTransfer(transfer, { status: TRANSFER_STATUS.CLOSED, mismatchResolution: asLoss ? 'LOSS' : 'RETURN', resolvedAt: new Date().toISOString() });
    notify.success(asLoss ? 'Shortfall written off as a loss.' : 'Shortfall returned to the source warehouse.');
  };

  /**
   * Reject and cancel, named once.
   *
   * They lived inline in the row menu, which is why the document view could
   * not offer them: there was nothing to call.
   */
  const rejectTransfer = async (t) => {
    const ok = await confirmDialog({
      title: 'Reject this transfer?',
      message: `The consignment goes back to ${locationLabel(t, 'source')} — the stock stays on their books and never lands here.`,
      confirmLabel: 'Yes, reject',
    });
    if (!ok) return;
    updateStatus(t, TRANSFER_STATUS.REJECTED);
    notify.info(`Transfer ${t?.number || ''} rejected — the stock returns to ${locationLabel(t, 'source')}.`);
  };

  const cancelTransfer = async (t) => {
    const ok = await confirmDialog({ title: 'Please confirm', message: 'Cancel this transfer?', confirmLabel: 'Yes, continue' });
    if (!ok) return;
    updateStatus(t, TRANSFER_STATUS.CANCELLED);
  };

  /** Opens the transfer as a document, with Print and Download beside it. */
  const openDocument = (transfer) => {
    if (typeof openModal !== 'function') return;
    openModal(
      <TransferDocumentView
        transfer={transfer}
        branches={branches}
        warehouses={warehouses}
        db={db}
        currentCompany={currentCompany}
        onPrint={() => printTransfer(transfer)}
        atSource={isAtSource(transfer)}
        atTarget={isAtTarget(transfer)}
        onAction={(action) => {
          if (action === 'submit') return submitTransferOut(transfer);
          if (action === 'receive') return openReceive(transfer);
          if (action === 'reject') return rejectTransfer(transfer);
          if (action === 'cancel') return cancelTransfer(transfer);
          if (action === 'resolveLoss') return resolveMismatch(transfer, 'LOSS');
          if (action === 'resolveReturn') return resolveMismatch(transfer, 'RETURN');
          if (action === 'print') return printTransfer(transfer);
          return undefined;
        }}
      />,
      { title: `${transfer?.number || 'Transfer'}`, maxWidthClass: 'max-w-3xl' }
    );
  };

  /** The transfer document, printable and savable as PDF by the browser. */
  const printTransfer = (transfer) => {
    const itemName = (id) =>
      safeArray(db?.items).find((i) => normalizeId(i?.id) === normalizeId(id))?.name || `Item ${normalizeId(id)}`;
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = safeArray(transfer?.lines)
      .map((l) => {
        const received = l?.receivedQty === undefined || l?.receivedQty === null ? '' : toNum(l.receivedQty);
        const batch = String(l?.batchNo || '').trim();
        const batchCell = batch ? `${esc(batch)}${l?.expiryDate ? ` (exp ${esc(l.expiryDate)})` : ''}` : '—';
        return `<tr><td>${esc(itemName(l?.itemId))}</td><td>${batchCell}</td><td class="r">${toNum(l?.qty || 0)}</td><td class="r">${received === '' ? '—' : received}</td></tr>`;
      })
      .join('');

    const w = window.open('', '_blank');
    if (!w) {
      notify.error('Allow pop-ups to print the transfer document.');
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(transfer?.number || 'Transfer')}</title>
      <style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:12px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f5f5f5}.r{text-align:right}
      .meta{display:flex;gap:32px;margin-top:8px}.meta div{font-size:12px}</style></head><body>
      <h1>${esc(mode === 'branch' ? 'Branch Transfer' : 'Warehouse Transfer')} — ${esc(transfer?.number || '')}</h1>
      <div>Status: ${esc(canonicalStatus(transfer))} · Date: ${esc(transfer?.date || '')}</div>
      <div class="meta">
        <div><strong>From</strong><br>${esc(transfer?.sourceBranchName || '')}<br>${esc(transfer?.sourceWarehouseName || '')}</div>
        <div><strong>To</strong><br>${esc(transfer?.targetBranchName || '')}<br>${esc(transfer?.targetWarehouseName || '')}</div>
      </div>
      ${transfer?.reason ? `<p><strong>Reason:</strong> ${esc(transfer.reason)}</p>` : ''}
      <table><thead><tr><th>Item</th><th>Batch</th><th class="r">Sent</th><th class="r">Received</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="margin-top:32px">Dispatched by ____________________ &nbsp;&nbsp; Received by ____________________</p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const submitTransferOut = async (transfer) => {
    const sourceWarehouseId = normalizeId(transfer?.sourceWarehouseId);
    const date = String(transfer?.date || '').trim();

    const lines = safeArray(transfer?.lines)
      .map((l) => ({ itemId: normalizeId(l?.itemId), qty: toNum(l?.qty || 0) }))
      .filter((l) => l.itemId && l.qty > 0);

    if (!sourceWarehouseId) {
      notify.error('From Warehouse is required');
      return;
    }

    const summary = computeInventorySummaryByItemId({ db, companyId: currentCompany?.id, fromDate: '', toDate: date, warehouseId: sourceWarehouseId });

    for (const l of lines) {
      const row = summary.get(l.itemId);
      const available = toNum(row?.closingQty ?? 0);
      if (available + 0.0001 < l.qty) {
        notify.error(`Not enough stock for item ${l.itemId} in the source warehouse. Available: ${available}, trying to transfer: ${l.qty}`);
        return;
      }
    }

    /*
     * The IGST an inter-state movement carries, POSTED — not merely printed.
     *
     * A transfer between two GSTINs is a supply: the sending side owes
     * Output IGST and the receiving side claims Input IGST. Both sit in one
     * org's books here, so the entry is Dr Input IGST / Cr Output IGST for
     * the document's IGST — through the same journal engine as everything,
     * once per transfer (the journal id is kept on the transfer). Where the
     * chart has no IGST ledgers the figure stays document-only and says so,
     * rather than landing somewhere it does not belong.
     */
    const igstJournalPatch = (() => {
      if (transfer?.gstJournalId) return {};
      const swState = String(warehouseById.get(normalizeId(transfer?.sourceWarehouseId))?.state || '').trim();
      const twState = String(warehouseById.get(normalizeId(transfer?.targetWarehouseId))?.state || '').trim();
      const isInter = Boolean(swState && twState && swState.toLowerCase() !== twState.toLowerCase());
      if (!isInter) return {};
      const itemsById = new Map(safeArray(db?.items).filter((i) => i.companyId === currentCompany?.id).map((i) => [normalizeId(i.id), i]));
      const igst = round2(
        safeArray(transfer?.lines).reduce((sum, l) => {
          const item = itemsById.get(normalizeId(l?.itemId));
          const rate = toNum(l?.gstRate ?? item?.gstRate ?? 0);
          const taxable = toNum(l?.qty || 0) * toNum(l?.rate ?? item?.purchasePrice ?? 0);
          return sum + (taxable * rate) / 100;
        }, 0)
      );
      if (igst <= 0.005) return {};
      const chart = safeArray(db?.chartOfAccounts).filter((a) => a.companyId === currentCompany?.id);
      const inputIgst = chart.find((a) => /input\s*igst/i.test(String(a.name || '')));
      const outputIgst = chart.find((a) => /output\s*igst/i.test(String(a.name || '')));
      if (!inputIgst || !outputIgst) {
        notify.info('IGST on this transfer stays on the document — create Input IGST and Output IGST ledgers to post it.');
        return {};
      }
      return { igst, inputIgst, outputIgst, chart };
    })();

    if (igstJournalPatch.igst) {
      const { igst, inputIgst, outputIgst, chart } = igstJournalPatch;
      const lines2 = [
        { accountId: String(inputIgst.id), accountName: inputIgst.name, debit: igst, credit: 0 },
        { accountId: String(outputIgst.id), accountName: outputIgst.name, debit: 0, credit: igst },
      ];
      const ledgerPatch = await postJournalToLedger({
        chartRows: chart,
        entry: { date, narration: `IGST on transfer ${transfer?.number || ''}`.trim(), lines: lines2 },
      });
      setDb((prev) => {
        const jid = ((prev.journalEntries || []).reduce((m, j) => Math.max(m, Number(j?.id || 0)), 0) || 0) + 1;
        return {
          ...prev,
          journalEntries: [
            ...(prev.journalEntries || []),
            {
              id: jid,
              companyId: currentCompany?.id,
              number: `TRF-${transfer?.number || transfer?.id}`,
              date,
              narration: `IGST on transfer ${transfer?.number || ''}`.trim(),
              lines: lines2,
              totalDebit: igst,
              totalCredit: igst,
              sourceTransferId: transfer?.id,
              createdAt: new Date().toISOString(),
              ...ledgerPatch,
            },
          ],
          stockTransfers: (prev.stockTransfers || []).map((t) =>
            normalizeId(t?.id) === normalizeId(transfer?.id) ? { ...t, gstJournalId: jid } : t
          ),
        };
      });
    }

    patchTransfer(transfer, { status: TRANSFER_STATUS.OUT, dispatchedAt: new Date().toISOString() });
    notify.success(
      `Transfer ${transfer?.number || ''} submitted — stock has left ${locationLabel(transfer, 'source')} and is awaiting approval at ${locationLabel(transfer, 'target')}.`
    );
  };

  const MENU_WIDTH = 224; // w-56
  const MENU_HEIGHT_ESTIMATE = 340;

  const openRowMenu = async (id, anchorEl) => {
    if (!anchorEl) {
      setOpenMenu({ id, left: 0, top: 0 });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const padding = 8;

    let left = rect.right - MENU_WIDTH;
    left = Math.max(padding, Math.min(left, vw - MENU_WIDTH - padding));

    let top = rect.bottom + 8;
    if (top + MENU_HEIGHT_ESTIMATE > vh - padding) {
      top = rect.top - MENU_HEIGHT_ESTIMATE - 8;
    }

    setOpenMenu({ id, left, top });
  };

  const transferExportColumns = [
    { key: 'number', label: 'Transfer #' },
    { key: 'date', label: 'Date' },
    { key: 'from', label: 'From', value: (r) => [r.sourceBranchName, r.sourceWarehouseName].filter(Boolean).join(' / ') },
    { key: 'to', label: 'To', value: (r) => [r.targetBranchName, r.targetWarehouseName].filter(Boolean).join(' / ') },
    { key: 'lines', label: 'Lines', value: (r) => safeArray(r.lines).length },
    { key: 'sentQty', label: 'Qty sent', value: (r) => safeArray(r.lines).reduce((t, l) => t + toNum(l?.qty || 0), 0) },
    {
      key: 'receivedQty',
      label: 'Qty received',
      value: (r) =>
        safeArray(r.lines).reduce((t, l) => t + (l?.receivedQty === undefined || l?.receivedQty === null ? 0 : toNum(l.receivedQty)), 0),
    },
    { key: 'status', label: 'Status' },
    { key: 'mismatchResolution', label: 'Resolution' },
    { key: 'reason', label: 'Reason' },
  ];

  /*
   * A transfer's life, as tabs. In transit is the one that matters: stock has
   * left one place and not arrived anywhere, so it belongs to nobody's shelf
   * until somebody at the far end confirms what turned up.
   */
  const TRANSFER_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: TRANSFER_STATUS.DRAFT, label: 'Draft', tone: 'draft' },
    { value: TRANSFER_STATUS.OUT, label: 'In transit', tone: 'outstanding' },
    { value: TRANSFER_STATUS.IN, label: 'Received', tone: 'paid' },
    { value: TRANSFER_STATUS.SHORT, label: 'Short received', tone: 'overdue' },
    { value: TRANSFER_STATUS.CLOSED, label: 'Closed', tone: 'cancelled' },
  ];
  const transferCounts = useMemo(() => {
    const counts = { '': transfersInScope.length };
    for (const t of transfersInScope) {
      const st = canonicalStatus(t);
      counts[st] = (counts[st] || 0) + 1;
    }
    return counts;
  }, [transfersInScope]);

  /*
   * Quantities, not money: a transfer moves stock between two places the
   * business already owns, so nothing is bought or sold and no value changes
   * hands. What somebody wants to know is how much is still in transit.
   */
  const transferHeadline = useMemo(() => {
    let sent = 0;
    let received = 0;
    let inTransit = 0;
    let shortLines = 0;
    for (const t of transfersInScope) {
      const st = canonicalStatus(t);
      for (const l of safeArray(t.lines)) {
        const q = toNum(l?.qty || 0);
        const r = l?.receivedQty === undefined || l?.receivedQty === null ? 0 : toNum(l.receivedQty);
        sent += q;
        received += r;
        if (st === TRANSFER_STATUS.OUT) inTransit += q;
        if (st === TRANSFER_STATUS.SHORT && r < q) shortLines += 1;
      }
    }
    return { count: transfersInScope.length, sent, received, inTransit, shortLines };
  }, [transfersInScope]);

  return (
    <DocumentListShell
      entity="stockTransfer"
      title={mode === 'branch' ? 'Branch Transfers' : 'Warehouse Transfers'}
      company={currentCompany}
      search={{
        value: searchText,
        onChange: setSearchText,
        placeholder: 'Search transfers…',
        label: 'Search transfers',
      }}
      moreItems={[exportMenuItem('Export transfers')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Transfers',
          fileName: `${mode === 'branch' ? 'BranchTransfers' : 'WarehouseTransfers'}_${currentCompany?.name || 'company'}`,
          label: 'transfer(s)',
          columns: transferExportColumns,
          rows: filteredTransfers,
        });
      }}
      primary={
        <button type="button" onClick={openCreate} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> New Transfer Out
        </button>
      }
      cards={[
        { label: 'Transfers', value: transferHeadline.count, count: true, tone: 'draft', Icon: Truck },
        { label: 'Awaiting approval', value: pendingIn.length, count: true, tone: 'outstanding', Icon: ClipboardCheck },
        { label: 'Units in transit', value: transferHeadline.inTransit, count: true, tone: 'partial', Icon: Package },
        { label: 'Units received', value: transferHeadline.received, count: true, tone: 'paid', Icon: PackageCheck },
        { label: 'Short-received lines', value: transferHeadline.shortLines, count: true, tone: 'overdue', Icon: AlertTriangle },
      ]}
      tabs={TRANSFER_TABS}
      tabsLabel="Transfer status"
      statusValue={statusFilter}
      statusCounts={transferCounts}
      onStatusChange={setStatusFilter}
      tip={{
        storageKey: `clor.tip.transfers.${mode}`,
        Icon: Truck,
        text: 'Stock in transit belongs to neither end until it is approved — approve for what actually turned up, not what was sent.',
      }}
      above={
        pendingIn.length ? (
          <div className="rounded-xl border p-4 bg-[rgb(var(--warn-soft))]">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium text-[rgb(var(--warn-ink))]">
                  {pendingIn.length} transfer(s) pending your approval
                </div>
                <div className="text-xs text-[rgb(var(--warn-ink))]">
                  Stock has left the sending {mode === 'branch' ? 'branch' : 'warehouse'} and is in transit. Check the
                  goods and approve — it lands in your stock only for the quantities you confirm.
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {pendingIn.map((t) => (
                <div key={normalizeId(t?.id)} className="flex items-center justify-between gap-3 flex-wrap ui-surface rounded-lg border px-3 py-2">
                  <div className="text-sm">
                    <span>{t?.number || 'Transfer'}</span>
                    <span className="ui-muted"> · {t?.date || ''} · from {t?.sourceWarehouseName || t?.sourceBranchName || '-'}</span>
                  </div>
                  <button type="button" onClick={() => openReceive(t)} className="ui-btn ui-btn-primary ui-btn-sm text-xs">
                    Approve — Transfer In
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null
      }
    >
      <div className="ui-table-scroll">
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                {/* Each label over the column it actually filters. They were
                    shifted by one — filtering "From" filtered by date, and the
                    Date column filtered by destination. */}
                <ColumnHeader label="Transfer #" col="number" state={transferColFilters} />
                <ColumnHeader label="From" col="from" state={transferColFilters} />
                <ColumnHeader label="To" col="to" state={transferColFilters} />
                <ColumnHeader label="Date" col="date" state={transferColFilters} align="center" />
                <ColumnHeader label="Status" col="status" state={transferColFilters} align="center" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Truck}
                      kind="new"
      title={transfersInScope.length ? 'No transfers match' : 'No stock transfers yet'}
                      description={
                        transfersInScope.length
                          ? 'Nothing in this status for the chosen period.'
                          : `Moving stock between two ${mode === 'branch' ? 'branches' : 'warehouses'} starts with a transfer out; the far end confirms what arrived.`
                      }
                      routes={
                        transfersInScope.length
                          ? undefined
                          : [
                              {
                                label: 'Send stock out',
                                description: 'Pick where it goes and what is on the vehicle.',
                                onSelect: () => openCreate(),
                              },
                            ]
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((t) => {
                  const status = statusForViewer(t, { atTarget: isAtTarget(t) });

                  const sb = branchById.get(normalizeId(t?.sourceBranchId)) || null;
                  const tb = branchById.get(normalizeId(t?.targetBranchId)) || null;
                  const sw = warehouseById.get(normalizeId(t?.sourceWarehouseId)) || null;
                  const tw = warehouseById.get(normalizeId(t?.targetWarehouseId)) || null;

                  const fromLabel = [getBranchLabel(sb) || t?.sourceBranchName, getWarehouseLabel(sw) || t?.sourceWarehouseName]
                    .map((x) => String(x || '').trim())
                    .filter(Boolean)
                    .join(' / ');

                  const toLabel = [getBranchLabel(tb) || t?.targetBranchName, getWarehouseLabel(tw) || t?.targetWarehouseName]
                    .map((x) => String(x || '').trim())
                    .filter(Boolean)
                    .join(' / ');

                  return (
                    <tr
                      key={normalizeId(t?.id)}
                      className="ui-hover-sunken cursor-pointer"
                      onClick={(e) => {
                        const el = e.target;
                        if (el?.closest?.('[data-transfer-menu-button]')) return;
                        if (el?.closest?.('[data-transfer-menu]')) return;
                        openDocument(t);
                      }}
                    >
                      <td className="ui-col-meta px-4 py-2.5">{t?.number || '-'}</td>
                      <td className="ui-col-meta px-4 py-2.5">{fromLabel || '-'}</td>
                      <td className="ui-col-meta px-4 py-2.5">{toLabel || '-'}</td>
                      <td className="ui-col-date px-4 py-2.5"><DocDate value={t?.date} /></td>
                      <td className="px-6 py-4">
                        <StatusPill status={status} />
                      </td>
                      <td
                        className="px-4 py-2.5 relative"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openMenu?.id === normalizeId(t?.id)) {
                              setOpenMenu(null);
                            } else {
                              openRowMenu(normalizeId(t?.id), e.currentTarget);
                            }
                          }}
                          className="p-2 rounded-lg border ui-surface ui-hover-sunken ui-border-c"
                          aria-label="Transfer actions"
                          data-transfer-menu-button={normalizeId(t?.id)}
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
      </div>
      <TableTotals
        count={filteredTransfers.length}
        totalCount={transfersInScope.length}
        noun="transfers"
        figures={[{ label: 'Units in transit', value: String(transferHeadline.inTransit) }]}
      />

        {openMenu?.id ? (
          <div
            ref={menuRef}
            className="fixed w-56 ui-surface border ui-border-c rounded-xl shadow-lg overflow-hidden"
            style={{ left: openMenu.left, top: openMenu.top, zIndex: 'var(--z-popover)' }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            data-transfer-menu
          >
            {(() => {
              const t = transfers.find((x) => normalizeId(x?.id) === normalizeId(openMenu?.id));
              if (!t) return null;
              const status = canonicalStatus(t);
              const atSource = isAtSource(t);
              const atTarget = isAtTarget(t);
              const editable = status === TRANSFER_STATUS.DRAFT && atSource;
              const canSubmit = status === TRANSFER_STATUS.DRAFT && atSource;
              const canReceive = status === TRANSFER_STATUS.OUT && atTarget;
              const canResolve = status === TRANSFER_STATUS.SHORT && atTarget;
              const canReject = status === TRANSFER_STATUS.OUT && atTarget;
              const canCancel = status === TRANSFER_STATUS.DRAFT && atSource;

              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      openDocument(t);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken"
                  >
                    View
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      if (editable) openEdit(t);
                    }}
                    disabled={!editable}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ editable ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed ui-surface'
                    }`}
                  >
                    <Pencil size={16} className={editable ? 'ui-muted' : 'ui-subtle'} />
                    <span>Edit</span>
                  </button>

                  {canSubmit ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!atSource) return;
                        setOpenMenu(null);
                        submitTransferOut(t);
                      }}
                      disabled={!atSource}
      title={atSource ? undefined : `Only ${locationLabel(t, 'source')} can send this transfer out.`}
                      className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                        atSource ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed ui-surface'
                      }`}
                    >
                      <Check size={16} className={atSource ? 'ui-muted' : 'ui-subtle'} />
                      <span>Submit — Transfer Out</span>
                    </button>
                  ) : null}

                  {canReceive ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!atTarget) return;
                        setOpenMenu(null);
                        openReceive(t);
                      }}
                      disabled={!atTarget}
      title={atTarget ? undefined : `Only ${locationLabel(t, 'target')} can approve this transfer.`}
                      className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                        atTarget ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed ui-surface'
                      }`}
                    >
                      <Check size={16} className={atTarget ? 'ui-muted' : 'ui-subtle'} />
                      <span>Approve — Transfer In</span>
                    </button>
                  ) : null}

                  {canResolve ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          resolveMismatch(t, 'LOSS');
                        }}
                        className="w-full px-4 py-2 text-left text-sm ui-hover-sunken"
                      >
                        Write off shortfall as loss
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          resolveMismatch(t, 'RETURN');
                        }}
                        className="w-full px-4 py-2 text-left text-sm ui-hover-sunken"
                      >
                        Return shortfall to source
                      </button>
                    </>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      printTransfer(t);
                    }}
                    className="w-full px-4 py-2 text-left text-sm ui-hover-sunken"
                  >
                    Print / Download
                  </button>

                  {canReject ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!atTarget) return;
                        setOpenMenu(null);
                        rejectTransfer(t);
                      }}
                      disabled={!atTarget}
      title={atTarget ? undefined : `Only ${locationLabel(t, 'target')} can reject this transfer.`}
                      className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${
                        atTarget ? 'ui-hover-sunken' : 'ui-subtle cursor-not-allowed ui-surface'
                      }`}
                    >
                      <X size={16} className={atTarget ? 'ui-muted' : 'ui-subtle'} />
                      <span>Reject</span>
                    </button>
                  ) : null}

                  {canCancel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenu(null);
                        cancelTransfer(t);
                      }}
                      className="w-full px-4 py-2 text-left text-sm ui-hover-sunken"
                    >
                      Cancel
                    </button>
                  ) : null}

                  <div className="border-t ui-border-c" />

                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      if (editable) removeTransfer(t);
                    }}
                    disabled={!editable}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${ editable ? 'ui-hover-sunken text-[rgb(var(--neg))]' : 'ui-subtle cursor-not-allowed ui-surface'
                    }`}
                  >
                    <Trash2 size={16} className={editable ? 'text-[rgb(var(--neg))]' : 'ui-subtle'} />
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

export default StockTransfersList;

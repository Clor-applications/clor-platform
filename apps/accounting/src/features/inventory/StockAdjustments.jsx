import React, { useMemo, useRef, useState } from 'react';
import { useDocumentFormKeys } from '@ui/components/ui/useDocumentFormKeys';
import { ClipboardList, Download, Package, Plus, Trash2, TrendingDown, TrendingUp, Upload } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import { blockIfClosed } from '@ui/utils/bookClose';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import ItemPicker from '../../components/pickers/ItemPicker';
import { formatMoney, round2 } from '@ui/utils/money';
import { isStockItem } from '@ui/utils/inventory';
import { generateVoucherNumber, getDocSettings, nextFreeVoucherNumber } from '@ui/utils/docSettings';
import DocNumberField from '@ui/components/DocNumberField';
import { DocumentNumber, DocDate } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { DocFormActions } from '@ui/components/DocumentForm';

const safeArray = (v) => (Array.isArray(v) ? v : []);
const normalizeId = (v) => (v === undefined || v === null ? '' : String(v).trim());
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Stock adjustments — the count against the books.
 *
 * An audit finds twelve fewer boxes than the system says. Something has to
 * record that, and it cannot be a quiet edit of a number: the difference is a
 * loss the business has taken, and it belongs in the accounts as one.
 *
 * These are movements, so nothing here posts a journal by hand. A negative
 * adjustment lowers closing stock, which lowers Stock-in-Hand on the balance
 * sheet and — because closing stock is what credits Purchase Accounts — raises
 * cost in the P&L by the same amount. A positive one does the reverse. The two
 * statements stay in agreement because they are reading one number.
 *
 * Every adjustment names a warehouse and a reason. Stock does not go missing
 * from a company in general, and "adjusted" is not an explanation anyone can
 * audit a year later.
 */

/** A row parsed out of an uploaded sheet, with whatever is wrong with it. */
const parseUploadRows = (text, { itemsByKey, warehousesByKey }) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['The file is empty.'] };

  const splitRow = (line) => {
    // Tab-separated when it looks like it (what a spreadsheet copy gives),
    // comma otherwise. Quoted commas survive either way.
    const sep = line.includes('\t') ? '\t' : ',';
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = !quoted;
        continue;
      }
      if (ch === sep && !quoted) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const header = splitRow(lines[0]).map((h) => h.toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iItem = col('item', 'item code', 'code', 'item name');
  const iQty = col('qty', 'quantity', 'qtydelta', 'qty delta', 'adjustment');
  const iReason = col('reason', 'notes', 'remark', 'remarks');
  const iWarehouse = col('warehouse', 'warehouse name', 'wh');

  if (iItem < 0 || iQty < 0) {
    return {
      rows: [],
      errors: ['The sheet needs an Item column and a Qty column. Reason and Warehouse are optional columns.'],
    };
  }

  const rows = [];
  const errors = [];

  for (let n = 1; n < lines.length; n += 1) {
    const cells = splitRow(lines[n]);
    const rawItem = String(cells[iItem] || '').trim();
    const rawQty = String(cells[iQty] || '').trim();
    if (!rawItem && !rawQty) continue;

    const item = itemsByKey.get(rawItem.toLowerCase()) || null;
    const qty = Number(rawQty);
    const rawWarehouse = iWarehouse >= 0 ? String(cells[iWarehouse] || '').trim() : '';
    const warehouse = rawWarehouse ? warehousesByKey.get(rawWarehouse.toLowerCase()) || null : null;

    if (!item) {
      errors.push(`Row ${n + 1}: no item matches "${rawItem}".`);
      continue;
    }
    if (!Number.isFinite(qty) || qty === 0) {
      errors.push(`Row ${n + 1}: "${rawQty}" is not a quantity to adjust by.`);
      continue;
    }
    if (rawWarehouse && !warehouse) {
      errors.push(`Row ${n + 1}: no warehouse matches "${rawWarehouse}".`);
      continue;
    }

    rows.push({
      itemId: normalizeId(item.id),
      itemName: item.name,
      qtyDelta: round2(qty),
      reason: iReason >= 0 ? String(cells[iReason] || '').trim() : '',
      warehouseId: warehouse ? normalizeId(warehouse.id) : '',
      warehouseName: warehouse ? warehouse.name : '',
    });
  }

  return { rows, errors };
};

const StockAdjustments = ({
  db,
  setDb,
  currentCompany,
  warehouses = [],
  branches = [],
  activeWarehouseId = '',
  activeBranchId = '',
}) => {
  const companyId = currentCompany?.id;
  const fileRef = useRef(null);
  const colFilters = useColumnFilters();

  const [creating, setCreating] = useState(false);
  const formRef = useRef(null);
  const [form, setForm] = useState(() => ({
    date: today(),
    branchId: normalizeId(activeBranchId) || normalizeId(safeArray(warehouses).find((warehouse) => normalizeId(warehouse?.id) === normalizeId(activeWarehouseId))?.branchId),
    warehouseId: normalizeId(activeWarehouseId),
    reason: '',
    lines: [{ itemId: '', qtyDelta: '' }],
  }));

  const stockItems = useMemo(
    () => safeArray(db?.items).filter((i) => Number(i?.companyId) === Number(companyId) && isStockItem(i)),
    [db?.items, companyId]
  );

  const itemById = useMemo(() => new Map(stockItems.map((i) => [normalizeId(i.id), i])), [stockItems]);

  const warehouseById = useMemo(
    () => new Map(safeArray(warehouses).map((w) => [normalizeId(w?.id), w])),
    [warehouses]
  );

  const branchOfWarehouse = (warehouseId) => normalizeId(warehouseById.get(normalizeId(warehouseId))?.branchId);

  const branchLabel = (branchId) => {
    const b = safeArray(branches).find((x) => normalizeId(x?.id) === normalizeId(branchId));
    if (!b) return '';
    const code = String(b.branchCode || '').trim();
    const name = String(b.branchName || b.name || '').trim();
    return code ? `${code} — ${name}` : name;
  };

  const adjustments = useMemo(() => {
    const rows = safeArray(db?.stockAdjustments)
      .filter((a) => Number(a?.companyId) === Number(companyId))
      .slice()
      .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')));

    // The header selector scopes the list the same way it scopes every other
    // stock screen: a warehouse shows its own adjustments, "All" shows the lot.
    const wh = normalizeId(activeWarehouseId);
    return wh ? rows.filter((a) => normalizeId(a.warehouseId) === wh) : rows;
  }, [db?.stockAdjustments, companyId, activeWarehouseId]);

  const shown = colFilters.apply(adjustments, {
    date: (a) => a.date || '',
    number: (a) => a.number || '',
    warehouse: (a) => warehouseById.get(normalizeId(a.warehouseId))?.name || '',
    branch: (a) => branchLabel(branchOfWarehouse(a.warehouseId)),
    item: (a) => itemById.get(normalizeId(a.itemId))?.name || '',
    qty: (a) => toNum(a.qtyDelta),
    value: (a) => toNum(a.valueDelta),
    reason: (a) => a.reason || '',
  });

  const valueOf = (itemId, qtyDelta) => {
    const item = itemById.get(normalizeId(itemId));
    const rate = toNum(item?.purchasePrice);
    return round2(toNum(qtyDelta) * rate);
  };

  const totals = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const a of shown) {
      const v = toNum(a.valueDelta);
      if (v >= 0) up = round2(up + v);
      else down = round2(down + v);
    }
    return { up, down, net: round2(up + down) };
  }, [shown]);

  const resetForm = () =>
    setForm({
      date: today(),
      branchId: normalizeId(activeBranchId) || normalizeId(safeArray(warehouses).find((warehouse) => normalizeId(warehouse?.id) === normalizeId(activeWarehouseId))?.branchId),
      warehouseId: normalizeId(activeWarehouseId),
      reason: '',
      lines: [{ itemId: '', qtyDelta: '' }],
    });

  const updateLine = (idx, patch) =>
    setForm((p) => ({
      ...p,
      lines: safeArray(p.lines).map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));

  const addLine = () => setForm((p) => ({ ...p, lines: [...safeArray(p.lines), { itemId: '', qtyDelta: '' }] }));


  const removeLine = (idx) =>
    setForm((p) => {
      const next = safeArray(p.lines).filter((_, i) => i !== idx);
      return { ...p, lines: next.length ? next : [{ itemId: '', qtyDelta: '' }] };
    });

  /*
   * The same keys as every other document with lines in it.
   *
   * An adjustment is typed the way a bill is — an item, a figure, the next row
   * — and this was the one such grid where none of it worked: no Ctrl+= for a
   * row, no arrows down a column, no Ctrl+S. A person who keys figures does not
   * hold a different set of habits for the stock screen.
   */
  const onFormKeyDown = useDocumentFormKeys({
    formRef,
    lineCount: safeArray(form.lines).length,
    addLine,
    removeLine,
    onSave: () => formRef.current?.requestSubmit?.(),
  });

  /** Writes a batch of adjustment rows into the book as separate movements. */
  const commit = (rows, { date, reason, warehouseId }) => {
    setDb((prev) => {
      const existing = safeArray(prev.stockAdjustments);
      let nextId = existing.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0);
      const stamp = new Date().toISOString();

      const created = rows.map((r) => {
        const wh = normalizeId(r.warehouseId) || normalizeId(warehouseId);
        return {
          id: ++nextId,
          companyId,
          number:
            generateVoucherNumber({
              db: prev,
              company: currentCompany,
              voucherKey: 'stockAdjustment',
              branchId: branchOfWarehouse(wh) || activeBranchId || null,
              offset: nextId,
            }) || `ADJ-${nextId}`,
          date: r.date || date,
          warehouseId: wh,
          branchId: branchOfWarehouse(wh),
          itemId: normalizeId(r.itemId),
          qtyDelta: round2(toNum(r.qtyDelta)),
          valueDelta: valueOf(r.itemId, r.qtyDelta),
          reason: String(r.reason || reason || '').trim(),
          createdAt: stamp,
        };
      });

      return { ...prev, stockAdjustments: [...existing, ...created] };
    });
  };

  const saveForm = (e) => {
    e.preventDefault();

    {
      const closed = blockIfClosed(db, companyId, form.date, 'This adjustment');
      if (closed) {
        notify.error(closed);
        return;
      }
    }
    const warehouseId = normalizeId(form.warehouseId);
    const reason = String(form.reason || '').trim();
    const lines = safeArray(form.lines).filter((l) => normalizeId(l.itemId) && toNum(l.qtyDelta) !== 0);

    if (!warehouseId) {
      notify.error('Choose the warehouse the stock is in.');
      return;
    }
    if (!reason) {
      // Deliberately not optional. An adjustment with no reason is a number
      // nobody can defend in an audit, which is when it will be read.
      notify.error('Give a reason — an adjustment without one cannot be explained later.');
      return;
    }
    if (!lines.length) {
      notify.error('Add at least one item with a quantity to adjust by.');
      return;
    }

    commit(lines, { date: form.date, reason, warehouseId });
    notify.success(`${lines.length} adjustment${lines.length === 1 ? '' : 's'} recorded.`);
    resetForm();
    setCreating(false);
  };

  const onUpload = async (file) => {
    if (!file) return;
    const warehouseId = normalizeId(form.warehouseId) || normalizeId(activeWarehouseId);
    if (!warehouseId) {
      notify.error('Choose a warehouse before uploading — every row has to land somewhere.');
      return;
    }

    let text = '';
    try {
      text = await file.text();
    } catch {
      notify.error('That file could not be read.');
      return;
    }

    if (/^PK/.test(text.slice(0, 2))) {
      notify.error('That is an .xlsx workbook. Save it as CSV and upload that.');
      return;
    }

    const itemsByKey = new Map();
    for (const i of stockItems) {
      itemsByKey.set(String(i.name || '').trim().toLowerCase(), i);
      if (i.code) itemsByKey.set(String(i.code).trim().toLowerCase(), i);
    }
    const warehousesByKey = new Map(
      safeArray(warehouses).map((w) => [String(w?.name || '').trim().toLowerCase(), w])
    );

    const { rows, errors } = parseUploadRows(text, { itemsByKey, warehousesByKey });

    const missingReason = rows.filter((r) => !String(r.reason || '').trim()).length;
    if (missingReason && !String(form.reason || '').trim()) {
      notify.error(
        `${missingReason} row(s) have no reason. Add a Reason column, or type one above to apply to the whole upload.`
      );
      return;
    }

    if (!rows.length) {
      notify.error(errors[0] || 'Nothing in that file could be read as an adjustment.');
      return;
    }

    commit(rows, { date: form.date, reason: form.reason, warehouseId });

    if (errors.length) {
      notify.info(`${rows.length} row(s) recorded. ${errors.length} skipped — ${errors[0]}`);
    } else {
      notify.success(`${rows.length} adjustment${rows.length === 1 ? '' : 's'} uploaded.`);
    }
    resetForm();
    setCreating(false);
  };

  const removeAdjustment = (id) => {
    setDb((prev) => ({
      ...prev,
      stockAdjustments: safeArray(prev.stockAdjustments).filter((a) => String(a.id) !== String(id)),
    }));
    notify.info('Adjustment removed — the stock it moved goes back.');
  };

  const branchOptions = safeArray(branches)
    .slice()
    .sort((a, b) => branchLabel(a?.id).localeCompare(branchLabel(b?.id)));

  const warehouseOptions = safeArray(warehouses)
    .filter((warehouse) => !normalizeId(form.branchId) || normalizeId(warehouse?.branchId) === normalizeId(form.branchId))
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

  // The screen had no search: an adjustment could only be found by scrolling
  // or by filtering a column one value at a time.
  const adjSearch = useListSearch(shown, [
    'number',
    'reason',
    'date',
    (a) => itemById.get(normalizeId(a.itemId))?.name || '',
    (a) => warehouseById.get(normalizeId(a.warehouseId))?.name || '',
  ]);

  /*
   * An adjustment is either stock found or stock lost. That is the only split
   * worth a tab: writing off is what a proprietor reviews, writing up is what
   * an auditor asks about.
   */
  const [adjFilter, setAdjFilter] = useState('ALL');
  const ADJ_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'UP', label: 'Written up', tone: 'paid' },
    { value: 'DOWN', label: 'Written off', tone: 'overdue' },
  ];
  const adjRows =
    adjFilter === 'ALL'
      ? adjSearch.filtered
      : adjSearch.filtered.filter((a) => (adjFilter === 'UP' ? toNum(a.qtyDelta) >= 0 : toNum(a.qtyDelta) < 0));

  const adjCounts = useMemo(
    () => ({
      ALL: adjSearch.filtered.length,
      UP: adjSearch.filtered.filter((a) => toNum(a.qtyDelta) >= 0).length,
      DOWN: adjSearch.filtered.filter((a) => toNum(a.qtyDelta) < 0).length,
    }),
    [adjSearch.filtered]
  );

  const adjHeadline = useMemo(() => {
    let upQty = 0;
    let downQty = 0;
    for (const a of shown) {
      const q = toNum(a.qtyDelta);
      if (q >= 0) upQty += q;
      else downQty += Math.abs(q);
    }
    return { count: shown.length, upQty, downQty };
  }, [shown]);

  const adjExportColumns = [
    { key: 'date', label: 'Date' },
    { key: 'number', label: 'Number' },
    { key: 'warehouse', label: 'Warehouse', value: (a) => warehouseById.get(normalizeId(a.warehouseId))?.name || '' },
    { key: 'item', label: 'Item', value: (a) => itemById.get(normalizeId(a.itemId))?.name || '' },
    { key: 'qty', label: 'Qty', value: (a) => toNum(a.qtyDelta) },
    { key: 'value', label: 'Value', value: (a) => toNum(a.valueDelta) },
    { key: 'reason', label: 'Reason' },
  ];

  /*
   * The form is a screen, not a panel above the list.
   *
   * It rendered between the status tabs and the table, so the cards, the tabs
   * and every past adjustment stayed on screen under a half-typed one — and
   * the list's own primary action had to be hidden to stop two of them sitting
   * side by side.
   */
  if (creating) {
    return (
      <div className="space-y-6">
        <DocFormActions
          title="New Stock Adjustment"
          onBack={() => {
            resetForm();
            setCreating(false);
          }}
          sticky
          secondaryLabel="Cancel"
          onSecondary={() => {
            resetForm();
            setCreating(false);
          }}
          primaryLabel="Record adjustment"
          primaryType="button"
          onPrimary={() => formRef.current?.requestSubmit()}
        />
        <form ref={formRef} onSubmit={saveForm} onKeyDown={onFormKeyDown} className="space-y-4">
          <section className="ui-card grid gap-3 p-3 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="ui-label" htmlFor="adj-branch">
                    Branch <span className="text-[rgb(var(--neg))]">*</span>
                  </label>
                  <select
                    id="adj-branch"
                    value={form.branchId}
                    onChange={(e) => {
                      const branchId = e.target.value;
                      setForm((previous) => ({
                        ...previous,
                        branchId,
                        warehouseId: normalizeId(warehouseById.get(normalizeId(previous.warehouseId))?.branchId) === normalizeId(branchId)
                          ? previous.warehouseId
                          : '',
                      }));
                    }}
                    className="ui-select w-full"
                    required
                  >
                    <option value="">Select branch</option>
                    {branchOptions.map((branch) => <option key={String(branch.id)} value={String(branch.id)}>{branchLabel(branch.id)}</option>)}
                  </select>
                </div>

                <div>
                  <label className="ui-label" htmlFor="adj-warehouse">
                    Warehouse <span className="text-[rgb(var(--neg))]">*</span>
                  </label>
                  <select
                    id="adj-warehouse"
                    value={form.warehouseId}
                    onChange={(e) => {
                      const warehouseId = e.target.value;
                      setForm((previous) => ({ ...previous, warehouseId, branchId: branchOfWarehouse(warehouseId) || previous.branchId }));
                    }}
                    className="ui-select ui-surface w-full"
                    required
                  >
                    <option value="">Select warehouse</option>
                    {warehouseOptions.map((w) => (
                      <option key={String(w.id)} value={String(w.id)}>{w.name || `Warehouse ${w.id}`}</option>
                    ))}
                  </select>
                </div>
              </div>

            </div>

            <div className="lg:col-span-6 lg:border-s lg:ps-3" style={{ borderColor: 'rgb(var(--border))' }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  {/* Numbers are handed out per row when the batch commits, so the
                      field previews the series rather than taking typing. */}
                  <DocNumberField
                    id="adj-number"
                    label="Adjustment No."
                    value={String(
                      nextFreeVoucherNumber({
                        db,
                        company: currentCompany,
                        voucherKey: 'stockAdjustment',
                        branchId: form.branchId || branchOfWarehouse(form.warehouseId) || activeBranchId || null,
                        takenNumbers: safeArray(db.stockAdjustments)
                          .filter((a) => a.companyId === companyId)
                          .map((a) => String(a.number || '').trim()),
                      }) || ''
                    )}
                    onChange={() => {}}
                    disabled
                    voucherKey="stockAdjustment"
                    title="Adjustment numbering"
                    sampleLabel="Next adjustment will be"
                    manualLabel="Typed on each adjustment"
                    branchId={form.branchId || branchOfWarehouse(form.warehouseId) || activeBranchId || null}
                    settings={getDocSettings(db, currentCompany, { branchId: form.branchId || branchOfWarehouse(form.warehouseId) || activeBranchId || null })?.numbering?.stockAdjustment}
                    db={db}
                    setDb={setDb}
                    currentCompany={currentCompany}
                  />
                </div>

                <div>
                  <label className="ui-label" htmlFor="adj-date">Date</label>
                  <input
                    id="adj-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                    className="ui-input w-full"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-12">
              <label className="ui-label" htmlFor="adj-reason">
                Reason <span className="text-[rgb(var(--neg))]">*</span>
              </label>
              <input
                id="adj-reason"
                type="text"
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                className="ui-input w-full"
                placeholder="Damaged in transit, audit shortfall…"
                required
              />
            </div>
          </section>

          <section className="ui-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Items</span>
              <button type="button" onClick={addLine} className="text-sm flex items-center gap-1 ui-fg">
                <Plus size={16} /> Add item
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <table className="ui-table ui-grid-dense w-full table-fixed">
                <colgroup>
                  <col className="w-[58%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[6%]" />
                </colgroup>
                <thead className="ui-sunken">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium">Item</th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium">Adjust by</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium">Value</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {safeArray(form.lines).map((l, idx) => (
                    /* The grid keys walk rows and columns by this. */
                    <tr key={idx} className="border-t" data-line-row={idx}>
                      <td className="ui-col-entity px-2 py-1.5 align-middle">
                        <ItemPicker
                          db={db}
                          setDb={setDb}
                          currentCompany={currentCompany}
                          value={l.itemId}
                          onChange={(val) => updateLine(idx, { itemId: val })}
                          label={null}
                        />
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <input
                          type="number"
                          value={l.qtyDelta}
                          onChange={(e) => updateLine(idx, { qtyDelta: e.target.value })}
                          className="ui-input w-full"
                          step="any"
                          placeholder="-12"
                        />
                      </td>
                      <td className="ui-money ui-col-meta px-2 py-1.5 text-right align-middle">
                        {formatMoney(valueOf(l.itemId, l.qtyDelta), currentCompany)}
                      </td>
                      <td className="px-2 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-[rgb(var(--neg))]"
                          aria-label="Remove line"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  onUpload(f);
                }}
              />
              <button type="button" onClick={() => fileRef.current?.click()} className="ui-btn ui-btn-secondary">
                <Upload size={16} aria-hidden="true" /> Upload from Excel
              </button>
            </div>
          </section>
        </form>
      </div>
    );
  }

  return (
    <DocumentListShell
      entity="adjustment"
      title="Stock Adjustments"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: adjSearch.query,
        onChange: adjSearch.setQuery,
        placeholder: 'Search adjustments…',
        label: 'Search adjustments',
      }}
      moreItems={[exportMenuItem('Export adjustments')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Adjustments',
          fileName: `StockAdjustments_${currentCompany?.name || 'company'}`,
          label: 'adjustment(s)',
          columns: adjExportColumns,
          rows: adjRows,
        });
      }}
      primary={
        creating ? null : (
          <button type="button" onClick={() => setCreating(true)} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> New Adjustment
          </button>
        )
      }
      cards={[
        { label: 'Adjustments', value: adjHeadline.count, count: true, tone: 'draft', Icon: ClipboardList },
        { label: 'Units written up', value: adjHeadline.upQty, count: true, tone: 'paid', Icon: TrendingUp },
        { label: 'Units written off', value: adjHeadline.downQty, count: true, tone: 'overdue', Icon: TrendingDown },
        { label: 'Value written up', value: totals.up, tone: 'sent', Icon: Package },
        { label: 'Value written off', value: Math.abs(totals.down), tone: 'outstanding', Icon: Package },
      ]}
      tabs={ADJ_TABS}
      tabsLabel="Adjustment filter"
      statusInHeader
      statusValue={adjFilter}
      statusCounts={adjCounts}
      onStatusChange={setAdjFilter}
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 11.5rem)' }} data-fill-viewport>
        <table className={`ui-table ui-table-wide ui-table-sticky ${adjRows.length ? '' : 'cash-bank-empty-table'}`}>
          <thead>
            <tr>
              <ColumnHeader label="Date" col="date" state={colFilters} align="center" />
              <ColumnHeader label="Number" col="number" state={colFilters} />
              <ColumnHeader label="Branch" col="branch" state={colFilters} />
              <ColumnHeader label="Warehouse" col="warehouse" state={colFilters} />
              <ColumnHeader label="Item" col="item" state={colFilters} />
              <ColumnHeader label="Qty" col="qty" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Value" col="value" state={colFilters} className="ui-num" align="right" />
              <ColumnHeader label="Reason" col="reason" state={colFilters} />
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {adjRows.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon={ClipboardList}
                    kind="new"
      title={shown.length ? 'Nothing matches' : 'No adjustments yet'}
                    description={
                      shown.length
                        ? 'No adjustment in this filter.'
                        : 'Record one when a count disagrees with the books — the difference moves stock and posts to the ledger.'
                    }
                    routes={
                      shown.length
                        ? undefined
                        : [
                            {
                              label: 'Record one now',
                              description: 'Warehouse, item, the quantity the count found.',
                              onSelect: () => setCreating(true),
                            },
                          ]
                    }
                  />
                </td>
              </tr>
            ) : (
              adjRows.map((a) => {
                const item = itemById.get(normalizeId(a.itemId));
                const qty = toNum(a.qtyDelta);
                const value = toNum(a.valueDelta);
                return (
                  <tr key={a.id}>
                    <td className="ui-col-date"><DocDate value={a.date} /></td>
                    <td className="ui-col-id"><DocumentNumber value={a.number} label="adjustment" /></td>
                    <td className="ui-col-meta">{branchLabel(a.branchId) || '—'}</td>
                    <td className="ui-col-meta">
                      {warehouseById.get(normalizeId(a.warehouseId))?.name || '—'}
                    </td>
                    <td className="ui-col-entity">{item?.name || `Item ${a.itemId}`}</td>
                    <td className={`ui-col-amount ui-mono ${qty < 0 ? 'ui-amount-neg' : 'ui-amount-pos'}`}>
                      {qty > 0 ? `+${qty}` : qty}
                      {item?.unit ? ` ${item.unit}` : ''}
                    </td>
                    <td className={`ui-col-amount ${value < 0 ? 'ui-amount-neg' : ''}`}>
                      {formatMoney(value, currentCompany)}
                    </td>
                    <td className="ui-col-meta">{a.reason || '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => removeAdjustment(a.id)}
                        className="text-[rgb(var(--neg))]"
                        aria-label="Remove adjustment"
                      >
                        <Trash2 size={16} />
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
        count={adjRows.length}
        totalCount={adjustments.length}
        noun="adjustments"
        figures={[{ label: 'Net effect on stock', value: formatMoney(totals.net, currentCompany) }]}
      />
    </DocumentListShell>
  );
};

export default StockAdjustments;

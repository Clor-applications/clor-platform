import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Building2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { ListToolbar, exportRows, useListSearch } from '@ui/components/ListToolbar';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { createFixedAsset, updateFixedAsset } from '@ui/api/masters';
import { formatMoney } from '@ui/utils/money';
import { fyRange } from '@ui/utils/tdsTcs';
import { ASSET_BLOCKS, assetRows } from '@ui/utils/fixedAssets';
import { DocDate } from '@ui/components/docs';

/**
 * Fixed asset register + WDV depreciation schedule.
 *
 * Assets sit in IT Act blocks with preset rates (editable per asset). The
 * schedule shows opening WDV → this year's depreciation (half rate when the
 * asset was used under 180 days) → closing WDV. One click drafts the yearly
 * depreciation journal: Dr Depreciation / Cr Accumulated Depreciation per
 * block.
 */
export default function FixedAssets({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const fy = useMemo(() => fyRange(), []);
  const rows = useMemo(() => assetRows(db, companyId, fy), [db, companyId, fy]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', block: ASSET_BLOCKS[0].name, cost: '', purchaseDate: '', depRate: String(ASSET_BLOCKS[0].rate), accumulatedDep: '' });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const add = async () => {
    if (!form.name.trim()) {
      notify.error('Asset name is required');
      return;
    }
    if (!(Number(form.cost) > 0)) {
      notify.error('Cost must be greater than zero');
      return;
    }
    if (!form.purchaseDate) {
      notify.error('Purchase date is required');
      return;
    }
    const nextId = (db.fixedAssets || []).reduce((m, a) => Math.max(m, Number(a.id) || 0), 0) + 1;

    /*
     * An asset is on the balance sheet, so holding it in one browser meant the
     * same company showed different assets on different machines. Written
     * through; a refusal keeps the row here rather than losing the entry.
     */
    let serverPatch = {};
    try {
      const created = await createFixedAsset({
        name: form.name.trim(),
        category: form.block || undefined,
        purchaseDate: form.purchaseDate,
        cost: Number(form.cost),
        depreciationMethod: 'WDV',
        depreciationRate: Number(form.depRate) || 0,
        accumulatedDepreciation: Number(form.accumulatedDep) || 0,
      });
      if (created?.asset?.id) serverPatch = { backendAssetId: String(created.asset.id) };
    } catch (e) {
      notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    }

    setDb((prev) => ({
      ...prev,
      fixedAssets: [
        ...(prev.fixedAssets || []),
        {
          ...serverPatch,
          id: nextId,
          companyId,
          name: form.name.trim(),
          block: form.block,
          cost: Number(form.cost),
          purchaseDate: form.purchaseDate,
          depRate: Number(form.depRate) || 0,
          accumulatedDep: Number(form.accumulatedDep) || 0,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setOpen(false);
    setForm({ name: '', block: ASSET_BLOCKS[0].name, cost: '', purchaseDate: '', depRate: String(ASSET_BLOCKS[0].rate), accumulatedDep: '' });
    notify.success('Asset added to the register.');
  };

  const remove = async (asset) => {
    const ok = await confirmDialog({ title: 'Remove asset', message: `Remove "${asset.name}" from the register?`, confirmLabel: 'Remove' });
    if (!ok) return;
    /*
     * Marked written off rather than deleted: an asset that was on the balance
     * sheet last year has to stay explainable this year.
     */
    if (asset.backendAssetId) {
      try {
        await updateFixedAsset(asset.backendAssetId, { status: 'WRITTEN_OFF' });
      } catch (e) {
        notify.error(`Removed here, but the server refused: ${String(e?.message || e)}`);
      }
    }
    setDb((prev) => ({ ...prev, fixedAssets: (prev.fixedAssets || []).filter((a) => a.id !== asset.id) }));
  };

  const totalDep = rows.reduce((s, r) => s + r.dep, 0);

  const draftDepJournal = () => {
    if (!totalDep) {
      notify.error('No depreciation to book.');
      return;
    }
    const byBlock = new Map();
    for (const r of rows) byBlock.set(r.asset.block, (byBlock.get(r.asset.block) || 0) + r.dep);
    const lines = [
      { accountId: '', accountCode: '', accountName: 'Depreciation', debit: Math.round(totalDep * 100) / 100, credit: 0 },
      ...[...byBlock.entries()].map(([block, dep]) => ({
        accountId: '',
        accountCode: '',
        accountName: `Accumulated Depreciation — ${block}`,
        debit: 0,
        credit: Math.round(dep * 100) / 100,
      })),
    ];
    const nextId = (db.journalEntries || []).reduce((m, j) => Math.max(m, Number(j.id) || 0), 0) + 1;
    setDb((prev) => ({
      ...prev,
      journalEntries: [
        ...(prev.journalEntries || []),
        {
          id: nextId,
          companyId,
          number: `JE-DEP-${nextId}`,
          date: fy.to,
          narration: `Depreciation for ${fy.label} (WDV) — auto-drafted from the asset register`,
          lines,
          totalDebit: Math.round(totalDep * 100) / 100,
          totalCredit: Math.round(totalDep * 100) / 100,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    notify.success(`Journal JE-DEP-${nextId} drafted for ${formatMoney(totalDep, currentCompany)}.`);
  };

  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const faSearch = useListSearch(rows, ['name', 'block']);
  const faSearchRows = faSearch.filtered;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader entity="items" title="Fixed Assets" description={`Register + WDV depreciation schedule for ${fy.label}. Half rate applies automatically under 180 days of use.`} />
        <div className="flex gap-2">
          <button type="button" onClick={draftDepJournal} className="ui-btn ui-btn-secondary">
            Draft depreciation journal ({money(totalDep)})
          </button>
          <button type="button" onClick={() => setOpen(true)} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add Asset
          </button>
        </div>
      </div>

      {open ? (
        <div className="ui-card space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="ui-label" htmlFor="fixedassets-asset-name">Asset name</label>
              <input id="fixedassets-asset-name" type="text" value={form.name} onChange={set('name')} className="ui-input w-full" placeholder="Delivery van / Office AC…" />
            </div>
            <div>
              <label className="ui-label" htmlFor="fixedassets-block">Block</label>
              <select id="fixedassets-block"
                value={form.block}
                onChange={(e) => {
                  const b = ASSET_BLOCKS.find((x) => x.name === e.target.value);
                  setForm((p) => ({ ...p, block: e.target.value, depRate: b ? String(b.rate) : p.depRate }));
                }}
                className="ui-select w-full"
              >
                {ASSET_BLOCKS.map((b) => (
                  <option key={b.name} value={b.name}>{b.name} ({b.rate}%)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="fixedassets-depreciation-rate-wdv">Depreciation rate % (WDV)</label>
              <input id="fixedassets-depreciation-rate-wdv" type="number" min="0" max="100" step="0.01" value={form.depRate} onChange={set('depRate')} className="ui-input w-full" />
            </div>
            <div>
              <label className="ui-label" htmlFor="fixedassets-cost">Cost (₹)</label>
              <input id="fixedassets-cost" type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} className="ui-input w-full" />
            </div>
            <div>
              <label className="ui-label" htmlFor="fixedassets-purchase-date">Purchase date</label>
              <input id="fixedassets-purchase-date" type="date" value={form.purchaseDate} onChange={set('purchaseDate')} className="ui-input w-full" />
            </div>
            <div>
              <label className="ui-label" htmlFor="fixedassets-accumulated-dep-till-last-fy">Accumulated dep till last FY (₹)</label>
              <input id="fixedassets-accumulated-dep-till-last-fy" type="number" min="0" step="0.01" value={form.accumulatedDep} onChange={set('accumulatedDep')} className="ui-input w-full" placeholder="0 for new assets" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="ui-btn ui-btn-secondary">Cancel</button>
            <button type="button" onClick={add} className="ui-btn ui-btn-primary">Add Asset</button>
          </div>
        </div>
      ) : null}

      <ListToolbar
        search={faSearch.query}
        onSearch={faSearch.setQuery}
        placeholder="Search assets (name, block)"
        count={faSearchRows.length}
        countLabel="assets"
        onExport={() =>
          exportRows({
            fileName: `FixedAssets_${currentCompany?.name || 'company'}`,
            label: 'asset(s)',
            columns: [
              { key: 'name', label: 'Asset' },
              { key: 'block', label: 'Block' },
              { key: 'purchaseDate', label: 'Purchased' },
              { key: 'cost', label: 'Cost', value: (r) => Number(r.cost || 0) },
              { key: 'openingWdv', label: 'Opening WDV', value: (r) => Number(r.openingWdv || 0) },
              { key: 'rate', label: 'Rate %', value: (r) => Number(r.rate || 0) },
              { key: 'depreciation', label: 'Depreciation', value: (r) => Number(r.depreciation || 0) },
              { key: 'closingWdv', label: 'Closing WDV', value: (r) => Number(r.closingWdv || 0) },
            ],
            rows: faSearchRows,
          })
        }
        exportTitle="Fixed Assets"
        exportFileName={`FixedAssets_${currentCompany?.name || 'company'}`}
        exportSheetName="Fixed Assets"
        exportColumns={[
              { key: 'name', label: 'Asset' },
              { key: 'block', label: 'Block' },
              { key: 'purchaseDate', label: 'Purchased' },
              { key: 'cost', label: 'Cost', value: (r) => Number(r.cost || 0) },
              { key: 'openingWdv', label: 'Opening WDV', value: (r) => Number(r.openingWdv || 0) },
              { key: 'rate', label: 'Rate %', value: (r) => Number(r.rate || 0) },
              { key: 'depreciation', label: 'Depreciation', value: (r) => Number(r.depreciation || 0) },
              { key: 'closingWdv', label: 'Closing WDV', value: (r) => Number(r.closingWdv || 0) },
        ]}
        exportRows={faSearchRows}
      />

      {rows.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={Building2} title="No assets registered" description="Add machines, vehicles, computers — depreciation computes itself every FY." />
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th className="ui-th">Asset</th>
                <th className="ui-th">Block</th>
                <th className="ui-th">Purchased</th>
                <th className="ui-th ui-num">Cost</th>
                <th className="ui-th ui-num">Opening WDV</th>
                <th className="ui-th ui-num">Rate</th>
                <th className="ui-th ui-num">Dep ({fy.label})</th>
                <th className="ui-th ui-num">Closing WDV</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {faSearchRows.map(({ asset, openingWdv, rateApplied, halfRate, dep, closingWdv }) => (
                <tr key={asset.id} className="border-t">
                  <td className="ui-col-entity px-4 py-2.5">{asset.name}</td>
                  <td className="ui-col-meta px-4 py-2.5">{asset.block}</td>
                  <td className="ui-col-date px-4 py-2.5"><DocDate value={asset.purchaseDate} /></td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(asset.cost)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(openingWdv)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {rateApplied}%{halfRate ? <span className="ui-caption block">half rate (&lt;180d)</span> : null}
                  </td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(dep)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(closingWdv)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => remove(asset)} className="ui-icon-btn !h-8 !w-8" aria-label={`Remove ${asset.name}`}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

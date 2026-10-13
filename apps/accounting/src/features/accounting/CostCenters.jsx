import React, { useMemo, useState } from 'react';
import { Plus, Trash2, PieChart } from 'lucide-react';
import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { ListToolbar, exportRows, useListSearch } from '@ui/components/ListToolbar';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { removeMaster, saveMaster } from '@ui/utils/masterSync';
import { formatMoney } from '@ui/utils/money';

/**
 * Cost centers — P&L by branch / project / vertical.
 *
 * Invoices and expenses carry an optional costCenterId; this page manages
 * the list and answers "which vertical actually makes money": income,
 * expense and net per center, plus an Unallocated row so nothing hides.
 */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function CostCenters({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const centers = useMemo(() => (db.costCenters || []).filter((c) => c.companyId === companyId), [db.costCenters, companyId]);
  const [name, setName] = useState('');

  const rows = useMemo(() => {
    const live = (d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase());
    const slots = new Map(centers.map((c) => [String(c.id), { center: c, income: 0, expense: 0 }]));
    const un = { center: { id: null, name: 'Unallocated' }, income: 0, expense: 0 };

    for (const inv of (db.invoices || []).filter((d) => d.companyId === companyId && live(d))) {
      const slot = slots.get(String(inv.costCenterId)) || un;
      slot.income += num(inv.subtotal) + num(inv.otherChargesTotal);
    }
    for (const ex of (db.expenses || []).filter((d) => d.companyId === companyId && live(d))) {
      const slot = slots.get(String(ex.costCenterId)) || un;
      slot.expense += num(ex.taxableTotal ?? ex.subtotal ?? ex.amount);
    }
    const list = [...slots.values()].map((s) => ({ ...s, net: s.income - s.expense }));
    if (un.income || un.expense) list.push({ ...un, net: un.income - un.expense });
    return list.sort((a, b) => b.net - a.net);
  }, [db, companyId, centers]);

  const add = async () => {
    const n = name.trim();
    if (!n) {
      notify.error('Give the cost center a name (branch, project, vertical…)');
      return;
    }
    const nextId = (db.costCenters || []).reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
    // This is a report — P&L by branch or project — so a cost centre held in
    // one browser made the same books report differently on different machines.
    const serverPatch = await saveMaster('costCenters', n);
    setDb((prev) => ({ ...prev, costCenters: [...(prev.costCenters || []), { id: nextId, companyId, name: n, createdAt: new Date().toISOString(), ...serverPatch }] }));
    setName('');
    notify.success(`Cost center "${n}" added.`);
  };

  const remove = async (c) => {
    const ok = await confirmDialog({ title: 'Remove cost center', message: `Remove "${c.name}"? Documents keep their tag but report as Unallocated.`, confirmLabel: 'Remove' });
    if (!ok) return;
    await removeMaster(c);
    setDb((prev) => ({ ...prev, costCenters: (prev.costCenters || []).filter((x) => x.id !== c.id) }));
  };

  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const ccSearch = useListSearch(rows, [(r) => r.center?.name]);
  const ccSearchRows = ccSearch.filtered;
  return (
    <div className="space-y-6">
      <PageHeader entity="branch" title="Cost Centers" />

      <div className="ui-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="ui-label" htmlFor="costcenters-new-cost-center">New cost center</label>
          <input id="costcenters-new-cost-center"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            className="ui-input w-56"
            placeholder="Retail counter / Project X…"
          />
        </div>
        <button type="button" onClick={add} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> Add
        </button>
        <div className="ui-caption pb-2">Then pick it on invoices and expenses.</div>
      </div>

      <ListToolbar
        search={ccSearch.query}
        onSearch={ccSearch.setQuery}
        placeholder="Search cost centres"
        count={ccSearchRows.length}
        countLabel="centres"
        onExport={() =>
          exportRows({
            fileName: `CostCenters_${currentCompany?.name || 'company'}`,
            label: 'cost centre(s)',
            columns: [
              { key: 'name', label: 'Cost center', value: (r) => r.center?.name || '' },
              { key: 'income', label: 'Income', value: (r) => Number(r.income || 0) },
              { key: 'expense', label: 'Expense', value: (r) => Number(r.expense || 0) },
              { key: 'net', label: 'Net', value: (r) => Number(r.net || 0) },
            ],
            rows: ccSearchRows,
          })
        }
        exportTitle="Cost Centres"
        exportFileName={`CostCenters_${currentCompany?.name || 'company'}`}
        exportSheetName="Cost Centres"
        exportColumns={[
              { key: 'name', label: 'Cost center', value: (r) => r.center?.name || '' },
              { key: 'income', label: 'Income', value: (r) => Number(r.income || 0) },
              { key: 'expense', label: 'Expense', value: (r) => Number(r.expense || 0) },
              { key: 'net', label: 'Net', value: (r) => Number(r.net || 0) },
        ]}
        exportRows={ccSearchRows}
      />

      {rows.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={PieChart} title="No cost centers yet" description="Add one per branch/project, then tag documents with it." />
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th className="ui-th">Cost center</th>
                <th className="ui-th ui-num">Income</th>
                <th className="ui-th ui-num">Expense</th>
                <th className="ui-th ui-num">Net</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {ccSearchRows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="ui-col-entity px-4 py-2.5">{r.center.name}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.income)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.expense)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${r.net >= 0 ? 'ui-amount-pos' : 'ui-amount-neg'}`}>{money(r.net)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.center.id != null ? (
                      <button type="button" onClick={() => remove(r.center)} className="ui-icon-btn !h-8 !w-8" aria-label={`Remove ${r.center.name}`}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
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

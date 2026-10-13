import React, { useMemo, useRef, useState } from 'react';
import { BadgeIndianRupee, Download, FileText, Plus, Receipt, Trash2, UserCheck, Users } from 'lucide-react';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { createSalesman, deactivateSalesman } from '@ui/api/masters';
import { MoneyValue } from '@ui/components/docs';
import { formatMoney } from '@ui/utils/money';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * Salesman master + performance report. Invoices carry salesmanId (picked on
 * the invoice form); commission is the salesman's percentage applied to his
 * non-draft, non-cancelled invoice subtotals (pre-GST — commission on tax
 * would overstate it).
 */
export default function Salesmen({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const salesmen = useMemo(
    () => (Array.isArray(db.salesmen) ? db.salesmen.filter((s) => s.companyId === companyId) : []),
    [db.salesmen, companyId]
  );

  const [form, setForm] = useState({ name: '', phone: '', commissionPct: '' });
  const nameRef = useRef(null);

  const add = async () => {
    const name = form.name.trim();
    if (!name) {
      notify.error('Salesman name is required');
      return;
    }
    const nextId = (db.salesmen || []).reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
    const pct = Math.max(0, Math.min(100, Number(form.commissionPct) || 0));

    /*
     * Sales by Salesman reports on this, so a salesman held in one browser made
     * the same books report differently on different machines. Written through
     * to the server; a refusal keeps the row here so entry is not lost.
     */
    let serverPatch = {};
    try {
      const created = await createSalesman({ name, phone: form.phone.trim() || undefined, commissionRate: pct });
      if (created?.salesman?.id) serverPatch = { backendSalesmanId: String(created.salesman.id) };
    } catch (e) {
      notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    }

    setDb((prev) => ({
      ...prev,
      salesmen: [
        ...(prev.salesmen || []),
        {
          id: nextId,
          companyId,
          name,
          phone: form.phone.trim(),
          commissionPct: pct,
          createdAt: new Date().toISOString(),
          ...serverPatch,
        },
      ],
    }));
    setForm({ name: '', phone: '', commissionPct: '' });
    notify.success(`${name} added.`);
  };

  const remove = async (s) => {
    const ok = await confirmDialog({ title: 'Remove salesman', message: `Remove ${s.name}? Past invoices keep his name.`, confirmLabel: 'Remove' });
    if (!ok) return;
    /*
     * Deactivated on the server, not deleted: past invoices carry the name and
     * the commission history has to stay explainable.
     */
    if (s.backendSalesmanId) {
      try {
        await deactivateSalesman(s.backendSalesmanId);
      } catch (e) {
        notify.error(`Removed here, but the server refused: ${String(e?.message || e)}`);
      }
    }
    setDb((prev) => ({ ...prev, salesmen: (prev.salesmen || []).filter((x) => Number(x.id) !== Number(s.id)) }));
  };

  /** Performance from real invoices — commission on pre-GST subtotal. */
  const perf = useMemo(() => {
    const map = new Map(salesmen.map((s) => [Number(s.id), { salesman: s, invoices: 0, sales: 0, commission: 0 }]));
    for (const inv of db.invoices || []) {
      if (inv.companyId !== companyId) continue;
      const st = String(inv.status || '').toLowerCase();
      if (st === 'draft' || st === 'cancelled') continue;
      const slot = map.get(Number(inv.salesmanId));
      if (!slot) continue;
      slot.invoices += 1;
      slot.sales += Number(inv.subtotal || 0);
      slot.commission += (Number(inv.subtotal || 0) * Number(slot.salesman.commissionPct || 0)) / 100;
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [db.invoices, salesmen, companyId]);

  const smSearch = useListSearch(perf, [(r) => r.salesman?.name, (r) => r.salesman?.phone]);

  /*
   * A salesman is either selling or he is not, and the second group is what
   * this list is opened to find: somebody on the team with nothing against
   * their name this year is either new or not being given work.
   */
  const [smStatus, setSmStatus] = useState('');
  const SM_STATUS_TABS = [
    { value: '', label: 'All', tone: 'all' },
    { value: 'Selling', label: 'Selling', tone: 'paid' },
    { value: 'Idle', label: 'No sales yet', tone: 'draft' },
    { value: 'Commission', label: 'Commission due', tone: 'outstanding' },
  ];
  const smMatches = (r, tab) => {
    if (tab === 'Selling') return r.invoices > 0;
    if (tab === 'Idle') return r.invoices === 0;
    if (tab === 'Commission') return Number(r.commission || 0) > 0.0001;
    return true;
  };
  const shownPerf = smStatus ? smSearch.filtered.filter((r) => smMatches(r, smStatus)) : smSearch.filtered;

  /*
   * Sales are pre-GST on purpose: commission on tax collected for the
   * government would pay the team for money that was never the business's.
   */
  const smHeadline = useMemo(() => {
    let sales = 0;
    let commission = 0;
    let invoices = 0;
    let selling = 0;
    for (const r of smSearch.filtered) {
      sales += Number(r.sales || 0);
      commission += Number(r.commission || 0);
      invoices += r.invoices;
      if (r.invoices > 0) selling += 1;
    }
    return { count: smSearch.filtered.length, sales, commission, invoices, selling };
  }, [smSearch.filtered]);

  const smExportColumns = [
    { key: 'name', label: 'Salesman', value: (r) => r.salesman?.name || '' },
    { key: 'phone', label: 'Phone', value: (r) => r.salesman?.phone || '' },
    { key: 'commissionPct', label: 'Commission %', value: (r) => Number(r.salesman?.commissionPct || 0) },
    { key: 'invoices', label: 'Invoices', value: (r) => r.invoices },
    { key: 'sales', label: 'Sales (pre-GST)', value: (r) => Number(r.sales || 0) },
    { key: 'commission', label: 'Commission due', value: (r) => Number(r.commission || 0) },
  ];

  return (
    <DocumentListShell
      entity="salesperson"
      className="sales-list-page"
      title="Salesmen"
      company={currentCompany}
      search={{
        before: <select value={smStatus} onChange={(event) => setSmStatus(event.target.value)} className="ui-select ui-ctl-compact w-40" aria-label="Salesman filter">{SM_STATUS_TABS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select>,
        value: smSearch.query,
        onChange: smSearch.setQuery,
        placeholder: 'Search salesmen…',
        label: 'Search salesmen',
      }}
      moreItems={[exportMenuItem('Export salesmen')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Salesmen',
          fileName: `Salesmen_${currentCompany?.name || 'company'}`,
          label: 'salesman/men',
          columns: smExportColumns,
          rows: shownPerf,
        });
      }}
      primary={
        /* The header button puts the cursor in the form rather than
           submitting it: pressed with the fields empty it only ever produced
           "name is required", which is a button that exists to scold you. */
        <button type="button" onClick={() => nameRef.current?.focus()} className="ui-btn ui-btn-primary">
          <Plus size={16} aria-hidden="true" /> Add salesman
        </button>
      }
      cards={[
        { label: 'Team size', value: smHeadline.count, count: true, tone: 'draft', Icon: Users },
        { label: 'Selling', value: smHeadline.selling, count: true, tone: 'paid', Icon: UserCheck },
        { label: 'Invoices credited', value: smHeadline.invoices, count: true, tone: 'sent', Icon: FileText },
        { label: 'Sales (pre-GST)', value: smHeadline.sales, tone: 'partial', Icon: Receipt },
        { label: 'Commission due', value: smHeadline.commission, tone: 'outstanding', Icon: BadgeIndianRupee },
      ]}
      denseCards
      above={
        <div className="ui-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="ui-label" htmlFor="salesmen-name">Name</label>
            <input id="salesmen-name"
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="ui-input w-48"
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="salesmen-phone">Phone</label>
            <input id="salesmen-phone" type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="ui-input w-36" />
          </div>
          <div>
            <label className="ui-label" htmlFor="salesmen-commission">Commission %</label>
            <input id="salesmen-commission"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={form.commissionPct}
              onChange={(e) => setForm((p) => ({ ...p, commissionPct: e.target.value }))}
              className="ui-input w-28"
              placeholder="0"
            />
          </div>
          <button type="button" onClick={add} className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden="true" /> Add salesman
          </button>
        </div>
        </div>
      }
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 12rem)' }}>
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Salesman</th>
                <th scope="col">Phone</th>
                <th scope="col">Commission %</th>
                <th scope="col" className="ui-num">Invoices</th>
                <th scope="col" className="ui-num">Sales (pre-GST)</th>
                <th scope="col" className="ui-num">Commission due</th>
                {/* Narrow and pinned, so the one control on the row does not
                    ride off the end of a wide table. */}
                <th scope="col" className="sticky end-0 w-12" style={{ backgroundColor: 'rgb(var(--surface))' }}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {shownPerf.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <EmptyState
                      icon={UserCheck}
                      kind="new"
      title={smStatus ? 'Nobody matches' : 'No salesmen yet'}
                      description={
                        smStatus
                          ? 'Nobody on the team matches that filter.'
                          : 'Name the people who sell, and every invoice can say who won it — commission follows on its own.'
                      }
                      routes={
                        smStatus
                          ? undefined
                          : [
                              {
                                label: 'Add the first',
                                description: 'Name, phone, and the percentage they earn.',
                                onSelect: () => nameRef.current?.focus(),
                              },
                            ]
                      }
                    />
                  </td>
                </tr>
              ) : (
              shownPerf.map(({ salesman: s, invoices, sales, commission }) => (
                <tr key={s.id}>
                  <td className="ui-col-entity">{s.name}</td>
                  <td className="ui-col-meta">{s.phone || '—'}</td>
                  <td className="ui-col-meta">{Number(s.commissionPct || 0)}%</td>
                  <td className="ui-col-amount ui-mono">{invoices}</td>
                  <td className="ui-col-amount"><MoneyValue value={sales} company={currentCompany} /></td>
                  {/* Commission is money the business owes out, not revenue. */}
                  <td className="ui-col-amount"><MoneyValue value={commission} company={currentCompany} kind="outstanding" /></td>
                  <td className="sticky end-0 px-2 text-right" style={{ backgroundColor: 'rgb(var(--surface))' }}>
                    <button type="button" onClick={() => remove(s)} className="ui-icon-btn !h-8 !w-8" aria-label={`Remove ${s.name}`}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
      </div>
      <TableTotals
        count={shownPerf.length}
        totalCount={salesmen.length}
        noun="salesmen"
        figures={[{ label: 'Commission due', value: formatMoney(smHeadline.commission, currentCompany) }]}
      />
    </DocumentListShell>
  );
}

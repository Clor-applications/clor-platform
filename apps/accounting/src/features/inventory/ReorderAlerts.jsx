import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, Package, PackageSearch, ShoppingCart, Truck } from 'lucide-react';
import { EmptyState, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { formatMoney } from '@ui/utils/money';
import { notify } from '@ui/components/ui/notify';
import { computeInventorySummaryByItemId, isStockItem } from '@ui/utils/inventory';
import { createDocApi, hasApiSession } from '@ui/api/purchaseDocs';
import { getVendorDisplayName } from '@ui/utils/contacts';
import { MoneyValue } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * Reorder alerts — inventory as buying decisions.
 *
 * Every stock item with a reorder level whose closing quantity has fallen to
 * or below it. Suggested order = enough to reach 2× the reorder level. One
 * click drafts a PO to the vendor who last supplied the item.
 */
export default function ReorderAlerts({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const [busyId, setBusyId] = useState(null);

  const rows = useMemo(() => {
    const summary = computeInventorySummaryByItemId({ db, companyId });
    const items = (db.items || []).filter((i) => i.companyId === companyId && isStockItem(i) && Number(i.reorderLevel) > 0);

    /** Most recent bill line per item decides the "last vendor" and rate. */
    const lastByItem = new Map();
    const bills = (db.bills || [])
      .filter((b) => b.companyId === companyId && String(b.status || '').toLowerCase() !== 'cancelled')
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    for (const bill of bills) {
      for (const l of bill.items || []) {
        const k = String(l.itemId);
        if (!lastByItem.has(k)) lastByItem.set(k, { vendorId: bill.vendorId, vendorName: bill.vendorName, rate: Number(l.rate) || 0 });
      }
    }

    return items
      .map((i) => {
        const closing = Number(summary.get(String(i.id))?.closingQty ?? 0);
        const level = Number(i.reorderLevel);
        return {
          item: i,
          closing,
          level,
          suggestedQty: Math.max(1, Math.ceil(level * 2 - closing)),
          last: lastByItem.get(String(i.id)) || null,
        };
      })
      .filter((r) => r.closing <= r.level)
      .sort((a, b) => a.closing - b.closing);
  }, [db, companyId]);

  const draftPo = async (row) => {
    const vendor = row.last
      ? (db.vendors || []).find((v) => v.companyId === companyId && Number(v.id) === Number(row.last.vendorId))
      : null;
    const vendorName = vendor ? getVendorDisplayName(vendor) : row.last?.vendorName || 'To be decided';
    const rate = row.last?.rate || Number(row.item.purchasePrice) || 0;
    const line = {
      itemId: String(row.item.id),
      description: row.item.name,
      quantity: row.suggestedQty,
      rate,
      gstRate: Number(row.item.gstRate) || 0,
      hsnSac: row.item.hsnSac || '',
      taxableAmount: row.suggestedQty * rate,
      lineTotal: row.suggestedQty * rate,
    };

    setBusyId(row.item.id);
    try {
      let backendDocId = null;
      let serverNumber = '';
      if (hasApiSession()) {
        try {
          const saved = await createDocApi('purchaseOrder', {
            date: new Date().toISOString().slice(0, 10),
            partyId: vendor?.backendPartyId ? String(vendor.backendPartyId) : null,
            partyName: vendorName,
            subtotal: line.taxableAmount,
            gstTotal: 0,
            total: line.taxableAmount,
            status: 'Draft',
            notes: `Auto-drafted from reorder alert (stock ${row.closing} ≤ level ${row.level})`,
            items: [line],
          });
          backendDocId = saved?.id || null;
          serverNumber = String(saved?.number || '');
        } catch (err) {
          notify.error(String(err?.message || 'PO not saved to the server.'));
          return;
        }
      }
      const nextId = (db.purchaseOrders || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1;
      setDb((prev) => ({
        ...prev,
        purchaseOrders: [
          ...(prev.purchaseOrders || []),
          {
            id: nextId,
            companyId,
            backendDocId,
            number: serverNumber || `PO-${nextId}`,
            date: new Date().toISOString().slice(0, 10),
            vendorId: row.last?.vendorId ?? '',
            vendorName,
            items: [line],
            subtotal: line.taxableAmount,
            gstTotal: 0,
            total: line.taxableAmount,
            status: 'Draft',
            notes: `Reorder: ${row.item.name}`,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      notify.success(`Draft PO ${serverNumber || `PO-${nextId}`} — ${row.suggestedQty} × ${row.item.name} to ${vendorName}.`);
    } finally {
      setBusyId(null);
    }
  };

  // Searched on what is actually on the row: the item's name and the vendor
  // last bought from. The old fields did not exist on these rows at all, so
  // typing anything emptied the table.
  const raSearch = useListSearch(rows, [(r) => r.item?.name, (r) => r.last?.vendorName]);

  /*
   * How urgent each line is. Out of stock is not "low": the shelf is empty and
   * something is unsellable today, which is a different call from a level that
   * has merely been touched.
   */
  const [raFilter, setRaFilter] = useState('ALL');
  const RA_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'OUT', label: 'Out of stock', tone: 'overdue' },
    { value: 'LOW', label: 'At or below level', tone: 'outstanding' },
    { value: 'KNOWN', label: 'Vendor known', tone: 'paid' },
  ];
  const raMatches = (r, tab) => {
    if (tab === 'OUT') return r.closing <= 0;
    if (tab === 'LOW') return r.closing > 0;
    if (tab === 'KNOWN') return Boolean(r.last?.vendorName);
    return true;
  };
  const raSearchRows = raFilter === 'ALL' ? raSearch.filtered : raSearch.filtered.filter((r) => raMatches(r, raFilter));

  const raCounts = useMemo(() => {
    const counts = { ALL: raSearch.filtered.length };
    for (const t of RA_TABS) {
      if (t.value === 'ALL') continue;
      counts[t.value] = raSearch.filtered.filter((r) => raMatches(r, t.value)).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raSearch.filtered]);

  /*
   * What refilling the shelf would cost, at the last rate paid. An estimate on
   * purpose: it is what the buyer needs to know before drafting six POs, and
   * the real figure is whatever the vendor quotes.
   */
  const raHeadline = useMemo(() => {
    let outOfStock = 0;
    let suggested = 0;
    let cost = 0;
    let noVendor = 0;
    for (const r of rows) {
      if (r.closing <= 0) outOfStock += 1;
      suggested += Number(r.suggestedQty || 0);
      cost += Number(r.suggestedQty || 0) * Number(r.last?.rate || 0);
      if (!r.last?.vendorName) noVendor += 1;
    }
    return { items: rows.length, outOfStock, suggested, cost, noVendor };
  }, [rows]);

  const raExportColumns = [
    { key: 'name', label: 'Item', value: (r) => r.item?.name || '' },
    { key: 'inStock', label: 'In stock', value: (r) => Number(r.closing || 0) },
    { key: 'reorderLevel', label: 'Reorder level', value: (r) => Number(r.level || 0) },
    { key: 'suggestedQty', label: 'Suggested qty', value: (r) => Number(r.suggestedQty || 0) },
    { key: 'lastVendorName', label: 'Last vendor', value: (r) => r.last?.vendorName || '' },
    { key: 'lastRate', label: 'Last rate', value: (r) => Number(r.last?.rate || 0) },
  ];
  return (
    <DocumentListShell
      entity="items"
      title="Reorder Alerts"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: raSearch.query,
        onChange: raSearch.setQuery,
        placeholder: 'Search items…',
        label: 'Search items',
      }}
      moreItems={[exportMenuItem('Export alerts')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Alerts',
          fileName: `ReorderAlerts_${currentCompany?.name || 'company'}`,
          label: 'alert(s)',
          columns: raExportColumns,
          rows: raSearchRows,
        });
      }}
      cards={[
        { label: 'Items to reorder', value: raHeadline.items, count: true, tone: 'draft', Icon: PackageSearch },
        { label: 'Out of stock', value: raHeadline.outOfStock, count: true, tone: 'overdue', Icon: AlertTriangle },
        { label: 'Suggested quantity', value: raHeadline.suggested, count: true, tone: 'outstanding', Icon: Package },
        { label: 'At last rate paid', value: raHeadline.cost, tone: 'sent', Icon: ShoppingCart },
        { label: 'No vendor on record', value: raHeadline.noVendor, count: true, tone: 'cancelled', Icon: Truck },
      ]}
      tabs={RA_TABS}
      tabsLabel="Reorder filter"
      statusValue={raFilter}
      statusCounts={raCounts}
      onStatusChange={setRaFilter}
      tip={{
        storageKey: 'clor.tip.reorderAlerts',
        Icon: PackageSearch,
        text: 'An item appears here once it has a reorder level and stock has fallen to it — set the level on the item itself.',
      }}
    >
      <div className="overflow-x-auto ui-table-scroll compact-list-table-scroll" data-fill-viewport>
          <table className="ui-table ui-table-wide ui-table-sticky">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="ui-num">In stock</th>
                <th scope="col" className="ui-num">Reorder level</th>
                <th scope="col" className="ui-num">Suggested qty</th>
                <th scope="col">Last vendor</th>
                <th scope="col" className="ui-num">Last rate</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {raSearchRows.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <EmptyState
                      icon={PackageSearch}
                      kind="new"
      title={rows.length ? 'Nothing matches' : 'Nothing below reorder level'}
                      description={
                        rows.length
                          ? 'No item in this filter has fallen to its level.'
                          : 'Give an item a reorder level and it appears here the moment stock falls to it — with how much to buy and who you last bought it from.'
                      }
                    />
                  </td>
                </tr>
              ) : (
              raSearchRows.map((r) => (
                <tr key={r.item.id}>
                  <td className="ui-col-entity">{r.item.name}</td>
                  <td className={`ui-col-amount ui-mono ${r.closing <= 0 ? 'ui-amount-neg' : ''}`}>{r.closing}</td>
                  <td className="ui-col-amount ui-mono">{r.level}</td>
                  <td className="ui-col-amount ui-mono">{r.suggestedQty}</td>
                  <td className="ui-col-entity">{r.last?.vendorName || '—'}</td>
                  <td className="ui-col-amount">
                    {r.last ? <MoneyValue value={r.last.rate} company={currentCompany} /> : '—'}
                  </td>
                  <td className="text-right">
                    <button type="button" onClick={() => draftPo(r)} disabled={busyId === r.item.id} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
                      {busyId === r.item.id ? 'Drafting…' : 'Draft PO'}
                    </button>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
      </div>
      <TableTotals
        count={raSearchRows.length}
        totalCount={rows.length}
        noun="items"
        figures={[{ label: 'At last rate paid', value: formatMoney(raHeadline.cost, currentCompany) }]}
      />
    </DocumentListShell>
  );
}

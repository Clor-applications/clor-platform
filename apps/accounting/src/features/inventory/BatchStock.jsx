import React, { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, CalendarClock, Download, Package, Timer } from 'lucide-react';
import { EmptyState, StatusPill, TableTotals } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { batchStockRows } from '@ui/utils/batches';
import { DocDate } from '@ui/components/docs';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';

/**
 * Batch-wise stock and expiry report.
 *
 * Rows come straight from bills (in) and invoices (out) — nothing stored.
 * Expiry chips: Expired, ≤30d, ≤60d, ≤90d. The filter buttons answer the
 * daily warehouse question: "what do I have to move first?"
 */
export default function BatchStock({ db, currentCompany }) {
  const rows = useMemo(() => batchStockRows(db, currentCompany.id), [db, currentCompany.id]);
  const [filter, setFilter] = useState('ALL'); // ALL | EXPIRED | 30 | 60 | 90 | INSTOCK

  const chip = (b) => {
    if (b.days == null) return null;
    if (b.days < 0) return 'Expired';
    if (b.days <= 30) return 'Expiring ≤30d';
    if (b.days <= 60) return 'Expiring ≤60d';
    if (b.days <= 90) return 'Expiring ≤90d';
    return null;
  };

  const shown = rows.filter((b) => {
    if (filter === 'INSTOCK') return b.remaining > 0;
    if (filter === 'EXPIRED') return b.days != null && b.days < 0 && b.remaining > 0;
    if (filter === '30' || filter === '60' || filter === '90') {
      const lim = Number(filter);
      return b.days != null && b.days >= 0 && b.days <= lim && b.remaining > 0;
    }
    return true;
  });

  const counts = {
    expired: rows.filter((b) => b.days != null && b.days < 0 && b.remaining > 0).length,
    d30: rows.filter((b) => b.days != null && b.days >= 0 && b.days <= 30 && b.remaining > 0).length,
    d60: rows.filter((b) => b.days != null && b.days >= 0 && b.days <= 60 && b.remaining > 0).length,
    d90: rows.filter((b) => b.days != null && b.days >= 0 && b.days <= 90 && b.remaining > 0).length,
  };

  /*
   * The warehouse's own question, as tabs: what has to move first. Expired is
   * an alarm, the three windows are a queue, and "in stock" is everything
   * still on the shelf whatever its date.
   */
  const BATCH_TABS = [
    { value: 'ALL', label: 'All', tone: 'all' },
    { value: 'INSTOCK', label: 'In stock', tone: 'paid' },
    { value: 'EXPIRED', label: 'Expired', tone: 'overdue' },
    { value: '30', label: '≤30 days', tone: 'outstanding' },
    { value: '60', label: '≤60 days', tone: 'partial' },
    { value: '90', label: '≤90 days', tone: 'sent' },
  ];
  const batchCounts = {
    ALL: rows.length,
    INSTOCK: rows.filter((b) => b.remaining > 0).length,
    EXPIRED: counts.expired,
    30: counts.d30,
    60: counts.d60,
    90: counts.d90,
  };

  /*
   * Batches are counted, not valued: a batch row carries quantity, and the
   * money it cost lives on the bill that brought it in.
   */
  const batchHeadline = useMemo(() => {
    let onShelf = 0;
    let expiredQty = 0;
    let soonQty = 0;
    for (const b of rows) {
      const left = Number(b.remaining || 0);
      if (left <= 0) continue;
      onShelf += left;
      if (b.days != null && b.days < 0) expiredQty += left;
      else if (b.days != null && b.days <= 30) soonQty += left;
    }
    return { batches: rows.length, onShelf, expiredQty, soonQty };
  }, [rows]);

  const batchExportColumns = [
    { key: 'itemName', label: 'Item' },
    { key: 'batchNo', label: 'Batch' },
    { key: 'mfgDate', label: 'Mfg' },
    { key: 'expiryDate', label: 'Expiry' },
    { key: 'inQty', label: 'In', value: (r) => Number(r.qtyIn || 0) },
    { key: 'outQty', label: 'Out', value: (r) => Number(r.qtyOut || 0) },
    { key: 'balance', label: 'Balance', value: (r) => Number(r.remaining ?? 0) },
    { key: 'source', label: 'Source', value: (r) => r.sourceBillNumber || '' },
  ];

  const bsSearch = useListSearch(shown, ['itemName', 'batchNo', 'expiryDate', 'source']);
  const bsSearchRows = bsSearch.filtered;
  return (
    <DocumentListShell
      entity="items"
      title="Batch Stock & Expiry"
      compact
      tight
      denseCards
      company={currentCompany}
      search={{
        value: bsSearch.query,
        onChange: bsSearch.setQuery,
        placeholder: 'Search batches…',
        label: 'Search batches',
      }}
      moreItems={[exportMenuItem('Export batches')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: 'Batches',
          fileName: `BatchStock_${currentCompany?.name || 'company'}`,
          label: 'batch(es)',
          columns: batchExportColumns,
          rows: bsSearchRows,
        });
      }}
      cards={[
        { label: 'Batches', value: batchHeadline.batches, count: true, tone: 'draft', Icon: Boxes },
        { label: 'On the shelf', value: batchHeadline.onShelf, count: true, tone: 'paid', Icon: Package },
        { label: 'Expiring in 30 days', value: batchHeadline.soonQty, count: true, tone: 'outstanding', Icon: Timer },
        { label: 'Expired, still held', value: batchHeadline.expiredQty, count: true, tone: 'overdue', Icon: AlertTriangle },
        { label: 'Dated batches', value: rows.filter((b) => b.days != null).length, count: true, tone: 'sent', Icon: CalendarClock },
      ]}
      tabs={BATCH_TABS}
      tabsLabel="Batch filter"
      statusInHeader
      statusValue={filter}
      statusCounts={batchCounts}
      onStatusChange={setFilter}
    >
      <div className="overflow-x-auto ui-table-scroll" style={{ '--table-scroll-h': 'calc(100dvh - 11.5rem)' }} data-fill-viewport>
          <table className={`ui-table ui-table-wide ui-table-sticky ${bsSearchRows.length ? '' : 'cash-bank-empty-table'}`}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Batch</th>
                <th scope="col">Mfg</th>
                <th scope="col">Expiry</th>
                <th scope="col" className="ui-num">In</th>
                <th scope="col" className="ui-num">Out</th>
                <th scope="col" className="ui-num">Balance</th>
                <th scope="col">Source</th>
                <th scope="col">Alert</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {bsSearchRows.length === 0 ? (
                <tr>
                  <td colSpan="9">
                    <EmptyState
                      icon={Boxes}
                      kind="new"
      title={rows.length ? 'No batches here' : 'No batches yet'}
                      description={
                        rows.length
                          ? 'Nothing matches this filter — try All, or widen the expiry window.'
                          : 'Receive a batch-tracked item on a purchase bill and its batch, its dates and what is left of it appear here.'
                      }
                    />
                  </td>
                </tr>
              ) : (
              bsSearchRows.map((b) => (
                <tr key={b.id}>
                  <td className="ui-col-entity">{b.itemName}</td>
                  <td className="ui-col-id ui-mono">{b.batchNo}</td>
                  <td className="ui-col-date"><DocDate value={b.mfgDate} /></td>
                  <td className="ui-col-date">
                    {b.expiryDate || '—'}
                    {b.days != null ? <span className="ui-caption block">{b.days < 0 ? `${-b.days}d ago` : `in ${b.days}d`}</span> : null}
                  </td>
                  <td className="ui-col-amount ui-mono">{b.qtyIn}</td>
                  <td className="ui-col-amount ui-mono">{b.qtyOut}</td>
                  <td className="ui-col-amount ui-mono">{b.remaining}</td>
                  <td className="ui-col-meta">{b.sourceBillNumber || '—'}</td>
                  <td>{chip(b) ? <StatusPill status={chip(b)} /> : null}</td>
                </tr>
              ))
              )}
            </tbody>
          </table>
      </div>
      <TableTotals
        count={bsSearchRows.length}
        totalCount={rows.length}
        noun="batches"
        figures={[{ label: 'On the shelf', value: String(batchHeadline.onShelf) }]}
      />
    </DocumentListShell>
  );
}

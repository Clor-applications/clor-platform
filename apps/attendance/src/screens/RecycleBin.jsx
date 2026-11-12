import React, { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Trash2 } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { deleteFromBin, listRecycleBin, restoreFromBin } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Settings → Recycle Bin. What was deleted in People and Attendance stays
 * here for a number of days (30 by default) and can be put back as it was;
 * after that it is gone for good. Each person sees what they may delete.
 */
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000));

const COLUMNS = {
  type: (r) => r.type,
  label: (r) => r.label,
  deletedBy: (r) => r.deletedBy,
  deletedAt: (r) => String(r.deletedAt || '').slice(0, 10),
};
const EXPORT_COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'label', label: 'Item' },
  { key: 'deletedBy', label: 'Deleted by' },
  { key: 'deletedAt', label: 'Deleted on', value: (r) => when(r.deletedAt) },
  { key: 'purgeAfter', label: 'Gone for good on', value: (r) => when(r.purgeAfter) },
];

export default function RecycleBin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    listRecycleBin().then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load the recycle bin.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const search = useListSearch(items, ['label', 'type', 'deletedBy']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  const restore = async (item) => {
    setBusy(item.id);
    try {
      await restoreFromBin(item.id);
      notify.success(`${item.type} restored: ${item.label}`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not restored.'));
    } finally {
      setBusy('');
    }
  };
  const purge = async (item) => {
    const ok = await confirmDialog({ title: `Delete ${item.label} for good?`, message: 'It cannot be brought back after this.', confirmLabel: 'Delete for good' });
    if (!ok) return;
    setBusy(item.id);
    try {
      await deleteFromBin(item.id);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not deleted.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <DocumentListShell
      entity="settings"
      title="Recycle bin"
      description={`Deleted employees, shifts, holidays, schedules and days stay here for ${data?.days || 30} days. Restore puts them back as they were.`}
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search deleted items…', label: 'Search deleted items' }}
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Recycle Bin', fileName: 'Recycle bin', label: 'item/items', columns: EXPORT_COLUMNS, rows });
      }}
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={5} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Item" col="label" state={filters} className="ui-col-grow" />
                <ColumnHeader label="Type" col="type" state={filters} />
                <ColumnHeader label="Deleted by" col="deletedBy" state={filters} />
                <ColumnHeader label="Deleted on" col="deletedAt" state={filters} type="date" />
                <th>Days left</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {items.length ? (
                      <EmptyState kind="filtered" totalCount={items.length} title="Nothing matches" description="Nothing matches the search or the column filters." />
                    ) : (
                      <EmptyState icon={Trash2} title="The recycle bin is empty" description="When something is deleted in People or Attendance, it waits here before it is gone for good." />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity ui-col-grow">{r.label}</td>
                    <td>{r.type}</td>
                    <td>{r.deletedBy || '—'}</td>
                    <td className="ui-col-date whitespace-nowrap">{when(r.deletedAt)}</td>
                    <td className="ui-num tabular-nums" title={`Gone for good on ${when(r.purgeAfter)}`}>{daysLeft(r.purgeAfter)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === r.id} onClick={() => restore(r)} aria-label={`Restore ${r.label}`}>
                        <ArchiveRestore size={14} aria-hidden="true" /> Restore
                      </button>{' '}
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === r.id} onClick={() => purge(r)} aria-label={`Delete ${r.label} for good`}>
                        <Trash2 size={14} aria-hidden="true" /> Delete for good
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}

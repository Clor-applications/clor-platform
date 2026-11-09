import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Clock, MessageSquareWarning, Smartphone } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { getMonthReadiness, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Employees confirm their month in the app, or say what is wrong with it.
 * The disputes are worth reading before the month is closed.
 */
const lastMonth = () => {
  const [y, m] = todayIst().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

const COLUMNS = {
  name: (d) => d.name,
  note: (d) => d.note,
  at: (d) => String(d.at || '').slice(0, 10),
};


/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Employee' },
  { key: 'note', label: 'What they say' },
  { key: 'at', label: 'When', value: (r) => (r.at ? new Date(r.at).toLocaleString('en-IN') : '') },
];
export default function MonthConfirmations() {
  const [month, setMonth] = useState(lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* Another month clears the last one's figures at once, while rendering; the fetch fills them in. */
  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setData(null);
  }
  const load = useCallback(() => {
    getMonthReadiness(month).then((d) => { setData(d.confirmations); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const disputed = data?.disputed || [];
  const search = useListSearch(disputed, ['name', 'note']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  return (
    <DocumentListShell
      entity="report"
      title="Employee confirmations"
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Employee confirmations', fileName: 'Month disputes', label: 'dispute/disputes', columns: EXPORT_COLUMNS, rows: rows });
      }}
      description="Who has confirmed their month in the app, and who says something is wrong."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search disputes…', label: 'Search disputes' }}
      headerExtras={<input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      cards={data ? [
        { label: 'Using the app', value: data.portalPeople, count: true, tone: 'all', Icon: Smartphone },
        { label: 'Confirmed', value: data.confirmed, count: true, tone: 'paid', Icon: CheckCheck },
        { label: 'Say it is wrong', value: data.disputed.length, count: true, tone: 'overdue', Icon: MessageSquareWarning },
        { label: 'Not yet', value: data.notYet, count: true, tone: 'partial', Icon: Clock },
      ] : null}
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={5} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="name" state={filters} />
                <ColumnHeader label="What they say" col="note" state={filters}  className="ui-col-grow" />
                <ColumnHeader label="When" col="at" state={filters} type="date" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={3}>
                    {disputed.length ? (
                      <EmptyState kind="filtered" totalCount={disputed.length} title="No disputes match" description="Nothing matches the search or the column filters." />
                    ) : (
                      <EmptyState icon={CheckCheck} title="No disputes" description="When someone says their month is wrong, what they wrote appears here." />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.employeeId}>
                    <td className="ui-col-entity">{d.name}</td>
                    <td className="ui-col-grow whitespace-normal">{d.note}</td>
                    <td className="ui-col-date whitespace-nowrap">{new Date(d.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
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

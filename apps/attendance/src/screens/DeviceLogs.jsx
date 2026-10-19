import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Router, ScrollText } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { listDeviceLogs, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const weekAgo = () => new Date(Date.now() + 330 * 60_000 - 6 * 86_400_000).toISOString().slice(0, 10);

const TABS = [
  { value: 'OPERATION', label: 'Operations', tone: 'all' },
  { value: 'ERROR', label: 'Errors', tone: 'overdue' },
];
const COLUMNS = {
  time: (r) => String(r.localTime || '').slice(0, 10),
  reader: (r) => r.deviceName,
  code: (r) => r.code,
  by: (r) => r.operator,
};
const EXPORT_COLUMNS = [
  { key: 'localTime', label: 'Time' },
  { key: 'deviceName', label: 'Reader' },
  { key: 'code', label: 'Code' },
  { key: 'operator', label: 'By' },
  { key: 'details', label: 'Details' },
];

/**
 * What the readers report about themselves: operations done at the reader
 * (enrolling, deleting users, opening the menu) and errors. Codes are the
 * reader's own numbering (ClorTime's Operation Log and Error Log).
 */
export default function DeviceLogs() {
  const [kind, setKind] = useState('OPERATION');
  const [range, setRange] = useState({ from: weekAgo(), to: todayIst() });
  const [logs, setLogs] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  /* The server answers one kind at a time; both are fetched so each tab can show its count. */
  const load = useCallback(() => {
    Promise.all([listDeviceLogs({ kind: 'OPERATION', ...range }), listDeviceLogs({ kind: 'ERROR', ...range })])
      .then(([ops, errs]) => {
        setLogs({ OPERATION: ops?.logs || [], ERROR: errs?.logs || [] });
        setLoadError('');
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load reader logs.')));
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => ({ OPERATION: logs?.OPERATION.length || 0, ERROR: logs?.ERROR.length || 0 }), [logs]);
  const inTab = logs ? logs[kind] : [];
  const search = useListSearch(inTab, ['localTime', 'deviceName', 'code', 'operator', 'details']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useEffect(() => setPage(1), [kind, search.query, range]);

  const readersWithErrors = useMemo(() => new Set((logs?.ERROR || []).map((r) => r.deviceId)).size, [logs]);
  const readersReporting = useMemo(() => new Set([...(logs?.OPERATION || []), ...(logs?.ERROR || [])].map((r) => r.deviceId)).size, [logs]);

  return (
    <DocumentListShell
      entity="reader"
      title="Reader logs"
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search logs…', label: 'Search reader logs' }}
      moreItems={[exportMenuItem('Export logs')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        const what = kind === 'ERROR' ? 'errors' : 'operations';
        runListExport({ format, title: `Reader ${what}`, subtitle: `${range.from} to ${range.to}`, fileName: `Reader ${what} ${range.from} to ${range.to}`, label: 'entry/entries', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'Operations', value: counts.OPERATION, count: true, tone: 'all', Icon: ClipboardList, onSelect: () => setKind('OPERATION') },
        { label: 'Errors', value: counts.ERROR, count: true, tone: 'overdue', Icon: AlertTriangle, onSelect: () => setKind('ERROR') },
        { label: 'Readers reporting', value: readersReporting, count: true, tone: 'sent', Icon: Router },
        { label: 'Readers with errors', value: readersWithErrors, count: true, tone: 'outstanding', Icon: ScrollText },
      ]}
      tabs={TABS}
      statusValue={kind}
      statusCounts={counts}
      onStatusChange={setKind}
      tabsLabel="Log kind"
      tabsExtras={
        <>
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
        </>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!logs ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Time" col="time" state={filters} type="date" />
                  <ColumnHeader label="Reader" col="reader" state={filters} />
                  <ColumnHeader label={kind === 'ERROR' ? 'Error' : 'Operation'} col="code" state={filters} />
                  <ColumnHeader label="By" col="by" state={filters} />
                  <th className="ui-col-grow" scope="col">Details</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={5}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="No log entries match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={ScrollText}
                          title={kind === 'ERROR' ? 'No errors' : 'No operations'}
                          description="Operations done at the readers, and errors they report. Readers send these with their punches; widen the dates to see older ones."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-date whitespace-nowrap tabular-nums">{r.localTime}</td>
                      <td className="ui-col-entity">{r.deviceName}</td>
                      <td className="ui-mono">{r.code}</td>
                      <td className="ui-mono">{r.operator || '—'}</td>
                      <td className="ui-col-meta ui-col-grow whitespace-normal">{r.details || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="entries" />
        </>
      )}
    </DocumentListShell>
  );
}

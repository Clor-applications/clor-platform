import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Fingerprint, Router, UserX, Wrench } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { deviceCommand, fixReaderGaps, getReaderSync, removeReaderExtras } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

const CELL = {
  OK: { mark: '✓', label: 'On the reader', color: 'rgb(var(--pos))' },
  PARTIAL: { mark: '◐', label: 'On it, missing a fingerprint or face', color: 'rgb(var(--warn-ink, 180 120 0))' },
  MISSING: { mark: '✕', label: 'Not on the reader', color: 'rgb(var(--neg))' },
  QUEUED: { mark: '…', label: 'Changes on their way', color: 'rgb(var(--fg-muted))' },
  EXTRA: { mark: '!', label: 'On a reader that is not theirs (left, or another site)', color: 'rgb(var(--neg))' },
  NA: { mark: '', label: 'Not for this reader', color: 'rgb(var(--fg-muted))' },
};

const TABS = [
  { value: 'gaps', label: 'With a gap', tone: 'overdue' },
  { value: 'all', label: 'Everyone', tone: 'all' },
];
const COLUMNS = { employee: (r) => r.name };

/**
 * Who is on which reader — the question behind "my finger doesn't work at
 * the back gate". Each person against each reader, with the gaps closed in
 * one click and people who should not be on a reader taken off.
 */
export default function ReaderSync() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(true);
  const load = useCallback(() => {
    getReaderSync().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const withGap = (r) => r.cells.some((c) => c.state !== 'OK' && c.state !== 'NA');
  const counts = useMemo(() => ({ gaps: (data?.rows || []).filter(withGap).length, all: (data?.rows || []).length }), [data]);
  const inTab = useMemo(() => (data ? data.rows.filter((r) => !onlyGaps || withGap(r)) : []), [data, onlyGaps]);
  const search = useListSearch(inTab, ['name', 'code', 'pin', 'department']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const totals = useMemo(() => (data?.summary || []).reduce((t, x) => ({ missing: t.missing + (x.missing || 0), partial: t.partial + (x.partial || 0), queued: t.queued + (x.queued || 0), extra: t.extra + (x.extra || 0) }), { missing: 0, partial: 0, queued: 0, extra: 0 }), [data]);

  const fix = async (body, what) => {
    try {
      const r = await fixReaderGaps(body);
      notify.success(r.people ? `${r.people} ${r.people === 1 ? 'person' : 'people'} queued (${r.commands} changes) ${what}. They arrive within a minute or two.` : 'Nothing to fix.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
  };
  const extras = async (reader, n) => {
    if (!(await confirmDialog({ title: `Take ${n} ${n === 1 ? 'person' : 'people'} off ${reader.name}?`, message: 'Their user, fingerprints and face are removed from this reader. People who have left, or belong to another site.', confirmLabel: 'Remove' }))) return;
    try {
      const r = await removeReaderExtras(reader.id);
      notify.success(`${r.removed} being removed.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
  };
  const readAll = async (reader) => {
    try {
      await deviceCommand(reader.id, 'READ_ALL');
      notify.success(`Asked ${reader.name} for everything it holds. Refresh in a minute.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not queued.'));
    }
  };

  const gaps = (data?.summary || []).reduce((s, x) => s + x.missing + x.partial, 0);
  const noReaders = data && !data.readers.length;
  return (
    <DocumentListShell
      entity="reader"
      title="Sync monitoring"
      description="Who is on which reader. Enrol once on any reader — CLOR copies fingerprints and faces to the rest."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search people' }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" disabled={!gaps} onClick={() => fix({}, 'on every reader')}>
          <Wrench size={16} aria-hidden="true" /> Fix all gaps{gaps ? ` (${gaps})` : ''}
        </button>
      }
      cards={
        data && !noReaders
          ? [
              { label: 'Missing', value: totals.missing, count: true, tone: 'overdue', Icon: UserX },
              { label: 'Partly enrolled', value: totals.partial, count: true, tone: 'partial', Icon: Fingerprint },
              { label: 'On the way', value: totals.queued, count: true, tone: 'sent', Icon: Clock },
              { label: 'Extras', value: totals.extra, count: true, tone: 'outstanding', Icon: AlertTriangle },
            ]
          : null
      }
      tabs={noReaders ? null : TABS}
      statusValue={onlyGaps ? 'gaps' : 'all'}
      statusCounts={counts}
      onStatusChange={(v) => setOnlyGaps(v === 'gaps')}
      tabsLabel="Who to show"
      tabsExtras={<span className="ui-caption">{Object.entries(CELL).filter(([k]) => k !== 'NA').map(([, v]) => `${v.mark} ${v.label.toLowerCase()}`).join(' · ')}</span>}
      above={
        data && !noReaders ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.readers.map((r) => {
              const s = data.summary.find((x) => x.deviceId === r.id) || {};
              return (
                <div key={r.id} className="ui-card space-y-2 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{r.name}</span>
                    <span className="ui-caption">{r.online ? 'online' : 'offline'}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>✓ {s.ok}</span>
                    {s.missing ? <span style={{ color: CELL.MISSING.color }}>✕ {s.missing} missing</span> : null}
                    {s.partial ? <span style={{ color: CELL.PARTIAL.color }}>◐ {s.partial} partial</span> : null}
                    {s.queued ? <span className="ui-muted">… {s.queued} on the way</span> : null}
                    {s.extra ? <span style={{ color: CELL.EXTRA.color }}>! {s.extra} should not be on it</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.missing || s.partial ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => fix({ deviceId: r.id }, `for ${r.name}`)}><Wrench size={14} aria-hidden="true" /> Fix gaps</button> : null}
                    {s.extra ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => extras(r, s.extra)}>Remove extras</button> : null}
                    {!s.known ? (
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => readAll(r)} title="CLOR does not yet know who this reader holds">Read what is on it</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={8} />
      ) : noReaders ? (
        <EmptyState icon={Router} title="No readers" description="Who is on which reader shows here. Add a reader under Readers first." />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full text-sm">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <th scope="col">Enrolled</th>
                {data.readers.map((r) => <th key={r.id} scope="col" className="ui-col-h-center">{r.name}</th>)}
                <th scope="col"><span className="sr-only">Fix</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={data.readers.length + 3}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="Nobody matches" description="Nobody in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Fingerprint}
                        title={onlyGaps ? 'No gaps' : 'Nobody'}
                        description={onlyGaps ? 'Everyone is on every reader they belong on. Enrol once on any reader — CLOR copies fingerprints and faces to the rest.' : 'No one with an employee code or Reader ID.'}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td className="ui-col-entity">
                      {row.name}
                      <span className="ui-caption block">ID {row.pin}{row.left ? ' · left' : ''}{row.department ? ` · ${row.department}` : ''}</span>
                    </td>
                    <td className="whitespace-nowrap">{[row.enrolled.fingers ? `${row.enrolled.fingers} finger${row.enrolled.fingers === 1 ? '' : 's'}` : null, row.enrolled.face ? 'face' : null].filter(Boolean).join(' + ') || '—'}</td>
                    {row.cells.map((c) => {
                      const v = CELL[c.state];
                      const title = c.state === 'PARTIAL' ? `${v.label}: ${[c.lackFingers && `${c.lackFingers} finger${c.lackFingers === 1 ? '' : 's'}`, c.lackFace && 'face'].filter(Boolean).join(' and ')} missing` : v.label;
                      return (
                        <td key={c.deviceId} className="ui-col-h-center font-semibold" style={{ color: v.color }} title={title}>
                          <span aria-label={title}>{v.mark}</span>
                        </td>
                      );
                    })}
                    <td className="ui-col-meta text-end">
                      {row.cells.some((c) => c.state === 'MISSING' || c.state === 'PARTIAL') ? (
                        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => fix({ employeeIds: [row.employeeId] }, `for ${row.name}`)}>Fix</button>
                      ) : null}
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

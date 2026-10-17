import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { deviceCommand, fixReaderGaps, getReaderSync, removeReaderExtras } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const CELL = {
  OK: { mark: '✓', label: 'On the reader', color: 'rgb(var(--pos))' },
  PARTIAL: { mark: '◐', label: 'On it, missing a fingerprint or face', color: 'rgb(var(--warn-ink, 180 120 0))' },
  MISSING: { mark: '✕', label: 'Not on the reader', color: 'rgb(var(--neg))' },
  QUEUED: { mark: '…', label: 'Changes on their way', color: 'rgb(var(--fg-muted))' },
  EXTRA: { mark: '!', label: 'On a reader that is not theirs (left, or another site)', color: 'rgb(var(--neg))' },
  NA: { mark: '', label: 'Not for this reader', color: 'rgb(var(--fg-muted))' },
};

/**
 * Who is on which reader — the question behind "my finger doesn't work at
 * the back gate". Each person against each reader, with the gaps closed in
 * one click and people who should not be on a reader taken off.
 */
export default function ReaderSync() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    getReaderSync().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    return data.rows.filter(
      (r) => (!onlyGaps || r.cells.some((c) => c.state !== 'OK' && c.state !== 'NA')) && (!n || `${r.name} ${r.code || ''} ${r.pin}`.toLowerCase().includes(n))
    );
  }, [data, onlyGaps, q]);

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

  if (!data) return loadError ? <LoadFailed message={loadError} onRetry={load} /> : <SkeletonCard lines={8} />;
  const gaps = data.summary.reduce((s, x) => s + x.missing + x.partial, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Sync status"
        description="Who is on which reader. Enrol once on any reader — CLOR copies fingerprints and faces to the rest."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" disabled={!gaps} onClick={() => fix({}, 'on every reader')}>
            <Wrench size={16} aria-hidden="true" /> Fix all gaps{gaps ? ` (${gaps})` : ''}
          </button>
        }
      />
      {!data.readers.length ? (
        <EmptyState title="No readers" description="Add a reader under Readers first." />
      ) : (
        <>
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
                    {s.missing || s.partial ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => fix({ deviceId: r.id }, `for ${r.name}`)}>Fix gaps</button> : null}
                    {s.extra ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => extras(r, s.extra)}>Remove extras</button> : null}
                    {!s.known ? (
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => readAll(r)} title="CLOR does not yet know who this reader holds">Read what is on it</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input type="search" className="ui-input max-w-xs" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only people with a gap
            </label>
            <span className="ui-caption">{Object.entries(CELL).filter(([k]) => k !== 'NA').map(([, v]) => `${v.mark} ${v.label.toLowerCase()}`).join(' · ')}</span>
          </div>

          {!rows.length ? (
            <EmptyState title={onlyGaps ? 'No gaps' : 'Nobody'} description={onlyGaps ? 'Everyone is on every reader they belong on.' : 'No one with an employee code or Reader ID.'} />
          ) : (
            <div className="ui-card overflow-hidden">
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
                <table className="ui-table w-full text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="ui-th">Employee</th>
                      <th scope="col" className="ui-th">Enrolled</th>
                      {data.readers.map((r) => <th key={r.id} scope="col" className="ui-th ui-col-h-center">{r.name}</th>)}
                      <th scope="col" className="ui-th"><span className="sr-only">Fix</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.employeeId}>
                        <td className="ui-col-entity">
                          {row.name}
                          <span className="ui-caption block">ID {row.pin}{row.left ? ' · left' : ''}{row.department ? ` · ${row.department}` : ''}</span>
                        </td>
                        <td className="ui-col-meta whitespace-nowrap">{[row.enrolled.fingers ? `${row.enrolled.fingers} finger${row.enrolled.fingers === 1 ? '' : 's'}` : null, row.enrolled.face ? 'face' : null].filter(Boolean).join(' + ') || '—'}</td>
                        {row.cells.map((c) => {
                          const v = CELL[c.state];
                          const title = c.state === 'PARTIAL' ? `${v.label}: ${[c.lackFingers && `${c.lackFingers} finger${c.lackFingers === 1 ? '' : 's'}`, c.lackFace && 'face'].filter(Boolean).join(' and ')} missing` : v.label;
                          return (
                            <td key={c.deviceId} className="ui-col-h-center font-semibold" style={{ color: v.color }} title={title}>
                              <span aria-label={title}>{v.mark}</span>
                            </td>
                          );
                        })}
                        <td className="text-end">
                          {row.cells.some((c) => c.state === 'MISSING' || c.state === 'PARTIAL') ? (
                            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => fix({ employeeIds: [row.employeeId] }, `for ${row.name}`)}>Fix</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';

import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { listStructure } from '@ui/personnel/api';
import { SCHEDULE_SOURCE, getSchedule, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const wd = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
/* What a cell says: the shift's code, W weekly off, H holiday, L leave, – not employed. */
const cellLabel = (c) => (c.kind === 'OUT' ? '–' : c.kind === 'OFF' ? 'W' : c.kind === 'HOLIDAY' ? 'H' : c.kind === 'LEAVE' ? 'L' : c.code || (c.name || '').slice(0, 2));

/**
 * Who works what, each day of the month — exactly what attendance is scored
 * against (ClorTime's Schedule View). Hover a cell for where it came from.
 */
export default function ScheduleCalendar() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [filters, setFilters] = useState({ departmentId: '', areaId: '' });
  const [lists, setLists] = useState({ departments: [], areas: [] });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    Promise.all([listStructure('departments'), listStructure('areas')])
      .then(([departments, areas]) => setLists({ departments, areas }))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let cancelled = false;
    getSchedule({ month, ...filters })
      .then((d) => !cancelled && (setData(d), setLoadError('')))
      .catch((e) => !cancelled && setLoadError(String(e?.message || 'Could not load the schedule.')));
    return () => {
      cancelled = true;
    };
  }, [month, filters, attempt]);

  const shownRows = (data?.rows || []).filter((r) => !query.trim() || String(r.name).toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <PageHeader
        entity="shift"
        title="Schedule calendar"
        description="Each person’s shift for each day of the month — what their attendance is scored against."
        actions={
          <>
            <input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            {/* The roster as a file (AT-01): one row a person, one column a day, the same marks as the grid. */}
            <MoreButton
              items={[exportMenuItem('Export roster')]}
              onSelect={(k) => {
                const format = exportFormatFromKey(k);
                if (!format || !data) return;
                runListExport({
                  format,
                  title: `Roster ${month}`,
                  fileName: `Roster ${month}`,
                  label: 'person/people',
                  columns: [{ key: 'name', label: 'Employee' }, ...data.days.map((d) => ({ key: d, label: `${Number(d.slice(8))} ${WD[wd(d)]}` }))],
                  rows: shownRows.map((r) => Object.fromEntries([['name', r.name], ...r.cells.map((c) => [c.date, cellLabel(c)])])),
                  footNote: 'Shift codes as in Shifts · W weekly off · H holiday · L leave · – not employed',
                });
              }}
            />
          </>
        }
      />
      <div className="pb-8 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" className="ui-input ui-ctl-compact !w-56" placeholder="Search people…" aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="ui-select ui-ctl-compact !w-auto" value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} aria-label="Department">
          <option value="">All departments</option>
          {lists.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {lists.areas.length ? (
          <select className="ui-select ui-ctl-compact !w-auto" value={filters.areaId} onChange={(e) => setFilters({ ...filters, areaId: e.target.value })} aria-label="Area">
            <option value="">All areas</option>
            {lists.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : null}
        {data?.shifts?.length ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {data.shifts.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1">
                <span className="inline-block rounded-full px-1.5 font-semibold text-white" style={{ backgroundColor: s.color || 'rgb(var(--fg-subtle))' }}>{s.code || s.name.slice(0, 2)}</span>
                {s.name} {s.startTime}–{s.endTime}
              </span>
            ))}
            <span className="ui-caption">· plain text: company default · W weekly off · H holiday · L leave · dashed: temporary</span>
          </div>
        ) : null}
      </div>
      <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={8} />
      ) : !shownRows.length ? (
        <EmptyState icon={CalendarRange} title="Nobody here" description="No one employed in this month matches." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full text-xs">
              <thead>
                <tr>
                  <th scope="col" className="ui-th sticky left-0 z-10 bg-[rgb(var(--surface))] px-3">Employee</th>
                  {data.days.map((d) => (
                    <th key={d} scope="col" className={`ui-th px-1 text-center ${wd(d) === 0 ? 'ui-muted' : ''}`}>
                      <div>{Number(d.slice(8))}</div>
                      <div className="font-normal">{WD[wd(d)]}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="ui-rows">
                {shownRows.map((r) => (
                  <tr key={r.employeeId}>
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-[rgb(var(--surface))] px-3 text-left font-medium">{r.name}</th>
                    {r.cells.map((c) => {
                      const title = c.kind === 'OUT' ? 'Not employed' : `${c.name}${c.source ? ` — ${SCHEDULE_SOURCE[c.source] || c.source}` : ''}${c.kind === 'OFF' ? ' · weekly off' : c.kind === 'HOLIDAY' ? ' · holiday' : c.kind === 'LEAVE' ? ' · on leave' : ''}`;
                      const label = cellLabel(c);
                      /* A scheduled shift is a chip; the company default is the usual case and stays quiet, so the exceptions show. */
                      const work = c.kind === 'WORK' && c.source !== 'DEFAULT';
                      return (
                        <td key={c.date} title={title} className="px-0.5 text-center">
                          <span
                            className={`inline-block min-w-[1.6rem] rounded-full px-1 py-0.5 ${work ? 'font-semibold text-white' : c.kind === 'WORK' ? '' : 'ui-muted'}`}
                            style={work ? { backgroundColor: c.color || 'rgb(var(--fg-subtle))', opacity: c.source === 'TEMPORARY' ? 0.75 : 1, outline: c.source === 'TEMPORARY' ? '2px dashed currentColor' : undefined } : undefined}
                          >
                            {label}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

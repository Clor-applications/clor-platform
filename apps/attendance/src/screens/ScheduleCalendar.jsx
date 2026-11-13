import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Trash2 } from '@ui/components/ui/lineIcons';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listBranches, listStructure } from '@ui/personnel/api';
import { copyRosterWeek, dayLabel, discardRosterDraft, getRoster, publishRoster, setRosterDraft, todayIst } from '../api/attendance';
import RosterGrid from '../components/RosterGrid';
import { cellLabel } from '../components/rosterCells';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const utc = (d) => new Date(`${d}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const plusMonths = (d, n) => { const x = utc(`${d.slice(0, 7)}-01`); x.setUTCMonth(x.getUTCMonth() + n); return iso(x); };
/* The week a day is in, Monday first. */
const weekStart = (d) => plusDays(d, -((utc(d).getUTCDay() + 6) % 7));
const plural = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

const SKIP_SAYS = { NOT_EMPLOYED: 'not employed that day', TEMPORARY: 'on a temporary schedule', NO_SHIFT: 'no shift to copy' };
/* Why days were left out, in words: "2 not employed that day, 1 on a temporary schedule". */
const skippedWords = (r) => {
  const by = {};
  for (const s of r.skipped || []) by[s.reason] = (by[s.reason] || 0) + 1;
  const listed = Object.entries(by).map(([k, n]) => `${n} ${SKIP_SAYS[k] || 'left out'}`).join(', ');
  return r.skippedCount > (r.skipped || []).length ? `${r.skippedCount} left out` : listed;
};

/**
 * The roster: who works which shift each day of a week or a month, and the
 * place it is planned. Changes are a draft until Publish; only then do they
 * count for attendance and show to the people themselves, who are told.
 * Someone who may only view Shifts sees the same grid, read only.
 */
export default function ScheduleCalendar() {
  const perms = usePermissions();
  const canEdit = Boolean(perms?.isAdmin) || Boolean(perms?.permissions?.has?.('ATTENDANCE::Shifts::EDIT'));
  const [view, setView] = useState('month');
  const [day, setDay] = useState(todayIst());
  const [filters, setFilters] = useState({ departmentId: '', branchId: '', areaId: '', shiftId: '' });
  const [lists, setLists] = useState({ departments: [], branches: [], areas: [] });
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);

  const range = useMemo(() => {
    if (view === 'week') return { from: weekStart(day), to: plusDays(weekStart(day), 6) };
    const first = `${day.slice(0, 7)}-01`;
    return { from: first, to: plusDays(plusMonths(first, 1), -1) };
  }, [view, day]);

  useEffect(() => {
    Promise.all([listStructure('departments'), listBranches().catch(() => []), listStructure('areas')])
      .then(([departments, branches, areas]) => setLists({ departments, branches, areas }))
      .catch(() => undefined);
  }, []);
  /* The search waits for a pause in typing: each change is a request for the whole grid. */
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    const mine = (asked.current += 1);
    return getRoster({ ...range, ...filters, q, page, pageSize: perPage })
      .then((d) => { if (mine === asked.current) { setData(d); setLoadError(''); } })
      .catch((e) => { if (mine === asked.current) setLoadError(String(e?.message || 'Could not load the roster.')); });
  }, [range, filters, q, page, perPage]);
  useEffect(() => { load(); }, [load, attempt]);

  const setFilter = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); setPage(1); };
  const step = (n) => { setDay(view === 'week' ? plusDays(day, 7 * n) : plusMonths(day, n)); setPage(1); };
  const filtered = Boolean(filters.departmentId || filters.branchId || filters.areaId || filters.shiftId || q);
  const draft = data?.draft || { days: 0, people: 0 };

  /* Every write: one request, then the grid as the server now has it. */
  const run = async (work, failed) => {
    setBusy(true);
    try {
      await work();
      await load();
    } catch (e) {
      notify.error(String(e?.message || failed));
    } finally {
      setBusy(false);
    }
  };

  const assign = (body) =>
    run(async () => {
      const r = await setRosterDraft(body);
      const left = r.skippedCount ? ` ${skippedWords(r)}.` : '';
      if (r.changed) notify.success(`${plural(r.changed, 'day', 'days')} set in the draft.${left}`);
      else notify.info(`Those days are already so.${left}`);
    }, 'Not set.');

  const copyWeek = async (weeks) => {
    const ids = data?.employeeIds || [];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Copy this week onto the next ${weeks === 1 ? 'week' : `${weeks} weeks`}?`,
      message: `${plural(ids.length, 'person', 'people')}${filtered ? ' listed' : ''}: the week of ${dayLabel(range.from)}, as planned here, becomes a draft for ${weeks === 1 ? 'the week' : `the ${weeks} weeks`} after it.`,
      confirmLabel: 'Copy',
      tone: 'primary',
    });
    if (!ok) return;
    await run(async () => {
      const r = await copyRosterWeek({ employeeIds: ids, weekStart: range.from, weeks });
      notify.success(`${plural(r.changed, 'day', 'days')} set in the draft.${r.skippedCount ? ` ${skippedWords(r)}.` : ''}`);
    }, 'Not copied.');
  };

  const discard = async () => {
    if (!(await confirmDialog({ title: 'Discard the draft?', message: `${plural(draft.days, 'unpublished change goes', 'unpublished changes go')}. The published roster stays as it is.`, confirmLabel: 'Discard', tone: 'danger' }))) return;
    await run(async () => {
      await discardRosterDraft();
      notify.success('Draft discarded.');
    }, 'Not discarded.');
  };

  const publish = async () => {
    const ok = await confirmDialog({
      title: `Publish ${plural(draft.days, 'change', 'changes')}?`,
      message: `${plural(draft.people, 'person', 'people')}, ${dayLabel(draft.from)}${draft.to !== draft.from ? ` to ${dayLabel(draft.to)}` : ''}. Attendance follows the roster from then on, and each person whose days change is told.`,
      confirmLabel: 'Publish',
      tone: 'primary',
    });
    if (!ok) return;
    await run(async () => {
      const r = await publishRoster();
      notify.success(`Roster published: ${plural(r.days, 'day', 'days')} changed for ${plural(r.people, 'person', 'people')}, ${r.notified} told.`);
    }, 'Not published.');
  };

  const exportRoster = (format) => {
    if (!data) return;
    const name = `Roster ${data.from} to ${data.to}`;
    runListExport({
      format,
      title: name,
      fileName: name,
      label: 'person/people',
      columns: [{ key: 'name', label: 'Employee' }, ...data.days.map((d) => ({ key: d, label: `${Number(d.slice(8))} ${WD[utc(d).getUTCDay()]}` }))],
      rows: data.rows.map((r) => Object.fromEntries([['name', r.name], ...r.cells.map((c) => [c.date, cellLabel(c)])])),
      footNote: 'Shift codes as in Shifts · W weekly off · H holiday · L leave · – not employed. Includes unpublished draft changes.',
    });
  };

  const moreItems = [
    ...(canEdit && view === 'week' && data?.total
      ? [1, 2, 4].map((n) => ({ key: `copy${n}`, label: `Copy this week onto the next ${n === 1 ? 'week' : `${n} weeks`}`, Icon: Copy }))
      : []),
    ...(canEdit && draft.days ? [{ key: 'discard', label: 'Discard the draft', Icon: Trash2 }] : []),
    exportMenuItem('Export roster'),
  ];

  return (
    <DocumentListShell
      entity="shift"
      title="Schedule calendar"
      compact
      tight
      search={{ value: query, onChange: setQuery, placeholder: 'Search name or code…', label: 'Search people by name or code' }}
      moreItems={moreItems}
      onMoreSelect={(k) => {
        if (k === 'discard') return discard();
        if (k.startsWith('copy')) return copyWeek(Number(k.slice(4)));
        const format = exportFormatFromKey(k);
        return format ? exportRoster(format) : undefined;
      }}
      primary={canEdit ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !draft.days} onClick={publish}>Publish</button> : null}
      above={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="ui-segmented" role="tablist" aria-label="Period">
              {[['week', 'Week'], ['month', 'Month']].map(([k, label]) => (
                <button key={k} type="button" role="tab" className="ui-segment" aria-selected={view === k} onClick={() => { setView(k); setPage(1); }}>{label}</button>
              ))}
            </div>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
            {view === 'week' ? (
              <input type="date" className="ui-input ui-ctl-compact !w-auto" value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setPage(1); } }} aria-label="A day in the week" />
            ) : (
              <input type="month" className="ui-input ui-ctl-compact !w-auto" value={day.slice(0, 7)} onChange={(e) => { if (e.target.value) { setDay(`${e.target.value}-01`); setPage(1); } }} aria-label="Month" />
            )}
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)}><ChevronRight size={16} aria-hidden="true" /></button>
            <select className="ui-select ui-ctl-compact !w-auto" value={filters.departmentId} onChange={setFilter('departmentId')} aria-label="Department">
              <option value="">All departments</option>
              {lists.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {lists.branches.length > 1 ? (
              <select className="ui-select ui-ctl-compact !w-auto" value={filters.branchId} onChange={setFilter('branchId')} aria-label="Branch">
                <option value="">All branches</option>
                {lists.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : null}
            {lists.areas.length ? (
              <select className="ui-select ui-ctl-compact !w-auto" value={filters.areaId} onChange={setFilter('areaId')} aria-label="Area">
                <option value="">All areas</option>
                {lists.areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            ) : null}
            {data?.shifts?.length ? (
              <select className="ui-select ui-ctl-compact !w-auto" value={filters.shiftId} onChange={setFilter('shiftId')} aria-label="Shift">
                <option value="">All shifts</option>
                {data.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : null}
          </div>
          {draft.days ? (
            <p className="text-sm" role="status">
              <span className="ui-pill ui-pill-warn mr-2">Draft</span>
              {plural(draft.days, 'change', 'changes')} for {plural(draft.people, 'person', 'people')}, {dayLabel(draft.from)}{draft.to !== draft.from ? ` to ${dayLabel(draft.to)}` : ''}, not published. Attendance and the employee app keep the published roster until then.
            </p>
          ) : null}
          {data?.closedMonths?.length ? <p className="ui-caption">{data.closedMonths.join(', ')} {data.closedMonths.length === 1 ? 'is' : 'are'} closed in Attendance: those days cannot change.</p> : null}
          {data?.shifts?.length ? (
            <p className="ui-caption">
              {data.shifts.map((s) => `${s.code || s.name.slice(0, 2)} ${s.name} ${s.startTime}–${s.endTime}`).join(' · ')} · W weekly off · H holiday · L leave · dashed: draft
            </p>
          ) : null}
        </div>
      }
    >
      <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={8} />
      ) : !data.rows.length ? (
        <EmptyState icon={CalendarRange} title="Nobody here" description="No one employed in these days matches." />
      ) : (
        <>
          <RosterGrid days={data.days} rows={data.rows} shifts={data.shifts} coverage={data.coverage} closedMonths={data.closedMonths} filtered={filtered} canEdit={canEdit} busy={busy} onAssign={assign} />
          <Pagination total={data.total} page={data.page} perPage={perPage} pageCount={Math.max(1, Math.ceil(data.total / perPage))} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="people" />
        </>
      )}
    </DocumentListShell>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarDays, CalendarMinus, Plus, Trash2, Upload } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createHoliday, dayLabel, deleteHoliday, getHolidayYear, todayIst, updateHoliday } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import { listStructure } from '@ui/personnel/api';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (iso) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'PAID', label: 'Paid', tone: 'paid' },
  { value: 'OPTIONAL', label: 'Optional', tone: 'cancelled' },
];
const COLUMNS = {
  date: (h) => h.date,
  name: (h) => h.name,
  area: (h) => h.areaName || 'Everyone',
};

/** The year's holidays. A day worked on a holiday is all overtime. */
/* What Export writes (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'name', label: 'Holiday' },
  { key: 'areaName', label: 'For', value: (h) => h.areaName || 'Everyone' },
  { key: 'isOptional', label: 'Optional', value: (h) => (h.isOptional ? 'Yes' : 'No') },
];

/**
 * Each branch in a state whose law sets a minimum of national and festival
 * holidays (Karnataka 10, Maharashtra 8): said when the year's list is short.
 * A state whose figure is not confirmed says so instead of a number.
 */
function StateMinimum({ rows, year }) {
  const short = rows.filter((r) => r.short);
  const unknown = rows.filter((r) => r.minimum == null);
  if (!short.length && !unknown.length) return null;
  return (
    <div className="space-y-1 text-sm" role="status">
      {short.map((r) => <p key={r.branchId} className="ui-text-warn">{r.branchName} ({r.state}): the state asks for {r.minimum} national and festival holidays a year; {year} has {r.holidays}. Optional holidays do not count.</p>)}
      {unknown.map((r) => <p key={r.branchId} className="ui-muted">{r.branchName} ({r.state}): {r.law}.</p>)}
    </div>
  );
}

export default function Holidays({ openScreen } = {}) {
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const [all, setAll] = useState(null);
  const [minimum, setMinimum] = useState([]);
  const [kind, setKind] = useState('');
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ date: '', name: '', isOptional: false, areaId: '' });
  const [areas, setAreas] = useState([]);
  useEffect(() => {
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, []);

  const load = useCallback(() => {
    getHolidayYear(year).then((v) => { setAll(v.holidays); setMinimum(v.stateMinimum); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load holidays.')));
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const list = all || [];
    const optional = list.filter((h) => h.isOptional).length;
    return { '': list.length, PAID: list.length - optional, OPTIONAL: optional };
  }, [all]);
  const upcoming = useMemo(() => (all || []).filter((h) => h.date >= todayIst()).length, [all]);
  const inTab = useMemo(() => (all || []).filter((h) => !kind || (kind === 'OPTIONAL') === Boolean(h.isOptional)), [all, kind]);
  const search = useListSearch(inTab, ['name', 'date', 'areaName']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  const add = async (e) => {
    e.preventDefault();
    try {
      await createHoliday({ ...form, areaId: form.areaId || null });
      notify.success('Holiday added.');
      setForm({ date: '', name: '', isOptional: false, areaId: '' });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not added.'));
    }
  };

  const toggleOptional = async (h) => {
    try {
      await updateHoliday(h.id, { date: h.date, name: h.name, isOptional: !h.isOptional, branchId: h.branchId, areaId: h.areaId });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };

  const remove = async (h) => {
    const ok = await confirmDialog({ title: `Delete ${h.name}?`, message: 'Days already marked as this holiday keep their status.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteHoliday(h.id);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <DocumentListShell
      entity="holiday"
      title="Holidays"
      moreItems={[exportMenuItem('Export'), ...(openScreen ? [{ key: 'import', label: 'Import from a spreadsheet', Icon: Upload }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'import') return openScreen('dataImport', { kind: 'holidays' });
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Holidays', fileName: 'Holidays', label: 'holiday/holidays', columns: EXPORT_COLUMNS, rows });
      }}
      description="Paid days off — for everyone, or only one area’s people (a plant in another state keeps its own). Optional holidays do not change anyone's attendance."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search holidays…', label: 'Search holidays' }}
      cards={[
        { label: `Holidays in ${year}`, value: counts[''], count: true, tone: 'all', Icon: CalendarDays },
        { label: 'Paid', value: counts.PAID, count: true, tone: 'paid', Icon: CalendarCheck, onSelect: () => setKind('PAID') },
        { label: 'Optional', value: counts.OPTIONAL, count: true, tone: 'cancelled', Icon: CalendarMinus, onSelect: () => setKind('OPTIONAL') },
        { label: 'Still to come', value: upcoming, count: true, tone: 'sent', Icon: CalendarClock },
      ]}
      tabs={TABS}
      statusValue={kind}
      statusCounts={counts}
      onStatusChange={setKind}
      tabsLabel="Paid or optional"
      tabsExtras={
        <div className="flex items-center gap-1">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
          <span className="min-w-[4ch] text-center font-medium tabular-nums">{year}</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
        </div>
      }
      above={
        <>
        <StateMinimum rows={minimum} year={year} />
        <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label="Add a holiday">
          <label className="block"><span className="ui-label">Date</span><input type="date" className="ui-input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label className="block min-w-[14rem] flex-1"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali" /></label>
          {areas.length ? (
            <label className="block">
              <span className="ui-label">For</span>
              <select className="ui-select" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                <option value="">Everyone</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name} only</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.isOptional} onChange={(e) => setForm({ ...form, isOptional: e.target.checked })} /> Optional</label>
          <button type="submit" className="ui-btn ui-btn-primary"><Plus size={16} aria-hidden="true" /> Add holiday</button>
        </form>
        </>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Date" col="date" state={filters} type="date" />
                <th scope="col">Day</th>
                <ColumnHeader label="Holiday" col="name" state={filters}  className="ui-col-grow" />
                <ColumnHeader label="For" col="area" state={filters} />
                <th scope="col" className="ui-col-h-center">Optional</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No holidays match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={CalendarDays}
                        title={kind ? `No ${kind.toLowerCase()} holidays in ${year}` : `No holidays in ${year}`}
                        description="Paid days off — for everyone, or only one area’s people (a plant in another state keeps its own). Optional holidays do not change anyone's attendance. A day worked on a holiday is all overtime. Add the year's holidays above."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((h) => (
                  <tr key={h.id}>
                    <td className="ui-col-date whitespace-nowrap">{dayLabel(h.date)}</td>
                    <td className="ui-col-meta">{weekday(h.date)}</td>
                    <td className="ui-col-entity">{h.name}</td>
                    <td className="ui-col-meta">{h.areaName || 'Everyone'}</td>
                    <td className="ui-col-h-center">
                      <input type="checkbox" className="ui-checkbox" aria-label={`${h.name} is optional`} checked={h.isOptional} onChange={() => toggleOptional(h)} />
                    </td>
                    <td className="ui-col-meta">
                      <span className="flex justify-end">
                        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Delete ${h.name}`} onClick={() => remove(h)}>
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>
                      </span>
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

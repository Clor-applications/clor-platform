import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, CalendarCheck, CheckCheck, FileSearch, FileSpreadsheet, HelpCircle, Plus, Timer, UserX, Upload, Wand2, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { approveOvertime, bulkChangeDays, dayLabel, deleteDay, explainDay, hm, listEmployees, listRecords, markDay, STATUS, todayIst, validateDays } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import DayExplain from '../components/DayExplain';
import { downloadEvidence } from '../components/evidenceXlsx';
import PunchEvidence from '../components/PunchEvidence';
import { TRUST } from '../components/readerTrust';
import { plusDaysIso } from '@ui/utils/dates';

/**
 * Everyone's days: filter, correct, validate, approve overtime. After
 * Horilla's attendance list (validate / overtime approval live here too);
 * laid out as Accounting's lists are — figures, status tabs with counts,
 * filters in the column headings, actions on the selection.
 */
const weekAgo = () => plusDaysIso(-6);

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'PRESENT', label: 'Present', tone: 'paid' },
  { value: 'HALF_DAY', label: 'Half day', tone: 'partial' },
  { value: 'ABSENT', label: 'Absent', tone: 'overdue' },
  { value: 'ON_LEAVE', label: 'On leave', tone: 'sent' },
  { value: 'HOLIDAY', label: 'Holiday', tone: 'cancelled' },
  { value: 'WEEKLY_OFF', label: 'Weekly off', tone: 'cancelled' },
];
/* Where a day came from: the reader, a phone, a person, an approved request, leave. */
const SOURCE = { DEVICE: 'Reader', CLOCK: 'Phone or web', MANUAL: 'By hand', REQUEST: 'Correction', LEAVE: 'Leave', IMPORT: 'Import', DEFAULT: 'Rule' };

const COLUMNS = {
  department: (r) => r.department || '',
  source: (r) => SOURCE[r.source] || r.source || '',
  date: (r) => r.date,
  employee: (r) => r.employeeName,
  status: (r) => STATUS[r.status]?.label || r.status,
  validated: (r) => (r.validated ? 'Validated' : 'Not validated'),
  trust: (r) => TRUST[r.trust]?.label || 'Not worked out',
};
const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'employeeCode', label: 'Employee ID' },
  { key: 'employeeName', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'checkInTime', label: 'In' },
  { key: 'checkOutTime', label: 'Out' },
  { key: 'workedMinutes', label: 'Worked (h:mm)', value: (r) => hm(r.workedMinutes) },
  { key: 'lateMinutes', label: 'Late (min)' },
  { key: 'earlyOutMinutes', label: 'Early out (min)' },
  { key: 'overtimeMinutes', label: 'Overtime (min)' },
  { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label || r.status },
  { key: 'validated', label: 'Validated', value: (r) => (r.validated ? 'Yes' : 'No') },
  { key: 'source', label: 'Source', value: (r) => SOURCE[r.source] || r.source || '' },
];
/* Reader trust (O-11), only while the company has it on. */
const TRUST_EXPORT = [
  { key: 'trust', label: 'Trust', value: (r) => TRUST[r.trust]?.label || '' },
  { key: 'trustReasons', label: 'Why', value: (r) => (Array.isArray(r.trustReasons) ? r.trustReasons.map((x) => x.text).join(' ') : '') },
];

export default function AttendanceRecords({ params, openScreen } = {}) {
  /* Opened from a report row or an exception: start on that person and those days. */
  const [filters, setFilters] = useState(() => ({ from: weekAgo(), to: todayIst(), employeeId: '', validated: '', late: '', trust: '', ...(params || {}), status: '' }));
  const [status, setStatus] = useState(() => params?.status || '');
  const [explaining, setExplaining] = useState(null);
  const [bulk, setBulk] = useState(null);
  const explainLoad = useCallback(() => explainDay(explaining?.employeeId, explaining?.date), [explaining]);
  const [all, setAll] = useState(null);
  /* Whether the company has reader trust on: the server says so with the days. */
  const [readerTrust, setReaderTrust] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const load = useCallback(() => {
    listRecords(filters)
      .then((r) => {
        setAll(r.records || []);
        setReaderTrust(Boolean(r.readerTrust));
        setLoadError('');
        setSelected(new Set());
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load days.')));
  }, [filters]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    listEmployees().then(setPeople).catch(() => setPeople([]));
  }, []);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const r of all || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'date']);
  const columns = useColumnFilters();
  const rows = columns.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useResetPage(setPage, [status, search.query, filters]);

  const figures = useMemo(() => {
    const list = all || [];
    return {
      present: list.filter((r) => r.status === 'PRESENT').length,
      late: list.filter((r) => r.lateMinutes > 0).length,
      absent: list.filter((r) => r.status === 'ABSENT').length,
      open: list.filter((r) => r.checkIn && !r.checkOut).length,
      overtime: list.filter((r) => r.overtimeMinutes > 0 && !r.overtimeApproved).length,
    };
  }, [all]);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /* Only closed days not yet validated can be validated; the rest of a selection is for bulk changes. */
  const validatable = useMemo(() => (all || []).filter((r) => selected.has(r.id) && !r.validated && r.checkOut).map((r) => r.id), [all, selected]);

  const validate = async () => {
    try {
      const r = await validateDays(validatable);
      notify.success(`${r.validated} days validated.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not validated.'));
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const onlyPerson = filters.employeeId ? people.find((p) => p.id === filters.employeeId) : null;

  return (
    <DocumentListShell
      entity="attendance"
      title="Attendance records"
      description="Mark, correct and validate days. A corrected day needs validating again."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people or dates…', label: 'Search records' }}
      moreItems={[exportMenuItem('Export days'), ...(readerTrust ? [{ key: 'evidence', label: 'Attendance evidence', Icon: FileSearch }] : []), ...(openScreen ? [{ key: 'import', label: 'Import from a spreadsheet', Icon: Upload }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'import') return openScreen('dataImport', { kind: 'records' });
        if (k === 'evidence') return setEvidenceOpen(true);
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Attendance', subtitle: `${filters.from} to ${filters.to}`, fileName: `Attendance ${filters.from} to ${filters.to}`, label: 'day/days', columns: readerTrust ? [...EXPORT_COLUMNS, ...TRUST_EXPORT] : EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ date: todayIst(), checkIn: '', checkOut: '', status: '' })}>
          <Plus size={16} aria-hidden="true" /> Mark attendance
        </button>
      }
      cards={[
        { label: 'Present', value: figures.present, count: true, tone: 'paid', Icon: CalendarCheck },
        { label: 'Late', value: figures.late, count: true, tone: 'partial', Icon: AlarmClock, onSelect: () => setFilters((f) => ({ ...f, late: f.late === 'true' ? '' : 'true' })) },
        { label: 'Absent', value: figures.absent, count: true, tone: 'overdue', Icon: UserX, onSelect: () => setStatus('ABSENT') },
        { label: 'No punch out', value: figures.open, count: true, tone: 'outstanding', Icon: Wand2 },
        { label: 'Overtime to approve', value: figures.overtime, count: true, tone: 'sent', Icon: Timer },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Day status"
      phoneCompact
      tabsExtras={
        <>
          {onlyPerson ? (
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setFilters((f) => ({ ...f, employeeId: '' }))} aria-label={`Show everyone, not only ${onlyPerson.name}`}>
              {onlyPerson.name} <X size={14} aria-hidden="true" />
            </button>
          ) : null}
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.from} max={filters.to} onChange={set('from')} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.to} max={todayIst()} onChange={set('to')} aria-label="To" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={filters.late === 'true'} onChange={(e) => setFilters((f) => ({ ...f, late: e.target.checked ? 'true' : '' }))} /> Late only
          </label>
          {readerTrust ? (
            <select className="ui-select ui-ctl-compact !w-auto" value={filters.trust || ''} onChange={set('trust')} aria-label="Reader trust">
              <option value="">Any trust</option>
              {Object.entries(TRUST).map(([value, t]) => <option key={value} value={value}>{t.label}</option>)}
            </select>
          ) : null}
        </>
      }
      above={
        selected.size ? (
          <div className="ui-bulkbar" role="region" aria-label="Change the selected days">
            <span className="text-sm"><strong className="tabular-nums">{selected.size}</strong> selected</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!validatable.length} onClick={validate}><CheckCheck size={14} aria-hidden="true" /> Validate {validatable.length || ''}</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBulk({ operation: 'SET_OUT_SHIFT_END' })}><Wand2 size={14} aria-hidden="true" /> Close at shift end</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBulk({ operation: 'APPROVE_OVERTIME' })}>Approve overtime</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBulk({ operation: 'SET_STATUS', status: 'ABSENT' })}>Mark days without times…</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        ) : null
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label="Select every day shown"
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <ColumnHeader label="Day" col="date" state={columns} type="date" />
                  <ColumnHeader label="Employee" col="employee" state={columns}  className="ui-col-grow" />
                  <ColumnHeader label="Department" col="department" state={columns} className="hidden min-[1800px]:table-cell" />
                  <th scope="col" className="ui-col-h-center">In</th>
                  <th scope="col" className="ui-col-h-center">Out</th>
                  <th scope="col" className="ui-num hidden md:table-cell">Worked</th>
                  <th scope="col" className="ui-num hidden md:table-cell">Late</th>
                  <th scope="col" className="ui-num hidden 2xl:table-cell">Early out</th>
                  <th scope="col" className="ui-num hidden md:table-cell">Overtime</th>
                  <ColumnHeader label="Status" col="status" state={columns} align="center" />
                  <ColumnHeader label="Source" col="source" state={columns} className="hidden 2xl:table-cell" />
                  <ColumnHeader label="Validated" col="validated" state={columns} align="center" className="hidden 2xl:table-cell" />
                  {readerTrust ? <ColumnHeader label="Trust" col="trust" state={columns} align="center" /> : null}
                  <th scope="col" className="w-10"><span className="sr-only">Explain</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={readerTrust ? 15 : 14}>
                      {all.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length || all.length} title="No days match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={CalendarCheck}
                          title="No days in this range"
                          description="Mark, correct and validate days here. A corrected day needs validating again. Widen the dates, or mark attendance."
                          routes={[{ label: 'Mark attendance', description: 'One person, one day, with the times.', onSelect: () => setEditing({ date: todayIst(), checkIn: '', checkOut: '', status: '' }) }]}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id} className="ui-row-click" onClick={() => setEditing({ ...r, checkIn: r.checkInTime || '', checkOut: r.checkOutTime || '', status: r.checkIn ? '' : r.status })}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="ui-checkbox" aria-label={`Select ${r.employeeName} ${r.date}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <td className="ui-col-date whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}{r.shiftLabel ? <span className="ui-caption block">{r.shiftLabel}</span> : null}</td>
                      <td className="ui-col-entity">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                      <td className="hidden min-[1800px]:table-cell">{r.department || <span className="ui-caption">—</span>}</td>
                      <td className="ui-col-h-center">{r.checkInTime || '—'}</td>
                      <td className="ui-col-h-center">{r.checkOutTime || '—'}</td>
                      <td className="ui-num hidden md:table-cell">{r.checkOut ? hm(r.workedMinutes) : '—'}</td>
                      <td className="ui-num hidden md:table-cell">{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</td>
                      <td className="ui-num hidden 2xl:table-cell">{r.earlyOutMinutes ? `${r.earlyOutMinutes}m` : '—'}</td>
                      <td className="ui-num hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                        {r.overtimeMinutes ? (
                          <span className="inline-flex items-center justify-end gap-2">
                          <span>{hm(r.overtimeMinutes)}</span>
                          <button
                            type="button"
                            className={`ui-btn ui-btn-sm ${r.overtimeApproved ? 'ui-btn-ghost' : 'ui-btn-secondary'}`}
                            aria-label={r.overtimeApproved ? `Overtime ${hm(r.overtimeMinutes)} approved; withdraw approval` : `Approve ${hm(r.overtimeMinutes)} overtime`}
                            title={r.overtimeApproved ? 'Approved: counts in the month summary. Click to withdraw.' : 'Not approved yet: does not count in the month summary.'}
                            onClick={async () => {
                              try {
                                await approveOvertime(r.id, !r.overtimeApproved);
                                load();
                              } catch (e) {
                                notify.error(String(e?.message || 'Not saved.'));
                              }
                            }}
                          >
                            {r.overtimeApproved ? 'Approved' : 'Approve'}
                          </button>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="ui-col-h-center"><span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                      <td className="ui-col-meta hidden 2xl:table-cell">{SOURCE[r.source] || r.source || '—'}</td>
                      <td className="ui-col-h-center hidden 2xl:table-cell">{r.validated ? <span className="ui-pill ui-pill-pos">Validated</span> : <span className="ui-caption">—</span>}</td>
                      {readerTrust ? (
                        <td className="ui-col-h-center" title={Array.isArray(r.trustReasons) ? r.trustReasons.map((x) => x.text).join(' ') : ''}>
                          {TRUST[r.trust] ? <span className={`ui-pill ${TRUST[r.trust].pill}`}>{TRUST[r.trust].label}</span> : <span className="ui-caption">—</span>}
                        </td>
                      ) : null}
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="ui-icon-btn" aria-label={`Why is ${r.employeeName} ${STATUS[r.status]?.label?.toLowerCase() || r.status} on ${r.date}?`} title="Why does this day say this?" onClick={() => setExplaining(r)}>
                          <HelpCircle size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="days" />
        </>
      )}

      {editing ? <MarkDay initial={editing} people={people} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
      <DayExplain
        open={Boolean(explaining)}
        onClose={() => setExplaining(null)}
        load={explainLoad}
        actions={
          explaining ? (
            <>
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => downloadEvidence(explaining.employeeId, `${explaining.date.slice(0, 7)}-01`, monthEnd(explaining.date))}>
                <FileSpreadsheet size={16} aria-hidden="true" /> Evidence for the month
              </button>
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => { const r = explaining; setExplaining(null); setEditing({ ...r, checkIn: r.checkInTime || '', checkOut: r.checkOutTime || '', status: r.checkIn ? '' : r.status }); }}>
                Correct this day
              </button>
            </>
          ) : null
        }
      />
      {evidenceOpen ? <PunchEvidence open onClose={() => setEvidenceOpen(false)} people={people} initial={{ employeeId: filters.employeeId, from: filters.from, to: filters.to }} /> : null}
      {bulk ? <BulkChange spec={bulk} ids={[...selected]} onClose={() => setBulk(null)} onDone={() => { setBulk(null); load(); }} /> : null}
    </DocumentListShell>
  );
}

const monthEnd = (date) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const OPERATION = {
  SET_OUT_SHIFT_END: { title: 'Close the days at the end of their shift', hint: 'For days with a check-in and no check-out (a reader that lost exits). Each day is scored again from its shift.' },
  APPROVE_OVERTIME: { title: 'Approve the overtime on these days', hint: 'Approved overtime counts in the month summary and payroll.' },
  SET_STATUS: { title: 'Mark days that have no times', hint: 'For days with no check-in. A day with times keeps them; correct those one by one.' },
};
const FIELD = { status: 'Status', in: 'In', out: 'Out', workedMinutes: 'Worked', lateMinutes: 'Late', earlyOutMinutes: 'Early out', overtimeMinutes: 'Overtime', overtimeApproved: 'Overtime approved', validated: 'Validated', source: 'Set by' };
const fmt = (field, v) => (v == null ? '—' : field === 'status' ? STATUS[v]?.label || v : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : /Minutes$/.test(field) ? hm(v) : String(v));

/** Many days at once: the server's preview first, then the same change applied with a reason kept in each day's history. */
function BulkChange({ spec, ids, onClose, onDone }) {
  const [status, setStatus] = useState(spec.status || 'ABSENT');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const op = OPERATION[spec.operation];
  useEffect(() => {
    let off = false;
    setPreview(null);
    setError('');
    bulkChangeDays({ ids, operation: spec.operation, status: spec.operation === 'SET_STATUS' ? status : undefined, reason: 'Preview', preview: true })
      .then((r) => !off && setPreview(r))
      .catch((e) => !off && setError(String(e?.message || 'Could not preview.')));
    return () => { off = true; };
  }, [ids, spec.operation, status]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await bulkChangeDays({ ids, operation: spec.operation, status: spec.operation === 'SET_STATUS' ? status : undefined, reason, preview: false });
      if (r.failed) notify.error(`${r.applied} changed, ${r.failed} not: ${r.results[0]?.error || ''}`);
      else notify.success(`${r.applied} day${r.applied === 1 ? '' : 's'} changed.`);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={op.title}
      description={op.hint}
      widthClass="w-[min(46rem,96vw)]"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !preview?.ready || reason.trim().length < 3} onClick={apply}>
            {busy ? 'Applying…' : `Change ${preview?.ready || 0} day${preview?.ready === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {spec.operation === 'SET_STATUS' ? (
          <label className="block">
            <span className="ui-label">Mark them as</span>
            <select className="ui-select w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ABSENT">Absent</option>

              <option value="HOLIDAY">Holiday</option>
              <option value="WEEKLY_OFF">Weekly off</option>
              <option value="PRESENT">Present</option>
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="ui-label">Why (kept in each day&rsquo;s history) *</span>
          <input className="ui-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Gate B reader lost exits on 14 Oct" />
        </label>
        {error ? <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {!preview && !error ? <SkeletonCard lines={4} /> : null}
        {preview ? (
          <>
            <p className="text-sm"><strong>{preview.ready}</strong> will change{preview.skipped ? <>, <strong>{preview.skipped}</strong> will be left as they are</> : null}.</p>
            <div className="ui-card overflow-hidden">
              <div className="overflow-x-auto ui-table-scroll">
                <table className="ui-table w-full">
                  <thead><tr><th className="ui-th">Day</th><th className="ui-th">Employee</th><th className="ui-th">What changes</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">{r.date ? dayLabel(r.date, { weekday: true, year: false }) : '—'}</td>
                        <td>{r.name}</td>
                        <td className="text-sm">
                          {r.ok
                            ? r.changes.filter((c) => FIELD[c.field]).map((c) => <span key={c.field} className="mr-3 whitespace-nowrap">{FIELD[c.field]} <s className="ui-caption">{fmt(c.field, c.before)}</s> → <strong>{fmt(c.field, c.after)}</strong></span>)
                            : <span className="ui-caption">Left as is: {r.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

function MarkDay({ initial, people, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...initial }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await markDay({
        employeeId: form.employeeId,
        date: form.date,
        checkIn: form.checkIn || null,
        checkOut: form.checkOut || null,
        status: form.checkIn ? null : form.status || 'ABSENT',
        note: form.note || null,
      });
      notify.success('Day saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: 'Delete this day?', message: 'The day goes back to unmarked.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteDay(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? `${form.employeeName} · ${form.date}` : 'Mark attendance'}
      description={form.shiftLabel ? `${form.shiftLabel}. Times are 24-hour, Indian Standard Time; a time after midnight is that night's.` : 'Times are 24-hour, Indian Standard Time. An out earlier than the in is the next morning.'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="mark-day" className="ui-btn ui-btn-primary" disabled={saving || !form.employeeId || !form.date}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="mark-day" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {form.id ? null : (
          <label className="block sm:col-span-2">
            <span className="ui-label">Employee *</span>
            <select className="ui-select w-full" required value={form.employeeId || ''} onChange={set('employeeId')}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="ui-label">Day *</span><input type="date" className="ui-input w-full" required max={todayIst()} value={form.date} onChange={set('date')} disabled={Boolean(form.id)} /></label>
        <span />
        <label className="block"><span className="ui-label">In</span><input type="time" className="ui-input w-full" value={form.checkIn} onChange={set('checkIn')} /></label>
        <label className="block"><span className="ui-label">Out</span><input type="time" className="ui-input w-full" value={form.checkOut} onChange={set('checkOut')} disabled={!form.checkIn} /></label>
        {!form.checkIn ? (
          <label className="block sm:col-span-2">
            <span className="ui-label">No times — mark as</span>
            <select className="ui-select w-full" value={form.status || 'ABSENT'} onChange={set('status')}>
              <option value="ABSENT">Absent</option>

              <option value="HOLIDAY">Holiday</option>
              <option value="WEEKLY_OFF">Weekly off</option>
            </select>
          </label>
        ) : null}
        <label className="block sm:col-span-2"><span className="ui-label">Note</span><input className="ui-input w-full" value={form.note || ''} onChange={set('note')} /></label>
      </form>
    </Drawer>
  );
}

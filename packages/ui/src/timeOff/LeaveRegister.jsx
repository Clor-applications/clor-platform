import React, { useMemo, useRef, useState } from 'react';
import { Printer } from '@ui/components/ui/lineIcons';

import { useListSearch } from '@ui/components/ListToolbar';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { MoreButton, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { TablePager } from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import Drawer from '@ui/components/ui/Drawer';
import { formatDate } from '@ui/components/ui/DatePicker';
import { printElement } from '@ui/utils/printElement';
import { colorOf, getLeaveRegister, getLeaveRegisterBook, getLeaveSettings, listLeaveTypes, periodChoices } from './api';
import { activeApp, homeCrumbs } from './shared';

/* People files the register under Reports, so its crumbs say so; Attendance keeps it under Time & Leave. */
const reportCrumbs = () => (activeApp() === 'people' ? [{ label: 'People' }, { label: 'Reports' }] : homeCrumbs());

/**
 * Time & Leave → Leave register (founder, 22 Oct 2026): for one leave
 * period, each person's leave of each type — what they started with, what
 * was credited on the policy's dates, what HR changed, took and paid out,
 * what is waiting, what lapsed at the end and what is left. Worked out from
 * the policy and the requests, so it is always current and nobody runs it.
 * A register, not a server-paged list: the totals row needs every row, so the
 * table is drawn here rather than by DataTable, in DataTable's own classes.
 */
const COLS = [
  ['opening', 'Opening'],
  ['credited', 'Credited'],
  ['changed', 'Changed'],
  ['taken', 'Taken'],
  ['encashed', 'Paid out'],
  ['pending', 'Waiting'],
  ['lapsed', 'Lapsed'],
  ['closing', 'Left'],
];
const num = (v) => (v == null ? '—' : v);

export default function LeaveRegister() {
  const settings = useRequest(() => getLeaveSettings(), []);
  const [picked, setPicked] = useState(null);
  const year = picked ?? settings.data?.current?.year ?? null;
  const [typeId, setTypeId] = useState('');
  /* Every type for the picker: the register itself answers with the chosen one only. */
  const allTypes = useRequest(() => listLeaveTypes().catch(() => []), []);
  const req = useRequest(() => (year ? getLeaveRegister({ year, leaveTypeId: typeId }) : Promise.resolve(undefined)), [year, typeId]);
  const data = req.data;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [printing, setPrinting] = useState(false);

  const cols = useMemo(() => COLS.filter(([k]) => k !== 'lapsed' || data?.ended), [data]);
  const search = useListSearch(data?.rows || [], ['name', 'code', 'department', 'leaveType']);
  useResetPage(setPage, [search.query, size, year, typeId]);
  const { pageRows, safePage } = usePaged(search.filtered, size, page);
  const totals = useMemo(() => Object.fromEntries(cols.map(([k]) => [k, Math.round(search.filtered.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100])), [cols, search.filtered]);
  const typeColor = useMemo(() => new Map((data?.types || []).map((t) => [t.id, colorOf(t)])), [data]);
  const label = data?.period?.label || '';
  const periodOptions = settings.data ? periodChoices(settings.data).map((c) => ({ value: String(c.year), label: c.label })) : [];
  const typeOptions = [{ value: '', label: 'Every type' }, ...(allTypes.data || []).map((t) => ({ value: t.id, label: t.name }))];

  const exportColumns = [
    { key: 'name', label: 'Employee' }, { key: 'code', label: 'Employee ID' }, { key: 'department', label: 'Department' }, { key: 'leaveType', label: 'Leave type' },
    ...cols.map(([key, l]) => ({ key, label: l })),
  ];
  const onMore = (k) => {
    const format = exportFormatFromKey(k);
    if (format) runListExport({ format, title: `Leave register, ${label}`, fileName: `leave-register-${year}`, label: 'Rows', rows: search.filtered.map((r) => Object.fromEntries(exportColumns.map((c) => [c.key, r[c.key] ?? '']))), columns: exportColumns });
  };

  const error = settings.error || req.error;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={reportCrumbs()}
        title="Leave register"
        actions={data?.rows?.length ? (
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setPrinting(true)}><Printer size={16} aria-hidden="true" /> Print register</button>
            <MoreButton items={[exportMenuItem('Export the register')]} onSelect={onMore} />
          </div>
        ) : null}
      />
      {error && !data ? <ErrorState error={error} onRetry={() => { settings.reload(); req.reload(); }} /> : !data ? <SkeletonCard lines={6} /> : (
        <div className="ui-datatable" aria-busy={req.refreshing || undefined}>
          <div className="ui-datatable-toolbar">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <SearchField value={search.query} onSearch={search.setQuery} placeholder="Search name, department or type" label="Search the register" className="w-full sm:w-80" />
              {periodOptions.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave period" value={String(year || '')} onChange={(v) => v && setPicked(Number(v))} options={periodOptions} /></div> : null}
              {typeOptions.length > 2 || typeId ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Leave type" value={typeId} onChange={(v) => setTypeId(v || '')} options={typeOptions} placeholder="Every type" /></div> : null}
            </div>
          </div>
          {!search.filtered.length ? (
            search.query ? <EmptyState kind="filtered" title="Nothing matches" onClearFilters={() => search.setQuery('')} /> : <EmptyState title="Nothing in this period" />
          ) : (
            <>
              <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full" aria-label={`Leave register, ${label}`}>
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Leave</th>
                      {cols.map(([k, l]) => <th key={k} scope="col" className="text-right ui-num">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody className="ui-rows">
                    {pageRows.map((r) => (
                      <tr key={`${r.employeeId}-${r.leaveTypeId}`}>
                        <td><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{[r.code, r.department].filter(Boolean).join(' · ')}</span></td>
                        <td><span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: typeColor.get(r.leaveTypeId) }} aria-hidden="true" />{r.leaveType}</span></td>
                        {cols.map(([k]) => <td key={k} className={`text-right tabular-nums ${k === 'closing' && r[k] < 0 ? 'ui-text-neg' : ''}`}>{num(r[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2} className="text-left font-medium">Total, <span className="tabular-nums">{search.filtered.length}</span> rows</th>
                      {cols.map(([k]) => <td key={k} className="text-right tabular-nums font-medium">{totals[k]}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <TablePager total={search.filtered.length} page={safePage} pageSize={size} onPage={setPage} onPageSize={setSize} noun="rows" />
            </>
          )}
        </div>
      )}
      {printing && year ? <PrintBook year={year} label={label} people={[...new Map((data?.rows || []).map((r) => [r.employeeId, r.name]))]} onClose={() => setPrinting(false)} /> : null}
    </div>
  );
}

const span = (r) => (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`);
const dash = (v) => (v == null ? '—' : v);

/**
 * The register as an inspector asks for it (TIME-LEAVE-MARKET-RESEARCH.md G2): one worker to a page, for the period,
 * with the days worked, and for each leave type the opening balance, leave earned, leave availed with its dates,
 * leave refused with its dates, paid out, lapsed and the closing balance, and a signature line. The columns follow
 * OSH (Central) Rules 2026 Form XX and Factories Rules Form 15 as secondary sources describe them, so the page says
 * "format based on". A printed document: black on white, whatever the theme (index.css, .leave-book).
 */
function PrintBook({ year, label, people, onClose }) {
  const [who, setWho] = useState('');
  const req = useRequest(() => getLeaveRegisterBook({ year, employeeId: who }), [year, who]);
  const sheet = useRef(null);
  const data = req.data;
  const print = () => printElement({ element: sheet.current, title: `Leave register, ${label}`, page: { orientation: 'landscape' } });
  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(64rem,96vw)] ui-drawer-sheet"
      title="Print register"
      description={label}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={!data?.workers?.length} onClick={print}><Printer size={16} aria-hidden="true" /> Print</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="w-full sm:w-64">
          <PopupSelect showValueSubtext={false} label="Worker" value={who} onChange={(v) => setWho(v || '')} placeholder="Everyone" options={[{ value: '', label: 'Everyone' }, ...people.map(([value, name]) => ({ value, label: name }))]} />
        </div>
        {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : !data ? <SkeletonCard lines={6} /> : !data.workers.length ? <EmptyState title="Nobody in this period" /> : (
          <div ref={sheet} className="leave-book rounded-xl border p-6" style={{ borderColor: 'rgb(var(--border))' }} aria-label={`Leave register, ${label}`}>
            {data.workers.map((w) => (
              <section key={w.employeeId} className="leave-book-worker">
                <h2>Register of leave with wages, {label}</h2>
                <dl>
                  <dt>Name</dt><dd>{w.name}</dd>
                  <dt>Employee ID</dt><dd>{w.code || '—'}</dd>
                  <dt>Department</dt><dd>{[w.department, w.designation].filter(Boolean).join(', ') || '—'}</dd>
                  <dt>Joined</dt><dd>{w.dateOfJoining ? formatDate(w.dateOfJoining) : '—'}{w.dateOfLeaving ? `; left ${formatDate(w.dateOfLeaving)}` : ''}</dd>
                  <dt>Days worked</dt>
                  <dd className="tabular-nums">{w.daysWorked ? `${w.daysWorked.worked} (with paid leave ${w.daysWorked.withPaidLeave})` : '—'}</dd>
                  <dt>Counted from</dt><dd>{w.daysWorked?.source === 'RECORD' ? 'The attendance record' : 'Working days less leave (no attendance record)'}</dd>
                </dl>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Leave</th>
                      <th scope="col" className="num">Opening</th>
                      <th scope="col" className="num">Earned</th>
                      <th scope="col" className="num">Changed</th>
                      <th scope="col">Availed, dates</th>
                      <th scope="col" className="num">Availed</th>
                      <th scope="col">Refused, dates</th>
                      <th scope="col" className="num">Refused</th>
                      <th scope="col" className="num">Paid out</th>
                      <th scope="col" className="num">Lapsed</th>
                      <th scope="col" className="num">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.leave.length ? w.leave.map((l) => (
                      <tr key={l.leaveTypeId}>
                        <td>{l.leaveType}{l.code ? ` (${l.code})` : ''}{l.isPaid ? '' : ', unpaid'}</td>
                        <td className="num">{dash(l.opening)}</td>
                        <td className="num">{dash(l.earned)}</td>
                        <td className="num">{dash(l.changed)}</td>
                        <td>{l.availed.length ? l.availed.map((r) => <span key={`${r.from}${r.to}`} className="block whitespace-nowrap">{span(r)}: <span className="tabular-nums">{r.days}</span></span>) : '—'}</td>
                        <td className="num">{l.availedDays}</td>
                        <td>{l.refused.length ? l.refused.map((r) => <span key={`${r.from}${r.to}`} className="block whitespace-nowrap">{span(r)}: <span className="tabular-nums">{r.days}</span></span>) : '—'}</td>
                        <td className="num">{l.refusedDays}</td>
                        <td className="num">{dash(l.encashed)}</td>
                        <td className="num">{data.ended ? dash(l.lapsed) : '—'}</td>
                        <td className="num">{dash(l.closing)}</td>
                      </tr>
                    )) : <tr><td colSpan={11}>No leave in this period.</td></tr>}
                  </tbody>
                </table>
                <div className="sign">
                  <span>Signature or thumb impression of the worker</span>
                  <span>Signature of the employer or manager</span>
                </div>
                <p className="basis">{data.format} (secondary sources, not the gazetted form). Check your state’s prescribed form; keep the register five years.</p>
              </section>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

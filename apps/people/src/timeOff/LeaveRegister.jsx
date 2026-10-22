import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { colorOf, getLeaveRegister, getLeaveSettings, periodChoices } from './api';

/**
 * People → Leave → Leave Register (founder, 22 Oct 2026): for one leave
 * period, each person's leave of each type — what they started with, what
 * was credited on the policy's dates, what HR changed, took and paid out,
 * what is waiting, what lapsed at the end and what is left. Worked out from
 * the policy and the applications, so it is always current and nobody runs it.
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
  const [settings, setSettings] = useState(null);
  const [year, setYear] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  useEffect(() => {
    getLeaveSettings().then((s) => { setSettings(s); setYear(s.current.year); }).catch((e) => setError(String(e?.message || 'Could not load the leave period.')));
  }, []);
  const load = useCallback(() => {
    if (!year) return;
    getLeaveRegister({ year, leaveTypeId: typeId }).then((r) => { setData(r); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load the register.')));
  }, [year, typeId]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(() => COLS.filter(([k]) => k !== 'lapsed' || data?.ended), [data]);
  const search = useListSearch(data?.rows || [], ['name', 'code', 'department', 'leaveType']);
  useResetPage(setPage, [search.query, perPage, year, typeId]);
  const { pageRows, safePage, pageCount } = usePaged(search.filtered, perPage, page);
  const totals = useMemo(() => Object.fromEntries(cols.map(([k]) => [k, Math.round(search.filtered.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100])), [cols, search.filtered]);
  const typeColor = useMemo(() => new Map((data?.types || []).map((t) => [t.id, colorOf(t)])), [data]);
  const label = data?.period?.label || '';

  const exportColumns = [
    { key: 'name', label: 'Employee' }, { key: 'code', label: 'Code' }, { key: 'department', label: 'Department' }, { key: 'leaveType', label: 'Leave type' },
    ...cols.map(([key, l]) => ({ key, label: l })),
  ];

  return (
    <DocumentListShell
      entity="leave"
      title="Leave Register"
      description="Each person’s leave for the period: opening, credited on the policy’s dates, changed, taken, paid out, waiting and left."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search person, department or type…', label: 'Search the register' }}
      headerExtras={
        <div className="flex flex-nowrap items-center gap-2">
          <select className="ui-select" value={year || ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Leave period">
            {periodChoices(settings).map((c) => <option key={c.year} value={c.year}>{c.label}</option>)}
          </select>
          <select className="ui-select" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Leave type">
            <option value="">Every type</option>
            {(data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      }
      moreItems={[exportMenuItem('Export the register')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: `Leave register, ${label}`, fileName: `leave-register-${year}`, label: 'Rows', rows: search.filtered.map((r) => Object.fromEntries(exportColumns.map((c) => [c.key, r[c.key] ?? '']))), columns: exportColumns });
      }}
    >
      {error ? <p role="alert" className="p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !search.filtered.length ? (
        <EmptyState title="Nothing in this period" description="Leave types and the people employed in the period appear here as soon as there are any." />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Leave</th>
                  {cols.map(([k, l]) => <th key={k} scope="col" className="ui-num">{l}</th>)}
                </tr>
              </thead>
              <tbody className="ui-rows">
                {pageRows.map((r) => (
                  <tr key={`${r.employeeId}-${r.leaveTypeId}`}>
                    <td className="ui-col-entity">{r.name}<span className="ui-caption block">{[r.code, r.department].filter(Boolean).join(', ')}</span></td>
                    <td><span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: typeColor.get(r.leaveTypeId) }} aria-hidden="true" />{r.leaveType}</span></td>
                    {cols.map(([k]) => <td key={k} className={`ui-num ${k === 'closing' ? 'font-medium' : ''} ${k === 'closing' && r[k] < 0 ? 'text-[rgb(var(--neg))]' : ''}`}>{num(r[k])}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="text-left">Total, {search.filtered.length} rows</th>
                  {cols.map(([k]) => <td key={k} className="ui-num font-medium">{totals[k]}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <Pagination total={search.filtered.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} />
        </>
      )}
    </DocumentListShell>
  );
}

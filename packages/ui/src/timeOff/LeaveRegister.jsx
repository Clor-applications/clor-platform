import React, { useMemo, useState } from 'react';

import { useListSearch } from '@ui/components/ListToolbar';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { MoreButton, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { TablePager } from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { colorOf, getLeaveRegister, getLeaveSettings, listLeaveTypes, periodChoices } from './api';
import { homeCrumbs } from './shared';

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
        breadcrumb={homeCrumbs()}
        title="Leave register"
        actions={data?.rows?.length ? <MoreButton items={[exportMenuItem('Export the register')]} onSelect={onMore} /> : null}
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
    </div>
  );
}

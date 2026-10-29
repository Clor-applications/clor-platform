import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { listAllEmployees } from '@ui/personnel/api';
const fields = ['name', 'code', 'department', 'designation', 'status', 'dateOfJoining', 'dateOfLeaving'];
const labels = ['Employee', 'Code', 'Department', 'Designation', 'Status', 'Joined', 'Left'];
const STATUS_LABEL = { ACTIVE: 'Active', ON_NOTICE: 'On notice', LEFT: 'Left', SUSPENDED: 'Suspended' };
const cell = (r, f) => (f === 'status' ? STATUS_LABEL[r.status] || r.status : r[f]) || '—';
export default function PeopleReports() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const load = useCallback(() => listAllEmployees().then((r) => { setRows(r.employees); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const inTab = useMemo(() => (rows || []).filter((r) => !status || r.status === status), [rows, status]);
  const search = useListSearch(inTab, fields);
  const columns = useColumnFilters();
  const shown = columns.applyFilters(search.filtered, Object.fromEntries(fields.map((k) => [k, (r) => r[k] || ''])));
  useResetPage(setPage, [status, search.query, columns.filters, perPage]);
  const { pageRows, safePage, pageCount } = usePaged(shown, perPage, page);
  if (!rows && !error) return <SkeletonCard lines={6} />;
  return <DocumentListShell title="People report" entity="people" tight description="Current employee records. Filter and export the rows you see; historical headcount is not inferred from today's status."
    search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search workforce…' }}
    tabs={['', 'ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'].map((s) => ({ value: s, label: s ? STATUS_LABEL[s] : 'All', tone: 'all' }))} statusValue={status} onStatusChange={setStatus} statusCounts={Object.fromEntries(['', 'ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'].map((s) => [s, (rows || []).filter((r) => !s || r.status === s).length]))}
    moreItems={[exportMenuItem('Export workforce report')]} onMoreSelect={(k) => { const format = exportFormatFromKey(k); if (format) runListExport({ format, title: 'Workforce report', fileName: 'workforce-report', label: 'Employees', rows: shown, columns: fields.map((k, i) => ({ key: k, label: labels[i] })) }); }}>
    {error ? <div role="alert" className="p-4">{error}<button className="ui-btn ml-3" onClick={load}>Retry</button></div> : <><div className="ui-table-scroll"><table className="ui-table w-full"><thead><tr>{fields.map((f, i) => <ColumnHeader key={f} label={labels[i]} col={f} state={columns} />)}</tr></thead><tbody>{pageRows.map((r) => <tr key={r.id}>{fields.map((f) => <td key={f}>{cell(r, f)}</td>)}</tr>)}{!shown.length && <tr><td colSpan={7}><EmptyState title="No matching employees" description="Add employees or change the report filters." /></td></tr>}</tbody></table></div><Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} /></>}
  </DocumentListShell>;
}

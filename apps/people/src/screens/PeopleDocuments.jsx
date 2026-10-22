import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { listCompanyDocuments, listEmployees, getDocument } from '@ui/personnel/api';
import { EmployeeDocuments } from '@ui/personnel/Employees';
const COLUMNS = [{ key: 'title', label: 'Document' }, { key: 'employeeName', label: 'Employee' }, { key: 'kind', label: 'Type' }, { key: 'expiresOn', label: 'Valid until' }];
export default function PeopleDocuments() {
  const [data, setData] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const load = useCallback(() => {
    Promise.all([listCompanyDocuments(), listEmployees()])
      .then(([docs, people]) => { setData(docs); setEmployees(people.employees); setError(''); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  const inTab = useMemo(() => (data || []).filter((r) => !status || (r.expiresOn && r.expiresOn < today ? 'expired' : 'valid') === status), [data, status, today]);
  const search = useListSearch(inTab, ['title', 'employeeName', 'employeeCode', 'kind']);
  const columns = useColumnFilters();
  const shown = columns.applyFilters(search.filtered, Object.fromEntries(COLUMNS.map(({ key }) => [key, (r) => r[key] || ''])));
  useResetPage(setPage, [status, search.query, columns.filters, perPage]);
  const { pageRows, safePage, pageCount } = usePaged(shown, perPage, page);
  const download = async (r) => {
    try { const d = await getDocument(r.id); const a = document.createElement('a'); a.href = d.dataUrl; a.download = r.title; a.click(); } catch (e) { notify.error(e.message); }
  };
  const close = () => { setOpened(false); load(); };
  if (!data && !error) return <SkeletonCard lines={6} />;
  return <DocumentListShell title="Documents" entity="people" description="Employee files, expiry dates, and visibility. Upload or manage documents against an employee."
    search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search documents…' }}
    primary={<button className="ui-btn ui-btn-primary" onClick={() => { setEmployeeId(''); setOpened(true); }}><Plus size={16} /> New document</button>}
    tabs={[{ value: '', label: 'All', tone: 'all' }, { value: 'valid', label: 'Current', tone: 'paid' }, { value: 'expired', label: 'Expired', tone: 'overdue' }]} statusValue={status} onStatusChange={setStatus} statusCounts={{ '': data?.length || 0, valid: (data || []).filter((r) => !r.expiresOn || r.expiresOn >= today).length, expired: (data || []).filter((r) => r.expiresOn && r.expiresOn < today).length }}
    moreItems={[exportMenuItem('Export document register')]} onMoreSelect={(key) => { const format = exportFormatFromKey(key); if (format) runListExport({ format, title: 'Documents', fileName: 'document-register', label: 'Documents', rows: shown, columns: COLUMNS }); }}>
    {error ? <div className="p-4" role="alert">{error}<button className="ui-btn ml-3" onClick={load}>Retry</button></div> : <><div className="ui-table-scroll"><table className="ui-table w-full"><thead><tr>{COLUMNS.map((c) => <ColumnHeader key={c.key} label={c.label} col={c.key} state={columns} />)}<th scope="col">Visibility</th><th scope="col">Actions</th></tr></thead><tbody>{pageRows.map((r) => <tr key={r.id}><td><button className="ui-link" onClick={() => { setEmployeeId(r.employeeId); setOpened(true); }}>{r.title}</button></td><td>{r.employeeName}</td><td>{r.kind.replaceAll('_', ' ').toLowerCase()}</td><td>{r.expiresOn || 'No expiry'}</td><td>{r.visibleToEmployee ? 'Employee & HR' : 'HR only'}</td><td><button className="ui-link" onClick={() => download(r)}>Download</button></td></tr>)}{!shown.length && <tr><td colSpan={6}><EmptyState title="No matching documents" description="Upload an employee document or change your filters." /></td></tr>}</tbody></table></div><Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} /></>}
    <Drawer title="Employee documents" open={opened} onClose={close} widthClass="w-[min(44rem,96vw)]"><label className="block mb-4"><span className="ui-label">Employee</span><select className="ui-select w-full" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Select employee</option>{employees.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}</select></label>{employeeId && <EmployeeDocuments key={employeeId} employeeId={employeeId} />}{!employees.length && <p className="ui-muted">Add an employee first, then upload their documents here.</p>}</Drawer>
  </DocumentListShell>;
}

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
import { listCompanyDocuments, listAllEmployees, getDocument } from '@ui/personnel/api';
import { EmployeeDocuments } from '@ui/personnel/Employees';
import { docWhoLabel } from '@ui/personnel/documentClassification';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { formatDate } from '@ui/components/ui/DatePicker';
const COLUMNS = [{ key: 'title', label: 'Document' }, { key: 'employeeName', label: 'Employee' }, { key: 'kind', label: 'Type' }, { key: 'expiresOn', label: 'Valid until' }];
/* A type as words ("work permit"), capitalised; an expiry as a date, with Expired or Expires soon beside it so it is not colour alone. */
const kindWord = (k) => { const w = String(k || '').replaceAll('_', ' ').toLowerCase(); return w ? w[0].toUpperCase() + w.slice(1) : '—'; };
const SOON_DAYS = 30;
function Expiry({ on, today }) {
  if (!on) return <span className="ui-muted">No expiry</span>;
  const days = Math.round((Date.parse(on) - Date.parse(today)) / 86_400_000);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{formatDate(on)}</span>
      {days < 0 ? <span className="ui-pill ui-pill-neg">Expired</span> : days <= SOON_DAYS ? <span className="ui-pill ui-pill-warn">Expires in {days} {days === 1 ? 'day' : 'days'}</span> : null}
    </span>
  );
}

export default function PeopleDocuments({ openScreen }) {
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
    Promise.all([listCompanyDocuments(), listAllEmployees()])
      .then(([docs, people]) => { setData(docs); setEmployees(people.employees); setError(''); })
      .catch((e) => setError(e));
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
  return <DocumentListShell title="Documents" entity="people" tight
    search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search documents…' }}
    primary={<button className="ui-btn ui-btn-primary" onClick={() => { setEmployeeId(''); setOpened(true); }}><Plus size={16} /> New document</button>}
    tabs={[{ value: '', label: 'All', tone: 'all' }, { value: 'valid', label: 'Current', tone: 'paid' }, { value: 'expired', label: 'Expired', tone: 'overdue' }]} statusValue={status} onStatusChange={setStatus} statusCounts={{ '': data?.length || 0, valid: (data || []).filter((r) => !r.expiresOn || r.expiresOn >= today).length, expired: (data || []).filter((r) => r.expiresOn && r.expiresOn < today).length }}
    moreItems={[exportMenuItem('Export document register')]} onMoreSelect={(key) => { const format = exportFormatFromKey(key); if (format) runListExport({ format, title: 'Documents', fileName: 'document-register', label: 'Documents', rows: shown, columns: COLUMNS }); }}>
    {error ? <ErrorState error={error} onRetry={load} /> : <><div className="ui-table-scroll"><table className="ui-table w-full"><thead><tr>{COLUMNS.map((c) => <ColumnHeader key={c.key} label={c.label} col={c.key} state={columns} />)}<th scope="col">Who can see</th><th scope="col">Actions</th></tr></thead><tbody>{pageRows.map((r) => <tr key={r.id}><td><button className="ui-link" onClick={() => { setEmployeeId(r.employeeId); setOpened(true); }}>{r.title}</button></td><td>{r.employeeId ? <button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: r.employeeId, tab: 'documents' })}>{r.employeeName}</button> : r.employeeName}</td><td>{kindWord(r.kind)}</td><td><Expiry on={r.expiresOn} today={today} /></td><td>{docWhoLabel(r)}</td><td><button className="ui-link" onClick={() => download(r)}>Download</button></td></tr>)}{!shown.length && <tr><td colSpan={6}><EmptyState title="No matching documents" description="Upload an employee document or change your filters." /></td></tr>}</tbody></table></div><Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} /></>}
    <Drawer title="Employee documents" open={opened} onClose={close} widthClass="w-[min(44rem,96vw)]"><div className="mb-4"><PopupSelect showValueSubtext={false} alwaysSearch label="Employee" value={employeeId} onChange={(v) => setEmployeeId(v || '')} placeholder="Choose an employee" options={employees.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))} /></div>{employeeId && <EmployeeDocuments key={employeeId} employeeId={employeeId} />}{!employees.length && <p className="ui-muted">Add an employee first, then upload their documents here.</p>}</Drawer>
  </DocumentListShell>;
}

import React, { useMemo, useState } from 'react';
import { CalendarClock20Color, DismissCircle20Color, DocumentText20Color, PeopleCommunity20Color } from '@fluentui/react-icons';
import { Download, Plus } from '@ui/components/ui/lineIcons';
import { KpiTiles } from '../components/Core';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { notify } from '@ui/components/ui/notify';
import { runListExport } from '@ui/components/list/exportMenu';
import { listCompanyDocuments, listAllEmployees, getDocument } from '@ui/personnel/api';
import { Avatar, EmployeeDocuments } from '@ui/personnel/Employees';
import { docWhoLabel } from '@ui/personnel/documentClassification';
import { todayIst } from '@ui/utils/dates';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/permissions/can';

/**
 * Documents: every document on every person's file, with its expiry, in one
 * Workforce list. Tabs for current and expired; a document opens the
 * person's documents in a drawer, where new ones are added.
 */
const EXPORT_COLUMNS = [{ key: 'title', label: 'Document' }, { key: 'employeeName', label: 'Employee' }, { key: 'kind', label: 'Type' }, { key: 'expiresOn', label: 'Valid until' }];
/* A type as words ("work permit"), capitalised; an expiry as a date, with Expired or Expires soon beside it so it is not colour alone. */
const kindWord = (k) => { const w = String(k || '').replaceAll('_', ' ').toLowerCase(); return w ? w[0].toUpperCase() + w.slice(1) : '—'; };
const SOON_DAYS = 30;
const daysTo = (on, today) => Math.round((Date.parse(on) - Date.parse(today)) / 86_400_000);
/* Where a document stands, always as a word in its pill (status colour never alone). */
function DocStatus({ on, today }) {
  if (!on) return <span className="ui-pill ui-pill-neutral">No expiry</span>;
  const days = daysTo(on, today);
  if (days < 0) return <span className="ui-pill ui-pill-neg">Expired</span>;
  if (days <= SOON_DAYS) return <span className="ui-pill ui-pill-warn">{days === 0 ? 'Expires today' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}`}</span>;
  return <span className="ui-pill ui-pill-pos">Valid</span>;
}

export default function PeopleDocuments({ openScreen }) {
  const req = useRequest(() => Promise.all([listCompanyDocuments(), listAllEmployees().then((r) => r?.employees || [])]), []);
  const [docs, employees] = req.data || [[], []];
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [drawer, setDrawer] = useState(null);
  /* A reader who may not add files (a view-only manager) is not offered New document; the server refuses it anyway. */
  const mayAdd = can(usePermissions(), 'PEOPLE::Documents::CREATE');
  const today = todayIst();
  const expired = (r) => Boolean(r.expiresOn && r.expiresOn < today);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs
      .filter((r) => tab === 'all' || (tab === 'expired' ? expired(r) : !expired(r)))
      .filter((r) => !kind || r.kind === kind)
      .filter((r) => !needle || [r.title, r.employeeName, r.employeeCode, kindWord(r.kind)].some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [docs, tab, q, kind, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { all: docs.length, valid: docs.filter((r) => !expired(r)).length, expired: docs.filter(expired).length };
  const soon = docs.filter((r) => r.expiresOn && !expired(r) && daysTo(r.expiresOn, today) <= SOON_DAYS).length;
  const people = new Set(docs.map((r) => r.employeeId).filter(Boolean)).size;
  const shared = docs.filter((r) => r.visibleToEmployee).length;
  const kinds = [...new Set(docs.map((r) => r.kind).filter(Boolean))].sort();
  const download = async (r) => {
    try { const d = await getDocument(r.id); const a = document.createElement('a'); a.href = d.dataUrl; a.download = r.title; a.click(); } catch (e) { notify.error(String(e?.message || 'Could not download.')); }
  };
  /* PEOPLE-06: the person first, then the document, its category, when it was added, when it runs out and where it stands. */
  const columns = [
    { key: 'employee', label: 'Employee', render: (r) => (r.employeeName ? <span className="pc-who"><Avatar person={{ name: r.employeeName }} size={32} /><span className="pc-who-text"><span className="pc-who-name">{r.employeeName}</span>{r.employeeCode ? <span className="pc-who-sub">{r.employeeCode}</span> : null}</span></span> : '—') },
    { key: 'title', label: 'Document', always: true, render: (r) => <span className="font-semibold">{r.title}</span> },
    { key: 'kind', label: 'Category', render: (r) => kindWord(r.kind) },
    { key: 'added', label: 'Added', align: 'right', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.createdAt ? formatDate(String(r.createdAt).slice(0, 10)) : '—'}</span> },
    { key: 'expires', label: 'Expires', align: 'right', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.expiresOn ? formatDate(r.expiresOn) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <DocStatus on={r.expiresOn} today={today} /> },
    { key: 'who', label: 'Who can see', render: (r) => docWhoLabel(r) },
  ];
  const rowActions = (r) => [
    { key: 'open', label: 'Open their documents', onSelect: () => setDrawer({ employeeId: r.employeeId || '' }) },
    { key: 'download', label: 'Download', onSelect: () => download(r) },
    r.employeeId ? { key: 'record', label: 'Open their record', onSelect: () => openScreen?.('employee', { id: r.employeeId, tab: 'documents' }) } : null,
  ];
  return (
    <div className="space-y-6">
      <ListHeader
        title="Documents"
        description="Every document on people's records, with who may see it and when it runs out."
        strip={req.data && docs.length ? (
          <KpiTiles label="Documents at a glance" items={[
            { key: 'docs', label: 'Documents', cat: 1, Icon: DocumentText20Color, value: docs.length.toLocaleString('en-IN'), note: `Across ${people} ${people === 1 ? 'person' : 'people'}` },
            { key: 'soon', label: `Expiring in ${SOON_DAYS} days`, cat: 4, Icon: CalendarClock20Color, value: soon, tone: 'warn', note: soon ? 'Renew before they run out' : 'Nothing runs out soon' },
            { key: 'expired', label: 'Expired', cat: 8, Icon: DismissCircle20Color, value: counts.expired, tone: 'neg', note: counts.expired ? 'Action needed' : 'None', onClick: counts.expired ? () => setTab('expired') : undefined },
            { key: 'shared', label: 'Shared with employees', cat: 3, Icon: PeopleCommunity20Color, value: shared, note: 'They see these in the employee app' },
          ]} />
        ) : null}
        secondary={<button type="button" className="ui-btn ui-btn-secondary" disabled={!shown.length} onClick={() => runListExport({ format: 'csv', title: 'Documents', fileName: 'document-register', label: 'Documents', rows: shown, columns: EXPORT_COLUMNS })}><Download size={16} aria-hidden="true" /> Export</button>}
        primary={mayAdd ? { label: 'Upload', icon: Plus, onClick: () => setDrawer({ employeeId: '' }) } : null}
        toolbar={<>
          <SearchField value={q} onSearch={setQ} placeholder="Search employee or document" label="Search documents" className="w-full sm:w-80" />
          {kinds.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Category" icon={null} placeholder="Category: All" value={kind} onChange={(v) => setKind(v || '')} options={[{ value: '', label: 'Category: All' }, ...kinds.map((k) => ({ value: k, label: kindWord(k) }))]} /></div> : null}
        </>}
        tabs={[{ key: 'all', label: 'All', count: counts.all }, { key: 'valid', label: 'Current', count: counts.valid }, { key: 'expired', label: 'Expired', count: counts.expired }]}
        tab={tab}
        onTab={setTab}
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Documents" columns={columns} rows={shown} loading={req.loading} refreshing={req.refreshing}
          total={shown.length} pageSize={Math.max(25, shown.length)} noun="documents"
          onRowClick={(r) => setDrawer({ employeeId: r.employeeId || '' })} rowActions={rowActions}
          card={(r) => <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span><span className="block truncate ui-caption">{[r.employeeName, kindWord(r.kind), r.expiresOn ? `until ${formatDate(r.expiresOn)}` : null].filter(Boolean).join(' · ')}</span></span>}
          empty={q || kind || tab !== 'all'
            ? <EmptyState kind="filtered" title="No documents match" description="Nothing here matches the search or the tab." />
            : <EmptyState title="No documents yet" description="Documents added on a person's record, or here, are listed with who may see them and their expiry." routes={mayAdd ? [{ label: 'New document', onSelect: () => setDrawer({ employeeId: '' }) }] : []} />} />
      )}
      {drawer ? (
        <Drawer open title="Employee documents" onClose={() => { setDrawer(null); req.reload(); }} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet">
          <div className="space-y-4">
            {employees.length ? <PopupSelect showValueSubtext={false} alwaysSearch label="Employee" value={drawer.employeeId} onChange={(v) => setDrawer({ employeeId: v || '' })} placeholder="Choose an employee" options={employees.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))} /> : <p className="ui-muted text-sm">Add an employee first, then their documents here.</p>}
            {drawer.employeeId ? <EmployeeDocuments key={drawer.employeeId} employeeId={drawer.employeeId} /> : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

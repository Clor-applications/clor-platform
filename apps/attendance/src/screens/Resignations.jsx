import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarX, Plus, UserCheck, UserMinus, UserX } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { LEAVING_TYPES, listEmployees, rehireEmployee, resignEmployee } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const TONE = { RESIGNED: 'sent', TERMINATED: 'overdue', RETIRED: 'paid', ABSCONDED: 'outstanding', CONTRACT_ENDED: 'cancelled', DECEASED: 'cancelled' };
const TABS = [{ value: '', label: 'All', tone: 'all' }, ...Object.entries(LEAVING_TYPES).map(([value, label]) => ({ value, label, tone: TONE[value] || 'cancelled' }))];
const COLUMNS = {
  employee: (p) => p.name,
  department: (p) => p.department,
  joined: (p) => p.dateOfJoining,
  left: (p) => p.dateOfLeaving,
  note: (p) => p.leavingReason,
};

/**
 * People who have left, and recording someone leaving (ClorTime's
 * Resignations). Leaving takes them off every reader at once; rehiring puts
 * them back.
 */
export default function Resignations() {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [active, setActive] = useState([]);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const load = useCallback(() => {
    listEmployees({ status: 'LEFT', limit: 500 })
      .then((r) => {
        setAll((r?.employees || []).sort((a, b) => String(b.dateOfLeaving || '').localeCompare(String(a.dateOfLeaving || ''))));
        setLoadError('');
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load.')));
    listEmployees({ status: 'ACTIVE', limit: 500 }).then((r) => setActive(r?.employees || [])).catch(() => setActive([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const r of all || []) c[r.leavingType] = (c[r.leavingType] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.leavingType === status), [all, status]);
  const search = useListSearch(inTab, ['name', 'code', 'department', 'leavingReason', 'dateOfLeaving']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useEffect(() => setPage(1), [status, search.query]);

  const figures = useMemo(() => {
    const today = todayIst();
    const list = all || [];
    return {
      total: list.length,
      month: list.filter((p) => String(p.dateOfLeaving || '').slice(0, 7) === today.slice(0, 7)).length,
      year: list.filter((p) => String(p.dateOfLeaving || '').slice(0, 4) === today.slice(0, 4)).length,
      absconded: counts.ABSCONDED || 0,
    };
  }, [all, counts]);

  const rehire = async (p) => {
    if (!(await confirmDialog({ title: `Rehire ${p.name}?`, message: 'Active again and back on every reader. They enrol fingerprints and face again.', confirmLabel: 'Rehire', tone: 'primary' }))) return;
    try {
      await rehireEmployee(p.id);
      notify.success(`${p.name} is back.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not rehired.'));
    }
  };

  return (
    <DocumentListShell
      entity="employee"
      title="Resignations"
      description="Who has left and why. Recording someone leaving removes them from every reader."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people who left…', label: 'Search resignations' }}
      primary={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Record leaving</button>}
      cards={[
        { label: 'Left', value: figures.total, count: true, tone: 'all', Icon: UserMinus },
        { label: 'This month', value: figures.month, count: true, tone: 'sent', Icon: CalendarDays },
        { label: 'This year', value: figures.year, count: true, tone: 'cancelled', Icon: CalendarX },
        { label: 'Absconded', value: figures.absconded, count: true, tone: 'outstanding', Icon: UserX, onSelect: () => setStatus('ABSCONDED') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Why they left"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Department" col="department" state={filters} />
                  <ColumnHeader label="Joined" col="joined" state={filters} type="date" />
                  <ColumnHeader label="Last day" col="left" state={filters} type="date" />
                  <th scope="col">Why</th>
                  <ColumnHeader label="Note" col="note" state={filters} />
                  <th scope="col"><span className="sr-only">Rehire</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={7}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="Nobody matches" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={UserMinus}
                          title={status ? `Nobody ${String(LEAVING_TYPES[status] || '').toLowerCase()}` : 'Nobody has left'}
                          description={status ? 'Try another tab.' : 'People who leave are listed here, with the reason.'}
                          routes={status ? undefined : [{ label: 'Record leaving', description: 'People who leave are listed here, with the reason.', onSelect: () => setAdding(true) }]}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((p) => (
                    <tr key={p.id}>
                      <td className="ui-col-entity">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</td>
                      <td>{p.department || '—'}</td>
                      <td className="ui-col-date whitespace-nowrap">{p.dateOfJoining || '—'}</td>
                      <td className="ui-col-date whitespace-nowrap">{p.dateOfLeaving || '—'}</td>
                      <td>{LEAVING_TYPES[p.leavingType] || '—'}</td>
                      <td className="max-w-[16rem] truncate" title={p.leavingReason || ''}>{p.leavingReason || '—'}</td>
                      <td className="ui-col-meta text-end"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Rehire ${p.name}`} onClick={() => rehire(p)}><UserCheck size={14} aria-hidden="true" /> Rehire</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="people" />
        </>
      )}
      {adding ? <RecordLeaving people={active} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
    </DocumentListShell>
  );
}

function RecordLeaving({ people, onClose, onSaved }) {
  const [form, setForm] = useState({ employeeId: '', lastDay: todayIst(), leavingType: 'RESIGNED', reason: '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await resignEmployee(form.employeeId, { lastDay: form.lastDay, leavingType: form.leavingType, reason: form.reason || null });
      notify.success(r.readers ? `Recorded, and removed from ${r.readers} reader${r.readers === 1 ? '' : 's'}.` : 'Recorded.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title="Record leaving"
      description="From the day after the last day they are not expected at work."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leaving-form" className="ui-btn ui-btn-primary" disabled={saving || !form.employeeId}>{saving ? 'Saving…' : 'Record'}</button>
        </>
      }
    >
      <form id="leaving-form" onSubmit={save} className="grid gap-4">
        <label className="block">
          <span className="ui-label">Employee *</span>
          <select className="ui-select w-full" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Last working day *</span><input type="date" className="ui-input w-full" required value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} /></label>
        <label className="block">
          <span className="ui-label">Why</span>
          <select className="ui-select w-full" value={form.leavingType} onChange={(e) => setForm({ ...form, leavingType: e.target.value })}>
            {Object.entries(LEAVING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Note</span><input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

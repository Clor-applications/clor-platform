import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeAlert, HardHat, Plus, Upload, UserCheck, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createContractor, deleteContractor, listContractors, updateContractor } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

const BLANK = { name: '', code: '', contactPerson: '', phone: '', email: '', gstin: '', licenceNo: '', licenceValidTo: '', address: '', isActive: true };

const TABS = [
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];
const kind = (c) => (c.isActive ? 'ACTIVE' : 'INACTIVE');
const COLUMNS = {
  name: (c) => c.name,
  contact: (c) => [c.contactPerson, c.phone].filter(Boolean).join(' · '),
  licence: (c) => c.licenceNo,
};

/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Contractor' },
  { key: 'code', label: 'Code' },
  { key: 'contactPerson', label: 'Contact person' },
  { key: 'phone', label: 'Phone' },
  { key: 'licenceNo', label: 'Licence' },
  { key: 'licenceValidTo', label: 'Licence valid to' },
  { key: 'workers', label: 'Workers' },
  { key: 'presentToday', label: 'In today' },
  { key: 'isActive', label: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No') },
];

/**
 * Companies that supply workers (ClorTime's Contractors). Their people are
 * employees linked to the contractor — enrolled, punched and counted like
 * everyone else — so the workforce present today is one look away.
 */
export default function Contractors({ openScreen } = {}) {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('ACTIVE');
  const load = useCallback(() => {
    listContractors().then((v) => { setAll(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load contractors.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const r of all || []) c[kind(r)] = (c[kind(r)] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || kind(r) === status), [all, status]);
  const search = useListSearch(inTab, ['name', 'code', 'contactPerson', 'phone', 'licenceNo']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  const figures = useMemo(() => {
    const list = (all || []).filter((c) => c.isActive);
    return {
      active: list.length,
      workers: list.reduce((a, c) => a + Number(c.workers || 0), 0),
      present: list.reduce((a, c) => a + Number(c.presentToday || 0), 0),
      expired: (all || []).filter((c) => c.licenceExpired).length,
    };
  }, [all]);

  const add = () => setEditing({ ...BLANK });

  return (
    <DocumentListShell
      entity="employee"
      title="Contractors"
      moreItems={[exportMenuItem('Export'), ...(openScreen ? [{ key: 'import', label: 'Import from a spreadsheet', Icon: Upload }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'import') return openScreen('dataImport', { kind: 'contractors' });
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Contractors', fileName: 'Contractors', label: 'contractor/contractors', columns: EXPORT_COLUMNS, rows: rows });
      }}
      description="Companies that supply workers. Link a worker to their contractor on their employee file."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search contractors…', label: 'Search contractors' }}
      primary={<button type="button" className="ui-btn ui-btn-primary" onClick={add}><Plus size={16} aria-hidden="true" /> New contractor</button>}
      cards={[
        { label: 'Active', value: figures.active, count: true, tone: 'all', Icon: HardHat },
        { label: 'Workers', value: figures.workers, count: true, tone: 'sent', Icon: Users },
        { label: 'In today', value: figures.present, count: true, tone: 'paid', Icon: UserCheck },
        { label: 'Licence expired', value: figures.expired, count: true, tone: 'overdue', Icon: BadgeAlert },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Contractor status"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Contractor" col="name" state={filters}  className="ui-col-grow" />
                <ColumnHeader label="Contact" col="contact" state={filters} />
                <ColumnHeader label="Licence" col="licence" state={filters} />
                <th scope="col" className="ui-num">Workers</th>
                <th scope="col" className="ui-num">In today</th>
                <th scope="col" className="ui-col-h-center">Active</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No contractors match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={HardHat}
                        title={status === 'INACTIVE' ? 'No inactive contractors' : 'No contractors'}
                        description={status === 'INACTIVE' ? 'Try another tab.' : 'Add the agencies and labour contractors who supply people.'}
                        routes={status === 'INACTIVE' ? undefined : [{ label: 'New contractor', description: 'Add the agencies and labour contractors who supply people.', onSelect: add }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="ui-row-click" onClick={() => setEditing({ ...BLANK, ...c })}>
                    <td className="ui-col-entity">{c.name}{c.code ? <span className="ui-caption"> · {c.code}</span> : null}</td>
                    <td>{[c.contactPerson, c.phone].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="whitespace-nowrap">
                      {c.licenceNo || '—'}
                      {c.licenceValidTo ? (
                        <span className={`ui-pill ml-2 ${c.licenceExpired ? 'ui-pill-neg' : 'ui-pill-neutral'}`}>{c.licenceExpired ? 'expired' : 'valid to'} {c.licenceValidTo}</span>
                      ) : null}
                    </td>
                    <td className="ui-num">{c.workers}</td>
                    <td className="ui-num">{c.presentToday}</td>
                    <td className="ui-col-h-center">{c.isActive ? '✓' : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <ContractorForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </DocumentListShell>
  );
}

function ContractorForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = Object.fromEntries(Object.keys({ ...initial, ...form }).filter((k) => k in initial && !['id', 'workers', 'presentToday', 'licenceExpired', 'accountId', 'orgId', 'createdAt', 'updatedAt', 'createdByUserId'].includes(k)).map((k) => [k, form[k] === '' ? null : form[k]]));
    try {
      if (form.id) await updateContractor(form.id, body);
      else await createContractor(body);
      notify.success('Contractor saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a contractor with no workers linked can be deleted.', confirmLabel: 'Delete' }))) return;
    try {
      await deleteContractor(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };
  const field = (k, label, props = {}) => (
    <label className="block"><span className="ui-label">{label}</span><input className="ui-input w-full" value={form[k] || ''} onChange={set(k)} {...props} /></label>
  );
  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? form.name : 'New contractor'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="contractor-form" className="ui-btn ui-btn-primary" disabled={saving || !form.name?.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="contractor-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field('name', 'Name *', { required: true, maxLength: 150 })}</div>
        {field('code', 'Code', { maxLength: 30 })}
        {field('gstin', 'GSTIN', { maxLength: 20 })}
        {field('contactPerson', 'Contact person')}
        {field('phone', 'Phone', { type: 'tel' })}
        {field('email', 'Email', { type: 'email' })}
        <span />
        {field('licenceNo', 'Contract Labour licence no.')}
        {field('licenceValidTo', 'Licence valid to', { type: 'date' })}
        <label className="block sm:col-span-2"><span className="ui-label">Address</span><textarea className="ui-input w-full" rows={2} value={form.address || ''} onChange={set('address')} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={form.isActive !== false} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
        </label>
      </form>
    </Drawer>
  );
}

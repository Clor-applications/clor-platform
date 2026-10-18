import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createContractor, deleteContractor, listContractors, updateContractor } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

const BLANK = { name: '', code: '', contactPerson: '', phone: '', email: '', gstin: '', licenceNo: '', licenceValidTo: '', address: '', isActive: true };

/**
 * Companies that supply workers (ClorTime's Contractors). Their people are
 * employees linked to the contractor — enrolled, punched and counted like
 * everyone else — so the workforce present today is one look away.
 */
export default function Contractors() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    listContractors().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load contractors.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Contractors"
        description="Companies that supply workers. Link a worker to their contractor on their employee file."
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ ...BLANK })}><Plus size={16} aria-hidden="true" /> New contractor</button>}
      />
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No contractors" description="Add the agencies and labour contractors who supply people." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Contractor</th>
                  <th scope="col" className="ui-th">Contact</th>
                  <th scope="col" className="ui-th">Licence</th>
                  <th scope="col" className="ui-th text-end">Workers</th>
                  <th scope="col" className="ui-th text-end">In today</th>
                  <th scope="col" className="ui-th ui-col-h-center">Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="ui-row-click" onClick={() => setEditing({ ...BLANK, ...c })}>
                    <td className="ui-col-entity">{c.name}{c.code ? <span className="ui-caption"> · {c.code}</span> : null}</td>
                    <td className="ui-col-meta">{[c.contactPerson, c.phone].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="whitespace-nowrap">
                      {c.licenceNo || '—'}
                      {c.licenceValidTo ? (
                        <span className={`ui-pill ml-2 ${c.licenceExpired ? 'ui-pill-neg' : 'ui-pill-neutral'}`}>{c.licenceExpired ? 'expired' : 'valid to'} {c.licenceValidTo}</span>
                      ) : null}
                    </td>
                    <td className="text-end tabular-nums">{c.workers}</td>
                    <td className="text-end tabular-nums">{c.presentToday}</td>
                    <td className="ui-col-h-center">{c.isActive ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing ? <ContractorForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
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

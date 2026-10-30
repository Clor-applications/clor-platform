import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from '@ui/components/ui/lineIcons';

import { EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';
import { createForm, listForms, switchOnTemplate, updateForm } from '../api/requests';
import { structure } from '../workforce/api';

/*
 * Request types (FEATURE-UI-AUDIT gap 25): requests HR sets up for the
 * company — an ID card, a salary certificate, an asset — each a short form,
 * who may ask, who approves and within how many working days. Employees ask
 * from the employee app and from My requests; the requests wait in the one
 * Approvals inbox. A form for a small business, not a workflow designer: the
 * steps can be refined on Approval rules, like any other kind.
 */

const FIELD_TYPES = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'CHOICE', label: 'One of a list' },
  { value: 'FILE', label: 'File (picture or PDF)' },
];
const APPROVER_WORDS = { MANAGER: 'Their manager', HR: 'HR', MANAGER_HR: 'Their manager, then HR', CUSTOM: 'Set on Approval rules' };
const APPROVER_OPTIONS = ['MANAGER', 'HR', 'MANAGER_HR'].map((value) => ({ value, label: APPROVER_WORDS[value] }));
const blankField = () => ({ label: '', type: 'TEXT', required: false, options: '' });
const BLANK = { name: '', description: '', fields: [{ ...blankField(), required: true }], audience: 'EVERYONE', departmentIds: [], approver: 'HR', slaDays: '', active: true };
const LABEL_IDEAS = ['Reason', 'Why', 'Needed by', 'Amount, ₹', 'Addressed to', 'Purpose', 'Anything else', 'Photo', 'Quote or picture'];

const toForm = (f) => ({
  id: f.id, name: f.name, description: f.description || '', audience: f.audience, departmentIds: f.departmentIds || [], approver: f.approver || 'HR', slaDays: f.slaDays ?? '', active: f.active,
  fields: (f.fields || []).map((x) => ({ key: x.key, label: x.label, type: x.type, required: Boolean(x.required), options: (x.options || []).join('\n') })),
});
const toBody = (form) => ({
  name: form.name.trim(), description: form.description.trim() || null, audience: form.audience, departmentIds: form.audience === 'DEPARTMENTS' ? form.departmentIds : [],
  approver: form.approver === 'CUSTOM' ? undefined : form.approver, slaDays: form.slaDays === '' ? null : Number(form.slaDays), active: form.active,
  fields: form.fields.map((x) => ({ ...(x.key ? { key: x.key } : {}), label: x.label.trim(), type: x.type, required: x.required, ...(x.type === 'CHOICE' ? { options: x.options.split(/\n|,/).map((o) => o.trim()).filter(Boolean) } : {}) })),
});

export default function RequestForms() {
  const perms = usePermissions();
  const canEdit = can(perms, 'PEOPLE::Approvals::EDIT');
  const req = useRequest(() => Promise.all([listForms(), structure('departments').catch(() => [])]), []);
  const [data, departments] = req.data || [null, []];
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const forms = data?.forms || [];
  const offTemplates = (data?.templates || []).filter((t) => !t.on);

  const switchOn = async (t) => {
    setBusy(t.key);
    try {
      const f = await switchOnTemplate(t.key);
      notify.success(`${f.name} is open for requests.`);
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not switched on.'));
    } finally {
      setBusy('');
    }
  };

  const deptNames = (ids) => ids.map((id) => departments.find((d) => d.id === id)?.name).filter(Boolean);
  const columns = [
    { key: 'name', label: 'Request', always: true, render: (f) => <span className="font-medium">{f.name}</span> },
    { key: 'fields', label: 'Fields', align: 'right', render: (f) => <span className="tabular-nums">{f.fields.length}</span> },
    { key: 'who', label: 'Who may ask', render: (f) => (f.audience === 'DEPARTMENTS' ? deptNames(f.departmentIds).join(', ') || 'Some departments' : 'Everyone') },
    { key: 'approver', label: 'Approved by', render: (f) => APPROVER_WORDS[f.approver] || '—' },
    { key: 'sla', label: 'Within', render: (f) => <span className="tabular-nums">{f.slaDays || 2} working days</span> },
    { key: 'requests', label: 'Waiting', align: 'right', render: (f) => <span className="tabular-nums">{f.open}</span> },
    { key: 'status', label: 'Status', render: (f) => <span className={`ui-pill ui-pill-${f.active ? 'pos' : 'neutral'}`}>{f.active ? 'Open' : 'Off'}</span> },
  ];

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Request types"
        actions={canEdit ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ ...BLANK, fields: [{ ...blankField(), required: true }] })}><Plus size={16} aria-hidden="true" /> New request type</button> : null}
      />
      {canEdit && offTemplates.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Ready-made request types">
          <span className="ui-caption">Ready-made</span>
          {offTemplates.map((t) => (
            <button key={t.key} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" title={t.description} disabled={busy === t.key} onClick={() => switchOn(t)}>
              <Plus size={14} aria-hidden="true" /> {t.name}
            </button>
          ))}
        </div>
      ) : null}
      <DataTable
        label="Request types"
        columns={columns}
        rows={forms}
        rowKey={(f) => f.id}
        total={forms.length}
        page={1}
        pageSize={100}
        noun="request types"
        loading={req.loading}
        refreshing={req.refreshing}
        onRowClick={(f) => setEditing(toForm(f))}
        card={(f) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{f.name}</span><span className={`ui-pill ui-pill-${f.active ? 'pos' : 'neutral'}`}>{f.active ? 'Open' : 'Off'}</span></span>
            <span className="block truncate ui-caption">{APPROVER_WORDS[f.approver] || '—'} · {f.open} waiting</span>
          </span>
        )}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState title="No request types yet" description="Switch on a ready-made one above, or make your own: an ID card, a salary certificate, an asset." />}
      />
      {editing ? <FormDrawer start={editing} departments={departments} canEdit={canEdit} taken={forms.filter((f) => f.id !== editing.id).map((f) => f.name.toLowerCase())} ideas={(data?.templates || []).filter((t) => !t.on).map((t) => t.name)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); req.reload(); }} /> : null}
    </div>
  );
}

function FormDrawer({ start, departments, canEdit, taken, ideas, onClose, onSaved }) {
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(start), [form, start]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setField = (i, patch) => setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const move = (i, d) => setForm((f) => {
    const list = [...f.fields];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    return { ...f, fields: list };
  });
  const nameTaken = taken.includes(form.name.trim().toLowerCase());
  const problem = !form.name.trim() ? 'Name it.' : nameTaken ? 'Already in the list.' : !form.fields.length ? 'Add a field.' : form.fields.some((x) => !x.label.trim()) ? 'Every field needs a name.' : form.fields.some((x) => x.type === 'CHOICE' && x.options.split(/\n|,/).filter((o) => o.trim()).length < 2) ? 'A list needs at least two options.' : form.audience === 'DEPARTMENTS' && !form.departmentIds.length ? 'Choose the departments, or let everyone ask.' : '';

  const save = async (e) => {
    e.preventDefault();
    if (problem || saving) return;
    setSaving(true);
    setError('');
    try {
      if (form.id) await updateForm(form.id, toBody(form));
      else await createForm(toBody(form));
      notify.success(form.id ? 'Saved.' : `${form.name.trim()} is open for requests.`);
      onSaved();
    } catch (err) {
      setError(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onClose={onClose} dirty={canEdit && dirty} title={form.id ? start.name : 'New request type'} widthClass="w-[min(40rem,96vw)] ui-drawer-sheet"
      footer={canEdit ? (
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="request-form" className="ui-btn ui-btn-primary" disabled={saving || !dirty || Boolean(problem)} title={problem || undefined}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      ) : null}
    >
      <form id="request-form" onSubmit={save}>
        <fieldset disabled={!canEdit} className="ui-form-grid">
          {error ? <p className="sm:col-span-2 text-sm ui-text-neg" role="alert">{error}</p> : null}
          <label className="block sm:col-span-2">
            <span className="ui-label">Name *</span>
            <SuggestInput required maxLength={60} value={form.name} onChange={set('name')} suggestions={form.id ? [] : ideas} aria-invalid={nameTaken || undefined} />
            {nameTaken ? <span className="ui-caption ui-text-neg">Already in the list.</span> : null}
          </label>
          <label className="block sm:col-span-2">
            <span className="ui-label">What it is for</span>
            <SuggestInput maxLength={300} value={form.description} onChange={set('description')} suggestions={[]} />
          </label>

          <section className="sm:col-span-2 space-y-3 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Fields">
            <h3 className="ui-t-label">Fields</h3>
            {form.fields.map((x, i) => (
              <div key={i} className="space-y-2 border-b pb-3" style={{ borderColor: 'rgb(var(--border))' }} role="group" aria-label={`Field ${i + 1}`}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_auto]">
                  <label className="block">
                    <span className="ui-label">Field name *</span>
                    <SuggestInput maxLength={60} value={x.label} onChange={(v) => setField(i, { label: v })} suggestions={LABEL_IDEAS} />
                  </label>
                  <div><PopupSelect showValueSubtext={false} label="Kind" value={x.type} onChange={(v) => setField(i, { type: v || 'TEXT' })} options={FIELD_TYPES} /></div>
                  <div className="flex items-end gap-1 pb-0.5">
                    <button type="button" className="ui-icon-btn" aria-label={`Move field ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className="ui-icon-btn" aria-label={`Move field ${i + 1} down`} disabled={i === form.fields.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                    <button type="button" className="ui-icon-btn" aria-label={`Remove field ${i + 1}`} disabled={form.fields.length === 1} onClick={() => setForm((f) => ({ ...f, fields: f.fields.filter((_, j) => j !== i) }))}><X size={16} aria-hidden="true" /></button>
                  </div>
                </div>
                {x.type === 'CHOICE' ? (
                  <label className="block">
                    <span className="ui-label">Options, one a line *</span>
                    <textarea className="ui-input w-full" rows={3} value={x.options} onChange={(e) => setField(i, { options: e.target.value })} />
                  </label>
                ) : null}
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={x.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Must be filled in</label>
              </div>
            ))}
            {form.fields.length < 12 ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setForm((f) => ({ ...f, fields: [...f.fields, blankField()] }))}><Plus size={14} aria-hidden="true" /> Add a field</button> : <p className="ui-caption">Twelve fields at most.</p>}
          </section>

          <section className="sm:col-span-2 space-y-3 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Who asks and who decides">
            <h3 className="ui-t-label">Who asks and who decides</h3>
            <div role="radiogroup" aria-label="Who may ask" className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="audience" checked={form.audience === 'EVERYONE'} onChange={() => set('audience')('EVERYONE')} /> Everyone</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="audience" checked={form.audience === 'DEPARTMENTS'} onChange={() => set('audience')('DEPARTMENTS')} /> Some departments</label>
            </div>
            {form.audience === 'DEPARTMENTS' ? (
              departments.length ? (
                <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Departments">
                  {departments.map((d) => (
                    <label key={d.id} className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.departmentIds.includes(d.id)} onChange={(e) => set('departmentIds')(e.target.checked ? [...form.departmentIds, d.id] : form.departmentIds.filter((x) => x !== d.id))} /> {d.name}
                    </label>
                  ))}
                </div>
              ) : <p className="ui-caption">No departments yet; add them in Organisation.</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <PopupSelect showValueSubtext={false} label="Approved by" value={form.approver} onChange={(v) => set('approver')(v || 'HR')} options={form.approver === 'CUSTOM' ? [{ value: 'CUSTOM', label: APPROVER_WORDS.CUSTOM }, ...APPROVER_OPTIONS] : APPROVER_OPTIONS} />
                {form.approver === 'CUSTOM' ? <span className="ui-caption">Its steps were changed on Approval rules. Choose one here to replace them.</span> : null}
              </div>
              <label className="block">
                <span className="ui-label">Decided within, working days</span>
                <input type="number" inputMode="numeric" min={1} max={30} className="ui-input w-full tabular-nums" placeholder="2" value={form.slaDays} onChange={(e) => set('slaDays')(e.target.value)} />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active')(e.target.checked)} /> Open for requests</label>
          </section>
        </fieldset>
      </form>
    </Drawer>
  );
}

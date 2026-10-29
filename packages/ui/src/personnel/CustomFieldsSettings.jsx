import React, { useState } from 'react';
import { Plus, X } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { getCustomFieldDefs, saveCustomFieldDef } from './api';

/**
 * Custom fields (CORE-08): the company's own fields on a person — text,
 * number, date, choice, yes/no, file — each saying who may see it and who
 * may edit it. A field keeps its key and type; anything else changed is a
 * new version, and each value remembers the version it was saved under.
 * A Workforce list with a drawer; the key is made from the label.
 */
const TYPES = [['TEXT', 'Text'], ['NUMBER', 'Number'], ['DATE', 'Date'], ['CHOICE', 'Choice'], ['BOOLEAN', 'Yes / no'], ['FILE', 'File on the record']];
const GRANTS = [
  ['PEOPLE::Employees::VIEW', 'Anyone who can see the person'],
  ['PEOPLE::Documents::VIEW', 'Anyone who can see documents'],
  ['PEOPLE::Statutory Details::VIEW', 'Statutory details (HR only)'],
  ['PEOPLE::Confidential Documents::VIEW', 'Confidential (HR head)'],
];
const EDIT_GRANTS = [
  ['PEOPLE::Employees::EDIT', 'Anyone who can edit the person'],
  ['PEOPLE::Documents::EDIT', 'Anyone who can edit documents'],
  ['PEOPLE::Statutory Details::EDIT', 'Statutory details (HR only)'],
  ['PEOPLE::Confidential Documents::EDIT', 'Confidential (HR head)'],
];
const opt = (list) => list.map(([value, label]) => ({ value, label }));
const word = (list, k) => list.find(([x]) => x === k)?.[1] || k;
const keyFrom = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
const blank = () => ({ key: '', label: '', type: 'TEXT', options: [], required: false, viewPermission: 'PEOPLE::Employees::VIEW', editPermission: 'PEOPLE::Employees::EDIT', help: '' });

export default function CustomFieldsSettings() {
  const req = useRequest(() => getCustomFieldDefs(true), []);
  const fields = req.data?.fields || [];
  const [draft, setDraft] = useState(null);
  const toggle = async (f) => {
    try {
      await saveCustomFieldDef({ id: f.id, active: !f.active });
      notify.success(f.active ? `${f.label} turned off.` : `${f.label} turned on.`);
      req.reload();
    } catch (err) { notify.error(String(err?.message || 'Not changed.')); }
  };
  const columns = [
    { key: 'label', label: 'Field', always: true, render: (f) => <span className="min-w-0"><span className="block font-medium">{f.label}{f.required ? ' *' : ''}</span><span className="block ui-caption tabular-nums">{f.key}</span></span> },
    { key: 'type', label: 'Type', render: (f) => <span>{word(TYPES, f.type)}{f.type === 'CHOICE' ? <span className="ui-caption"> · {f.options.length} options</span> : null}</span> },
    { key: 'sees', label: 'Who sees', render: (f) => word(GRANTS, f.viewPermission) },
    { key: 'edits', label: 'Who edits', render: (f) => word(EDIT_GRANTS, f.editPermission) },
    { key: 'version', label: 'Version', render: (f) => <span className="tabular-nums">v{f.version}</span> },
    { key: 'on', label: 'In use', render: (f) => (f.active ? 'Yes' : <span className="ui-muted">No</span>) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Custom fields" actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setDraft(blank())}><Plus size={16} aria-hidden="true" /> New field</button>} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Custom fields" columns={columns} rows={fields} loading={req.loading} refreshing={req.refreshing}
          total={fields.length} pageSize={Math.max(25, fields.length)} noun="fields"
          onRowClick={(f) => setDraft({ id: f.id, key: f.key, label: f.label, type: f.type, options: f.options || [], required: f.required, viewPermission: f.viewPermission, editPermission: f.editPermission, help: f.help || '' })}
          rowActions={(f) => [{ key: 'toggle', label: f.active ? 'Turn off' : 'Turn on', onSelect: () => toggle(f) }]}
          card={(f) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{f.label}</span>{f.active ? null : <span className="ui-pill ui-pill-neutral">Off</span>}</span><span className="block truncate ui-caption">{word(TYPES, f.type)} · {word(GRANTS, f.viewPermission)}</span></span>}
          empty={<EmptyState title="No custom fields yet" description="Blood group, uniform size, a background-check flag: anything the employee form does not already ask." />} />
      )}
      {draft ? <FieldDrawer value={draft} taken={fields.map((f) => f.key)} onClose={() => setDraft(null)} onDone={() => { setDraft(null); req.reload(); }} /> : null}
    </div>
  );
}

function FieldDrawer({ value, taken, onClose, onDone }) {
  const isNew = !value.id;
  const [form, setForm] = useState(value);
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [option, setOption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const addOption = () => {
    const v = option.trim();
    if (v && !form.options.includes(v)) set({ options: [...form.options, v] });
    setOption('');
  };
  const save = async () => {
    const problem = !form.label.trim() ? 'Give the field a label.'
      : !/^[a-z][a-z0-9_]{1,39}$/.test(form.key) ? 'The key starts with a letter and uses lower-case letters, digits and underscores.'
        : isNew && taken.includes(form.key) ? `Another field already uses the key ${form.key}.`
          : form.type === 'CHOICE' && form.options.length < 2 ? 'Give a choice at least two options.' : null;
    if (problem) { setError({ message: problem }); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await saveCustomFieldDef({ ...form, label: form.label.trim(), help: form.help.trim(), options: form.type === 'CHOICE' ? form.options : undefined });
      notify.success(`${r.field.label} saved (version ${r.field.version}).`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={isNew ? 'New field' : `Edit ${value.label}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : isNew ? 'Add field' : 'Save as new version'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block"><span className="ui-label">Label *</span><input className="ui-input w-full" maxLength={80} value={form.label} autoFocus onChange={(e) => set({ label: e.target.value, ...(keyTouched ? {} : { key: keyFrom(e.target.value) }) })} placeholder="Blood group" /></label>
        <label className="block"><span className="ui-label">Key *</span><input className="ui-input w-full tabular-nums" maxLength={40} disabled={!isNew} value={form.key} onChange={(e) => { setKeyTouched(true); set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); }} aria-describedby="cf-key" /><span id="cf-key" className="ui-caption">Fixed once the field is made.</span></label>
        <div><PopupSelect showValueSubtext={false} label="Type" value={form.type} disabled={!isNew} onChange={(v) => set({ type: v || 'TEXT' })} options={opt(TYPES)} /></div>
        <label className="flex items-center gap-2 text-sm sm:self-end sm:pb-2"><input type="checkbox" className="ui-checkbox" checked={form.required} onChange={(e) => set({ required: e.target.checked })} />Needed on every person</label>
        {form.type === 'CHOICE' ? (
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="cf-option">Options *</label>
            <div className="flex gap-2">
              <input id="cf-option" className="ui-input w-full" maxLength={80} value={option} onChange={(e) => setOption(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }} placeholder="A+" />
              <button type="button" className="ui-btn ui-btn-secondary" onClick={addOption} disabled={!option.trim()}>Add</button>
            </div>
            {form.options.length ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.options.map((o) => <span key={o} className="ui-pill ui-pill-info inline-flex items-center gap-1">{o}<button type="button" className="ui-icon-btn !h-4 !w-4" aria-label={`Remove ${o}`} onClick={() => set({ options: form.options.filter((x) => x !== o) })}><X size={12} aria-hidden="true" /></button></span>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div><PopupSelect showValueSubtext={false} label="Who may see" value={form.viewPermission} onChange={(v) => set({ viewPermission: v || form.viewPermission })} options={opt(GRANTS)} /></div>
        <div><PopupSelect showValueSubtext={false} label="Who may edit" value={form.editPermission} onChange={(v) => set({ editPermission: v || form.editPermission })} options={opt(EDIT_GRANTS)} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">Help</span><input className="ui-input w-full" maxLength={300} value={form.help} onChange={(e) => set({ help: e.target.value })} placeholder="Shown under the field on the record" /></label>
      </form>
    </Drawer>
  );
}

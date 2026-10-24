import React, { useEffect, useState } from 'react';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getCustomFieldDefs, saveCustomFieldDef } from './api';

/**
 * Custom fields (CORE-08): the company's own fields on a person — text,
 * number, date, choice, yes/no, file — each saying who may see it and who
 * may edit it. A field keeps its key and type; anything else changed is a
 * new version, and each value remembers the version it was saved under.
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
const blank = () => ({ key: '', label: '', type: 'TEXT', options: '', required: false, viewPermission: 'PEOPLE::Employees::VIEW', editPermission: 'PEOPLE::Employees::EDIT', help: '' });

export default function CustomFieldsSettings() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = () => getCustomFieldDefs(true).then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  useEffect(() => { load(); }, []);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...draft, options: draft.type === 'CHOICE' ? String(draft.options || '').split(',').map((s) => s.trim()).filter(Boolean) : undefined };
      const r = await saveCustomFieldDef(body);
      notify.success(`${r.field.label} saved (version ${r.field.version}).`);
      setDraft(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (f) => {
    try {
      await saveCustomFieldDef({ id: f.id, active: !f.active });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not changed.'));
    }
  };
  if (!data) return <SkeletonCard lines={5} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Custom fields" description="Your own details on every person. Each field says who may see it and who may edit it; a field someone may not see is simply not there for them."
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setDraft(blank())}>New field</button>} />
      {!data.fields.length ? <p className="ui-muted text-sm">None yet. Blood group, uniform size, a background-check flag: anything the form does not already ask.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Field</th><th className="py-1.5 font-medium">Key</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Who sees</th><th className="py-1.5 font-medium">Who edits</th><th className="py-1.5 font-medium">Version</th><th className="py-1.5 font-medium">On</th></tr></thead>
          <tbody className="divide-y">
            {data.fields.map((f) => (
              <tr key={f.id}>
                <td className="py-1.5 pr-2"><button type="button" className="ui-link font-medium" onClick={() => setDraft({ id: f.id, key: f.key, label: f.label, type: f.type, options: (f.options || []).join(', '), required: f.required, viewPermission: f.viewPermission, editPermission: f.editPermission, help: f.help || '' })}>{f.label}</button>{f.required ? ' *' : ''}</td>
                <td className="py-1.5 pr-2 font-mono text-xs">{f.key}</td>
                <td className="py-1.5 pr-2">{TYPES.find(([k]) => k === f.type)?.[1] || f.type}{f.type === 'CHOICE' ? <span className="ui-caption"> · {f.options.length} options</span> : null}</td>
                <td className="py-1.5 pr-2">{GRANTS.find(([k]) => k === f.viewPermission)?.[1] || f.viewPermission}</td>
                <td className="py-1.5 pr-2">{EDIT_GRANTS.find(([k]) => k === f.editPermission)?.[1] || f.editPermission}</td>
                <td className="py-1.5 pr-2 tabular-nums">v{f.version}</td>
                <td className="py-1.5"><input type="checkbox" className="ui-checkbox" checked={f.active} onChange={() => toggle(f)} aria-label={`${f.label} on`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft ? (
        <form onSubmit={save} className="ui-card p-3 grid gap-3 sm:grid-cols-2" aria-label={draft.id ? 'Edit field' : 'New field'}>
          <label className="block"><span className="ui-label">Label *</span><input className="ui-input w-full" required maxLength={80} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Key *</span><input className="ui-input w-full font-mono" required pattern="[a-z][a-z0-9_]{1,39}" disabled={Boolean(draft.id)} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="blood_group" /><span className="ui-caption">Lower-case, digits and underscores; never changes once made.</span></label>
          <label className="block"><span className="ui-label">Type</span>
            <select className="ui-select w-full" disabled={Boolean(draft.id)} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          {draft.type === 'CHOICE' ? <label className="block"><span className="ui-label">Options (comma-separated)</span><input className="ui-input w-full" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} placeholder="A+, A-, B+" /></label> : <div />}
          <label className="block"><span className="ui-label">Who may see</span>
            <select className="ui-select w-full" value={draft.viewPermission} onChange={(e) => setDraft({ ...draft, viewPermission: e.target.value })}>{GRANTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="block"><span className="ui-label">Who may edit</span>
            <select className="ui-select w-full" value={draft.editPermission} onChange={(e) => setDraft({ ...draft, editPermission: e.target.value })}>{EDIT_GRANTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="block sm:col-span-2"><span className="ui-label">Help (optional)</span><input className="ui-input w-full" maxLength={300} value={draft.help} onChange={(e) => setDraft({ ...draft, help: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />Needed on every person</label>
          <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save as new version' : 'Add field'}</button></div>
        </form>
      ) : null}
    </div>
  );
}

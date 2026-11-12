import React, { useRef, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getLetterTemplateVersions, getLetterTemplates, saveLetterSettings, saveLetterTemplate } from './api';
import { istDay } from '@ui/utils/dates';

/**
 * Letters the company issues (DOC-04): one template per kind, plain text
 * with {{fields}} from the record and {{extra.name}} fields HR fills in when
 * issuing. Each save is a new version; an issued letter names the version
 * that made it. Until the company writes its own, the built-in one is used.
 * Pick the letter, edit it, Save top right; a field goes in with a click.
 * The company's own appointment, confirmation, increment, relieving and
 * experience letters go out by themselves on the event (People plan 8 Nov
 * 2026, step 6), signed by the person named under Signed by.
 */

export default function LetterTemplates() {
  const req = useRequest(() => getLetterTemplates(), []);
  const [kind, setKind] = useState('APPOINTMENT');
  const data = req.data;
  if (req.error && !data) return <ErrorState error={req.error} onRetry={req.reload} />;
  if (!data) return <SkeletonCard lines={6} />;
  const current = data.templates.find((t) => t.kind === kind) || data.templates[0];
  return <Editor key={`${current.kind}-${current.version || 0}`} data={data} current={current} kind={current.kind} setKind={setKind} onSaved={req.reload} />;
}

function Editor({ data, current, kind, setKind, onSaved }) {
  const versions = useRequest(() => getLetterTemplateVersions(kind).catch(() => []), [kind, current.version]);
  const [form, setForm] = useState({ name: current.name, body: current.body });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);
  const dirty = form.name !== current.name || form.body !== current.body;
  useUnsavedChanges(dirty);
  const save = async () => {
    if (!form.name.trim() || !form.body.trim()) { setError({ message: !form.name.trim() ? 'Give the letter a name.' : 'Write the letter.' }); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await saveLetterTemplate({ kind, name: form.name.trim(), body: form.body });
      notify.success(`${r.template.name} saved as version ${r.template.version}. New letters use it.`);
      onSaved();
    } catch (e) { setError(e); } finally { setSaving(false); }
  };
  /* A field goes in where the cursor is. */
  const insert = (token) => {
    const el = bodyRef.current;
    const at = el ? el.selectionStart : form.body.length;
    const end = el ? el.selectionEnd : at;
    const body = `${form.body.slice(0, at)}${token}${form.body.slice(end)}`;
    setForm({ ...form, body });
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } });
  };
  const switchTo = async (k) => {
    if (k === kind) return;
    if (dirty && !(await confirmDialog({ title: 'Leave this letter?', message: 'Your changes are not saved.', confirmLabel: 'Leave' }))) return;
    setKind(k);
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Letters"
        actions={<>
          {dirty ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setForm({ name: current.name, body: current.body })}>Discard</button> : null}
          <button type="button" className="ui-btn ui-btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save as new version'}</button>
        </>} />
      <div className="ui-form-grid">
        <div><PopupSelect showValueSubtext={false} label="Letter" value={kind} onChange={(v) => v && switchTo(v)} options={data.kinds.map((k) => ({ value: k.kind, label: k.label }))} /></div>
        <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></label>
      </div>
      <p className="ui-caption">{captionOf(current, data.kinds.find((k) => k.kind === kind)?.issuedWhen)}</p>
      <Signatory key={data.signatory || ''} saved={data.signatory || ''} onSaved={onSaved} />
      {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <label className="block"><span className="ui-label">Letter</span><textarea ref={bodyRef} className="ui-input w-full text-sm leading-relaxed" rows={22} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <aside className="space-y-4" aria-label="Fields">
          <section className="space-y-2">
            <h3 className="ui-label">From the record</h3>
            <div className="flex flex-wrap gap-1.5">{data.mergeFields.map((f) => <button key={f} type="button" className="ui-choice-chip" onClick={() => insert(`{{${f}}}`)}>{f}</button>)}</div>
          </section>
          <section className="space-y-2">
            <h3 className="ui-label">Typed in when issued</h3>
            {current.extra.length ? <div className="flex flex-wrap gap-1.5">{current.extra.map((x) => <button key={x} type="button" className="ui-choice-chip" onClick={() => insert(`{{extra.${x}}}`)}>{x}</button>)}</div> : <p className="text-sm ui-muted">None. Write {'{{extra.name}}'} to ask for one.</p>}
          </section>
          {versions.data?.length ? (
            <section className="space-y-2">
              <h3 className="ui-label">Versions</h3>
              <ul className="divide-y border-t text-sm">
                {versions.data.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="tabular-nums">v{v.version}{v.active ? <span className="ui-pill ui-pill-pos ms-2">In use</span> : null}<span className="block ui-caption">{v.createdAt ? formatDate(istDay(v.createdAt)) : ''}</span></span>
                    {!v.active ? <button type="button" className="ui-link" onClick={() => setForm({ name: v.name, body: v.body })}>Open</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* What is in use, and when CLOR sends it by itself. */
function captionOf(current, issuedWhen) {
  if (current.builtIn) return issuedWhen ? `CLOR’s built-in letter. Save it as the company’s own and CLOR issues it by itself when ${issuedWhen}.` : 'CLOR’s built-in letter. Saving makes it the company’s own, version 1.';
  return issuedWhen ? `Version ${current.version} is in use. CLOR issues it by itself when ${issuedWhen}.` : `Version ${current.version} is in use.`;
}

/** Who signs the letters CLOR issues by itself and the ones people ask for in the app: one name for every letter. */
function Signatory({ saved, onSaved }) {
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changed = value.trim() !== saved;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await saveLetterSettings({ signatory: value });
      notify.success(r.signatory ? `Letters are signed by ${r.signatory}.` : 'No one is named to sign letters.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1" style={{ maxWidth: '28rem' }}>
        <span className="ui-label">Signed by</span>
        <input className="ui-input w-full" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} placeholder="Meera Shah, HR Manager" />
      </label>
      <button type="submit" className="ui-btn ui-btn-secondary" disabled={!changed || busy} aria-busy={busy || undefined}>Save</button>
      <p className="ui-caption w-full">{saved ? 'Goes under every letter CLOR issues by itself, and under letters people ask for in the employee app.' : 'Name who signs. Until then, CLOR leaves letters that need a signature for HR to issue by hand.'}</p>
    </form>
  );
}

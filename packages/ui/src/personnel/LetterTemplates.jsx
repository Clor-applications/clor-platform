import React, { useEffect, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getLetterTemplateVersions, getLetterTemplates, saveLetterTemplate } from './api';

/**
 * Letters the company issues (DOC-04): one template per kind, plain text
 * with {{fields}} from the record and {{extra.name}} fields HR fills in when
 * issuing. Each save is a new version; an issued letter names the version
 * that made it. Until the company writes its own, the built-in one is used.
 */
export default function LetterTemplates() {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('APPOINTMENT');
  const [draft, setDraft] = useState(null);
  const [versions, setVersions] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = () => getLetterTemplates().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setDraft(null);
    getLetterTemplateVersions(kind).then(setVersions).catch(() => setVersions([]));
  }, [kind, data]);

  if (!data) return <SkeletonCard lines={6} />;
  const current = data.templates.find((t) => t.kind === kind);
  const form = draft || { name: current.name, body: current.body };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await saveLetterTemplate({ kind, name: form.name, body: form.body });
      notify.success(`${r.template.name} saved as version ${r.template.version}. New letters use it.`);
      setDraft(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Letters" description="Offer, appointment, confirmation, increment, relieving and experience letters, and the service certificate. Fields in double braces are filled from the record; {{extra.name}} is typed in when the letter is issued." />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Letter kinds">
        {data.kinds.map((k) => (
          <button key={k.kind} type="button" role="tab" aria-selected={kind === k.kind} className={`ui-pill ${kind === k.kind ? 'ui-pill-info' : ''}`} onClick={() => setKind(k.kind)}>{k.label}</button>
        ))}
      </div>
      <form onSubmit={save} className="space-y-3">
        <p className="ui-caption">
          {current.builtIn ? 'Built-in letter. Save it to make the company’s own version 1.' : `Version ${current.version} in use.`}
          {' '}Fields: {data.mergeFields.map((f) => `{{${f}}}`).join(' ')}
        </p>
        <label className="block">
          <span className="ui-label">Letter name</span>
          <input className="ui-input w-full sm:max-w-md" value={form.name} onChange={(e) => setDraft({ ...form, name: e.target.value })} maxLength={120} />
        </label>
        <label className="block">
          <span className="ui-label">Letter</span>
          <textarea className="ui-input w-full font-mono text-xs" rows={22} value={form.body} onChange={(e) => setDraft({ ...form, body: e.target.value })} />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="ui-caption">HR fills in when issuing: {current.extra.length ? current.extra.map((x) => `{{extra.${x}}}`).join(', ') : 'nothing'}</span>
          <div className="flex gap-2">
            {draft ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft(null)}>Discard</button> : null}
            <button type="submit" className="ui-btn ui-btn-primary" disabled={!draft || saving}>{saving ? 'Saving…' : 'Save as new version'}</button>
          </div>
        </div>
      </form>
      {versions.length ? (
        <section aria-label="Earlier versions">
          <h3 className="ui-t-sec">Versions</h3>
          <ul className="divide-y text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <span>Version {v.version}{v.active ? ' · in use' : ''} · {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : ''}</span>
                {!v.active ? <button type="button" className="ui-link" onClick={() => setDraft({ name: v.name, body: v.body })}>Open as a draft</button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

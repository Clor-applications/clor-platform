import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { OWNER_WORD, employeeTypes, getSteps, resetSteps, saveSteps } from './api';
import { can } from './shared';

/**
 * Settings → Joining & Leaving Steps (was the template half of Onboarding &
 * Exit). Each step: what, whose, when (calendar or working days from the
 * joining day or last day), who it is for (everyone or some employment
 * types), and whether it closes only with a note. CLOR's own reader step
 * stays as CLOR closes it. A change applies to plans started afterwards.
 */
const COPY = {
  JOINING: { title: 'Joining', due: 'Days after joining', verb: 'join' },
  LEAVING: { title: 'Leaving', due: 'Days from the last day', verb: 'leave' },
};
const OWNERS = Object.entries(OWNER_WORD).map(([value, label]) => ({ value, label }));
const DAY_KIND = [{ value: 'calendar', label: 'Calendar days' }, { value: 'working', label: 'Working days' }];

function Editor({ kind, template, types, editable, onSaved }) {
  const initial = useMemo(() => JSON.stringify(template.items), [template]);
  const [items, setItems] = useState(template.items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(items) !== initial;
  useUnsavedChanges(dirty);
  const set = (i, patch) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const typeOptions = [{ value: 'all', label: 'Everyone' }, ...types.map((t) => ({ value: t.id, label: `Only ${t.name}` }))];
  const save = async () => {
    const blank = items.findIndex((it) => !String(it.title || '').trim());
    if (blank >= 0) { setError(`Step ${blank + 1} has no words.`); return; }
    setSaving(true);
    setError(null);
    try {
      onSaved(kind, await saveSteps(kind, items.map((it) => ({ ...it, title: it.title.trim(), dueDays: Number(it.dueDays) || 0 }))));
      notify.success(`${COPY[kind].title} steps saved.`);
    } catch (e) {
      setError(String(e?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    const ok = await confirmDialog({ title: 'Back to CLOR’s steps?', message: `Your own steps are replaced by CLOR’s for people who ${COPY[kind].verb} from now on.`, confirmLabel: 'Use CLOR’s steps' });
    if (!ok) return;
    try { onSaved(kind, await resetSteps(kind)); } catch (e) { setError(String(e?.message || 'Not saved.')); }
  };
  return (
    <section className="space-y-4" aria-label={`${COPY[kind].title} steps`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{template.custom ? 'Your company’s own steps.' : 'CLOR’s steps.'} A change applies to people who {COPY[kind].verb} from now on.</p>
        {editable ? (
          <span className="flex gap-2">
            {template.custom ? <button type="button" className="ui-btn ui-btn-ghost" onClick={reset}>Use CLOR’s steps</button> : null}
            <button type="button" className="ui-btn ui-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          </span>
        ) : null}
      </div>
      {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
      <div className="hidden lg:grid gap-3 lg:grid-cols-[minmax(0,1fr)_9rem_6rem_9rem_10rem_8rem_2rem] ui-label border-b pb-2" aria-hidden="true">
        <span>Step</span><span>Owner</span><span>{COPY[kind].due}</span><span>Counted in</span><span>For</span><span>Note</span><span />
      </div>
      <ol className="divide-y lg:-mt-4" aria-label="Steps">
        {items.map((it, i) => {
          const system = it.system === 'READERS';
          return (
            <li key={i} className="grid gap-3 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_6rem_9rem_10rem_8rem_2rem] lg:items-center">
              <label className="block sm:col-span-2 lg:col-span-1">
                <span className="ui-label lg:sr-only">Step {i + 1}</span>
                <input className="ui-input w-full" value={it.title} disabled={!editable || system} onChange={(e) => set(i, { title: e.target.value })} maxLength={200} />
                {system ? <span className="ui-caption block mt-1">CLOR does this on the last day and closes it when every reader confirms.</span> : null}
              </label>
              <div><span className="ui-label lg:hidden">Owner</span><PopupSelect showValueSubtext={false} ariaLabel={`Step ${i + 1} owner`} icon={null} disabled={!editable} value={it.owner} onChange={(v) => set(i, { owner: v || 'HR' })} options={OWNERS} /></div>
              <label className="block"><span className="ui-label lg:sr-only">{COPY[kind].due}</span><input className="ui-input w-full tabular-nums" inputMode="numeric" disabled={!editable} aria-label={`Step ${i + 1}: ${COPY[kind].due.toLowerCase()}`} value={it.dueDays} onChange={(e) => set(i, { dueDays: e.target.value.replace(/[^\d-]/g, '').slice(0, 4) })} /></label>
              <div><span className="ui-label lg:hidden">Counted in</span><PopupSelect showValueSubtext={false} ariaLabel={`Step ${i + 1} counted in`} icon={null} disabled={!editable} value={it.workingDays ? 'working' : 'calendar'} onChange={(v) => set(i, { workingDays: v === 'working' || undefined })} options={DAY_KIND} /></div>
              <div><span className="ui-label lg:hidden">For</span><PopupSelect showValueSubtext={false} ariaLabel={`Step ${i + 1} is for`} icon={null} disabled={!editable || system} value={it.types?.[0] || 'all'} onChange={(v) => set(i, { types: v && v !== 'all' ? [v] : undefined })} options={typeOptions} /></div>
              <label className="flex items-center gap-2 text-sm whitespace-nowrap"><input type="checkbox" disabled={!editable || system} checked={Boolean(it.needsNote)} onChange={(e) => set(i, { needsNote: e.target.checked || undefined })} /> <span>Needs a note</span></label>
              {editable ? <button type="button" className="ui-icon-btn justify-self-end" onClick={() => setItems((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${it.title || `step ${i + 1}`}`}><Trash2 size={16} aria-hidden="true" /></button> : <span />}
            </li>
          );
        })}
      </ol>
      {editable ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setItems((list) => [...list, { title: '', owner: 'HR', dueDays: 0 }])}><Plus size={16} aria-hidden="true" /> Add a step</button> : null}
    </section>
  );
}

export default function Steps() {
  const perms = usePermissions();
  const editable = can(perms, 'PEOPLE::Org Structure::EDIT');
  const req = useRequest(() => Promise.all([getSteps(), employeeTypes()]), []);
  const [saved, setSaved] = useState({});
  const [kind, setKind] = useState('JOINING');
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, kind);
  const [steps, types] = req.data || [null, []];
  const templates = steps ? { ...steps, ...saved } : null;
  const current = templates?.[kind.toLowerCase()];
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Settings' }]} title="Joining & Leaving Steps" />
      <div ref={tabsRef} role="tablist" aria-label="Steps" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {['JOINING', 'LEAVING'].map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`ui-tab ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>{COPY[k].title}</button>
        ))}
        {tabIndicator}
      </div>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} />
        : !current ? <SkeletonCard lines={6} />
          : <Editor key={`${kind}-${JSON.stringify(current.items)}`} kind={kind} template={current} types={types || []} editable={editable} onSaved={(k, t) => setSaved((all) => ({ ...all, [k.toLowerCase()]: t }))} />}
    </div>
  );
}

import React, { useMemo, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { confirmDialog, notify } from '@ui/components/ui/notify';

import { codeOf } from './exitAnswerCode';
import { getExitQuestions, resetExitQuestions, saveExitQuestions } from '../api/engagement';

/**
 * Settings → Exit interview (WORKFLOW-GAP-RESEARCH-2026-10-30 4.9): the questions a leaver answers in the
 * employee app, five by default, and how long the answers are kept. One question gives the main reason
 * (the People report counts it); the rest are a choice or a short answer. A leaver already asked keeps
 * the questions they were given.
 */

const SUGGESTED = ['What is the main reason you are leaving?', 'Would you come back to work here?', 'What would have made you stay?', 'What did you like about working here?', 'Anything you want the owner to know?', 'Was your notice period fair?', 'How was your manager?', 'Would you recommend us to a friend?'];
const toForm = (d) => ({ keepMonths: String(d.keepMonths), questions: d.questions.map((q) => ({ ...q, optionsText: (q.options || []).map((o) => o.label).join('\n') })) });

export default function ExitQuestions() {
  const req = useRequest(() => getExitQuestions(), []);
  const saved = useMemo(() => (req.data ? toForm(req.data) : null), [req.data]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = draft || saved;
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  useUnsavedChanges(dirty);
  const title = 'Exit interview';
  if (req.error && !req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title={title} /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!form) return <div className="space-y-6 max-w-2xl"><PageHeader title={title} /><SkeletonCard lines={8} /></div>;
  const canEdit = Boolean(req.data.canEdit);
  const set = (patch) => { setError(''); setDraft({ ...form, ...patch }); };
  const setQ = (i, patch) => set({ questions: form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const add = () => {
    const used = new Set(form.questions.map((q) => q.key));
    let n = form.questions.length + 1;
    while (used.has(`q${n}`)) n += 1;
    set({ questions: [...form.questions, { key: `q${n}`, text: '', kind: 'TEXT', optionsText: '' }] });
  };
  const body = () => ({
    keepMonths: Number(form.keepMonths),
    questions: form.questions.map((q) => {
      const before = req.data.questions.find((x) => x.key === q.key)?.options || [];
      const labels = q.kind === 'TEXT' ? [] : [...new Set(q.optionsText.split('\n').map((s) => s.trim()).filter(Boolean))];
      return { key: q.key, text: q.text.trim(), kind: q.kind, ...(q.kind === 'TEXT' ? {} : { options: labels.map((label) => ({ code: codeOf(label, before), label })) }) };
    }),
  });
  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const out = await saveExitQuestions(body());
      req.setData(out);
      setDraft(null);
      notify.success('Exit interview questions saved.');
    } catch (e) {
      setError(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Go back to CLOR’s five questions?', message: 'Your own questions are replaced. Leavers already asked keep theirs.', confirmLabel: 'Use CLOR’s', tone: 'primary' }))) return;
    try {
      req.setData(await resetExitQuestions());
      setDraft(null);
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    }
  };
  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title={title} actions={canEdit ? <button type="button" className="ui-btn ui-btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button> : null} />
      <fieldset disabled={!canEdit} className="ui-record-section space-y-5 min-w-0">
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        <ol className="space-y-5">
          {form.questions.map((q, i) => (
            <li key={q.key} className="space-y-2 border-b pb-5 last:border-0 last:pb-0" style={{ borderColor: 'rgb(var(--border))' }}>
              <label className="block">
                <span className="ui-label">Question {i + 1}{q.kind === 'REASON' ? ': the main reason' : ''}</span>
                <SuggestInput maxLength={200} value={q.text} onChange={(v) => setQ(i, { text: v })} suggestions={SUGGESTED.filter((s) => !form.questions.some((x) => x.text === s))} />
              </label>
              {q.kind !== 'REASON' ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-56"><PopupSelect label="Answer" showValueSubtext={false} value={q.kind} onChange={(v) => setQ(i, { kind: v || 'TEXT' })} options={[{ value: 'TEXT', label: 'In their own words' }, { value: 'CHOICE', label: 'Choose one' }]} /></div>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => set({ questions: form.questions.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ) : null}
              {q.kind !== 'TEXT' ? (
                <label className="block">
                  <span className="ui-label">Answers to choose from, one per line</span>
                  <textarea className="ui-input w-full" rows={Math.min(9, Math.max(3, q.optionsText.split('\n').length))} value={q.optionsText} onChange={(e) => setQ(i, { optionsText: e.target.value })} />
                </label>
              ) : null}
            </li>
          ))}
        </ol>
        {form.questions.length < 8 ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={add}>Add a question</button> : null}
        <label className="block max-w-xs">
          <span className="ui-label">Keep answers for</span>
          <span className="flex items-center gap-2"><input type="number" min={1} max={120} className="ui-input w-24 tabular-nums" value={form.keepMonths} onChange={(e) => set({ keepMonths: e.target.value })} /><span className="ui-caption">months</span></span>
          <span className="ui-caption block">Then the answers are erased; the main reason stays for the report. Your choice, not a legal period.</span>
        </label>
        {req.data.custom && canEdit ? <button type="button" className="ui-link text-sm" onClick={reset}>Use CLOR’s five questions again</button> : null}
      </fieldset>
    </div>
  );
}

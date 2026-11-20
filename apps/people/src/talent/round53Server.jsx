import React, { useState } from 'react';
import Drawer from '@ui/components/ui/Drawer';
import useRequest from '@ui/components/ui/useRequest';
import ErrorState from '@ui/components/ui/ErrorState';
import { notify } from '@ui/components/ui/notify';
import { getInterviewQuestions, setInterviewQuestions } from '../api/talent';
import { FormError, Footer, SHEET } from './shared';

/*
 * Round 53 picks that needed the server (hiring): one interview question list for every job, each
 * question rated 1 to 5 on the interviewer's form (round 36 pick too), and the candidate's answers to
 * the opening's screening questions.
 */

export const RATING_WORDS = { 1: 'Poor', 2: 'Weak', 3: 'Fair', 4: 'Good', 5: 'Excellent' };

/** One question, rated 1 to 5 as joined buttons; pressing the chosen one again clears it. */
export function RatingRow({ question, value, onChange }) {
  const name = `rate-${question}`;
  return (
    <fieldset className="sm:col-span-2">
      <legend className="ui-label">{question}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={question}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`ui-btn ui-btn-sm tabular-nums ${value === n ? 'ui-btn-primary' : 'ui-btn-secondary'}`} title={RATING_WORDS[n]}>
            <input type="radio" className="sr-only" name={name} value={n} checked={value === n} onChange={() => onChange(n)} onClick={() => { if (value === n) onChange(null); }} />{n}
          </label>
        ))}
        {value ? <span className="ui-caption self-center">{RATING_WORDS[value]}</span> : null}
      </div>
    </fieldset>
  );
}

/** The company's questions, for the feedback form. */
export function useInterviewQuestions() {
  const req = useRequest(() => getInterviewQuestions().catch(() => ({ questions: [], canEdit: false })), []);
  return req.data || { questions: [], canEdit: false };
}

/** An interviewer's ratings, read back on the candidate: "Communication 4 · Problem solving —". */
export function RatedAnswers({ answers }) {
  const rated = (answers || []).filter((a) => a && a.question);
  if (!rated.length) return null;
  return (
    <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 ui-caption">
      {rated.map((a) => <li key={a.question}>{a.question} <span className="tabular-nums">{a.rating || '—'}</span></li>)}
    </ul>
  );
}

/** What the candidate answered on the apply page. */
export function ScreeningAnswers({ answers }) {
  const list = (answers || []).filter((a) => a && a.question);
  if (!list.length) return null;
  return (
    <section aria-label="Answers on the apply page" className="space-y-1.5">
      <h3 className="ui-label">Answers on the apply page</h3>
      <dl className="space-y-1.5 text-sm">
        {list.map((a) => (
          <div key={a.question}><dt className="ui-muted">{a.question}</dt><dd className="whitespace-pre-wrap">{a.answer || <span className="ui-muted">Not answered</span>}</dd></div>
        ))}
      </dl>
    </section>
  );
}

/** HR sets the question list every interviewer rates, one a line, the same for every job. */
export function InterviewQuestionsDrawer({ onClose }) {
  const req = useRequest(() => getInterviewQuestions(), []);
  const [text, setText] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const initial = (req.data?.questions || []).join('\n');
  const value = text ?? initial;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await setInterviewQuestions(value.split('\n').map((x) => x.trim()).filter(Boolean));
      notify.success(saved.length ? `${saved.length} question${saved.length === 1 ? '' : 's'} on every interview form.` : 'No questions: interviewers give a recommendation and notes only.');
      onClose();
    } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={text !== null && text !== initial} title="Interview questions"
      description="The same list for every job. Each interviewer rates every question from 1 to 5 beside their recommendation."
      footer={<Footer onCancel={onClose} onSave={save} busy={busy || req.loading} disabled={Boolean(req.error && !req.data)} label="Save" />}>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} compact /> : (
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">Questions, one a line</span>
          <textarea className="ui-input w-full" rows={8} maxLength={3000} value={value} onChange={(e) => setText(e.target.value)} placeholder={'Communication\nProblem solving\nKnows the work\nFits the team'} />
          <span className="ui-help">Up to 12. Ratings already given keep the questions they were given against.</span>
        </label>
      </form>
      )}
    </Drawer>
  );
}

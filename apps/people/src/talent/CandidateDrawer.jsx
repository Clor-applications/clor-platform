import React, { useMemo, useRef, useState } from 'react';
import { Download, Upload } from '@ui/components/ui/lineIcons';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { nextEmployeeCode } from '../workforce/api';
import OfferDrawer from '../workforce/OfferDrawer';
import {
  addCandidate, cancelInterview, getCandidate, giveFeedback, hireCandidate, interviewers, listInterviews, moveCandidate, moveInterview, noteCandidate, readFile, resumeFile, saveResume, scheduleInterview, updateCandidate,
} from '../api/talent';
import { FormError, Footer, MODES, OPEN_STAGES, Pill, RECOMMENDATIONS, ReasonDrawer, SHEET, SOURCES, STAGES, WIDE_SHEET, day, fromLocalInput, toLocalInput, todayIst, usedValues, when, word } from './shared';

/**
 * One candidate (TALENT-DECISIONS.md): where they stand, their résumé, interviews with each
 * interviewer's recommendation, offers, notes and the timeline of every move. HR acts on it;
 * an interviewer without Recruitment rights sees the brief and gives their own feedback, and
 * reads the others' only after that.
 */
const OFFER_STATUS = { DRAFT: ['Draft', 'ui-pill-neutral'], SENT: ['Sent', 'ui-pill-info'], ACCEPTED: ['Accepted', 'ui-pill-pos'], DECLINED: ['Declined', 'ui-pill-neg'], WITHDRAWN: ['Withdrawn', 'ui-pill-neutral'], EXPIRED: ['Expired', 'ui-pill-neutral'] };
const INTERVIEW_STATUS = { SCHEDULED: ['Set', 'ui-pill-info'], DONE: ['Done', 'ui-pill-pos'], CANCELLED: ['Cancelled', 'ui-pill-neutral'] };

export default function CandidateDrawer({ id, hr, canEdit = false, canHire, canOffer, known = [], onClose, onChanged, onHired }) {
  const req = useRequest(() => getCandidate(id), [id]);
  const d = req.data;
  const c = d?.candidate;
  const [sub, setSub] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const reload = () => { req.reload(); onChanged?.(); };
  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) notify.success(ok); reload(); return true; } catch (e) { notify.error(String(e?.message || 'Not done.')); return false; } finally { setBusy(false); }
  };
  const live = c && OPEN_STAGES.includes(c.stage);
  const move = (stage) => act(() => moveCandidate(id, stage), `${c.name}: ${word(STAGES, stage).toLowerCase()}.`);
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify.error('A résumé is up to 5 MB.'); return; }
    await act(async () => saveResume(id, await readFile(file)), 'Résumé added.');
  };
  const addNote = (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    act(async () => { await noteCandidate(id, note.trim()); setNote(''); }, 'Note added.');
  };
  const cancel = async (iv) => {
    if (await confirmDialog({ title: 'Cancel this interview?', message: 'The interviewers stop seeing it as theirs. It stays on the timeline.', confirmLabel: 'Cancel interview' })) act(() => cancelInterview(iv.id), 'Interview cancelled.');
  };
  const offerTarget = c ? { ...c, designation: c.openingTitle || '' } : null;
  /* The one next step for where they stand; the others sit in the row under the details. */
  const primary = !c || !live ? null
    : c.stage === 'APPLIED' ? ['Move to screening', () => move('SCREENING')]
      : c.stage === 'SCREENING' ? ['Set an interview', () => setSub({ kind: 'interview' })]
        : c.stage === 'INTERVIEW' ? (canOffer ? ['Send an offer', () => setSub({ kind: 'offer' })] : ['Move to offer', () => move('OFFER')])
          : c.stage === 'OFFER' && canHire ? ['Hire', () => setSub({ kind: 'hire' })] : null;

  return (
    <Drawer open onClose={onClose} title={c?.name || 'Candidate'} widthClass={WIDE_SHEET} dirty={Boolean(note.trim())}
      footer={c && canEdit && live ? (
        <>
          <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={() => setSub({ kind: 'reject' })}>Not taken forward</button>
          {primary ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={primary[1]}>{primary[0]}</button> : null}
        </>
      ) : c && canEdit && ['REJECTED', 'WITHDRAWN'].includes(c.stage) ? (
        <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => move('APPLIED')}>Bring back to Applied</button>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !c ? <SkeletonCard lines={8} /> : (
        <div className="space-y-5">
          <p className="ui-caption flex flex-wrap items-center gap-2">
            <Pill map={STAGES} value={c.stage} />
            <span>{[c.openingTitle, hr ? word(SOURCES, c.source) + (c.sourceDetail ? ` (${c.sourceDetail})` : '') : null, `since ${day(c.stageAt)}`].filter(Boolean).join(' · ')}</span>
          </p>
          {d.referral ? <p className="text-sm">Referred by <span className="font-medium">{d.referral.referrer}</span>{d.referral.via === 'LINK' ? ', through their link' : ''} on <span className="tabular-nums">{day(d.referral.referredAt)}</span>{d.referral.relation ? `. How they know them: ${d.referral.relation}` : ''}.{d.referral.note ? <span className="block whitespace-pre-wrap ui-muted">{d.referral.note}</span> : null}</p> : null}
          {c.closedReason ? <p className="text-sm"><span className="ui-label">Why</span> {c.closedReason}</p> : null}
          {c.offerAcceptedOn ? <p className="text-sm">Offer accepted on <span className="tabular-nums">{day(c.offerAcceptedOn)}</span>.</p> : null}
          <dl className="ui-field-grid">
            {hr ? <div><dt className="ui-label">E-mail</dt><dd className="text-sm break-all">{c.email || '—'}</dd></div> : null}
            {hr ? <div><dt className="ui-label">Phone</dt><dd className="text-sm tabular-nums">{c.phone || '—'}</dd></div> : null}
            <div><dt className="ui-label">Works at now</dt><dd className="text-sm">{c.currentEmployer || '—'}</dd></div>
            <div>
              <dt className="ui-label">Résumé</dt>
              <dd className="text-sm flex flex-wrap items-center gap-2">
                {c.resume ? <button type="button" className="ui-link inline-flex items-center gap-1" onClick={() => resumeFile(id).catch((e) => notify.error(e.message))}><Download size={14} aria-hidden="true" />{c.resume.name}</button> : null}
                {c.resumeUrl ? <a className="ui-link break-all" href={c.resumeUrl} target="_blank" rel="noopener noreferrer">Their link</a> : null}
                {!c.resume && !c.resumeUrl ? <span className="ui-muted">None yet</span> : null}
                {canEdit && !c.anonymised ? (
                  <>
                    <input ref={fileRef} type="file" className="sr-only" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} aria-label="Résumé file" />
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" /> {c.resume ? 'Replace' : 'Add'}</button>
                  </>
                ) : null}
              </dd>
            </div>
          </dl>
          {canEdit && live ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSub({ kind: 'edit' })}>Edit details</button>
              {c.stage !== 'SCREENING' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSub({ kind: 'interview' })}>Set an interview</button> : null}
              {canOffer && c.stage !== 'INTERVIEW' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSub({ kind: 'offer' })}>{d.offers.length ? 'Send a new offer' : 'Send an offer'}</button> : null}
              <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Move to stage" value="" placeholder="Move to…" onChange={(v) => v && (v === 'WITHDRAWN' ? setSub({ kind: 'withdrawn' }) : move(v))}
                options={[...OPEN_STAGES.filter((s) => s !== c.stage).map((s) => ({ value: s, label: word(STAGES, s) })), { value: 'WITHDRAWN', label: 'Withdrew' }]} /></div>
            </div>
          ) : null}

          <section aria-label="Interviews" className="space-y-2">
            <h3 className="ui-label">Interviews</h3>
            {!d.interviews.length ? <p className="text-sm ui-muted">None set.</p> : (
              <ol className="ui-history-list">
                {d.interviews.map((iv) => (
                  <li key={iv.id} className="ui-history-row space-y-1.5">
                    <p className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium tabular-nums">{when(iv.at)}</span>
                      <span className="ui-muted">{word(MODES, iv.mode)}{iv.minutes ? `, ${iv.minutes} min` : ''}</span>
                      <Pill map={INTERVIEW_STATUS} value={iv.status} />
                    </p>
                    {iv.place ? <p className="text-sm break-all">{/^https:\/\//.test(iv.place) ? <a className="ui-link" href={iv.place} target="_blank" rel="noopener noreferrer">{iv.place}</a> : iv.place}</p> : null}
                    <p className="ui-caption">{iv.interviewers.map((u) => `${u.name}${u.gave ? ' ✓' : ''}`).join(', ')}</p>
                    {iv.feedback.map((f) => (
                      <div key={f.byUserId} className="text-sm">
                        <span className="font-medium">{f.by}</span>: {word(RECOMMENDATIONS, f.recommendation)}{f.notes ? <span className="block whitespace-pre-wrap ui-muted">{f.notes}</span> : null}
                      </div>
                    ))}
                    {iv.feedbackHidden ? <p className="ui-caption">Others have given feedback. You see it once you give yours.</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {iv.mineToGive ? <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setSub({ kind: 'feedback', interview: iv })}>Give my feedback</button> : null}
                      {canEdit && iv.status === 'SCHEDULED' && live ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setSub({ kind: 'interview', interview: iv })}>Move</button> : null}
                      {canEdit && iv.status === 'SCHEDULED' && live ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => cancel(iv)}>Cancel</button> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {hr && d.offers.length ? (
            <section aria-label="Offers" className="space-y-2">
              <h3 className="ui-label">Offers</h3>
              <ul className="space-y-1">
                {d.offers.map((o) => (
                  <li key={o.id} className="text-sm flex flex-wrap items-center gap-2">
                    <Pill map={OFFER_STATUS} value={o.status} />
                    <span>{o.designation}</span>
                    <span className="ui-muted tabular-nums">{o.joiningDate ? `joins ${day(o.joiningDate)}` : ''}{o.acceptBy ? ` · answer by ${day(o.acceptBy)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {hr ? (
            <section aria-label="Timeline" className="space-y-2">
              <h3 className="ui-label">Timeline</h3>
              {canEdit && !c.anonymised ? (
                <form onSubmit={addNote} className="flex gap-2">
                  <input className="ui-input w-full" maxLength={4000} placeholder="Add a note" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !note.trim()}>Add</button>
                </form>
              ) : null}
              <ol className="ui-history-list">
                {d.timeline.map((e) => (
                  <li key={e.id} className="ui-history-row">
                    <p className="ui-caption flex flex-wrap gap-x-2"><span className="font-medium">{e.by}</span><span className="tabular-nums ms-auto">{when(e.at)}</span></p>
                    <p className="text-sm whitespace-pre-wrap">{eventText(e)}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      )}
      {sub?.kind === 'edit' ? <CandidateForm value={c} known={known} onClose={() => setSub(null)} onSaved={() => { setSub(null); reload(); }} /> : null}
      {sub?.kind === 'interview' ? <InterviewForm candidate={c} interview={sub.interview} onClose={() => setSub(null)} onSaved={() => { setSub(null); reload(); }} /> : null}
      {sub?.kind === 'feedback' ? <FeedbackForm interview={sub.interview} name={c.name} onClose={() => setSub(null)} onSaved={() => { setSub(null); reload(); }} /> : null}
      {sub?.kind === 'offer' ? <OfferDrawer candidate={offerTarget} onClose={() => setSub(null)} onSent={() => { setSub(null); reload(); }} /> : null}
      {sub?.kind === 'hire' ? <HireDrawer candidate={c} acceptedJoining={(d.offers.find((o) => o.status === 'ACCEPTED') || d.offers.find((o) => o.joiningDate))?.joiningDate} onClose={() => setSub(null)} onDone={(e) => { setSub(null); reload(); onHired?.(e); }} /> : null}
      {sub?.kind === 'reject' || sub?.kind === 'withdrawn' ? (
        <ReasonDrawer title={sub.kind === 'reject' ? `Not taking ${c.name} forward` : `${c.name} withdrew`} label="Why" action="Save"
          help={sub.kind === 'reject' ? 'Say why. It stays on their card.' : 'Say why they withdrew.'}
          suggestions={sub.kind === 'reject' ? ['Not enough experience', 'Salary expectation too high', 'Did not attend the interview', 'Another candidate chosen'] : ['Took another offer', 'Salary not enough', 'Moved away']}
          onClose={() => setSub(null)}
          onDone={async (reason) => { await moveCandidate(id, sub.kind === 'reject' ? 'REJECTED' : 'WITHDRAWN', reason); notify.success('Saved.'); setSub(null); reload(); }} />
      ) : null}
    </Drawer>
  );
}

const eventText = (e) => {
  if (e.kind === 'STAGE') return `${e.fromWord ? `${e.fromWord} → ` : ''}${e.toWord || ''}${e.text ? `: ${e.text}` : ''}`;
  if (e.kind === 'APPLIED') return `Applied${e.text ? `. ${e.text}` : ''}`;
  if (e.kind === 'HIRED') return `Hired${e.text ? `. ${e.text}` : ''}`;
  return e.text || '';
};

/** Add a candidate to an opening, or change their details. */
export function CandidateForm({ value, openings = [], known = [], onClose, onSaved }) {
  const initial = useMemo(() => ({ openingId: value.openingId || '', name: value.name || '', email: value.email || '', phone: value.phone || '', source: value.source || 'REFERRAL', sourceDetail: value.sourceDetail || '', currentEmployer: value.currentEmployer || '' }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (inFlight.current) return;
    const missing = !value.id && !form.openingId ? 'Pick the opening they apply for.' : !form.name.trim() ? 'Give the candidate’s name.' : null;
    if (missing) { setError({ message: missing }); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, source: form.source, sourceDetail: form.sourceDetail.trim() || null, currentEmployer: form.currentEmployer.trim() || null };
    try {
      const r = value.id ? await updateCandidate(value.id, body) : await addCandidate({ ...body, openingId: form.openingId });
      notify.success(value.id ? 'Saved.' : `${body.name} added as Applied.`);
      onSaved(r);
    } catch (e) { setError(e); } finally { inFlight.current = false; setBusy(false); }
  };
  const detailLabel = { REFERRAL: 'Referred by', AGENCY: 'Agency', JOB_PORTAL: 'Which portal' }[form.source] || 'Detail';
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={value.id ? `Edit ${value.name}` : 'Add a candidate'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label={value.id ? 'Save' : 'Add'} disabled={Boolean(value.id) && !dirty} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormError error={error} />
        {!value.id ? <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Opening *" value={form.openingId} placeholder={openings.length ? 'Choose…' : 'No open job yet'} alwaysSearch={openings.length > 8} onChange={(v) => set({ openingId: v || '' })} options={openings.map((o) => ({ value: o.id, label: o.title }))} /></div> : null}
        {/* A candidate's own name, e-mail and phone are theirs: never offered to another record. */}
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" autoFocus maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="ui-label">E-mail</span><input className="ui-input w-full" type="email" inputMode="email" maxLength={200} value={form.email} onChange={(e) => set({ email: e.target.value })} /></label>
        <label className="block"><span className="ui-label">Phone</span><input className="ui-input w-full" type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="Came through" value={form.source} onChange={(v) => set({ source: v || 'OTHER' })} options={SOURCES.filter(([k]) => !['APPLY_LINK', 'INTERNAL'].includes(k) || form.source === k).map(([v, l]) => ({ value: v, label: l }))} /></div>
        <label className="block"><span className="ui-label">{detailLabel}</span><SuggestInput maxLength={120} value={form.sourceDetail} onChange={(v) => set({ sourceDetail: v })} suggestions={form.source === 'JOB_PORTAL' ? ['Naukri', 'LinkedIn', 'Indeed', 'Apna', 'WorkIndia'] : []} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Works at now</span><SuggestInput maxLength={120} value={form.currentEmployer} onChange={(v) => set({ currentEmployer: v })} suggestions={usedValues(known, (r) => r.currentEmployer)} /></label>
      </form>
    </Drawer>
  );
}

/** Set or move an interview: when, how, where, and who sits on it. */
function InterviewForm({ candidate, interview, onClose, onSaved }) {
  const users = useRequest(() => interviewers().catch(() => []), []);
  /* Rooms and meeting links used before (the company's own places, nobody's private details). */
  const places = useRequest(() => listInterviews({ when: 'all' }).then((r) => usedValues(r?.interviews || [], (i) => i.place)).catch(() => []), []);
  const initial = useMemo(() => ({ at: toLocalInput(interview?.at) || '', minutes: String(interview?.minutes || 45), mode: interview?.mode || 'IN_PERSON', place: interview?.place || '', ids: interview?.interviewers?.map((u) => u.id) || [] }), [interview]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    const missing = !form.at ? 'Pick the date and time.' : !form.ids.length ? 'Pick at least one interviewer.' : null;
    if (missing) { setError({ message: missing }); return; }
    setBusy(true);
    setError(null);
    const body = { at: fromLocalInput(form.at), minutes: Number(form.minutes) || 45, mode: form.mode, place: form.place.trim() || null, interviewerUserIds: form.ids };
    try {
      if (interview) await moveInterview(interview.id, body); else await scheduleInterview(candidate.id, body);
      notify.success(interview ? 'Interview moved. The interviewers are told.' : 'Interview set. The interviewers are told.');
      onSaved();
    } catch (e) { setError(e); setBusy(false); }
  };
  const list = users.data || [];
  /* Up to 10, as the server takes. */
  const toggle = (uid) => set({ ids: form.ids.includes(uid) ? form.ids.filter((x) => x !== uid) : form.ids.length >= 10 ? form.ids : [...form.ids, uid] });
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={`${interview ? 'Move the interview' : 'Interview'} with ${candidate.name}`}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label={interview ? 'Move' : 'Set'} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormError error={error} />
        <label className="block"><span className="ui-label">When *</span><input className="ui-input w-full tabular-nums" type="datetime-local" value={form.at} min={`${todayIst()}T00:00`} onChange={(e) => set({ at: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="How long" value={form.minutes} onChange={(v) => set({ minutes: v || '45' })} options={['30', '45', '60', '90', '120'].map((m) => ({ value: m, label: `${m} minutes` }))} /></div>
        <div><PopupSelect showValueSubtext={false} label="How" value={form.mode} onChange={(v) => set({ mode: v || 'IN_PERSON' })} options={MODES.map(([v, l]) => ({ value: v, label: l }))} /></div>
        <label className="block"><span className="ui-label">{form.mode === 'VIDEO' ? 'Meeting link' : form.mode === 'PHONE' ? 'Who calls whom' : 'Where'}</span><SuggestInput maxLength={300} value={form.place} onChange={(v) => set({ place: v })} suggestions={places.data || []} /></label>
        <fieldset className="sm:col-span-2 space-y-1.5">
          <legend className="ui-label">Interviewers *</legend>
          {users.loading ? <p className="text-sm ui-muted">Loading…</p> : !list.length ? <p className="text-sm ui-muted">No users to choose from.</p> : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {list.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.ids.includes(u.id)} disabled={!form.ids.includes(u.id) && form.ids.length >= 10} onChange={() => toggle(u.id)} />{u.name}</label>)}
            </div>
          )}
          {form.ids.length >= 10 ? <p className="ui-caption">Up to 10 interviewers.</p> : null}
        </fieldset>
      </form>
    </Drawer>
  );
}

/** One interviewer's recommendation and notes; they may change it later. */
export function FeedbackForm({ interview, name, onClose, onSaved }) {
  const [recommendation, setRec] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    if (!recommendation) { setError({ message: 'Pick a recommendation.' }); return; }
    setBusy(true);
    setError(null);
    try { await giveFeedback(interview.id, { recommendation, notes: notes.trim() || null }); notify.success('Feedback given.'); onSaved(); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={Boolean(recommendation || notes.trim())} title={`Feedback on ${name}`}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Give feedback" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormError error={error} />
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Would you take them on? *</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {RECOMMENDATIONS.map(([v, l]) => (
              <label key={v} className={`ui-btn ${recommendation === v ? 'ui-btn-primary' : 'ui-btn-secondary'}`}>
                <input type="radio" className="sr-only" name="recommendation" value={v} checked={recommendation === v} onChange={() => setRec(v)} />{l}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block sm:col-span-2"><span className="ui-label">What you saw</span><textarea className="ui-input w-full" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </form>
    </Drawer>
  );
}

/** Someone offered the job becomes an employee: their joining date and, if the company sets it, their ID. */
function HireDrawer({ candidate, acceptedJoining, onClose, onDone }) {
  const [dateOfJoining, setDate] = useState(acceptedJoining || todayIst());
  const next = useRequest(() => nextEmployeeCode().catch(() => ''), []);
  const [typed, setCode] = useState(null);
  const code = typed ?? next.data ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const hire = async () => {
    if (!dateOfJoining) { setError({ message: 'Choose the joining date.' }); return; }
    setBusy(true);
    setError(null);
    try {
      const { employee } = await hireCandidate(candidate.id, { dateOfJoining, code: code.trim() || null });
      notify.success(`${employee.name} is now an employee. Their joining plan has started.`);
      onDone(employee);
    } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={`Hire ${candidate.name}`}
      footer={<Footer onCancel={onClose} onSave={hire} busy={busy} label="Hire" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); hire(); }}>
        <FormError error={error} />
        <div><label className="ui-label" htmlFor="hire-date">Joining date *</label><DatePicker id="hire-date" value={dateOfJoining} onChange={(v) => setDate(v || '')} /></div>
        <label className="block"><span className="ui-label">Employee ID</span><SuggestInput maxLength={40} value={code} onChange={setCode} suggestions={next.data ? [{ value: next.data, hint: 'Next ID' }] : []} /></label>
        <p className="sm:col-span-2 ui-caption">Their record takes the opening’s department, designation, branch and hiring manager.</p>
      </form>
    </Drawer>
  );
}

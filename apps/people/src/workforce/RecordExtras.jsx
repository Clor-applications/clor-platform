import React, { useEffect, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { currentUser, orgId as currentOrgId, branchId as currentBranchId } from '@platform/context';
import { featuresFor } from '@platform/auth';

import { appAccessSends, decideProbation, getProbation, listAssets, policiesFor, saveProbationReview } from './api';
import { getCelebrationsFor, setCelebrationsFor } from '../api/engagement';
import Toggle from '../components/Toggle';
import { todayIst } from '@ui/utils/dates';

/*
 * Parts of the employee record that each read one more thing the server
 * keeps (FEATURE-UI-AUDIT 30 Oct 2026, gaps 8 and 22): the probation review
 * and decision, the policies that apply to this person, the assets they
 * hold, and when they were sent employee app access.
 */

const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
/* A moment (saved, accepted) as India's calendar day, not the UTC date. */
const onDay = (t) => (t ? formatDate(new Date(new Date(t).getTime() + 330 * 60_000).toISOString().slice(0, 10)) : '');

/* `writeAllowed`: the record screen is read-only for someone without Employees edit (WriteGuard), but a manager
   may still write a probation review with Lifecycle edit; the server checks that grant itself. */
function Part({ title, count = null, action = null, writeAllowed = false, children }) {
  return (
    <section className="ui-record-section" aria-label={title} data-write-allowed={writeAllowed ? '' : undefined}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <h2 className="ui-t-sec">{title}{count != null ? <span className="ui-section-count tabular-nums">{count}</span> : null}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Probation (gap 8) */

const RECOMMENDATION = { CONFIRM: 'Confirm', EXTEND: 'Extend', END: 'End employment' };
const recommendationWords = (r) => (r.recommendation === 'EXTEND' && r.newEndDate ? `Extend to ${day(r.newEndDate)}` : RECOMMENDATION[r.recommendation] || 'No recommendation yet');

/**
 * Probation: the manager's review (goals, what was seen, a recommendation),
 * then the decision. Whoever may review writes it; whoever may approve
 * decides, with the review in front of them and its recommendation filled
 * in. Nobody reviews or decides their own (the server refuses it too).
 */
export function ProbationSection({ person, canReview, canDecide, onDecided }) {
  const reviews = useRequest(() => getProbation(person.id), [person.id, person.version]);
  const open = (reviews.data || []).find((r) => !r.outcome) || null;
  const own = Boolean(person.userId) && person.userId === currentUser()?.id;
  const [writing, setWriting] = useState(false);
  const [extendTo, setExtendTo] = useState('');
  const [endOn, setEndOn] = useState('');
  /* The review's recommendation fills in its own row: the date to extend to, ready to confirm. */
  const extendOn = extendTo || (open?.recommendation === 'EXTEND' ? open.newEndDate || '' : '');
  const decide = async (outcome) => {
    const ask = {
      CONFIRM: { title: `Confirm ${person.name} after probation?`, confirmLabel: 'Confirm', tone: 'primary' },
      EXTEND: { title: `Extend probation to ${formatDate(extendOn)}?`, confirmLabel: 'Extend', tone: 'primary' },
      END: { title: `End ${person.name}’s employment after probation?`, message: `Their last day is ${formatDate(endOn)}. The leaving checklist starts.`, confirmLabel: 'End employment' },
    }[outcome];
    if (!(await confirmDialog(ask))) return;
    try {
      const r = await decideProbation(person.id, outcome === 'CONFIRM' ? { outcome } : outcome === 'EXTEND' ? { outcome, newEndDate: extendOn } : { outcome, lastDay: endOn });
      notify.success(r.request ? `Sent for approval: ${r.request.title}.` : { CONFIRM: 'Confirmed.', EXTEND: 'Probation extended.', END: 'Employment ends after probation.' }[outcome]);
      setExtendTo('');
      setEndOn('');
      onDecided?.();
      reviews.reload();
    } catch (e) { notify.error(String(e?.message || 'Not saved.')); }
  };
  const mayReview = canReview && !own;
  const mayDecide = canDecide && !own;
  const recommended = open?.recommendation;
  return (
    <Part title="Probation" writeAllowed={mayReview} action={mayReview && !reviews.loading ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setWriting(true)}>{open ? 'Edit review' : 'Write review'}</button> : null}>
      <p className="text-sm mb-3">Ends <span className="tabular-nums">{day(person.probationEndDate)}</span>{String(person.probationEndDate).slice(0, 10) < todayIst() ? ', not confirmed yet.' : '.'}</p>
      {reviews.error ? <ErrorState error={reviews.error} onRetry={reviews.reload} compact /> : open ? (
        <dl className="ui-field-grid mb-4" aria-label="Review">
          <div className="ui-field-row sm:col-span-2"><dt className="ui-caption">Goals</dt><dd className="text-sm whitespace-pre-wrap">{open.goals || <span className="ui-muted">Not written</span>}</dd></div>
          <div className="ui-field-row sm:col-span-2"><dt className="ui-caption">What was seen</dt><dd className="text-sm whitespace-pre-wrap">{open.observations || <span className="ui-muted">Not written</span>}</dd></div>
          <div className="ui-field-row"><dt className="ui-caption">Recommendation</dt><dd className="text-sm">{recommendationWords(open)}</dd></div>
          <div className="ui-field-row"><dt className="ui-caption">Reviewed</dt><dd className="text-sm">{open.reviewedBy ? `${open.reviewedBy}, ` : ''}<span className="tabular-nums">{onDay(open.updatedAt)}</span></dd></div>
          {open.note ? <div className="ui-field-row sm:col-span-2"><dt className="ui-caption">Note</dt><dd className="text-sm">{open.note}</dd></div> : null}
        </dl>
      ) : !reviews.loading ? <p className="text-sm ui-muted mb-4">{mayReview ? 'No review yet. The manager writes the goals, what they saw and what they recommend.' : 'No review yet.'}</p> : null}
      {own ? <p className="ui-caption">Someone else reviews and decides your own probation.</p> : null}
      {mayDecide ? (
        /* One decision, three outcomes: a row each, so the choice reads down the page; the recommended one says so. */
        <div className="ui-decide">
          <div className="ui-decide-row">
            <span className="ui-decide-label">Passed{recommended === 'CONFIRM' ? <><span className="ui-pill ui-pill-info ml-2" aria-hidden="true">Recommended</span><span className="sr-only">, recommended</span></> : null}</span>
            <span />
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => decide('CONFIRM')}>Confirm</button>
          </div>
          <div className="ui-decide-row">
            <label className="ui-decide-label" htmlFor="prob-extend">Extend to{recommended === 'EXTEND' ? <><span className="ui-pill ui-pill-info ml-2" aria-hidden="true">Recommended</span><span className="sr-only">, recommended</span></> : null}</label>
            <DatePicker id="prob-extend" value={extendOn} min={person.probationEndDate} onChange={setExtendTo} />
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!extendOn} onClick={() => decide('EXTEND')}>Extend</button>
          </div>
          <div className="ui-decide-row">
            <label className="ui-decide-label" htmlFor="prob-end">End on{recommended === 'END' ? <><span className="ui-pill ui-pill-info ml-2" aria-hidden="true">Recommended</span><span className="sr-only">, recommended</span></> : null}</label>
            <DatePicker id="prob-end" value={endOn} min={String(person.dateOfJoining || '').slice(0, 10)} onChange={setEndOn} />
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!endOn} onClick={() => decide('END')}>End employment</button>
          </div>
        </div>
      ) : null}
      {writing ? <ProbationReviewDrawer person={person} review={open} onClose={() => setWriting(false)} onSaved={() => { setWriting(false); reviews.reload(); }} /> : null}
    </Part>
  );
}

export function ProbationReviewDrawer({ person, review, onClose, onSaved }) {
  const initial = { goals: review?.goals || '', observations: review?.observations || '', recommendation: review?.recommendation || '', newEndDate: review?.newEndDate || '', note: review?.note || '' };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const needsDate = form.recommendation === 'EXTEND' && !form.newEndDate;
  const save = async (e) => {
    e?.preventDefault();
    if (busy || needsDate) return;
    setBusy(true);
    setError(null);
    try {
      await saveProbationReview(person.id, { ...form, newEndDate: form.recommendation === 'EXTEND' ? form.newEndDate : '' });
      notify.success('Review saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={`Probation review: ${person.name}`} dirty={dirty}
      footer={<span className="contents" data-write-allowed=""><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="probation-review" className="ui-btn ui-btn-primary" disabled={busy || needsDate || !dirty}>{busy ? 'Saving…' : 'Save review'}</button></span>}>
      <form id="probation-review" className="grid gap-4" onSubmit={save} data-write-allowed="">
        {error ? <ErrorState error={error} compact onRetry={save} retryLabel="Try again" body={error?.status === 400 || error?.status === 409 ? error.message : undefined} /> : null}
        <label className="block"><span className="ui-label">Goals agreed</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} /></label>
        <label className="block"><span className="ui-label">What you saw</span><textarea className="ui-input w-full" rows={4} maxLength={4000} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="Recommendation" value={form.recommendation} placeholder="Choose…" onChange={(v) => setForm({ ...form, recommendation: v || '' })}
          options={[{ value: '', label: 'Not yet' }, ...Object.entries(RECOMMENDATION).map(([value, label]) => ({ value, label }))]} /></div>
        {form.recommendation === 'EXTEND' ? <div><label className="ui-label" htmlFor="review-extend">Extend to *</label><DatePicker id="review-extend" value={form.newEndDate} min={person.probationEndDate} onChange={(v) => setForm({ ...form, newEndDate: v || '' })} /></div> : null}
        <label className="block"><span className="ui-label">Note for HR</span><textarea className="ui-input w-full" rows={2} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ Policies for one person (gap 22) */

/** What applies to this person today, and whether they accepted the ones that ask for it: HR's view of what the employee app shows them. */
export function PersonPolicies({ employeeId, openScreen }) {
  const req = useRequest(() => policiesFor(employeeId), [employeeId]);
  if (req.loading) return null;
  const rows = req.data || [];
  return (
    <Part title="Policies that apply" count={rows.length || null}>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !rows.length ? <p className="text-sm ui-muted">No published policy applies to them yet.</p> : (
        <ul className="divide-y border-t text-sm" aria-label="Policies that apply">
          {rows.map((p) => (
            <li key={p.versionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                {openScreen ? <button type="button" className="ui-link font-medium text-left" onClick={() => openScreen('policies', { id: p.policyId })}>{p.title}</button> : <span className="font-medium">{p.title}</span>}
                <span className="block ui-caption">{p.categoryLabel} · version {p.version} · from <span className="tabular-nums">{day(p.effectiveFrom)}</span></span>
              </span>
              {p.acceptedAt ? <span className="ui-pill ui-pill-pos">Accepted {onDay(p.acceptedAt)}</span>
                : p.acknowledgementId ? <span className="ui-pill ui-pill-warn">Not accepted yet</span>
                  : p.needsAcceptance ? <span className="ui-pill ui-pill-neutral">Not asked yet</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Part>
  );
}

/* ------------------------------------------------------------------ Assets they hold (gap 22) */

const ASSET_WORD = { ASSIGNED: 'With them', RETURNED: 'Returned', REPAIR: 'In repair', AVAILABLE: 'Available', RETIRED: 'Retired' };

/** Shown only when the company keeps an assets register (Pay, benefits & assets on) and the viewer may read it. */
export function PersonAssets({ employeeId, openScreen }) {
  const [state, setState] = useState({ on: null, rows: [], error: null });
  useEffect(() => {
    let live = true;
    featuresFor(currentOrgId(), currentBranchId())
      .then((r) => {
        if (!r?.features?.peopleBenefits) { if (live) setState({ on: false, rows: [], error: null }); return null; }
        return listAssets(employeeId).then((rows) => live && setState({ on: true, rows: rows.filter((a) => a.employeeId === employeeId), error: null }));
      })
      .catch((e) => live && setState({ on: true, rows: [], error: e }));
    return () => { live = false; };
  }, [employeeId]);
  if (!state.on) return null;
  const held = state.rows.filter((a) => a.status === 'ASSIGNED');
  const earlier = state.rows.filter((a) => a.status !== 'ASSIGNED');
  return (
    <Part title="Assets" count={held.length || null} action={openScreen ? <button type="button" className="ui-link text-sm" onClick={() => openScreen('assets')}>Open the register</button> : null}>
      {state.error ? <p className="text-sm ui-muted">The assets register could not be read.</p> : !state.rows.length ? <p className="text-sm ui-muted">They hold nothing from the assets register.</p> : (
        <ul className="divide-y border-t text-sm" aria-label="Assets">
          {[...held, ...earlier].map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{a.title}</span>
                <span className="block ui-caption">{[a.details?.assetTag, a.details?.category, a.details?.issuedOn ? `issued ${day(a.details.issuedOn)}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={`ui-pill ${a.status === 'ASSIGNED' ? 'ui-pill-info' : 'ui-pill-neutral'}`}>{ASSET_WORD[a.status] || a.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Part>
  );
}

/* ------------------------------------------------------------------ Employee app access sent (gap 22) */

const CHANNEL_WORD = { EMAIL: 'By e-mail', PRINT: 'Code handed over' };

/** When this person was sent employee app access, how, and until when the code worked. Never the code. */
export function AppAccessHistory({ employeeId, canSend, onSend }) {
  const req = useRequest(() => appAccessSends(employeeId), [employeeId]);
  const rows = req.data || [];
  const until = (r) => new Date(r.expiresAt) > new Date() ? `works until ${new Date(r.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` : 'code ran out';
  return (
    <Part title="Employee app access" count={rows.length || null} action={canSend ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onSend}>{rows.length ? 'Send again' : 'Send access'}</button> : null}>
      {req.loading ? <span className="ui-skel ui-skel-text" /> : req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !rows.length ? <p className="text-sm ui-muted">Not sent yet.</p> : (
        <ul className="divide-y border-t text-sm" aria-label="Access sent">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="tabular-nums whitespace-nowrap">{new Date(r.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="min-w-0 flex-1">{CHANNEL_WORD[r.channel] || r.channel}{r.channel === 'EMAIL' && r.sentTo ? ` to ${r.sentTo}` : ''}</span>
              <span className="ui-caption">{until(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </Part>
  );
}

/**
 * Birthdays and work anniversaries (WORKFLOW-GAP-RESEARCH 4.8): whether the team is told. The person turns it
 * off in the employee app; HR records it here for someone who asked in person. The year of birth is never shown.
 */
export function PersonCelebrations({ employeeId }) {
  const req = useRequest(() => getCelebrationsFor(employeeId), [employeeId]);
  const [busy, setBusy] = useState(false);
  if (req.error) return null;
  const d = req.data;
  const change = async (on) => {
    setBusy(true);
    try {
      await setCelebrationsFor(employeeId, !on);
      notify.success(on ? 'They will be announced again.' : 'They will not be announced.');
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Part title="Birthdays and anniversaries">
      {!d ? <span className="ui-skel ui-skel-text" /> : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm">{d.optedOut ? 'Not announced: they asked not to be.' : 'Announced to their team on their birthday and work anniversary.'}{d.canEdit ? '' : ' HR changes this.'}</p>
          <Toggle checked={!d.optedOut} disabled={!d.canEdit || busy} label="Announce their birthday and work anniversary" onChange={change} />
        </div>
      )}
    </Part>
  );
}

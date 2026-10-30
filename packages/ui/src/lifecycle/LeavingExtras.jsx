import React, { useMemo, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { hasApp } from '@platform/context';

import { addClearanceLine, decideExitInterview, enterExitInterview, orgUsers, removeClearanceLine, updateClearanceLine, withOwner } from './api';

/**
 * The leaving plan's money and goodbye (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.9): the final-pay clock,
 * the no-dues sign-off (one line per department, signed by its owner or HR), and the exit interview.
 * Clearance never holds up final wages: an open line is a warning, the clock runs regardless.
 */

/* Paise as two figures, or none: ₹1,250.50, not ₹1,250.5. */
const rupees = (n) => { const v = Number(n || 0); return `₹${v.toLocaleString('en-IN', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The clock in words: tone, headline and the line under it. */
function finalPayWords(c) {
  if (!c) return null;
  if (c.paid) return { tone: 'pos', title: 'Final pay paid', detail: `${c.paidOnPlan ? 'Marked paid on the plan. ' : ''}Last day ${formatDate(c.lastDay)}.` };
  if (c.held) return { tone: 'info', title: 'Final pay held', detail: `${c.held.reason || 'Held'}. What they earned stays owed; release the hold under Absences.` };
  if (c.overdue) return { tone: 'neg', title: `Final pay was due ${formatDate(c.dueDate)}`, detail: `${plural(Math.abs(c.daysLeft), 'working day')} late. Last day ${formatDate(c.lastDay)}.` };
  if (!c.started) return { tone: 'info', title: `Final pay due ${formatDate(c.dueDate)}`, detail: `Two working days after the last day, ${formatDate(c.lastDay)}.` };
  if (c.daysLeft <= 0) return { tone: 'warn', title: 'Final pay due today', detail: `Last day was ${formatDate(c.lastDay)}.` };
  return { tone: 'warn', title: `Final pay due ${formatDate(c.dueDate)}`, detail: `${plural(c.daysLeft, 'working day')} left. Last day ${formatDate(c.lastDay)}.` };
}

const SETTLEMENT_WORD = { DRAFT: 'drafted in Payroll', APPROVED: 'approved in Payroll, not paid yet', PAID: 'paid' };

/** The countdown banner: on the leaving plan, and per leaver on Home. */
export function FinalPayBanner({ clock, name, showRule = true, action = null }) {
  const w = finalPayWords(clock);
  if (!w) return null;
  return (
    <div className={`ui-alert ui-alert-${w.tone} rounded-xl`} role="status">
      <div className="min-w-0 flex-1">
        <p className="ui-alert-title">{name ? `${name}: ${w.title.charAt(0).toLowerCase()}${w.title.slice(1)}` : w.title}</p>
        <p className="ui-alert-body">
          {w.detail}
          {clock.paid ? '' : clock.payrollUnknown ? ' Payroll could not be read just now.' : clock.settlement ? ` Settlement ${SETTLEMENT_WORD[clock.settlement.status] || clock.settlement.status.toLowerCase()}.` : hasApp('payroll') ? ' No settlement in Payroll yet.' : ' Tick “Final wages paid” on the plan once it is paid.'}
        </p>
        {showRule && !clock.paid ? <p className="ui-caption mt-1">{clock.rule}</p> : null}
      </div>
      {action || (hasApp('payroll') && !clock.paid) ? (
        <span className="ui-alert-action flex flex-col items-end gap-1 text-sm">
          {action}
          {hasApp('payroll') && !clock.paid ? <a className="ui-link whitespace-nowrap" href="?app=payroll&open=settlements">Full and final</a> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Home with several leavers waiting: one alert with a row each, not a stack of alerts pushing the page down a phone. */
export function FinalPayList({ rows, onOpen, onMore, limit = 3 }) {
  const worst = rows.some((r) => r.overdue && !r.held) ? 'neg' : 'warn';
  return (
    <div className={`ui-alert ui-alert-${worst} rounded-xl`} role="status">
      <div className="min-w-0 flex-1">
        <p className="ui-alert-title">Final pay is waiting for {rows.length} leavers</p>
        <ul className="mt-1 space-y-1">
          {rows.slice(0, limit).map((r) => (
            <li key={r.employeeId} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0"><span className="font-medium">{r.name}</span> <span className="ui-alert-body">{finalPayWords(r).title.charAt(0).toLowerCase()}{finalPayWords(r).title.slice(1)}</span></span>
              <button type="button" className="ui-link inline-flex min-h-11 shrink-0 items-center whitespace-nowrap sm:min-h-0" onClick={onOpen(r.employeeId)}>Open plan</button>
            </li>
          ))}
        </ul>
        {rows.length > limit ? <button type="button" className="ui-link mt-1 text-sm" onClick={onMore}>{rows.length - limit} more</button> : null}
      </div>
    </div>
  );
}

const DIRECTION = [
  { value: 'NONE', label: 'Nothing owed' },
  { value: 'OWES', label: 'They owe the company' },
  { value: 'OWED', label: 'The company owes them' },
];
const moneyLine = (l) => (l.direction === 'OWES' ? `Owes ${rupees(l.amount)}` : l.direction === 'OWED' ? `Owed ${rupees(l.amount)}` : null);

/** One line opened: what came back, money either way, a note, the owner (HR), and the sign-off. */
function LineDrawer({ line, canEdit, onClose, onSaved }) {
  const signed = line.status === 'CLEAR';
  const [items, setItems] = useState(line.items);
  /* Money is HR's and the line owner's: for anyone else the server sends none of it. */
  const money = !line.moneyHidden;
  const [direction, setDirection] = useState(line.direction || 'NONE');
  const [amount, setAmount] = useState(line.amount ? String(line.amount) : '');
  const [note, setNote] = useState(line.note || '');
  const [owner, setOwner] = useState(line.ownerUserId || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const users = useRequest(() => (canEdit ? orgUsers() : Promise.resolve([])), [canEdit]);
  const body = () => ({
    items,
    ...(money ? { direction, ...(direction === 'NONE' ? {} : { amount: Number(amount) }), note: note.trim() || null } : {}),
    ...(canEdit && owner !== (line.ownerUserId || '') ? { ownerUserId: owner || null } : {}),
    seenAt: line.updatedAt,
  });
  const dirty = JSON.stringify(items) !== JSON.stringify(line.items) || (money && (direction !== line.direction || (direction !== 'NONE' && Number(amount) !== Number(line.amount)) || note.trim() !== (line.note || ''))) || (canEdit && owner !== (line.ownerUserId || ''));
  const run = async (kind) => {
    if (direction !== 'NONE' && !(Number(amount) > 0)) { setError('Enter how much is owed.'); return; }
    setBusy(kind);
    setError('');
    try {
      if (kind === 'reopen') await updateClearanceLine(line.id, { sign: false });
      else await updateClearanceLine(line.id, { ...body(), ...(kind === 'sign' ? { sign: true } : {}) });
      notify.success(kind === 'sign' ? `${line.label}: signed off.` : kind === 'reopen' ? 'Opened again.' : 'Saved.');
      onSaved?.();
    } catch (e) {
      setError(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Remove “${line.label}”?`, message: 'The line goes from this leaving plan.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await removeClearanceLine(line.id);
      onSaved?.();
    } catch (e) {
      setError(String(e?.message || 'Not removed.'));
    }
  };
  const open = !signed && line.canSign;
  /*
   * The line's owner may sign and save it whatever the screen's own rights (the server checks: Employees view
   * and being the owner). The screen-wide write guard would read "Sign off" as an approval and the screen as
   * view only, so the drawer says this line is theirs to act on; nothing else on the screen is widened.
   */
  const mayAct = line.canSign ? { 'data-write-allowed': 'true' } : {};
  return (
    <Drawer open onClose={onClose} dirty={dirty && !busy} widthClass="w-[min(34rem,96vw)]" title={`${line.deptWord}: ${line.label}`}
      footer={<div className="contents" {...mayAct}>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>{open ? 'Cancel' : 'Close'}</button>
        {signed && canEdit ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => run('reopen')}>{busy === 'reopen' ? 'Opening…' : 'Open again'}</button> : null}
        {open && dirty ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => run('save')}>{busy === 'save' ? 'Saving…' : 'Save'}</button> : null}
        {open ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => run('sign')}>{busy === 'sign' ? 'Signing…' : 'Sign off'}</button> : null}
      </div>}>
      <div className="grid gap-5" {...mayAct}>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="ui-label">Owner</dt><dd className="mt-0.5">{line.ownerName || 'Nobody named: HR signs it'}</dd></div>
          <div><dt className="ui-label">State</dt><dd className="mt-0.5">{signed ? `Signed off${line.signedBy ? ` by ${line.signedBy}` : ''}${line.signedAt ? `, ${formatDate(String(line.signedAt).slice(0, 10))}` : ''}` : 'Open'}</dd></div>
        </dl>
        {!line.canSign && !signed ? <p className="text-sm">{line.ownerName || 'Its owner'} or HR signs this line.</p> : null}
        {items.length && !open ? (
          /* Not theirs to change, or already signed: what came back, as words, not boxes that look tickable. */
          <div className="space-y-1">
            <p className="ui-label">{line.dept === 'MANAGER' ? 'To do' : 'To hand back'}</p>
            <ul className="divide-y border-t text-sm" aria-label={line.dept === 'MANAGER' ? 'To do' : 'To hand back'}>
              {items.map((it, i) => (
                <li key={`${it.title}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span>{it.title}{it.tag ? <span className="ui-caption"> · {it.tag}</span> : null}</span>
                  <span className="ui-caption shrink-0">{it.returned ? (line.dept === 'MANAGER' ? 'Done' : 'Back') : (line.dept === 'MANAGER' ? 'Not yet' : 'Not back yet')}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : items.length ? (
          <fieldset className="space-y-2">
            <legend className="ui-label">{line.dept === 'MANAGER' ? 'To do' : 'To hand back'}</legend>
            {items.map((it, i) => (
              <label key={`${it.title}-${i}`} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={it.returned} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, returned: e.target.checked } : x)))} />
                <span>{it.title}{it.tag ? <span className="ui-caption"> · {it.tag}</span> : null}</span>
              </label>
            ))}
            {items.some((i) => i.assetId) ? <p className="ui-caption">An asset ticked here is marked Returned in the asset register too.</p> : null}
          </fieldset>
        ) : null}
        {money ? <fieldset className="grid gap-3 sm:grid-cols-2" disabled={!open}>
          <div><PopupSelect label="Money" showValueSubtext={false} value={direction} onChange={(v) => { setDirection(v || 'NONE'); setError(''); }} options={DIRECTION} /></div>
          {direction !== 'NONE' ? (
            <label className="block">
              <span className="ui-label">Amount (₹) *</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" className="ui-input w-full tabular-nums text-right" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} aria-invalid={Boolean(error) || undefined} />
            </label>
          ) : null}
        </fieldset> : null}
        {money ? <label className="block">
          <span className="ui-label">Note</span>
          <textarea className="ui-input w-full" rows={2} maxLength={500} value={note} disabled={!open} onChange={(e) => setNote(e.target.value)} />
        </label> : null}
        {canEdit && !signed ? <div><PopupSelect label="Whose line" showValueSubtext={false} value={owner} onChange={(v) => setOwner(v || '')} options={[{ value: '', label: 'Nobody yet' }, ...withOwner(users.data || [], line.ownerUserId, line.ownerName).map((u) => ({ value: u.id, label: u.fullName || u.name || u.email }))]} /></div> : null}
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        {canEdit && !signed && line.dept === 'CUSTOM' ? <div><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={remove}>Remove this line</button></div> : null}
      </div>
    </Drawer>
  );
}

function AddLine({ employeeId, existing, onAdded }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hints = ['Uniform', 'Library books', 'Petty cash', 'Company SIM card', 'Vehicle and fuel card', 'Tools'].filter((h) => !existing.includes(h));
  const add = async (e) => {
    e.preventDefault();
    if (label.trim().length < 2) { setError('Name the line.'); return; }
    setBusy(true);
    setError('');
    try {
      await addClearanceLine(employeeId, { label: label.trim() });
      setLabel('');
      onAdded?.();
    } catch (err) {
      setError(String(err?.message || 'Not added.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex items-end gap-2" onSubmit={add}>
      <label className="block min-w-0 flex-1">
        <span className="ui-label">Add a line</span>
        <SuggestInput maxLength={80} value={label} onChange={(v) => { setLabel(v); setError(''); }} suggestions={hints} placeholder="Uniform, petty cash…" aria-invalid={Boolean(error) || undefined} />
        {error ? <span className="ui-field-error" role="alert">{error}</span> : null}
      </label>
      <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
    </form>
  );
}

function Clearance({ data, employeeId, canEdit, onChanged }) {
  const [open, setOpen] = useState(null);
  if (!data?.lines?.length) return null;
  const { lines, totals } = data;
  return (
    <section aria-label="No-dues" className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="ui-t-sec">No-dues</h3><span className="ui-caption tabular-nums">{lines.length - data.open} of {lines.length} signed</span></div>
      <ul className="divide-y border-t">
        {lines.map((l) => (
          <li key={l.id}>
            <button type="button" className="flex w-full items-start gap-3 py-2 text-left" onClick={() => setOpen(l)}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${l.status === 'CLEAR' ? 'ui-dot-pos' : 'ui-dot-quiet'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{l.deptWord}: {l.label}<span className="sr-only">{l.status === 'CLEAR' ? ', signed off' : ', open'}</span></span>
                <span className="block ui-caption">
                  {l.status === 'CLEAR' ? `Signed off${l.signedBy ? ` by ${l.signedBy}` : ''}` : l.ownerName || 'Nobody named'}
                  {l.items.length ? ` · ${l.items.filter((i) => i.returned).length} of ${l.items.length} ${l.dept === 'MANAGER' ? 'done' : 'back'}` : ''}
                  {l.mine && l.status !== 'CLEAR' ? ' · yours to sign' : ''}
                </span>
              </span>
              {moneyLine(l) ? <span className="shrink-0 text-sm tabular-nums text-right">{moneyLine(l)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {totals?.owes || totals?.owed ? (
        <p className="flex justify-between gap-3 text-sm"><span className="ui-muted">For the full and final</span><span className="tabular-nums text-right">{[totals.owes ? `They owe ${rupees(totals.owes)}` : null, totals.owed ? `${totals.owes ? 'owed' : 'Owed'} to them ${rupees(totals.owed)}` : null].filter(Boolean).join(' · ')}</span></p>
      ) : null}
      {data.found?.loansUnknown ? <p className="ui-caption" role="status">Payroll could not be read, so loans are not checked here. Look in Payroll before signing off.</p> : null}
      {data.open ? <p className="ui-caption">Open lines are a reminder only: they never hold up final wages.</p> : null}
      {canEdit && data.leaving ? <AddLine employeeId={employeeId} existing={lines.map((l) => l.label)} onAdded={onChanged} /> : null}
      {open ? <LineDrawer line={open} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onChanged?.(); }} /> : null}
    </section>
  );
}

/** The questions as a form: one choice chip per answer, text answers as short boxes. Shared with the employee app. */
export function ExitQuestionsForm({ questions, answers, onChange, idPrefix = 'exit' }) {
  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <fieldset key={q.key} className="space-y-1.5">
          <legend className="ui-label">{q.text}{q.kind !== 'TEXT' ? ' *' : ''}</legend>
          {q.kind === 'TEXT' ? (
            <textarea id={`${idPrefix}-${q.key}`} aria-label={q.text} className="ui-input w-full" rows={2} maxLength={2000} value={answers[q.key] || ''} onChange={(e) => onChange({ ...answers, [q.key]: e.target.value })} />
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label={q.text}>
              {(q.options || []).map((o) => (
                <button key={o.code} type="button" aria-pressed={answers[q.key] === o.code} className="ui-choice-chip min-h-11 sm:min-h-0" onClick={() => onChange({ ...answers, [q.key]: o.code })}>{o.label}</button>
              ))}
            </div>
          )}
        </fieldset>
      ))}
    </div>
  );
}

const missingChoice = (questions, answers) => questions.find((q) => q.kind !== 'TEXT' && !answers[q.key]);

function EnterDrawer({ interview, employeeId, name, onClose, onSaved }) {
  const [answers, setAnswers] = useState({});
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault();
    const miss = missingChoice(interview.questions, answers);
    if (miss) { setError(`Answer “${miss.text}”.`); return; }
    setBusy(true);
    setError('');
    try {
      await enterExitInterview(employeeId, { answers, hideFromManager: hide });
      notify.success('Exit interview saved.');
      onSaved?.();
    } catch (err) {
      setError(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} dirty={Object.keys(answers).length > 0 && !busy} widthClass="w-[min(36rem,96vw)]" title={`Exit interview: ${name}`}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="exit-enter" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save answers'}</button></>}>
      <form id="exit-enter" onSubmit={send} className="space-y-4">
        <p className="ui-caption">From your conversation with them. They will not be asked in the app once this is saved.</p>
        <ExitQuestionsForm questions={interview.questions} answers={answers} onChange={(a) => { setAnswers(a); setError(''); }} idPrefix="hr-exit" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />They asked to keep this from their managers</label>
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
      </form>
    </Drawer>
  );
}

const COULD_KEEP = [{ value: '', label: 'Not decided' }, { value: 'YES', label: 'Yes' }, { value: 'MAYBE', label: 'Maybe' }, { value: 'NO', label: 'No' }];
const OUTCOME_WORD = { EXIT_CONFIRMED: 'Exit confirmed', RETAINED: 'Retained: they stay' };

function ExitInterview({ interview: iv, employeeId, name, onChanged }) {
  const [entering, setEntering] = useState(false);
  const [busy, setBusy] = useState('');
  const answered = useMemo(() => (iv?.answers ? iv.questions.filter((q) => iv.answers[q.key]).map((q) => {
    const a = iv.answers[q.key];
    return { q: q.text, a: q.options?.find((o) => o.code === a)?.label || a };
  }) : []), [iv]);
  if (!iv) return null;
  const decide = async (body, word) => {
    if (body.outcome === 'RETAINED' && !(await confirmDialog({ title: `Keep ${name}?`, message: 'Their leaving is withdrawn: they are active again, the last day is cleared and the open leaving steps are closed as not needed.', confirmLabel: 'They stay', tone: 'primary' }))) return;
    setBusy(word);
    try {
      await decideExitInterview(employeeId, body);
      notify.success(body.outcome ? OUTCOME_WORD[body.outcome] : 'Saved.');
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  return (
    <section aria-label="Exit interview" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="ui-t-sec">Exit interview</h3>
        <span className={`ui-pill ${iv.status === 'SUBMITTED' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{iv.status === 'SUBMITTED' ? (iv.enteredBy === 'HR' ? 'Entered by HR' : 'Answered') : 'Not answered yet'}</span>
      </div>
      {iv.status !== 'SUBMITTED' ? (
        <p className="text-sm">{iv.appAccess === false
          ? `They have no employee app access, so they cannot answer it themselves.${iv.canEnter ? ' Enter the answers from a conversation.' : ' HR enters the answers from a conversation.'}`
          : `They can answer in the employee app, under Me${iv.dueBy ? `, until ${formatDate(iv.dueBy)}` : ''}.${iv.canEnter ? ' Or enter the answers from a conversation.' : ''}`}</p>
      ) : iv.hiddenFromYou ? (
        <p className="text-sm">Answered{iv.submittedAt ? ` on ${formatDate(String(iv.submittedAt).slice(0, 10))}` : ''}. They asked to keep the answers from their managers; HR reads them.</p>
      ) : iv.erased ? (
        <p className="text-sm">The answers were erased after the keeping period. Main reason: {iv.reasonLabel || 'not given'}.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          {answered.map((x) => <div key={x.q}><dt className="ui-caption">{x.q}</dt><dd className="whitespace-pre-line">{x.a}</dd></div>)}
          {iv.hideFromManager ? <p className="ui-caption">Kept from their managers, as they asked.</p> : null}
        </dl>
      )}
      {iv.canEnter ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEntering(true)}>Enter answers</button> : null}
      {iv.canDecide ? (
        <div className="grid gap-3 pt-1">
          <div className="max-w-xs"><PopupSelect label="Could we have kept them?" placeholder="Not decided" showValueSubtext={false} value={iv.couldKeep || ''} onChange={(v) => decide({ couldKeep: v || null }, 'keep')} options={COULD_KEEP} /></div>
          {iv.outcome ? <p className="text-sm">Outcome: {OUTCOME_WORD[iv.outcome]}{iv.outcomeAt ? `, ${formatDate(String(iv.outcomeAt).slice(0, 10))}` : ''}.</p> : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => decide({ outcome: 'EXIT_CONFIRMED' }, 'exit')}>{busy === 'exit' ? 'Saving…' : 'Exit confirmed'}</button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => decide({ outcome: 'RETAINED' }, 'stay')}>{busy === 'stay' ? 'Saving…' : 'They stay'}</button>
            </div>
          )}
        </div>
      ) : null}
      <p className="ui-caption">{iv.purpose}</p>
      {entering ? <EnterDrawer interview={iv} employeeId={employeeId} name={name} onClose={() => setEntering(false)} onSaved={() => { setEntering(false); onChanged?.(); }} /> : null}
    </section>
  );
}

/** The plan's No-dues and Exit interview sections, from one read (leavingExtras); the clock's banner sits at the plan's top. */
export default function LeavingSections({ data, employeeId, name, onChanged }) {
  if (!data) return null;
  return (
    <>
      <Clearance data={data.clearance} employeeId={employeeId} canEdit={data.canEdit} onChanged={onChanged} />
      <ExitInterview interview={data.interview} employeeId={employeeId} name={name} onChanged={onChanged} />
    </>
  );
}

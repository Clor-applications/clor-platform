import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, ErrorSummary, FieldMsg, Loading, ReasonDrawer, Tabs, day, may, errorWords, countLine, fieldErr } from './kit';
import { inr, rupeesText, toPaise } from './money';
import { opsOfferSave, opsOfferStep, opsOffers } from './api';

/**
 * Offers (operator console, Billing and setup; server: routes/opsDeals.ts). A code that
 * takes a percent or an amount off a plan, set on a customer by Billing when
 * they make the subscription. Everyone reads; Billing makes, changes, pauses
 * and archives, each with the authenticator code.
 */
const STATUS = {
  active: ['Can be used', 'ws-pill ws-pill--ok'],
  scheduled: ['Starts later', 'ws-pill'],
  paused: ['Paused', 'ws-pill ws-pill--warn'],
  'used-up': ['All places taken', 'ws-pill ws-pill--off'],
  ended: ['Ended', 'ws-pill ws-pill--off'],
  archived: ['Archived', 'ws-pill ws-pill--off'],
};
const TAB_OF = { active: 'active', scheduled: 'active', paused: 'paused', 'used-up': 'over', ended: 'over', archived: 'over' };

const off = (o) => (o.kind === 'PERCENT' ? `${o.value}% off` : `${inr(o.value)} off`);
const lasts = (o) => (o.durationPeriods == null ? 'for as long as they subscribe' : `for the first ${o.durationPeriods} ${o.durationPeriods === 1 ? 'billing period' : 'billing periods'}`);
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function Field({ id, label, hint, errors, k, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <span id={`${id}-hint`} className="ws-card-blurb">{hint}</span> : null}
      {k ? <FieldMsg errors={errors} k={k} idBase="offer" /> : null}
    </div>
  );
}
/* aria-describedby for a field with a hint, and its error line too when there is one. */
const described = (errors, k, hint) => {
  const fe = fieldErr(errors, k, 'offer');
  return { ...fe, 'aria-describedby': [hint, fe['aria-describedby']].filter(Boolean).join(' ') || undefined };
};

function Editor({ editing, plans, onClose, onSaved }) {
  const isNew = editing === 'new';
  const e = isNew ? {} : editing;
  const taken = !isNew && e.redemptions > 0;
  const [f, setF] = useState(() => ({
    code: e.code || '',
    name: e.name || '',
    description: e.description || '',
    kind: e.kind || 'PERCENT',
    value: e.kind === 'AMOUNT' ? rupeesText(e.value) : e.value ? String(e.value) : '',
    planCodes: e.planCodes || [],
    periods: e.periods || [],
    duration: e.durationPeriods == null ? '' : String(e.durationPeriods),
    startsOn: isoDay(e.startsAt),
    endsOn: isoDay(e.endsAt),
    max: e.maxRedemptions == null ? '' : String(e.maxRedemptions),
  }));
  const [start] = useState(() => JSON.stringify(f));
  const dirty = JSON.stringify(f) !== start;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const value = f.kind === 'AMOUNT' ? toPaise(f.value) : Number(f.value);
  const valueOk = f.kind === 'AMOUNT' ? value != null && value > 0 : Number.isInteger(value) && value >= 1 && value <= 100;
  const whole = (v) => /^\d+$/.test(String(v).trim());
  /* Every problem at once, each on its field. */
  const problems = () => {
    const bad = {};
    if (!taken && !/^[A-Za-z0-9][A-Za-z0-9-]{2,23}$/.test(f.code.trim())) bad.code = 'The code is 3 to 24 letters, numbers or dashes, like DIWALI25.';
    if (f.name.trim().length < 3) bad.name = 'Give the offer a name of 3 characters or more.';
    if (!taken && !valueOk) bad.value = f.kind === 'AMOUNT' ? 'The amount off is in rupees, more than 0, like 500 or 499.50.' : 'The percent off is a whole number from 1 to 100.';
    if (!taken && f.duration && !(whole(f.duration) && Number(f.duration) >= 1 && Number(f.duration) <= 60)) bad.duration = 'Billing periods is a whole number from 1 to 60, or empty.';
    if (f.max && !(whole(f.max) && Number(f.max) >= Math.max(1, e.redemptions || 0))) bad.max = `How many is a whole number, at least ${Math.max(1, e.redemptions || 0)}, or empty.`;
    return bad;
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const bad = problems();
    setErrors(bad);
    if (Object.keys(bad).length) return;
    setBusy(true);
    setError('');
    const body = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      endsOn: f.endsOn || null,
      maxRedemptions: f.max ? Number(f.max) : null,
      ...(taken
        ? {}
        : {
            code: f.code.trim(),
            kind: f.kind,
            value,
            planCodes: f.planCodes,
            periods: f.periods,
            durationPeriods: f.duration ? Number(f.duration) : null,
            startsOn: f.startsOn || null,
          }),
    };
    try {
      const r = await opsOfferSave(isNew ? null : e.id, body);
      onSaved(r.offer, isNew);
    } catch (err) {
      setError(errorWords(err, 'save the offer'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open
      onClose={onClose}
      dirty={dirty || busy}
      title={isNew ? 'New offer' : `Change ${e.code}`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ops-offer" className="ws-btn ws-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Make offer' : 'Save offer'}
          </button>
        </>
      }
    >
      <form id="ops-offer" onSubmit={save} className="grid gap-4" noValidate>
        <ErrorSummary errors={errors} label="Fix these before the offer is saved" />
        {taken ? (
          <p className="ws-notice" role="status">
            {e.redemptions} {e.redemptions === 1 ? 'customer has' : 'customers have'} taken this offer, so its code, price and rules stay. You can change its name, last day and how many may take it.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="offer-code" label="Code" hint="What a salesperson quotes, like DIWALI25." errors={errors} k="code">
            <input id="offer-code" className="ui-input" value={f.code} onChange={(ev) => setF((x) => ({ ...x, code: ev.target.value.toUpperCase() }))} disabled={taken} maxLength={24} autoComplete="off" {...described(errors, 'code', 'offer-code-hint')} />
          </Field>
          <Field id="offer-name" label="Name" errors={errors} k="name">
            <input id="offer-name" className="ui-input" value={f.name} onChange={set('name')} maxLength={80} {...fieldErr(errors, 'name', 'offer')} />
          </Field>
        </div>
        <Field id="offer-desc" label="Note for staff (optional)">
          <input id="offer-desc" className="ui-input" value={f.description} onChange={set('description')} maxLength={300} />
        </Field>
        <fieldset className="grid gap-2" disabled={taken}>
          <legend className="text-sm font-semibold">Takes off</legend>
          <div className="flex flex-wrap items-center gap-3">
            {[
              ['PERCENT', 'A percent'],
              ['AMOUNT', 'An amount'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="offer-kind" checked={f.kind === k} onChange={() => setF((x) => ({ ...x, kind: k, value: '' }))} />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2">
              {f.kind === 'AMOUNT' ? <span aria-hidden="true">₹</span> : null}
              <input className="ui-input tabular-nums" inputMode="decimal" value={f.value} onChange={set('value')} style={{ width: 120 }} aria-label={f.kind === 'PERCENT' ? 'Percent off' : 'Rupees off each period'} {...fieldErr(errors, 'value', 'offer')} />
              {f.kind === 'PERCENT' ? <span aria-hidden="true">%</span> : <span className="ws-item-sub">each period</span>}
            </label>
          </div>
          <FieldMsg errors={errors} k="value" idBase="offer" />
        </fieldset>
        <fieldset className="grid gap-2" disabled={taken}>
          <legend className="text-sm font-semibold">For which plans</legend>
          <span className="ws-card-blurb">None ticked means every plan, custom plans too.</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {plans.length ? (
              plans.map((p) => (
                <label key={p.code} className="flex items-center gap-2">
                  <input type="checkbox" checked={f.planCodes.includes(p.code)} onChange={() => toggle('planCodes', p.code)} />
                  {p.name}
                </label>
              ))
            ) : (
              <span className="ws-card-blurb">No price list is published, so it works on every plan.</span>
            )}
          </div>
        </fieldset>
        <fieldset className="grid gap-2" disabled={taken}>
          <legend className="text-sm font-semibold">For which billing</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[
              ['MONTHLY', 'Monthly'],
              ['YEARLY', 'Yearly'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={f.periods.includes(k)} onChange={() => toggle('periods', k)} />
                {label}
              </label>
            ))}
          </div>
          <span className="ws-card-blurb">None ticked means both.</span>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="offer-duration" label="Lasts how many billing periods" hint="Empty: for as long as they subscribe." errors={errors} k="duration">
            <input id="offer-duration" className="ui-input tabular-nums" type="text" inputMode="numeric" value={f.duration} onChange={set('duration')} disabled={taken} {...described(errors, 'duration', 'offer-duration-hint')} />
          </Field>
          <Field id="offer-max" label="How many customers may take it" hint={taken ? `${e.redemptions} have. Empty: no limit.` : 'Empty: no limit.'} errors={errors} k="max">
            <input id="offer-max" className="ui-input tabular-nums" type="text" inputMode="numeric" value={f.max} onChange={set('max')} {...described(errors, 'max', 'offer-max-hint')} />
          </Field>
          <Field id="offer-start" label="First day" hint="Empty: from today.">
            <input id="offer-start" className="ui-input" type="date" value={f.startsOn} onChange={set('startsOn')} disabled={taken} aria-describedby="offer-start-hint" />
          </Field>
          <Field id="offer-end" label="Last day" hint="Empty: until you end it.">
            <input id="offer-end" className="ui-input" type="date" value={f.endsOn} onChange={set('endsOn')} aria-describedby="offer-end-hint" />
          </Field>
        </div>
        <Err>{error}</Err>
      </form>
    </WsDrawer>
  );
}

export function Offers({ role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('active');
  const [editing, setEditing] = useState(null);
  const [step, setStep] = useState(null);
  const mayChange = may(role, 'BILLING');
  const load = useCallback(() => {
    opsOffers()
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(errorWords(e, 'load the offers')));
  }, []);
  useEffect(load, [load]);

  const planName = (code) => d?.plans.find((p) => p.code === code)?.name || code;
  const rows = d ? d.offers.filter((o) => TAB_OF[o.status] === tab) : [];
  const n = (t) => (d ? d.offers.filter((o) => TAB_OF[o.status] === t).length : 0);
  const STEP = {
    pause: ['Pause', 'No new customer can be given it until you resume it. Customers who have it keep it.'],
    resume: ['Resume', 'Staff can give it to customers again.'],
    archive: ['Archive', 'It goes for good: nobody new can take it, and it cannot be changed. Customers who have it keep it.'],
  };
  const doStep = async (reason) => {
    await opsOfferStep(step.o.id, step.k, reason);
    notify.success(`${step.o.code}: ${{ pause: 'paused', resume: 'can be used again', archive: 'archived' }[step.k]}.`);
    setStep(null);
    load();
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Billing and setup']}
          title="Offers"
          description="Codes that take a percent or an amount off a plan. Finance gives one to a customer when setting their subscription."
          counts={d ? countLine([[n('active'), 'can be used'], [n('paused'), 'paused']], 'No offers in force') : null}
          actions={
            mayChange ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setEditing('new')}>
                New offer
              </button>
            ) : null
          }
        />
        <Tabs
          label="Which offers"
          value={tab}
          onChange={setTab}
          tabs={[
            ['active', `In force${d ? ` (${n('active')})` : ''}`],
            ['paused', `Paused${d && n('paused') ? ` (${n('paused')})` : ''}`],
            ['over', 'Over'],
          ]}
        />
        <Err onRetry={load}>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && !rows.length ? (
          <Empty>{tab === 'active' ? 'No offers in force. Make one for a festival, a launch or a sales push.' : tab === 'paused' ? 'Nothing is paused.' : 'No offer has ended yet.'}</Empty>
        ) : d ? (
          <ul className="ws-list ws-list--ground" aria-label="Offers">
            {rows.map((o) => (
              <li key={o.id}>
                <div className="ws-item ws-item--wrap" style={{ alignItems: 'flex-start' }}>
                  <span className="ws-item-text">
                    <span className="ws-item-title">
                      <span className="tabular-nums">{o.code}</span> · {o.name}
                    </span>
                    <span className="ws-item-sub" style={{ color: 'rgb(var(--ws-ink))' }}>
                      {off(o)} {lasts(o)}
                      {o.periods.length === 1 ? `, ${o.periods[0] === 'YEARLY' ? 'yearly' : 'monthly'} billing only` : ''}
                      {o.planCodes.length ? `, on ${o.planCodes.map(planName).join(', ')}` : ', on every plan'}.
                    </span>
                    <span className="ws-item-sub">
                      <span className={STATUS[o.status][1]}>{STATUS[o.status][0]}</span> · {o.redemptions}
                      {o.maxRedemptions != null ? ` of ${o.maxRedemptions}` : ''} taken
                      {o.status === 'scheduled' ? ` · from ${day(o.startsAt)}` : ''}
                      {o.endsAt ? ` · last day ${day(o.endsAt)}` : ''}
                    </span>
                  </span>
                  {mayChange && o.status !== 'archived' ? (
                    <span className="ws-item-actions inline-flex flex-wrap gap-2">
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setEditing(o)} aria-label={`Change ${o.code}`}>
                        Change
                      </button>
                      {o.status === 'paused' ? (
                        <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setStep({ k: 'resume', o })} aria-label={`Resume ${o.code}`}>
                          Resume
                        </button>
                      ) : o.status === 'active' || o.status === 'scheduled' ? (
                        <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setStep({ k: 'pause', o })} aria-label={`Pause ${o.code}`}>
                          Pause
                        </button>
                      ) : null}
                      <button type="button" className="ws-btn ws-btn--danger-quiet" onClick={() => setStep({ k: 'archive', o })} aria-label={`Archive ${o.code}`}>
                        Archive
                      </button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {editing ? (
        <Editor
          editing={editing}
          plans={d?.plans || []}
          onClose={() => setEditing(null)}
          onSaved={(o, made) => {
            notify.success(made ? `${o.code} is ready to use.` : `${o.code} saved.`);
            setEditing(null);
            load();
          }}
        />
      ) : null}
      <ReasonDrawer
        open={Boolean(step)}
        title={step ? `${STEP[step.k][0]} ${step.o.code}` : ''}
        what={step ? STEP[step.k][1] : ''}
        confirmLabel={step ? STEP[step.k][0] : ''}
        tone={step?.k === 'archive' ? 'danger' : 'primary'}
        reasonOptional
        onClose={() => setStep(null)}
        onConfirm={doStep}
      />
    </div>
  );
}

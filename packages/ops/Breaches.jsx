import React, { useEffect, useState } from 'react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsAccounts, opsBreaches, opsNotifyBreach, opsRecordBreach } from './api';
import { Empty, Err, ErrorSummary, FieldMsg, HoldOpen, Loading, day, fieldErr, may, when, errorWords } from './kit';
import { Button } from '@ui/components/ui/Primitives';

/**
 * Data breaches (round 67 "breachops"; server: routes/opsBreaches.ts): a
 * breach of customer data that CLOR, as the processor, has to record and tell
 * the customers about. Recording keeps what happened, when, what data and
 * what was done; "Email their administrators" emails every owner and administrator of
 * each customer named, once. Staff only: customers never see this list.
 */

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const msg = (e, what) => errorWords(e, what);

export function Breaches({ me, openCustomer }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const [again, setAgain] = useState(0);
  useEffect(() => {
    opsBreaches()
      .then((r) => (setRows(r.breaches || []), setError('')))
      .catch((e) => setError(msg(e, 'load the breaches')));
  }, [again]);
  const mayChange = may(me.role, 'SUPPORT');
  const tell = async (b) => {
    const n = b.accounts.length;
    if (!(await confirmDialog({ title: 'Email their administrators?', message: `Every owner and administrator of ${n === 1 ? b.accounts[0].name || 'this customer' : `these ${n} customers`} gets an email saying what happened and what to do. This is done once and cannot be undone.`, confirmLabel: 'Send the emails', tone: 'primary' }))) return;
    setBusy(b.id);
    try {
      const r = await opsNotifyBreach(b.id);
      notify.success(`${r.notifiedCount} ${r.notifiedCount === 1 ? 'administrator was' : 'administrators were'} emailed.`);
      setAgain((x) => x + 1);
    } catch (e) {
      notify.error(msg(e, 'send the emails'));
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <PageHead
        crumbs={['Trust']}
        title="Data breaches"
        counts={rows ? (rows.length ? (rows.some((b) => !b.notifiedAt) ? `${rows.filter((b) => !b.notifiedAt).length} not told yet` : 'All customers told') : 'None recorded') : null}
        actions={
          mayChange ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setRecording(true)}>
              Record a breach
            </button>
          ) : null
        }
      />
      <p className="ws-card-blurb r67-lede">When customer data reaches someone it should not, record it here the day it is found, then tell the customers’ administrators. A company’s own breach of its staff data is recorded by that company in the Admin center, Privacy.</p>
      <Err onRetry={rows ? null : () => (setError(''), setAgain((x) => x + 1))}>{error}</Err>
      {!rows ? (
        error ? null : <Loading />
      ) : !rows.length ? (
        <Empty>No breaches recorded. If customer data reaches someone it should not, record it here with Record a breach.</Empty>
      ) : (
        <ul className="r67-breaches">
          {rows.map((b) => (
            <li key={b.id} className="r67-breach">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0" style={{ flex: '1 1 20rem' }}>
                  <p>{b.what}</p>
                  <p className="ws-item-sub">
                    Happened {day(b.happenedAt)} · found {day(b.foundAt)} · {b.dataKinds}
                  </p>
                </div>
                {b.notifiedAt ? (
                  <span className="ws-pill ws-pill--ok">Told {b.notifiedCount} on {day(b.notifiedAt)}</span>
                ) : mayChange ? (
                  <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy === b.id} onClick={() => tell(b)}>
                    Email their administrators
                  </button>
                ) : (
                  <span className="ws-pill ws-pill--warn">Not told yet</span>
                )}
              </div>
              <p className="text-sm">
                <span className="ws-item-sub">What CLOR did: </span>
                {b.stepsTaken}
              </p>
              {b.stepsForCustomer ? (
                <p className="text-sm">
                  <span className="ws-item-sub">Asked of customers: </span>
                  {b.stepsForCustomer}
                </p>
              ) : null}
              <p className="text-sm r67-breach-who">
                {b.accounts.map((a, i) => (
                  <React.Fragment key={a.id}>
                    {i ? ', ' : ''}
                    <button type="button" className="ws-name-link" onClick={() => openCustomer(a.id)}>
                      {a.name || a.id}
                    </button>
                  </React.Fragment>
                ))}
              </p>
              <p className="ws-item-sub">Recorded {when(b.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {recording ? <RecordBreach onClose={() => setRecording(false)} onSaved={() => (setRecording(false), setAgain((x) => x + 1))} /> : null}
    </>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}

function RecordBreach({ onClose, onSaved }) {
  const [f, setF] = useState({ what: '', dataKinds: '', stepsTaken: '', stepsForCustomer: '', happenedOn: today(), foundOn: today() });
  const [chosen, setChosen] = useState([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  /* The search: what was asked last and answered, and whether it failed, so "No customer matches" waits for an answer. */
  const [lookedFor, setLookedFor] = useState(null);
  const [lookError, setLookError] = useState('');
  const [lookAgain, setLookAgain] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState({});
  const [first] = useState(() => JSON.stringify(f));
  const dirty = busy || JSON.stringify(f) !== first || chosen.length > 0 || Boolean(q.trim());
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    let live = true;
    const asked = q.trim();
    const t = setTimeout(() => {
      opsAccounts({ q: asked })
        .then((r) => {
          if (!live) return;
          setLookError('');
          setHits((r.accounts || []).slice(0, 6));
          setLookedFor(asked);
        })
        .catch((e) => live && setLookError(msg(e, 'look up the customers')));
    }, 250);
    return () => ((live = false), clearTimeout(t));
  }, [q, lookAgain]);
  const add = (a) => {
    setChosen((c) => (c.some((x) => x.id === a.id) ? c : [...c, { id: a.id, name: a.name }]));
    setQ('');
    setHits([]);
  };
  const save = async () => {
    if (busy) return;
    const wrong = {};
    if (f.what.trim().length < 10) wrong.what = 'Say what happened, in a sentence or two.';
    if (f.dataKinds.trim().length < 3) wrong.data = 'Say what data was reached, like names and work emails.';
    if (!f.happenedOn) wrong.happened = 'Enter the day it happened.';
    if (!f.foundOn) wrong.found = 'Enter the day it was found.';
    if (f.happenedOn && f.foundOn && f.foundOn < f.happenedOn) wrong.found = 'It cannot be found before it happened.';
    if (f.stepsTaken.trim().length < 5) wrong.steps = 'Say what CLOR has done about it.';
    if (!chosen.length) wrong.who = 'Add at least one customer affected.';
    setProblems(wrong);
    if (Object.keys(wrong).length) return;
    setBusy(true);
    setError('');
    try {
      await opsRecordBreach({ ...f, stepsForCustomer: f.stepsForCustomer.trim() || null, accountIds: chosen.map((c) => c.id) });
      notify.success('Recorded. Email their administrators when the facts are clear.');
      onSaved();
    } catch (e) {
      setError(msg(e, 'record the breach'));
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={() => !busy && onClose()}
      dirty={dirty}
      title="Record a data breach"
      description="Plain words: the customers’ administrators read this in the email. Saving asks for a code from your authenticator app."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <Button plain className="ws-btn ws-btn--primary" loading={busy} onClick={save}>
            Record breach
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <HoldOpen active={busy} />
        <ErrorSummary errors={problems} />
        <Field id="br-what" label="What happened">
          <textarea id="br-what" className="ui-input" rows={3} maxLength={2000} value={f.what} onChange={set('what')} {...fieldErr(problems, 'what', 'br')} />
          <FieldMsg errors={problems} k="what" idBase="br" />
        </Field>
        <Field id="br-data" label="What data" hint="For example: names, work emails and phone numbers of staff.">
          <input id="br-data" className="ui-input" maxLength={600} value={f.dataKinds} onChange={set('dataKinds')} {...fieldErr(problems, 'data', 'br')} />
          <FieldMsg errors={problems} k="data" idBase="br" />
        </Field>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Field id="br-happened" label="Happened on">
            <input id="br-happened" type="date" className="ui-input" max={today()} value={f.happenedOn} onChange={set('happenedOn')} {...fieldErr(problems, 'happened', 'br')} />
            <FieldMsg errors={problems} k="happened" idBase="br" />
          </Field>
          <Field id="br-found" label="Found on">
            <input id="br-found" type="date" className="ui-input" max={today()} value={f.foundOn} onChange={set('foundOn')} {...fieldErr(problems, 'found', 'br')} />
            <FieldMsg errors={problems} k="found" idBase="br" />
          </Field>
        </div>
        <Field id="br-steps" label="What CLOR has done">
          <textarea id="br-steps" className="ui-input" rows={2} maxLength={2000} value={f.stepsTaken} onChange={set('stepsTaken')} {...fieldErr(problems, 'steps', 'br')} />
          <FieldMsg errors={problems} k="steps" idBase="br" />
        </Field>
        <Field id="br-ask" label="What customers should do" hint="Leave empty if nothing is needed from them.">
          <textarea id="br-ask" className="ui-input" rows={2} maxLength={1000} value={f.stepsForCustomer} onChange={set('stepsForCustomer')} />
        </Field>
        <Field id="br-who" label="Customers affected" hint="Search by name, email or code.">
          <input id="br-who" className="ui-input" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} {...fieldErr(problems, 'who', 'br')} />
          <FieldMsg errors={problems} k="who" idBase="br" />
        </Field>
        {q.trim().length < 2 ? null : lookError ? (
          <Err onRetry={() => setLookAgain((n) => n + 1)}>{lookError}</Err>
        ) : lookedFor !== q.trim() && !hits.length ? (
          <span className="ws-item-sub" role="status">Looking…</span>
        ) : !hits.length ? (
          <span className="ws-item-sub" role="status">No customer matches.</span>
        ) : (
          <ul className="r67-hits" aria-label="Matching customers">
            {hits.map((a) => (
              <li key={a.id}>
                <button type="button" className="ws-link" onClick={() => add(a)}>
                  Add {a.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Customers chosen">
            {chosen.map((c) => (
              <li key={c.id} className="ws-pill">
                {c.name}
                <button type="button" className="r67-chip-x" aria-label={`Remove ${c.name}`} onClick={() => setChosen((x) => x.filter((y) => y.id !== c.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

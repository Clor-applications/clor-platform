import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CalendarOff, Camera, CheckSquare, Clock3, Fingerprint, ListChecks, LogIn, LogOut, MapPin, UserRound, X } from 'lucide-react';

import { STATUS } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import PhonePunch from '../components/PhonePunch';
import {
  SignedOut,
  activate,
  askCorrection,
  askLeave,
  cancelLeave,
  changePassword,
  decideApproval,
  getApprovals,
  getAttendance,
  getLeave,
  getMe,
  getSchedule,
  getTax,
  hm,
  portalToken,
  punch,
  rememberedIds,
  saveTax,
  signIn,
  signOut,
  todayIst,
} from './portalApi';

/**
 * The employee portal (ClorTime's /portal), at #/portal: for staff who have no
 * CLOR user. Sign in with company code + employee code + one's own password;
 * see today and punch from the phone (inside a work site, when HR allows it),
 * one's days, schedule and leave; ask for leave and corrections.
 *
 * Phone-first: one column, big targets, the tabs at the bottom where a thumb is.
 */
export default function EmployeePortal() {
  const [signedIn, setSignedIn] = useState(() => Boolean(portalToken()));
  const [tab, setTab] = useState('today');
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Employee portal · Clor';
    document.documentElement.setAttribute('data-app', 'attendance');
    return () => {
      document.title = 'Clor';
      document.documentElement.removeAttribute('data-app');
    };
  }, []);

  /** Any call that finds the session over sends the person back to sign in. */
  const guard = useCallback((p) => p.catch((e) => {
    if (e instanceof SignedOut) {
      setSignedIn(false);
      setMe(null);
    }
    throw e;
  }), []);

  const loadMe = useCallback(() => {
    guard(getMe())
      .then((d) => {
        setMe(d);
        setError('');
      })
      .catch((e) => !(e instanceof SignedOut) && setError(String(e?.message || 'Could not load.')));
  }, [guard]);
  useEffect(() => {
    if (signedIn) loadMe();
  }, [signedIn, loadMe]);

  if (!signedIn) return <PortalSignIn onDone={() => setSignedIn(true)} />;

  const leave = () => {
    signOut();
    setSignedIn(false);
    setMe(null);
    setTab('today');
  };

  /* Approvals shows only for someone people report to (ClorTime's portal did the same). */
  const TABS = [
    { key: 'today', label: 'Today', icon: Clock3 },
    { key: 'days', label: 'My days', icon: ListChecks },
    ...(me?.approver ? [{ key: 'approvals', label: 'Approvals', icon: CheckSquare }] : []),
    { key: 'schedule', label: 'Schedule', icon: CalendarDays },
    { key: 'leave', label: 'Leave', icon: CalendarOff },
    { key: 'me', label: 'Me', icon: UserRound },
  ];

  return (
    <div className="min-h-dvh pb-20" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <header className="sticky top-0 z-10 border-b px-4 py-3" style={{ backgroundColor: 'rgb(var(--surface))', borderColor: 'rgb(var(--border))' }}>
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Fingerprint size={20} aria-hidden="true" style={{ color: 'rgb(var(--accent))' }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me?.company?.name || 'Employee portal'}</div>
            <div className="ui-caption truncate">{me ? `${me.employee.name}${me.employee.code ? ` · ${me.employee.code}` : ''}` : ' '}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 py-4">
        {error ? <div className="ui-card p-4 text-sm" role="alert">{error}</div> : null}
        {tab === 'today' ? <Today me={me} reload={loadMe} guard={guard} /> : null}
        {tab === 'days' ? <MyDays guard={guard} /> : null}
        {tab === 'approvals' ? <Approvals guard={guard} /> : null}
        {tab === 'schedule' ? <MySchedule guard={guard} /> : null}
        {tab === 'leave' ? <MyLeave guard={guard} /> : null}
        {tab === 'me' ? <Account me={me} guard={guard} onSignOut={leave} /> : null}
      </main>

      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-10 border-t" style={{ backgroundColor: 'rgb(var(--surface))', borderColor: 'rgb(var(--border))' }}>
        <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.key;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px]"
                  style={{ color: on ? 'rgb(var(--accent))' : 'rgb(var(--fg-muted))', fontWeight: on ? 600 : 400 }}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => setTab(t.key)}
                >
                  <Icon size={20} aria-hidden="true" />
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

const fromLink = () => {
  try {
    const q = new URLSearchParams(String(window.location.hash).split('?')[1] || '');
    return { company: q.get('c') || '', employeeCode: q.get('e') || '' };
  } catch {
    return {};
  }
};

function PortalSignIn({ onDone }) {
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState(() => {
    const link = fromLink();
    const kept = rememberedIds();
    return { company: link.company || kept.company || '', employeeCode: link.employeeCode || kept.employeeCode || '', password: '', activationCode: '', confirm: '' };
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'activate' && form.password !== form.confirm) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      if (mode === 'activate') await activate(form);
      else await signIn(form);
      onDone();
    } catch (err) {
      setError(String(err?.message || 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <div className="w-full max-w-sm space-y-5">
        <div className="space-y-1 text-center">
          <Fingerprint size={36} aria-hidden="true" className="mx-auto" style={{ color: 'rgb(var(--accent))' }} />
          <h1 className="ui-display text-xl">Employee portal</h1>
          <p className="ui-caption">Your attendance, schedule and leave.</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg p-1" role="tablist" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
          {[
            ['signin', 'Sign in'],
            ['activate', 'First time? Activate'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={`ui-btn ui-btn-sm ${mode === k ? 'ui-btn-primary' : 'ui-btn-ghost'}`} onClick={() => { setMode(k); setError(''); }}>
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="ui-card space-y-4 p-5">
          <label className="block">
            <span className="ui-label">Company code</span>
            <input className="ui-input w-full uppercase" required autoCapitalize="characters" autoComplete="organization" value={form.company} onChange={set('company')} placeholder="e.g. INNO-C100" />
          </label>
          <label className="block">
            <span className="ui-label">Employee code</span>
            <input className="ui-input w-full" required autoComplete="username" value={form.employeeCode} onChange={set('employeeCode')} />
          </label>
          {mode === 'activate' ? (
            <label className="block">
              <span className="ui-label">Activation code from HR</span>
              <input className="ui-input w-full ui-mono uppercase tracking-widest" required autoComplete="one-time-code" autoCapitalize="characters" value={form.activationCode} onChange={set('activationCode')} placeholder="ABCD-EFGH" />
            </label>
          ) : null}
          <label className="block">
            <span className="ui-label">{mode === 'activate' ? 'Choose a password' : 'Password'}</span>
            <input type="password" className="ui-input w-full" required autoComplete={mode === 'activate' ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} />
            {mode === 'activate' ? <span className="ui-caption">8 or more characters, with a letter and a digit. Only you will know it.</span> : null}
          </label>
          {mode === 'activate' ? (
            <label className="block">
              <span className="ui-label">Same password again</span>
              <input type="password" className="ui-input w-full" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
            </label>
          ) : null}
          {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
          <button type="submit" className="ui-btn ui-btn-primary w-full !h-11" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'activate' ? 'Activate and sign in' : 'Sign in'}
          </button>
          {mode === 'signin' ? <p className="ui-caption text-center">Forgot your password? Ask HR for a new activation code.</p> : null}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function Today({ me, reload, guard }) {
  if (!me) return <div className="ui-card p-6 ui-caption">Loading…</div>;
  const r = me.record;
  const s = me.shift;

  return (
    <>
      <section className="ui-card space-y-3 p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="ui-t-sec">{new Date(`${me.today}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h2>
          {r ? <span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span> : null}
        </div>
        <p className="text-sm">
          {s.holiday ? `Holiday — ${s.holiday}` : s.off ? 'Weekly off' : `${s.name} · ${s.startTime}–${s.endTime}`}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgb(var(--app-bg))' }}><dt className="ui-caption">In</dt><dd className="text-lg font-semibold tabular-nums">{r?.checkInTime || '—'}</dd></div>
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgb(var(--app-bg))' }}><dt className="ui-caption">Out</dt><dd className="text-lg font-semibold tabular-nums">{r?.checkOutTime || '—'}</dd></div>
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgb(var(--app-bg))' }}><dt className="ui-caption">Worked</dt><dd className="text-lg font-semibold tabular-nums">{r?.checkOut ? hm(r.workedMinutes) : '—'}</dd></div>
        </dl>
        {r?.lateMinutes ? <p className="ui-caption">Late by {r.lateMinutes} min.</p> : null}
      </section>

      {me.phone.allowed ? (
        <PhonePunch phone={me.phone} punches={me.punches} onPunch={(body) => guard(punch(body))} onDone={reload} />
      ) : (
        <p className="ui-caption px-1">Punch at the reader at work. Punching from your phone is not switched on for you.</p>
      )}

      <section className="ui-card p-5" aria-labelledby="punches-h">
        <h2 id="punches-h" className="ui-t-sec mb-2">Punches today</h2>
        {me.punches.length ? (
          <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
            {me.punches.map((p, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="tabular-nums font-medium">{p.time}</span>
                <span className="ui-caption">{p.phone ? `Phone${p.site ? ` · ${p.site}` : ''}` : 'Reader'}</span>
                {/* A reader that does not say in or out gets no badge: an empty one reads as an error. */}
                {p.kind ? <span className={`ui-pill ${p.kind === 'IN' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{p.kind === 'IN' ? 'In' : 'Out'}</span> : <span />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-caption">None yet.</p>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// My days and corrections
// ---------------------------------------------------------------------------

const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function MyDays({ guard }) {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ date: '', checkIn: '', checkOut: '', reason: '' });
  const [note, setNote] = useState(null);
  /* Only the latest request may fill the screen: a slow earlier month must not overwrite the one picked since. */
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    guard(getAttendance(month))
      .then((d) => n === latest.current && (setData(d), setError('')))
      .catch((e) => n === latest.current && setError(String(e?.message || 'Could not load your days.')));
  }, [month, guard]);
  useEffect(() => {
    load();
  }, [load]);

  const ask = async (e) => {
    e.preventDefault();
    setNote(null);
    try {
      await guard(askCorrection({ ...form, checkOut: form.checkOut || null }));
      setNote({ ok: true, text: 'Sent to HR for approval.' });
      setForm({ date: '', checkIn: '', checkOut: '', reason: '' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: String(err?.message || 'Not sent.') });
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="ui-t-sec">My days</h2>
        <input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      </div>
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <div className="ui-card p-6 ui-caption">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1 text-center text-xs">
            {[
              ['Present', data.totals.present],
              ['Half', data.totals.halfDay],
              ['Absent', data.totals.absent],
              ['Leave', data.totals.leave],
              ['Late', data.totals.late],
            ].map(([k, v]) => (
              <div key={k} className="ui-card p-2"><div className="text-base font-semibold tabular-nums">{v}</div><div className="ui-caption">{k}</div></div>
            ))}
          </div>
          <section className="ui-card overflow-hidden">
            {data.days.length ? (
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
              <table className="ui-table w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="ui-th">Day</th>
                    <th scope="col" className="ui-th">Status</th>
                    <th scope="col" className="ui-th text-end">In – out</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.days].reverse().map((d) => {
                    /* A past day with an in and no out is not paid until it is corrected: say so, here where it can be. */
                    const open = d.status === 'PRESENT' && d.checkIn && !d.checkOut && d.date < todayIst();
                    return (
                      <tr key={d.date}>
                        <td className="whitespace-nowrap">{dayLabel(d.date)}</td>
                        <td>
                          {open ? (
                            <span className="ui-pill ui-pill-warn">No check-out</span>
                          ) : (
                            <span className={`ui-pill ${STATUS[d.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[d.status]?.label || d.status}</span>
                          )}
                          {d.lateMinutes ? <span className="ui-caption block">late {d.lateMinutes} min</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-end tabular-nums">
                          {d.checkIn ? `${d.checkIn} – ${d.checkOut || ''}`.trim() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="ui-caption p-4">Nothing recorded this month yet.</p>
            )}
          </section>
        </>
      )}

      <form onSubmit={ask} className="ui-card space-y-3 p-5" aria-labelledby="fix-h">
        <h2 id="fix-h" className="ui-t-sec">Ask for a correction</h2>
        <p className="ui-caption">Missed a punch, or the reader was down? Say when you were in.</p>
        <label className="block"><span className="ui-label">Day</span><input type="date" className="ui-input w-full" required max={todayIst()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="ui-label">In</span><input type="time" className="ui-input w-full" required value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Out</span><input type="time" className="ui-input w-full" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></label>
        </div>
        <label className="block"><span className="ui-label">Why</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
        <button type="submit" className="ui-btn ui-btn-primary w-full">Send</button>
      </form>

      {data?.corrections?.length ? (
        <section className="ui-card p-5" aria-labelledby="fixes-h">
          <h2 id="fixes-h" className="ui-t-sec mb-2">My corrections</h2>
          <ul className="space-y-2 text-sm">
            {data.corrections.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2">
                <span>{dayLabel(c.date)} · {c.checkIn || '—'}–{c.checkOut || '—'}<span className="ui-caption block">{c.reason}{c.note ? ` — ${c.note}` : ''}</span></span>
                <RequestPill status={c.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

const REQUEST_PILL = { PENDING: 'ui-pill-warn', APPROVED: 'ui-pill-pos', REJECTED: 'ui-pill-neg', CANCELLED: 'ui-pill-neutral' };
const REQUEST_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const RequestPill = ({ status }) => <span className={`ui-pill ${REQUEST_PILL[status] || 'ui-pill-neutral'}`}>{REQUEST_LABEL[status] || status}</span>;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function MySchedule({ guard }) {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let off = false;
    guard(getSchedule(month))
      .then((d) => !off && (setData(d), setError('')))
      .catch((e) => !off && setError(String(e?.message || 'Could not load your schedule.')));
    return () => {
      off = true;
    };
  }, [month, guard, attempt]);
  const t = todayIst();
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="ui-t-sec">My schedule</h2>
        <input type="month" className="ui-input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      </div>
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <div className="ui-card p-6 ui-caption">Loading…</div>
      ) : (
        <ul className="ui-card divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
          {data.days.map((d) => (
            <li key={d.date} className="flex items-center gap-3 px-4 py-2" style={d.date === t ? { backgroundColor: 'rgb(var(--accent-soft))' } : undefined}>
              <span className="w-24 shrink-0 whitespace-nowrap">{dayLabel(d.date)}</span>
              {d.kind === 'WORK' ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color || '#64748b' }} aria-hidden="true" />
                  {d.shift} <span className="ui-caption tabular-nums">{d.startTime}–{d.endTime}</span>
                </span>
              ) : (
                <span className="ui-muted">{d.kind === 'OFF' ? 'Weekly off' : d.kind === 'HOLIDAY' ? `Holiday${d.holiday ? ` — ${d.holiday}` : ''}` : 'On leave'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

function MyLeave({ guard }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
  const [note, setNote] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    guard(getLeave())
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError(String(e?.message || 'Could not load your leave.')));
  }, [guard]);
  useEffect(() => {
    load();
  }, [load]);

  const ask = async (e) => {
    e.preventDefault();
    setNote(null);
    try {
      const r = await guard(askLeave({ ...form, toDate: form.toDate || form.fromDate }));
      setNote({ ok: true, text: `Asked for ${r.request.days} day${r.request.days === 1 ? '' : 's'} of ${r.request.leaveTypeName}. HR will approve it.` });
      setForm({ leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: String(err?.message || 'Not sent.') });
    }
  };
  const cancel = async (id) => {
    try {
      await guard(cancelLeave(id));
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: String(err?.message || 'Not cancelled.') });
    }
  };

  if (!data) return error ? <LoadFailed message={error} onRetry={load} /> : <div className="ui-card p-6 ui-caption">Loading…</div>;
  return (
    <>
      <h2 className="ui-t-sec">My leave {data.year}</h2>
      {data.types.length ? (
        <div className="grid grid-cols-2 gap-2">
          {data.types.map((t) => (
            <div key={t.id} className="ui-card p-3">
              <div className="text-sm font-medium">{t.name}</div>
              {t.isPaid ? (
                <>
                  <div className="text-2xl font-semibold tabular-nums">{t.available}</div>
                  <div className="ui-caption">left of {t.allocated}{t.pending ? ` · ${t.pending} waiting` : ''}</div>
                </>
              ) : (
                <div className="ui-caption">Unpaid · {t.used} taken</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="ui-caption">No leave types are set up yet.</p>
      )}

      {data.types.length ? (
        <form onSubmit={ask} className="ui-card space-y-3 p-5" aria-labelledby="ask-leave-h">
          <h2 id="ask-leave-h" className="ui-t-sec">Ask for leave</h2>
          <label className="block">
            <span className="ui-label">Kind</span>
            <select className="ui-select w-full" required value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
              <option value="">Choose…</option>
              {data.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input w-full" required value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate && form.toDate < e.target.value ? e.target.value : form.toDate })} /></label>
            <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input w-full" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></label>
          </div>
          <label className="block"><span className="ui-label">Why</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
          <button type="submit" className="ui-btn ui-btn-primary w-full">Send</button>
        </form>
      ) : null}

      {data.requests.length ? (
        <section className="ui-card p-5" aria-labelledby="leave-list-h">
          <h2 id="leave-list-h" className="ui-t-sec mb-2">My requests</h2>
          <ul className="space-y-3 text-sm">
            {data.requests.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2">
                <span>
                  {r.leaveTypeName} · {r.days} day{r.days === 1 ? '' : 's'}
                  <span className="ui-caption block">{r.fromDate === r.toDate ? dayLabel(r.fromDate) : `${dayLabel(r.fromDate)} – ${dayLabel(r.toDate)}`}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <RequestPill status={r.status} />
                  {r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > data.today) ? (
                    <button type="button" className="ui-link text-xs" onClick={() => cancel(r.id)}>Cancel</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

function Account({ me, guard, onSignOut }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [note, setNote] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setNote(null);
    if (form.next !== form.confirm) return setNote({ ok: false, text: 'The two new passwords are not the same.' });
    try {
      await guard(changePassword(form.current, form.next));
      setForm({ current: '', next: '', confirm: '' });
      setNote({ ok: true, text: 'Password changed. Other phones signed in as you are signed out.' });
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: String(err?.message || 'Not changed.') });
    }
  };
  return (
    <>
      {me ? (
        <section className="ui-card space-y-1 p-5">
          <div className="text-base font-semibold">{me.employee.name}</div>
          <div className="ui-caption">{[me.employee.code, me.employee.designation, me.employee.department].filter(Boolean).join(' · ')}</div>
          <div className="ui-caption">{me.company.name}{me.company.code ? ` · ${me.company.code}` : ''}</div>
        </section>
      ) : null}
      <MyTax guard={guard} />
      <form onSubmit={save} className="ui-card space-y-3 p-5" aria-labelledby="pw-h">
        <h2 id="pw-h" className="ui-t-sec">Change password</h2>
        <label className="block"><span className="ui-label">Current password</span><input type="password" className="ui-input w-full" required autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></label>
        <label className="block"><span className="ui-label">New password</span><input type="password" className="ui-input w-full" required autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></label>
        <label className="block"><span className="ui-label">New password again</span><input type="password" className="ui-input w-full" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
        {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
        <button type="submit" className="ui-btn ui-btn-primary w-full">Change password</button>
      </form>
      <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={onSignOut}>
        <LogOut size={16} aria-hidden="true" /> Sign out
      </button>
    </>
  );
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * Income tax for the year: choose the regime, and under the old one declare
 * investments, rent and home loan interest. HR checks the proofs; tax is taken
 * on what is declared until then. Shown only where payroll runs in CLOR.
 */
function MyTax({ guard }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const take = (r) => {
    if (!r?.available) return setD(false);
    const x = r.declaration;
    setD(x);
    setForm({
      regime: x.regime,
      items: Object.fromEntries(x.items.map((i) => [i.code, i.declared || ''])),
      monthlyRent: x.monthlyRent || '',
      metroCity: x.metroCity,
      landlordPan: x.landlordPan || '',
      seniorSelf: x.seniorSelf,
      seniorParents: x.seniorParents,
    });
  };
  useEffect(() => {
    guard(getTax())
      .then(take)
      .catch(() => setD(false));
  }, [guard]);
  if (!d || !form) return null;

  const locked = d.status === 'VERIFIED';
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const send = async (e) => {
    e.preventDefault();
    setNote(null);
    setBusy(true);
    try {
      take(
        await guard(
          saveTax({
            regime: form.regime,
            items: Object.entries(form.items).map(([code, v]) => ({ code, declared: Number(v) || 0 })),
            monthlyRent: Number(form.monthlyRent) || 0,
            metroCity: form.metroCity,
            landlordPan: form.landlordPan || null,
            seniorSelf: form.seniorSelf,
            seniorParents: form.seniorParents,
          })
        )
      );
      setNote({ ok: true, text: 'Sent to HR. Tax from the next payslip uses it.' });
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: String(err?.message || 'Not saved.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="ui-card space-y-3 p-5" aria-labelledby="tax-h">
      <h2 id="tax-h" className="ui-t-sec">Income tax · FY {d.financialYear}</h2>
      <p className="ui-caption">
        {locked ? 'HR has checked your proofs. Ask HR if something needs changing.' : d.status === 'SUBMITTED' ? 'Sent to HR. You can still change it until your proofs are checked.' : 'Choose your regime. Under the old one, tell us what you will invest so less tax is taken each month.'}
      </p>
      <fieldset disabled={locked || busy} className="space-y-3">
        <div className="space-y-2 text-sm">
          {[
            ['NEW', 'New regime', 'Lower rates; no deductions to declare.'],
            ['OLD', 'Old regime', 'Deductions for investments, rent and home loan.'],
          ].map(([v, label, hint]) => (
            <label key={v} className="flex items-start gap-2">
              <input type="radio" name="tax-regime" className="mt-1" checked={form.regime === v} onChange={() => set({ regime: v })} />
              <span>
                <span className="font-medium">{label}</span>
                <span className="ui-caption block">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {form.regime === 'OLD' ? (
          <>
            {d.items.map((i) => (
              <label key={i.code} className="block">
                <span className="ui-label">{i.label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="ui-input ui-num w-full"
                  value={form.items[i.code]}
                  onChange={(e) => set({ items: { ...form.items, [i.code]: e.target.value } })}
                />
                <span className="ui-caption">
                  {i.hint}
                  {i.cap ? ` Up to ${rupees(i.cap)}.` : ''}
                  {locked && i.verified != null ? ` Verified: ${rupees(i.verified)}.` : ''}
                </span>
              </label>
            ))}
            <label className="block">
              <span className="ui-label">Rent you pay a month</span>
              <input type="number" inputMode="numeric" min="0" className="ui-input ui-num w-full" value={form.monthlyRent} onChange={(e) => set({ monthlyRent: e.target.value })} />
            </label>
            {Number(form.monthlyRent) * 12 > 100000 ? (
              <label className="block">
                <span className="ui-label">Landlord’s PAN</span>
                <input className="ui-input w-full uppercase" maxLength={10} autoCapitalize="characters" value={form.landlordPan} onChange={(e) => set({ landlordPan: e.target.value })} required />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.metroCity} onChange={(e) => set({ metroCity: e.target.checked })} /> I live in Delhi, Mumbai, Kolkata or Chennai</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.seniorSelf} onChange={(e) => set({ seniorSelf: e.target.checked })} /> I am 60 or older</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.seniorParents} onChange={(e) => set({ seniorParents: e.target.checked })} /> My parents are 60 or older</label>
            <p className="ui-caption">Your PF from salary already counts towards 80C. Keep the receipts: HR will ask for proofs.</p>
          </>
        ) : null}
      </fieldset>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {locked ? null : (
        <button type="submit" className="ui-btn ui-btn-primary w-full" disabled={busy}>
          Send to HR
        </button>
      )}
    </form>
  );
}// ---------------------------------------------------------------------------
// Approvals — what my reportees are waiting on
// ---------------------------------------------------------------------------

function Approvals({ guard }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    guard(getApprovals())
      .then((d) => { setData(d); setError(''); })
      .catch((e) => !(e instanceof SignedOut) && setError(String(e?.message || 'Could not load.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);

  const decide = async (item, decision) => {
    setBusy(`${item.type}:${item.id}`);
    try {
      await guard(decideApproval(item.type, item.id, { decision, note: decision === 'reject' ? note : undefined }));
      setRejecting(null);
      setNote('');
      load();
    } catch (e) {
      /* 409 means another approver got there first — worth saying, then showing the fresh queue. */
      if (!(e instanceof SignedOut)) setError(String(e?.message || 'That decision was not recorded.'));
      load();
    } finally {
      setBusy('');
    }
  };

  if (error && !data) return <LoadFailed message={error} onRetry={load} />;
  if (!data) return <div className="ui-card p-6 ui-caption">Loading…</div>;
  const items = [...data.leaves, ...data.corrections].sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
  const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <>
      <section className="ui-card p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="ui-t-sec">Waiting for you</h2>
          <span className="ui-caption">{data.team} report{data.team === 1 ? 's' : ''} to you</span>
        </div>
        {error ? <p className="mt-2 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {!items.length ? <p className="ui-caption mt-2">Nothing waiting. Leave and correction requests from your team appear here.</p> : null}
      </section>
      {items.map((item) => {
        const key = `${item.type}:${item.id}`;
        return (
          <section key={key} className="ui-card space-y-3 p-5" aria-label={`${item.type} request from ${item.employeeName}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{item.employeeName}{item.employeeCode ? <span className="ui-caption font-normal"> · {item.employeeCode}</span> : null}</div>
                <div className="text-sm">
                  {item.type === 'leave'
                    ? <>{item.leaveTypeName} · {fmt(item.fromDate)}{item.toDate !== item.fromDate ? ` – ${fmt(item.toDate)}` : ''} · {item.days} day{item.days === 1 ? '' : 's'}</>
                    : <>Correction · {fmt(item.date)} · in {item.checkIn || '—'}{item.checkOut ? `, out ${item.checkOut}` : ''}</>}
                </div>
              </div>
              <span className={`ui-pill ${item.type === 'leave' ? 'ui-pill-neutral' : 'ui-pill-warn'}`}>{item.type === 'leave' ? 'Leave' : 'Correction'}</span>
            </div>
            {item.reason ? <p className="text-sm ui-muted">“{item.reason}”</p> : null}
            {rejecting === key ? (
              <div className="space-y-2">
                <textarea className="ui-input w-full" rows={2} placeholder="Why not? (optional, the person sees this)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" className="ui-btn ui-btn-danger flex-1" disabled={busy === key} onClick={() => decide(item, 'reject')}>Reject</button>
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={busy === key} onClick={() => decide(item, 'approve')}>{busy === key ? 'Saving…' : 'Approve'}</button>
                <button type="button" className="ui-btn ui-btn-secondary" disabled={busy === key} onClick={() => setRejecting(key)}>Reject</button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}



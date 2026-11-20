import { expiringWords } from '@ui/timeOff/expiring';
import { fyLabel } from '@ui/picks/round34';
import { installFormRules } from '@ui/picks/round56';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import DateNotes from '@ui/timeOff/DateNotes';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CalendarOff, Camera, Check, CheckSquare, Clock3, Fingerprint, HelpCircle, ListChecks, LogIn, LogOut, MapPin, UserRound, X } from '@ui/components/ui/lineIcons';

import { REASON_CODES, STATUS } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import DayExplain from '../components/DayExplain';
import LeaveExplain from '../components/LeaveExplain';
import LeaveDocumentField from '@ui/timeOff/LeaveDocumentField';
import HalfDayChoice, { halfDayBody, leaveSpan } from '@ui/timeOff/HalfDayChoice';
import { HoursChoice, PreviewNotes } from '@ui/timeOff/LeaveShape';
import { amountFigure, amountWords, hoursBetween, hoursBody, hoursReady, hoursText as leaveHours, hoursWords, isHourly } from '@ui/timeOff/partOfDay';
import PhonePunch from '../components/PhonePunch';
import { MyDetails, Policies } from './MyDetails';
import AskHr from './AskHr';
import { LeavingCompany, MySteps, PayCard, Payslips, PrivateComplaint } from './MeExtras';
import { HolidaysYear, WhatsNew } from './PortalFeeds';
import MyGrowth from './MyGrowth';
import TrainingsDue from './TrainingsDue';
import { NextHoliday, useNextDays } from './round48';
import MyJobs from './MyJobs';
import MyMoney from './MyMoney';
import MyAssets from './MyAssets';
import { MonthReview, MyOvertime } from './MonthAndOvertime';
import ShiftSwaps from './ShiftSwaps';
import MyForms from './MyForms';
import AskLetter from './AskLetter';
import { FixNotices, MyMarks, NightConsent } from './TimeRules';
import WeekBars from './WeekBars';
import { Celebrations, ExitInterview, TodayPosts } from './Engagement';
import {
  SignedOut,
  acceptItem,
  getToAccept,
  activate,
  askLeave,
  listRequests,
  askRequest,
  changeRequest,
  cancelRequest as cancelPortalRequest,
  requestRules,
  explainDay as portalExplainDay,
  explainLeave as portalExplainLeave,
  cancelLeave,
  remindLeave,
  answerLeaveQuestion,
  editLeave,
  shortenLeave,
  changePassword,
  endOtherSessions,
  endSession,
  getSessions,
  decideApproval,
  askData,
  getApprovals,
  getDataRequests,
  getMyData,
  getPrivacyNotice,
  readPrivacyNotice,
  withdrawConsent,
  getDocument,
  getDocuments,
  getAttendance,
  getLeave,
  previewLeave,
  getMe,
  getCompanyUpdates,
  getSchedule,
  getTax,
  hm,
  portalToken,
  punch,
  rememberedIds,
  saveTax,
  setLanguage,
  signIn,
  signOut,
  todayIst,
} from './portalApi';
import PasswordInput from '@ui/components/ui/PasswordInput';
import EarlyGoTag from '@ui/timeOff/EarlyGoTag';
import { wholeRupees as rupees } from '@ui/utils/money';
import TaxCompare from './TaxCompare';
import { AddToHome, LeaveCalendar } from './round58';
import { sentWords, useBackClose } from '@ui/picks/round58';
import { LeaveRules } from './LeaveRules';
import { LANGUAGES, LANGUAGE_CHOICE_ON, isLanguage, rememberLanguage, savedLanguage, usePageLanguage } from '@ui/i18n';
import { errorWords, enumWords } from '@ui/utils/errorWords';
import { dateWords } from '@ui/utils/dates';
import { PageHeader } from '@ui/components/ui/Primitives';
import ApproveActions from '@ui/components/ui/ApproveActions';
import ExceptionTag from '@ui/components/ui/ExceptionTag';
import { PortalLoading, RowState, kindOfPill } from './portalUi';
import './portal.css';

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
  /* Me: whether Ask HR is on (the Pay card hands over to it), a question it should open filled, and a nudge after resigning so My job reloads. */
  const [deskOn, setDeskOn] = useState(false);
  const [askPreset, setAskPreset] = useState(null);
  const [leavingSent, setLeavingSent] = useState(0);
  const presetUsed = useCallback(() => setAskPreset(null), []);
  const askBank = useCallback(() => setAskPreset({ category: 'PAYROLL', subject: 'Change my salary account', description: 'Please change the bank account my salary is paid into. Tell me how to give you the new account details.' }), []);
  const resigned = useCallback(() => setLeavingSent((n) => n + 1), []);
  /* A swap answered or withdrawn reloads My schedule below it. */
  const [scheduleKey, setScheduleKey] = useState(0);
  /* A day to fix, tapped on Today: My days opens with the missed-punch request filled in. */
  const [fix, setFix] = useState(null);
  /* Round 56: capitals in a PAN or IFSC as typed, and Enter moving to the next field. */
  useEffect(() => installFormRules(), []);
  /* Round 67: the app in Hindi or English, as the person chose on Me (this browser remembers it for the sign-in page).
   * Paused 19 Nov 2026: English for everyone while LANGUAGE_CHOICE_ON is false. */
  const [language, setLanguageNow] = useState(() => (LANGUAGE_CHOICE_ON ? savedLanguage() : 'en'));
  usePageLanguage(language);

  useEffect(() => {
    document.title = 'Employee portal · CLOR';
    document.documentElement.setAttribute('data-app', 'attendance');
    return () => {
      document.title = 'CLOR';
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

  const chooseLanguage = useCallback((code, { save = true } = {}) => {
    if (!isLanguage(code)) return;
    setLanguageNow(code);
    rememberLanguage(code);
    if (save) guard(setLanguage(code)).catch((e) => !(e instanceof SignedOut) && notify.error(errorWords(e, 'save the changes')));
  }, [guard]);

  const loadMe = useCallback(() => {
    guard(getMe())
      .then((d) => {
        setMe(d);
        setError('');
        /* The language kept on the person wins: a new phone opens in it too. */
        if (LANGUAGE_CHOICE_ON && d?.language && isLanguage(d.language)) chooseLanguage(d.language, { save: false });
      })
      .catch((e) => !(e instanceof SignedOut) && setError(errorWords(e, 'load this')));
  }, [guard, chooseLanguage]);
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
    <div className="ui-portal min-h-dvh pb-20" data-brand="d" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <header className="sticky top-0 z-10 border-b px-4 py-3" style={{ backgroundColor: 'rgb(var(--surface))', borderColor: 'rgb(var(--border))' }}>
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Fingerprint size={20} aria-hidden="true" style={{ color: 'rgb(var(--brand-ink))' }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me?.company?.name || 'Employee portal'}</div>
            <div className="ui-caption truncate">{me ? `${me.employee.name}${me.employee.code ? ` · ${me.employee.code}` : ''}` : ' '}</div>
          </div>
        </div>
      </header>

      {/* Calm register (design audit, 20 Nov 2026): one 24px title per tab, sections on the white page apart by a hairline, every control 44px on a phone. */}
      <main className="ui-touch-44 mx-auto max-w-md space-y-6 px-4 py-4">
        {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {tab === 'today' ? <PageHeader title="Today" counts={me?.today ? longDay(me.today) : null} /> : null}
        {tab === 'schedule' ? <PageHeader title="Schedule" /> : null}
        {tab === 'leave' ? <PageHeader title="Leave" /> : null}
        {tab === 'me' ? <PageHeader title="Me" /> : null}
        {tab === 'today' ? <><WhatsNew guard={guard} /><FixNotices guard={guard} onFix={(f) => { setFix(f); setTab('days'); }} /><AddToHome /><Today me={me} reload={loadMe} guard={guard} onAskInstead={(f) => { setFix(f); setTab('days'); }} /><NextHoliday guard={guard} today={todayIst()} />{me?.people !== false ? <TrainingsDue guard={guard} /> : null}<TodayPosts guard={guard} /><CompanyUpdates guard={guard} /></> : null}
        {tab === 'days' ? <><MyDays guard={guard} fix={fix} onFixUsed={() => setFix(null)} /><MonthReview guard={guard} /><MyOvertime guard={guard} /></> : null}
        {tab === 'approvals' ? <Approvals guard={guard} /> : null}
        {tab === 'schedule' ? <><ShiftSwaps guard={guard} onChanged={() => setScheduleKey((n) => n + 1)} /><MySchedule key={scheduleKey} guard={guard} /></> : null}
        {tab === 'leave' ? <MyLeave guard={guard} /> : null}
        {tab === 'me' ? (
          /* Every control on Me is a 44px target on a phone (QA, 1 Nov 2026: Add a bill, Change details and Sign out were 28px). */
          <div className="ui-touch-44 space-y-6">
            {/* Steps that are mine while I join or leave come first: they have dates. */}
            <MySteps guard={guard} refreshKey={leavingSent} />
            <ExitInterview guard={guard} refreshKey={leavingSent} />
            {me?.people !== false ? <><MyJobs guard={guard} /><MyGrowth guard={guard} /></> : null}
            <Payslips guard={guard} onAsk={deskOn ? setAskPreset : null} />
            {me?.people !== false ? <><MyMoney guard={guard} /><MyAssets guard={guard} /></> : null}
            <MyDetails guard={guard} refreshKey={leavingSent} />
            <MyForms guard={guard} />
            <NightConsent guard={guard} />
            {me?.people !== false ? <Celebrations guard={guard} /> : null}
            <Policies guard={guard} />
            {deskOn ? <PayCard onAsk={askBank} /> : null}
            <AskHr guard={guard} preset={askPreset} onPresetUsed={presetUsed} onAvailability={setDeskOn} />
            <PrivateComplaint guard={guard} />
            <LeavingCompany guard={guard} refreshKey={leavingSent} onSent={resigned} />
            <Account me={me} guard={guard} onSignOut={leave} language={language} onLanguage={LANGUAGE_CHOICE_ON ? chooseLanguage : undefined} />
          </div>
        ) : null}
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
                  className="flex w-full flex-col items-center gap-0.5 py-2 text-xs"
                  /* The open tab's words in the brand's ink: the neon itself (amber, orange) is too light for text on white. */
                  style={{ color: on ? 'rgb(var(--brand-ink))' : 'rgb(var(--fg-muted))', fontWeight: on ? 600 : 400 }}
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

const SIGN_IN_TABS = [
  ['signin', 'Sign in'],
  ['activate', 'First time? Activate'],
];

export function PortalSignIn({ onDone }) {
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
      setError(err?.status === 401 || /^Could not/.test(errorWords(err, 'sign in')) ? 'Could not sign in. Check the company code, employee code and password, or ask HR for a new activation code.' : errorWords(err, 'sign in'));
    } finally {
      setBusy(false);
    }
  };

  const choose = (k) => { setMode(k); setError(''); };
  const onTabKey = (e) => {
    const at = SIGN_IN_TABS.findIndex(([k]) => k === mode);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: SIGN_IN_TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [k] = SIGN_IN_TABS[(to + SIGN_IN_TABS.length) % SIGN_IN_TABS.length];
    choose(k);
    document.getElementById(`portal-tab-${k}`)?.focus();
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <div className="ui-touch-44 w-full max-w-sm space-y-5">
        <div className="space-y-1 text-center">
          <Fingerprint size={36} aria-hidden="true" className="mx-auto" style={{ color: 'rgb(var(--brand-ink))' }} />
          <h1 className="ui-t-page">Employee portal</h1>
          <p className="ui-caption">Your attendance, schedule and leave.</p>
        </div>
        {/*
          * The whole tab pattern (UI audit, 7 Nov 2026): the form is the tab panel, the chosen tab alone is in the Tab
          * order, and the arrow keys, Home and End move between the two. Kept as tabs, not pressed buttons, so the
          * submit button stays the only button called "Sign in".
          */}
        <div className="grid grid-cols-2 gap-1 rounded-lg p-1" role="tablist" aria-label="Sign in or activate" style={{ backgroundColor: 'rgb(var(--app-bg))' }} onKeyDown={onTabKey}>
          {SIGN_IN_TABS.map(([k, label]) => (
            <button
              key={k}
              id={`portal-tab-${k}`}
              type="button"
              role="tab"
              aria-selected={mode === k}
              aria-controls="portal-signin-panel"
              tabIndex={mode === k ? 0 : -1}
              className={`ui-btn ui-btn-sm ${mode === k ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
              onClick={() => choose(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4" id="portal-signin-panel" role="tabpanel" aria-labelledby={`portal-tab-${mode}`}>
          <label className="block">
            <span className="ui-label">Company code</span>
            <input className="ui-input ui-num w-full" required inputMode="numeric" autoComplete="organization" value={form.company} onChange={set('company')} placeholder="e.g. 4831920657" />
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
            <PasswordInput className="ui-input w-full" required autoComplete={mode === 'activate' ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} />
            {mode === 'activate' ? <span className="ui-caption">8 or more characters, with a letter and a digit. Only you will know it.</span> : null}
          </label>
          {mode === 'activate' ? (
            <label className="block">
              <span className="ui-label">Same password again</span>
              <PasswordInput className="ui-input w-full" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
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

function Today({ me, reload, guard, onAskInstead }) {
  if (!me) return <PortalLoading label="Loading your day…" />;
  const r = me.record;
  const s = me.shift;

  return (
    <>
      {me.privacy && !me.privacy.read ? <PrivacyNoticeCard guard={guard} onRead={reload} /> : null}
      {/* The date is the count line under the title; the day's state shows only when it needs attention. */}
      <section className="portal-sec space-y-3" aria-label="Today’s shift">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0">
            <span className="ui-label block">Today’s shift</span>
            <b className="font-semibold">{s.holiday ? `Holiday — ${s.holiday}` : s.off ? 'Weekly off' : s.label ? `${s.name} · ${s.label}` : `${s.name} · ${s.startTime}–${s.endTime}`}</b>
          </p>
          {r ? <DayState status={r.status} /> : null}
        </div>
        <dl className="grid grid-cols-3 gap-2">
          <div><dt className="ui-label">In</dt><dd className="portal-figure">{r?.checkInTime || '—'}</dd></div>
          <div><dt className="ui-label">Out</dt><dd className="portal-figure">{r?.checkOutTime || '—'}</dd></div>
          <div><dt className="ui-label">Worked</dt><dd className="portal-figure">{r?.checkOut ? hm(r.workedMinutes) : '—'}</dd></div>
        </dl>
        {r?.lateMinutes || r?.earlyOutMinutes ? <p className="flex flex-wrap gap-1.5">{r.lateMinutes ? <span className="ui-late-tag">Late {r.lateMinutes} min</span> : null}<EarlyGoTag minutes={r.earlyOutMinutes} /></p> : null}
      </section>

      {me.phone.allowed ? (
        <PhonePunch
          phone={me.phone}
          punches={me.punches}
          onPunch={(body) => guard(punch(body))}
          onDone={reload}
          shiftStart={s.off || s.holiday ? '' : s.startTime}
          /* Round 58 "outsidearea" A: outside the site, the punch goes to the manager as a request with a reason. */
          onAskInstead={({ kind, site, distance }) => {
            const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);
            onAskInstead?.({ date: me.today, ...(kind === 'IN' ? { checkIn: now } : { suggestedOut: now }), reasonCode: 'ON_DUTY', reason: `Punching from outside${site ? ` ${site}` : ' the work site'}${distance ? ` (${distance} away)` : ''}: ` });
          }}
        />
      ) : (
        <p className="ui-caption">{me.phone.why || 'Punch at the reader at work. Punching from your phone is not switched on for you.'}</p>
      )}

      <section className="portal-sec" aria-labelledby="punches-h">
        <h2 id="punches-h" className="ui-t-sec mb-2">Punches today</h2>
        {me.punches.length ? (
          <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
            {me.punches.map((p, i) => (
              <li key={i} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="tabular-nums font-semibold">{p.time}</span>
                <span className="ui-caption flex-1">{p.phone ? `Phone${p.site ? ` · ${p.site}` : ''}` : 'Reader'}</span>
                {/* In or out is what the punch is, not a state to flag: plain words, no tag. A reader that does not say gets nothing. */}
                {p.kind ? <span className="ui-muted">{p.kind === 'IN' ? 'In' : 'Out'}</span> : <span />}
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
/** "Thursday, 19 November": the count line under Today's title. */
const longDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/*
 * A day's state, tagged only when it needs attention (DESIGN.md "Status tags"): absent or a half day. Present is
 * the expected state and shows no tag (a screen reader still hears it); leave, a holiday and a weekly off are what
 * the day is, said in plain words.
 */
const DAY_EXCEPTIONS = new Set(['ABSENT', 'HALF_DAY']);
function DayState({ status }) {
  const label = STATUS[status]?.label || enumWords(status);
  if (DAY_EXCEPTIONS.has(status)) return <ExceptionTag label={label} pill={STATUS[status]?.pill} />;
  if (status === 'PRESENT') return <ExceptionTag normal={label} />;
  return <span className="ui-muted">{label}</span>;
}

function MyDays({ guard, fix = null, onFixUsed }) {
  const [month, setMonth] = useState(() => (fix ? fix.date.slice(0, 7) : todayIst().slice(0, 7)));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [explaining, setExplaining] = useState(null);
  const explainLoad = useCallback(() => guard(portalExplainDay(explaining)), [explaining, guard]);
  const closeExplain = useCallback(() => setExplaining(null), []);
  useBackClose(Boolean(explaining), closeExplain);
  /* Only the latest request may fill the screen: a slow earlier month must not overwrite the one picked since. */
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    guard(getAttendance(month))
      .then((d) => n === latest.current && (setData(d), setError('')))
      .catch((e) => n === latest.current && setError(errorWords(e, 'load your days')));
  }, [month, guard]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      {/* The month's totals are the count line under the title, not five tiles; a total at zero drops out. */}
      <PageHeader
        title="My days"
        actions={<input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
        counts={data ? [
          { key: 'present', label: 'Present', value: data.totals.present },
          { key: 'half', label: 'Half day', value: data.totals.halfDay, tone: 'warn' },
          { key: 'absent', label: 'Absent', value: data.totals.absent, tone: 'neg' },
          { key: 'leave', label: 'On leave', value: data.totals.leave },
          { key: 'late', label: 'Late', value: data.totals.late, tone: 'warn' },
        ] : null}
      />
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <PortalLoading label="Loading your days…" lines={5} />
      ) : (
        <>
          {month === todayIst().slice(0, 7) ? <WeekBars days={data.days} today={todayIst()} /> : null}
          <section>
            {data.days.length ? (
              <div className="overflow-x-auto ui-table-scroll ui-table-fit">
              <table className="ui-table w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="ui-th">Day</th>
                    <th scope="col" className="ui-th">Status</th>
                    <th scope="col" className="ui-th text-end">In – out</th>
                    <th scope="col" className="ui-th w-10"><span className="sr-only">Why</span></th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.days].reverse().map((d) => {
                    /* A past day with an in and no out is not paid until it is corrected: say so, here where it can be. */
                    const open = d.status === 'PRESENT' && d.checkIn && !d.checkOut && d.date < todayIst();
                    return (
                      <tr key={d.date}>
                        <td className="whitespace-nowrap">{dayLabel(d.date)}{d.shiftLabel ? <span className="ui-caption block">{d.shiftLabel}</span> : null}</td>
                        <td>
                          {open ? <ExceptionTag label="No punch out" /> : <DayState status={d.status} />}
                          {d.lateMinutes ? <span className="block"><span className="ui-late-tag">Late {d.lateMinutes} min</span></span> : null}
                          <EarlyGoTag minutes={d.earlyOutMinutes} block />
                        </td>
                        <td className="whitespace-nowrap text-end tabular-nums">
                          {d.checkIn ? `${d.checkIn} – ${d.checkOut || ''}`.trim() : '—'}
                        </td>
                        <td>
                          <button type="button" className="ui-icon-btn" aria-label={`Why is ${dayLabel(d.date)} ${STATUS[d.status]?.label?.toLowerCase() || d.status}?`} onClick={() => setExplaining(d.date)}>
                            <HelpCircle size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="ui-caption py-4">Nothing recorded this month yet.</p>
            )}
          </section>
        </>
      )}

      <MyMarks guard={guard} month={month} />
      <Requests guard={guard} month={month} onChanged={load} preset={fix} onPresetUsed={onFixUsed} />
      <DayExplain open={Boolean(explaining)} onClose={closeExplain} load={explainLoad} title="Why my day says this" />
    </>
  );
}

const REQUEST_PILL = { PENDING: 'ui-pill-warn', APPROVED: 'ui-pill-pos', REJECTED: 'ui-pill-neg', CANCELLED: 'ui-pill-neutral' };
const REQUEST_LABEL = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Not approved', CANCELLED: 'Cancelled' };
/* Tags only on exceptions: waiting and not approved. Approved is expected (read out, not shown); cancelled is a plain word. */
const RequestPill = ({ status }) => <RowState label={REQUEST_LABEL[status] || enumWords(status)} pill={REQUEST_PILL[status]} kind={kindOfPill(REQUEST_PILL[status] || 'ui-pill-warn')} />;
/* Approved leave I asked to cancel (round 47): still approved, waiting on the approver. */
const LeavePill = ({ r }) => (r.status === 'APPROVED' && r.cancelAsked ? <span className="ui-pill ui-pill-warn">Approved · cancellation asked</span> : <RequestPill status={r.status} />);

/*
 * Requests (TIME-LEAVE-DECISIONS.md, advanced build): a missed punch, and —
 * when the company switches them on — work from home, on duty and permission
 * hours, from one card with the fields the kind needs and what is left of the
 * month's quota. Below it, what I asked for this month, with Change while it
 * waits and Cancel while it can be.
 */
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDayYear = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const hoursText = (minutes) => {
  const m = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(m / 60);
  return [h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '', m % 60 ? `${m % 60} min` : ''].filter(Boolean).join(' ');
};
/** "2 of 4 used", "1 of 3 used, 1 waiting", "2 used, no limit". */
const usageLine = (u) => (!u ? '' : `${u.quota == null ? `${u.used} used, no limit` : `${u.used} of ${u.quota} used`}${u.pending ? `, ${u.pending} waiting` : ''}`);
/** What a request says about itself: dates, half day, place, hours. */
export const requestWords = (r) => {
  const when = !r.toDate || r.toDate === r.date ? fmtDay(r.date) : `${fmtDay(r.date)} – ${fmtDay(r.toDate)}`;
  const kind = r.requestKind || r.kind;
  const extra = kind === 'SHIFT_CHANGE' ? (r.shiftName ? `to ${r.shiftName}` : '') : kind === 'ON_DUTY' ? r.place : kind === 'PERMISSION' ? `${r.checkIn || ''}–${r.checkOut || ''}, ${hoursText(r.minutes)}` : kind === 'MISSED_PUNCH' || r.kind === 'correction' ? `in ${r.checkIn || '—'}${r.checkOut ? `, out ${r.checkOut}` : ''}` : r.halfDay ? (r.halfDay === 'FIRST' ? 'first half' : 'second half') : '';
  return extra ? `${when} · ${extra}` : when;
};
const EMPTY_ASK = { kind: '', date: '', toDate: '', halfDay: '', place: '', shiftId: '', checkIn: '', checkOut: '', reason: '', reasonCode: '' };

function Requests({ guard, month, onChanged, preset = null, onPresetUsed }) {
  const [rules, setRules] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_ASK);
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    /* The list is every recent request of mine, whatever month is on view; the month decides only the usage line. */
    Promise.all([guard(requestRules(month)), guard(listRequests())])
      .then(([r, l]) => { if (n !== latest.current) return; setRules(r); setList(l); setError(''); })
      .catch((e) => n === latest.current && !(e instanceof SignedOut) && setError(errorWords(e, 'load your requests')));
  }, [month, guard]);
  useEffect(() => { load(); }, [load]);
  const formRef = useRef(null);
  useEffect(() => {
    if (!preset) return;
    setEditing(null);
    setForm({ ...EMPTY_ASK, kind: 'MISSED_PUNCH', date: preset.date, checkIn: preset.checkIn || preset.suggestedIn || '', checkOut: preset.suggestedOut || '', reasonCode: preset.reasonCode || 'FORGOT_PUNCH', reason: preset.reason || (preset.what === 'NO_OUT' ? 'Forgot to punch out' : 'Forgot to punch') });
    formRef.current?.scrollIntoView?.({ block: 'start' });
    onPresetUsed?.();
  }, [preset, onPresetUsed]);

  const kinds = rules?.kinds || [];
  const kind = form.kind || (editing ? editing.requestKind : kinds[0]?.kind) || '';
  const spans = kind === 'WFH' || kind === 'ON_DUTY' || kind === 'SHIFT_CHANGE';
  const oneDay = spans && kind !== 'SHIFT_CHANGE' && form.date && (!form.toDate || form.toDate === form.date);
  const usage = rules?.usage?.[kind];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  /* Round 56 (datedefaults A): a fix or a request is most often for today, so the date starts there. */
  const pick = (k) => { setEditing(null); setForm({ ...EMPTY_ASK, kind: k, date: todayIst() }); setNote(null); };
  const startChange = (r) => {
    setEditing(r);
    setNote(null);
    setForm({ kind: r.requestKind, date: r.date, toDate: r.toDate || r.date, halfDay: r.halfDay || '', place: r.place || '', shiftId: r.shiftId || '', checkIn: r.checkIn || '', checkOut: r.checkOut || '', reason: r.reason || '', reasonCode: r.reasonCode || '' });
  };

  const send = async (e) => {
    e.preventDefault();
    setNote(null);
    setBusy('send');
    const body = {
      kind, date: form.date, reason: form.reason,
      toDate: spans && form.toDate && form.toDate !== form.date ? form.toDate : null,
      halfDay: oneDay && form.halfDay ? form.halfDay : null,
      place: kind === 'ON_DUTY' ? form.place : null,
      shiftId: kind === 'SHIFT_CHANGE' ? form.shiftId : null,
      checkIn: kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? form.checkIn : null,
      checkOut: kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? form.checkOut || null : null,
      reasonCode: kind === 'MISSED_PUNCH' ? form.reasonCode || null : null,
    };
    try {
      await guard(editing ? changeRequest(editing.id, body) : askRequest(body));
      setNote({ ok: true, text: editing ? 'Changed. It waits for approval.' : 'Sent for approval.' });
      setForm({ ...EMPTY_ASK, kind, date: todayIst() });
      setEditing(null);
      load();
      onChanged?.();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    } finally {
      setBusy('');
    }
  };
  const cancel = async (r) => {
    const ok = await confirmDialog({ title: r.status === 'APPROVED' ? 'Cancel this request?' : 'Withdraw this request?', confirmLabel: r.status === 'APPROVED' ? 'Cancel request' : 'Withdraw' });
    if (!ok) return;
    setBusy(r.id);
    try {
      await guard(cancelPortalRequest(r.id));
      setNote({ ok: true, text: r.status === 'APPROVED' ? 'Cancelled.' : 'Withdrawn.' });
      load();
      onChanged?.();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'do that') });
    } finally {
      setBusy('');
    }
  };

  const mine = (list?.requests || []).filter((r) => r.kind === 'correction' || r.kind === 'request');
  return (
    <>
      <form ref={formRef} onSubmit={send} className="portal-sec space-y-3" aria-labelledby="ask-h">
        <h2 id="ask-h" className="ui-t-sec">{editing ? `Change: ${editing.kindName}` : 'Ask'}</h2>
        <LoadFailed message={error} onRetry={load} />
        {!editing && kinds.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
            {kinds.map((k) => <button key={k.kind} type="button" className="ui-choice-chip" aria-pressed={kind === k.kind} onClick={() => pick(k.kind)}>{k.name}</button>)}
          </div>
        ) : null}
        {!kinds.length && rules ? <p className="ui-caption">Nothing can be asked for right now.</p> : null}
        {kind ? (
          <>
            <div className={spans ? 'grid grid-cols-2 gap-3' : ''}>
              <label className="block"><span className="ui-label">{spans ? 'First day' : 'Day'}</span><input type="date" className="ui-input w-full" required max={kind === 'MISSED_PUNCH' ? todayIst() : undefined} value={form.date} onChange={(e) => set({ date: e.target.value, ...(spans && (!form.toDate || form.toDate < e.target.value) ? { toDate: e.target.value } : {}) })} /></label>
              {spans ? <label className="block"><span className="ui-label">Last day</span><input type="date" className="ui-input w-full" required min={form.date} value={form.toDate} onChange={(e) => set({ toDate: e.target.value })} /></label> : null}
            </div>
            {oneDay ? (
              <label className="block"><span className="ui-label">Day</span>
                <select className="ui-select w-full" value={form.halfDay} onChange={(e) => set({ halfDay: e.target.value })}>
                  <option value="">Whole day</option><option value="FIRST">First half</option><option value="SECOND">Second half</option>
                </select>
              </label>
            ) : null}
            {kind === 'SHIFT_CHANGE' ? (
              <label className="block"><span className="ui-label">Shift to work</span>
                <select className="ui-select w-full" required value={form.shiftId} onChange={(e) => set({ shiftId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(rules?.shifts || []).map((x) => <option key={x.id} value={x.id}>{x.name}, {x.startTime}–{x.endTime}</option>)}
                </select>
              </label>
            ) : null}
            {kind === 'ON_DUTY' ? <label className="block"><span className="ui-label">Place</span><input className="ui-input w-full" required maxLength={120} value={form.place} onChange={(e) => set({ place: e.target.value })} /></label> : null}
            {kind === 'MISSED_PUNCH' || kind === 'PERMISSION' ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="ui-label">{kind === 'PERMISSION' ? 'From' : 'In'}</span><input type="time" className="ui-input w-full" required value={form.checkIn} onChange={(e) => set({ checkIn: e.target.value })} /></label>
                <label className="block"><span className="ui-label">{kind === 'PERMISSION' ? 'To' : 'Out'}</span><input type="time" className="ui-input w-full" required={kind === 'PERMISSION'} value={form.checkOut} onChange={(e) => set({ checkOut: e.target.value })} /></label>
              </div>
            ) : null}
            {kind === 'MISSED_PUNCH' ? (
              <fieldset className="ui-reason-chips">
                <legend className="ui-label">What happened</legend>
                <div className="ui-reason-chips-row">
                  {REASON_CODES.map((c) => (
                    <label key={c.value} className="ui-reason-chip">
                      <input type="radio" name="missed-reason" value={c.value} checked={form.reasonCode === c.value} onChange={() => set({ reasonCode: c.value, reason: form.reason || c.label })} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <label className="block"><span className="ui-label">Why</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
            {usage ? <p className="ui-caption tabular-nums">{usage.unit === 'hours' ? 'Permission hours' : usage.unit === 'requests' ? 'Missed-punch requests' : `${kind === 'WFH' ? 'Work-from-home' : 'On-duty'} days`} this month: {usageLine(usage)}{usage.quota != null ? `, ${usage.left} left` : ''}.</p> : null}
            {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
            <div className="flex gap-2">
              <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy === 'send'}>{busy === 'send' ? 'Saving…' : editing ? 'Save' : 'Send'}</button>
              {editing ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setEditing(null); setForm({ ...EMPTY_ASK, kind: kinds[0]?.kind || '' }); }}>Cancel</button> : null}
            </div>
          </>
        ) : null}
      </form>

      {mine.length ? (
        <section className="portal-sec" aria-labelledby="mine-h">
          <h2 id="mine-h" className="ui-t-sec mb-2">My requests</h2>
          <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
            {mine.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span><span>{r.kindName}</span><span className="block tabular-nums">{requestWords(r)}</span><span className="ui-caption block">{r.reason}{r.note ? ` — ${r.note}` : ''}</span></span>
                  <RequestPill status={r.status} />
                </div>
                {r.canChange || r.canCancel ? (
                  <div className="flex gap-2">
                    {r.canChange ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy === r.id} onClick={() => startChange(r)}>Change</button> : null}
                    {r.canCancel ? <button type="button" className="ui-btn ui-btn-ghost" disabled={busy === r.id} onClick={() => cancel(r)}>Cancel</button> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function MySchedule({ guard }) {
  /* Round 48 "myshifts" A: the next 14 days first, today on top; the whole month on request. */
  const [view, setView] = useState('next');
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const next = useNextDays(guard, todayIst(), 14, attempt);
  useEffect(() => {
    let off = false;
    guard(getSchedule(month))
      .then((d) => !off && (setData(d), setError('')))
      .catch((e) => !off && setError(errorWords(e, 'load your schedule')));
    return () => {
      off = true;
    };
  }, [month, guard, attempt]);
  const t = todayIst();
  return (
    <section className="portal-sec space-y-3" aria-labelledby="sched-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sched-h" className="ui-t-sec">My schedule</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ui-sched-view" role="group" aria-label="Show">
            <button type="button" className="ui-sched-view-btn" aria-pressed={view === 'next'} onClick={() => setView('next')}>Next 14 days</button>
            <button type="button" className="ui-sched-view-btn" aria-pressed={view === 'month'} onClick={() => setView('month')}>Whole month</button>
          </div>
          {view === 'month' ? <input type="month" className="ui-input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" /> : null}
        </div>
      </div>
      <LoadFailed message={view === 'next' ? next.error : error} onRetry={() => setAttempt((n) => n + 1)} />
      {!(view === 'next' ? next.days : data) ? (
        (view === 'next' ? next.error : error) ? null : <PortalLoading label="Loading your schedule…" lines={5} />
      ) : (
        <ul className="divide-y border-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
          {(view === 'next' ? next.days : data.days).map((d) => (
            /* Today is marked in weight, not a tinted band (white grounds only). */
            <li key={d.date} className={`flex min-h-11 items-center gap-3 py-2${d.date === t ? ' font-semibold' : ''}`} aria-current={d.date === t ? 'date' : undefined}>
              <span className="w-24 shrink-0 whitespace-nowrap">{dayLabel(d.date)}</span>
              {d.kind === 'WORK' ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color || 'rgb(var(--fg-muted))' }} aria-hidden="true" />
                  {d.shift} <span className="ui-caption tabular-nums">{d.startTime}–{d.endTime}</span>
                </span>
              ) : (
                <span className="ui-muted">{d.kind === 'OFF' ? 'Weekly off' : d.kind === 'HOLIDAY' ? `Holiday${d.holiday ? ` — ${d.holiday}` : ''}` : 'On leave'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/** Which half of a one-day request, in the words the form used (E2: the row said "0.5 days" and not which half). */
const halfWords = (half) => (half === 'FIRST' ? 'first half (morning)' : half === 'SECOND' ? 'second half (afternoon)' : '');
const BLANK_LEAVE = { leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', startHalf: false, endHalf: false, fromTime: '', toTime: '', reason: '' };
const daysText = (n) => (n === 0.5 ? 'half a day' : `${n} day${n === 1 ? '' : 's'}`);
const NUMBER_WORD = ['', 'one', 'two', 'three', 'four'];

/**
 * What the request would charge, asked of the server as the dates are picked
 * (AUT-05), so what the person sees is what the save does. `last` is the
 * newest answer for any dates; `preview` only the one for the dates on screen.
 */
function useLeavePreview(run, form, type) {
  const key = form.leaveTypeId && form.fromDate && hoursReady(form, type)
    ? JSON.stringify({ leaveTypeId: form.leaveTypeId, fromDate: form.fromDate, toDate: form.toDate || form.fromDate, ...halfDayBody(form, !isHourly(type)), ...hoursBody(form, type) })
    : '';
  const [got, setGot] = useState(null);
  useEffect(() => {
    if (!key) return undefined;
    let off = false;
    const timer = setTimeout(() => {
      run(JSON.parse(key))
        .then((p) => { if (!off) setGot({ ...p, key }); })
        .catch((e) => {
          if (!off && !(e instanceof SignedOut)) setGot({ key, ok: false, total: 0, parts: [], problems: [{ code: 'INPUT', message: errorWords(e, 'work out the days') }] });
        });
    }, 300);
    return () => { off = true; clearTimeout(timer); };
  }, [key, run]);
  const preview = got && got.key === key ? got : null;
  return { preview, last: got, checking: Boolean(key) && !preview };
}

/**
 * The preview while a request of mine is being changed still sees the request
 * itself: an overlap with its own dates and a balance short by its own days
 * are not problems, and the balance after gets its own days back when the
 * type is unchanged. The server checks the rest on save.
 */
function ownPreview(p, request) {
  if (!p || !request) return p;
  const sameType = Boolean(p.type) && (p.type.id === request.leaveTypeId || p.type.name === request.leaveTypeName);
  const own = (x) => (x.code === 'OVERLAP' && String(x.message || '').includes(request.fromDate) && String(x.message || '').includes(request.toDate)) || (x.code === 'NO_BALANCE' && sameType);
  const parts = p.parts || [];
  return {
    ...p,
    problems: (p.problems || []).filter((x) => !own(x)),
    parts: sameType && parts.length === 1 ? parts.map((x) => (x.balance?.after == null ? x : { ...x, balance: { ...x.balance, after: Math.round((x.balance.after + request.days) * 100) / 100 } })) : parts,
  };
}

/** The days a request takes, the dates it skips and why, the balance after, and anything stopping it. */
function LeavePreview({ preview, checking }) {
  if (!preview) return checking ? <p className="ui-caption" role="status">Working out the days…</p> : null;
  const parts = preview.parts || [];
  const saved = parts.filter((p) => p.days > 0);
  /* An hourly type says hours (gap 23): asked, and left after. */
  const amount = (n) => (isHourly(preview.type) ? amountWords(n, preview.type) : daysText(n));
  return (
    <div className="space-y-2 text-sm" role="status" aria-live="polite">
      {preview.total ? <p className="font-semibold tabular-nums">{amount(preview.total)}</p> : null}
      {preview.split && saved.length > 1 ? (
        <div>
          <p>This crosses the end of the leave period, so it is saved as {NUMBER_WORD[saved.length] || saved.length} requests, one per leave period.</p>
          <ul className="ui-caption">
            {saved.map((p) => <li key={p.label} className="tabular-nums">{p.label}: {amount(p.days)}</li>)}
          </ul>
        </div>
      ) : null}
      <DateNotes parts={parts} label={dayLabel} className="ui-caption" />
      {saved.filter((p) => p.balance?.after != null).map((p) => (
        <p key={p.label} className="tabular-nums">{saved.length > 1 ? `${p.label}: ` : ''}{isHourly(preview.type) ? amountWords(p.balance.after, preview.type) : p.balance.after} left after this</p>
      ))}
      {(preview.problems || []).map((x) => <p key={x.code + x.message} role="alert" style={{ color: 'rgb(var(--neg))' }}>{x.message}</p>)}
    </div>
  );
}

function MyLeave({ guard }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(BLANK_LEAVE);
  /* The document a long request of some types asks for (a certificate). A change keeps the one already sent, so it is not asked again. */
  const [doc, setDoc] = useState(null);
  const [sending, setSending] = useState(false);
  const runPreview = useCallback((body) => guard(previewLeave(body)), [guard]);
  const listed = (data?.types || []).find((t) => t.id === form.leaveTypeId);
  const hourly = isHourly(listed);
  const { preview, last, checking } = useLeavePreview(runPreview, form, listed);
  const type = last?.type && last.type.id === form.leaveTypeId ? last.type : null;
  const halfAllowed = Boolean((type || listed)?.allowHalfDay) && !hourly;
  const reasonNeeded = !type?.isPrivate;
  const blocked = Boolean(preview?.problems?.length);
  const [note, setNote] = useState(null);
  const [error, setError] = useState('');
  const [explaining, setExplaining] = useState(null);
  const explainLoad = useCallback(() => guard(portalExplainLeave(explaining)), [explaining, guard]);
  const closeExplain = useCallback(() => setExplaining(null), []);
  useBackClose(Boolean(explaining), closeExplain);
  const loadMonth = useCallback((ym) => guard(getSchedule(ym)), [guard]);

  const load = useCallback(() => {
    guard(getLeave())
      .then((d) => (setData(d), setError('')))
      .catch((e) => setError(errorWords(e, 'load your leave')));
  }, [guard]);
  useEffect(() => {
    load();
  }, [load]);

  const ask = async (e) => {
    e.preventDefault();
    if (blocked || sending || (preview?.documentNeeded && !doc)) return;
    setNote(null);
    setSending(true);
    try {
      const r = await guard(askLeave({
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        ...halfDayBody(form, halfAllowed),
        ...hoursBody(form, listed),
        reason: form.reason.trim(),
        ...(preview?.split ? { split: true } : {}),
        ...(doc ? { attachment: doc } : {}),
      }));
      setDoc(null);
      const sent = r.requests || [r.request];
      const days = Math.round(sent.reduce((a, x) => a + (Number(x.days) || 0), 0) * 100) / 100;
      setNote({ ok: true, text: `Asked for ${isHourly(listed) ? amountWords(days, listed) : daysText(days)} of ${r.request.leaveTypeName}${preview?.split && sent.length > 1 ? `, as ${NUMBER_WORD[sent.length] || sent.length} requests` : ''}.`, sentId: r.request?.id || null });
      setForm(BLANK_LEAVE);
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    } finally {
      setSending(false);
    }
  };
  /* Approved leave (round 47): "Cancel" asks whoever approved it, with an optional reason, in a small form on the row. */
  const [asking, setAsking] = useState({ id: null, reason: '' });
  const cancel = async (r) => {
    if (r.status === 'APPROVED') { setAsking({ id: r.id, reason: '' }); setNote(null); return; }
    const span = r.fromDate === r.toDate ? dayLabel(r.fromDate) : `${dayLabel(r.fromDate)} – ${dayLabel(r.toDate)}`;
    const ok = await confirmDialog({ title: 'Withdraw this request?', message: `${r.leaveTypeName}, ${span}. It will not be decided.`, confirmLabel: 'Withdraw' });
    if (!ok) return;
    try {
      await guard(cancelLeave(r.id));
      setNote({ ok: true, text: 'Request withdrawn.' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'cancel it') });
    }
  };
  const askCancel = async (e) => {
    e.preventDefault();
    try {
      await guard(cancelLeave(asking.id, asking.reason.trim()));
      setAsking({ id: null, reason: '' });
      setNote({ ok: true, text: 'Asked to cancel. Your leave stays approved until it is agreed.' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    }
  };
  /* Round 18/47: remind whoever it waits on, once a day. */
  const remind = async (r) => {
    try {
      await guard(remindLeave(r.id));
      setNote({ ok: true, text: 'Reminder sent.' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    }
  };
  /* Round 27: the approver sent it back with a question; the answer sends it back to them. */
  const [answering, setAnswering] = useState({ id: null, text: '' });
  const answer = async (e) => {
    e.preventDefault();
    if (!answering.text.trim()) return;
    try {
      await guard(answerLeaveQuestion(answering.id, answering.text.trim()));
      setAnswering({ id: null, text: '' });
      setNote({ ok: true, text: 'Answer sent.' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    }
  };
  /* Change a waiting request: the ask form, prefilled, saves over it. */
  const [editing, setEditing] = useState(null);
  const formRef = useRef(null);
  const startChange = (r) => {
    setEditing(r);
    setNote(null);
    setForm({ leaveTypeId: r.leaveTypeId || data.types.find((t) => t.name === r.leaveTypeName)?.id || '', ...leaveSpan(r, data.requests || []), fromTime: r.fromTime || '', toTime: r.toTime || '', reason: r.reason || '' });
    formRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const stopChange = () => { setEditing(null); setForm(BLANK_LEAVE); };
  /* While changing, the preview still sees the request itself; its own overlap and its own days are not problems. */
  const shown = editing ? ownPreview(preview, editing) : preview;
  const held = Boolean(shown?.problems?.length) || (Boolean(shown?.documentNeeded) && !doc && !editing);
  const change = async (e) => {
    e.preventDefault();
    if (sending || !editing || held) return;
    setNote(null);
    setSending(true);
    try {
      await guard(editLeave(editing.id, {
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        ...halfDayBody(form, halfAllowed),
        ...hoursBody(form, listed),
        reason: form.reason.trim(),
        ...(preview?.split ? { split: true } : {}),
        ...(doc ? { attachment: doc } : {}),
      }));
      setDoc(null);
      setNote({ ok: true, text: 'Changed. It waits for a decision again.' });
      stopChange();
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'make the change') });
    } finally {
      setSending(false);
    }
  };
  /* Came back early: the approved leave I am on ends on an earlier day. */
  const [shortening, setShortening] = useState(null);
  const [shortTo, setShortTo] = useState('');
  const shorten = async (e) => {
    e.preventDefault();
    if (!shortening || !shortTo || sending) return;
    setSending(true);
    try {
      await guard(shortenLeave(shortening.id, shortTo));
      setNote({ ok: true, text: `Your leave now ends ${dayLabel(shortTo)}.` });
      setShortening(null);
      setShortTo('');
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'make the change') });
    } finally {
      setSending(false);
    }
  };
  /* Round 58 "aftersend" A: once the list reloads, the request just sent says who has it and what happens next. */
  const sentRow = note?.sentId ? (data?.requests || []).find((x) => x.id === note.sentId) : null;
  const shortenable = (r) => r.status === 'APPROVED' && !r.halfDay && !r.fromTime && r.fromDate <= data?.today && r.toDate > data?.today;
  const dayBefore = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  if (!data) return error ? <LoadFailed message={error} onRetry={load} /> : <PortalLoading label="Loading your leave…" lines={4} />;
  return (
    <>
      {/* Balances as rows on the page, the number on the right (no tiles, no cards). */}
      <section className="portal-sec space-y-2" aria-labelledby="bal-h">
      <h2 id="bal-h" className="ui-t-sec">My leave {data.year}</h2>
      {data.types.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {data.types.map((t) => (
            <li key={t.id} className="space-y-1 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{t.name}</span>
                {t.isPaid ? (
                  /* Round 58 "balancewhy" A: the number itself opens how it is worked out. */
                  <button type="button" className="ui-bal-why portal-figure text-right" onClick={() => setExplaining(t.id)} aria-label={`${amountFigure(t.available, t)} ${isHourly(t) ? 'hours' : 'days'} of ${t.name} left: how is this worked out?`}>{amountFigure(t.available, t)}</button>
                ) : (
                  <span className="ui-caption">Unpaid · {t.used} taken</span>
                )}
              </div>
              {t.isPaid ? (
                <>
                  {/* An hourly type's balance is in hours (gap 23). */}
                  <div className="ui-caption">{isHourly(t) ? 'hours ' : ''}left of {amountFigure(t.allocated, t)}{t.pending ? ` · ${amountFigure(t.pending, t)} waiting` : ''}</div>
                  {/* Owner's pick (17 Nov 2026, round 7): the number with a bar of what is left. */}
                  {t.allocated > 0 ? <span className="ui-bal-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (t.available / t.allocated) * 100))}%` }} /></span> : null}
                  {/* Comp-off under a validity: the days that go first, and when. */}
                  {t.expiring?.length ? <div className="ui-caption tabular-nums">{expiringWords(t.expiring, fmtDayYear)}</div> : null}
                  <button type="button" className="ui-link text-xs" onClick={() => setExplaining(t.id)}>How is this worked out?</button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-caption">No leave types are set up yet.</p>
      )}
      </section>
      {/* Round 59 leavepolicyread A: each type's rule in one line, so the answer is here, not with HR. */}
      <LeaveRules types={data.types} />

      {data.types.length ? (
        <form ref={formRef} onSubmit={editing ? change : ask} className="portal-sec space-y-3" aria-labelledby="ask-leave-h">
          {/* Round 58 "stickysubmit" C: Send sits top right and stays in reach while the form scrolls. */}
          <div className="ui-form-top">
            <h2 id="ask-leave-h" className="ui-t-sec">{editing ? 'Change leave' : 'Ask for leave'}</h2>
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={held || sending}>{sending ? (editing ? 'Saving…' : 'Sending…') : editing ? 'Save' : 'Send'}</button>
          </div>
          <label className="block">
            <span className="ui-label">Leave type *</span>
            <select className="ui-select w-full" required value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value, halfDay: '', fromTime: '', toTime: '' })}>
              <option value="">Choose…</option>
              {data.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <LeaveCalendar
            from={form.fromDate}
            to={form.toDate}
            single={hourly}
            today={data.today}
            loadMonth={loadMonth}
            onChange={({ from, to }) => setForm({ ...form, fromDate: from, toDate: to, halfDay: to && to !== from ? '' : form.halfDay })}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="ui-label">{hourly ? 'Day *' : 'First day *'}</span><input type="date" className="ui-input w-full" required value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate && form.toDate < e.target.value ? e.target.value : form.toDate })} /></label>
            {hourly ? null : <label className="block"><span className="ui-label">Last day</span><input type="date" className="ui-input w-full" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value, halfDay: e.target.value && e.target.value !== form.fromDate ? '' : form.halfDay })} /></label>}
          </div>
          {hourly
            ? <HoursChoice native form={form} onChange={(patch) => setForm({ ...form, ...patch })} />
            : <HalfDayChoice native form={form} allowed={halfAllowed} typeName={(type || listed)?.name} label="How much of the day" onChange={(patch) => setForm({ ...form, ...patch })} />}
          <label className="block">
            <span className="ui-label">{reasonNeeded ? 'Reason *' : 'Reason'}</span>
            <input className="ui-input w-full" required={reasonNeeded} minLength={reasonNeeded ? 3 : undefined} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          {shown?.documentNeeded || doc ? <LeaveDocumentField typeName={type?.name} afterDays={shown?.documentAfterDays} value={doc} onChange={setDoc} required={!editing} note={editing ? 'The one already sent stays unless you choose another.' : ''} /> : null}
          <LeavePreview preview={shown} checking={checking} />
          <PreviewNotes preview={shown} />
          {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}{note.ok && sentRow?.status === 'PENDING' ? <> {sentWords(sentRow.withWhom)} <button type="button" className="ui-link" onClick={() => document.getElementById(`leave-req-${sentRow.id}`)?.scrollIntoView?.({ block: 'center' })}>View request</button></> : null}</p> : null}
          {editing ? <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={stopChange}>Keep it as it was</button> : null}
        </form>
      ) : null}

      {data.requests.length ? (
        <section className="portal-sec" aria-labelledby="leave-list-h">
          <h2 id="leave-list-h" className="ui-t-sec mb-2">My requests</h2>
          <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
            {data.requests.map((r) => (
              <li key={r.id} id={`leave-req-${r.id}`} className="flex items-start justify-between gap-2 py-3" data-just-sent={r.id === note?.sentId || undefined}>
                <span>
                  {r.leaveTypeName} · {r.fromTime && r.toTime ? hoursWords(hoursBetween(r.fromTime, r.toTime)) : r.days === 0.5 ? 'half a day' : `${r.days} day${r.days === 1 ? '' : 's'}`}
                  <span className="ui-caption block">{r.fromDate === r.toDate ? dayLabel(r.fromDate) : `${dayLabel(r.fromDate)} – ${dayLabel(r.toDate)}`}{leaveHours(r) ? `, ${leaveHours(r)}` : halfWords(r.halfDay) ? `, ${halfWords(r.halfDay)}` : ''}{!leaveHours(r) && r.overflowOfId ? ', over the balance: loss of pay' : ''}</span>
                  {r.note && r.status !== 'PENDING' ? <span className="ui-caption block">“{r.note}”</span> : null}
                  {r.status === 'PENDING' && r.withWhom ? <span className="ui-caption block">{r.withWhom}</span> : null}
                  {r.status === 'APPROVED' && r.cancelAsked ? <span className="ui-caption block">You asked to cancel this. It stays approved until whoever approved it agrees.</span> : null}
                  {r.status === 'PENDING' && r.question ? (
                    <span className="block mt-1">
                      <span className="ui-caption block">Question for you: “{r.question.note}”</span>
                      <form onSubmit={answer} className="flex flex-wrap items-end gap-2 pt-1" aria-label="Your answer">
                        <label className="block flex-1 min-w-[10rem]">
                          <span className="ui-label">Your answer</span>
                          <input className="ui-input w-full" maxLength={500} value={answering.id === r.id ? answering.text : ''} onChange={(e) => setAnswering({ id: r.id, text: e.target.value })} />
                        </label>
                        <button type="submit" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={answering.id !== r.id || !answering.text.trim()}>Send answer</button>
                      </form>
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <LeavePill r={r} />
                  <span className="flex gap-3">
                    {r.status === 'PENDING' && editing?.id !== r.id ? <button type="button" className="ui-link text-xs" onClick={() => startChange(r)}>Change</button> : null}
                    {r.status === 'PENDING' && 'canRemind' in r ? <button type="button" className="ui-link text-xs" disabled={!r.canRemind} title={r.canRemind ? undefined : 'Reminded today. You can remind again tomorrow.'} onClick={() => remind(r)}>{r.canRemind ? 'Remind' : 'Reminded'}</button> : null}
                    {shortenable(r) && shortening?.id !== r.id ? <button type="button" className="ui-link text-xs" onClick={() => { setShortening(r); setShortTo(''); setNote(null); }}>Came back early</button> : null}
                    {r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > data.today && !r.cancelAsked && asking.id !== r.id) ? (
                      <button type="button" className="ui-link text-xs" onClick={() => cancel(r)}>Cancel</button>
                    ) : null}
                  </span>
                  {asking.id === r.id ? (
                    <form onSubmit={askCancel} className="flex flex-wrap items-end justify-end gap-2 pt-1" aria-label="Ask to cancel">
                      <label className="block">
                        <span className="ui-label">Why cancel (optional)</span>
                        <input className="ui-input" maxLength={500} value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} />
                      </label>
                      <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm">Ask to cancel</button>
                      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAsking({ id: null, reason: '' })}>Keep leave</button>
                    </form>
                  ) : null}
                  {shortening?.id === r.id ? (
                    <form onSubmit={shorten} className="flex flex-wrap items-end justify-end gap-2 pt-1" aria-label="Came back early">
                      <label className="block">
                        <span className="ui-label">Last day of leave</span>
                        <input type="date" className="ui-input" required min={r.fromDate} max={dayBefore(r.toDate)} value={shortTo} onChange={(e) => setShortTo(e.target.value)} />
                      </label>
                      <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!shortTo || sending}>Save</button>
                      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setShortening(null); setShortTo(''); }}>Cancel</button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <HolidaysYear guard={guard} />
      <LeaveExplain open={Boolean(explaining)} onClose={closeExplain} load={explainLoad} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

function Account({ me, guard, onSignOut, language = 'en', onLanguage }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  /* A letter approved at once (no approver but me) reloads My documents. */
  const [docsAt, setDocsAt] = useState(0);
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
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'make the change') });
    }
  };
  return (
    <>
      {me ? (
        <section className="portal-sec space-y-1" aria-label="You">
          <div className="font-semibold">{me.employee.name}</div>
          <div className="ui-caption">{[me.employee.code, me.employee.designation, me.employee.department].filter(Boolean).join(' · ')}</div>
          <div className="ui-caption">{me.company.name}{me.company.code ? ` · ${me.company.code}` : ''}</div>
        </section>
      ) : null}
      {onLanguage ? <LanguageChoice language={language} onLanguage={onLanguage} /> : null}
      <MyTax guard={guard} />
      <MyDocuments key={docsAt} guard={guard} />
      <AskLetter guard={guard} onIssued={() => setDocsAt(Date.now())} />
      <MyData guard={guard} />
      <Devices guard={guard} />
      <form onSubmit={save} className="portal-sec space-y-3" aria-labelledby="pw-h">
        <h2 id="pw-h" className="ui-t-sec">Change password</h2>
        <label className="block"><span className="ui-label">Current password</span><PasswordInput className="ui-input w-full" required autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></label>
        <label className="block"><span className="ui-label">New password</span><PasswordInput className="ui-input w-full" required strength autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></label>
        <label className="block"><span className="ui-label">New password again</span><PasswordInput className="ui-input w-full" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
        {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
        {/* One primary on Me (design audit P3): a password change is rare, so it is a secondary button. */}
        <button type="submit" className="ui-btn ui-btn-secondary w-full">Change password</button>
      </form>
      <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={onSignOut}>
        <LogOut size={16} aria-hidden="true" /> Sign out
      </button>
    </>
  );
}

/**
 * The app's language (round 67): English or Hindi, kept on the person so every
 * phone they sign in on follows it. Each language is named in its own script,
 * so someone who reads only one of them can still find theirs.
 */
function LanguageChoice({ language, onLanguage }) {
  return (
    <section className="portal-sec space-y-3" aria-labelledby="lang-h">
      <div>
        <h2 id="lang-h" className="ui-t-sec">Language</h2>
        <p className="ui-caption">The app's words, on this phone and any other you sign in on.</p>
      </div>
      <div role="radiogroup" aria-labelledby="lang-h" className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((l) => {
          const on = language === l.code;
          return (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={on}
              lang={l.code}
              data-no-translate=""
              className="ui-btn ui-btn-secondary w-full"
              data-chosen={on || undefined}
              onClick={() => !on && onLanguage(l.code)}
            >
              {on ? <Check size={16} aria-hidden="true" /> : null}
              {l.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Where you are signed in (A-33): every phone and browser, this one marked.
 * Sign any other one out, or all of them; this one signs out with the button
 * below.
 */
function Devices({ guard }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(getSessions())
      .then((r) => {
        setD(r);
        setFailed('');
      })
      .catch((e) => !(e instanceof SignedOut) && setFailed(errorWords(e, 'load your devices')));
  }, [guard]);
  useEffect(() => {
    load();
  }, [load]);
  const endOne = async (s) => {
    if (!(await confirmDialog({ title: `Sign out ${s.deviceLabel}?`, message: 'That device will need your password to get back in.', confirmLabel: 'Sign out' }))) return;
    await guard(endSession(s.id)).catch((e) => !(e instanceof SignedOut) && setFailed(errorWords(e, 'do that')));
    load();
  };
  const endOthers = async () => {
    if (!(await confirmDialog({ title: 'Sign out all other devices?', message: 'Every phone and browser except this one will need your password to get back in.', confirmLabel: 'Sign them out' }))) return;
    await guard(endOtherSessions()).catch((e) => !(e instanceof SignedOut) && setFailed(errorWords(e, 'do that')));
    load();
  };
  const when = (v) => dateWords(v);
  const others = (d?.sessions || []).filter((s) => !s.current);
  return (
    <section className="portal-sec space-y-3" aria-labelledby="dev-h">
      <h2 id="dev-h" className="ui-t-sec">Signed-in devices</h2>
      {failed ? <p className="text-sm" role="alert">{failed}</p> : null}
      {!d && !failed ? <PortalLoading label="Loading your devices…" lines={2} /> : null}
      {d ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {d.sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span>{s.deviceLabel}</span>
                {s.current ? <span className="ui-caption ml-2">This device</span> : null}
                <span className="ui-caption block">Signed in {when(s.createdAt)} · last used {when(s.lastSeenAt)}</span>
              </span>
              {s.current ? null : <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => endOne(s)}>Sign out</button>}
            </li>
          ))}
        </ul>
      ) : null}
      {d && !others.length && !d.olderSignIns ? <p className="ui-caption">This is the only device signed in.</p> : null}
      {d && (others.length || d.olderSignIns) ? (
        <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={endOthers}>Sign out all other devices</button>
      ) : null}
      {d?.olderSignIns ? <p className="ui-caption">A device you signed in on before this list existed is not shown; “Sign out all other devices” signs it out too.</p> : null}
    </section>
  );
}


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
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(getTax())
      .then((r) => { take(r); setFailed(''); })
      .catch((e) => !(e instanceof SignedOut) && setFailed(errorWords(e, 'load your tax declaration')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
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
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'save the changes') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="portal-sec space-y-3" aria-labelledby="tax-h">
      <h2 id="tax-h" className="ui-t-sec">Income tax · {fyLabel(d.financialYear)}</h2>
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
                <span className="font-semibold">{label}</span>
                <span className="ui-caption block">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <TaxCompare
          guard={guard}
          items={d.items}
          declared={form.items}
          senior={form.seniorSelf}
          regime={form.regime}
          onPick={(regime) => set({ regime })}
          disabled={locked || busy}
        />
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

const APPROVAL_PILL = { leave: 'Leave', 'leave-cancel': 'Cancel leave', punch: 'Field punch', overtime: 'Overtime', correction: 'Correction' };
function Approvals({ guard }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    guard(getApprovals())
      .then((d) => { setData(d); setError(''); })
      .catch((e) => !(e instanceof SignedOut) && setError(errorWords(e, 'load this')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);

  const decide = async (item, decision) => {
    setBusy(`${item.type}:${item.id}`);
    try {
      const r = await guard(decideApproval(item.type, item.id, { decision, note: decision === 'reject' ? note : undefined }));
      setRejecting(null);
      setNote('');
      if (r?.stage === 'HR') setError('');
      load();
    } catch (e) {
      /* 409 means another approver got there first — worth saying, then showing the fresh queue. */
      if (!(e instanceof SignedOut)) setError(errorWords(e, 'record the decision'));
      load();
    } finally {
      setBusy('');
    }
  };

  const title = <PageHeader title="Approvals" />;
  if (error && !data) return <>{title}<LoadFailed message={error} onRetry={load} /></>;
  if (!data) return <>{title}<PortalLoading label="Loading what is waiting for you…" /></>;
  /* Field punches and overtime wait here too (time depth, gap 18): the phone app always showed them. */
  const items = [...data.leaves, ...(data.cancellations || []), ...data.corrections, ...(data.requests || []), ...(data.punches || []), ...(data.overtime || [])].sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
  const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  /* What each item is, in words: every item here waits on me, so none carries a "waiting" tag. */
  const kindWord = (item) => (item.type === 'overtime' && item.kind === 'COMP_OFF' ? 'Comp-off' : item.type === 'leave' ? item.leaveTypeName || APPROVAL_PILL.leave : APPROVAL_PILL[item.type] || item.kindName || 'Correction');

  return (
    <>
      {/* The count line says how many wait; who reports to me is the line under it. */}
      <PageHeader title="Approvals" counts={[{ key: 'waiting', label: 'Waiting', value: items.length }]} description={<span>{data.team} report{data.team === 1 ? 's' : ''} to you</span>} />
      <section className="portal-sec" aria-labelledby="approvals-h">
        <h2 id="approvals-h" className="ui-t-sec">Waiting for you</h2>
        {error ? <p className="mt-2 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {!items.length ? <p className="ui-caption mt-2">Nothing waiting. Leave, corrections, field punches and overtime from your team appear here.</p> : null}
        {items.length ? (
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {items.map((item) => {
              const key = `${item.type}:${item.id}`;
              const cancelAsk = item.type === 'leave-cancel';
              return (
                <li key={key} className="space-y-2 py-4" aria-label={`${item.type} request from ${item.employeeName}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{item.employeeName}{item.employeeCode ? <span className="ui-caption font-normal"> · {item.employeeCode}</span> : null}</div>
                      {/* The kind, in words, where the line below does not already say it (a field punch). */}
                      {item.type === 'punch' ? <div className="ui-caption">{APPROVAL_PILL.punch}</div> : null}
                      <div className="text-sm">
                        {item.type === 'leave' || item.type === 'leave-cancel'
                          ? <>{item.type === 'leave-cancel' ? 'Asks to cancel ' : ''}{item.leaveTypeName} · {fmt(item.fromDate)}{item.toDate !== item.fromDate ? ` – ${fmt(item.toDate)}` : ''} · {item.days} day{item.days === 1 ? '' : 's'}</>
                          : item.type === 'request'
                            ? <span className="tabular-nums">{item.kindName} · {requestWords(item)}</span>
                            : item.type === 'punch'
                              ? <span className="tabular-nums">{item.kind === 'OUT' ? 'Out' : 'In'} at {item.checkIn} · {fmt(item.date)}{item.accuracy != null ? ` · within ${item.accuracy}\u00a0m` : ''}</span>
                              : item.type === 'overtime'
                                ? <span className="tabular-nums">{fmt(item.date)} · {item.kind === 'COMP_OFF' ? `${item.days} day${item.days === 1 ? '' : 's'} comp-off` : `${hm(item.minutes)} overtime`}</span>
                                : <>Correction · {fmt(item.date)} · in {item.checkIn || '—'}{item.checkOut ? `, out ${item.checkOut}` : ''}</>}
                      </div>
                    </div>
                    {/* Tick and cross (DESIGN.md "Approvals"); the cross opens the reason the person will see. */}
                    {rejecting === key ? null : (
                      <ApproveActions
                        what={`${kindWord(item)} for ${item.employeeName}`}
                        busy={busy === key}
                        approveTitle={cancelAsk ? 'Approve cancellation' : 'Approve'}
                        rejectTitle={cancelAsk ? 'Keep leave' : 'Reject'}
                        onApprove={() => decide(item, 'approve')}
                        onReject={() => { setRejecting(key); setNote(''); }}
                      />
                    )}
                  </div>
                  {/* Private leave comes masked ("Private leave", no reason): a manager plans cover from the dates. */}
                  {item.type === 'punch' ? <p className="text-sm ui-muted">Made outside the work sites{item.reason && item.reason !== 'Outside the work sites' ? `, near ${item.reason}` : ''}. Approved, it counts; refused, it does not.</p> : item.reason && !item.reasonHidden ? <p className="text-sm ui-muted">“{item.reason}”</p> : null}
                  {rejecting === key ? (
                    <div className="space-y-2">
                      {/* A rejected leave or request needs a reason; the person sees it. */}
                      <textarea className="ui-input w-full" rows={2} aria-label="Why not" placeholder={cancelAsk ? 'Why keep it? The person sees this.' : 'Why not? The person sees this.'} value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex gap-2">
                        <button type="button" className="ui-btn ui-btn-danger flex-1" disabled={busy === key || ((item.type === 'leave' || item.type === 'request') && !note.trim())} onClick={() => decide(item, 'reject')}>{cancelAsk ? 'Keep leave' : 'Reject'}</button>
                        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// My documents, and my data (DPDP)
// ---------------------------------------------------------------------------

const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * What HR has put on my file and marked for me: download, and Accept where HR
 * asked me to read it (E3). A document asked of me but not on my visible
 * list still shows, with Accept.
 */
function MyDocuments({ guard }) {
  const [docs, setDocs] = useState(null);
  const [asks, setAsks] = useState([]);
  const [failed, setFailed] = useState('');
  const [loadFailed, setLoadFailed] = useState('');
  const load = useCallback(() => {
    Promise.all([guard(getDocuments()), guard(getToAccept())])
      .then(([d, a]) => {
        setDocs(d?.documents || []);
        setAsks((a?.pending || []).filter((p) => p.targetType === 'DOCUMENT'));
        setLoadFailed('');
      })
      .catch((e) => !(e instanceof SignedOut) && setLoadFailed(errorWords(e, 'load your documents')));
  }, [guard]);
  useEffect(() => {
    load();
  }, [load]);
  const accept = async (ack) => {
    setFailed('');
    try {
      await guard(acceptItem(ack.id));
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setFailed(errorWords(err, 'accept it'));
    }
  };
  const open = async (d) => {
    try {
      const full = await guard(getDocument(d.id));
      const a = document.createElement('a');
      a.href = full.document.dataUrl;
      a.download = d.title;
      a.click();
    } catch (err) {
      if (!(err instanceof SignedOut)) notify.error(errorWords(err, 'open this document'));
    }
  };
  if (loadFailed) return <LoadFailed message={loadFailed} onRetry={load} />;
  const askOf = new Map(asks.map((a) => [a.targetId, a]));
  const hidden = asks.filter((a) => !(docs || []).some((d) => d.id === a.targetId));
  if ((!docs || !docs.length) && !hidden.length) return null;
  return (
    <section className="portal-sec space-y-2" aria-labelledby="docs-h">
      <h2 id="docs-h" className="ui-t-sec">My documents</h2>
      {asks.length ? <p className="ui-caption">HR asked you to read {asks.length === 1 ? 'one document' : `${asks.length} documents`}. Read it, then accept.</p> : null}
      {failed ? <p className="text-sm" role="alert">{failed}</p> : null}
      <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {(docs || []).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0"><span className="block truncate">{d.title}</span><span className="ui-caption">{sizeOf(d.size)}{d.expiresOn ? ` · valid until ${dateWords(d.expiresOn)}` : ''}</span></span>
            <span className="flex shrink-0 gap-2">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => open(d)}>Download</button>
              {askOf.has(d.id) ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => accept(askOf.get(d.id))}>Accept</button> : null}
            </span>
          </li>
        ))}
        {hidden.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0"><span className="block truncate">{a.title}</span><span className="ui-caption">Ask HR for a copy if you have not read it</span></span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm shrink-0" onClick={() => accept(a)}>Accept</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DATA_TYPES = [
  ['ACCESS', 'See the data held about me'],
  ['CORRECTION', 'Correct something that is wrong'],
  ['ERASURE', 'Erase data that is no longer needed'],
  ['NOMINATE', 'Name someone to act for me if I cannot'],
  ['GRIEVANCE', 'Complain about how my data is handled'],
  ['WITHDRAW', 'Withdraw consent'],
];

/**
 * The company's privacy notice (DPDP s.5): shown on Today until read, and
 * under My data any time. "I have read this" records the version read.
 */
function PrivacyNoticeCard({ guard, onRead, always = false }) {
  const [n, setN] = useState(null);
  const [open, setOpen] = useState(!always);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || n) return;
    guard(getPrivacyNotice()).then(setN).catch(() => {});
  }, [open, n, guard]);
  const read = async () => {
    setBusy(true);
    try {
      await guard(readPrivacyNotice(n.notice.version));
      setN({ ...n, read: true });
      onRead?.();
    } catch (err) {
      if (!(err instanceof SignedOut)) setN(null);
    } finally {
      setBusy(false);
    }
  };
  if (always && !open) return <button type="button" className="ui-link text-sm" onClick={() => setOpen(true)}>Read the privacy notice</button>;
  return (
    /* Inside My data it is a part of that section, not a box in a box; on Today it is a section of its own. */
    <section className={always ? 'space-y-3' : 'portal-sec space-y-3'} aria-labelledby="notice-h">
      <h2 id="notice-h" className="ui-t-sec">{always ? 'Privacy notice' : `How ${n?.notice.company || 'your employer'} uses your attendance data`}</h2>
      {!n ? <PortalLoading label="Loading the privacy notice…" lines={4} /> : (
        <>
          {n.notice.sections.map((x) => (
            <div key={x.id} className="text-sm">
              <h3 className="font-semibold">{x.title}</h3>
              <ul className="list-disc space-y-0.5 ps-5">{x.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
          {n.read ? <p className="ui-caption">You have read this version.</p> : <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={read}>I have read this</button>}
        </>
      )}
    </section>
  );
}

/** The three DPDP rights, as a form; HR answers under Personnel → Data requests and the answer shows here. */
function MyData({ guard }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'ACCESS', details: '' });
  const [note, setNote] = useState(null);
  const load = useCallback(() => guard(getDataRequests()).then((d) => setList(d?.requests || [])).catch(() => setList([])), [guard]);
  useEffect(() => { load(); }, [load]);
  const download = async () => {
    try {
      const data = await guard(getMyData());
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'prepare your data') });
    }
  };
  const withdraw = async (what) => {
    const sure = await confirmDialog(
      what === 'BIOMETRIC'
        ? { title: 'Withdraw consent for fingerprint and face copies?', message: 'CLOR will delete any copy of your fingerprints and face it keeps, and keep none. The readers still recognise you.', confirmLabel: 'Withdraw consent' }
        : { title: 'Withdraw consent for phone punches?', message: 'Your phone will stop punching and reading your location; you will punch at a reader.', confirmLabel: 'Withdraw consent' }
    );
    if (!sure) return;
    try {
      const r = await guard(withdrawConsent(what));
      setNote({ ok: true, text: r.message });
      setOpen(false);
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'do that') });
    }
  };
  const send = async (e) => {
    e.preventDefault();
    setNote(null);
    try {
      await guard(askData(form));
      setForm({ type: 'ACCESS', details: '' });
      setOpen(false);
      setNote({ ok: true, text: 'Sent to HR. The answer appears here.' });
      load();
    } catch (err) {
      if (!(err instanceof SignedOut)) setNote({ ok: false, text: errorWords(err, 'send it') });
    }
  };
  return (
    <section className="portal-sec space-y-3" aria-labelledby="data-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="data-h" className="ui-t-sec">My data</h2>
        {!open ? <button type="button" className="ui-link text-sm" onClick={() => setOpen(true)}>Ask about my data</button> : null}
      </div>
      <p className="ui-caption">Download what is held about you, ask for it to be corrected or erased, withdraw consent, name a nominee, or complain. Answers come within 30 days.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={download}>Download my data</button>
      </div>
      <PrivacyNoticeCard guard={guard} always />
      {open ? (
        <form onSubmit={send} className="space-y-2">
          <select className="ui-select w-full" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} aria-label="What you are asking">
            {DATA_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {form.type === 'WITHDRAW' ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ui-btn ui-btn-secondary flex-1" onClick={() => withdraw('BIOMETRIC')}>Fingerprint and face copies</button>
              <button type="button" className="ui-btn ui-btn-secondary flex-1" onClick={() => withdraw('PHONE')}>Phone punches and my location</button>
            </div>
          ) : (
          <>
          <textarea className="ui-input w-full" rows={3} required maxLength={2000} placeholder={form.type === 'NOMINATE' ? 'Their name, how they are related to you, and how to reach them' : 'What exactly, and why'} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} aria-label="Details" />
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1">Send to HR</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          </>
          )}
        </form>
      ) : null}
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'} style={{ color: note.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>{note.text}</p> : null}
      {list?.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {list.map((r) => (
            <li key={r.id} className="py-2 text-sm space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span>{DATA_TYPES.find(([k]) => k === r.type)?.[1] || r.type}</span>
                {/* Done is the expected end and shows no tag; with HR and declined are tagged. */}
                <RowState kind={r.status === 'RESOLVED' ? 'normal' : 'exception'} pill={r.status === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-warn'} label={r.status === 'PENDING' ? `With HR${r.dueAt ? ` · answer by ${dateWords(r.dueAt)}` : ''}` : r.status === 'RESOLVED' ? 'Done' : 'Declined'} />
              </div>
              <p className="ui-caption">{r.details}</p>
              {r.resolution ? <p className="text-sm">HR: {r.resolution}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}




function CompanyUpdates({ guard }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => guard(getCompanyUpdates()).then((d) => { setData(d); setError(''); }).catch((e) => !(e instanceof SignedOut) && setError('Could not load company updates.')), [guard]);
  useEffect(() => { load(); }, [load]);
  if (error) return <LoadFailed message={error} onRetry={load} />;
  if (!data || (!data.announcements.length && !data.events.length)) return null;
  return <section className="portal-sec" aria-labelledby="company-updates-heading"><h2 id="company-updates-heading" className="ui-t-sec mb-3">Company updates</h2>
    <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>{data.announcements.map((a) => <li className="py-3" key={a.id}><h3 className="font-semibold text-sm">{a.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm ui-muted">{a.body}</p></li>)}{data.events.map((e) => <li className="py-3" key={e.id}><h3 className="font-semibold text-sm">{e.title}</h3><p className="text-sm ui-muted">{dateWords(e.startDate)}{e.endDate && e.endDate !== e.startDate ? ` – ${dateWords(e.endDate)}` : ''}{e.location ? ` · ${e.location}` : ''}</p>{e.description && <p className="mt-1 text-sm">{e.description}</p>}</li>)}</ul>
  </section>;
}

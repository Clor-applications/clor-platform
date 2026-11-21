import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { isValidGstin } from '@ui/utils/gstin';

import { signupConfirm, signupOptions, signupPending, signupStart } from '@platform/auth';
import AuthLayout from './AuthLayout';
import GatePage from './GatePage';
import { Clock } from '@ui/components/ui/lineIcons';
import { legalHref } from './legal/useLegalRoute';
import { readStartLinkOnce } from './startLink';
import { FieldError, FieldErrorAnnounce } from '@ui/components/ui/Primitives';
import { useFieldErrors } from '@ui/components/ui/useFieldErrors';

/**
 * Start a free trial from clor.in's pricing page (roadmap item 7), at
 * app.clor.in/start?app=<key>.
 *
 * Four screens in one room (AuthLayout, the sign-in frame):
 *  - email: the address, and the link is sent. No card, no password yet.
 *  - sent: check your mail, with a way to send it again.
 *  - setup: the link from the mail lands here (/start?t=<token>). The email
 *    is confirmed by the click, so the page asks only what the account needs:
 *    who, the company's name and, if registered, its GSTIN, a password to sign in with from then on, which
 *    apps first, and the state when Books is among them (GST's place of
 *    supply). Then "Open CLOR" makes the account
 *    (server: routes/signup.ts, the same account-making code the operator
 *    console uses) and opens it, signed in.
 *  - ended: the link ran out or was used.
 *
 * People includes Attendance: ticking People ticks Attendance and says so.
 * What may be started, and for how many days, comes from the server (the
 * published price book), not from here.
 */

const GST_STATES = [...new Set(Object.values(GST_STATE_BY_CODE))].filter((s) => !/\(Old\)/.test(s)).sort((a, b) => a.localeCompare(b));
const SITE_ORDER = ['accounting', 'people', 'attendance', 'payroll'];
/* Fallback names until the server answers; the server's names win. */
const NAMES = { accounting: 'Books', people: 'People', attendance: 'Attendance', payroll: 'Payroll' };
const WHAT = {
  accounting: 'GST invoices, bills, stock and the books.',
  people: 'Staff records, leave, documents, joining and leaving. Includes Attendance.',
  attendance: 'Punches, shifts, leave and the month’s payable days.',
  payroll: 'Salaries with PF, ESI, PT and TDS, and payslips.',
};
const onDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

const Err = ({ children }) => (children ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{children}</p> : null);

/* One exchange per token, however many times the effect runs (React's strict mode runs it twice). */
const pendings = new Map();
const pendingOnce = (token) => {
  if (!pendings.has(token)) pendings.set(token, signupPending(token));
  return pendings.get(token);
};

/**
 * `signedIn`: `{ name }` when somebody is signed in to a real company in this
 * browser; confirming signs them out of it first, and the page says so.
 */
export default function Start({ onHome, onSignIn, signedIn = null, signOut = null }) {
  const [link] = useState(readStartLinkOnce);
  const [step, setStep] = useState(link.token ? 'setup' : 'email');
  const [options, setOptions] = useState(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [pending, setPending] = useState(null);

  /* What the offer is, before anybody types: the apps, the days. */
  useEffect(() => {
    let live = true;
    signupOptions(link.app || undefined)
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions({ apps: SITE_ORDER.map((code) => ({ code, name: NAMES[code] })), trialDays: null }));
    return () => {
      live = false;
    };
  }, [link.app]);

  /* The link from the mail: what it is for, or that it ended. */
  useEffect(() => {
    if (!link.token) return undefined;
    let off = false;
    pendingOnce(link.token)
      .then((p) => !off && setPending(p))
      .catch(() => !off && setStep('ended'));
    return () => {
      off = true;
    };
  }, [link.token]);

  const days = pending?.trialDays ?? options?.trialDays ?? null;
  const apps = useMemo(() => {
    const list = pending?.apps || options?.apps || SITE_ORDER.map((code) => ({ code, name: NAMES[code] }));
    return [...list].sort((a, b) => SITE_ORDER.indexOf(a.code) - SITE_ORDER.indexOf(b.code));
  }, [pending, options]);
  const firstApp = link.app && apps.some((a) => a.code === link.app) ? link.app : '';
  const appName = (code) => apps.find((a) => a.code === code)?.name || NAMES[code] || code;

  if (step === 'ended') {
    return (
      /* On the gate frame like every other stop (DESIGN.md: every gate page on GatePage). */
      <GatePage icon={Clock} title="This link has ended" subtitle="A link works for 24 hours and once. Start again and we will send a new one.">
        <button type="button" className="ui-btn ui-btn-brand ui-btn-lg w-full" onClick={() => setStep('email')}>
          Start again <ArrowRight size={16} aria-hidden="true" />
        </button>
      </GatePage>
    );
  }

  if (step === 'setup' && !pending) {
    return (
      <AuthLayout scene="start" title="Opening your link…" subtitle="One moment." onHome={onHome}>
        <p className="ui-muted text-sm">Checking the link from your email.</p>
      </AuthLayout>
    );
  }

  if (step === 'setup') {
    return (
      <SetupStep
        link={link}
        pending={pending}
        apps={apps}
        appName={appName}
        days={days}
        signedIn={signedIn}
        signOut={signOut}
        onHome={onHome}
        onEnded={() => setStep('ended')}
      />
    );
  }

  if (step === 'sent') {
    return (
      <AuthLayout
      scene="start"
        title="Check your email"
        subtitle={`We sent a link to ${sentTo}. Open it to set up your company. It works for 24 hours.`}
        onHome={onHome}
        footer={
          <span className="ui-muted">
            Wrong address?{' '}
            <button type="button" className="ui-link font-medium" onClick={() => setStep('email')}>
              Use another
            </button>
          </span>
        }
      >
        <ResendLine email={sentTo} app={firstApp} plan={link.plan} />
      </AuthLayout>
    );
  }

  return (
    <EmailStep
      email={email}
      setEmail={setEmail}
      firstApp={firstApp}
      appName={appName}
      plan={link.plan}
      days={days}
      onHome={onHome}
      onSignIn={onSignIn}
      onSent={(to) => {
        setSentTo(to);
        setStep('sent');
      }}
    />
  );
}

function EmailStep({ email, setEmail, firstApp, appName, plan, days, onHome, onSignIn, onSent }) {
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const v = useFieldErrors('start', { email: () => (email.trim() ? '' : 'Enter your email.') });
  const submit = async (e) => {
    e.preventDefault();
    const to = email.trim().toLowerCase();
    v.reset();
    v.require('email', to, 'Enter your email.');
    if (v.failed()) return setError('');
    setBusy(true);
    setError('');
    try {
      await signupStart({ email: to, app: firstApp || undefined, plan: plan || undefined, website: website || undefined });
      onSent(to);
    } catch (err) {
      setError(String(err?.message || 'Could not send the link. Try again in a minute.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      scene="start"
      title={firstApp ? `Start your ${appName(firstApp)} trial` : 'Start your free trial'}
      subtitle={`${days ? `${days} days free, ` : 'Free, '}no card. We send you a link to check your email, then you set up your company.`}
      onHome={onHome}
      footer={
        <span className="ui-muted">
          Already have an account?{' '}
          <button type="button" className="ui-link font-medium" onClick={onSignIn}>
            Sign in
          </button>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="ui-label" htmlFor="start-email">Work email</label>
          <input
            id="start-email"
            type="email"
            className="ui-input h-11 w-full"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            autoComplete="email"
            autoFocus
            {...v.props('email')}
          />
          <FieldError error={v.error('email')} id={v.errorId('email')} />
        </div>
        {/* A field people never see; a bot fills it and the server thanks it and keeps nothing. */}
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="start-website">Website</label>
          <input id="start-website" className="ui-input" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <FieldErrorAnnounce errors={v.errors} />
        <Err>{error}</Err>
        <p className="ui-caption">
          By starting a trial you agree to the <a className="ui-link" href={legalHref('terms')} target="_blank" rel="noopener">terms of service</a> and confirm you have read the{' '}
          <a className="ui-link" href={legalHref('privacy')} target="_blank" rel="noopener">privacy notice</a>.
        </p>
        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send me the link'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
    </AuthLayout>
  );
}

function ResendLine({ email, app, plan }) {
  const [state, setState] = useState('');
  const again = async () => {
    setState('busy');
    try {
      await signupStart({ email, app: app || undefined, plan: plan || undefined });
      setState('sent');
    } catch (err) {
      setState(String(err?.message || 'Could not send it again. Try again in a minute.'));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm ui-muted">Nothing after a few minutes? Look in spam, or we can send it again.</p>
      <button type="button" className="ui-btn ui-btn-secondary w-full" onClick={again} disabled={state === 'busy' || state === 'sent'}>
        {state === 'busy' ? 'Sending…' : state === 'sent' ? 'Sent again' : 'Send it again'}
      </button>
      {state && state !== 'busy' && state !== 'sent' ? <Err>{state}</Err> : null}
    </div>
  );
}

function SetupStep({ link, pending, apps, appName, days, signedIn, signOut, onHome, onEnded }) {
  const [form, setForm] = useState({ ownerName: '', companyName: '', gstin: '', password: '', state: '' });
  /* The app the pricing button named (kept with the link) is ticked first. */
  const [chosen, setChosen] = useState(() => new Set([pending.app || link.app].filter(Boolean)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* When the page opened: the trial's end is counted from it, not from each render. */
  const [now] = useState(() => Date.now());

  const has = (code) => chosen.has(code) || (code === 'attendance' && chosen.has('people'));
  const toggle = (code) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const set = (patch) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      /* A GSTIN begins with its state's code, so typing one answers the state too. */
      if (patch.gstin !== undefined) {
        const derived = getGstStateFromGstin(patch.gstin);
        if (derived && GST_STATES.includes(derived)) next.state = derived;
      }
      return next;
    });
    setError('');
  };
  const withBooks = has('accounting');
  const gstin = form.gstin.trim();
  const fromGstin = gstin ? getGstStateFromGstin(gstin) : '';
  const askState = withBooks || Boolean(gstin);
  const picked = apps.map((a) => a.code).filter(has);

  /* Each rule's words go under its own field; the line above the button is for the server's answer. */
  const rules = {
    ownerName: () => (form.ownerName.trim().length >= 2 ? '' : 'Tell us your name.'),
    companyName: () => (form.companyName.trim().length >= 2 ? '' : 'Give your company a name.'),
    password: () => (form.password.length >= 8 ? '' : 'Choose a password of at least 8 characters.'),
    apps: () => (picked.length ? '' : 'Tick at least one product.'),
    gstin: () => (!gstin || isValidGstin(gstin) ? '' : 'Check the GSTIN: it has 15 characters, like 29ABCDE1234F1ZW. Leave it blank if you are not registered yet.'),
    state: () => {
      if (withBooks && !form.state) return 'Choose the state of your head office. It decides CGST and SGST or IGST on every invoice.';
      if (gstin && !form.state) return 'Choose the state the GSTIN is registered in.';
      if (gstin && fromGstin && form.state !== fromGstin) return `This GSTIN is registered in ${fromGstin}, not ${form.state}. Check the GSTIN or the state.`;
      return '';
    },
  };
  const v = useFieldErrors('start-setup', rules);
  const submit = async (e) => {
    e.preventDefault();
    v.reset();
    for (const [field, rule] of Object.entries(rules)) {
      const message = rule();
      v.check(field, !message, message);
    }
    if (v.failed()) return setError('');
    setBusy(true);
    setError('');
    try {
      /* Signed out of the other company first, so the sign-out cannot end the new session. */
      if (signedIn && signOut) await signOut();
      const r = await signupConfirm({ token: link.token, ownerName: form.ownerName.trim(), companyName: form.companyName.trim(), apps: picked, state: askState ? form.state : undefined, gstin: gstin || undefined, password: form.password });
      try {
        localStorage.setItem('token', r.token);
        for (const store of [localStorage, sessionStorage]) for (const key of Object.keys(store)) if (key.startsWith('clor.sel.')) store.removeItem(key);
      } catch {
        /* storage unavailable: the reload below still has the refresh cookie */
      }
      window.location.replace(r.app ? `/?app=${r.app}` : '/');
    } catch (err) {
      if (err?.code === 'LINK_ENDED' || err?.status === 410) return onEnded();
      setError(String(err?.message || 'Could not make the account. Try again.'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      scene="start"
      title="Set up your company"
      subtitle={`${pending.email} is confirmed.${days ? ` Your trial runs ${days} days, no card.` : ''}`}
      wide
      onHome={onHome}
    >
      <form onSubmit={submit} className="space-y-5">
        {signedIn ? <p className="ui-caption">You’re signed in as {signedIn.name}. Opening the trial signs you out of that company here.</p> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="ui-label" htmlFor="start-name">Your name</label>
            <input id="start-name" className="ui-input h-11 w-full" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} autoComplete="name" autoFocus {...v.props('ownerName')} />
            <FieldError error={v.error('ownerName')} id={v.errorId('ownerName')} />
          </div>
          <div>
            <label className="ui-label" htmlFor="start-company">Company name</label>
            <input id="start-company" className="ui-input h-11 w-full" value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} autoComplete="organization" {...v.props('companyName')} />
            <FieldError error={v.error('companyName')} id={v.errorId('companyName')} />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="ui-label" htmlFor="start-gstin">
              GSTIN <span className="ui-caption">· optional</span>
            </label>
            <input id="start-gstin" className="ui-input h-11 w-full ui-mono" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} maxLength={15} placeholder="29ABCDE1234F1ZW" {...v.props('gstin')} aria-describedby={[v.error('gstin') ? v.errorId('gstin') : '', 'start-gstin-hint'].filter(Boolean).join(' ')} />
            <FieldError error={v.error('gstin')} id={v.errorId('gstin')} />
            <p id="start-gstin-hint" className="ui-caption mt-1">Leave it blank if you are not registered yet. You can add it later.</p>
          </div>
          {askState ? (
            <div>
              <label className="ui-label" htmlFor="start-state">State of your head office</label>
              <select id="start-state" className="ui-select h-11 w-full" value={form.state} onChange={(e) => set({ state: e.target.value })} {...v.props('state')} aria-describedby={[v.error('state') ? v.errorId('state') : '', 'start-state-hint'].filter(Boolean).join(' ')}>
                <option value="">Choose a state</option>
                {GST_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <FieldError error={v.error('state')} id={v.errorId('state')} />
              <p id="start-state-hint" className="ui-caption mt-1">
                {fromGstin && form.state === fromGstin ? 'Taken from the GSTIN.' : 'For GST: it decides CGST and SGST or IGST on every invoice.'}
              </p>
            </div>
          ) : null}
        </div>

        <div>
          {/* The address the password belongs to, for a password manager; not shown. */}
          <div className="sr-only" aria-hidden="true">
            <input type="email" className="ui-input" tabIndex={-1} autoComplete="username" value={pending.email} readOnly />
          </div>
          <label className="ui-label" htmlFor="start-password">Choose a password</label>
          <input id="start-password" type="password" className="ui-input h-11 w-full" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" {...v.props('password')} aria-describedby={[v.error('password') ? v.errorId('password') : '', 'start-password-hint'].filter(Boolean).join(' ')} />
          <FieldError error={v.error('password')} id={v.errorId('password')} />
          <p id="start-password-hint" className="ui-caption mt-1">At least 8 characters. You sign in with {pending.email} and this password.</p>
        </div>

        <fieldset ref={(el) => v.register('apps', el)} aria-invalid={v.error('apps') ? true : undefined} aria-describedby={v.error('apps') ? v.errorId('apps') : undefined}>
          <legend className="ui-label">Which apps first</legend>
          <div className="grid gap-2 mt-1">
            {apps.map((a) => {
              const implied = a.code === 'attendance' && chosen.has('people');
              return (
                <label key={a.code} className="flex items-start gap-3 rounded-lg p-3" style={{ border: '1px solid rgb(var(--border))', cursor: implied ? 'default' : 'pointer' }}>
                  <input type="checkbox" className="ui-checkbox mt-0.5" checked={has(a.code)} disabled={implied} onChange={() => toggle(a.code)} aria-label={a.name} aria-describedby={`start-app-${a.code}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{a.name}</span>
                    <span id={`start-app-${a.code}`} className="block ui-caption">
                      {implied ? 'Included with People.' : WHAT[a.code] || ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {chosen.has('people') ? <p className="ui-caption mt-2">People includes Attendance, so both are on.</p> : null}
          <FieldError error={v.error('apps')} id={v.errorId('apps')} />
        </fieldset>


        <FieldErrorAnnounce errors={v.errors} />
        <Err>{error}</Err>
        <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg w-full" disabled={busy}>
          {busy ? 'Opening…' : `Open CLOR${picked.length ? ` with ${picked.map(appName).join(', ')}` : ''}`} <ArrowRight size={16} aria-hidden="true" />
        </button>
        {days && pending ? <p className="ui-caption text-center">Trial ends {onDay(now + days * 86_400_000)}. No card is taken.</p> : null}
      </form>
    </AuthLayout>
  );
}

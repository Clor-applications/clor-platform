import React, { useEffect, useRef, useState } from 'react';
import { firstVisit } from '../firstVisit.js';
import { Link, useSearch } from '../router.jsx';
import { AVAILABLE, SITE, productBySlug } from '../site.js';
import { PageHead } from './Pages.jsx';

/*
 * Request a demo. Saved on the CLOR API (server/src/routes/demoRequests.ts):
 * the team sees it in the operator console, calls, holds the demo, then makes
 * the account. ?app=books|payroll|people|attendance ticks that app; the
 * header's button comes with nothing ticked.
 *
 * Errors sit beside their field and focus moves to the first one. The button
 * stays enabled until sending starts. `noValidate` so the browser's bubbles do
 * not replace the inline messages; the server checks everything again.
 */
const SIZES = [
  ['1-10', '1–10'],
  ['11-20', '11–20'],
  ['21-50', '21–50'],
  ['51-200', '51–200'],
  ['200+', 'More than 200'],
];
/* The order fields are checked in, so focus goes to the first wrong one on the page. */
const ORDER = ['name', 'company', 'email', 'phone', 'city', 'companySize', 'users', 'apps', 'message'];
const EMPTY = { name: '', company: '', email: '', phone: '', city: '', companySize: '', users: '', message: '', website: '' };

function check(f, apps) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter your name.';
  if (f.company.trim().length < 2) e.company = 'Enter your company’s name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = f.email.trim() ? 'Enter an email address like name@company.in.' : 'Enter your work email.';
  const digits = f.phone.replace(/[\s\-().]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  if (!/^[1-9]\d{9}$/.test(digits)) e.phone = f.phone.trim() ? 'Enter a 10-digit Indian phone number.' : 'Enter a phone number.';
  if (f.city.trim().length < 2) e.city = 'Enter your city.';
  if (!f.companySize) e.companySize = 'Choose how many people work there.';
  const n = Number(f.users);
  if (!f.users || !Number.isInteger(n) || n < 1) e.users = 'Enter how many people will sign in.';
  if (!apps.size) e.apps = 'Tick at least one app.';
  return e;
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default function Demo() {
  const [form, setForm] = useState(EMPTY);
  const [apps, setApps] = useState(() => new Set());
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState(null);
  /* The product page they came from: sent first, so their account opens in it (roadmap item 5). */
  const [cameFor, setCameFor] = useState('');
  const formRef = useRef(null);
  const thanksRef = useRef(null);
  const search = useSearch();

  /* ?app= is known only in the browser: read after hydration, on the next frame. */
  useEffect(() => {
    const p = productBySlug(new URLSearchParams(search).get('app') || '');
    if (!p || p.status !== 'available') return undefined;
    const frame = requestAnimationFrame(() => {
      setCameFor(p.slug);
      setApps((s) => (s.has(p.slug) ? s : new Set([...s, p.slug])));
    });
    return () => cancelAnimationFrame(frame);
  }, [search]);
  useEffect(() => {
    if (done) thanksRef.current?.focus();
  }, [done]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors(({ [k]: _gone, ...rest }) => rest);
  };
  const toggle = (slug) => {
    setApps((s) => {
      const n = new Set(s);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });
    if (errors.apps) setErrors(({ apps: _gone, ...rest }) => rest);
  };
  const focusFirst = (errs) => {
    const first = ORDER.find((k) => errs[k]);
    if (!first) return;
    const el = formRef.current?.querySelector(first === 'apps' ? 'input[name="apps"]' : `#demo-${first}`);
    el?.focus();
  };
  /* aria props for a field: invalid, and described by its hint and error. */
  const a = (k, hint) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': [hint ? `demo-${k}-hint` : '', errors[k] ? `demo-${k}-error` : ''].filter(Boolean).join(' ') || undefined,
  });

  const submit = async (e) => {
    e.preventDefault();
    setFailed('');
    const errs = check(form, apps);
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirst(errs);
    setSending(true);
    try {
      const r = await fetch(`${SITE.apiUrl}/public/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, users: Number(form.users), apps: AVAILABLE.filter((p) => apps.has(p.slug)).map((p) => p.slug).sort((x, y) => (y === cameFor) - (x === cameFor)), source: firstVisit() }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        /* Explore (roadmap item 6): a 14-day link to a sample company, also mailed to them. Only a link to the app itself is followed. */
        const explore = typeof body.explore?.url === 'string' && body.explore.url.startsWith(`${SITE.appUrl}/explore?`) ? body.explore.url : '';
        setDone({ name: form.name.trim().split(/\s+/)[0], phone: form.phone.trim(), explore });
        return undefined;
      }
      if (r.status === 400 && body.fields) {
        setErrors(body.fields);
        return focusFirst(body.fields);
      }
      setFailed(body.error || 'Not sent. Try again in a minute.');
    } catch {
      setFailed(`Not sent: we could not reach CLOR. Check your connection and try again, or write to ${SITE.salesEmail}.`);
    } finally {
      setSending(false);
    }
    return undefined;
  };

  if (done) {
    return (
      <>
        <PageHead title="Request a demo" />
        <section className="section">
          <div className="wrap demo-thanks" ref={thanksRef} tabIndex={-1} role="status">
            <h2 className="h-2">Thank you{done.name ? `, ${done.name}` : ''}.</h2>
            <p className="lede">We have your request. Someone from the CLOR team will call you on {done.phone} within one working day to fix a time.</p>
            {done.explore ? (
              <>
                <p className="body">
                  Until then, look around CLOR with a sample company: a made-up business with a few months of invoices, pay runs, people and attendance. Open any screen; nothing you change is saved. The link is in your email too, and works for 14 days.
                </p>
                <a className="btn btn--primary" href={done.explore}>
                  Explore the apps now
                </a>
              </>
            ) : null}
            <p className="body">
              Anything to add? Write to <a href={`mailto:${SITE.salesEmail}`}>{SITE.salesEmail}</a>.
            </p>
            {done.explore ? null : (
              <Link className="btn btn--text" href="/products">
                Look around the products meanwhile
              </Link>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead title="Request a demo" intro="Tell us about your company. We will call within one working day and show you CLOR with your kind of work." />
      <section className="section">
        <div className="wrap contact">
          <form ref={formRef} className="form" onSubmit={submit} noValidate aria-describedby={failed ? 'demo-failed' : undefined}>
            <div className="field-row">
              <Field id="demo-name" label="Your name" error={errors.name}>
                <input id="demo-name" name="name" autoComplete="name" value={form.name} onChange={set('name')} maxLength={120} {...a('name')} />
              </Field>
              <Field id="demo-company" label="Company" error={errors.company}>
                <input id="demo-company" name="organization" autoComplete="organization" value={form.company} onChange={set('company')} maxLength={160} {...a('company')} />
              </Field>
            </div>
            <div className="field-row">
              <Field id="demo-email" label="Work email" error={errors.email}>
                <input id="demo-email" name="email" type="email" autoComplete="email" spellCheck={false} value={form.email} onChange={set('email')} maxLength={200} {...a('email')} />
              </Field>
              <Field id="demo-phone" label="Phone" error={errors.phone}>
                <input id="demo-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="98450 12345" value={form.phone} onChange={set('phone')} maxLength={20} {...a('phone')} />
              </Field>
            </div>
            <div className="field-row">
              <Field id="demo-city" label="City" error={errors.city}>
                <input id="demo-city" name="city" autoComplete="address-level2" value={form.city} onChange={set('city')} maxLength={80} {...a('city')} />
              </Field>
              <Field id="demo-companySize" label="People who work there" error={errors.companySize}>
                <select id="demo-companySize" name="companySize" value={form.companySize} onChange={set('companySize')} {...a('companySize')}>
                  <option value="">Choose</option>
                  {SIZES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="demo-users" label="How many will sign in to CLOR" hint="Owners, accountants, HR: everyone who needs a login. Staff using only the employee app don’t count." error={errors.users}>
              <input id="demo-users" name="users" type="number" inputMode="numeric" min={1} step={1} value={form.users} onChange={set('users')} className="field-short" {...a('users', true)} />
            </Field>
            <fieldset className="field field-set" aria-invalid={errors.apps ? true : undefined} aria-describedby={errors.apps ? 'demo-apps-error' : undefined}>
              <legend>Which apps</legend>
              <div className="field-checks">
                {AVAILABLE.map((p) => (
                  <label key={p.slug} className="check">
                    <input type="checkbox" name="apps" value={p.slug} checked={apps.has(p.slug)} onChange={() => toggle(p.slug)} />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
              {errors.apps ? (
                <span className="field-error" id="demo-apps-error">
                  {errors.apps}
                </span>
              ) : null}
            </fieldset>
            <Field id="demo-message" label="Anything we should know (optional)" error={errors.message}>
              <textarea id="demo-message" name="message" rows={4} value={form.message} onChange={set('message')} maxLength={2000} {...a('message')} />
            </Field>
            {/* For bots: people never see it. */}
            <div className="trap" aria-hidden="true">
              <label htmlFor="demo-website">Leave this empty</label>
              <input id="demo-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
            </div>
            {failed ? (
              <p className="form-error" id="demo-failed" role="alert">
                {failed}
              </p>
            ) : null}
            <div className="actions">
              <button type="submit" className="btn btn--primary" disabled={sending}>
                {sending ? 'Sending…' : 'Request a demo'}
              </button>
            </div>
            <p className="small">
              We keep these details to arrange your demo and, if you go ahead, to set up your account, and we use them for nothing else. See the{' '}
              <Link className="text-link" href="/legal/privacy">
                privacy notice
              </Link>
              .
            </p>
          </form>
          <aside className="contact-aside stack">
            <img className="demo-pic" src="/people/demo-team-3d-1120.webp" srcSet="/people/demo-team-3d-560.webp 560w, /people/demo-team-3d-1120.webp 1120w" sizes="(max-width: 900px) 100vw, 420px" width="1120" height="747" loading="lazy" alt="" />
            <h2 className="h-3">What happens next</h2>
            <ol className="demo-steps body">
              <li>We call you within one working day and fix a time.</li>
              <li>We show you CLOR doing work like yours, on a video call.</li>
              <li>If it suits you, we set up your account with the apps you chose, on a 30-day trial, and email you a link to set your password.</li>
            </ol>
            <h2 className="h-3">Rather write?</h2>
            <p className="body">
              <a href={`mailto:${SITE.salesEmail}`}>{SITE.salesEmail}</a>
            </p>
          </aside>
        </div>
      </section>
    </>
  );
}

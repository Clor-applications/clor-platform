import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check } from '@ui/components/ui/lineIcons';

import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';

import GatePage from './GatePage';
import { APPS } from './registry';
import { appIntent, clearAppIntent, landingAfterSetup } from './appIntent';
import { useSession } from './session';

/**
 * The company, and what it runs. Two questions, and only two.
 *
 * This was four steps inside Accounting: company, modules, a first customer, a
 * first invoice. The last two were a tour, and a tour is not setup — somebody
 * who has just signed up does not yet know which customer matters, and the
 * invoice they are walked through is one they will delete. Worse, the wizard
 * belonged to Accounting, so a company that had bought only Payroll was
 * introduced to the product by being asked to raise an invoice.
 *
 * What is left is what the rest of the product cannot work without:
 *
 * **The state.** It decides whether every invoice this business ever raises
 * splits into CGST and SGST or lands as IGST. Nothing downstream can guess it,
 * and getting it wrong is not a display problem — it is a wrong return.
 *
 * **The apps.** Which applications this company has. It is asked here rather
 * than left to a settings screen because the answer decides what the person
 * sees the moment they arrive, and because "add the rest later" only reads as
 * a promise if the first choice was theirs.
 */

const GST_STATES = [...new Set(Object.values(GST_STATE_BY_CODE))].sort((a, b) => a.localeCompare(b));

/* `onLanding(appId)`: told, before the company is made, which app to open once it is (the one picked). */
export default function CompanySetup({ onLanding } = {}) {
  const { user, createCompany, signOut } = useSession();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', gstin: '', state: '' });
  /* The app they came for from clor.in, chosen already; otherwise Accounting, as before. */
  const [chosen, setChosen] = useState(() => [appIntent() || 'accounting']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      /*
       * A GSTIN begins with its state code, so typing one answers the question
       * below it. Only while the state is still blank: overwriting a
       * deliberate choice would be worse than asking twice.
       */
      if (patch.gstin !== undefined && !f.state) {
        const derived = getGstStateFromGstin(patch.gstin);
        if (derived) next.state = derived;
      }
      return next;
    });
    setError('');
  };

  /* The Workspace comes with every company; it is not a choice. */
  const buildable = useMemo(() => APPS.filter((a) => a.available && !a.platform), []);
  const planned = useMemo(() => APPS.filter((a) => !a.available && !a.platform), []);

  const toggle = (id) =>
    setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const toModules = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Enter the company name.');
    if (!form.state.trim()) return setError('The state decides how GST splits, so it is not optional.');
    setStep(1);
  };

  const finish = async () => {
    if (!chosen.length) {
      setError('Choose at least one. You can add the others whenever you like.');
      return;
    }
    setBusy(true);
    setError('');
    /* Said first: the shell swaps this screen for the company as soon as it exists. */
    const landing = landingAfterSetup(chosen);
    if (landing && onLanding) onLanding(landing);
    try {
      await createCompany({
        name: form.name.trim(),
        gstin: form.gstin.trim(),
        state: form.state.trim(),
        apps: chosen,
      });
      clearAppIntent();
    } catch (err) {
      setError(String(err?.message || 'Could not create that company. Try again.'));
      setBusy(false);
    }
  };

  const gstinLooksTyped = form.gstin.trim().length > 0;

  const steps = [
    { title: 'Whose books are these?', sub: 'The name goes on every invoice. The state decides how the tax on them splits.' },
    { title: `What does ${form.name || 'this company'} run?`, sub: 'Each one you switch on gets its own set of records. The others stay out of the way until you add them from More apps.' },
  ];

  return (
    <GatePage
      icon={Building2}
      eyebrow={`Step ${step + 1} of 2 · ${step === 0 ? 'Company' : 'Apps'}`}
      title={steps[step].title}
      subtitle={steps[step].sub}
      who={user?.email || user?.name}
      onSignOut={signOut}
      size={step === 1 ? 'wide' : 'narrow'}
    >
        {step === 0 ? (
          <form onSubmit={toModules} className="space-y-6">
            <div>
              <label className="ui-label" htmlFor="setup-name">Company name</label>
              <input
                id="setup-name"
                className="ui-input h-11 w-full"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                autoComplete="organization"
                autoFocus
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="ui-label" htmlFor="setup-gstin">
                  GSTIN <span className="ui-caption">· optional</span>
                </label>
                <input
                  id="setup-gstin"
                  className="ui-input h-11 w-full ui-mono"
                  value={form.gstin}
                  onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
                  autoComplete="off"
                  maxLength={15}
                  placeholder="27AAAAA0000A1Z5"
                />
                <p className="ui-caption mt-1">
                  {gstinLooksTyped
                    ? 'Checked when the company is created. The digits have to add up.'
                    : 'Leave it blank if you are not registered yet.'}
                </p>
              </div>

              <div>
                <label className="ui-label" htmlFor="setup-state">State</label>
                <select
                  id="setup-state"
                  className="ui-select h-11 w-full"
                  value={form.state}
                  onChange={(e) => set({ state: e.target.value })}
                >
                  <option value="">Choose a state</option>
                  {GST_STATES.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <p className="ui-caption mt-1">
                  {form.state && getGstStateFromGstin(form.gstin) === form.state
                    ? 'Taken from the GSTIN.'
                    : 'Where the head office is registered.'}
                </p>
              </div>
            </div>

            {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

            <div className="flex justify-end">
              <button type="submit" className="ui-btn ui-btn-primary">
                Continue <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {buildable.map((app) => {
                const on = chosen.includes(app.id);
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => toggle(app.id)}
                    aria-pressed={on}
                    className="ui-panel p-4 text-left"
                    style={on ? { borderColor: 'rgb(var(--fg))', boxShadow: '0 0 0 1px rgb(var(--fg))' } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                        style={{ border: '1px solid rgb(229 229 229)', color: 'rgb(var(--fg))' }}
                      >
                        <app.icon size={18} aria-hidden="true" />
                      </span>
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-lg"
                        style={{
                          backgroundColor: on ? 'rgb(var(--fg))' : 'transparent',
                          border: on ? 'none' : '1px solid rgb(var(--border))',
                          color: 'rgb(255 255 255)',
                        }}
                        aria-hidden="true"
                      >
                        {on ? <Check size={13} /> : null}
                      </span>
                    </div>
                    <span className="mt-3 block" style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'rgb(var(--fg))' }}>{app.name}</span>
                    <span className="mt-1 block" style={{ fontSize: '0.8125rem', lineHeight: '1.25rem', fontWeight: 400, color: 'rgb(var(--fg-muted))' }}>{app.blurb}</span>
                  </button>
                );
              })}

              {planned.map((app) => (
                <div key={app.id} className="ui-panel p-4 opacity-60">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      style={{ border: '1px solid rgb(229 229 229)' }}
                    >
                      <app.icon size={18} aria-hidden="true" />
                    </span>
                    <span className="ui-pill ui-pill-neutral">Coming soon</span>
                  </div>
                  <span className="mt-3 block" style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'rgb(var(--fg))' }}>{app.name}</span>
                  <span className="mt-1 block" style={{ fontSize: '0.8125rem', lineHeight: '1.25rem', fontWeight: 400, color: 'rgb(var(--fg-muted))' }}>{app.blurb}</span>
                </div>
              ))}
            </div>

            {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

            <div className="flex items-center justify-between gap-3">
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setStep(0)} disabled={busy}>
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
              <button type="button" className="ui-btn ui-btn-primary" onClick={finish} disabled={busy}>
                {busy ? 'Setting up…' : `Open ${form.name || 'the books'}`}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
    </GatePage>
  );
}

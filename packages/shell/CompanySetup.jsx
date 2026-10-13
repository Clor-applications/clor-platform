import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, LogOut } from 'lucide-react';

import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';

import ClorMark from './ClorMark';
import { APPS } from './registry';
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

export default function CompanySetup() {
  const { user, createCompany, signOut } = useSession();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', gstin: '', state: '' });
  const [chosen, setChosen] = useState(['accounting']);
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

  const buildable = useMemo(() => APPS.filter((a) => a.available), []);
  const planned = useMemo(() => APPS.filter((a) => !a.available), []);

  const toggle = (id) =>
    setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const toModules = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('The company these books belong to.');
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
    try {
      await createCompany({
        name: form.name.trim(),
        gstin: form.gstin.trim(),
        state: form.state.trim(),
        apps: chosen,
      });
    } catch (err) {
      setError(String(err?.message || 'Could not create that company.'));
      setBusy(false);
    }
  };

  const gstinLooksTyped = form.gstin.trim().length > 0;

  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <header
        className="flex h-14 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid rgb(var(--border))', backgroundColor: 'rgb(var(--surface))' }}
      >
        <ClorMark size={24} />
        <span className="ui-display text-base">Clor</span>
        <div className="flex-1" />
        <span className="ui-caption">{user?.email || user?.name}</span>
        <button type="button" className="ui-icon-btn" onClick={signOut} aria-label="Sign out">
          <LogOut size={16} />
        </button>
      </header>

      <main className="mx-auto px-6 py-12" style={{ maxWidth: '44rem' }}>
        {/* Two steps, named. A progress bar with no names tells somebody how
            far they are and not what is coming. */}
        <ol className="flex items-center gap-3 text-sm" aria-label="Setup">
          {['Company', 'Apps'].map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className="grid h-6 w-6 place-items-center rounded-full text-xs"
                style={
                  i <= step
                    ? { backgroundColor: 'rgb(var(--brand))', color: 'rgb(var(--on-brand))' }
                    : { border: '1px solid rgb(var(--border))', color: 'rgb(var(--fg-subtle))' }
                }
              >
                {i < step ? <Check size={12} /> : i + 1}
              </span>
              <span style={{ color: i <= step ? 'rgb(var(--fg))' : 'rgb(var(--fg-subtle))' }}>{label}</span>
              {i === 0 ? <span className="ui-caption" aria-hidden="true">—</span> : null}
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <form onSubmit={toModules} className="mt-8 space-y-6">
            <div>
              <h1 className="ui-display text-2xl flex items-center gap-2">
                <Building2 size={20} aria-hidden="true" /> Whose books are these?
              </h1>
              <p className="ui-muted mt-2 text-sm">
                The name goes on every invoice. The state decides how the tax on them splits.
              </p>
            </div>

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
                    ? 'Checked when the company is created — the digits have to add up.'
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
                  <option value="">Select a state</option>
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
              <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg">
                Continue <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-8 space-y-6">
            <div>
              <h1 className="ui-display text-2xl">What does {form.name || 'this company'} run?</h1>
              <p className="ui-muted mt-2 text-sm">
                Each one you switch on gets its own set of records. The others stay out of the way until you
                add them from <span className="ui-fg">More apps</span>.
              </p>
            </div>

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
                    style={on ? { borderColor: 'rgb(var(--brand))', boxShadow: '0 0 0 1px rgb(var(--brand))' } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                        style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand))' }}
                      >
                        <app.icon size={18} aria-hidden="true" />
                      </span>
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-md"
                        style={{
                          backgroundColor: on ? 'rgb(var(--brand))' : 'transparent',
                          border: on ? 'none' : '1px solid rgb(var(--border))',
                          color: 'rgb(var(--on-brand))',
                        }}
                        aria-hidden="true"
                      >
                        {on ? <Check size={13} /> : null}
                      </span>
                    </div>
                    <span className="mt-3 block font-medium">{app.name}</span>
                    <span className="mt-1 block text-sm ui-muted">{app.blurb}</span>
                  </button>
                );
              })}

              {planned.map((app) => (
                <div key={app.id} className="ui-panel p-4 opacity-60">
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}
                    >
                      <app.icon size={18} aria-hidden="true" />
                    </span>
                    <span className="ui-pill ui-pill-neutral">Coming</span>
                  </div>
                  <span className="mt-3 block font-medium">{app.name}</span>
                  <span className="mt-1 block text-sm ui-muted">{app.blurb}</span>
                </div>
              ))}
            </div>

            {error ? <p className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

            <div className="flex items-center gap-3">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setStep(0)} disabled={busy}>
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
              <button type="button" className="ui-btn ui-btn-brand ui-btn-lg flex-1" onClick={finish} disabled={busy}>
                {busy ? 'Setting up…' : `Open ${form.name || 'the books'}`}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

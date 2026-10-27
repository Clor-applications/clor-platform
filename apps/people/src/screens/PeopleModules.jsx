import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

import { apiFetch } from '@platform/http';
import { billingFor, setFeature } from '@platform/auth';
import { branchId, orgId } from '@platform/context';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';

/**
 * People → Settings → Modules & Apps (founder, 22 Oct 2026). A company
 * switches off the HR modules it does not use, so HR stays simple; the
 * subscription decides what may be switched on. The apps beside People are
 * shown with what the subscription carries; Attendance is recommended.
 */
const MODULES = ['peopleHiring', 'peoplePerformance', 'peopleEngage', 'peopleBenefits'];
const APPS = [
  { key: 'attendance', name: 'Attendance', note: 'Biometric readers, shifts, late marks and overtime; days marked automatically and sent to HR and Payroll.', recommended: true },
  { key: 'payroll', name: 'Payroll', note: 'Salaries, PF, ESI, PT and TDS, and payslips; unpaid leave from HR is loss of pay.' },
];
const CORE = 'Always on: Workforce, Organization, Time & Leave, Insights and Settings.';

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[rgb(var(--brand))]' : 'bg-[rgb(var(--border-strong))]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function PeopleModules() {
  const [catalog, setCatalog] = useState(null);
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    Promise.all([
      apiFetch(`/orgs/${encodeURIComponent(orgId())}/features/catalog`, { skipWarehouseHeader: true }),
      billingFor(orgId(), branchId()).catch(() => null),
    ])
      .then(([c, b]) => { setCatalog(c); setBilling(b); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load the modules.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKey = new Map((catalog?.features || []).map((f) => [f.key, f]));
  const owns = (app) => !billing?.restricted || (billing.ownedApps || []).includes(app);

  const flip = async (key, on) => {
    setBusy(key);
    try {
      await setFeature(orgId(), branchId(), key, on);
      notify.success(key === 'peopleSimpleMode' ? (on ? 'Simple mode is on: the detailed screens are out of the menu.' : 'Simple mode is off: every People screen is in the menu.') : on ? 'Switched on.' : 'Switched off. Its records are kept and come back when it is switched on.');
      window.dispatchEvent(new Event('clor:features-changed'));
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <PageHeader entity="settings" title="Modules & Apps" description="Switch off what your company does not use; the menu follows. What can be switched on comes from your subscription." />
      {error ? <p role="alert" className="ui-card p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!catalog ? (error ? null : <SkeletonCard lines={6} />) : (
        <>
          {byKey.get('peopleSimpleMode') ? (
            <section className="space-y-2" aria-labelledby="simple-h">
              <div>
                <h2 id="simple-h" className="ui-t-sec">Menu</h2>
                <p className="ui-caption">For a company of up to 10 people and up to 2 users. Nothing anyone needs for their own leave, days or details is hidden.</p>
              </div>
              <ul className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                {[byKey.get('peopleSimpleMode')].map((f) => (
                  <li key={f.key} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{f.label}</p>
                      <p className="ui-caption">Hides the detailed screens a larger HR team uses: stand-ins, request rules, leave year end, compliance and privacy lists, custom fields, approval rules and similar. They still open from any link to them.</p>
                    </div>
                    <Toggle label={f.label} checked={Boolean(f.enabled)} disabled={busy === f.key || (!f.entitled && !f.enabled)} onChange={(on) => flip(f.key, on)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2" aria-labelledby="mod-h">
            <div>
              <h2 id="mod-h" className="ui-t-sec">HR modules</h2>
              <p className="ui-caption">{CORE}</p>
            </div>
            <ul className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {MODULES.map((k) => byKey.get(k)).filter(Boolean).map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{f.label}</p>
                    <p className="ui-caption">{f.description}</p>
                    {!f.entitled ? <p className="ui-caption mt-1 inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" /> {f.upgradeHint || 'Not in your plan'}</p> : null}
                  </div>
                  <Toggle label={f.label} checked={Boolean(f.enabled)} disabled={busy === f.key || (!f.entitled && !f.enabled)} onChange={(on) => flip(f.key, on)} />
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2" aria-labelledby="apps-h">
            <div>
              <h2 id="apps-h" className="ui-t-sec">Apps with People</h2>
              <p className="ui-caption">Leave, holidays and employees are shared, so each app works with the same records.</p>
            </div>
            <ul className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {APPS.map((a) => {
                const f = byKey.get(a.key);
                const owned = owns(a.key);
                return (
                  <li key={a.key} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {a.name}
                        {a.recommended && !f?.enabled ? <span className="ui-pill ui-pill-info ml-2">Recommended</span> : null}
                      </p>
                      <p className="ui-caption">{a.note}</p>
                      {!owned ? <p className="ui-caption mt-1 inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" /> Not in your subscription. Add it from More apps.</p> : null}
                    </div>
                    <Toggle label={a.name} checked={Boolean(f?.enabled)} disabled={busy === a.key || (!owned && !f?.enabled)} onChange={(on) => flip(a.key, on)} />
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

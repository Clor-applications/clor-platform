import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from '@ui/components/ui/lineIcons';

import { apiFetch } from '@platform/http';
import { billingFor, setFeature } from '@platform/auth';
import { branchId, orgId } from '@platform/context';
import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { BookOpen16Regular, Briefcase20Color, CalendarCheckmark16Regular, Gift20Color, MegaphoneLoud20Color, People20Color, Trophy20Color } from '@fluentui/react-icons';
import { colorIcon } from '@ui/components/ui/colorIcon';
import Toggle from '../components/Toggle';
import '../people-settings.css';

/**
 * People → Settings → Modules & apps (founder, 22 Oct 2026; laid out as PEOPLE-44, R&D hand-off 14 Nov 2026). A company
 * switches off the HR modules it does not use, so HR stays simple; the
 * subscription decides what may be switched on. The apps beside People are
 * shown with what the subscription carries; Attendance is recommended.
 */
const MODULES = ['peopleHiring', 'peoplePerformance', 'peopleEngage', 'peopleBenefits'];
const APPS = [
  { key: 'payroll', name: 'Payroll', mark: '₹', note: 'Salaries, PF, ESI, PT and TDS, and payslips; unpaid leave from HR is loss of pay.' },
  { key: 'attendance', name: 'Attendance', mark: <CalendarCheckmark16Regular />, note: 'Biometric readers, shifts, late marks and overtime; days marked automatically and sent to HR and Payroll.', recommended: true },
  { key: 'accounting', name: 'Accounting', mark: <BookOpen16Regular />, note: 'Salary journals and cost centres, in Books.' },
];
/* The apps People switches with it; Accounting is shown for what the subscription carries, and is not switched from here. */
const TOGGLES = { payroll: true, attendance: true };
/* Each module's mark and identity colour (--cat-N) on its tile, the same glyphs as the rail. */
const ICON = {
  core: colorIcon(People20Color, 'People20Color'),
  peopleHiring: colorIcon(Briefcase20Color, 'Briefcase20Color'),
  peoplePerformance: colorIcon(Trophy20Color, 'Trophy20Color'),
  peopleEngage: colorIcon(MegaphoneLoud20Color, 'MegaphoneLoud20Color'),
  peopleBenefits: colorIcon(Gift20Color, 'Gift20Color'),
};
const TONE = { peopleHiring: 2, peoplePerformance: 3, peopleEngage: 5, peopleBenefits: 2 };
const CORE = 'Employees, organisation, leave and attendance, insights and settings.';

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
      notify.success(key === 'peopleSimpleMode' ? (on ? 'Simple mode is on: organisation detail is out of the menu.' : 'Simple mode is off: every People screen is in the menu.') : on ? 'Switched on.' : 'Switched off. Its records are kept and come back when it is switched on.');
      window.dispatchEvent(new Event('clor:features-changed'));
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    } finally {
      setBusy('');
    }
  };

  const modules = MODULES.map((k) => byKey.get(k)).filter(Boolean);
  return (
    <div className="space-y-8 pb-8">
      <PageHeader entity="settings" title="Modules & apps" description="Turn People features on or off. Turning a module off hides it; no data is deleted. What can be switched on comes from your subscription." />
      {error ? <p role="alert" className="ui-card p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!catalog ? (error ? null : <SkeletonCard lines={6} />) : (
        <>
          {/* The modules as tiles, three across (PEOPLE-44): core HR first and always on, then each module's switch. */}
          <section className="space-y-3" aria-labelledby="mod-h">
            <h2 id="mod-h" className="sr-only">HR modules</h2>
            <ul className="people-module-grid">
              <li className="people-module-tile" style={{ '--set-tone': 'var(--cat-4)' }}>
                <span className="people-module-chip" aria-hidden="true"><ICON.core size={20} /></span>
                <p className="people-module-name">Core HR</p>
                <p className="people-module-note">{CORE}</p>
                <p className="people-module-foot">Always on</p>
              </li>
              {modules.map((f) => {
                const Icon = ICON[f.key];
                return (
                  <li key={f.key} className="people-module-tile" style={{ '--set-tone': `var(--cat-${TONE[f.key] || 1})` }}>
                    <span className="people-module-chip" aria-hidden="true">{Icon ? <Icon size={20} /> : null}</span>
                    <span className="people-module-switch">
                      <Toggle label={f.label} checked={Boolean(f.enabled)} disabled={busy === f.key || (!f.entitled && !f.enabled)} onChange={(on) => flip(f.key, on)} />
                    </span>
                    <p className="people-module-name">{f.label}</p>
                    <p className="people-module-note">{f.description}</p>
                    {!f.entitled ? <p className="people-module-foot inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" /> {f.upgradeHint || 'Not in your plan'}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {byKey.get('peopleSimpleMode') ? (
            <section className="space-y-2" aria-labelledby="simple-h">
              <h2 id="simple-h" className="ui-t-sec">Menu</h2>
              <ul className="people-app-rows">
                {[byKey.get('peopleSimpleMode')].map((f) => (
                  <li key={f.key} className="people-setting-row">
                    <div className="min-w-0">
                      <p className="people-setting-name">{f.label}</p>
                      <p className="people-setting-note">For a company of up to 10 people and up to 2 users. Keeps organisation detail a larger company uses, such as legal entities, out of the menu; nothing anyone needs for their own leave, days or details is hidden.</p>
                    </div>
                    <Toggle label={f.label} checked={Boolean(f.enabled)} disabled={busy === f.key || (!f.entitled && !f.enabled)} onChange={(on) => flip(f.key, on)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Connected CLOR apps: rows under one hairline, each app's own colour on its mark, the state as a labelled pill. */}
          <section className="space-y-2" aria-labelledby="apps-h">
            <h2 id="apps-h" className="ui-t-sec">Connected CLOR apps</h2>
            <ul className="people-app-rows">
              {APPS.map((a) => {
                const f = byKey.get(a.key);
                const switched = a.key in TOGGLES;
                const owned = switched ? owns(a.key) : (billing?.ownedApps || []).includes(a.key);
                const on = switched ? Boolean(f?.enabled) : owned;
                return (
                  <li key={a.key} className="people-app-row">
                    <span className="people-app-mark" style={{ background: `rgb(var(--app-${a.key}))` }} aria-hidden="true">{a.mark}</span>
                    <div className="min-w-0">
                      <p className="people-setting-name">
                        {a.name}
                        {a.recommended && !on && owned ? <span className="ui-pill ui-pill-neutral ml-2">Recommended</span> : null}
                      </p>
                      <p className="people-setting-note">{a.note}</p>
                    </div>
                    <span className="inline-flex items-center gap-3">
                      <span className={`ui-pill ${!owned ? 'ui-pill-neutral' : on ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{!owned ? 'Not in plan' : on ? 'Connected' : 'Off'}</span>
                      {switched ? <Toggle label={a.name} checked={on} disabled={busy === a.key || (!owned && !on)} onChange={(v) => flip(a.key, v)} /> : null}
                    </span>
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

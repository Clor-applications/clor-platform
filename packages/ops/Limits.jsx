import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { Panel } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, ReasonDrawer, may } from './kit';
import { opsCustomerLimits, opsSetCustomerFeature, opsSetCustomerLimits } from './api';

/**
 * A customer's limits (Ops plan P1, item 5; server: routes/opsLimits.ts): how
 * many companies and users they may have, and which modules of their apps are
 * on. Billing changes them; everyone else reads. Apps are not here — they
 * follow the subscription.
 */
const STATE = {
  plan: ['In their plan', 'ws-pill ws-pill--ok'],
  on: ['Added by CLOR', 'ws-pill ws-pill--ok'],
  off: ['Turned off by CLOR', 'ws-pill ws-pill--warn'],
  'not-in-plan': ['Not in their plan', 'ws-pill ws-pill--off'],
};

const nWord = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "A", "A and B", "A, B and C". */
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function Limits({ id, name, role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ companies: '', users: '' });
  const [change, setChange] = useState(null);
  const [all, setAll] = useState(false);
  const mayChange = may(role, 'BILLING');

  const load = useCallback(() => {
    opsCustomerLimits(id)
      .then(setD)
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  if (!d) return error ? <Err>{error}</Err> : <Loading />;

  const openLimits = () => {
    setForm({ companies: d.set.maxCompanies ?? '', users: d.set.maxUsers ?? '' });
    setEditing(true);
  };
  const asNumber = (v) => (String(v).trim() === '' ? null : Number(v));
  const formOk = ['companies', 'users'].every((k) => String(form[k]).trim() === '' || (Number.isInteger(Number(form[k])) && Number(form[k]) >= 1));
  const saveLimits = async (reason) => {
    await opsSetCustomerLimits(id, { maxCompanies: asNumber(form.companies), maxUsers: asNumber(form.users), reason });
    notify.success('Limits changed.');
    setEditing(false);
    load();
  };
  const saveFeature = async (reason) => {
    await opsSetCustomerFeature(id, change.f.key, change.to, reason);
    notify.success({ on: `${change.f.label} is on for ${name}.`, off: `${change.f.label} is off for ${name}.`, plan: `${change.f.label} follows their plan again.` }[change.to]);
    setChange(null);
    load();
  };

  const rows = [
    ['Companies', d.used.companies, d.limits.maxCompanies, d.plan.limits.maxCompanies, d.set.maxCompanies, ['company', 'companies']],
    ['Users', d.used.users, d.limits.maxUsers, d.plan.limits.maxUsers, d.set.maxUsers, ['user', 'users']],
  ];
  const planLimit = (n, words) => (n == null ? 'no limit' : nWord(n, ...words));

  /*
   * Most modules simply follow the plan; what CLOR changed is what staff come
   * here for. The rest stay one click away.
   */
  const changed = d.features.filter((f) => f.state === 'on' || f.state === 'off' || f.offWithParent);
  const direct = changed.filter((f) => f.state === 'on' || f.state === 'off').length;
  const shown = all ? d.features : changed;
  /* Modules by app, in the order the catalog lists them. */
  const byApp = [];
  for (const f of shown) {
    let g = byApp.find((x) => x.app === f.app);
    if (!g) byApp.push((g = { app: f.app, name: f.appName, list: [] }));
    g.list.push(f);
  }
  const choices = (f) =>
    f.state === 'plan'
      ? [['off', 'Turn off']]
      : f.state === 'not-in-plan'
        ? [['on', 'Turn on']]
        : [['plan', 'Back to plan']];
  const needing = change ? d.features.filter((x) => x.needs === change.f.label && x.state !== 'not-in-plan' && x.state !== 'off').map((x) => x.label) : [];
  const what = change
    ? {
        on: `${change.f.label} opens for every company ${name} has, on top of their ${d.plan.name} plan. It stays on when their plan renews, until you put it back.`,
        off: `${change.f.label} closes for every company ${name} has${needing.length ? `, and so ${needing.length === 1 ? 'does' : 'do'} ${listWords(needing)}, which ${needing.length === 1 ? 'needs' : 'need'} it` : ''}. Their records stay; the screens come back when you turn it on again.`,
        plan: `${change.f.label} goes back to what the ${d.plan.name} plan says: ${change.f.inPlan ? 'on' : 'off'}.`,
      }[change.to]
    : '';

  return (
    <>
      <Panel
        title="Companies and users"
        action={mayChange ? <button type="button" className="ws-btn ws-btn--quiet" onClick={openLimits}>Change limits</button> : null}
      >
        <ul className="ws-list" aria-label="Limits">
          {rows.map(([label, used, limit, own, set, words]) => (
            <li key={label}>
              <div className="ws-item">
                <span className="ws-item-text">
                  <span className="ws-item-title">{label}</span>
                  <span className="ws-item-sub">
                    {set != null ? `Set by CLOR. The ${d.plan.name} plan has ${planLimit(own, words)}.` : `The ${d.plan.name} plan’s own.`}
                  </span>
                </span>
                <span className="ws-item-actions tabular-nums" style={{ textAlign: 'right' }}>
                  {limit == null ? `${used} · no limit` : `${used} of ${limit}`}
                  {limit != null && used > limit ? <span className="ws-item-sub" style={{ display: 'block' }}>Over: they cannot add more</span> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Features">
        {!d.inGoodStanding ? (
          <p className="ws-card-blurb">Their subscription is not paid up, so features added by CLOR are paused until it is.</p>
        ) : null}
        <p className="ws-card-blurb">
          {changed.length
            ? `CLOR changed ${nWord(direct, 'feature', 'features')} for ${name}${changed.length > direct ? `, and ${changed.length - direct} more ${changed.length - direct === 1 ? 'is' : 'are'} closed with ${direct === 1 ? 'it' : 'them'}` : ''}; everything else follows the ${d.plan.name} plan.`
            : `Every feature follows the ${d.plan.name} plan and the apps ${name} has.`}{' '}
          {d.features.length ? (
            <button type="button" className="ui-link" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? 'Show only what CLOR changed' : `Show all ${d.features.length} features`}
            </button>
          ) : null}
        </p>
        {!d.features.length ? (
          <p className="ws-card-blurb">No apps yet, so nothing to switch. Apps come with the subscription.</p>
        ) : null}
        {byApp.length ? (
          byApp.map((g) => (
            <div key={g.app} className="grid gap-1">
              {byApp.length > 1 ? <h3 className="ws-item-sub" style={{ fontWeight: 600, marginTop: 8 }}>{g.name}</h3> : null}
              <ul className="ws-list" aria-label={`${g.name} features`}>
                {g.list.map((f) => (
                  <li key={f.key}>
                    <div className="ws-item ws-item--wrap">
                      <span className="ws-item-text">
                        <span className="ws-item-title">{f.label}</span>
                        <span className="ws-item-sub">
                          {f.offWithParent ? (
                            `Closed while ${f.needs} is off.`
                          ) : f.state === 'plan' ? (
                            STATE.plan[0]
                          ) : (
                            <span className={STATE[f.state][1]}>{STATE[f.state][0]}</span>
                          )}
                        </span>
                      </span>
                      {mayChange && !f.offWithParent ? (
                        <span className="ws-item-actions">
                          {choices(f).map(([to, label]) => (
                            <button key={to} type="button" className="ws-btn ws-btn--quiet" onClick={() => setChange({ f, to })} aria-label={`${label}: ${f.label}`}>
                              {label}
                            </button>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : null}
      </Panel>
      {!mayChange ? <p className="ws-card-blurb">Your role can look at these limits but not change them. Billing changes them.</p> : null}

      <ReasonDrawer
        open={editing}
        title="Change limits"
        what={`Leave a box empty to use the ${d.plan.name} plan’s own. A lower limit takes nothing away: ${name} keeps what they have, and cannot add more until they are under it.`}
        confirmLabel="Change limits"
        ready={formOk}
        onClose={() => setEditing(false)}
        onConfirm={saveLimits}
      >
        {[
          ['companies', 'Companies', d.plan.limits.maxCompanies, ['company', 'companies']],
          ['users', 'Users', d.plan.limits.maxUsers, ['user', 'users']],
        ].map(([k, label, own, words]) => (
          <div key={k} className="grid gap-1">
            <label htmlFor={`ops-limit-${k}`} className="text-sm font-medium">{label}</label>
            <input
              id={`ops-limit-${k}`}
              className="ui-input tabular-nums"
              type="number"
              inputMode="numeric"
              min={1}
              value={form[k]}
              placeholder={own == null ? 'No limit' : String(own)}
              aria-describedby={`ops-limit-${k}-own`}
              onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value }))}
              style={{ maxWidth: 160 }}
            />
            <span id={`ops-limit-${k}-own`} className="ws-item-sub">Plan’s own: {planLimit(own, words)}.</span>
          </div>
        ))}
      </ReasonDrawer>
      <ReasonDrawer
        open={Boolean(change)}
        title={change ? `${{ on: 'Turn on', off: 'Turn off', plan: 'Back to plan' }[change.to]}: ${change.f.label}` : ''}
        what={what}
        confirmLabel={change ? { on: 'Turn on', off: 'Turn off', plan: 'Back to plan' }[change.to] : ''}
        tone={change?.to === 'off' ? 'danger' : 'primary'}
        onClose={() => setChange(null)}
        onConfirm={saveFeature}
      />
    </>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { APP_NAMES, Empty, Err, Loading, ReasonDrawer, Tabs, may } from './kit';
import { inr, rupeesText, toPaise } from './money';
import { opsAccounts, opsCustomPlanArchive, opsCustomPlanSave, opsCustomPlans } from './api';

/**
 * Custom plans (operator console, Money; server: routes/opsDeals.ts): a deal's
 * own apps, unit and prices, never shown on clor.in. Made for one customer or
 * for any. A subscription copies the price when it is set, so a change here
 * reaches only deals made after it.
 */
export const UNIT = { COMPANY: ['company', 'companies'], USER: ['user', 'users'], EMPLOYEE: ['employee', 'employees'] };
export const unitName = (unit, n = 2) => (UNIT[unit] || ['unit', 'units'])[n === 1 ? 0 : 1];
export const units = (unit, n) => `${n} ${(UNIT[unit] || ['unit', 'units'])[n === 1 ? 0 : 1]}`;
export const priceWords = (base, extra, unit, included, per) =>
  base == null ? null : `${inr(base)} a ${per} for ${units(unit, included)}${extra ? `, ${inr(extra)} for each more` : ''}`;

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1 content-start">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="ws-card-blurb">{hint}</span> : null}
    </div>
  );
}

/** Pick a customer by name or code; empty means any customer. */
function CustomerPick({ value, valueName, onChange }) {
  const [q, setQ] = useState(valueName || '');
  const [found, setFound] = useState([]);
  const searching = Boolean(q.trim()) && q !== valueName;
  useEffect(() => {
    if (!searching) return undefined;
    const t = setTimeout(() => {
      opsAccounts({ q: q.trim() })
        .then((r) => setFound((r.accounts || []).slice(0, 6)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, searching]);
  return (
    <div className="grid gap-1">
      <input
        id="plan-customer"
        className="ui-input"
        value={q}
        placeholder="Any customer"
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value) onChange(null, '');
        }}
        autoComplete="off"
      />
      {searching && found.length ? (
        <ul className="ws-list" aria-label="Matching customers">
          {found.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="ws-item w-full text-left"
                onClick={() => {
                  onChange(a.id, a.title || a.name);
                  setQ(a.title || a.name);
                  setFound([]);
                }}
              >
                <span className="ws-item-text">
                  <span className="ws-item-title">{a.title || a.name}</span>
                  <span className="ws-item-sub tabular-nums">{a.code || ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value ? <span className="ws-card-blurb">Only this customer can be given the plan.</span> : <span className="ws-card-blurb">Empty: staff can give it to any customer.</span>}
    </div>
  );
}

export function PlanEditor({ editing, apps, onClose, onSaved, forAccount = null }) {
  const isNew = !editing?.id;
  const e = editing || {};
  const [f, setF] = useState({
    accountId: e.accountId ?? forAccount?.id ?? null,
    accountName: e.accountName ?? forAccount?.name ?? '',
    name: e.name || '',
    description: e.description || '',
    apps: e.apps || [],
    unit: e.unit || 'USER',
    included: e.includedUnits ? String(e.includedUnits) : '1',
    monthly: rupeesText(e.monthlyPrice),
    monthlyExtra: rupeesText(e.monthlyExtra || 0),
    yearly: rupeesText(e.yearlyPrice),
    yearlyExtra: rupeesText(e.yearlyExtra || 0),
    gst: e.gstApplies ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const m = toPaise(f.monthly);
  const y = toPaise(f.yearly);
  const included = Number(f.included);
  const ready = f.name.trim().length >= 3 && f.apps.length > 0 && (m != null || y != null) && Number.isInteger(included) && included >= 1;
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await opsCustomPlanSave(isNew ? null : e.id, {
        accountId: f.accountId,
        name: f.name.trim(),
        description: f.description.trim() || null,
        apps: f.apps,
        unit: f.unit,
        includedUnits: included,
        monthlyPrice: m,
        monthlyExtra: toPaise(f.monthlyExtra) ?? 0,
        yearlyPrice: y,
        yearlyExtra: toPaise(f.yearlyExtra) ?? 0,
        gstApplies: f.gst,
      });
      onSaved(r.plan, isNew);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  const priceRow = (key, label) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`plan-${key}`} label={`${label} price, ₹`} hint={`Covers ${units(f.unit, included || 1)}. Empty: not sold ${label.toLowerCase()}.`}>
        <input id={`plan-${key}`} className="ui-input tabular-nums" inputMode="decimal" value={f[key]} onChange={set(key)} />
      </Field>
      <Field id={`plan-${key}Extra`} label={`Each ${(UNIT[f.unit] || ['unit'])[0]} more a ${key === 'monthly' ? 'month' : 'year'}, ₹`}>
        <input id={`plan-${key}Extra`} className="ui-input tabular-nums" inputMode="decimal" value={f[`${key}Extra`]} onChange={set(`${key}Extra`)} />
      </Field>
    </div>
  );
  return (
    <WsDrawer
      open
      onClose={onClose}
      title={isNew ? 'New custom plan' : `Change ${e.name}`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ops-plan" className="ws-btn ws-btn--primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : isNew ? 'Make plan' : 'Save'}
          </button>
        </>
      }
    >
      <form id="ops-plan" onSubmit={save} className="grid gap-4">
        {!isNew && e.inUse ? (
          <p className="ws-notice" role="status">
            {e.inUse} {e.inUse === 1 ? 'customer is' : 'customers are'} on this plan at the price set then. A change here applies to subscriptions set from now on.
          </p>
        ) : null}
        <Field id="plan-name" label="Name">
          <input id="plan-name" className="ui-input" value={f.name} onChange={set('name')} maxLength={80} />
        </Field>
        <Field id="plan-customer" label="For">
          {forAccount ? <span className="text-sm">{forAccount.name}</span> : <CustomerPick value={f.accountId} valueName={f.accountName} onChange={(id, name) => setF((x) => ({ ...x, accountId: id, accountName: name }))} />}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Apps</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {apps.map((a) => (
              <label key={a.code} className="flex items-center gap-2">
                <input type="checkbox" checked={f.apps.includes(a.code)} onChange={() => setF((x) => ({ ...x, apps: x.apps.includes(a.code) ? x.apps.filter((c) => c !== a.code) : [...x.apps, a.code] }))} />
                {APP_NAMES[a.code] || a.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="plan-unit" label="Counted by">
            <select id="plan-unit" className="ui-select" value={f.unit} onChange={set('unit')}>
              <option value="USER">Users</option>
              <option value="EMPLOYEE">Employees</option>
              <option value="COMPANY">Companies</option>
            </select>
          </Field>
          <Field id="plan-included" label="Included in the price">
            <input id="plan-included" className="ui-input tabular-nums" type="number" min={1} value={f.included} onChange={set('included')} />
          </Field>
        </div>
        {priceRow('monthly', 'Monthly')}
        {priceRow('yearly', 'Yearly')}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.gst} onChange={(ev) => setF((x) => ({ ...x, gst: ev.target.checked }))} />
          Add GST once CLOR charges GST
        </label>
        <Field id="plan-desc" label="Note for staff (optional)">
          <input id="plan-desc" className="ui-input" value={f.description} onChange={set('description')} maxLength={300} />
        </Field>
        <Err>{error}</Err>
      </form>
    </WsDrawer>
  );
}

export function CustomPlans({ role, openCustomer = () => {} }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('open');
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const mayChange = may(role, 'BILLING');
  const load = useCallback(() => {
    opsCustomPlans()
      .then(setD)
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const rows = d ? d.plans.filter((p) => (tab === 'open' ? !p.archivedAt : p.archivedAt)) : [];
  const open = d ? d.plans.filter((p) => !p.archivedAt).length : 0;
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Money', 'Custom plans']}
          title="Custom plans"
          description="Plans made for a deal: their own apps and prices, never shown on clor.in. For one customer, or for staff to use with any."
          meta={d ? `${open} in use or ready` : null}
          actions={
            mayChange ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setEditing({})}>
                New custom plan
              </button>
            ) : null
          }
        />
        <Tabs
          label="Which plans"
          value={tab}
          onChange={setTab}
          tabs={[
            ['open', `Ready${d ? ` (${open})` : ''}`],
            ['archived', 'Archived'],
          ]}
        />
        <Err>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && !rows.length ? (
          <Empty>{tab === 'open' ? 'No custom plans yet. Make one when a customer needs a price the public plans do not have.' : 'Nothing archived.'}</Empty>
        ) : d ? (
          <ul className="ws-list ws-list--ground" aria-label="Custom plans">
            {rows.map((p) => (
              <li key={p.id}>
                <div className="ws-item ws-item--wrap" style={{ alignItems: 'flex-start' }}>
                  <span className="ws-item-text">
                    <span className="ws-item-title">{p.name}</span>
                    <span className="ws-item-sub" style={{ color: 'rgb(var(--ws-ink))' }}>
                      {[priceWords(p.monthlyPrice, p.monthlyExtra, p.unit, p.includedUnits, 'month'), priceWords(p.yearlyPrice, p.yearlyExtra, p.unit, p.includedUnits, 'year')].filter(Boolean).join('; ')}
                      {p.gstApplies ? '' : '; no GST'}
                    </span>
                    <span className="ws-item-sub">
                      {p.apps.map((a) => APP_NAMES[a] || a).join(', ')} ·{' '}
                      {p.accountId ? (
                        <button type="button" className="ui-link" onClick={() => openCustomer(p.accountId)}>
                          For {p.accountName}
                        </button>
                      ) : (
                        'For any customer'
                      )}
                      {p.inUse ? ` · ${p.inUse} on it` : ''}
                    </span>
                  </span>
                  {mayChange && !p.archivedAt ? (
                    <span className="ws-item-actions inline-flex flex-wrap gap-2">
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setEditing(p)} aria-label={`Change ${p.name}`}>
                        Change
                      </button>
                      <button type="button" className="ws-btn ws-btn--danger-quiet" onClick={() => setArchiving(p)} aria-label={`Archive ${p.name}`}>
                        Archive
                      </button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {editing ? (
        <PlanEditor
          editing={editing}
          apps={d?.apps || []}
          onClose={() => setEditing(null)}
          onSaved={(p, made) => {
            notify.success(made ? `${p.name} is ready to give to a customer.` : `${p.name} saved.`);
            setEditing(null);
            load();
          }}
        />
      ) : null}
      <ReasonDrawer
        open={Boolean(archiving)}
        title={archiving ? `Archive ${archiving.name}` : ''}
        what="Nobody new can be put on it. Customers on it keep their price."
        confirmLabel="Archive"
        tone="danger"
        reasonOptional
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          await opsCustomPlanArchive(archiving.id);
          notify.success(`${archiving.name} archived.`);
          setArchiving(null);
          load();
        }}
      />
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Pencil } from '@ui/components/ui/lineIcons';

import { renameAccount } from '@platform/admin/account';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn, localDateIso } from '@ui/utils/dates';
import NotConnected from '@ui/components/ui/NotConnected';
import { getAccountOverview } from '@platform/admin/admin';
import { ICON, PageHead, Panel, Stat } from './wsKit';
import './workspace.css';

/**
 * Workspace → Plan → Subscription (redesign W-R8): the account, above any one
 * company.
 *
 * Everything else in this product is scoped to a company — right for doing the
 * work, wrong for running the business that does it. This page answers "how
 * many companies do we have, who has access, and how close are we to the
 * plan's limits" without opening each company in turn. Every figure is the
 * server's (/account/overview); nothing here is a placeholder.
 */

/**
 * How much of a limit is used, as words and a bar. The words carry the
 * warning ("nearly full", "at the limit") so running out of seats is visible
 * before somebody is refused.
 */
const LimitMeter = ({ label, used, limit }) => {
  if (limit === null || limit === undefined) {
    return (
      <div className="ws-meter">
        <div className="ws-meter-row">
          <span>{label}</span>
          <strong>{used} · no limit on this plan</strong>
        </div>
      </div>
    );
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const words = `${used} of ${limit}${pct >= 100 ? ' — at the limit' : pct >= 80 ? ' — nearly full' : ''}`;
  return (
    <div className="ws-meter">
      <div className="ws-meter-row">
        <span>{label}</span>
        <strong>{words}</strong>
      </div>
      <div className="ws-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <span
          style={{ width: `${pct}%`, ...(pct >= 100 ? { background: 'rgb(var(--ws-danger))' } : null) }}
          data-tight={pct >= 80 ? '' : undefined}
        />
      </div>
    </div>
  );
};

/**
 * W-7.3: rename the account (it starts as the name of whoever signed up).
 * The server lets owners and administrators do it, and records it in the
 * account's activity; anyone else is told so.
 */
function AccountName({ name, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  if (!editing) {
    return (
      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => { setValue(name); setError(''); setEditing(true); }}>
        <Pencil size={16} aria-hidden="true" /> Rename the account
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await renameAccount(value.trim());
          onRenamed(r?.account?.name || value.trim());
          setEditing(false);
        } catch (err) {
          setError(String(err?.message || 'Could not rename the account.'));
        }
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Account name</span>
        <input className="ui-input" value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={120} required autoFocus />
      </label>
      <button type="submit" className="ws-btn ws-btn--primary ws-btn--small">Save</button>
      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setEditing(false)}>Cancel</button>
      {error ? <p role="alert" className="w-full text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
    </form>
  );
}

export default function AccountOverview({ currentCompany, onOpenCompany = null }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAccountOverview()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setFailed(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const companies = data?.companies || [];
    return {
      billed: companies.reduce((s, c) => s + Number(c.billed || 0), 0),
      outstanding: companies.reduce((s, c) => s + Number(c.outstanding || 0), 0),
      invoices: companies.reduce((s, c) => s + Number(c.invoices || 0), 0),
    };
  }, [data]);

  const money = (v) => formatMoney(Number(v || 0), currentCompany);
  const companies = data?.companies || [];
  const users = data?.users || [];
  const active = users.filter((u) => u.active).length;
  const limits = data?.plan?.limits || {};
  const plan = data?.plan;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Subscription']} scope="account"
          title={data?.account?.name || 'Account'}
          actions={
            data ? (
              <AccountName
                name={data?.account?.name || ''}
                onRenamed={(name) => setData((d) => (d ? { ...d, account: { ...d.account, name } } : d))}
              />
            ) : null
          }
        />

        {loading ? <p className="ws-card-blurb">Loading the account…</p> : null}
        {failed ? (
          <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>
            The account could not be read: {failed}
          </p>
        ) : null}

        {data ? (
          <>
            <div className="ws-stats">
              <Stat icon={ICON.companies} label="Companies" value={companies.length} note="In this account" />
              <Stat icon={ICON.people} label="People" value={active} note="Active sign-ins" />
              <Stat icon={ICON.plan} label="Billed across all companies" value={money(totals.billed)} note={`${totals.invoices} invoice(s)`} />
              <Stat icon={ICON.warning} label="Outstanding" value={money(totals.outstanding)} note="Still owed by customers" />
            </div>

            <div className="ws-layout">
              <div className="ws-main">
                <Panel title="Companies" action={<span className="ws-head-meta">{companies.length}</span>}>
                  {companies.length === 0 ? (
                    <p className="ws-card-blurb">No companies yet. The first company is created at signup.</p>
                  ) : (
                    <div className="ws-table-wrap">
                      <table className="ws-table">
                        <caption className="sr-only">Companies in this account</caption>
                        <thead>
                          <tr>
                            <th>Company</th>
                            <th>State</th>
                            <th>GSTIN</th>
                            <th className="num">People</th>
                            <th className="num">Invoices</th>
                            <th className="num">Billed</th>
                            <th className="num">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {companies.map((c) => (
                            <tr key={c.orgId}>
                              <td>
                                {onOpenCompany ? (
                                  <button type="button" onClick={() => onOpenCompany(c)} className="ws-link">
                                    {c.name}
                                  </button>
                                ) : (
                                  <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                                )}
                              </td>
                              <td>{c.state || '—'}</td>
                              <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{c.gstin || '—'}</td>
                              <td className="num">{c.people}</td>
                              <td className="num">{c.invoices}</td>
                              <td className="num">{money(c.billed)}</td>
                              <td className="num">{money(c.outstanding)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                {/*
                  The address each company would answer on. The handle is real —
                  stored on the company and unique — so these are the addresses
                  that will exist. What does not exist yet is the routing that
                  makes them resolve, and saying so is cheaper than somebody
                  sending one to a client.
                */}
                {companies.length ? (
                  <Panel title="Company addresses">
                    <NotConnected what="company subdomains">
                      The addresses below are reserved but do not open yet.
                    </NotConnected>
                    <ul className="ws-list">
                      {companies.map((c) => (
                        <li key={c.orgId}>
                          <div className="ws-item">
                            <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.company size={14} /></span>
                            <span className="ws-item-text">
                              <span className="ws-item-title">{c.name}</span>
                            </span>
                            <span className="ws-item-end ui-mono">{c.slug ? `${c.slug}.clor.in` : 'no handle yet'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}

                <Panel title="People" action={<span className="ws-head-meta">{users.length}</span>}>
                  {users.length === 0 ? (
                    <p className="ws-card-blurb">Nobody else yet.</p>
                  ) : (
                    <ul className="ws-list">
                      {users.map((u) => (
                        <li key={u.id}>
                          <div className="ws-item">
                            <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.person size={14} /></span>
                            <span className="ws-item-text">
                              <span className="ws-item-title">{u.name || u.email}</span>
                              <span className="ws-item-sub truncate">{u.email}</span>
                            </span>
                            <span className="ws-item-end">
                              {u.active ? (u.lastLoginAt ? `Last signed in ${formatDateIn(localDateIso(u.lastLoginAt))}` : 'Never signed in') : 'Deactivated'}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <aside className="ws-side">
                <Panel title="Plan">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ws-stat-value">{plan?.name || 'Full'}</span>
                    {plan?.inGoodStanding ? (
                      <span className="ws-pill ws-pill--ok">Active</span>
                    ) : (
                      <span className="ws-pill">Status: {plan?.status || 'unknown'}</span>
                    )}
                  </div>
                  <LimitMeter label="Companies" used={companies.length} limit={limits.maxCompanies ?? null} />
                  <LimitMeter label="Users" used={active} limit={limits.maxUsers ?? null} />
                </Panel>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

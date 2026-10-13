import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Users } from 'lucide-react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn, localDateIso } from '@ui/utils/dates';
import NotConnected from '@ui/components/ui/NotConnected';
import { getAccountOverview } from '../../api/admin';

/**
 * The account, above any one company.
 *
 * Everything else in this product is scoped to a company — right for doing the
 * work, wrong for running the business that does it. A practice with twenty
 * clients had no screen that could answer "how many companies do we have, who
 * has access to them, and how close are we to the plan's limits". The only way
 * to find out was to open each company in turn.
 *
 * Every figure here is real. Nothing on this screen is a placeholder.
 */

const Stat = ({ label, value, hint }) => (
  <div className="ui-card p-4">
    <div className="ui-label">{label}</div>
    {/* Size carries the hierarchy here; weight marks structure, not the
        figure itself — see DESIGN.md. */}
    <div className="mt-1 text-2xl ui-money">{value}</div>
    {hint ? <div className="ui-caption ui-muted mt-0.5">{hint}</div> : null}
  </div>
);

/**
 * How much of a limit is used.
 *
 * Shown as a bar because "8 of 10" is a number people read and do not feel. The
 * bar turns as it fills, so running out of seats is visible before it happens
 * rather than at the moment somebody is refused.
 */
const LimitBar = ({ used, limit }) => {
  if (limit === null || limit === undefined) {
    return <div className="ui-caption ui-muted">{used} · no limit on this plan</div>;
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? 'neg' : pct >= 80 ? 'warn' : 'pos';
  return (
    <div>
      <div className="ui-caption ui-muted mb-1">
        {used} of {limit}
        {pct >= 80 && pct < 100 ? ' — nearly full' : ''}
        {pct >= 100 ? ' — at the limit' : ''}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgb(var(--sunken))' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `rgb(var(--${tone}))` }} />
      </div>
    </div>
  );
};

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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader entity="company" title="Account" />
        <div className="ui-card p-4 text-sm ui-muted">Loading…</div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-6">
        <PageHeader entity="company" title="Account" />
        <div className="ui-card p-4 text-sm" style={{ color: 'rgb(var(--neg-ink))' }}>
          The account could not be read: {failed}
        </div>
      </div>
    );
  }

  const companies = data?.companies || [];
  const users = data?.users || [];
  const limits = data?.plan?.limits || {};

  return (
    <div className="space-y-6">
      <PageHeader
        entity="company"
        title={data?.account?.name || 'Account'}
            />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Companies" value={String(companies.length)} />
        <Stat label="People" value={String(users.filter((u) => u.active).length)} />
        <Stat label="Billed across all companies" value={money(totals.billed)} hint={`${totals.invoices} invoice(s)`} />
        <Stat label="Outstanding" value={money(totals.outstanding)} hint="Still owed by customers" />
      </div>

      <div className="ui-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="ui-label">Plan</div>
            <div className="mt-1 text-lg">{data?.plan?.name || 'Full'}</div>
            <div className="ui-caption ui-muted">
              {data?.plan?.inGoodStanding ? 'Active' : `Status: ${data?.plan?.status || 'unknown'}`}
            </div>
          </div>
          <div className="min-w-[12rem]">
            <div className="ui-label mb-1">Companies</div>
            <LimitBar used={companies.length} limit={limits.maxCompanies ?? null} />
          </div>
          <div className="min-w-[12rem]">
            <div className="ui-label mb-1">Users</div>
            <LimitBar used={users.filter((u) => u.active).length} limit={limits.maxUsers ?? null} />
          </div>
        </div>
      </div>

      <div>
        <div className="ui-label mb-2">Companies</div>
        {companies.length === 0 ? (
          <div className="ui-card">
            <EmptyState icon={Building2} title="No companies yet" description="The first company is created at signup." />
          </div>
        ) : (
          <div className="ui-card overflow-x-auto">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th className="ui-th text-left">Company</th>
                  <th className="ui-th text-left">State</th>
                  <th className="ui-th text-left">GSTIN</th>
                  <th className="ui-th ui-num text-right">People</th>
                  <th className="ui-th ui-num text-right">Invoices</th>
                  <th className="ui-th ui-num text-right">Billed</th>
                  <th className="ui-th ui-num text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.orgId} className="border-t">
                    <td className="ui-col-entity px-4 py-2.5">
                      {onOpenCompany ? (
                        <button
                          type="button"
                          onClick={() => onOpenCompany(c)}
                          className="ui-link text-left"
                        >
                          {c.name}
                        </button>
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="ui-col-meta px-4 py-2.5">{c.state || '—'}</td>
                    <td className="ui-col-meta px-4 py-2.5 ui-mono">{c.gstin || '—'}</td>
                    <td className="ui-col-amount px-4 py-2.5 text-right">{c.people}</td>
                    <td className="ui-col-amount px-4 py-2.5 text-right">{c.invoices}</td>
                    <td className="ui-col-amount px-4 py-2.5 text-right">{money(c.billed)}</td>
                    <td className="ui-col-amount px-4 py-2.5 text-right">{money(c.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*
        The address each company would answer on.
        
        The slug is real — it is stored on the company and it is unique — so
        these are the addresses that will exist rather than invented examples.
        What does not exist yet is the routing that makes them resolve, and
        saying so here is cheaper than somebody sending one to a client.
      */}
      {companies.length ? (
        <div>
          <div className="ui-label mb-2">Company addresses</div>
          <div className="space-y-3">
            <NotConnected what="company subdomains">
              Each company already has the handle below, and it is unique across the account. Pointing a subdomain at it
              needs DNS and a certificate, which is a deployment step rather than a product one — so these do not resolve
              yet.
            </NotConnected>
            <div className="ui-card divide-y">
              {companies.map((c) => (
                <div key={c.orgId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1 text-sm">{c.name}</div>
                  <div className="ui-mono ui-caption ui-muted">
                    {c.slug ? `${c.slug}.clor.in` : 'no handle yet'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div>
        <div className="ui-label mb-2">People</div>
        {users.length === 0 ? (
          <div className="ui-card">
            <EmptyState icon={Users} title="Nobody else yet" description="Invite colleagues from Settings → Users." />
          </div>
        ) : (
          <div className="ui-card divide-y">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{u.name || u.email}</div>
                  <div className="ui-caption ui-muted truncate">{u.email}</div>
                </div>
                <div className="ui-caption ui-muted">
                  {u.active ? (u.lastLoginAt ? `Last signed in ${formatDateIn(localDateIso(u.lastLoginAt))}` : 'Never signed in') : 'Deactivated'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

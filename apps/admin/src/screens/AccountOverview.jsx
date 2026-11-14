import React, { useEffect, useMemo, useState } from 'react';

import { memberDirectory, renameAccount } from '@platform/admin/account';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn, localDateIso } from '@ui/utils/dates';
import NotConnected from '@ui/components/ui/NotConnected';
import { getAccountOverview } from '@platform/admin/admin';
import { requestOpenScreen } from '@platform/context';
import { ICON, PageHead, Panel, Stat } from './wsKit';
import { inr } from './InvoiceDocument';
import './workspace.css';
import './ws-plan.css';

/**
 * Workspace → Settings → Workspace settings (redesign W-R8, R&D hand-off
 * WS-14): the account, above any one company — its name, its companies and
 * people, the plan, and the way to its data and to closing a company.
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
 * account's activity; anyone else is told so. The field is the General
 * section's; the page's one primary action, Save changes, submits it.
 */
function AccountName({ name, owners = null, onRenamed, onDirty }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  return (
    <form
      id="ws-settings-form"
      className="ws-form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value.trim() === name) return;
        try {
          const r = await renameAccount(value.trim());
          onRenamed(r?.account?.name || value.trim());
          onDirty(false);
          setError('');
        } catch (err) {
          setError(String(err?.message || 'Could not rename the account.'));
        }
      }}
    >
      <label className="ws-field">
        <span>Workspace name</span>
        <input
          className="ui-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onDirty(e.target.value.trim() !== name);
          }}
          minLength={2}
          maxLength={120}
          required
          aria-describedby="ws-name-help"
        />
        <span id="ws-name-help" className="ws-field-help">The account’s name on invoices, invitations and the company switcher.</span>
      </label>
      {/* WS-14's Owner: the account stores owners as member roles, so this names them and Members changes them. */}
      {owners ? (
        <div className="ws-field">
          <span id="ws-owner-label">Owner</span>
          <p className="ws-field-value" aria-labelledby="ws-owner-label">{owners.length ? owners.join(', ') : 'No owner on record'}</p>
          <span className="ws-field-help">
            Change who owns the workspace in{' '}
            <button type="button" className="ws-link" onClick={() => requestOpenScreen('members')}>Members</button>.
          </span>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm" style={{ gridColumn: '1 / -1', color: 'rgb(var(--neg))' }}>{error}</p> : null}
    </form>
  );
}

/**
 * What the account pays a month. Never a figure that looks like an answer when
 * it is not one: if any line has no price, this says so and names the app.
 */
function RunRate({ rate }) {
  if (!rate) return null;
  if (rate.monthly == null) {
    const apps = (rate.unpriced || []).join(', ');
    return (
      <p className="ws-card-blurb">
        Monthly run rate: not priced yet{apps ? ` (${apps})` : ''}.
      </p>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="ws-stat-note">Monthly run rate</span>
      <span className="ws-stat-value num">{inr(rate.monthly)}</span>
    </div>
  );
}

/**
 * Whether what feeds the suite from outside is flowing. The reader-check job
 * has already judged each alert, so this repeats its answer rather than
 * forming a second opinion. An account with no such source is told plainly
 * that there is nothing to sync, not shown a reassuring tick. Company then
 * Integrations has the detail; this is the one line that says whether to go.
 */
function DataHealth({ health }) {
  if (!health) return null;
  if (health.status === 'none') {
    return (
      <Panel title="Data health">
        <p className="ws-card-blurb">Nothing to sync: no readers, connectors or mail on this account yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Data health">
      <div className="flex items-center justify-between gap-2">
        <span className="ws-stat-note">{health.issues ? 'Needs a look' : 'Flowing'}</span>
        <span className={`ws-pill${health.issues ? '' : ' ws-pill--ok'}`}>
          {health.issues ? `${health.issues} to fix` : 'All sources working'}
        </span>
      </div>
      <dl className="ws-kv">
        {(health.sources || []).map((src) => (
          <div key={src.key}>
            <dt>{src.label}</dt>
            {/* Not "2 of 1": one reader can raise two alerts, and that read as nonsense live. */}
            <dd className="num">{src.issues ? `${src.total}, ${src.issues} to fix` : src.total}</dd>
          </div>
        ))}
      </dl>
      {(health.alerts || []).length ? (
        <ul className="ws-card-blurb" style={{ display: 'grid', gap: 4 }}>
          {health.alerts.map((a) => (
            <li key={`${a.title}-${a.since}`}>{a.title}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** How much of the account signs in with an authenticator. */
function Security({ security }) {
  if (!security || !security.activeUsers) return null;
  const { withAuthenticator: on, activeUsers: all } = security;
  const share = Math.round((on / all) * 100);
  const everyone = on === all;
  return (
    <Panel title="Security">
      <div className="flex items-center justify-between gap-2">
        <span className="ws-stat-note">Sign in with an authenticator</span>
        <span className={`ws-pill${everyone ? ' ws-pill--ok' : ''}`}>{share}%</span>
      </div>
      <p className="ws-card-blurb">
        {everyone
          ? all === 1
            ? 'The one active person on the account.'
            : `All ${all} active people.`
          : `${on} of ${all} active people. The rest sign in with a password alone.`}
      </p>
    </Panel>
  );
}

export default function AccountOverview({ currentCompany, onOpenCompany = null }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [owners, setOwners] = useState(null);

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
    /* Who owns the account (owners and administrators may read the directory; anyone else simply does not see the line). */
    Promise.resolve()
      .then(memberDirectory)
      .then((d) => {
        if (!cancelled && Array.isArray(d?.members)) setOwners(d.members.filter((m) => m.accountRole === 'OWNER' && m.status !== 'SUSPENDED').map((m) => m.name || m.email));
      })
      .catch(() => {});
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
  const entities = data?.entities || null;
  const health = data?.dataHealth || null;
  const runRate = data?.runRate || null;
  const security = data?.security || null;

  const name = data?.account?.name || '';
  const since = data?.account?.since ? new Date(data.account.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Settings', 'Workspace settings']} scope="account"
          title="Workspace settings"
          description={
            data ? (
              <>
                {name ? <span>{name}</span> : null}
                {name ? ' · ' : ''}
                {companies.length} {companies.length === 1 ? 'company' : 'companies'}
                {since ? ` · created ${since}` : ''}
              </>
            ) : null
          }
          actions={
            data ? (
              <button type="submit" form="ws-settings-form" className="ws-btn ws-btn--primary" disabled={!dirty}>
                Save changes
              </button>
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
          <div className="ws-settings">
            <div>
              <section className="ws-section" aria-labelledby="ws-general">
                <h2 id="ws-general" className="ws-h2">General</h2>
                <AccountName
                  key={name}
                  name={name}
                  owners={owners}
                  onDirty={setDirty}
                  onRenamed={(n) => setData((d) => (d ? { ...d, account: { ...d.account, name: n } } : d))}
                />
              </section>

              <div className="ws-stats">
                <Stat icon={ICON.companies} label="Companies" value={companies.length} note="In this account" />
                <Stat icon={ICON.people} label="People" value={active} note="Active sign-ins" />
                <Stat icon={ICON.plan} label="Billed across all companies" value={money(totals.billed)} note={`${totals.invoices} invoice(s)`} />
                <Stat icon={ICON.warning} label="Outstanding" value={money(totals.outstanding)} note="Still owed by customers" />
              </div>

              <section className="ws-section" aria-labelledby="ws-companies">
                <div className="ws-section-head">
                  <h2 id="ws-companies" className="ws-h2">Companies</h2>
                  <span className="ws-head-meta">{companies.length}</span>
                </div>
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
                                <button type="button" onClick={() => onOpenCompany(c)} className="ws-name-link">
                                  {c.name}
                                </button>
                              ) : (
                                <span className="ws-cell-main">{c.name}</span>
                              )}
                              {c.slug ? <span className="ws-cell-sub">{c.slug}.clor.in</span> : null}
                            </td>
                            <td>{c.state || '—'}</td>
                            <td className="ui-mono">{c.gstin || '—'}</td>
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
                {/*
                  The address each company would answer on (shown under its name above).
                  The handle is real — stored on the company and unique — so these are
                  the addresses that will exist. What does not exist yet is the routing
                  that makes them resolve, and saying so is cheaper than somebody
                  sending one to a client.
                */}
                {companies.some((c) => c.slug) ? (
                  <NotConnected what="company subdomains">
                    The addresses under each company are reserved but do not open yet.
                  </NotConnected>
                ) : null}
              </section>

              <section className="ws-section" aria-labelledby="ws-people">
                <div className="ws-section-head">
                  <h2 id="ws-people" className="ws-h2">People</h2>
                  <span className="ws-head-meta">{users.length}</span>
                </div>
                {users.length === 0 ? (
                  <p className="ws-card-blurb">Nobody else yet.</p>
                ) : (
                  <ul className="ws-list ws-flat-list">
                    {users.map((u) => (
                      <li key={u.id}>
                        <div className="ws-item">
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
              </section>

              <section className="ws-section" aria-labelledby="ws-danger-zone">
                <h2 id="ws-danger-zone" className="ws-h2">Danger zone</h2>
                <div className="ws-danger">
                  <div className="ws-danger-row" style={{ borderTop: 0, paddingTop: 0 }}>
                    <div>
                      <strong>Close {currentCompany?.name || 'this company'}</strong>
                      <span>Stops its apps. Every record is deleted after a notice period; export first.</span>
                    </div>
                    <button type="button" className="ws-btn ws-btn--danger-quiet" onClick={() => requestOpenScreen('close')}>
                      Close company
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <aside>
              <Panel title="Plan">
                <div className="flex items-center justify-between gap-2">
                  <span className="ws-stat-value">{plan?.name || 'Full'}</span>
                  {plan?.inGoodStanding ? (
                    <span className="ws-pill ws-pill--ok">Active</span>
                  ) : (
                    <span className="ws-pill ws-pill--neutral">Status: {plan?.status || 'unknown'}</span>
                  )}
                </div>
                <LimitMeter label="Companies" used={companies.length} limit={limits.maxCompanies ?? null} />
                <LimitMeter label="Users" used={active} limit={limits.maxUsers ?? null} />
                <RunRate rate={runRate} />
              </Panel>

              <section className="ws-section" aria-labelledby="ws-data">
                <h2 id="ws-data" className="ws-h2">Data</h2>
                <dl className="ws-kv">
                  <div>
                    <dt>Export everything</dt>
                    <dd>
                      <button type="button" className="ws-link" onClick={() => requestOpenScreen('export')}>Export</button>
                    </dd>
                  </div>
                  <div>
                    <dt>Where it is kept, for how long</dt>
                    <dd>
                      <button type="button" className="ws-link" onClick={() => requestOpenScreen('dataHome')}>Data</button>
                    </dd>
                  </div>
                </dl>
              </section>

              {entities ? (
                <section className="ws-section" aria-labelledby="ws-made-of">
                  <h2 id="ws-made-of" className="ws-h2">What the account is made of</h2>
                  <dl className="ws-facts ws-facts--2">
                    <div><dt>Companies</dt><dd className="num">{entities.companies}</dd></div>
                    <div><dt>Branches</dt><dd className="num">{entities.branches}</dd></div>
                    <div><dt>GST registrations</dt><dd className="num">{entities.taxProfiles}</dd></div>
                    <div><dt>Cost centres</dt><dd className="num">{entities.costCentres}</dd></div>
                  </dl>
                  {entities.companiesWithoutGstin > 0 ? (
                    <p className="ws-card-blurb">
                      {entities.companiesWithoutGstin === 1
                        ? 'One company has no GSTIN on record.'
                        : `${entities.companiesWithoutGstin} companies have no GSTIN on record.`}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <DataHealth health={health} />
              <Security security={security} />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

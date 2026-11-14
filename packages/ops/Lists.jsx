import React, { useEffect, useState } from 'react';
import { AlertTriangle, Search, X } from '@ui/components/ui/lineIcons';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { APP_NAMES, Empty, Err, Loading, Pager, REASON, when } from './kit';
import { opsDenials, opsFeatureSwitches, opsOrganisations, opsUsers } from './api';
import './lists.css';

/**
 * The console's lists across every account (R&D OPS-05, 06, 08, 09; server:
 * routes/opsLists.ts): every organisation, every person who can sign in,
 * every refusal the platform made, and every module CLOR can switch per
 * account. Read-only: a change happens on the account's own page, with a
 * reason, as before.
 */

/* ----------------------------------------------------------------- shared */
/** Fetch `load(view)` whenever the view changes, a little after typing stops. */
function useList(load, view) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      load(view)
        .then((r) => live && (setData(r), setError('')))
        .catch((e) => live && setError(String(e?.message || e)));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [load, view]);
  return { data, error };
}

export function SearchBox({ label, value, onChange, placeholder }) {
  return (
    <label className="ops-search-field">
      <span className="sr-only">{label}</span>
      <Search size={16} aria-hidden="true" />
      <input className="ui-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** A filter that reads "Status: All", as the designs draw them. */
export function Filter({ label, value, options, onChange }) {
  return (
    <label className="ops-filter">
      <span className="sr-only">{label}</span>
      <select className="ui-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, text]) => (
          <option key={k} value={k}>
            {label}: {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A filter set from elsewhere (an account's page), shown so it can be taken off. */
function Chip({ children, onClear }) {
  return (
    <span className="ops-chip">
      {children}
      <button type="button" aria-label="Remove this filter" onClick={onClear}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

const initials = (s) =>
  String(s || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

/* Five identity colours for initials, by the name, so a person keeps theirs from page to page. */
const tone = (s) => (String(s || '').split('').reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5) + 1;
export const Initials = ({ name }) => (
  <span className="ops-initials ops-initials--list" aria-hidden="true" style={{ '--who': `var(--cat-${tone(name)})` }}>
    {initials(name)}
  </span>
);

const appList = (codes = []) => (codes.length ? codes.map((c) => APP_NAMES[c] || c).join(', ') : '—');

/* --------------------------------------------------------- organisations */
const ORG_STATUS = { active: ['Active', 'ws-pill ws-pill--ok'], archived: ['Archived', 'ws-pill ws-pill--off'], suspended: ['Account suspended', 'ws-pill ws-pill--danger'] };

export function Organisations({ account = '', openAccount, clearAccount }) {
  const [view, setView] = useState({ q: '', status: 'all', account, page: 0 });
  const { data, error } = useList(opsOrganisations, view);
  const set = (patch) => setView((v) => ({ ...v, ...patch, page: 0 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const accountName = data?.organisations?.[0]?.account?.name;
  return (
    <>
      <PageHead
        title="Organizations"
        description="Companies, across every account. Every row of customer data belongs to exactly one organization, and the database refuses a row from any other."
        meta={data ? `${data.total.toLocaleString('en-IN')} ${data.total === 1 ? 'organization' : 'organizations'}` : null}
      />
      <div className="ops-filters" role="search">
        <SearchBox label="Search organizations" value={view.q} onChange={(q) => set({ q })} placeholder="Search organization, ID or GSTIN" />
        <Filter
          label="Status"
          value={view.status}
          onChange={(status) => set({ status })}
          options={[
            ['all', 'All'],
            ['active', 'Active'],
            ['archived', 'Archived'],
            ['suspended', 'Account suspended'],
          ]}
        />
        {view.account ? (
          <Chip
            onClear={() => {
              set({ account: '' });
              clearAccount?.();
            }}
          >
            Account: {accountName || 'this one'}
          </Chip>
        ) : null}
      </div>
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.organisations.length ? (
        <Empty>{view.q ? 'No organization matches that search.' : 'No organization here.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Organizations</caption>
            <thead>
              <tr>
                <th>Organization</th>
                <th className="hidden md:table-cell">Account</th>
                <th className="hidden lg:table-cell">GSTIN</th>
                <th className="hidden xl:table-cell">Apps on</th>
                <th className="num hidden sm:table-cell">Members</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.organisations.map((o) => {
                const [word, cls] = ORG_STATUS[o.status] || [o.status, 'ws-pill'];
                return (
                  <tr key={o.id}>
                    <td style={{ whiteSpace: 'normal' }}>
                      <span className="ops-strong">{o.name}</span>
                      <div className="ws-item-sub tabular-nums">{o.code || '—'}</div>
                    </td>
                    <td className="hidden md:table-cell">
                      <button type="button" className="ops-row-link" onClick={() => openAccount(o.account.id)}>
                        {o.account.name}
                      </button>
                    </td>
                    <td className="hidden lg:table-cell tabular-nums">
                      {o.gstin || '—'}
                      {o.otherGstins ? <div className="ws-item-sub">and {o.otherGstins} more</div> : null}
                    </td>
                    <td className="hidden xl:table-cell" style={{ whiteSpace: 'normal' }}>{appList(o.apps)}</td>
                    <td className="num hidden sm:table-cell">{o.members}</td>
                    <td>
                      <span className={cls}>{word}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
      <p className="ops-callout">
        <AlertTriangle size={16} aria-hidden="true" />
        Row-level security is on for every company: each row carries its organization’s ID and the database refuses rows from another. Archived organizations are read-only and off the plan’s count.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ users */
const ROLE_WORD = { OWNER: 'Owner', ADMIN: 'Admin', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };
const USER_STATUS = {
  active: ['Active', 'ws-pill ws-pill--ok'],
  never: ['Never signed in', 'ws-pill ws-pill--off'],
  locked: ['Locked', 'ws-pill ws-pill--warn'],
  suspended: ['Suspended', 'ws-pill ws-pill--danger'],
  deactivated: ['Deactivated', 'ws-pill ws-pill--danger'],
  left: ['Left', 'ws-pill ws-pill--off'],
  'no-membership': ['No membership', 'ws-pill ws-pill--off'],
};
const signInWords = (s) => [s.method === 'sso' ? `SSO${s.provider ? ` (${s.provider})` : ''}` : 'Password', s.twoFactor ? '2FA' : null].filter(Boolean).join(' · ');
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function Users({ openAccount }) {
  const [view, setView] = useState({ q: '', signIn: 'all', status: 'all', page: 0 });
  const { data, error } = useList(opsUsers, view);
  const [exporting, setExporting] = useState(false);
  const set = (patch) => setView((v) => ({ ...v, ...patch, page: 0 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  /* Export what the filters show, every page of it (up to 5,000 people). */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = [];
      for (let page = 0; page < 100; page++) {
        const r = await opsUsers({ ...view, page });
        rows.push(...r.users);
        if ((page + 1) * r.pageSize >= r.total) break;
      }
      const lines = [['Name', 'Email', 'Accounts', 'Companies', 'Highest role', 'Sign-in', 'Last sign-in', 'Status'].map(csvCell).join(',')];
      for (const u of rows) {
        lines.push(
          [u.name, u.email, u.accounts.map((a) => a.name).join('; '), u.companies, ROLE_WORD[u.role] || u.role || '', signInWords(u.signIn), u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '', USER_STATUS[u.status]?.[0] || u.status]
            .map(csvCell)
            .join(','),
        );
      }
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clor-users.csv';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHead
        title="Users"
        description="People who can sign in, across all accounts. One person can belong to many accounts, for example a CA firm."
        meta={data ? `${data.total.toLocaleString('en-IN')} ${data.total === 1 ? 'person' : 'people'}` : null}
        actions={
          <button type="button" className="ws-btn ws-btn--quiet" onClick={exportCsv} disabled={exporting || !data?.total}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        }
      />
      <div className="ops-filters" role="search">
        <SearchBox label="Search users" value={view.q} onChange={(q) => set({ q })} placeholder="Search name or email" />
        <Filter
          label="Sign-in"
          value={view.signIn}
          onChange={(signIn) => set({ signIn })}
          options={[
            ['all', 'All'],
            ['twofactor', 'With 2FA'],
            ['password', 'Without 2FA'],
            ['sso', 'Single sign-on'],
          ]}
        />
        <Filter
          label="Status"
          value={view.status}
          onChange={(status) => set({ status })}
          options={[
            ['all', 'All'],
            ['active', 'Active'],
            ['locked', 'Locked'],
            ['deactivated', 'Deactivated'],
            ['never', 'Never signed in'],
          ]}
        />
      </div>
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.users.length ? (
        <Empty>{view.q ? 'Nobody matches that search.' : 'Nobody here.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Users</caption>
            <thead>
              <tr>
                <th>User</th>
                <th className="hidden md:table-cell">Accounts</th>
                <th className="hidden lg:table-cell">Highest role</th>
                <th className="hidden lg:table-cell">Sign-in</th>
                <th className="num hidden sm:table-cell">Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const [word, cls] = USER_STATUS[u.status] || [u.status, 'ws-pill'];
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="ops-person">
                        <Initials name={u.name || u.email} />
                        <span style={{ minWidth: 0 }}>
                          <span className="ops-strong">{u.name || u.email}</span>
                          <span className="ws-item-sub ops-clip">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden md:table-cell">
                      {u.accounts.length === 1 ? (
                        <button type="button" className="ops-row-link" onClick={() => openAccount(u.accounts[0].id)}>
                          {u.accounts[0].name}
                        </button>
                      ) : (
                        <span title={u.accounts.map((a) => a.name).join(', ')}>{u.accounts.length} accounts</span>
                      )}
                      <div className="ws-item-sub">{u.companies === 1 ? '1 company' : `${u.companies} companies`}</div>
                    </td>
                    <td className="hidden lg:table-cell">
                      <span className="ws-pill ws-pill--role">{u.role ? ROLE_WORD[u.role] || u.role : 'No membership'}</span>
                      {u.staff ? <div className="ws-item-sub">CLOR staff</div> : null}
                    </td>
                    <td className="hidden lg:table-cell">{signInWords(u.signIn)}</td>
                    <td className="num hidden sm:table-cell" title={u.lastLoginAt ? when(u.lastLoginAt) : undefined}>
                      {u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}
                    </td>
                    <td>
                      <span className={cls}>{word}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
    </>
  );
}

/* ---------------------------------------------------------------- denials */
const TILES = [
  ['', 'Denials today', 1, null],
  ['APP_NOT_SUBSCRIBED', 'APP_NOT_SUBSCRIBED', 2, 'Upsell signal'],
  ['NO_ROLE_GRANT', 'NO_ROLE_GRANT', 3, 'Role does not allow it'],
  ['SUBSCRIPTION_LAPSED', 'SUBSCRIPTION_LAPSED', 4, 'Plan lapsed', 'warn'],
];
const SINCE = [
  ['hour', 'Last hour'],
  ['day', 'Last 24 hours'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
];
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function Denials({ account = '', openAccount, clearAccount }) {
  const [view, setView] = useState({ q: '', code: '', app: '', since: account ? 'month' : 'day', account, page: 0 });
  const { data, error } = useList(opsDenials, view);
  const set = (patch) => setView((v) => ({ ...v, ...patch, page: 0 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const accountName = data?.denials?.find((d) => d.account)?.account?.name;
  const codes = [...new Set([...(data?.codes || []), ...Object.keys(REASON)])].sort();
  return (
    <>
      <PageHead title="Entitlement denials" description="Every time the platform said no, with the reason code. Use it to answer “why can’t I open this?” in one search." />
      <div className="ops-kpis">
        {TILES.map(([code, label, cat, note, state]) => {
          const value = code ? data?.today?.byCode?.[code] || 0 : data?.today?.total || 0;
          return (
            <button
              key={label}
              type="button"
              className="ops-kpi"
              aria-pressed={view.code === code && Boolean(code)}
              style={{ '--kpi': `var(--cat-${cat})` }}
              onClick={() => set({ code: view.code === code ? '' : code, since: 'day' })}
            >
              <span className="ops-kpi-chip" aria-hidden="true">
                <span className="ops-kpi-dot" />
              </span>
              <span className="ops-kpi-label">{label}</span>
              <span className="ops-kpi-value" data-state={value && state ? state : undefined}>
                {Number(value).toLocaleString('en-IN')}
              </span>
              <span className="ops-kpi-note">{note || (code ? '' : 'Since midnight')}</span>
            </button>
          );
        })}
      </div>
      <div className="ops-filters" role="search">
        <SearchBox label="Search denials" value={view.q} onChange={(q) => set({ q })} placeholder="Search user, org or correlation ID" />
        <Filter label="Reason" value={view.code} onChange={(code) => set({ code })} options={[['', 'All'], ...codes.map((c) => [c, c])]} />
        <Filter
          label="App"
          value={view.app}
          onChange={(app) => set({ app })}
          options={[['', 'All'], ...Object.entries(APP_NAMES)]}
        />
        <Filter label="When" value={view.since} onChange={(since) => set({ since })} options={SINCE} />
        {view.account ? (
          <Chip
            onClear={() => {
              set({ account: '' });
              clearAccount?.();
            }}
          >
            Account: {accountName || 'this one'}
          </Chip>
        ) : null}
      </div>
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.denials.length ? (
        <Empty>{view.q || view.code || view.app ? 'No refusal matches.' : 'Nobody was refused in this time.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Refusals</caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Who</th>
                <th className="hidden md:table-cell">Organization</th>
                <th>Reason code</th>
                <th className="num hidden sm:table-cell">HTTP</th>
                <th className="hidden lg:table-cell">Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {data.denials.map((d) => (
                <tr key={d.id}>
                  <td className="tabular-nums" title={when(d.at)}>
                    {view.since === 'hour' || view.since === 'day' ? clock(d.at) : when(d.at)}
                  </td>
                  <td>
                    <span className="ops-strong">{d.who?.name || d.who?.email || 'Someone signed in'}</span>
                    {d.account ? (
                      <div className="ws-item-sub">
                        <button type="button" className="ops-row-link" onClick={() => openAccount(d.account.id)}>
                          {d.account.name}
                        </button>
                      </div>
                    ) : null}
                  </td>
                  <td className="hidden md:table-cell">{d.org?.name || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }} title={REASON[d.code] || undefined}>
                    <span className="ops-code">{d.code}</span>
                    {d.app || d.feature ? <span className="ops-code-sub"> · {d.feature || APP_NAMES[d.app] || d.app}</span> : null}
                    <div className="ws-item-sub ops-clip">
                      {d.method} {d.route}
                    </div>
                  </td>
                  <td className="num hidden sm:table-cell">{d.status}</td>
                  <td className="hidden lg:table-cell tabular-nums ops-clip" style={{ maxWidth: 220 }} title={d.requestId || undefined}>
                    {d.requestId || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
      <p className="ops-callout">
        <AlertTriangle size={16} aria-hidden="true" />
        Kept for 30 days. A customer quotes the correlation ID from their error; paste it in the search to see who was refused, where, and why.
      </p>
    </>
  );
}

/* -------------------------------------------------------- feature switches */
const who = (s) => {
  if (s.appSwitch) return 'Follows the subscription';
  if (s.locked) return 'Always on';
  return s.defaultEnabled ? 'Its plan; on unless a company turns it off' : 'Its plan; off until a company turns it on';
};

function AccountLinks({ list, count, openAccount }) {
  if (!count) return null;
  return (
    <span>
      {list.map((a, i) => (
        <React.Fragment key={a.id}>
          {i ? ', ' : ''}
          <button type="button" className="ops-row-link" onClick={() => openAccount(a.id)}>
            {a.name}
          </button>
        </React.Fragment>
      ))}
      {count > list.length ? ` and ${count - list.length} more` : ''}
    </span>
  );
}

export function FeatureSwitches({ openAccount }) {
  const [view, setView] = useState({ q: '', app: '', changed: 'all', page: 0 });
  const { data, error } = useList(opsFeatureSwitches, view);
  const set = (patch) => setView((v) => ({ ...v, ...patch, page: 0 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <PageHead
        title="Feature switches"
        description="Every module, who gets it, and the accounts CLOR switched it for. Switch one for an account on that account’s Limits tab; every change needs a reason and is logged."
        meta={data ? `${data.accountsChanged} ${data.accountsChanged === 1 ? 'account has' : 'accounts have'} a switch set by CLOR` : null}
      />
      <div className="ops-filters" role="search">
        <SearchBox label="Search switches" value={view.q} onChange={(q) => set({ q })} placeholder="Search a module or its key" />
        <Filter label="App" value={view.app} onChange={(app) => set({ app })} options={[['', 'All'], ...Object.entries(APP_NAMES)]} />
        <Filter
          label="Show"
          value={view.changed}
          onChange={(changed) => set({ changed })}
          options={[
            ['all', 'Every switch'],
            ['changed', 'Set by CLOR somewhere'],
          ]}
        />
      </div>
      <Err>{error}</Err>
      {!data ? (
        error ? null : <Loading />
      ) : !data.switches.length ? (
        <Empty>{view.changed === 'changed' ? 'CLOR has not switched any module for any account.' : 'No switch matches.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Feature switches</caption>
            <thead>
              <tr>
                <th>Switch</th>
                <th className="hidden md:table-cell">Who gets it</th>
                <th>Set by CLOR</th>
                <th className="hidden lg:table-cell">Companies’ own choice</th>
              </tr>
            </thead>
            <tbody>
              {data.switches.map((s) => (
                <tr key={s.key}>
                  <td style={{ whiteSpace: 'normal', minWidth: '14rem' }}>
                    <span className="ops-strong">{s.label}</span>
                    <div className="ws-item-sub">
                      <span className="ops-key">{s.key}</span> · {APP_NAMES[s.app] || s.appName}
                    </div>
                  </td>
                  <td className="hidden md:table-cell" style={{ whiteSpace: 'normal' }}>{who(s)}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {!s.addedFor.count && !s.offFor.count ? (
                      <span className="ws-item-sub">Nowhere</span>
                    ) : (
                      <div className="grid gap-1">
                        {s.addedFor.count ? (
                          <div>
                            <span className="ws-pill ws-pill--ok">On for {s.addedFor.count}</span> <AccountLinks list={s.addedFor.accounts} count={s.addedFor.count} openAccount={openAccount} />
                          </div>
                        ) : null}
                        {s.offFor.count ? (
                          <div>
                            <span className="ws-pill ws-pill--off">Off for {s.offFor.count}</span> <AccountLinks list={s.offFor.accounts} count={s.offFor.count} openAccount={openAccount} />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="hidden lg:table-cell tabular-nums">
                    {s.companies.on || s.companies.off ? `On in ${s.companies.on.toLocaleString('en-IN')}, off in ${s.companies.off.toLocaleString('en-IN')}` : 'Default everywhere'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
      <p className="ops-callout">
        <AlertTriangle size={16} aria-hidden="true" />
        A switch CLOR sets takes effect at once and survives a renewal. Customers never see switch keys; a refused module shows as MODULE_OFF in Entitlement denials.
      </p>
    </>
  );
}

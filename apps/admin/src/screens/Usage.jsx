import React, { useEffect, useState } from 'react';

import { getAccountMe, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { CountLine } from '@ui/components/ui/CountLine';
import { LoadError, Loading, PageHead } from './wsKit';
import { IDLE_DAYS, allowances, idleMembers, seatHolders, seatRows } from './usageModel';
import './workspace.css';

/**
 * Workspace → Plan → Usage: is the account using what it pays for?
 *
 * Seats per app (bought, in use, left), the people who hold a seat and are
 * not signing in, what each company uses, and the plan's own caps. Every
 * figure is read from the server (/account/overview, /account/members/directory);
 * nothing is estimated. Owners and administrators see all of it; a billing
 * admin sees the plan's side without the list of people.
 */
const APP_NAME = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance', projects: 'Projects' };
const appNames = (ids) => ids.map((a) => APP_NAME[a] || a).join(', ');
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

export default function Usage({ tenant, catalog = [], navItems = [], openScreen }) {
  const [me, setMe] = useState(undefined);
  const [overview, setOverview] = useState(undefined);
  const [directory, setDirectory] = useState(undefined);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    getAccountMe()
      .then((r) => {
        if (!live) return;
        setMe(r || null);
        const role = r?.role;
        const seesPlan = role === 'OWNER' || role === 'ADMIN' || role === 'BILLING_ADMIN';
        const seesPeople = role === 'OWNER' || role === 'ADMIN';
        if (seesPlan) getAccountOverview().then((o) => live && setOverview(o || null)).catch(() => live && setOverview(null));
        else setOverview(null);
        if (seesPeople) memberDirectory().then((d) => live && setDirectory(d?.members || [])).catch(() => live && setDirectory(null));
        else setDirectory(null);
      })
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [tenant?.id, tries]);

  const may = new Set(navItems.map((n) => n.key));
  const role = me?.role;
  const allowed = role === 'OWNER' || role === 'ADMIN' || role === 'BILLING_ADMIN';
  const loading = me === undefined || (allowed && (overview === undefined || directory === undefined));
  /* Back to "loading" before reading again, so the old error does not sit beside the new attempt. */
  const retry = () => {
    setMe(undefined);
    setOverview(undefined);
    setDirectory(undefined);
    setTries((n) => n + 1);
  };

  const built = catalog.filter((a) => !a.platform && a.available).map((a) => a.id);
  const metered = (overview?.seats || []).filter((s) => s.bought != null).map((s) => s.app);
  const usedIn = new Set((overview?.companies || []).filter((c) => !c.archived).flatMap((c) => c.apps || []));
  /* An app is listed when the account has it on somewhere or has bought seats for it; one the plan merely allows is not. */
  const appIds = (built.length ? built : [...new Set([...usedIn, ...metered])]).filter((a) => usedIn.has(a) || metered.includes(a));
  const seats = directory ? seatRows(directory, overview?.seats, appIds) : null;
  const idle = directory ? idleMembers(directory) : null;
  const holders = directory ? seatHolders(directory) : null;
  const caps = allowances(overview);
  const companies = (overview?.companies || []).filter((c) => !c.archived);
  const short = (seats || []).filter((s) => s.state === 'over' || s.state === 'full').length;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Usage']}
          scope="account"
          title="Usage"
          description="What the plan gives you, and how much of it is used."
          actions={
            allowed && may.has('billing') ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => openScreen?.('billing')}>Change plan or seats</button>
            ) : null
          }
        />

        {loading ? <Loading shape="rows" rows={4} label="Loading usage…" /> : null}
        {me === null ? <LoadError onRetry={retry}>Your access could not be read. Try again in a minute.</LoadError> : null}
        {!loading && me && !allowed ? <p className="ws-notice" role="status">Only the account’s owners, administrators and billing admins see usage.</p> : null}
        {!loading && allowed && overview === null ? <LoadError onRetry={retry}>The plan could not be read. Try again in a minute.</LoadError> : null}

        {!loading && allowed && overview ? (
          <>
            <CountLine
              label="Usage figures"
              items={[
                { key: 'holders', label: holders === 1 ? 'person with a seat' : 'people with a seat', value: holders },
                { key: 'companies', label: companies.length === 1 ? 'company' : 'companies', value: companies.length },
                { key: 'short', label: short === 1 ? 'app out of seats' : 'apps out of seats', value: short, tone: 'warn' },
                { key: 'idle', label: 'not signing in', value: idle?.length || 0, tone: 'warn' },
              ]}
            />

            <section aria-labelledby="us-seats" className="grid gap-2">
              <h2 id="us-seats" className="ws-h2">Seats by app</h2>
              {seats === null ? (
                <p className="ws-item-sub">{directory === null && (role === 'OWNER' || role === 'ADMIN') ? 'The list of people could not be read, so seats in use are not shown.' : 'Seats in use are shown to owners and administrators.'}</p>
              ) : !seats.length ? (
                <p className="ws-item-sub">No app is switched on yet.</p>
              ) : (
                <div className="ws-table-wrap">
                  <table className="ws-table">
                    <caption className="sr-only">Seats bought and in use, by app</caption>
                    <thead>
                      <tr>
                        <th>App</th>
                        <th className="num">In use</th>
                        <th className="num">Bought</th>
                        <th className="num">Left</th>
                        <th><span className="sr-only">State</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seats.map((s) => (
                        <tr key={s.app}>
                          <td><strong style={{ fontWeight: 600 }}>{APP_NAME[s.app] || s.app}</strong></td>
                          <td className="num">{s.used}</td>
                          <td className="num">{s.bought == null ? 'No limit' : s.bought}</td>
                          <td className="num">{s.left == null ? '' : Math.max(0, s.left)}</td>
                          <td>
                            {s.state === 'over' ? <span className="ws-pill ws-pill--danger">{-s.left} over</span> : s.state === 'full' ? <span className="ws-pill ws-pill--warn">Full</span> : <span className="sr-only">{s.state === 'open' ? 'Not limited' : 'Seats left'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {idle ? (
              <section aria-labelledby="us-idle" className="grid gap-2">
                <h2 id="us-idle" className="ws-h2">Not signing in</h2>
                {idle.length ? (
                  <>
                    <p className="ws-item-sub" style={{ whiteSpace: 'normal' }}>
                      {people(idle.length)} {idle.length === 1 ? 'holds' : 'hold'} a seat and {idle.length === 1 ? 'has' : 'have'} not signed in for {IDLE_DAYS} days, or ever. Taking away an app they do not use frees the seat.{' '}
                      {may.has('members') ? <button type="button" className="ws-row-link" onClick={() => openScreen?.('members')}>Open Members</button> : null}
                    </p>
                    <div className="ws-table-wrap">
                      <table className="ws-table">
                        <caption className="sr-only">People with a seat who are not signing in</caption>
                        <thead>
                          <tr>
                            <th>Person</th>
                            <th>Apps they can open</th>
                            <th>Last sign-in</th>
                          </tr>
                        </thead>
                        <tbody>
                          {idle.map((m) => (
                            <tr key={m.userId}>
                              <td>
                                <strong style={{ fontWeight: 600 }}>{m.name}</strong>
                                {m.email && m.email !== m.name ? <div className="ws-item-sub">{m.email}</div> : null}
                              </td>
                              <td>{appNames(m.apps)}</td>
                              <td className="tabular-nums">{m.days == null ? 'Never signed in' : `${day(m.lastSignInAt)} · ${m.days} days ago`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="ws-item-sub">Everyone with a seat has signed in during the last {IDLE_DAYS} days.</p>
                )}
              </section>
            ) : null}

            {companies.length ? (
              <section aria-labelledby="us-companies" className="grid gap-2">
                <h2 id="us-companies" className="ws-h2">By company</h2>
                <div className="ws-table-wrap">
                  <table className="ws-table">
                    <caption className="sr-only">People and apps in each company</caption>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th className="num">People</th>
                        <th>Apps switched on</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map((c) => (
                        <tr key={c.orgId}>
                          <td><strong style={{ fontWeight: 600 }}>{c.name}</strong></td>
                          <td className="num">{c.people}</td>
                          <td>{appNames(c.apps || []) || 'None'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {caps.length ? (
              <section aria-labelledby="us-caps" className="grid gap-2">
                <h2 id="us-caps" className="ws-h2">Plan allowance</h2>
                <div className="ws-table-wrap">
                  <table className="ws-table">
                    <caption className="sr-only">What the {overview.plan?.name || ''} plan allows and what is used</caption>
                    <thead>
                      <tr>
                        <th>What</th>
                        <th className="num">Used</th>
                        <th className="num">Allowed</th>
                        <th><span className="sr-only">State</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {caps.map((c) => (
                        <tr key={c.key}>
                          <td><strong style={{ fontWeight: 600 }}>{c.label}</strong></td>
                          <td className="num">{c.used}</td>
                          <td className="num">{c.limit}</td>
                          <td>{c.used >= c.limit ? <span className="ws-pill ws-pill--warn">{c.used > c.limit ? `${c.used - c.limit} over` : 'At the limit'}</span> : <span className="sr-only">Within the plan</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { opsBuildSample, opsEndPass, opsExplorePasses, opsResendPass, opsSampleCompany } from './api';

/**
 * Explore on the operator console (server: routes/opsExplore.ts).
 *
 * The owner's rule: Clor's own staff work is done on screens. The sample
 * company that Explore links open is built here, and every link sent with a
 * demo request is listed here, to resend or end. Reading is for any operator;
 * a change needs support or billing, an authenticator code, and goes on the
 * operator log.
 */

const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const Err = ({ children }) => (children ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p> : null);
const seconds = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 1000)) : null);

/* The build's steps, as a person would say them (server: services/sampleCompanyData.ts). */
const STEP = {
  'books: parties, items, ledgers': 'customers, vendors and items',
  'books: bills and payments': 'bills and payments',
  'books: invoices and receipts': 'invoices and receipts',
  'people: departments, positions, employees': 'departments and employees',
  'time: holidays, leave, attendance': 'holidays, leave and attendance',
  'payroll: setup, profiles, last month posted': "payroll and last month's pay run",
};
const COUNTS = [
  ['employees', 'Employees'],
  ['customers', 'Customers'],
  ['vendors', 'Vendors'],
  ['items', 'Items'],
  ['invoices', 'Invoices'],
  ['bills', 'Bills'],
  ['payRuns', 'Pay runs'],
  ['leaveRequests', 'Leave requests'],
  ['attendanceDays', 'Attendance days'],
];

/** What the latest build is doing or did, in plain words. */
export function BuildLine({ build }) {
  if (!build) return <p className="ws-card-blurb">It has not been built from here yet.</p>;
  if (build.state === 'running') {
    const done = (build.done || []).map((s) => STEP[s] || s);
    return (
      <div role="status" className="grid gap-1">
        <p>Building now. This takes about a minute; you can leave this page.</p>
        <p className="ws-card-blurb">{done.length ? `Done so far: ${done.join(', ')}.` : `Started ${ago(build.startedAt)}.`}</p>
      </div>
    );
  }
  if (build.state === 'failed') {
    return (
      <div role="status" className="grid gap-1">
        <p style={{ color: 'rgb(var(--ws-danger))' }}>The last build did not finish{build.finishedAt ? ` (${when(build.finishedAt)})` : ''}.</p>
        {build.error ? <p className="ws-card-blurb">{build.error}</p> : null}
        <p className="ws-card-blurb">Press Build sample company to try again. What was made before is kept.</p>
      </div>
    );
  }
  const took = seconds(build.startedAt, build.finishedAt);
  const problems = build.problems || [];
  return (
    <div role="status" className="grid gap-1">
      <p>
        Built {when(build.finishedAt)}
        {took ? `, in ${took} s` : ''}.
      </p>
      {problems.length ? (
        <details>
          <summary className="ws-card-blurb">{problems.length === 1 ? 'One thing did not go in' : `${problems.length} things did not go in`}; the rest is there.</summary>
          <ul className="ws-card-blurb" style={{ marginTop: 4 }}>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the sample */
export function SampleCompany({ role, openLinks }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(
    () =>
      opsSampleCompany()
        .then((r) => {
          setD(r);
          setError('');
        })
        .catch((e) => setError(String(e?.message || e))),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  const running = d?.build?.state === 'running';
  /* While it builds, look again every two seconds. */
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [running, load]);
  /* Tell the operator once when a build they watched ends. */
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (running) setWatching(true);
    else if (watching && d?.build) {
      setWatching(false);
      if (d.build.state === 'done') notify.success('The sample company is built.');
      else if (d.build.state === 'failed') notify.error('The sample company build did not finish.');
    }
  }, [running, watching, d]);

  const mayAct = may(role, 'SUPPORT', 'BILLING');
  const build = async (force) => {
    if (
      force &&
      !(await confirmDialog({
        title: 'Rebuild the sample company?',
        message: 'Every step of the build runs again, and anything missing is put back. Nothing is deleted, and visitors can keep looking while it runs. It takes about a minute.',
        confirmLabel: 'Rebuild',
        tone: 'primary',
      }))
    )
      return;
    setBusy(force ? 'rebuild' : 'build');
    setError('');
    try {
      await opsBuildSample(force);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const primary = mayAct ? (
    <button type="button" className="ws-btn ws-btn--primary" disabled={Boolean(busy) || running || !d} onClick={() => build(false)}>
      {running ? 'Building…' : busy === 'build' ? 'Starting…' : 'Build sample company'}
    </button>
  ) : null;

  return (
    <>
      <PageHead
        crumbs={['Operator']}
        title="Sample company"
        description="The made-up company that Explore links open, read-only, for people who asked for a demo."
        actions={primary}
      />
      <Err>{error}</Err>
      {!d ? (
        error ? null : <p className="ws-card-blurb">Loading…</p>
      ) : (
        <>
          <Panel title={d.company}>
            <div className="grid gap-3">
              {d.exists && d.builtAt ? (
                /* A finished build already says when; the line below would say it twice. */
                <p>{d.build?.state === 'done' ? 'It is there.' : `It is there, last built ${when(d.builtAt)}.`}</p>
              ) : d.exists && running ? (
                <p>It is being made for the first time.</p>
              ) : d.exists ? (
                <p>It is there, but its people, invoices and pay are not in it yet. Build it to put them in.</p>
              ) : (
                <p>
                  It has not been made yet. The first person to open an Explore link would wait about a minute while it is made, so build it now.
                </p>
              )}
              {d.build || d.exists ? <BuildLine build={d.build} /> : null}
              {mayAct && d.exists ? (
                <div>
                  <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy) || running} onClick={() => build(true)}>
                    {busy === 'rebuild' ? 'Starting…' : 'Rebuild from scratch'}
                  </button>
                </div>
              ) : null}
            </div>
          </Panel>
          {d.exists && d.counts ? (
            <Panel title="What is in it">
              <dl className="ops-facts">
                {COUNTS.map(([k, label]) => (
                  <React.Fragment key={k}>
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{d.counts[k] ?? '—'}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </Panel>
          ) : null}
          <Panel
            title="Explore links"
            action={
              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={openLinks}>
                See every link
              </button>
            }
          >
            <p>
              <span className="tabular-nums">{d.livePasses}</span> {d.livePasses === 1 ? 'link works' : 'links work'} now, of <span className="tabular-nums">{d.allPasses}</span> sent.
            </p>
          </Panel>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- the links */
const PASS_STATE = { active: ['Open', 'ws-pill ws-pill--ok'], expired: ['Ran out', 'ws-pill ws-pill--off'], ended: ['Ended', 'ws-pill ws-pill--off'] };
const VIEWS = [
  ['all', 'Every link'],
  ['active', 'Open'],
  ['expired', 'Ran out'],
  ['ended', 'Ended'],
];

export function ExploreLinks({ role, openRequest }) {
  const [view, setView] = useState({ state: 'all', page: 0 });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    opsExplorePasses(view)
      .then((r) => live && (setData(r), setError('')))
      .catch((e) => live && setError(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [view, tick]);
  const mayAct = may(role, 'SUPPORT', 'BILLING');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const act = async (kind, p) => {
    if (kind === 'end' && !(await confirmDialog({ title: 'End Explore access?', message: `The link sent to ${p.email} stops working and anyone using it now is signed out. Resend makes a new one.`, confirmLabel: 'End access' }))) return;
    setBusy(`${kind}:${p.id}`);
    setError('');
    try {
      if (kind === 'end') {
        const r = await opsEndPass(p.id);
        notify.success(r.sessionsEnded ? `Access ended. ${r.sessionsEnded} open session${r.sessionsEnded === 1 ? '' : 's'} signed out.` : 'Access ended.');
      } else {
        await opsResendPass(p.id);
        notify.success(`A new link is on its way to ${p.email}. The old one no longer works.`);
      }
      setTick((n) => n + 1);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHead crumbs={['Operator']} title="Explore links" meta={data ? `${data.active} open` : null} />
      <div className="flex flex-wrap gap-2 items-center">
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Which links" value={view.state} onChange={(e) => setView({ state: e.target.value, page: 0 })}>
          {VIEWS.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </div>
      <Err>{error}</Err>
      {!data ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : data.passes.length === 0 ? (
        <div className="ws-empty">
          <p>{view.state === 'all' ? 'No Explore link has been sent yet. Each demo request from clor.in/demo sends one.' : 'No link here.'}</p>
        </div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Explore links, newest first</caption>
            <thead>
              <tr>
                <th>Sent to</th>
                <th>Sent</th>
                <th>Last used</th>
                <th className="num">Times used</th>
                <th>Works until</th>
                <th>State</th>
                {mayAct ? <th><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {data.passes.map((p) => {
                const [label, tone] = PASS_STATE[p.state] || [p.state, 'ws-pill'];
                return (
                  <tr key={p.id}>
                    <td>
                      <div>{p.email}</div>
                      {p.demoRequest ? (
                        <button type="button" className="ws-name-link ws-item-sub" onClick={() => openRequest(p.demoRequest.id)}>
                          {[p.demoRequest.name, p.demoRequest.company].filter(Boolean).join(', ') || 'Demo request'}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      {when(p.sentAt)}
                      {p.sendCount > 1 ? <div className="ws-item-sub">{p.sendCount} times</div> : null}
                    </td>
                    <td>{p.lastUsedAt ? ago(p.lastUsedAt) : 'Not yet'}</td>
                    <td className="num">{p.useCount}</td>
                    <td>{day(p.revokedAt || p.expiresAt)}</td>
                    <td><span className={tone}>{label}</span></td>
                    {mayAct ? (
                      <td>
                        <div className="flex gap-2 justify-end">
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy)} onClick={() => act('resend', p)}>
                            {busy === `resend:${p.id}` ? 'Sending…' : 'Resend'}
                          </button>
                          {p.state === 'active' ? (
                            <button type="button" className="ws-btn ws-btn--danger ws-btn--small" disabled={Boolean(busy)} onClick={() => act('end', p)}>
                              {busy === `end:${p.id}` ? 'Ending…' : 'End access'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav className="flex items-center gap-2" aria-label="Pages">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page === 0} onClick={() => setView((v) => ({ ...v, page: v.page - 1 }))}>Newer</button>
          <span className="ws-head-meta">Page {view.page + 1} of {pages}</span>
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page + 1 >= pages} onClick={() => setView((v) => ({ ...v, page: v.page + 1 }))}>Older</button>
        </nav>
      ) : null}
    </>
  );
}

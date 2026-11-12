import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { PageHead, Panel, WsDrawer, ago } from '../../apps/admin/src/screens/wsKit';
import { opsCreateDemoAccount, opsDemoRequest, opsDemoRequests, opsDemoTeam, opsEndExplore, opsResendExplore, opsSetDemoStatus } from './api';

/**
 * Demo requests from clor.in/demo (server: routes/demoRequests.ts). The team
 * calls, holds the demo, then makes the account from here: Create account
 * makes the owner and company with the chosen apps on a trial and emails the
 * owner a link to set their password. A second click returns the same account.
 *
 * A pipeline (platform audit, 11 Nov 2026): each lead has someone on the team
 * who looks after it and a date to call next; Mine, Follow up today and
 * Nobody's yet find them, and Source says where the visitor came from.
 */
const DEMO_STATUS = { NEW: 'New', CONTACTED: 'Contacted', DEMO_DONE: 'Demo done', ACCOUNT_CREATED: 'Account created', NOT_A_FIT: 'Not a fit' };
const SETTABLE = ['NEW', 'CONTACTED', 'DEMO_DONE', 'NOT_A_FIT'];
/* clor.in's names and order. */
const APPS = [
  ['accounting', 'Books'],
  ['payroll', 'Payroll'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
];
const appName = (code) => APPS.find(([k]) => k === code)?.[1] || code;
const appsText = (codes = []) => APPS.filter(([k]) => codes.includes(k)).map(([, n]) => n).join(', ') || '—';
const SIZE = { '1-10': '1–10', '11-20': '11–20', '21-50': '21–50', '51-200': '51–200', '200+': '200+' };
const STATES = [...new Set(Object.values(GST_STATE_BY_CODE))].filter((s) => !/\(Old\)/.test(s)).sort((a, b) => a.localeCompare(b));
/* +919845012345 as people read it: +91 98450 12345. */
const phone = (p) => (/^\+91\d{10}$/.test(p || '') ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : p);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const may = (role, ...roles) => role === 'SUPER_ADMIN' || roles.includes(role);
const Err = ({ children }) => (children ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{children}</p> : null);

/* What the team did, in a line each. */
const HISTORY = { DEMO_ACCOUNT_CREATED: 'Account created', EXPLORE_RESENT: 'Explore link sent again', EXPLORE_ENDED: 'Explore access ended', DEMO_REQUEST_ASSIGNED: 'Given to someone', DEMO_REQUEST_FOLLOW_UP: 'Follow-up date set' };
const VIEWS = [
  ['all', 'Everyone’s'],
  ['mine', 'Mine'],
  ['due', 'Follow up today'],
  ['unassigned', 'Nobody’s yet'],
];
/* A follow-up date as the day in India, and whether it is today or earlier. */
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const isDue = (d) => Boolean(d) && istDay(d) <= istDay(Date.now());
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

export function DemoPill({ status }) {
  const tone = status === 'ACCOUNT_CREATED' ? 'ws-pill ws-pill--ok' : status === 'NEW' ? 'ws-pill ws-pill--warn' : status === 'NOT_A_FIT' ? 'ws-pill ws-pill--off' : 'ws-pill';
  return <span className={tone}>{DEMO_STATUS[status] || status}</span>;
}

/* ------------------------------------------------------------------ list */
export function DemoRequests({ openRequest }) {
  const [view, setView] = useState({ status: 'all', page: 0, view: 'all', source: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    /* Only the filters in use go on the address. */
    opsDemoRequests({ status: view.status, page: view.page, ...(view.view !== 'all' ? { view: view.view } : {}), ...(view.source ? { source: view.source } : {}) })
      .then((r) => live && (setData(r), setError('')))
      .catch((e) => live && setError(String(e?.message || e)));
    return () => {
      live = false;
    };
  }, [view]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const waiting = data?.counts?.NEW || 0;
  return (
    <>
      <PageHead crumbs={['Operator']} title="Demo requests" meta={data ? `${waiting} new` : null} />
      <div className="flex flex-wrap gap-2 items-center">
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Whose" value={view.view} onChange={(e) => setView((v) => ({ ...v, view: e.target.value, page: 0 }))}>
          {VIEWS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
              {k !== 'all' && data?.views?.[k] ? ` (${data.views[k]})` : ''}
            </option>
          ))}
        </select>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Status" value={view.status} onChange={(e) => setView((v) => ({ ...v, status: e.target.value, page: 0 }))}>
          <option value="all">Every status</option>
          {Object.entries(DEMO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
              {data?.counts?.[k] ? ` (${data.counts[k]})` : ''}
            </option>
          ))}
        </select>
        {data?.sources?.length ? (
          <select className="ui-select" style={{ width: 'auto' }} aria-label="Source" value={view.source} onChange={(e) => setView((v) => ({ ...v, source: e.target.value, page: 0 }))}>
            <option value="">Every source</option>
            {data.sources.map((x) => (
              <option key={x.source} value={x.source}>{x.source} ({x.count})</option>
            ))}
          </select>
        ) : null}
      </div>
      <Err>{error}</Err>
      {!data ? (
        <p className="ws-card-blurb">Loading…</p>
      ) : data.requests.length === 0 ? (
        <div className="ws-empty">
          <p>
            {view.view === 'due'
              ? 'No follow-up is due today.'
              : view.view === 'mine'
                ? 'No open request is yours.'
                : view.view === 'unassigned'
                  ? 'Every open request has someone looking after it.'
                  : view.status === 'all' && !view.source
                    ? 'Nobody has asked for a demo yet. Requests from clor.in/demo land here.'
                    : 'No request matches.'}
          </p>
        </div>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Demo requests, newest first</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Company</th>
                <th>Apps</th>
                <th>Size</th>
                <th className="num">Users</th>
                <th>Looked after by</th>
                <th>Follow up</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    {day(r.createdAt)}
                    <div className="ws-item-sub">{ago(r.createdAt)}</div>
                  </td>
                  <td>
                    <button type="button" className="ws-name-link" onClick={() => openRequest(r.id)}>{r.name}</button>
                    <div className="ws-item-sub">{r.email}</div>
                  </td>
                  <td>
                    <div>{r.company}</div>
                    <div className="ws-item-sub">{r.city}{r.source ? ` · ${r.source}` : ''}</div>
                  </td>
                  <td>{appsText(r.apps)}</td>
                  <td>{SIZE[r.companySize] || r.companySize}</td>
                  <td className="num">{r.users}</td>
                  <td>{r.assignedToName || <span className="ws-item-sub">Nobody yet</span>}</td>
                  <td>{r.followUpAt ? <span className={isDue(r.followUpAt) && !['ACCOUNT_CREATED', 'NOT_A_FIT'].includes(r.status) ? 'ws-pill ws-pill--warn' : undefined}>{day(r.followUpAt)}</span> : '—'}</td>
                  <td><DemoPill status={r.status} /></td>
                </tr>
              ))}
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

/* ------------------------------------------------------------ one request */
export function DemoRequestDetail({ id, role, back, openAccount }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('NEW');
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [team, setTeam] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    opsDemoRequest(id)
      .then((r) => {
        setD(r);
        setStatus(r.request.status);
        setNote(r.request.note || '');
        setOwner(r.request.assignedToUserId || '');
        setFollowUp(r.request.followUpAt ? istDay(r.request.followUpAt) : '');
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    opsDemoTeam()
      .then((t) => setTeam(t?.team || []))
      .catch(() => setTeam([]));
  }, []);

  if (!d) return error ? <Err>{error}</Err> : <p className="ws-card-blurb">Loading…</p>;
  const r = d.request;
  const closed = r.status === 'ACCOUNT_CREATED';
  const mayMove = may(role, 'SALES', 'SUPPORT', 'BILLING');
  const mayCreate = may(role, 'BILLING');
  const wasFollowUp = r.followUpAt ? istDay(r.followUpAt) : '';
  const changed = status !== r.status || note.trim() !== (r.note || '') || owner !== (r.assignedToUserId || '') || followUp !== wasFollowUp;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      await opsSetDemoStatus(r.id, {
        status,
        note: note.trim() || null,
        ...(owner !== (r.assignedToUserId || '') ? { assignedToUserId: owner || null } : {}),
        /* A date is a day in India: midnight IST, due all that day. */
        ...(followUp !== wasFollowUp ? { followUpAt: followUp ? `${followUp}T00:00:00+05:30` : null } : {}),
      });
      notify.success('Saved. It is on the record.');
      load();
    } catch (err) {
      setSaveError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div>
        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={back}>
          <ArrowLeft size={14} aria-hidden="true" /> Demo requests
        </button>
      </div>
      <PageHead
        crumbs={['Operator · Demo requests']}
        title={r.company}
        meta={<>{r.name} · asked {day(r.createdAt)}</>}
        actions={
          closed && d.account ? (
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openAccount(d.account.id)}>Open the account</button>
          ) : mayCreate ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setCreating(true)}>Create account</button>
          ) : null
        }
      />
      {closed && d.account ? (
        <p className="ws-notice" role="status">
          Account made: {d.account.name} (<span className="ui-mono">{d.account.code || '—'}</span>). The owner was emailed a link to set their password.
        </p>
      ) : null}

      <div className="ws-layout">
        <div className="ws-main">
          <Panel title="What they asked for">
            <dl className="ops-facts">
              <dt>Name</dt>
              <dd>{r.name}</dd>
              <dt>Work email</dt>
              <dd><a href={`mailto:${r.email}`}>{r.email}</a></dd>
              <dt>Phone</dt>
              <dd><a className="ui-num" href={`tel:${r.phone}`}>{phone(r.phone)}</a></dd>
              <dt>City</dt>
              <dd>{r.city}</dd>
              <dt>People who work there</dt>
              <dd>{SIZE[r.companySize] || r.companySize}</dd>
              <dt>Will sign in</dt>
              <dd>{r.users}</dd>
              <dt>Apps</dt>
              <dd>{appsText(r.apps)}</dd>
              <dt>Message</dt>
              <dd style={{ whiteSpace: 'pre-line' }}>{r.message || '—'}</dd>
              <dt>Came from</dt>
              <dd>
                {r.source || '—'}
                {r.sourceDetail?.utm_campaign ? <div className="ws-item-sub">Campaign: {r.sourceDetail.utm_campaign}{r.sourceDetail.utm_medium ? ` (${r.sourceDetail.utm_medium})` : ''}</div> : null}
                {r.sourceDetail?.landing ? <div className="ws-item-sub">First page: clor.in{r.sourceDetail.landing}</div> : null}
              </dd>
            </dl>
          </Panel>
        </div>
        <aside className="ws-side">
          <Panel title="Status">
            {closed || !mayMove ? (
              <div className="grid gap-2">
                <div><DemoPill status={r.status} /></div>
                <p className="ws-card-blurb">Looked after by {r.assignedToName || 'nobody yet'}{r.followUpAt && !closed ? `; follow up on ${day(r.followUpAt)}` : ''}.</p>
                {r.note ? <p className="ws-card-blurb" style={{ whiteSpace: 'pre-line' }}>{r.note}</p> : null}
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={save}>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Status</span>
                  <select className="ui-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {SETTABLE.map((k) => (
                      <option key={k} value={k}>{DEMO_STATUS[k]}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Looked after by</span>
                  <select className="ui-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">Nobody yet</option>
                    {team.map((t) => (
                      <option key={t.userId} value={t.userId}>{t.name}</option>
                    ))}
                    {owner && !team.some((t) => t.userId === owner) ? <option value={owner}>{r.assignedToName || 'Someone who left the team'}</option> : null}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Follow up on</span>
                  <input type="date" className="ui-input" value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={status === 'NOT_A_FIT'} />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Note</span>
                  <textarea className="ui-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Called, demo on Thursday at 11" />
                </label>
                <Err>{saveError}</Err>
                <div>
                  <button type="submit" className="ws-btn ws-btn--quiet" disabled={saving || !changed}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </form>
            )}
          </Panel>
          <ExplorePanel id={r.id} pass={d.explore} mayAct={mayMove} onChange={load} />
          <Panel title="What the team did">
            {d.history.length ? (
              <ul className="ws-list">
                {d.history.map((e) => (
                  <li key={e.id}>
                    <div className="ws-item">
                      <span className="ws-item-text">
                        <span className="ws-item-title">
                          {e.action === 'DEMO_REQUEST_ASSIGNED'
                            ? `Given to ${team.find((t) => t.userId === e.detail?.to)?.name || (e.detail?.to ? 'someone' : 'nobody')}`
                            : e.action === 'DEMO_REQUEST_FOLLOW_UP'
                              ? e.detail?.at ? `Follow up on ${day(e.detail.at)}` : 'Follow-up date cleared'
                              : HISTORY[e.action] || `${DEMO_STATUS[e.detail?.from] || e.detail?.from} → ${DEMO_STATUS[e.detail?.to] || e.detail?.to}`}
                        </span>
                        <span className="ws-item-sub">{e.operatorName || 'operator'} · {ago(e.at)}{e.detail?.note ? ` · ${e.detail.note}` : ''}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-card-blurb">Nothing yet.</p>
            )}
          </Panel>
        </aside>
      </div>

      <CreateAccount open={creating} request={r} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />
    </>
  );
}

/**
 * The Explore link sent with the request (server: services/explore.ts): a
 * read-only look at the sample company for 14 days. Resend mails a new link
 * (the old one stops working; an ended link opens again for 14 days); End
 * access stops the link and signs out whoever is using it.
 */
const PASS_STATE = { active: ['Open', 'ws-pill ws-pill--ok'], expired: ['Ran out', 'ws-pill ws-pill--off'], ended: ['Ended', 'ws-pill ws-pill--off'] };
function ExplorePanel({ id, pass, mayAct, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const act = async (kind) => {
    if (kind === 'end' && !(await confirmDialog({ title: 'End Explore access?', message: 'The link stops working and anyone using it now is signed out. Resend makes a new one.', confirmLabel: 'End access' }))) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'end') {
        const r = await opsEndExplore(id);
        notify.success(r.sessionsEnded ? `Access ended. ${r.sessionsEnded} open session${r.sessionsEnded === 1 ? '' : 's'} signed out.` : 'Access ended.');
      } else {
        await opsResendExplore(id);
        notify.success('A new link is on its way. The old one no longer works.');
      }
      onChange();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };
  const [label, tone] = pass ? PASS_STATE[pass.state] || [pass.state, 'ws-pill'] : [];
  return (
    <Panel title="Explore link">
      {pass ? (
        <div className="grid gap-3">
          <div><span className={tone}>{label}</span></div>
          <dl className="ops-facts">
            <dt>Sent</dt>
            <dd>{when(pass.sentAt)}{pass.sendCount > 1 ? ` (${pass.sendCount} times)` : ''}</dd>
            <dt>Last used</dt>
            <dd>{pass.lastUsedAt ? ago(pass.lastUsedAt) : 'Not yet'}</dd>
            <dt>Times used</dt>
            <dd className="tabular-nums">{pass.useCount}</dd>
            <dt>{pass.state === 'active' ? 'Works until' : 'Worked until'}</dt>
            <dd>{day(pass.revokedAt || pass.expiresAt)}</dd>
          </dl>
        </div>
      ) : (
        <p className="ws-card-blurb">No link was sent with this request.</p>
      )}
      <Err>{error}</Err>
      {mayAct ? (
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={Boolean(busy)} onClick={() => act('resend')}>
            {busy === 'resend' ? 'Sending…' : pass ? 'Resend' : 'Send a link'}
          </button>
          {pass && pass.state === 'active' ? (
            <button type="button" className="ws-btn ws-btn--danger ws-btn--small" disabled={Boolean(busy)} onClick={() => act('end')}>
              {busy === 'end' ? 'Ending…' : 'End access'}
            </button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function CreateAccount({ open, request, onClose, onDone }) {
  const [state, setState] = useState('');
  const [apps, setApps] = useState(() => new Set(request.apps));
  const [trialDays, setTrialDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setApps(new Set(request.apps));
    setError('');
  }, [open, request.apps]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await opsCreateDemoAccount(request.id, { state, apps: APPS.map(([k]) => k).filter((k) => apps.has(k)), trialDays: Number(trialDays) });
      notify.success(r.created ? `Account made. ${r.owner?.email} has the set-password email.` : 'This account was already made.');
      onDone();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title="Create account"
      description={`${request.company}, owned by ${request.name} (${request.email}). They get an email with a link to set their password. You will be asked for an authenticator code.`}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ops-demo-create" className="ws-btn ws-btn--primary" disabled={busy || !state || !apps.size}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="ops-demo-create" className="grid gap-5" onSubmit={submit}>
        <Err>{error}</Err>
        <div className="grid gap-1">
          <label htmlFor="ops-demo-state" className="text-sm font-medium">State of the head office</label>
          <select id="ops-demo-state" className="ui-select" value={state} onChange={(e) => setState(e.target.value)} required aria-describedby="ops-demo-state-hint">
            <option value="">Choose</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span id="ops-demo-state-hint" className="ws-card-blurb">They said {request.city}. The state decides CGST and SGST or IGST on every invoice.</span>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Apps</legend>
          {APPS.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={apps.has(k)} onChange={() => setApps((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} /> {label}
              {request.apps.includes(k) ? <span className="ws-item-sub"> · asked for</span> : null}
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Trial length, days</span>
          <input className="ui-input ui-num" style={{ maxWidth: 128 }} type="number" min={1} max={90} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
        </label>
        <p className="ws-card-blurb">
          {apps.size ? `They will open ${appName(request.apps.find((k) => apps.has(k)) || APPS.map(([k]) => k).find((k) => apps.has(k)))} first. ` : 'Tick at least one app. '}
          No payment is taken.
        </p>
      </form>
    </WsDrawer>
  );
}

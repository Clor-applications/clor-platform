import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { PageHead, Panel, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { opsPostStatus, opsRemoveStatus, opsStatusPosts, opsUpdateStatus } from './api';
import { Empty, Err, Loading, Tabs, may, when } from './kit';

/**
 * Status page (server: routes/opsStatus.ts). clor.in/status checks CLOR's
 * databases by itself; what it cannot know — e-invoices failing at the
 * government portal, Payroll down tonight for an upgrade — Support posts here,
 * updates as it goes, and resolves. Each post asks for the authenticator code
 * and is audited.
 */
export const PART_NAMES = { platform: 'Sign-in and Workspace', accounting: 'Books', people: 'People and Attendance', payroll: 'Payroll' };
const IMPACT = { MINOR: ['Minor', 'ws-pill'], MAJOR: ['Major', 'ws-pill ws-pill--warn'], OUTAGE: ['Down', 'ws-pill ws-pill--danger'] };
export const STATE_WORD = {
  INVESTIGATING: 'Looking into it',
  IDENTIFIED: 'Cause found',
  MONITORING: 'Fixed, watching',
  RESOLVED: 'Resolved',
  SCHEDULED: 'Planned',
  IN_PROGRESS: 'Under way',
  COMPLETED: 'Done',
};
const NEXT = {
  INCIDENT: ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'],
  MAINTENANCE: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'],
};
const partsWords = (parts) => (parts?.length ? parts.map((p) => PART_NAMES[p] || p).join(', ') : 'All of CLOR');
const toIso = (v) => (v ? new Date(v).toISOString() : undefined);

function Field({ id, label, hint, children }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="ui-label">{label}</label>
      {children}
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </div>
  );
}

function NewPost({ onClose, onSaved }) {
  const [kind, setKind] = useState('INCIDENT');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [parts, setParts] = useState([]);
  const [impact, setImpact] = useState('MINOR');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (p) => setParts((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const maintenance = kind === 'MAINTENANCE';
  const ready = title.trim().length >= 4 && body.trim().length >= 10 && (!maintenance || (startsAt && endsAt));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await opsPostStatus({ kind, title: title.trim(), body: body.trim(), parts, impact, startsAt: toIso(startsAt), endsAt: toIso(endsAt) || null });
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title="Post on the status page"
      description="It shows on clor.in/status as soon as you post it."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || !ready} onClick={save}>{busy ? 'Posting…' : 'Post'}</button>
        </>
      }
    >
      <div className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Kind</legend>
          {[['INCIDENT', 'Something is not working'], ['MAINTENANCE', 'Planned maintenance']].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="st-kind" checked={kind === k} onChange={() => setKind(k)} /> {label}
            </label>
          ))}
        </fieldset>
        <Field id="st-title" label="Title" hint="What customers notice, in a few words.">
          <input id="st-title" className="ui-input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={maintenance ? 'Payroll upgrade' : 'E-invoices are not going through'} />
        </Field>
        <Field id="st-body" label="First update" hint="What is happening and what people should do meanwhile.">
          <textarea id="st-body" className="ui-input" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Which parts</legend>
          <span className="ui-caption">Tick none if it touches all of CLOR.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {Object.entries(PART_NAMES).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={parts.includes(k)} onChange={() => toggle(k)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">How bad</legend>
          {[['MINOR', 'Minor: slow, or one feature'], ['MAJOR', 'Major: many people cannot work'], ['OUTAGE', 'Down: the part does not open']].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="st-impact" checked={impact === k} onChange={() => setImpact(k)} /> {label}
            </label>
          ))}
        </fieldset>
        {maintenance ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="st-start" label="Starts">
              <input id="st-start" type="datetime-local" className="ui-input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field id="st-end" label="Ends">
              <input id="st-end" type="datetime-local" className="ui-input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

function AddUpdate({ post, onClose, onSaved }) {
  const states = NEXT[post.kind];
  const [state, setState] = useState(states[Math.min(states.indexOf(post.state) + 1, states.length - 1)]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await opsUpdateStatus(post.id, { state, body: body.trim() });
      onSaved(state);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <WsDrawer
      open
      onClose={onClose}
      title="Add an update"
      description={post.title}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="ws-btn ws-btn--primary" disabled={busy || body.trim().length < 4} onClick={save}>{busy ? 'Posting…' : 'Post update'}</button>
        </>
      }
    >
      <div className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Where it stands</legend>
          {states.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="st-state" checked={state === k} onChange={() => setState(k)} /> {STATE_WORD[k]}
              {k === states[states.length - 1] ? <span className="ws-item-sub">· closes the post</span> : null}
            </label>
          ))}
        </fieldset>
        <Field id="st-update" label="Update">
          <textarea id="st-update" className="ui-input" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Err>{error}</Err>
      </div>
    </WsDrawer>
  );
}

function PostItem({ p, canWrite, onUpdate, onRemove }) {
  return (
    <li>
      <div className="ws-item ws-item--wrap">
        <span className="ws-item-text">
          <span className="ws-item-title">
            {p.title} <span className={IMPACT[p.impact]?.[1]}>{IMPACT[p.impact]?.[0]}</span> <span className="ws-pill ws-pill--off">{STATE_WORD[p.state] || p.state}</span>
          </span>
          <span className="ws-item-sub">
            {p.kind === 'MAINTENANCE' ? `Planned ${when(p.startsAt)} to ${when(p.endsAt)}` : `Since ${when(p.startsAt)}`} · {partsWords(p.parts)}
            {p.resolvedAt ? ` · closed ${when(p.resolvedAt)}` : ''}
          </span>
          <ol className="grid gap-1 mt-2">
            {p.updates.map((u) => (
              <li key={u.id} className="ws-item-sub" style={{ whiteSpace: 'normal' }}>
                <strong>{STATE_WORD[u.state] || u.state}</strong> · {when(u.createdAt)} — {u.body}
              </li>
            ))}
          </ol>
        </span>
        {canWrite && !p.resolvedAt ? (
          <span className="inline-flex gap-1">
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => onUpdate(p)}>Add update</button>
            <button type="button" className="ws-btn ws-btn--danger-quiet ws-btn--small" onClick={() => onRemove(p)}>Remove</button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function StatusPage({ me }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('open');
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [updating, setUpdating] = useState(null);
  const canWrite = may(me?.role, 'SUPPORT');
  const load = useCallback(() => {
    opsStatusPosts().then((r) => (setD(r), setError(''))).catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const remove = async (p) => {
    if (!window.confirm(`Remove “${p.title}” from the status page? Use this only for a post made by mistake.`)) return;
    try {
      await opsRemoveStatus(p.id);
      notify.success('Removed from the status page.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not removed.'));
    }
  };

  const rows = d ? (tab === 'open' ? d.open : d.resolved) : [];
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['System', 'Status page']}
          title="Status page"
          description="Posts on clor.in/status, next to the automatic checks: problems CLOR is fixing, and planned maintenance."
          actions={
            <span className="inline-flex gap-2">
              <a className="ws-btn ws-btn--quiet" href="https://clor.in/status" target="_blank" rel="noreferrer">Open clor.in/status</a>
              {canWrite ? (
                <button type="button" className="ws-btn ws-btn--primary" onClick={() => setMaking(true)}>New post</button>
              ) : null}
            </span>
          }
        />
        <Tabs label="Which posts" value={tab} onChange={setTab} tabs={[['open', `Open${d ? ` (${d.open.length})` : ''}`], ['resolved', 'Closed']]} />
        <Err>{error}</Err>
        {!d ? (
          error ? null : <Loading />
        ) : !rows.length ? (
          <Empty>{tab === 'open' ? 'Nothing open. The status page shows only its automatic checks.' : 'Nothing closed yet.'}</Empty>
        ) : (
          <Panel title={tab === 'open' ? 'Showing now or planned' : 'Closed, newest first'}>
            <ul className="ws-list">
              {rows.map((p) => (
                <PostItem key={p.id} p={p} canWrite={canWrite} onUpdate={setUpdating} onRemove={remove} />
              ))}
            </ul>
          </Panel>
        )}
        {making ? (
          <NewPost
            onClose={() => setMaking(false)}
            onSaved={() => {
              setMaking(false);
              setTab('open');
              notify.success('Posted. It shows on clor.in/status now.');
              load();
            }}
          />
        ) : null}
        {updating ? (
          <AddUpdate
            post={updating}
            onClose={() => setUpdating(null)}
            onSaved={(state) => {
              setUpdating(null);
              notify.success(NEXT[updating.kind].at(-1) === state ? 'Closed. The status page shows it as resolved for a week.' : 'Update posted.');
              load();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import Modal from '@ui/components/ui/Modal';
import { notify } from '@ui/components/ui/notify';
import {
  changeOutsideAccess,
  endOutsideAccess,
  listOutsideAccess,
  pauseOutsideAccess,
  resumeOutsideAccess,
} from '@platform/admin/outsideAccess';
import { APP_LABEL, STATUS, actionsFor, appsText } from './outsideAccessModel';
import { requestOpenScreen } from '@platform/context';
import { Plus } from '@ui/components/ui/lineIcons';
import { Avatar, ICON, PageHead, Stat, StatusPill } from './wsKit';
import './workspace.css';
import './ws-access.css';

/**
 * Workspace → Outside access (GAP-006).
 *
 * People from other accounts this company has let in — its accountant, an
 * auditor — with what each may use here, until when, and who granted it.
 * Pausing, changing or ending it takes effect on their next request. They are
 * added under Users; nobody changes their own access.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
const DAY = 86_400_000;
const isoDay = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const ACTION_LABEL = { pause: 'Pause', resume: 'Resume', change: 'Change', end: 'End' };

/** Apps and end date, or a reason for pausing or ending. */
function Change({ action, row, apps, onDone, onClose }) {
  const [chosen, setChosen] = useState(row.apps || apps);
  const [until, setUntil] = useState(isoDay(row.expiresAt));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const name = row.person.name || row.person.email;
  const toggle = (a) => setChosen((c) => (c.includes(a) ? c.filter((x) => x !== a) : [...c, a]));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (action === 'change') {
        await changeOutsideAccess(row.id, { apps: chosen.length === apps.length ? null : chosen, expiresAt: until ? new Date(`${until}T23:59:59`).toISOString() : null });
        onDone('Changed.');
      }
      if (action === 'pause') {
        await pauseOutsideAccess(row.id, reason || null);
        onDone('Paused.');
      }
      if (action === 'end') {
        await endOutsideAccess(row.id, reason || null);
        onDone('Ended.');
      }
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  const words = {
    change: 'Takes effect on their next request.',
    pause: 'They are stopped at once and can be resumed.',
    end: 'Their access stops now.',
  }[action];
  return (
    <Modal title={`${ACTION_LABEL[action]} access for ${name}`} onClose={onClose} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="ws space-y-3" style={{ minHeight: 0, padding: 0, background: 'none' }}>
        <p className="text-sm">{words}</p>
        {action === 'change' ? (
          <>
            <fieldset>
              <legend className="ui-label">May use</legend>
              {apps.map((a) => (
                <label key={a} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" className="ui-checkbox" checked={chosen.includes(a)} onChange={() => toggle(a)} /> {APP_LABEL[a] || a}
                </label>
              ))}
              <p className="ui-caption">Their role decides what they can do in each app.</p>
            </fieldset>
            <label className="block"><span className="ui-label">Until</span>
              <input type="date" className="ui-input" min={isoDay(Date.now() + DAY)} value={until} onChange={(e) => setUntil(e.target.value)} />
              <span className="ui-caption block">Blank: until somebody ends it.</span>
            </label>
          </>
        ) : (
          <label className="block"><span className="ui-label">Why</span><input className="ui-input w-full" maxLength={150} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — kept in the history" /></label>
        )}
        <div className="flex gap-2">
          <button type="submit" className={`ws-btn ${action === 'end' ? 'ws-btn--danger' : 'ws-btn--primary'}`} disabled={busy || (action === 'change' && !chosen.length)}>{busy ? 'Working…' : ACTION_LABEL[action]}</button>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** The pill for a state, in the Workspace's words and tones. */
const PILL = { 'ui-pill-pos': 'ok', 'ui-pill-warn': 'warn', 'ui-pill-neutral': 'neutral' };

/** How outside access works, beside the grants (CLOR-04). */
const HOW = [
  ['Scoped', 'Each grant is for this company only, and names the apps the firm may use. Their role decides what they can do there.'],
  ['Time-limited', 'Give a grant an end date and it stops on that day. Ending soon shows above, so you can extend it.'],
  ['On the record', 'Everything they do is in your audit log under their own name, never yours.'],
  ['Yours to end', 'Pause, change or end it at any time. Their history stays; their access does not.'],
];
const SOON = 30 * DAY;

export default function OutsideAccess() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [change, setChange] = useState(null);

  const load = useCallback(() => {
    listOutsideAccess()
      .then((r) => {
        /* "Ending soon" is measured from when the list was read, not on every render. */
        setData({ ...r, readAt: Date.now() });
        setFailed('');
      })
      .catch((e) => setFailed(String(e?.message || 'Could not load outside access.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (row, action) => {
    if (action === 'resume') {
      await resumeOutsideAccess(row.id).then(() => notify.success('Resumed.')).catch((e) => notify.error(String(e?.message || 'Not done.')));
      return load();
    }
    return setChange({ action, row });
  };
  const rows = data?.outsideAccess || [];
  const count = (state) => rows.filter((r) => r.effective === state).length;
  const endingSoon = rows.filter((r) => r.effective === 'ACTIVE' && r.expiresAt && Date.parse(r.expiresAt) - data.readAt < SOON).length;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Outside access']}
          title="Accountant access"
          description="Let your CA firm or auditor work in this company with limited, time-bound access, separate from your staff."
          actions={
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => requestOpenScreen('users')}>
              <Plus size={16} aria-hidden="true" /> Add accountant
            </button>
          }
        />

        {data ? (
          <div className="ws-stats">
            <Stat icon={ICON.team} label="With access" value={count('ACTIVE')} note="From other accounts, active now" />
            <Stat icon={ICON.history} tone={endingSoon ? 'warn' : null} label="Ending within 30 days" value={endingSoon} note={endingSoon ? 'Change the date to extend' : 'Nothing ends soon'} />
            <Stat icon={ICON.security} label="On pause" value={count('SUSPENDED')} note="Stopped, and can be resumed" />
          </div>
        ) : null}

        <div className="ws-layout">
          <section className="ws-flat ws-main" aria-labelledby="ws-grants-title">
            <h2 id="ws-grants-title" className="ws-h2">Grants</h2>
        {failed ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            <span>{failed}</span>
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={load}>Try again</button>
          </div>
        ) : !data ? (
          <p className="ws-card-blurb">Loading outside access…</p>
        ) : rows.length ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">People from other accounts with access to this company</caption>
              <thead>
                <tr>
                  <th scope="col">Firm</th>
                  <th scope="col">Can use</th>
                  <th scope="col">Status</th>
                  <th scope="col">Approved by</th>
                  <th scope="col" className="num">Ends</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [word, tone] = STATUS[r.effective] || ['—', 'ui-pill-neutral'];
                  const name = r.person.name || r.person.email;
                  const sub = [r.person.email !== name ? r.person.email : null, r.from?.name ? `from ${r.from.name}` : null].filter(Boolean).join(' · ');
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="inline-flex items-center gap-3">
                          <Avatar name={r.from?.name || name} />
                          <span className="grid" style={{ minWidth: 0 }}>
                            <span className="ws-cell-main">{name}</span>
                            {sub ? <span className="ws-cell-sub">{sub}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>{appsText(r.apps)}</td>
                      <td>
                        <StatusPill tone={PILL[tone] || 'neutral'}>{word}</StatusPill>
                        {r.endedAt && r.status !== 'ACTIVE' ? <div className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{`${r.endedBy || 'Someone'}, ${dateOf(r.endedAt)}${r.reason ? ` — ${r.reason}` : ''}`}</div> : null}
                      </td>
                      <td>
                        <span className="block">{r.grantedBy || 'Carried over'}</span>
                        <span className="ws-cell-sub">{dateOf(r.grantedAt)}</span>
                      </td>
                      <td className="num">{r.expiresAt ? dateOf(r.expiresAt) : 'No end'}</td>
                      <td className="num">
                        <div className="inline-flex justify-end gap-1">
                          {actionsFor(r).map((a) => (
                            <button key={a} type="button" className={`ws-btn ws-btn--small ${a === 'end' ? 'ws-btn--danger-quiet' : 'ws-btn--quiet'}`} aria-label={`${ACTION_LABEL[a]} access for ${name}`} onClick={() => act(r, a)}>
                              {ACTION_LABEL[a]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ws-card-blurb">Nobody from outside. Add an accountant or auditor under Users.</p>
        )}
          </section>
          <aside className="ws-flat ws-side" aria-labelledby="ws-how-title">
            <h2 id="ws-how-title" className="ws-h2">How it works</h2>
            <ol className="ws-steps-side">
              {HOW.map(([title, text], i) => (
                <li key={title}>
                  <span className="ws-step-num" aria-hidden="true">{i + 1}</span>
                  <span>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>

      {change ? (
        <Change
          action={change.action}
          row={change.row}
          apps={data?.apps || Object.keys(APP_LABEL)}
          onClose={() => setChange(null)}
          onDone={(message) => {
            setChange(null);
            notify.success(message);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

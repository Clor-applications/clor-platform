import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
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
    end: 'They are stopped for good. Their roles and the history stay; adding them again under Users grants it afresh.',
  }[action];
  return (
    <Modal title={`${ACTION_LABEL[action]} access for ${name}`} onClose={onClose} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="space-y-3">
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
              <p className="ui-caption">An app the company does not have stays closed; their role still decides what they do inside each.</p>
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
          <button type="submit" className={`ui-btn ${action === 'end' ? 'ui-btn-danger' : 'ui-btn-primary'}`} disabled={busy || (action === 'change' && !chosen.length)}>{busy ? 'Working…' : ACTION_LABEL[action]}</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function OutsideAccess() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [change, setChange] = useState(null);

  const load = useCallback(() => {
    listOutsideAccess()
      .then((r) => {
        setData(r);
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

  return (
    <div className="space-y-3">
      <PageHeader entity="settings" title="Outside access" description="People from other accounts this company has let in — its accountant, an auditor — what each may use, and until when." />

      {failed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert"><span>{failed}</span> <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={load}>Try again</button></div>
      ) : !data ? (
        <SkeletonCard lines={3} />
      ) : rows.length ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-col-grow">Person</th>
                <th scope="col">May use</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col" className="ui-col-date">Until</th>
                <th scope="col">Granted by</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.map((r) => {
                const [word, tone] = STATUS[r.effective] || ['—', 'ui-pill-neutral'];
                const name = r.person.name || r.person.email;
                return (
                  <tr key={r.id}>
                    <td className="ui-col-entity">
                      <div>{name}</div>
                      <div className="ui-caption">{[r.person.email !== name ? r.person.email : null, r.from?.name ? `from ${r.from.name}` : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{appsText(r.apps)}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${tone}`}>{word}</span>
                      {r.endedAt && r.status !== 'ACTIVE' ? <div className="ui-caption">{`${r.endedBy || 'Someone'}, ${dateOf(r.endedAt)}${r.reason ? ` — ${r.reason}` : ''}`}</div> : null}
                    </td>
                    <td className="ui-col-date whitespace-nowrap">{r.expiresAt ? dateOf(r.expiresAt) : 'No end'}</td>
                    <td>
                      <div>{r.grantedBy || 'Carried over'}</div>
                      <div className="ui-caption">{dateOf(r.grantedAt)}</div>
                    </td>
                    <td className="ui-col-meta whitespace-nowrap text-end">
                      <div className="inline-flex justify-end gap-1">
                        {actionsFor(r).map((a) => (
                          <button key={a} type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`${ACTION_LABEL[a]} access for ${name}`} onClick={() => act(r, a)}>{ACTION_LABEL[a]}</button>
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
        <div className="px-4 py-10 text-center">
          <UserCheck size={20} aria-hidden="true" className="ui-muted mx-auto" />
          <p className="mt-2 text-sm">Nobody from another account has access. Add your accountant or auditor under Users with their e-mail; they appear here.</p>
        </div>
      )}

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

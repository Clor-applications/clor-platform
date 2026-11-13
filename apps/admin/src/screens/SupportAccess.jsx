import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { approveSupportGrant, endSupportGrant, listSupportGrants } from '@platform/admin/supportGrants';
import { ICON, PageHead, Stat } from './wsKit';
import './workspace.css';

/**
 * Workspace → CLOR support access (docs/workspace/SUPPORT_GRANTS.md).
 *
 * CLOR staff open this company only when somebody here says yes. A request
 * waits on this screen with the person's reason; approving lets that one
 * person in for the hours chosen, to read only unless they asked to change
 * something and the approver agreed. Ending it stops them on their next
 * request. What they opened is in the audit trail.
 */

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const HOURS = [4, 8, 24, 48, 72];
const SCOPE = { READ_ONLY: 'Read only', READ_WRITE: 'Read and change' };
const STATE = {
  PENDING: ['Waiting for you', 'ws-pill ws-pill--role'],
  ACTIVE: ['Open', 'ws-pill ws-pill--ok'],
  EXPIRED: ['Ran out', 'ws-pill ws-pill--off'],
  ENDED: ['Ended', 'ws-pill ws-pill--off'],
  REVOKED: ['Refused', 'ws-pill ws-pill--off'],
};

/** One request, with the choice of how long and how much. */
function Request({ g, defaultHours, onDone }) {
  const [hours, setHours] = useState(defaultHours);
  const [scope, setScope] = useState(g.scope);
  const [busy, setBusy] = useState('');
  const run = async (what) => {
    setBusy(what);
    try {
      if (what === 'approve') {
        await approveSupportGrant(g.id, { hours, scope });
        notify.success(`${g.staff} can look for ${hours} hours.`);
      } else {
        await endSupportGrant(g.id, null);
        notify.success('Refused.');
      }
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  return (
    <li className="ws-sg-request">
      <div className="ws-sg-who">
        <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.chat size={14} /></span>
        <span className="ws-item-text">
          <span className="ws-item-title">{g.staff}, CLOR support</span>
          <span className="ws-item-sub">Asked {when(g.requestedAt)}{g.ticketRef ? ` · ticket ${g.ticketRef}` : ''}</span>
        </span>
      </div>
      <p className="ws-sg-reason">{g.reason}</p>
      <div className="ws-sg-choices">
        <label>
          <span className="ui-label">For</span>
          <select className="ui-input" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label={`How long ${g.staff} may look`}>
            {HOURS.map((h) => (
              <option key={h} value={h}>{h} hours</option>
            ))}
          </select>
        </label>
        {g.scope === 'READ_WRITE' ? (
          <fieldset>
            <legend className="ui-label">May</legend>
            <label className="ws-sg-radio"><input type="radio" name={`scope-${g.id}`} checked={scope === 'READ_ONLY'} onChange={() => setScope('READ_ONLY')} /> Read only</label>
            <label className="ws-sg-radio"><input type="radio" name={`scope-${g.id}`} checked={scope === 'READ_WRITE'} onChange={() => setScope('READ_WRITE')} /> Read and change</label>
          </fieldset>
        ) : (
          <p className="ws-item-sub">To read only</p>
        )}
        <div className="ws-sg-actions">
          <button type="button" className="ws-btn ws-btn--primary" disabled={Boolean(busy)} onClick={() => run('approve')}>{busy === 'approve' ? 'Letting in…' : 'Let them in'}</button>
          <button type="button" className="ws-btn ws-btn--quiet" disabled={Boolean(busy)} onClick={() => run('refuse')}>{busy === 'refuse' ? 'Refusing…' : 'Refuse'}</button>
        </div>
      </div>
    </li>
  );
}

export default function SupportAccess() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');

  const load = useCallback(() => {
    listSupportGrants()
      .then((r) => {
        setData(r);
        setFailed('');
      })
      .catch((e) => setFailed(String(e?.message || 'Could not load CLOR support access.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const end = async (g) => {
    try {
      await endSupportGrant(g.id, null);
      notify.success(`${g.staff} can no longer look.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
    load();
  };

  const grants = data?.grants || [];
  const waiting = grants.filter((g) => g.state === 'PENDING');
  const open = grants.filter((g) => g.state === 'ACTIVE');
  const past = grants.filter((g) => g.state !== 'PENDING' && g.state !== 'ACTIVE');

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Access', 'CLOR support access']} title="CLOR support access" />

        <p className="ws-card-blurb ws-sg-rule">
          CLOR staff see this company only when somebody here lets them in, for the hours chosen. Salary and payslips, employee
          documents and bank details stay closed to them even then. Everything they open is in the audit trail.
        </p>

        {data ? (
          <div className="ws-stats">
            <Stat icon={ICON.inbox} tone={waiting.length ? 'warn' : null} label="Waiting for an answer" value={waiting.length} note={waiting.length ? 'Nothing opens until you answer' : 'Nobody is asking'} />
            <Stat icon={ICON.secure} label="Open now" value={open.length} note={open.length ? 'End any of them at once' : 'Nobody from CLOR can look'} />
          </div>
        ) : null}

        {failed ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            <span>{failed}</span>
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={load}>Try again</button>
          </div>
        ) : !data ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : (
          <>
            {waiting.length ? (
              <section className="ws-section" aria-labelledby="sg-waiting">
                <h2 id="sg-waiting" className="ws-h2">Asking to look</h2>
                <ul className="ws-sg-list">
                  {waiting.map((g) => (
                    <Request key={g.id} g={g} defaultHours={data.defaultHours || 24} onDone={load} />
                  ))}
                </ul>
              </section>
            ) : null}

            {open.length || past.length ? (
              <section className="ws-section" aria-labelledby="sg-history">
                <h2 id="sg-history" className="ws-h2">{open.length ? 'Open and past' : 'Past'}</h2>
                <div className="ws-table-wrap">
                  <table className="ws-table">
                    <caption className="sr-only">CLOR staff let into this company</caption>
                    <thead>
                      <tr>
                        <th scope="col">Who and why</th>
                        <th scope="col">May</th>
                        <th scope="col">Status</th>
                        <th scope="col">Until</th>
                        <th scope="col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...open, ...past].map((g) => {
                        const [word, pill] = STATE[g.state] || ['—', 'ws-pill'];
                        return (
                          <tr key={g.id}>
                            <td>
                              <span className="ws-item-text">
                                <span className="ws-item-title">{g.staff}</span>
                                <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{g.reason}</span>
                              </span>
                            </td>
                            <td>{SCOPE[g.scope] || g.scope}</td>
                            <td><span className={pill}>{word}</span></td>
                            <td>{g.state === 'ACTIVE' || g.state === 'EXPIRED' ? when(g.expiresAt) : g.endedAt ? when(g.endedAt) : '—'}</td>
                            <td className="num">
                              {g.state === 'ACTIVE' ? (
                                <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" style={{ color: 'rgb(var(--ws-danger))' }} aria-label={`End access for ${g.staff}`} onClick={() => end(g)}>
                                  End now
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {!grants.length ? (
              <div className="ws-setup">
                <span className="ws-tile" aria-hidden="true"><ICON.chat size={20} /></span>
                <p className="ws-card-blurb">CLOR support has never asked to look. When they do, the request waits here for you.</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

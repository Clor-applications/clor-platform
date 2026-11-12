import React, { useCallback, useEffect, useState } from 'react';

import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, when } from './kit';
import { opsHealth, opsRequestLookup } from './api';

/**
 * System health (operator console, Ops P0): whether the background workers
 * are running, what failed in the last day, and the request-ID lookup — the
 * code a customer reads off an error page, turned into a link to the logs.
 * Read only. Fixing a stopped worker or a deploy stays with engineering.
 */
const OVERALL = {
  ok: ['All working', 'ws-pill--ok', 'Every background job ran on time and nothing is failing.'],
  attention: ['Needs a look', 'ws-pill--warn', 'Something is late or failing below. Customers may not notice yet.'],
  down: ['Something has stopped', 'ws-pill--danger', 'A background job is failing. Tell engineering with the job name and its error.'],
};
const WORKER_STATE = { ok: ['On time', 'ws-pill--ok'], late: ['Late', 'ws-pill--warn'], failing: ['Failing', 'ws-pill--danger'] };

/* Job names are code ("people.document-reminders"); staff read words. */
export const workerName = (w) =>
  String(w)
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(hr|sso|scim|upi|gst)\b/gi, (w) => w.toUpperCase());

const gapWords = (m) => (m == null ? 'not enough runs yet' : m < 1 ? 'several times a minute' : m >= 1440 ? `about every ${Math.round(m / 1440)} ${Math.round(m / 1440) === 1 ? 'day' : 'days'}` : m >= 60 ? `about every ${Math.round(m / 60)} ${Math.round(m / 60) === 1 ? 'hour' : 'hours'}` : `about every ${m} min`);

export function Health({ go, request = '' }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    opsHealth().then(setD).catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const [word, cls, says] = OVERALL[d?.overall] || [];
  const troubled = d ? d.workers.filter((w) => w.state !== 'ok') : [];
  const fine = d ? d.workers.filter((w) => w.state === 'ok') : [];
  return (
    <>
      <PageHead
        crumbs={['System health']}
        title="System health"
        meta={d ? <>Checked {when(d.at)}</> : null}
        actions={
          <button type="button" className="ws-btn ws-btn--quiet" onClick={() => { setD(null); setError(''); load(); }}>
            Check again
          </button>
        }
      />
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : (
        <>
          <p className="ws-notice" role="status">
            <span className={`ws-pill ${cls}`}>{word}</span> {says}
          </p>
          <Panel title="In the last day">
            <ul className="ws-list">
              {d.signals.map((s) => (
                <li key={s.key}>
                  <div className="ws-item">
                    <span className="ws-item-text">
                      <span className="ws-item-title">{s.label}</span>
                    </span>
                    {s.screen && s.count ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => go('emailLog', { status: 'FAILED' })}>
                        Open
                      </button>
                    ) : null}
                    <span className={`tabular-nums ops-count${s.count ? ' ops-count--bad' : ''}`}>{s.count}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Background jobs">
            {d.workers.length ? (
              <>
                {troubled.length ? <WorkerList workers={troubled} /> : <p className="ws-card-blurb">Every background job ran on time.</p>}
                {fine.length ? (
                  <details className="ops-more">
                    <summary>{troubled.length ? `Show the ${fine.length} on time` : `Show all ${fine.length}`}</summary>
                    <WorkerList workers={fine} />
                  </details>
                ) : null}
              </>
            ) : (
              <p className="ws-card-blurb">No background job has run in the last week. On a new server that is expected for a few minutes; after that, tell engineering.</p>
            )}
          </Panel>
        </>
      )}
      <RequestLookup initial={request} />
    </>
  );
}

function WorkerList({ workers }) {
  return (
    <ul className="ws-list">
      {workers.map((w) => {
        const [ww, wc] = WORKER_STATE[w.state];
        return (
          <li key={w.worker}>
            <div className="ws-item">
              <span className="ws-item-text">
                <span className="ws-item-title">{workerName(w.worker)}</span>
                <span className="ws-item-sub">
                  Last ran {ago(w.lastStartedAt)}, {gapWords(w.usualGapMinutes)}
                  {w.failedToday ? ` · failed ${w.failedToday} ${w.failedToday === 1 ? 'time' : 'times'} today` : ''}
                  {w.state === 'failing' && w.lastError ? ` · ${w.lastError}` : ''}
                </span>
              </span>
              <span className={`ws-pill ${wc}`}>{ww}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A customer reads out the code under an error; this opens what the server logged for it. */
export function RequestLookup({ initial = '' }) {
  const [id, setId] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await opsRequestLookup(id.trim());
      window.open(r.logsUrl, '_blank', 'noopener');
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Look up a request ID">
      <form className="grid gap-3" onSubmit={open}>
        <p className="ws-card-blurb">Every error a customer sees shows a request ID. Paste it here to open what the server recorded for it in Google Cloud logs (you sign in there with your CLOR Google account).</p>
        <div className="flex flex-wrap gap-2">
          <input className="ui-input ui-mono" style={{ flex: '1 1 18rem' }} aria-label="Request ID" placeholder="e.g. 6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b" value={id} onChange={(e) => { setId(e.target.value); setError(''); }} />
          <button type="submit" className="ws-btn ws-btn--quiet" disabled={busy || id.trim().length < 8}>Open the logs</button>
        </div>
        <Err>{error}</Err>
      </form>
    </Panel>
  );
}

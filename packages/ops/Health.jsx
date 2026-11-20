import React, { useCallback, useEffect, useState } from 'react';

import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, day, when, errorWords } from './kit';
import { opsBooksCheck, opsHealth, opsRequestLookup } from './api';

/**
 * Jobs & workers (operator console, Platform; Ops P0): whether the background workers
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
    opsHealth().then(setD).catch((e) => setError(errorWords(e, 'load the background jobs')));
  }, []);
  useEffect(load, [load]);

  const [word, cls, says] = OVERALL[d?.overall] || [];
  const troubled = d ? d.workers.filter((w) => w.state !== 'ok') : [];
  const fine = d ? d.workers.filter((w) => w.state === 'ok') : [];
  return (
    <>
      <PageHead
        title="Background jobs"
        description="Work CLOR does in the background: postings, e-invoices, reader punches, messages and renewals. If a job has stopped, tell engineering."
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
          <section className="ops-section" aria-labelledby="ops-queues">
            <h2 id="ops-queues" className="ops-h2">Background jobs</h2>
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
          </section>
          <section className="ops-section" aria-labelledby="ops-signals">
            <h2 id="ops-signals" className="ops-h2">Failed in the last day</h2>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">What failed in the last day</caption>
                <thead>
                  <tr>
                    <th>What</th>
                    <th className="num">Count</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {d.signals.map((s) => (
                    <tr key={s.key}>
                      <td style={{ whiteSpace: 'normal' }}>{s.label}</td>
                      <td className={`num ops-count${s.count ? ' ops-count--bad' : ''}`}>{s.count}</td>
                      <td className="num">
                        {s.screen && s.count ? (
                          <button type="button" className="ops-link" onClick={() => go('emailLog', { status: 'FAILED' })}>
                            See failed emails
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <BooksCheck openAccount={(id) => go('customers', {}, id)} />
      <RequestLookup initial={request} />
    </>
  );
}

function WorkerList({ workers }) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <caption className="sr-only">Background jobs</caption>
        <thead>
          <tr>
            <th>Job</th>
            <th>State</th>
            <th className="num">Failed, last 24 hours</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => {
            const [ww, wc] = WORKER_STATE[w.state];
            return (
              <tr key={w.worker}>
                <td style={{ whiteSpace: 'normal' }}>
                  <span className="ops-strong">{workerName(w.worker)}</span>
                  <div className="ws-item-sub">
                    Last ran {ago(w.lastStartedAt)}, {gapWords(w.usualGapMinutes)}
                    {w.failedToday ? ` · failed ${w.failedToday} ${w.failedToday === 1 ? 'time' : 'times'} today` : ''}
                    {w.state === 'failing' && w.lastError ? ` · ${w.lastError}` : ''}
                  </div>
                </td>
                <td>
                  <span className={`ws-pill ${wc}`}>{ww}</span>
                </td>
                <td className={`num${w.failedToday ? ' ops-count--bad' : ''}`}>{w.failedToday}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DOC_KIND = { BILL: ['bill', 'bills'], EXPENSE: ['expense', 'expenses'], CREDIT_NOTE: ['credit note', 'credit notes'], DEBIT_NOTE: ['debit note', 'debit notes'], INVOICE: ['invoice', 'invoices'] };
export const kindsText = (kinds = {}) =>
  Object.entries(kinds)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${(DOC_KIND[k] || [k.toLowerCase(), k.toLowerCase()])[n === 1 ? 0 : 1]}`)
    .join(', ');

/**
 * Books to check: companies where a bill, expense, note or invoice stands in
 * the ledger more than once. A fault fixed on 17 Nov 2026 put a document's
 * first amount back when it was changed a second time. The list says which
 * company and how many documents, never which document or how much: what to
 * post to put the books right is for the customer's accountant and engineering.
 */
export function BooksCheck({ openAccount }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    opsBooksCheck().then(setD).catch((e) => setError(errorWords(e, 'run the Books check')));
  }, []);
  useEffect(load, [load]);
  return (
    <section className="ops-section" aria-labelledby="ops-books-check">
      <h2 id="ops-books-check" className="ops-h2">Books to check</h2>
      <p className="ws-card-blurb">
        Until 17 Nov 2026, changing a bill, expense, credit note, debit note or invoice a second time could put its first amount back in the ledger. New changes are safe. These companies still carry such amounts; tell engineering before the customer closes a period or files a return.
      </p>
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : d.companies.length ? (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Companies with documents posted more than once</caption>
            <thead>
              <tr>
                <th>Company</th>
                <th>Documents</th>
                <th>Posted between</th>
                <th><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {d.companies.map((c) => (
                <tr key={c.orgId}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <span className="ops-strong">{c.company}</span>
                    {c.customer && c.customer !== c.company ? <div className="ws-item-sub">{c.customer}</div> : null}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{kindsText(c.kinds)}</td>
                  <td>{c.from === c.to ? day(c.from) : `${day(c.from)} to ${day(c.to)}`}</td>
                  <td className="num">
                    <button type="button" className="ops-link" onClick={() => openAccount(c.accountId)}>
                      Open customer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ws-notice" role="status">
          <span className="ws-pill ws-pill--ok">None found</span> No company has a document posted more than once. Checked {when(d.at)}.
        </p>
      )}
    </section>
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
      setError(errorWords(err, 'open the logs'));
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

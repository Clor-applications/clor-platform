import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { api } from './api';
import { ConfirmDialog, Loading, Notice, PageHead, Pill, ReasonDialog, When, useAction, useLoad } from './kit';

export const MARK = { MIGRATION: 'Database change', WORKFLOW: 'CI workflow', RELEASE: 'Release scripts', ACCESS: 'Sign-in or permissions', BOOKS: 'Books' };
const can = (me, need) => ['VIEWER', 'ENGINEER', 'OWNER'].indexOf(me.role) >= ['VIEWER', 'ENGINEER', 'OWNER'].indexOf(need);
const RUN_TONE = { success: 'ok', failure: 'bad', cancelled: 'none' };
const RUN_WORD = { queued: 'Queued', in_progress: 'Running', waiting: 'Waiting for approval', success: 'Finished', failure: 'Failed', cancelled: 'Cancelled' };
const runWord = (r) => RUN_WORD[r.status === 'completed' ? r.conclusion : r.status] || r.status;

function Steps({ runId }) {
  const [steps, setSteps] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api.runSteps(runId).then((d) => live && setSteps(d.steps), () => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [runId]);
  if (!steps?.length) return null;
  return (
    <ol className="con-run-steps">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} data-state={s.status === 'completed' ? s.conclusion : s.status}>
          <span>{s.name}</span>
          <span className="con-quiet">{s.status === 'completed' ? (s.conclusion === 'success' ? 'Done' : s.conclusion === 'skipped' ? 'Skipped' : 'Failed') : s.status === 'in_progress' ? 'Running' : 'Waiting'}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Releases({ me }) {
  const { data, error, loading, reload } = useLoad(() => api.releases());
  const act = useAction(reload);
  const [ask, setAsk] = useState(null);

  /* While something is running, look again every ten seconds. */
  const moving = data && ['BUSY', 'TESTS_RUNNING'].includes(data.next);
  useEffect(() => {
    if (!moving) return undefined;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [moving, reload]);

  if (!data && loading) return <><PageHead title="Releases" /><Loading /></>;
  if (!data) return <><PageHead title="Releases" /><Notice tone="bad">{error?.message}</Notice></>;

  const engineer = can(me, 'ENGINEER');
  const owner = can(me, 'OWNER');
  const primary =
    data.next === 'TESTS' && engineer ? { label: 'Run full tests', on: () => act.run('tests', api.runTests, 'The full tests have started. They take about 25 minutes.') }
    : data.next === 'STAGE' && engineer ? { label: 'Stage', on: () => act.run('stage', api.stage, 'Staging has started. An owner approves it before anything is built.') }
    : data.next === 'RELEASE' && owner ? { label: 'Release', on: () => setAsk({ kind: 'release' }) }
    : null;
  const running = data.runs.find((r) => r.status !== 'completed');
  const approvable = data.pending.find((p) => p.canApprove);
  const NEXT_NOTE = {
    UNKNOWN: data.github === false ? 'GitHub is not connected to the Console yet, so releases cannot be started from here. Roll back and release from the Mac for now.' : 'GitHub or Google Cloud could not be reached, so no step is offered. Nothing has changed.',
    NOTHING: 'The commit on main is the one that is live. Nothing is waiting.',
    TESTS_RUNNING: 'The full tests are running on this commit.',
    TESTS: 'The full tests have not passed on this commit yet.',
    STAGE: 'Tests have passed. Staging builds this commit and starts it with no customers on it.',
    RELEASE: owner ? 'This commit is staged and answering. Releasing moves customers to it.' : 'This commit is staged. An owner releases it.',
    BUSY: 'A release is running.',
  };

  return (
    <>
      <PageHead title="Releases">
        {primary ? <button type="button" className="ui-btn con-btn-primary" onClick={primary.on} disabled={Boolean(act.busy)}>{primary.label}</button> : null}
      </PageHead>
      {error ? <Notice tone="bad">{error.message}</Notice> : null}
      {act.error ? <Notice tone="bad">{act.error}</Notice> : null}
      {act.done ? <Notice tone="ok">{act.done}</Notice> : null}

      <section className="con-section" aria-labelledby="rel-main">
        <h2 id="rel-main" className="con-h2">On main</h2>
        <dl className="con-facts">
          <div><dt>Commit</dt><dd>{data.head ? <><code className="con-key">{data.head.short}</code> {data.head.message}</> : 'Unknown'}</dd></div>
          <div><dt>Full tests</dt><dd>{data.tests ? <><Pill tone={data.tests.status !== 'completed' ? 'warn' : data.tests.conclusion === 'success' ? 'ok' : 'bad'}>{data.tests.status !== 'completed' ? 'Running' : data.tests.conclusion === 'success' ? 'Passed' : 'Failed'}</Pill> <a className="con-link" href={data.tests.url} target="_blank" rel="noreferrer">Open the run</a></> : <Pill tone="warn">Not run</Pill>}</dd></div>
          <div><dt>Staged</dt><dd>{data.staged ? <><code className="con-key">{data.staged.revision}</code>, <When at={data.staged.createdAt} /></> : 'No'}</dd></div>
          <div><dt>Live now</dt><dd>{data.serving ? <code className="con-key">{data.serving}</code> : 'Unknown'}</dd></div>
        </dl>
        <p className="con-quiet">{NEXT_NOTE[data.next]}</p>
      </section>

      {running ? (
        <section className="con-section" aria-labelledby="rel-running">
          <h2 id="rel-running" className="con-h2">Running now</h2>
          <div className="con-row con-row--split">
            <span><strong>{running.kind}</strong> started by {running.actor}, <When at={running.at} /> <Pill tone="warn">{runWord(running)}</Pill></span>
            <span className="con-row-actions">
              <a className="con-link" href={running.url} target="_blank" rel="noreferrer">Open on GitHub</a>
              {approvable && owner ? <button type="button" className="ui-btn con-btn-primary ui-btn-sm" disabled={Boolean(act.busy)} onClick={() => setAsk({ kind: 'approve', id: running.id, what: running.kind })}>Approve</button> : null}
            </span>
          </div>
          {running.status === 'waiting' && !approvable ? <p className="con-quiet">Waiting for an owner to approve.</p> : null}
          <Steps runId={running.id} />
        </section>
      ) : null}

      <section className="con-section" aria-labelledby="rel-waiting">
        <h2 id="rel-waiting" className="con-h2">Waiting to release{data.waiting?.since ? <span className="con-quiet con-h2-note"> since {data.waiting.since}</span> : null}</h2>
        {!data.waiting ? <p className="con-quiet">Could not check.</p> : data.waiting.pulls.length === 0 ? <p className="con-quiet">Nothing is waiting.</p> : (
          <>
            {data.waiting.marks.length ? <p className="con-marks">This release includes: {data.waiting.marks.map((m) => <Pill key={m} tone="warn">{MARK[m]}</Pill>)}</p> : null}
            {!data.waiting.complete ? <p className="con-quiet">More has changed than is listed here. Check on GitHub before releasing.</p> : null}
            <ul className="con-list">
              {data.waiting.pulls.map((p) => <li key={p.number} className="con-row"><span className="con-num">#{p.number}</span><span>{p.title}</span></li>)}
            </ul>
          </>
        )}
      </section>

      <section className="con-section" aria-labelledby="rel-back">
        <h2 id="rel-back" className="con-h2">Roll back</h2>
        <p className="con-quiet">Moves every customer to an earlier version of the API. It does not undo a database change.</p>
        <ul className="con-list">
          {data.revisions.map((r) => (
            <li key={r.name} className="con-row con-row--split">
              <span><code className="con-key">{r.name}</code>{r.tag ? <span className="con-quiet"> {r.tag}</span> : null} <span className="con-quiet"><When at={r.createdAt} /></span> {r.serving ? <Pill tone="ok">Live now</Pill> : null}</span>
              {!r.serving && engineer && data.github !== false ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(act.busy) || Boolean(running)} onClick={() => setAsk({ kind: 'rollback', revision: r.name })}>Roll back to this</button> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="con-section" aria-labelledby="rel-history">
        <h2 id="rel-history" className="con-h2">Past releases</h2>
        {data.history.length === 0 ? <p className="con-quiet">None recorded yet.</p> : (
          <div className="con-table-wrap">
            <table className="con-table">
              <thead><tr><th scope="col">Release</th><th scope="col">By</th><th scope="col">When</th><th scope="col">Note</th></tr></thead>
              <tbody>{data.history.map((h) => <tr key={h.tag}><td><code className="con-key">{h.tag}</code></td><td>{h.by}</td><td><When at={h.at} /></td><td>{h.message}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {data.runs.filter((r) => r.status === 'completed').length ? (
          <>
            <h3 className="con-h3">Runs from the Console</h3>
            <ul className="con-list">
              {data.runs.filter((r) => r.status === 'completed').map((r) => (
                <li key={r.id} className="con-row con-row--split">
                  <span>{r.kind}: {r.title} <Pill tone={RUN_TONE[r.conclusion] || 'none'}>{runWord(r)}</Pill></span>
                  <span className="con-quiet">{r.actor}, <When at={r.at} /> <a className="con-link con-link--icon" href={r.url} target="_blank" rel="noreferrer" aria-label="Open this run on GitHub"><ExternalLink size={14} aria-hidden="true" /></a></span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {ask?.kind === 'release' ? (
        <ReasonDialog title={`Release ${data.head.short}`} lede={`Customers move from ${data.serving} to ${data.staged.revision}. The web app and the website are published too. An owner approval follows on this page.`} label="What is in this release" confirm="Release" onClose={() => setAsk(null)} onConfirm={(reason) => act.through(() => api.release(reason), 'The release has started. Approve it below to let it run.')} />
      ) : null}
      {ask?.kind === 'approve' ? (
        <ConfirmDialog title="Approve this run?" lede={`The ${String(ask.what || 'run').toLowerCase()} carries on now${data.staged ? `, and customers move to ${data.staged.revision}` : ''}. Once it has run it cannot be stopped from here; use Roll back to undo a release.`} confirm="Approve run" cancel="Not yet" onClose={() => setAsk(null)} onConfirm={() => act.through(() => api.approve(ask.id), 'Approved. The run is continuing.')} />
      ) : null}
      {ask?.kind === 'rollback' ? (
        <ReasonDialog title="Roll back the API" lede={`Every customer moves from ${data.serving} to ${ask.revision}. A database change made since then stays as it is. An owner approves it before it runs.`} label="Why" confirm="Roll back" danger onClose={() => setAsk(null)} onConfirm={(reason) => act.through(() => api.rollback(ask.revision, reason), 'The rollback is waiting for an owner. Approve it under Running now.')} />
      ) : null}
    </>
  );
}

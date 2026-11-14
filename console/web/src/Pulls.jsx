import React, { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

import { api } from './api';
import { Loading, Notice, PageHead, Pill, ReasonDialog, When, useAction, useLoad } from './kit';
import { MARK } from './Releases';

const WRITER = { AGENT: 'Agent', DEPENDABOT: 'Dependabot', PERSON: 'Person' };
const CHECKS = { GREEN: ['ok', 'Passing'], RED: ['bad', 'Failing'], RUNNING: ['warn', 'Running'], NONE: ['none', 'Not run'] };
const rank = (role) => ['VIEWER', 'ENGINEER', 'OWNER'].indexOf(role);

/*
 * The review desk: every open pull request, who wrote it, whether its checks
 * pass and what it touches. Nothing is edited here; a change to code is a
 * pull request on GitHub.
 */
export default function Pulls({ me }) {
  const { data, error, loading, reload } = useLoad(() => api.pulls());
  const act = useAction(reload);
  const [open, setOpen] = useState(null);
  const [closing, setClosing] = useState(null);
  const engineer = rank(me.role) >= 1;
  const owner = rank(me.role) >= 2;

  return (
    <>
      <PageHead title="Pull requests">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={reload} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{loading && data ? 'Checking…' : 'Check again'}</span>
        </button>
      </PageHead>
      {error ? <Notice tone="bad">{error.message}</Notice> : null}
      {act.error ? <Notice tone="bad">{act.error}</Notice> : null}
      {act.done ? <Notice tone="ok">{act.done}</Notice> : null}
      {data && !data.reachable ? <Notice>GitHub could not be reached. {data.checkedAt ? 'This is the list as it was when last checked.' : 'There is no list to show yet.'}</Notice> : null}
      {!data && loading ? <Loading /> : null}
      {data && data.pulls.length === 0 && data.reachable ? <p className="con-quiet">No pull requests are open.</p> : null}
      {data && data.pulls.length ? (
        <div className="con-table-wrap">
          <table className="con-table">
            <thead>
              <tr><th scope="col">Pull request</th><th scope="col">Written by</th><th scope="col">Checks</th><th scope="col" className="con-num-col">Size</th><th scope="col">Touches</th><th scope="col">Last push</th></tr>
            </thead>
            <tbody>
              {data.pulls.map((p) => {
                const isOpen = open === p.number;
                const [tone, word] = CHECKS[p.checks];
                return (
                  <React.Fragment key={p.number}>
                    <tr>
                      <td>
                        <button type="button" className="con-expand" aria-expanded={isOpen} aria-controls={`pull-${p.number}`} onClick={() => setOpen(isOpen ? null : p.number)}>
                          {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                          <span className="con-num">#{p.number}</span>
                          <span className="con-pull-title">{p.title}</span>
                          {p.draft ? <Pill>Draft</Pill> : null}
                        </button>
                      </td>
                      <td>{WRITER[p.writtenBy]}<span className="con-quiet"> {p.author}</span></td>
                      <td><Pill tone={tone}>{word}</Pill>{p.checks !== 'NONE' && !p.fullTests ? <span className="con-quiet"> related tests only</span> : null}</td>
                      <td className="con-num-col">{p.changedFiles} {p.changedFiles === 1 ? 'file' : 'files'}<span className="con-quiet"> +{p.additions} −{p.deletions}</span></td>
                      <td>{p.marks.length ? <span className="con-marks">{p.marks.map((m) => <Pill key={m} tone="warn">{MARK[m]}</Pill>)}</span> : <span className="con-quiet">Nothing marked</span>}</td>
                      <td><When at={p.pushedAt} /></td>
                    </tr>
                    {isOpen ? (
                      <tr id={`pull-${p.number}`} className="con-detail-row">
                        <td colSpan={6}>
                          <div className="con-detail">
                            <p className="con-quiet">Branch <code className="con-key">{p.branch}</code>, opened <When at={p.createdAt} />. <a className="con-link" href={p.url} target="_blank" rel="noreferrer">Open on GitHub</a></p>
                            {p.body ? <p className="con-body">{p.body}</p> : null}
                            <h3 className="con-h3">Files{p.filesTruncated ? ' (first 100)' : ''}</h3>
                            <ul className="con-files">{p.files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
                            {p.cannotMerge ? <p className="con-quiet">Cannot be merged here: {p.cannotMerge}</p> : null}
                            {engineer ? (
                              <div className="con-row-actions">
                                {owner && !p.cannotMerge ? <button type="button" className="ui-btn con-btn-primary ui-btn-sm" disabled={Boolean(act.busy)} onClick={() => act.run(`merge-${p.number}`, () => api.pullMerge(p.number), `#${p.number} is merged.`)}>Merge</button> : null}
                                {!p.fullTests ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(act.busy)} onClick={() => act.run(`tests-${p.number}`, () => api.pullFullTests(p.number), `The full tests have started on #${p.number}.`)}>Run full tests</button> : null}
                                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={Boolean(act.busy)} onClick={() => setClosing(p)}>Close</button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {closing ? (
        <ReasonDialog title={`Close #${closing.number}`} lede={`"${closing.title}" is closed without merging. The reason is posted on the pull request.`} label="Why" confirm="Close pull request" danger onClose={() => setClosing(null)} onConfirm={(reason) => act.through(() => api.pullClose(closing.number, reason), `#${closing.number} is closed.`)} />
      ) : null}
    </>
  );
}

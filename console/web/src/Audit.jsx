import React from 'react';

import { api } from './api';
import { Loading, Notice, PageHead, exact, useLoad } from './kit';

const ACTION = {
  AUTHENTICATOR_SET_UP: 'Set up an authenticator',
  FULL_TESTS_STARTED: 'Started the full tests',
  RELEASE_STAGED: 'Staged a release',
  RELEASE_STARTED: 'Started a release',
  RELEASE_APPROVED: 'Approved a release run',
  ROLLED_BACK: 'Rolled back the API',
  PR_FULL_TESTS: 'Started full tests on a pull request',
  PR_MERGED: 'Merged a pull request',
  PR_CLOSED: 'Closed a pull request',
  MEMBER_ADDED: 'Added a member',
  MEMBER_CHANGED: 'Changed a member',
};
const words = (action) => (action.endsWith('_FAILED') ? `Failed: ${ACTION[action.replace(/_FAILED$/, '')] || action}` : ACTION[action] || action);

/* Every change made from the Console, newest first. Kept for good: no line is ever changed or removed. */
export default function Audit() {
  const { data, error, loading } = useLoad(() => api.audit());
  return (
    <>
      <PageHead title="Log" />
      {error ? <Notice tone="bad">{error.message}</Notice> : null}
      {!data && loading ? <Loading /> : null}
      {data && data.events.length === 0 ? <p className="con-quiet">Nothing has been changed from the Console yet.</p> : null}
      {data && data.events.length ? (
        <div className="con-table-wrap">
          <table className="con-table">
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">On</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} data-failed={e.action.endsWith('_FAILED') || undefined}>
                  <td className="con-nowrap">{exact(e.at)}</td>
                  <td>{e.who}</td>
                  <td>{words(e.action)}</td>
                  <td><code className="con-key">{e.target}</code></td>
                  <td>{e.reason || (e.detail?.error ? e.detail.error : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

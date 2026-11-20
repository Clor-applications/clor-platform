import React, { useState } from 'react';

import { connectGithubUrl, linkClorUrl } from './api';
import { Notice, PageHead, Pill, useAskCode } from './kit';

/* After connecting or linking, the API sends the browser back with one of these. */
const LINK_NOTE = {
  'code-first': 'Enter an authenticator code first, then try again. Adding a way to sign in needs a fresh code.',
  'other-github': 'That is a different GitHub account from the one linked to you. Sign in to GitHub as your own account and try again.',
  'github-taken': 'That GitHub account already belongs to another member.',
  'other-clor': 'That is a different CLOR login from the one linked to you.',
  'clor-taken': 'That CLOR login already belongs to another member.',
  failed: 'The sign-in was not linked. Start again from this page; if it keeps failing, tell engineering.',
};

/*
 * The ways into the Console that are switched on, for the person signed in.
 * Any of them gets you in to read. A change on GitHub (release, roll back, merge) is always made with
 * your own GitHub account, so a CLOR sign-in connects GitHub before it can
 * change anything. Adding a way to sign in asks for a fresh code first.
 */
export default function YourSignIn({ me }) {
  const askCode = useAskCode();
  const [error, setError] = useState('');
  const note = LINK_NOTE[new URLSearchParams(window.location.search).get('signin')];

  /* Ask for a code unless one was entered in the last few minutes, then leave for GitHub or Ops. */
  const leaveFor = (url) => async () => {
    setError('');
    try {
      const fresh = me.steppedUpUntil && me.steppedUpUntil - Date.now() > 30_000;
      if (!fresh) await askCode();
      window.location.assign(url);
    } catch (e) {
      if (!e.cancelled) setError(e.message);
    }
  };

  return (
    <>
      <PageHead title="Your sign-in" />
      {note ? <Notice tone="bad">{note}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <ul className="con-list">
        {me.password.available ? (
          <li className="con-row con-row--split">
            <span>
              <strong>Email and password</strong>{' '}
              {me.password.set ? <Pill tone="ok">Set</Pill> : <Pill>Not set</Pill>}
              <span className="con-quiet"> {me.password.email ? `${me.password.email}. ` : ''}{me.password.set ? 'An owner can reset it from Members.' : 'An owner adds your email address in Members and gives you a setup code.'}</span>
            </span>
          </li>
        ) : null}
        {me.github.available ? (
          <li className="con-row con-row--split">
            <span>
              <strong>GitHub</strong>{' '}
              {me.github.connected ? <Pill tone="ok">Connected now</Pill> : me.github.linked ? <Pill tone="warn">Linked, not connected</Pill> : <Pill>Not linked</Pill>}
              <span className="con-quiet"> {me.github.login ? `${me.github.login}. ` : ''}{me.github.connected ? 'You can make changes.' : 'Needed to release, roll back, merge or close. Reading does not need it.'}</span>
            </span>
            {!me.github.connected ? <button type="button" className="ui-btn con-btn-primary ui-btn-sm" onClick={leaveFor(connectGithubUrl)}>Connect GitHub</button> : null}
          </li>
        ) : null}
        {me.clor.available ? (
          <li className="con-row con-row--split">
            <span>
              <strong>CLOR login</strong>{' '}
              {me.clor.linked ? <Pill tone="ok">Linked</Pill> : <Pill>Not linked</Pill>}
              <span className="con-quiet"> {me.clor.email ? `${me.clor.email}. ` : ''}{me.clor.linked ? 'You can sign in with CLOR.' : 'Link it to sign in with your CLOR staff login.'}</span>
            </span>
            {!me.clor.linked ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={leaveFor(linkClorUrl)}>Link CLOR login</button> : null}
          </li>
        ) : null}
      </ul>
      {!me.github.available ? <p className="con-quiet" style={{ marginTop: 12 }}>GitHub is not connected to the Console yet, so releases and pull requests cannot be read or changed from here.</p> : null}
      <p className="con-quiet" style={{ marginTop: 12 }}>You came in with {{ clor: 'your CLOR login', github: 'GitHub', password: 'your password' }[me.via]} this time.</p>
    </>
  );
}

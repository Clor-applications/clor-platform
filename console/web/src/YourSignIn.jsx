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
  failed: 'That did not work. Try again.',
};

/*
 * The two ways into the Console, for the person signed in. Either gets you in
 * to read. A change on GitHub (release, roll back, merge) is always made with
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
        <li className="con-row con-row--split">
          <span>
            <strong>GitHub</strong>{' '}
            {me.github.connected ? <Pill tone="ok">Connected now</Pill> : me.github.linked ? <Pill tone="warn">Linked, not connected</Pill> : <Pill>Not linked</Pill>}
            <span className="con-quiet"> {me.github.login ? `${me.github.login}. ` : ''}{me.github.connected ? 'You can make changes.' : 'Needed to release, roll back, merge or close. Reading does not need it.'}</span>
          </span>
          {!me.github.connected ? <button type="button" className="ui-btn con-btn-primary ui-btn-sm" onClick={leaveFor(connectGithubUrl)}>Connect GitHub</button> : null}
        </li>
        <li className="con-row con-row--split">
          <span>
            <strong>CLOR login</strong>{' '}
            {!me.clor.available ? <Pill>Not set up</Pill> : me.clor.linked ? <Pill tone="ok">Linked</Pill> : <Pill>Not linked</Pill>}
            <span className="con-quiet"> {me.clor.email ? `${me.clor.email}. ` : ''}{!me.clor.available ? 'Sign-in with CLOR is switched off for the Console.' : me.clor.linked ? 'You can sign in with CLOR.' : 'Link it to sign in with your CLOR staff login.'}</span>
          </span>
          {me.clor.available && !me.clor.linked ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={leaveFor(linkClorUrl)}>Link CLOR login</button> : null}
        </li>
      </ul>
      <p className="con-quiet" style={{ marginTop: 12 }}>You came in with {me.via === 'clor' ? 'your CLOR login' : 'GitHub'} this time.</p>
    </>
  );
}

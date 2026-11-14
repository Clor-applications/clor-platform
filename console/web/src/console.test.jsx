import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './api';
import { GuardProvider } from './kit';
import Pulls from './Pulls';
import Releases from './Releases';
import YourSignIn from './YourSignIn';
import App from './App';

vi.mock('./api', async (orig) => {
  const real = await orig();
  return { ...real, api: Object.fromEntries(Object.keys(real.api).map((k) => [k, vi.fn()])) };
});

/* jsdom has no <dialog> behaviour of its own. */
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  Object.values(api).forEach((f) => f.mockReset());
});

const releases = (over = {}) => ({
  reachable: true,
  next: 'STAGE',
  head: { sha: 'c5fbc8eb', short: 'c5fbc8e', message: 'Merge pull request #269', date: new Date().toISOString() },
  tests: { status: 'completed', conclusion: 'success', url: 'https://github.example/run', at: new Date().toISOString() },
  staged: null,
  serving: 'clor-api-00131-abc',
  waiting: { pulls: [{ number: 269, title: 'Web guidelines fixes' }], commits: 2, marks: ['MIGRATION'], since: 'rel-8a8ed97', complete: true },
  revisions: [{ name: 'clor-api-00131-abc', createdAt: new Date().toISOString(), tag: 'rel-8a8ed97', serving: true }, { name: 'clor-api-00127-622', createdAt: new Date().toISOString(), tag: 'rel-70e780f', serving: false }],
  runs: [],
  pending: [],
  history: [],
  ...over,
});
const show = (ui) => render(<GuardProvider>{ui}</GuardProvider>);

describe('Releases', () => {
  // protects=the one primary action is the next step for this person's role; fails_when=a Viewer is offered a step, an Engineer is offered Release, or the step does not match the state; no_claim=the API enforces roles itself; this is what the page offers
  it.each([
    ['TESTS', 'ENGINEER', 'Run full tests'],
    ['STAGE', 'ENGINEER', 'Stage'],
    ['RELEASE', 'OWNER', 'Release'],
    ['RELEASE', 'ENGINEER', null],
    ['STAGE', 'VIEWER', null],
    ['UNKNOWN', 'OWNER', null],
    ['NOTHING', 'OWNER', null],
  ])('when the next step is %s, a %s is offered %s', async (next, role, label) => {
    api.releases.mockResolvedValue(releases({ next, staged: next === 'RELEASE' ? { revision: 'clor-api-00132-new', tag: 'rel-c5fbc8e', createdAt: new Date().toISOString() } : null }));
    show(<Releases me={{ role }} />);
    await screen.findByText('On main');
    const offered = ['Run full tests', 'Stage', 'Release'].filter((l) => screen.queryByRole('button', { name: l }));
    expect(offered).toEqual(label ? [label] : []);
  });

  // protects=a change that needs a code asks for it, then goes through once the code is accepted; fails_when=the change is dropped, or runs without the code step; no_claim=the code check itself is the API's
  it('asks for an authenticator code, then stages', async () => {
    const user = userEvent.setup();
    api.releases.mockResolvedValue(releases());
    api.stage.mockRejectedValueOnce(new ApiError('Enter a code from your authenticator.', 401, 'STEP_UP')).mockResolvedValueOnce({ ok: true });
    api.stepUp.mockResolvedValue({});
    show(<Releases me={{ role: 'ENGINEER' }} />);
    await user.click(await screen.findByRole('button', { name: 'Stage' }));
    await user.type(await screen.findByLabelText('Six-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.stage).toHaveBeenCalledTimes(2));
    expect(api.stepUp).toHaveBeenCalledWith('123456');
    expect(await screen.findByText(/Staging has started/)).toBeTruthy();
  });

  // protects=a rollback names both revisions, says it does not undo a database change, and sends the reason typed; fails_when=it goes out without a reason or for another revision; no_claim=none beyond protects
  it('rolls back only with a reason, to the revision picked', async () => {
    const user = userEvent.setup();
    api.releases.mockResolvedValue(releases());
    api.rollback.mockResolvedValue({ ok: true });
    show(<Releases me={{ role: 'ENGINEER' }} />);
    await user.click(await screen.findByRole('button', { name: 'Roll back to this' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/from clor-api-00131-abc to clor-api-00127-622/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Roll back' }).disabled).toBe(true);
    await user.type(within(dialog).getByLabelText('Why'), 'Errors after release');
    await user.click(within(dialog).getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith('clor-api-00127-622', 'Errors after release'));
  });

  // protects=when the sources cannot be reached the page says so and offers no step; fails_when=a step is offered on unknown state; no_claim=none beyond protects
  it('says so when nothing could be checked', async () => {
    api.releases.mockResolvedValue(releases({ reachable: false, next: 'UNKNOWN' }));
    show(<Releases me={{ role: 'OWNER' }} />);
    expect(await screen.findByText(/could not be reached, so no step is offered/)).toBeTruthy();
  });
});

describe('Pull requests', () => {
  const pull = (over = {}) => ({ number: 301, title: 'Leave balance', url: 'https://github.example/301', body: '', draft: false, branch: 'claude/leave', author: 'suresh-3333', writtenBy: 'AGENT', checks: 'GREEN', fullTests: false, additions: 10, deletions: 2, changedFiles: 1, files: ['apps/people/src/Profile.jsx'], filesTruncated: false, marks: [], createdAt: new Date().toISOString(), pushedAt: new Date().toISOString(), cannotMerge: null, ...over });

  // protects=Merge is offered to an owner only, and only where the API says it can be merged; the reason it cannot is shown; fails_when=Merge appears for an Engineer or on a release-path pull request; no_claim=the API refuses these itself
  it('offers Merge only to an owner on a pull request that can be merged', async () => {
    const user = userEvent.setup();
    api.pulls.mockResolvedValue({ reachable: true, checkedAt: Date.now(), pulls: [pull(), pull({ number: 302, title: 'Release retry', marks: ['RELEASE'], cannotMerge: 'It changes how releases or sign-in work. Review this one on GitHub.' })] });
    const view = show(<Pulls me={{ role: 'OWNER' }} />);
    await user.click(await screen.findByRole('button', { name: /#301/ }));
    expect(screen.getByRole('button', { name: 'Merge' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /#302/ }));
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(screen.getByText(/Review this one on GitHub/)).toBeTruthy();
    expect(screen.getByText('Release scripts')).toBeTruthy();
    view.unmount();

    show(<Pulls me={{ role: 'ENGINEER' }} />);
    await user.click(await screen.findByRole('button', { name: /#301/ }));
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run full tests' })).toBeTruthy();
  });

  // protects=a Viewer sees the list and no action; fails_when=any change button is drawn for a Viewer; no_claim=none beyond protects
  it('shows a Viewer no actions', async () => {
    const user = userEvent.setup();
    api.pulls.mockResolvedValue({ reachable: true, checkedAt: Date.now(), pulls: [pull()] });
    show(<Pulls me={{ role: 'VIEWER' }} />);
    await user.click(await screen.findByRole('button', { name: /#301/ }));
    for (const name of ['Merge', 'Run full tests', 'Close']) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});

describe('signing in', () => {
  const me = (over = {}) => ({ name: 'owner', role: 'OWNER', via: 'github', authenticator: true, needsCode: false, github: { connected: true, linked: true, login: 'owner' }, clor: { available: true, linked: false, email: null }, steppedUpUntil: null, ...over });

  // protects=the sign-in page offers CLOR only when the Console has it switched on, and always offers GitHub; fails_when=a CLOR button appears while it is off, or GitHub is missing; no_claim=none beyond protects
  it.each([[true, ['Sign in with CLOR', 'Sign in with GitHub']], [false, ['Sign in with GitHub']]])('with CLOR sign-in %s, offers %j', async (clor, links) => {
    api.me.mockRejectedValue(new ApiError('Sign in.', 401, 'SIGN_IN'));
    api.signInOptions.mockResolvedValue({ github: true, clor });
    render(<App />);
    await screen.findByText('CLOR Console');
    await waitFor(() => expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(links));
  });

  // protects=a CLOR sign-in sees only the code screen until the Console's own code is entered; fails_when=any screen or menu is drawn first; no_claim=the API refuses the reads itself
  it('shows a CLOR sign-in nothing but the code screen first', async () => {
    const user = userEvent.setup();
    api.me.mockResolvedValueOnce(me({ via: 'clor', needsCode: true, github: { connected: false, linked: true, login: 'owner' } })).mockResolvedValue(me({ via: 'clor' }));
    api.stepUp.mockResolvedValue({});
    api.overview.mockResolvedValue({ rows: [] });
    render(<App />);
    expect(await screen.findByText('Enter your authenticator code')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(api.overview).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('navigation')).toBeTruthy();
    expect(api.stepUp).toHaveBeenCalledWith('123456');
  });

  // protects=a change refused for want of a GitHub connection tells the person where to connect; fails_when=it shows a bare error or asks for a code instead; no_claim=none beyond protects
  it('says to connect GitHub when a CLOR sign-in tries a change', async () => {
    const user = userEvent.setup();
    api.releases.mockResolvedValue(releases());
    api.stage.mockRejectedValue(new ApiError('Connect your GitHub account to make changes.', 401, 'CONNECT_GITHUB'));
    show(<Releases me={{ role: 'ENGINEER' }} />);
    await user.click(await screen.findByRole('button', { name: 'Stage' }));
    expect(await screen.findByText(/Connect your GitHub account first \(Your sign-in/)).toBeTruthy();
    expect(screen.queryByLabelText('Six-digit code')).toBeNull();
  });

  // protects=Your sign-in offers exactly what is missing: Connect GitHub when not connected, Link CLOR login when not linked and switched on; fails_when=it offers what is already done, or CLOR while it is off; no_claim=none beyond protects
  it.each([
    [me(), ['Link CLOR login']],
    [me({ via: 'clor', github: { connected: false, linked: true, login: 'owner' }, clor: { available: true, linked: true, email: 'owner@clor.in' } }), ['Connect GitHub']],
    [me({ clor: { available: false, linked: false, email: null } }), []],
    [me({ clor: { available: true, linked: true, email: 'owner@clor.in' } }), []],
  ])('offers the missing sign-in steps (%#)', (who, buttons) => {
    show(<YourSignIn me={who} />);
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(buttons);
  });
});

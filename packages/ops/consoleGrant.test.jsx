import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { opsConsoleGrant } from './api';
import { ConsoleGrant } from './ConsoleGrant';

vi.mock('./api', () => ({ opsConsoleGrant: vi.fn() }));

const STATE = 'a'.repeat(32);
const me = { user: { email: 'owner@clor.in' }, role: 'SUPER_ADMIN' };

describe('opening the Engineering Console from Ops', () => {
  let assign;
  beforeEach(() => {
    opsConsoleGrant.mockReset();
    assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  });

  // protects=nothing is asked of the API until the person confirms, and the browser then goes only where the API says; fails_when=a pass is fetched on arrival, or the page builds the address itself; no_claim=the API's own checks are server/src/__tests__/consoleGrant.test.ts
  it('asks first, then goes where the API says', async () => {
    const user = userEvent.setup();
    opsConsoleGrant.mockResolvedValue({ redirectTo: 'https://console-api.clor.in/api/auth/clor/callback?grant=x&state=y' });
    render(<ConsoleGrant state={STATE} me={me} onCancel={() => {}} />);
    expect(screen.getByText(/signed in as owner@clor.in/)).toBeTruthy();
    expect(opsConsoleGrant).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue to the Console' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://console-api.clor.in/api/auth/clor/callback?grant=x&state=y'));
    expect(opsConsoleGrant).toHaveBeenCalledWith(STATE);
  });

  // protects=a refusal is shown and the browser stays; Stay in Ops asks nothing; fails_when=the browser leaves on an error, or cancel fetches a pass; no_claim=none beyond protects
  it('stays put when refused or cancelled', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    opsConsoleGrant.mockRejectedValue(new Error('Sign-in to the Console with a CLOR login is not set up yet.'));
    render(<ConsoleGrant state={STATE} me={me} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Continue to the Console' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not set up yet/);
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stay in Ops' }));
    expect(onCancel).toHaveBeenCalled();
    expect(opsConsoleGrant).toHaveBeenCalledTimes(1);
  });
});

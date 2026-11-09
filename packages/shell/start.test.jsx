import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ options: vi.fn(), start: vi.fn(), pending: vi.fn(), confirm: vi.fn() }));
vi.mock('@platform/auth', () => ({
  signupOptions: (a) => api.options(a),
  signupStart: (b) => api.start(b),
  signupPending: (t) => api.pending(t),
  signupConfirm: (b) => api.confirm(b),
}));

import Start from './Start';
import { appOf, forgetStartLink, isStartPath } from './startLink';

const OFFER = {
  apps: [
    { code: 'accounting', name: 'Books' },
    { code: 'people', name: 'People' },
    { code: 'attendance', name: 'Attendance' },
    { code: 'payroll', name: 'Payroll' },
  ],
  trialDays: 14,
  planCode: null,
  linkHours: 24,
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.options.mockResolvedValue(OFFER);
  forgetStartLink();
});

describe('Start a free trial', () => {
  it('knows its address and the site’s product slugs', () => {
    expect(isStartPath('/start')).toBe(true);
    expect(isStartPath('/start/')).toBe(true);
    expect(isStartPath('/signup')).toBe(false);
    expect(appOf('books')).toBe('accounting');
    expect(appOf('People')).toBe('people');
    expect(appOf('projects')).toBe('');
  });

  it('asks for the email, says the days and that no card is taken, sends the link for the app the pricing button named, then says check your mail', async () => {
    window.history.replaceState(null, '', '/start?app=books');
    api.start.mockResolvedValue({ ok: true });
    render(<Start onHome={() => {}} onSignIn={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Start your Books trial' })).toBeInTheDocument();
    expect(screen.getByText(/14 days free, no card\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: ' Asha@Rao.in ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send me the link/ }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({ email: 'asha@rao.in', app: 'accounting', plan: undefined, website: undefined }));
    expect(await screen.findByRole('heading', { name: 'Check your mail' })).toBeInTheDocument();
    expect(screen.getByText(/We sent a link to asha@rao.in/)).toBeInTheDocument();
    /* It can be sent again, once. */
    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Sent again' })).toBeDisabled();
  });

  it('shows the server’s refusal for an email that already signs in, and offers sign in', async () => {
    window.history.replaceState(null, '', '/start');
    api.start.mockRejectedValue(Object.assign(new Error('Somebody already signs in to CLOR with this email. Sign in instead, or use another address.'), { status: 409, code: 'EMAIL_TAKEN' }));
    const onSignIn = vi.fn();
    render(<Start onHome={() => {}} onSignIn={onSignIn} />);
    expect(await screen.findByRole('heading', { name: 'Start your free trial' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'asha@rao.in' } });
    fireEvent.click(screen.getByRole('button', { name: /Send me the link/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Somebody already signs in to CLOR with this email');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('opens the mailed link: the token leaves the address, the email is confirmed, Books asks for the state, People includes Attendance, and Open CLOR makes the account and opens the app', async () => {
    window.history.replaceState(null, '', '/start?t=mail-token-0123456789abcdef&app=books');
    api.pending.mockResolvedValue({ email: 'asha@rao.in', app: 'accounting', apps: OFFER.apps, trialDays: 14, planCode: null, expiresAt: '2026-11-11T00:00:00Z' });
    api.confirm.mockResolvedValue({ token: 'access-token', activeOrgId: 'o1', app: 'accounting', apps: ['accounting', 'people', 'attendance'], trialEndsAt: '2026-11-24T00:00:00Z', trialDays: 14 });
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, replace, search: original.search, pathname: original.pathname } });
    try {
      render(<Start onHome={() => {}} onSignIn={() => {}} />);
      expect(await screen.findByRole('heading', { name: 'Set up your company' })).toBeInTheDocument();
      expect(api.pending).toHaveBeenCalledWith('mail-token-0123456789abcdef');
      expect(window.history.state).toBeNull();
      expect(screen.getByText(/asha@rao.in is confirmed\. Your trial runs 14 days, no card\./)).toBeInTheDocument();

      /* Books is ticked from the link, so the state is asked. */
      const books = screen.getByRole('checkbox', { name: /Books/ });
      expect(books).toBeChecked();
      expect(screen.getByLabelText('State of your head office')).toBeInTheDocument();
      /* Without Books the state question goes away. */
      fireEvent.click(books);
      expect(screen.queryByLabelText('State of your head office')).not.toBeInTheDocument();
      fireEvent.click(books);

      /* People ticks Attendance and says so. */
      fireEvent.click(screen.getByRole('checkbox', { name: /People/ }));
      const attendance = screen.getByRole('checkbox', { name: /Attendance/ });
      expect(attendance).toBeChecked();
      expect(attendance).toBeDisabled();
      expect(screen.getByText('People includes Attendance, so both are on.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Open CLOR with Books, People, Attendance/ })).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } });
      fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Rao Textiles' } });
      fireEvent.click(screen.getByRole('button', { name: /Open CLOR/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Choose the state of your head office');
      fireEvent.change(screen.getByLabelText('State of your head office'), { target: { value: 'Karnataka' } });
      fireEvent.click(screen.getByRole('button', { name: /Open CLOR/ }));
      await waitFor(() =>
        expect(api.confirm).toHaveBeenCalledWith({ token: 'mail-token-0123456789abcdef', ownerName: 'Asha Rao', companyName: 'Rao Textiles', apps: ['accounting', 'people', 'attendance'], state: 'Karnataka' }),
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/?app=accounting'));
      expect(localStorage.getItem('token')).toBe('access-token');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
      localStorage.removeItem('token');
    }
  });

  it('says a link has ended, in plain words, with a way to start again', async () => {
    window.history.replaceState(null, '', '/start?t=old-token-0123456789abcdef');
    api.pending.mockRejectedValue(Object.assign(new Error('This link has ended.'), { status: 410, code: 'LINK_ENDED' }));
    render(<Start onHome={() => {}} onSignIn={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start again/ }));
    expect(await screen.findByRole('heading', { name: 'Start your free trial' })).toBeInTheDocument();
  });
});

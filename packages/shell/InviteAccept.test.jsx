import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { previewInvitation: vi.fn(), acceptInvitationNew: vi.fn(), acceptInvitationSignedIn: vi.fn() };
vi.mock('@platform/admin/account', () => ({
  previewInvitation: (...a) => api.previewInvitation(...a),
  acceptInvitationNew: (...a) => api.acceptInvitationNew(...a),
  acceptInvitationSignedIn: (...a) => api.acceptInvitationSignedIn(...a),
}));
const session = { user: null, signIn: vi.fn(), signInWithCode: vi.fn(), signOut: vi.fn() };
const sms = vi.fn();
vi.mock('@platform/auth', () => ({ loginTwoFactorSms: (...a) => sms(...a) }));
vi.mock('./session', () => ({ useSession: () => session }));
vi.mock('./AuthLayout', () => ({ default: ({ title, subtitle, children }) => <div><h1>{title}</h1><p>{subtitle}</p>{children}</div> }));

import InviteAccept from './InviteAccept';

const INVITE = { email: 'priya@x.in', accountName: 'Anand Group', companies: ['Anand Traders'], accountRole: 'MEMBER', invitedBy: 'Rohit', hasLogin: false };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  session.user = null;
  session.signIn.mockReset().mockResolvedValue({});
  session.signInWithCode.mockReset().mockResolvedValue({});
  sms.mockReset().mockResolvedValue({ sent: true, phone: '+91 ••••• ••210', resendIn: 30 });
  api.previewInvitation.mockResolvedValue(INVITE);
  api.acceptInvitationNew.mockResolvedValue({ accepted: true });
  api.acceptInvitationSignedIn.mockResolvedValue({ accepted: true });
  delete window.location;
  window.location = { replace: vi.fn(), assign: vi.fn() };
});

/* W-3: the invited person's door. */
describe('accepting an invitation', () => {
  it('says who invited whom to what, then makes the login with the password they choose', async () => {
    render(<InviteAccept token="t1" />);
    expect(await screen.findByText('Rohit invited priya@x.in to join Anand Group (Anand Traders) as a member.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Priya' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Passw0rd!23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my login and join' }));
    await waitFor(() => expect(api.acceptInvitationNew).toHaveBeenCalledWith('t1', 'Priya', 'Passw0rd!23'));
    expect(session.signIn).toHaveBeenCalledWith({ email: 'priya@x.in', password: 'Passw0rd!23' });
    expect(window.location.replace).toHaveBeenCalledWith('/');
  });

  it('lets the invited person, signed in, join with one click', async () => {
    session.user = { email: 'Priya@x.in' };
    api.previewInvitation.mockResolvedValue({ ...INVITE, hasLogin: true });
    render(<InviteAccept token="t2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join Anand Group' }));
    await waitFor(() => expect(api.acceptInvitationSignedIn).toHaveBeenCalledWith('t2'));
  });

  it('asks someone with two-step sign-in for their code right there, then joins', async () => {
    api.previewInvitation.mockResolvedValue({ ...INVITE, hasLogin: true });
    session.signIn.mockResolvedValue({ twoFactorRequired: true, challenge: 'chal-9', methods: ['SMS'], phone: '+91 ••••• ••210' });
    render(<InviteAccept token="t5" />);
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'Passw0rd!23' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and join' }));
    expect(await screen.findByText('Enter your code')).toBeInTheDocument();
    await waitFor(() => expect(sms).toHaveBeenCalledWith('chal-9'));
    expect(api.acceptInvitationSignedIn).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in and join/ }));
    await waitFor(() => expect(session.signInWithCode).toHaveBeenCalledWith({ challenge: 'chal-9', code: '123456' }));
    await waitFor(() => expect(api.acceptInvitationSignedIn).toHaveBeenCalledWith('t5'));
    expect(window.location.replace).toHaveBeenCalledWith('/');
  });

  it('stops someone signed in as another address', async () => {
    session.user = { email: 'someone@else.in' };
    render(<InviteAccept token="t3" />);
    expect(await screen.findByText(/You are signed in as someone@else.in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('explains a dead link', async () => {
    api.previewInvitation.mockRejectedValue(new Error('This invitation has expired. Ask for a new one.'));
    render(<InviteAccept token="t4" onSignIn={() => {}} />);
    expect(await screen.findByText('This invitation has expired. Ask for a new one.')).toBeInTheDocument();
  });
});

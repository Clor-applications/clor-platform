import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => http.apiFetch(...a) }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', requestOpenScreen: vi.fn() }));

import Integrations from './Integrations';

const ROWS = [
  { key: 'connectors', label: 'On-site connectors', about: 'The small program on your office computer.', status: 'attention', summary: '1 connector', lastActivityAt: null, parts: [{ name: 'Head office server', status: 'attention', note: 'Not connected yet', lastSeenAt: null }], manage: { app: 'people', screen: 'integrations' } },
  { key: 'apiKeys', label: 'API keys', about: 'Keys other systems use.', status: 'ok', summary: '1 key', lastActivityAt: null, parts: [{ name: 'Canteen system', status: 'ok', note: null, lastSeenAt: null }], manage: { app: 'admin', screen: 'credentials' } },
  { key: 'email', label: 'E-mail', about: 'Mail goes out through your own server.', status: 'ok', summary: '2 e-mails sent this week', lastActivityAt: null, parts: [], manage: null, manageNote: 'Your mail server is set in Books, under Settings.' },
];

beforeEach(() => http.apiFetch.mockReset());

/* Workspace plan P2: what connects the company to the outside, whether it works, where it is managed. */
describe('Workspace Integrations', () => {
  it('says what needs a look, lists each part, and sends Manage to the owning screen', async () => {
    http.apiFetch.mockResolvedValue({ integrations: ROWS });
    const openApp = vi.fn();
    const openScreen = vi.fn();
    render(<Integrations openApp={openApp} openScreen={openScreen} />);
    const list = within(await screen.findByRole('list', { name: 'Integrations' }));
    expect(screen.getByText('1 needs a look')).toBeInTheDocument();
    expect(list.getByText('Head office server')).toBeInTheDocument();
    expect(list.getByText('Not connected yet')).toBeInTheDocument();
    expect(list.getByText('Your mail server is set in Books, under Settings.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage On-site connectors in People' }));
    expect(openApp).toHaveBeenCalledWith('people', 'integrations', {});
    fireEvent.click(screen.getByRole('button', { name: 'Manage API keys in Workspace' }));
    expect(openScreen).toHaveBeenCalledWith('credentials');
    expect(screen.queryByRole('button', { name: /Manage E-mail/ })).toBeNull();
  });

  it('says so when nothing is connected', async () => {
    http.apiFetch.mockResolvedValue({ integrations: [] });
    render(<Integrations />);
    expect(await screen.findByText(/Nothing outside CLOR is connected/)).toBeInTheDocument();
  });
});

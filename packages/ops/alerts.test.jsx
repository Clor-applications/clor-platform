import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsAlerts: vi.fn(), opsAcknowledgeAlert: vi.fn() }));
vi.mock('./api', () => ({ opsAlerts: (...a) => api.opsAlerts(...a), opsAcknowledgeAlert: (...a) => api.opsAcknowledgeAlert(...a) }));

import { Alerts } from './Alerts';

const RULES = { emailsFailingPerHour: 5, webhooksFailingPerDay: 10, urgentTicketMinutes: 60, ticketWaitHours: 24, trialEndingDays: 3 };
const A = (o = {}) => ({ id: 'a1', key: 'invoice:i1', kind: 'invoice', severity: 'critical', audience: 'BILLING', title: 'Rao Textiles: invoice CLOR/26-27/0042 overdue 20 days', detail: '₹1,180 unpaid.', link: { page: 'invoices', id: 'i1' }, firstSeenAt: new Date().toISOString(), resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, forMe: true, ...o });

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: alerts', () => {
  it('shows open alerts, urgent ones marked, opens the thing and acknowledges', async () => {
    api.opsAlerts.mockResolvedValue({ open: [A(), A({ id: 'a2', key: 'emails-stuck', kind: 'email', severity: 'warning', audience: 'SUPPORT', title: '3 emails waiting more than an hour to send', detail: null, link: null, forMe: false })], closed: [], counts: { open: 2, critical: 1, unacknowledged: 2 }, rules: RULES });
    api.opsAcknowledgeAlert.mockResolvedValue({});
    const go = vi.fn();
    render(<Alerts go={go} me={{ role: 'BILLING', user: { id: 'op1' } }} />);
    const list = within(await screen.findByRole('list', { name: 'Alerts' }));
    const first = list.getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('Urgent');
    expect(first).toHaveTextContent('for Finance');
    expect(screen.getByText('2 open · 1 urgent · 2 not acknowledged')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Open' }));
    expect(go).toHaveBeenCalledWith('invoices', {}, 'i1', '');
    /* Not this team's: no acknowledge button. */
    expect(within(list.getAllByRole('listitem')[1]).queryByRole('button', { name: 'I am on it' })).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'I am on it' }));
    await waitFor(() => expect(api.opsAcknowledgeAlert).toHaveBeenCalledWith('a1'));
    fireEvent.click(screen.getByRole('tab', { name: 'For my team' }));
    expect(within(screen.getByRole('list', { name: 'Alerts' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('says plainly when nothing is wrong, and lists the rules', async () => {
    api.opsAlerts.mockResolvedValue({ open: [], closed: [], counts: { open: 0, critical: 0, unacknowledged: 0 }, rules: RULES });
    render(<Alerts go={() => {}} me={{ role: 'READ_ONLY', user: { id: 'x' } }} />);
    expect(await screen.findByText('Nothing needs CLOR staff right now.')).toBeInTheDocument();
    expect(screen.getByText(/urgent ticket has no answer after 60 minutes/)).toBeInTheDocument();
  });
});

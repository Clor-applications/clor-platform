import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsHome: vi.fn() }));
vi.mock('./api', () => api);

import { Home } from './Home';

describe('Home', () => {
  it('says today’s numbers in plain words, each opening its list', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 3, demosToday: 1, trialsEnding: 1, failedPayments: 0, failedEmails: 2, suspended: 0, overdue: 1 });
    const go = vi.fn();
    render(<Home go={go} has={(k) => k !== 'trials' && k !== 'payments'} />);
    expect(await screen.findByText('3 new requests wait for a call · 1 came in today')).toBeInTheDocument();
    expect(screen.getByText('1 trial ends in the next 7 days')).toBeInTheDocument();
    expect(screen.getByText('None this week')).toBeInTheDocument();
    expect(screen.getByText('2 emails this week did not go')).toBeInTheDocument();
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Failed emails/ }));
    expect(go).toHaveBeenCalledWith('emailLog', { status: 'FAILED' });
    fireEvent.click(screen.getByRole('button', { name: /Trials ending this week/ }));
    expect(go).toHaveBeenCalledWith('customers', { status: 'trialing' });
    fireEvent.click(screen.getByRole('button', { name: /Demo requests/ }));
    expect(go).toHaveBeenCalledWith('demos');
  });

  it('opens Trials and Payments once the console has them', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 0, demosToday: 0, trialsEnding: 0, failedPayments: 1, failedEmails: 0, suspended: 0, overdue: 0 });
    const go = vi.fn();
    render(<Home go={go} has={() => true} />);
    fireEvent.click(await screen.findByRole('button', { name: /Failed payments/ }));
    expect(go).toHaveBeenCalledWith('payments');
    fireEvent.click(screen.getByRole('button', { name: /Trials ending/ }));
    expect(go).toHaveBeenCalledWith('trials');
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ sample: vi.fn(), build: vi.fn(), passes: vi.fn(), resend: vi.fn(), end: vi.fn() }));
vi.mock('./api', () => ({
  opsSampleCompany: () => api.sample(),
  opsBuildSample: (force) => api.build(force),
  opsExplorePasses: (p) => api.passes(p),
  opsResendPass: (id) => api.resend(id),
  opsEndPass: (id) => api.end(id),
}));
const ui = vi.hoisted(() => ({ confirm: vi.fn(() => Promise.resolve(true)), success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: ui.success, error: ui.error }, confirmDialog: (o) => ui.confirm(o) }));

import { ExploreLinks, SampleCompany } from './Explore';

const counts = { employees: 12, customers: 8, vendors: 5, items: 8, invoices: 20, bills: 8, payRuns: 1, leaveRequests: 5, attendanceDays: 384 };
const ready = { exists: true, company: 'Sample Traders Pvt Ltd', builtAt: '2026-11-09T13:00:00Z', counts, livePasses: 3, allPasses: 7, build: { state: 'done', startedAt: '2026-11-09T12:59:06Z', finishedAt: '2026-11-09T13:00:00Z', done: [], problems: [], error: null } };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(ui).forEach((f) => f.mockClear());
});

describe('Sample company in the operator console', () => {
  it('says whether it is there, what is in it and how many links work, in plain words', async () => {
    api.sample.mockResolvedValue(ready);
    render(<SampleCompany role="SUPPORT" openLinks={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Sample Traders Pvt Ltd' })).toBeInTheDocument();
    expect(screen.getByText('It is there.')).toBeInTheDocument();
    expect(screen.getByText(/in 54 s\./)).toBeInTheDocument();
    expect(screen.getByText('Employees').nextElementSibling).toHaveTextContent('12');
    expect(screen.getByText('Invoices').nextElementSibling).toHaveTextContent('20');
    expect(screen.getByText(/links work now, of/)).toHaveTextContent('3 links work now, of 7 sent.');
  });

  it('builds in the background and shows the progress until it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.sample
        .mockResolvedValueOnce({ ...ready, exists: false, counts: null, builtAt: null, build: null })
        .mockResolvedValueOnce({ ...ready, exists: false, counts: null, build: { state: 'running', startedAt: new Date().toISOString(), done: ['people: departments, positions, employees'], problems: [] } })
        .mockResolvedValue(ready);
      api.build.mockResolvedValue({ build: { state: 'running' } });
      render(<SampleCompany role="BILLING" openLinks={() => {}} />);
      expect(await screen.findByText(/It has not been made yet/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Build sample company' }));
      await waitFor(() => expect(api.build).toHaveBeenCalledWith(false));
      expect(await screen.findByText('Done so far: departments and employees.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Building…' })).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(await screen.findByText(/in 54 s\./)).toBeInTheDocument();
      await waitFor(() => expect(ui.success).toHaveBeenCalledWith('The sample company is built.'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks before a rebuild, and shows a failed build in plain words', async () => {
    api.sample.mockResolvedValue({ ...ready, build: { state: 'failed', finishedAt: '2026-11-09T13:00:00Z', error: 'The database could not be reached.', problems: [] } });
    api.build.mockResolvedValue({ build: { state: 'running' } });
    render(<SampleCompany role="SUPPORT" openLinks={() => {}} />);
    expect(await screen.findByText(/The last build did not finish/)).toBeInTheDocument();
    expect(screen.getByText('The database could not be reached.')).toBeInTheDocument();
    ui.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild from scratch' }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    expect(api.build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild from scratch' }));
    await waitFor(() => expect(api.build).toHaveBeenCalledWith(true));
  });

  it('shows no build buttons to an operator without the role', async () => {
    api.sample.mockResolvedValue(ready);
    render(<SampleCompany role="VIEWER" openLinks={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Sample Traders Pvt Ltd' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build sample company' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rebuild from scratch' })).toBeNull();
  });
});

describe('Explore links in the operator console', () => {
  const pass = { id: 'p1', email: 'asha@rao.in', state: 'active', sentAt: '2026-11-09T05:00:00Z', sendCount: 1, lastUsedAt: null, useCount: 0, expiresAt: '2026-11-23T05:00:00Z', revokedAt: null, demoRequest: { id: 'd1', name: 'Asha Rao', company: 'Rao Textiles' } };

  it('lists every link with its request, and filters', async () => {
    api.passes.mockResolvedValue({ total: 1, page: 0, pageSize: 25, active: 1, passes: [pass] });
    const openRequest = vi.fn();
    render(<ExploreLinks role="SUPPORT" openRequest={openRequest} />);
    expect(await screen.findByText('asha@rao.in')).toBeInTheDocument();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Asha Rao, Rao Textiles' }));
    expect(openRequest).toHaveBeenCalledWith('d1');
    fireEvent.change(screen.getByLabelText('Which links'), { target: { value: 'ended' } });
    await waitFor(() => expect(api.passes).toHaveBeenLastCalledWith({ state: 'ended', page: 0 }));
  });

  it('ends access after asking, and resends', async () => {
    api.passes.mockResolvedValue({ total: 1, page: 0, pageSize: 25, active: 1, passes: [pass] });
    api.end.mockResolvedValue({ sessionsEnded: 1 });
    api.resend.mockResolvedValue({});
    render(<ExploreLinks role="BILLING" openRequest={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'End access' }));
    await waitFor(() => expect(api.end).toHaveBeenCalledWith('p1'));
    expect(ui.confirm).toHaveBeenCalled();
    await waitFor(() => expect(ui.success).toHaveBeenCalledWith('Access ended. 1 open session signed out.'));
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('p1'));
  });
});

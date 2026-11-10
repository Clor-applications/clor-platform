import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsHealth: vi.fn(), opsRequestLookup: vi.fn(), opsSearch: vi.fn() }));
vi.mock('./api', () => api);

import { Health, workerName } from './Health';
import { OpsSearch } from './OpsSearch';

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

const health = {
  at: '2026-11-11T06:00:00Z',
  overall: 'down',
  workers: [
    { worker: 'reader.checks', state: 'failing', lastStartedAt: '2026-11-11T05:50:00Z', usualGapMinutes: 10, failedToday: 3, lastError: 'connection refused' },
    { worker: 'people.document-reminders', state: 'ok', lastStartedAt: '2026-11-11T00:00:00Z', usualGapMinutes: 1440, failedToday: 0, lastError: null },
  ],
  signals: [
    { key: 'emails-failed', label: 'Emails that failed in the last day', count: 4, screen: 'emails' },
    { key: 'readers-offline', label: 'Attendance readers offline', count: 0, screen: null },
  ],
};

describe('System health', () => {
  it('says plainly what is wrong, lists jobs worst first, and opens failed email', async () => {
    api.opsHealth.mockResolvedValue(health);
    const go = vi.fn();
    render(<Health go={go} />);
    expect(await screen.findByText('Something has stopped')).toBeInTheDocument();
    expect(screen.getByText('Reader checks')).toBeInTheDocument();
    expect(screen.getByText('Show the 1 on time')).toBeInTheDocument();
    expect(screen.getByText(/failed 3 times today · connection refused/)).toBeInTheDocument();
    expect(screen.getByText(/about every 1 day/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(go).toHaveBeenCalledWith('emailLog', { status: 'FAILED' });
  });

  it('opens the logs for a request ID, and says when it is not one', async () => {
    api.opsHealth.mockResolvedValue({ ...health, overall: 'ok', workers: [], signals: [] });
    api.opsRequestLookup.mockResolvedValueOnce({ id: 'req-12345678', logsUrl: 'https://console.cloud.google.com/logs/query;query=x' });
    api.opsRequestLookup.mockRejectedValueOnce(new Error('That does not look like a request ID.'));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Health go={() => {}} request="req-12345678" />);
    expect(await screen.findByText('All working')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the logs' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://console.cloud.google.com/logs/query;query=x', '_blank', 'noopener'));
    fireEvent.change(screen.getByLabelText('Request ID'), { target: { value: 'bad id here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the logs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That does not look like a request ID.');
    open.mockRestore();
  });

  it('names jobs in words', () => {
    expect(workerName('people.document-reminders')).toBe('People document reminders');
    expect(workerName('attendance.fullDayFix')).toBe('Attendance full day fix');
    expect(workerName('hr.pull')).toBe('HR pull');
  });
});

describe('the search box', () => {
  it('finds customers, people, invoices and request IDs, and opens the one picked', async () => {
    api.opsSearch.mockResolvedValue({
      customers: [{ id: 'a1', title: 'Rao Textiles', code: '4831920657', suspended: false }],
      people: [{ id: 'u1', name: 'Asha Rao', email: 'asha@rao.in', accountId: 'a1', accountName: 'Rao Textiles' }],
      invoices: [{ id: 'inv1', number: 'CLOR/26-27/0001', status: 'ISSUED' }],
      requestId: null,
    });
    const go = vi.fn();
    render(<OpsSearch go={go} />);
    const box = screen.getByRole('combobox', { name: 'Search the console' });
    fireEvent.change(box, { target: { value: 'rao' } });
    expect(await screen.findByRole('option', { name: /Rao Textiles\s*4831920657/ }, { timeout: 2000 })).toHaveAttribute('aria-selected', 'true');
    expect(api.opsSearch).toHaveBeenCalledWith('rao');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Asha Rao/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(go).toHaveBeenCalledWith('customers', {}, 'a1', 'users');
    expect(box).toHaveValue('');
  });

  it('jumps to the box on "/", and offers a request ID lookup', async () => {
    api.opsSearch.mockResolvedValue({ customers: [], people: [], invoices: [], requestId: '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b' });
    const go = vi.fn();
    render(<OpsSearch go={go} />);
    fireEvent.keyDown(window, { key: '/' });
    const box = screen.getByRole('combobox');
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Look up 6f1c2a9e/ }, { timeout: 2000 }));
    expect(go).toHaveBeenCalledWith('health', { request: '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b' });
  });

  it('says when nothing matches', async () => {
    api.opsSearch.mockResolvedValue({ customers: [], people: [], invoices: [], requestId: null });
    render(<OpsSearch go={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing matches “zzz”.', {}, { timeout: 2000 })).toBeInTheDocument();
  });
});

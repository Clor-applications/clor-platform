import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Reader trust (closure audit O-11, TLA-005) on Attendance records: with the
 * company feature on, a Trust filter and column, and an "Attendance evidence"
 * export (CSV or a printable page) for one person and a period. Off, the
 * screen is as it was.
 */
const api = vi.hoisted(() => ({
  listRecords: vi.fn(),
  listEmployees: vi.fn(() => Promise.resolve([{ id: 'e1', name: 'Rekha Nair', code: 'MF-020' }])),
  getPunchEvidence: vi.fn(),
  getPunchEvidenceCsv: vi.fn(() => Promise.resolve('Day,Punched (IST)\r\n')),
}));
vi.mock('../apps/attendance/src/api/attendance', async (orig) => ({ ...(await orig()), ...api }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import AttendanceRecords from '../apps/attendance/src/screens/AttendanceRecords';

const day = (over) => ({
  id: 'd1', employeeId: 'e1', employeeName: 'Rekha Nair', employeeCode: 'MF-020', date: '2026-10-20', status: 'PRESENT', source: 'DEVICE',
  checkIn: '2026-10-20T03:30:00.000Z', checkOut: '2026-10-20T12:30:00.000Z', checkInTime: '09:00', checkOutTime: '18:00',
  workedMinutes: 540, lateMinutes: 0, earlyOutMinutes: 0, overtimeMinutes: 0, validated: false, ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Attendance records with reader trust', () => {
  it('off: no trust filter, column or evidence export', async () => {
    api.listRecords.mockResolvedValue({ records: [day()], readerTrust: false });
    const user = userEvent.setup();
    render(<AttendanceRecords />);
    await screen.findAllByText('Rekha Nair');
    expect(screen.queryByLabelText('Reader trust')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Trust/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.queryByText('Attendance evidence')).toBeNull();
  });

  it('on: filters by trust, shows it on each day, and exports a person’s punches as CSV or a printable page', async () => {
    api.listRecords.mockImplementation((f) =>
      Promise.resolve({
        readerTrust: true,
        records: [
          day({ trust: 'TRUSTED', trustReasons: [{ code: 'READERS_OK', text: '2 punches from registered readers.' }] }),
          day({ id: 'd2', date: '2026-10-21', trust: 'CHECK', trustReasons: [{ code: 'LATE_UPLOAD', text: 'Punch at 09:00 reached CLOR 3 days after it was made.' }] }),
        ].filter((r) => !f.trust || r.trust === f.trust),
      })
    );
    const user = userEvent.setup();
    render(<AttendanceRecords />);
    await screen.findAllByText('Rekha Nair');
    expect(screen.getByRole('columnheader', { name: /Trust/ })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Trusted')).toBeInTheDocument();
    expect(within(table).getByText('Check').closest('td')).toHaveAttribute('title', 'Punch at 09:00 reached CLOR 3 days after it was made.');

    await user.selectOptions(screen.getAllByLabelText('Reader trust')[0], 'CHECK');
    await waitFor(() => expect(api.listRecords).toHaveBeenLastCalledWith(expect.objectContaining({ trust: 'CHECK' })));
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Trusted')).toBeNull());

    /* The export: pick the person and the period, then CSV or print. */
    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(await screen.findByText('Attendance evidence'));
    const drawer = await screen.findByRole('dialog', { name: 'Attendance evidence' });
    const csv = within(drawer).getByRole('button', { name: /Download CSV/ });
    expect(csv).toBeDisabled();
    await user.selectOptions(within(drawer).getByLabelText('Person'), 'e1');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await user.click(csv);
    await waitFor(() => expect(api.getPunchEvidenceCsv).toHaveBeenCalledWith('e1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));

    const doc = { write: vi.fn(), close: vi.fn() };
    const win = { document: doc, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win);
    api.getPunchEvidence.mockResolvedValue({
      period: { from: '2026-10-01', to: '2026-10-27' },
      employee: { id: 'e1', name: 'Rekha Nair', code: 'MF-020' },
      summary: { punches: 1, days: 1, trusted: 0, check: 1, manual: 0 },
      rows: [{ date: '2026-10-21', punched: '2026-10-21 09:00:00', received: '2026-10-24 11:00:00', delayMinutes: 4440, direction: 'IN', readerId: '20', serialNumber: 'CQZ7', reader: 'Gate', method: 'Fingerprint', geofence: 'Not a phone punch', dayTrust: 'CHECK', dayReasons: 'Punch at 09:00 reached CLOR 3 days after it was made.' }],
    });
    await user.click(within(drawer).getByRole('button', { name: /Printable page/ }));
    await waitFor(() => expect(win.print).toHaveBeenCalled());
    const page = doc.write.mock.calls[0][0];
    expect(page).toContain('Attendance evidence');
    expect(page).toContain('CQZ7');
    expect(page).toContain('2026-10-24 11:00:00');
    expect(page).toContain('<td>Check</td>');
  });
});

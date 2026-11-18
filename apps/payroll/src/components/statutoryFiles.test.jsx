import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { checklistLine, esicRow, ESIC_COLUMNS } from './filingChecks';
import PtStateField from './PtStateField';
import TdsDepositsPanel from './TdsDepositsPanel';
import { getEmployee } from '../api/payrollPeople';
import { addTdsChallan, getTdsChallans } from '../api/payrollReports';
import { requestOpenScreen } from '@platform/context';

vi.mock('../api/payrollPeople', () => ({ getEmployee: vi.fn() }));
vi.mock('../api/payrollReports', () => ({ getTdsChallans: vi.fn(), addTdsChallan: vi.fn(), removeTdsChallan: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@platform/context', () => ({ requestOpenScreen: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it('says who is ready and who is left out before a download (round 26 and 44)', () => {
  expect(checklistLine({ ready: 82, leftOut: 2, byKind: { NO_UAN: 2 } })).toBe('82 ready · 2 without a UAN');
  expect(checklistLine({ ready: 0, leftOut: 1, byKind: { BAD_IP: 1 } })).toBe('Nobody ready · 1 with an IP number that is not 10 digits');
  expect(checklistLine(null)).toBe('');
});

it('writes an ESIC template row: digits-only IP, letters-only name, reason only when it applies', () => {
  expect(ESIC_COLUMNS).toHaveLength(6);
  expect(esicRow({ ipNumber: '3100123456', name: "Asha O'Rao", days: 30, wages: 18208.4, reason: 0, lastWorkingDay: '' })).toEqual(['3100123456', 'Asha O Rao', 30, 18208, 0, '']);
  expect(esicRow({ ipNumber: '3100123457', name: 'Left Person', days: 12, wages: 7000, reason: 2, lastWorkingDay: '12/09/2026' })).toEqual(['3100123457', 'Left Person', 12, 7000, 2, '12/09/2026']);
});

it('offers the work site’s state for professional tax, with a link to its slab (round 25)', async () => {
  getEmployee.mockResolvedValue({ ptFromSite: { state: 'Maharashtra', site: 'Pune works' } });
  const onChange = vi.fn();
  render(<PtStateField employeeId="e1" value="" onChange={onChange} />);
  expect(await screen.findByRole('option', { name: 'From the work site (Maharashtra)' })).toBeInTheDocument();
  expect(screen.getByText(/Follows Pune works, in Maharashtra/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'See Maharashtra’s slab' }));
  expect(requestOpenScreen).toHaveBeenCalledWith('compliance', { scheme: 'PT', state: 'Maharashtra' });
  await userEvent.selectOptions(screen.getByLabelText('Professional tax state'), 'Karnataka');
  expect(onChange).toHaveBeenCalledWith('Karnataka');
});

const year = () => ({
  financialYear: '2026-27',
  totals: { tds: 9000, deposited: 0, left: 9000 },
  months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((month) => ({
    month,
    tds: month === '2026-09' ? 9000 : 0,
    deposited: 0,
    left: month === '2026-09' ? 9000 : 0,
    due: '2026-10-07',
    late: false,
    challans: [],
  })),
});

it('lists a row per month with "Add challan" and records one (round 27)', async () => {
  getTdsChallans.mockResolvedValue(year());
  addTdsChallan.mockResolvedValue({ id: 'c1' });
  render(<TdsDepositsPanel fy="2026-27" />);
  await userEvent.click(screen.getByRole('button', { name: /TDS deposits/ }));
  const add = await screen.findAllByRole('button', { name: /Add challan/ });
  expect(add).toHaveLength(12);
  await userEvent.click(add[5]);
  const form = screen.getByRole('form', { name: 'Add a challan for Sep 2026' });
  expect(within(form).getByLabelText('Amount')).toHaveValue('9000');
  await userEvent.type(within(form).getByLabelText('BSR code'), '0510308');
  await userEvent.type(within(form).getByLabelText('Challan serial'), '42');
  await userEvent.type(within(form).getByLabelText('Paid on'), '2026-10-05');
  await userEvent.click(within(form).getByRole('button', { name: 'Add challan' }));
  await waitFor(() => expect(addTdsChallan).toHaveBeenCalledWith({ financialYear: '2026-27', month: '2026-09', bsrCode: '0510308', challanSerial: '42', depositDate: '2026-10-05', amount: 9000 }));
});

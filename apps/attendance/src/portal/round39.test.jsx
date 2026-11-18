import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./portalApi', () => ({
  getPayslips: vi.fn(() => Promise.resolve({ available: true, slips: [{ id: 's1', gross: 125000, net: 100000 }] })),
}));

import { regimeTax, cappedDeductions, compareRegimes } from './regimeTax';
import TaxCompare from './TaxCompare';

describe('round 39: old and new regime side by side', () => {
  it('works out the new regime with the ₹12 lakh rebate and marginal relief', () => {
    expect(regimeTax('NEW', 1000000)).toBe(0); // 9.25 lakh taxable, rebated
    expect(regimeTax('NEW', 1500000)).toBe(97500); // 93,750 + cess
    expect(regimeTax('NEW', 1280000)).toBe(5200); // relief: 5,000 over the line + cess
  });

  it('works out the old regime with deductions, the senior slab and the ₹5 lakh rebate', () => {
    expect(regimeTax('OLD', 1000000, 150000)).toBe(75400);
    expect(regimeTax('OLD', 550000, 0)).toBe(0);
    expect(regimeTax('OLD', 1000000, 150000, { senior: true })).toBe(72800);
  });

  it('caps each declared item', () => {
    const items = [{ code: '80C', cap: 150000 }, { code: '80D', cap: 25000, seniorCap: 50000 }];
    expect(cappedDeductions(items, { '80C': 200000, '80D': 40000 })).toBe(175000);
    expect(cappedDeductions(items, { '80C': 200000, '80D': 40000 }, { senior: true })).toBe(190000);
  });

  it('names the lower regime and what it saves', () => {
    expect(compareRegimes(1500000, 150000)).toMatchObject({ lower: 'NEW', saves: expect.any(Number) });
    expect(compareRegimes(400000, 0)).toMatchObject({ lower: null, saves: 0 });
  });

  it('starts from the latest payslip times twelve and offers the lower regime', async () => {
    const onPick = vi.fn();
    render(<TaxCompare items={[{ code: '80C', cap: 150000 }]} declared={{ '80C': 0 }} regime="OLD" onPick={onPick} />);
    const input = await screen.findByLabelText(/salary for the year/i);
    await waitFor(() => expect(input).toHaveValue(1500000));
    expect(screen.getByRole('status')).toHaveTextContent(/New saves you about ₹/);
    fireEvent.click(screen.getByRole('button', { name: 'Use the new regime' }));
    expect(onPick).toHaveBeenCalledWith('NEW');
  });

  it('shows no pick button when the lower regime is already chosen', async () => {
    render(<TaxCompare items={[]} declared={{}} regime="NEW" onPick={() => {}} />);
    await screen.findByText(/New saves you about/);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

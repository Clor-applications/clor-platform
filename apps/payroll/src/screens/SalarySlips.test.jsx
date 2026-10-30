import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { DeductionNote } from './SalarySlips';

it('says what moved to next month and why', () => {
  render(<DeductionNote note={{ percent: 50, wages: 20000, limit: 10000, reason: 'LIMIT', total: 4000, carried: [{ label: 'Loan Recovery', amount: 4000 }] }} />);
  expect(screen.getByText('Moved to next month')).toBeInTheDocument();
  expect(screen.getByText('Loan Recovery')).toBeInTheDocument();
  expect(screen.getByText(/up to 50% of wages/)).toBeInTheDocument();
});

it('words it differently when net pay ran out before the limit', () => {
  render(<DeductionNote note={{ percent: 50, wages: 1000, limit: 500, reason: 'NET_PAY', total: 100, carried: [{ label: 'Advance', amount: 100 }] }} />);
  expect(screen.getByText(/nothing left to take it from/)).toBeInTheDocument();
});

it('shows nothing when nothing moved', () => {
  const { container } = render(<DeductionNote note={null} />);
  expect(container).toBeEmptyDOMElement();
});

it('F6: when other deductions alone pass the share, it says so rather than naming a smaller figure as what was held', () => {
  render(<DeductionNote note={{ percent: 50, wages: 15000, limit: 7500, counted: 7800, reason: 'LIMIT', total: 8000, carried: [{ label: 'Advance recovery', amount: 3000 }, { label: 'Salary advance', amount: 5000 }] }} />);
  expect(screen.getByText(/other deductions already came to ₹7,800(\.00)?, so none was taken this month/)).toBeInTheDocument();
  expect(screen.queryByText(/held to/)).toBeNull();
});

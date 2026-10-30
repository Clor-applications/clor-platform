import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { DeductionNote } from './SalarySlips';

it('says what moved to next month and why', () => {
  render(<DeductionNote note={{ percent: 50, wages: 20000, limit: 10000, reason: 'LIMIT', total: 4000, carried: [{ label: 'Loan Recovery', amount: 4000 }] }} />);
  expect(screen.getByText('Moved to next month')).toBeInTheDocument();
  expect(screen.getByText('Loan Recovery')).toBeInTheDocument();
  expect(screen.getByText(/held to 50% of wages/)).toBeInTheDocument();
});

it('words it differently when net pay ran out before the limit', () => {
  render(<DeductionNote note={{ percent: 50, wages: 1000, limit: 500, reason: 'NET_PAY', total: 100, carried: [{ label: 'Advance', amount: 100 }] }} />);
  expect(screen.getByText(/nothing left to take it from/)).toBeInTheDocument();
});

it('shows nothing when nothing moved', () => {
  const { container } = render(<DeductionNote note={null} />);
  expect(container).toBeEmptyDOMElement();
});

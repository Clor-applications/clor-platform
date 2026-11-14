import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProfitLossReport from './ProfitLossReport';

describe('ProfitLossReport comparisons', () => {
  it('keeps filters and actions on the title row with visible dates and shows amounts without currency symbols', () => {
    const { container } = render(<ProfitLossReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    const headerRow = screen.getByRole('heading', { name: 'Profit & Loss Account' }).parentElement;
    expect(headerRow).toContainElement(screen.getByRole('button', { name: 'Current Period' }));
    expect(headerRow).toContainElement(screen.getByRole('button', { name: 'Compare with' }));
    expect(headerRow).toContainElement(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('button', { name: 'Current Period' })).toHaveTextContent(/\d{2} .*\d{4}/);
    expect(screen.getByRole('button', { name: 'Compare with' })).toHaveTextContent(/\d{2} .*\d{4}/);
    expect(container.querySelector('.profit-loss-statement tbody')).not.toHaveTextContent('₹');
  });

  it('adds a dated amount column for each prior period and hides percentages and variance', () => {
    render(<ProfitLossReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Number of comparison periods' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getAllByRole('columnheader', { name: 'Amount (₹)' })).toHaveLength(4);
    expect(screen.queryByRole('columnheader', { name: '% of Sales' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Variance' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Compare with' })).toHaveTextContent('3 periods');
    // Dates read dd/mm/yyyy, the platform's date format.
    expect(screen.getAllByRole('columnheader', { name: /^\d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}$/ })).toHaveLength(4);
  });

  it('compares the selected period with previous years', () => {
    render(<ProfitLossReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Comparison type' }), { target: { value: 'previousYear' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Number of comparison periods' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('button', { name: 'Compare with' })).toHaveTextContent('2 years');
    expect(screen.getAllByRole('columnheader', { name: 'Amount (₹)' })).toHaveLength(3);
  });

  it('uses the same bordered header structure for thirty comparison periods', () => {
    const { container } = render(<ProfitLossReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Number of comparison periods' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(container.querySelector('.pnl-report-table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: 'Amount (₹)' })).toHaveLength(31);
    expect(container.querySelectorAll('.pnl-report-table thead tr:first-child .pnl-period-heading')).toHaveLength(31);
  });
});

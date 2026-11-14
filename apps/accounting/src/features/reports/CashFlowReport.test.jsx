import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CashFlowReport from './CashFlowReport';

describe('CashFlowReport comparisons', () => {
  it('adds a dated cash-flow column for every selected previous year', () => {
    const { container } = render(<CashFlowReport db={{}} currentCompany={{ id: 1, name: 'Neev' }} />);
    const header = screen.getByRole('heading', { name: 'Cash Flow Statement' }).parentElement;
    expect(header).toContainElement(screen.getByRole('button', { name: 'Current Period' }));
    expect(header).toContainElement(screen.getByRole('button', { name: 'Compare with' }));

    fireEvent.click(screen.getByRole('button', { name: 'Compare with' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Comparison type' }), { target: { value: 'previousYear' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Number of comparison periods' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('button', { name: 'Compare with' })).toHaveTextContent('3 years');
    expect(container.querySelectorAll('.cash-flow-table thead th')).toHaveLength(5);
    expect(container.querySelectorAll('.cash-flow-table tbody tr:first-child td')).toHaveLength(5);
    expect(container.querySelector('.cash-flow-table tbody')).not.toHaveTextContent('₹');
  });
});

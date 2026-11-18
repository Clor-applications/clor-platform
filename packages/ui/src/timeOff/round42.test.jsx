import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ForWhom, UnpaidNote, reasonFor } from './round42';
import LongLeaveSpan from './LongLeaveSpan';

/* Round 42 picks (18 Nov 2026): sick leave for a child, unpaid leave cost, adoption weeks. */

afterEach(() => { cleanup(); delete document.documentElement.dataset.palette; });

describe('sick leave for a child', () => {
  it('starts the reason with "For my child" only when picked', () => {
    expect(reasonFor('fever', true)).toBe('For my child: fever');
    expect(reasonFor('  fever ', false)).toBe('fever');
    expect(reasonFor('For my child: fever', true)).toBe('For my child: fever');
  });
  it('shows Me / My child for sick leave only', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ForWhom typeName="Casual leave" value={false} onChange={onChange} />);
    expect(screen.queryByRole('radiogroup', { name: 'Who is ill' })).toBeNull();
    rerender(<ForWhom typeName="Sick leave" value={false} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Me' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'My child' }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<ForWhom typeName="Sick leave" value onChange={onChange} />);
    expect(screen.getByText(/Taken from your own sick leave/)).toBeInTheDocument();
  });
  it('is not drawn in Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    render(<ForWhom typeName="Sick leave" value={false} onChange={() => {}} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('leave without pay', () => {
  it('says the pay is cut for those days', () => {
    render(<UnpaidNote type={{ isPaid: false }} total={3} />);
    expect(screen.getByRole('note')).toHaveTextContent('Without pay: your pay for the month is cut for these 3 days.');
  });
  it('says nothing for paid leave or no days', () => {
    const { container, rerender } = render(<UnpaidNote type={{ isPaid: true }} total={3} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<UnpaidNote type={{ isPaid: false }} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('adoption leave', () => {
  it('fills 12 weeks from the day the child comes home', () => {
    const onFill = vi.fn();
    render(<LongLeaveSpan typeName="Adoption leave" fromDate="2027-02-02" toDate="" onFill={onFill} />);
    expect(screen.getByText(/For a child under 3 months: 12 weeks/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fill 12 weeks/ }));
    expect(onFill).toHaveBeenCalledWith('2027-04-26');
  });
  it('keeps 26 weeks for maternity', () => {
    render(<LongLeaveSpan typeName="Maternity leave" fromDate="2027-02-02" toDate="" onFill={() => {}} />);
    expect(screen.getByRole('button', { name: /Fill 26 weeks/ })).toBeInTheDocument();
    expect(screen.queryByText(/under 3 months/)).toBeNull();
  });
});

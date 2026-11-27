import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import TimeRegisterTable from './TimeRegisterTable';

it('keeps optional fields, grouped totals and stored choices aligned when the register reopens', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const register = <TimeRegisterTable enabled register="alignment-test" required={['Employee']} defaultHidden={['Department']}>
    <thead><tr><th>Department</th><th>Employee</th><th>Hours</th></tr></thead>
    <tbody><tr><td>Operations</td><td>Mira</td><td>8</td></tr></tbody>
    <tfoot><tr><td colSpan={2}>Total</td><td>8</td></tr></tfoot>
  </TimeRegisterTable>;
  try {
    const result = render(register);
    expect(screen.queryByRole('columnheader', { name: 'Department' })).toBeNull();
    expect(screen.getByText('Total').colSpan).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const menu = screen.getByRole('group', { name: 'Columns' });
    expect(within(menu).getByLabelText('Employee').disabled).toBe(true);
    fireEvent.click(within(menu).getByLabelText('Department'));
    expect(screen.getByText('Total').colSpan).toBe(2);
    result.unmount();
    render(register);
    expect(screen.getByRole('columnheader', { name: 'Department' })).toBeTruthy();
    expect(screen.getByText('Operations').cellIndex).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    Object.keys(localStorage).filter(k => k.includes(':alignment-test:')).forEach(k => localStorage.removeItem(k));
  }
});

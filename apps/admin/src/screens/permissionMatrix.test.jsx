import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PermissionMatrix from './PermissionMatrix';

const CATALOG = [
  { key: 'PEOPLE', label: 'People', resources: [{ key: 'Employees', label: 'Employees', actions: ['VIEW'] }] },
  {
    key: 'ATTENDANCE',
    label: 'Attendance',
    resources: [
      { key: 'Shifts', label: 'Shifts', actions: ['VIEW'] },
      { key: 'Leave Types', label: 'Leave types', actions: ['VIEW', 'EDIT'] },
    ],
  },
];

/* Two sections share the ATTENDANCE key; each opens on its own and grants its own wire keys. */
describe('the permission matrix with Time & Leave split out', () => {
  it('draws Time & Leave and Attendance as separate sections', () => {
    const onToggle = vi.fn();
    const onSetMany = vi.fn();
    render(<PermissionMatrix modules={CATALOG} granted={new Set()} onToggle={onToggle} onSetMany={onSetMany} initiallyOpen={0} />);
    const time = screen.getByRole('button', { name: /Time & Leave/ });
    const attendance = screen.getByRole('button', { name: /^Attendance/ });
    fireEvent.click(time);
    expect(time.getAttribute('aria-expanded')).toBe('true');
    expect(attendance.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByLabelText('Edit Leave types'));
    expect(onToggle).toHaveBeenCalledWith('ATTENDANCE::Leave Types::EDIT');
    fireEvent.click(screen.getByLabelText('Grant every permission in Time & Leave'));
    expect(onSetMany).toHaveBeenCalledWith(['ATTENDANCE::Leave Types::VIEW', 'ATTENDANCE::Leave Types::EDIT'], true);
  });
});

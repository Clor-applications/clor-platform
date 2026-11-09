import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import LeaveRequests from './LeaveRequests';
import { PermissionContext } from '@ui/permissions/context';

vi.mock('./api', async (orig) => ({
  ...(await orig()),
  getLeaveSettings: vi.fn().mockResolvedValue({ current: { year: 2026 }, periods: [] }),
  listLeaveTypes: vi.fn().mockResolvedValue([]),
  pageLeaveRequests: vi.fn().mockResolvedValue({ requests: [], total: 0, counts: {} }),
}));
vi.mock('./suggestions', () => ({ useSuggestions: () => [] }));

/* People plan 8 Nov 2026, step 3: with no leave types the primary is Set up leave types, once; the empty state is a sentence with a link. */
it('with no leave types, Set up leave types is the one primary and the empty state links to Leave policy', async () => {
  const openScreen = vi.fn();
  render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><LeaveRequests params={{}} updateParams={() => {}} openScreen={openScreen} /></PermissionContext.Provider>);
  expect(await screen.findByText('No leave types yet')).toBeTruthy();
  const buttons = screen.getAllByRole('button', { name: 'Set up leave types' });
  expect(buttons).toHaveLength(1);
  expect(buttons[0].className).toContain('ui-btn-primary');
  expect(screen.queryByRole('button', { name: /Enter leave/ })).toBeNull();
  expect(screen.getByText(/need at least one leave type/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Settings › Leave policy' }));
  expect(openScreen).toHaveBeenCalledWith('leaveTypes');
});
